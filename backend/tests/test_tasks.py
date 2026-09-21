"""Задачник: назначение исполнителя, изоляция по пространству, уведомления.

Проверяем главное: задачу можно поставить только участнику своего проекта,
и на неё ставится флаг, по которому планировщик шлёт TG-уведомление.
"""
from datetime import datetime, timedelta

import pytest

from fastapi.testclient import TestClient

import main
from database import Base, engine, SessionLocal
from models.user import User
from models.auth_session import AuthSession
from models.workspace import Workspace, WorkspaceMember
from models.task import Task

LERA_TG = 102001
HELPER_TG = 102002
OUTSIDER_TG = 102003


@pytest.fixture(scope="module")
def ctx():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    db.add_all([
        User(tg_id=LERA_TG, role="admin", label="Лера"),
        User(tg_id=HELPER_TG, role="editor", label="Помощница"),
        User(tg_id=OUTSIDER_TG, role="editor", label="Чужой"),
    ])
    db.commit()

    main_ws = Workspace(title="Основное", owner_tg_id=LERA_TG)
    other_ws = Workspace(title="Чужое", owner_tg_id=OUTSIDER_TG)
    db.add_all([main_ws, other_ws])
    db.commit()
    db.refresh(main_ws)
    db.refresh(other_ws)

    now = datetime.now()
    db.add_all([
        WorkspaceMember(workspace_id=main_ws.id, user_tg_id=LERA_TG, role="owner", joined_at=now),
        WorkspaceMember(workspace_id=main_ws.id, user_tg_id=HELPER_TG, role="lead", joined_at=now),
        WorkspaceMember(workspace_id=other_ws.id, user_tg_id=OUTSIDER_TG, role="owner", joined_at=now),
    ])

    expires = now + timedelta(days=1)
    db.add_all([
        AuthSession(token="task-lera", tg_id=LERA_TG, expires_at=expires),
        AuthSession(token="task-helper", tg_id=HELPER_TG, expires_at=expires),
    ])
    db.commit()

    data = {"main_ws_id": main_ws.id, "other_ws_id": other_ws.id}
    db.close()

    with TestClient(main.app) as client:
        yield client, data



def _as(client, token: str, ws_id: int):
    client.cookies.set("zametochnitsa_session", token)
    return {"X-Workspace-Id": str(ws_id)}


def test_workspace_members_endpoint_lists_only_this_project(ctx):
    """Выпадашка исполнителей: только те, кто в текущем пространстве."""
    client, data = ctx
    headers = _as(client, "task-lera", data["main_ws_id"])
    r = client.get("/api/tasks/assignees", headers=headers)
    assert r.status_code == 200
    ids = [u["tg_id"] for u in r.json()]
    assert set(ids) == {LERA_TG, HELPER_TG}
    assert OUTSIDER_TG not in ids


def test_create_task_with_assignee(ctx):
    client, data = ctx
    headers = _as(client, "task-lera", data["main_ws_id"])
    due = (datetime.now() + timedelta(days=2)).replace(microsecond=0)
    r = client.post(
        "/api/tasks",
        json={
            "title": "Согласовать ТЗ с брендом",
            "description": "до созвона",
            "due_at": due.isoformat(),
            "assignee_tg_id": HELPER_TG,
        },
        headers=headers,
    )
    assert r.status_code == 201
    body = r.json()
    assert body["assignee_tg_id"] == HELPER_TG
    assert body["title"] == "Согласовать ТЗ с брендом"

    # флаг должен быть False - иначе планировщик не отправит уведомление
    db = SessionLocal()
    t = db.get(Task, body["id"])
    assert t.notified_assigned is False, "задача помечена как уведомлённая, TG-пуш не уйдёт"
    assert t.created_by_tg_id == LERA_TG
    db.close()


def test_cannot_assign_to_outsider(ctx):
    """Нельзя поставить задачу тому, кого нет в этом пространстве."""
    client, data = ctx
    headers = _as(client, "task-lera", data["main_ws_id"])
    r = client.post(
        "/api/tasks",
        json={"title": "Чужая задача", "assignee_tg_id": OUTSIDER_TG},
        headers=headers,
    )
    assert r.status_code == 400


def test_task_visible_to_coworker(ctx):
    client, data = ctx
    headers = _as(client, "task-helper", data["main_ws_id"])
    r = client.get("/api/tasks", headers=headers)
    assert r.status_code == 200
    titles = [t["title"] for t in r.json()]
    assert "Согласовать ТЗ с брендом" in titles


def test_task_out_includes_assignee_label(ctx):
    """В списке нужно имя исполнителя, а не голый tg_id."""
    client, data = ctx
    headers = _as(client, "task-lera", data["main_ws_id"])
    r = client.get("/api/tasks", headers=headers)
    assert r.status_code == 200
    task = next(t for t in r.json() if t["title"] == "Согласовать ТЗ с брендом")
    assert task.get("assignee_label") == "Помощница"


def test_reassign_resets_notification_flag(ctx):
    """Переназначили - человек должен получить своё уведомление."""
    client, data = ctx
    headers = _as(client, "task-lera", data["main_ws_id"])

    db = SessionLocal()
    t = db.query(Task).filter_by(title="Согласовать ТЗ с брендом").first()
    t.notified_assigned = True
    db.commit()
    task_id = t.id
    db.close()

    r = client.patch(f"/api/tasks/{task_id}", json={"assignee_tg_id": LERA_TG}, headers=headers)
    assert r.status_code == 200

    db = SessionLocal()
    t = db.get(Task, task_id)
    assert t.notified_assigned is False
    db.close()


def test_cannot_touch_task_from_other_workspace(ctx):
    client, data = ctx

    db = SessionLocal()
    foreign = Task(workspace_id=data["other_ws_id"], title="Не моя задача")
    db.add(foreign)
    db.commit()
    db.refresh(foreign)
    foreign_id = foreign.id
    db.close()

    headers = _as(client, "task-lera", data["main_ws_id"])
    r = client.patch(f"/api/tasks/{foreign_id}", json={"title": "взлом"}, headers=headers)
    assert r.status_code == 404
