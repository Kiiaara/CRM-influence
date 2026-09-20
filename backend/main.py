from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from datetime import datetime

from config import settings
from database import engine, Base, SessionLocal
import models  # регистрирует все ORM-классы
from models.workspace import Workspace, WorkspaceMember
from models.user import User
from models.advertiser import Advertiser
from models.integration import Integration
from routers import auth as auth_router
from routers import search, tasks, users, integrations, streamer_profiles, workspaces as workspaces_router, advertisers as advertisers_router
from scheduler import start_scheduler, stop_scheduler


def _migrate_users_add_pinned():
    """Добавляем колонку pinned_pages в users если её нет."""
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    if "users" not in insp.get_table_names():
        return
    cols = [c["name"] for c in insp.get_columns("users")]
    if "pinned_pages" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN pinned_pages VARCHAR(2048) DEFAULT '[]'"))


def _migrate_users_add_vk_id():
    """Добавляем колонку vk_id в users если её нет."""
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    if "users" not in insp.get_table_names():
        return
    cols = [c["name"] for c in insp.get_columns("users")]
    if "vk_id" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN vk_id BIGINT"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_vk_id ON users (vk_id)"))


def _migrate_users_add_notification_settings():
    """Добавляем настройки бот-уведомлений (интервал сводки, тихие часы) в users, если их нет."""
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    if "users" not in insp.get_table_names():
        return
    cols = [c["name"] for c in insp.get_columns("users")]
    with engine.begin() as conn:
        if "notify_hot_tasks" not in cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN notify_hot_tasks BOOLEAN DEFAULT 1"))
        if "notify_interval_hours" not in cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN notify_interval_hours INTEGER DEFAULT 4"))
        if "quiet_hours_start" not in cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN quiet_hours_start INTEGER DEFAULT 22"))
        if "quiet_hours_end" not in cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN quiet_hours_end INTEGER DEFAULT 8"))
        if "last_hot_tasks_notified_at" not in cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN last_hot_tasks_notified_at DATETIME"))


def _migrate_streamers_add_content_status():
    """Добавляем колонку content_status в integration_streamers если её нет."""
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    if "integration_streamers" not in insp.get_table_names():
        return
    cols = [c["name"] for c in insp.get_columns("integration_streamers")]
    if "content_status" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE integration_streamers ADD COLUMN content_status VARCHAR(32)"))


def _migrate_streamers_add_contract_valid_until():
    """Добавляем колонку contract_valid_until в integration_streamers если её нет."""
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    if "integration_streamers" not in insp.get_table_names():
        return
    cols = [c["name"] for c in insp.get_columns("integration_streamers")]
    if "contract_valid_until" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE integration_streamers ADD COLUMN contract_valid_until DATETIME"))


def _migrate_workspaces_add_owner():
    """Добавляем owner_tg_id и updated_at в workspaces если их нет."""
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    if "workspaces" not in insp.get_table_names():
        return
    cols = [c["name"] for c in insp.get_columns("workspaces")]
    with engine.begin() as conn:
        if "owner_tg_id" not in cols:
            conn.execute(text("ALTER TABLE workspaces ADD COLUMN owner_tg_id BIGINT"))
        if "updated_at" not in cols:
            conn.execute(text("ALTER TABLE workspaces ADD COLUMN updated_at DATETIME"))


def _backfill_workspace_owners_and_members():
    """Для существующих workspace без owner_tg_id проставляем первого админа
    и создаём workspace_members на основе уже существующих юзеров."""
    db = SessionLocal()
    try:
        first_admin = (
            db.query(User).filter(User.role == "admin").order_by(User.created_at).first()
        )
        if not first_admin:
            return
        workspaces_to_fix = db.query(Workspace).filter(Workspace.owner_tg_id.is_(None)).all()
        all_users = db.query(User).all()
        for ws in workspaces_to_fix:
            ws.owner_tg_id = first_admin.tg_id
            ws.updated_at = ws.updated_at or datetime.now()
            for u in all_users:
                exists = (
                    db.query(WorkspaceMember)
                    .filter_by(workspace_id=ws.id, user_tg_id=u.tg_id)
                    .first()
                )
                if exists:
                    continue
                if u.tg_id == first_admin.tg_id:
                    role = "owner"
                elif u.role == "editor":
                    role = "lead"
                else:
                    role = "viewer"
                db.add(
                    WorkspaceMember(
                        workspace_id=ws.id,
                        user_tg_id=u.tg_id,
                        role=role,
                        joined_at=datetime.now(),
                    )
                )
        db.commit()
    finally:
        db.close()


