"""Привязка VK ID: вход через VK для тех, кого завела админ.

VK ID - отдельное поле, а не то же самое, что TG ID. Проверяем, что его можно
задать при создании и позже, что он уникален, и что человека можно завести
вообще без Telegram (тогда он работает, но без уведомлений).
"""
from datetime import datetime, timedelta

import pytest

from fastapi.testclient import TestClient

import main
from database import Base, engine, SessionLocal
from models.user import User
from models.auth_session import AuthSession
from models.workspace import Workspace, WorkspaceMember

LERA_TG = 103001


@pytest.fixture(scope="module")
def ctx():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    db.add(User(tg_id=LERA_TG, role="admin", label="Лера"))
    db.commit()

    ws = Workspace(title="Основное", owner_tg_id=LERA_TG)
    db.add(ws)
    db.commit()
    db.refresh(ws)

    now = datetime.now()
    db.add(WorkspaceMember(workspace_id=ws.id, user_tg_id=LERA_TG, role="owner", joined_at=now))
    db.add(AuthSession(token="vk-lera", tg_id=LERA_TG, expires_at=now + timedelta(days=1)))
    db.commit()

    data = {"ws_id": ws.id}
    db.close()

    with TestClient(main.app) as client:
        client.cookies.set("zametochnitsa_session", "vk-lera")
        yield client, data



def _headers(data):
    return {"X-Workspace-Id": str(data["ws_id"])}


def test_create_user_with_vk_id(ctx):
    client, data = ctx
    r = client.post(
        "/api/users",
        json={"tg_id": 103002, "role": "editor", "label": "Коллега", "vk_id": 555001},
        headers=_headers(data),
    )
    assert r.status_code == 201
    assert r.json()["vk_id"] == 555001


def test_user_list_exposes_vk_id(ctx):
    client, data = ctx
    r = client.get("/api/users", headers=_headers(data))
    assert r.status_code == 200
    u = next(x for x in r.json() if x["tg_id"] == 103002)
    assert u["vk_id"] == 555001


def test_bind_vk_id_later(ctx):
    """Человек уже заведён по TG, прислал свой VK ID - привязываем."""
    client, data = ctx
    client.post("/api/users", json={"tg_id": 103003, "role": "editor"}, headers=_headers(data))

    r = client.patch("/api/users/103003", json={"vk_id": 555002}, headers=_headers(data))
    assert r.status_code == 200
    assert r.json()["vk_id"] == 555002


def test_unbind_vk_id(ctx):
    client, data = ctx
    r = client.patch("/api/users/103003", json={"vk_id": None}, headers=_headers(data))
    assert r.status_code == 200
    assert r.json()["vk_id"] is None


def test_duplicate_vk_id_rejected(ctx):
    """Один VK на двоих - это чужой вход в чужой аккаунт."""
    client, data = ctx
    r = client.post(
        "/api/users",
        json={"tg_id": 103004, "role": "editor", "vk_id": 555001},
        headers=_headers(data),
    )
    assert r.status_code == 400


def test_create_vk_only_user(ctx):
    """Без Telegram: tg_id не передан, человек заводится по одному VK ID."""
    client, data = ctx
    r = client.post(
        "/api/users",
        json={"role": "editor", "label": "Только ВК", "vk_id": 555003},
        headers=_headers(data),
    )
    assert r.status_code == 201
    body = r.json()
    assert body["vk_id"] == 555003
    # без TG уведомления невозможны - фронт должен это показать
    assert body["tg_chat_ready"] is False
    assert body["has_telegram"] is False


def test_user_without_tg_and_vk_rejected(ctx):
    client, data = ctx
    r = client.post("/api/users", json={"role": "editor", "label": "Никто"}, headers=_headers(data))
    assert r.status_code == 400


def test_vk_only_user_can_be_added_to_workspace(ctx):
    """У VK-юзера синтетический tg_id, и это не должно мешать доступу к проекту."""
    client, data = ctx
    r = client.post(
        "/api/users",
        json={
            "role": "editor",
            "label": "ВК в проекте",
            "vk_id": 555004,
            "workspace_id": data["ws_id"],
            "workspace_role": "viewer",
        },
        headers=_headers(data),
    )
    assert r.status_code == 201
    tg_id = r.json()["tg_id"]

    db = SessionLocal()
    m = db.query(WorkspaceMember).filter_by(workspace_id=data["ws_id"], user_tg_id=tg_id).first()
    db.close()
    assert m is not None
    assert m.role == "viewer"
