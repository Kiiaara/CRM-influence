"""CRUD для рабочих пространств (Workspaces) + участники с ролями."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from deps import get_current_user, require_role
from models.user import User
from models.workspace import Workspace, WorkspaceMember
from models.integration import Integration
from models.task import Task

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])

ROLES = ("owner", "lead", "viewer")


def _member_role(db: Session, workspace_id: int, tg_id: int) -> Optional[str]:
    m = (
        db.query(WorkspaceMember)
        .filter_by(workspace_id=workspace_id, user_tg_id=tg_id)
        .first()
    )
    return m.role if m else None


def require_workspace_role(*allowed: str):
    """Depends-фабрика: юзер должен быть участником workspace с одной из ролей.
    workspace_id берём из path-параметра."""
    def _checker(
        workspace_id: int,
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user),
    ) -> str:
        role = _member_role(db, workspace_id, user.tg_id)
        if role is None:
            raise HTTPException(404, "Пространство не найдено")
        if role not in allowed:
            raise HTTPException(403, f"Нужна роль: {', '.join(allowed)}")
        return role
    return _checker


class WorkspaceOut(BaseModel):
    id: int
    title: str
    owner_tg_id: int
    created_at: datetime
    updated_at: datetime
    my_role: str = "viewer"
    model_config = {"from_attributes": True}


class WorkspaceCreate(BaseModel):
    title: str


class WorkspaceUpdate(BaseModel):
    title: str


class MemberOut(BaseModel):
    user_tg_id: int
    role: str
    invited_at: datetime
    joined_at: Optional[datetime] = None
    label: Optional[str] = None
    tg_username: Optional[str] = None
    model_config = {"from_attributes": True}


class InviteIn(BaseModel):
    tg_id: int
    role: str = "viewer"


@router.get("", response_model=List[WorkspaceOut])
def list_workspaces(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (
        db.query(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .filter(WorkspaceMember.user_tg_id == user.tg_id)
        .order_by(Workspace.created_at.asc())
        .all()
    )
    return [
        WorkspaceOut.model_validate(ws).model_copy(update={"my_role": role})
        for ws, role in rows
    ]


@router.post("", response_model=WorkspaceOut, status_code=201)
def create_workspace(data: WorkspaceCreate, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    """Новые пространства заводит только глобальный админ - иначе приглашённый
    мог бы плодить себе проекты."""
    title = data.title.strip()
    if not title:
        raise HTTPException(400, "Название не может быть пустым")
    ws = Workspace(title=title, owner_tg_id=user.tg_id)
    db.add(ws)
    db.commit()
    db.refresh(ws)
    db.add(WorkspaceMember(workspace_id=ws.id, user_tg_id=user.tg_id, role="owner", joined_at=datetime.now()))
    db.commit()
    return WorkspaceOut.model_validate(ws).model_copy(update={"my_role": "owner"})


@router.put("/{workspace_id}", response_model=WorkspaceOut)
def update_workspace(
    workspace_id: int,
    data: WorkspaceUpdate,
    db: Session = Depends(get_db),
    role: str = Depends(require_workspace_role("owner", "lead")),
):
    ws = db.get(Workspace, workspace_id)
    if not ws:
        raise HTTPException(404)
    title = data.title.strip()
    if not title:
        raise HTTPException(400, "Название не может быть пустым")
    ws.title = title
    ws.updated_at = datetime.now()
    db.commit()
    db.refresh(ws)
    return WorkspaceOut.model_validate(ws).model_copy(update={"my_role": role})


@router.delete("/{workspace_id}")
def delete_workspace(
    workspace_id: int,
    db: Session = Depends(get_db),
    role: str = Depends(require_workspace_role("owner")),
):
    if db.query(Workspace).count() <= 1:
        raise HTTPException(400, "Нельзя удалить последнее пространство")
    ws = db.get(Workspace, workspace_id)
    if not ws:
        raise HTTPException(404)
    # переносим интеграции/задачи некуда - явно запрещаем удаление, если внутри есть данные
    has_integrations = db.query(Integration).filter_by(workspace_id=workspace_id).first()
    has_tasks = db.query(Task).filter_by(workspace_id=workspace_id).first()
    if has_integrations or has_tasks:
        raise HTTPException(400, "В пространстве есть сделки или задачи - сначала перенесите или удалите их")
    db.query(WorkspaceMember).filter_by(workspace_id=workspace_id).delete()
    db.delete(ws)
    db.commit()
    return {"ok": True}


@router.get("/{workspace_id}/members", response_model=List[MemberOut])
def list_members(
    workspace_id: int,
    db: Session = Depends(get_db),
    role: str = Depends(require_workspace_role("owner", "lead", "viewer")),
):
    rows = (
        db.query(WorkspaceMember, User)
        .join(User, User.tg_id == WorkspaceMember.user_tg_id)
        .filter(WorkspaceMember.workspace_id == workspace_id)
        .order_by(WorkspaceMember.invited_at.asc())
        .all()
    )
    out = []
    for m, u in rows:
        out.append(
            MemberOut.model_validate(m).model_copy(
                update={"label": u.label, "tg_username": u.tg_username}
            )
        )
    return out


@router.post("/{workspace_id}/invite", response_model=MemberOut, status_code=201)
def invite_member(
    workspace_id: int,
    data: InviteIn,
    db: Session = Depends(get_db),
    role: str = Depends(require_workspace_role("owner", "lead")),
):
    if data.role not in ROLES:
        raise HTTPException(400, f"Роль: {', '.join(ROLES)}")
    target_user = db.get(User, data.tg_id)
    if not target_user:
        raise HTTPException(404, "Такого пользователя нет в whitelist - сначала добавьте его в Users")
    existing = (
        db.query(WorkspaceMember)
        .filter_by(workspace_id=workspace_id, user_tg_id=data.tg_id)
        .first()
    )
    if existing:
        raise HTTPException(400, "Пользователь уже в этом пространстве")
    m = WorkspaceMember(
        workspace_id=workspace_id,
        user_tg_id=data.tg_id,
        role=data.role,
        joined_at=datetime.now(),
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return MemberOut.model_validate(m).model_copy(
        update={"label": target_user.label, "tg_username": target_user.tg_username}
    )


@router.patch("/{workspace_id}/members/{tg_id}", response_model=MemberOut)
def update_member_role(
    workspace_id: int,
    tg_id: int,
    data: InviteIn,
    db: Session = Depends(get_db),
    role: str = Depends(require_workspace_role("owner")),
):
    if data.role not in ROLES:
        raise HTTPException(400, f"Роль: {', '.join(ROLES)}")
    m = db.query(WorkspaceMember).filter_by(workspace_id=workspace_id, user_tg_id=tg_id).first()
    if not m:
        raise HTTPException(404)
    ws = db.get(Workspace, workspace_id)
    if ws.owner_tg_id == tg_id and data.role != "owner":
        raise HTTPException(400, "Нельзя понизить роль владельца пространства")
    m.role = data.role
    db.commit()
    db.refresh(m)
    u = db.get(User, tg_id)
    return MemberOut.model_validate(m).model_copy(
        update={"label": u.label if u else None, "tg_username": u.tg_username if u else None}
    )


@router.delete("/{workspace_id}/members/{tg_id}")
def remove_member(
    workspace_id: int,
    tg_id: int,
    db: Session = Depends(get_db),
    role: str = Depends(require_workspace_role("owner")),
):
    ws = db.get(Workspace, workspace_id)
    if ws and ws.owner_tg_id == tg_id:
        raise HTTPException(400, "Нельзя удалить владельца пространства")
    m = db.query(WorkspaceMember).filter_by(workspace_id=workspace_id, user_tg_id=tg_id).first()
    if not m:
        raise HTTPException(404)
    db.delete(m)
    db.commit()
    return {"ok": True}
