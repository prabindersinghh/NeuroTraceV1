from __future__ import annotations

import uuid

import pytest

from app.services import emergency_notifications as notifications
from app.services.emergency_notifications import EmergencySmtpConfig
from app.services.whatsapp import send_alert


@pytest.mark.asyncio
async def test_unconfigured_delivery_never_claims_success(monkeypatch):
    monkeypatch.setattr(notifications, "smtp_config", lambda: None)
    result = await notifications.deliver_emergency(
        recipient="caregiver@example.test",
        patient_name="Test Patient",
        lang="en",
        event_id=uuid.uuid4(),
        location=None,
    )
    assert result.accepted is False
    assert result.provider == "unconfigured"


@pytest.mark.asyncio
async def test_configured_delivery_is_true_only_after_smtp_accepts(monkeypatch):
    seen = {}

    def accept(config, **kwargs):
        seen.update(kwargs)
        return True

    monkeypatch.setattr(notifications, "_send_smtp", accept)
    config = EmergencySmtpConfig(
        host="smtp.example.test",
        port=587,
        from_email="alerts@example.test",
    )
    event_id = uuid.uuid4()
    result = await notifications.deliver_emergency(
        recipient="caregiver@example.test",
        patient_name="Test Patient",
        lang="pa",
        event_id=event_id,
        location={"lat": 30.9, "lon": 75.85, "accuracy_m": 20.0},
        config=config,
    )

    assert result.accepted is True
    assert result.provider == "smtp"
    assert seen["event_id"] == event_id
    assert seen["location"]["accuracy_m"] == 20.0


def test_email_has_a_stable_event_id_and_no_location_when_not_consented():
    event_id = uuid.uuid4()
    message = notifications._message(
        from_email="alerts@example.test",
        recipient="caregiver@example.test",
        patient_name="Test Patient",
        lang="en",
        event_id=event_id,
        location=None,
    )
    assert message["Message-ID"] == f"<awaaz-{event_id}@neurotrace.local>"
    assert "Location:" not in message.get_content()


def test_the_deprecated_whatsapp_stub_never_reports_mock_success():
    assert send_alert(uuid.uuid4(), "ALERT", "test") is False
