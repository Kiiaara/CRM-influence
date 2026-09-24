"""APScheduler: проверяет задачи и шлёт уведомления.
- сразу после создания задачи с assignee - notified_assigned (через хук в роутере)
- за ~30 минут до дедлайна - один раз notified_deadline
- бот-листенер по long-polling параллельно: фиксирует /start чтобы tg_chat_ready=True"""
import asyncio
import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.orm import joinedload, Session

from config import settings
from database import SessionLocal
from models.task import Task
from models.user import User
from models.integration_streamer import IntegrationStreamer
from notifier import send_message
import notifier
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
            link = f"{settings.public_url}/tasks"
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
            link = f"{settings.public_url}/tasks"
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


async def _notify_creator(db: Session, s: IntegrationStreamer, text: str):
    """Шлём тому, кто добавил карточку стримера в канбан. Если создатель не
    известен (старые записи) или ещё не подключил чат - фолбэк на рассылку
    всем админам, как было раньше."""
    creator = db.get(User, s.created_by_tg_id) if s.created_by_tg_id else None
    if creator and creator.tg_chat_ready:
        await send_message(creator.tg_id, text)
        return
    await _notify_admins(text)


def _day_bounds(offset_days: int) -> tuple[datetime, datetime]:
    day = (datetime.now() + timedelta(days=offset_days)).date()
    start = datetime(day.year, day.month, day.day)
    return start, start + timedelta(days=1)


def _stream_start_dt(s: IntegrationStreamer) -> datetime | None:
    """Точное время старта стрима, если оно указано (integration_date - только день,
    время времени старта хранится отдельно в integration_time как 'ЧЧ:ММ')."""
    if not s.integration_date or not s.integration_time:
        return None
    try:
        hh, mm = (int(x) for x in s.integration_time.split(":"))
    except ValueError:
        return None
    return s.integration_date.replace(hour=hh, minute=mm, second=0, microsecond=0)


def _screenshot_trigger_dt(s: IntegrationStreamer) -> datetime | None:
    """Через 2 часа после старта стрима: либо если время не указано - в 15:00 того же дня."""
    start = _stream_start_dt(s)
    if start:
        return start + timedelta(hours=2)
    if s.integration_date:
        return s.integration_date.replace(hour=15, minute=0, second=0, microsecond=0)
    return None


def _report_trigger_dt(s: IntegrationStreamer) -> datetime | None:
    """Ещё через 20 минут после напоминания про скриншот."""
    screenshot = _screenshot_trigger_dt(s)
    return screenshot + timedelta(minutes=20) if screenshot else None


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
            await _notify_creator(db, s, f"🎨 Завтра интеграция с <b>{s.streamer_name}</b>. Повесили брендинг по РК {s.integration.brand}?")
            s.notified_branding_check = True
        db.commit()
    finally:
        db.close()


async def _check_stream_start_reminders():
    """Ровно в момент старта стрима (если время указано): 'стрим начинается'."""
    db = SessionLocal()
    try:
        now = datetime.now()
        rows = (
            db.query(IntegrationStreamer)
            .options(joinedload(IntegrationStreamer.integration))
            .filter(
                IntegrationStreamer.integration_date >= now - timedelta(days=1),
                IntegrationStreamer.integration_date <= now + timedelta(days=1),
                IntegrationStreamer.integration_time.isnot(None),
                IntegrationStreamer.notified_stream_start == False,
                IntegrationStreamer.stage != "cancelled",
            )
            .all()
        )
        for s in rows:
            trigger = _stream_start_dt(s)
            if trigger and now >= trigger:
                await _notify_creator(db, s, f"🔴 Стрим начинается: <b>{s.streamer_name}</b> ({s.integration.brand})")
                s.notified_stream_start = True
        db.commit()
    finally:
        db.close()


async def _check_screenshot_reminders():
    """Через 2 часа после старта стрима (или в 15:00, если время не указано): 'сделала скриншот?'"""
    db = SessionLocal()
    try:
        now = datetime.now()
        rows = (
            db.query(IntegrationStreamer)
            .options(joinedload(IntegrationStreamer.integration))
            .filter(
                IntegrationStreamer.integration_date >= now - timedelta(days=2),
                IntegrationStreamer.integration_date <= now,
                IntegrationStreamer.notified_screenshot == False,
                IntegrationStreamer.stage != "cancelled",
            )
            .all()
        )
        for s in rows:
            trigger = _screenshot_trigger_dt(s)
            if trigger and now >= trigger:
                await _notify_creator(db, s, f"📸 Сегодня интеграция с <b>{s.streamer_name}</b> ({s.integration.brand}). Ты сделала скриншот РК?")
                s.notified_screenshot = True
        db.commit()
    finally:
        db.close()


async def _check_report_reminders():
    """Через 20 минут после напоминания про скриншот: 'отдала клиенту отчёт?'"""
    db = SessionLocal()
    try:
        now = datetime.now()
        rows = (
            db.query(IntegrationStreamer)
            .options(joinedload(IntegrationStreamer.integration))
            .filter(
                IntegrationStreamer.integration_date >= now - timedelta(days=2),
                IntegrationStreamer.integration_date <= now,
                IntegrationStreamer.notified_report == False,
                IntegrationStreamer.stage != "cancelled",
            )
            .all()
        )
        for s in rows:
            trigger = _report_trigger_dt(s)
            if trigger and now >= trigger:
                await _notify_creator(db, s, f"📋 Интеграция с <b>{s.streamer_name}</b> ({s.integration.brand}) сегодня. Отдала клиенту отчёт?")
                s.notified_report = True
        db.commit()
    finally:
        db.close()


