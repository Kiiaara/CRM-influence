from datetime import datetime
from sqlalchemy import String, DateTime, Integer, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class OwnBlogger(Base):
    """Свои блогеры: найденные командой самостоятельно и заведённые руками.
    Отдельная таблица от BloggerProfile (базы агентства из гугл-таблицы): синхронизация
    приводит ту базу к таблице и удаляет всё лишнее, а свои блогеры не должны пропадать.
    База агентства общая на все пространства, свои - у каждого пространства свои."""
    __tablename__ = "own_bloggers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)

    name: Mapped[str] = mapped_column(String(255), index=True)
    url: Mapped[str] = mapped_column(String(512), default="")
    # площадка свободным текстом (YouTube, Instagram, Telegram...)
    platform: Mapped[str] = mapped_column(String(64), default="")
    # как связаться: ТГ, почта, телефон, менеджер блогера
    contact: Mapped[str] = mapped_column(String(255), default="")
    category: Mapped[str] = mapped_column(String(255), default="")
    notes: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)
