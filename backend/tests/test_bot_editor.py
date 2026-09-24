"""Бот: правка всего, что есть в CRM - сделки/КП, оплаты, задачи, рекламодатели, базы,
мастер с выбором стример/блогер, выбор пространства и изоляция чужих пространств."""
import asyncio
from datetime import datetime

import pytest

import bot_dialog
import bot_editor
from database import Base, engine, SessionLocal
from models.advertiser import Advertiser
from models.blogger_profile import BloggerProfile
from models.integration import Integration
from models.integration_payment import IntegrationPayment
from models.integration_streamer import IntegrationStreamer
from models.task import Task
from models.user import User
from models.workspace import Workspace, WorkspaceMember

LERA_TG = 106001
HELPER_TG = 106002
VIEWER_TG = 106003
OUTSIDER_TG = 106004


@pytest.fixture(scope="module")
def ids():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.add_all([
        User(tg_id=LERA_TG, role="admin", label="Лера"),
        User(tg_id=HELPER_TG, role="editor", label="Помощница"),
        User(tg_id=VIEWER_TG, role="viewer", label="Зритель"),
        User(tg_id=OUTSIDER_TG, role="editor", label="Чужой"),
    ])
    db.commit()
    main_ws = Workspace(title="Бот-основное", owner_tg_id=LERA_TG)
    second_ws = Workspace(title="Бот-второе", owner_tg_id=LERA_TG)
    other_ws = Workspace(title="Бот-чужое", owner_tg_id=OUTSIDER_TG)
    db.add_all([main_ws, second_ws, other_ws])
    db.commit()
    now = datetime.now()
    db.add_all([
        WorkspaceMember(workspace_id=main_ws.id, user_tg_id=LERA_TG, role="owner", joined_at=now),
        WorkspaceMember(workspace_id=second_ws.id, user_tg_id=LERA_TG, role="owner", joined_at=now),
        WorkspaceMember(workspace_id=main_ws.id, user_tg_id=HELPER_TG, role="lead", joined_at=now),
        WorkspaceMember(workspace_id=main_ws.id, user_tg_id=VIEWER_TG, role="viewer", joined_at=now),
        WorkspaceMember(workspace_id=other_ws.id, user_tg_id=OUTSIDER_TG, role="owner", joined_at=now),
    ])
    adv = Advertiser(workspace_id=main_ws.id, name="БотБренд")
    other_adv = Advertiser(workspace_id=other_ws.id, name="ЧужойБренд")
    db.add_all([adv, other_adv])
    db.commit()
    deal = Integration(workspace_id=main_ws.id, advertiser_id=adv.id, brand=adv.name)
    other_deal = Integration(workspace_id=other_ws.id, advertiser_id=other_adv.id, brand=other_adv.name)
    db.add_all([deal, other_deal])
    db.commit()
    card = IntegrationStreamer(integration_id=deal.id, streamer_name="Стример1", amount=100000)
    other_card = IntegrationStreamer(integration_id=other_deal.id, streamer_name="ЧужойСтример")
    blogger = BloggerProfile(name="Блогер1", platform="YouTube")
    db.add_all([card, other_card, blogger])
    db.commit()
    data = {
        "main_ws": main_ws.id, "second_ws": second_ws.id, "adv": adv.id, "deal": deal.id,
        "other_deal": other_deal.id, "card": card.id, "other_card": other_card.id, "blogger": blogger.id,
    }
    db.close()
    return data


@pytest.fixture
def sent(monkeypatch):
    """Перехватываем все исходящие сообщения бота."""
    messages: list[tuple[int, str, list | None]] = []

    async def fake_send(chat_id, text, with_keyboard=False, inline_keyboard=None):
        messages.append((chat_id, text, inline_keyboard))
        return True

    monkeypatch.setattr(bot_editor, "send_message", fake_send)
    monkeypatch.setattr(bot_dialog, "send_message", fake_send)
    bot_dialog._sessions.clear()
    return messages


def run(coro):
    return asyncio.run(coro)


