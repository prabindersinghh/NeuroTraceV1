"""Pydantic v2 request/response models — one group per TRD §3 table and §9 endpoint."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from .models import Band, BaselineState, Instrument, Role, SessionType, StrokeSide

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


class PatientCreate(PatientBase):
    # PRD §3 locks enrolment to >= 3 months post-stroke; this is what proves it.
    stroke_date: datetime
    user_id: uuid.UUID | None = None
    clinician_id: uuid.UUID | None = None


class PatientUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
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


# --------------------------------------------------------------------------- sessions
class SessionStart(BaseModel):
    type: SessionType = SessionType.daily
    device_info: dict | None = None
    offline_captured: bool = False


class ModuleSubmit(BaseModel):
    """Features only. The device extracts; raw media never leaves it (TRD §1)."""
    features: dict[str, float | str | list | None]
    quality_flag: bool = True
    quality_detail: dict | None = None
    extracted_on_device: bool = True


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


class SessionFinalizeResponse(BaseModel):
    """TRD §9: what POST /sessions/{sid}/finalize returns."""
    session_id: uuid.UUID
    patient_id: uuid.UUID
    band: Band
    reason: str
    gate1_passed: bool
    gate2_passed: bool
    persistent_domains: list[str]
    domain_deviations: dict[str, float]
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
    persistent_domains: list | None
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
    confidence: float
    last_session: datetime | None
    unacknowledged_alerts: int
    baseline_state: BaselineState


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
