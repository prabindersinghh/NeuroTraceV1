"""SQLAlchemy tables — TRD §3.

Portability note: types are chosen so the same schema runs on PostgreSQL 15 (production)
and SQLite (tests) without dialect branches — `sa.Uuid` becomes native UUID on PG and
CHAR(32) on SQLite, `sa.JSON` becomes JSON on PG and TEXT on SQLite, and enums render as
VARCHAR + CHECK (native_enum=False) rather than PG enum types.

Privacy note (TRD §1): there is deliberately no column anywhere in this schema that can
hold audio, video or image bytes. Raw media is extracted on the device and discarded there.
What syncs is `module_results.features_json` — numbers.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Role(str, enum.Enum):
    patient = "patient"
    caregiver = "caregiver"
    clinician = "clinician"


class SessionType(str, enum.Enum):
    daily = "daily"
    weekly = "weekly"
    monthly = "monthly"


class Band(str, enum.Enum):
    STABLE = "STABLE"
    WATCH = "WATCH"
    ALERT = "ALERT"


class BaselineState(str, enum.Enum):
    not_started = "not_started"
    collecting = "collecting"
    locked = "locked"


class Instrument(str, enum.Enum):
    PHQ2 = "PHQ2"
    PHQ9 = "PHQ9"
    EAT10 = "EAT10"
    FSS = "FSS"
    BARTHEL = "BARTHEL"


class StrokeSide(str, enum.Enum):
    left = "left"
    right = "right"
    bilateral = "bilateral"
    unknown = "unknown"


def _enum(py_enum, name: str) -> sa.Enum:
    return sa.Enum(py_enum, name=name, native_enum=False, create_constraint=True,
                   validate_strings=True, length=24)


_UUID_PK = dict(primary_key=True, default=_uuid)
_TS = dict(server_default=sa.func.now(), default=utcnow, nullable=False)


# --------------------------------------------------------------------------- users
class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    email: Mapped[str] = mapped_column(sa.String(320), unique=True, index=True, nullable=False)
    pw_hash: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    role: Mapped[Role] = mapped_column(_enum(Role, "role_enum"), nullable=False)
    full_name: Mapped[str | None] = mapped_column(sa.String(120))
    lang: Mapped[str] = mapped_column(sa.String(8), default="en", nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), **_TS)

    managed_patients: Mapped[list["Patient"]] = relationship(
        back_populates="caregiver", foreign_keys="Patient.caregiver_id",
        cascade="all, delete-orphan", passive_deletes=True,
    )


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    caregiver_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    clinician_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="SET NULL"), unique=True, nullable=True)

    name: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    age: Mapped[int | None] = mapped_column(sa.Integer)
    sex: Mapped[str | None] = mapped_column(sa.String(16))
    # PRD §3: enrolment requires >= 3 months post-stroke; this column is what enforces it.
    stroke_date: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    stroke_side: Mapped[StrokeSide] = mapped_column(
        _enum(StrokeSide, "stroke_side_enum"), default=StrokeSide.unknown, nullable=False)
    enrolment_date: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), **_TS)
    languages: Mapped[list | None] = mapped_column(sa.JSON, default=list)
    # The patient's chosen exam slot, as an hour of day. Sessions far from it are tagged.
    preferred_hour: Mapped[float | None] = mapped_column(sa.Float)
    education_band: Mapped[str | None] = mapped_column(sa.String(24))
    baseline_state: Mapped[BaselineState] = mapped_column(
        _enum(BaselineState, "baseline_state_enum"),
        default=BaselineState.not_started, nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), **_TS)

    caregiver: Mapped[User] = relationship(back_populates="managed_patients",
                                           foreign_keys=[caregiver_id])
    sessions: Mapped[list["ExamSession"]] = relationship(
        back_populates="patient", cascade="all, delete-orphan", passive_deletes=True)
    baselines: Mapped[list["Baseline"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True)
    alerts: Mapped[list["Alert"]] = relationship(
        back_populates="patient", cascade="all, delete-orphan", passive_deletes=True)
    questionnaires: Mapped[list["Questionnaire"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True)
    vitals: Mapped[list["Vital"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True)
    adherence: Mapped[list["Adherence"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True)


# --------------------------------------------------------------------------- sessions
class ExamSession(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("patients.id", ondelete="CASCADE"), index=True, nullable=False)
    ts: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), index=True, **_TS)
    type: Mapped[SessionType] = mapped_column(
        _enum(SessionType, "session_type_enum"), default=SessionType.daily, nullable=False)
    device_info: Mapped[dict | None] = mapped_column(sa.JSON)
    # TRD §5: quality and identity gate a session out of the baseline entirely.
    quality_score: Mapped[float] = mapped_column(sa.Float, default=1.0, nullable=False)
    identity_verified: Mapped[bool] = mapped_column(sa.Boolean, default=True, nullable=False)
    identity_score: Mapped[float | None] = mapped_column(sa.Float)
    off_window: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    completed: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    offline_captured: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)

    patient: Mapped[Patient] = relationship(back_populates="sessions")
    module_results: Mapped[list["ModuleResult"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", passive_deletes=True)
    deviations: Mapped[list["Deviation"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True)
    score: Mapped["Score | None"] = relationship(
        back_populates="session", cascade="all, delete-orphan",
        passive_deletes=True, uselist=False)


class ModuleResult(Base):
    __tablename__ = "module_results"
    __table_args__ = (
        sa.UniqueConstraint("session_id", "module_code", name="uq_module_result_session_code"),
    )

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    session_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("sessions.id", ondelete="CASCADE"), index=True, nullable=False)
    module_code: Mapped[str] = mapped_column(sa.String(8), nullable=False)
    domain: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    # Numbers only. No media, ever.
    features_json: Mapped[dict] = mapped_column(sa.JSON, nullable=False)
    quality_flag: Mapped[bool] = mapped_column(sa.Boolean, default=True, nullable=False)
    quality_detail: Mapped[dict | None] = mapped_column(sa.JSON)
    extracted_on_device: Mapped[bool] = mapped_column(sa.Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), **_TS)

    session: Mapped[ExamSession] = relationship(back_populates="module_results")


# --------------------------------------------------------------------------- baseline
class Baseline(Base):
    __tablename__ = "baselines"
    __table_args__ = (
        sa.UniqueConstraint("patient_id", "module_code", name="uq_baseline_patient_module"),
    )

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("patients.id", ondelete="CASCADE"), index=True, nullable=False)
    module_code: Mapped[str] = mapped_column(sa.String(8), nullable=False)
    # TRD §5: MEDIAN and MAD, not mean and SD.
    median_json: Mapped[dict] = mapped_column(sa.JSON, nullable=False, default=dict)
    mad_json: Mapped[dict] = mapped_column(sa.JSON, nullable=False, default=dict)
    trajectory_json: Mapped[dict | None] = mapped_column(sa.JSON)
    n_sessions: Mapped[int] = mapped_column(sa.Integer, default=0, nullable=False)
    n_rejected: Mapped[int] = mapped_column(sa.Integer, default=0, nullable=False)
    n_discarded: Mapped[int] = mapped_column(sa.Integer, default=0, nullable=False)
    window_start: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    window_end: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    locked: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    reason: Mapped[str | None] = mapped_column(sa.String(256))
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), default=utcnow,
        onupdate=utcnow, nullable=False)


# --------------------------------------------------------------------------- scoring
class Deviation(Base):
    __tablename__ = "deviations"
    __table_args__ = (
        sa.UniqueConstraint("session_id", "module_code", name="uq_deviation_session_module"),
    )

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    session_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("sessions.id", ondelete="CASCADE"), index=True, nullable=False)
    module_code: Mapped[str] = mapped_column(sa.String(8), nullable=False)
    domain: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    rci_json: Mapped[dict | None] = mapped_column(sa.JSON)
    mean_abs_z: Mapped[float] = mapped_column(sa.Float, default=0.0, nullable=False)
    max_abs_z: Mapped[float] = mapped_column(sa.Float, default=0.0, nullable=False)
    cusum_stat: Mapped[float] = mapped_column(sa.Float, default=0.0, nullable=False)
    cusum_alarm: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    improving: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    # False when this module is recorded but not permitted to drive the alert gate.
    gateable: Mapped[bool] = mapped_column(sa.Boolean, default=True, nullable=False)
    flagged: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), **_TS)


class Score(Base):
    __tablename__ = "scores"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("patients.id", ondelete="CASCADE"), index=True, nullable=False)
    session_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("sessions.id", ondelete="CASCADE"), unique=True, nullable=False)
    domain_devs_json: Mapped[dict] = mapped_column(sa.JSON, nullable=False, default=dict)
    band: Mapped[Band] = mapped_column(_enum(Band, "band_enum"), nullable=False)
    gate1_passed: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    gate2_passed: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    persistent_domains: Mapped[list | None] = mapped_column(sa.JSON)
    drivers_json: Mapped[list | None] = mapped_column(sa.JSON)
    confounders_json: Mapped[dict | None] = mapped_column(sa.JSON)
    confidence: Mapped[float] = mapped_column(sa.Float, default=1.0, nullable=False)
    improving: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    reason: Mapped[str | None] = mapped_column(sa.String(512))
    baseline_phase: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    explanation_en: Mapped[str | None] = mapped_column(sa.Text)
    explanation_hi: Mapped[str | None] = mapped_column(sa.Text)
    explanation_source: Mapped[str] = mapped_column(sa.String(16), default="template",
                                                    nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), index=True, **_TS)

    session: Mapped[ExamSession] = relationship(back_populates="score")
    alerts: Mapped[list["Alert"]] = relationship(
        back_populates="score", cascade="all, delete-orphan", passive_deletes=True)


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("patients.id", ondelete="CASCADE"), index=True, nullable=False)
    score_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("scores.id", ondelete="CASCADE"), nullable=False)
    band: Mapped[Band] = mapped_column(_enum(Band, "band_enum"), nullable=False)
    drivers_json: Mapped[list | None] = mapped_column(sa.JSON)
    confounders_json: Mapped[dict | None] = mapped_column(sa.JSON)
    explanation_en: Mapped[str] = mapped_column(sa.Text, nullable=False)
    explanation_hi: Mapped[str | None] = mapped_column(sa.Text)
    clinician_line: Mapped[str | None] = mapped_column(sa.Text)
    acknowledged_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="SET NULL"))
    acknowledged_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), index=True, **_TS)

    patient: Mapped[Patient] = relationship(back_populates="alerts")
    score: Mapped[Score] = relationship(back_populates="alerts")


# --------------------------------------------------------------------------- domain F/G
class Questionnaire(Base):
    __tablename__ = "questionnaires"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("patients.id", ondelete="CASCADE"), index=True, nullable=False)
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("sessions.id", ondelete="SET NULL"))
    instrument: Mapped[Instrument] = mapped_column(
        _enum(Instrument, "instrument_enum"), nullable=False)
    score: Mapped[float] = mapped_column(sa.Float, nullable=False)
    responses_json: Mapped[dict | None] = mapped_column(sa.JSON)
    flags_json: Mapped[dict | None] = mapped_column(sa.JSON)
    ts: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), index=True, **_TS)


class Vital(Base):
    __tablename__ = "vitals"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("patients.id", ondelete="CASCADE"), index=True, nullable=False)
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("sessions.id", ondelete="SET NULL"))
    bp_sys: Mapped[int | None] = mapped_column(sa.Integer)
    bp_dia: Mapped[int | None] = mapped_column(sa.Integer)
    rhythm_flag: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    ppg_features_json: Mapped[dict | None] = mapped_column(sa.JSON)
    ts: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), index=True, **_TS)


class Adherence(Base):
    __tablename__ = "adherence"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("patients.id", ondelete="CASCADE"), index=True, nullable=False)
    taken: Mapped[bool] = mapped_column(sa.Boolean, nullable=False)
    ts: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), index=True, **_TS)


class SafetyEvent(Base):
    """An acute-symptom report. Recorded *before* any scoring happens (TRD §8)."""

    __tablename__ = "safety_events"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("patients.id", ondelete="CASCADE"), index=True, nullable=False)
    reported_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="SET NULL"))
    symptoms_json: Mapped[list] = mapped_column(sa.JSON, nullable=False, default=list)
    note: Mapped[str | None] = mapped_column(sa.Text)
    escalated: Mapped[bool] = mapped_column(sa.Boolean, default=True, nullable=False)
    ts: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), index=True, **_TS)


class AuditLog(Base):
    """Who saw or changed what. Required for the B2B tier (TRD §9)."""

    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="SET NULL"), index=True)
    action: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    patient_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    meta_json: Mapped[dict | None] = mapped_column(sa.JSON)
    ts: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), index=True, **_TS)
