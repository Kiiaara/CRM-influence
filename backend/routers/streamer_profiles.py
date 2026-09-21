"""Справочник стримеров (медиакит): соцсети, аудитория, прайс-лист.
Импорт/экспорт через Excel, независим от конкретных сделок."""
import io
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Body
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from openpyxl import Workbook, load_workbook

from database import get_db
from deps import get_current_user, require_role
from models.streamer_profile import StreamerProfile
from models.user import User

router = APIRouter(prefix="/api/streamer-profiles", tags=["streamer-profiles"])

# (заголовок колонки в Excel, имя поля модели, тип)
COLUMNS: list[tuple[str, str, type]] = [
    ("Имя", "name", str),
    ("Ссылка на Twitch", "twitch_url", str),
    ("Категория", "category", str),
    ("Соц. сети", "social_links", str),
    ("Подписчики", "subscribers", int),
    ("Средний онлайн", "avg_online", int),
    ("Гео", "geo", str),
    ("Просмотров за месяц", "views_per_month", int),
    ("Просмотры за 1 стрим", "views_per_stream", int),
    ("Подписчики Telegram", "telegram_subscribers", int),
    ("Telegram Охват", "telegram_reach", int),
    ("Стоимость поста", "post_price", float),
    ("Реестр КНД", "knd_registry", str),
    ("Твич партнер", "twitch_partner", bool),
    ("Статистика", "stats_url", str),
    ("Дата обновления статы", "stats_updated_at", datetime),
    ("Менеджер", "manager", str),
    ("Стоимость брендинга на 1 неделю", "branding_price_1w", float),
    ("Стоимость брендинга на 2 недели", "branding_price_2w", float),
    ("Стоимость брендинга на 3 недели", "branding_price_3w", float),
    ("Стоимость брендинга на 1 месяц", "branding_price_1m", float),
    ("Стоимость спецстрима", "special_stream_price", float),
    ("Стоимость 1 голосовой интеграции", "voice_integration_price", float),
]


class ProfileOut(BaseModel):
    id: int
    name: str
    twitch_url: str
    category: str
    social_links: str
    subscribers: Optional[int] = None
    avg_online: Optional[int] = None
    geo: str
    views_per_month: Optional[int] = None
    views_per_stream: Optional[int] = None
    telegram_subscribers: Optional[int] = None
    telegram_reach: Optional[int] = None
    post_price: Optional[float] = None
    knd_registry: str
    twitch_partner: bool
    stats_url: str
    stats_updated_at: Optional[datetime] = None
    manager: str
    branding_price_1w: Optional[float] = None
    branding_price_2w: Optional[float] = None
    branding_price_3w: Optional[float] = None
    branding_price_1m: Optional[float] = None
    special_stream_price: Optional[float] = None
    voice_integration_price: Optional[float] = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class ProfileCreate(BaseModel):
    name: str
    twitch_url: str = ""
    category: str = ""
    social_links: str = ""
    subscribers: Optional[int] = None
    avg_online: Optional[int] = None
    geo: str = ""
    views_per_month: Optional[int] = None
    views_per_stream: Optional[int] = None
    telegram_subscribers: Optional[int] = None
    telegram_reach: Optional[int] = None
    post_price: Optional[float] = None
    knd_registry: str = ""
    twitch_partner: bool = False
    stats_url: str = ""
    stats_updated_at: Optional[datetime] = None
    manager: str = ""
    branding_price_1w: Optional[float] = None
    branding_price_2w: Optional[float] = None
    branding_price_3w: Optional[float] = None
    branding_price_1m: Optional[float] = None
    special_stream_price: Optional[float] = None
    voice_integration_price: Optional[float] = None


class ProfileUpdate(ProfileCreate):
    name: Optional[str] = None


