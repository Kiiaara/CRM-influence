"""Отправка сообщений в Telegram через Bot API.
Бот должен быть тем же, что используется для логина (AUTH_BOT_TOKEN).
chat_id == tg_id юзера, при условии что юзер написал боту /start."""
import logging
import httpx
from config import settings

log = logging.getLogger(__name__)
TG_API = "https://api.telegram.org"


async def send_message(chat_id: int, text: str) -> bool:
    if not settings.auth_bot_token:
        log.warning("AUTH_BOT_TOKEN не задан, уведомление не отправлено")
        return False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{TG_API}/bot{settings.auth_bot_token}/sendMessage",
                json={"chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True},
            )
            if r.status_code == 200:
                return True
            log.warning("TG sendMessage %s -> %s: %s", chat_id, r.status_code, r.text)
            return False
    except Exception:
        log.exception("Не удалось отправить TG-сообщение")
        return False
