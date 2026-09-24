"""Универсальный редактор CRM в Telegram-боте: сделки, оплаты, кейсы, файлы ТЗ,
рекламодатели и контакты, задачи, база стримеров и база блогеров.

Каждая сущность описана декларативно (Entity: поля, как искать, как создавать, кто может
править), а общий код рисует списки, карточки, кнопки полей и принимает ввод. Так бот
умеет править всё, что есть на сайте, без отдельного диалога под каждую форму.

Карточка стримера/блогера внутри сделки редактируется старым категорийным меню из
bot_dialog (e:...), здесь для неё только список, удаление и дочерние разделы.

Колбэки (callback_data до 64 байт):
  x:m                          главное меню
  x:l:<ent>:<parent>:<page>    список (parent=0 - без родителя)
  x:o:<ent>:<id>               карточка
  x:f:<ent>:<id>:<field_idx>   выбрать поле
  x:v:<ent>:<id>:<field_idx>:<opt_idx|n>   значение для enum/bool
  x:n:<ent>:<parent>           создать
  x:s:<ent>:<parent>           поиск по списку / x:sc:<ent>:<parent> - сбросить поиск
  x:dq:<ent>:<id> / x:dd:<ent>:<id>        удалить (вопрос / подтверждение)
  x:a:<action>:<id>            особые действия (файлы, синхронизация таблицы...)
  x:ws:<workspace_id>          выбрать пространство для бота
"""
import html
import json
import logging
import os
import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Optional

from sqlalchemy.orm import Session

import blogger_sheet
import notifier
from database import SessionLocal
from models.advertiser import Advertiser
from models.audit_log import AuditLogEntry
from models.blogger_profile import BloggerProfile
from models.brand_contact import BrandContact
from models.brief_file import BriefFile
from models.case_study import CaseStudy
from models.integration import Integration
from models.integration_payment import IntegrationPayment
from models.integration_streamer import IntegrationStreamer
from models.streamer_profile import StreamerProfile
from models.task import Task
from models.user import User
from models.workspace import Workspace, WorkspaceMember
from notifier import send_message

log = logging.getLogger(__name__)

PAGE_SIZE = 8
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
CONTRACT_DIR = os.path.join(DATA_DIR, "contracts")
CASE_PHOTO_DIR = os.path.join(DATA_DIR, "case_photos")
BRIEF_DIR = os.path.join(DATA_DIR, "briefs")
MAX_BRIEF_FILE_BYTES = 25 * 1024 * 1024

STAGE_LABELS = {
    "negotiation": "На согласовании",
    "agreed": "Согласован",
    "awaiting_contract": "Ждёт договора",
    "awaiting_payment": "Ждёт оплаты",
    "done": "Завершено",
    "cancelled": "Отменено",
}
TALENT_LABELS = {"streamer": "Стример", "blogger": "Блогер"}
TASK_STATUS_LABELS = {"todo": "К выполнению", "doing": "В работе", "done": "Готово"}
CONTACT_TYPE_LABELS = {
    "telegram": "Telegram", "email": "Email", "whatsapp": "WhatsApp", "phone": "Телефон", "other": "Другое",
}
BOOL_LABELS = {"1": "Да", "0": "Нет"}

# состояние "ждём текстовый ввод/файл" - в bot_dialog._sessions (общий dict на tg_id),
# а поисковые строки по спискам - здесь: tg_id -> {entity_code: query}
_search: dict[int, dict[str, str]] = {}


def esc(v: Any) -> str:
    return html.escape(str(v), quote=False)


# ---------- контекст запроса: юзер + его пространство в боте ----------

def resolve_workspace_id(db: Session, tg_id: int) -> Optional[int]:
    """Пространство бота: выбранное через /workspace (если юзер всё ещё там участник),
    иначе первое по дате вступления."""
    u = db.get(User, tg_id)
    if u and u.bot_workspace_id:
        member = db.query(WorkspaceMember).filter_by(workspace_id=u.bot_workspace_id, user_tg_id=tg_id).first()
        if member:
            return member.workspace_id
    member = (
        db.query(WorkspaceMember)
        .filter_by(user_tg_id=tg_id)
        .order_by(WorkspaceMember.joined_at.asc())
        .first()
    )
    return member.workspace_id if member else None


@dataclass
class Ctx:
    db: Session
    tg_id: int
    user: User
    ws_id: Optional[int]


# ---------- описание сущностей ----------

@dataclass
class F:
    key: str
    label: str
    kind: str  # text | int | float | date | datetime | time | enum | bool
    options: Optional[Any] = None  # dict[str, str] или callable(ctx, obj) -> dict[str, str]
    nullable: bool = False  # можно ли очистить в None (иначе текст очищается в "", число - нельзя)
    required: bool = False  # нельзя очистить совсем (имя, название)


@dataclass
class Entity:
    code: str
    title: str
    plural: str
    model: type
    fields: list[F]
    label: Callable[[Any], str]
    # пространство объекта (для проверки доступа); None у глобальных баз стримеров/блогеров
    workspace_of: Callable[[Session, Any], Optional[int]] = lambda db, o: None
    global_base: bool = False
    edit_roles: tuple = ()  # глобальные роли, которым можно править (пусто - всем участникам)
    delete_roles: tuple = ()
    list_query: Optional[Callable[[Ctx, int], Any]] = None  # (ctx, parent_id) -> Query
    search_attrs: tuple = ("name",)
    parent_code: Optional[str] = None
    parent_of: Optional[Callable[[Any], int]] = None
    create_prompt: str = ""
    create_prompt_in_parent: str = ""  # вопрос при создании изнутри родителя (если отличается)
    create: Optional[Callable[[Ctx, int, str], Any]] = None  # (ctx, parent_id, text) -> obj | str (ошибка)
    on_change: Optional[Callable[[Ctx, Any, str, Any, Any], Optional[str]]] = None  # вернуть строку = отказ
    before_delete: Optional[Callable[[Ctx, Any], Optional[str]]] = None  # строка = нельзя удалить
    extra_buttons: Optional[Callable[[Ctx, Any], list]] = None
    header: Optional[Callable[[Ctx, Any], str]] = None  # доп. текст карточки
    list_extra: Optional[Callable[[Ctx, int], list]] = None  # доп. кнопки над списком
    open_cb: Optional[Callable[[Any], str]] = None  # свой колбэк открытия (карточка участника)
    delete_hint: str = ""
    readonly: bool = False  # только просмотр (база блогеров правится только в гугл-таблице)


def _ws_of_streamer(db: Session, s: Optional[IntegrationStreamer]) -> Optional[int]:
    if not s:
        return None
    it = db.get(Integration, s.integration_id)
    return it.workspace_id if it else None


def _audit(ctx: Ctx, s: IntegrationStreamer, field_name: str, old, new):
    if old == new:
        return
    it = ctx.db.get(Integration, s.integration_id)
    ctx.db.add(AuditLogEntry(
        workspace_id=it.workspace_id, streamer_id=s.id, integration_id=s.integration_id,
        brand=it.brand, streamer_name=s.streamer_name, field=field_name,
        old_value=str(old) if old is not None else None,
        new_value=str(new) if new is not None else None,
        changed_by_tg_id=ctx.tg_id,
    ))


