"""Управление пользователями (whitelist + роли). Доступно только админам."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from deps import get_current_user, require_role
from models.user import User
from models.auth_session import AuthSession

router = APIRouter(prefix="/api/users", tags=["users"])


class UserOut(BaseModel):
    tg_id: int
    role: str
    label: Optional[str] = None
    tg_username: Optional[str] = None
    tg_first_name: Optional[str] = None
    tg_chat_ready: bool
    created_at: datetime
    is_self: bool = False
    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    tg_id: int
    role: str = "editor"
    label: Optional[str] = None


class UserUpdate(BaseModel):
    role: Optional[str] = None
    label: Optional[str] = None


class MeUpdate(BaseModel):
    label: str


@router.patch("/me")
def update_me(data: MeUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Юзер сам может поменять только своё отображаемое имя - роль назначает только админ."""
    label = data.label.strip()
    if not label:
        raise HTTPException(400, "Имя не может быть пустым")
    user.label = label
    db.commit()
    db.refresh(user)
    return {
        "tg_id": user.tg_id,
        "username": user.tg_username,
        "first_name": user.tg_first_name,
        "role": user.role,
        "label": user.label,
        "tg_chat_ready": user.tg_chat_ready,
    }


@router.get("", response_model=List[UserOut])
def list_users(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(User).order_by(User.created_at.asc()).all()
    return [UserOut.model_validate(r).model_copy(update={"is_self": r.tg_id == user.tg_id}) for r in rows]


@router.post("", response_model=UserOut, status_code=201, dependencies=[Depends(require_role("admin"))])
def add_user(data: UserCreate, db: Session = Depends(get_db)):
    if data.role not in ("admin", "editor", "viewer"):
        raise HTTPException(400, "Роль: admin | editor | viewer")
    if db.get(User, data.tg_id):
        raise HTTPException(400, "Такой TG ID уже добавлен")
    u = User(tg_id=data.tg_id, role=data.role, label=data.label)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@router.patch("/{tg_id}", response_model=UserOut, dependencies=[Depends(require_role("admin"))])
def update_user(tg_id: int, data: UserUpdate, db: Session = Depends(get_db)):
    u = db.get(User, tg_id)
    if not u:
        raise HTTPException(404)
    if data.role is not None:
        if data.role not in ("admin", "editor", "viewer"):
            raise HTTPException(400)
        u.role = data.role
    if data.label is not None:
        u.label = data.label
    db.commit()
    db.refresh(u)
    return u


@router.delete("/{tg_id}", dependencies=[Depends(require_role("admin"))])
def delete_user(tg_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if tg_id == user.tg_id:
        raise HTTPException(400, "Себя удалить нельзя")
    u = db.get(User, tg_id)
    if not u:
        raise HTTPException(404)
    db.delete(u)
    db.query(AuthSession).filter(AuthSession.tg_id == tg_id).delete()
    db.commit()
    return {"ok": True}
