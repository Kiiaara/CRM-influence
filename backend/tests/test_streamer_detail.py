"""Одна сделка по id: модалке блогера внутри кампании нужны полные данные,
чтобы не уходить на канбан. Плюс создание рекламодателя прямо из кампании."""
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

import main
from database import Base, SessionLocal, engine
from models.advertiser import Advertiser
from models.auth_session import AuthSession
from models.integration import Integration
from models.integration_streamer import IntegrationStreamer
from models.user import User
from models.workspace import Workspace, WorkspaceMember

# 110xxx - диапазон этого файла, токены sd-
LERA = 110001
OUTSIDER = 110002


@pytest.fixture(scope="module")
def ctx():
    # таблицы нужны до первого запроса, как в test_campaign_bloggers.py
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.add_all([
        User(tg_id=LERA, role="admin", label="Лера"),
        User(tg_id=OUTSIDER, role="editor", label="Чужой"),
    ])
    db.commit()
    ws = Workspace(title="Детали сделки", owner_tg_id=LERA)
    other_ws = Workspace(title="Чужое", owner_tg_id=OUTSIDER)
    db.add_all([ws, other_ws])
    db.commit()
    now = datetime.now()
    db.add_all([
        WorkspaceMember(workspace_id=ws.id, user_tg_id=LERA, role="owner", joined_at=now),
        WorkspaceMember(workspace_id=other_ws.id, user_tg_id=OUTSIDER, role="owner", joined_at=now),
        AuthSession(token="sd-lera", tg_id=LERA, expires_at=now + timedelta(days=1)),
        AuthSession(token="sd-outsider", tg_id=OUTSIDER, expires_at=now + timedelta(days=1)),
    ])
    adv = Advertiser(workspace_id=ws.id, name="Умскул", notes="")
    db.add(adv)
    db.commit()
    db.refresh(adv)

    it = Integration(workspace_id=ws.id, brand="Умскул", advertiser_id=adv.id)
    db.add(it)
    db.commit()
    db.refresh(it)
    s = IntegrationStreamer(integration_id=it.id, streamer_name="Лолита", talent_type="blogger")
    db.add(s)
    db.commit()
    db.refresh(s)

    ids = {"ws": ws.id, "other_ws": other_ws.id, "adv": adv.id, "it": it.id, "s": s.id}
    db.close()
    with TestClient(main.app) as client:
        yield client, ids


def _as(client, token: str, ws_id: int):
    client.cookies.set("zametochnitsa_session", token)
    return {"X-Workspace-Id": str(ws_id)}


def test_poluchaem_sdelku_po_id(ctx):
    """Модалка в кампании тянет сделку целиком, без захода на канбан."""
    client, ids = ctx
    h = _as(client, "sd-lera", ids["ws"])
    r = client.get(f"/api/integrations/streamers/{ids['s']}", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == ids["s"]
    assert body["streamer_name"] == "Лолита"
    # поля, которые правятся в модалке
    for field in ("amount", "payment_status", "brief", "deadline", "integration_date", "stage", "content_status"):
        assert field in body


def test_chuzhoy_ne_vidit_sdelku(ctx):
    client, ids = ctx
    h = _as(client, "sd-outsider", ids["other_ws"])
    r = client.get(f"/api/integrations/streamers/{ids['s']}", headers=h)
    assert r.status_code == 404


def test_pravka_poley_iz_modalki(ctx):
    """Сумма, ТЗ, даты и статусы правятся одним PATCH."""
    client, ids = ctx
    h = _as(client, "sd-lera", ids["ws"])
    r = client.patch(
        f"/api/integrations/streamers/{ids['s']}",
        json={
            "amount": 50000,
            "payment_status": "invoiced",
            "brief": "Рилс 60 секунд, показать приложение",
            "integration_date": "2026-11-01",
            "deadline": "2026-11-05",
            "content_status": "filming",
        },
        headers=h,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["amount"] == 50000
    assert body["payment_status"] == "invoiced"
    assert body["brief"].startswith("Рилс")
    assert body["content_status"] == "filming"


def test_sozdanie_reklamodatelya_iz_kampanii(ctx):
    """Нового рекламодателя можно завести на лету, он попадает в общий раздел."""
    client, ids = ctx
    h = _as(client, "sd-lera", ids["ws"])
    r = client.post("/api/advertisers", json={"name": "Новый бренд"}, headers=h)
    assert r.status_code in (200, 201), r.text
    new_id = r.json()["id"]

    # он виден в списке рекламодателей
    names = [a["name"] for a in client.get("/api/advertisers", headers=h).json()]
    assert "Новый бренд" in names

    # и его можно сразу назначить кампании
    c = client.post("/api/campaigns", json={"name": "РК на новом бренде"}, headers=h)
    assert c.status_code in (200, 201), c.text
    cid = c.json()["id"]
    upd = client.patch(f"/api/campaigns/{cid}", json={"advertiser_id": new_id}, headers=h)
    assert upd.status_code == 200, upd.text
    assert upd.json()["advertiser_id"] == new_id


def test_chuzhoy_reklamodatel_ne_privyazyvaetsya(ctx):
    """Рекламодателя другого пространства подсунуть нельзя."""
    client, ids = ctx
    ho = _as(client, "sd-outsider", ids["other_ws"])
    foreign = client.post("/api/advertisers", json={"name": "Чужой бренд"}, headers=ho).json()["id"]

    h = _as(client, "sd-lera", ids["ws"])
    cid = client.post("/api/campaigns", json={"name": "Проверка"}, headers=h).json()["id"]
    r = client.patch(f"/api/campaigns/{cid}", json={"advertiser_id": foreign}, headers=h)
    assert r.status_code == 400
