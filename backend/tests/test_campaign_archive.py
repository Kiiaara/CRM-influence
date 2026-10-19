"""Завершённые рекламные кампании: отдельное поле archived_at, а не новый статус.
Активные и завершённые разделены списком GET /campaigns?archived=..., статус при этом сохраняется."""
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

import main
from database import Base, SessionLocal, engine
from models.auth_session import AuthSession
from models.user import User
from models.workspace import Workspace, WorkspaceMember

# 117xxx - диапазон этого файла, токены arc-
OWNER = 117001
OUTSIDER = 117002


@pytest.fixture(scope="module")
def ctx():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.add_all([
        User(tg_id=OWNER, role="admin", label="Владелец"),
        User(tg_id=OUTSIDER, role="editor", label="Чужой"),
    ])
    db.commit()
    my_ws = Workspace(title="Архив РК", owner_tg_id=OWNER)
    other_ws = Workspace(title="Чужой архив", owner_tg_id=OUTSIDER)
    db.add_all([my_ws, other_ws])
    db.commit()
    now = datetime.now()
    db.add_all([
        WorkspaceMember(workspace_id=my_ws.id, user_tg_id=OWNER, role="owner", joined_at=now),
        WorkspaceMember(workspace_id=other_ws.id, user_tg_id=OUTSIDER, role="owner", joined_at=now),
        AuthSession(token="arc-owner", tg_id=OWNER, expires_at=now + timedelta(days=1)),
        AuthSession(token="arc-outsider", tg_id=OUTSIDER, expires_at=now + timedelta(days=1)),
    ])
    db.commit()
    data = {"ws_id": my_ws.id, "other_ws_id": other_ws.id}
    db.close()
    with TestClient(main.app) as client:
        yield client, data


def _as(client, token: str, ws_id: int):
    client.cookies.set("zametochnitsa_session", token)
    return {"X-Workspace-Id": str(ws_id)}


def _names(client, headers, **params):
    r = client.get("/api/campaigns", params=params, headers=headers)
    assert r.status_code == 200, r.text
    return [c["name"] for c in r.json()]


def test_default_archived_at_is_null(ctx):
    client, data = ctx
    h = _as(client, "arc-owner", data["ws_id"])
    r = client.post("/api/campaigns", json={"name": "Новая РК"}, headers=h)
    assert r.status_code == 201
    assert r.json()["archived_at"] is None


def test_archive_sets_date_and_keeps_status(ctx):
    client, data = ctx
    h = _as(client, "arc-owner", data["ws_id"])
    c = client.post("/api/campaigns", json={"name": "РК на запуске", "status": "running"}, headers=h).json()
    r = client.patch(f"/api/campaigns/{c['id']}", json={"archived": True}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["archived_at"] is not None
    # стадия, на которой закончилась РК, не теряется
    assert body["status"] == "running"


def test_list_default_only_active_and_archived_only_done(ctx):
    client, data = ctx
    h = _as(client, "arc-owner", data["ws_id"])
    client.post("/api/campaigns", json={"name": "Активная РК"}, headers=h)
    done = client.post("/api/campaigns", json={"name": "Завершённая РК"}, headers=h).json()
    client.patch(f"/api/campaigns/{done['id']}", json={"archived": True}, headers=h)

    default = _names(client, h)
    assert "Активная РК" in default
    assert "Завершённая РК" not in default

    archived = _names(client, h, archived="true")
    assert "Завершённая РК" in archived
    assert "Активная РК" not in archived


def test_unarchive_clears_date(ctx):
    client, data = ctx
    h = _as(client, "arc-owner", data["ws_id"])
    c = client.post("/api/campaigns", json={"name": "Вернуть РК"}, headers=h).json()
    client.patch(f"/api/campaigns/{c['id']}", json={"archived": True}, headers=h)
    r = client.patch(f"/api/campaigns/{c['id']}", json={"archived": False}, headers=h)
    assert r.status_code == 200
    assert r.json()["archived_at"] is None
    assert "Вернуть РК" in _names(client, h)
    assert "Вернуть РК" not in _names(client, h, archived="true")


def test_repeat_archive_keeps_first_date(ctx):
    """Повторное 'Готово' не сдвигает дату закрытия."""
    client, data = ctx
    h = _as(client, "arc-owner", data["ws_id"])
    c = client.post("/api/campaigns", json={"name": "Дубль закрытия"}, headers=h).json()
    first = client.patch(f"/api/campaigns/{c['id']}", json={"archived": True}, headers=h).json()["archived_at"]
    second = client.patch(f"/api/campaigns/{c['id']}", json={"archived": True}, headers=h).json()["archived_at"]
    assert first == second


def test_archive_isolated_between_workspaces(ctx):
    client, data = ctx
    h = _as(client, "arc-owner", data["ws_id"])
    c = client.post("/api/campaigns", json={"name": "Моя закрытая"}, headers=h).json()
    client.patch(f"/api/campaigns/{c['id']}", json={"archived": True}, headers=h)

    # чужое пространство не видит её ни в одном списке и не может вернуть
    h2 = _as(client, "arc-outsider", data["other_ws_id"])
    assert "Моя закрытая" not in _names(client, h2, archived="true")
    assert client.patch(f"/api/campaigns/{c['id']}", json={"archived": False}, headers=h2).status_code == 404
