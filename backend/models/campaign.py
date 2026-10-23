from datetime import datetime
from sqlalchemy import String, DateTime, Integer, BigInteger, ForeignKey, Text, Numeric
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class Campaign(Base):
    """Рекламная кампания - уровень выше сделки со инфлюенсером.
    Запрос от бренда живёт здесь ещё до того, как подобраны блогеры:
    пришёл запрос -> собираем подборку -> отдали -> ждём ОС -> условия -> запуск.

    status: picking | sent | waiting_feedback | negotiating | running | cancelled
    """
    __tablename__ = "campaigns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)

    name: Mapped[str] = mapped_column(String(255))
    advertiser_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("advertisers.id", ondelete="SET NULL"), nullable=True, index=True)

    status: Mapped[str] = mapped_column(String(24), default="picking", index=True)

    # дата поступления запроса от бренда
    requested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # дедлайн сдачи подборки блогеров клиенту
    selection_due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    # дедлайн самой рекламной кампании
    campaign_due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)

    budget: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String(8), default="RUB")

    owner_tg_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.tg_id", ondelete="SET NULL"), nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    # ссылка на КП (гугл-таблица с расчётом) по всей кампании
    kp_url: Mapped[str] = mapped_column(String(512), default="")

    # коэффициент наценки этой кампании (клиентская сумма / коэффициент = выплата блогеру);
    # null - берём коэффициент пространства. Новая кампания фиксирует его при создании
    margin_divisor: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)

    # когда РК отметили завершённой (кнопка "Готово"); null = активная.
    # Отдельное поле, а не статус: так видно, на какой стадии РК закончилась
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)
