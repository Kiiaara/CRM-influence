"""Бесплатный перевод кейсов без ключей: Google (публичный эндпоинт) и MyMemory, цепочка auto.

Диапазон id 126xxx, токены gtr-. Сеть мокается через case_translate._transport,
настоящих запросов нет.
"""
import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

import case_translate
import site_publisher
from config import settings

SOURCE = {
    "title": "Игра gtr-126001",
    "mini": "34к+ просмотров",
    "description": "Запуск",
    "what_was_done": "Стримы\nKPI\nОтчёт",
    "result": "13 млн",
}


class Net:
    """Подмена сети: Google и MyMemory, пишет все запросы. google/mymemory - статус ответа или None."""

    def __init__(self, google=200, mymemory=200, quota=False):
        self.google, self.mymemory, self.quota = google, mymemory, quota
        self.requests: list[httpx.Request] = []

    def sent(self, host_part: str) -> list[str]:
        return [r.url.params.get("q") for r in self.requests if host_part in r.url.host]

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        q = request.url.params.get("q", "")
        if "googleapis" in request.url.host:
            if self.google != 200:
                return httpx.Response(self.google, text="err")
            tl = request.url.params.get("tl")
            return httpx.Response(200, json=[[[f"{tl}:{q}", q, None, None, 10]], None, "ru"])
        if "mymemory" in request.url.host:
            if self.mymemory != 200:
                return httpx.Response(self.mymemory, text="err")
            lang = request.url.params.get("langpair").split("|")[1]
            if self.quota:
                return httpx.Response(200, json={
                    "responseData": {"translatedText": "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY"},
                    "responseStatus": 429, "quotaFinished": True, "responseDetails": "limit"})
            return httpx.Response(200, json={
                "responseData": {"translatedText": f"m-{lang}:{q}"}, "responseStatus": 200, "quotaFinished": False})
        raise AssertionError(f"неожиданный хост {request.url.host}")


@pytest.fixture
def net(monkeypatch):
    n = Net()
    monkeypatch.setattr(settings, "translate_provider", "auto")
    monkeypatch.setattr(settings, "groq_api_key", "")
    monkeypatch.setattr(settings, "mymemory_email", "")
    monkeypatch.setattr(case_translate, "_transport", httpx.MockTransport(n.handler))
    return n


# ---------- Google: разбор и запрос ----------

def test_google_joins_chunks_of_long_text():
    body = [[["Первый кусок. ", "a", None, None, 1], ["Второй кусок.", "b", None, None, 1], [None, None, "translit"]], None, "ru"]
    assert case_translate._google_text(httpx.Response(200, json=body)) == "Первый кусок. Второй кусок."


def test_google_garbage_is_clear_error():
    with pytest.raises(case_translate.TranslateError, match="Google"):
        case_translate._google_text(httpx.Response(200, json={"x": 1}))
    with pytest.raises(case_translate.TranslateError, match="Google"):
        case_translate._google_text(httpx.Response(200, text="<html>"))


def test_google_request_is_urlencoded_and_uses_zh_cn(net, monkeypatch):
    monkeypatch.setattr(settings, "translate_provider", "google")
    case_translate.translate_case({"description": "Игра & Ко = тест"})
    reqs = [r for r in net.requests]
    assert reqs and all(r.url.host == "translate.googleapis.com" and r.url.path == "/translate_a/single" for r in reqs)
    raw = str(reqs[0].url)
    assert "%D0%98%D0%B3%D1%80%D0%B0" in raw and "Игра" not in raw  # кириллица закодирована
    assert "%26" in raw  # амперсанд в тексте не ломает параметры
    assert reqs[0].url.params["q"] == "Игра & Ко = тест"
    assert {r.url.params["tl"] for r in reqs} == {"en", "zh-CN"}
    assert all(r.url.params["client"] == "gtx" and r.url.params["sl"] == "ru" and r.url.params["dt"] == "t" for r in reqs)


def test_google_result_goes_to_right_language(net):
    tr = case_translate.translate_case({"description": "Игра"})
    assert tr["en"]["description"] == "en:Игра" and tr["zh"]["description"] == "zh-CN:Игра"


# ---------- MyMemory ----------

