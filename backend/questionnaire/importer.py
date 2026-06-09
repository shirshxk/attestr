"""
questionnaire/importer.py — CSV and JSON answer import

Vendors with existing data can import answers via CSV or JSON.
The importer maps their columns/keys to question IDs and normalizes
everything through the standard answer schema before signing.
"""

import csv
import json
import io
from questionnaire.processor import normalize_answer


def import_from_csv(csv_content: str, column_mapping: dict) -> list:
    """
    Import answers from CSV content.

    column_mapping: maps CSV column names to answer schema fields
    e.g. {"Question": "question_text", "Answer": "answer_value", "ID": "question_id"}
    """
    reader = csv.DictReader(io.StringIO(csv_content))
    answers = []
    for row in reader:
        mapped = {}
        for csv_col, schema_field in column_mapping.items():
            if csv_col in row:
                mapped[schema_field] = row[csv_col]
        if mapped.get("question_id") and mapped.get("answer_value"):
            answers.append(normalize_answer(
                question_id   = mapped.get("question_id", ""),
                question_text = mapped.get("question_text", ""),
                answer_value  = mapped.get("answer_value", ""),
                answer_type   = mapped.get("answer_type", "free_text"),
                evidence_note = mapped.get("evidence_note", ""),
            ))
    return answers


def import_from_json(json_content: str) -> list:
    """
    Import answers from JSON content.
    Expects a list of answer objects matching or close to the Attestr schema.
    """
    data = json.loads(json_content)
    if not isinstance(data, list):
        raise ValueError("JSON import must be a list of answer objects.")

    answers = []
    for item in data:
        answers.append(normalize_answer(
            question_id   = item.get("question_id", ""),
            question_text = item.get("question_text", ""),
            answer_value  = item.get("answer_value", ""),
            answer_type   = item.get("answer_type", "free_text"),
            evidence_note = item.get("evidence_note", ""),
            answered_at   = item.get("answered_at"),
        ))
    return answers
