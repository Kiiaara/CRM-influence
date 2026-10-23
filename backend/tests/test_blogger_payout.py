"""Ручная выплата блогеру на руки (IntegrationStreamer.blogger_payout).
Пусто = считаем по коэффициенту пространства, заполнено = берём вписанную сумму.
127xxx - диапазон этого файла, токены bpay-."""
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
from models.user import User
from models.workspace import Workspace, WorkspaceMember

OWNER = 127001


@pytest.fixture(scope="module")
def ctx():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.add(User(tg_id=OWNER, role="admin", label="Владелец выплат"))
    db.commit()
    ws = Workspace(title="Выплаты", owner_tg_id=OWNER)
    db.add(ws)
    db.commit()
    now = datetime.now()
    db.add_all([
        WorkspaceMember(workspace_id=ws.id, user_tg_id=OWNER, role="owner", joined_at=now),
        AuthSession(token="bpay-owner", tg_id=OWNER, expires_at=now + timedelta(days=1)),
    ])
    db.commit()
    camp = Campaign(workspace_id=ws.id, name="РК выплат")
    db.add(camp)
    db.commit()
    it = Integration(workspace_id=ws.id, brand="ВыплатБренд", campaign_id=camp.id)
    db.add(it)
    db.commit()
    data = {"ws_id": ws.id, "camp_id": camp.id, "it_id": it.id}
    db.close()
    with TestClient(main.app) as client:
        client.cookies.set("zametochnitsa_session", "bpay-owner")
        data["headers"] = {"X-Workspace-Id": str(ws.id)}
        yield client, data


def _create(client, data, **fields):
    body = {"streamer_name": "Выплатов", **fields}
    return client.post(f"/api/integrations/{data['it_id']}/streamers", json=body, headers=data["headers"])


def test_migration_adds_column_and_old_rows_are_null(tmp_path, monkeypatch):
    """Старая база без blogger_payout: колонка появляется (повтор безопасен), у старых строк null."""
    eng = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with eng.begin() as conn:
        conn.execute(text("CREATE TABLE integration_streamers (id INTEGER PRIMARY KEY, amount NUMERIC(12,2))"))
        conn.execute(text("INSERT INTO integration_streamers (id, amount) VALUES (1, 5000)"))
    monkeypatch.setattr(main, "engine", eng)
    main._migrate_blogger_payout()
    main._migrate_blogger_payout()
    assert "blogger_payout" in [c["name"] for c in inspect(eng).get_columns("integration_streamers")]
    with eng.begin() as conn:
        assert conn.execute(text("SELECT blogger_payout FROM integration_streamers WHERE id=1")).scalar() is None


def test_migration_registered_in_lifespan():
    src = open(os.path.join(os.path.dirname(__file__), "..", "main.py"), encoding="utf-8").read()
    assert src.count("_migrate_blogger_payout()") >= 2


def test_new_streamer_has_null_payout(ctx):
    client, data = ctx
    r = _create(client, data, amount=5000)
    assert r.status_code == 201, r.text
    assert r.json()["blogger_payout"] is None


def test_patch_saves_payout_and_null_resets(ctx):
    client, data = ctx
    sid = _create(client, data, amount=5000).json()["id"]
    r = client.patch(f"/api/integrations/streamers/{sid}", json={"blogger_payout": 2000}, headers=data["headers"])
    assert r.status_code == 200, r.text
    assert r.json()["blogger_payout"] == 2000
    r = client.patch(f"/api/integrations/streamers/{sid}", json={"blogger_payout": None}, headers=data["headers"])
    assert r.status_code == 200, r.text
    assert r.json()["blogger_payout"] is None


def test_payout_zero_and_equal_to_amount_allowed(ctx):
    client, data = ctx
    sid = _create(client, data, amount=5000).json()["id"]
    for value in (0, 5000):
        r = client.patch(f"/api/integrations/streamers/{sid}", json={"blogger_payout": value}, headers=data["headers"])
        assert r.status_code == 200, r.text
        assert r.json()["blogger_payout"] == value