def _remove_file(path: Optional[str]):
    if path and os.path.exists(path):
        os.remove(path)


def _money(v) -> str:
    return "—" if v is None else f"{float(v):,.0f}".replace(",", " ")


# --- сделка ---

def _deal_label(it: Integration) -> str:
    return f"{it.brand} · {len(it.streamers)} уч."


def _deal_header(ctx: Ctx, it: Integration) -> str:
    lines = []
    if it.kp_sheet_url:
        lines.append(f'📊 <a href="{esc(it.kp_sheet_url)}">Таблица КП</a>')
    for s in it.streamers:
        icon = "📱" if s.talent_type == "blogger" else "🎮"
        lines.append(f"{icon} {esc(s.streamer_name)} — {STAGE_LABELS.get(s.stage, s.stage)}, {_money(s.amount)}")
    return "\n".join(lines)


def _deal_create(ctx: Ctx, parent_id: int, text: str):
    name = text.strip()
    if not name:
        return "Название не может быть пустым."
    if parent_id:
        adv = ctx.db.get(Advertiser, parent_id)
    else:
        adv = ctx.db.query(Advertiser).filter(Advertiser.workspace_id == ctx.ws_id, Advertiser.name == name).first()
        if not adv:
            adv = Advertiser(workspace_id=ctx.ws_id, name=name)
            ctx.db.add(adv)
            ctx.db.flush()
    if not adv or adv.workspace_id != ctx.ws_id:
        return "Рекламодатель не найден."
    it = Integration(workspace_id=ctx.ws_id, advertiser_id=adv.id, brand=adv.name, description=name if parent_id else "")
    ctx.db.add(it)
    return it


def _deal_before_delete(ctx: Ctx, it: Integration):
    for s in it.streamers:
        _remove_file(s.contract_file_path)
        for bf in ctx.db.query(BriefFile).filter(BriefFile.streamer_id == s.id).all():
            _remove_file(bf.file_path)
        for c in ctx.db.query(CaseStudy).filter(CaseStudy.streamer_id == s.id).all():
            _remove_file(c.photo_path)
    return None


def _deal_extra(ctx: Ctx, it: Integration) -> list:
    rows = [
        [{"text": "👥 Участники", "callback_data": f"x:l:card:{it.id}:0"},
         {"text": "➕ Участник", "callback_data": f"x:a:addp:{it.id}"}],
    ]
    if it.advertiser_id:
        rows.append([{"text": "🏢 Рекламодатель", "callback_data": f"x:o:adv:{it.advertiser_id}"}])
    return rows


def _deal_list(ctx: Ctx, parent_id: int):
    q = ctx.db.query(Integration).filter(Integration.workspace_id == ctx.ws_id)
    if parent_id:
        q = q.filter(Integration.advertiser_id == parent_id)
    return q.order_by(Integration.updated_at.desc())


# --- карточка участника (стример/блогер в сделке) ---

def _card_label(s: IntegrationStreamer) -> str:
    icon = "📱" if s.talent_type == "blogger" else "🎮"
    return f"{icon} {s.integration.brand} · {s.streamer_name} ({STAGE_LABELS.get(s.stage, s.stage)})"


def _card_list(ctx: Ctx, parent_id: int):
    q = ctx.db.query(IntegrationStreamer).join(Integration).filter(Integration.workspace_id == ctx.ws_id)
    if parent_id:
        q = q.filter(IntegrationStreamer.integration_id == parent_id)
    return q.order_by(IntegrationStreamer.updated_at.desc())


def _card_before_delete(ctx: Ctx, s: IntegrationStreamer):
    _audit(ctx, s, "deleted", s.streamer_name, None)
    _remove_file(s.contract_file_path)
    for bf in ctx.db.query(BriefFile).filter(BriefFile.streamer_id == s.id).all():
        _remove_file(bf.file_path)
    for c in ctx.db.query(CaseStudy).filter(CaseStudy.streamer_id == s.id).all():
        _remove_file(c.photo_path)
    return None


# --- оплата ---

def _pay_create(ctx: Ctx, parent_id: int, text: str):
    try:
        amount = float(text.replace(",", ".").replace(" ", ""))
    except ValueError:
        return "Не понял сумму, введи число (например 50000)."
    s = ctx.db.get(IntegrationStreamer, parent_id)
    p = IntegrationPayment(streamer_id=s.id, amount=amount, currency=s.currency or "RUB", comment="", paid_at=datetime.now())
    ctx.db.add(p)
    # та же логика, что на сайте: суммарно оплатили >= суммы сделки -> "оплачен", иначе "частично"
    total = sum(float(x.amount) for x in ctx.db.query(IntegrationPayment).filter(IntegrationPayment.streamer_id == s.id)) + amount
    old_status = s.payment_status
    if s.amount is not None and total >= float(s.amount):
        s.payment_status = "paid"
    elif total > 0:
        s.payment_status = "partial"
    _audit(ctx, s, "payment_added", None, f"{amount:g} {p.currency}")
    if old_status != s.payment_status:
        _audit(ctx, s, "payment_status", old_status, s.payment_status)
    return p


# --- кейс ---

def _case_label(c: CaseStudy) -> str:
    return (c.title or "Без названия")[:40] + (" 🖼" if c.photo_path else "")


def _case_list(ctx: Ctx, parent_id: int):
    q = (
        ctx.db.query(CaseStudy)
        .join(IntegrationStreamer, CaseStudy.streamer_id == IntegrationStreamer.id)
        .join(Integration, IntegrationStreamer.integration_id == Integration.id)
        .filter(Integration.workspace_id == ctx.ws_id)
    )
    if parent_id:
        q = q.filter(CaseStudy.streamer_id == parent_id)
    return q.order_by(CaseStudy.updated_at.desc())


def _case_header(ctx: Ctx, c: CaseStudy) -> str:
    s = ctx.db.get(IntegrationStreamer, c.streamer_id)
    return f"{esc(s.integration.brand)} × {esc(s.streamer_name)}" if s else ""


def _case_extra(ctx: Ctx, c: CaseStudy) -> list:
    row = [{"text": "🖼 Загрузить фото", "callback_data": f"x:a:cphoto:{c.id}"}]
    if c.photo_path:
        row.append({"text": "👀 Фото", "callback_data": f"x:a:cphotoget:{c.id}"})
    return [row, [{"text": "👤 Карточка участника", "callback_data": f"e:cat:{c.streamer_id}"}]]


def _case_before_delete(ctx: Ctx, c: CaseStudy):
    _remove_file(c.photo_path)
    return None


# --- файлы ТЗ ---

def _brief_extra(ctx: Ctx, bf: BriefFile) -> list:
    return [[{"text": "⬇️ Скачать", "callback_data": f"x:a:bget:{bf.id}"}]]


def _brief_list_extra(ctx: Ctx, parent_id: int) -> list:
    return [[{"text": "📎 Загрузить файл ТЗ", "callback_data": f"x:a:bup:{parent_id}"}]] if parent_id else []


def _brief_before_delete(ctx: Ctx, bf: BriefFile):
    _remove_file(bf.file_path)
    return None


