"""split the speech domain, and add the frozen reference baseline

Two clinical corrections.

SPEECH SPLIT. `speech_language` became `motor_speech` (M4 dysarthria) and `language`
(M5 aphasia). Dysarthria is a motor failure with the message intact; aphasia is a failure
of the message itself. They localise differently and mean different things. Merged, they
also could not corroborate each other under Gate 2 — two modules in one domain count once.

FROZEN REFERENCE. The adaptive baseline follows the patient, which is right for day-to-day
comparison and wrong for slow decline: the rolling median walks down with them and the
z-score never moves. At lock we now snapshot the baseline permanently and score every
session against both.

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-22
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ---------------- frozen reference on the baseline ----------------
    with op.batch_alter_table("baselines") as batch:
        batch.add_column(sa.Column("reference_median_json", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("reference_mad_json", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("reference_locked_at", sa.DateTime(timezone=True),
                                   nullable=True))
        batch.add_column(sa.Column("reference_n_sessions", sa.Integer(), nullable=False,
                                   server_default="0"))

    # Existing locked baselines have no snapshot. Seed it from their CURRENT values: that is
    # the best available estimate of this patient's established normal, and it is strictly
    # better than leaving them with no reference at all. Everything locked from here on gets
    # a true at-lock snapshot.
    op.execute(
        """
        UPDATE baselines
           SET reference_median_json = median_json,
               reference_mad_json    = mad_json,
               reference_n_sessions  = n_sessions,
               reference_locked_at   = COALESCE(window_end, updated_at)
         -- `locked = true`, not `= 1`. SQLite stores booleans as integers and accepts
         -- either; Postgres rejects `boolean = integer` outright with UndefinedFunction.
         -- This migration ran clean on SQLite for weeks and broke the first Neon boot.
         -- Rendering with `alembic upgrade --sql` cannot catch it: the text is literal,
         -- so it renders identically and only fails when a real Postgres parses it.
         WHERE locked = true AND reference_locked_at IS NULL
        """
    )

    # ---------------- cumulative drift on the score ----------------
    with op.batch_alter_table("scores") as batch:
        batch.add_column(sa.Column("cumulative_drift_json", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("cumulative_drift", sa.Float(), nullable=False,
                                   server_default="0"))
        batch.add_column(sa.Column("drift_flagged", sa.Boolean(), nullable=False,
                                   server_default=sa.false()))

    # ---------------- rename the speech domain in stored rows ----------------
    # Deviations carry the domain they were scored under. M4 and M5 are the only modules
    # that were ever in speech_language, so the mapping is exact rather than a guess.
    op.execute("UPDATE deviations SET domain = 'motor_speech' WHERE module_code = 'M4'")
    op.execute("UPDATE deviations SET domain = 'language' WHERE module_code = 'M5'")


def downgrade() -> None:
    op.execute(
        "UPDATE deviations SET domain = 'speech_language' "
        "WHERE domain IN ('motor_speech', 'language')"
    )

    with op.batch_alter_table("scores") as batch:
        batch.drop_column("drift_flagged")
        batch.drop_column("cumulative_drift")
        batch.drop_column("cumulative_drift_json")

    with op.batch_alter_table("baselines") as batch:
        batch.drop_column("reference_n_sessions")
        batch.drop_column("reference_locked_at")
        batch.drop_column("reference_mad_json")
        batch.drop_column("reference_median_json")
