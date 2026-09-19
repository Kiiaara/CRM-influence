"""Диалог в Telegram: создание новой интеграции (пошаговый мастер) и
редактирование существующей (инлайн-кнопки: сделка -> категория -> поле -> значение).
Состояние диалога держим в памяти процесса (простой dict по tg_id) -
процесс один (uvicorn без воркеров), так что этого достаточно."""
import logging
import os
import re
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from database import SessionLocal
from models.advertiser import Advertiser
from models.audit_log import AuditLogEntry
from models.integration import Integration
from models.integration_streamer import IntegrationStreamer
from models.user import User
from models.workspace import WorkspaceMember
import notifier
from notifier import send_message


def _resolve_workspace_id(db: Session, tg_id: int) -> Optional[int]:
    """Пространство, в которое создаём/редактируем сделки из бота - первое, где юзер состоит участником."""
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

# tg_id -> {"step": int, "data": {...}} (создание) либо {"mode": "edit_value"|"edit_contract_file", ...} (редактирование)
_sessions: dict[int, dict] = {}

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "data", "contracts")

# ---------- редактирование существующих сделок: лейблы, поля, категории ----------

STAGE_LABELS = {
    "negotiation": "На согласовании",
    "agreed": "Согласован",
    "awaiting_contract": "Ждёт договора",
    "awaiting_payment": "Ждёт оплаты",
    "done": "Завершено",
    "cancelled": "Отменено",
}
PAYMENT_LABELS = {
    "not_invoiced": "Не выставлен",
    "invoiced": "Выставлен счёт",
    "partial": "Частично оплачен",
    "paid": "Оплачен",
}
CONTENT_LABELS = {"awaiting_brief": "Ждём ТЗ", "filming": "Снимает контент", "filmed": "Снят контент"}
CONTRACT_STATUS_LABELS = {
    "not_sent": "Не отправлен",
    "sent_to_streamer": "Отправлен стримеру",
    "signed_by_streamer": "Подписан стримером",
    "sent_to_brand": "Отправлен бренду",
    "signed_by_brand": "Подписан брендом",
    "active": "Активен",
    "expired": "Истёк",
}
ORD_RESPONSIBLE_LABELS = {"us": "Мы", "client": "Клиент"}
ORD_STATUS_LABELS = {"todo": "Сделать", "done": "Сделано"}
ORD_REPORTING_LABELS = {"not_submitted": "Не сдана", "submitted": "Сдана", "overdue": "Просрочена"}

# поле -> (словарь лейблов, можно ли "не задано")
ENUM_FIELDS = {
    "stage": (STAGE_LABELS, False),
    "payment_status": (PAYMENT_LABELS, False),
    "content_status": (CONTENT_LABELS, True),
    "contract_status": (CONTRACT_STATUS_LABELS, False),
    "ord_responsible": (ORD_RESPONSIBLE_LABELS, False),
    "ord_status": (ORD_STATUS_LABELS, False),
    "ord_reporting_status": (ORD_REPORTING_LABELS, False),
}

# поле -> тип ввода для текстовых полей (не-enum)
FIELD_TYPE = {
    "amount": "float",
    "currency": "text",
    "commission_percent": "float",
    "streamer_tax_percent": "float",
    "deadline": "date",
    "integration_date": "date",
    "integration_time": "time",
    "contact": "text",
    "streamer_name": "text",
    "description": "text",
    "contract_sent_date": "date",
    "contract_signed_date": "date",
    "contract_valid_until": "date",
    "contract_notes": "text",
    "brief": "text",
}

# поля, у которых в БД реально допустим NULL (остальные NOT NULL с дефолтом "" или числом -
# для них "нет" очищает в "" для текста, либо трактуется как невалидный ввод для чисел)
NULLABLE_FIELDS = {
    "amount", "deadline", "integration_date", "integration_time",
    "contract_sent_date", "contract_signed_date", "contract_valid_until",
}

FIELD_LABELS = {
    "stage": "Стадия",
    "payment_status": "Оплата",
    "content_status": "Статус контента",
    "amount": "Сумма",
    "currency": "Валюта",
    "commission_percent": "Комиссия, %",
    "streamer_tax_percent": "Налог стримера, %",
    "deadline": "Дедлайн",
    "integration_date": "Дата интеграции",
    "integration_time": "Время старта стрима",
    "contact": "Контакт",
    "streamer_name": "Имя стримера",
    "description": "Описание",
    "contract_status": "Статус договора",
    "contract_sent_date": "Договор отправлен",
    "contract_signed_date": "Договор подписан",
    "contract_valid_until": "Договор действует до",
    "contract_notes": "Заметка по договору",
    "brief": "ТЗ",
    "ord_responsible": "Ответственный (ОРД)",
    "ord_status": "Статус маркировки",
    "ord_reporting_status": "Отчётность ОРД",
}

