"""Свои блогеры: заводятся руками, привязаны к пространству и не трогаются синхронизацией
с гугл-таблицей (в отличие от базы агентства BloggerProfile)."""
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

import blogger_sheet
import main
from database import Base, SessionLocal, engine
from models.auth_session import AuthSession
from models.blogger_profile import BloggerProfile
from models.user import User
from models.workspace import Workspace, WorkspaceMember

# 119xxx - диапазон этого файла, токены own-
OWNER = 119001
OUTSIDER = 119002
VIEWER = 119003


@pytest.fixture(scope="module")
def ctx():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.add_all([
        User(tg_id=OWNER, role="admin", label="Владелец"),
        User(tg_id=OUTSIDER, role="editor", label="Чужой"),
        User(tg_id=VIEWER, role="viewer", label="Зритель"),
    ])
    db.commit()
    my_ws = Workspace(title="Свои блогеры", owner_tg_id=OWNER)
    other_ws = Workspace(title="Чужое пространство", owner_tg_id=OUTSIDER)
    db.add_all([my_ws, other_ws])
    db.commit()
    now = datetime.now()
    db.add_all([
        WorkspaceMember(workspace_id=my_ws.id, user_tg_id=OWNER, role="owner", joined_at=now),
        WorkspaceMember(workspace_id=my_ws.id, user_tg_id=VIEWER, role="viewer", joined_at=now),
        WorkspaceMember(workspace_id=other_ws.id, user_tg_id=OUTSIDER, role="owner", joined_at=now),
        AuthSession(token="own-owner", tg_id=OWNER, expires_at=now + timedelta(days=1)),
        AuthSession(token="own-outsider", tg_id=OUTSIDER, expires_at=now + timedelta(days=1)),
        AuthSession(token="own-viewer", tg_id=VIEWER, expires_at=now + timedelta(days=1)),
    ])
    db.commit()
    data = {"ws_id": my_ws.id, "other_ws_id": other_ws.id}
    db.close()
    with TestClient(main.app) as client:
        yield client, data


def _as(client, token: str, ws_id: int):
    client.cookies.set("zametochnitsa_session", token)
    return {"X-Workspace-Id": str(ws_id)}


def _create(client, h, **over):
    body = {
        "name": "Вася Игры", "url": "https://youtube.com/@vasya", "platform": "YouTube",
        "contact": "@vasya_manager", "category": "игры", "notes": "пишет только в ТГ",
    }
    body.update(over)
    return client.post("/api/own-bloggers", json=body, headers=h)


def test_create_update_delete(ctx):
    client, data = ctx
    h = _as(client, "own-owner", data["ws_id"])
    r = _create(client, h)
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["name"] == "Вася Игры"
    assert b["platform"] == "YouTube"
    assert b["contact"] == "@vasya_manager"
    assert b["category"] == "игры"
    assert b["url"] == "https://youtube.com/@vasya"

    r = client.patch(f"/api/own-bloggers/{b['id']}", json={"contact": "vasya@mail.ru", "category": "техника"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["contact"] == "vasya@mail.ru"
    assert r.json()["name"] == "Вася Игры"

    listed = client.get("/api/own-bloggers", headers=h).json()
    assert [x["category"] for x in listed if x["id"] == b["id"]] == ["техника"]

    assert client.delete(f"/api/own-bloggers/{b['id']}", headers=h).status_code == 200
    assert b["id"] not in [x["id"] for x in client.get("/api/own-bloggers", headers=h).json()]


def test_empty_name_rejected(ctx):
    client, data = ctx
    h = _as(client, "own-owner", data["ws_id"])
    assert _create(client, h, name="   ").status_code == 400


def test_isolated_between_workspaces(ctx):
    client, data = ctx
    h = _as(client, "own-owner", data["ws_id"])
    b = _create(client, h, name="Только наш").json()

    h2 = _as(client, "own-outsider", data["other_ws_id"])
    assert "Только наш" not in [x["name"] for x in client.get("/api/own-bloggers", headers=h2).json()]
    assert client.patch(f"/api/own-bloggers/{b['id']}", json={"name": "взлом"}, headers=h2).status_code == 404
    assert client.delete(f"/api/own-bloggers/{b['id']}", headers=h2).status_code == 404


def test_viewer_cannot_write_but_can_read(ctx):
    client, data = ctx
    h = _as(client, "own-owner", data["ws_id"])
    b = _create(client, h, name="Для зрителя").json()
    hv = _as(client, "own-viewer", data["ws_id"])
    assert client.get("/api/own-bloggers", headers=hv).status_code == 200
    assert _create(client, hv, name="Левый").status_code == 403
    assert client.delete(f"/api/own-bloggers/{b['id']}", headers=hv).status_code == 403


def test_sheet_sync_does_not_delete_own_bloggers(ctx):
    """Главное: синхронизация приводит к таблице только базу агентства, свои не трогает."""
    client, data = ctx
    h = _as(client, "own-owner", data["ws_id"])
    own = _create(client, h, name="Свой переживёт синк").json()

    db = SessionLocal()
    try:
        result = blogger_sheet.upsert_bloggers(
            db, [{"name": "Из таблицы", "platform": "YouTube", "url": "", "telegram": "", "sheet_row": []}], ["YouTube"]
        )
        assert result["total"] == 1
        # таблица пересобрана: в базе агентства только строка из таблицы
        assert [b.name for b in db.query(BloggerProfile).all()] == ["Из таблицы"]
    finally:
        db.close()

    names = [x["name"] for x in client.get("/api/own-bloggers", headers=h).json()]
    assert "Свой переживёт синк" in names
    assert own["id"] in [x["id"] for x in client.get("/api/own-bloggers", headers=h).json()]
