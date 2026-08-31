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
from datetime import date, datetime, timezone

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
    #: A community health worker (ASHA) who visits a fixed list of households, runs the
    #: monthly deep assessment on a shared tablet, and syncs per patient. They see only
    #: their own households, and only what a visit requires.
    asha_worker = "asha_worker"
    #: Operator of the deployment, not a participant in care. Sees system health, aggregate
    #: counts and the audit trail — and NO clinical content, by design. An admin who can
    #: read patient data is a backdoor around INV-11 with a friendlier name, so the admin
    #: endpoints return numbers and never rows. See `routers/admin.py`.
    admin = "admin"


class DeploymentTier(str, enum.Enum):
    """What hardware this patient actually has.

    The module set has to follow the hardware rather than the wish list. A 6-inch phone
    held at arm's length cannot run a nine-point gaze task or a line-bisection test with
    any validity — the target subtends too few degrees and the arm shakes. Offering those
    modules anyway would produce numbers that look like measurements and are not, which is
    worse than not offering them.
    """

    #: Phone only. Daily check-in. The base product, zero added hardware.
    TIER_1_PHONE = "TIER_1_PHONE"
    #: + Samsung Galaxy Watch: passive HR, rhythm notifications, sleep, steps, falls.
    TIER_2_WATCH = "TIER_2_WATCH"
    #: + a shared ASHA kit (tablet, BP cuff, pulse oximeter) serving ~50 households.
    TIER_3_ASHA = "TIER_3_ASHA"


class WearableMetric(str, enum.Enum):
    """Vendor-device readings we LOG and TREND.

    We never make a measurement claim about any of these. The device vendor holds the
    regulatory claim for the measurement; we hold only the claim that we recorded what
    their device reported and can show how it moved. See `app/slm/templates.py`.
    """

    heart_rate = "heart_rate"
    irregular_rhythm = "irregular_rhythm"
    sleep_quality = "sleep_quality"
    step_count = "step_count"
    spo2 = "spo2"
    blood_pressure_systolic = "blood_pressure_systolic"
    blood_pressure_diastolic = "blood_pressure_diastolic"


class SessionType(str, enum.Enum):
    daily = "daily"
    weekly = "weekly"
    monthly = "monthly"


