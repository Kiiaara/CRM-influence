"""База блогеров: CRUD + ссылка на гугл-таблицу и импорт из неё (или из xlsx-файла).
Как и база стримеров, общая на все пространства."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session

import blogger_sheet
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
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class BloggerCreate(BaseModel):
    name: str
    platform: str = ""
    url: str = ""
    telegram: str = ""
    category: str = ""
    geo: str = ""
    subscribers: Optional[int] = None
    avg_views: Optional[int] = None
    price: Optional[float] = None
    manager: str = ""
    notes: str = ""


class BloggerUpdate(BloggerCreate):
    name: Optional[str] = None


class SheetSettings(BaseModel):
    url: str


@router.get("", response_model=List[BloggerOut])
def list_bloggers(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.query(BloggerProfile).order_by(BloggerProfile.platform.asc(), BloggerProfile.name.asc()).all()


@router.get("/sheet")
def get_sheet(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return {"url": blogger_sheet.get_sheet_url(db)}


@router.put("/sheet")
def set_sheet(data: SheetSettings, db: Session = Depends(get_db), user: User = Depends(require_role("admin", "editor"))):
    url = data.url.strip()
    if url:
        try:
            blogger_sheet.export_url(url)
        except blogger_sheet.SheetImportError as e:
            raise HTTPException(400, str(e))
    blogger_sheet.set_sheet_url(db, url)
    return {"url": url}


@router.post("/sync")
async def sync_from_sheet(db: Session = Depends(get_db), user: User = Depends(require_role("admin", "editor"))):
    """Подтягивает блогеров из гугл-таблицы по сохранённой ссылке (все листы)."""
    try:
        return await blogger_sheet.sync_from_sheet(db)
    except blogger_sheet.SheetImportError as e:
        raise HTTPException(400, str(e))


@router.post("/import")
async def import_file(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(require_role("admin", "editor"))):
    """Тот же импорт, но из скачанного xlsx - если таблицу нельзя открыть по ссылке."""
    try:
        items = blogger_sheet.parse_workbook(await file.read())
    except blogger_sheet.SheetImportError as e:
        raise HTTPException(400, str(e))
    return blogger_sheet.upsert_bloggers(db, items)


@router.post("", response_model=BloggerOut, status_code=201)
def create_blogger(data: BloggerCreate, db: Session = Depends(get_db), user: User = Depends(require_role("admin", "editor"))):
    if not data.name.strip():
        raise HTTPException(400, "Имя не может быть пустым")
    b = BloggerProfile(**data.model_dump())
    b.name = b.name.strip()
    db.add(b)
    db.commit()
    db.refresh(b)
    return b


@router.patch("/{blogger_id}", response_model=BloggerOut)
def update_blogger(blogger_id: int, data: BloggerUpdate, db: Session = Depends(get_db), user: User = Depends(require_role("admin", "editor"))):
    b = db.get(BloggerProfile, blogger_id)
    if not b:
        raise HTTPException(404)
    for k, v in data.model_dump(exclude_unset=True).items():
        if k == "name":
            if not v or not v.strip():
                raise HTTPException(400, "Имя не может быть пустым")
            v = v.strip()
        setattr(b, k, v)
    db.commit()
    db.refresh(b)
    return b


@router.delete("/{blogger_id}")
def delete_blogger(blogger_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    b = db.get(BloggerProfile, blogger_id)
    if not b:
        raise HTTPException(404)
    db.delete(b)
    db.commit()
    return {"ok": True}