# категории меню: (ключ, заголовок, [поля]); "__file__" - особый пункт загрузки договора
CATEGORIES = [
    ("main", "📋 Основное", ["stage", "payment_status", "content_status"]),
    ("amounts", "💰 Суммы", ["amount", "currency", "commission_percent", "streamer_tax_percent"]),
    ("dates", "📅 Даты", ["deadline", "integration_date", "integration_time"]),
    ("contract", "✍️ Договор", ["contract_status", "contract_sent_date", "contract_signed_date", "contract_valid_until", "contract_notes", "__file__"]),
    ("ord", "🏷️ Маркировка ОРД", ["ord_responsible", "ord_status", "ord_reporting_status"]),
    ("other", "📝 Прочее", ["contact", "streamer_name", "description", "brief"]),
]

# те же поля, что логируются в журнал изменений на сайте (routers/integrations.py TRACKED_FIELDS)
TRACKED_FIELDS = (
    "stage", "payment_status", "content_status", "amount", "deadline",
    "contract_status", "contract_sent_date", "contract_signed_date",
    "ord_status", "ord_reporting_status",
)


def _category_of(field: str) -> str:
    for key, _, fields in CATEGORIES:
        if field in fields:
            return key
    return "main"


def _log_audit(db: Session, it: Integration, s: IntegrationStreamer, field: str, old, new, tg_id: int):
    if old == new:
        return
    db.add(AuditLogEntry(
        workspace_id=it.workspace_id, streamer_id=s.id, integration_id=s.integration_id,
        brand=it.brand, streamer_name=s.streamer_name, field=field,
        old_value=str(old) if old is not None else None,
        new_value=str(new) if new is not None else None,
        changed_by_tg_id=tg_id,
    ))


def _current_value_label(s: IntegrationStreamer, field: str) -> str:
    v = getattr(s, field)
    if field in ENUM_FIELDS:
        labels, _ = ENUM_FIELDS[field]
        return "—" if v is None else labels.get(v, v)
    if v is None:
        return "—"
    if isinstance(v, datetime):
        return v.strftime("%d.%m.%Y")
    return str(v)[:24]


def _streamer_button_label(s: IntegrationStreamer) -> str:
    stage_label = STAGE_LABELS.get(s.stage, s.stage)
    label = f"{s.integration.brand} · {s.streamer_name} ({stage_label})"
    return label[:64]


async def start_edit_flow(tg_id: int):
    db = SessionLocal()
    try:
        workspace_id = _resolve_workspace_id(db, tg_id)
        if workspace_id is None:
            await send_message(tg_id, "У тебя нет доступа ни к одному пространству, обратись к админу.")
            return
        streamers = (
            db.query(IntegrationStreamer)
            .join(Integration)
            .options(joinedload(IntegrationStreamer.integration))
            .filter(Integration.workspace_id == workspace_id)
            .order_by(IntegrationStreamer.updated_at.desc())
            .limit(15)
            .all()
        )
        if not streamers:
            await send_message(tg_id, "Пока нет ни одной сделки. Начни с /new_integration.")
            return
        keyboard = [[{"text": _streamer_button_label(s), "callback_data": f"e:cat:{s.id}"}] for s in streamers]
        await send_message(tg_id, "Какую сделку редактируем?", inline_keyboard=keyboard)
    finally:
        db.close()


async def _show_category_menu(tg_id: int, sid: int):
    db = SessionLocal()
    try:
        s = db.get(IntegrationStreamer, sid)
        if not s:
            await send_message(tg_id, "Карточка не найдена (возможно, удалена).")
            return
        it = db.get(Integration, s.integration_id)
        keyboard = [[{"text": label, "callback_data": f"e:fld:{sid}:{key}"}] for key, label, _ in CATEGORIES]
        keyboard.append([{"text": "✅ Готово", "callback_data": "e:done"}])
        await send_message(tg_id, f"<b>{it.brand} × {s.streamer_name}</b>\nЧто меняем?", inline_keyboard=keyboard)
    finally:
        db.close()