class Band(str, enum.Enum):
    STABLE = "STABLE"
    WATCH = "WATCH"
    ALERT = "ALERT"
    #: Symmetric, progressive change across face, motor and voice with no one-sided
    #: finding. Not a focal deficit, so not a stroke-monitoring alert — reported as its
    #: own thing so the family is told something true rather than nothing.
    PATTERN_ATYPICAL = "PATTERN_ATYPICAL"


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
    # PRD §3 exclusions. A comorbid movement disorder produces symmetric decline across
    # face, motor and voice simultaneously, which is the exact signature the alert gate
    # reads as deterioration. The engine's laterality requirement makes that safe rather
    # than catastrophic, but the system is validated only for post-stroke monitoring
    # without these comorbidities, so enrolment is refused outright.
    pd_diagnosis: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    other_movement_disorder: Mapped[bool] = mapped_column(
        sa.Boolean, default=False, nullable=False)
    #: How much of the daily battery this patient runs: FULL / STANDARD / LIGHT / RESEARCH.
    #:
    #: This is NOT cosmetic. Each intensity changes which tasks run and therefore where in
    #: the session a given task falls, and every module's baseline encodes its position on
    #: the fatigue curve. A patient moved from FULL to STANDARD performs finger tapping
    #: three tasks earlier — less fatigued, better score, reading as improvement. So a
    #: change here is a confounder, recorded per result, not a silent setting.
    intensity: Mapped[str] = mapped_column(
        sa.String(16), default="FULL", nullable=False)

    #: Icon-and-audio-first presentation for a patient whose LANGUAGE is affected. This is
    #: presentation only — it changes nothing about what is measured.
    aphasia_mode: Mapped[bool] = mapped_column(
        sa.Boolean, default=False, nullable=False, server_default=sa.false())
    #: Which consent text the caregiver agreed to, and in which language. Versioned so a
    #: future consent change is a re-consent event, not a silent swap under an old yes.
    consent_version: Mapped[str | None] = mapped_column(sa.String(16))
    consent_lang: Mapped[str | None] = mapped_column(sa.String(8))
    #: Device calibration captured during onboarding: measured fps, lighting, audio level.
    #: Informational context for capture quality — never a measurement input.
    calibration_json: Mapped[dict | None] = mapped_column(sa.JSON)
    onboarding_complete: Mapped[bool] = mapped_column(
        sa.Boolean, default=False, nullable=False, server_default=sa.false())

    #: Which hardware tier this patient is on. Gates which modules are offered.
    deployment_tier: Mapped[DeploymentTier] = mapped_column(
        _enum(DeploymentTier, "deployment_tier_enum"),
        default=DeploymentTier.TIER_1_PHONE, nullable=False)
    #: The ASHA worker whose household list this patient is on (TIER_3 only).
    asha_worker_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="SET NULL"), index=True)
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
    #: A guided practice run from onboarding. Stored in full — the family can see it went
    #: fine — but it never reaches the engine: no Score, no baseline contribution. The
    #: patient is learning the tasks, and a learning attempt inside the baseline would
    #: manufacture an improvement over the next week that is really just familiarity.
    is_practice: Mapped[bool] = mapped_column(
        sa.Boolean, default=False, nullable=False, server_default=sa.false())

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
    # --- fatigue instrumentation (FINAL_PRODUCT_SPEC v4 Part 1) ---
    #
    # A twelve-minute battery tires an 82-year-old. Fixed ordering makes position a
    # constant that each baseline absorbs; these columns exist because intensity changes
    # and pauses BREAK that constant, both in the direction that masks decline.
    #: 1-indexed position in the protocol.
    session_position: Mapped[int | None] = mapped_column(sa.Integer)
    #: Seconds from session start to this task starting.
    elapsed_seconds_at_task_start: Mapped[float | None] = mapped_column(sa.Float)
    #: The intensity this result was captured under.
    intensity: Mapped[str | None] = mapped_column(sa.String(16))
    #: True when the session was paused before this task — it was performed rested.
    paused_before_task: Mapped[bool] = mapped_column(
        sa.Boolean, default=False, nullable=False)

    #: Optional derived TRACE for modules that produce one — currently only M9
    #: craniocorpography, where the movement path is the clinical output a specialist
    #: reads first.
    #:
    #: This is NOT media and does not weaken INV-1. What is stored is a list of head-centre
    #: coordinates in centimetres, already reduced from the video on the device; the frames
    #: themselves are discarded there as always. A CCG report is a picture of a path, and
    #: without the path we would be handing a clinician four numbers and asking them to
    #: trust a format they have never seen.
    trace_json: Mapped[dict | None] = mapped_column(sa.JSON)
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

    # --- the frozen reference (TRD §5) ---
    #
    # The adaptive baseline above follows the patient. That is correct for day-to-day
    # comparison — it tracks genuine recovery and stops flagging a level the patient has
    # legitimately settled at — but it has a failure mode that matters more than anything
    # it fixes: a slow, real decline gets absorbed. Each day is close to the last, the
    # rolling median walks down with the patient, and the z-score stays near zero the whole
    # way. The engine tracks them to the floor and never says a word.
    #
    # So at lock we take a permanent snapshot and never touch it again. Every session is
    # then scored twice: against the adaptive baseline for "is today different from
    # recently", and against this for "how far are they from the normal we established".
    # The second question is the one a slow decline cannot hide from.
    reference_median_json: Mapped[dict | None] = mapped_column(sa.JSON)
    reference_mad_json: Mapped[dict | None] = mapped_column(sa.JSON)
    #: When the snapshot was taken. Its presence is what marks the reference as established.
    reference_locked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    reference_n_sessions: Mapped[int] = mapped_column(sa.Integer, default=0, nullable=False)

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
    #: mean |z| across this module's asymmetry features only.
    lateral_abs_z: Mapped[float] = mapped_column(sa.Float, default=0.0, nullable=False)
    #: True when the change is one-sided rather than a symmetric change in level.
    lateralised: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
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
    #: Gate 3 — at least one persistent domain showed a one-sided change.
    gate3_passed: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    persistent_domains: Mapped[list | None] = mapped_column(sa.JSON)
    lateralised_domains: Mapped[list | None] = mapped_column(sa.JSON)
    #: Symmetric progressive change across face, motor and voice — see gates.py.
    symmetric_pattern: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    #: Deviation from the FROZEN reference baseline, per domain. Distinct from
    #: domain_deviations, which is measured against the adaptive baseline.
    cumulative_drift_json: Mapped[dict | None] = mapped_column(sa.JSON)
    #: Worst per-domain cumulative drift, for trend display and ranking.
    cumulative_drift: Mapped[float] = mapped_column(sa.Float, default=0.0, nullable=False)
    #: True when drift from the established normal is beyond RCI even though the adaptive
    #: comparison looks unremarkable — i.e. the slow decline the adaptive baseline absorbed.
    drift_flagged: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
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


