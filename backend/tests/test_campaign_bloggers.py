"""Блогеры внутри кампании: сделка со инфлюенсером теперь входит через кампанию.

Плюс ссылка на КП в кампании, миграция campaign_id и статика фронта
(выпадашки в тёмной теме, меню без «Интеграции»).
"""
import os
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text

import main
from database import Base, engine, SessionLocal
from models.user import User
from models.auth_session import AuthSession
from models.workspace import Workspace, WorkspaceMember
from models.advertiser import Advertiser
from models.campaign import Campaign
from models.integration import Integration

MY_TG = 109001
OUT_TG = 109002

FRONT = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "src")


def _read_front(*parts: str) -> str:
    with open(os.path.join(FRONT, *parts), encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def ctx():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.add_all([
        User(tg_id=MY_TG, role="admin", label="Лера"),
        User(tg_id=OUT_TG, role="editor", label="Чужой"),
    ])
    db.commit()
    my_ws = Workspace(title="Мой проект", owner_tg_id=MY_TG)
    other_ws = Workspace(title="Чужой проект", owner_tg_id=OUT_TG)
    db.add_all([my_ws, other_ws])
    db.commit()
    now = datetime.now()
    db.add_all([
        WorkspaceMember(workspace_id=my_ws.id, user_tg_id=MY_TG, role="owner", joined_at=now),
        WorkspaceMember(workspace_id=other_ws.id, user_tg_id=OUT_TG, role="owner", joined_at=now),
        AuthSession(token="cbr-lera", tg_id=MY_TG, expires_at=now + timedelta(days=1)),
        AuthSession(token="cbr-outsider", tg_id=OUT_TG, expires_at=now + timedelta(days=1)),
    ])
    adv = Advertiser(workspace_id=my_ws.id, name="БафБаф", notes="")
    db.add(adv)
    db.commit()
    data = {"ws_id": my_ws.id, "other_ws_id": other_ws.id, "adv_id": adv.id}
    db.close()
    with TestClient(main.app) as client:
        yield client, data


def _h(client, token: str, ws_id: int):
    client.cookies.set("zametochnitsa_session", token)
    return {"X-Workspace-Id": str(ws_id)}


def _mk_campaign(client, data, **extra):
    headers = _h(client, "cbr-lera", data["ws_id"])
    r = client.post("/api/campaigns", json={"name": "РК с блогерами", **extra}, headers=headers)
    assert r.status_code == 201
    return r.json(), headers


def test_bloggers_empty_and_counters_zero(ctx):
    client, data = ctx
    c, headers = _mk_campaign(client, data, advertiser_id=data["adv_id"])
    assert c["bloggers_count"] == 0
    assert c["bloggers_total"] == 0
    r = client.get(f"/api/campaigns/{c['id']}/bloggers", headers=headers)
    assert r.status_code == 200
    assert r.json() == []


def test_add_blogger_creates_integration_and_reuses_it(ctx):
    client, data = ctx
    c, headers = _mk_campaign(client, data, advertiser_id=data["adv_id"])
    url = f"/api/campaigns/{c['id']}/bloggers"

    r1 = client.post(url, json={"name": "Вася", "amount": 50000}, headers=headers)
    assert r1.status_code == 201
    b1 = r1.json()
    assert b1["name"] == "Вася"
    assert b1["amount"] == 50000
    assert b1["stage"] == "negotiation"
    assert b1["talent_type"] == "blogger"

    r2 = client.post(url, json={"name": "Петя", "amount": 30000, "talent_type": "streamer"}, headers=headers)
    assert r2.status_code == 201
    # вторая сделка не создаётся: оба блогера в одной интеграции кампании
    assert r2.json()["integration_id"] == b1["integration_id"]

    db = SessionLocal()
    its = db.query(Integration).filter_by(campaign_id=c["id"]).all()
    assert len(its) == 1
    assert its[0].brand == "БафБаф"
    assert its[0].advertiser_id == data["adv_id"]
    assert its[0].workspace_id == data["ws_id"]
    db.close()

    listed = client.get(url, headers=headers).json()
    assert [b["name"] for b in listed] == ["Вася", "Петя"]
    for key in ("streamer_id", "integration_id", "amount", "currency", "payment_status",
                "integration_date", "deadline", "stage"):
        assert key in listed[0]

    # блогер виден и на канбане - это та же сделка
    board = client.get("/api/integrations", headers=headers).json()
    names = [s["streamer_name"] for it in board for s in it["streamers"]]
    assert "Вася" in names

    row = next(x for x in client.get("/api/campaigns", headers=headers).json() if x["id"] == c["id"])
    assert row["bloggers_count"] == 2
    assert row["bloggers_total"] == 80000


def test_cancelled_blogger_not_counted(ctx):
    client, data = ctx
    c, headers = _mk_campaign(client, data)
    b = client.post(f"/api/campaigns/{c['id']}/bloggers", json={"name": "Отказ", "amount": 1000}, headers=headers).json()
    client.patch(f"/api/integrations/streamers/{b['streamer_id']}", json={"stage": "cancelled"}, headers=headers)
    row = next(x for x in client.get("/api/campaigns", headers=headers).json() if x["id"] == c["id"])
    assert row["bloggers_count"] == 0
    assert row["bloggers_total"] == 0


def test_campaign_without_advertiser_uses_name_as_brand(ctx):
    client, data = ctx
    c, headers = _mk_campaign(client, data, name="Без бренда")
    r = client.post(f"/api/campaigns/{c['id']}/bloggers", json={"name": "Коля"}, headers=headers)
    assert r.status_code == 201
    db = SessionLocal()
    it = db.query(Integration).filter_by(campaign_id=c["id"]).one()
    assert it.brand == "Без бренда"
    db.close()


def test_blank_blogger_name_rejected(ctx):
    client, data = ctx
    c, headers = _mk_campaign(client, data)
    r = client.post(f"/api/campaigns/{c['id']}/bloggers", json={"name": "  "}, headers=headers)
    assert r.status_code == 400


def test_bloggers_isolated_between_workspaces(ctx):
    client, data = ctx
    c, headers = _mk_campaign(client, data)
    out = _h(client, "cbr-outsider", data["other_ws_id"])
    assert client.get(f"/api/campaigns/{c['id']}/bloggers", headers=out).status_code == 404
    assert client.post(f"/api/campaigns/{c['id']}/bloggers", json={"name": "Взлом"}, headers=out).status_code == 404


def test_delete_campaign_keeps_deal(ctx):
    """Удаление кампании не сносит сделки: campaign_id просто обнуляется."""
    client, data = ctx
    c, headers = _mk_campaign(client, data)
    b = client.post(f"/api/campaigns/{c['id']}/bloggers", json={"name": "Останусь"}, headers=headers).json()
    assert client.delete(f"/api/campaigns/{c['id']}", headers=headers).status_code == 200
    db = SessionLocal()
    it = db.get(Integration, b["integration_id"])
    assert it is not None
    assert it.campaign_id is None
    db.close()


def test_advertiser_change_syncs_deal_brand(ctx):
    client, data = ctx
    c, headers = _mk_campaign(client, data, name="Смена бренда")
    b = client.post(f"/api/campaigns/{c['id']}/bloggers", json={"name": "Лена"}, headers=headers).json()
    r = client.patch(f"/api/campaigns/{c['id']}", json={"advertiser_id": data["adv_id"]}, headers=headers)
    assert r.status_code == 200
    db = SessionLocal()
    it = db.get(Integration, b["integration_id"])
    assert it.brand == "БафБаф"
    assert it.advertiser_id == data["adv_id"]
    db.close()


def test_kp_url_roundtrip(ctx):
    client, data = ctx
    c, headers = _mk_campaign(client, data)
    assert c["kp_url"] == ""
    r = client.patch(f"/api/campaigns/{c['id']}", json={"kp_url": "  https://docs.google.com/spreadsheets/d/x  "}, headers=headers)
    assert r.status_code == 200
    assert r.json()["kp_url"] == "https://docs.google.com/spreadsheets/d/x"
    created = client.post("/api/campaigns", json={"name": "С КП", "kp_url": "https://kp.example"}, headers=headers).json()
    assert created["kp_url"] == "https://kp.example"


def test_migration_adds_columns_idempotently(tmp_path, monkeypatch):
    """Старая база без campaign_id/kp_url: миграция добавляет колонки и не падает при повторе."""
    eng = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with eng.begin() as conn:
        conn.execute(text("CREATE TABLE integrations (id INTEGER PRIMARY KEY, brand VARCHAR(255))"))
        conn.execute(text("CREATE TABLE campaigns (id INTEGER PRIMARY KEY, name VARCHAR(255))"))
        conn.execute(text("INSERT INTO integrations (id, brand) VALUES (1, 'старый')"))
        conn.execute(text("INSERT INTO campaigns (id, name) VALUES (1, 'старая')"))
    monkeypatch.setattr(main, "engine", eng)
    main._migrate_integrations_add_campaign()
    main._migrate_integrations_add_campaign()
    insp = inspect(eng)
    assert "campaign_id" in [c["name"] for c in insp.get_columns("integrations")]
    assert "kp_url" in [c["name"] for c in insp.get_columns("campaigns")]
    with eng.begin() as conn:
        assert conn.execute(text("SELECT brand FROM integrations WHERE id=1")).scalar() == "старый"
        assert conn.execute(text("SELECT kp_url FROM campaigns WHERE id=1")).scalar() in ("", None)


def test_migration_skips_missing_tables(tmp_path, monkeypatch):
    eng = create_engine(f"sqlite:///{tmp_path / 'empty.db'}")
    monkeypatch.setattr(main, "engine", eng)
    main._migrate_integrations_add_campaign()


def test_migration_registered_in_lifespan():
    src = open(os.path.join(os.path.dirname(__file__), "..", "main.py"), encoding="utf-8").read()
    assert src.count("_migrate_integrations_add_campaign()") >= 2  # определение + вызов в lifespan


def test_select_options_have_explicit_colors():
    """Нативный список select в тёмной теме не должен быть белым по белому."""
    css = _read_front("index.css")
    assert "select option" in css
    block = css[css.index("select option"):]
    assert "background-color" in block and "color:" in block
    assert ".dark select option" in css


def test_integrations_removed_from_menu_but_route_kept():
    ws = _read_front("pages", "WorkspacePage.tsx")
    assert "label: 'Интеграции'" not in ws
    app = _read_front("App.tsx")
    assert 'path="/integrations"' in app