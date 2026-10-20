"""Автоперевод кейса на английский и китайский для переключателя языков на сайте.

Четыре провайдера, выбор - TRANSLATE_PROVIDER в .env. По умолчанию auto: DeepL (если задан
DEEPL_API_KEY) -> Google -> MyMemory -> Groq (если задан GROQ_API_KEY). Если провайдер упал, auto
пробует следующий и сообщает пользователю, кто в итоге перевёл. Без ключей работает Google.
- Google (публичный эндпоинт translate.googleapis.com, без ключа и регистрации; неофициальный,
  может отвалиться без предупреждения - поэтому есть запасной MyMemory): строка за строкой.
- MyMemory (без ключа, 5000 симв/день на IP, с MYMEMORY_EMAIL до 50000): строка за строкой.
- DeepL: на каждый язык один запрос с массивом строк (все поля кейса сразу). Ключ Free (на ':fx')
  ходит на api-free.deepl.com, остальные на api.deepl.com.
- Groq (бесплатный тариф с лимитами, OpenAI-совместимый API): один запрос, на выходе JSON
  {"en": {...}, "zh": {...}}. Модель - GROQ_MODEL (список: console.groq.com/docs/models).
  С FirstVDS Groq отвечает 403 даже через Cloudflare Worker, поэтому на проде основной - DeepL.
На входе русские тексты кейса, на выходе {"en": {...}, "zh": {...}}. Переводы потом можно поправить руками в CRM.
"""
import json
import re
import time
from typing import Callable, Optional

import httpx

from config import settings

GOOGLE_URL = "https://translate.googleapis.com/translate_a/single"
MYMEMORY_URL = "https://api.mymemory.translated.net/get"
# таймаут одного запроса к Google/MyMemory: отвечают за доли секунды, ждать дольше нет смысла
FREE_TIMEOUT_SEC = 8.0
# общий бюджет перевода одного кейса по всей цепочке провайдеров (меньше TRANSLATE_BUDGET_SEC публикации,
# nginx режет ответ на 60 секундах)
CASE_DEADLINE_SEC = 30.0
# максимальная длина куска текста в одном запросе: Google берёт через GET с запасом, MyMemory - до 500 символов
GOOGLE_CHUNK = 1500
MYMEMORY_CHUNK = 450
# язык -> код целевого языка у Google / в langpair MyMemory
GOOGLE_LANGS = {"en": "en", "zh": "zh-CN"}
MYMEMORY_LANGS = {"en": "en", "zh": "zh"}
LABELS = {"deepl": "DeepL", "google": "Google", "mymemory": "MyMemory", "groq": "Groq"}
# что нельзя отдавать переводчику: почта, ссылки, ники, erid (метка рекламы). Заменяются на заглушки и возвращаются
PROTECT_RE = re.compile(
    r"[\w.+-]+@[\w-]+\.[\w.-]+"            # почта
    r"|https?://[^\s]*[^\s.,;:!?)»\"']"    # ссылка без хвостовой пунктуации
    r"|www\.[^\s]*[^\s.,;:!?)»\"']"
    r"|\berid[:=\s]*[A-Za-z0-9]+"            # маркировка рекламы
    r"|@\w+",                              # ник
    re.IGNORECASE,
)

# Числа с сокращениями ("34к+", "1,9 млн") переводчик сворачивает как придётся:
# на сайте вышло "3.4万+" в одном кейсе и "22k+" в соседнем. Приводим их сами,
# до отправки: для en латинские k/M, для zh принятое в китайском 万 (десять тысяч).
_NUM_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(млн\.?|тыс\.?|[кk])(?![\w.])", re.IGNORECASE)
_MULT = {"млн": 1_000_000, "тыс": 1_000, "тыс.": 1_000, "к": 1_000, "k": 1_000}


def _fmt_num(value: float) -> str:
    """4.0 -> "4", 3.4 -> "3.4": хвост .0 в тексте не нужен."""
    return f"{value:.1f}".rstrip("0").rstrip(".") if value % 1 else str(int(value))


def localize_numbers(text: str, lang: str) -> str:
    """Приводит русские сокращения чисел к принятым в языке.
    "34к+" -> "34k+" (en) и "3.4万+" (zh); "1,9 млн" -> "1.9M" и "190万"."""
    if not text or lang not in ("en", "zh"):
        return text

    def one(m: re.Match) -> str:
        amount = float(m.group(1).replace(",", "."))
        unit = m.group(2).lower().rstrip(".")
        total = amount * _MULT.get(unit, _MULT.get(unit + ".", 1))
        if lang == "zh":
            # 万 = 10 000, принятая в китайском единица счёта
            return f"{_fmt_num(total / 10_000)}万" if total >= 10_000 else _fmt_num(total)
        if total >= 1_000_000:
            return f"{_fmt_num(total / 1_000_000)}M"
        if total >= 1_000:
            return f"{_fmt_num(total / 1_000)}k"
        return _fmt_num(total)

    return _NUM_RE.sub(one, text)


