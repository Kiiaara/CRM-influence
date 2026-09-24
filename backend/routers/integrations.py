"""CRM интеграций: сделка с брендом (Integration) содержит пул стримеров
(IntegrationStreamer), каждый со своим статусом/сроком/суммой/договором/оплатами."""
import json
import os
import re
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel, computed_field, field_validator
from sqlalchemy.orm import Session

import case_translate
import site_publisher
from database import get_db
from deps import get_current_user, get_current_workspace
from models.integration import Integration
from models.integration_streamer import IntegrationStreamer
from models.integration_payment import IntegrationPayment
from models.case_study import CaseStudy
from models.brief_file import BriefFile
from models.advertiser import Advertiser
from models.audit_log import AuditLogEntry
from models.user import User
from models.workspace import Workspace


def _get_integration_or_404(db: Session, ws: Workspace, integration_id: int) -> Integration:
    it = db.get(Integration, integration_id)
    if not it or it.workspace_id != ws.id:
        raise HTTPException(404)
    return it


def _get_streamer_or_404(db: Session, ws: Workspace, streamer_id: int) -> IntegrationStreamer:
    """Достаём стримера, проверяя что его сделка принадлежит текущему workspace -
    иначе любой залогиненный юзер мог бы читать/менять чужие сделки по id."""
    s = db.get(IntegrationStreamer, streamer_id)
    if not s:
        raise HTTPException(404)
    it = db.get(Integration, s.integration_id)
    if not it or it.workspace_id != ws.id:
        raise HTTPException(404)
    return s


def _get_case_or_404(db: Session, ws: Workspace, case_id: int) -> CaseStudy:
    c = db.get(CaseStudy, case_id)
    if not c:
        raise HTTPException(404)
    _get_streamer_or_404(db, ws, c.streamer_id)
    return c


# поля стримера, изменения которых пишем в журнал - только те, что важны для бизнеса
TRACKED_FIELDS = (
    "stage",
    "payment_status",
    "content_status",
    "amount",
    "deadline",
    "contract_status",
    "contract_sent_date",
    "contract_signed_date",
    "ord_status",
    "ord_reporting_status",
)


def _log_audit(
    db: Session,
    *,
    workspace_id: int,
    streamer_id: Optional[int],
    integration_id: Optional[int],
    brand: str,
    streamer_name: str,
    field: str,
    old,
    new,
    user: Optional[User],
):
    if old == new:
        return
    db.add(AuditLogEntry(
        workspace_id=workspace_id,
        streamer_id=streamer_id,
        integration_id=integration_id,
        brand=brand,
        streamer_name=streamer_name,
        field=field,
        old_value=str(old) if old is not None else None,
        new_value=str(new) if new is not None else None,
        changed_by_tg_id=user.tg_id if user else None,
    ))

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

STAGES = ("negotiation", "agreed", "awaiting_contract", "awaiting_payment", "done", "cancelled")
PAYMENT_STATUSES = ("not_invoiced", "invoiced", "partial", "paid")
CONTENT_STATUSES = ("awaiting_brief", "filming", "filmed")
ORD_RESPONSIBLE = ("us", "client", "not_required")
ORD_STATUSES = ("todo", "done", "not_required")
ORD_REPORTING_STATUSES = ("not_submitted", "submitted", "overdue")
TALENT_TYPES = ("streamer", "blogger")
CONTRACT_STATUSES = (
    "not_sent",
    "sent_to_streamer",
    "signed_by_streamer",
    "sent_to_brand",
    "signed_by_brand",
    "active",
    "expired",
)

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "contracts")
CASE_PHOTO_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "case_photos")
BRIEF_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "briefs")

# ограничение на файл ТЗ - чтобы случайным перетаскиванием видоса не забить диск
MAX_BRIEF_FILE_BYTES = 25 * 1024 * 1024


def _validate_stage(stage: str):
    if stage not in STAGES:
        raise HTTPException(400, f"stage должен быть одним из: {', '.join(STAGES)}")


