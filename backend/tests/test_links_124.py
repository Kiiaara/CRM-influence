"""Диапазон id 124xxx, токены lnk-.

1) ссылки в текстах кейса становятся кликабельными в cases.json (поля *Html);
2) адрес Groq переопределяется через groq_api_base, при 403 - подсказка про прокси.
"""
import json

import httpx
import pytest

import case_translate
import site_publisher
from config import settings
from models.case_study import CaseStudy


# ---------- задача 1: ссылки ----------

def test_url_becomes_link_with_short_text():
    out = site_publisher.linkify_html("Спецстрим на канале https://www.twitch.tv/xxx")
    assert out == (
        'Спецстрим на канале '
        '<a href="https://www.twitch.tv/xxx" target="_blank" rel="noopener">xxx</a>'
    )


def test_trailing_dot_stays_outside_href():
    out = site_publisher.linkify_html("Канал https://www.twitch.tv/xxx.")
    assert 'href="https://www.twitch.tv/xxx"' in out
    assert out.endswith("</a>.")


def test_trailing_punctuation_and_brackets_trimmed():
    out = site_publisher.linkify_html("(см. https://youtu.be/abc), а потом https://t.me/chan!")
    assert 'href="https://youtu.be/abc"' in out and 'href="https://t.me/chan"' in out
    assert out.startswith("(см. <a") and "</a>), а потом" in out and out.endswith("</a>!")


def test_several_links_in_one_field():
    out = site_publisher.linkify_html("http://a.ru/x и https://b.com/y/?q=1#top")
    assert out.count("<a ") == 2
    assert 'href="http://a.ru/x"' in out
    assert 'href="https://b.com/y/?q=1#top"' in out
    assert ">y<" in out  # в видимом тексте только ник, без домена, query и фрагмента


def test_html_in_text_is_escaped():
    out = site_publisher.linkify_html('<script>alert(1)</script> "кавычки" https://t.me/chan <b>x</b>')
    assert "<script>" not in out and "<b>" not in out
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in out
    assert out.count("<a ") == 1


def test_html_in_url_cannot_break_attribute():
    out = site_publisher.linkify_html('https://x.ru/a"onmouseover="alert(1)')
    # кавычка обрывает адрес: остаток уходит в текст после </a>, а не в атрибут ссылки
    assert out.startswith('<a href="https://x.ru/a" target="_blank" rel="noopener">')
    assert out.index("</a>") < out.index("onmouseover")
    out =site_publisher.linkify_html("https://x.ru/?a=1&b=2")
    assert 'href="https://x.ru/?a=1&amp;b=2"' in out


def test_text_without_links_equals_escaped_text():
    for text in ("Обычный текст", "a < b & c", 'Он сказал "да"', ""):
        assert site_publisher.linkify_html(text) == site_publisher._esc(text)


def test_url_before_chinese_text_not_swallowed():
    out = site_publisher.linkify_html("频道https://twitch.tv/xxx直播")
    assert 'href="https://twitch.tv/xxx"' in out and out.endswith("直播")


def test_long_label_shortened():
    out = site_publisher.linkify_html("https://example.com/" + "a" * 80)
    label = out.split(">")[1].split("<")[0]
    assert len(label) <= 40 and label.endswith("...")


def _label(url: str) -> str:
    """Текст, который увидит человек на сайте вместо голой ссылки."""
    return site_publisher.linkify_html(url).split(">")[1].split("<")[0]


def test_tekst_ssylki_tolko_nik():
    """На сайте должен стоять никнейм, без домена и схемы."""
    assert _label("https://www.twitch.tv/soonvooshko") == "soonvooshko"
    assert _label("https://t.me/mychannel") == "mychannel"
    # у телеграма и ютуба ник часто с собакой, её не показываем
    assert _label("https://youtube.com/@somenick") == "somenick"
    assert _label("https://www.tiktok.com/@tiktoker") == "tiktoker"
    # вложенный путь: ник - последний осмысленный кусок
    assert _label("https://www.instagram.com/insta_nick/") == "insta_nick"
    # query и фрагмент в текст не попадают
    assert _label("https://twitch.tv/nick?sr=a&tt=1") == "nick"
    # служебный хвост ник не несёт
    assert _label("https://youtube.com/@somenick/videos") == "somenick"