async def _check_case_reminders():
    """Разово, когда сделка завершена (stage=done) и по ней ещё нет кейса для сайта - напоминаем добавить."""
    db = SessionLocal()
    try:
        rows = (
            db.query(IntegrationStreamer)
            .options(joinedload(IntegrationStreamer.integration))
            .filter(
                IntegrationStreamer.stage == "done",
                IntegrationStreamer.notified_case_reminder == False,
            )
            .all()
        )
        for s in rows:
            if s.has_case:
                s.notified_case_reminder = True
                continue
            await _notify_creator(db, s, f"🎬 Интеграция с <b>{s.streamer_name}</b> ({s.integration.brand}) завершена. Не забудь добавить кейс для сайта!")
            s.notified_case_reminder = True
        db.commit()
    finally:
        db.close()


async def _check_hot_tasks_push():
    """Раз в N часов (свой интервал у каждого юзера) шлёт сводку «Горячие задачи»,
    если у юзера включена эта настройка, сейчас не тихие часы и есть что показать."""
    db = SessionLocal()
    try:
        now = datetime.now()
        users = db.query(User).filter(User.tg_chat_ready == True, User.notify_hot_tasks == True).all()
        for u in users:
            if bot_dialog.in_quiet_hours(now, u.quiet_hours_start, u.quiet_hours_end):
                continue
            interval = max(1, u.notify_interval_hours or 4)
            if u.last_hot_tasks_notified_at and (now - u.last_hot_tasks_notified_at) < timedelta(hours=interval):
                continue
            workspace_id = bot_dialog._resolve_workspace_id(db, u.tg_id)
            u.last_hot_tasks_notified_at = now
            if workspace_id is None:
                continue
            total, text = bot_dialog.compute_hot_tasks(db, workspace_id)
            if total > 0:
                await send_message(u.tg_id, text)
        db.commit()
    finally:
        db.close()


# ── Long-polling listener для /start ────────────────────────
_tg_offset = 0


async def _poll_telegram_updates():
    """Слушает getUpdates: /start, текстовые команды/шаги диалога, нажатия инлайн-кнопок
    редактирования (callback_query) и присланные документы/фото (договор, файлы ТЗ, фото кейса)."""
    global _tg_offset
    if not settings.auth_bot_token:
        return
    try:
        async with httpx.AsyncClient(timeout=35.0) as client:
            r = await client.get(
                f"{settings.telegram_api_base}/bot{settings.auth_bot_token}/getUpdates",
                params={"offset": _tg_offset, "timeout": 25, "allowed_updates": '["message","callback_query"]'},
            )
            if r.status_code != 200:
                return
            data = r.json()
            for upd in data.get("result", []):
                _tg_offset = upd["update_id"] + 1

                cq = upd.get("callback_query")
                if cq:
                    tg_id = (cq.get("from") or {}).get("id")
                    cq_id = cq.get("id")
                    if tg_id and cq_id:
                        await notifier.answer_callback_query(cq_id)
                        await bot_dialog.handle_callback(tg_id, cq.get("data") or "")
                    continue

                msg = upd.get("message") or {}
                from_ = msg.get("from") or {}
                tg_id = from_.get("id")
                if not tg_id:
                    continue

                doc = msg.get("document")
                if doc:
                    await bot_dialog.handle_document(tg_id, doc.get("file_id"), doc.get("file_name"))
                    continue
                photos = msg.get("photo")
                if photos:
                    # фото приходит несколькими размерами - берём самое большое (последнее)
                    biggest = photos[-1]
                    await bot_dialog.handle_document(tg_id, biggest.get("file_id"), f"photo_{biggest.get('file_unique_id', 'tg')}.jpg")
                    continue

                text = msg.get("text") or ""
                if text.startswith("/start"):
                    _mark_chat_ready(tg_id, from_)
                    await send_message(
                        tg_id,
                        "Привет 👋 Я буду присылать тебе уведомления по интеграциям из CRM-influence.\n\n"
                        "Жми кнопку ниже или пиши /new_integration, чтобы добавить интеграцию, "
                        "/edit_integration - чтобы отредактировать карточку, "
                        "/menu - чтобы открыть всё остальное: сделки и КП, рекламодателей, задачи, кейсы, "
                        "базы стримеров и блогеров.",
                        with_keyboard=True,
                    )
                    continue
                if text.strip() == "❌ Отменить диалог":
                    text = "/cancel"
                elif text.strip() == "➕ Новая интеграция":
                    text = "/new_integration"
                elif text.strip() == "✏️ Редактировать":
                    text = "/edit_integration"
                elif text.strip() == "🔥 Горячие задачи":
                    text = "/hot_tasks"
                elif text.strip() == "⚙️ Настройки":
                    text = "/settings"
                elif text.strip() == "📂 Меню":
                    text = "/menu"
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
    # напоминания по интеграциям: за день утром (брендинг - фикс. время),
    # дальше цепочка от времени старта стрима - старт / +2ч скриншот / +20мин отчёт
    _scheduler.add_job(_check_branding_reminders, CronTrigger(hour=10, minute=0), id="branding_reminder")
    _scheduler.add_job(_check_stream_start_reminders, "interval", minutes=1, id="stream_start_reminder")
    _scheduler.add_job(_check_screenshot_reminders, "interval", minutes=5, id="screenshot_reminder")
    _scheduler.add_job(_check_report_reminders, "interval", minutes=5, id="report_reminder")
    _scheduler.add_job(_check_case_reminders, "interval", minutes=5, id="case_reminder")
    # персональная сводка "Горячие задачи" - каждому по своему интервалу/тихим часам (настройки в /settings)
    _scheduler.add_job(_check_hot_tasks_push, "interval", minutes=15, id="hot_tasks_push")
    _scheduler.start()
    log.info("Scheduler started")


def stop_scheduler():
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