def _validate_payment_status(status: str):
    if status not in PAYMENT_STATUSES:
        raise HTTPException(400, f"payment_status должен быть одним из: {', '.join(PAYMENT_STATUSES)}")


def _validate_content_status(status: Optional[str]):
    if status is not None and status not in CONTENT_STATUSES:
        raise HTTPException(400, f"content_status должен быть одним из: {', '.join(CONTENT_STATUSES)}")


def _validate_ord_responsible(v: str):
    if v not in ORD_RESPONSIBLE:
        raise HTTPException(400, f"ord_responsible должен быть одним из: {', '.join(ORD_RESPONSIBLE)}")


def _validate_ord_status(v: str):
    if v not in ORD_STATUSES:
        raise HTTPException(400, f"ord_status должен быть одним из: {', '.join(ORD_STATUSES)}")


def _validate_ord_reporting_status(v: str):
    if v not in ORD_REPORTING_STATUSES:
        raise HTTPException(400, f"ord_reporting_status должен быть одним из: {', '.join(ORD_REPORTING_STATUSES)}")


def _validate_contract_status(v: str):
    if v not in CONTRACT_STATUSES:
        raise HTTPException(400, f"contract_status должен быть одним из: {', '.join(CONTRACT_STATUSES)}")


_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _validate_talent_type(v: str):
    if v not in TALENT_TYPES:
        raise HTTPException(400, f"talent_type должен быть одним из: {', '.join(TALENT_TYPES)}")


def _validate_integration_time(v: Optional[str]):
    if v is not None and not _TIME_RE.match(v):
        raise HTTPException(400, "integration_time должен быть в формате ЧЧ:ММ (например 18:30)")


# ---------- схемы ----------

class StreamerOut(BaseModel):
    id: int
    integration_id: int
    streamer_name: str
    talent_type: str = "streamer"
    contact: str
    stage: str
    payment_status: str
    content_status: Optional[str] = None
    amount: Optional[float] = None
    currency: str
    commission_percent: float
    streamer_tax_percent: float
    deadline: Optional[datetime] = None
    integration_date: Optional[datetime] = None
    integration_time: Optional[str] = None
    description: str
    contract_file_name: Optional[str] = None
    contract_valid_until: Optional[datetime] = None
    contract_status: str
    contract_sent_date: Optional[datetime] = None
    contract_signed_date: Optional[datetime] = None
    contract_notes: str
    brief: str
    ord_responsible: str
    ord_status: str
    ord_reporting_status: str
    ord_link: str = ""
    ord_report_link: str = ""
    position: int
    created_by_tg_id: Optional[int] = None
    has_case: bool = False
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}

    @computed_field
    @property
    def commission_amount(self) -> Optional[float]:
        if self.amount is None:
            return None
        return round(float(self.amount) * float(self.commission_percent) / 100, 2)

    @computed_field
    @property
    def streamer_net_amount(self) -> Optional[float]:
        if self.amount is None:
            return None
        tax = float(self.amount) * float(self.streamer_tax_percent) / 100
        return round(float(self.amount) - self.commission_amount - tax, 2)

    @computed_field
    @property
    def paid_percent(self) -> Optional[float]:
        """Сколько % от суммы уже фактически оплачено (по истории платежей)."""
        if not self.amount:
            return None
        payments = getattr(self, "payments", None) or []
        paid = sum(float(p.amount) for p in payments)
        if paid <= 0:
            return None
        return round(min(paid / float(self.amount) * 100, 100), 1)


class StreamerCreate(BaseModel):
    streamer_name: str
    talent_type: str = "streamer"
    contact: str = ""
    stage: str = "negotiation"
    payment_status: str = "not_invoiced"
    content_status: Optional[str] = None
    amount: Optional[float] = None
    currency: str = "RUB"
    commission_percent: float = 15
    streamer_tax_percent: float = 6
    deadline: Optional[datetime] = None
    integration_date: Optional[datetime] = None
    integration_time: Optional[str] = None
    description: str = ""
    ord_responsible: str = "us"
    ord_status: str = "todo"
    ord_reporting_status: str = "not_submitted"
    ord_link: str = ""
    ord_report_link: str = ""


