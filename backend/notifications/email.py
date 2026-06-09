"""
notifications/email.py — Email notifications via Mailhog (local SMTP)
"""

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from config import settings


def send_email(to: str, subject: str, body: str) -> bool:
    """Send an email via Mailhog (catches all emails locally at http://localhost:8025)."""
    try:
        msg = MIMEMultipart()
        msg["From"]    = settings.smtp_from
        msg["To"]      = to
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "html"))

        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            server.sendmail(settings.smtp_from, to, msg.as_string())
        return True
    except Exception as e:
        print(f"[Email] Failed to send to {to}: {e}")
        return False


def notify_questionnaire_sent(vendor_email: str, auditor_name: str, questionnaire_title: str, deadline: str):
    send_email(
        vendor_email,
        f"New compliance questionnaire from {auditor_name}",
        f"""<p>You have received a new compliance questionnaire from <b>{auditor_name}</b>.</p>
        <p><b>Questionnaire:</b> {questionnaire_title}</p>
        <p><b>Deadline:</b> {deadline}</p>
        <p>Please log in to Attestr to complete and submit your response.</p>"""
    )


def notify_submission_received(auditor_email: str, vendor_name: str, questionnaire_title: str):
    send_email(
        auditor_email,
        f"{vendor_name} has submitted their compliance response",
        f"""<p><b>{vendor_name}</b> has submitted their response to <b>{questionnaire_title}</b>.</p>
        <p>Log in to Attestr to review and verify the Tessera bundle.</p>"""
    )


def notify_remediation_requested(vendor_email: str, auditor_name: str, flagged_count: int):
    send_email(
        vendor_email,
        f"Remediation requested by {auditor_name}",
        f"""<p><b>{auditor_name}</b> has flagged <b>{flagged_count} answer(s)</b> as insufficient.</p>
        <p>Please log in to Attestr to review the flags and submit a remediation response.</p>"""
    )


def notify_deadline_reminder(vendor_email: str, questionnaire_title: str, days_remaining: int):
    send_email(
        vendor_email,
        f"Reminder: {days_remaining} day(s) remaining to submit compliance questionnaire",
        f"""<p>This is a reminder that your response to <b>{questionnaire_title}</b> is due in
        <b>{days_remaining} day(s)</b>.</p>
        <p>Please log in to Attestr to complete your submission.</p>"""
    )


def notify_cert_expiring(org_email: str, org_name: str, days_remaining: int):
    send_email(
        org_email,
        f"Certificate expiring in {days_remaining} days",
        f"""<p>The X.509 certificate for <b>{org_name}</b> expires in <b>{days_remaining} days</b>.</p>
        <p>Please contact your CA Admin to renew your certificate.</p>"""
    )