GROQ_PATH = "/openai/v1/chat/completions"
DEEPL_PATH = "/v2/translate"
FIELDS = ("title", "mini", "description", "what_was_done", "result")
# поля-списки: один пункт на строку, при переводе число строк должно сохраниться
LIST_FIELDS = ("what_was_done", "result")
# название кейса - это имя бренда или проекта, его не переводят:
# "BuffBuff" превращался в китайское 增益增益 ("усиление-усиление")
KEEP_AS_IS_FIELDS = ("title",)
NO_GROQ_KEY = "Не настроен ключ Groq (GROQ_API_KEY в backend/.env, бесплатно на console.groq.com)"
# таймаут одного запроса к Groq: обычно ответ за 1-3 секунды, 25 хватает с запасом, а публикация
# на сайт идёт за nginx с лимитом ответа 60 секунд и ждать дольше нельзя
TIMEOUT_SEC = 25.0
# DeepL отвечает за доли секунды, но на кейс уходит два запроса (en и zh): 2 x 12 остаётся в лимите nginx
DEEPL_TIMEOUT_SEC = 12.0
_transport: Optional[httpx.BaseTransport] = None  # подменяется в тестах

SYSTEM = (
    "You translate influencer-marketing case studies for a portfolio website from Russian into "
    "English (en) and Simplified Chinese (zh). Keep the tone concise and professional. Keep brand, game, "
    "streamer and blogger names as they are (do not translate nicknames). Convert number formats naturally, "
    "e.g. \"23,5 млн+ просмотров\" -> \"23.5M+ views\" / \"2350万+ 观看次数\". Fields what_was_done and result "
    "are lists: one item per line - keep exactly the same number of lines and their order. Empty source "
    "fields stay empty.\n"
    "Reply with JSON only, exactly this shape: "
    '{"en": {"title": "", "mini": "", "description": "", "what_was_done": "", "result": ""}, '
    '"zh": {"title": "", "mini": "", "description": "", "what_was_done": "", "result": ""}}'
)


class TranslateError(Exception):
    pass


def groq_url() -> str:
    """Адрес запроса: GROQ_API_BASE (по умолчанию api.groq.com, можно прокси) + путь API.
    Слеши на конце базы срезаем, чтобы не получить '//' в пути."""
    base = (settings.groq_api_base or "").strip().rstrip("/") or "https://api.groq.com"
    return base + GROQ_PATH


def deepl_url(key: str) -> str:
    """Адрес DeepL по ключу: Free-ключи заканчиваются на ':fx' и ходят на api-free, остальные на api."""
    host = "api-free.deepl.com" if (key or "").strip().endswith(":fx") else "api.deepl.com"
    return f"https://{host}{DEEPL_PATH}"


def provider_chain() -> list[str]:
    """Список провайдеров по порядку попыток. Бросает TranslateError, если явно выбранный не настроен.
    google / mymemory / deepl / groq: один выбранный, без запасных.
    auto (и любое неизвестное значение): DeepL (если ключ) -> Google -> MyMemory -> Groq (если ключ)."""
    mode = (settings.translate_provider or "auto").strip().lower()
    if mode == "deepl":
        if not settings.deepl_api_key.strip():
            raise TranslateError("Не настроен ключ DeepL (DEEPL_API_KEY в backend/.env, бесплатно на deepl.com/pro-api)")
        return ["deepl"]
    if mode == "groq":
        if not settings.groq_api_key:
            raise TranslateError(NO_GROQ_KEY)
        return ["groq"]
    if mode in ("google", "mymemory"):
        return [mode]
    chain = []
    if settings.deepl_api_key.strip():
        chain.append("deepl")
    chain += ["google", "mymemory"]
    if settings.groq_api_key:
        chain.append("groq")
    return chain


def pick_provider() -> str:
    """Первый провайдер цепочки (основной)."""
    return provider_chain()[0]


def is_configured() -> bool:
    """Настроен ли перевод (для статуса публикации в интерфейсе). Google/MyMemory ключей не требуют."""
    try:
        provider_chain()
    except TranslateError:
        return False
    return True


