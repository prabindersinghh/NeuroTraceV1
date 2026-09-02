"""Deprecated unconfigured WhatsApp boundary.

This module used to log a message and return ``True`` without calling a provider. Nothing
currently imports it, but leaving a mock-success function is a trap for the next caller.
Real Awaaz delivery lives in ``emergency_notifications`` and is configured-only.
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
        "whatsapp.unconfigured patient_id=%s band=%s chars=%d", patient_id, band, len(message)
    )
    return False
