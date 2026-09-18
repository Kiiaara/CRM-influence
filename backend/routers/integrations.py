"""CRM интеграций: сделка с брендом (Integration) содержит пул стримеров
(IntegrationStreamer), каждый со своим статусом/сроком/суммой/договором/оплатами."""
import os
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel, computed_field
from sqlalchemy.orm import Session

from database import get_db
from deps import get_current_user
from models.integration import Integration
from models.integration_streamer import IntegrationStreamer
from models.integration_payment import IntegrationPayment
from models.case_study import CaseStudy
from models.user import User

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

STAGES = ("negotiation", "agreed", "awaiting_contract", "awaiting_payment", "done", "cancelled")
PAYMENT_STATUSES = ("not_invoiced", "invoiced", "partial", "paid")
CONTENT_STATUSES = ("awaiting_brief", "filming", "filmed")

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "contracts")
CASE_PHOTO_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "case_photos")


def _validate_stage(stage: str):
    if stage not in STAGES:
        raise HTTPException(400, f"stage должен быть одним из: {', '.join(STAGES)}")


def _validate_payment_status(status: str):
    if status not in PAYMENT_STATUSES:
        raise HTTPException(400, f"payment_status должен быть одним из: {', '.join(PAYMENT_STATUSES)}")


def _validate_content_status(status: Optional[str]):
    if status is not None and status not in CONTENT_STATUSES:
        raise HTTPException(400, f"content_status должен быть одним из: {', '.join(CONTENT_STATUSES)}")


# ---------- схемы ----------

class StreamerOut(BaseModel):
    id: int
    integration_id: int
    streamer_name: str
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
    description: str
    contract_file_name: Optional[str] = None
    contract_valid_until: Optional[datetime] = None
    position: int
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
    description: str = ""


class StreamerUpdate(BaseModel):
    streamer_name: Optional[str] = None
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
    description: Optional[str] = None
    contract_valid_until: Optional[datetime] = None
    position: Optional[int] = None


class IntegrationOut(BaseModel):
    id: int
    brand: str
    description: str
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
    brand: str
    description: str = ""


class IntegrationUpdate(BaseModel):
    brand: Optional[str] = None
    description: Optional[str] = None


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


class CaseStudyOut(BaseModel):
    id: int
    streamer_id: int
    title: str
    description: str
    what_was_done: str
    result: str
    photo_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


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


# ---------- сделки (бренды) ----------

@router.get("", response_model=List[IntegrationOut])
def list_integrations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.query(Integration).order_by(Integration.updated_at.desc()).all()


