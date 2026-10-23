"""Коэффициент наценки на уровне кампании (Campaign.margin_divisor).
Кампания фиксирует коэффициент на момент создания: смена настройки пространства
не пересчитывает уже созданные кампании. null у кампании - едем за пространством.
128xxx - диапазон этого файла, токены cmg-."""
import os
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text

import main
from database import Base, SessionLocal, engine
from models.auth_session import AuthSession
from models.user import User
from models.workspace import Workspace, WorkspaceMember

OWNER = 128001


@pytest.fixture()
def ctx():
    """Своё пространство на каждый тест: коэффициент пространства меняется прямо в тестах."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    if not db.get(User, OWNER):
        db.add(User(tg_id=OWNER, role="admin", label="Владелец коэффициентов"))
        db.commit()
    ws = Workspace(title="Коэффициенты", owner_tg_id=OWNER)
    db.add(ws)
    db.commit()
    now = datetime.now()
    db.add(WorkspaceMember(workspace_id=ws.id, user_tg_id=OWNER, role="owner", joined_at=now))
    if not db.query(AuthSession).filter_by(token="cmg-owner").first():
        db.add(AuthSession(token="cmg-owner", tg_id=OWNER, expires_at=now + timedelta(days=1)))
    db.commit()
    ws_id = ws.id
    db.close()
    with TestClient(main.app) as client:
        client.cookies.set("zametochnitsa_session", "cmg-owner")
        yield client, {"X-Workspace-Id": str(ws_id)}, ws_id


def _set_ws_divisor(client, ws_id, value):
    r = client.put(f"/api/workspaces/{ws_id}", json={"margin_divisor": value})
    assert r.status_code == 200, r.text


def _campaign(client, headers, name, **fields):
    r = client.post("/api/campaigns", json={"name": name, **fields}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _blogger(client, headers, camp_id, amount, name="Блогер"):
    r = client.post(f"/api/campaigns/{camp_id}/bloggers", json={"name": name, "amount": amount}, headers=headers)
    assert r.status_code == 201, r.text


def _get(client, headers, camp_id):
    rows = client.get("/api/campaigns", headers=headers).json()
    return next(x for x in rows if x["id"] == camp_id)


def test_migration_fixes_workspace_divisor_on_existing_campaigns(tmp_path, monkeypatch):
    """Старая база: кампании получают коэффициент СВОЕГО пространства, повтор ничего не ломает."""
    eng = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with eng.begin() as conn:
        conn.execute(text("CREATE TABLE workspaces (id INTEGER PRIMARY KEY, margin_divisor NUMERIC(6, 4))"))
        conn.execute(text("CREATE TABLE campaigns (id INTEGER PRIMARY KEY, workspace_id INTEGER, name VARCHAR(255))"))
        conn.execute(text("INSERT INTO workspaces (id, margin_divisor) VALUES (1, 1.375), (2, 1.5), (3, NULL)"))
        conn.execute(text(
            "INSERT INTO campaigns (id, workspace_id, name) VALUES (1, 1, 'а'), (2, 2, 'б'), (3, 3, 'в')"
        ))
    monkeypatch.setattr(main, "engine", eng)
    main._migrate_campaign_margin_divisor()
    assert "margin_divisor" in [c["name"] for c in inspect(eng).get_columns("campaigns")]
    with eng.begin() as conn:
        got = {r[0]: float(r[1]) for r in conn.execute(text("SELECT id, margin_divisor FROM campaigns"))}
        assert got == {1: pytest.approx(1.375), 2: pytest.approx(1.5), 3: pytest.approx(1.375)}
        # владелец потом вернул кампании "по пространству" (null): повторный запуск этого не трогает
        conn.execute(text("UPDATE campaigns SET margin_divisor = NULL WHERE id = 2"))
    main._migrate_campaign_margin_divisor()
    with eng.begin() as conn:
        assert conn.execute(text("SELECT margin_divisor FROM campaigns WHERE id = 2")).scalar() is None
        assert float(conn.execute(text("SELECT margin_divisor FROM campaigns WHERE id = 1")).scalar()) == pytest.approx(1.375)


def test_migration_skips_missing_table(tmp_path, monkeypatch):
    eng = create_engine(f"sqlite:///{tmp_path / 'empty.db'}")
    monkeypatch.setattr(main, "engine", eng)
    main._migrate_campaign_margin_divisor()


def test_migration_registered_in_lifespan():
    src = open(os.path.join(os.path.dirname(__file__), "..", "main.py"), encoding="utf-8").read()
    assert src.count("_migrate_campaign_margin_divisor()") >= 2  # определение + вызов в lifespan


def test_new_campaign_fixes_workspace_divisor(ctx):
    client, headers, ws_id = ctx
    _set_ws_divisor(client, ws_id, 1.4)
    c = _campaign(client, headers, "Новая")
    assert c["margin_divisor"] == pytest.approx(1.4)
    # явно переданный коэффициент главнее пространства
    c2 = _campaign(client, headers, "Своя", margin_divisor=1.2)
    assert c2["margin_divisor"] == pytest.approx(1.2)


def test_main_scenario_old_campaign_does_not_move(ctx):
    """Кампания создана при 1.375, потом настройка стала 1.32: старая не меняется, новая считается по 1.32."""
    client, headers, ws_id = ctx
    old = _campaign(client, headers, "Старая")
    _blogger(client, headers, old["id"], 1375)
    before = _get(client, headers, old["id"])
    assert before["bloggers_payout_total"] == pytest.approx(1000)

    _set_ws_divisor(client, ws_id, 1.32)

    after = _get(client, headers, old["id"])
    assert after["margin_divisor"] == pytest.approx(1.375)
    assert after["bloggers_total"] == before["bloggers_total"]
    assert after["bloggers_payout_total"] == pytest.approx(1000)

    new = _campaign(client, headers, "Новая")
    assert new["margin_divisor"] == pytest.approx(1.32)
    _blogger(client, headers, new["id"], 1320)
    assert _get(client, headers, new["id"])["bloggers_payout_total"] == pytest.approx(1000)


def test_null_campaign_follows_workspace(ctx):
    client, headers, ws_id = ctx
    c = _campaign(client, headers, "По пространству")
    r = client.patch(f"/api/campaigns/{c['id']}", json={"margin_divisor": None}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["margin_divisor"] is None
    _blogger(client, headers, c["id"], 1375)
    assert _get(client, headers, c["id"])["bloggers_payout_total"] == pytest.approx(1000)
    _set_ws_divisor(client, ws_id, 1.5)
    assert _get(client, headers, c["id"])["bloggers_payout_total"] == pytest.approx(1375 / 1.5)
    # а создание с явным null тоже даёт "по пространству", а не фиксацию
    c2 = _campaign(client, headers, "Явный null", margin_divisor=None)
    assert c2["margin_divisor"] == pytest.approx(1.5)


def test_patch_changes_campaign_divisor_and_keeps_it_without_field(ctx):
    client, headers, _ = ctx
    c = _campaign(client, headers, "Правка")
    r = client.patch(f"/api/campaigns/{c['id']}", json={"margin_divisor": 1.2}, headers=headers)
    assert r.json()["margin_divisor"] == pytest.approx(1.2)
    # правка другого поля коэффициент не сбрасывает
    r = client.patch(f"/api/campaigns/{c['id']}", json={"notes": "заметка"}, headers=headers)
    assert r.json()["margin_divisor"] == pytest.approx(1.2)


@pytest.mark.parametrize("bad", [0, -1, -0.5, 100, 1000, 1.37512, 1.00001])
def test_bad_divisor_rejected(ctx, bad):
    client, headers, _ = ctx
    r = client.post("/api/campaigns", json={"name": "Кривая", "margin_divisor": bad}, headers=headers)
    assert r.status_code == 400, r.text
    c = _campaign(client, headers, "Для правки")
    r = client.patch(f"/api/campaigns/{c['id']}", json={"margin_divisor": bad}, headers=headers)
    assert r.status_code == 400, r.text
    assert _get(client, headers, c["id"])["margin_divisor"] == pytest.approx(1.375)


def test_two_campaigns_in_one_list_use_own_divisors(ctx):
    """_stats обрабатывает пачку: у каждой кампании свой делитель, а не один на всю выдачу."""
    client, headers, ws_id = ctx
    a = _campaign(client, headers, "Первая", margin_divisor=1.375)
    b = _campaign(client, headers, "Вторая", margin_divisor=1.32)
    _blogger(client, headers, a["id"], 1375)
    _blogger(client, headers, b["id"], 1320)
    rows = client.get("/api/campaigns", headers=headers).json()
    by_id = {x["id"]: x for x in rows}
    assert by_id[a["id"]]["bloggers_payout_total"] == pytest.approx(1000)
    assert by_id[b["id"]]["bloggers_payout_total"] == pytest.approx(1000)
    # пространство при этом ни при чём: сдвигаем его, обе остаются на своих
    _set_ws_divisor(client, ws_id, 2)
    rows = client.get("/api/campaigns", headers=headers).json()
    by_id = {x["id"]: x for x in rows}
    assert by_id[a["id"]]["bloggers_payout_total"] == pytest.approx(1000)
    assert by_id[b["id"]]["bloggers_payout_total"] == pytest.approx(1000)
