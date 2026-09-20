"""База рекламодателей: самостоятельная сущность (не привязана к одной сделке).
У рекламодателя может быть много сделок за всё время и общие контакты."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from deps import get_current_workspace
from models.advertiser import Advertiser
from models.integration import Integration
from models.brand_contact import BrandContact
from models.workspace import Workspace

router = APIRouter(prefix="/api/advertisers", tags=["advertisers"])

CONTACT_TYPES = ("email", "telegram", "whatsapp", "phone", "other")


def _validate_contact_type(contact_type: str):
    if contact_type not in CONTACT_TYPES:
        raise HTTPException(400, f"contact_type должен быть одним из: {', '.join(CONTACT_TYPES)}")


def _get_advertiser_or_404(db: Session, ws: Workspace, advertiser_id: int) -> Advertiser:
    adv = db.get(Advertiser, advertiser_id)
    if not adv or adv.workspace_id != ws.id:
        raise HTTPException(404)
    return adv


def _get_contact_or_404(db: Session, ws: Workspace, contact_id: int) -> BrandContact:
    c = db.get(BrandContact, contact_id)
    if not c:
        raise HTTPException(404)
    adv = db.get(Advertiser, c.advertiser_id)
    if not adv or adv.workspace_id != ws.id:
        raise HTTPException(404)
    return c


def _list_contacts(db: Session, advertiser_id: int) -> list[BrandContact]:
    return (
        db.query(BrandContact)
        .filter(BrandContact.advertiser_id == advertiser_id)
        .order_by(BrandContact.is_primary.desc(), BrandContact.created_at.asc())
        .all()
    )


# ---------- схемы ----------

class BrandContactOut(BaseModel):
    id: int
    advertiser_id: int
    contact_type: str
    value: str
    label: str
    is_primary: bool
    notes: str
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class BrandContactCreate(BaseModel):
    contact_type: str
    value: str
    label: str = ""
    is_primary: bool = False
    notes: str = ""


class BrandContactUpdate(BaseModel):
    contact_type: Optional[str] = None
    value: Optional[str] = None
    label: Optional[str] = None
    is_primary: Optional[bool] = None
    notes: Optional[str] = None


class AdvertiserOut(BaseModel):
    id: int
    name: str
    notes: str
    created_at: datetime
    updated_at: datetime
    deals_count: int = 0
    contacts_count: int = 0
    contacts: List[BrandContactOut] = []
    model_config = {"from_attributes": True}


class AdvertiserCreate(BaseModel):
    name: str
    notes: str = ""


class AdvertiserUpdate(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None


class AdvertiserDealOut(BaseModel):
    id: int
    description: str
    created_at: datetime
    updated_at: datetime
    streamers_count: int = 0
    model_config = {"from_attributes": True}


# ---------- рекламодатели ----------

@router.get("", response_model=List[AdvertiserOut])
def list_advertisers(db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    rows = db.query(Advertiser).filter(Advertiser.workspace_id == ws.id).order_by(Advertiser.name.asc()).all()
    out = []
    for adv in rows:
        deals_count = db.query(Integration).filter(Integration.advertiser_id == adv.id).count()
        contacts = _list_contacts(db, adv.id)
        out.append(AdvertiserOut.model_validate(adv).model_copy(update={"deals_count": deals_count, "contacts_count": len(contacts), "contacts": contacts}))
    return out


@router.post("", response_model=AdvertiserOut, status_code=201)
def create_advertiser(data: AdvertiserCreate, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "Название не может быть пустым")
    existing = db.query(Advertiser).filter(Advertiser.workspace_id == ws.id, Advertiser.name == name).first()
    if existing:
        raise HTTPException(400, "Рекламодатель с таким названием уже есть")
    adv = Advertiser(workspace_id=ws.id, name=name, notes=data.notes)
    db.add(adv)
    db.commit()
    db.refresh(adv)
    return AdvertiserOut.model_validate(adv)


@router.get("/{advertiser_id}", response_model=AdvertiserOut)
def get_advertiser(advertiser_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    adv = _get_advertiser_or_404(db, ws, advertiser_id)
    deals_count = db.query(Integration).filter(Integration.advertiser_id == adv.id).count()
    contacts = _list_contacts(db, adv.id)
    return AdvertiserOut.model_validate(adv).model_copy(update={"deals_count": deals_count, "contacts_count": len(contacts), "contacts": contacts})


@router.patch("/{advertiser_id}", response_model=AdvertiserOut)
def update_advertiser(advertiser_id: int, data: AdvertiserUpdate, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    adv = _get_advertiser_or_404(db, ws, advertiser_id)
    if data.name is not None:
        name = data.name.strip()
        if not name:
            raise HTTPException(400, "Название не может быть пустым")
        dup = db.query(Advertiser).filter(Advertiser.workspace_id == ws.id, Advertiser.name == name, Advertiser.id != advertiser_id).first()
        if dup:
            raise HTTPException(400, "Рекламодатель с таким названием уже есть")
        adv.name = name
        # держим Integration.brand синхронным - весь остальной код читает его напрямую
        db.query(Integration).filter(Integration.advertiser_id == adv.id).update({"brand": name})
    if data.notes is not None:
        adv.notes = data.notes
    db.commit()
    db.refresh(adv)
    deals_count = db.query(Integration).filter(Integration.advertiser_id == adv.id).count()
    contacts = _list_contacts(db, adv.id)
    return AdvertiserOut.model_validate(adv).model_copy(update={"deals_count": deals_count, "contacts_count": len(contacts), "contacts": contacts})


@router.delete("/{advertiser_id}")
def delete_advertiser(advertiser_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    adv = _get_advertiser_or_404(db, ws, advertiser_id)
    if db.query(Integration).filter(Integration.advertiser_id == adv.id).first():
        raise HTTPException(400, "У рекламодателя есть сделки - сначала перенесите или удалите их")
    db.query(BrandContact).filter(BrandContact.advertiser_id == adv.id).delete()
    db.delete(adv)
    db.commit()
    return {"ok": True}


@router.get("/{advertiser_id}/deals", response_model=List[AdvertiserDealOut])
def list_advertiser_deals(advertiser_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    _get_advertiser_or_404(db, ws, advertiser_id)
    deals = (
        db.query(Integration)
        .filter(Integration.advertiser_id == advertiser_id)
        .order_by(Integration.updated_at.desc())
        .all()
    )
    return [
        AdvertiserDealOut.model_validate(d).model_copy(update={"streamers_count": len(d.streamers)})
        for d in deals
    ]


# ---------- контакты ----------

@router.get("/{advertiser_id}/contacts", response_model=List[BrandContactOut])
def list_contacts(advertiser_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    _get_advertiser_or_404(db, ws, advertiser_id)
    return (
        db.query(BrandContact)
        .filter(BrandContact.advertiser_id == advertiser_id)
        .order_by(BrandContact.is_primary.desc(), BrandContact.created_at.asc())
        .all()
    )


@router.post("/{advertiser_id}/contacts", response_model=BrandContactOut, status_code=201)
def create_contact(advertiser_id: int, data: BrandContactCreate, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    _get_advertiser_or_404(db, ws, advertiser_id)
    _validate_contact_type(data.contact_type)
    if data.is_primary:
        db.query(BrandContact).filter(BrandContact.advertiser_id == advertiser_id).update({"is_primary": False})
    c = BrandContact(
        advertiser_id=advertiser_id,
        contact_type=data.contact_type,
        value=data.value,
        label=data.label,
        is_primary=data.is_primary,
        notes=data.notes,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.patch("/contacts/{contact_id}", response_model=BrandContactOut)
def update_contact(contact_id: int, data: BrandContactUpdate, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    c = _get_contact_or_404(db, ws, contact_id)
    if data.contact_type is not None:
        _validate_contact_type(data.contact_type)
    if data.is_primary:
        db.query(BrandContact).filter(
            BrandContact.advertiser_id == c.advertiser_id, BrandContact.id != contact_id
        ).update({"is_primary": False})
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    db.commit()
    db.refresh(c)
    return c


@router.delete("/contacts/{contact_id}")
def delete_contact(contact_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    c = _get_contact_or_404(db, ws, contact_id)
    db.delete(c)
    db.commit()
    return {"ok": True}
