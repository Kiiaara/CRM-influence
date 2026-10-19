"""Импорт из гугл-таблицы берёт только ник, ссылку и площадку.
Цены и прочие колонки в таблице есть, но в CRM попадать не должны."""
import io

import pytest
from openpyxl import Workbook

import blogger_sheet


def _book(rows: list[list], title: str = "Телеграм") -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = title
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_cena_ne_importiruetsya():
    """Колонка со стоимостью есть в таблице, но в базу не едет."""
    data = _book([
        ["Имя блогера", "Ссылки на медиалиц", "Стоимость", "Подписчики"],
        ["Лолита", "https://t.me/virginlolita", "50 000", "120000"],
    ])
    items, _ = blogger_sheet.parse_workbook_with_tabs(data)
    assert len(items) == 1
    it = items[0]
    assert it["name"] == "Лолита"
    assert it["url"] == "https://t.me/virginlolita"
    # цены и подписчиков быть не должно
    assert it.get("price") is None
    assert it.get("subscribers") is None


def test_ssylki_vo_mnozhestvennom_chisle():
    """Колонка называется "Ссылки на медиалиц" - раньше не распознавалась."""
    data = _book([
        ["Имя блогера", "Ссылки на медиалиц"],
        ["Лолита", "https://t.me/virginlolita"],
    ])
    items, _ = blogger_sheet.parse_workbook_with_tabs(data)
    assert items[0]["url"] == "https://t.me/virginlolita"


def test_sheet_row_bez_cen():
    """Сырая строка тоже не должна тащить прайс: её видно в карточке блогера."""
    data = _book([
        ["Имя блогера", "Ссылки на медиалиц", "Цена за пост"],
        ["Лолита", "https://t.me/virginlolita", "50 000"],
    ])
    items, _ = blogger_sheet.parse_workbook_with_tabs(data)
    dumped = str(items[0].get("sheet_row", []))
    assert "50 000" not in dumped
    assert "Цена за пост" not in dumped
    # а имя и ссылка на месте
    assert "virginlolita" in dumped


def test_ostalnye_kolonki_ignoriruyutsya():
    """Гео, менеджер, тематика - в таблице есть, в базе нет."""
    data = _book([
        ["Ник", "Ссылка", "Гео", "Менеджер", "Тематика"],
        ["Лолита", "https://t.me/virginlolita", "Россия", "Лера", "Бьюти"],
    ])
    items, _ = blogger_sheet.parse_workbook_with_tabs(data)
    it = items[0]
    assert it.get("geo", "") == ""
    assert it.get("manager", "") == ""
    assert it.get("category", "") == ""


def test_ploshchadka_iz_nazvaniya_lista():
    data = _book([
        ["Имя блогера", "Ссылки на медиалиц"],
        ["Лолита", "https://t.me/virginlolita"],
    ], title="Тикток")
    items, tabs = blogger_sheet.parse_workbook_with_tabs(data)
    assert items[0]["platform"] == "Тикток"
    assert tabs == ["Тикток"]


def test_imya_iz_ssylki_esli_kolonki_imeni_net():
    data = _book([
        ["Ссылки на медиалиц"],
        ["https://t.me/virginlolita"],
    ])
    items, _ = blogger_sheet.parse_workbook_with_tabs(data)
    assert items[0]["name"] == "virginlolita"
