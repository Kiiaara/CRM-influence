from datetime import datetime
from sqlalchemy import String, DateTime, Integer, ForeignKey, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class IntegrationPayment(Base):
    """Запись в истории оплат по стримеру внутри интеграции."""
    __tablename__ = "integration_payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    streamer_id: Mapped[int] = mapped_column(Integer, ForeignKey("integration_streamers.id", ondelete="CASCADE"), index=True)
    amount: Mapped[float] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(8), default="RUB")
    comment: Mapped[str] = mapped_column(Text, default="")
    paid_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
