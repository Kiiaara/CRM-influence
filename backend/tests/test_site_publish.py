"""Кейсы на сайт: поля кейса, автоперевод, сборка cases.json и коммит в репозиторий сайта."""
import base64
import json
from datetime import datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import case_translate
import main
import site_publisher
from config import settings
from database import Base, engine, SessionLocal
from models.advertiser import Advertiser
from models.auth_session import AuthSession
from models.case_study import CaseStudy
from models.integration import Integration
from models.integration_streamer import IntegrationStreamer
from models.user import User
from models.workspace import Workspace, WorkspaceMember

OWNER_TG = 107001
GUEST_OWNER_TG = 107002


def _case_in_new_ws(db, owner, title):
    ws = Workspace(title=f"ws-{title}", owner_tg_id=owner)
    db.add(ws)
    db.commit()
    db.add(WorkspaceMember(workspace_id=ws.id, user_tg_id=owner, role="owner", joined_at=datetime.now()))
    adv = Advertiser(workspace_id=ws.id, name=f"adv-{title}")
    db.add(adv)
    db.commit()
    it = Integration(workspace_id=ws.id, advertiser_id=adv.id, brand=adv.name)
    db.add(it)
    db.commit()
    s = IntegrationStreamer(integration_id=it.id, streamer_name="s", stage="done")
    db.add(s)
    db.commit()
    c = CaseStudy(streamer_id=s.id, title=title)
    db.add(c)
    db.commit()
    return ws.id, c.id


@pytest.fixture(scope="module")
def ctx(tmp_path_factory):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.add_all([User(tg_id=OWNER_TG, role="admin", label="Лера"), User(tg_id=GUEST_OWNER_TG, role="editor", label="Гость")])
    db.commit()
    ws_id, case_id = _case_in_new_ws(db, OWNER_TG, "Arena <Breakout>")
    _, foreign_case_id = _case_in_new_ws(db, GUEST_OWNER_TG, "Чужой кейс")
    photo = tmp_path_factory.mktemp("p") / "photo.png"
    Image.new("RGB", (3000, 1500), (40, 200, 90)).save(photo)
    c = db.get(CaseStudy, case_id)
    c.photo_path, c.photo_name = str(photo), "photo.png"
    foreign = db.get(CaseStudy, foreign_case_id)
    foreign.show_on_site = True
    now = datetime.now()
    db.add_all([
        AuthSession(token="site-owner", tg_id=OWNER_TG, expires_at=now + timedelta(days=1)),
        AuthSession(token="site-guest", tg_id=GUEST_OWNER_TG, expires_at=now + timedelta(days=1)),
    ])
    db.commit()
    db.close()
    with TestClient(main.app) as client:
        client.cookies.set("zametochnitsa_session", "site-owner")
        yield client, {"ws": ws_id, "case": case_id}


def _h(data):
    return {"X-Workspace-Id": str(data["ws"])}


def test_case_site_fields_and_translate(ctx, monkeypatch):
    client, data = ctx
    r = client.patch(f"/api/integrations/cases/{data['case']}", json={
        "show_on_site": True, "site_tag": "Tournament", "site_mini": "20 млн+ просмотров",
        "description": "Запуск шутера", "what_was_done": "- Стримы на запуске\nКонтроль KPI", "result": "13 млн просмотров",
    }, headers=_h(data))
    assert r.status_code == 200, r.text
    assert r.json()["show_on_site"] is True and r.json()["site_tag"] == "Tournament"
    assert client.patch(f"/api/integrations/cases/{data['case']}", json={"site_tag": "Прочее"}, headers=_h(data)).status_code == 400

    def fake_translate(source):
        assert source["mini"] == "20 млн+ просмотров"
        return {
            "en": {"title": "Arena Breakout", "mini": "20M+ views", "description": "Shooter launch",
                   "what_was_done": "Launch streams\nKPI control", "result": "13M views"},
            "zh": {"title": "Arena Breakout", "mini": "2000万+ 观看次数", "description": "射击游戏上线",
                   "what_was_done": "", "result": ""},
        }
    monkeypatch.setattr(case_translate, "translate_case", fake_translate)
    r = client.post(f"/api/integrations/cases/{data['case']}/translate", headers=_h(data))
    assert r.status_code == 200, r.text
    assert r.json()["translations"]["en"]["mini"] == "20M+ views"

    # правка перевода руками
    tr = r.json()["translations"]
    tr["zh"]["result"] = "1300万次观看"
    r = client.patch(f"/api/integrations/cases/{data['case']}", json={"translations": tr}, headers=_h(data))
    assert r.json()["translations"]["zh"]["result"] == "1300万次观看"


