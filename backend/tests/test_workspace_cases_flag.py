"""Настройка пространства cases_enabled: показывать ли раздел 'Кейсы'.
Правит только владелец, как и margin_divisor."""
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

import main
from database import Base, SessionLocal, engine
from models.auth_session import AuthSession
from models.user import User
from models.workspace import Workspace, WorkspaceMember

# 118xxx - диапазон этого файла, токены cs-
OWNER = 118001
LEAD = 118002


@pytest.fixture(scope="module")
def ctx():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.add_all([
        User(tg_id=OWNER, role="admin", label="Владелец"),
        User(tg_id=LEAD, role="editor", label="Руководитель"),
    ])
    db.commit()
    ws = Workspace(title="Кейсы", owner_tg_id=OWNER)
    db.add(ws)
    db.commit()
    now = datetime.now()
    db.add_all([
        WorkspaceMember(workspace_id=ws.id, user_tg_id=OWNER, role="owner", joined_at=now),
        WorkspaceMember(workspace_id=ws.id, user_tg_id=LEAD, role="lead", joined_at=now),
        AuthSession(token="cs-owner", tg_id=OWNER, expires_at=now + timedelta(days=1)),
        AuthSession(token="cs-lead", tg_id=LEAD, expires_at=now + timedelta(days=1)),
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


def test_cases_enabled_default_true_and_in_api(ctx):
    client, ws_id = ctx
    _as(client, "cs-owner")
    assert _mine(client, ws_id)["cases_enabled"] is True


def test_owner_can_disable_and_enable(ctx):
    client, ws_id = ctx
    _as(client, "cs-owner")
    r = client.put(f"/api/workspaces/{ws_id}", json={"cases_enabled": False})
    assert r.status_code == 200, r.text
    assert r.json()["cases_enabled"] is False
    assert _mine(client, ws_id)["cases_enabled"] is False
    r = client.put(f"/api/workspaces/{ws_id}", json={"cases_enabled": True})
    assert r.status_code == 200, r.text
    assert _mine(client, ws_id)["cases_enabled"] is True


def test_lead_cannot_change_cases_flag(ctx):
    client, ws_id = ctx
    _as(client, "cs-lead")
    before = _mine(client, ws_id)
    r = client.put(f"/api/workspaces/{ws_id}", json={"cases_enabled": False})
    assert r.status_code == 403, r.text
    assert _mine(client, ws_id)["cases_enabled"] == before["cases_enabled"]


def test_case_reminder_hidden_when_cases_disabled(ctx):
    """Сводка бота не напоминает про кейс в пространстве, где раздел выключен."""
    from bot_dialog import compute_hot_tasks
    from models.integration import Integration
    from models.integration_streamer import IntegrationStreamer
    client, ws_id = ctx
    _as(client, "cs-owner")
    db = SessionLocal()
    try:
        it = Integration(workspace_id=ws_id, brand="КейсБренд")
        db.add(it)
        db.commit()
        db.add(IntegrationStreamer(integration_id=it.id, streamer_name="Без кейса", stage="done"))
        db.commit()

        client.put(f"/api/workspaces/{ws_id}", json={"cases_enabled": True})
        db.expire_all()
        assert "нет кейса" in compute_hot_tasks(db, ws_id)[1]

        client.put(f"/api/workspaces/{ws_id}", json={"cases_enabled": False})
        db.expire_all()
        assert "нет кейса" not in compute_hot_tasks(db, ws_id)[1]
    finally:
        db.close()


def test_other_settings_do_not_touch_flag(ctx):
    """Смена названия не сбрасывает галочку."""
    client, ws_id = ctx
    _as(client, "cs-owner")
    client.put(f"/api/workspaces/{ws_id}", json={"cases_enabled": False})
    r = client.put(f"/api/workspaces/{ws_id}", json={"title": "Другое имя"})
    assert r.status_code == 200
    assert r.json()["cases_enabled"] is False
