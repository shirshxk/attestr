"""
api/notifications.py — In-app notification endpoints
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from api.auth import require_auth
from models.database import get_db, Organization
from notifications.inapp import get_notifications, get_unread_count, mark_all_read

router = APIRouter(tags=["Notifications"])


@router.get("/notifications")
def list_notifications(
    org: Organization = Depends(require_auth),
    db: Session = Depends(get_db),
):
    notifs = get_notifications(db, org.id)
    return [
        {
            "id":         n.id,
            "title":      n.title,
            "body":       n.body,
            "is_read":    n.is_read,
            "created_at": n.created_at.isoformat(),
        }
        for n in notifs
    ]


@router.get("/notifications/unread-count")
def unread_count(
    org: Organization = Depends(require_auth),
    db: Session = Depends(get_db),
):
    return {"count": get_unread_count(db, org.id)}


@router.post("/notifications/mark-read")
def mark_read(
    org: Organization = Depends(require_auth),
    db: Session = Depends(get_db),
):
    mark_all_read(db, org.id)
    return {"message": "All notifications marked as read."}
