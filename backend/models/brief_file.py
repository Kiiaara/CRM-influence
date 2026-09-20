from datetime import datetime
from sqlalchemy import String, DateTime, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class BriefFile(Base):
    """Файл, приложенный к ТЗ стримера. В отличие от договора их может быть много -
    бренд часто кидает презентацию, референс-видео и текстовую бумагу отдельно."""
    __tablename__ = "brief_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    streamer_id: Mapped[int] = mapped_column(Integer, ForeignKey("integration_streamers.id", ondelete="CASCADE"), index=True)

    file_path: Mapped[str] = mapped_column(String(512))
    file_name: Mapped[str] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