# --- рекламодатель и контакты ---

def _adv_change(ctx: Ctx, adv: Advertiser, key: str, old, new) -> Optional[str]:
    if key == "name":
        dup = (
            ctx.db.query(Advertiser)
            .filter(Advertiser.workspace_id == adv.workspace_id, Advertiser.name == new, Advertiser.id != adv.id)
            .first()
        )
        if dup:
            return "Рекламодатель с таким названием уже есть."
        # держим Integration.brand синхронным - весь остальной код читает его напрямую
        ctx.db.query(Integration).filter(Integration.advertiser_id == adv.id).update({"brand": new})
    return None


def _adv_create(ctx: Ctx, parent_id: int, text: str):
    name = text.strip()
    if ctx.db.query(Advertiser).filter(Advertiser.workspace_id == ctx.ws_id, Advertiser.name == name).first():
        return "Рекламодатель с таким названием уже есть."
    adv = Advertiser(workspace_id=ctx.ws_id, name=name)
    ctx.db.add(adv)
    return adv


def _adv_before_delete(ctx: Ctx, adv: Advertiser):
    if ctx.db.query(Integration).filter(Integration.advertiser_id == adv.id).first():
        return "У рекламодателя есть сделки - сначала удалите их."
    ctx.db.query(BrandContact).filter(BrandContact.advertiser_id == adv.id).delete()
    return None


def _adv_extra(ctx: Ctx, adv: Advertiser) -> list:
    return [[
        {"text": "📇 Контакты", "callback_data": f"x:l:contact:{adv.id}:0"},
        {"text": "🤝 Сделки", "callback_data": f"x:l:deal:{adv.id}:0"},
    ]]


def _guess_contact_type(value: str) -> str:
    v = value.strip().lower()
    if "@" in v and "." in v.split("@")[-1] and not v.startswith("@"):
        return "email"
    if v.startswith("@") or "t.me/" in v:
        return "telegram"
    if "wa.me" in v:
        return "whatsapp"
    if re.fullmatch(r"[+\d\s()-]{6,}", v):
        return "phone"
    return "other"


def _contact_create(ctx: Ctx, parent_id: int, text: str):
    value = text.strip()
    return BrandContact(advertiser_id=parent_id, contact_type=_guess_contact_type(value), value=value)


def _contact_change(ctx: Ctx, c: BrandContact, key: str, old, new) -> Optional[str]:
    if key == "is_primary" and new:
        ctx.db.query(BrandContact).filter(BrandContact.advertiser_id == c.advertiser_id, BrandContact.id != c.id).update({"is_primary": False})
    return None


# --- задачи ---

def _assignee_options(ctx: Ctx, t: Task) -> dict:
    rows = (
        ctx.db.query(WorkspaceMember, User)
        .join(User, User.tg_id == WorkspaceMember.user_tg_id)
        .filter(WorkspaceMember.workspace_id == t.workspace_id)
        .order_by(WorkspaceMember.joined_at.asc())
        .all()
    )
    return {str(u.tg_id): (u.label or u.tg_first_name or u.tg_username or str(u.tg_id)) for _, u in rows}


def _task_label(t: Task) -> str:
    mark = {"todo": "⬜", "doing": "🔄", "done": "✅"}.get(t.status, "⬜")
    due = f" · {t.due_at.strftime('%d.%m %H:%M')}" if t.due_at else ""
    return f"{mark} {t.title}{due}"


def _task_list(ctx: Ctx, parent_id: int):
    # сначала незакрытые, потом по сроку
    return (
        ctx.db.query(Task)
        .filter(Task.workspace_id == ctx.ws_id)
        .order_by((Task.status == "done").asc(), Task.due_at.asc().nullslast(), Task.created_at.desc())
    )


def _task_create(ctx: Ctx, parent_id: int, text: str):
    return Task(workspace_id=ctx.ws_id, title=text.strip(), created_by_tg_id=ctx.tg_id)


def _task_change(ctx: Ctx, t: Task, key: str, old, new) -> Optional[str]:
    if key == "due_at" and old != new:
        t.notified_deadline = False
    if key == "assignee_tg_id" and old != new:
        t.notified_assigned = False
    return None


# --- базы стримеров и блогеров ---

def _bp_list_extra(ctx: Ctx, parent_id: int) -> list:
    url = blogger_sheet.get_sheet_url(ctx.db)
    rows = [[{"text": "🔗 Ссылка на таблицу", "callback_data": "x:a:bsheet:0"}]]
    if url:
        rows[0].append({"text": "🔄 Подтянуть из таблицы", "callback_data": "x:a:bsync:0"})
    return rows


def _bp_header(ctx: Ctx, b: BloggerProfile) -> str:
    """Карточка блогера - строка его листа как в таблице (правится только там)."""
    try:
        cells = json.loads(b.sheet_row or "[]")
    except ValueError:
        cells = []
    lines = [f"{esc(c.get('h', ''))}: {esc(c.get('u') or c.get('v', ''))}" for c in cells if isinstance(c, dict)]
    lines.append("<i>Править блогеров можно только в гугл-таблице - CRM подтягивает её сама.</i>")
    return "\n".join(lines)


ENTITIES: dict[str, Entity] = {}


def _reg(e: Entity):
    ENTITIES[e.code] = e


_reg(Entity(
    code="deal", title="Сделка", plural="Сделки", model=Integration,
    fields=[
        F("kp_sheet_url", "Ссылка на КП (гугл-таблица)", "text"),
        F("description", "Описание", "text"),
    ],
    label=_deal_label,
    workspace_of=lambda db, o: o.workspace_id,
    list_query=_deal_list, search_attrs=("brand",),
    parent_code="adv", parent_of=lambda o: o.advertiser_id or 0,
    create_prompt="Название бренда/рекламодателя для новой сделки?",
    create_prompt_in_parent="Короткое описание новой сделки (например, «Осенняя кампания»)?",
    create=_deal_create,
    before_delete=_deal_before_delete, extra_buttons=_deal_extra, header=_deal_header,
    delete_hint="Удалятся все участники сделки, их договоры, оплаты и кейсы.",
))

_reg(Entity(
    code="card", title="Участник сделки", plural="Участники", model=IntegrationStreamer,
    fields=[],
    label=_card_label,
    workspace_of=_ws_of_streamer,
    list_query=_card_list, search_attrs=("streamer_name",),
    parent_code="deal", parent_of=lambda o: o.integration_id,
    before_delete=_card_before_delete,
    open_cb=lambda o: f"e:cat:{o.id}",
))

_reg(Entity(
    code="pay", title="Оплата", plural="Оплаты", model=IntegrationPayment,
    fields=[
        F("amount", "Сумма", "float", required=True),
        F("currency", "Валюта", "text"),
        F("comment", "Комментарий", "text"),
        F("paid_at", "Дата оплаты", "date", required=True),
    ],
    label=lambda p: f"{_money(p.amount)} {p.currency} · {p.paid_at.strftime('%d.%m.%Y')}",
    workspace_of=lambda db, o: _ws_of_streamer(db, db.get(IntegrationStreamer, o.streamer_id)),
    list_query=lambda ctx, pid: ctx.db.query(IntegrationPayment).filter(IntegrationPayment.streamer_id == pid).order_by(IntegrationPayment.paid_at.desc()),
    search_attrs=("comment",),
    parent_code="card", parent_of=lambda o: o.streamer_id,
    create_prompt="Сумма поступившей оплаты (число)?",
    create=_pay_create,
))

