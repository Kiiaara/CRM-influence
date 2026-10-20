"""Доработки после модалки блогера: единые контакты рекламодателя (BrandContact), бот,
кейс-черновик из первого скриншота, автоперевод при публикации на сайт.

Диапазон id 123xxx, токены fix-.
"""
import asyncio
import json
import os
from datetime import datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import inspect

import bot_dialog
import bot_editor
import case_translate
import main
import site_publisher
from config import settings
from database import Base, SessionLocal, engine
from models.advertiser import Advertiser
from models.auth_session import AuthSession
from models.campaign import Campaign
from models.case_study import CaseStudy
from models.integration import Integration
from models.integration_streamer import IntegrationStreamer
from models.user import User
from models.workspace import Workspace, WorkspaceMember
from routers import integrations as integrations_router
from test_site_publish import FakeGitHub

OWNER = 123001
SOLO_OWNER = 123002  # владелец пространства с выключенными кейсами

# длинное тире собираем из кода, чтобы его не было в самом файле
DASH = chr(0x2014)

BACK = os.path.join(os.path.dirname(__file__), "..")
FRONT = os.path.join(BACK, "..", "frontend", "src")

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
JPG = b"\xff\xd8\xff\xe0" + b"0" * 64


def _read(base: str, *parts: str) -> str:
    with open(os.path.join(base, *parts), encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def ctx(tmp_path_factory):
    integrations_router.SCREENSHOT_DIR = str(tmp_path_factory.mktemp("fix_shots"))
    integrations_router.CASE_PHOTO_DIR = str(tmp_path_factory.mktemp("fix_case_photos"))
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.add_all([
        User(tg_id=OWNER, role="admin", label="Лера"),
        User(tg_id=SOLO_OWNER, role="admin", label="Без кейсов"),
    ])
    db.commit()
    ws = Workspace(title="Фикс", owner_tg_id=OWNER)
    ws_nocases = Workspace(title="Фикс без кейсов", owner_tg_id=SOLO_OWNER, cases_enabled=False)
    db.add_all([ws, ws_nocases])
    db.commit()
    now = datetime.now()
    db.add_all([
        WorkspaceMember(workspace_id=ws.id, user_tg_id=OWNER, role="owner", joined_at=now),
        WorkspaceMember(workspace_id=ws_nocases.id, user_tg_id=SOLO_OWNER, role="owner", joined_at=now),
        AuthSession(token="fix-lera", tg_id=OWNER, expires_at=now + timedelta(days=1)),
        AuthSession(token="fix-solo", tg_id=SOLO_OWNER, expires_at=now + timedelta(days=1)),
    ])
    adv = Advertiser(workspace_id=ws.id, name="Фикс Бренд")
    adv_nc = Advertiser(workspace_id=ws_nocases.id, name="Фикс Бренд НК")
    db.add_all([adv, adv_nc])
    db.commit()
    camp = Campaign(workspace_id=ws.id, name="Фикс РК")
    db.add(camp)
    db.commit()
    data = {"ws": ws.id, "ws_nc": ws_nocases.id, "adv": adv.id, "adv_nc": adv_nc.id, "camp": camp.id}
    db.close()
    with TestClient(main.app) as client:
        yield client, data


def _h(client, data, token="fix-lera", ws_key="ws"):
    client.cookies.set("zametochnitsa_session", token)
    return {"X-Workspace-Id": str(data[ws_key])}


def _streamer(client, data, adv_key="adv", token="fix-lera", ws_key="ws", name="Фикс Блогер"):
    headers = _h(client, data, token, ws_key)
    it = client.post("/api/integrations", json={"advertiser_id": data[adv_key]}, headers=headers)
    assert it.status_code == 201, it.text
    s = client.post(f"/api/integrations/{it.json()['id']}/streamers", json={"streamer_name": name}, headers=headers)
    assert s.status_code == 201, s.text
    return s.json(), headers


def _upload(client, sid, headers, name="shot.png", content=PNG, mime="image/png"):
    return client.post(
        f"/api/integrations/streamers/{sid}/screenshots",
        files={"file": (name, content, mime)},
        headers=headers,
    )


def _cases(client, sid, headers):
    return client.get(f"/api/integrations/streamers/{sid}/cases", headers=headers).json()


# ---------- 1. контакты рекламодателя: один источник - BrandContact ----------

def test_deal_gets_contacts_from_brand_contacts(ctx):
    client, data = ctx
    headers = _h(client, data)
    adv = client.post("/api/advertisers", json={"name": "Контакты из списка"}, headers=headers).json()
    client.post(f"/api/advertisers/{adv['id']}/contacts", json={"contact_type": "email", "value": "a@b.ru", "label": "Бухгалтер"}, headers=headers)
    client.post(f"/api/advertisers/{adv['id']}/contacts", json={"contact_type": "telegram", "value": "@boss", "label": "Менеджер", "is_primary": True}, headers=headers)
    it = client.post("/api/integrations", json={"advertiser_id": adv["id"]}, headers=headers).json()
    s = client.post(f"/api/integrations/{it['id']}/streamers", json={"streamer_name": "С контактами"}, headers=headers).json()

    got = client.get(f"/api/integrations/streamers/{s['id']}", headers=headers).json()["advertiser"]
    assert got["name"] == "Контакты из списка"
    # основной контакт первым
    assert [(c["contact_type"], c["value"], c["label"], c["is_primary"]) for c in got["contacts"]] == [
        ("telegram", "@boss", "Менеджер", True),
        ("email", "a@b.ru", "Бухгалтер", False),
    ]
    # и в списке сделок (канбан / кампания)
    rows = client.get("/api/integrations", headers=headers).json()
    mine = next(i for i in rows if i["id"] == it["id"])
    assert mine["streamers"][0]["advertiser"]["contacts"][0]["value"] == "@boss"


def test_new_contact_appears_in_deal_without_restart(ctx):
    client, data = ctx
    s, headers = _streamer(client, data)
    assert client.get(f"/api/integrations/streamers/{s['id']}", headers=headers).json()["advertiser"]["contacts"] == []
    client.post(f"/api/advertisers/{data['adv']}/contacts", json={"contact_type": "phone", "value": "+7 900"}, headers=headers)
    got = client.get(f"/api/integrations/streamers/{s['id']}", headers=headers).json()["advertiser"]
    assert [c["value"] for c in got["contacts"]] == ["+7 900"]


def test_legacy_advertiser_fields_are_not_used(ctx):
    client, data = ctx
    headers = _h(client, data)
    r = client.post(
        "/api/advertisers",
        json={"name": "Старые поля", "contact_person": "Анна", "telegram": "@anna", "email": "a@b.ru", "phone": "1"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    for legacy in ("contact_person", "telegram", "email", "phone"):
        assert legacy not in r.json()
    assert "contacts" in r.json()
    r = client.patch(f"/api/advertisers/{r.json()['id']}", json={"telegram": "@x"}, headers=headers)
    assert "telegram" not in r.json()
    assert not any(c.name in ("contact_person", "telegram", "email", "phone") for c in Advertiser.__table__.columns)
    s, headers = _streamer(client, data)
    adv = client.get(f"/api/integrations/streamers/{s['id']}", headers=headers).json()["advertiser"]
    assert set(adv) == {"id", "name", "contacts"}


def test_legacy_migration_no_longer_registered():
    src = _read(BACK, "main.py")
    assert "_migrate_advertisers_add_contacts" not in src


def test_front_contacts_single_source():
    page = _read(FRONT, "pages", "AdvertisersPage.tsx")
    for legacy in ("contact_person", "setContactPerson", "setTelegram", "setPhone"):
        assert legacy not in page, legacy
    assert 'placeholder="Значение"' not in page
    assert 'placeholder="Контакт"' in page
    api = _read(FRONT, "api", "advertisers.ts")
    ints = _read(FRONT, "api", "integrations.ts")
    parts = _read(FRONT, "components", "DealParts.tsx")
    for src in (api, ints, parts):
        assert "contact_person" not in src
    assert "advertiser.contacts" in parts


# ---------- 2. бот ----------

@pytest.fixture
def sent(monkeypatch):
    messages = []

    async def fake_send(chat_id, text, with_keyboard=False, inline_keyboard=None):
        messages.append((chat_id, text, inline_keyboard))
        return True

    monkeypatch.setattr(bot_editor, "send_message", fake_send)
    monkeypatch.setattr(bot_dialog, "send_message", fake_send)
    bot_dialog._sessions.clear()
    return messages


def run(coro):
    return asyncio.run(coro)


def _in_campaign(client, data, name, **fields):
    """Участник сделки, лежащей в кампании."""
    s, headers = _streamer(client, data, name=name)
    db = SessionLocal()
    it = db.get(Integration, s["integration_id"])
    it.campaign_id = data["camp"]
    db.commit()
    for k, v in fields.items():
        db.query(IntegrationStreamer).filter(IntegrationStreamer.id == s["id"]).update({k: v})
    db.commit()
    db.close()
    return s["id"]


def test_bot_adv_card_lists_contacts(ctx, sent):
    client, data = ctx
    headers = _h(client, data)
    adv = client.post("/api/advertisers", json={"name": "Бот-карточка"}, headers=headers).json()
    client.post(f"/api/advertisers/{adv['id']}/contacts", json={"contact_type": "telegram", "value": "@botcontact", "label": "Директор", "is_primary": True}, headers=headers)
    run(bot_editor.show_card(OWNER, "adv", adv["id"]))
    text = sent[-1][1]
    assert "@botcontact" in text and "Директор" in text


def test_bot_hot_tasks_skip_drafts_when_disabled_and_deals_outside_campaign(ctx):
    client, data = ctx
    headers = _h(client, data)
    _in_campaign(client, data, "БотЧерновикВКампании")
    _streamer(client, data, name="БотЧерновикВне")
    db = SessionLocal()
    try:
        _, text = bot_dialog.compute_hot_tasks(db, data["ws"])
        assert "БотЧерновикВКампании" in text
        assert "БотЧерновикВне" not in text  # сделки вне кампании в сводке не показываем
        # выключили напоминания про черновики
        client.put(f"/api/workspaces/{data['ws']}", json={"draft_alerts_enabled": False}, headers=headers)
        db.expire_all()
        _, text = bot_dialog.compute_hot_tasks(db, data["ws"])
        assert "БотЧерновикВКампании" not in text and "Черновики" not in text
    finally:
        client.put(f"/api/workspaces/{data['ws']}", json={"draft_alerts_enabled": True}, headers=headers)
        db.close()


def test_bot_hot_tasks_other_groups_also_need_campaign(ctx):
    client, data = ctx
    past = datetime.now() - timedelta(days=5)
    inside = _in_campaign(client, data, "БотПросрочкаВКампании", deadline=past, stage="agreed")
    s, _ = _streamer(client, data, name="БотПросрочкаВне")
    db = SessionLocal()
    try:
        db.query(IntegrationStreamer).filter(IntegrationStreamer.id == s["id"]).update({"deadline": past, "stage": "agreed"})
        db.commit()
        _, text = bot_dialog.compute_hot_tasks(db, data["ws"])
        assert "БотПросрочкаВКампании" in text and "БотПросрочкаВне" not in text
    finally:
        db.close()


def test_bot_edits_erid_and_urls(ctx, sent):
    client, data = ctx
    sid = _in_campaign(client, data, "БотПоля")
    for field, value in (("erid", "2VtzqERID"), ("contract_url", "https://sign.example/c"), ("publication_url", "https://t.me/c/5")):
        assert field in bot_dialog.FIELD_LABELS and field in bot_dialog.FIELD_TYPE
        assert any(field in cat[2] for cat in bot_dialog.CATEGORIES)
        run(bot_dialog.handle_callback(OWNER, f"e:pick:{sid}:{field}"))
        assert run(bot_dialog.handle_message(OWNER, value))
        db = SessionLocal()
        assert getattr(db.get(IntegrationStreamer, sid), field) == value
        db.close()
    # старое поле больше не называется erid: путаница с настоящим полем erid
    assert "erid" not in bot_dialog.FIELD_LABELS["ord_link"].lower()


def test_bot_has_no_long_dashes_and_no_streamer_word():
    for name in ("bot_editor.py", "bot_dialog.py"):
        src = _read(BACK, name)
        assert DASH not in src, name
        # в текстах бота везде "инфлюенсер"
        assert "стример" not in src.lower(), name


def test_bot_publish_shows_warnings(ctx, sent, monkeypatch):
    async def fake_publish(db, tg_id):
        return {"count": 2, "commit_url": "u", "changed": True, "site_url": "s", "translated": 0,
                "warnings": ["Перевод не сделан: нет ключа Groq"]}
    monkeypatch.setattr(site_publisher, "publish", fake_publish)
    run(bot_editor._publish_site(OWNER))
    assert "нет ключа Groq" in sent[-1][1]


# ---------- 3. первый скриншот создаёт кейс-черновик ----------

def test_first_screenshot_creates_draft_case(ctx):
    client, data = ctx
    s, headers = _streamer(client, data)
    assert _cases(client, s["id"], headers) == []
    assert _upload(client, s["id"], headers, name="first.png").status_code == 201
    cases = _cases(client, s["id"], headers)
    assert len(cases) == 1
    c = cases[0]
    assert c["title"] == "Фикс Бренд - Фикс Блогер"
    assert c["show_on_site"] is False
    assert c["description"] == "" and c["what_was_done"] == "" and c["result"] == "" and c["site_mini"] == ""
    assert c["photo_name"] == "first.png"
    # has_case включился: блок "завершено без кейса" такого инфлюенсера больше не покажет
    assert client.get(f"/api/integrations/streamers/{s['id']}", headers=headers).json()["has_case"] is True


def test_second_screenshot_does_not_create_another_case(ctx):
    client, data = ctx
    s, headers = _streamer(client, data)
    _upload(client, s["id"], headers, name="a.png")
    _upload(client, s["id"], headers, name="b.jpg", content=JPG, mime="image/jpeg")
    assert len(_cases(client, s["id"], headers)) == 1


def test_deleted_case_is_not_recreated_by_next_screenshot(ctx):
    client, data = ctx
    s, headers = _streamer(client, data)
    _upload(client, s["id"], headers, name="a.png")
    case_id = _cases(client, s["id"], headers)[0]["id"]
    client.delete(f"/api/integrations/cases/{case_id}", headers=headers)
    _upload(client, s["id"], headers, name="b.png")  # уже не первый скриншот
    assert _cases(client, s["id"], headers) == []


def test_existing_case_is_not_duplicated_by_first_screenshot(ctx):
    client, data = ctx
    s, headers = _streamer(client, data)
    client.post(f"/api/integrations/streamers/{s['id']}/cases", json={"title": "Свой кейс"}, headers=headers)
    _upload(client, s["id"], headers)
    cases = _cases(client, s["id"], headers)
    assert [c["title"] for c in cases] == ["Свой кейс"]


def test_no_case_when_cases_disabled(ctx):
    client, data = ctx
    s, headers = _streamer(client, data, adv_key="adv_nc", token="fix-solo", ws_key="ws_nc")
    assert _upload(client, s["id"], headers).status_code == 201
    assert _cases(client, s["id"], headers) == []
    assert client.get(f"/api/integrations/streamers/{s['id']}", headers=headers).json()["has_case"] is False


def test_front_screenshot_upload_refreshes_cases():
    parts = _read(FRONT, "components", "DealParts.tsx")
    start = parts.index("export function Screenshots")
    block = parts[start:start + 2500]
    assert "'cases'" in block and "['integrations']" in block


# ---------- 4. автоперевод при публикации ----------

GROQ_ANSWER = {
    "en": {"title": "Fix Game", "mini": "20M+ views", "description": "Launch", "what_was_done": "Streams\nKPI", "result": "13M views"},
    "zh": {"title": "修复游戏", "mini": "2000万+ 观看次数", "description": "上线", "what_was_done": "直播\nKPI", "result": "1300万次观看"},
}


def _site_case(client, data, title, translations=None):
    """Кейс с галочкой «на сайте» в пространстве владельца; остальные кейсы снимаем с публикации."""
    db = SessionLocal()
    db.query(CaseStudy).filter(CaseStudy.show_on_site.is_(True)).update({"show_on_site": False})
    db.commit()
    db.close()
    s, headers = _streamer(client, data, name=f"Блогер {title}")
    c = client.post(f"/api/integrations/streamers/{s['id']}/cases", json={
        "title": title, "description": "Запуск", "what_was_done": "Стримы\nKPI", "result": "13 млн",
    }, headers=headers).json()
    body = {"show_on_site": True, "site_mini": "20 млн+ просмотров"}
    if translations is not None:
        body["translations"] = translations
    client.patch(f"/api/integrations/cases/{c['id']}", json=body, headers=headers)
    return c["id"], headers


class Groq:
    """Подмена Groq: считает вызовы, отдаёт заданный ответ."""

    def __init__(self, status=200, answer=GROQ_ANSWER):
        self.calls = 0
        self.status = status
        self.answer = answer

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        if self.status != 200:
            return httpx.Response(self.status)
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(self.answer, ensure_ascii=False)}}]})


