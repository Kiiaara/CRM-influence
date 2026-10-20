"""Горячие задачи: флаг пространства draft_alerts_enabled и campaign_id в списках сделок.
Флаг правит только владелец, как cases_enabled и margin_divisor."""
import os
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text

import main
from database import Base, SessionLocal, engine
from models.auth_session import AuthSession
from models.campaign import Campaign
from models.integration import Integration
from models.integration_streamer import IntegrationStreamer
from models.user import User
from models.workspace import Workspace, WorkspaceMember

# 121xxx - диапазон этого файла, токены alrt-
OWNER = 121001
LEAD = 121002

FRONT = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "src")


@pytest.fixture(scope="module")
def ctx():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.add_all([
        User(tg_id=OWNER, role="admin", label="Владелец"),
        User(tg_id=LEAD, role="editor", label="Руководитель"),
    ])
    db.commit()
    ws = Workspace(title="Алерты", owner_tg_id=OWNER)
    db.add(ws)
    db.commit()
    now = datetime.now()
    db.add_all([
        WorkspaceMember(workspace_id=ws.id, user_tg_id=OWNER, role="owner", joined_at=now),
        WorkspaceMember(workspace_id=ws.id, user_tg_id=LEAD, role="lead", joined_at=now),
        AuthSession(token="alrt-owner", tg_id=OWNER, expires_at=now + timedelta(days=1)),
        AuthSession(token="alrt-lead", tg_id=LEAD, expires_at=now + timedelta(days=1)),
    ])
    db.commit()
    # сделка в кампании и сделка вне кампании
    camp = Campaign(workspace_id=ws.id, name="РК для алертов")
    db.add(camp)
    db.commit()
    in_camp = Integration(workspace_id=ws.id, brand="АлртБренд", campaign_id=camp.id)
    outside = Integration(workspace_id=ws.id, brand="АлртБренд")
    db.add_all([in_camp, outside])
    db.commit()
    db.add_all([
        IntegrationStreamer(integration_id=in_camp.id, streamer_name="АлртВКампании"),
        IntegrationStreamer(integration_id=outside.id, streamer_name="АлртБезКампании"),
    ])
    db.commit()
    data = {"ws_id": ws.id, "camp_id": camp.id, "in_id": in_camp.id, "out_id": outside.id}
    db.close()
    with TestClient(main.app) as client:
        yield client, data


def _as(client, token: str, ws_id: int):
    client.cookies.set("zametochnitsa_session", token)
    return {"X-Workspace-Id": str(ws_id)}


def _mine(client, ws_id: int) -> dict:
    return next(w for w in client.get("/api/workspaces").json() if w["id"] == ws_id)


def test_draft_alerts_default_true_and_in_api(ctx):
    client, data = ctx
    _as(client, "alrt-owner", data["ws_id"])
    assert _mine(client, data["ws_id"])["draft_alerts_enabled"] is True


def test_owner_can_toggle_draft_alerts(ctx):
    client, data = ctx
    ws_id = data["ws_id"]
    _as(client, "alrt-owner", ws_id)
    r = client.put(f"/api/workspaces/{ws_id}", json={"draft_alerts_enabled": False})
    assert r.status_code == 200, r.text
    assert r.json()["draft_alerts_enabled"] is False
    assert _mine(client, ws_id)["draft_alerts_enabled"] is False
    r = client.put(f"/api/workspaces/{ws_id}", json={"draft_alerts_enabled": True})
    assert r.status_code == 200, r.text
    assert _mine(client, ws_id)["draft_alerts_enabled"] is True


def test_lead_gets_403_on_draft_alerts(ctx):
    client, data = ctx
    ws_id = data["ws_id"]
    _as(client, "alrt-lead", ws_id)
    before = _mine(client, ws_id)["draft_alerts_enabled"]
    r = client.put(f"/api/workspaces/{ws_id}", json={"draft_alerts_enabled": not before})
    assert r.status_code == 403, r.text
    assert _mine(client, ws_id)["draft_alerts_enabled"] == before


def test_other_settings_do_not_touch_draft_flag(ctx):
    client, data = ctx
    ws_id = data["ws_id"]
    _as(client, "alrt-owner", ws_id)
    client.put(f"/api/workspaces/{ws_id}", json={"draft_alerts_enabled": False})
    r = client.put(f"/api/workspaces/{ws_id}", json={"title": "Алерты 2"})
    assert r.status_code == 200
    assert r.json()["draft_alerts_enabled"] is False
    client.put(f"/api/workspaces/{ws_id}", json={"draft_alerts_enabled": True})


def test_integrations_list_returns_campaign_id(ctx):
    client, data = ctx
    headers = _as(client, "alrt-owner", data["ws_id"])
    board = client.get("/api/integrations", headers=headers).json()
    by_id = {it["id"]: it for it in board}
    assert by_id[data["in_id"]]["campaign_id"] == data["camp_id"]
    assert by_id[data["out_id"]]["campaign_id"] is None


def test_search_hit_returns_campaign_id(ctx):
    """Поиск ведёт на модалку в кампании, поэтому кампания должна быть в ответе."""
    client, data = ctx
    headers = _as(client, "alrt-owner", data["ws_id"])
    hits = client.get("/api/search", params={"q": "АлртВКампании"}, headers=headers).json()
    assert len(hits) == 1 and hits[0]["campaign_id"] == data["camp_id"]
    hits = client.get("/api/search", params={"q": "АлртБезКампании"}, headers=headers).json()
    assert len(hits) == 1 and hits[0]["campaign_id"] is None


def test_migration_adds_column_idempotently(tmp_path, monkeypatch):
    """Старая база без draft_alerts_enabled: колонка появляется, у старых строк включено."""
    eng = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with eng.begin() as conn:
        conn.execute(text("CREATE TABLE workspaces (id INTEGER PRIMARY KEY, title VARCHAR(255))"))
        conn.execute(text("INSERT INTO workspaces (id, title) VALUES (1, 'старое')"))
    monkeypatch.setattr(main, "engine", eng)
    main._migrate_workspaces_add_draft_alerts_enabled()
    main._migrate_workspaces_add_draft_alerts_enabled()
    assert "draft_alerts_enabled" in [c["name"] for c in inspect(eng).get_columns("workspaces")]
    with eng.begin() as conn:
        assert conn.execute(text("SELECT draft_alerts_enabled FROM workspaces WHERE id=1")).scalar() == 1


def test_migration_registered_in_lifespan():
    src = open(os.path.join(os.path.dirname(__file__), "..", "main.py"), encoding="utf-8").read()
    assert src.count("_migrate_workspaces_add_draft_alerts_enabled()") >= 2


def test_no_kanban_links_outside_board():
    """Канбан нигде не открываем: ссылок на /integrations вне самой доски не осталось."""
    allowed = {"IntegrationsBoard.tsx", "App.tsx"}
    bad = []
    for root, _, files in os.walk(FRONT):
        for name in files:
            if not name.endswith((".tsx", ".ts")) or name in allowed:
                continue
            with open(os.path.join(root, name), encoding="utf-8") as f:
                src = f.read()
            # запросы к API (api.get('/integrations...')) не в счёт, только маршруты в Link/navigate
            if "to=\"/integrations" in src or "to={`/integrations" in src or "nav(`/integrations" in src:
                bad.append(name)
    assert bad == []
