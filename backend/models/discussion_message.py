from datetime import datetime
from sqlalchemy import BigInteger, DateTime, Integer, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class DiscussionMessage(Base):
    """Сообщение чата. streamer_id = None - общая лента пространства,
    заполнен - ветка по конкретной сделке (бывшее обсуждение в модалке)."""
    __tablename__ = "discussion_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # у веток workspace берётся через сделку, но для общего чата нужен явный
    workspace_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True, index=True)
    streamer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("integration_streamers.id", ondelete="CASCADE"), nullable=True, index=True)
    author_tg_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.tg_id", ondelete="SET NULL"), nullable=True)

    text: Mapped[str] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
