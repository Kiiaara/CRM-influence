"""Автоперевод кейса на английский и китайский для переключателя языков на сайте.

Два провайдера, выбор - TRANSLATE_PROVIDER в .env (auto по умолчанию: DeepL, если задан
DEEPL_API_KEY, иначе Groq):
- DeepL: на каждый язык один запрос с массивом строк (все поля кейса сразу). Ключ Free (на ':fx')
  ходит на api-free.deepl.com, остальные на api.deepl.com.
- Groq (бесплатный тариф с лимитами, OpenAI-совместимый API): один запрос, на выходе JSON
  {"en": {...}, "zh": {...}}. Модель - GROQ_MODEL (список: console.groq.com/docs/models).
  С FirstVDS Groq отвечает 403 даже через Cloudflare Worker, поэтому на проде основной - DeepL.
На входе русские тексты кейса, на выходе {"en": {...}, "zh": {...}}. Переводы потом можно поправить руками в CRM.
"""
import json
from typing import Optional

import httpx

from config import settings

GROQ_PATH = "/openai/v1/chat/completions"
DEEPL_PATH = "/v2/translate"
FIELDS = ("title", "mini", "description", "what_was_done", "result")
# поля-списки: один пункт на строку, при переводе число строк должно сохраниться
LIST_FIELDS = ("what_was_done", "result")
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


def pick_provider() -> str:
    """Какой переводчик используем: 'deepl' или 'groq'. Бросает TranslateError, если нужный не настроен.
    auto (и любое неизвестное значение): DeepL при наличии ключа, иначе Groq, иначе ошибка."""
    mode = (settings.translate_provider or "auto").strip().lower()
    if mode == "deepl":
        if not settings.deepl_api_key.strip():
            raise TranslateError("Не настроен ключ DeepL (DEEPL_API_KEY в backend/.env, бесплатно на deepl.com/pro-api)")
        return "deepl"
    if mode == "groq":
        if not settings.groq_api_key:
            raise TranslateError(NO_GROQ_KEY)
        return "groq"
    if settings.deepl_api_key.strip():
        return "deepl"
    if settings.groq_api_key:
        return "groq"
    raise TranslateError(
        "Перевод не настроен: задай DEEPL_API_KEY (рекомендуется, deepl.com/pro-api) "
        "или GROQ_API_KEY (console.groq.com) в backend/.env"
    )


def is_configured() -> bool:
    """Настроен ли перевод (для статуса публикации в интерфейсе)."""
    try:
        pick_provider()
    except TranslateError:
        return False
    return True


def translate_case(source: dict) -> dict:
    """source: {title, mini, description, what_was_done, result} на русском -> {"en": {...}, "zh": {...}}.
    Провайдер выбирается настройкой TRANSLATE_PROVIDER (см. pick_provider)."""
    if pick_provider() == "deepl":
        return _translate_deepl(source)
    return _translate_groq(source)


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
