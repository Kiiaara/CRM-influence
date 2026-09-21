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
from models.workspace import WorkspaceMember

router = APIRouter(prefix="/api/users", tags=["users"])

WORKSPACE_ROLES = ("owner", "lead", "viewer")


def _has_telegram(u: User) -> bool:
    """У VK-only юзера tg_id синтетический (отрицательный) - настоящего чата нет."""
    return u.tg_id > 0


def _out(u: User, is_self: bool = False) -> "UserOut":
    return UserOut.model_validate(u).model_copy(
        update={"is_self": is_self, "has_telegram": _has_telegram(u)}
    )


class UserOut(BaseModel):
    tg_id: int
    role: str
    label: Optional[str] = None
    tg_username: Optional[str] = None
    tg_first_name: Optional[str] = None
    vk_id: Optional[int] = None
    tg_chat_ready: bool
    created_at: datetime
    is_self: bool = False
    # для VK-only юзеров tg_id синтетический, уведомления им не уйдут
    has_telegram: bool = True
    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    # tg_id необязателен: можно завести человека по одному VK ID, но тогда
    # он останется без уведомлений в боте
    tg_id: Optional[int] = None
    vk_id: Optional[int] = None
    role: str = "editor"
    label: Optional[str] = None
    # опционально сразу кидаем человека в пространство - чтобы не делать это вторым шагом
    workspace_id: Optional[int] = None
    workspace_role: str = "viewer"


class UserUpdate(BaseModel):
    role: Optional[str] = None
    label: Optional[str] = None
    vk_id: Optional[int] = None


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
    """Админ видит всех, остальные - только тех, с кем делят хотя бы одно пространство:
    приглашённый под один проект не должен знать, кто работает в остальных."""
    q = db.query(User)
    if user.role != "admin":
        my_ws = db.query(WorkspaceMember.workspace_id).filter(WorkspaceMember.user_tg_id == user.tg_id)
        coworkers = (
            db.query(WorkspaceMember.user_tg_id)
            .filter(WorkspaceMember.workspace_id.in_(my_ws))
            .distinct()
        )
        q = q.filter(User.tg_id.in_(coworkers))
    rows = q.order_by(User.created_at.asc()).all()
    return [_out(r, is_self=r.tg_id == user.tg_id) for r in rows]


@router.post("", response_model=UserOut, status_code=201)
def add_user(data: UserCreate, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    if data.role not in ("admin", "editor", "viewer"):
        raise HTTPException(400, "Роль: admin | editor | viewer")
    if data.tg_id is None and data.vk_id is None:
        raise HTTPException(400, "Нужен TG ID или VK ID")
    if data.tg_id is not None and db.get(User, data.tg_id):
        raise HTTPException(400, "Такой TG ID уже добавлен")
    if data.vk_id is not None and db.query(User).filter(User.vk_id == data.vk_id).first():
        raise HTTPException(400, "Этот VK ID уже привязан к другому пользователю")

    # пространство проверяем до создания юзера, чтобы не осталось полудобавленных
    if data.workspace_id is not None:
        if data.workspace_role not in WORKSPACE_ROLES:
            raise HTTPException(400, f"Роль в пространстве: {', '.join(WORKSPACE_ROLES)}")
        mine = (
            db.query(WorkspaceMember)
            .filter_by(workspace_id=data.workspace_id, user_tg_id=user.tg_id)
            .first()
        )
        if not mine or mine.role not in ("owner", "lead"):
            raise HTTPException(403, "Нет прав добавлять людей в это пространство")

    # tg_id - первичный ключ, поэтому для VK-only юзера ставим заглушку -vk_id.
    # Тот же приём используется в auth.vk_login для самого первого админа;
    # при входе через TG настоящий id привяжется к аккаунту.
    tg_id = data.tg_id if data.tg_id is not None else -data.vk_id
    if data.tg_id is None and db.get(User, tg_id):
        raise HTTPException(400, "Этот VK ID уже привязан к другому пользователю")

    u = User(tg_id=tg_id, vk_id=data.vk_id, role=data.role, label=data.label)
    db.add(u)
    if data.workspace_id is not None:
        db.add(WorkspaceMember(
            workspace_id=data.workspace_id,
            user_tg_id=tg_id,
            role=data.workspace_role,
            joined_at=datetime.now(),
        ))
    db.commit()
    db.refresh(u)
    return _out(u)


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
    # null отвязывает VK; проверяем занятость, иначе чужой вход попадёт в этот аккаунт
    if "vk_id" in data.model_fields_set:
        if data.vk_id is not None:
            taken = db.query(User).filter(User.vk_id == data.vk_id, User.tg_id != tg_id).first()
            if taken:
                raise HTTPException(400, "Этот VK ID уже привязан к другому пользователю")
        elif not _has_telegram(u):
            raise HTTPException(400, "У этого пользователя нет Telegram - без VK ID он не сможет войти")
        u.vk_id = data.vk_id
    db.commit()
    db.refresh(u)
    return _out(u)


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