def test_mymemory_parses_and_uses_langpair(net, monkeypatch):
    monkeypatch.setattr(settings, "translate_provider", "mymemory")
    tr = case_translate.translate_case({"description": "Игра"})
    pairs = {r.url.params["langpair"] for r in net.requests}
    assert pairs == {"ru|en", "ru|zh"}
    assert tr["en"]["description"] == "m-en:Игра" and tr["zh"]["description"] == "m-zh:Игра"
    assert all("de" not in r.url.params for r in net.requests)


def test_mymemory_email_adds_de(net, monkeypatch):
    monkeypatch.setattr(settings, "translate_provider", "mymemory")
    monkeypatch.setattr(settings, "mymemory_email", "me@example.com")
    case_translate.translate_case({"description": "Игра"})
    assert all(r.url.params["de"] == "me@example.com" for r in net.requests)


def test_mymemory_quota_is_clear_error(net, monkeypatch):
    monkeypatch.setattr(settings, "translate_provider", "mymemory")
    net.quota = True
    with pytest.raises(case_translate.TranslateError) as e:
        case_translate.translate_case({"description": "Игра"})
    assert "MyMemory" in str(e.value) and "лимит" in str(e.value).lower() and "MYMEMORY_EMAIL" in str(e.value)


# ---------- выбор провайдера ----------

def test_auto_without_keys_uses_google_only(net):
    case_translate.translate_case(SOURCE)
    assert net.sent("googleapis") and net.sent("mymemory") == []
    assert case_translate.is_configured() is True


def test_auto_falls_back_to_mymemory_when_google_dies(net):
    net.google = 503
    tr = case_translate.translate_case(SOURCE)
    assert net.sent("mymemory") and tr["en"]["description"] == "m-en:Запуск"
    assert any("Google" in n and "MyMemory" in n for n in tr.notes)


def test_auto_without_failures_has_no_notes(net):
    assert case_translate.translate_case(SOURCE).notes == []


def test_auto_all_dead_names_every_provider(net):
    net.google, net.mymemory = 500, 500
    with pytest.raises(case_translate.TranslateError) as e:
        case_translate.translate_case(SOURCE)
    assert "Google" in str(e.value) and "MyMemory" in str(e.value)


def test_auto_order_with_deepl_key_first(net, monkeypatch):
    monkeypatch.setattr(settings, "deepl_api_key", "k:fx")
    monkeypatch.setattr(settings, "groq_api_key", "g")
    assert case_translate.provider_chain() == ["deepl", "google", "mymemory", "groq"]
    monkeypatch.setattr(settings, "deepl_api_key", "")
    monkeypatch.setattr(settings, "groq_api_key", "")
    assert case_translate.provider_chain() == ["google", "mymemory"]


def test_explicit_provider_has_no_fallback(net, monkeypatch):
    monkeypatch.setattr(settings, "translate_provider", "google")
    net.google = 500
    with pytest.raises(case_translate.TranslateError, match="Google"):
        case_translate.translate_case(SOURCE)
    assert net.sent("mymemory") == []


# ---------- качество ----------

def test_list_fields_keep_item_count_and_blank_lines(net):
    tr = case_translate.translate_case({"what_was_done": "Стримы\n\nKPI\nОтчёт", "result": "A\nB"})
    for lang in ("en", "zh"):
        assert len(tr[lang]["what_was_done"].split("\n")) == 4
        assert tr[lang]["what_was_done"].split("\n")[1] == ""
        assert len(tr[lang]["result"].split("\n")) == 2


def test_empty_and_url_only_lines_are_not_sent(net):
    tr = case_translate.translate_case({
        "title": "Игра", "mini": "", "description": None,
        "what_was_done": "Стрим\nhttps://www.twitch.tv/gtr126\n   \n@gtr_nick",
    })
    sent = net.sent("googleapis")
    assert all(s.strip() for s in sent)
    assert not any("twitch.tv" in s or "gtr_nick" in s for s in sent)
    # строка-ссылка и ник доезжают до результата как есть
    for lang in ("en", "zh"):
        lines = tr[lang]["what_was_done"].split("\n")
        assert lines[1] == "https://www.twitch.tv/gtr126" and lines[3] == "@gtr_nick"
    assert tr["en"]["mini"] == "" and tr["en"]["description"] == ""