@router.get("/streamer-names")
def suggest_streamer_names(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Уникальные ранее введённые имена стримеров - для автоподстановки."""
    rows = db.query(IntegrationStreamer.streamer_name).distinct().all()
    return sorted({r[0] for r in rows if r[0]})


@router.post("", response_model=IntegrationOut, status_code=201)
def create_integration(data: IntegrationCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    it = Integration(workspace_id=1, brand=data.brand, description=data.description)
    db.add(it)
    db.commit()
    db.refresh(it)
    return it


@router.get("/{integration_id}", response_model=IntegrationOut)
def get_integration(integration_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    it = db.get(Integration, integration_id)
    if not it:
        raise HTTPException(404)
    return it


@router.patch("/{integration_id}", response_model=IntegrationOut)
def update_integration(integration_id: int, data: IntegrationUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    it = db.get(Integration, integration_id)
    if not it:
        raise HTTPException(404)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(it, k, v)
    db.commit()
    db.refresh(it)
    return it


@router.delete("/{integration_id}")
def delete_integration(integration_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    it = db.get(Integration, integration_id)
    if not it:
        raise HTTPException(404)
    for s in it.streamers:
        if s.contract_file_path and os.path.exists(s.contract_file_path):
            os.remove(s.contract_file_path)
    db.delete(it)
    db.commit()
    return {"ok": True}


# ---------- стримеры внутри сделки ----------

@router.get("/{integration_id}/streamers", response_model=List[StreamerOut])
def list_streamers(integration_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not db.get(Integration, integration_id):
        raise HTTPException(404)
    return (
        db.query(IntegrationStreamer)
        .filter(IntegrationStreamer.integration_id == integration_id)
        .order_by(IntegrationStreamer.stage.asc(), IntegrationStreamer.position.asc())
        .all()
    )


@router.post("/{integration_id}/streamers", response_model=StreamerOut, status_code=201)
def create_streamer(integration_id: int, data: StreamerCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not db.get(Integration, integration_id):
        raise HTTPException(404)
    _validate_stage(data.stage)
    _validate_payment_status(data.payment_status)
    _validate_content_status(data.content_status)
    max_pos = (
        db.query(IntegrationStreamer)
        .filter(IntegrationStreamer.integration_id == integration_id, IntegrationStreamer.stage == data.stage)
        .order_by(IntegrationStreamer.position.desc())
        .first()
    )
    s = IntegrationStreamer(
        integration_id=integration_id,
        streamer_name=data.streamer_name,
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
        description=data.description,
        position=(max_pos.position + 1) if max_pos else 0,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@router.patch("/streamers/{streamer_id}", response_model=StreamerOut)
def update_streamer(streamer_id: int, data: StreamerUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = db.get(IntegrationStreamer, streamer_id)
    if not s:
        raise HTTPException(404)
    if data.stage is not None:
        _validate_stage(data.stage)
    if data.payment_status is not None:
        _validate_payment_status(data.payment_status)
    if data.content_status is not None:
        _validate_content_status(data.content_status)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return s


@router.delete("/streamers/{streamer_id}")
def delete_streamer(streamer_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = db.get(IntegrationStreamer, streamer_id)
    if not s:
        raise HTTPException(404)
    if s.contract_file_path and os.path.exists(s.contract_file_path):
        os.remove(s.contract_file_path)
    db.delete(s)
    db.commit()
    return {"ok": True}


# ---------- договор (файл) ----------

@router.post("/streamers/{streamer_id}/contract", response_model=StreamerOut)
async def upload_contract(streamer_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = db.get(IntegrationStreamer, streamer_id)
    if not s:
        raise HTTPException(404)
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
    db.commit()
    db.refresh(s)
    return s


@router.get("/streamers/{streamer_id}/contract")
def download_contract(streamer_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = db.get(IntegrationStreamer, streamer_id)
    if not s or not s.contract_file_path or not os.path.exists(s.contract_file_path):
        raise HTTPException(404, "Договор не найден")
    return FileResponse(s.contract_file_path, filename=s.contract_file_name or "contract")


@router.delete("/streamers/{streamer_id}/contract")
def delete_contract(streamer_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = db.get(IntegrationStreamer, streamer_id)
    if not s:
        raise HTTPException(404)
    if s.contract_file_path and os.path.exists(s.contract_file_path):
        os.remove(s.contract_file_path)
    s.contract_file_path = None
    s.contract_file_name = None
    db.commit()
    return {"ok": True}


# ---------- платежи ----------

@router.get("/streamers/{streamer_id}/payments", response_model=List[PaymentOut])
def list_payments(streamer_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not db.get(IntegrationStreamer, streamer_id):
        raise HTTPException(404)
    return (
        db.query(IntegrationPayment)
        .filter(IntegrationPayment.streamer_id == streamer_id)
        .order_by(IntegrationPayment.paid_at.desc())
        .all()
    )


@router.post("/streamers/{streamer_id}/payments", response_model=PaymentOut, status_code=201)
def create_payment(streamer_id: int, data: PaymentCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = db.get(IntegrationStreamer, streamer_id)
    if not s:
        raise HTTPException(404)
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

    db.commit()
    db.refresh(p)
    return p


@router.delete("/streamers/{streamer_id}/payments/{payment_id}")
def delete_payment(streamer_id: int, payment_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = db.get(IntegrationPayment, payment_id)
    if not p or p.streamer_id != streamer_id:
        raise HTTPException(404)
    db.delete(p)
    db.commit()
    return {"ok": True}


# ---------- кейсы для сайта (фото + результаты интеграции) ----------

@router.get("/streamers/{streamer_id}/cases", response_model=List[CaseStudyOut])
def list_cases(streamer_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not db.get(IntegrationStreamer, streamer_id):
        raise HTTPException(404)
    return (
        db.query(CaseStudy)
        .filter(CaseStudy.streamer_id == streamer_id)
        .order_by(CaseStudy.created_at.desc())
        .all()
    )


@router.post("/streamers/{streamer_id}/cases", response_model=CaseStudyOut, status_code=201)
def create_case(streamer_id: int, data: CaseStudyCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not db.get(IntegrationStreamer, streamer_id):
        raise HTTPException(404)
    c = CaseStudy(streamer_id=streamer_id, **data.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.patch("/cases/{case_id}", response_model=CaseStudyOut)
def update_case(case_id: int, data: CaseStudyUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = db.get(CaseStudy, case_id)
    if not c:
        raise HTTPException(404)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    db.commit()
    db.refresh(c)
    return c


@router.delete("/cases/{case_id}")
def delete_case(case_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = db.get(CaseStudy, case_id)
    if not c:
        raise HTTPException(404)
    if c.photo_path and os.path.exists(c.photo_path):
        os.remove(c.photo_path)
    db.delete(c)
    db.commit()
    return {"ok": True}


@router.post("/cases/{case_id}/photo", response_model=CaseStudyOut)
async def upload_case_photo(case_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = db.get(CaseStudy, case_id)
    if not c:
        raise HTTPException(404)
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
def download_case_photo(case_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = db.get(CaseStudy, case_id)
    if not c or not c.photo_path or not os.path.exists(c.photo_path):
        raise HTTPException(404, "Фото не найдено")
    return FileResponse(c.photo_path, filename=c.photo_name or "photo")


@router.delete("/cases/{case_id}/photo")
def delete_case_photo(case_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = db.get(CaseStudy, case_id)
    if not c:
        raise HTTPException(404)
    if c.photo_path and os.path.exists(c.photo_path):
        os.remove(c.photo_path)
    c.photo_path = None
    c.photo_name = None
    db.commit()
    return {"ok": True}