def _migrate_streamers_add_integration_date():
    """Добавляем колонку integration_date и флаги напоминаний бота, если их нет."""
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    if "integration_streamers" not in insp.get_table_names():
        return
    cols = [c["name"] for c in insp.get_columns("integration_streamers")]
    with engine.begin() as conn:
        if "integration_date" not in cols:
            conn.execute(text("ALTER TABLE integration_streamers ADD COLUMN integration_date DATETIME"))
        if "notified_branding_check" not in cols:
            conn.execute(text("ALTER TABLE integration_streamers ADD COLUMN notified_branding_check BOOLEAN DEFAULT 0"))
        if "notified_screenshot" not in cols:
            conn.execute(text("ALTER TABLE integration_streamers ADD COLUMN notified_screenshot BOOLEAN DEFAULT 0"))
        if "notified_report" not in cols:
            conn.execute(text("ALTER TABLE integration_streamers ADD COLUMN notified_report BOOLEAN DEFAULT 0"))


def _migrate_streamers_add_ord_marking():
    """Добавляем колонки маркировки рекламы (ОРД), если их нет."""
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    if "integration_streamers" not in insp.get_table_names():
        return
    cols = [c["name"] for c in insp.get_columns("integration_streamers")]
    with engine.begin() as conn:
        if "ord_responsible" not in cols:
            conn.execute(text("ALTER TABLE integration_streamers ADD COLUMN ord_responsible VARCHAR(16) DEFAULT 'us'"))
        if "ord_status" not in cols:
            conn.execute(text("ALTER TABLE integration_streamers ADD COLUMN ord_status VARCHAR(16) DEFAULT 'todo'"))
        if "ord_reporting_status" not in cols:
            conn.execute(text("ALTER TABLE integration_streamers ADD COLUMN ord_reporting_status VARCHAR(16) DEFAULT 'not_submitted'"))


def _migrate_streamers_add_contract_status():
    """Добавляем колонки статуса договора и ТЗ, если их нет."""
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    if "integration_streamers" not in insp.get_table_names():
        return
    cols = [c["name"] for c in insp.get_columns("integration_streamers")]
    with engine.begin() as conn:
        if "contract_status" not in cols:
            conn.execute(text("ALTER TABLE integration_streamers ADD COLUMN contract_status VARCHAR(24) DEFAULT 'not_sent'"))
        if "contract_sent_date" not in cols:
            conn.execute(text("ALTER TABLE integration_streamers ADD COLUMN contract_sent_date DATETIME"))
        if "contract_signed_date" not in cols:
            conn.execute(text("ALTER TABLE integration_streamers ADD COLUMN contract_signed_date DATETIME"))
        if "contract_notes" not in cols:
            conn.execute(text("ALTER TABLE integration_streamers ADD COLUMN contract_notes TEXT DEFAULT ''"))
        if "brief" not in cols:
            conn.execute(text("ALTER TABLE integration_streamers ADD COLUMN brief TEXT DEFAULT ''"))


def _migrate_streamers_add_time_and_creator():
    """Добавляем точное время старта стрима, флаг напоминания о старте и создателя карточки, если их нет."""
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    if "integration_streamers" not in insp.get_table_names():
        return
    cols = [c["name"] for c in insp.get_columns("integration_streamers")]
    with engine.begin() as conn:
        if "integration_time" not in cols:
            conn.execute(text("ALTER TABLE integration_streamers ADD COLUMN integration_time VARCHAR(5)"))
        if "notified_stream_start" not in cols:
            conn.execute(text("ALTER TABLE integration_streamers ADD COLUMN notified_stream_start BOOLEAN DEFAULT 0"))
        if "created_by_tg_id" not in cols:
            conn.execute(text("ALTER TABLE integration_streamers ADD COLUMN created_by_tg_id BIGINT"))


def _migrate_streamers_add_case_reminder():
    """Добавляем флаг разового напоминания «добавь кейс» при завершении сделки, если его нет."""
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    if "integration_streamers" not in insp.get_table_names():
        return
    cols = [c["name"] for c in insp.get_columns("integration_streamers")]
    if "notified_case_reminder" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE integration_streamers ADD COLUMN notified_case_reminder BOOLEAN DEFAULT 0"))


def _migrate_integrations_add_advertiser():
    """Добавляем advertiser_id в integrations, если его нет."""
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    if "integrations" not in insp.get_table_names():
        return
    cols = [c["name"] for c in insp.get_columns("integrations")]
    if "advertiser_id" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE integrations ADD COLUMN advertiser_id INTEGER"))


def _migrate_brand_contacts_add_advertiser():
    """Добавляем advertiser_id в brand_contacts, если его нет (было integration_id)."""
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    if "brand_contacts" not in insp.get_table_names():
        return
    cols = [c["name"] for c in insp.get_columns("brand_contacts")]
    if "advertiser_id" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE brand_contacts ADD COLUMN advertiser_id INTEGER"))


