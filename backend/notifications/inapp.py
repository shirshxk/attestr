"""
notifications/inapp.py — In-app notification storage
"""

from sqlalchemy.orm import Session
from models.database import Notification


def create_notification(db: Session, org_id: str, title: str, body: str):
    """Create an in-app notification for an organization."""
    notif = Notification(org_id=org_id, title=title, body=body)
    db.add(notif)
    db.commit()
    return notif


def get_notifications(db: Session, org_id: str, limit: int = 20):
    """Get recent notifications for an org."""
    return (
        db.query(Notification)
        .filter(Notification.org_id == org_id)
        .order_by(Notification.created_at.desc())
        .limit(limit)
        .all()
    )


def get_unread_count(db: Session, org_id: str) -> int:
    return db.query(Notification).filter(
        Notification.org_id == org_id,
        Notification.is_read == False,  # noqa
    ).count()


def mark_all_read(db: Session, org_id: str):
    db.query(Notification).filter(
        Notification.org_id == org_id,
        Notification.is_read == False,  # noqa
    ).update({"is_read": True})
    db.commit()