def test_inline_url_nick_erid_survive_and_are_hidden_from_translator(net):
    src = "Стрим на https://twitch.tv/gtr126, ник @gtr_nick, erid: 2VtzqGTR126"
    tr = case_translate.translate_case({"description": src})
    sent = net.sent("googleapis")
    assert sent and not any("twitch.tv" in s or "gtr_nick" in s or "2VtzqGTR126" in s for s in sent)
    for lang in ("en", "zh"):
        out = tr[lang]["description"]
        assert "https://twitch.tv/gtr126" in out and "@gtr_nick" in out and "erid: 2VtzqGTR126" in out


def test_lost_placeholder_keeps_source_line(net, monkeypatch):
    # переводчик съел защищённый кусок: оставляем русский оригинал строки, а не битый текст
    def eat(request):
        return httpx.Response(200, json=[[["просто текст", "x"]], None, "ru"])

    monkeypatch.setattr(case_translate, "_transport", httpx.MockTransport(eat))
    tr = case_translate.translate_case({"description": "Смотри https://twitch.tv/gtr126 тут"})
    assert tr["en"]["description"] == "Смотри https://twitch.tv/gtr126 тут"


def test_long_line_is_split_into_chunks_for_mymemory(net, monkeypatch):
    monkeypatch.setattr(settings, "translate_provider", "mymemory")
    long_line = " ".join(["слово"] * 300)
    tr = case_translate.translate_case({"description": long_line})
    sent = net.sent("mymemory")
    assert len(sent) > 2 and all(len(s) <= case_translate.MYMEMORY_CHUNK for s in sent)
    assert tr["en"]["description"].replace("m-en:", "").split() == long_line.split()


def test_all_empty_source_makes_no_requests(net):
    case_translate.translate_case({})
    assert net.requests == []


# ---------- публикация ----------

class FakeDb:
    def __init__(self):
        self.commits = 0

    def commit(self):
        self.commits += 1


def _case():
    return SimpleNamespace(title="Игра gtr-126002", site_mini="20 млн+", description="Запуск",
                           what_was_done="Стримы\nKPI", result="13 млн", translations=None)


def test_publish_translates_via_google_without_keys(net):
    c, db = _case(), FakeDb()
    done, warnings = asyncio.run(site_publisher.translate_missing(db, [c]))
    assert (done, warnings) == (1, [])
    saved = json.loads(c.translations)
    assert saved["en"]["description"] == "en:Запуск" and saved["zh"]["description"] == "zh-CN:Запуск"


def test_publish_warns_which_provider_saved_the_day(net):
    net.google = 500
    c = _case()
    done, warnings = asyncio.run(site_publisher.translate_missing(FakeDb(), [c]))
    assert done == 1 and len(warnings) == 1 and "Google" in warnings[0] and "MyMemory" in warnings[0]


def test_publish_survives_all_providers_dead(net):
    net.google, net.mymemory = 500, 500
    c = _case()
    done, warnings = asyncio.run(site_publisher.translate_missing(FakeDb(), [c]))
    assert done == 0 and c.translations is None
    assert len(warnings) == 1 and "Google" in warnings[0] and "MyMemory" in warnings[0]
    assert "на сайте будет русский текст" in warnings[0]


def test_publish_survives_network_error(monkeypatch):
    def boom(request):
        raise httpx.ConnectError("нет сети")

    monkeypatch.setattr(settings, "translate_provider", "auto")
    monkeypatch.setattr(settings, "groq_api_key", "")
    monkeypatch.setattr(case_translate, "_transport", httpx.MockTransport(boom))
    done, warnings = asyncio.run(site_publisher.translate_missing(FakeDb(), [_case()]))
    assert done == 0 and len(warnings) == 1


def test_nazvanie_kejsa_ne_perevoditsya(net, monkeypatch):
    """Название бренда переводить нельзя: на китайском BuffBuff превращался в 增益增益."""
    monkeypatch.setattr(settings, "translate_provider", "google")
    src = dict(SOURCE, title="BuffBuff")
    out = case_translate.translate_case(src)
    assert out["en"]["title"] == "BuffBuff"
    assert out["zh"]["title"] == "BuffBuff"
    # и переводчику его вообще не отправляли
    assert all("BuffBuff" not in (q or "") for q in net.sent("googleapis"))


def test_defaults_and_timeouts():
    assert type(settings).model_fields["mymemory_email"].default == ""
    assert case_translate.FREE_TIMEOUT_SEC <= 10
    assert case_translate.CASE_DEADLINE_SEC < site_publisher.TRANSLATE_BUDGET_SEC