class StreamerUpdate(BaseModel):
    streamer_name: Optional[str] = None
    talent_type: Optional[str] = None
    contact: Optional[str] = None
    stage: Optional[str] = None
    payment_status: Optional[str] = None
    content_status: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    commission_percent: Optional[float] = None
    streamer_tax_percent: Optional[float] = None
    deadline: Optional[datetime] = None
    integration_date: Optional[datetime] = None
    integration_time: Optional[str] = None
    description: Optional[str] = None
    contract_valid_until: Optional[datetime] = None
    contract_status: Optional[str] = None
    contract_sent_date: Optional[datetime] = None
    contract_signed_date: Optional[datetime] = None
    contract_notes: Optional[str] = None
    brief: Optional[str] = None
    ord_responsible: Optional[str] = None
    ord_status: Optional[str] = None
    ord_reporting_status: Optional[str] = None
    ord_link: Optional[str] = None
    ord_report_link: Optional[str] = None
    position: Optional[int] = None


class IntegrationOut(BaseModel):
    id: int
    advertiser_id: Optional[int] = None
    brand: str
    description: str
    kp_sheet_url: str = ""
    created_at: datetime
    updated_at: datetime
    streamers: List[StreamerOut] = []
    model_config = {"from_attributes": True}


class IntegrationBrief(BaseModel):
    id: int
    brand: str
    description: str
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class IntegrationCreate(BaseModel):
    advertiser_id: int
    description: str = ""
    kp_sheet_url: str = ""


class IntegrationUpdate(BaseModel):
    description: Optional[str] = None
    kp_sheet_url: Optional[str] = None


class PaymentOut(BaseModel):
    id: int
    streamer_id: int
    amount: float
    currency: str
    comment: str
    paid_at: datetime
    model_config = {"from_attributes": True}


class PaymentCreate(BaseModel):
    amount: float
    currency: str = "RUB"
    comment: str = ""
    paid_at: Optional[datetime] = None


class BriefFileOut(BaseModel):
    id: int
    streamer_id: int
    file_name: str
    size_bytes: int
    created_at: datetime
    model_config = {"from_attributes": True}


class CaseStudyOut(BaseModel):
    id: int
    streamer_id: int
    title: str
    description: str
    what_was_done: str
    result: str
    show_on_site: bool = False
    site_tag: str = "Games"
    site_mini: str = ""
    # {"en": {title, mini, description, what_was_done, result}, "zh": {...}}
    translations: dict[str, dict[str, str]] = {}
    site_published_at: Optional[datetime] = None
    photo_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}

    @field_validator("translations", mode="before")
    @classmethod
    def _parse_translations(cls, v):
        return site_publisher.parse_translations(v) if isinstance(v, str) or v is None else v


class CaseStudyCreate(BaseModel):
    title: str = ""
    description: str = ""
    what_was_done: str = ""
    result: str = ""


class CaseStudyUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    what_was_done: Optional[str] = None
    result: Optional[str] = None
    show_on_site: Optional[bool] = None
    site_tag: Optional[str] = None
    site_mini: Optional[str] = None
    translations: Optional[dict[str, dict[str, str]]] = None


class AuditLogEntryOut(BaseModel):
    id: int
    streamer_id: Optional[int] = None
    integration_id: Optional[int] = None
    brand: str
    streamer_name: str
    field: str
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    changed_by_tg_id: Optional[int] = None
    author_label: Optional[str] = None
    created_at: datetime
    model_config = {"from_attributes": True}


# ---------- сделки (бренды) ----------

