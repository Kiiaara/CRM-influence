"""Изоляция воркспейсов: приглашённый в один проект не должен видеть чужой.

Сценарий на всех тестах один: Лера (админ) владеет "Основным" пространством,
Гость (editor) приглашён только в "Клиентский". Гость не должен видеть ни данных
Основного, ни людей, которые там работают.
"""
from datetime import datetime, timedelta

import pytest

from fastapi.testclient import TestClient

import main
from database import Base, engine, SessionLocal
from models.user import User
from models.auth_session import AuthSession
from models.workspace import Workspace, WorkspaceMember
from models.integration import Integration
from models.task import Task

# база общая на весь прогон (см. conftest), поэтому у каждого файла свой диапазон id
LERA_TG = 101001
GUEST_TG = 101002
STRANGER_TG = 101003


@pytest.fixture(scope="module")
def ctx():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    db.add(User(tg_id=LERA_TG, role="admin", label="Лера"))
    db.add(User(tg_id=GUEST_TG, role="editor", label="Гость"))
    db.commit()

    main_ws = Workspace(title="Основное", owner_tg_id=LERA_TG)
    client_ws = Workspace(title="Клиентский", owner_tg_id=LERA_TG)
    db.add_all([main_ws, client_ws])
    db.commit()
    db.refresh(main_ws)
    db.refresh(client_ws)

    now = datetime.now()
    db.add_all([
        WorkspaceMember(workspace_id=main_ws.id, user_tg_id=LERA_TG, role="owner", joined_at=now),
        WorkspaceMember(workspace_id=client_ws.id, user_tg_id=LERA_TG, role="owner", joined_at=now),
        # гость только в клиентском
        WorkspaceMember(workspace_id=client_ws.id, user_tg_id=GUEST_TG, role="lead", joined_at=now),
    ])

    # секретная сделка в основном пространстве
    secret = Integration(workspace_id=main_ws.id, brand="СекретБренд", description="не для гостя")
    db.add(secret)
    db.add(Task(workspace_id=main_ws.id, title="Секретная задача"))
    db.commit()
    db.refresh(secret)

    expires = datetime.now() + timedelta(days=1)
    db.add_all([
        AuthSession(token="iso-lera", tg_id=LERA_TG, expires_at=expires),
        AuthSession(token="iso-guest", tg_id=GUEST_TG, expires_at=expires),
    ])
    db.commit()

    data = {
        "main_ws_id": main_ws.id,
        "client_ws_id": client_ws.id,
        "secret_integration_id": secret.id,
    }
    db.close()

    with TestClient(main.app) as client:
        yield client, data



def _as(client, token: str, ws_id: int | None = None):
    client.cookies.set("zametochnitsa_session", token)
    headers = {}
    if ws_id is not None:
        headers["X-Workspace-Id"] = str(ws_id)
    return headers


def test_guest_cannot_read_other_workspace_integrations(ctx):
    """Гость подставляет id чужого пространства в заголовок - не должен получить чужие сделки."""
    client, data = ctx
    headers = _as(client, "iso-guest", data["main_ws_id"])
    r = client.get("/api/integrations", headers=headers)
    assert r.status_code == 200
    brands = [it["brand"] for it in r.json()]
    assert "СекретБренд" not in brands


def test_guest_cannot_open_secret_integration_by_id(ctx):
    """Прямой доступ по id чужой сделки."""
    client, data = ctx
    headers = _as(client, "iso-guest", data["main_ws_id"])
    r = client.get(f"/api/integrations/{data['secret_integration_id']}", headers=headers)
    assert r.status_code == 404


def test_guest_cannot_read_other_workspace_tasks(ctx):
    client, data = ctx
    headers = _as(client, "iso-guest", data["main_ws_id"])
    r = client.get("/api/tasks", headers=headers)
    assert r.status_code == 200
    titles = [t["title"] for t in r.json()]
    assert "Секретная задача" not in titles


def test_guest_sees_only_coworkers_in_users_list(ctx):
    """Гость делит с Лерой клиентское пространство, так что Леру видит.
    Но если появится человек из чужого проекта - видеть его гость не должен."""
    client, data = ctx

    db = SessionLocal()
    db.add(User(tg_id=STRANGER_TG, role="editor", label="Чужой"))
    db.commit()
    db.add(WorkspaceMember(
        workspace_id=data["main_ws_id"], user_tg_id=STRANGER_TG, role="lead", joined_at=datetime.now()
    ))
    db.commit()
    db.close()

    headers = _as(client, "iso-guest", data["client_ws_id"])
    r = client.get("/api/users", headers=headers)
    assert r.status_code == 200
    ids = [u["tg_id"] for u in r.json()]
    assert STRANGER_TG not in ids, "гость видит юзера из чужого пространства"
    assert LERA_TG in ids, "гость должен видеть коллегу по общему пространству"


def test_admin_sees_all_users(ctx):
    client, data = ctx
    headers = _as(client, "iso-lera", data["main_ws_id"])
    r = client.get("/api/users", headers=headers)
    assert r.status_code == 200
    ids = [u["tg_id"] for u in r.json()]
    assert {LERA_TG, GUEST_TG, STRANGER_TG}.issubset(set(ids))


def test_guest_cannot_create_workspace(ctx):
    """Новые пространства заводит только админ."""
    client, data = ctx
    headers = _as(client, "iso-guest", data["client_ws_id"])
    r = client.post("/api/workspaces", json={"title": "Гостевое"}, headers=headers)
    assert r.status_code == 403


def test_admin_can_create_workspace(ctx):
    client, data = ctx
    headers = _as(client, "iso-lera", data["main_ws_id"])
    r = client.post("/api/workspaces", json={"title": "Ещё одно"}, headers=headers)
    assert r.status_code == 201


def test_guest_workspace_list_excludes_foreign(ctx):
    client, data = ctx
    headers = _as(client, "iso-guest", data["client_ws_id"])
    r = client.get("/api/workspaces", headers=headers)
    assert r.status_code == 200
    titles = [w["title"] for w in r.json()]
    assert "Основное" not in titles
    assert "Клиентский" in titles


def test_add_user_with_workspace_creates_membership(ctx):
    """Админ добавляет юзера сразу в конкретное пространство - одним действием."""
    client, data = ctx
    headers = _as(client, "iso-lera", data["main_ws_id"])
    r = client.post(
        "/api/users",
        json={
            "tg_id": 101004,
            "role": "editor",
            "label": "Новенький",
            "workspace_id": data["client_ws_id"],
            "workspace_role": "viewer",
        },
        headers=headers,
    )
    assert r.status_code == 201

    db = SessionLocal()
    m = db.query(WorkspaceMember).filter_by(
        workspace_id=data["client_ws_id"], user_tg_id=101004
    ).first()
    db.close()
    assert m is not None, "юзер не попал в указанное пространство"
    assert m.role == "viewer"


def test_guest_cannot_export_streamer_profiles(ctx):
    """Выгрузка всего медиакита в Excel - только для админа."""
    client, data = ctx
    headers = _as(client, "iso-guest", data["client_ws_id"])
    r = client.get("/api/streamer-profiles/export", headers=headers)
    assert r.status_code == 403
