"""Рекламные кампании: таблица запросов от брендов.

Уровень выше сделки со стримером - запрос живёт с момента поступления,
когда блогеры ещё не подобраны.
"""
from datetime import datetime, timedelta

import pytest

from fastapi.testclient import TestClient

import main
from database import Base, engine, SessionLocal
from models.user import User
from models.auth_session import AuthSession
from models.workspace import Workspace, WorkspaceMember
from models.advertiser import Advertiser
from models.campaign import Campaign

LERA_TG = 105001
OUTSIDER_TG = 105002


@pytest.fixture(scope="module")
def ctx():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    db.add_all([
        User(tg_id=LERA_TG, role="admin", label="Лера"),
        User(tg_id=OUTSIDER_TG, role="editor", label="Чужой"),
    ])
    db.commit()

    my_ws = Workspace(title="Мой проект", owner_tg_id=LERA_TG)
    other_ws = Workspace(title="Чужой проект", owner_tg_id=OUTSIDER_TG)
    db.add_all([my_ws, other_ws])
    db.commit()
    db.refresh(my_ws)
    db.refresh(other_ws)

    now = datetime.now()
    db.add_all([
        WorkspaceMember(workspace_id=my_ws.id, user_tg_id=LERA_TG, role="owner", joined_at=now),
        WorkspaceMember(workspace_id=other_ws.id, user_tg_id=OUTSIDER_TG, role="owner", joined_at=now),
    ])

    adv = Advertiser(workspace_id=my_ws.id, name="БафБаф", notes="")
    foreign_adv = Advertiser(workspace_id=other_ws.id, name="Чужой бренд", notes="")
    db.add_all([adv, foreign_adv])

    db.add_all([
        AuthSession(token="camp-lera", tg_id=LERA_TG, expires_at=now + timedelta(days=1)),
        AuthSession(token="camp-outsider", tg_id=OUTSIDER_TG, expires_at=now + timedelta(days=1)),
    ])
    db.commit()
    db.refresh(adv)
    db.refresh(foreign_adv)

    data = {
        "ws_id": my_ws.id,
        "other_ws_id": other_ws.id,
        "adv_id": adv.id,
        "foreign_adv_id": foreign_adv.id,
    }
    db.close()

    with TestClient(main.app) as client:
        yield client, data


def _as(client, token: str, ws_id: int):
    client.cookies.set("zametochnitsa_session", token)
    return {"X-Workspace-Id": str(ws_id)}


def test_create_campaign(ctx):
    client, data = ctx
    headers = _as(client, "camp-lera", data["ws_id"])
    r = client.post(
        "/api/campaigns",
        json={
            "name": "Осенний запуск",
            "advertiser_id": data["adv_id"],
            "status": "picking",
            "requested_at": datetime.now().isoformat(),
            "budget": 300000,
            "notes": "нужны фемки",
        },
        headers=headers,
    )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Осенний запуск"
    assert body["advertiser_name"] == "БафБаф"
    assert body["budget"] == 300000


def test_list_campaigns(ctx):
    client, data = ctx
    headers = _as(client, "camp-lera", data["ws_id"])
    r = client.get("/api/campaigns", headers=headers)
    assert r.status_code == 200
    names = [c["name"] for c in r.json()]
    assert "Осенний запуск" in names


def test_cancelled_status_allowed(ctx):
    """Отмена - полноценный статус, а не удаление."""
    client, data = ctx
    headers = _as(client, "camp-lera", data["ws_id"])
    created = client.post("/api/campaigns", json={"name": "Сорвалась"}, headers=headers).json()

    r = client.patch(f"/api/campaigns/{created['id']}", json={"status": "cancelled"}, headers=headers)
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"


def test_invalid_status_rejected(ctx):
    client, data = ctx
    headers = _as(client, "camp-lera", data["ws_id"])
    r = client.post("/api/campaigns", json={"name": "Кривая", "status": "wat"}, headers=headers)
    assert r.status_code == 400


def test_empty_name_rejected(ctx):
    client, data = ctx
    headers = _as(client, "camp-lera", data["ws_id"])
    r = client.post("/api/campaigns", json={"name": "   "}, headers=headers)
    assert r.status_code == 400


def test_owner_assignment(ctx):
    """Ответственный - только участник этого пространства."""
    client, data = ctx
    headers = _as(client, "camp-lera", data["ws_id"])

    ok = client.post("/api/campaigns", json={"name": "С ответственным", "owner_tg_id": LERA_TG}, headers=headers)
    assert ok.status_code == 201
    assert ok.json()["owner_label"] == "Лера"

    bad = client.post("/api/campaigns", json={"name": "Чужой ответственный", "owner_tg_id": OUTSIDER_TG}, headers=headers)
    assert bad.status_code == 400


def test_foreign_advertiser_rejected(ctx):
    client, data = ctx
    headers = _as(client, "camp-lera", data["ws_id"])
    r = client.post(
        "/api/campaigns",
        json={"name": "Чужой бренд", "advertiser_id": data["foreign_adv_id"]},
        headers=headers,
    )
    assert r.status_code == 400


def test_campaigns_isolated_between_workspaces(ctx):
    client, data = ctx
    headers = _as(client, "camp-outsider", data["other_ws_id"])
    r = client.get("/api/campaigns", headers=headers)
    assert r.status_code == 200
    names = [c["name"] for c in r.json()]
    assert "Осенний запуск" not in names


def test_cannot_touch_foreign_campaign(ctx):
    client, data = ctx

    db = SessionLocal()
    foreign = Campaign(workspace_id=data["other_ws_id"], name="Не моя РК")
    db.add(foreign)
    db.commit()
    db.refresh(foreign)
    foreign_id = foreign.id
    db.close()

    headers = _as(client, "camp-lera", data["ws_id"])
    assert client.patch(f"/api/campaigns/{foreign_id}", json={"name": "взлом"}, headers=headers).status_code == 404
    assert client.delete(f"/api/campaigns/{foreign_id}", headers=headers).status_code == 404


def test_update_dates_and_delete(ctx):
    client, data = ctx
    headers = _as(client, "camp-lera", data["ws_id"])
    created = client.post("/api/campaigns", json={"name": "С дедлайнами"}, headers=headers).json()

    due = (datetime.now() + timedelta(days=5)).replace(microsecond=0)
    r = client.patch(
        f"/api/campaigns/{created['id']}",
        json={"selection_due_at": due.isoformat(), "campaign_due_at": due.isoformat()},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["selection_due_at"].startswith(due.strftime("%Y-%m-%d"))

    assert client.delete(f"/api/campaigns/{created['id']}", headers=headers).status_code == 200
    remaining = [c["name"] for c in client.get("/api/campaigns", headers=headers).json()]
    assert "С дедлайнами" not in remaining