async def _show_field_menu(tg_id: int, sid: int, cat_key: str):
    db = SessionLocal()
    try:
        s = db.get(IntegrationStreamer, sid)
        if not s:
            await send_message(tg_id, "Карточка не найдена.")
            return
        cat = next((c for c in CATEGORIES if c[0] == cat_key), None)
        if not cat:
            return
        keyboard = []
        for field in cat[2]:
            if field == "__file__":
                text = "📎 " + ("заменить файл договора" if s.contract_file_name else "загрузить файл договора")
                keyboard.append([{"text": text, "callback_data": f"e:file:{sid}"}])
                continue
            label = FIELD_LABELS[field]
            current = _current_value_label(s, field)
            keyboard.append([{"text": f"{label}: {current}", "callback_data": f"e:pick:{sid}:{field}"}])
        keyboard.append([{"text": "⬅️ Назад", "callback_data": f"e:cat:{sid}"}])
        await send_message(tg_id, f"<b>{cat[1]}</b>", inline_keyboard=keyboard)
    finally:
        db.close()


async def _pick_field(tg_id: int, sid: int, field: str):
    if field in ENUM_FIELDS:
        labels, nullable = ENUM_FIELDS[field]
        keyboard = [[{"text": lbl, "callback_data": f"e:val:{sid}:{field}:{key}"}] for key, lbl in labels.items()]
        if nullable:
            keyboard.append([{"text": "🚫 Не задано", "callback_data": f"e:val:{sid}:{field}:__none__"}])
        keyboard.append([{"text": "⬅️ Назад", "callback_data": f"e:fld:{sid}:{_category_of(field)}"}])
        await send_message(tg_id, f"{FIELD_LABELS[field]} - выбери значение:", inline_keyboard=keyboard)
        return

    _sessions[tg_id] = {"mode": "edit_value", "streamer_id": sid, "field": field}
    prompts = {
        "float": "Введи число (например 15000).",
        "date": "Введи дату в формате ДД.ММ.ГГГГ (или «нет», чтобы убрать).",
        "time": "Введи время в формате ЧЧ:ММ (например 18:30), или «нет», чтобы убрать.",
        "text": "Введи новое значение (или «нет», чтобы очистить).",
    }
    ftype = FIELD_TYPE[field]
    await send_message(tg_id, f"{FIELD_LABELS[field]}\n{prompts[ftype]}")


async def _apply_enum(tg_id: int, sid: int, field: str, raw_val: str):
    db = SessionLocal()
    try:
        s = db.get(IntegrationStreamer, sid)
        if not s:
            await send_message(tg_id, "Карточка не найдена.")
            return
        value = None if raw_val == "__none__" else raw_val
        old = getattr(s, field)
        setattr(s, field, value)
        it = db.get(Integration, s.integration_id)
        if field in TRACKED_FIELDS and it:
            _log_audit(db, it, s, field, old, value, tg_id)
        db.commit()
        await send_message(tg_id, "✅ Обновлено")
        await _show_field_menu(tg_id, sid, _category_of(field))
    finally:
        db.close()


async def _apply_text_value(tg_id: int, sid: int, field: str, raw: str) -> bool:
    """Возвращает True, если значение принято и сохранено. False - если ввод
    невалиден (сессия при этом переоткрывается заново, чтобы юзер мог повторить)."""
    ftype = FIELD_TYPE[field]
    is_clear = raw.lower() in ("нет", "-", "no")

    if is_clear:
        if field in NULLABLE_FIELDS:
            value: object = None
        elif ftype == "text":
            value = ""
        else:
            await send_message(tg_id, "Это поле обязательное, очистить нельзя. Введи число.")
            _sessions[tg_id] = {"mode": "edit_value", "streamer_id": sid, "field": field}
            return False
    elif ftype == "float":
        try:
            value = float(raw.replace(",", ".").replace(" ", ""))
        except ValueError:
            await send_message(tg_id, "Не понял число, попробуй ещё раз.")
            _sessions[tg_id] = {"mode": "edit_value", "streamer_id": sid, "field": field}
            return False
    elif ftype == "date":
        try:
            value = datetime.strptime(raw, "%d.%m.%Y")
        except ValueError:
            await send_message(tg_id, "Не понял дату, формат ДД.ММ.ГГГГ или «нет».")
            _sessions[tg_id] = {"mode": "edit_value", "streamer_id": sid, "field": field}
            return False
    elif ftype == "time":
        if not _TIME_RE.match(raw):
            await send_message(tg_id, "Не понял время, формат ЧЧ:ММ (например 18:30) или «нет».")
            _sessions[tg_id] = {"mode": "edit_value", "streamer_id": sid, "field": field}
            return False
        value = raw
    else:
        value = raw

    db = SessionLocal()
    try:
        s = db.get(IntegrationStreamer, sid)
        if not s:
            await send_message(tg_id, "Карточка не найдена.")
            return True
        it = db.get(Integration, s.integration_id)
        old = getattr(s, field)
        setattr(s, field, value)
        if field in TRACKED_FIELDS and it:
            _log_audit(db, it, s, field, old, value, tg_id)
        if field in ("integration_date", "integration_time"):
            s.notified_stream_start = False
            s.notified_screenshot = False
            s.notified_report = False
        db.commit()
        await send_message(tg_id, "✅ Обновлено")
        await _show_field_menu(tg_id, sid, _category_of(field))
    finally:
        db.close()
    return True


