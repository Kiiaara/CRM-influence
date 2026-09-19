"""Пошаговый диалог в Telegram для создания интеграции прямо из бота.
Состояние диалога держим в памяти процесса (простой dict по tg_id) -
процесс один (uvicorn без воркеров), так что этого достаточно."""
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from database import SessionLocal
from models.advertiser import Advertiser
from models.integration import Integration
from models.integration_streamer import IntegrationStreamer
from models.user import User
from models.workspace import WorkspaceMember
from notifier import send_message


def _resolve_workspace_id(db: Session, tg_id: int) -> Optional[int]:
    """Пространство, в которое создаём сделку из бота - первое, где юзер состоит участником."""
    member = (
        db.query(WorkspaceMember)
        .filter_by(user_tg_id=tg_id)
        .order_by(WorkspaceMember.joined_at.asc())
        .first()
    )
    return member.workspace_id if member else None

log = logging.getLogger(__name__)

STEPS = ["brand", "streamer_name", "amount", "commission_percent", "streamer_tax_percent", "integration_date"]

STEP_PROMPTS = {
    "brand": "Как называется бренд/клиент?",
    "streamer_name": "Имя стримера?",
    "amount": "Сумма сделки (число, без пробелов и валюты)?",
    "commission_percent": "Твоя комиссия, % (например 15)?",
    "streamer_tax_percent": "Налог стримера, % (например 6)?",
    "integration_date": "Дата интеграции в формате ДД.ММ.ГГГГ (или напиши «нет», если пока неизвестна)?",
}

# tg_id -> {"step": int, "data": {...}}
_sessions: dict[int, dict] = {}


def _cancel_text() -> str:
    return "Диалог отменён. Команда /new_integration - начать заново."


async def handle_command(tg_id: int, text: str) -> bool:
    """Обрабатывает /new_integration и /cancel. Возвращает True, если сообщение обработано."""
    if text.startswith("/new_integration"):
        db = SessionLocal()
        try:
            user = db.get(User, tg_id)
        finally:
            db.close()
        if not user:
            await send_message(tg_id, "Доступ запрещён.")
            return True
        _sessions[tg_id] = {"step": 0, "data": {}}
        await send_message(tg_id, f"Новая интеграция.\n{STEP_PROMPTS[STEPS[0]]}")
        return True

    if text.startswith("/cancel"):
        if tg_id in _sessions:
            del _sessions[tg_id]
            await send_message(tg_id, _cancel_text())
            return True
        return False

    return False


async def handle_message(tg_id: int, text: str) -> bool:
    """Продолжает активный диалог, если он есть. Возвращает True, если сообщение обработано."""
    session = _sessions.get(tg_id)
    if not session:
        return False

    step_name = STEPS[session["step"]]
    value = text.strip()

    if step_name == "amount":
        try:
            session["data"]["amount"] = float(value.replace(",", ".").replace(" ", ""))
        except ValueError:
            await send_message(tg_id, "Не понял сумму, введи число (например 100000).")
            return True
    elif step_name in ("commission_percent", "streamer_tax_percent"):
        try:
            session["data"][step_name] = float(value.replace(",", "."))
        except ValueError:
            await send_message(tg_id, "Не понял процент, введи число (например 15).")
            return True
    elif step_name == "integration_date":
        if value.lower() in ("нет", "-", "no"):
            session["data"]["integration_date"] = None
        else:
            try:
                session["data"]["integration_date"] = datetime.strptime(value, "%d.%m.%Y")
            except ValueError:
                await send_message(tg_id, "Не понял дату, формат ДД.ММ.ГГГГ (например 25.09.2026) или «нет».")
                return True
    else:
        session["data"][step_name] = value

    session["step"] += 1

    if session["step"] >= len(STEPS):
        await _finish(tg_id, session["data"])
        del _sessions[tg_id]
        return True

    next_step = STEPS[session["step"]]
    await send_message(tg_id, STEP_PROMPTS[next_step])
    return True


async def _finish(tg_id: int, data: dict):
    db: Session = SessionLocal()
    try:
        workspace_id = _resolve_workspace_id(db, tg_id)
        if workspace_id is None:
            await send_message(tg_id, "У тебя нет доступа ни к одному пространству, обратись к админу.")
            return
        brand_name = data["brand"].strip()
        advertiser = (
            db.query(Advertiser)
            .filter(Advertiser.workspace_id == workspace_id, Advertiser.name == brand_name)
            .first()
        )
        if not advertiser:
            advertiser = Advertiser(workspace_id=workspace_id, name=brand_name)
            db.add(advertiser)
            db.flush()

        integration = (
            db.query(Integration)
            .filter(Integration.advertiser_id == advertiser.id, Integration.workspace_id == workspace_id)
            .order_by(Integration.created_at.desc())
            .first()
        )
        if not integration:
            integration = Integration(workspace_id=workspace_id, advertiser_id=advertiser.id, brand=advertiser.name)
            db.add(integration)
            db.flush()

        max_pos = (
            db.query(IntegrationStreamer)
            .filter(IntegrationStreamer.integration_id == integration.id, IntegrationStreamer.stage == "negotiation")
            .order_by(IntegrationStreamer.position.desc())
            .first()
        )
        streamer = IntegrationStreamer(
            integration_id=integration.id,
            streamer_name=data["streamer_name"],
            amount=data.get("amount"),
            commission_percent=data.get("commission_percent", 15),
            streamer_tax_percent=data.get("streamer_tax_percent", 6),
            integration_date=data.get("integration_date"),
            position=(max_pos.position + 1) if max_pos else 0,
            created_by_tg_id=tg_id,
        )
        db.add(streamer)
        db.commit()

        commission = round((data.get("amount") or 0) * (data.get("commission_percent", 15)) / 100, 2)
        text = (
            f"✅ Добавлено: <b>{data['brand']}</b> × {data['streamer_name']}\n"
            f"Сумма: {data.get('amount') or 0:,.0f}\n"
            f"Комиссия: {commission:,.0f}"
        ).replace(",", " ")
        await send_message(tg_id, text)
    except Exception:
        log.exception("Не удалось создать интеграцию из бот-диалога")
        await send_message(tg_id, "Что-то пошло не так, попробуй ещё раз через /new_integration.")
    finally:
        db.close()