def test_translate_error_is_readable(ctx, monkeypatch):
    client, data = ctx

    def broken(source):
        raise case_translate.TranslateError("Не настроен ключ Groq")
    monkeypatch.setattr(case_translate, "translate_case", broken)
    r = client.post(f"/api/integrations/cases/{data['case']}/translate", headers=_h(data))
    assert r.status_code == 400 and "ключ" in r.json()["detail"]


def test_preview_matches_site_format_and_skips_foreign_workspace(ctx):
    client, data = ctx
    cases = client.get("/api/site/preview", headers=_h(data)).json()["cases"]
    assert len(cases) == 1  # кейс из чужого пространства с галочкой не попадает
    c = cases[0]
    assert c["tag"] == "Tournament"
    assert c["title"]["ru"] == "Arena &lt;Breakout&gt;"  # сайт вставляет через innerHTML
    assert c["doing"]["ru"] == ["Стримы на запуске", "Контроль KPI"]
    assert c["doing"]["en"] == ["Launch streams", "KPI control"]
    assert c["doing"]["zh"] == ["Стримы на запуске", "Контроль KPI"]  # нет перевода - русский
    assert c["mini"]["zh"] == "2000万+ 观看次数"
    assert c["img"] == f"assets/images/crm/case-{data['case']}.webp"


class FakeGitHub:
    """Минимальный GitHub Git Data API в памяти."""

    def __init__(self):
        self.files = {"index.html": b"<html>", "assets/images/crm/case-999.webp": b"old"}
        self.commits = 0
        self.head = "c0"
        self.trees: dict[str, dict] = {"t0": dict(self.files)}
        self.blobs: dict[str, bytes] = {}

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer test-token"
        path, method = request.url.path, request.method
        body = json.loads(request.content) if request.content else {}
        if method == "GET" and path.endswith("/git/ref/heads/main"):
            return httpx.Response(200, json={"object": {"sha": self.head}})
        if method == "GET" and "/git/commits/" in path:
            return httpx.Response(200, json={"tree": {"sha": f"t{self.commits}"}})
        if method == "GET" and "/git/trees/" in path:
            tree = self.trees[path.rsplit("/", 1)[1]]
            return httpx.Response(200, json={"tree": [
                {"path": p, "type": "blob", "sha": site_publisher._git_blob_sha(c)} for p, c in tree.items()
            ]})
        if method == "POST" and path.endswith("/git/blobs"):
            content = base64.b64decode(body["content"])
            sha = site_publisher._git_blob_sha(content)
            self.blobs[sha] = content
            return httpx.Response(201, json={"sha": sha})
        if method == "POST" and path.endswith("/git/trees"):
            tree = dict(self.trees[body["base_tree"]])
            for e in body["tree"]:
                if e["sha"] is None:
                    tree.pop(e["path"], None)
                else:
                    tree[e["path"]] = self.blobs[e["sha"]]
            self.trees[f"t{self.commits + 1}"] = tree
            return httpx.Response(201, json={"sha": f"t{self.commits + 1}"})
        if method == "POST" and path.endswith("/git/commits"):
            assert body["parents"] == [self.head]
            return httpx.Response(201, json={"sha": f"c{self.commits + 1}", "html_url": "https://github.com/x/commit/1"})
        if method == "PATCH" and path.endswith("/git/refs/heads/main"):
            self.commits += 1
            self.head = body["sha"]
            self.files = self.trees[f"t{self.commits}"]
            return httpx.Response(200, json={})
        return httpx.Response(404)


