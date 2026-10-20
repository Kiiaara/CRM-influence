"""Общая подготовка тестов.

Важно: database.engine создаётся один раз при первом импорте модуля, поэтому
DATABASE_URL надо выставить до того, как любой тест импортирует приложение.
Раньше каждый файл делал это сам, и при запуске всей папки второй файл писал
в базу первого - отсюда падения на общем прогоне.
"""
import os
import sys
import uuid

import pytest

_TEST_DB = os.path.join(os.path.dirname(__file__), f"test_{uuid.uuid4().hex}.db")
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB}"
os.environ["DEV_AUTH_BYPASS"] = "false"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture(autouse=True)
def _isolate_translate_settings(monkeypatch):
    """Ключи и провайдер из локального .env не должны влиять на тесты перевода. По умолчанию в тестах
    провайдер groq: старые тесты проверяют именно Groq, а новые (Google, MyMemory, auto) выставляют свой."""
    from config import settings
    monkeypatch.setattr(settings, "deepl_api_key", "")
    monkeypatch.setattr(settings, "mymemory_email", "")
    monkeypatch.setattr(settings, "translate_provider", "groq")


def pytest_sessionfinish(session, exitstatus):
    """Чистим временную базу, включая WAL-хвосты."""
    from database import engine
    engine.dispose()
    for suffix in ("", "-wal", "-shm"):
        path = _TEST_DB + suffix
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass
