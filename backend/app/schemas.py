"""Pydantic v2 request/response models — one group per TRD §3 table and §9 endpoint."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from .models import (
    Band, BaselineState, DeploymentTier, Instrument, Role, SessionType, StrokeSide,
    WearableMetric,
)

ORM = ConfigDict(from_attributes=True)
Lang = Field(default="en", pattern="^(en|hi|pa)$")


# --------------------------------------------------------------------------- auth
class UserBase(BaseModel):
    email: EmailStr
    role: Role = Role.caregiver
    full_name: str | None = Field(default=None, max_length=120)
    lang: str = Lang


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserRead(UserBase):
    model_config = ORM
    id: uuid.UUID
    created_at: datetime


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class RefreshRequest(BaseModel):
    refresh_token: str


class AuthResponse(BaseModel):
    user: UserRead
    tokens: TokenPair


# --------------------------------------------------------------------------- patients
class PatientBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    age: int | None = Field(default=None, ge=0, le=130)
    sex: str | None = Field(default=None, max_length=16)
    stroke_side: StrokeSide = StrokeSide.unknown
    languages: list[str] = Field(default_factory=lambda: ["en"])
    preferred_hour: float | None = Field(default=None, ge=0, le=23.99)
    education_band: str | None = Field(default=None, max_length=24)
    # PRD §3 exclusions - see Patient.pd_diagnosis for why these block enrolment.
    pd_diagnosis: bool = False
    other_movement_disorder: bool = False


class PatientCreate(PatientBase):
    # PRD §3 locks enrolment to >= 3 months post-stroke; this is what proves it.
    stroke_date: datetime
    user_id: uuid.UUID | None = None
    clinician_id: uuid.UUID | None = None


class PatientUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    intensity: str | None = Field(default=None, pattern="^(FULL|STANDARD|LIGHT|RESEARCH)$")
    aphasia_mode: bool | None = None
    consent_version: str | None = Field(default=None, max_length=16)
    consent_lang: str | None = Field(default=None, max_length=8)
    calibration_json: dict | None = None
    onboarding_complete: bool | None = None
    age: int | None = Field(default=None, ge=0, le=130)
    sex: str | None = Field(default=None, max_length=16)
    languages: list[str] | None = None
    preferred_hour: float | None = Field(default=None, ge=0, le=23.99)
    education_band: str | None = Field(default=None, max_length=24)
    clinician_id: uuid.UUID | None = None


class PatientRead(PatientBase):
    model_config = ORM
    id: uuid.UUID
    caregiver_id: uuid.UUID
    clinician_id: uuid.UUID | None
    user_id: uuid.UUID | None
    stroke_date: datetime | None
    enrolment_date: datetime
    baseline_state: BaselineState
    created_at: datetime
    intensity: str = "FULL"
    aphasia_mode: bool = False
    consent_version: str | None = None
    onboarding_complete: bool = False


# --------------------------------------------------------------------------- sessions
class ProvisionUser(BaseModel):
    """An admin minting a privileged account. Not reachable from /auth/register."""

    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: Role
    full_name: str | None = Field(default=None, max_length=120)


class IdentitySignatureSave(BaseModel):
    """The on-device enrolment vector: ratios and spreads, never an image."""

    signature: dict


class SessionStart(BaseModel):
    type: SessionType = SessionType.daily
    device_info: dict | None = None
    offline_captured: bool = False
    is_practice: bool = False
    # The same-person check runs on the device; the server only records its verdict.
    # `identity_verified=False` flags the session as a confounder — it never rejects it.
    # Omitted (the default) means "not checked", which is stored as verified: an
    # unenrolled patient must not read to a clinician as a failed identity check.
    identity_score: float | None = Field(default=None, ge=0.0, le=1.0)
    identity_verified: bool = True


class ModuleSubmit(BaseModel):
    """Features — or raw landmark-derived POINTS for modules with a server extractor.

    `raw` is numbers only: gaze coordinates, head positions, per-frame scalars already
    computed from landmarks on the device. It is never audio, video or an image — INV-1 is
    about media, and the raw-media invariant test enforces that no endpoint accepts a blob.
    Sending points for M3/M9 lets the server run the SAME extractors the test suite pins,
    instead of a JavaScript re-implementation drifting away from them.
    """
    features: dict[str, float | str | list | None] = {}
    raw: dict | None = None
    quality_flag: bool = True
    quality_detail: dict | None = None
    extracted_on_device: bool = True
    # Fatigue instrumentation (migration 0008). Position on the fatigue curve is part of
    # every measurement; these make an intensity change or a pause visible to the engine.
    session_position: int | None = Field(default=None, ge=1, le=64)
    elapsed_seconds_at_task_start: float | None = Field(default=None, ge=0)
    intensity: str | None = Field(default=None, pattern="^(full|standard|light|research)$")
    paused_before_task: bool = False


class SessionRead(BaseModel):
    model_config = ORM
    id: uuid.UUID
    patient_id: uuid.UUID
    ts: datetime
    type: SessionType
    quality_score: float
    identity_verified: bool
    off_window: bool
    completed: bool
    offline_captured: bool


class ModuleResultRead(BaseModel):
    model_config = ORM
    id: uuid.UUID
    session_id: uuid.UUID
    module_code: str
    domain: str
    features_json: dict
    quality_flag: bool
    created_at: datetime
    session_position: int | None = None
    elapsed_seconds_at_task_start: float | None = None
    intensity: str | None = None
    paused_before_task: bool = False


class SessionFinalizeResponse(BaseModel):
    """TRD §9: what POST /sessions/{sid}/finalize returns."""
    session_id: uuid.UUID
    patient_id: uuid.UUID
    band: Band
    reason: str
    gate1_passed: bool
    gate2_passed: bool
    gate3_passed: bool = False
    persistent_domains: list[str]
    lateralised_domains: list[str] = Field(default_factory=list)
    symmetric_pattern: bool = False
    domain_deviations: dict[str, float]
    lateral_deviations: dict[str, float] = Field(default_factory=dict)
    #: Deviation from the FROZEN reference baseline — cumulative distance from the normal
    #: this patient established, which an adaptive baseline cannot see.
    cumulative_drift: float = 0.0
    cumulative_drift_by_domain: dict[str, float] = Field(default_factory=dict)
    drift_flagged: bool = False
    drivers: list[list]
    confounders: dict
    confidence: float
    improving: bool
    sustained_sessions: int = 0
    baseline_phase: bool
    baseline_state: str
    explanation_en: str
    explanation_hi: str
    explanation_source: str
    guardrail_violations: list[str] = Field(default_factory=list)
    clinician_line: str
    alert_id: uuid.UUID | None = None
    # The safety layer attaches this to EVERY finalize response (TRD §8).
    fast: dict = Field(default_factory=dict)


# --------------------------------------------------------------------------- scoring
class BaselineRead(BaseModel):
    model_config = ORM
    id: uuid.UUID
    patient_id: uuid.UUID
    module_code: str
    median_json: dict
    mad_json: dict
    n_sessions: int
    n_rejected: int
    n_discarded: int
    locked: bool
    reason: str | None
    window_start: datetime | None
    window_end: datetime | None
    updated_at: datetime


class DeviationRead(BaseModel):
    model_config = ORM
    id: uuid.UUID
    session_id: uuid.UUID
    module_code: str
    domain: str
    mean_abs_z: float
    max_abs_z: float
    cusum_stat: float
    cusum_alarm: bool
    improving: bool
    flagged: bool


class ScoreRead(BaseModel):
    model_config = ORM
    id: uuid.UUID
    patient_id: uuid.UUID
    session_id: uuid.UUID
    domain_devs_json: dict
    band: Band
    gate1_passed: bool
    gate2_passed: bool
    gate3_passed: bool
    persistent_domains: list | None
    lateralised_domains: list | None
    symmetric_pattern: bool
    drivers_json: list | None
    confounders_json: dict | None
    confidence: float
    improving: bool
    reason: str | None
    baseline_phase: bool
    explanation_en: str | None
    explanation_hi: str | None
    explanation_source: str
    created_at: datetime


class AlertRead(BaseModel):
    model_config = ORM
    id: uuid.UUID
    patient_id: uuid.UUID
    score_id: uuid.UUID
    band: Band
    drivers_json: list | None
    confounders_json: dict | None
    explanation_en: str
    explanation_hi: str | None
    clinician_line: str | None
    acknowledged_by: uuid.UUID | None
    acknowledged_at: datetime | None
    created_at: datetime


# --------------------------------------------------------------------------- domain F/G
class QuestionnaireSubmit(BaseModel):
    instrument: Instrument
    responses: list[int] | dict[str, int]
    session_id: uuid.UUID | None = None


class QuestionnaireRead(BaseModel):
    model_config = ORM
    id: uuid.UUID
    patient_id: uuid.UUID
    instrument: Instrument
    score: float
    flags_json: dict | None
    ts: datetime


class VitalSubmit(BaseModel):
    bp_sys: int | None = Field(default=None, ge=50, le=300)
    bp_dia: int | None = Field(default=None, ge=30, le=200)
    ppg_features: dict | None = None
    session_id: uuid.UUID | None = None


class VitalRead(BaseModel):
    model_config = ORM
    id: uuid.UUID
    patient_id: uuid.UUID
    bp_sys: int | None
    bp_dia: int | None
    rhythm_flag: bool
    ts: datetime


class AdherenceSubmit(BaseModel):
    taken: bool


class AdherenceRead(BaseModel):
    model_config = ORM
    id: uuid.UUID
    patient_id: uuid.UUID
    taken: bool
    ts: datetime


# --------------------------------------------------------------------------- safety
class AcuteReport(BaseModel):
    symptoms: list[str] = Field(min_length=1)
    note: str | None = Field(default=None, max_length=2000)
    lang: str = Lang


class AcuteResponse(BaseModel):
    escalate: bool
    scoring_bypassed: bool
    reported: list[str]
    reported_labels: list[str]
    message: str
    fast: dict
    emergency_number: str


# --------------------------------------------------------------------------- dashboards
class TrendPoint(BaseModel):
    date: datetime
    session_id: uuid.UUID
    band: Band
    domain_devs: dict[str, float]
    confidence: float
    baseline_phase: bool
    #: The long-term lane. `domain_devs` is measured against the adaptive baseline and
    #: answers "is today unlike recently"; this is measured against the frozen reference
    #: and answers "how far from their established normal are they now". Plotted separately
    #: because a flat band line above a rising drift line is the whole point.
    cumulative_drift: float = 0.0
    drift_flagged: bool = False


class HistoryRow(BaseModel):
    date: datetime
    band: Band
    reason: str | None
    explanation_en: str | None
    explanation_hi: str | None
    confidence: float
    baseline_phase: bool
    confounders: list[str] = Field(default_factory=list)


class BaselineProgress(BaseModel):
    state: BaselineState
    modules_locked: int
    modules_total: int
    min_sessions: int
    required_sessions: int
    window_min_days: int
    window_max_days: int


class DashboardResponse(BaseModel):
    patient: PatientRead
    baseline: BaselineProgress
    latest: ScoreRead | None
    trends: list[TrendPoint]
    history: list[HistoryRow]
    alerts: list[AlertRead]
    adherence_streak: int
    adherence_rate_30d: float
    latest_questionnaires: list[QuestionnaireRead]
    dev_threshold: float
    # TRD §8: the FAST card renders on every dashboard, not only when the band is high.
    fast: dict


class ClinicPatientRow(BaseModel):
    patient_id: uuid.UUID
    name: str
    age: int | None
    band: Band | None
    sustained_domains: list[str]
    #: Which of those domains showed a genuinely ONE-SIDED change. An alert with an empty
    #: list here would be a focal claim with no focal evidence behind it.
    lateralised_domains: list[str] = Field(default_factory=list)
    confidence: float
    last_session: datetime | None
    unacknowledged_alerts: int
    baseline_state: BaselineState
    #: How this row should render. TRD §6 requires the atypical pattern to be a DISTINCT
    #: card, not a deviation alert - it is a prompt to think about a different diagnosis,
    #: and dressing it up as a stroke finding would defeat the point of detecting it.
    #:   "deviation"        - a focal finding: ALERT or WATCH
    #:   "atypical_pattern" - symmetric progressive change; consider non-vascular causes
    #:   "routine"          - stable, or still building a baseline
    #: Long-term distance from the normal established at baseline lock, measured against
    #: the FROZEN reference. Displayed as its own trend lane, because it answers a
    #: different question from the day-to-day band and can move while that stays quiet.
    cumulative_drift: float = 0.0
    drift_flagged: bool = False
    card_type: Literal["deviation", "atypical_pattern", "routine", "cumulative_drift"] = "routine"
    #: One line of context for the atypical card. None for every other card type.
    card_note: str | None = None


class ClinicListResponse(BaseModel):
    patients: list[ClinicPatientRow]


class AuditRow(BaseModel):
    model_config = ORM
    id: uuid.UUID
    actor_id: uuid.UUID | None
    action: str
    patient_id: uuid.UUID | None
    meta_json: dict | None
    ts: datetime


# --------------------------------------------------------------------------- misc
class HealthResponse(BaseModel):
    status: str
    app: str
    version: str
    env: str
    database: str


class MessageResponse(BaseModel):
    detail: str


# --------------------------------------------------------------------------- wearables
class WearableReading(BaseModel):
    metric: WearableMetric
    value: float
    unit: str | None = Field(default=None, max_length=24)
    ts: datetime


class WearableBatch(BaseModel):
    """A watch syncs when it can, not when a reading happens, so ingestion is batched."""

    source: str = Field(max_length=64)
    device_id: str | None = Field(default=None, max_length=128)
    readings: list[WearableReading] = Field(min_length=1, max_length=5000)


class WearableSummary(BaseModel):
    stored: int
    skipped_too_old: int
    source: str
    #: Restated on every response so an integrator cannot miss where the claim sits.
    claim_notice: str


class FallReport(BaseModel):
    source: str = Field(max_length=64)
    ts: datetime
    device_id: str | None = Field(default=None, max_length=128)
    #: The DEVICE's confidence, passed through unchanged. Never our estimate.
    device_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    dismissed_by_patient: bool = False


class FallEventRead(BaseModel):
    id: uuid.UUID
    patient_id: uuid.UUID
    ts: datetime
    source: str
    dismissed_by_patient: bool
    #: Always True. A fall never enters the deviation engine — see routers/wearable.py.
    scoring_bypassed: bool
    caregiver_notified: bool
    acknowledged: bool = False
    message: str
    claim_notice: str


# --------------------------------------------------------------------------- ASHA
class AshaHousehold(BaseModel):
    patient_id: uuid.UUID
    name: str
    age: int | None
    village: str | None = None
    deployment_tier: DeploymentTier
    last_session: datetime | None
    last_visit: datetime | None
    #: Modules this visit should cover that the patient's own phone cannot fully run.
    due_modules: list[str] = Field(default_factory=list)
    #: Which TASKS within each of those, so a worker repeats nothing the family already
    #: did. M9 in particular is now partly phone-runnable, so "do M9" would be wrong.
    due_tasks: dict[str, list[str]] = Field(default_factory=dict)


class AshaHouseholdList(BaseModel):
    households: list[AshaHousehold]
    total: int


class AshaSessionSubmit(BaseModel):
    """One patient's assessment from an ASHA visit.

    `client_visit_id` is the worker's device-side id. An ASHA worker is offline for most of
    a round and uploads when they find signal, so a retried upload must update the same
    visit rather than create a second one.
    """

    patient_id: uuid.UUID
    client_visit_id: str = Field(max_length=64)
    ts: datetime
    device_id: str | None = Field(default=None, max_length=128)
    notes: str | None = Field(default=None, max_length=512)
    #: module_code -> extracted features, exactly as the daily path posts them.
    modules: dict[str, dict[str, float]] = Field(default_factory=dict)


class AshaSessionResult(BaseModel):
    visit_id: uuid.UUID
    patient_id: uuid.UUID
    session_id: uuid.UUID | None
    modules_stored: list[str]
    modules_rejected: list[str]
    created: bool
    detail: str


# --------------------------------------------------------------------------- Awaaz
class AwaazProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    patient_id: uuid.UUID
    speech_profile: str
    auto_speak_enabled: bool
    auto_speak_threshold: float
    voice_status: str
    endpoint_silence_seconds: float


class AwaazProfileUpdate(BaseModel):
    speech_profile: str | None = None
    auto_speak_enabled: bool | None = None
    auto_speak_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    #: Capped server-side at 4s. Default VAD cuts dysarthric speakers off mid-sentence.
    endpoint_silence_seconds: float | None = Field(default=None, ge=0.5, le=4.0)


class AwaazCardRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    text: str
    lang: str
    icon: str | None
    category: str
    slot: int
    use_count: int
    is_emergency: bool


class AwaazCardCreate(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    lang: str | None = Field(default=None, pattern="^(en|hi|pa)$")
    icon: str | None = Field(default=None, max_length=32)
    category: str = Field(default="general", max_length=32)
    #: Omitted means append after the existing board. Explicit positions remain available
    #: for an eventual reorder UI without making every new phrase jump to the first slot.
    slot: int | None = Field(default=None, ge=0, le=1_000)


class AwaazBoard(BaseModel):
    patient_id: uuid.UUID
    profile: AwaazProfileRead
    cards: list[AwaazCardRead]


class AwaazSpeakRequest(BaseModel):
    """A tapped card, or recognised free speech.

    A card is always spoken — the patient chose those exact words. Free speech goes through
    the auto-speak gate.
    """

    card_id: uuid.UUID | None = None
    text: str | None = Field(default=None, max_length=500)
    candidates: list[str] = Field(default_factory=list, max_length=8)
    lang: str = Field(default="en", max_length=8)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    #: True only after the person taps one of the offered candidates. This is distinct from
    #: a model returning the same text twice: the tap is the consent event that makes it safe
    #: to speak and the audit fact INV-9 needs to retain.
    confirmed_candidate: bool = False
    #: A UUID naming a WAV kept in the browser's private IndexedDB vault. Only metadata
    #: crosses this API; raw media remains on device under INV-1.
    audio_capture_id: uuid.UUID | None = None
    audio_duration_seconds: float | None = Field(default=None, ge=0.25, le=30.0)
    audio_sha256: str | None = Field(default=None, pattern="^[0-9a-f]{64}$")
    audio_size_bytes: int | None = Field(default=None, ge=44, le=1_100_000)
    #: Must be explicitly true when an audio capture is registered. The authenticated user
    #: becomes the consent actor retained beside the receipt.
    audio_capture_consent: bool = False


class AwaazSpeakResult(BaseModel):
    patient_id: uuid.UUID
    #: None on the confirmation path — nothing has been decided yet, so nothing is returned
    #: as though it had been.
    text: str | None
    lang: str
    mode: str
    speak_now: bool
    candidates: list[str]
    reason: str
    requires_confirmation: bool
    utterance_id: uuid.UUID | None = None
    #: True means a labelled audio receipt was registered; it never means audio was uploaded.
    audio_pair_registered: bool = False


class AwaazReviewLabelRequest(BaseModel):
    """A caregiver-verified label, optionally paired with a local patient repeat.

    The WAV never enters this schema. If a local receipt is supplied, all integrity and
    consent metadata is required together so a partial request cannot become a training
    pair by accident.
    """

    corrected_text: str = Field(min_length=1, max_length=500)
    audio_capture_id: uuid.UUID | None = None
    audio_duration_seconds: float | None = Field(default=None, ge=0.25, le=30.0)
    audio_sha256: str | None = Field(default=None, pattern="^[0-9a-f]{64}$")
    audio_size_bytes: int | None = Field(default=None, ge=44, le=1_100_000)
    audio_capture_consent: bool = False

    @model_validator(mode="after")
    def local_audio_receipt_is_complete_and_consented(self):
        receipt_values = (
            self.audio_capture_id,
            self.audio_duration_seconds,
            self.audio_sha256,
            self.audio_size_bytes,
        )
        has_any_receipt = any(value is not None for value in receipt_values)
        if has_any_receipt and not all(value is not None for value in receipt_values):
            raise ValueError("local audio receipt metadata must be provided together")
        if has_any_receipt and not self.audio_capture_consent:
            raise ValueError("explicit consent is required for a local audio receipt")
        if self.audio_capture_consent and not has_any_receipt:
            raise ValueError("audio_capture_consent requires a complete local audio receipt")
        return self


class AwaazEmergencyResult(BaseModel):
    patient_id: uuid.UUID
    spoken_text: str
    lang: str
    location: dict | None
    #: True only after a delivery provider accepts the caregiver notification.
    caregiver_notified: bool
    #: True only when a pre-rendered phrase is available without network access.
    works_offline: bool
    #: Always False. A person in crisis is the least intelligible they will ever be.
    used_speech_recognition: bool
    message: str


class AwaazEmergencyRequest(BaseModel):
    event_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    #: Set by the client only after a patient-specific local WAV starts playing. This is a
    #: playback receipt, not a claim that the server itself can provide offline speech.
    offline_audio_played: bool = False
    location_consent: bool = False
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    location_accuracy_m: float | None = Field(default=None, ge=0, le=100_000)

    @model_validator(mode="after")
    def location_is_complete_and_consented(self):
        if (self.lat is None) != (self.lon is None):
            raise ValueError("lat and lon must be provided together")
        if (self.lat is not None or self.location_accuracy_m is not None) \
                and not self.location_consent:
            raise ValueError("location_consent must be true when location is provided")
        return self