# --------------------------------------------------------------------------- wearables
class WearableData(Base):
    """A reading a vendor device reported.

    Deliberately a log, not a measurement. `value` is stored exactly as the device gave it,
    with the device identified, so that anything derived from it can be traced back to the
    thing that holds the regulatory claim for it. NeuroTrace claims only the trend.
    """

    __tablename__ = "wearable_data"
    __table_args__ = (
        sa.Index("ix_wearable_patient_metric_ts", "patient_id", "metric", "ts"),
    )

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("patients.id", ondelete="CASCADE"), index=True, nullable=False)
    #: Vendor/app that produced the reading, e.g. "samsung_health".
    source: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    metric: Mapped[WearableMetric] = mapped_column(
        _enum(WearableMetric, "wearable_metric_enum"), nullable=False)
    value: Mapped[float] = mapped_column(sa.Float, nullable=False)
    unit: Mapped[str | None] = mapped_column(sa.String(24))
    ts: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    #: Which physical device. Two watches on one patient must stay distinguishable.
    device_id: Mapped[str | None] = mapped_column(sa.String(128))
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), default=utcnow,
        nullable=False)


class FallEvent(Base):
    """A fall the watch reported.

    Handled like the acute-symptom path and for the same reason: a fall is an event, not a
    trend. Routing it through the deviation engine would mean a patient lies on the floor
    while the system waits for a second corroborating domain across two sessions. It
    bypasses scoring entirely and notifies the caregiver immediately.
    """

    __tablename__ = "fall_events"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("patients.id", ondelete="CASCADE"), index=True, nullable=False)
    source: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    ts: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    device_id: Mapped[str | None] = mapped_column(sa.String(128))
    #: Confidence the DEVICE reported, passed through unchanged. Not our estimate.
    device_confidence: Mapped[float | None] = mapped_column(sa.Float)
    #: True when the wearer cancelled the alert on the watch.
    dismissed_by_patient: Mapped[bool] = mapped_column(
        sa.Boolean, default=False, nullable=False)
    caregiver_notified_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True))
    acknowledged_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), default=utcnow,
        nullable=False)


class AshaVisit(Base):
    """One ASHA household visit, which may carry several patients' assessments.

    Recorded separately from ExamSession because the visit is the unit that gets synced:
    an ASHA worker is offline for most of a round and uploads when they get signal.
    `client_visit_id` is the worker's device-side id, so a retried upload updates the same
    visit instead of creating a duplicate.
    """

    __tablename__ = "asha_visits"
    __table_args__ = (
        sa.UniqueConstraint("asha_worker_id", "client_visit_id",
                            name="uq_asha_visit_worker_client"),
    )

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    asha_worker_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("patients.id", ondelete="CASCADE"), index=True, nullable=False)
    #: Device-side identifier, for idempotent sync after an offline round.
    client_visit_id: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    ts: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("sessions.id", ondelete="SET NULL"))
    device_id: Mapped[str | None] = mapped_column(sa.String(128))
    notes: Mapped[str | None] = mapped_column(sa.String(512))
    synced_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), default=utcnow,
        nullable=False)


