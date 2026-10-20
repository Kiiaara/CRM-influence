"""Ник блогера в кампании: ссылку по имени ищем в базе агентства, своей базе и базе инфлюенсеров."""
import json
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

import main
from database import Base, SessionLocal, engine
from models.auth_session import AuthSession
from models.blogger_profile import BloggerProfile
from models.own_blogger import OwnBlogger
from models.streamer_profile import StreamerProfile
from models.user import User
from models.workspace import Workspace, WorkspaceMember

# 120xxx - диапазон этого файла, токены nick-
ME = 120001
OUT = 120002


@pytest.fixture(scope="module")
def ctx():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.add_all([
        User(tg_id=ME, role="admin", label="Лера"),
        User(tg_id=OUT, role="editor", label="Чужой"),
    ])
    db.commit()
    my_ws = Workspace(title="Ники", owner_tg_id=ME)
    other_ws = Workspace(title="Чужие ники", owner_tg_id=OUT)
    db.add_all([my_ws, other_ws])
    db.commit()
    now = datetime.now()
    db.add_all([
        WorkspaceMember(workspace_id=my_ws.id, user_tg_id=ME, role="owner", joined_at=now),
        WorkspaceMember(workspace_id=other_ws.id, user_tg_id=OUT, role="owner", joined_at=now),
        AuthSession(token="nick-me", tg_id=ME, expires_at=now + timedelta(days=1)),
        # база агентства: url пустой, ссылка только в sheet_row (как у записей из гугл-таблицы)
        BloggerProfile(
            name="Энергичная Ева", platform="Instagram", source="sheet",
            sheet_row=json.dumps([
                {"h": "Имя", "v": "Энергичная Ева"},
                {"h": "Ссылка", "v": "instagram", "u": "https://instagram.com/yaevochkaura"},
            ], ensure_ascii=False),
        ),
        # своя база этого пространства и чужого
        OwnBlogger(workspace_id=my_ws.id, name="Свой Вася", url="https://youtube.com/@nickvasya"),
        OwnBlogger(workspace_id=other_ws.id, name="Чужой Петя", url="https://youtube.com/@nickpetya"),
        # база инфлюенсеров: голый ник в twitch_url
        StreamerProfile(name="Анар Абдуллаев", twitch_url="anarabdullaev"),
    ])
    db.commit()
    data = {"ws_id": my_ws.id}
    db.close()
    with TestClient(main.app) as client:
        yield client, data


def _h(client, ws_id):
    client.cookies.set("zametochnitsa_session", "nick-me")
    return {"X-Workspace-Id": str(ws_id)}


def _campaign(client, h):
    r = client.post("/api/campaigns", json={"name": "РК ники"}, headers=h)
    assert r.status_code == 201
    return r.json()["id"]


def _add(client, h, cid, name):
    r = client.post(f"/api/campaigns/{cid}/bloggers", json={"name": name}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def _list(client, h, cid):
    r = client.get(f"/api/campaigns/{cid}/bloggers", headers=h)
    assert r.status_code == 200
    return {b["name"]: b for b in r.json()}


def test_agency_base_link_only_in_sheet_row(ctx):
    client, data = ctx
    h = _h(client, data["ws_id"])
    cid = _campaign(client, h)
    _add(client, h, cid, "Энергичная Ева")
    assert "yaevochkaura" in _list(client, h, cid)["Энергичная Ева"]["link"]


def test_own_base(ctx):
    client, data = ctx
    h = _h(client, data["ws_id"])
    cid = _campaign(client, h)
    _add(client, h, cid, "Свой Вася")
    assert "nickvasya" in _list(client, h, cid)["Свой Вася"]["link"]


def test_influencer_base_bare_nick(ctx):
    client, data = ctx
    h = _h(client, data["ws_id"])
    cid = _campaign(client, h)
    _add(client, h, cid, "Анар Абдуллаев")
    assert _list(client, h, cid)["Анар Абдуллаев"]["link"] == "anarabdullaev"


def test_unknown_blogger_empty(ctx):
    client, data = ctx
    h = _h(client, data["ws_id"])
    cid = _campaign(client, h)
    _add(client, h, cid, "Никому Неизвестный")
    assert _list(client, h, cid)["Никому Неизвестный"]["link"] == ""


def test_case_and_spaces_insensitive(ctx):
    client, data = ctx
    h = _h(client, data["ws_id"])
    cid = _campaign(client, h)
    # кириллица в другом регистре плюс лишние пробелы внутри и по краям
    b = _add(client, h, cid, "  энергичная   ЕВА ")
    assert "yaevochkaura" in b["link"]


def test_foreign_workspace_own_base_not_used(ctx):
    client, data = ctx
    h = _h(client, data["ws_id"])
    cid = _campaign(client, h)
    _add(client, h, cid, "Чужой Петя")
    assert _list(client, h, cid)["Чужой Петя"]["link"] == ""


def test_no_n_plus_one(ctx):
    """Число SQL-запросов на список не зависит от числа блогеров."""
    client, data = ctx
    h = _h(client, data["ws_id"])
    names = ["Энергичная Ева", "Свой Вася", "Анар Абдуллаев", "Никому Неизвестный"]

    def count_queries(cid):
        n = []
        def on_exec(*_a, **_k):
            n.append(1)
        event.listen(engine, "before_cursor_execute", on_exec)
        try:
            client.get(f"/api/campaigns/{cid}/bloggers", headers=h)
        finally:
            event.remove(engine, "before_cursor_execute", on_exec)
        return len(n)

    # в обоих списках есть совпадения во всех трёх базах (иначе лишний запрос за полями
    # не выполняется и счёт отличается не из-за N+1), размер отличается в 5 раз
    small = _campaign(client, h)
    for nm in names:
        _add(client, h, small, nm)
    big = _campaign(client, h)
    for i in range(5):
        for nm in names:
            _add(client, h, big, nm if i == 0 else f"{nm} {i}")
    assert count_queries(big) == count_queries(small)