class TranslationResult(dict):
    """{"en": {...}, "zh": {...}} плюс notes - предупреждения для пользователя (кто из провайдеров упал)."""

    def __init__(self, data: dict, notes: Optional[list[str]] = None):
        super().__init__(data)
        self.notes = notes or []


def translate_case(source: dict) -> dict:
    """source: {title, mini, description, what_was_done, result} на русском -> {"en": {...}, "zh": {...}}.
    Провайдеры берутся из provider_chain(): упал один - пробуем следующий. Если сработал не первый,
    в результате .notes объясняет, кто упал и кто перевёл. Упали все - TranslateError со всеми причинами."""
    chain = provider_chain()
    deadline = time.monotonic() + CASE_DEADLINE_SEC
    runners: dict[str, Callable[[dict], dict]] = {
        "deepl": _translate_deepl,
        "groq": _translate_groq,
        "google": lambda s: _translate_lines(s, "Google", _google_one, GOOGLE_CHUNK, deadline),
        "mymemory": lambda s: _translate_lines(s, "MyMemory", _mymemory_one, MYMEMORY_CHUNK, deadline),
    }
    # название бренда переводчику не отдаём: "BuffBuff" на китайском становился 增益增益.
    # Если человек впишет перевод названия руками, он сохранится: сюда такие поля не доходят
    to_translate = {f: v for f, v in source.items() if f not in KEEP_AS_IS_FIELDS}
    failed: list[tuple[str, str]] = []
    for name in chain:
        try:
            result = runners[name](to_translate)
        except TranslateError as e:
            failed.append((name, str(e)))
            continue
        # возвращаем название как есть на всех языках
        for lang in result:
            for f in KEEP_AS_IS_FIELDS:
                result[lang][f] = _as_text(source.get(f))
        notes = []
        if failed:
            dead = "; ".join(f"{LABELS[n]}: {msg}" for n, msg in failed)
            notes.append(f"Основной переводчик не сработал ({dead}). Перевод сделал {LABELS[name]}, качество может быть ниже.")
        return TranslationResult(result, notes)
    if len(failed) == 1:
        raise TranslateError(failed[0][1])
    raise TranslateError("Не сработал ни один переводчик. " + "; ".join(f"{LABELS[n]}: {msg}" for n, msg in failed))


def _translate_lines(source: dict, name: str, one: Callable, chunk_limit: int, deadline: float) -> dict:
    """Построчный перевод для Google и MyMemory (у них нет пакетного режима).
    Списковые поля режутся по строкам и собираются обратно: число пунктов сохраняется.
    Пустые строки и строки без букв (ссылка, ник, число) не отправляются и остаются как есть.
    Ссылки, почта, ники и erid внутри текста прячутся за заглушки и возвращаются после перевода;
    если переводчик заглушку потерял, строка остаётся русской (лучше русский оригинал, чем битая ссылка)."""
    lines = {}
    for f in FIELDS:
        value = _as_text(source.get(f))
        lines[f] = value.split("\n") if f in LIST_FIELDS else [value]
    result = {"en": {f: "" for f in FIELDS}, "zh": {f: "" for f in FIELDS}}
    if not any(l.strip() for ls in lines.values() for l in ls):
        return result  # переводить нечего, лишних запросов нет

    cache: dict[tuple[str, str], str] = {}  # одинаковые строки (повторяющиеся пункты) переводим один раз
    try:
        with httpx.Client(timeout=FREE_TIMEOUT_SEC, transport=_transport) as client:
            for lang in ("en", "zh"):
                for f in FIELDS:
                    out = []
                    for line in lines[f]:
                        key = (lang, line)
                        if key not in cache:
                            cache[key] = _translate_line(client, name, one, chunk_limit, deadline, lang, line)
                        out.append(cache[key])
                    result[lang][f] = "\n".join(out)
    except httpx.HTTPError:
        raise TranslateError(f"Нет связи с {name}, попробуй ещё раз")
    return result


