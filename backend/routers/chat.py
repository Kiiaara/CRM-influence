"""Чат пространства: общая лента + ветки по сделкам.

Раньше переписка жила только внутри карточки стримера. Модель та же
(DiscussionMessage), но streamer_id теперь может быть пустым - это общий чат.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from deps import get_current_user, get_current_workspace
from models.discussion_message import DiscussionMessage
from models.integration import Integration
from models.integration_streamer import IntegrationStreamer
from models.user import User
from models.workspace import Workspace

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _get_streamer_or_404(db: Session, ws: Workspace, streamer_id: int) -> IntegrationStreamer:
    """Ветка доступна только если её сделка в текущем пространстве."""
    s = db.get(IntegrationStreamer, streamer_id)
    if not s:
        raise HTTPException(404)
    it = db.get(Integration, s.integration_id)
    if not it or it.workspace_id != ws.id:
        raise HTTPException(404)
    return s


def _author_label(db: Session, tg_id: Optional[int]) -> Optional[str]:
    if tg_id is None:
        return None
    u = db.get(User, tg_id)
    if not u:
        return None
    return u.label or u.tg_first_name or u.tg_username or str(tg_id)


class MessageOut(BaseModel):
    id: int
    streamer_id: Optional[int] = None
    author_tg_id: Optional[int] = None
    author_label: Optional[str] = None
    text: str
    created_at: datetime
    model_config = {"from_attributes": True}


class MessageCreate(BaseModel):
    text: str
    streamer_id: Optional[int] = None


class ThreadOut(BaseModel):
    streamer_id: int
    streamer_name: str
    brand: str
    messages_count: int
    last_message: Optional[str] = None
    last_message_at: Optional[datetime] = None


@router.get("/messages", response_model=List[MessageOut])
def list_messages(
    streamer_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    ws: Workspace = Depends(get_current_workspace),
):
    q = db.query(DiscussionMessage)
    if streamer_id is not None:
        _get_streamer_or_404(db, ws, streamer_id)
        q = q.filter(DiscussionMessage.streamer_id == streamer_id)
    else:
        # общая лента: только сообщения без ветки и только этого пространства
        q = q.filter(
            DiscussionMessage.streamer_id.is_(None),
            DiscussionMessage.workspace_id == ws.id,
        )
    msgs = q.order_by(DiscussionMessage.created_at.asc()).all()
    return [
        MessageOut.model_validate(m).model_copy(update={"author_label": _author_label(db, m.author_tg_id)})
        for m in msgs
    ]


@router.post("/messages", response_model=MessageOut, status_code=201)
def create_message(
    data: MessageCreate,
    db: Session = Depends(get_db),
    ws: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
):
    text = data.text.strip()
    if not text:
        raise HTTPException(400, "Сообщение не может быть пустым")
    if data.streamer_id is not None:
        _get_streamer_or_404(db, ws, data.streamer_id)

    m = DiscussionMessage(
        workspace_id=ws.id,
        streamer_id=data.streamer_id,
        author_tg_id=user.tg_id,
        text=text,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return MessageOut.model_validate(m).model_copy(update={"author_label": _author_label(db, m.author_tg_id)})


@router.delete("/messages/{message_id}")
def delete_message(
    message_id: int,
    db: Session = Depends(get_db),
    ws: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
):
    m = db.get(DiscussionMessage, message_id)
    if not m:
        raise HTTPException(404)
    # принадлежность проверяем по ветке, а для общей ленты - по workspace
    if m.streamer_id is not None:
        _get_streamer_or_404(db, ws, m.streamer_id)
    elif m.workspace_id != ws.id:
        raise HTTPException(404)
    if m.author_tg_id != user.tg_id and user.role != "admin":
        raise HTTPException(403, "Можно удалить только своё сообщение")
    db.delete(m)
    db.commit()
    return {"ok": True}


@router.get("/threads", response_model=List[ThreadOut])
def list_threads(db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    """Ветки со сделками, где есть хоть одно сообщение - для списка слева."""
    rows = (
        db.query(DiscussionMessage, IntegrationStreamer, Integration)
        .join(IntegrationStreamer, IntegrationStreamer.id == DiscussionMessage.streamer_id)
        .join(Integration, Integration.id == IntegrationStreamer.integration_id)
        .filter(Integration.workspace_id == ws.id)
        .order_by(DiscussionMessage.created_at.asc())
        .all()
    )

    threads: dict[int, ThreadOut] = {}
    for m, s, it in rows:
        t = threads.get(s.id)
        if t is None:
            threads[s.id] = ThreadOut(
                streamer_id=s.id,
                streamer_name=s.streamer_name,
                brand=it.brand,
                messages_count=1,
                last_message=m.text,
                last_message_at=m.created_at,
            )
        else:
            t.messages_count += 1
            t.last_message = m.text
            t.last_message_at = m.created_at

    return sorted(threads.values(), key=lambda t: t.last_message_at or datetime.min, reverse=True)
