"""Pydantic v2 request/response models — one schema group per TRD §3 table."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from .models import Band, Modality, Role, SampleStatus

ORM = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------- users / auth
class UserBase(BaseModel):
    email: EmailStr
    role: Role = Role.caregiver
    full_name: str | None = Field(default=None, max_length=120)


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
    language: str = Field(default="en", max_length=8)


class PatientCreate(PatientBase):
    user_id: uuid.UUID | None = None


class PatientUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    age: int | None = Field(default=None, ge=0, le=130)
    sex: str | None = Field(default=None, max_length=16)
    language: str | None = Field(default=None, max_length=8)


class PatientRead(PatientBase):
    model_config = ORM
    id: uuid.UUID
    caregiver_id: uuid.UUID
    user_id: uuid.UUID | None
    baseline_ready: bool
    created_at: datetime


# --------------------------------------------------------------------------- samples / features
class DailySampleRead(BaseModel):
    model_config = ORM
    id: uuid.UUID
    patient_id: uuid.UUID
    ts: datetime
    audio_path: str | None
    video_path: str | None
    reaction_json: dict | None
    status: SampleStatus


class ReactionPayload(BaseModel):
    """Raw payload emitted by the browser tap game (TRD §4 / reaction.py)."""
    latencies_ms: list[float] = Field(default_factory=list)
    misses: int = 0
    false_starts: int = 0


class FeatureVectorRead(BaseModel):
    model_config = ORM
    id: uuid.UUID
    sample_id: uuid.UUID
    modality: Modality
    features_json: dict
    created_at: datetime


class FeatureExtractionResult(BaseModel):
    sample_id: uuid.UUID
    modality: Modality
    valid: bool
    n_features: int
    features: dict


# --------------------------------------------------------------------------- baselines
class BaselineRead(BaseModel):
    model_config = ORM
    id: uuid.UUID
    patient_id: uuid.UUID
    modality: Modality
    mean_json: dict
    std_json: dict
    n_days: int
    ready: bool
    updated_at: datetime


# --------------------------------------------------------------------------- scores / alerts
class ScoreRead(BaseModel):
    model_config = ORM
    id: uuid.UUID
    patient_id: uuid.UUID
    sample_id: uuid.UUID
    voice_dev: float
    face_dev: float
    reaction_dev: float
    stability_score: float
    band: Band
    reason: str | None
    modalities_flagged: list[str] | None
    explanation_en: str | None
    explanation_hi: str | None
    baseline_day: bool
    created_at: datetime


class AlertRead(BaseModel):
    model_config = ORM
    id: uuid.UUID
    patient_id: uuid.UUID
    score_id: uuid.UUID
    band: Band
    explanation: str
    explanation_hi: str | None
    whatsapp_sent: bool
    created_at: datetime


class CheckinResult(BaseModel):
    """What POST /checkin/{pid}/finalize returns."""
    sample_id: uuid.UUID
    patient_id: uuid.UUID
    stability_score: float
    band: Band
    reason: str
    baseline_day: bool
    baseline_ready: bool
    deviations: dict[str, float]
    modalities_flagged: list[str]
    valid_modalities: dict[str, bool]
    top_drivers: list[tuple[str, float]]
    explanation_en: str
    explanation_hi: str
    alert_id: uuid.UUID | None = None


# --------------------------------------------------------------------------- dashboard
class TrendPoint(BaseModel):
    """One day on the caregiver's charts."""
    date: datetime
    sample_id: uuid.UUID
    voice_dev: float
    face_dev: float
    reaction_dev: float
    stability_score: float
    band: Band
    baseline_day: bool


class HistoryRow(BaseModel):
    date: datetime
    band: Band
    stability_score: float
    reason: str | None
    explanation_en: str | None
    explanation_hi: str | None
    baseline_day: bool


class DashboardResponse(BaseModel):
    """Everything the caregiver view needs in one request (TRD §6)."""
    patient: PatientRead
    baseline_ready: bool
    baseline_days_recorded: int
    baseline_days_required: int
    latest: ScoreRead | None
    latest_explanation_en: str | None
    latest_explanation_hi: str | None
    trends: list[TrendPoint]
    history: list[HistoryRow]
    alerts: list[AlertRead]
    dev_threshold: float
    band_thresholds: dict[str, float]


# --------------------------------------------------------------------------- misc
class HealthResponse(BaseModel):
    status: str
    app: str
    version: str
    env: str
    database: str


class MessageResponse(BaseModel):
    detail: str
