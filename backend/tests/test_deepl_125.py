"""Перевод кейсов через DeepL и выбор провайдера (DeepL / Groq / auto).

Диапазон id 125xxx, токены dpl-. Сеть мокается через case_translate._transport,
настоящих запросов к DeepL и Groq нет.
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
    "title": "Игра dpl-125001",
    "mini": "20 млн+ просмотров",
    "description": "Запуск",
    "what_was_done": "Стримы\nKPI\nОтчёт",
    "result": "13 млн",
}


class DeepL:
    """Подмена DeepL: пишет запросы, на каждый text отвечает '<язык>:<текст>'."""

    def __init__(self, status=200):
        self.status = status
        self.requests = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if "deepl" not in request.url.host:
            return httpx.Response(503)  # Google/MyMemory из цепочки auto в этих тестах недоступны
        body = json.loads(request.content)
        self.requests.append({"url": request.url, "headers": request.headers, "body": body})
        if self.status != 200:
            return httpx.Response(self.status, text="err")
        lang = body["target_lang"]
        return httpx.Response(200, json={
            "translations": [{"detected_source_language": "RU", "text": f"{lang}:{t}"} for t in body["text"]],
        })


class Groq:
    """Подмена Groq: считает вызовы."""

    def __init__(self):
        self.calls = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        answer = {lang: {f: f"g-{lang}" for f in case_translate.FIELDS} for lang in ("en", "zh")}
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(answer)}}]})


@pytest.fixture
def deepl(monkeypatch):
    d = DeepL()
    monkeypatch.setattr(settings, "deepl_api_key", "dpl-key:fx")
    monkeypatch.setattr(settings, "translate_provider", "auto")
    monkeypatch.setattr(case_translate, "_transport", httpx.MockTransport(d.handler))
    return d


# ---------- адрес и авторизация ----------

def test_free_key_goes_to_api_free(deepl):
    case_translate.translate_case(SOURCE)
    assert deepl.requests
    for r in deepl.requests:
        assert r["url"].host == "api-free.deepl.com" and r["url"].path == "/v2/translate"


def test_pro_key_goes_to_api(deepl, monkeypatch):
    monkeypatch.setattr(settings, "deepl_api_key", "dpl-pro-key")
    case_translate.translate_case(SOURCE)
    for r in deepl.requests:
        assert r["url"].host == "api.deepl.com" and r["url"].path == "/v2/translate"


def test_auth_header_format(deepl):
    case_translate.translate_case(SOURCE)
    for r in deepl.requests:
        assert r["headers"]["authorization"] == "DeepL-Auth-Key dpl-key:fx"


# ---------- запросы и разбор ----------

def test_one_request_per_language_with_all_fields(deepl):
    tr = case_translate.translate_case(SOURCE)
    assert len(deepl.requests) == 2
    by_lang = {r["body"]["target_lang"]: r["body"] for r in deepl.requests}
    assert set(by_lang) == {"EN-US", "ZH"}
    for body in by_lang.values():
        assert body["source_lang"] == "RU"
        sent = " | ".join(body["text"])
        # title не отправляем: название бренда не переводится
        for f in case_translate.FIELDS:
            if f in case_translate.KEEP_AS_IS_FIELDS:
                assert SOURCE[f] not in sent
                continue
            for line in SOURCE[f].split("\n"):
                assert line in sent
    assert tr["en"]["description"] == "EN-US:Запуск"
    assert tr["zh"]["mini"] == "ZH:20 млн+ просмотров"


def test_list_fields_keep_line_count(deepl):
    tr = case_translate.translate_case(SOURCE)
    assert tr["en"]["what_was_done"].split("\n") == ["EN-US:Стримы", "EN-US:KPI", "EN-US:Отчёт"]
    assert len(tr["zh"]["what_was_done"].split("\n")) == 3


def test_empty_fields_are_not_sent_and_stay_empty(deepl):
    tr = case_translate.translate_case({"title": "Игра", "mini": "", "description": None, "what_was_done": "A\n\nB"})
    for r in deepl.requests:
        assert all(t.strip() for t in r["body"]["text"])
    assert tr["en"]["mini"] == "" and tr["en"]["description"] == "" and tr["en"]["result"] == ""
    assert tr["en"]["what_was_done"] == "EN-US:A\n\nEN-US:B"


def test_all_empty_source_makes_no_requests(deepl):
    tr = case_translate.translate_case({})
    assert deepl.requests == []
    assert all(v == "" for lang in ("en", "zh") for v in tr[lang].values())


# ---------- выбор провайдера ----------

def _both(monkeypatch, provider="auto", deepl_key="dpl-key:fx", groq_key="gsk-dpl"):
    d, g = DeepL(), Groq()

    def route(request):
        if "deepl" in request.url.host:
            return d.handler(request)
        if "groq" in request.url.host:
            return g.handler(request)
        return httpx.Response(503)  # Google/MyMemory в этих тестах недоступны, auto доходит до Groq

    monkeypatch.setattr(settings, "deepl_api_key", deepl_key)
    monkeypatch.setattr(settings, "groq_api_key", groq_key)
    monkeypatch.setattr(settings, "translate_provider", provider)
    monkeypatch.setattr(case_translate, "_transport", httpx.MockTransport(route))
    return d, g


def test_auto_prefers_deepl_when_key_set(monkeypatch):
    d, g = _both(monkeypatch)
    case_translate.translate_case(SOURCE)
    assert len(d.requests) == 2 and g.calls == 0


def test_auto_falls_back_to_groq_without_deepl_key(monkeypatch):
    d, g = _both(monkeypatch, deepl_key="")
    case_translate.translate_case(SOURCE)
    assert d.requests == [] and g.calls == 1


def test_explicit_groq_ignores_deepl_key(monkeypatch):
    d, g = _both(monkeypatch, provider="groq")
    case_translate.translate_case(SOURCE)
    assert d.requests == [] and g.calls == 1


def test_explicit_deepl_without_key_is_error_naming_deepl(monkeypatch):
    _both(monkeypatch, provider="deepl", deepl_key="")
    with pytest.raises(case_translate.TranslateError, match="DEEPL_API_KEY"):
        case_translate.translate_case(SOURCE)


def test_auto_without_any_key_goes_to_free_providers(monkeypatch):
    # ключей нет: auto не падает с "не настроен", а пробует Google и MyMemory (здесь оба недоступны)
    _both(monkeypatch, deepl_key="", groq_key="")
    with pytest.raises(case_translate.TranslateError) as e:
        case_translate.translate_case(SOURCE)
    assert "Google" in str(e.value) and "MyMemory" in str(e.value)


def test_is_configured_follows_provider(monkeypatch):
    _both(monkeypatch, deepl_key="", groq_key="")
    assert case_translate.is_configured() is True  # Google работает без ключей
    _both(monkeypatch, deepl_key="k:fx", groq_key="")
    assert case_translate.is_configured() is True
    _both(monkeypatch, provider="groq", deepl_key="k:fx", groq_key="")
    assert case_translate.is_configured() is False
    _both(monkeypatch, provider="deepl", deepl_key="", groq_key="g")
    assert case_translate.is_configured() is False


def test_defaults():
    assert settings.translate_provider == "auto" or settings.translate_provider in ("deepl", "groq")
    assert type(settings).model_fields["translate_provider"].default == "auto"
    assert type(settings).model_fields["deepl_api_key"].default == ""


# ---------- ошибки DeepL ----------

@pytest.mark.parametrize("status", [403, 429, 456, 500, 400])
def test_deepl_errors_name_provider(deepl, status):
    deepl.status = status
    with pytest.raises(case_translate.TranslateError, match="DeepL"):
        case_translate.translate_case(SOURCE)


def test_deepl_network_error_names_provider(monkeypatch):
    def boom(request):
        raise httpx.ConnectError("нет сети")

    monkeypatch.setattr(settings, "deepl_api_key", "k:fx")
    monkeypatch.setattr(settings, "translate_provider", "auto")
    monkeypatch.setattr(case_translate, "_transport", httpx.MockTransport(boom))
    with pytest.raises(case_translate.TranslateError, match="DeepL"):
        case_translate.translate_case(SOURCE)


def test_deepl_bad_response_names_provider(monkeypatch):
    monkeypatch.setattr(settings, "deepl_api_key", "k:fx")
    monkeypatch.setattr(settings, "translate_provider", "auto")
    monkeypatch.setattr(case_translate, "_transport", httpx.MockTransport(
        lambda r: httpx.Response(200, json={"translations": []})))
    with pytest.raises(case_translate.TranslateError, match="DeepL"):
        case_translate.translate_case(SOURCE)


# ---------- публикация ----------

class FakeDb:
    def __init__(self):
        self.commits = 0

    def commit(self):
        self.commits += 1


def _case(translations=None):
    return SimpleNamespace(
        title="Игра dpl-125002", site_mini="20 млн+", description="Запуск",
        what_was_done="Стримы\nKPI", result="13 млн", translations=translations,
    )


def test_publish_translates_via_deepl_and_saves(deepl):
    c, db = _case(), FakeDb()
    done, warnings = asyncio.run(site_publisher.translate_missing(db, [c]))
    assert (done, warnings) == (1, [])
    saved = json.loads(c.translations)
    assert saved["en"]["description"] == "EN-US:Запуск" and saved["zh"]["description"] == "ZH:Запуск"
    assert db.commits == 1


def test_publish_does_not_overwrite_ready_translation_with_deepl(deepl):
    ready = json.dumps({"en": {"title": "Mine"}, "zh": {"title": "我的"}}, ensure_ascii=False)
    c = _case(ready)
    done, warnings = asyncio.run(site_publisher.translate_missing(FakeDb(), [c]))
    assert done == 0 and warnings == [] and deepl.requests == []
    assert c.translations == ready


@pytest.mark.parametrize("status", [403, 456])
def test_publish_survives_deepl_error_and_names_provider(deepl, status):
    deepl.status = status
    c = _case()
    done, warnings = asyncio.run(site_publisher.translate_missing(FakeDb(), [c]))
    assert done == 0 and c.translations is None
    assert len(warnings) == 1 and "DeepL" in warnings[0] and "на сайте будет русский текст" in warnings[0]


def test_budget_still_guards_deepl(deepl, monkeypatch):
    monkeypatch.setattr(site_publisher, "TRANSLATE_BUDGET_SEC", 0)
    done, warnings = asyncio.run(site_publisher.translate_missing(FakeDb(), [_case()]))
    assert done == 0 and deepl.requests == [] and "время" in warnings[0].lower()
    assert case_translate.TIMEOUT_SEC <= 30
