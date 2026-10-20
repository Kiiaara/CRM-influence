"""Модалка блогера в кампании: договор ссылкой, контакты рекламодателя,
ссылка на вышедшую интеграцию и скриншоты интеграции.

Диапазон id 122xxx, токены doc-.
"""
import os
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text

import main
from database import Base, engine, SessionLocal
from models.user import User
from models.auth_session import AuthSession
from models.workspace import Workspace, WorkspaceMember
from models.advertiser import Advertiser
from models.integration import Integration
from models.integration_streamer import IntegrationStreamer
from models.integration_screenshot import IntegrationScreenshot
from routers import integrations as integrations_router

MY_TG = 122001
OUT_TG = 122002

# длинное тире собираем из кода, чтобы его не было в самом файле
DASH = chr(0x2014)

FRONT = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "src")

# минимальные «картинки»: достаточно сигнатуры файла
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
JPG = b"\xff\xd8\xff\xe0" + b"0" * 64
GIF = b"GIF89a" + b"0" * 64
WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"0" * 64


def _read_front(*parts: str) -> str:
    with open(os.path.join(FRONT, *parts), encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def ctx(tmp_path_factory):
    # скриншоты кладём во временную папку, не в data/ проекта
    integrations_router.SCREENSHOT_DIR = str(tmp_path_factory.mktemp("shots"))
    integrations_router.CASE_PHOTO_DIR = str(tmp_path_factory.mktemp("case_photos"))
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.add_all([
        User(tg_id=MY_TG, role="admin", label="Лера"),
        User(tg_id=OUT_TG, role="editor", label="Чужой"),
    ])
    db.commit()
    my_ws = Workspace(title="Мой проект", owner_tg_id=MY_TG)
    other_ws = Workspace(title="Чужой проект", owner_tg_id=OUT_TG)
    db.add_all([my_ws, other_ws])
    db.commit()
    now = datetime.now()
    db.add_all([
        WorkspaceMember(workspace_id=my_ws.id, user_tg_id=MY_TG, role="owner", joined_at=now),
        WorkspaceMember(workspace_id=other_ws.id, user_tg_id=OUT_TG, role="owner", joined_at=now),
        AuthSession(token="doc-lera", tg_id=MY_TG, expires_at=now + timedelta(days=1)),
        AuthSession(token="doc-outsider", tg_id=OUT_TG, expires_at=now + timedelta(days=1)),
    ])
    adv = Advertiser(workspace_id=my_ws.id, name="Бренд Док")
    db.add(adv)
    db.commit()
    data = {"ws_id": my_ws.id, "other_ws_id": other_ws.id, "adv_id": adv.id}
    db.close()
    with TestClient(main.app) as client:
        yield client, data


def _h(client, token: str, ws_id: int):
    client.cookies.set("zametochnitsa_session", token)
    return {"X-Workspace-Id": str(ws_id)}


def _mk_streamer(client, data, adv_id="default"):
    """Сделка + участник через API. Возвращает (streamer, integration, headers)."""
    headers = _h(client, "doc-lera", data["ws_id"])
    aid = data["adv_id"] if adv_id == "default" else adv_id
    it = client.post("/api/integrations", json={"advertiser_id": aid}, headers=headers)
    assert it.status_code == 201, it.text
    s = client.post(f"/api/integrations/{it.json()['id']}/streamers", json={"streamer_name": "Блогер Док"}, headers=headers)
    assert s.status_code == 201, s.text
    return s.json(), it.json(), headers


def _upload(client, sid, headers, name="shot.png", content=PNG, mime="image/png"):
    return client.post(
        f"/api/integrations/streamers/{sid}/screenshots",
        files={"file": (name, content, mime)},
        headers=headers,
    )


# ---------- 1. договор и публикация ссылками ----------

def test_contract_and_publication_url_saved_and_returned(ctx):
    client, data = ctx
    s, _, headers = _mk_streamer(client, data)
    assert s["contract_url"] == ""
    assert s["publication_url"] == ""
    r = client.patch(
        f"/api/integrations/streamers/{s['id']}",
        json={"contract_url": "https://sign.example/doc1", "publication_url": "https://t.me/chan/55"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["contract_url"] == "https://sign.example/doc1"
    assert r.json()["publication_url"] == "https://t.me/chan/55"
    got = client.get(f"/api/integrations/streamers/{s['id']}", headers=headers).json()
    assert got["contract_url"] == "https://sign.example/doc1"
    assert got["publication_url"] == "https://t.me/chan/55"
    # ссылку можно стереть
    r = client.patch(f"/api/integrations/streamers/{s['id']}", json={"contract_url": ""}, headers=headers)
    assert r.json()["contract_url"] == ""
    assert r.json()["publication_url"] == "https://t.me/chan/55"


def test_urls_also_in_integrations_list(ctx):
    """Канбан читает список сделок: ссылки должны быть и там."""
    client, data = ctx
    s, it, headers = _mk_streamer(client, data)
    client.patch(f"/api/integrations/streamers/{s['id']}", json={"contract_url": "https://x.example/c"}, headers=headers)
    rows = client.get("/api/integrations", headers=headers).json()
    mine = next(i for i in rows if i["id"] == it["id"])
    assert mine["streamers"][0]["contract_url"] == "https://x.example/c"


# ---------- 2. контакты рекламодателя ----------

def test_streamer_gets_advertiser_name(ctx):
    # контакты рекламодателя (BrandContact) проверяет test_followup_123.py
    client, data = ctx
    s, it, headers = _mk_streamer(client, data)
    got = client.get(f"/api/integrations/streamers/{s['id']}", headers=headers).json()
    assert got["advertiser"]["name"] == "Бренд Док"


def test_streamer_without_advertiser_has_null(ctx):
    client, data = ctx
    headers = _h(client, "doc-lera", data["ws_id"])
    db = SessionLocal()
    it = Integration(workspace_id=data["ws_id"], advertiser_id=None, brand="Без рекламодателя")
    db.add(it)
    db.commit()
    s = IntegrationStreamer(integration_id=it.id, streamer_name="Одиночка")
    db.add(s)
    db.commit()
    sid = s.id
    db.close()
    got = client.get(f"/api/integrations/streamers/{sid}", headers=headers)
    assert got.status_code == 200
    assert got.json()["advertiser"] is None


# ---------- 3. скриншоты ----------

def test_screenshot_upload_list_download_delete(ctx):
    client, data = ctx
    s, _, headers = _mk_streamer(client, data)
    r = _upload(client, s["id"], headers)
    assert r.status_code == 201, r.text
    shot = r.json()
    assert shot["file_name"] == "shot.png"
    assert shot["size_bytes"] == len(PNG)
    lst = client.get(f"/api/integrations/streamers/{s['id']}/screenshots", headers=headers).json()
    assert [x["id"] for x in lst] == [shot["id"]]
    dl = client.get(f"/api/integrations/screenshots/{shot['id']}", headers=headers)
    assert dl.status_code == 200
    assert dl.content == PNG
    assert dl.headers["content-type"].startswith("image/png")
    assert dl.headers["content-disposition"].startswith("inline")
    assert client.delete(f"/api/integrations/screenshots/{shot['id']}", headers=headers).status_code == 200
    assert client.get(f"/api/integrations/streamers/{s['id']}/screenshots", headers=headers).json() == []
    assert client.get(f"/api/integrations/screenshots/{shot['id']}", headers=headers).status_code == 404


def test_screenshot_several_and_all_formats(ctx):
    client, data = ctx
    s, _, headers = _mk_streamer(client, data)
    for name, body in (("a.png", PNG), ("b.jpg", JPG), ("c.jpeg", JPG), ("d.gif", GIF), ("e.webp", WEBP)):
        assert _upload(client, s["id"], headers, name=name, content=body).status_code == 201, name
    lst = client.get(f"/api/integrations/streamers/{s['id']}/screenshots", headers=headers).json()
    assert [x["file_name"] for x in lst] == ["a.png", "b.jpg", "c.jpeg", "d.gif", "e.webp"]


def test_screenshot_rejects_non_image(ctx):
    client, data = ctx
    s, _, headers = _mk_streamer(client, data)
    # неверное расширение
    assert _upload(client, s["id"], headers, name="doc.pdf", content=b"%PDF-1.4 abc", mime="application/pdf").status_code == 400
    # картинка по имени, но внутри текст
    assert _upload(client, s["id"], headers, name="fake.png", content=b"just text, not an image").status_code == 400
    # исполняемое под видом картинки
    assert _upload(client, s["id"], headers, name="evil.svg", content=b"<svg onload=alert(1)>", mime="image/svg+xml").status_code == 400
    assert client.get(f"/api/integrations/streamers/{s['id']}/screenshots", headers=headers).json() == []


def test_screenshot_rejects_too_big(ctx, monkeypatch):
    client, data = ctx
    s, _, headers = _mk_streamer(client, data)
    monkeypatch.setattr(integrations_router, "MAX_SCREENSHOT_BYTES", 100)
    r = _upload(client, s["id"], headers, content=PNG + b"0" * 200)
    assert r.status_code == 400
    assert "МБ" in r.json()["detail"] or "больше" in r.json()["detail"]


def test_screenshot_workspace_isolation(ctx):
    client, data = ctx
    s, _, headers = _mk_streamer(client, data)
    shot = _upload(client, s["id"], headers).json()
    out = _h(client, "doc-outsider", data["other_ws_id"])
    assert client.get(f"/api/integrations/streamers/{s['id']}/screenshots", headers=out).status_code == 404
    assert _upload(client, s["id"], out).status_code == 404
    assert client.get(f"/api/integrations/screenshots/{shot['id']}", headers=out).status_code == 404
    assert client.delete(f"/api/integrations/screenshots/{shot['id']}", headers=out).status_code == 404
    # свой всё ещё на месте
    mine = _h(client, "doc-lera", data["ws_id"])
    assert client.get(f"/api/integrations/screenshots/{shot['id']}", headers=mine).status_code == 200


def test_delete_streamer_removes_screenshots_and_files(ctx):
    client, data = ctx
    s, _, headers = _mk_streamer(client, data)
    shot = _upload(client, s["id"], headers).json()
    db = SessionLocal()
    path = db.get(IntegrationScreenshot, shot["id"]).file_path
    db.close()
    assert os.path.exists(path)
    assert client.delete(f"/api/integrations/streamers/{s['id']}", headers=headers).status_code == 200
    db = SessionLocal()
    assert db.get(IntegrationScreenshot, shot["id"]) is None
    db.close()
    assert not os.path.exists(path)


def test_delete_integration_cascades_screenshots(ctx):
    client, data = ctx
    s, it, headers = _mk_streamer(client, data)
    shot = _upload(client, s["id"], headers).json()
    db = SessionLocal()
    path = db.get(IntegrationScreenshot, shot["id"]).file_path
    db.close()
    assert client.delete(f"/api/integrations/{it['id']}", headers=headers).status_code == 200
    db = SessionLocal()
    assert db.query(IntegrationScreenshot).filter(IntegrationScreenshot.id == shot["id"]).count() == 0
    db.close()
    assert not os.path.exists(path)


def test_case_gets_first_screenshot_as_photo(ctx):
    client, data = ctx
    s, _, headers = _mk_streamer(client, data)
    _upload(client, s["id"], headers, name="first.png", content=PNG)
    _upload(client, s["id"], headers, name="second.jpg", content=JPG)
    case = client.post(f"/api/integrations/streamers/{s['id']}/cases", json={"title": "Кейс"}, headers=headers).json()
    assert case["photo_name"] == "first.png"
    photo = client.get(f"/api/integrations/cases/{case['id']}/photo", headers=headers)
    assert photo.status_code == 200 and photo.content == PNG
    # удаление фото кейса не трогает сам скриншот
    client.delete(f"/api/integrations/cases/{case['id']}/photo", headers=headers)
    lst = client.get(f"/api/integrations/streamers/{s['id']}/screenshots", headers=headers).json()
    assert len(lst) == 2
    assert client.get(f"/api/integrations/screenshots/{lst[0]['id']}", headers=headers).content == PNG


def test_case_without_screenshots_has_no_photo(ctx):
    client, data = ctx
    s, _, headers = _mk_streamer(client, data)
    case = client.post(f"/api/integrations/streamers/{s['id']}/cases", json={"title": "Кейс"}, headers=headers).json()
    assert case["photo_name"] is None


# ---------- миграции ----------

def test_migrations_add_columns_idempotently(tmp_path, monkeypatch):
    eng = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with eng.begin() as conn:
        conn.execute(text("CREATE TABLE integration_streamers (id INTEGER PRIMARY KEY, streamer_name VARCHAR(255))"))
        conn.execute(text("INSERT INTO integration_streamers (id, streamer_name) VALUES (1, 'старый')"))
    monkeypatch.setattr(main, "engine", eng)
    main._migrate_streamers_add_contract_url()
    main._migrate_streamers_add_contract_url()
    main._migrate_streamers_add_publication_url()
    main._migrate_streamers_add_publication_url()
    insp = inspect(eng)
    scols = [c["name"] for c in insp.get_columns("integration_streamers")]
    assert "contract_url" in scols and "publication_url" in scols
    with eng.begin() as conn:
        assert conn.execute(text("SELECT streamer_name FROM integration_streamers WHERE id=1")).scalar() == "старый"
        assert conn.execute(text("SELECT contract_url FROM integration_streamers WHERE id=1")).scalar() in ("", None)


def test_migrations_skip_missing_tables(tmp_path, monkeypatch):
    eng = create_engine(f"sqlite:///{tmp_path / 'empty.db'}")
    monkeypatch.setattr(main, "engine", eng)
    main._migrate_streamers_add_contract_url()
    main._migrate_streamers_add_publication_url()


def test_migrations_registered_in_lifespan():
    src = open(os.path.join(os.path.dirname(__file__), "..", "main.py"), encoding="utf-8").read()
    for name in ("_migrate_streamers_add_contract_url", "_migrate_streamers_add_publication_url"):
        assert src.count(f"{name}()") >= 2, name  # определение + вызов в lifespan


# ---------- фронт (статические проверки) ----------

def test_front_modal_has_new_blocks():
    modal = _read_front("components", "CampaignBloggerModal.tsx")
    assert "Ссылка на вышедшую интеграцию" in modal
    assert "Скриншоты интеграции" in modal
    assert "Рекламодатель" in modal
    assert "contract_url" in modal and "publication_url" in modal
    parts = _read_front("components", "DealParts.tsx")
    assert "export function Screenshots" in parts
    assert "export function AdvertiserCard" in parts


def test_front_board_has_new_fields():
    board = _read_front("pages", "IntegrationsBoard.tsx")
    assert "contract_url" in board and "publication_url" in board


def test_no_long_dashes_in_changed_files():
    files = [
        ("components", "CampaignBloggerModal.tsx"),
        ("components", "DealParts.tsx"),
        ("pages", "IntegrationsBoard.tsx"),
        ("pages", "AdvertisersPage.tsx"),
        ("api", "integrations.ts"),
        ("api", "advertisers.ts"),
    ]
    for parts in files:
        assert DASH not in _read_front(*parts), parts
    back = os.path.join(os.path.dirname(__file__), "..")
    for rel in ("main.py", os.path.join("routers", "integrations.py"), os.path.join("routers", "advertisers.py"),
                os.path.join("models", "integration_screenshot.py"), os.path.join("models", "advertiser.py"),
                os.path.join("models", "integration_streamer.py")):
        with open(os.path.join(back, rel), encoding="utf-8") as f:
            assert DASH not in f.read(), rel
