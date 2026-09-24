"""Импорт базы блогеров из гугл-таблицы (или xlsx-файла).

Таблица большая, с листами по площадкам (YouTube, Instagram, TikTok...), и колонки
на листах называются по-разному. Поэтому колонки ищем по ключевым словам в заголовке,
а название листа считаем площадкой. Берём минимум: имя, ссылку на блогера, его TG -
плюс подписчиков/просмотры/цену/тематику/гео/менеджера, если такие колонки нашлись.
"""
import io
import re
from typing import Optional

import httpx
from openpyxl import load_workbook
from sqlalchemy.orm import Session

from models.app_setting import AppSetting
from models.blogger_profile import BloggerProfile

SHEET_URL_KEY = "bloggers_sheet_url"

_SHEET_ID_RE = re.compile(r"/spreadsheets/d/([a-zA-Z0-9_-]+)")

# поле -> ключевые слова в заголовке колонки (в нижнем регистре, ищем вхождение).
# Порядок важен: telegram проверяем раньше url, чтобы "Ссылка на ТГ" не стала ссылкой на блогера.
_HEADER_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("telegram", ("тг", "telegram", "телеграм", "tg")),
    ("name", ("имя", "ник", "блогер", "name", "инфлюенсер")),
    ("url", ("ссылка", "link", "url", "канал", "профиль", "аккаунт")),
    ("subscribers", ("подписчик", "subscribers", "followers", "фолловер")),
    ("avg_views", ("просмотр", "охват", "views", "reach")),
    ("price", ("стоимость", "цена", "прайс", "price")),
    ("category", ("тематик", "категор", "ниша", "category")),
    ("geo", ("гео", "geo", "страна")),
    ("manager", ("менеджер", "manager")),
    ("notes", ("комментар", "примечан", "заметк", "notes")),
]

_INT_FIELDS = {"subscribers", "avg_views"}
_FLOAT_FIELDS = {"price"}


class SheetImportError(Exception):
    pass


def get_sheet_url(db: Session) -> str:
    row = db.get(AppSetting, SHEET_URL_KEY)
    return row.value if row else ""


def set_sheet_url(db: Session, url: str) -> None:
    row = db.get(AppSetting, SHEET_URL_KEY)
    if row:
        row.value = url
    else:
        db.add(AppSetting(key=SHEET_URL_KEY, value=url))
    db.commit()


def export_url(sheet_url: str) -> str:
    m = _SHEET_ID_RE.search(sheet_url or "")
    if not m:
        raise SheetImportError("Не похоже на ссылку гугл-таблицы (нужна ссылка вида docs.google.com/spreadsheets/d/...)")
    return f"https://docs.google.com/spreadsheets/d/{m.group(1)}/export?format=xlsx"


