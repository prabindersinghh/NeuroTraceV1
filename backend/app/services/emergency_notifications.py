"""Configured-only caregiver delivery for deliberate Awaaz emergency activations.

No mock success path exists here. An unconfigured deployment returns ``accepted=False``;
configured SMTP reports success only after the recipient is accepted by the server. The
recipient, patient name, message body, and coordinates are never written to logs.
"""
from __future__ import annotations

import asyncio
import logging
import smtplib
import ssl
import uuid
from dataclasses import dataclass
from email.message import EmailMessage

from ..config import settings

logger = logging.getLogger("neurotrace.emergency_delivery")


@dataclass(frozen=True)
class EmergencySmtpConfig:
    host: str
    port: int
    from_email: str
    security: str = "starttls"
    username: str | None = None
    password: str | None = None
    timeout_seconds: float = 5.0


@dataclass(frozen=True)
class EmergencyDelivery:
    accepted: bool
    provider: str
    detail: str


def smtp_config() -> EmergencySmtpConfig | None:
    host = (settings.emergency_smtp_host or "").strip()
    from_email = (settings.emergency_smtp_from or "").strip()
    if not host or not from_email:
        return None
    return EmergencySmtpConfig(
        host=host,
        port=settings.emergency_smtp_port,
        from_email=from_email,
        security=settings.emergency_smtp_security,
        username=(settings.emergency_smtp_username or "").strip() or None,
        password=settings.emergency_smtp_password,
        timeout_seconds=settings.emergency_smtp_timeout_seconds,
    )


def _message(
    *, from_email: str, recipient: str, patient_name: str, lang: str, event_id: uuid.UUID,
    location: dict[str, float] | None,
) -> EmailMessage:
    copy = {
        "hi": (
            "आवाज़ आपातकालीन अलर्ट",
            f"{patient_name} के डिवाइस पर मदद का बटन दबाया गया है। अभी उनसे संपर्क करें।",
            "स्थान",
            "अगर तत्काल खतरा हो सकता है, तो 108 या स्थानीय आपातकालीन सेवा को कॉल करें।",
        ),
        "pa": (
            "ਆਵਾਜ਼ ਐਮਰਜੈਂਸੀ ਅਲਰਟ",
            f"{patient_name} ਦੇ ਡਿਵਾਈਸ 'ਤੇ ਮਦਦ ਵਾਲਾ ਬਟਨ ਦਬਾਇਆ ਗਿਆ ਹੈ। ਹੁਣੇ ਸੰਪਰਕ ਕਰੋ।",
            "ਟਿਕਾਣਾ",
            "ਜੇ ਤੁਰੰਤ ਖ਼ਤਰਾ ਹੋ ਸਕਦਾ ਹੈ ਤਾਂ 108 ਜਾਂ ਸਥਾਨਕ ਐਮਰਜੈਂਸੀ ਸੇਵਾ ਨੂੰ ਕਾਲ ਕਰੋ।",
        ),
    }
    subject, body, location_label, emergency_line = copy.get(lang, (
        "Awaaz emergency alert",
        f"The help control was activated on {patient_name}'s device. Contact them now.",
        "Location",
        "If they may be in immediate danger, call 108 or local emergency services.",
    ))
    if location:
        body += (
            f"\n\n{location_label}: {location['lat']:.6f}, {location['lon']:.6f}"
            + (f" (accuracy about {location['accuracy_m']:.0f} m)"
               if location.get("accuracy_m") is not None else "")
        )
    body += f"\n\n{emergency_line}"

    message = EmailMessage()
    message["From"] = from_email
    message["To"] = recipient
    message["Subject"] = subject
    # A stable message id gives SMTP relays a correlation key if the same event is retried.
    message["Message-ID"] = f"<awaaz-{event_id}@neurotrace.local>"
    message.set_content(body)
    return message


def _send_smtp(
    config: EmergencySmtpConfig,
    *, recipient: str,
    patient_name: str,
    lang: str,
    event_id: uuid.UUID,
    location: dict[str, float] | None,
) -> bool:
    message = _message(
        from_email=config.from_email,
        recipient=recipient,
        patient_name=patient_name,
        lang=lang,
        event_id=event_id,
        location=location,
    )
    client_type = smtplib.SMTP_SSL if config.security == "ssl" else smtplib.SMTP
    kwargs = {"host": config.host, "port": config.port, "timeout": config.timeout_seconds}
    if config.security == "ssl":
        kwargs["context"] = ssl.create_default_context()
    with client_type(**kwargs) as client:
        if config.security == "starttls":
            client.ehlo()
            client.starttls(context=ssl.create_default_context())
            client.ehlo()
        if config.username:
            client.login(config.username, config.password or "")
        refused = client.send_message(message)
    return recipient not in refused


async def deliver_emergency(
    *, recipient: str, patient_name: str, lang: str, event_id: uuid.UUID,
    location: dict[str, float] | None,
    config: EmergencySmtpConfig | None = None,
) -> EmergencyDelivery:
    config = config or smtp_config()
    if config is None:
        return EmergencyDelivery(False, "unconfigured", "No delivery provider is configured")
    try:
        accepted = await asyncio.to_thread(
            _send_smtp,
            config,
            recipient=recipient,
            patient_name=patient_name,
            lang=lang,
            event_id=event_id,
            location=location,
        )
    except Exception:  # noqa: BLE001 - provider failures are a result, never a 500
        # SMTP exceptions can contain the refused recipient. Do not log the exception.
        logger.warning("emergency delivery failed event_id=%s provider=smtp", event_id)
        return EmergencyDelivery(False, "smtp", "The SMTP provider rejected the request")
    logger.info(
        "emergency delivery event_id=%s provider=smtp accepted=%s", event_id, accepted,
    )
    return EmergencyDelivery(accepted, "smtp", "Accepted by SMTP" if accepted else "Recipient refused")
