"""Числа с сокращениями в кейсах должны выглядеть одинаково на каждом языке.

На сайте вышло вразнобой: "34к+ просмотров" стало "3.4万+ 观看次数", а "22к+ просмотров"
осталось "22k+ 观看次数". Переводчик сворачивает тысячи в 万 как придётся, поэтому
приводим числа сами, до отправки на перевод.
"""
import pytest

import case_translate as ct


@pytest.mark.parametrize(
    "src, en, zh",
    [
        ("34к+ просмотров", "34k+", "3.4万+"),
        ("22к+ просмотров", "22k+", "2.2万+"),
        ("709к+ просмотров", "709k+", "70.9万+"),
        ("1,9 млн+ просмотров", "1.9M+", "190万+"),
        ("23,5 млн+ просмотров", "23.5M+", "2350万+"),
        ("13 млн", "13M", "1300万"),
        ("6,8 млн+ просмотров", "6.8M+", "680万+"),
    ],
)
def test_chisla_privodyatsya_k_edinomu_vidu(src, en, zh):
    """Русское сокращение -> латинское для en и 万 для zh."""
    assert ct.localize_numbers(src, "en").startswith(en)
    assert ct.localize_numbers(src, "zh").startswith(zh)


def test_tekst_vokrug_chisla_ne_tryaetsya():
    out = ct.localize_numbers("Более 34к+ просмотров за сутки", "zh")
    assert "3.4万+" in out
    assert "Более" in out and "просмотров за сутки" in out


def test_bez_sokrashcheniy_nichego_ne_menyaetsya():
    for text in ("Просто текст", "100 просмотров", "", "https://t.me/abc"):
        assert ct.localize_numbers(text, "zh") == text
        assert ct.localize_numbers(text, "en") == text


def test_odna_tysyacha_ne_stanovitsya_drobyu():
    """10к это ровно 1万, без .0 в хвосте."""
    assert ct.localize_numbers("10к просмотров", "zh").startswith("1万")
    assert ct.localize_numbers("100к просмотров", "zh").startswith("10万")


def test_tochka_ot_sokrashcheniya_ne_ostayotsya():
    """"34 тыс. просмотров" не должно давать "34k. просмотров"."""
    assert "34k." not in ct.localize_numbers("Более 34 тыс. просмотров", "en")
    assert ct.localize_numbers("Более 34 тыс. просмотров", "en").startswith("Более 34k ")
    assert "万." not in ct.localize_numbers("Более 34 тыс. просмотров", "zh")


def test_latinskoe_k_tozhe_lovitsya():
    """В текстах встречается и латинская k."""
    assert ct.localize_numbers("34k+ просмотров", "zh").startswith("3.4万+")


def test_primenyaetsya_pri_perevode(monkeypatch):
    """Числа приводятся до отправки переводчику, а не после."""
    sent = []

    def fake_one(client, text, lang):
        sent.append((lang, text))
        return text

    monkeypatch.setattr(ct, "_google_one", fake_one)
    monkeypatch.setattr(ct.settings, "translate_provider", "google")
    out = ct.translate_case({"mini": "22к+ просмотров"})
    # в китайский ушло уже свёрнутое число
    assert any(lang == "zh" and "2.2万+" in text for lang, text in sent)
    assert "2.2万+" in out["zh"]["mini"]
