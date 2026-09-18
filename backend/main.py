from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import settings
from database import engine, Base, SessionLocal
import models  # регистрирует все ORM-классы
from models.workspace import Workspace
from routers import auth as auth_router
from routers import search, tasks, users, integrations
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    _migrate_users_add_pinned()
    auth_router.bootstrap_initial_admins()
    # гарантируем что есть хотя бы одно пространство
    db = SessionLocal()
    try:
        if not db.query(Workspace).first():
            db.add(Workspace(title="Главное пространство"))
            db.commit()
    finally:
        db.close()
    if settings.auth_bot_token:
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