def cb(tg_id, data):
    return run(bot_dialog.handle_callback(tg_id, data))


def say(tg_id, text):
    if run(bot_dialog.handle_command(tg_id, text)):
        return True
    return run(bot_dialog.handle_message(tg_id, text))


def buttons(messages) -> list[str]:
    kb = messages[-1][2] or []
    return [b["callback_data"] for row in kb for b in row]


def test_menu_lists_all_sections(ids, sent):
    assert say(LERA_TG, "/menu")
    cbs = buttons(sent)
    for data in ("x:l:deal:0:0", "x:l:adv:0:0", "x:l:task:0:0", "x:l:case:0:0", "x:l:sp:0:0", "x:l:bp:0:0", "x:a:wslist:0"):
        assert data in cbs


def test_edit_deal_kp_link(ids, sent):
    cb(LERA_TG, f"x:o:deal:{ids['deal']}")
    assert "БотБренд" in sent[-1][1]
    fi = bot_editor.ENTITIES["deal"].fields.index(next(f for f in bot_editor.ENTITIES["deal"].fields if f.key == "kp_sheet_url"))
    cb(LERA_TG, f"x:f:deal:{ids['deal']}:{fi}")
    say(LERA_TG, "https://docs.google.com/spreadsheets/d/kp-bot/edit")
    db = SessionLocal()
    assert db.get(Integration, ids["deal"]).kp_sheet_url == "https://docs.google.com/spreadsheets/d/kp-bot/edit"
    db.close()
    assert "Таблица КП" in sent[-1][1]


def test_foreign_workspace_is_invisible(ids, sent):
    cb(LERA_TG, f"x:o:deal:{ids['other_deal']}")
    assert "Не найдено" in sent[-1][1]
    cb(LERA_TG, f"e:cat:{ids['other_card']}")
    assert "не найдена" in sent[-1][1]
    cb(LERA_TG, f"e:val:{ids['other_card']}:stage:done")
    db = SessionLocal()
    assert db.get(IntegrationStreamer, ids["other_card"]).stage == "negotiation"
    db.close()


def test_card_menu_has_sections_and_talent_type(ids, sent):
    cb(LERA_TG, f"e:cat:{ids['card']}")
    cbs = buttons(sent)
    assert f"x:l:pay:{ids['card']}:0" in cbs
    assert f"x:l:case:{ids['card']}:0" in cbs
    assert f"x:l:brief:{ids['card']}:0" in cbs
    assert f"x:dq:card:{ids['card']}" in cbs
    cb(LERA_TG, f"e:val:{ids['card']}:talent_type:blogger")
    db = SessionLocal()
    assert db.get(IntegrationStreamer, ids["card"]).talent_type == "blogger"
    db.close()


def test_add_payment_updates_status(ids, sent):
    cb(LERA_TG, f"x:n:pay:{ids['card']}")
    say(LERA_TG, "40 000")
    db = SessionLocal()
    s = db.get(IntegrationStreamer, ids["card"])
    assert [float(p.amount) for p in db.query(IntegrationPayment).filter_by(streamer_id=s.id)] == [40000.0]
    assert s.payment_status == "partial"
    db.close()


def test_task_create_and_assign(ids, sent):
    cb(LERA_TG, "x:n:task:0")
    say(LERA_TG, "Позвонить бренду")
    db = SessionLocal()
    t = db.query(Task).filter_by(title="Позвонить бренду").one()
    task_id = t.id
    db.close()

    fields = [f.key for f in bot_editor.ENTITIES["task"].fields]
    cb(LERA_TG, f"x:f:task:{task_id}:{fields.index('assignee_tg_id')}")
    opts = buttons(sent)
    # исполнители - только участники пространства
    labels = [b["text"] for row in sent[-1][2] for b in row]
    assert "Помощница" in labels and "Чужой" not in labels
    helper_cb = opts[labels.index("Помощница")]
    cb(LERA_TG, helper_cb)

    cb(LERA_TG, f"x:f:task:{task_id}:{fields.index('due_at')}")
    say(LERA_TG, "01.10.2026 15:30")

    db = SessionLocal()
    t = db.get(Task, task_id)
    assert t.assignee_tg_id == HELPER_TG
    assert t.due_at == datetime(2026, 10, 1, 15, 30)
    assert t.notified_assigned is False
    db.close()


