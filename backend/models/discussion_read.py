from datetime import datetime
from sqlalchemy import BigInteger, DateTime, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class DiscussionMessageRead(Base):
    """Отметка "прочитано до" по обсуждению стримера для конкретного юзера -
    нужна для бейджа непрочитанных в чатике справа."""
    __tablename__ = "discussion_message_reads"

    streamer_id: Mapped[int] = mapped_column(Integer, ForeignKey("integration_streamers.id", ondelete="CASCADE"), primary_key=True)
    user_tg_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.tg_id", ondelete="CASCADE"), primary_key=True)
    last_read_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
