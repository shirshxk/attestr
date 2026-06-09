"""
export/pdf.py — PDF report generation using ReportLab

Generates a professional compliance report PDF with:
  - Organization details and certificate info
  - Full questionnaire with answers
  - Verification status per answer
  - Remediation history
  - Cryptographic proof summary
"""

import io
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT


BLUE  = colors.HexColor("#2563eb")
GREEN = colors.HexColor("#16a34a")
RED   = colors.HexColor("#dc2626")
GRAY  = colors.HexColor("#64748b")
LIGHT = colors.HexColor("#f1f5f9")


def generate_pdf_report(
    bundle: dict,
    answers: list,
    verification_result: dict,
    auditor_name: str,
    vendor_name: str,
    questionnaire_title: str,
    remediation_history: list = None,
) -> bytes:
    """
    Generate a complete PDF compliance report.
    Returns PDF as bytes.
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=20*mm,
        leftMargin=20*mm,
        topMargin=20*mm,
        bottomMargin=20*mm,
    )

    styles = getSampleStyleSheet()
    story  = []

    # Title style
    title_style = ParagraphStyle("Title", parent=styles["Normal"],
        fontSize=20, fontName="Helvetica-Bold", textColor=BLUE,
        spaceAfter=4, alignment=TA_LEFT)
    subtitle_style = ParagraphStyle("Subtitle", parent=styles["Normal"],
        fontSize=11, fontName="Helvetica", textColor=GRAY,
        spaceAfter=16)
    h2_style = ParagraphStyle("H2", parent=styles["Normal"],
        fontSize=13, fontName="Helvetica-Bold", textColor=colors.black,
        spaceBefore=16, spaceAfter=8)
    body_style = ParagraphStyle("Body", parent=styles["Normal"],
        fontSize=9, fontName="Helvetica", textColor=colors.black,
        spaceAfter=4, leading=14)
    mono_style = ParagraphStyle("Mono", parent=styles["Normal"],
        fontSize=7.5, fontName="Courier", textColor=GRAY,
        spaceAfter=4, leading=12)

    # ── Header ────────────────────────────────────────────
    story.append(Paragraph("Attestr", title_style))
    story.append(Paragraph("Compliance Verification Report", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1, color=BLUE))
    story.append(Spacer(1, 8*mm))

    # ── Meta table ────────────────────────────────────────
    meta_data = [
        ["Questionnaire", questionnaire_title],
        ["Auditor",       auditor_name],
        ["Vendor",        vendor_name],
        ["Bundle ID",     bundle.get("bundle_id", "N/A")],
        ["Generated",     datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")],
        ["Round",         str(bundle.get("remediation_round", 0))],
    ]
    meta_table = Table(meta_data, colWidths=[45*mm, 120*mm])
    meta_table.setStyle(TableStyle([
        ("FONTNAME",  (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE",  (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), GRAY),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 6*mm))

    # ── Verification Summary ──────────────────────────────
    story.append(Paragraph("Cryptographic Verification Summary", h2_style))

    vr = verification_result
    overall_color = GREEN if vr.get("overall_valid") else RED
    overall_text  = "ALL LAYERS PASSED" if vr.get("overall_valid") else "VERIFICATION FAILED"

    summary_data = [
        ["Layer", "Check", "Result"],
        ["L1 Identity",     "X.509 Certificate Chain",      "PASS" if vr.get("cert_valid") else "FAIL"],
        ["L1 Identity",     "Certificate Revocation (CRL)", "PASS" if vr.get("crl_valid") else "FAIL"],
        ["L3 Signing",      "ECDSA Signature",              "PASS" if vr.get("ecdsa_valid") else "FAIL"],
        ["L3 Signing",      "Merkle Proof Paths",           "PASS" if vr.get("merkle_valid") else "FAIL"],
        ["L5 Timestamp",    "RFC 3161 Timestamp",           "PASS" if vr.get("timestamp_valid") else "FAIL"],
    ]

    summary_table = Table(summary_data, colWidths=[35*mm, 90*mm, 25*mm])
    summary_table.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR",    (0, 0), (-1, 0), colors.white),
        ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1, -1), 8.5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
    ]))
    # Color PASS/FAIL cells
    for row_idx in range(1, len(summary_data)):
        val = summary_data[row_idx][2]
        clr = GREEN if val == "PASS" else RED
        summary_table.setStyle(TableStyle([
            ("TEXTCOLOR", (2, row_idx), (2, row_idx), clr),
            ("FONTNAME",  (2, row_idx), (2, row_idx), "Helvetica-Bold"),
        ]))

    story.append(summary_table)
    story.append(Spacer(1, 4*mm))
    story.append(Paragraph(
        f'<font color="#{("16a34a" if vr.get("overall_valid") else "dc2626")}">'
        f'<b>Overall: {overall_text}</b></font>',
        body_style
    ))
    story.append(Spacer(1, 6*mm))

    # ── Merkle Root and Signature ─────────────────────────
    story.append(Paragraph("Cryptographic Proof", h2_style))
    proof_data = [
        ["Merkle Root",      bundle.get("merkle_root", "N/A")[:64]],
        ["ECDSA Signature",  (bundle.get("ecdsa_signature", "N/A")[:48] + "...")],
        ["RFC 3161 Token",   "Present" if bundle.get("rfc3161_timestamp_token") else "Not present"],
    ]
    proof_table = Table(proof_data, colWidths=[45*mm, 120*mm])
    proof_table.setStyle(TableStyle([
        ("FONTNAME",  (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME",  (1, 0), (1, -1), "Courier"),
        ("FONTSIZE",  (0, 0), (-1, -1), 8),
        ("TEXTCOLOR", (0, 0), (0, -1), GRAY),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
    ]))
    story.append(proof_table)
    story.append(Spacer(1, 6*mm))

    # ── Answers ───────────────────────────────────────────
    story.append(Paragraph("Questionnaire Answers", h2_style))

    merkle_results = {}
    if vr.get("merkle_details") and vr["merkle_details"].get("results"):
        for r in vr["merkle_details"]["results"]:
            merkle_results[r["question_id"]] = r["valid"]

    ans_data = [["#", "Question ID", "Question", "Answer", "Status"]]
    for i, ans in enumerate(answers):
        qid    = ans.get("question_id", "")
        valid  = merkle_results.get(qid, True)
        status = "Valid" if valid else "TAMPERED"
        ans_data.append([
            str(i + 1),
            qid,
            ans.get("question_text", "")[:60],
            ans.get("answer_value", "")[:30],
            status,
        ])

    ans_table = Table(ans_data, colWidths=[10*mm, 20*mm, 70*mm, 40*mm, 22*mm])
    ans_table.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, 0), BLUE),
        ("TEXTCOLOR",    (0, 0), (-1, 0), colors.white),
        ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1, -1), 7.5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#e2e8f0")),
        ("WORDWRAP", (2, 1), (3, -1), True),
    ]))

    for row_idx in range(1, len(ans_data)):
        status = ans_data[row_idx][4]
        clr = GREEN if status == "Valid" else RED
        ans_table.setStyle(TableStyle([
            ("TEXTCOLOR", (4, row_idx), (4, row_idx), clr),
            ("FONTNAME",  (4, row_idx), (4, row_idx), "Helvetica-Bold"),
        ]))

    story.append(ans_table)

    # ── Remediation history ────────────────────────────────
    if remediation_history:
        story.append(PageBreak())
        story.append(Paragraph("Remediation History", h2_style))
        for rnd in remediation_history:
            story.append(Paragraph(
                f'Round {rnd.get("round")} — {rnd.get("created_at", "")}',
                body_style
            ))
            story.append(Paragraph(
                f'Flagged answers: {rnd.get("flagged_count", 0)}',
                body_style
            ))
            story.append(Spacer(1, 4*mm))

    # ── Footer ─────────────────────────────────────────────
    story.append(Spacer(1, 8*mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=GRAY))
    story.append(Paragraph(
        "This report was generated by Attestr. The cryptographic proof summary above can be "
        "independently verified using the accompanying .tessera bundle file without any "
        "dependency on the Attestr platform.",
        ParagraphStyle("Footer", parent=styles["Normal"],
            fontSize=7.5, textColor=GRAY, spaceAfter=4)
    ))

    doc.build(story)
    return buffer.getvalue()