def _migrate_brand_contacts_drop_integration_not_null():
    """Старая схема brand_contacts требовала integration_id NOT NULL - после
    перехода на advertiser_id это ломает вставку новых контактов
    (IntegrityError: NOT NULL constraint failed: brand_contacts.integration_id).
    SQLite не умеет менять constraint через ALTER - пересоздаём таблицу."""
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    if "brand_contacts" not in insp.get_table_names():
        return
    cols = {c["name"]: c for c in insp.get_columns("brand_contacts")}
    if "integration_id" not in cols:
        return  # уже новая схема
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE brand_contacts_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                advertiser_id INTEGER REFERENCES advertisers(id) ON DELETE CASCADE,
                contact_type VARCHAR(16) NOT NULL,
                value VARCHAR(255) NOT NULL,
                label VARCHAR(128) DEFAULT '',
                is_primary BOOLEAN DEFAULT 0,
                notes TEXT DEFAULT '',
                created_at DATETIME,
                updated_at DATETIME
            )
        """))
        conn.execute(text("""
            INSERT INTO brand_contacts_new
                (id, advertiser_id, contact_type, value, label, is_primary, notes, created_at, updated_at)
            SELECT id, advertiser_id, contact_type, value, label, is_primary, notes, created_at, updated_at
            FROM brand_contacts
            WHERE advertiser_id IS NOT NULL
        """))
        conn.execute(text("DROP TABLE brand_contacts"))
        conn.execute(text("ALTER TABLE brand_contacts_new RENAME TO brand_contacts"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_brand_contacts_advertiser_id ON brand_contacts (advertiser_id)"))


def _backfill_advertisers():
    """Создаём Advertiser по уникальным brand внутри каждого workspace,
    линкуем к ним существующие интеграции и переносим контакты бренда
    с integration_id на advertiser_id."""
    from sqlalchemy import text, inspect

    db = SessionLocal()
    try:
        rows = db.execute(
            text("SELECT DISTINCT workspace_id, brand FROM integrations WHERE advertiser_id IS NULL")
        ).fetchall()
        for workspace_id, brand in rows:
            adv = db.query(Advertiser).filter_by(workspace_id=workspace_id, name=brand).first()
            if not adv:
                adv = Advertiser(workspace_id=workspace_id, name=brand)
                db.add(adv)
                db.commit()
                db.refresh(adv)
            db.execute(
                text(
                    "UPDATE integrations SET advertiser_id = :aid "
                    "WHERE workspace_id = :wid AND brand = :brand AND advertiser_id IS NULL"
                ),
                {"aid": adv.id, "wid": workspace_id, "brand": brand},
            )
            db.commit()

        # старые контакты (если есть) были привязаны к integration_id - подтягиваем advertiser_id через сделку
        insp_cols = [c["name"] for c in inspect(engine).get_columns("brand_contacts")]
        if "integration_id" in insp_cols:
            db.execute(
                text(
                    "UPDATE brand_contacts SET advertiser_id = ("
                    "  SELECT advertiser_id FROM integrations WHERE integrations.id = brand_contacts.integration_id"
                    ") WHERE advertiser_id IS NULL"
                )
            )
            db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    _migrate_users_add_pinned()
    _migrate_users_add_vk_id()
    _migrate_users_add_notification_settings()
    _migrate_streamers_add_content_status()
    _migrate_streamers_add_contract_valid_until()
    _migrate_streamers_add_integration_date()
    _migrate_streamers_add_ord_marking()
    _migrate_streamers_add_contract_status()
    _migrate_streamers_add_time_and_creator()
    _migrate_streamers_add_case_reminder()
    _migrate_integrations_add_advertiser()
    _migrate_brand_contacts_add_advertiser()
    _backfill_advertisers()
    _migrate_brand_contacts_drop_integration_not_null()
    _migrate_workspaces_add_owner()
    auth_router.bootstrap_initial_admins()
    # гарантируем что есть хотя бы одно пространство
    db = SessionLocal()
    try:
        if not db.query(Workspace).first():
            first_admin = db.query(User).filter(User.role == "admin").order_by(User.created_at).first()
            ws = Workspace(title="Главное пространство", owner_tg_id=first_admin.tg_id if first_admin else None)
            db.add(ws)
            db.commit()
            db.refresh(ws)
            if first_admin:
                db.add(WorkspaceMember(workspace_id=ws.id, user_tg_id=first_admin.tg_id, role="owner", joined_at=datetime.now()))
                db.commit()
    finally:
        db.close()
    _backfill_workspace_owners_and_members()
    if settings.auth_bot_token:
        from notifier import set_my_commands
        await set_my_commands()
        start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="CRM-influence", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


PUBLIC_PATHS = {
    "/api/health",
    "/api/auth/config",
    "/api/auth/telegram",
    "/api/auth/vk",
    "/api/auth/me",
    "/api/auth/logout",
}


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if settings.dev_auth_bypass:
        return await call_next(request)
    if not path.startswith("/api/") or path in PUBLIC_PATHS:
        return await call_next(request)
    from deps import SESSION_COOKIE
    if not request.cookies.get(SESSION_COOKIE):
        return JSONResponse({"detail": "Не авторизован"}, status_code=401)
    return await call_next(request)


@app.get("/api/health")
def health():
    return {"ok": True}


app.include_router(auth_router.router)
app.include_router(search.router)
app.include_router(tasks.router)
app.include_router(users.router)
app.include_router(integrations.router)
app.include_router(streamer_profiles.router)
app.include_router(workspaces_router.router)
app.include_router(advertisers_router.router)
