"""Зависимости FastAPI: текущий юзер и проверка роли."""
from datetime import datetime
from typing import Optional
from fastapi import Depends, HTTPException, Cookie
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from models.auth_session import AuthSession
from models.user import User

SESSION_COOKIE = "zametochnitsa_session"


def _get_or_create_dev_user(db: Session) -> User:
    """В dev-режиме возвращаем (или создаём) фиктивного юзера-админа.
    tg_id берём из AUTH_ALLOWED_TG_IDS если есть, иначе 0."""
    raw = settings.auth_allowed_tg_ids or ""
    ids = [int(x.strip()) for x in raw.split(",") if x.strip().isdigit()]
    tg_id = ids[0] if ids else 0
    user = db.get(User, tg_id)
    if not user:
        user = User(tg_id=tg_id, role="admin", label="dev user", tg_first_name="dev")
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def get_current_user(
    session_token: Optional[str] = Cookie(None, alias=SESSION_COOKIE),
    db: Session = Depends(get_db),
) -> User:
    if settings.dev_auth_bypass:
        return _get_or_create_dev_user(db)
    if not session_token:
        raise HTTPException(401, "Не авторизован")
    sess = db.get(AuthSession, session_token)
    if not sess or sess.expires_at < datetime.now():
        raise HTTPException(401, "Сессия истекла")
    user = db.get(User, sess.tg_id)
    if not user:
        raise HTTPException(401, "Пользователь удалён")
    return user


def require_role(*allowed: str):
    """require_role('admin') или require_role('admin','editor')"""
    def _checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(403, f"Нужна роль: {', '.join(allowed)}")
        return user
    return _checker
