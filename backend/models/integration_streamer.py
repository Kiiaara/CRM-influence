from datetime import datetime
from sqlalchemy import String, DateTime, Integer, BigInteger, ForeignKey, Text, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


class IntegrationStreamer(Base):
    """Стример внутри интеграции с брендом. Каждый со своими сроками, суммой и статусом.
    stage: negotiation | agreed | awaiting_contract | awaiting_payment | done | cancelled
    payment_status: not_invoiced | invoiced | partial | paid
    content_status: awaiting_brief | filming | filmed
    ord_responsible: us | client - кто маркирует рекламу (получает erid) по этому размещению
    ord_status: todo | done - статус самой маркировки
    ord_reporting_status: not_submitted | submitted | overdue - статус отчётности в ОРД
    contract_status: not_sent | sent_to_streamer | signed_by_streamer | sent_to_brand | signed_by_brand | active | expired
    """
    __tablename__ = "integration_streamers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    integration_id: Mapped[int] = mapped_column(Integer, ForeignKey("integrations.id", ondelete="CASCADE"), index=True)

    streamer_name: Mapped[str] = mapped_column(String(255))
    contact: Mapped[str] = mapped_column(String(255), default="")

    stage: Mapped[str] = mapped_column(String(32), default="negotiation", index=True)
    payment_status: Mapped[str] = mapped_column(String(32), default="not_invoiced")
    content_status: Mapped[str | None] = mapped_column(String(32), nullable=True)

    amount: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String(8), default="RUB")

    # для расчёта суммы на руки стримеру: amount - (amount * commission%) - (amount * tax%)
    commission_percent: Mapped[float] = mapped_column(Numeric(5, 2), default=15)
    streamer_tax_percent: Mapped[float] = mapped_column(Numeric(5, 2), default=6)

    deadline: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    integration_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    # точное время старта стрима в формате "ЧЧ:ММ" - если известно; integration_date хранит только день
    integration_time: Mapped[str | None] = mapped_column(String(5), nullable=True)
    description: Mapped[str] = mapped_column(Text, default="")

    contract_file_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    contract_file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contract_valid_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    contract_status: Mapped[str] = mapped_column(String(24), default="not_sent")
    contract_sent_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    contract_signed_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    contract_notes: Mapped[str] = mapped_column(Text, default="")

    # ТЗ (техническое задание) для стримера, свободный текст
    brief: Mapped[str] = mapped_column(Text, default="")

    # позиция карточки внутри колонки канбана (для сортировки внутри stage)
    position: Mapped[int] = mapped_column(Integer, default=0)

    # маркировка рекламы (ОРД / erid)
    ord_responsible: Mapped[str] = mapped_column(String(16), default="us")
    ord_status: Mapped[str] = mapped_column(String(16), default="todo")
    ord_reporting_status: Mapped[str] = mapped_column(String(16), default="not_submitted")

    # флаги напоминаний бота по integration_date (чтобы не слать повторно)
    notified_branding_check: Mapped[bool] = mapped_column(default=False)
    notified_screenshot: Mapped[bool] = mapped_column(default=False)
    notified_report: Mapped[bool] = mapped_column(default=False)
    notified_stream_start: Mapped[bool] = mapped_column(default=False)
    notified_case_reminder: Mapped[bool] = mapped_column(default=False)

    # кто добавил карточку в канбан - напоминания по ней таргетируются на этого юзера
    created_by_tg_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.tg_id", ondelete="SET NULL"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)

    integration: Mapped["Integration"] = relationship(back_populates="streamers")
    payments: Mapped[list["IntegrationPayment"]] = relationship(cascade="all, delete-orphan")
    case_studies: Mapped[list["CaseStudy"]] = relationship(cascade="all, delete-orphan")

    @property
    def has_case(self) -> bool:
        return len(self.case_studies) > 0
