"""Свои блогеры пространства: заводятся и правятся руками (в отличие от базы агентства,
которая приходит из гугл-таблицы и в CRM только для чтения).
Привязаны к пространству; читать могут все участники, писать - владелец и руководитель."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from deps import get_current_user, get_current_workspace
from models.own_blogger import OwnBlogger
from models.user import User
from models.workspace import Workspace, WorkspaceMember

router = APIRouter(prefix="/api/own-bloggers", tags=["own-bloggers"])


class OwnBloggerOut(BaseModel):
    id: int
    name: str
    url: str
    platform: str
    contact: str
    category: str
    notes: str
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class OwnBloggerCreate(BaseModel):
    name: str
    url: str = ""
    platform: str = ""
    contact: str = ""
    category: str = ""
    notes: str = ""


class OwnBloggerUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    platform: Optional[str] = None
    contact: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None


def _require_writer(
    db: Session = Depends(get_db),
    ws: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
) -> Workspace:
    """Писать могут владелец и руководитель пространства; наблюдатель только читает."""
    m = db.query(WorkspaceMember).filter_by(workspace_id=ws.id, user_tg_id=user.tg_id).first()
    if not m or m.role == "viewer":
        raise HTTPException(403, "Наблюдатель не может менять базу блогеров")
    return ws


def _get_or_404(db: Session, ws: Workspace, blogger_id: int) -> OwnBlogger:
    b = db.get(OwnBlogger, blogger_id)
    if not b or b.workspace_id != ws.id:
        raise HTTPException(404)
    return b


@router.get("", response_model=List[OwnBloggerOut])
def list_own_bloggers(db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    return (
        db.query(OwnBlogger)
        .filter(OwnBlogger.workspace_id == ws.id)
        .order_by(OwnBlogger.name.asc())
        .all()
    )


@router.post("", response_model=OwnBloggerOut, status_code=201)
def create_own_blogger(data: OwnBloggerCreate, db: Session = Depends(get_db), ws: Workspace = Depends(_require_writer)):
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "Имя не может быть пустым")
    b = OwnBlogger(
        workspace_id=ws.id,
        name=name[:255],
        url=data.url.strip()[:512],
        platform=data.platform.strip()[:64],
        contact=data.contact.strip()[:255],
        category=data.category.strip()[:255],
        notes=data.notes.strip(),
    )
    db.add(b)
    db.commit()
    db.refresh(b)
    return b


@router.patch("/{blogger_id}", response_model=OwnBloggerOut)
def update_own_blogger(
    blogger_id: int,
    data: OwnBloggerUpdate,
    db: Session = Depends(get_db),
    ws: Workspace = Depends(_require_writer),
):
    b = _get_or_404(db, ws, blogger_id)
    if data.name is not None and not data.name.strip():
        raise HTTPException(400, "Имя не может быть пустым")
    limits = {"name": 255, "url": 512, "platform": 64, "contact": 255, "category": 255}
    for k, v in data.model_dump(exclude_unset=True).items():
        if v is None:
            continue
        v = v.strip()
        setattr(b, k, v[:limits[k]] if k in limits else v)
    db.commit()
    db.refresh(b)
    return b


@router.delete("/{blogger_id}")
def delete_own_blogger(blogger_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(_require_writer)):
    b = _get_or_404(db, ws, blogger_id)
    db.delete(b)
    db.commit()
    return {"ok": True}
