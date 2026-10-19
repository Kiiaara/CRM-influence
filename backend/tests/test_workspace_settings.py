"""Экран настроек пространства: кто что может править через PUT /api/workspaces/{id}.
Руководитель правит название, но не коэффициент маржи; владелец - оба поля."""
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

import main
from database import Base, SessionLocal, engine
from models.auth_session import AuthSession
from models.user import User
from models.workspace import Workspace, WorkspaceMember

# 113xxx - диапазон этого файла, токены ws-
OWNER = 113001
LEAD = 113002


@pytest.fixture(scope="module")
def ctx():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.add_all([
        User(tg_id=OWNER, role="admin", label="Владелец"),
        User(tg_id=LEAD, role="editor", label="Руководитель"),
    ])
    db.commit()
    ws = Workspace(title="Настройки", owner_tg_id=OWNER)
    db.add(ws)
    db.commit()
    now = datetime.now()
    db.add_all([
        WorkspaceMember(workspace_id=ws.id, user_tg_id=OWNER, role="owner", joined_at=now),
        WorkspaceMember(workspace_id=ws.id, user_tg_id=LEAD, role="lead", joined_at=now),
        AuthSession(token="ws-owner", tg_id=OWNER, expires_at=now + timedelta(days=1)),
        AuthSession(token="ws-lead", tg_id=LEAD, expires_at=now + timedelta(days=1)),
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


def test_lead_can_change_title(ctx):
    client, ws_id = ctx
    _as(client, "ws-lead")
    r = client.put(f"/api/workspaces/{ws_id}", json={"title": "Новое имя"})
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "Новое имя"
    assert _mine(client, ws_id)["title"] == "Новое имя"


def test_lead_cannot_change_divisor_and_nothing_applies(ctx):
    """Запрос руководителя с обоими полями отбивается 403, название тоже не меняется."""
    client, ws_id = ctx
    _as(client, "ws-lead")
    before = _mine(client, ws_id)
    r = client.put(f"/api/workspaces/{ws_id}", json={"title": "Взлом", "margin_divisor": 3})
    assert r.status_code == 403, r.text
    after = _mine(client, ws_id)
    assert after["margin_divisor"] == pytest.approx(before["margin_divisor"])
    assert after["title"] == before["title"]


def test_owner_can_change_title_and_divisor_together(ctx):
    client, ws_id = ctx
    _as(client, "ws-owner")
    r = client.put(f"/api/workspaces/{ws_id}", json={"title": "Оба поля", "margin_divisor": 1.4})
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "Оба поля"
    assert r.json()["margin_divisor"] == pytest.approx(1.4)


def test_fractional_divisor_roundtrip_exact(ctx):
    """1.4 и 1.375 сохраняются и возвращаются без потери точности (в списке тоже)."""
    client, ws_id = ctx
    _as(client, "ws-owner")
    for value in (1.4, 1.375, 1.2345):
        r = client.put(f"/api/workspaces/{ws_id}", json={"margin_divisor": value})
        assert r.status_code == 200, r.text
        assert r.json()["margin_divisor"] == value
        assert _mine(client, ws_id)["margin_divisor"] == value
