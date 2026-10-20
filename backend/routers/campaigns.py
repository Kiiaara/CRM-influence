"""Рекламные кампании: запросы от брендов на уровень выше сделок со инфлюенсерами.

Сделка на канбане - это конкретный инфлюенсер. Кампания - весь запрос клиента,
который живёт с момента поступления, когда блогеры ещё не подобраны.
"""
import json
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from deps import get_current_user, get_current_workspace
from models.advertiser import Advertiser
from models.blogger_profile import BloggerProfile
from models.campaign import Campaign
from models.integration import Integration
from models.integration_streamer import IntegrationStreamer
from models.own_blogger import OwnBlogger
from models.streamer_profile import StreamerProfile
from models.user import User
from models.workspace import Workspace, WorkspaceMember
from routers.integrations import StreamerCreate, create_streamer

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
    kp_url: str = ""
    # дата завершения РК; null = активная
    archived_at: Optional[datetime] = None
    # счётчик и сумма по живым (не отменённым) блогерам кампании, чтобы видеть без раскрытия
    bloggers_count: int = 0
    bloggers_total: float = 0
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class CampaignBloggerOut(BaseModel):
    """Блогер кампании = инфлюенсер в сделке кампании (та же запись, что на канбане)."""
    streamer_id: int
    integration_id: int
    name: str
    talent_type: str
    amount: Optional[float] = None
    currency: str
    payment_status: str
    integration_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    stage: str
    # ссылки/ник блогера через пробел из баз (пусто, если не нашли); ник из них достаёт фронт
    link: str = ""


class CampaignBloggerCreate(BaseModel):
    name: str
    talent_type: str = "blogger"
    amount: Optional[float] = None
    currency: str = "RUB"
    contact: str = ""


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
    kp_url: str = ""


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
    kp_url: Optional[str] = None
    # true - отметить завершённой (проставит дату), false - вернуть в активные
    archived: Optional[bool] = None


def _stats(db: Session, campaign_ids: List[int]) -> dict:
    """campaign_id -> (число живых блогеров, сумма). Отменённые сделки не считаем."""
    if not campaign_ids:
        return {}
    rows = (
        db.query(Integration.campaign_id, func.count(IntegrationStreamer.id), func.coalesce(func.sum(IntegrationStreamer.amount), 0))
        .join(IntegrationStreamer, IntegrationStreamer.integration_id == Integration.id)
        .filter(Integration.campaign_id.in_(campaign_ids), IntegrationStreamer.stage != "cancelled")
        .group_by(Integration.campaign_id)
        .all()
    )
    return {r[0]: (r[1], float(r[2])) for r in rows}


def _out(db: Session, c: Campaign, stats: Optional[dict] = None) -> CampaignOut:
    if stats is None:
        stats = _stats(db, [c.id])
    count, total = stats.get(c.id, (0, 0.0))
    return CampaignOut.model_validate(c).model_copy(update={
        "advertiser_name": _adv_name(db, c.advertiser_id),
        "owner_label": _label(db, c.owner_tg_id),
        "bloggers_count": count,
        "bloggers_total": total,
    })


def _norm_name(name: Optional[str]) -> str:
    """Ключ сравнения имён: без регистра, лишние пробелы схлопнуты."""
    return " ".join((name or "").split()).casefold()


def _sheet_row_links(raw: Optional[str]) -> List[str]:
    """Ссылки из sheet_row базы агентства (порт sheetRowLinks с фронта): у записей из таблицы
    url/telegram пустые, а реальная ссылка лежит в гиперссылке ячейки или в тексте значения."""
    try:
        row = json.loads(raw or "[]")
    except ValueError:
        return []
    if not isinstance(row, list):
        return []
    found: List[str] = []
    for cell in row:
        if not isinstance(cell, dict):
            continue
        if cell.get("u"):
            found.append(str(cell["u"]))
        text = str(cell.get("v") or "")
        if "://" in text or "t.me/" in text:
            for p in text.replace(",", " ").replace(";", " ").replace("|", " ").split():
                if "://" in p or "t.me/" in p:
                    found.append(p)
    return found


def _links_by_name(db: Session, ws: Workspace, names: List[str]) -> dict:
    """norm(имя) -> строка со ссылками блогера. Константное число запросов (по два на базу)
    независимо от длины списка. lower() в SQLite не понимает кириллицу, поэтому имена
    сверяем в Python: сначала лёгкие (id, name), потом полные поля только для совпавших."""
    wanted = {_norm_name(n) for n in names if _norm_name(n)}
    result: dict = {}
    if not wanted:
        return result

    def matched(model, extra_filter=None):
        q = db.query(model.id, model.name)
        if extra_filter is not None:
            q = q.filter(extra_filter)
        ids = [r.id for r in q.all() if _norm_name(r.name) in wanted]
        if not ids:
            return []
        return db.query(model).filter(model.id.in_(ids)).order_by(model.id.asc()).all()

    def put(name: str, parts: List[str]):
        link = " ".join(p.strip() for p in parts if p and p.strip())
        key = _norm_name(name)
        # первая найденная непустая ссылка выигрывает: порядок баз - своя, агентская, инфлюенсеры
        if link and key not in result:
            result[key] = link

    # своя база только этого пространства
    for r in matched(OwnBlogger, OwnBlogger.workspace_id == ws.id):
        put(r.name, [r.url])
    # база агентства общая
    for r in matched(BloggerProfile):
        put(r.name, [r.url, r.telegram, *_sheet_row_links(r.sheet_row)])
    # база инфлюенсеров: twitch_url часто голый ник
    for r in matched(StreamerProfile):
        put(r.name, [r.twitch_url, r.social_links])
    return result