# --------------------------------------------------------------------------- Awaaz
class AwaazProfile(Base):
    """Per-patient communication settings.

    `speech_profile` is the safety-critical field: it decides whether anything may ever be
    spoken without the patient confirming it. See `app/awaaz/safety.py`.
    """

    __tablename__ = "awaaz_profiles"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("patients.id", ondelete="CASCADE"), unique=True, nullable=False)
    #: dysarthria_dominant | aphasia_dominant | mixed | unassessed. Defaults to unassessed,
    #: which is treated as aphasia — safe by default rather than convenient by default.
    speech_profile: Mapped[str] = mapped_column(
        sa.String(32), default="unassessed", nullable=False)
    #: Even for an eligible profile this must be turned on deliberately.
    auto_speak_enabled: Mapped[bool] = mapped_column(
        sa.Boolean, default=False, nullable=False)
    auto_speak_threshold: Mapped[float] = mapped_column(
        sa.Float, default=0.85, nullable=False)
    #: none | pending | ready | failed | deleted
    voice_status: Mapped[str] = mapped_column(
        sa.String(16), default="none", nullable=False)
    #: Silence in seconds before an utterance is considered finished. Tunable up to 4s:
    #: default VAD cutting dysarthric speakers off mid-sentence is the single biggest
    #: cause of abandonment in this product category.
    endpoint_silence_seconds: Mapped[float] = mapped_column(
        sa.Float, default=2.5, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), default=utcnow,
        onupdate=utcnow, nullable=False)


class PhraseCard(Base):
    """One tile on the patient's board. One tap speaks it."""

    __tablename__ = "phrase_cards"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("patients.id", ondelete="CASCADE"), index=True, nullable=False)
    text: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    lang: Mapped[str] = mapped_column(sa.String(8), default="en", nullable=False)
    icon: Mapped[str | None] = mapped_column(sa.String(32))
    category: Mapped[str] = mapped_column(sa.String(32), default="general", nullable=False)
    slot: Mapped[int] = mapped_column(sa.Integer, default=0, nullable=False)
    #: Cards sort by use, so what matters surfaces without the patient hunting for it.
    use_count: Mapped[int] = mapped_column(sa.Integer, default=0, nullable=False)
    #: Emergency cards stay pinned; pre-rendered offline audio is a separate pending asset.
    is_emergency: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), default=utcnow,
        nullable=False)


class VoiceSample(Base):
    """Metadata for a family-archive clip used to build the voice.

    Deliberately metadata ONLY — duration, status, consent. The audio itself never enters
    this database. See DECISIONS D-014 for why that upload is a documented exception to
    INV-1 rather than a hole in it.
    """

    __tablename__ = "voice_samples"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("patients.id", ondelete="CASCADE"), index=True, nullable=False)
    #: Where the caregiver said it came from, e.g. "wedding video".
    provenance: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    duration_seconds: Mapped[float] = mapped_column(sa.Float, nullable=False)
    #: uploaded | training | ready | failed | deleted
    status: Mapped[str] = mapped_column(sa.String(16), default="uploaded", nullable=False)
    consent_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="SET NULL"))
    #: Recorded when the source audio is destroyed after training.
    audio_deleted_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), default=utcnow,
        nullable=False)


class UtteranceLog(Base):
    """What was spoken, and whether the patient confirmed it first.

    The `confirmed` column is the audit trail for INV-9: it must be possible to show, after
    the fact, that nothing was ever spoken on an aphasic patient's behalf unconfirmed.
    """

    __tablename__ = "utterance_log"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("patients.id", ondelete="CASCADE"), index=True, nullable=False)
    text: Mapped[str] = mapped_column(sa.String(500), nullable=False)
    lang: Mapped[str] = mapped_column(sa.String(8), default="en", nullable=False)
    card_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("phrase_cards.id", ondelete="SET NULL"))
    #: auto | confirm
    mode: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    #: True when the patient explicitly chose this before it was spoken.
    confirmed: Mapped[bool] = mapped_column(sa.Boolean, default=True, nullable=False)
    confidence: Mapped[float | None] = mapped_column(sa.Float)
    is_emergency: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    #: The caregiver's verified text label (D4). It becomes a training target only after
    #: an audio capture is associated with this utterance.
    corrected_text: Mapped[str | None] = mapped_column(sa.String(500))
    reviewed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    #: Identifier of a WAV retained in this browser's on-device IndexedDB vault. This is a
    #: receipt/link only: the database has no media column and the API never receives bytes.
    audio_capture_id: Mapped[str | None] = mapped_column(
        sa.String(36), unique=True, index=True)
    audio_duration_seconds: Mapped[float | None] = mapped_column(sa.Float)
    #: Integrity metadata lets a future exporter verify the local WAV before training.
    audio_sha256: Mapped[str | None] = mapped_column(sa.String(64))
    audio_size_bytes: Mapped[int | None] = mapped_column(sa.Integer)
    #: Explicit consent actor and time. A recording without these fields is not a pair.
    audio_consent_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="SET NULL"))
    audio_consent_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    #: Truth about the local copy, updated when the person revokes and deletes it.
    audio_retained_on_device: Mapped[bool] = mapped_column(
        sa.Boolean, default=False, nullable=False)
    audio_deleted_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    ts: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), default=utcnow,
        nullable=False)