_reg(Entity(
    code="case", title="Кейс", plural="Кейсы", model=CaseStudy,
    fields=[
        F("title", "Заголовок", "text"),
        F("description", "Описание / задача", "text"),
        F("what_was_done", "Что сделано", "text"),
        F("result", "Результат", "text"),
    ],
    label=_case_label,
    workspace_of=lambda db, o: _ws_of_streamer(db, db.get(IntegrationStreamer, o.streamer_id)),
    list_query=_case_list, search_attrs=("title",),
    parent_code="card", parent_of=lambda o: o.streamer_id,
    create_prompt="Заголовок кейса (например название игры/бренда)?",
    create=lambda ctx, pid, text: CaseStudy(streamer_id=pid, title=text.strip()),
    header=_case_header, extra_buttons=_case_extra, before_delete=_case_before_delete,
))

_reg(Entity(
    code="brief", title="Файл ТЗ", plural="Файлы ТЗ", model=BriefFile,
    fields=[],
    label=lambda b: f"📎 {b.file_name}",
    workspace_of=lambda db, o: _ws_of_streamer(db, db.get(IntegrationStreamer, o.streamer_id)),
    list_query=lambda ctx, pid: ctx.db.query(BriefFile).filter(BriefFile.streamer_id == pid).order_by(BriefFile.created_at.desc()),
    search_attrs=("file_name",),
    parent_code="card", parent_of=lambda o: o.streamer_id,
    extra_buttons=_brief_extra, before_delete=_brief_before_delete, list_extra=_brief_list_extra,
))

_reg(Entity(
    code="adv", title="Рекламодатель", plural="Рекламодатели", model=Advertiser,
    fields=[
        F("name", "Название", "text", required=True),
        F("notes", "Заметки", "text"),
    ],
    label=lambda a: a.name,
    workspace_of=lambda db, o: o.workspace_id,
    list_query=lambda ctx, pid: ctx.db.query(Advertiser).filter(Advertiser.workspace_id == ctx.ws_id).order_by(Advertiser.updated_at.desc()),
    create_prompt="Название нового рекламодателя?",
    create=_adv_create, on_change=_adv_change, before_delete=_adv_before_delete, extra_buttons=_adv_extra,
))

_reg(Entity(
    code="contact", title="Контакт", plural="Контакты", model=BrandContact,
    fields=[
        F("value", "Контакт", "text", required=True),
        F("contact_type", "Тип", "enum", options=CONTACT_TYPE_LABELS),
        F("label", "Кто это (должность)", "text"),
        F("is_primary", "Основной", "bool"),
        F("notes", "Заметки", "text"),
    ],
    label=lambda c: f"{'⭐ ' if c.is_primary else ''}{c.value}" + (f" · {c.label}" if c.label else ""),
    workspace_of=lambda db, o: (db.get(Advertiser, o.advertiser_id).workspace_id if db.get(Advertiser, o.advertiser_id) else None),
    list_query=lambda ctx, pid: ctx.db.query(BrandContact).filter(BrandContact.advertiser_id == pid).order_by(BrandContact.is_primary.desc(), BrandContact.created_at.asc()),
    search_attrs=("value", "label"),
    parent_code="adv", parent_of=lambda o: o.advertiser_id,
    create_prompt="Контакт: @telegram, email или телефон?",
    create=_contact_create, on_change=_contact_change,
))

_reg(Entity(
    code="task", title="Задача", plural="Задачи", model=Task,
    fields=[
        F("title", "Название", "text", required=True),
        F("status", "Статус", "enum", options=TASK_STATUS_LABELS),
        F("due_at", "Срок", "datetime", nullable=True),
        F("assignee_tg_id", "Исполнитель", "enum", options=_assignee_options, nullable=True),
        F("description", "Описание", "text"),
    ],
    label=_task_label,
    workspace_of=lambda db, o: o.workspace_id,
    list_query=_task_list, search_attrs=("title",),
    create_prompt="Что нужно сделать? (название задачи)",
    create=_task_create, on_change=_task_change,
))

_reg(Entity(
    code="sp", title="Стример (база)", plural="База стримеров", model=StreamerProfile,
    fields=[
        F("name", "Имя", "text", required=True),
        F("twitch_url", "Ссылка на Twitch", "text"),
        F("category", "Категория", "text"),
        F("social_links", "Соц. сети", "text"),
        F("geo", "Гео", "text"),
        F("subscribers", "Подписчики", "int", nullable=True),
        F("avg_online", "Средний онлайн", "int", nullable=True),
        F("views_per_month", "Просмотров за месяц", "int", nullable=True),
        F("views_per_stream", "Просмотры за стрим", "int", nullable=True),
        F("telegram_subscribers", "Подписчики TG", "int", nullable=True),
        F("telegram_reach", "Охват TG", "int", nullable=True),
        F("post_price", "Стоимость поста", "float", nullable=True),
        F("special_stream_price", "Спецстрим", "float", nullable=True),
        F("voice_integration_price", "Голосовая интеграция", "float", nullable=True),
        F("branding_price_1w", "Брендинг 1 нед.", "float", nullable=True),
        F("branding_price_2w", "Брендинг 2 нед.", "float", nullable=True),
        F("branding_price_3w", "Брендинг 3 нед.", "float", nullable=True),
        F("branding_price_1m", "Брендинг 1 мес.", "float", nullable=True),
        F("knd_registry", "Реестр КНД", "text"),
        F("twitch_partner", "Твич партнёр", "bool"),
        F("stats_url", "Статистика (ссылка)", "text"),
        F("stats_updated_at", "Дата обновления статы", "date", nullable=True),
        F("manager", "Менеджер", "text"),
    ],
    label=lambda p: p.name + (f" · {p.category}" if p.category else ""),
    global_base=True, edit_roles=("admin", "editor"), delete_roles=("admin",),
    list_query=lambda ctx, pid: ctx.db.query(StreamerProfile).order_by(StreamerProfile.name.asc()),
    create_prompt="Имя стримера?",
    create=lambda ctx, pid, text: StreamerProfile(name=text.strip()),
))

_reg(Entity(
    code="bp", title="Блогер (база)", plural="База блогеров", model=BloggerProfile,
    fields=[],  # всё показываем строкой листа (_bp_header) - править можно только в таблице
    label=lambda b: b.name + (f" · {b.platform}" if b.platform else ""),
    global_base=True, readonly=True,
    list_query=lambda ctx, pid: ctx.db.query(BloggerProfile).order_by(BloggerProfile.platform.asc(), BloggerProfile.name.asc()),
    search_attrs=("name", "telegram", "platform"),
    list_extra=_bp_list_extra, header=_bp_header,
))


# ---------- общий код: доступ, отрисовка, ввод ----------

