"""
questionnaire/builder.py — Dynamic questionnaire engine

Handles creation, retrieval and management of questionnaires.
Three modes:
  1. Use predefined template as-is
  2. Modify a predefined template
  3. Build completely custom questionnaire
"""

import json
import os
from datetime import datetime
from sqlalchemy.orm import Session
from models.database import Questionnaire, Question, Organization
from audit.hmac_log import append_log

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")


def load_template(template_type: str) -> dict:
    """Load a predefined questionnaire template from JSON."""
    path = os.path.join(TEMPLATES_DIR, f"{template_type}.json")
    if not os.path.exists(path):
        raise ValueError(f"Template '{template_type}' not found.")
    with open(path) as f:
        return json.load(f)


def create_questionnaire_from_template(
    template_type: str,
    auditor_id: str,
    vendor_id: str,
    deadline,
    db: Session,
    custom_title: str = None,
    question_overrides: list = None,
) -> Questionnaire:
    """
    Create a questionnaire from a predefined template.
    Optionally override or add questions.
    """
    template = load_template(template_type)
    questions = template["questions"][:]

    if question_overrides:
        for override in question_overrides:
            action = override.get("action", "add")
            if action == "remove":
                questions = [q for q in questions if q["question_id"] != override["question_id"]]
            elif action == "modify":
                for q in questions:
                    if q["question_id"] == override["question_id"]:
                        q.update({k: v for k, v in override.items() if k != "action"})
            elif action == "add":
                questions.append(override)

    q = Questionnaire(
        title=custom_title or template["title"],
        type=template_type,
        template_json=json.dumps(template),
        auditor_id=auditor_id,
        vendor_id=vendor_id,
        deadline=deadline,
    )
    db.add(q)
    db.flush()

    for i, qdata in enumerate(questions):
        question = Question(
            questionnaire_id=q.id,
            question_id=qdata["question_id"],
            question_text=qdata["question_text"],
            question_type=qdata["question_type"],
            is_required=qdata.get("is_required", True),
            order_index=i,
        )
        db.add(question)

    db.commit()
    append_log(db, "questionnaire_created", actor_id=auditor_id, target_id=q.id,
               details={"type": template_type, "vendor_id": vendor_id})
    return q


def create_custom_questionnaire(
    title: str,
    auditor_id: str,
    vendor_id: str,
    deadline,
    questions_data: list,
    db: Session,
) -> Questionnaire:
    """Create a fully custom questionnaire from scratch."""
    q = Questionnaire(
        title=title,
        type="custom",
        auditor_id=auditor_id,
        vendor_id=vendor_id,
        deadline=deadline,
    )
    db.add(q)
    db.flush()

    for i, qdata in enumerate(questions_data):
        question = Question(
            questionnaire_id=q.id,
            question_id=qdata.get("question_id", f"q{i+1}"),
            question_text=qdata["question_text"],
            question_type=qdata.get("question_type", "free_text"),
            is_required=qdata.get("is_required", True),
            order_index=i,
        )
        db.add(question)

    db.commit()
    append_log(db, "questionnaire_created", actor_id=auditor_id, target_id=q.id,
               details={"type": "custom", "vendor_id": vendor_id})
    return q


def get_questionnaire_with_questions(questionnaire_id: str, db: Session) -> dict:
    """Return questionnaire + all questions as a dict."""
    q = db.query(Questionnaire).filter(Questionnaire.id == questionnaire_id).first()
    if not q:
        return None

    questions = (
        db.query(Question)
        .filter(Question.questionnaire_id == q.id)
        .order_by(Question.order_index)
        .all()
    )

    return {
        "id":          q.id,
        "title":       q.title,
        "type":        q.type,
        "status":      q.status,
        "auditor_id":  q.auditor_id,
        "vendor_id":   q.vendor_id,
        "deadline":    q.deadline.isoformat() if q.deadline else None,
        "created_at":  q.created_at.isoformat(),
        "questions": [
            {
                "id":            qq.id,
                "question_id":   qq.question_id,
                "question_text": qq.question_text,
                "question_type": qq.question_type,
                "is_required":   qq.is_required,
                "order_index":   qq.order_index,
            }
            for qq in questions
        ],
    }
