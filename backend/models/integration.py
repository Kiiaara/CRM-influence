from datetime import datetime
from sqlalchemy import String, DateTime, Integer, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


class Integration(Base):
    """Сделка с брендом. Внутри - пул стримеров (IntegrationStreamer),
    каждый со своими сроками/суммой/статусом."""
    __tablename__ = "integrations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    advertiser_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("advertisers.id", ondelete="RESTRICT"), index=True, nullable=True)

    # денормализовано из advertiser.name - держим синхронно при переименовании рекламодателя,
    # чтобы не трогать весь остальной код, который читает Integration.brand напрямую
    brand: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    # ссылка на гугл-таблицу с расчётом КП по этой сделке
    kp_sheet_url: Mapped[str] = mapped_column(String(512), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)

    streamers: Mapped[list["IntegrationStreamer"]] = relationship(
        back_populates="integration", cascade="all, delete-orphan", order_by="IntegrationStreamer.position"
    )
