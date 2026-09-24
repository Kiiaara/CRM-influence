"""Автоперевод кейса на английский и китайский для переключателя языков на сайте.

Один запрос к Claude: на входе русские тексты кейса, на выходе JSON по схеме (structured
outputs), так что разбирать свободный текст не нужно. Переводы потом можно поправить руками.
"""
import json

import anthropic

from config import settings

MODEL = "claude-opus-5"
FIELDS = ("title", "mini", "description", "what_was_done", "result")

_LANG_SCHEMA = {
    "type": "object",
    "properties": {f: {"type": "string"} for f in FIELDS},
    "required": list(FIELDS),
    "additionalProperties": False,
}
SCHEMA = {
    "type": "object",
    "properties": {"en": _LANG_SCHEMA, "zh": _LANG_SCHEMA},
    "required": ["en", "zh"],
    "additionalProperties": False,
}

SYSTEM = (
    "You translate influencer-marketing case studies for a portfolio website (tkacheva-media.ru) "
    "from Russian into English (en) and Simplified Chinese (zh). Keep the tone concise and professional, "
    "like a marketing portfolio. Keep brand, game, streamer and blogger names as they are (do not translate "
    "nicknames). Convert Russian number formats to natural ones for each language (e.g. \"23,5 млн+ просмотров\" "
    "-> \"23.5M+ views\" / \"2350万+ 观看次数\"). Fields what_was_done and result are lists: one item per line - "
    "keep exactly the same number of lines and their order. Empty source fields stay empty."
)


class TranslateError(Exception):
    pass


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.anthropic_api_key) if settings.anthropic_api_key else anthropic.Anthropic()


def translate_case(source: dict) -> dict:
    """source: {title, mini, description, what_was_done, result} на русском -> {"en": {...}, "zh": {...}}."""
    payload = {f: (source.get(f) or "") for f in FIELDS}
    try:
        response = _client().beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            system=SYSTEM,
            messages=[{
                "role": "user",
                "content": "Translate this case study (JSON, Russian):\n" + json.dumps(payload, ensure_ascii=False),
            }],
            output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
            # если классификатор модели откажет, запрос сам повторится на рекомендованной модели
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.AuthenticationError:
        raise TranslateError("Не настроен ключ Claude API (ANTHROPIC_API_KEY в backend/.env)")
    except anthropic.RateLimitError:
        raise TranslateError("Claude API перегружен, попробуй через минуту")
    except anthropic.APIStatusError as e:
        raise TranslateError(f"Claude API ответил ошибкой {e.status_code}")
    except anthropic.APIConnectionError:
        raise TranslateError("Нет связи с Claude API")
    except TypeError:
        # SDK не нашёл ни одного ключа в окружении
        raise TranslateError("Не настроен ключ Claude API (ANTHROPIC_API_KEY в backend/.env)")

    if response.stop_reason == "refusal":
        raise TranslateError("Модель отказалась переводить этот текст")
    if response.stop_reason == "max_tokens":
        raise TranslateError("Кейс слишком длинный для автоперевода")
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        data = json.loads(text)
    except ValueError:
        raise TranslateError("Не удалось разобрать перевод, попробуй ещё раз")
    return {lang: {f: str(data.get(lang, {}).get(f, "")) for f in FIELDS} for lang in ("en", "zh")}
