"""Общая подготовка тестов.

Важно: database.engine создаётся один раз при первом импорте модуля, поэтому
DATABASE_URL надо выставить до того, как любой тест импортирует приложение.
Раньше каждый файл делал это сам, и при запуске всей папки второй файл писал
в базу первого - отсюда падения на общем прогоне.
"""
import os
import sys
import uuid

_TEST_DB = os.path.join(os.path.dirname(__file__), f"test_{uuid.uuid4().hex}.db")
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB}"
os.environ["DEV_AUTH_BYPASS"] = "false"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


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
