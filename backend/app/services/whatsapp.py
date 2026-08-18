"""Mock WhatsApp sender (TRD §2 / PRD non-goal: real integration is Tier 2).

It is a real function with real behaviour — it logs a structured, PII-free record of the
notification and reports success — it just does not call a provider yet. Swapping in the
Cloud API later means replacing the body of `send_alert`, nothing else.
"""
from __future__ import annotations

import logging
import uuid

logger = logging.getLogger("neurotrace.whatsapp")


def send_alert(patient_id: uuid.UUID, band: str, message: str) -> bool:
    """Return True when the notification was accepted for delivery.

    No PII in logs (TRD §7): the patient is identified by id, and the caregiver's number
    is never logged. The explanation text is medical-adjacent but not identifying.
    """
    logger.warning(
        "whatsapp.alert patient_id=%s band=%s chars=%d", patient_id, band, len(message)
    )
    logger.info("whatsapp.alert.body patient_id=%s body=%r", patient_id, message)
    return True
