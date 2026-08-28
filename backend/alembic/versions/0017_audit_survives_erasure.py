"""Part 5.4: patient erasure, without destroying the audit trail.

THE BUG THIS WORKS AROUND, verified by probing a real database rather than assumed:
`audit_log.patient_id` carries `ondelete="CASCADE"`, so deleting a `patients` row destroys
every audit entry for that patient. A probe confirmed it — one audit row before the delete,
zero after. That directly contradicts INV-8 (audit data is append-only), and it destroys
exactly the record that matters most after an erasure: who accessed this person's data,
and when, before it was removed.

THE APPROACH: erasure does not DELETE the patient row, it TOMBSTONES it. Every clinical
measurement is really deleted — sessions, module results, baselines, deviations, scores,
alerts, questionnaires, vitals, adherence, wearable readings, falls, Awaaz content. What
remains is a stripped row carrying no name, no age, no sex, no stroke details and no
identity vector: just the id, `erased_at`, and a reason.

Rejected alternative: dropping the foreign key so the patient row could be deleted outright.
That is a constraint rewrite on a table every other table references, on SQLite (which
rebuilds the whole table under `batch_alter_table`), to solve a problem a nullable column
solves additively. The tombstone also keeps audit linkage INTACT — `SET NULL` would have
kept the audit row while destroying the one thing that makes it useful.

The tombstone is not a privacy compromise: it holds no identifier. It is the record that an
erasure happened, which is itself something a deployment has to be able to show.

Revision ID: 0017
Revises: 0016
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Additive. No existing row touched, no constraint rewritten (INV-7).
    op.add_column("patients", sa.Column("erased_at", sa.DateTime(timezone=True)))
    op.add_column("patients", sa.Column("erasure_reason", sa.String(200)))


def downgrade() -> None:
    op.drop_column("patients", "erasure_reason")
    op.drop_column("patients", "erased_at")
