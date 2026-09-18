"""APScheduler: проверяет задачи и шлёт уведомления.
- сразу после создания задачи с assignee - notified_assigned (через хук в роутере)
- за ~30 минут до дедлайна - один раз notified_deadline
- бот-листенер по long-polling параллельно: фиксирует /start чтобы tg_chat_ready=True"""
import asyncio
import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.orm import joinedload

from config import settings
from database import SessionLocal
from models.task import Task
from models.user import User
from models.integration_streamer import IntegrationStreamer
from notifier import send_message
import bot_dialog
import httpx

log = logging.getLogger(__name__)
_scheduler: AsyncIOScheduler | None = None


async def _check_deadlines():
    """Раз в минуту: задачи которые в ближайшие 30 мин - уведомить."""
    db = SessionLocal()
    try:
        now = datetime.now()
        soon = now + timedelta(minutes=30)
        tasks = (
            db.query(Task)
            .filter(
                Task.due_at.isnot(None),
                Task.due_at >= now,
                Task.due_at <= soon,
                Task.notified_deadline == False,
                Task.status != "done",
                Task.assignee_tg_id.isnot(None),
            )
            .all()
        )
        for t in tasks:
            user = db.get(User, t.assignee_tg_id) if t.assignee_tg_id else None
            if not user or not user.tg_chat_ready:
                continue
            link = f"{settings.public_url}/calendar"
            text = (
                f"⏰ Скоро дедлайн: <b>{t.title}</b>\n"
                f"Срок: {t.due_at.strftime('%d.%m.%Y %H:%M')}\n"
                f'<a href="{link}">Открыть календарь</a>'
            )
            ok = await send_message(t.assignee_tg_id, text)
            if ok:
                t.notified_deadline = True
        db.commit()
    finally:
        db.close()


async def _notify_assigned():
    """Шлёт «тебе поставили задачу» для тех, кто ещё не оповещён."""
    db = SessionLocal()
    try:
        tasks = (
            db.query(Task)
            .filter(
                Task.assignee_tg_id.isnot(None),
                Task.notified_assigned == False,
                Task.status != "done",
            )
            .all()
        )
        for t in tasks:
            user = db.get(User, t.assignee_tg_id) if t.assignee_tg_id else None
            if not user or not user.tg_chat_ready:
                continue
            link = f"{settings.public_url}/calendar"
            due = t.due_at.strftime('%d.%m.%Y %H:%M') if t.due_at else 'без срока'
            text = (
                f"📌 Тебе поставили задачу: <b>{t.title}</b>\n"
                f"Дедлайн: {due}\n"
                f'<a href="{link}">Открыть</a>'
            )
            ok = await send_message(t.assignee_tg_id, text)
            if ok:
                t.notified_assigned = True
        db.commit()
    finally:
        db.close()


async def _notify_admins(text: str):
    """Шлёт сообщение всем админам, которые уже писали боту /start."""
    db = SessionLocal()
    try:
        admins = db.query(User).filter(User.role == "admin", User.tg_chat_ready == True).all()
        for u in admins:
            await send_message(u.tg_id, text)
    finally:
        db.close()


def _day_bounds(offset_days: int) -> tuple[datetime, datetime]:
    day = (datetime.now() + timedelta(days=offset_days)).date()
    start = datetime(day.year, day.month, day.day)
    return start, start + timedelta(days=1)


async def _check_branding_reminders():
    """За день до интеграции: 'повесили брендинг?'"""
    db = SessionLocal()
    try:
        start, end = _day_bounds(1)
        rows = (
            db.query(IntegrationStreamer)
            .options(joinedload(IntegrationStreamer.integration))
            .filter(
                IntegrationStreamer.integration_date >= start,
                IntegrationStreamer.integration_date < end,
                IntegrationStreamer.notified_branding_check == False,
                IntegrationStreamer.stage != "cancelled",
            )
            .all()
        )
        for s in rows:
            await _notify_admins(f"🎨 Завтра интеграция с <b>{s.streamer_name}</b>. Повесили брендинг по РК {s.integration.brand}?")
            s.notified_branding_check = True
        db.commit()
    finally:
        db.close()


