"""Поиск по стримерам внутри интеграций (имя / контакт / бренд / описание).
Сравнение регистронезависимое делаем на стороне Python (str.lower()), а не через
SQL ilike/lower() - в SQLite эти функции фолдят регистр только для ASCII,
кириллица (Иван -> иван) не матчится."""
from typing import List
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from database import get_db
from deps import get_current_workspace
from models.integration import Integration
from models.integration_streamer import IntegrationStreamer
from models.workspace import Workspace

router = APIRouter(prefix="/api/search", tags=["search"])


class SearchHit(BaseModel):
    kind: str  # streamer
    id: int
    title: str
    snippet: str


@router.get("", response_model=List[SearchHit])
def search(q: str = Query(..., min_length=1), db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    needle = q.strip().lower()
    if not needle:
        return []

    rows = (
        db.query(IntegrationStreamer)
        .join(Integration, IntegrationStreamer.integration_id == Integration.id)
        .options(joinedload(IntegrationStreamer.integration))
        .filter(Integration.workspace_id == ws.id)
        .all()
    )

    matched = [
        s for s in rows
        if needle in s.streamer_name.lower()
        or needle in (s.contact or "").lower()
        or needle in (s.description or "").lower()
        or needle in s.integration.brand.lower()
    ][:30]

    return [
        SearchHit(
            kind="streamer",
            id=s.id,
            title=f"{s.integration.brand} × {s.streamer_name}",
            snippet=s.description[:200] if s.description else s.contact,
        )
        for s in matched
    ]
