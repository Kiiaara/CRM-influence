from datetime import datetime
from sqlalchemy import String, DateTime, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class IntegrationScreenshot(Base):
    """Скриншот вышедшей интеграции (для будущего кейса). Как BriefFile: на одну сделку
    инфлюенсера их может быть несколько, строки удаляются каскадом вместе со сделкой."""
    __tablename__ = "integration_screenshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    streamer_id: Mapped[int] = mapped_column(Integer, ForeignKey("integration_streamers.id", ondelete="CASCADE"), index=True)

    file_path: Mapped[str] = mapped_column(String(512))
    file_name: Mapped[str] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