@router.get("", response_model=List[IntegrationOut])
def list_integrations(db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    return (
        db.query(Integration)
        .filter(Integration.workspace_id == ws.id)
        .order_by(Integration.updated_at.desc())
        .all()
    )


@router.get("/streamer-names")
def suggest_streamer_names(db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    """Уникальные ранее введённые имена стримеров в этом пространстве - для автоподстановки."""
    rows = (
        db.query(IntegrationStreamer.streamer_name)
        .join(Integration, IntegrationStreamer.integration_id == Integration.id)
        .filter(Integration.workspace_id == ws.id)
        .distinct()
        .all()
    )
    return sorted({r[0] for r in rows if r[0]})


@router.get("/audit-log", response_model=List[AuditLogEntryOut])
def workspace_audit_log(
    limit: int = 100,
    db: Session = Depends(get_db),
    ws: Workspace = Depends(get_current_workspace),
):
    """Должен быть объявлен раньше GET /{integration_id}, иначе 'audit-log' парсится как int-id."""
    entries = (
        db.query(AuditLogEntry)
        .filter(AuditLogEntry.workspace_id == ws.id)
        .order_by(AuditLogEntry.created_at.desc())
        .limit(min(limit, 300))
        .all()
    )
    return [
        AuditLogEntryOut.model_validate(e).model_copy(update={"author_label": _author_label(db, e.changed_by_tg_id)})
        for e in entries
    ]


@router.post("", response_model=IntegrationOut, status_code=201)
def create_integration(data: IntegrationCreate, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    adv = db.get(Advertiser, data.advertiser_id)
    if not adv or adv.workspace_id != ws.id:
        raise HTTPException(404, "Рекламодатель не найден")
    it = Integration(
        workspace_id=ws.id, advertiser_id=adv.id, brand=adv.name,
        description=data.description, kp_sheet_url=data.kp_sheet_url.strip(),
    )
    db.add(it)
    db.commit()
    db.refresh(it)
    return it


@router.get("/{integration_id}", response_model=IntegrationOut)
def get_integration(integration_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    return _get_integration_or_404(db, ws, integration_id)


@router.patch("/{integration_id}", response_model=IntegrationOut)
def update_integration(integration_id: int, data: IntegrationUpdate, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    it = _get_integration_or_404(db, ws, integration_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        if v is None:
            continue
        setattr(it, k, v.strip() if k == "kp_sheet_url" else v)
    db.commit()
    db.refresh(it)
    return it


@router.delete("/{integration_id}")
def delete_integration(integration_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    it = _get_integration_or_404(db, ws, integration_id)
    for s in it.streamers:
        if s.contract_file_path and os.path.exists(s.contract_file_path):
            os.remove(s.contract_file_path)
    db.delete(it)
    db.commit()
    return {"ok": True}


# ---------- стримеры внутри сделки ----------

@router.get("/{integration_id}/streamers", response_model=List[StreamerOut])
def list_streamers(integration_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    _get_integration_or_404(db, ws, integration_id)
    return (
        db.query(IntegrationStreamer)
        .filter(IntegrationStreamer.integration_id == integration_id)
        .order_by(IntegrationStreamer.stage.asc(), IntegrationStreamer.position.asc())
        .all()
    )


@router.post("/{integration_id}/streamers", response_model=StreamerOut, status_code=201)
def create_streamer(
    integration_id: int,
    data: StreamerCreate,
    db: Session = Depends(get_db),
    ws: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
):
    it = _get_integration_or_404(db, ws, integration_id)
    _validate_talent_type(data.talent_type)
    _validate_stage(data.stage)
    _validate_payment_status(data.payment_status)
    _validate_content_status(data.content_status)
    _validate_ord_responsible(data.ord_responsible)
    _validate_ord_status(data.ord_status)
    _validate_ord_reporting_status(data.ord_reporting_status)
    _validate_integration_time(data.integration_time)
    max_pos = (
        db.query(IntegrationStreamer)
        .filter(IntegrationStreamer.integration_id == integration_id, IntegrationStreamer.stage == data.stage)
        .order_by(IntegrationStreamer.position.desc())
        .first()
    )
    s = IntegrationStreamer(
        integration_id=integration_id,
        streamer_name=data.streamer_name,
        talent_type=data.talent_type,
        contact=data.contact,
        stage=data.stage,
        payment_status=data.payment_status,
        content_status=data.content_status,
        amount=data.amount,
        currency=data.currency,
        commission_percent=data.commission_percent,
        streamer_tax_percent=data.streamer_tax_percent,
        deadline=data.deadline,
        integration_date=data.integration_date,
        integration_time=data.integration_time,
        description=data.description,
        ord_responsible=data.ord_responsible,
        ord_status=data.ord_status,
        ord_reporting_status=data.ord_reporting_status,
        ord_link=data.ord_link,
        ord_report_link=data.ord_report_link,
        position=(max_pos.position + 1) if max_pos else 0,
        created_by_tg_id=user.tg_id,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    _log_audit(
        db, workspace_id=it.workspace_id, streamer_id=s.id, integration_id=integration_id,
        brand=it.brand, streamer_name=s.streamer_name, field="created", old=None, new=s.streamer_name, user=user,
    )
    db.commit()
    return s


@router.patch("/streamers/{streamer_id}", response_model=StreamerOut)
def update_streamer(streamer_id: int, data: StreamerUpdate, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace), user: User = Depends(get_current_user)):
    s = _get_streamer_or_404(db, ws, streamer_id)
    if data.talent_type is not None:
        _validate_talent_type(data.talent_type)
    if data.stage is not None:
        _validate_stage(data.stage)
    if data.payment_status is not None:
        _validate_payment_status(data.payment_status)
    if data.content_status is not None:
        _validate_content_status(data.content_status)
    if data.ord_responsible is not None:
        _validate_ord_responsible(data.ord_responsible)
    if data.ord_status is not None:
        _validate_ord_status(data.ord_status)
    if data.ord_reporting_status is not None:
        _validate_ord_reporting_status(data.ord_reporting_status)
    if data.contract_status is not None:
        _validate_contract_status(data.contract_status)
    if "integration_time" in data.model_fields_set:
        _validate_integration_time(data.integration_time)

    changes = data.model_dump(exclude_unset=True)
    old_values = {f: getattr(s, f) for f in TRACKED_FIELDS if f in changes}

    for k, v in changes.items():
        setattr(s, k, v)

    # если время/дату интеграции поправили - пересчитываем цепочку напоминаний заново
    if "integration_date" in changes or "integration_time" in changes:
        s.notified_stream_start = False
        s.notified_screenshot = False
        s.notified_report = False

    # если сделку вернули из "завершено" в другую стадию - при повторном завершении напомним о кейсе снова
    if "stage" in changes and old_values.get("stage") == "done" and changes["stage"] != "done":
        s.notified_case_reminder = False

    db.commit()
    db.refresh(s)

    tracked_changed = [f for f in TRACKED_FIELDS if f in changes]
    if tracked_changed:
        it = db.get(Integration, s.integration_id)
        for f in tracked_changed:
            _log_audit(
                db, workspace_id=it.workspace_id, streamer_id=s.id, integration_id=s.integration_id,
                brand=it.brand, streamer_name=s.streamer_name, field=f, old=old_values[f], new=getattr(s, f), user=user,
            )
        db.commit()
    return s


@router.delete("/streamers/{streamer_id}")
def delete_streamer(streamer_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace), user: User = Depends(get_current_user)):
    s = _get_streamer_or_404(db, ws, streamer_id)
    it = db.get(Integration, s.integration_id)
    if it:
        _log_audit(
            db, workspace_id=it.workspace_id, streamer_id=s.id, integration_id=s.integration_id,
            brand=it.brand, streamer_name=s.streamer_name, field="deleted", old=s.streamer_name, new=None, user=user,
        )
        db.commit()
    if s.contract_file_path and os.path.exists(s.contract_file_path):
        os.remove(s.contract_file_path)
    # cascade удалит строки brief_files, но сами файлы с диска надо убрать руками
    for bf in db.query(BriefFile).filter(BriefFile.streamer_id == s.id).all():
        if os.path.exists(bf.file_path):
            os.remove(bf.file_path)
    db.delete(s)
    db.commit()
    return {"ok": True}


# ---------- договор (файл) ----------

@router.post("/streamers/{streamer_id}/contract", response_model=StreamerOut)
async def upload_contract(streamer_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace), user: User = Depends(get_current_user)):
    s = _get_streamer_or_404(db, ws, streamer_id)
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    ext = os.path.splitext(file.filename or "")[1][:16]
    stored_name = f"{uuid.uuid4().hex}{ext}"
    dest_path = os.path.join(UPLOAD_DIR, stored_name)

    if s.contract_file_path and os.path.exists(s.contract_file_path):
        os.remove(s.contract_file_path)

    with open(dest_path, "wb") as f:
        f.write(await file.read())

    s.contract_file_path = dest_path
    s.contract_file_name = file.filename

    it = db.get(Integration, s.integration_id)
    if it:
        _log_audit(
            db, workspace_id=it.workspace_id, streamer_id=s.id, integration_id=s.integration_id,
            brand=it.brand, streamer_name=s.streamer_name, field="contract_uploaded", old=None,
            new=file.filename, user=user,
        )

    db.commit()
    db.refresh(s)
    return s


@router.get("/streamers/{streamer_id}/contract")
def download_contract(streamer_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    s = _get_streamer_or_404(db, ws, streamer_id)
    if not s.contract_file_path or not os.path.exists(s.contract_file_path):
        raise HTTPException(404, "Договор не найден")
    return FileResponse(s.contract_file_path, filename=s.contract_file_name or "contract")


@router.delete("/streamers/{streamer_id}/contract")
def delete_contract(streamer_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    s = _get_streamer_or_404(db, ws, streamer_id)
    if s.contract_file_path and os.path.exists(s.contract_file_path):
        os.remove(s.contract_file_path)
    s.contract_file_path = None
    s.contract_file_name = None
    db.commit()
    return {"ok": True}


# ---------- файлы ТЗ ----------

@router.get("/streamers/{streamer_id}/brief-files", response_model=List[BriefFileOut])
def list_brief_files(streamer_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    _get_streamer_or_404(db, ws, streamer_id)
    return (
        db.query(BriefFile)
        .filter(BriefFile.streamer_id == streamer_id)
        .order_by(BriefFile.created_at.asc())
        .all()
    )


@router.post("/streamers/{streamer_id}/brief-files", response_model=BriefFileOut, status_code=201)
async def upload_brief_file(streamer_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    _get_streamer_or_404(db, ws, streamer_id)
    os.makedirs(BRIEF_DIR, exist_ok=True)

    content = await file.read()
    if len(content) > MAX_BRIEF_FILE_BYTES:
        raise HTTPException(400, f"Файл больше {MAX_BRIEF_FILE_BYTES // (1024 * 1024)} МБ")

    ext = os.path.splitext(file.filename or "")[1][:16]
    dest_path = os.path.join(BRIEF_DIR, f"{uuid.uuid4().hex}{ext}")
    with open(dest_path, "wb") as f:
        f.write(content)

    bf = BriefFile(
        streamer_id=streamer_id,
        file_path=dest_path,
        file_name=file.filename or "file",
        size_bytes=len(content),
    )
    db.add(bf)
    db.commit()
    db.refresh(bf)
    return bf


def _get_brief_file_or_404(db: Session, ws: Workspace, file_id: int) -> BriefFile:
    bf = db.get(BriefFile, file_id)
    if not bf:
        raise HTTPException(404)
    _get_streamer_or_404(db, ws, bf.streamer_id)
    return bf


@router.get("/brief-files/{file_id}")
def download_brief_file(file_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    bf = _get_brief_file_or_404(db, ws, file_id)
    if not os.path.exists(bf.file_path):
        raise HTTPException(404, "Файл не найден")
    return FileResponse(bf.file_path, filename=bf.file_name)


@router.delete("/brief-files/{file_id}")
def delete_brief_file(file_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    bf = _get_brief_file_or_404(db, ws, file_id)
    if os.path.exists(bf.file_path):
        os.remove(bf.file_path)
    db.delete(bf)
    db.commit()
    return {"ok": True}


# ---------- платежи ----------

@router.get("/streamers/{streamer_id}/payments", response_model=List[PaymentOut])
def list_payments(streamer_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    _get_streamer_or_404(db, ws, streamer_id)
    return (
        db.query(IntegrationPayment)
        .filter(IntegrationPayment.streamer_id == streamer_id)
        .order_by(IntegrationPayment.paid_at.desc())
        .all()
    )


@router.post("/streamers/{streamer_id}/payments", response_model=PaymentOut, status_code=201)
def create_payment(streamer_id: int, data: PaymentCreate, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace), user: User = Depends(get_current_user)):
    s = _get_streamer_or_404(db, ws, streamer_id)
    p = IntegrationPayment(
        streamer_id=streamer_id,
        amount=data.amount,
        currency=data.currency,
        comment=data.comment,
        paid_at=data.paid_at or datetime.now(),
    )
    db.add(p)

    total_paid = sum(
        float(x.amount) for x in db.query(IntegrationPayment).filter(IntegrationPayment.streamer_id == streamer_id)
    ) + float(data.amount)
    if s.amount is not None and total_paid >= float(s.amount):
        s.payment_status = "paid"
    elif total_paid > 0:
        s.payment_status = "partial"

    it = db.get(Integration, s.integration_id)
    if it:
        _log_audit(
            db, workspace_id=it.workspace_id, streamer_id=s.id, integration_id=s.integration_id,
            brand=it.brand, streamer_name=s.streamer_name, field="payment_added", old=None,
            new=f"{data.amount:g} {data.currency}", user=user,
        )

    db.commit()
    db.refresh(p)
    return p


@router.delete("/streamers/{streamer_id}/payments/{payment_id}")
def delete_payment(streamer_id: int, payment_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    _get_streamer_or_404(db, ws, streamer_id)
    p = db.get(IntegrationPayment, payment_id)
    if not p or p.streamer_id != streamer_id:
        raise HTTPException(404)
    db.delete(p)
    db.commit()
    return {"ok": True}


# ---------- кейсы для сайта (фото + результаты интеграции) ----------

@router.get("/streamers/{streamer_id}/cases", response_model=List[CaseStudyOut])
def list_cases(streamer_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    _get_streamer_or_404(db, ws, streamer_id)
    return (
        db.query(CaseStudy)
        .filter(CaseStudy.streamer_id == streamer_id)
        .order_by(CaseStudy.created_at.desc())
        .all()
    )


@router.post("/streamers/{streamer_id}/cases", response_model=CaseStudyOut, status_code=201)
def create_case(streamer_id: int, data: CaseStudyCreate, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    _get_streamer_or_404(db, ws, streamer_id)
    c = CaseStudy(streamer_id=streamer_id, **data.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.patch("/cases/{case_id}", response_model=CaseStudyOut)
def update_case(case_id: int, data: CaseStudyUpdate, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    c = _get_case_or_404(db, ws, case_id)
    changes = data.model_dump(exclude_unset=True)
    if "site_tag" in changes and changes["site_tag"] not in site_publisher.SITE_TAGS:
        raise HTTPException(400, f"site_tag: {', '.join(site_publisher.SITE_TAGS)}")
    if "translations" in changes:
        tr = changes["translations"] or {}
        changes["translations"] = json.dumps(
            {lang: {f: str((tr.get(lang) or {}).get(f, "")) for f in case_translate.FIELDS} for lang in ("en", "zh") if lang in tr},
            ensure_ascii=False,
        )
    for k, v in changes.items():
        if v is None:
            continue
        setattr(c, k, v)
    db.commit()
    db.refresh(c)
    return c


@router.post("/cases/{case_id}/translate", response_model=CaseStudyOut)
def translate_case(case_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    """Автоперевод кейса на EN/ZH (Groq). Обычная def - FastAPI выполнит в потоке, запрос долгий."""
    c = _get_case_or_404(db, ws, case_id)
    try:
        tr = case_translate.translate_case({
            "title": c.title, "mini": c.site_mini, "description": c.description,
            "what_was_done": c.what_was_done, "result": c.result,
        })
    except case_translate.TranslateError as e:
        raise HTTPException(400, str(e))
    c.translations = json.dumps(tr, ensure_ascii=False)
    db.commit()
    db.refresh(c)
    return c


@router.delete("/cases/{case_id}")
def delete_case(case_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    c = _get_case_or_404(db, ws, case_id)
    if c.photo_path and os.path.exists(c.photo_path):
        os.remove(c.photo_path)
    db.delete(c)
    db.commit()
    return {"ok": True}


@router.post("/cases/{case_id}/photo", response_model=CaseStudyOut)
async def upload_case_photo(case_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    c = _get_case_or_404(db, ws, case_id)
    os.makedirs(CASE_PHOTO_DIR, exist_ok=True)

    ext = os.path.splitext(file.filename or "")[1][:16]
    stored_name = f"{uuid.uuid4().hex}{ext}"
    dest_path = os.path.join(CASE_PHOTO_DIR, stored_name)

    if c.photo_path and os.path.exists(c.photo_path):
        os.remove(c.photo_path)

    with open(dest_path, "wb") as f:
        f.write(await file.read())

    c.photo_path = dest_path
    c.photo_name = file.filename
    db.commit()
    db.refresh(c)
    return c


@router.get("/cases/{case_id}/photo")
def download_case_photo(case_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    c = _get_case_or_404(db, ws, case_id)
    if not c.photo_path or not os.path.exists(c.photo_path):
        raise HTTPException(404, "Фото не найдено")
    return FileResponse(c.photo_path, filename=c.photo_name or "photo")


@router.delete("/cases/{case_id}/photo")
def delete_case_photo(case_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    c = _get_case_or_404(db, ws, case_id)
    if c.photo_path and os.path.exists(c.photo_path):
        os.remove(c.photo_path)
    c.photo_path = None
    c.photo_name = None
    db.commit()
    return {"ok": True}


# ---------- обсуждение сделки со стримером ----------

def _author_label(db: Session, tg_id: Optional[int]) -> Optional[str]:
    if tg_id is None:
        return None
    u = db.get(User, tg_id)
    if not u:
        return None
    return u.label or u.tg_first_name or u.tg_username or str(u.tg_id)


# обсуждения переехали в routers/chat.py: там общая лента пространства
# и те же ветки по сделкам в одном разделе


# ---------- журнал изменений (кто когда что менял) ----------

@router.get("/streamers/{streamer_id}/audit-log", response_model=List[AuditLogEntryOut])
def streamer_audit_log(streamer_id: int, db: Session = Depends(get_db), ws: Workspace = Depends(get_current_workspace)):
    _get_streamer_or_404(db, ws, streamer_id)
    entries = (
        db.query(AuditLogEntry)
        .filter(AuditLogEntry.streamer_id == streamer_id)
        .order_by(AuditLogEntry.created_at.desc())
        .all()
    )
    return [
        AuditLogEntryOut.model_validate(e).model_copy(update={"author_label": _author_label(db, e.changed_by_tg_id)})
        for e in entries
    ]
