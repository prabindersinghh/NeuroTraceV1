"""Pydantic v2 request/response models — one group per TRD §3 table and §9 endpoint."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from .models import (
    Band, BaselineState, DeploymentTier, Instrument, MAX_POLICY_CANDIDATES,
    MIN_POLICY_CANDIDATES, PolicyEventOutcome, PolicyFeedbackActor, Role, SessionType,
    StrokeSide, WearableMetric,
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


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


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
    #: Overrides `PatientBase.name`'s `min_length=1`, and this is not cosmetic.
    #:
    #: `erase_patient_data` sets `name = ""` on the tombstone (Part 5.4) — deliberately,
    #: because the honest value after an erasure is nothing, not a fabricated placeholder.
    #: But every route that returns this schema then raised
    #: `string_too_short` on that row, so a SINGLE erasure made `GET /patients` return
    #: **500 for that caregiver's entire roster, permanently** — not just for the erased
    #: patient. `GET /patients/{id}` and every other `response_model=PatientRead` route
    #: failed the same way.
    #:
    #: The constraint is right for input and wrong for output: a read schema has to be able
    #: to represent what the database legitimately holds. `PatientCreate` and
    #: `PatientUpdate` still require a real name, so nothing can be created nameless.
    name: str = Field(max_length=120)
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
    #: Part 5.4. Non-NULL means this row is an erasure TOMBSTONE — every clinical
    #: measurement is gone and every identifying field has been cleared, including `name`,
    #: which is why it comes back as an empty string rather than anything readable.
    #:
    #: Exposed because `GET /patients` does not filter these out (and should not — the
    #: caregiver who requested the erasure is entitled to see that it happened, and the row
    #: really does still exist to keep `audit_log.patient_id` intact). Without this field a
    #: client cannot tell a tombstone from a live patient whose name failed to load, so the
    #: roster showed a blank, permanently broken-looking card with no explanation.
    erased_at: datetime | None = None


# --------------------------------------------------------------------------- sessions
class ClinicianProfileUpsert(BaseModel):
    """Part 3.1. `verification_status` is deliberately ABSENT — it is never client-set."""

    full_name: str = Field(min_length=1, max_length=160)
    qualification: str | None = Field(default=None, max_length=120)
    registration_number: str | None = Field(default=None, max_length=64)
    registering_authority: str | None = Field(default=None, max_length=160)
    specialty: str | None = Field(default=None, max_length=120)
    affiliation: str | None = Field(default=None, max_length=200)
    contact: str | None = Field(default=None, max_length=200)


class ClinicianProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    full_name: str
    qualification: str | None = None
    registration_number: str | None = None
    registering_authority: str | None = None
    specialty: str | None = None
    affiliation: str | None = None
    contact: str | None = None
    #: Always SELF_DECLARED. Rendered beside the registration number, everywhere.
    verification_status: str


class LinkCreate(BaseModel):
    patient_id: uuid.UUID
    clinician_id: uuid.UUID
    clinician_role: str = Field(pattern="^(TREATING_PHYSICIAN|CONSULTING_NEUROLOGIST|CLINICAL_REVIEWER)$")


class CaretakerLinkCreate(BaseModel):
    """Create a family account and link it. Owning caregiver only.

    `relationship` is required rather than optional: "who is this person to the patient" is
    the first thing anyone asks about an account with access, and OTHER exists so the answer
    is never forced to be wrong.
    """

    patient_id: uuid.UUID
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=120)
    relationship: str = Field(pattern="^(SON|DAUGHTER|SPOUSE|SIBLING|OTHER)$")


class CaretakerChannelCreate(BaseModel):
    """Where to reach a caretaker. `destination` is health-adjacent PII — see
    `models.CaretakerChannel` for the four rules that follow from that."""

    patient_id: uuid.UUID
    caretaker_id: uuid.UUID
    channel: str = Field(pattern="^(WHATSAPP|SMS|EMAIL)$")
    destination: str = Field(min_length=3, max_length=190)


class ConsentSet(BaseModel):
    """PUT body for one of the six consents (Part 4). `version` defaults to the current
    wording for that type when omitted — a caller only needs to pass it when it is agreeing
    to a specific, displayed version."""

    granted: bool
    version: str | None = Field(default=None, max_length=24)
    device_context: str | None = Field(default=None, max_length=256)


class BaselineReviewSubmit(BaseModel):
    """A note is required for EXTEND and FLAG_CONCERN — enforced in the service so the
    failure is a readable 400 rather than a constraint error."""

    action: str = Field(pattern="^(CONFIRM|EXTEND|FLAG_CONCERN)$")
    note: str | None = Field(default=None, max_length=2000)


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
    type: SessionType = SessionType.daily_pulse
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


class SessionAbandon(BaseModel):
    """The patient chose to stop part-way. Counts, so a caregiver can be told how far.

    No `reason` field. Asking a stroke survivor to justify stopping is the wrong prompt at
    the wrong moment, and a free-text field would be one more thing between them and the
    exit they already asked for.
    """
    steps_completed: int = Field(ge=0)
    steps_total: int = Field(ge=1)


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
    #: Present only on a session the patient exited. `{"at", "steps_completed",
    #: "steps_total"}`. Read from `device_info` rather than a column of its own — see the
    #: note on `abandon_session` for why that trade was made.
    abandoned: dict | None = None


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


# ------------------------------------------------------- Awaaz policy events (AWA-FR-014)
# `extra="forbid"` on both request models is load-bearing, not tidiness. The whole value of
# `awaaz_policy_events` is that it cannot hold a transcript; a permissive request model lets
# a well-meaning client post `{"candidate_id": ..., "text": "..."}`, and the field would then
# be sitting in the request log and one `model_dump()` away from the row. Rejecting unknown
# keys makes "no text crosses this boundary" checkable at the boundary.


class AwaazPolicyCandidate(BaseModel):
    """One already-screened option, as an opaque id and the ranker's score.

    The score is used to build the logging distribution and is then discarded: it is a
    property of the model, not of the patient, and persisting it would let a reader rebuild
    a per-utterance confidence trace beside the slate.
    """

    model_config = ConfigDict(extra="forbid")

    candidate_id: uuid.UUID
    score: float = Field(ge=0.0, le=1.0)


class AwaazPolicyDecisionRequest(BaseModel):
    """Ask the behaviour policy which candidate to show first, and at what probability.

    The server does the sampling. A client-reported propensity is not a propensity -- it is
    a number the estimator would divide by on trust, and nothing downstream could tell a
    mistaken one from an honest one.
    """

    model_config = ConfigDict(extra="forbid")

    #: Minted by the client when it rendered the slate, so a retry after a lost response is
    #: the same event rather than a second draw from the same decision.
    event_id: uuid.UUID
    candidates: list[AwaazPolicyCandidate] = Field(
        min_length=MIN_POLICY_CANDIDATES, max_length=MAX_POLICY_CANDIDATES)
    #: Must be true. Randomising a slate that may be spoken without confirmation would be
    #: exploration on a patient's mouth; see the router.
    requires_confirmation: bool = False
    #: PRD_AWAAZ.md §10.2 requires a separate consent record per purpose. Analytics logging
    #: is its own purpose and does not ride on the consent given for anything else.
    policy_logging_consent: bool = False

    @model_validator(mode="after")
    def slate_is_a_set(self):
        ids = [item.candidate_id for item in self.candidates]
        if len(set(ids)) != len(ids):
            raise ValueError("candidates must not repeat a candidate_id")
        return self


class AwaazPolicyDecision(BaseModel):
    """What to show, and the propensity that will be logged against it."""

    event_id: uuid.UUID
    behavior_policy_id: str
    #: Display order. Index 0 is the logged action.
    offered_candidate_ids: list[uuid.UUID]
    logged_action_id: uuid.UUID
    logged_action_probability: float
    top_ranked_action_id: uuid.UUID
    #: False means the slate had a clear winner and this event carries no counterfactual
    #: information. Returned so a caller can see it rather than infer it from a 1.0.
    randomised: bool
    exploration_epsilon: float
    near_tie_margin: float


class AwaazPolicyOutcomeRequest(BaseModel):
    """What the patient actually did. One write, then the row is immutable."""

    model_config = ConfigDict(extra="forbid")

    event_id: uuid.UUID
    outcome: PolicyEventOutcome
    #: Who supplied the signal. A caregiver tap is retained and marked, never silently
    #: promoted to the patient's own preference.
    actor: PolicyFeedbackActor = PolicyFeedbackActor.patient
    selected_action_id: uuid.UUID | None = None
    rejected_action_ids: list[uuid.UUID] = Field(
        default_factory=list, max_length=MAX_POLICY_CANDIDATES)
    confirmation_observed: bool = False
    output_spoken: bool = False

    @model_validator(mode="after")
    def outcome_matches_its_evidence(self):
        rejected = self.rejected_action_ids
        if len(set(rejected)) != len(rejected):
            raise ValueError("rejected_action_ids must not contain duplicates")
        if self.selected_action_id is not None and self.selected_action_id in rejected:
            raise ValueError("an action cannot be both selected and rejected")
        if self.outcome is PolicyEventOutcome.selected and self.selected_action_id is None:
            raise ValueError("a selected outcome requires selected_action_id")
        if self.outcome is PolicyEventOutcome.rejected and not rejected:
            raise ValueError("a rejected outcome requires rejected_action_ids")
        if self.outcome in (
            PolicyEventOutcome.phrase_board_fallback,
            PolicyEventOutcome.no_explicit_signal,
        ) and self.selected_action_id is not None:
            raise ValueError(
                "leaving for the phrase board or giving no signal is not a selection")
        if self.outcome is PolicyEventOutcome.no_explicit_signal and (
            rejected or self.confirmation_observed or self.output_spoken
        ):
            raise ValueError("no_explicit_signal cannot carry evidence of a signal")
        return self


class AwaazPolicyEventRead(BaseModel):
    """The stored row, in full. Everything it can say is on this list."""

    model_config = ORM

    id: uuid.UUID
    behavior_policy_id: str
    candidate_action_ids: list[uuid.UUID]
    logged_action_id: uuid.UUID
    logged_action_probability: float
    top_ranked_action_id: uuid.UUID
    randomised: bool
    speech_profile: str
    confirmation_required: bool
    confirmation_observed: bool
    output_spoken: bool
    emergency: bool
    feedback_actor: PolicyFeedbackActor
    outcome: PolicyEventOutcome
    selected_action_id: uuid.UUID | None
    rejected_action_ids: list[uuid.UUID]
    #: A day, deliberately. See `models.AwaazPolicyEvent`.
    logged_on: date
