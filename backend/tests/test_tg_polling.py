"""Long polling Telegram живёт отдельной фоновой задачей, а не джобом APScheduler.

Раньше джоб tg_poll с интервалом 2 с держал getUpdates (timeout 25 с), и планировщик
каждые 2 секунды писал в лог «maximum number of running instances reached».
Сеть не трогаем: httpx.AsyncClient и sleep подменяются. Диапазон id 115xxx, токены tg-.
"""
import asyncio

import pytest

import scheduler
from config import settings


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    """Каждый тест стартует без чужой задачи и с токеном по умолчанию."""
    monkeypatch.setattr(settings, "auth_bot_token", "tg-115001:test")
    monkeypatch.setattr(scheduler, "_poll_task", None, raising=False)
    monkeypatch.setattr(scheduler, "_tg_offset", 0)
    yield


class _FakeResp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {"result": []}

    def json(self):
        return self._payload


def _fake_client(resp):
    """Фабрика подмены httpx.AsyncClient: get() возвращает заранее заданный ответ."""
    class _Client:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, *a, **kw):
            return resp
    return _Client


def test_no_token_task_not_started(monkeypatch):
    monkeypatch.setattr(settings, "auth_bot_token", "")

    async def run():
        return scheduler.start_polling()

    assert asyncio.run(run()) is None
    assert scheduler._poll_task is None


def test_second_start_does_not_spawn_duplicate(monkeypatch):
    async def forever():
        await asyncio.Event().wait()

    monkeypatch.setattr(scheduler, "_poll_once", forever)

    async def run():
        t1 = scheduler.start_polling()
        await asyncio.sleep(0)
        t2 = scheduler.start_polling()
        same = t1 is t2
        await scheduler.stop_polling()
        return same

    assert asyncio.run(run()) is True


def test_stop_cancels_task(monkeypatch):
    async def forever():
        await asyncio.Event().wait()

    monkeypatch.setattr(scheduler, "_poll_once", forever)

    async def run():
        t = scheduler.start_polling()
        await asyncio.sleep(0)
        await scheduler.stop_polling()
        return t.done()

    assert asyncio.run(run()) is True
    assert scheduler._poll_task is None


def test_loop_survives_exceptions_with_backoff(monkeypatch):
    calls = {"n": 0}
    delays = []

    async def flaky():
        calls["n"] += 1
        if calls["n"] <= 3:
            raise ConnectionError("сеть упала")
        # после трёх сбоев цикл жив: дальше просто ждём, как настоящий getUpdates
        await asyncio.Event().wait()

    async def fake_sleep(sec):
        delays.append(sec)
        await asyncio.sleep(0)

    monkeypatch.setattr(scheduler, "_poll_once", flaky)
    monkeypatch.setattr(scheduler, "_sleep", fake_sleep)

    async def run():
        scheduler.start_polling()
        for _ in range(50):
            await asyncio.sleep(0)
        alive = not scheduler._poll_task.done()
        await scheduler.stop_polling()
        return alive

    assert asyncio.run(run()) is True
    assert calls["n"] == 4
    # backoff растёт и не нулевой
    assert len(delays) == 3 and delays == sorted(delays) and delays[0] > 0 and delays[-1] > delays[0]


def test_backoff_is_capped():
    assert scheduler._backoff_delay(1) < scheduler._backoff_delay(3)
    assert scheduler._backoff_delay(1000) <= 60


def test_non_200_raises_for_backoff(monkeypatch):
    monkeypatch.setattr(scheduler.httpx, "AsyncClient", _fake_client(_FakeResp(502)))
    with pytest.raises(RuntimeError):
        asyncio.run(scheduler._poll_once())


def test_poll_once_processes_updates_and_survives_bad_one(monkeypatch):
    """Падение обработчика одного апдейта не должно терять остальные из пачки."""
    handled = []
    payload = {"result": [
        {"update_id": 115010, "message": {"from": {"id": 115111}, "text": "boom"}},
        {"update_id": 115011, "message": {"from": {"id": 115112}, "text": "hello"}},
    ]}
    monkeypatch.setattr(scheduler.httpx, "AsyncClient", _fake_client(_FakeResp(200, payload)))

    async def handle_command(tg_id, text):
        if text == "boom":
            raise RuntimeError("ошибка обработчика")
        return False

    async def handle_message(tg_id, text):
        handled.append((tg_id, text))

    monkeypatch.setattr(scheduler.bot_dialog, "handle_command", handle_command)
    monkeypatch.setattr(scheduler.bot_dialog, "handle_message", handle_message)
    asyncio.run(scheduler._poll_once())
    assert handled == [(115112, "hello")]
    assert scheduler._tg_offset == 115012


def test_poll_job_not_registered_in_apscheduler():
    async def run():
        scheduler.start_scheduler(with_bot=True)
        ids = {j.id for j in scheduler._scheduler.get_jobs()}
        scheduler.stop_scheduler()
        return ids

    ids = asyncio.run(run())
    assert "tg_poll" not in ids
    assert "assigned" in ids  # остальные джобы уведомлений на месте
