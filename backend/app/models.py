"""SQLAlchemy tables — TRD §3 data model.

Portability note: types are chosen so the same schema runs on PostgreSQL 15 (production)
and SQLite (tests) without dialect branches — `sa.Uuid` becomes native UUID on PG and
CHAR(32) on SQLite, `sa.JSON` becomes JSON on PG and TEXT on SQLite, and enums are
rendered as VARCHAR + CHECK constraint (native_enum=False) instead of PG enum types.
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


class SampleStatus(str, enum.Enum):
    processing = "processing"
    done = "done"


class Modality(str, enum.Enum):
    voice = "voice"
    face = "face"
    reaction = "reaction"


class Band(str, enum.Enum):
    STABLE = "STABLE"
    WATCH = "WATCH"
    ALERT = "ALERT"


def _enum(py_enum, name: str) -> sa.Enum:
    return sa.Enum(
        py_enum,
        name=name,
        native_enum=False,
        create_constraint=True,
        validate_strings=True,
        length=16,
    )


_UUID_PK = dict(primary_key=True, default=_uuid)
_TS = dict(server_default=sa.func.now(), default=utcnow, nullable=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    email: Mapped[str] = mapped_column(sa.String(320), unique=True, index=True, nullable=False)
    pw_hash: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    role: Mapped[Role] = mapped_column(_enum(Role, "role_enum"), nullable=False)
    full_name: Mapped[str | None] = mapped_column(sa.String(120))
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), **_TS)

    managed_patients: Mapped[list["Patient"]] = relationship(
        back_populates="caregiver",
        foreign_keys="Patient.caregiver_id",
        cascade="all, delete-orphan",
    )


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    caregiver_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Optional login for the patient themselves (PRD G1: the patient signs in and checks in).
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="SET NULL"), unique=True, nullable=True
    )
    name: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    age: Mapped[int | None] = mapped_column(sa.Integer)
    sex: Mapped[str | None] = mapped_column(sa.String(16))
    language: Mapped[str] = mapped_column(sa.String(8), default="en", nullable=False)
    baseline_ready: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), **_TS)

    caregiver: Mapped[User] = relationship(back_populates="managed_patients", foreign_keys=[caregiver_id])

    # passive_deletes: the ON DELETE CASCADE in the schema does the work, so deleting a
    # patient does not first load every child row into memory. `scores`/`alerts`/
    # `baselines` are declared even though nothing reads them, because without them a
    # session-level delete would leave orphans behind on any database that is not
    # enforcing the constraint.
    samples: Mapped[list["DailySample"]] = relationship(
        back_populates="patient", cascade="all, delete-orphan", passive_deletes=True
    )
    baselines: Mapped[list["Baseline"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True
    )
    scores: Mapped[list["Score"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True
    )
    alerts: Mapped[list["Alert"]] = relationship(
        back_populates="patient", cascade="all, delete-orphan", passive_deletes=True
    )


class DailySample(Base):
    __tablename__ = "daily_samples"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("patients.id", ondelete="CASCADE"), index=True, nullable=False
    )
    ts: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), index=True, **_TS)
    audio_path: Mapped[str | None] = mapped_column(sa.String(512))
    video_path: Mapped[str | None] = mapped_column(sa.String(512))
    reaction_json: Mapped[dict | None] = mapped_column(sa.JSON)
    status: Mapped[SampleStatus] = mapped_column(
        _enum(SampleStatus, "sample_status_enum"), default=SampleStatus.processing, nullable=False
    )

    patient: Mapped[Patient] = relationship(back_populates="samples")
    feature_vectors: Mapped[list["FeatureVector"]] = relationship(
        back_populates="sample", cascade="all, delete-orphan"
    )


class FeatureVector(Base):
    __tablename__ = "feature_vectors"
    __table_args__ = (sa.UniqueConstraint("sample_id", "modality", name="uq_feature_sample_modality"),)

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    sample_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("daily_samples.id", ondelete="CASCADE"), index=True, nullable=False
    )
    modality: Mapped[Modality] = mapped_column(_enum(Modality, "modality_enum"), nullable=False)
    features_json: Mapped[dict] = mapped_column(sa.JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), **_TS)

    sample: Mapped[DailySample] = relationship(back_populates="feature_vectors")


class Baseline(Base):
    __tablename__ = "baselines"
    __table_args__ = (sa.UniqueConstraint("patient_id", "modality", name="uq_baseline_patient_modality"),)

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("patients.id", ondelete="CASCADE"), index=True, nullable=False
    )
    modality: Mapped[Modality] = mapped_column(_enum(Modality, "modality_enum"), nullable=False)
    mean_json: Mapped[dict] = mapped_column(sa.JSON, nullable=False, default=dict)
    std_json: Mapped[dict] = mapped_column(sa.JSON, nullable=False, default=dict)
    n_days: Mapped[int] = mapped_column(sa.Integer, default=0, nullable=False)
    ready: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), default=utcnow,
        onupdate=utcnow, nullable=False,
    )


class Score(Base):
    __tablename__ = "scores"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("patients.id", ondelete="CASCADE"), index=True, nullable=False
    )
    sample_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("daily_samples.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    voice_dev: Mapped[float] = mapped_column(sa.Float, default=0.0, nullable=False)
    face_dev: Mapped[float] = mapped_column(sa.Float, default=0.0, nullable=False)
    reaction_dev: Mapped[float] = mapped_column(sa.Float, default=0.0, nullable=False)
    stability_score: Mapped[float] = mapped_column(sa.Float, default=0.0, nullable=False)
    band: Mapped[Band] = mapped_column(_enum(Band, "band_enum"), nullable=False)
    # Additive to TRD §3 so the dashboard/finalize contract in TRD §6 can be served
    # without recomputing the explanation on every read.
    reason: Mapped[str | None] = mapped_column(sa.String(256))
    modalities_flagged: Mapped[list | None] = mapped_column(sa.JSON)
    z_scores_json: Mapped[dict | None] = mapped_column(sa.JSON)
    explanation_en: Mapped[str | None] = mapped_column(sa.Text)
    explanation_hi: Mapped[str | None] = mapped_column(sa.Text)
    baseline_day: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), index=True, **_TS)

    alerts: Mapped[list["Alert"]] = relationship(
        back_populates="score", cascade="all, delete-orphan", passive_deletes=True
    )


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("patients.id", ondelete="CASCADE"), index=True, nullable=False
    )
    score_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("scores.id", ondelete="CASCADE"), nullable=False
    )
    band: Mapped[Band] = mapped_column(_enum(Band, "band_enum"), nullable=False)
    explanation: Mapped[str] = mapped_column(sa.Text, nullable=False)
    explanation_hi: Mapped[str | None] = mapped_column(sa.Text)
    whatsapp_sent: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), index=True, **_TS)

    patient: Mapped[Patient] = relationship(back_populates="alerts")
    score: Mapped[Score] = relationship(back_populates="alerts")
