from datetime import datetime
from sqlalchemy import String, DateTime, Integer, ForeignKey, Text, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


class IntegrationStreamer(Base):
    """Стример внутри интеграции с брендом. Каждый со своими сроками, суммой и статусом.
    stage: negotiation | agreed | awaiting_contract | awaiting_payment | done | cancelled
    payment_status: not_invoiced | invoiced | partial | paid
    """
    __tablename__ = "integration_streamers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    integration_id: Mapped[int] = mapped_column(Integer, ForeignKey("integrations.id", ondelete="CASCADE"), index=True)

    streamer_name: Mapped[str] = mapped_column(String(255))
    contact: Mapped[str] = mapped_column(String(255), default="")

    stage: Mapped[str] = mapped_column(String(32), default="negotiation", index=True)
    payment_status: Mapped[str] = mapped_column(String(32), default="not_invoiced")

    amount: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String(8), default="RUB")

    # для расчёта суммы на руки стримеру: amount - (amount * commission%) - (amount * tax%)
    commission_percent: Mapped[float] = mapped_column(Numeric(5, 2), default=15)
    streamer_tax_percent: Mapped[float] = mapped_column(Numeric(5, 2), default=6)

    deadline: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    description: Mapped[str] = mapped_column(Text, default="")

    contract_file_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    contract_file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # позиция карточки внутри колонки канбана (для сортировки внутри stage)
    position: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)

    integration: Mapped["Integration"] = relationship(back_populates="streamers")
