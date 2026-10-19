"""Коэффициент маржи пространства (margin_divisor): блогеру = клиентская сумма / коэффициент.
Хранится на уровне Workspace, правит только владелец пространства."""
import os
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text

import main
from database import Base, SessionLocal, engine
from models.auth_session import AuthSession
from models.user import User
from models.workspace import Workspace, WorkspaceMember

# 112xxx - диапазон этого файла, токены mg-
OWNER = 112001
LEAD = 112002
VIEWER = 112003


@pytest.fixture(scope="module")
def ctx():
    # таблицы нужны до первого запроса, как в test_streamer_detail.py
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.add_all([
        User(tg_id=OWNER, role="admin", label="Владелец"),
        User(tg_id=LEAD, role="editor", label="Руководитель"),
        User(tg_id=VIEWER, role="viewer", label="Наблюдатель"),
    ])
    db.commit()
    ws = Workspace(title="Маржа", owner_tg_id=OWNER)
    db.add(ws)
    db.commit()
    now = datetime.now()
    db.add_all([
        WorkspaceMember(workspace_id=ws.id, user_tg_id=OWNER, role="owner", joined_at=now),
        WorkspaceMember(workspace_id=ws.id, user_tg_id=LEAD, role="lead", joined_at=now),
        WorkspaceMember(workspace_id=ws.id, user_tg_id=VIEWER, role="viewer", joined_at=now),
        AuthSession(token="mg-owner", tg_id=OWNER, expires_at=now + timedelta(days=1)),
        AuthSession(token="mg-lead", tg_id=LEAD, expires_at=now + timedelta(days=1)),
        AuthSession(token="mg-viewer", tg_id=VIEWER, expires_at=now + timedelta(days=1)),
    ])
    db.commit()
    ws_id = ws.id
    db.close()
    with TestClient(main.app) as client:
        yield client, ws_id


def _as(client, token: str):
    client.cookies.set("zametochnitsa_session", token)


def _mine(client, ws_id: int) -> dict:
    return next(w for w in client.get("/api/workspaces").json() if w["id"] == ws_id)


def test_default_divisor_for_new_workspace(ctx):
    """Новое пространство получает 1.375 без явной установки."""
    client, ws_id = ctx
    _as(client, "mg-owner")
    assert _mine(client, ws_id)["margin_divisor"] == pytest.approx(1.375)


def test_divisor_in_create_response(ctx):
    client, _ = ctx
    _as(client, "mg-owner")
    r = client.post("/api/workspaces", json={"title": "Новое для маржи"})
    assert r.status_code == 201, r.text
    assert r.json()["margin_divisor"] == pytest.approx(1.375)


def test_owner_can_change_divisor(ctx):
    client, ws_id = ctx
    _as(client, "mg-owner")
    r = client.put(f"/api/workspaces/{ws_id}", json={"margin_divisor": 1.5})
    assert r.status_code == 200, r.text
    assert r.json()["margin_divisor"] == pytest.approx(1.5)
    # название при этом не трогаем
    assert r.json()["title"] == "Маржа"
    assert _mine(client, ws_id)["margin_divisor"] == pytest.approx(1.5)
    # возвращаем дефолт, чтобы тесты ниже не зависели от порядка
    client.put(f"/api/workspaces/{ws_id}", json={"margin_divisor": 1.375})


def test_title_only_update_keeps_divisor(ctx):
    """Старый клиент шлёт только title: коэффициент не должен сбрасываться."""
    client, ws_id = ctx
    _as(client, "mg-owner")
    client.put(f"/api/workspaces/{ws_id}", json={"margin_divisor": 1.4})
    r = client.put(f"/api/workspaces/{ws_id}", json={"title": "Маржа"})
    assert r.status_code == 200, r.text
    assert r.json()["margin_divisor"] == pytest.approx(1.4)
    client.put(f"/api/workspaces/{ws_id}", json={"margin_divisor": 1.375})


def test_lead_cannot_change_divisor(ctx):
    client, ws_id = ctx
    _as(client, "mg-lead")
    r = client.put(f"/api/workspaces/{ws_id}", json={"margin_divisor": 2})
    assert r.status_code == 403, r.text
    _as(client, "mg-owner")
    assert _mine(client, ws_id)["margin_divisor"] == pytest.approx(1.375)


def test_viewer_cannot_change_divisor(ctx):
    client, ws_id = ctx
    _as(client, "mg-viewer")
    r = client.put(f"/api/workspaces/{ws_id}", json={"margin_divisor": 2})
    assert r.status_code == 403, r.text


@pytest.mark.parametrize("bad", [0, -1, -0.5, 100, 1000])
def test_bad_divisor_rejected_with_400(ctx, bad):
    client, ws_id = ctx
    _as(client, "mg-owner")
    r = client.put(f"/api/workspaces/{ws_id}", json={"margin_divisor": bad})
    assert r.status_code == 400, r.text
    assert _mine(client, ws_id)["margin_divisor"] == pytest.approx(1.375)


def test_empty_update_rejected(ctx):
    client, ws_id = ctx
    _as(client, "mg-owner")
    assert client.put(f"/api/workspaces/{ws_id}", json={}).status_code == 400


def test_migration_adds_column_with_default(tmp_path, monkeypatch):
    """Старая база без margin_divisor: колонка добавляется, у старых строк 1.375, повтор не падает."""
    eng = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with eng.begin() as conn:
        conn.execute(text("CREATE TABLE workspaces (id INTEGER PRIMARY KEY, title VARCHAR(255))"))
        conn.execute(text("INSERT INTO workspaces (id, title) VALUES (1, 'старое')"))
    monkeypatch.setattr(main, "engine", eng)
    main._migrate_workspaces_add_margin_divisor()
    main._migrate_workspaces_add_margin_divisor()
    assert "margin_divisor" in [c["name"] for c in inspect(eng).get_columns("workspaces")]
    with eng.begin() as conn:
        assert float(conn.execute(text("SELECT margin_divisor FROM workspaces WHERE id=1")).scalar()) == pytest.approx(1.375)


def test_migration_skips_missing_table(tmp_path, monkeypatch):
    eng = create_engine(f"sqlite:///{tmp_path / 'empty.db'}")
    monkeypatch.setattr(main, "engine", eng)
    main._migrate_workspaces_add_margin_divisor()


def test_migration_registered_in_lifespan():
    src = open(os.path.join(os.path.dirname(__file__), "..", "main.py"), encoding="utf-8").read()
    assert src.count("_migrate_workspaces_add_margin_divisor()") >= 2  # определение + вызов в lifespan
