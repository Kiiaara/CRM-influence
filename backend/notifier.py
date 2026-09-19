"""Отправка сообщений в Telegram через Bot API.
Бот должен быть тем же, что используется для логина (AUTH_BOT_TOKEN).
chat_id == tg_id юзера, при условии что юзер написал боту /start."""
import logging
from typing import Optional

import httpx
from config import settings

log = logging.getLogger(__name__)


MAIN_KEYBOARD = {
    "keyboard": [
        [{"text": "➕ Новая интеграция"}, {"text": "✏️ Редактировать"}],
        [{"text": "❌ Отменить диалог"}],
    ],
    "resize_keyboard": True,
}


async def send_message(chat_id: int, text: str, with_keyboard: bool = False, inline_keyboard: Optional[list] = None) -> bool:
    if not settings.auth_bot_token:
        log.warning("AUTH_BOT_TOKEN не задан, уведомление не отправлено")
        return False
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True}
    if inline_keyboard is not None:
        payload["reply_markup"] = {"inline_keyboard": inline_keyboard}
    elif with_keyboard:
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


async def answer_callback_query(callback_query_id: str, text: Optional[str] = None) -> None:
    """Гасит 'часики' на нажатой inline-кнопке в клиенте Telegram."""
    if not settings.auth_bot_token:
        return
    payload = {"callback_query_id": callback_query_id}
    if text:
        payload["text"] = text
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{settings.telegram_api_base}/bot{settings.auth_bot_token}/answerCallbackQuery",
                json=payload,
            )
    except Exception:
        log.exception("Не удалось ответить на callback_query")


async def get_file_path(file_id: str) -> Optional[str]:
    """Резолвит file_id присланного документа в file_path для скачивания."""
    if not settings.auth_bot_token:
        return None
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                f"{settings.telegram_api_base}/bot{settings.auth_bot_token}/getFile",
                params={"file_id": file_id},
            )
            if r.status_code != 200:
                log.warning("getFile %s -> %s: %s", file_id, r.status_code, r.text)
                return None
            return r.json().get("result", {}).get("file_path")
    except Exception:
        log.exception("Не удалось получить file_path")
        return None


async def download_file(file_path: str) -> Optional[bytes]:
    if not settings.auth_bot_token:
        return None
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(f"{settings.telegram_api_base}/file/bot{settings.auth_bot_token}/{file_path}")
            if r.status_code != 200:
                log.warning("download file %s -> %s", file_path, r.status_code)
                return None
            return r.content
    except Exception:
        log.exception("Не удалось скачать файл из Telegram")
        return None


async def set_my_commands():
    """Регистрирует меню команд бота (кнопка Menu рядом с полем ввода)."""
    if not settings.auth_bot_token:
        return
    commands = [
        {"command": "new_integration", "description": "Добавить новую интеграцию"},
        {"command": "edit_integration", "description": "Редактировать существующую сделку"},
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
