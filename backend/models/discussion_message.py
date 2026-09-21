from datetime import datetime
from sqlalchemy import BigInteger, DateTime, Integer, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class DiscussionMessage(Base):
    """Комментарий в обсуждении сделки со стримером - плоская лента,
    чтобы не терять переписку/договорённости по проекту."""
    __tablename__ = "discussion_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    streamer_id: Mapped[int] = mapped_column(Integer, ForeignKey("integration_streamers.id", ondelete="CASCADE"), index=True)
    author_tg_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.tg_id", ondelete="SET NULL"), nullable=True)

    text: Mapped[str] = mapped_column(Text)
    # упомянутые через @ участники пространства - JSON-массив tg_id, как pinned_pages у User
    mentions: Mapped[str] = mapped_column(Text, default="[]")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
