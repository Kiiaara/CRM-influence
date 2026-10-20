"""Публикация кейсов из CRM на сайт tkacheva-media.

Сайт - статичный index.html в репозитории Kiiaara/site, сервер сам забирает изменения с GitHub.
Кейсы с галочкой «Показывать на сайте» собираем в cases.json (формат - как массив кейсов в
index.html: title/mini/task/doing/result на ru/en/zh), фото конвертируем в webp и одним коммитом
кладём в репозиторий через GitHub Git Data API. index.html читает cases.json и добавляет эти
кейсы к тем, что вписаны в него руками.

Файлы, которые пишет CRM:
  cases.json                       - все опубликованные кейсы
  assets/images/crm/case-<id>.webp - их фото (фото снятых с публикации кейсов удаляются)
"""
import asyncio
import base64
import hashlib
import html
import io
import json
import time
from datetime import datetime
from typing import Optional

import httpx
from PIL import Image
from sqlalchemy.orm import Session

import case_translate
from config import settings
from models.case_study import CaseStudy
from models.integration import Integration
from models.integration_streamer import IntegrationStreamer
from models.workspace import Workspace

CASES_PATH = "cases.json"
IMAGES_DIR = "assets/images/crm"
SITE_TAGS = ("Games", "Tournament", "Special Project")
LANGS = ("ru", "en", "zh")
MAX_IMAGE_SIDE = 1600
GITHUB_API = "https://api.github.com"
# сколько секунд суммарно тратим на автоперевод при публикации. Запрос идёт через nginx с лимитом
# ответа 60 секунд, а после перевода ещё коммит в GitHub, поэтому укладываемся в 40. Что не успели -
# уходит на сайт на русском с предупреждением; уже переведённое сохраняется, и повторная публикация
# переведёт остальные
TRANSLATE_BUDGET_SEC = 40.0
# маркеры списка в начале строки (длинное тире собрано из кода, чтобы его не было в исходнике)
_BULLETS = "-•" + chr(0x2014) + " "
_transport: Optional[httpx.AsyncBaseTransport] = None  # подменяется в тестах


class PublishError(Exception):
    pass


def missing_settings() -> list[str]:
    """Имена переменных backend/.env, без которых публикация на сайт не работает."""
    missing = []
    if not settings.site_github_token:
        missing.append("SITE_GITHUB_TOKEN")
    if not settings.site_github_repo:
        missing.append("SITE_GITHUB_REPO")
    return missing


def is_configured() -> bool:
    return not missing_settings()


def parse_translations(raw: Optional[str]) -> dict:
    try:
        data = json.loads(raw or "{}")
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def _esc(text: str) -> str:
    # сайт вставляет тексты через innerHTML - экранируем, чтобы "<" в тексте не ломал вёрстку
    return html.escape(text.strip(), quote=False)


def _lines(text: str) -> list[str]:
    return [_esc(line.lstrip(_BULLETS).strip()) for line in (text or "").splitlines() if line.strip()]


def _localized(case: CaseStudy, field: str) -> dict:
    """{ru, en, zh}; нет перевода - показываем русский, чтобы на сайте не было пустоты."""
    tr = parse_translations(case.translations)
    ru = case.site_mini if field == "mini" else getattr(case, field)
    out = {"ru": ru or ""}
    for lang in ("en", "zh"):
        out[lang] = (tr.get(lang) or {}).get(field) or out["ru"]
    return out


def image_path(case: CaseStudy) -> str:
    return f"{IMAGES_DIR}/case-{case.id}.webp"


def to_webp(path: str) -> bytes:
    with Image.open(path) as im:
        im = im.convert("RGB")
        im.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=82, method=6)
        return buf.getvalue()


