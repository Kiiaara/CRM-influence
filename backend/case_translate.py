"""Автоперевод кейса на английский и китайский для переключателя языков на сайте.

Переводим через Groq (бесплатный тариф с лимитами, OpenAI-совместимый API): один запрос,
на входе русские тексты кейса, на выходе JSON {"en": {...}, "zh": {...}}. Переводы потом
можно поправить руками в CRM. Модель - GROQ_MODEL в .env (список: console.groq.com/docs/models).
"""
import json
from typing import Optional

import httpx

from config import settings

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
FIELDS = ("title", "mini", "description", "what_was_done", "result")
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


def translate_case(source: dict) -> dict:
    """source: {title, mini, description, what_was_done, result} на русском -> {"en": {...}, "zh": {...}}."""
    if not settings.groq_api_key:
        raise TranslateError("Не настроен ключ Groq (GROQ_API_KEY в backend/.env, бесплатно на console.groq.com)")
    payload = {f: (source.get(f) or "") for f in FIELDS}
    try:
        with httpx.Client(timeout=60.0, transport=_transport) as client:
            r = client.post(
                GROQ_URL,
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
