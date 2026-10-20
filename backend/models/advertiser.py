from datetime import datetime
from sqlalchemy import String, DateTime, Integer, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base
from models.brand_contact import BrandContact


class Advertiser(Base):
    """Рекламодатель (бренд/клиент) - самостоятельная сущность вне привязки
    к конкретной сделке. Внутри пространства: одна сделка = один рекламодатель,
    но у рекламодателя может быть много сделок за всё время.

    Контакты хранятся только в BrandContact (несколько на рекламодателя). Старые колонки
    contact_person/telegram/email/phone в уже существующих базах остались мёртвым грузом:
    модель их не знает, ничего не читает и не пишет."""
    __tablename__ = "advertisers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)

    name: Mapped[str] = mapped_column(String(255), index=True)
    notes: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)

    # контакты только для чтения (основной первым); правятся через BrandContact
    contacts: Mapped[list[BrandContact]] = relationship(
        BrandContact,
        viewonly=True,
        order_by=lambda: (BrandContact.is_primary.desc(), BrandContact.created_at.asc(), BrandContact.id.asc()),
    )
