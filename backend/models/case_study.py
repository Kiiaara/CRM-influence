from datetime import datetime
from sqlalchemy import String, DateTime, Integer, ForeignKey, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class CaseStudy(Base):
    """Кейс интеграции для сайта: игра/бренд, описание, что сделано, результат + фото."""
    __tablename__ = "case_studies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    streamer_id: Mapped[int] = mapped_column(Integer, ForeignKey("integration_streamers.id", ondelete="CASCADE"), index=True)

    title: Mapped[str] = mapped_column(String(255), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    what_was_done: Mapped[str] = mapped_column(Text, default="")
    result: Mapped[str] = mapped_column(Text, default="")

    # --- публикация на сайт tkacheva-media (site_publisher.py) ---
    show_on_site: Mapped[bool] = mapped_column(Boolean, default=False)
    site_tag: Mapped[str] = mapped_column(String(32), default="Games")  # Games | Tournament | Special Project - фильтры сайта
    site_mini: Mapped[str] = mapped_column(String(128), default="")  # плашка на карточке: "23,5 млн+ просмотров"
    # переводы для переключателя языков сайта: JSON {"en": {title, mini, description, what_was_done, result}, "zh": {...}}
    translations: Mapped[str] = mapped_column(Text, default="{}")
    site_published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    photo_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    photo_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)