def test_patch_negative_payout_400(ctx):
    client, data = ctx
    sid = _create(client, data, amount=5000).json()["id"]
    r = client.patch(f"/api/integrations/streamers/{sid}", json={"blogger_payout": -1}, headers=data["headers"])
    assert r.status_code == 400, r.text


def test_patch_payout_above_amount_400(ctx):
    client, data = ctx
    sid = _create(client, data, amount=5000).json()["id"]
    r = client.patch(f"/api/integrations/streamers/{sid}", json={"blogger_payout": 5001}, headers=data["headers"])
    assert r.status_code == 400, r.text
    assert "не может быть больше" in r.json()["detail"]


def test_patch_lowering_amount_below_saved_payout_400(ctx):
    """Сумму нельзя уронить ниже уже вписанной выплаты - иначе доход уйдёт в минус."""
    client, data = ctx
    sid = _create(client, data, amount=5000, blogger_payout=3000).json()["id"]
    r = client.patch(f"/api/integrations/streamers/{sid}", json={"amount": 1000}, headers=data["headers"])
    assert r.status_code == 400, r.text


def test_patch_payout_without_amount_is_ok(ctx):
    client, data = ctx
    sid = _create(client, data).json()["id"]
    r = client.patch(f"/api/integrations/streamers/{sid}", json={"blogger_payout": 700}, headers=data["headers"])
    assert r.status_code == 200, r.text
    assert r.json()["blogger_payout"] == 700


def test_create_validates_payout(ctx):
    client, data = ctx
    assert _create(client, data, amount=5000, blogger_payout=-5).status_code == 400
    assert _create(client, data, amount=5000, blogger_payout=6000).status_code == 400
    r = _create(client, data, amount=5000, blogger_payout=2000)
    assert r.status_code == 201, r.text
    assert r.json()["blogger_payout"] == 2000


def test_payout_change_goes_to_audit_log():
    from routers.integrations import TRACKED_FIELDS
    assert "blogger_payout" in TRACKED_FIELDS


def test_campaign_payout_total_mixed_and_cancelled_excluded(ctx):
    """Кампания в отдельной сделке: один блогер с ручной выплатой, другой по формуле, отменённый не считается."""
    client, data = ctx
    camp = client.post("/api/campaigns", json={"name": "РК агрегата"}, headers=data["headers"]).json()
    base = f"/api/campaigns/{camp['id']}/bloggers"
    # ручная выплата: 5000 клиентская, 2000 блогеру
    s1 = client.post(base, json={"name": "Ручной", "amount": 5000}, headers=data["headers"]).json()
    client.patch(f"/api/integrations/streamers/{s1['streamer_id']}", json={"blogger_payout": 2000}, headers=data["headers"])
    # по формуле: 1375 / 1.375 = 1000
    client.post(base, json={"name": "Формульный", "amount": 1375}, headers=data["headers"])
    # отменённый с вписанной выплатой в агрегат не входит
    s3 = client.post(base, json={"name": "Отменённый", "amount": 9999}, headers=data["headers"]).json()
    r = client.patch(
        f"/api/integrations/streamers/{s3['streamer_id']}",
        json={"stage": "cancelled", "blogger_payout": 1}, headers=data["headers"],
    )
    assert r.status_code == 200, r.text

    rows = client.get("/api/campaigns", headers=data["headers"]).json()
    c = next(x for x in rows if x["id"] == camp["id"])
    assert c["bloggers_count"] == 2
    assert c["bloggers_total"] == 6375
    assert c["bloggers_payout_total"] == pytest.approx(3000)

    bloggers = client.get(base, headers=data["headers"]).json()
    by_name = {b["name"]: b for b in bloggers}
    assert by_name["Ручной"]["blogger_payout"] == 2000
    assert by_name["Формульный"]["blogger_payout"] is None


def test_campaign_without_bloggers_has_zero_payout(ctx):
    client, data = ctx
    camp = client.post("/api/campaigns", json={"name": "Пустая РК"}, headers=data["headers"]).json()
    assert camp["bloggers_payout_total"] == 0