def _clean_number(value) -> Optional[float]:
    """'1,2 млн', '150 000', '82%' -> число. Поддерживаем суффиксы к/k и млн/m."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().lower().replace("\xa0", " ")
    if not s:
        return None
    mult = 1
    if re.search(r"(млн|\bm\b|m$)", s):
        mult = 1_000_000
    elif re.search(r"(тыс|к$|k$|\bк\b|\bk\b)", s):
        mult = 1_000
    cleaned = "".join(ch for ch in s if ch.isdigit() or ch in ".,")
    cleaned = cleaned.replace(",", ".")
    if cleaned.count(".") > 1:
        # "150.000.000" - точки как разделители тысяч
        cleaned = cleaned.replace(".", "")
    if not cleaned or cleaned == ".":
        return None
    try:
        return float(cleaned) * mult
    except ValueError:
        return None


def _match_header(text: str) -> Optional[str]:
    t = text.strip().lower()
    if not t:
        return None
    for field, words in _HEADER_KEYWORDS:
        for w in words:
            # короткие ключи ("тг", "tg", "ник") - только отдельным словом, иначе "тг" найдётся в "стоимость тг-поста"
            if len(w) <= 3:
                if re.search(rf"(^|[^a-zа-яё]){re.escape(w)}([^a-zа-яё]|$)", t):
                    return field
            elif w in t:
                return field
    return None


def _find_header(rows: list[tuple]) -> tuple[int, dict[int, str]]:
    """Ищем строку-заголовок среди первых 10: ту, где нашлось больше всего известных колонок
    и обязательно есть имя или ссылка."""
    best_idx, best_map = -1, {}
    for idx, row in enumerate(rows[:10]):
        col_map: dict[int, str] = {}
        for ci, cell in enumerate(row):
            if cell.value is None:
                continue
            field = _match_header(str(cell.value))
            if field and field not in col_map.values():
                col_map[ci] = field
        if ("name" in col_map.values() or "url" in col_map.values()) and len(col_map) > len(best_map):
            best_idx, best_map = idx, col_map
    return best_idx, best_map


def _name_from_url(url: str) -> str:
    s = (url or "").strip().rstrip("/")
    if not s:
        return ""
    tail = s.rsplit("/", 1)[-1]
    return tail.lstrip("@").split("?", 1)[0]


def _cell_text(cell) -> str:
    v = cell.value
    if v is None:
        return ""
    return str(v).strip()


def parse_workbook(content: bytes) -> list[dict]:
    """Возвращает список блогеров {name, platform, url, telegram, ...} со всех листов."""
    try:
        wb = load_workbook(io.BytesIO(content), data_only=True)
    except Exception as e:
        raise SheetImportError(f"Не удалось прочитать таблицу: {e}")

    result: list[dict] = []
    for ws in wb.worksheets:
        rows = list(ws.iter_rows())
        if not rows:
            continue
        header_idx, col_map = _find_header(rows)
        if header_idx < 0:
            continue
        platform = ws.title.strip()[:64]
        for row in rows[header_idx + 1:]:
            item: dict = {"platform": platform}
            name_hyperlink = ""
            for ci, field in col_map.items():
                if ci >= len(row):
                    continue
                cell = row[ci]
                text = _cell_text(cell)
                if field == "name" and cell.hyperlink is not None and cell.hyperlink.target:
                    # в гугл-таблицах имя часто само является ссылкой на канал
                    name_hyperlink = cell.hyperlink.target
                if field in ("url", "telegram") and not text.startswith("http") and cell.hyperlink is not None and cell.hyperlink.target:
                    text = cell.hyperlink.target
                if field in _INT_FIELDS:
                    n = _clean_number(cell.value)
                    item[field] = int(n) if n is not None else None
                elif field in _FLOAT_FIELDS:
                    item[field] = _clean_number(cell.value)
                else:
                    item[field] = text
            if not item.get("url") and name_hyperlink:
                item["url"] = name_hyperlink
            url_text = item.get("url") or ""
            if url_text and not item.get("name") and not re.search(r"[./]", url_text):
                # колонка "Канал" без ссылки - это просто название канала
                item["name"], item["url"] = url_text, name_hyperlink
            name = (item.get("name") or "").strip() or _name_from_url(item.get("url") or "")
            if not name:
                continue
            item["name"] = name[:255]
            result.append(item)
    return result


def upsert_bloggers(db: Session, items: list[dict]) -> dict:
    """Строка с тем же именем и площадкой обновляется, новая - создаётся.
    Пустые ячейки таблицы не затирают то, что уже заполнено в CRM руками."""
    existing = {(b.name.lower(), b.platform.lower()): b for b in db.query(BloggerProfile).all()}
    created, updated = 0, 0
    for item in items:
        key = (item["name"].lower(), item.get("platform", "").lower())
        values = {k: v for k, v in item.items() if v not in (None, "")}
        b = existing.get(key)
        if b:
            for k, v in values.items():
                setattr(b, k, v)
            updated += 1
        else:
            b = BloggerProfile(**values)
            db.add(b)
            existing[key] = b
            created += 1
    db.commit()
    return {"created": created, "updated": updated, "total": len(items)}


async def download_sheet(sheet_url: str) -> bytes:
    url = export_url(sheet_url)
    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            r = await client.get(url)
    except httpx.HTTPError as e:
        raise SheetImportError(f"Не удалось скачать таблицу: {e}")
    ctype = r.headers.get("content-type", "")
    if r.status_code != 200 or "html" in ctype:
        raise SheetImportError(
            "Гугл не отдал таблицу. Открой доступ «Все, у кого есть ссылка → Читатель» и попробуй ещё раз."
        )
    return r.content


async def sync_from_sheet(db: Session) -> dict:
    sheet_url = get_sheet_url(db)
    if not sheet_url:
        raise SheetImportError("Ссылка на таблицу блогеров не задана")
    content = await download_sheet(sheet_url)
    return upsert_bloggers(db, parse_workbook(content))
