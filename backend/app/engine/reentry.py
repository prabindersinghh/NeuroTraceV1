"""When a clinician is brought back after the baseline locks — Part 3.5.

An explicit, ordered list rather than behaviour scattered across the pipeline. The point of
writing it as data is that "when does the doctor get involved again?" has one answer a
person can read, and adding a trigger is a visible edit to this list rather than a new
`if` somewhere in scoring.

Ordered by urgency, because the caller surfaces the first match as the headline reason.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class ReentryTrigger(str, Enum):
    """Why a clinician is being asked to look again."""

    #: The engine raised an ALERT: persistent, cross-modal, lateralised change.
    ALERT_BAND = "ALERT_BAND"
    #: Symmetric progressive change with no side — points at a different referral
    #: entirely, so it needs a clinician precisely because it is NOT our alert.
    PATTERN_ATYPICAL = "PATTERN_ATYPICAL"
    #: A new clinical event was reported. The patient's normal may have moved.
    CLINICAL_EVENT = "CLINICAL_EVENT"
    #: The caregiver asked for a review. A family's concern is a valid trigger on its own
    #: and does not need to be corroborated by a number first.
    CAREGIVER_CONCERN = "CAREGIVER_CONCERN"
    #: Too few sessions to keep saying anything meaningful about the trend.
    LOW_ADHERENCE = "LOW_ADHERENCE"
    #: The scheduled look, so a stable patient is not simply forgotten.
    PERIODIC_REVIEW = "PERIODIC_REVIEW"


@dataclass(frozen=True, slots=True)
class ReentryReason:
    trigger: ReentryTrigger
    detail: str
    #: Lower sorts first. Not a clinical severity score — an ordering for the queue.
    urgency: int


#: Adherence below this over the review window brings a clinician back.
ADHERENCE_FLOOR = 0.5

#: A locked, quiet patient still gets looked at this often.
PERIODIC_REVIEW_DAYS = 90


def evaluate_reentry(
    *,
    band: str | None,
    adherence: float | None,
    days_since_last_review: int | None,
    caregiver_concern: bool = False,
    clinical_event: bool = False,
) -> list[ReentryReason]:
    """Every reason this patient is owed a clinician's attention, most urgent first.

    Returns ALL matching reasons rather than the first: a patient who is both alerting and
    non-adherent is a different conversation from one who is only alerting, and a caller
    that only saw the headline would lose that.
    """
    reasons: list[ReentryReason] = []

    if band == "ALERT":
        reasons.append(ReentryReason(
            ReentryTrigger.ALERT_BAND,
            "Persistent, cross-modal, lateralised change reached the ALERT band.", 0,
        ))
    if band == "PATTERN_ATYPICAL":
        reasons.append(ReentryReason(
            ReentryTrigger.PATTERN_ATYPICAL,
            "Symmetric progressive change with no lateralised finding — not a "
            "stroke-monitoring alert, and points at a different referral.", 1,
        ))
    if clinical_event:
        reasons.append(ReentryReason(
            ReentryTrigger.CLINICAL_EVENT,
            "A new clinical event was reported; this patient's normal may have moved.", 1,
        ))
    if caregiver_concern:
        reasons.append(ReentryReason(
            ReentryTrigger.CAREGIVER_CONCERN,
            "The caregiver asked for a review.", 2,
        ))
    if adherence is not None and adherence < ADHERENCE_FLOOR:
        reasons.append(ReentryReason(
            ReentryTrigger.LOW_ADHERENCE,
            f"Adherence {adherence:.0%} is below {ADHERENCE_FLOOR:.0%}; the trend is "
            "based on too few sessions to carry weight.", 3,
        ))
    if days_since_last_review is not None and days_since_last_review >= PERIODIC_REVIEW_DAYS:
        reasons.append(ReentryReason(
            ReentryTrigger.PERIODIC_REVIEW,
            f"{days_since_last_review} days since the last clinician review.", 4,
        ))

    return sorted(reasons, key=lambda r: r.urgency)