# ---------------------------------------------------------- Awaaz policy events (AWA-FR-014)
# The counterfactual-logging contract. `app/ml/rl/` can already compare candidate-ranking
# policies offline, but until this table existed NO product event was eligible: production
# recorded no slate, no policy version, no propensity, and no confirmation outcome, so every
# importance weight would have had an unknown denominator. PLAN_RL.md calls this out and
# PRD_AWAAZ.md §11 makes it a precondition for any real offline evaluation.
#
# WHAT IS DELIBERATELY NOT HERE, and why it is not an oversight (INV-11):
#   * no patient_id and no foreign key of any kind. Every other table in this schema hangs
#     off `patients.id`; this one must not, because a row that can be joined to a patient is
#     a per-person record of what they tried to say. The cost is real and is stated in the
#     report: without a patient column we cannot split by patient before fitting, so the
#     repeated-speaker dependence in `offline.LIMITATIONS` stays unaddressed. That is the
#     correct trade -- an offline UX estimate does not justify a re-identifiable log.
#   * no transcript, no candidate text, no lang, no card_id. Candidate contents live in the
#     client's slate behind opaque UUIDs and never cross this boundary.
#   * no audio, no audio hash, no capture id, no duration. INV-1 already forbids the bytes;
#     a hash is still a per-utterance identifier that joins to `utterance_log`.
#   * no latency, dwell, tap timing, or session duration. `rewards.RewardConfig` refuses to
#     score them because they measure disability and fatigue; storing them would invite it.
#   * no clinical outcome, band, or score.
#   * no wall-clock timestamp. `logged_on` is a DATE. A microsecond timestamp here would
#     join one-to-one against `audit_log.ts` and `utterance_log.ts`, both of which carry
#     `patient_id` -- which would hand back the identifier this table exists without. A day
#     is the coarsest granularity that still supports retention and deletion sweeps, and the
#     audit rows this router writes deliberately omit the event id so the join stays
#     many-to-many rather than exact.
#
# Append-only (INV-8): there is no code path that UPDATEs or DELETEs a row here. The outcome
# is known before the single INSERT because the sampled decision waits in process memory
# (see `routers/awaaz.py`) until the interaction finishes; a restart drops pending decisions
# and those events are simply never logged, which errs the right way.

#: Must equal `app.ml.rl.contracts.MAX_CANDIDATES`. Duplicated rather than imported so the
#: request path does not pull the analysis package in at boot; `test_awaaz_policy_logging.py`
#: asserts the two stay equal, because a slate this table accepts and the contract rejects
#: would be silently unloggable.
MAX_POLICY_CANDIDATES = 8
MIN_POLICY_CANDIDATES = 2


class PolicyEventOutcome(str, enum.Enum):
    """The patient's explicit signal, and nothing else.

    `no_explicit_signal` is recorded rather than dropped: an event whose row only exists
    when the patient reacted would make the log a sample selected on the outcome. These rows
    carry no reward and cannot become `ExplicitFeedback` -- inactivity is not a preference
    -- so the exporter skips them, and the skip rate is itself a number a reviewer must look
    at before believing an estimate.
    """

    selected = "selected"
    rejected = "rejected"
    corrected = "corrected"
    phrase_board_fallback = "phrase_board_fallback"
    no_explicit_signal = "no_explicit_signal"


class PolicyFeedbackActor(str, enum.Enum):
    """Values mirror `app.ml.rl.contracts.FeedbackActor` exactly.

    Recorded because a caregiver tapping on the patient's behalf is not the patient's
    communication preference, and the offline gate refuses those rows. Without the column we
    would be unable to tell the two apart and would have to refuse the whole log.
    """

    patient = "patient"
    caregiver = "caregiver"


