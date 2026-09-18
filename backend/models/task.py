from datetime import datetime
from sqlalchemy import String, DateTime, Integer, ForeignKey, Text, BigInteger, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(512))
    description: Mapped[str] = mapped_column(Text, default="")
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(16), default="todo")  # todo | doing | done
    assignee_tg_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.tg_id", ondelete="SET NULL"), nullable=True, index=True)
    created_by_tg_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    page_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("pages.id", ondelete="SET NULL"), nullable=True)
    # флаги чтобы не дублировать TG-уведомления
    notified_assigned: Mapped[bool] = mapped_column(Boolean, default=False)
    notified_deadline: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)
