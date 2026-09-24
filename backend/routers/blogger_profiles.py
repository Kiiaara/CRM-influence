"""База блогеров: CRUD + ссылка на гугл-таблицу и импорт из неё (или из xlsx-файла).
Как и база стримеров, общая на все пространства. Таблица подтягивается и сама по расписанию
(scheduler._sync_bloggers_sheet), вкладки в CRM повторяют листы таблицы.
В CRM база только для чтения: создавать, править и удалять блогеров можно только в самой таблице."""
import json
from datetime import datetime
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

import blogger_sheet
from config import settings
from database import get_db
from deps import get_current_user, require_role
from models.blogger_profile import BloggerProfile
from models.user import User

router = APIRouter(prefix="/api/blogger-profiles", tags=["blogger-profiles"])


class BloggerOut(BaseModel):
    id: int
    name: str
    platform: str
    url: str
    telegram: str
    category: str
    geo: str
    subscribers: Optional[int] = None
    avg_views: Optional[int] = None
    price: Optional[float] = None
    manager: str
    notes: str
    source: str = "manual"
    # все колонки строки листа как в таблице: [{"h": заголовок, "v": значение, "u": ссылка?}]
    sheet_row: List[dict[str, Any]] = []
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}

    @field_validator("sheet_row", mode="before")
    @classmethod
    def _parse_sheet_row(cls, v):
        if isinstance(v, str):
            try:
                v = json.loads(v or "[]")
            except ValueError:
                return []
        return v if isinstance(v, list) else []


class SheetSettings(BaseModel):
    url: str


@router.get("", response_model=List[BloggerOut])
def list_bloggers(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.query(BloggerProfile).order_by(BloggerProfile.platform.asc(), BloggerProfile.name.asc()).all()


def _sheet_info(db: Session) -> dict:
    return {
        "url": blogger_sheet.get_sheet_url(db),
        "tabs": blogger_sheet.get_tabs(db),
        "last_sync": blogger_sheet.get_last_sync(db),
        "sync_minutes": settings.bloggers_sync_minutes,
    }


@router.get("/sheet")
def get_sheet(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _sheet_info(db)


@router.put("/sheet")
async def set_sheet(data: SheetSettings, db: Session = Depends(get_db), user: User = Depends(require_role("admin", "editor"))):
    """Сохраняем ссылку и сразу подтягиваем таблицу - чтобы вкладки появились без ожидания."""
    url = data.url.strip()
    if url:
        try:
            blogger_sheet.export_url(url)
        except blogger_sheet.SheetImportError as e:
            raise HTTPException(400, str(e))
    blogger_sheet.set_sheet_url(db, url)
    if url:
        try:
            await blogger_sheet.sync_from_sheet(db)
        except blogger_sheet.SheetImportError:
            pass  # ошибка уже записана в last_sync - фронт её покажет
    return _sheet_info(db)


@router.post("/sync")
async def sync_from_sheet(db: Session = Depends(get_db), user: User = Depends(require_role("admin", "editor"))):
    """Подтягивает блогеров из гугл-таблицы по сохранённой ссылке (все листы)."""
    try:
        return await blogger_sheet.sync_from_sheet(db)
    except blogger_sheet.SheetImportError as e:
        raise HTTPException(400, str(e))


@router.post("/import")
async def import_file(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(require_role("admin", "editor"))):
    """Тот же импорт, но из скачанного xlsx - если таблицу нельзя открыть по ссылке.
    База приводится к файлу целиком, как при синхронизации."""
    try:
        items, tabs = blogger_sheet.parse_workbook_with_tabs(await file.read())
    except blogger_sheet.SheetImportError as e:
        raise HTTPException(400, str(e))
    if not items:
        # пустой/чужой файл не должен снести всю базу
        raise HTTPException(400, "В файле не нашлось ни одного блогера - проверь заголовки колонок (Имя/Ник/Ссылка)")
    return blogger_sheet.upsert_bloggers(db, items, tabs)
