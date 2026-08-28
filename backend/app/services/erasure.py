"""Patient data erasure — Part 5.4.

THE DISTINCTION THIS MODULE EXISTS TO ENFORCE:

  CLINICAL MEASUREMENTS ARE DELETED.  Sessions, module features, baselines, deviations,
  scores, alerts, questionnaires, vitals, adherence, wearable readings, fall events, and
  everything Awaaz stored. Really deleted — rows gone, not flagged.

  AUDIT RECORDS ARE RETAINED.  Who accessed this patient's data and when is append-only
  (INV-8) and survives the erasure. It is the record that makes the erasure itself
  accountable, and destroying it would mean a deployment could not answer "who saw this
  person's data before it was removed" — which is exactly the question an erasure request
  tends to come attached to.

WHY THE PATIENT ROW SURVIVES AS A TOMBSTONE. `audit_log.patient_id` carries
`ondelete="CASCADE"` — verified by probing a real database, not assumed. Deleting the
`patients` row therefore destroys the audit trail along with it. So erasure strips the row
instead of removing it: name, age, sex, stroke details, languages, the face-identity vector
and all calibration are cleared, `erased_at` is stamped, and what remains identifies nobody
while keeping every audit row's linkage intact.

Consent history is retained for the same reason as audit and with the same reasoning: a
record that someone granted and later withdrew consent is evidence about a decision, not
clinical data about a body. It carries no measurement.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    Adherence,
    Alert,
    AuditLog,
    AwaazProfile,
    Baseline,
    BaselineReview,
    Deviation,
    ExamSession,
    FallEvent,
    ModuleResult,
    Patient,
    PatientClinicianLink,
    PhraseCard,
    Questionnaire,
    SafetyEvent,
    Score,
    StrokeSide,
    UtteranceLog,
    Vital,
    VoiceSample,
    WearableData,
)

#: Tables holding a clinical measurement or patient-generated content, keyed directly on
#: `patient_id`. Ordered children-before-parents so a deployment with foreign keys actually
#: enforced does not trip a constraint mid-erasure.
_PATIENT_SCOPED = (
    Alert,
    Score,
    Baseline,
    BaselineReview,
    Questionnaire,
    Vital,
    Adherence,
    SafetyEvent,
    WearableData,
    FallEvent,
    UtteranceLog,
    PhraseCard,
    VoiceSample,
    AwaazProfile,
)

#: These hang off a SESSION, not off the patient, so they need the join. Verified against
#: the models rather than assumed from the naming: `Deviation` and `ModuleResult` both key
#: on `session_id` only, and a `patient_id`-based delete would silently remove nothing.
_SESSION_SCOPED = (Deviation, ModuleResult)


async def erase_patient_data(
    db: AsyncSession, patient: Patient, actor_id: uuid.UUID, reason: str | None = None,
) -> dict[str, int]:
    """Delete every clinical measurement for this patient; retain the audit trail.

    Returns a per-table count of what was removed, so the caller can report it and so the
    audit entry records the actual scope of the erasure rather than asserting it happened.
    """
    removed: dict[str, int] = {}

    session_ids = list(await db.scalars(
        select(ExamSession.id).where(ExamSession.patient_id == patient.id)
    ))
    for model in _SESSION_SCOPED:
        removed[model.__tablename__] = 0
        if session_ids:
            result = await db.execute(
                delete(model).where(model.session_id.in_(session_ids))
            )
            removed[model.__tablename__] = int(result.rowcount or 0)

    for model in _PATIENT_SCOPED:
        result = await db.execute(
            delete(model).where(model.patient_id == patient.id)
        )
        removed[model.__tablename__] = int(result.rowcount or 0)

    # Sessions last: everything hanging off them is gone by now.
    result = await db.execute(
        delete(ExamSession).where(ExamSession.patient_id == patient.id)
    )
    removed["sessions"] = int(result.rowcount or 0)

    # Clinician links are revoked rather than deleted — the same INV-8 reasoning as the
    # audit trail. Who could see this patient, and until when, stays recoverable.
    now = datetime.now(timezone.utc)
    links = list(await db.scalars(
        select(PatientClinicianLink).where(
            PatientClinicianLink.patient_id == patient.id,
            PatientClinicianLink.unlinked_at.is_(None),
        )
    ))
    for link in links:
        link.unlinked_at = now
        link.unlinked_by = actor_id
        link.unlink_reason = "patient data erased"
    removed["clinician_links_revoked"] = len(links)

    # --- the tombstone ---
    patient.name = ""
    patient.age = None
    patient.sex = None
    patient.stroke_date = None
    # NOT NULL with an `unknown` default — so it is reset to `unknown`, not nulled. That is
    # also the more honest value: after erasure we genuinely do not know which side.
    patient.stroke_side = StrokeSide.unknown
    patient.languages = []
    patient.education_band = None
    patient.pd_diagnosis = False
    patient.other_movement_disorder = False       # NOT NULL — reset, not nulled
    patient.aphasia_mode = False
    patient.consent_version = None
    patient.consent_lang = None
    # Clears device calibration AND the face-identity enrolment vector that shares the
    # column — the one piece of stored data derived from the patient's body.
    patient.calibration_json = None
    patient.onboarding_complete = False
    patient.asha_worker_id = None
    patient.clinician_id = None
    patient.user_id = None
    patient.erased_at = now
    patient.erasure_reason = (reason or "").strip()[:200] or None

    db.add(AuditLog(
        actor_id=actor_id,
        action="patient.erased",
        patient_id=patient.id,
        meta_json={"removed": removed, "reason": patient.erasure_reason},
    ))
    await db.flush()
    return removed


async def audit_rows_for(db: AsyncSession, patient_id: uuid.UUID) -> int:
    """Count of retained audit entries. Exists so a test can assert retention directly
    rather than inferring it."""
    rows = list(await db.scalars(
        select(AuditLog.id).where(AuditLog.patient_id == patient_id)
    ))
    return len(rows)