def _open_ctx(tg_id: int) -> Optional[Ctx]:
    db = SessionLocal()
    user = db.get(User, tg_id)
    if not user:
        db.close()
        return None
    return Ctx(db=db, tg_id=tg_id, user=user, ws_id=resolve_workspace_id(db, tg_id))


def _get_obj(ctx: Ctx, ent: Entity, obj_id: int):
    """Объект, если он есть и доступен юзеру (своё пространство / глобальная база)."""
    obj = ctx.db.get(ent.model, obj_id)
    if obj is None:
        return None
    if ent.global_base:
        return obj
    if ctx.ws_id is None or ent.workspace_of(ctx.db, obj) != ctx.ws_id:
        return None
    return obj


def _parent_ok(ctx: Ctx, ent: Entity, parent_id: int) -> bool:
    if not parent_id:
        return True
    parent_ent = ENTITIES.get(ent.parent_code or "")
    return parent_ent is not None and _get_obj(ctx, parent_ent, parent_id) is not None


def _can_edit(ctx: Ctx, ent: Entity) -> bool:
    if ent.readonly:
        return False
    return not ent.edit_roles or ctx.user.role in ent.edit_roles


# ссылку на таблицу блогеров и ручное обновление меняют те же роли, что и на сайте
SHEET_ROLES = ("admin", "editor")


def _can_delete(ctx: Ctx, ent: Entity) -> bool:
    if ent.delete_roles:
        return ctx.user.role in ent.delete_roles
    return _can_edit(ctx, ent)


def _options(ctx: Ctx, f: F, obj) -> dict:
    if f.kind == "bool":
        return BOOL_LABELS
    if callable(f.options):
        return f.options(ctx, obj)
    return f.options or {}


def _value_label(ctx: Ctx, f: F, obj) -> str:
    v = getattr(obj, f.key)
    if f.kind == "bool":
        return "Да" if v else "Нет"
    if v is None or v == "":
        return "—"
    if f.kind == "enum":
        return _options(ctx, f, obj).get(str(v), str(v))
    if isinstance(v, datetime):
        return v.strftime("%d.%m.%Y %H:%M") if f.kind == "datetime" else v.strftime("%d.%m.%Y")
    if f.kind in ("float", "int"):
        return _money(v)
    return str(v)


def _requires_ws(ctx: Ctx, ent: Entity) -> bool:
    return not ent.global_base and ctx.ws_id is None


async def _no_ws(tg_id: int):
    await send_message(tg_id, "У тебя нет доступа ни к одному пространству, обратись к админу.")


async def show_main_menu(tg_id: int):
    db = SessionLocal()
    try:
        ws_id = resolve_workspace_id(db, tg_id)
        ws = db.get(Workspace, ws_id) if ws_id else None
    finally:
        db.close()
    keyboard = [
        [{"text": "🤝 Сделки", "callback_data": "x:l:deal:0:0"}, {"text": "👥 Карточки", "callback_data": "x:l:card:0:0"}],
        [{"text": "🏢 Рекламодатели", "callback_data": "x:l:adv:0:0"}, {"text": "✅ Задачи", "callback_data": "x:l:task:0:0"}],
        [{"text": "🎬 Кейсы", "callback_data": "x:l:case:0:0"}],
        [{"text": "📋 База стримеров", "callback_data": "x:l:sp:0:0"}, {"text": "📱 База блогеров", "callback_data": "x:l:bp:0:0"}],
        [{"text": "🗂 Пространство", "callback_data": "x:a:wslist:0"}, {"text": "⚙️ Уведомления", "callback_data": "s:back"}],
    ]
    title = f"Пространство: <b>{esc(ws.title)}</b>" if ws else "Пространство не выбрано"
    await send_message(tg_id, f"📂 <b>Меню CRM</b>\n{title}\nЧто открываем?", inline_keyboard=keyboard)


