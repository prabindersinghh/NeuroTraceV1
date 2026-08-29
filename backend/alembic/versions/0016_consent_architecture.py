"""Part 4: six independent consents, and the D-046 consent_ref backfill.

PURELY ADDITIVE. One new table (`consents`), no existing column touched or rewritten.

The data step matters more than the schema step here. Every Part-3-era row in
`patient_clinician_links` has `consent_ref IS NULL`, because the `consents` table did not
exist when it was created — even though real consent happened, evidenced by the
`clinician.link.granted` audit event each link already writes (see `app/models.py`,
`PatientClinicianLink`, D-046). Leaving those rows unreferenced forever would mean the
access-control change landing alongside this migration (`services.consent.
consent_currently_granted`, gating on a CLINICIAN_SHARING row that does not exist) locks out
every doctor-patient relationship created before today. So this migration MATERIALISES the
historical consent as a real `consents` row, sourced from the link's own `linked_at` /
`linked_by` — which is exactly what the audit event recorded — and threads the new row's id
back onto `consent_ref`. Nothing is invented; the evidence already existed, this just gives
it a queryable home.

Revision ID: 0016
Revises: 0015
"""
from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import context, op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None

CONSENT_TYPES = (
    "FOLLOW_UP", "DATA_PROCESSING", "CLINICIAN_SHARING",
    "RESEARCH", "MEDIA_TESTIMONIAL", "TELECONSULTATION",
)

#: Sentinel version for consent materialised from Part-3-era audit evidence rather than
#: captured through the real six-consent flow. Deliberately distinct from any real wording
#: version so a future reader can tell "we know this happened" from "we have their words".
BACKFILL_VERSION = "backfilled-pre-c3"


def _enum(values: tuple[str, ...], name: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=True,
                   validate_strings=True, length=24)


def upgrade() -> None:
    op.create_table(
        "consents",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("consent_type", _enum(CONSENT_TYPES, "consent_type_enum"), nullable=False),
        sa.Column("version", sa.String(24), nullable=False),
        sa.Column("granted", sa.Boolean(), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("granted_by", sa.Uuid()),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True)),
        sa.Column("withdrawn_by", sa.Uuid()),
        sa.Column("ip_address", sa.String(64)),
        sa.Column("device_context", sa.String(256)),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["granted_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["withdrawn_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_consents_patient_type", "consents", ["patient_id", "consent_type"])

    # --- D-046 backfill ---
    # Row-by-row in Python, not a single portable INSERT...SELECT, because the new
    # `consents.id` has to be threaded back onto that same link's `consent_ref` — a
    # correlated write-then-read-the-generated-id that a single statement cannot express
    # identically on both SQLite and Postgres. The number of pre-Part-4 links is small
    # (real clinician relationships, not synthetic bulk data), so row-by-row is not a
    # performance concern here the way a synthetic-fixture backfill might be.
    # OFFLINE-MODE GUARD. `alembic upgrade --sql` has no live connection, so `bind.execute`
    # returns None and this backfill raised `AttributeError: 'NoneType' has no attribute
    # 'fetchall'` — which stopped the Postgres RENDER dead at 0016 and silently took the
    # portability check for every later migration with it. That check is how this repo
    # catches SQLite-isms before a real Postgres does (D-014), so losing it is worse than it
    # looks.
    #
    # A data backfill cannot be expressed as static SQL anyway: it reads rows to decide what
    # to write. In offline mode it is therefore skipped with a visible marker in the emitted
    # script, rather than pretending to have run.
    if context.is_offline_mode():
        op.execute(
            "-- SKIPPED IN OFFLINE MODE: consent_ref backfill reads existing rows. "
            "Run this migration against a live connection (D-046)."
        )
        return

    bind = op.get_bind()
    links = bind.execute(sa.text(
        "SELECT id, patient_id, linked_at, linked_by FROM patient_clinician_links "
        "WHERE consent_ref IS NULL"
    )).fetchall()

    consents_table = sa.table(
        "consents",
        sa.column("id", sa.Uuid()),
        sa.column("patient_id", sa.Uuid()),
        sa.column("consent_type", sa.String()),
        sa.column("version", sa.String()),
        sa.column("granted", sa.Boolean()),
        sa.column("granted_at", sa.DateTime()),
        sa.column("granted_by", sa.Uuid()),
    )
    links_table = sa.table(
        "patient_clinician_links",
        sa.column("id", sa.Uuid()),
        sa.column("consent_ref", sa.String()),
    )

    for link_id, patient_id, linked_at, linked_by in links:
        consent_id = uuid.uuid4()
        bind.execute(consents_table.insert().values(
            id=consent_id, patient_id=patient_id, consent_type="CLINICIAN_SHARING",
            version=BACKFILL_VERSION, granted=True, granted_at=linked_at,
            granted_by=linked_by,
        ))
        bind.execute(
            links_table.update()
            .where(links_table.c.id == link_id)
            .values(consent_ref=str(consent_id))
        )


def downgrade() -> None:
    # Additive only. The backfilled consent_ref values point at rows this drops, but
    # `consent_ref` is a bare String column (not a foreign key — see PatientClinicianLink's
    # own docstring on why it is deliberately loose typed), so dropping `consents` leaves
    # `patient_clinician_links` with dangling-but-harmless string references rather than an
    # integrity error. No row in any other table is touched (INV-7).
    op.drop_index("ix_consents_patient_type", table_name="consents")
    op.drop_table("consents")
