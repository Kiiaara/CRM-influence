"""CRUD задач для календаря + выборка по диапазону."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import and_

from database import get_db
from deps import get_current_user, get_current_workspace
from models.task import Task
from models.user import User
from models.workspace import Workspace, WorkspaceMember

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

STATUSES = ("todo", "doing", "done")


def _workspace_member_ids(db: Session, workspace_id: int) -> set[int]:
    rows = db.query(WorkspaceMember.user_tg_id).filter(WorkspaceMember.workspace_id == workspace_id).all()
    return {r[0] for r in rows}


def _check_assignee(db: Session, ws: Workspace, assignee_tg_id: Optional[int]):
    """Ставить задачу можно только участнику этого пространства - иначе человек
    получит уведомление о задаче, которую не сможет открыть."""
    if assignee_tg_id is None:
        return
    if assignee_tg_id not in _workspace_member_ids(db, ws.id):
        raise HTTPException(400, "Этот человек не участник текущего пространства")


def _user_label(db: Session, tg_id: Optional[int]) -> Optional[str]:
    if tg_id is None:
        return None
    u = db.get(User, tg_id)
    if not u:
        return None
    return u.label or u.tg_first_name or u.tg_username or str(tg_id)


class TaskOut(BaseModel):
    id: int
    title: str
    description: str
    due_at: Optional[datetime] = None
    status: str
    assignee_tg_id: Optional[int] = None
    assignee_label: Optional[str] = None
    created_by_tg_id: Optional[int] = None
    created_at: datetime
    model_config = {"from_attributes": True}


class AssigneeOut(BaseModel):
    tg_id: int
    label: str
    workspace_role: str


class TaskCreate(BaseModel):
    title: str
    description: str = ""
    due_at: Optional[datetime] = None
    status: str = "todo"
    assignee_tg_id: Optional[int] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    due_at: Optional[datetime] = None
    status: Optional[str] = None
    assignee_tg_id: Optional[int] = None


@router.get("/assignees", response_model=List[AssigneeOut])
def list_assignees(db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    """Кому можно поставить задачу - участники текущего пространства.
    Объявлен до GET /{task_id}-путей, чтобы 'assignees' не парсился как id."""
    rows = (
        db.query(WorkspaceMember, User)
        .join(User, User.tg_id == WorkspaceMember.user_tg_id)
        .filter(WorkspaceMember.workspace_id == ws.id)
        .order_by(WorkspaceMember.joined_at.asc())
        .all()
    )
    return [
        AssigneeOut(
            tg_id=u.tg_id,
            label=u.label or u.tg_first_name or u.tg_username or str(u.tg_id),
            workspace_role=m.role,
        )
        for m, u in rows
    ]


@router.get("", response_model=List[TaskOut])
def list_tasks(
    start: Optional[datetime] = Query(None),
    end: Optional[datetime] = Query(None),
    db: Session = Depends(get_db),
    ws: Workspace = Depends(get_current_workspace),
):
    q = db.query(Task).filter(Task.workspace_id == ws.id)
    if start:
        q = q.filter(Task.due_at >= start)
    if end:
        q = q.filter(Task.due_at <= end)
    tasks = q.order_by(Task.due_at.asc().nullslast()).all()
    return [
        TaskOut.model_validate(t).model_copy(update={"assignee_label": _user_label(db, t.assignee_tg_id)})
        for t in tasks
    ]


@router.post("", response_model=TaskOut, status_code=201)
def create_task(data: TaskCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user), ws: Workspace = Depends(get_current_workspace)):
    title = data.title.strip()
    if not title:
        raise HTTPException(400, "Название задачи не может быть пустым")
    if data.status not in STATUSES:
        raise HTTPException(400, f"Статус: {', '.join(STATUSES)}")
    _check_assignee(db, ws, data.assignee_tg_id)

    t = Task(
        workspace_id=ws.id,
        title=title,
        description=data.description,
        due_at=data.due_at,
        status=data.status,
        assignee_tg_id=data.assignee_tg_id,
        created_by_tg_id=user.tg_id,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    # notified_assigned остаётся False - планировщик подхватит и пришлёт TG-уведомление
    # исполнителю в течение 30 секунд (scheduler._notify_assigned)
    return TaskOut.model_validate(t).model_copy(update={"assignee_label": _user_label(db, t.assignee_tg_id)})


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, data: TaskUpdate, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    t = db.get(Task, task_id)
    if not t or t.workspace_id != ws.id:
        raise HTTPException(404)
    if data.status is not None and data.status not in STATUSES:
        raise HTTPException(400, f"Статус: {', '.join(STATUSES)}")
    if "assignee_tg_id" in data.model_fields_set:
        _check_assignee(db, ws, data.assignee_tg_id)

    old_due = t.due_at
    old_assignee = t.assignee_tg_id
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(t, k, v)
    # дедлайн изменили (в том числе проставили впервые) - напомним заново
    if "due_at" in data.model_fields_set and t.due_at != old_due:
        t.notified_deadline = False
    # если поменяли assignee - сбрасываем флаг, чтобы новый исполнитель получил своё уведомление
    if "assignee_tg_id" in data.model_fields_set and data.assignee_tg_id != old_assignee:
        t.notified_assigned = False
    db.commit()
    db.refresh(t)
    return TaskOut.model_validate(t).model_copy(update={"assignee_label": _user_label(db, t.assignee_tg_id)})


@router.delete("/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    t = db.get(Task, task_id)
    if not t or t.workspace_id != ws.id:
        raise HTTPException(404)
    db.delete(t)
    db.commit()
    return {"ok": True}
