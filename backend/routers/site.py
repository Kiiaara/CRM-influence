"""Публикация кейсов на сайт tkacheva-media (см. site_publisher.py)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import site_publisher
from config import settings
from database import get_db
from deps import get_current_user, require_role
from models.user import User

router = APIRouter(prefix="/api/site", tags=["site"])


@router.get("/status")
def site_status(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    cases = site_publisher.cases_for_site(db, user.tg_id)
    last = max((c.site_published_at for c in cases if c.site_published_at), default=None)
    return {
        "configured": site_publisher.is_configured(),
        "site_url": settings.site_url,
        "count": len(cases),
        "unpublished": sum(1 for c in cases if not c.site_published_at or c.updated_at > c.site_published_at),
        "last_published_at": last,
    }


@router.get("/preview")
def site_preview(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Что уйдёт в cases.json - без фото и без коммита."""
    cases = site_publisher.cases_for_site(db, user.tg_id)
    return {"cases": [site_publisher.case_to_site(c, bool(c.photo_path)) for c in cases]}


@router.post("/publish")
async def site_publish(db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    try:
        return await site_publisher.publish(db, user.tg_id)
    except site_publisher.PublishError as e:
        raise HTTPException(400, str(e))
