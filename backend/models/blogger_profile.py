from datetime import datetime
from sqlalchemy import String, DateTime, Integer, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class BloggerProfile(Base):
    """База блогеров - аналог базы стримеров (StreamerProfile). Большая гугл-таблица
    ведётся по листам-площадкам (YouTube, Instagram, TikTok...), поэтому у блогера есть
    platform = название листа. Один и тот же человек на разных площадках - разные записи."""
    __tablename__ = "blogger_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    name: Mapped[str] = mapped_column(String(255), index=True)
    platform: Mapped[str] = mapped_column(String(64), default="", index=True)
    url: Mapped[str] = mapped_column(String(512), default="")
    telegram: Mapped[str] = mapped_column(String(255), default="")
    category: Mapped[str] = mapped_column(String(255), default="")
    geo: Mapped[str] = mapped_column(String(255), default="")

    subscribers: Mapped[int | None] = mapped_column(Integer, nullable=True)
    avg_views: Mapped[int | None] = mapped_column(Integer, nullable=True)
    price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)

    manager: Mapped[str] = mapped_column(String(255), default="")
    notes: Mapped[str] = mapped_column(Text, default="")

    # manual - заведён в CRM руками, sheet - пришёл из гугл-таблицы (такие удаляются,
    # если строку убрали из таблицы)
    source: Mapped[str] = mapped_column(String(16), default="manual")
    # все колонки строки листа как есть, по порядку: JSON [{"h": заголовок, "v": значение, "u": ссылка?}]
    sheet_row: Mapped[str] = mapped_column(Text, default="[]")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)
