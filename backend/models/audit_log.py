from datetime import datetime
from sqlalchemy import BigInteger, DateTime, Integer, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class AuditLogEntry(Base):
    """Запись в журнале изменений: кто когда что поменял по стримеру внутри сделки.
    streamer_id нулится (не каскадно удаляется), чтобы запись переживала удаление карточки -
    brand/streamer_name денормализованы специально для этого.
    field: stage | payment_status | content_status | amount | deadline | contract_status |
    contract_sent_date | contract_signed_date | ord_status | ord_reporting_status |
    created | deleted | payment_added | contract_uploaded
    """
    __tablename__ = "audit_log_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    streamer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("integration_streamers.id", ondelete="SET NULL"), nullable=True, index=True)
    integration_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    brand: Mapped[str] = mapped_column(String(255), default="")
    streamer_name: Mapped[str] = mapped_column(String(255), default="")

    field: Mapped[str] = mapped_column(String(32))
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)

    changed_by_tg_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.tg_id", ondelete="SET NULL"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
