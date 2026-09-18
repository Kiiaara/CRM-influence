"""Поиск по стримерам внутри интеграций (имя / контакт / бренд / описание)."""
from typing import List
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from database import get_db
from deps import get_current_user
from models.integration_streamer import IntegrationStreamer
from models.user import User

router = APIRouter(prefix="/api/search", tags=["search"])


class SearchHit(BaseModel):
    kind: str  # streamer
    id: int
    title: str
    snippet: str


@router.get("", response_model=List[SearchHit])
def search(q: str = Query(..., min_length=1), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    like = f"%{q}%"
    items = (
        db.query(IntegrationStreamer)
        .options(joinedload(IntegrationStreamer.integration))
        .filter(or_(
            IntegrationStreamer.streamer_name.ilike(like),
            IntegrationStreamer.contact.ilike(like),
            IntegrationStreamer.description.ilike(like),
        ))
        .limit(30)
        .all()
    )

    return [
        SearchHit(
            kind="streamer",
            id=s.id,
            title=f"{s.integration.brand} × {s.streamer_name}",
            snippet=s.description[:200] if s.description else s.contact,
        )
        for s in items
    ]