def case_to_site(case: CaseStudy, has_image: bool) -> dict:
    title, mini, task = _localized(case, "title"), _localized(case, "mini"), _localized(case, "description")
    doing, result = _localized(case, "what_was_done"), _localized(case, "result")
    return {
        "crmId": case.id,
        "img": image_path(case) if has_image else "",
        "tag": case.site_tag if case.site_tag in SITE_TAGS else "Games",
        "title": {lang: _esc(title[lang]) for lang in LANGS},
        "mini": {lang: _esc(mini[lang]) for lang in LANGS},
        "task": {lang: _esc(task[lang]) for lang in LANGS},
        "doing": {lang: _lines(doing[lang]) for lang in LANGS},
        "result": {lang: _lines(result[lang]) for lang in LANGS},
    }


def cases_for_site(db: Session, owner_tg_id: int) -> list[CaseStudy]:
    """Кейсы с галочкой из пространств, которыми владеет публикующий - чужой проект
    не может попасть на личный сайт, даже если там кто-то отметил галочку."""
    return (
        db.query(CaseStudy)
        .join(IntegrationStreamer, CaseStudy.streamer_id == IntegrationStreamer.id)
        .join(Integration, IntegrationStreamer.integration_id == Integration.id)
        .join(Workspace, Integration.workspace_id == Workspace.id)
        .filter(CaseStudy.show_on_site.is_(True), Workspace.owner_tg_id == owner_tg_id)
        .order_by(CaseStudy.created_at.desc())
        .all()
    )