def test_invalid_input_keeps_dialog(ids, sent):
    fields = [f.key for f in bot_editor.ENTITIES["pay"].fields]
    db = SessionLocal()
    pay_id = db.query(IntegrationPayment).filter_by(streamer_id=ids["card"]).first().id
    db.close()
    cb(LERA_TG, f"x:f:pay:{pay_id}:{fields.index('amount')}")
    say(LERA_TG, "много")
    assert "Не понял" in sent[-1][1]
    assert bot_dialog._sessions[LERA_TG]["mode"] == "x_value"
    say(LERA_TG, "45000")
    assert LERA_TG not in bot_dialog._sessions
    db = SessionLocal()
    assert float(db.get(IntegrationPayment, pay_id).amount) == 45000
    db.close()


def test_rename_advertiser_syncs_deal_brand(ids, sent):
    fields = [f.key for f in bot_editor.ENTITIES["adv"].fields]
    cb(LERA_TG, f"x:f:adv:{ids['adv']}:{fields.index('name')}")
    say(LERA_TG, "БотБренд 2")
    db = SessionLocal()
    assert db.get(Integration, ids["deal"]).brand == "БотБренд 2"
    db.close()


def test_blogger_base_edit_requires_role(ids, sent):
    fields = [f.key for f in bot_editor.ENTITIES["bp"].fields]
    cb(VIEWER_TG, f"x:f:bp:{ids['blogger']}:{fields.index('telegram')}")
    assert "нет прав" in sent[-1][1].lower()
    cb(HELPER_TG, f"x:f:bp:{ids['blogger']}:{fields.index('telegram')}")
    say(HELPER_TG, "@blogger1")
    db = SessionLocal()
    assert db.get(BloggerProfile, ids["blogger"]).telegram == "@blogger1"
    db.close()


def test_wizard_adds_blogger_to_existing_deal(ids, sent):
    cb(LERA_TG, f"x:a:addp:{ids['deal']}")
    assert "n:tt:blogger" in buttons(sent)
    cb(LERA_TG, "n:tt:blogger")
    for answer in ("Новый Блогер", "70000", "15", "6", "нет"):
        say(LERA_TG, answer)
    db = SessionLocal()
    s = db.query(IntegrationStreamer).filter_by(streamer_name="Новый Блогер").one()
    assert s.talent_type == "blogger"
    assert s.integration_id == ids["deal"]
    db.close()


def test_workspace_switch(ids, sent):
    cb(LERA_TG, f"x:ws:{ids['second_ws']}")
    db = SessionLocal()
    assert bot_editor.resolve_workspace_id(db, LERA_TG) == ids["second_ws"]
    db.close()
    # во втором пространстве сделки первого не видны
    cb(LERA_TG, f"x:o:deal:{ids['deal']}")
    assert "Не найдено" in sent[-1][1]
    cb(LERA_TG, f"x:ws:{ids['main_ws']}")
    # в чужое пространство переключиться нельзя
    cb(LERA_TG, "x:ws:999999")
    db = SessionLocal()
    assert bot_editor.resolve_workspace_id(db, LERA_TG) == ids["main_ws"]
    db.close()


def test_delete_card(ids, sent):
    cb(LERA_TG, f"x:dq:card:{ids['card']}")
    assert f"x:dd:card:{ids['card']}" in buttons(sent)
    cb(LERA_TG, f"x:dd:card:{ids['card']}")
    db = SessionLocal()
    assert db.get(IntegrationStreamer, ids["card"]) is None
    assert db.query(IntegrationPayment).filter_by(streamer_id=ids["card"]).count() == 0
    db.close()
