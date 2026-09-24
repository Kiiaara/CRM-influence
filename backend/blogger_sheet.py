"""Импорт базы блогеров из гугл-таблицы (или xlsx-файла).

Таблица большая, с листами по площадкам (YouTube, Instagram, TikTok...), и колонки
на листах называются по-разному. Поэтому колонки ищем по ключевым словам в заголовке,
а название листа считаем площадкой. Берём минимум: имя, ссылку на блогера, его TG -
плюс подписчиков/просмотры/цену/тематику/гео/менеджера, если такие колонки нашлись.
"""
import io
import json
import re
from datetime import datetime
from typing import Optional

import httpx
from openpyxl import load_workbook
from sqlalchemy.orm import Session

from models.app_setting import AppSetting
from models.blogger_profile import BloggerProfile

SHEET_URL_KEY = "bloggers_sheet_url"
TABS_KEY = "bloggers_sheet_tabs"  # JSON: названия листов в порядке таблицы - так же идут вкладки в CRM
LAST_SYNC_KEY = "bloggers_last_sync"  # JSON: {at, created, updated, deleted, error}

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


def _get_json(db: Session, key: str, default):
    row = db.get(AppSetting, key)
    if not row or not row.value:
        return default
    try:
        return json.loads(row.value)
    except ValueError:
        return default


def _set_json(db: Session, key: str, value) -> None:
    row = db.get(AppSetting, key)
    raw = json.dumps(value, ensure_ascii=False)
    if row:
        row.value = raw
    else:
        db.add(AppSetting(key=key, value=raw))


def get_tabs(db: Session) -> list[str]:
    return _get_json(db, TABS_KEY, [])


def get_last_sync(db: Session) -> Optional[dict]:
    return _get_json(db, LAST_SYNC_KEY, None)


def _record_sync(db: Session, result: Optional[dict], error: Optional[str]) -> None:
    info = {"at": datetime.now().isoformat(timespec="seconds"), "error": error}
    if result:
        info.update({k: result.get(k, 0) for k in ("created", "updated", "deleted")})
    _set_json(db, LAST_SYNC_KEY, info)
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
    if isinstance(v, datetime):
        return v.strftime("%d.%m.%Y")
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def _hyperlink(cell) -> str:
    return cell.hyperlink.target if cell.hyperlink is not None and cell.hyperlink.target else ""


def parse_workbook(content: bytes) -> list[dict]:
    return parse_workbook_with_tabs(content)[0]


def parse_workbook_with_tabs(content: bytes) -> tuple[list[dict], list[str]]:
    """Возвращает (блогеры {name, platform, url, telegram, ..., sheet_row} со всех листов,
    названия листов с блогерами в порядке таблицы)."""
    try:
        wb = load_workbook(io.BytesIO(content), data_only=True)
    except Exception as e:
        raise SheetImportError(f"Не удалось прочитать таблицу: {e}")

    result: list[dict] = []
    tabs: list[str] = []
    for ws in wb.worksheets:
        if ws.sheet_state != "visible":
            continue
        rows = list(ws.iter_rows())
        if not rows:
            continue
        header_idx, col_map = _find_header(rows)
        if header_idx < 0:
            continue
        platform = ws.title.strip()[:64]
        # все подписанные колонки листа - чтобы показать вкладку в CRM так же, как в таблице
        headers = {ci: _cell_text(c) for ci, c in enumerate(rows[header_idx]) if _cell_text(c)}
        found = False
        for row in rows[header_idx + 1:]:
            item: dict = {"platform": platform}
            sheet_row = []
            for ci, h in headers.items():
                if ci >= len(row):
                    continue
                text, link = _cell_text(row[ci]), _hyperlink(row[ci])
                if text or link:
                    entry = {"h": h, "v": text or link}
                    if link and link != text:
                        entry["u"] = link
                    sheet_row.append(entry)
            item["sheet_row"] = sheet_row
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
            found = True
        if found:
            tabs.append(platform)
    return result, tabs


# поля, которые берутся из таблицы; пустая ячейка = пустое поле (таблица - единственный источник)
_SYNC_TEXT_FIELDS = ("platform", "url", "telegram", "category", "geo", "manager", "notes")
_SYNC_NUM_FIELDS = ("subscribers", "avg_views", "price")


def upsert_bloggers(db: Session, items: list[dict], tabs: Optional[list[str]] = None) -> dict:
    """Приводим базу блогеров к таблице: строка с тем же именем и площадкой обновляется,
    новая - создаётся, всё, чего в таблице больше нет, удаляется. В CRM база только
    для чтения, поэтому таблица - единственный источник правды."""
    existing = {(b.name.lower(), b.platform.lower()): b for b in db.query(BloggerProfile).all()}
    created, updated, deleted = 0, 0, 0
    seen: set[tuple[str, str]] = set()
    for item in items:
        key = (item["name"].lower(), item.get("platform", "").lower())
        if key in seen:
            continue  # дубль строки на листе - берём первую
        seen.add(key)
        values: dict = {"name": item["name"], "source": "sheet"}
        values.update({f: item.get(f) or "" for f in _SYNC_TEXT_FIELDS})
        values.update({f: item.get(f) for f in _SYNC_NUM_FIELDS})
        values["sheet_row"] = json.dumps(item.get("sheet_row") or [], ensure_ascii=False)
        b = existing.get(key)
        if b:
            for k, v in values.items():
                setattr(b, k, v)
            updated += 1
        else:
            db.add(BloggerProfile(**values))
            created += 1
    for key, b in existing.items():
        if key not in seen:
            db.delete(b)
            deleted += 1
    if tabs is not None:
        # порядок вкладок как в таблице
        _set_json(db, TABS_KEY, tabs)
    db.commit()
    return {"created": created, "updated": updated, "deleted": deleted, "total": len(seen)}


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
    try:
        content = await download_sheet(sheet_url)
        items, tabs = parse_workbook_with_tabs(content)
        if not items:
            raise SheetImportError("В таблице не нашлось ни одного блогера - проверь заголовки колонок (Имя/Ник/Ссылка)")
        result = upsert_bloggers(db, items, tabs)
    except SheetImportError as e:
        db.rollback()
        _record_sync(db, None, str(e))
        raise
    _record_sync(db, result, None)
    return result
