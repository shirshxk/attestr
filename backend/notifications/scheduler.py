"""
notifications/scheduler.py — APScheduler deadline reminder jobs

Runs daily to check for:
  - Questionnaire deadlines approaching (7 days, 1 day)
  - Certificates expiring within 30 days
"""

from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime, timedelta
from sqlalchemy.orm import Session


def check_deadlines():
    """Daily job: send reminders for approaching questionnaire deadlines."""
    from models.database import SessionLocal, Questionnaire, Organization
    from notifications.email import notify_deadline_reminder
    from notifications.inapp import create_notification

    db = SessionLocal()
    try:
        now   = datetime.utcnow()
        soon7 = now + timedelta(days=7)
        soon1 = now + timedelta(days=1)

        questionnaires = db.query(Questionnaire).filter(
            Questionnaire.deadline != None,  # noqa
            Questionnaire.status.in_(["pending", "in_remediation"]),
        ).all()

        for q in questionnaires:
            vendor = db.query(Organization).filter(Organization.id == q.vendor_id).first()
            if not vendor:
                continue

            delta = (q.deadline - now).days
            if delta == 7 or delta == 1:
                notify_deadline_reminder(vendor.email, q.title, delta)
                create_notification(db, vendor.id,
                    f"Deadline reminder: {delta} day(s) remaining",
                    f"Your response to '{q.title}' is due in {delta} day(s).")
    finally:
        db.close()


def check_expiring_certs():
    """Daily job: warn about certificates expiring within 30 days."""
    from models.database import SessionLocal, Certificate, Organization
    from notifications.email import notify_cert_expiring
    from notifications.inapp import create_notification

    db = SessionLocal()
    try:
        now    = datetime.utcnow()
        cutoff = now + timedelta(days=30)

        certs = db.query(Certificate).filter(
            Certificate.expires_at <= cutoff,
            Certificate.expires_at >= now,
            Certificate.is_revoked == False,  # noqa
        ).all()

        for cert in certs:
            org = db.query(Organization).filter(Organization.id == cert.org_id).first()
            if not org:
                continue
            days_left = (cert.expires_at - now).days
            notify_cert_expiring(org.email, org.name, days_left)
            create_notification(db, org.id,
                f"Certificate expiring in {days_left} days",
                "Please contact the CA Admin to renew your certificate.")
    finally:
        db.close()


def start_scheduler():
    """Start the background scheduler. Called at application startup."""
    scheduler = BackgroundScheduler()
    scheduler.add_job(check_deadlines,     "cron", hour=8, minute=0)
    scheduler.add_job(check_expiring_certs, "cron", hour=8, minute=30)
    scheduler.start()
    return scheduler