@router.get("", response_model=List[ProfileOut])
def list_profiles(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.query(StreamerProfile).order_by(StreamerProfile.name.asc()).all()


@router.post("", response_model=ProfileOut, status_code=201)
def create_profile(data: ProfileCreate, db: Session = Depends(get_db), user: User = Depends(require_role("admin", "editor"))):
    p = StreamerProfile(**data.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@router.patch("/{profile_id}", response_model=ProfileOut)
def update_profile(profile_id: int, data: ProfileUpdate, db: Session = Depends(get_db), user: User = Depends(require_role("admin", "editor"))):
    p = db.get(StreamerProfile, profile_id)
    if not p:
        raise HTTPException(404)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return p


@router.delete("/{profile_id}")
def delete_profile(profile_id: int, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    p = db.get(StreamerProfile, profile_id)
    if not p:
        raise HTTPException(404)
    db.delete(p)
    db.commit()
    return {"ok": True}


def _clean_number(value) -> Optional[float]:
    """Достаём число из 'p.155 265', '5 860 000', '82%' и подобного мусора."""
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if not s:
        return None
    s = s.replace("\xa0", " ")
    # оставляем цифры, точку, запятую и минус
    cleaned = "".join(ch for ch in s if ch.isdigit() or ch in ".,-")
    cleaned = cleaned.replace(",", ".")
    if not cleaned or cleaned in ("-", "."):
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _cast(value, py_type):
    if value is None or value == "":
        return None
    if py_type is bool:
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in ("да", "yes", "true", "1", "истина")
    if py_type is int:
        n = _clean_number(value)
        return int(n) if n is not None else None
    if py_type is float:
        return _clean_number(value)
    if py_type is datetime:
        if isinstance(value, datetime):
            return value
        return None
    return str(value)


def _name_from_twitch_url(url: object) -> str:
    """Если колонки 'Имя' нет, берём ник из хвоста ссылки на Twitch."""
    s = str(url or "").strip().rstrip("/")
    if not s:
        return ""
    return s.rsplit("/", 1)[-1]


@router.post("/import")
async def import_profiles(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    """Импорт из Excel. Первая строка - заголовки (см. COLUMNS), строки с существующим
    именем стримера обновляются, новые - создаются."""
    content = await file.read()
    wb = load_workbook(io.BytesIO(content), data_only=True)
    ws = wb.active

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise HTTPException(400, "Пустой файл")

    header = [str(h).strip() if h else "" for h in rows[0]]
    header_to_field = {label: field for label, field, _ in COLUMNS}
    field_types = {field: t for _, field, t in COLUMNS}
    col_map: dict[int, str] = {}
    for idx, h in enumerate(header):
        if h in header_to_field:
            col_map[idx] = header_to_field[h]

    has_name_col = "name" in col_map.values()
    twitch_col_idx = next((idx for idx, f in col_map.items() if f == "twitch_url"), None)
    if not has_name_col and twitch_col_idx is None:
        raise HTTPException(400, "В файле должна быть колонка 'Имя' или 'Ссылка на Twitch'")

    created, updated = 0, 0
    for row in rows[1:]:
        if not row or all(c is None for c in row):
            continue
        values: dict[str, object] = {}
        for idx, field in col_map.items():
            if idx >= len(row):
                continue
            values[field] = _cast(row[idx], field_types[field])

        name = values.get("name")
        if not name and twitch_col_idx is not None and twitch_col_idx < len(row):
            name = _name_from_twitch_url(row[twitch_col_idx])
            if name:
                values["name"] = name
        if not name:
            continue

        existing = db.query(StreamerProfile).filter(StreamerProfile.name == name).first()
        if existing:
            for k, v in values.items():
                if v is not None:
                    setattr(existing, k, v)
            updated += 1
        else:
            fields = {k: v for k, v in values.items() if v is not None and k != "name"}
            db.add(StreamerProfile(name=name, **fields))
            created += 1

    db.commit()
    return {"created": created, "updated": updated}


@router.get("/export")
def export_profiles(ids: Optional[str] = None, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    """Экспорт справочника (или подборки по ids=1,2,3) в Excel - для отправки клиенту как КП.
    База общая на все пространства, поэтому выгрузку целиком отдаём только админу -
    иначе приглашённый унёс бы весь медиакит с прайсами одним файлом."""
    q = db.query(StreamerProfile)
    if ids:
        id_list = [int(x) for x in ids.split(",") if x.strip().isdigit()]
        q = q.filter(StreamerProfile.id.in_(id_list))
    profiles = q.order_by(StreamerProfile.name.asc()).all()

    wb = Workbook()
    ws = wb.active
    ws.title = "Стримеры"
    ws.append([label for label, _, _ in COLUMNS])
    for p in profiles:
        row = []
        for _, field, _ in COLUMNS:
            v = getattr(p, field)
            if field == "twitch_partner":
                v = "Да" if v else "Нет"
            elif isinstance(v, datetime):
                v = v.strftime("%Y-%m-%d")
            row.append(v if v is not None else "")
        ws.append(row)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=streamers.xlsx"},
    )