def _setup_publish(monkeypatch, groq: Groq, key="gsk-fix"):
    gh = FakeGitHub()
    monkeypatch.setattr(site_publisher, "_transport", httpx.MockTransport(gh.handler))
    monkeypatch.setattr(settings, "site_github_token", "test-token")
    monkeypatch.setattr(settings, "groq_api_key", key)
    monkeypatch.setattr(case_translate, "_transport", httpx.MockTransport(groq.handler))
    return gh


def _published_case(gh, case_id):
    items = json.loads(gh.files["cases.json"])["cases"]
    return next(i for i in items if i["crmId"] == case_id)


def test_publish_translates_missing_and_commits_three_languages(ctx, monkeypatch):
    client, data = ctx
    case_id, headers = _site_case(client, data, "Фикс Игра")
    groq = Groq()
    gh = _setup_publish(monkeypatch, groq)
    r = client.post("/api/site/publish", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["warnings"] == [] and r.json()["translated"] == 1
    assert groq.calls == 1
    assert gh.commits == 1  # один коммит на три языка
    item = _published_case(gh, case_id)
    assert item["title"]["ru"] == "Фикс Игра"
    # название бренда не переводится автоматически, на всех языках остаётся исходным
    assert item["title"]["en"] == "Фикс Игра" and item["title"]["zh"] == "Фикс Игра"
    assert item["doing"]["en"] == ["Streams", "KPI"]
    # перевод сохранён в кейсе: его можно поправить руками
    db = SessionLocal()
    assert json.loads(db.get(CaseStudy, case_id).translations)["zh"]["description"] == "上线"
    db.close()


def test_publish_does_not_overwrite_manual_translations(ctx, monkeypatch):
    client, data = ctx
    manual = {
        "en": {"title": "My own title", "mini": "", "description": "", "what_was_done": "", "result": ""},
        "zh": {"title": "我的标题", "mini": "", "description": "", "what_was_done": "", "result": ""},
    }
    case_id, headers = _site_case(client, data, "Фикс Ручной", translations=manual)
    groq = Groq()
    gh = _setup_publish(monkeypatch, groq)
    r = client.post("/api/site/publish", headers=headers)
    assert r.status_code == 200, r.text
    assert groq.calls == 0
    assert r.json()["warnings"] == [] and r.json()["translated"] == 0
    item = _published_case(gh, case_id)
    assert item["title"]["en"] == "My own title" and item["title"]["zh"] == "我的标题"


def test_publish_with_only_one_manual_language_is_not_touched(ctx, monkeypatch):
    client, data = ctx
    manual = {"en": {"title": "Only EN", "mini": "", "description": "", "what_was_done": "", "result": ""}}
    case_id, headers = _site_case(client, data, "Фикс Один язык", translations=manual)
    groq = Groq()
    gh = _setup_publish(monkeypatch, groq)
    client.post("/api/site/publish", headers=headers)
    assert groq.calls == 0
    item = _published_case(gh, case_id)
    assert item["title"]["en"] == "Only EN" and item["title"]["zh"] == "Фикс Один язык"


def test_publish_survives_groq_error_and_warns(ctx, monkeypatch):
    client, data = ctx
    case_id, headers = _site_case(client, data, "Фикс Лимит")
    groq = Groq(status=429)
    gh = _setup_publish(monkeypatch, groq)
    r = client.post("/api/site/publish", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["changed"] is True
    assert len(r.json()["warnings"]) == 1 and "Лимит" in r.json()["warnings"][0]
    assert "Фикс Лимит" in r.json()["warnings"][0]
    item = _published_case(gh, case_id)
    assert item["title"]["en"] == "Фикс Лимит" and item["title"]["zh"] == "Фикс Лимит"  # русский вместо перевода
    db = SessionLocal()
    assert json.loads(db.get(CaseStudy, case_id).translations or "{}") == {}
    db.close()


def test_publish_without_groq_key_warns_but_publishes(ctx, monkeypatch):
    client, data = ctx
    case_id, headers = _site_case(client, data, "Фикс Без ключа")
    groq = Groq()
    gh = _setup_publish(monkeypatch, groq, key="")
    r = client.post("/api/site/publish", headers=headers)
    assert r.status_code == 200, r.text
    assert groq.calls == 0
    assert "GROQ_API_KEY" in r.json()["warnings"][0]
    assert _published_case(gh, case_id)["title"]["ru"] == "Фикс Без ключа"


def test_publish_stops_translating_when_time_budget_is_out(ctx, monkeypatch):
    client, data = ctx
    case_id, headers = _site_case(client, data, "Фикс Бюджет")
    groq = Groq()
    gh = _setup_publish(monkeypatch, groq)
    monkeypatch.setattr(site_publisher, "TRANSLATE_BUDGET_SEC", 0)
    r = client.post("/api/site/publish", headers=headers)
    assert r.status_code == 200, r.text
    assert groq.calls == 0
    assert "время" in r.json()["warnings"][0].lower()
    assert _published_case(gh, case_id)["title"]["en"] == "Фикс Бюджет"


def test_translate_timeout_is_below_proxy_limit():
    assert case_translate.TIMEOUT_SEC <= 30
    assert site_publisher.TRANSLATE_BUDGET_SEC <= 45


def test_status_reports_missing_settings(ctx, monkeypatch):
    client, data = ctx
    headers = _h(client, data)
    monkeypatch.setattr(settings, "site_github_token", "")
    monkeypatch.setattr(settings, "groq_api_key", "")
    st = client.get("/api/site/status", headers=headers).json()
    assert st["configured"] is False and st["missing"] == ["SITE_GITHUB_TOKEN"]
    assert st["translate_configured"] is False
    r = client.post("/api/site/publish", headers=headers)
    assert r.status_code == 400 and "SITE_GITHUB_TOKEN" in r.json()["detail"]
    monkeypatch.setattr(settings, "site_github_token", "t")
    monkeypatch.setattr(settings, "groq_api_key", "g")
    st = client.get("/api/site/status", headers=headers).json()
    assert st["configured"] is True and st["missing"] == [] and st["translate_configured"] is True


def test_front_publish_errors_are_visible():
    bar = _read(FRONT, "pages", "CasesPage.tsx")
    api = _read(FRONT, "api", "site.ts")
    assert "warnings" in api and "missing" in api and "translate_configured" in api
    # статус не загрузился: объясняем, а не прячем панель молча
    assert "Не удалось получить состояние публикации" in bar
    # не настроено: заметное сообщение, не серая мелочь
    assert "text-red-600" in bar and "status.missing" in bar
    # предупреждения о переводе показываются после публикации
    assert "r.warnings" in bar
    # не админ: объясняем, почему кнопки нет
    assert "только администратор" in bar
    # публикация без кейсов с галочкой не выдаёт «всё актуально»
    assert "Показывать на сайте" in bar


def test_no_long_dashes_in_changed_files():
    front_files = [
        ("pages", "CasesPage.tsx"), ("pages", "AdvertisersPage.tsx"), ("components", "DealParts.tsx"),
        ("api", "site.ts"), ("api", "advertisers.ts"), ("api", "integrations.ts"),
    ]
    for parts in front_files:
        assert DASH not in _read(FRONT, *parts), parts
    for rel in ("site_publisher.py", "case_translate.py", "main.py", "bot_editor.py", "bot_dialog.py",
                os.path.join("routers", "integrations.py"), os.path.join("routers", "advertisers.py"),
                os.path.join("routers", "site.py"), os.path.join("models", "advertiser.py")):
        assert DASH not in _read(BACK, rel), rel