def _translate_line(client, name: str, one: Callable, chunk_limit: int, deadline: float, lang: str, line: str) -> str:
    """Перевод одной строки с защитой ссылок и ников (см. _translate_lines)."""
    if not line.strip():
        return ""
    # числа приводим до перевода: иначе "34к+" и "22к+" свернутся по-разному
    line = localize_numbers(line, lang)
    protected: list[str] = []

    def hide(m: re.Match) -> str:
        protected.append(m.group(0))
        return f"QZ{len(protected)}QZ"

    masked = PROTECT_RE.sub(hide, line.strip())
    # после вычета заглушек не осталось букв: строка - ссылка, ник или число, переводить нечего
    if not re.search(r"[^\W\d_]", re.sub(r"QZ\d+QZ", "", masked)):
        return line.strip()
    parts = []
    for piece in _chunks(masked, chunk_limit):
        if time.monotonic() > deadline:
            raise TranslateError(f"Время на перевод через {name} вышло")
        parts.append(one(client, piece, lang).strip())
    text = " ".join(p for p in parts if p)
    for i, original in enumerate(protected, 1):
        token = f"QZ{i}QZ"
        if token not in text:
            return line.strip()
        text = text.replace(token, original)
    return text


def _chunks(text: str, limit: int) -> list[str]:
    """Режет длинную строку по словам на куски не длиннее limit (MyMemory принимает до ~500 символов)."""
    if len(text) <= limit:
        return [text]
    out, cur = [], ""
    for word in text.split(" "):
        if cur and len(cur) + 1 + len(word) > limit:
            out.append(cur)
            cur = word
        else:
            cur = f"{cur} {word}" if cur else word
    if cur:
        out.append(cur)
    return out


def _google_one(client: httpx.Client, text: str, lang: str) -> str:
    """Один запрос к публичному Google Translate. Параметры кодирует httpx (без кодирования кириллицы Google отвечает 400)."""
    r = client.get(GOOGLE_URL, params={"client": "gtx", "sl": "ru", "tl": GOOGLE_LANGS[lang], "dt": "t", "q": text})
    return _google_text(r)


def _google_text(r: httpx.Response) -> str:
    """Разбор ответа Google: [[[перевод, оригинал, ...], ...], ...]. Длинный текст приходит кусками - склеиваем item[0]."""
    if r.status_code == 429:
        raise TranslateError("Google временно ограничил запросы, попробуй позже")
    if r.status_code >= 400:
        raise TranslateError(f"Google ответил ошибкой {r.status_code}")
    try:
        items = r.json()[0]
        text = "".join(item[0] for item in items if item and isinstance(item[0], str))
    except (ValueError, KeyError, IndexError, TypeError):
        text = ""
    if not text.strip():
        raise TranslateError("Не удалось разобрать ответ Google (неофициальный эндпоинт мог измениться)")
    return text


def _mymemory_one(client: httpx.Client, text: str, lang: str) -> str:
    """Один запрос к MyMemory. С MYMEMORY_EMAIL (параметр de) дневной лимит выше."""
    params = {"q": text, "langpair": f"ru|{MYMEMORY_LANGS[lang]}"}
    email = (settings.mymemory_email or "").strip()
    if email:
        params["de"] = email
    r = client.get(MYMEMORY_URL, params=params)
    return _mymemory_text(r)


def _mymemory_text(r: httpx.Response) -> str:
    """Разбор ответа MyMemory с понятной ошибкой при исчерпанном дневном лимите."""
    quota_msg = "Дневной лимит MyMemory исчерпан (5000 символов на IP). Задай MYMEMORY_EMAIL в backend/.env (лимит 50000) или попробуй завтра"
    if r.status_code == 429:
        raise TranslateError(quota_msg)
    if r.status_code >= 400:
        raise TranslateError(f"MyMemory ответил ошибкой {r.status_code}")
    try:
        data = r.json()
        text = str(data["responseData"]["translatedText"])
    except (ValueError, KeyError, TypeError):
        raise TranslateError("Не удалось разобрать ответ MyMemory, попробуй ещё раз")
    details = str(data.get("responseDetails") or "").lower()
    if (data.get("quotaFinished") or "mymemory warning" in text.lower()
            or "limit" in details or "quota" in details or str(data.get("responseStatus")) == "429"):
        raise TranslateError(quota_msg)
    if str(data.get("responseStatus", "200")) != "200" or not text.strip():
        raise TranslateError("MyMemory не вернул перевод, попробуй ещё раз")
    return text


