"""Поле erid у сделки с блогером: хранение, API, миграция, изоляция по пространству,
плюс правки модалки блогера (подписи, отступы, подвал)."""
import os
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text

import main
from database import Base, SessionLocal, engine
from models.advertiser import Advertiser
from models.auth_session import AuthSession
from models.integration import Integration
from models.integration_streamer import IntegrationStreamer
from models.user import User
from models.workspace import Workspace, WorkspaceMember

# 116xxx - диапазон этого файла, токены er-
LERA = 116001
OUTSIDER = 116002

FRONT = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "src")


def _read_front(*parts: str) -> str:
    with open(os.path.join(FRONT, *parts), encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def ctx():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.add_all([
        User(tg_id=LERA, role="admin", label="Лера"),
        User(tg_id=OUTSIDER, role="editor", label="Чужой"),
    ])
    db.commit()
    ws = Workspace(title="Erid", owner_tg_id=LERA)
    other_ws = Workspace(title="Erid чужое", owner_tg_id=OUTSIDER)
    db.add_all([ws, other_ws])
    db.commit()
    now = datetime.now()
    db.add_all([
        WorkspaceMember(workspace_id=ws.id, user_tg_id=LERA, role="owner", joined_at=now),
        WorkspaceMember(workspace_id=other_ws.id, user_tg_id=OUTSIDER, role="owner", joined_at=now),
        AuthSession(token="er-lera", tg_id=LERA, expires_at=now + timedelta(days=1)),
        AuthSession(token="er-outsider", tg_id=OUTSIDER, expires_at=now + timedelta(days=1)),
    ])
    adv = Advertiser(workspace_id=ws.id, name="Бренд", notes="")
    db.add(adv)
    db.commit()
    it = Integration(workspace_id=ws.id, brand="Бренд", advertiser_id=adv.id)
    db.add(it)
    db.commit()
    s = IntegrationStreamer(integration_id=it.id, streamer_name="Блогер", talent_type="blogger")
    db.add(s)
    db.commit()
    ids = {"ws": ws.id, "other_ws": other_ws.id, "it": it.id, "s": s.id}
    db.close()
    with TestClient(main.app) as client:
        yield client, ids


def _as(client, token: str, ws_id: int):
    client.cookies.set("zametochnitsa_session", token)
    return {"X-Workspace-Id": str(ws_id)}


def test_erid_po_umolchaniyu_pustoy(ctx):
    client, ids = ctx
    h = _as(client, "er-lera", ids["ws"])
    r = client.get(f"/api/integrations/streamers/{ids['s']}", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["erid"] == ""


def test_erid_sohranyaetsya_i_otdaetsya(ctx):
    client, ids = ctx
    h = _as(client, "er-lera", ids["ws"])
    r = client.patch(f"/api/integrations/streamers/{ids['s']}", json={"erid": "2VtzqwP3abc"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["erid"] == "2VtzqwP3abc"
    # читаем заново и ищем в списке сделок
    assert client.get(f"/api/integrations/streamers/{ids['s']}", headers=h).json()["erid"] == "2VtzqwP3abc"
    db = SessionLocal()
    try:
        assert db.get(IntegrationStreamer, ids["s"]).erid == "2VtzqwP3abc"
    finally:
        db.close()


def test_erid_pravka_ne_stiraet_sosednie_polya(ctx):
    client, ids = ctx
    h = _as(client, "er-lera", ids["ws"])
    client.patch(f"/api/integrations/streamers/{ids['s']}", json={"ord_link": "https://ord.vk.com/x"}, headers=h)
    r = client.patch(f"/api/integrations/streamers/{ids['s']}", json={"erid": "2VtzqwP3def"}, headers=h)
    assert r.json()["ord_link"] == "https://ord.vk.com/x"
    assert r.json()["erid"] == "2VtzqwP3def"


def test_chuzhoe_prostranstvo_ne_pravit_erid(ctx):
    client, ids = ctx
    h = _as(client, "er-outsider", ids["other_ws"])
    r = client.patch(f"/api/integrations/streamers/{ids['s']}", json={"erid": "hack"}, headers=h)
    assert r.status_code == 404
    db = SessionLocal()
    try:
        assert db.get(IntegrationStreamer, ids["s"]).erid != "hack"
    finally:
        db.close()


def test_erid_migraciya_idempotentna(tmp_path, monkeypatch):
    """Старая таблица без erid: колонка добавляется, данные целы, повтор не падает."""
    eng = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with eng.begin() as conn:
        conn.execute(text("CREATE TABLE integration_streamers (id INTEGER PRIMARY KEY, streamer_name VARCHAR(255))"))
        conn.execute(text("INSERT INTO integration_streamers (id, streamer_name) VALUES (1, 'старый')"))
    monkeypatch.setattr(main, "engine", eng)
    main._migrate_streamers_add_erid()
    main._migrate_streamers_add_erid()
    assert "erid" in [c["name"] for c in inspect(eng).get_columns("integration_streamers")]
    with eng.begin() as conn:
        assert conn.execute(text("SELECT streamer_name FROM integration_streamers WHERE id=1")).scalar() == "старый"
        assert conn.execute(text("SELECT erid FROM integration_streamers WHERE id=1")).scalar() in ("", None)


def test_erid_migraciya_propuskaet_otsutstvuyushuyu_tablicu(tmp_path, monkeypatch):
    eng = create_engine(f"sqlite:///{tmp_path / 'empty.db'}")
    monkeypatch.setattr(main, "engine", eng)
    main._migrate_streamers_add_erid()


def test_erid_migraciya_v_lifespan():
    src = open(os.path.join(os.path.dirname(__file__), "..", "main.py"), encoding="utf-8").read()
    assert src.count("_migrate_streamers_add_erid()") >= 2  # определение + вызов в lifespan


# ---- фронт: правки модалки блогера и канбана ----

def test_front_erid_v_modalke_i_na_kanbane():
    modal = _read_front("components", "CampaignBloggerModal.tsx")
    board = _read_front("pages", "IntegrationsBoard.tsx")
    api = _read_front("api", "integrations.ts")
    assert "erid: string" in api
    assert "form.erid" in modal and "form.erid" in board
    # erid стоит выше ссылки на ОРД
    assert modal.index("form.erid") < modal.index("form.ord_link")
    assert "Копировать" in _read_front("components", "DealParts.tsx")


def test_front_podpis_vremya_zapuska():
    modal = _read_front("components", "CampaignBloggerModal.tsx")
    board = _read_front("pages", "IntegrationsBoard.tsx")
    for src in (modal, board):
        assert "Время запуска" in src
        assert "Время старта стрима" not in src


def test_front_net_istorii_izmeneniy_v_modalke():
    modal = _read_front("components", "CampaignBloggerModal.tsx")
    assert "История изменений" not in modal
    assert "AuditBlock" not in modal


def test_front_nash_dohod_vmesto_marzhi():
    for parts in (("components", "CampaignBloggerModal.tsx"), ("pages", "CampaignsPage.tsx"),
                  ("pages", "WorkspaceSettingsPage.tsx")):
        src = _read_front(*parts)
        for bad in ("Наша маржа", "наша маржа", "Маржа:", "Коэффициент маржи", "расчёта маржи"):
            assert bad not in src, f"{parts[-1]}: {bad}"
    assert "Наш доход" in _read_front("components", "CampaignBloggerModal.tsx")
    assert "Наш доход" in _read_front("pages", "CampaignsPage.tsx")
    assert "наш доход" in _read_front("pages", "WorkspaceSettingsPage.tsx")


def test_front_podval_ne_perekryvaet_polya():
    """Контент модалки получает нижний отступ под высоту липкого подвала."""
    modal = _read_front("components", "CampaignBloggerModal.tsx")
    assert "pb-16" in modal


def test_front_ritm_otstupov_mezhdu_sekciyami():
    """Обе колонки с одинаковым вертикальным ритмом, договор не приклеен."""
    modal = _read_front("components", "CampaignBloggerModal.tsx")
    assert modal.count('<div className="flex flex-col gap-4 min-w-0">') == 2


def test_net_dlinnyh_tire_v_izmenennyh_failah():
    names = [
        ("components", "CampaignBloggerModal.tsx"), ("pages", "IntegrationsBoard.tsx"),
        ("pages", "CampaignsPage.tsx"), ("pages", "WorkspaceSettingsPage.tsx"),
        ("components", "DealParts.tsx"), ("api", "integrations.ts"),
    ]
    for parts in names:
        assert chr(0x2014) not in _read_front(*parts), parts[-1]
    for rel in ("main.py", os.path.join("models", "integration_streamer.py"),
                os.path.join("routers", "integrations.py")):
        path = os.path.join(os.path.dirname(__file__), "..", rel)
        assert chr(0x2014) not in open(path, encoding="utf-8").read(), rel