def test_ssylka_na_domen_bez_puti():
    """Без пути ника нет, показываем домен, но текст не должен быть пустым."""
    assert _label("https://tkacheva-media.ru") == "tkacheva-media.ru"


def _case():
    c = CaseStudy(id=124001, title="Кейс", site_mini="1 млн", description="Описание https://twitch.tv/lnk-a.",
                  what_was_done="- Стрим https://www.twitch.tv/xxx\n- Без ссылки", result="Итог <b>1</b>")
    c.translations = json.dumps({"en": {"description": "Desc https://youtu.be/lnk", "what_was_done": "Stream https://t.me/lnk"}})
    return c


def test_case_to_site_has_html_fields_for_all_langs():
    item = site_publisher.case_to_site(_case(), False)
    for lang in site_publisher.LANGS:
        assert set(item["taskHtml"]) == set(site_publisher.LANGS)
    assert 'href="https://twitch.tv/lnk-a"' in item["taskHtml"]["ru"]
    assert 'href="https://youtu.be/lnk"' in item["taskHtml"]["en"]
    assert item["doingHtml"]["ru"][0].count("<a ") == 1 and item["doingHtml"]["ru"][1] == "Без ссылки"
    assert 'href="https://t.me/lnk"' in item["doingHtml"]["en"][0]
    assert item["resultHtml"]["ru"] == ["Итог &lt;b&gt;1&lt;/b&gt;"]
    # чистые поля остаются прежними: без тегов-ссылок
    assert "<a " not in item["task"]["ru"] and "<a " not in item["doing"]["ru"][0]
    assert item["doing"]["ru"] == ["Стрим https://www.twitch.tv/xxx", "Без ссылки"]


def test_build_files_writes_html_fields():
    files = site_publisher.build_files([_case()])
    data = json.loads(files[site_publisher.CASES_PATH].decode("utf-8"))
    assert 'target="_blank"' in data["cases"][0]["doingHtml"]["ru"][0]


# ---------- задача 2: адрес Groq ----------

def _ok_answer():
    answer = {"en": {"title": "Game"}, "zh": {"title": "游戏"}}
    return {"choices": [{"message": {"content": json.dumps(answer, ensure_ascii=False)}}]}


@pytest.mark.parametrize("base", [
    "https://lnk-proxy.example.workers.dev",
    "https://lnk-proxy.example.workers.dev/",
    "https://lnk-proxy.example.workers.dev//",
])
def test_groq_request_goes_to_configured_base(monkeypatch, base):
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        return httpx.Response(200, json=_ok_answer())

    monkeypatch.setattr(settings, "groq_api_key", "lnk-key")
    monkeypatch.setattr(settings, "groq_api_base", base)
    monkeypatch.setattr(case_translate, "_transport", httpx.MockTransport(handler))
    case_translate.translate_case({"title": "Игра"})
    assert seen["url"] == "https://lnk-proxy.example.workers.dev/openai/v1/chat/completions"


def test_groq_default_base(monkeypatch):
    seen = {}
    monkeypatch.setattr(settings, "groq_api_key", "lnk-key")
    assert settings.groq_api_base == "https://api.groq.com"
    monkeypatch.setattr(case_translate, "_transport", httpx.MockTransport(
        lambda r: seen.update(url=str(r.url)) or httpx.Response(200, json=_ok_answer())))
    case_translate.translate_case({"title": "Игра"})
    assert seen["url"] == "https://api.groq.com/openai/v1/chat/completions"


def test_groq_403_hints_about_proxy(monkeypatch):
    monkeypatch.setattr(settings, "groq_api_key", "lnk-key")
    monkeypatch.setattr(case_translate, "_transport", httpx.MockTransport(lambda r: httpx.Response(403)))
    with pytest.raises(case_translate.TranslateError) as e:
        case_translate.translate_case({"title": "Игра"})
    msg = str(e.value)
    assert "403" in msg and "IP" in msg and "GROQ_API_BASE" in msg