def build_files(cases: list[CaseStudy]) -> dict[str, bytes]:
    """Все файлы, которые должны лежать в репозитории сайта от CRM: путь -> содержимое."""
    files: dict[str, bytes] = {}
    items = []
    for c in cases:
        has_image = False
        if c.photo_path:
            try:
                files[image_path(c)] = to_webp(c.photo_path)
                has_image = True
            except (OSError, ValueError):
                pass  # битое/удалённое фото - кейс публикуем с заглушкой сайта
        items.append(case_to_site(c, has_image))
    files[CASES_PATH] = (json.dumps({"cases": items}, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    return files


def _git_blob_sha(content: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(content) + content).hexdigest()


async def _gh(client: httpx.AsyncClient, method: str, path: str, **kwargs) -> dict:
    r = await client.request(method, f"{GITHUB_API}/repos/{settings.site_github_repo}{path}", **kwargs)
    if r.status_code in (401, 403):
        raise PublishError("GitHub не пустил: проверь SITE_GITHUB_TOKEN (нужен доступ Contents: Read and write к репозиторию сайта)")
    if r.status_code == 404:
        raise PublishError(f"GitHub: не найден репозиторий {settings.site_github_repo} или ветка {settings.site_github_branch}")
    if r.status_code >= 400:
        raise PublishError(f"GitHub ответил ошибкой {r.status_code}: {r.text[:200]}")
    return r.json()


async def push_files(files: dict[str, bytes], message: str) -> Optional[str]:
    """Один коммит: кладём files и удаляем из assets/images/crm то, чего в files нет.
    Возвращает ссылку на коммит или None, если на сайте и так всё актуально."""
    headers = {
        "Authorization": f"Bearer {settings.site_github_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    branch = settings.site_github_branch
    async with httpx.AsyncClient(timeout=60.0, headers=headers, transport=_transport) as client:
        ref = await _gh(client, "GET", f"/git/ref/heads/{branch}")
        head_sha = ref["object"]["sha"]
        head = await _gh(client, "GET", f"/git/commits/{head_sha}")
        tree = await _gh(client, "GET", f"/git/trees/{head['tree']['sha']}", params={"recursive": "1"})
        existing = {e["path"]: e["sha"] for e in tree.get("tree", []) if e.get("type") == "blob"}

        entries = []
        for path, content in files.items():
            if existing.get(path) == _git_blob_sha(content):
                continue  # файл не изменился - не заливаем заново
            blob = await _gh(client, "POST", "/git/blobs", json={
                "content": base64.b64encode(content).decode(), "encoding": "base64",
            })
            entries.append({"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        for path in existing:
            if path.startswith(IMAGES_DIR + "/") and path not in files:
                entries.append({"path": path, "mode": "100644", "type": "blob", "sha": None})
        if not entries:
            return None

        new_tree = await _gh(client, "POST", "/git/trees", json={"base_tree": head["tree"]["sha"], "tree": entries})
        commit = await _gh(client, "POST", "/git/commits", json={
            "message": message, "tree": new_tree["sha"], "parents": [head_sha],
        })
        await _gh(client, "PATCH", f"/git/refs/heads/{branch}", json={"sha": commit["sha"]})
        return commit.get("html_url") or f"https://github.com/{settings.site_github_repo}/commit/{commit['sha']}"


def has_translation(case: CaseStudy) -> bool:
    """Есть ли у кейса хоть одно непустое поле перевода (en или zh). Если есть - считаем, что
    перевод делали или правили руками, и автоперевод его не трогает."""
    tr = parse_translations(case.translations)
    for lang in ("en", "zh"):
        part = tr.get(lang)
        if isinstance(part, dict) and any(str(v).strip() for v in part.values()):
            return True
    return False


def _translation_source(case: CaseStudy) -> dict:
    return {
        "title": case.title, "mini": case.site_mini, "description": case.description,
        "what_was_done": case.what_was_done, "result": case.result,
    }


async def translate_missing(db: Session, cases: list[CaseStudy]) -> tuple[int, list[str]]:
    """Переводит через Groq кейсы без перевода. Возвращает (сколько переведено, предупреждения).
    Никогда не бросает исключений наружу: публикация на русском важнее перевода."""
    todo = [c for c in cases if not has_translation(c) and any((v or "").strip() for v in _translation_source(c).values())]
    warnings: list[str] = []
    translated = 0
    started = time.monotonic()
    for i, c in enumerate(todo):
        rest = todo[i:]
        names = ", ".join(f"«{x.title or 'без названия'}»" for x in rest[:3]) + (" и др." if len(rest) > 3 else "")
        if time.monotonic() - started >= TRANSLATE_BUDGET_SEC:
            warnings.append(
                f"Время на перевод вышло, не переведено кейсов: {len(rest)} ({names}). Они ушли на сайт на русском. "
                "Опубликуйте ещё раз: готовые переводы сохранены, система доделает остальные."
            )
            break
        try:
            # синхронный httpx - в отдельном потоке, чтобы не вешать event loop
            tr = await asyncio.to_thread(case_translate.translate_case, _translation_source(c))
        except case_translate.TranslateError as e:
            warnings.append(f"Перевод не сделан для {names}, на сайте будет русский текст. Причина: {e}")
            break  # причина общая (ключ, лимит, нет связи): остальные кейсы не пробуем, чтобы не копить таймауты
        c.translations = json.dumps(tr, ensure_ascii=False)
        db.commit()
        translated += 1
    return translated, warnings


async def publish(db: Session, owner_tg_id: int) -> dict:
    missing = missing_settings()
    if missing:
        raise PublishError(f"Публикация не настроена: добавь {', '.join(missing)} в backend/.env")
    cases = cases_for_site(db, owner_tg_id)
    # переводим то, чего нет, и публикуем все три языка одним коммитом; готовые переводы не трогаем
    translated, warnings = await translate_missing(db, cases)
    files = build_files(cases)
    commit_url = await push_files(files, f"Кейсы из CRM: {len(cases)} шт.")
    now = datetime.now()
    for c in cases:
        # updated_at ставим явно, иначе onupdate сдвинет его позже site_published_at
        # и кейс сразу снова покажется «неопубликованным»
        c.site_published_at = now
        c.updated_at = now
    db.commit()
    return {
        "count": len(cases), "commit_url": commit_url, "changed": commit_url is not None, "site_url": settings.site_url,
        "translated": translated, "warnings": warnings,
    }