async def _check_screenshot_reminders():
    """В день интеграции (утром): 'сделала скриншот?'"""
    db = SessionLocal()
    try:
        start, end = _day_bounds(0)
        rows = (
            db.query(IntegrationStreamer)
            .options(joinedload(IntegrationStreamer.integration))
            .filter(
                IntegrationStreamer.integration_date >= start,
                IntegrationStreamer.integration_date < end,
                IntegrationStreamer.notified_screenshot == False,
                IntegrationStreamer.stage != "cancelled",
            )
            .all()
        )
        for s in rows:
            await _notify_admins(f"📸 Сегодня интеграция с <b>{s.streamer_name}</b> ({s.integration.brand}). Ты сделала скриншот РК?")
            s.notified_screenshot = True
        db.commit()
    finally:
        db.close()


async def _check_report_reminders():
    """В конце дня интеграции: 'отдала клиенту отчёт?'"""
    db = SessionLocal()
    try:
        start, end = _day_bounds(0)
        rows = (
            db.query(IntegrationStreamer)
            .options(joinedload(IntegrationStreamer.integration))
            .filter(
                IntegrationStreamer.integration_date >= start,
                IntegrationStreamer.integration_date < end,
                IntegrationStreamer.notified_report == False,
                IntegrationStreamer.stage != "cancelled",
            )
            .all()
        )
        for s in rows:
            await _notify_admins(f"📋 Интеграция с <b>{s.streamer_name}</b> ({s.integration.brand}) сегодня. Отдала клиенту отчёт?")
            s.notified_report = True
        db.commit()
    finally:
        db.close()


# ── Long-polling listener для /start ────────────────────────
_tg_offset = 0


async def _poll_telegram_updates():
    """Слушает getUpdates, если кто-то из whitelist пишет /start - отмечаем tg_chat_ready=True."""
    global _tg_offset
    if not settings.auth_bot_token:
        return
    try:
        async with httpx.AsyncClient(timeout=35.0) as client:
            r = await client.get(
                f"https://api.telegram.org/bot{settings.auth_bot_token}/getUpdates",
                params={"offset": _tg_offset, "timeout": 25, "allowed_updates": '["message"]'},
            )
            if r.status_code != 200:
                return
            data = r.json()
            for upd in data.get("result", []):
                _tg_offset = upd["update_id"] + 1
                msg = upd.get("message") or {}
                from_ = msg.get("from") or {}
                tg_id = from_.get("id")
                text = msg.get("text") or ""
                if not tg_id:
                    continue
                if text.startswith("/start"):
                    _mark_chat_ready(tg_id, from_)
                    await send_message(tg_id, "Привет 👋 Я буду присылать тебе уведомления о задачах из «Заметочницы».")
                    continue
                if await bot_dialog.handle_command(tg_id, text):
                    continue
                await bot_dialog.handle_message(tg_id, text)
    except Exception:
        log.exception("Ошибка getUpdates")


def _mark_chat_ready(tg_id: int, from_user: dict):
    db = SessionLocal()
    try:
        u = db.get(User, tg_id)
        if not u:
            return  # не в whitelist - игнор
        u.tg_chat_ready = True
        if not u.tg_username and from_user.get("username"):
            u.tg_username = from_user["username"]
        if not u.tg_first_name and from_user.get("first_name"):
            u.tg_first_name = from_user["first_name"]
        db.commit()
    finally:
        db.close()


def start_scheduler():
    global _scheduler
    if _scheduler:
        return
    _scheduler = AsyncIOScheduler()
    interval = max(15, settings.scheduler_interval_seconds)
    _scheduler.add_job(_check_deadlines, "interval", seconds=interval, id="deadlines")
    _scheduler.add_job(_notify_assigned, "interval", seconds=30, id="assigned")
    _scheduler.add_job(_poll_telegram_updates, "interval", seconds=2, id="tg_poll", max_instances=1, coalesce=True)
    # напоминания по интеграциям: за день утром, в день утром (скрин), в день вечером (отчёт)
    _scheduler.add_job(_check_branding_reminders, CronTrigger(hour=10, minute=0), id="branding_reminder")
    _scheduler.add_job(_check_screenshot_reminders, CronTrigger(hour=10, minute=5), id="screenshot_reminder")
    _scheduler.add_job(_check_report_reminders, CronTrigger(hour=19, minute=0), id="report_reminder")
    _scheduler.start()
    log.info("Scheduler started")


def stop_scheduler():
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
