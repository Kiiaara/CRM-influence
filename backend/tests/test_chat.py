"""Чат: общая лента пространства + ветки по сделкам.

Раньше обсуждения жили только внутри карточки стримера. Теперь есть общий чат
пространства (streamer_id = None) и те же ветки по сделкам, собранные в один
раздел со списком слева.
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
from models.integration_streamer import IntegrationStreamer
from models.discussion_message import DiscussionMessage

LERA_TG = 104001
HELPER_TG = 104002
OUTSIDER_TG = 104003


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

    my_ws = Workspace(title="Мой проект", owner_tg_id=LERA_TG)
    other_ws = Workspace(title="Чужой проект", owner_tg_id=OUTSIDER_TG)
    db.add_all([my_ws, other_ws])
    db.commit()
    db.refresh(my_ws)
    db.refresh(other_ws)

    now = datetime.now()
    db.add_all([
        WorkspaceMember(workspace_id=my_ws.id, user_tg_id=LERA_TG, role="owner", joined_at=now),
        WorkspaceMember(workspace_id=my_ws.id, user_tg_id=HELPER_TG, role="lead", joined_at=now),
        WorkspaceMember(workspace_id=other_ws.id, user_tg_id=OUTSIDER_TG, role="owner", joined_at=now),
    ])

    it = Integration(workspace_id=my_ws.id, brand="БафБаф", description="")
    other_it = Integration(workspace_id=other_ws.id, brand="Чужой бренд", description="")
    db.add_all([it, other_it])
    db.commit()
    db.refresh(it)
    db.refresh(other_it)

    streamer = IntegrationStreamer(integration_id=it.id, streamer_name="Кияра")
    other_streamer = IntegrationStreamer(integration_id=other_it.id, streamer_name="Чужой стример")
    db.add_all([streamer, other_streamer])

    expires = now + timedelta(days=1)
    db.add_all([
        AuthSession(token="chat-lera", tg_id=LERA_TG, expires_at=expires),
        AuthSession(token="chat-helper", tg_id=HELPER_TG, expires_at=expires),
        AuthSession(token="chat-outsider", tg_id=OUTSIDER_TG, expires_at=expires),
    ])
    db.commit()
    db.refresh(streamer)
    db.refresh(other_streamer)

    data = {
        "ws_id": my_ws.id,
        "other_ws_id": other_ws.id,
        "streamer_id": streamer.id,
        "other_streamer_id": other_streamer.id,
    }
    db.close()

    with TestClient(main.app) as client:
        yield client, data


def _as(client, token: str, ws_id: int):
    client.cookies.set("zametochnitsa_session", token)
    return {"X-Workspace-Id": str(ws_id)}


def test_post_to_general_chat(ctx):
    """Общий чат пространства - без привязки к сделке."""
    client, data = ctx
    headers = _as(client, "chat-lera", data["ws_id"])
    r = client.post("/api/chat/messages", json={"text": "Всем привет"}, headers=headers)
    assert r.status_code == 201
    body = r.json()
    assert body["text"] == "Всем привет"
    assert body["streamer_id"] is None
    assert body["author_label"] == "Лера"


def test_read_general_chat(ctx):
    client, data = ctx
    headers = _as(client, "chat-helper", data["ws_id"])
    r = client.get("/api/chat/messages", headers=headers)
    assert r.status_code == 200
    texts = [m["text"] for m in r.json()]
    assert "Всем привет" in texts


def test_post_to_streamer_thread(ctx):
    client, data = ctx
    headers = _as(client, "chat-lera", data["ws_id"])
    r = client.post(
        "/api/chat/messages",
        json={"text": "Когда сдаём ролик?", "streamer_id": data["streamer_id"]},
        headers=headers,
    )
    assert r.status_code == 201
    assert r.json()["streamer_id"] == data["streamer_id"]


def test_general_chat_excludes_thread_messages(ctx):
    """Сообщения веток не должны протекать в общую ленту."""
    client, data = ctx
    headers = _as(client, "chat-lera", data["ws_id"])
    r = client.get("/api/chat/messages", headers=headers)
    texts = [m["text"] for m in r.json()]
    assert "Когда сдаём ролик?" not in texts


def test_thread_returns_only_its_messages(ctx):
    client, data = ctx
    headers = _as(client, "chat-lera", data["ws_id"])
    r = client.get("/api/chat/messages", params={"streamer_id": data["streamer_id"]}, headers=headers)
    assert r.status_code == 200
    texts = [m["text"] for m in r.json()]
    assert texts == ["Когда сдаём ролик?"]


def test_threads_list(ctx):
    """Список веток слева: сделка, последнее сообщение, счётчик."""
    client, data = ctx
    headers = _as(client, "chat-lera", data["ws_id"])
    r = client.get("/api/chat/threads", headers=headers)
    assert r.status_code == 200
    threads = r.json()
    mine = next(t for t in threads if t["streamer_id"] == data["streamer_id"])
    assert mine["streamer_name"] == "Кияра"
    assert mine["brand"] == "БафБаф"
    assert mine["messages_count"] == 1
    assert mine["last_message"] == "Когда сдаём ролик?"


def test_outsider_cannot_read_foreign_chat(ctx):
    """Чужой в своём пространстве не видит наших сообщений."""
    client, data = ctx
    headers = _as(client, "chat-outsider", data["other_ws_id"])
    r = client.get("/api/chat/messages", headers=headers)
    assert r.status_code == 200
    texts = [m["text"] for m in r.json()]
    assert "Всем привет" not in texts


def test_cannot_post_to_foreign_streamer_thread(ctx):
    client, data = ctx
    headers = _as(client, "chat-outsider", data["other_ws_id"])
    r = client.post(
        "/api/chat/messages",
        json={"text": "взлом", "streamer_id": data["streamer_id"]},
        headers=headers,
    )
    assert r.status_code == 404


def test_empty_message_rejected(ctx):
    client, data = ctx
    headers = _as(client, "chat-lera", data["ws_id"])
    r = client.post("/api/chat/messages", json={"text": "   "}, headers=headers)
    assert r.status_code == 400


def test_delete_own_message(ctx):
    client, data = ctx
    headers = _as(client, "chat-helper", data["ws_id"])
    posted = client.post("/api/chat/messages", json={"text": "опечатка"}, headers=headers).json()

    r = client.delete(f"/api/chat/messages/{posted['id']}", headers=headers)
    assert r.status_code == 200


def test_cannot_delete_someone_elses_message(ctx):
    client, data = ctx
    lera_headers = _as(client, "chat-lera", data["ws_id"])
    posted = client.post("/api/chat/messages", json={"text": "моё сообщение"}, headers=lera_headers).json()

    helper_headers = _as(client, "chat-helper", data["ws_id"])
    r = client.delete(f"/api/chat/messages/{posted['id']}", headers=helper_headers)
    assert r.status_code == 403


def test_old_streamer_discussions_visible_as_threads(ctx):
    """Переписка, заведённая до появления чата, не должна потеряться."""
    client, data = ctx

    db = SessionLocal()
    db.add(DiscussionMessage(streamer_id=data["streamer_id"], author_tg_id=LERA_TG, text="старое обсуждение"))
    db.commit()
    db.close()

    headers = _as(client, "chat-lera", data["ws_id"])
    r = client.get("/api/chat/messages", params={"streamer_id": data["streamer_id"]}, headers=headers)
    texts = [m["text"] for m in r.json()]
    assert "старое обсуждение" in texts
