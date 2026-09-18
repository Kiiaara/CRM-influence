from datetime import datetime
from sqlalchemy import String, DateTime, Integer, Numeric, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class StreamerProfile(Base):
    """Справочник (медиакит) стримеров: соцсети, аудитория, прайс-лист.
    Независим от конкретных сделок - используется чтобы быстро добавлять
    стримеров на интеграции без ввода одних и тех же данных заново."""
    __tablename__ = "streamer_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    name: Mapped[str] = mapped_column(String(255), index=True)
    twitch_url: Mapped[str] = mapped_column(String(512), default="")
    category: Mapped[str] = mapped_column(String(255), default="")
    social_links: Mapped[str] = mapped_column(Text, default="")

    subscribers: Mapped[int | None] = mapped_column(Integer, nullable=True)
    avg_online: Mapped[int | None] = mapped_column(Integer, nullable=True)
    geo: Mapped[str] = mapped_column(String(255), default="")
    views_per_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    views_per_stream: Mapped[int | None] = mapped_column(Integer, nullable=True)

    telegram_subscribers: Mapped[int | None] = mapped_column(Integer, nullable=True)
    telegram_reach: Mapped[int | None] = mapped_column(Integer, nullable=True)

    post_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    knd_registry: Mapped[str] = mapped_column(String(255), default="")
    twitch_partner: Mapped[bool] = mapped_column(Boolean, default=False)
    stats_url: Mapped[str] = mapped_column(String(512), default="")
    stats_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    manager: Mapped[str] = mapped_column(String(255), default="")

    branding_price_1w: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    branding_price_2w: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    branding_price_3w: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    branding_price_1m: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    special_stream_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    voice_integration_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)