def _blogger_out(s: IntegrationStreamer, links: Optional[dict] = None) -> CampaignBloggerOut:
    return CampaignBloggerOut(
        streamer_id=s.id,
        integration_id=s.integration_id,
        name=s.streamer_name,
        talent_type=s.talent_type,
        amount=float(s.amount) if s.amount is not None else None,
        currency=s.currency,
        payment_status=s.payment_status,
        integration_date=s.integration_date,
        deadline=s.deadline,
        stage=s.stage,
        link=(links or {}).get(_norm_name(s.streamer_name), ""),
    )


@router.get("", response_model=List[CampaignOut])
def list_campaigns(
    archived: bool = False,
    db: Session = Depends(get_db),
    ws: Workspace = Depends(get_current_workspace),
):
    """По умолчанию только активные; archived=true - только завершённые."""
    q = db.query(Campaign).filter(Campaign.workspace_id == ws.id)
    q = q.filter(Campaign.archived_at.is_not(None) if archived else Campaign.archived_at.is_(None))
    rows = q.order_by(Campaign.created_at.desc()).all()
    stats = _stats(db, [c.id for c in rows])
    return [_out(db, c, stats) for c in rows]


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
        kp_url=data.kp_url.strip(),
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
        if k == "archived":
            # "Готово" ставит дату один раз (повтор её не сдвигает), "Вернуть" снимает; null игнорируем
            if v is True and c.archived_at is None:
                c.archived_at = datetime.now()
            elif v is False:
                c.archived_at = None
            continue
        if k == "kp_url":
            v = (v or "").strip()
        setattr(c, k, v.strip() if k == "name" and isinstance(v, str) else v)
    # сменили рекламодателя - сделки кампании должны показывать тот же бренд
    if "advertiser_id" in data.model_fields_set or "name" in data.model_fields_set:
        for it in db.query(Integration).filter(Integration.campaign_id == c.id).all():
            it.advertiser_id = c.advertiser_id
            it.brand = _adv_name(db, c.advertiser_id) or c.name
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

@router.get("/{campaign_id}/bloggers", response_model=List[CampaignBloggerOut])
def list_campaign_bloggers(
    campaign_id: int,
    db: Session = Depends(get_db),
    ws: Workspace = Depends(get_current_workspace),
):
    c = _get_or_404(db, ws, campaign_id)
    rows = (
        db.query(IntegrationStreamer)
        .join(Integration, IntegrationStreamer.integration_id == Integration.id)
        .filter(Integration.campaign_id == c.id, Integration.workspace_id == ws.id)
        .order_by(IntegrationStreamer.id.asc())
        .all()
    )
    links = _links_by_name(db, ws, [s.streamer_name for s in rows])
    return [_blogger_out(s, links) for s in rows]


@router.post("/{campaign_id}/bloggers", response_model=CampaignBloggerOut, status_code=201)
def add_campaign_blogger(
    campaign_id: int,
    data: CampaignBloggerCreate,
    db: Session = Depends(get_db),
    ws: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
):
    c = _get_or_404(db, ws, campaign_id)
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "Имя блогера не может быть пустым")

    # сделка кампании создаётся при первом блогере; дальше все идут в неё же
    it = (
        db.query(Integration)
        .filter(Integration.campaign_id == c.id, Integration.workspace_id == ws.id)
        .order_by(Integration.id.asc())
        .first()
    )
    if not it:
        it = Integration(
            workspace_id=ws.id,
            advertiser_id=c.advertiser_id,
            # без рекламодателя бренд сделки - название кампании
            brand=_adv_name(db, c.advertiser_id) or c.name,
            description="",
            campaign_id=c.id,
        )
        db.add(it)
        db.commit()
        db.refresh(it)

    # саму карточку создаёт общий код канбана: позиция, аудит, валидации
    s = create_streamer(
        it.id,
        StreamerCreate(
            streamer_name=name,
            talent_type=data.talent_type,
            amount=data.amount,
            currency=data.currency,
            contact=data.contact,
        ),
        db=db, ws=ws, user=user,
    )
    return _blogger_out(s, _links_by_name(db, ws, [s.streamer_name]))