async def _pick_file(tg_id: int, sid: int):
    _sessions[tg_id] = {"mode": "edit_contract_file", "streamer_id": sid}
    await send_message(tg_id, "Пришли файл договора документом (не фото, а именно 📎 файл).")


async def handle_document(tg_id: int, file_id: Optional[str], file_name: Optional[str]) -> bool:
    """Обрабатывает присланный документ, если сейчас ждём файл договора."""
    session = _sessions.get(tg_id)
    if not session or session.get("mode") != "edit_contract_file":
        return False
    sid = session["streamer_id"]
    del _sessions[tg_id]

    if not file_id:
        await send_message(tg_id, "Не вижу файл, попробуй ещё раз через /edit_integration.")
        return True

    path = await notifier.get_file_path(file_id)
    content = await notifier.download_file(path) if path else None
    if content is None:
        await send_message(tg_id, "Не смог скачать файл из Telegram, попробуй ещё раз.")
        return True

    file_name = file_name or "contract"
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(file_name)[1][:16]
    dest_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}{ext}")

    db = SessionLocal()
    try:
        s = db.get(IntegrationStreamer, sid)
        if not s:
            await send_message(tg_id, "Карточка не найдена.")
            return True
        if s.contract_file_path and os.path.exists(s.contract_file_path):
            os.remove(s.contract_file_path)
        with open(dest_path, "wb") as f:
            f.write(content)
        s.contract_file_path = dest_path
        s.contract_file_name = file_name
        it = db.get(Integration, s.integration_id)
        if it:
            _log_audit(db, it, s, "contract_uploaded", None, file_name, tg_id)
        db.commit()
        await send_message(tg_id, f"✅ Договор загружен: {file_name}")
        await _show_field_menu(tg_id, sid, "contract")
    finally:
        db.close()
    return True


async def handle_callback(tg_id: int, data: str) -> bool:
    """Обрабатывает нажатия инлайн-кнопок редактирования (callback_data вида 'e:...')."""
    parts = data.split(":")
    if not parts or parts[0] != "e":
        return False
    action = parts[1] if len(parts) > 1 else ""
    try:
        if action == "cat":
            await _show_category_menu(tg_id, int(parts[2]))
        elif action == "fld":
            await _show_field_menu(tg_id, int(parts[2]), parts[3])
        elif action == "pick":
            await _pick_field(tg_id, int(parts[2]), parts[3])
        elif action == "val":
            await _apply_enum(tg_id, int(parts[2]), parts[3], parts[4])
        elif action == "file":
            await _pick_file(tg_id, int(parts[2]))
        elif action == "done":
            _sessions.pop(tg_id, None)
            await send_message(tg_id, "Готово ✅")
        else:
            return False
    except (IndexError, ValueError):
        log.exception("Некорректный callback_data: %s", data)
        return False
    return True


def _cancel_text() -> str:
    return "Диалог отменён. /new_integration - новая сделка, /edit_integration - редактировать существующую."


async def handle_command(tg_id: int, text: str) -> bool:
    """Обрабатывает /new_integration, /edit_integration и /cancel. Возвращает True, если сообщение обработано."""
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

    if text.startswith("/edit_integration"):
        db = SessionLocal()
        try:
            user = db.get(User, tg_id)
        finally:
            db.close()
        if not user:
            await send_message(tg_id, "Доступ запрещён.")
            return True
        _sessions.pop(tg_id, None)
        await start_edit_flow(tg_id)
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

    if session.get("mode") == "edit_value":
        ok = await _apply_text_value(tg_id, session["streamer_id"], session["field"], text.strip())
        if ok:
            _sessions.pop(tg_id, None)
        return True

    if session.get("mode") == "edit_contract_file":
        await send_message(tg_id, "Жду именно файл договора (📎), не текст.")
        return True

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
