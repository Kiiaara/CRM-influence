from datetime import datetime
from sqlalchemy import String, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class AppSetting(Base):
    """Глобальные настройки ключ-значение (например, ссылка на гугл-таблицу базы блогеров)."""
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)
