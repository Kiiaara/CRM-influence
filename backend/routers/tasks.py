"""CRUD задач для календаря + выборка по диапазону."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import and_

from database import get_db
from deps import get_current_user
from models.task import Task
from models.user import User

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


class TaskOut(BaseModel):
    id: int
    title: str
    description: str
    due_at: Optional[datetime] = None
    status: str
    assignee_tg_id: Optional[int] = None
    created_at: datetime
    model_config = {"from_attributes": True}


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


@router.get("", response_model=List[TaskOut])
def list_tasks(
    start: Optional[datetime] = Query(None),
    end: Optional[datetime] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(Task)
    if start:
        q = q.filter(Task.due_at >= start)
    if end:
        q = q.filter(Task.due_at <= end)
    return q.order_by(Task.due_at.asc().nullslast()).all()


@router.post("", response_model=TaskOut, status_code=201)
def create_task(data: TaskCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t = Task(
        workspace_id=1,
        title=data.title,
        description=data.description,
        due_at=data.due_at,
        status=data.status,
        assignee_tg_id=data.assignee_tg_id,
        created_by_tg_id=user.tg_id,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    # TODO: отправить TG-уведомление assignee если assignee_tg_id задан и tg_chat_ready
    return t


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, data: TaskUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404)
    old_due = t.due_at
    old_assignee = t.assignee_tg_id
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(t, k, v)
    # если дедлайн перенесли на день вперёд - сбрасываем флаг дедлайн-уведомления
    if data.due_at is not None and old_due and t.due_at and t.due_at.date() != old_due.date():
        t.notified_deadline = False
    # если поменяли assignee - сбрасываем флаг "уведомили о назначении"
    if data.assignee_tg_id is not None and data.assignee_tg_id != old_assignee:
        t.notified_assigned = False
    db.commit()
    db.refresh(t)
    return t


@router.delete("/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404)
    db.delete(t)
    db.commit()
    return {"ok": True}
