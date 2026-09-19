from datetime import datetime
from sqlalchemy import BigInteger, String, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class User(Base):
    """Whitelist + роль. tg_id одновременно ID юзера и chat_id для личных сообщений
    (если юзер хоть раз писал боту - иначе tg_chat_ready=False и шлём плашку в UI)."""
    __tablename__ = "users"

    tg_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    role: Mapped[str] = mapped_column(String(16), default="editor")  # admin | editor | viewer
    label: Mapped[str | None] = mapped_column(String(128), nullable=True)
    tg_username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tg_first_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # VK ID для входа через VK (привязывается к тому же аккаунту, что и TG)
    vk_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, unique=True, index=True)
    # стал ли юзер досягаем для бота (написал ли /start)
    tg_chat_ready: Mapped[bool] = mapped_column(Boolean, default=False)
    # закреплённые id страниц - JSON-массив. Хранится в виде строки "[1,2,3]"
    pinned_pages: Mapped[str] = mapped_column(String(2048), default="[]")

    # настройки бот-уведомлений: сводка "Горячие задачи" (черновики/дедлайны/договоры/оплаты)
    notify_hot_tasks: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_interval_hours: Mapped[int] = mapped_column(default=4)
    quiet_hours_start: Mapped[int | None] = mapped_column(nullable=True, default=22)  # 0-23, None = тихие часы выключены
    quiet_hours_end: Mapped[int | None] = mapped_column(nullable=True, default=8)
    last_hot_tasks_notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