class AwaazPolicyEvent(Base):
    """One candidate-ranking decision, its logged action, and its propensity."""

    __tablename__ = "awaaz_policy_events"

    #: The opaque event UUID the client minted when it rendered the slate. It is the primary
    #: key AND the idempotency key: a retried outcome POST lands on the same row instead of
    #: creating a second observation of one decision, which would double-count that event in
    #: every importance-weighted sum.
    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, **_UUID_PK)
    #: The behaviour policy's version slug, constrained to `contracts._POLICY_ID`'s shape.
    #: An estimate is only ever about a named logger; mixing two versions in one log without
    #: being able to say so is how a "policy improvement" turns out to be a release boundary.
    behavior_policy_id: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    #: The full offered slate as opaque candidate UUIDs, in the order the patient saw them:
    #: index 0 is rank 0, which is the logged action. The whole slate is required, not just
    #: the chosen one, because the evaluated policy has to be able to put mass on the actions
    #: that were available and were not taken -- that support set is what overlap means.
    candidate_action_ids: Mapped[list] = mapped_column(sa.JSON, nullable=False)
    #: The action actually shown first. May differ from `top_ranked_action_id` after
    #: exploration; that difference is the entire point of the table.
    logged_action_id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, nullable=False)
    #: pi_0(logged_action_id | context) -- the probability THIS policy assigned to the action
    #: it actually logged, never the top-ranked action's probability. `compare_policies`
    #: divides by this number, so the wrong quantity here mis-specifies every weight and both
    #: estimates come back wrong with no blocker firing.
    logged_action_probability: Mapped[float] = mapped_column(sa.Float, nullable=False)
    #: What the scorer ranked first before sampling. Stored so a re-rank is declarable and
    #: the contract's arithmetic check (a non-top action cannot carry probability above 0.5)
    #: can run at export time -- the last point at which a mis-written propensity is visible.
    top_ranked_action_id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, nullable=False)
    #: False when the slate had a single clear winner and no near-tie to explore among, so
    #: the probability above is exactly 1.0. Flagged rather than refused: an occasional
    #: certain event is legitimate, and `offline.py` fails the whole log closed with
    #: `logging_policy_is_deterministic` once too many of them accumulate.
    randomised: Mapped[bool] = mapped_column(sa.Boolean, nullable=False)
    #: The coarse four-value enum `app/awaaz/safety.py` already uses. The offline gate admits
    #: only `dysarthria_dominant`, so without it every row would be ineligible. Four buckets
    #: over a whole cohort is not an identifier.
    speech_profile: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    #: The confirmation gate as it stood for this event. Nothing here changes it; these are
    #: an observation of INV-9, which is why an inconsistent combination is refused at write
    #: time rather than stored and filtered later.
    confirmation_required: Mapped[bool] = mapped_column(sa.Boolean, nullable=False)
    confirmation_observed: Mapped[bool] = mapped_column(sa.Boolean, nullable=False)
    output_spoken: Mapped[bool] = mapped_column(sa.Boolean, nullable=False)
    #: Always false from the product path -- the emergency flow is never ranked, never
    #: randomised, and never logged here. The column exists so the exported record is total
    #: and so any future writer has to set it deliberately rather than by omission.
    emergency: Mapped[bool] = mapped_column(
        sa.Boolean, default=False, nullable=False)
    feedback_actor: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    outcome: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    #: Which candidate the patient chose, when they chose one. An opaque slate member.
    selected_action_id: Mapped[uuid.UUID | None] = mapped_column(sa.Uuid)
    #: Candidates explicitly dismissed. Negative evidence about the logged action, and the
    #: only way "they scrolled past it" is distinguishable from "they never looked".
    rejected_action_ids: Mapped[list] = mapped_column(
        sa.JSON, default=list, nullable=False)
    #: UTC day, not a timestamp. See the section note above: finer resolution reconstructs
    #: the patient link this table is built to not have. Indexed because the only query this
    #: table ever needs to serve besides a full export is a retention sweep.
    logged_on: Mapped[date] = mapped_column(sa.Date, index=True, nullable=False)
