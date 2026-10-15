"""Рекламные кампании: запросы от брендов на уровень выше сделок со стримерами.

Сделка на канбане - это конкретный стример. Кампания - весь запрос клиента,
который живёт с момента поступления, когда блогеры ещё не подобраны.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from deps import get_current_user, get_current_workspace
from models.advertiser import Advertiser
from models.campaign import Campaign
from models.user import User
from models.workspace import Workspace, WorkspaceMember

router = APIRouter(prefix="/api/campaigns", tags=["campaigns"])

STATUSES = ("picking", "sent", "waiting_feedback", "negotiating", "running", "cancelled")


def _get_or_404(db: Session, ws: Workspace, campaign_id: int) -> Campaign:
    c = db.get(Campaign, campaign_id)
    if not c or c.workspace_id != ws.id:
        raise HTTPException(404)
    return c


def _validate_status(status: str):
    if status not in STATUSES:
        raise HTTPException(400, f"Статус: {', '.join(STATUSES)}")


def _validate_advertiser(db: Session, ws: Workspace, advertiser_id: Optional[int]):
    if advertiser_id is None:
        return
    adv = db.get(Advertiser, advertiser_id)
    if not adv or adv.workspace_id != ws.id:
        raise HTTPException(400, "Такого рекламодателя нет в этом пространстве")


def _validate_owner(db: Session, ws: Workspace, owner_tg_id: Optional[int]):
    """Ответственный должен быть в этом пространстве - иначе назначим того,
    кто кампанию даже не откроет."""
    if owner_tg_id is None:
        return
    m = db.query(WorkspaceMember).filter_by(workspace_id=ws.id, user_tg_id=owner_tg_id).first()
    if not m:
        raise HTTPException(400, "Этот человек не участник текущего пространства")


def _label(db: Session, tg_id: Optional[int]) -> Optional[str]:
    if tg_id is None:
        return None
    u = db.get(User, tg_id)
    if not u:
        return None
    return u.label or u.tg_first_name or u.tg_username or str(tg_id)


def _adv_name(db: Session, advertiser_id: Optional[int]) -> Optional[str]:
    if advertiser_id is None:
        return None
    adv = db.get(Advertiser, advertiser_id)
    return adv.name if adv else None


class CampaignOut(BaseModel):
    id: int
    name: str
    advertiser_id: Optional[int] = None
    advertiser_name: Optional[str] = None
    status: str
    requested_at: Optional[datetime] = None
    selection_due_at: Optional[datetime] = None
    campaign_due_at: Optional[datetime] = None
    budget: Optional[float] = None
    currency: str
    owner_tg_id: Optional[int] = None
    owner_label: Optional[str] = None
    notes: str
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class CampaignCreate(BaseModel):
    name: str
    advertiser_id: Optional[int] = None
    status: str = "picking"
    requested_at: Optional[datetime] = None
    selection_due_at: Optional[datetime] = None
    campaign_due_at: Optional[datetime] = None
    budget: Optional[float] = None
    currency: str = "RUB"
    owner_tg_id: Optional[int] = None
    notes: str = ""


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    advertiser_id: Optional[int] = None
    status: Optional[str] = None
    requested_at: Optional[datetime] = None
    selection_due_at: Optional[datetime] = None
    campaign_due_at: Optional[datetime] = None
    budget: Optional[float] = None
    currency: Optional[str] = None
    owner_tg_id: Optional[int] = None
    notes: Optional[str] = None


def _out(db: Session, c: Campaign) -> CampaignOut:
    return CampaignOut.model_validate(c).model_copy(update={
        "advertiser_name": _adv_name(db, c.advertiser_id),
        "owner_label": _label(db, c.owner_tg_id),
    })


@router.get("", response_model=List[CampaignOut])
def list_campaigns(db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    rows = (
        db.query(Campaign)
        .filter(Campaign.workspace_id == ws.id)
        .order_by(Campaign.created_at.desc())
        .all()
    )
    return [_out(db, c) for c in rows]


@router.post("", response_model=CampaignOut, status_code=201)
def create_campaign(
    data: CampaignCreate,
    db: Session = Depends(get_db),
    ws: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
):
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "Название не может быть пустым")
    _validate_status(data.status)
    _validate_advertiser(db, ws, data.advertiser_id)
    _validate_owner(db, ws, data.owner_tg_id)

    c = Campaign(
        workspace_id=ws.id,
        name=name,
        advertiser_id=data.advertiser_id,
        status=data.status,
        # запрос без даты - считаем, что пришёл сегодня
        requested_at=data.requested_at or datetime.now(),
        selection_due_at=data.selection_due_at,
        campaign_due_at=data.campaign_due_at,
        budget=data.budget,
        currency=data.currency,
        owner_tg_id=data.owner_tg_id,
        notes=data.notes,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return _out(db, c)


@router.patch("/{campaign_id}", response_model=CampaignOut)
def update_campaign(
    campaign_id: int,
    data: CampaignUpdate,
    db: Session = Depends(get_db),
    ws: Workspace = Depends(get_current_workspace),
):
    c = _get_or_404(db, ws, campaign_id)
    if data.status is not None:
        _validate_status(data.status)
    if "advertiser_id" in data.model_fields_set:
        _validate_advertiser(db, ws, data.advertiser_id)
    if "owner_tg_id" in data.model_fields_set:
        _validate_owner(db, ws, data.owner_tg_id)
    if data.name is not None and not data.name.strip():
        raise HTTPException(400, "Название не может быть пустым")

    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(c, k, v.strip() if k == "name" and isinstance(v, str) else v)
    db.commit()
    db.refresh(c)
    return _out(db, c)


@router.delete("/{campaign_id}")
def delete_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    ws: Workspace = Depends(get_current_workspace),
):
    c = _get_or_404(db, ws, campaign_id)
    db.delete(c)
    db.commit()
    return {"ok": True}