def _translate_deepl(source: dict) -> dict:
    """Перевод через DeepL: на каждый язык один запрос с массивом строк (все поля кейса сразу)."""
    key = settings.deepl_api_key.strip()
    # сегменты: (поле, номер строки). Списковые поля режем по строкам, чтобы число пунктов точно сохранилось,
    # пустые строки и пустые поля в DeepL не отправляем
    segments: list[tuple[str, int]] = []
    texts: list[str] = []
    lines: dict[str, list[str]] = {}
    for f in FIELDS:
        value = _as_text(source.get(f))
        lines[f] = value.split("\n") if f in LIST_FIELDS else [value]
        for i, line in enumerate(lines[f]):
            if line.strip():
                segments.append((f, i))
                texts.append(line)

    result = {"en": {f: "" for f in FIELDS}, "zh": {f: "" for f in FIELDS}}
    if not texts:
        return result  # переводить нечего, лишний запрос не тратим

    try:
        with httpx.Client(timeout=DEEPL_TIMEOUT_SEC, transport=_transport) as client:
            for lang, target in (("en", "EN-US"), ("zh", "ZH")):
                r = client.post(
                    deepl_url(key),
                    headers={"Authorization": f"DeepL-Auth-Key {key}"},
                    json={"text": texts, "source_lang": "RU", "target_lang": target},
                )
                translated = _deepl_texts(r, len(texts))
                # строки, которые не отправляли (пустые), остаются пустыми
                out = {f: [""] * len(lines[f]) for f in FIELDS}
                for (f, i), text in zip(segments, translated):
                    out[f][i] = text
                result[lang] = {f: "\n".join(out[f]) for f in FIELDS}
    except httpx.HTTPError:
        raise TranslateError("Нет связи с DeepL, попробуй ещё раз")
    return result


def _deepl_texts(r: httpx.Response, expected: int) -> list[str]:
    """Разбор ответа DeepL: список переведённых строк в том же порядке, ошибки с названием провайдера."""
    if r.status_code in (401, 403):
        raise TranslateError("DeepL не принял ключ - проверь DEEPL_API_KEY (и что ключ Free заканчивается на :fx)")
    if r.status_code == 456:
        raise TranslateError("Лимит символов DeepL на этот месяц исчерпан")
    if r.status_code == 429:
        raise TranslateError("DeepL: слишком много запросов, попробуй через минуту")
    if r.status_code >= 400:
        raise TranslateError(f"DeepL ответил ошибкой {r.status_code}")
    try:
        items = [str(t["text"]) for t in r.json()["translations"]]
    except (ValueError, KeyError, TypeError):
        raise TranslateError("Не удалось разобрать ответ DeepL, попробуй ещё раз")
    if len(items) != expected:
        raise TranslateError("DeepL вернул не все строки перевода, попробуй ещё раз")
    return items


def _translate_groq(source: dict) -> dict:
    """Перевод через Groq: один запрос, модель отдаёт JSON сразу с двумя языками."""
    if not settings.groq_api_key:
        raise TranslateError(NO_GROQ_KEY)
    payload = {f: (source.get(f) or "") for f in FIELDS}
    try:
        with httpx.Client(timeout=TIMEOUT_SEC, transport=_transport) as client:
            r = client.post(
                groq_url(),
                headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                json={
                    "model": settings.groq_model,
                    "temperature": 0.2,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": SYSTEM},
                        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
                    ],
                },
            )
    except httpx.HTTPError:
        raise TranslateError("Нет связи с Groq, попробуй ещё раз")

    if r.status_code == 401:
        raise TranslateError("Groq не принял ключ - проверь GROQ_API_KEY")
    if r.status_code == 403:
        raise TranslateError(
            "Groq ответил 403: скорее всего он блокирует IP сервера по региону. "
            "Помогает прокси: задай GROQ_API_BASE в backend/.env (адрес Cloudflare Worker, см. CLOUDFLARE_WORKER_SETUP.md)"
        )
    if r.status_code == 429:
        raise TranslateError("Лимит бесплатного Groq исчерпан, попробуй через минуту")
    if r.status_code == 404 or (r.status_code == 400 and "model" in r.text):
        raise TranslateError(f"Groq не знает модель {settings.groq_model} - поменяй GROQ_MODEL")
    if r.status_code >= 400:
        raise TranslateError(f"Groq ответил ошибкой {r.status_code}")

    try:
        text = r.json()["choices"][0]["message"]["content"]
        data = json.loads(text)
    except (ValueError, KeyError, IndexError, TypeError):
        raise TranslateError("Не удалось разобрать перевод, попробуй ещё раз")
    if not isinstance(data, dict):
        raise TranslateError("Не удалось разобрать перевод, попробуй ещё раз")

    result = {}
    for lang in ("en", "zh"):
        part = data.get(lang) if isinstance(data.get(lang), dict) else {}
        result[lang] = {f: _as_text(part.get(f)) for f in FIELDS}
    return result


def _as_text(v) -> str:
    # модель иногда отдаёт пункты списком вместо строк через перенос
    if isinstance(v, list):
        return "\n".join(str(x) for x in v)
    return "" if v is None else str(v)
