from datetime import datetime
from sqlalchemy import String, DateTime, Integer, ForeignKey, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class BrandContact(Base):
    """Контакт представителя рекламодателя (Advertiser). Несколько контактов
    на рекламодателя, один может быть отмечен как основной. Общие на всю
    историю сделок с этим рекламодателем, а не на одну конкретную сделку."""
    __tablename__ = "brand_contacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    advertiser_id: Mapped[int] = mapped_column(Integer, ForeignKey("advertisers.id", ondelete="CASCADE"), index=True)

    contact_type: Mapped[str] = mapped_column(String(16))  # email | telegram | whatsapp | phone | other
    value: Mapped[str] = mapped_column(String(255))
    label: Mapped[str] = mapped_column(String(128), default="")  # например "Менеджер", "Директор"
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str] = mapped_column(Text, default="")  # часовой пояс, лучшее время для связи и т.п.

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)
