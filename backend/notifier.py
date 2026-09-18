"""Отправка сообщений в Telegram через Bot API.
Бот должен быть тем же, что используется для логина (AUTH_BOT_TOKEN).
chat_id == tg_id юзера, при условии что юзер написал боту /start."""
import logging
import httpx
from config import settings

log = logging.getLogger(__name__)


MAIN_KEYBOARD = {
    "keyboard": [[{"text": "➕ Новая интеграция"}], [{"text": "❌ Отменить диалог"}]],
    "resize_keyboard": True,
}


async def send_message(chat_id: int, text: str, with_keyboard: bool = False) -> bool:
    if not settings.auth_bot_token:
        log.warning("AUTH_BOT_TOKEN не задан, уведомление не отправлено")
        return False
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True}
    if with_keyboard:
        payload["reply_markup"] = MAIN_KEYBOARD
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{settings.telegram_api_base}/bot{settings.auth_bot_token}/sendMessage",
                json=payload,
            )
            if r.status_code == 200:
                return True
            log.warning("TG sendMessage %s -> %s: %s", chat_id, r.status_code, r.text)
            return False
    except Exception:
        log.exception("Не удалось отправить TG-сообщение")
        return False


async def set_my_commands():
    """Регистрирует меню команд бота (кнопка Menu рядом с полем ввода)."""
    if not settings.auth_bot_token:
        return
    commands = [
        {"command": "new_integration", "description": "Добавить новую интеграцию"},
        {"command": "cancel", "description": "Отменить текущий диалог"},
        {"command": "start", "description": "Начать / привязать аккаунт"},
    ]
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{settings.telegram_api_base}/bot{settings.auth_bot_token}/setMyCommands",
                json={"commands": commands},
            )
            if r.status_code != 200:
                log.warning("setMyCommands -> %s: %s", r.status_code, r.text)
    except Exception:
        log.exception("Не удалось зарегистрировать команды бота")