async def show_list(tg_id: int, code: str, parent_id: int = 0, page: int = 0):
    ent = ENTITIES.get(code)
    ctx = _open_ctx(tg_id)
    if not ent or not ctx:
        return
    try:
        if _requires_ws(ctx, ent):
            await _no_ws(tg_id)
            return
        if not _parent_ok(ctx, ent, parent_id):
            await send_message(tg_id, "Не найдено (возможно, удалено).")
            return
        q = ent.list_query(ctx, parent_id)
        query = _search.get(tg_id, {}).get(code, "")
        rows = q.all()
        if query:
            ql = query.lower()
            rows = [r for r in rows if any(ql in str(getattr(r, a, "") or "").lower() for a in ent.search_attrs)]
        total = len(rows)
        page = max(0, min(page, (total - 1) // PAGE_SIZE if total else 0))
        chunk = rows[page * PAGE_SIZE:(page + 1) * PAGE_SIZE]

        keyboard = []
        if ent.list_extra and (_can_edit(ctx, ent) or (ent.readonly and ctx.user.role in SHEET_ROLES)):
            keyboard.extend(ent.list_extra(ctx, parent_id))
        for o in chunk:
            cb = ent.open_cb(o) if ent.open_cb else f"x:o:{code}:{o.id}"
            keyboard.append([{"text": ent.label(o)[:60], "callback_data": cb}])
        nav = []
        if page > 0:
            nav.append({"text": "◀️", "callback_data": f"x:l:{code}:{parent_id}:{page - 1}"})
        if (page + 1) * PAGE_SIZE < total:
            nav.append({"text": "▶️", "callback_data": f"x:l:{code}:{parent_id}:{page + 1}"})
        if nav:
            keyboard.append(nav)
        tools = []
        if ent.create and _can_edit(ctx, ent):
            tools.append({"text": "➕ Добавить", "callback_data": f"x:n:{code}:{parent_id}"})
        if code == "card" and parent_id:
            tools = [{"text": "➕ Добавить", "callback_data": f"x:a:addp:{parent_id}"}]
        if query:
            tools.append({"text": f"✖ Сбросить «{query[:12]}»", "callback_data": f"x:sc:{code}:{parent_id}"})
        elif total > PAGE_SIZE or ent.global_base:
            tools.append({"text": "🔎 Поиск", "callback_data": f"x:s:{code}:{parent_id}"})
        if tools:
            keyboard.append(tools)
        back = _list_back(ent, parent_id)
        keyboard.append([{"text": "⬅️ Назад", "callback_data": back}])

        heading = ent.plural
        if parent_id and ent.parent_code:
            parent = _get_obj(ctx, ENTITIES[ent.parent_code], parent_id)
            if parent is not None:
                heading += f" · {esc(ENTITIES[ent.parent_code].label(parent))}"
        text = f"<b>{heading}</b>" + (f" ({total})" if total else "\nПока пусто.")
        if code == "case" and not parent_id:
            text += "\nНовый кейс заводится из карточки участника (👥 Карточки → участник → 🎬 Кейсы)."
        await send_message(tg_id, text, inline_keyboard=keyboard)
    finally:
        ctx.db.close()


def _list_back(ent: Entity, parent_id: int) -> str:
    if parent_id and ent.parent_code:
        parent_ent = ENTITIES[ent.parent_code]
        if parent_ent.open_cb:
            return f"e:cat:{parent_id}"
        return f"x:o:{ent.parent_code}:{parent_id}"
    return "x:m"


async def show_card(tg_id: int, code: str, obj_id: int):
    ent = ENTITIES.get(code)
    ctx = _open_ctx(tg_id)
    if not ent or not ctx:
        return
    try:
        obj = _get_obj(ctx, ent, obj_id)
        if obj is None:
            await send_message(tg_id, "Не найдено (возможно, удалено).")
            return
        if ent.open_cb:
            await send_message(tg_id, ent.label(obj), inline_keyboard=[[{"text": "Открыть", "callback_data": ent.open_cb(obj)}]])
            return
        lines = [f"<b>{esc(ent.title)}: {esc(ent.label(obj))}</b>"]
        if ent.header:
            extra = ent.header(ctx, obj)
            if extra:
                lines.append(extra)
        editable = _can_edit(ctx, ent)
        for f in ent.fields:
            lines.append(f"{esc(f.label)}: {esc(_value_label(ctx, f, obj))}")
        keyboard = []
        if editable:
            btns = [{"text": f"✏️ {f.label}"[:40], "callback_data": f"x:f:{code}:{obj.id}:{i}"} for i, f in enumerate(ent.fields)]
            keyboard.extend(btns[i:i + 2] for i in range(0, len(btns), 2))
        if ent.extra_buttons:
            keyboard.extend(ent.extra_buttons(ctx, obj))
        if _can_delete(ctx, ent):
            keyboard.append([{"text": "🗑 Удалить", "callback_data": f"x:dq:{code}:{obj.id}"}])
        parent_id = ent.parent_of(obj) if ent.parent_of else 0
        keyboard.append([{"text": "⬅️ К списку", "callback_data": f"x:l:{code}:{parent_id}:0"}])
        await send_message(tg_id, "\n".join(lines), inline_keyboard=keyboard)
    finally:
        ctx.db.close()


async def _pick_field(tg_id: int, code: str, obj_id: int, fi: int, set_session: Callable[[dict], None]):
    ent = ENTITIES.get(code)
    ctx = _open_ctx(tg_id)
    if not ent or not ctx:
        return
    try:
        obj = _get_obj(ctx, ent, obj_id)
        if obj is None or not (0 <= fi < len(ent.fields)) or not _can_edit(ctx, ent):
            await send_message(tg_id, "Не найдено или нет прав.")
            return
        f = ent.fields[fi]
        if f.kind in ("enum", "bool"):
            opts = list(_options(ctx, f, obj).items())
            keyboard = [[{"text": lbl[:40], "callback_data": f"x:v:{code}:{obj_id}:{fi}:{i}"}] for i, (_, lbl) in enumerate(opts)]
            if f.nullable:
                keyboard.append([{"text": "🚫 Не задано", "callback_data": f"x:v:{code}:{obj_id}:{fi}:n"}])
            keyboard.append([{"text": "⬅️ Назад", "callback_data": f"x:o:{code}:{obj_id}"}])
            await send_message(tg_id, f"{esc(f.label)} - выбери значение:", inline_keyboard=keyboard)
            return
        set_session({"mode": "x_value", "code": code, "id": obj_id, "fi": fi})
        prompts = {
            "int": "Введи целое число.",
            "float": "Введи число (например 15000).",
            "date": "Введи дату ДД.ММ.ГГГГ.",
            "datetime": "Введи дату и время: ДД.ММ.ГГГГ ЧЧ:ММ (или только дату).",
            "time": "Введи время ЧЧ:ММ.",
            "text": "Введи новое значение.",
        }
        hint = prompts[f.kind]
        if not f.required:
            hint += " Или «нет», чтобы очистить."
        current = _value_label(ctx, f, obj)
        await send_message(tg_id, f"<b>{esc(f.label)}</b>\nСейчас: {esc(current)}\n{hint}")
    finally:
        ctx.db.close()


def parse_value(kind: str, raw: str):
    """Разбор текстового ввода; ValueError - не понял."""
    if kind == "int":
        return int(float(raw.replace(",", ".").replace(" ", "")))
    if kind == "float":
        return float(raw.replace(",", ".").replace(" ", ""))
    if kind == "date":
        return datetime.strptime(raw, "%d.%m.%Y")
    if kind == "datetime":
        for fmt in ("%d.%m.%Y %H:%M", "%d.%m.%Y"):
            try:
                return datetime.strptime(raw, fmt)
            except ValueError:
                pass
        raise ValueError(raw)
    if kind == "time":
        if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", raw):
            raise ValueError(raw)
        return raw
    return raw


async def _set_value(tg_id: int, code: str, obj_id: int, fi: int, value, *, is_clear: bool = False) -> Optional[str]:
    """Сохраняет значение. Возвращает текст ошибки (тогда ввод надо повторить) или None."""
    ent = ENTITIES.get(code)
    ctx = _open_ctx(tg_id)
    if not ent or not ctx:
        return None
    try:
        obj = _get_obj(ctx, ent, obj_id)
        if obj is None or not (0 <= fi < len(ent.fields)) or not _can_edit(ctx, ent):
            await send_message(tg_id, "Не найдено или нет прав.")
            return None
        f = ent.fields[fi]
        if is_clear:
            if f.required:
                return "Это поле обязательное, очистить нельзя."
            if f.nullable:
                value = None
            elif f.kind == "text":
                value = ""
            else:
                return "Это поле нельзя очистить, введи значение."
        if f.required and isinstance(value, str) and not value.strip():
            return "Значение не может быть пустым."
        if isinstance(value, str):
            value = value.strip()
        old = getattr(obj, f.key)
        if ent.on_change:
            err = ent.on_change(ctx, obj, f.key, old, value)
            if err:
                ctx.db.rollback()
                await send_message(tg_id, err)
                return None
        setattr(obj, f.key, value)
        ctx.db.commit()
    finally:
        ctx.db.close()
    await send_message(tg_id, "✅ Обновлено")
    await show_card(tg_id, code, obj_id)
    return None


async def _apply_option(tg_id: int, code: str, obj_id: int, fi: int, oi: str):
    ent = ENTITIES.get(code)
    ctx = _open_ctx(tg_id)
    if not ent or not ctx:
        return
    try:
        obj = _get_obj(ctx, ent, obj_id)
        if obj is None or not (0 <= fi < len(ent.fields)):
            await send_message(tg_id, "Не найдено.")
            return
        f = ent.fields[fi]
        if oi == "n":
            value = None
        else:
            opts = list(_options(ctx, f, obj).keys())
            idx = int(oi)
            if not (0 <= idx < len(opts)):
                return
            value = opts[idx]
            if f.kind == "bool":
                value = value == "1"
            elif f.key.endswith("_tg_id"):
                value = int(value)
    finally:
        ctx.db.close()
    await _set_value(tg_id, code, obj_id, fi, value)


async def _start_create(tg_id: int, code: str, parent_id: int, set_session: Callable[[dict], None]):
    ent = ENTITIES.get(code)
    ctx = _open_ctx(tg_id)
    if not ent or not ctx or not ent.create:
        return
    try:
        if _requires_ws(ctx, ent):
            await _no_ws(tg_id)
            return
        if not _can_edit(ctx, ent):
            await send_message(tg_id, "Нет прав на добавление.")
            return
        if ent.parent_code and ent.parent_code != "adv" and not parent_id:
            await send_message(tg_id, f"{ent.title} добавляется из карточки участника сделки.")
            return
        if not _parent_ok(ctx, ent, parent_id):
            await send_message(tg_id, "Не найдено (возможно, удалено).")
            return
    finally:
        ctx.db.close()
    set_session({"mode": "x_create", "code": code, "parent": parent_id})
    prompt = ent.create_prompt_in_parent if parent_id and ent.create_prompt_in_parent else ent.create_prompt
    await send_message(tg_id, prompt + "\n(/cancel - отменить)")


async def _finish_create(tg_id: int, code: str, parent_id: int, text: str) -> Optional[str]:
    ent = ENTITIES.get(code)
    ctx = _open_ctx(tg_id)
    if not ent or not ctx:
        return None
    try:
        if not text.strip():
            return "Пустое значение, попробуй ещё раз."
        if not _parent_ok(ctx, ent, parent_id):
            await send_message(tg_id, "Не найдено (возможно, удалено).")
            return None
        obj = ent.create(ctx, parent_id, text)
        if isinstance(obj, str):
            return obj
        ctx.db.add(obj)
        ctx.db.commit()
        new_id = obj.id
    finally:
        ctx.db.close()
    await send_message(tg_id, "✅ Добавлено")
    await show_card(tg_id, code, new_id)
    return None


async def _ask_delete(tg_id: int, code: str, obj_id: int):
    ent = ENTITIES.get(code)
    ctx = _open_ctx(tg_id)
    if not ent or not ctx:
        return
    try:
        obj = _get_obj(ctx, ent, obj_id)
        if obj is None or not _can_delete(ctx, ent):
            await send_message(tg_id, "Не найдено или нет прав на удаление.")
            return
        back = ent.open_cb(obj) if ent.open_cb else f"x:o:{code}:{obj_id}"
        text = f"Удалить «{esc(ent.label(obj))}»?"
        if ent.delete_hint:
            text += f"\n{ent.delete_hint}"
        await send_message(tg_id, text, inline_keyboard=[[
            {"text": "🗑 Да, удалить", "callback_data": f"x:dd:{code}:{obj_id}"},
            {"text": "Отмена", "callback_data": back},
        ]])
    finally:
        ctx.db.close()


async def _do_delete(tg_id: int, code: str, obj_id: int):
    ent = ENTITIES.get(code)
    ctx = _open_ctx(tg_id)
    if not ent or not ctx:
        return
    try:
        obj = _get_obj(ctx, ent, obj_id)
        if obj is None or not _can_delete(ctx, ent):
            await send_message(tg_id, "Не найдено или нет прав на удаление.")
            return
        parent_id = ent.parent_of(obj) if ent.parent_of else 0
        if ent.before_delete:
            err = ent.before_delete(ctx, obj)
            if err:
                ctx.db.rollback()
                await send_message(tg_id, err)
                return
        ctx.db.delete(obj)
        ctx.db.commit()
    finally:
        ctx.db.close()
    await send_message(tg_id, "🗑 Удалено")
    await show_list(tg_id, code, parent_id if ent.parent_code else 0)


# ---------- особые действия ----------

async def show_workspaces(tg_id: int):
    db = SessionLocal()
    try:
        current = resolve_workspace_id(db, tg_id)
        rows = (
            db.query(WorkspaceMember, Workspace)
            .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
            .filter(WorkspaceMember.user_tg_id == tg_id)
            .order_by(WorkspaceMember.joined_at.asc())
            .all()
        )
        if not rows:
            await _no_ws(tg_id)
            return
        keyboard = [
            [{"text": ("✅ " if ws.id == current else "") + ws.title[:50], "callback_data": f"x:ws:{ws.id}"}]
            for _, ws in rows
        ]
        keyboard.append([{"text": "⬅️ Меню", "callback_data": "x:m"}])
        await send_message(tg_id, "С каким пространством работает бот?", inline_keyboard=keyboard)
    finally:
        db.close()


async def _set_workspace(tg_id: int, ws_id: int):
    db = SessionLocal()
    try:
        member = db.query(WorkspaceMember).filter_by(workspace_id=ws_id, user_tg_id=tg_id).first()
        u = db.get(User, tg_id)
        if not member or not u:
            await send_message(tg_id, "Нет доступа к этому пространству.")
            return
        u.bot_workspace_id = ws_id
        db.commit()
    finally:
        db.close()
    await send_message(tg_id, "✅ Пространство переключено")
    await show_main_menu(tg_id)


async def _send_file(tg_id: int, path: Optional[str], name: Optional[str]):
    if not path or not os.path.exists(path):
        await send_message(tg_id, "Файл не найден на сервере.")
        return
    if not await notifier.send_document(tg_id, path, name or os.path.basename(path)):
        await send_message(tg_id, "Не получилось отправить файл.")


async def _action(tg_id: int, action: str, obj_id: int, set_session: Callable[[dict], None]):
    ctx = _open_ctx(tg_id)
    if not ctx:
        return
    try:
        if action == "wslist":
            pass
        elif action == "addp":
            it = _get_obj(ctx, ENTITIES["deal"], obj_id)
            if it is None:
                await send_message(tg_id, "Сделка не найдена.")
                return
            brand = it.brand
        elif action in ("cphoto", "cphotoget"):
            c = _get_obj(ctx, ENTITIES["case"], obj_id)
            if c is None:
                await send_message(tg_id, "Кейс не найден.")
                return
            photo = (c.photo_path, c.photo_name)
        elif action == "bget":
            bf = _get_obj(ctx, ENTITIES["brief"], obj_id)
            if bf is None:
                await send_message(tg_id, "Файл не найден.")
                return
            photo = (bf.file_path, bf.file_name)
        elif action == "bup":
            if _get_obj(ctx, ENTITIES["card"], obj_id) is None:
                await send_message(tg_id, "Карточка не найдена.")
                return
        elif action == "cget":
            s = _get_obj(ctx, ENTITIES["card"], obj_id)
            if s is None:
                await send_message(tg_id, "Карточка не найдена.")
                return
            photo = (s.contract_file_path, s.contract_file_name)
        elif action in ("bsheet", "bsync"):
            if ctx.user.role not in SHEET_ROLES:
                await send_message(tg_id, "Нет прав менять ссылку на таблицу блогеров.")
                return
            sheet_url = blogger_sheet.get_sheet_url(ctx.db)
        else:
            return
    finally:
        ctx.db.close()

    if action == "wslist":
        await show_workspaces(tg_id)
    elif action == "addp":
        import bot_dialog  # циклический импорт: мастер создания живёт в bot_dialog
        await bot_dialog.start_add_participant(tg_id, obj_id, brand)
    elif action == "cphoto":
        set_session({"mode": "x_file", "kind": "case_photo", "id": obj_id})
        await send_message(tg_id, "Пришли фото для кейса (можно картинкой или файлом).")
    elif action in ("cphotoget", "bget", "cget"):
        await _send_file(tg_id, *photo)
    elif action == "bup":
        set_session({"mode": "x_file", "kind": "brief", "id": obj_id})
        await send_message(tg_id, "Пришли файл ТЗ документом (📎). До 25 МБ.")
    elif action == "bsheet":
        set_session({"mode": "x_sheet_url"})
        current = f"Сейчас: {esc(sheet_url)}\n" if sheet_url else ""
        await send_message(tg_id, f"{current}Пришли ссылку на гугл-таблицу с блогерами (или «нет», чтобы убрать).")
    elif action == "bsync":
        await _sync_bloggers(tg_id)


async def _sync_bloggers(tg_id: int):
    await send_message(tg_id, "🔄 Подтягиваю таблицу блогеров…")
    db = SessionLocal()
    try:
        result = await blogger_sheet.sync_from_sheet(db)
        text = f"✅ Готово: новых {result['created']}, обновлено {result['updated']}"
    except blogger_sheet.SheetImportError as e:
        text = f"⚠️ {e}"
    except Exception:
        log.exception("Синхронизация таблицы блогеров из бота")
        text = "⚠️ Не получилось подтянуть таблицу."
    finally:
        db.close()
    await send_message(tg_id, text)
    await show_list(tg_id, "bp")


async def _save_sheet_url(tg_id: int, raw: str) -> Optional[str]:
    url = "" if raw.strip().lower() in ("нет", "-", "no") else raw.strip()
    if url:
        try:
            blogger_sheet.export_url(url)
        except blogger_sheet.SheetImportError as e:
            return str(e)
    db = SessionLocal()
    try:
        blogger_sheet.set_sheet_url(db, url)
    finally:
        db.close()
    await send_message(tg_id, "✅ Ссылка сохранена" if url else "Ссылка убрана")
    await show_list(tg_id, "bp")
    return None


async def save_file(tg_id: int, kind: str, obj_id: int, content: bytes, file_name: str):
    """Сохраняет присланный файл: фото кейса или файл ТЗ."""
    ctx = _open_ctx(tg_id)
    if not ctx:
        return
    try:
        ext = os.path.splitext(file_name)[1][:16]
        if kind == "case_photo":
            c = _get_obj(ctx, ENTITIES["case"], obj_id)
            if c is None:
                await send_message(tg_id, "Кейс не найден.")
                return
            os.makedirs(CASE_PHOTO_DIR, exist_ok=True)
            dest = os.path.join(CASE_PHOTO_DIR, f"{uuid.uuid4().hex}{ext}")
            with open(dest, "wb") as f:
                f.write(content)
            _remove_file(c.photo_path)
            c.photo_path, c.photo_name = dest, file_name
            ctx.db.commit()
            reply, code = "✅ Фото кейса загружено", "case"
        elif kind == "brief":
            s = _get_obj(ctx, ENTITIES["card"], obj_id)
            if s is None:
                await send_message(tg_id, "Карточка не найдена.")
                return
            if len(content) > MAX_BRIEF_FILE_BYTES:
                await send_message(tg_id, "Файл больше 25 МБ - загрузи его через сайт или дай ссылку в ТЗ.")
                return
            os.makedirs(BRIEF_DIR, exist_ok=True)
            dest = os.path.join(BRIEF_DIR, f"{uuid.uuid4().hex}{ext}")
            with open(dest, "wb") as f:
                f.write(content)
            ctx.db.add(BriefFile(streamer_id=s.id, file_path=dest, file_name=file_name, size_bytes=len(content)))
            ctx.db.commit()
            reply, code = f"✅ Файл ТЗ загружен: {esc(file_name)}", "brief"
        else:
            return
    finally:
        ctx.db.close()
    await send_message(tg_id, reply)
    if code == "case":
        await show_card(tg_id, "case", obj_id)
    else:
        await show_list(tg_id, "brief", obj_id)


# ---------- вход из bot_dialog ----------

async def handle_callback(tg_id: int, parts: list, set_session: Callable[[dict], None]) -> bool:
    action = parts[1] if len(parts) > 1 else ""
    try:
        if action == "m":
            await show_main_menu(tg_id)
        elif action == "l":
            await show_list(tg_id, parts[2], int(parts[3]), int(parts[4]))
        elif action == "o":
            await show_card(tg_id, parts[2], int(parts[3]))
        elif action == "f":
            await _pick_field(tg_id, parts[2], int(parts[3]), int(parts[4]), set_session)
        elif action == "v":
            await _apply_option(tg_id, parts[2], int(parts[3]), int(parts[4]), parts[5])
        elif action == "n":
            await _start_create(tg_id, parts[2], int(parts[3]), set_session)
        elif action == "s":
            set_session({"mode": "x_search", "code": parts[2], "parent": int(parts[3])})
            await send_message(tg_id, "Что ищем? Напиши часть названия/имени.")
        elif action == "sc":
            _search.get(tg_id, {}).pop(parts[2], None)
            await show_list(tg_id, parts[2], int(parts[3]))
        elif action == "dq":
            await _ask_delete(tg_id, parts[2], int(parts[3]))
        elif action == "dd":
            await _do_delete(tg_id, parts[2], int(parts[3]))
        elif action == "a":
            await _action(tg_id, parts[2], int(parts[3]), set_session)
        elif action == "ws":
            await _set_workspace(tg_id, int(parts[2]))
        else:
            return False
    except (IndexError, ValueError):
        log.exception("Некорректный callback_data: %s", parts)
        return False
    return True


async def handle_text(tg_id: int, session: dict, text: str) -> bool:
    """Текстовый ввод в режимах редактора. Возвращает True, если сессию можно закрыть."""
    mode = session.get("mode")
    raw = text.strip()
    if mode == "x_value":
        ent = ENTITIES.get(session["code"])
        if not ent or not (0 <= session["fi"] < len(ent.fields)):
            return True
        f = ent.fields[session["fi"]]
        if raw.lower() in ("нет", "-", "no"):
            err = await _set_value(tg_id, session["code"], session["id"], session["fi"], None, is_clear=True)
        else:
            try:
                value = parse_value(f.kind, raw)
            except ValueError:
                await send_message(tg_id, "Не понял значение, попробуй ещё раз (или /cancel).")
                return False
            err = await _set_value(tg_id, session["code"], session["id"], session["fi"], value)
        if err:
            await send_message(tg_id, err + " Попробуй ещё раз (или /cancel).")
            return False
        return True
    if mode == "x_create":
        err = await _finish_create(tg_id, session["code"], session["parent"], raw)
        if err:
            await send_message(tg_id, err + " Попробуй ещё раз (или /cancel).")
            return False
        return True
    if mode == "x_search":
        _search.setdefault(tg_id, {})[session["code"]] = raw
        await show_list(tg_id, session["code"], session["parent"])
        return True
    if mode == "x_sheet_url":
        err = await _save_sheet_url(tg_id, raw)
        if err:
            await send_message(tg_id, err + " Попробуй ещё раз (или /cancel).")
            return False
        return True
    if mode == "x_file":
        await send_message(tg_id, "Жду файл (📎) или фото, не текст. /cancel - отменить.")
        return False
    return True