def test_publish_commits_json_and_images(ctx, monkeypatch):
    client, data = ctx
    gh = FakeGitHub()
    monkeypatch.setattr(site_publisher, "_transport", httpx.MockTransport(gh.handler))
    monkeypatch.setattr(settings, "site_github_token", "test-token")

    r = client.post("/api/site/publish", headers=_h(data))
    assert r.status_code == 200, r.text
    assert r.json()["changed"] is True and r.json()["count"] == 1
    assert gh.commits == 1
    published = json.loads(gh.files["cases.json"])
    assert [c["crmId"] for c in published["cases"]] == [data["case"]]
    img = gh.files[f"assets/images/crm/case-{data['case']}.webp"]
    assert img[:4] == b"RIFF" and b"WEBP" in img[:16]
    assert "assets/images/crm/case-999.webp" not in gh.files  # фото снятого кейса удалено
    assert gh.files["index.html"] == b"<html>"  # остальное не трогаем

    # повторная публикация без изменений - без пустого коммита
    r = client.post("/api/site/publish", headers=_h(data))
    assert r.json()["changed"] is False and gh.commits == 1

    status = client.get("/api/site/status", headers=_h(data)).json()
    assert status["configured"] and status["count"] == 1 and status["unpublished"] == 0


def test_publish_requires_admin_and_token(ctx, monkeypatch):
    client, data = ctx
    monkeypatch.setattr(settings, "site_github_token", "")
    r = client.post("/api/site/publish", headers=_h(data))
    assert r.status_code == 400 and "SITE_GITHUB_TOKEN" in r.json()["detail"]
    client.cookies.set("zametochnitsa_session", "site-guest")
    try:
        assert client.post("/api/site/publish").status_code == 403
    finally:
        client.cookies.set("zametochnitsa_session", "site-owner")


def test_groq_translate_request_and_parsing(monkeypatch):
    import httpx as _httpx
    seen = {}

    def handler(request):
        body = json.loads(request.content)
        seen["auth"] = request.headers["Authorization"]
        seen["model"] = body["model"]
        seen["json_mode"] = body["response_format"]
        answer = {
            "en": {"title": "Game", "mini": "20M+ views", "description": "Launch",
                   "what_was_done": ["Streams", "KPI"], "result": "13M views"},
            "zh": {"title": "游戏", "mini": "2000万+ 观看次数"},
        }
        return _httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(answer, ensure_ascii=False)}}]})

    monkeypatch.setattr(settings, "groq_api_key", "gsk-test")
    monkeypatch.setattr(case_translate, "_transport", _httpx.MockTransport(handler))
    tr = case_translate.translate_case({"title": "Игра", "mini": "20 млн+"})
    assert seen == {"auth": "Bearer gsk-test", "model": settings.groq_model, "json_mode": {"type": "json_object"}}
    assert tr["en"]["what_was_done"] == "Streams\nKPI"  # список от модели -> строки
    assert tr["zh"]["result"] == ""  # пропущенное поле - пустое, на сайте будет русский

    monkeypatch.setattr(case_translate, "_transport", _httpx.MockTransport(lambda r: _httpx.Response(429)))
    with pytest.raises(case_translate.TranslateError, match="Лимит"):
        case_translate.translate_case({"title": "Игра"})

    monkeypatch.setattr(settings, "groq_api_key", "")
    with pytest.raises(case_translate.TranslateError, match="GROQ_API_KEY"):
        case_translate.translate_case({"title": "Игра"})
