"""TG Login Widget авторизация. Логика взята из smm-autoposter и адаптирована
под модель User (с ролями) и whitelist-bootstrap из .env."""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, Cookie
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config import settings
from database import get_db, SessionLocal
from models.auth_session import AuthSession
from models.user import User
from deps import get_current_user, SESSION_COOKIE

router = APIRouter(prefix="/api/auth", tags=["auth"])


def bootstrap_initial_admins():
    """При первом старте поднимаем AUTH_ALLOWED_TG_IDS из .env в БД как админов."""
    raw = settings.auth_allowed_tg_ids or ""
    ids = [int(x.strip()) for x in raw.split(",") if x.strip().isdigit()]
    if not ids:
        return
    db = SessionLocal()
    try:
        for tg_id in ids:
            if not db.get(User, tg_id):
                db.add(User(tg_id=tg_id, role="admin", label="initial admin"))
        db.commit()
    finally:
        db.close()


def _verify_tg_signature(data: dict, bot_token: str) -> bool:
    received_hash = data.get("hash")
    if not received_hash:
        return False
    pairs = [f"{k}={v}" for k, v in sorted(data.items()) if k != "hash" and v is not None]
    data_check_string = "\n".join(pairs)
    secret_key = hashlib.sha256(bot_token.encode()).digest()
    expected = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, received_hash)


@router.get("/config")
def auth_config():
    """Фронту нужен username бота, чтобы поднять Login Widget."""
    return {"bot_username": settings.auth_bot_username}


@router.post("/telegram")
async def telegram_login(request: Request, response: Response, db: Session = Depends(get_db)):
    if not settings.auth_bot_token:
        raise HTTPException(500, "AUTH_BOT_TOKEN не настроен")

    data = await request.json()
    norm = {k: str(v) for k, v in data.items() if v is not None}

    if not _verify_tg_signature(norm, settings.auth_bot_token):
        raise HTTPException(401, "Невалидная подпись Telegram")

    try:
        auth_date = int(norm.get("auth_date", "0"))
    except ValueError:
        raise HTTPException(400, "Некорректный auth_date")
    if datetime.now().timestamp() - auth_date > 86400:
        raise HTTPException(401, "Срок авторизации истёк, попробуй снова")

    tg_id = int(norm.get("id", "0"))

    user = db.get(User, tg_id)
    has_anyone = db.query(User).first() is not None

    if not user:
        if not has_anyone:
            # самый первый - админ
            user = User(tg_id=tg_id, role="admin", label=norm.get("first_name") or "owner")
            db.add(user)
        else:
            raise HTTPException(403, f"Доступ запрещён. Твой TG ID: {tg_id}. Попроси админа добавить.")

    # обновляем данные из TG
    user.tg_username = norm.get("username")
    user.tg_first_name = norm.get("first_name")
    db.commit()
    db.refresh(user)

    token = secrets.token_hex(32)
    expires = datetime.now() + timedelta(days=settings.session_ttl_days)
    db.add(AuthSession(token=token, tg_id=tg_id, expires_at=expires))
    db.commit()

    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_ttl_days * 86400,
        httponly=True,
        secure=False,  # для локалки; на VPS поставим True (через переменную)
        samesite="lax",
        path="/",
    )
    return {
        "ok": True,
        "tg_id": tg_id,
        "username": user.tg_username,
        "first_name": user.tg_first_name,
        "role": user.role,
        "tg_chat_ready": user.tg_chat_ready,
    }


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {
        "tg_id": user.tg_id,
        "username": user.tg_username,
        "first_name": user.tg_first_name,
        "role": user.role,
        "label": user.label,
        "tg_chat_ready": user.tg_chat_ready,
    }


@router.post("/logout")
def logout(response: Response, session_token: Optional[str] = Cookie(None, alias=SESSION_COOKIE), db: Session = Depends(get_db)):
    if session_token:
        sess = db.get(AuthSession, session_token)
        if sess:
            db.delete(sess)
            db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}
