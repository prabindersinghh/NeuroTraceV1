# ML data and adapter recovery runbook

**Status:** policy and code-recovery path implemented; encrypted patient-data/model backup
service and restore drill are required before any real training run.

## What is recoverable today

The source tree is protected by a dated recovery branch and a verified complete Git bundle.
That recovers code, migrations, tests, and reviewed synthetic metric fixtures. It does **not**
contain patient audio, consent receipts, database rows, model weights, or per-patient
adapters. At the time this recovery point was created, none of those training inputs or
weights existed in the workspace.

All real corpora live under the repository-level, gitignored `data/raw/` tree. Awaaz exports
and executable model weights are also gitignored. Git is never a backup system for either.

## Production recovery objectives

These are release requirements, not claims about the current local prototype.

| Asset | Target RPO | Target RTO | Required recovery source |
|---|---:|---:|---|
| source and infrastructure definitions | one reviewed commit | 30 minutes | protected remote branch + verified Git bundle |
| application database and deletion journal | 24 hours | 4 hours | encrypted database snapshots + append-only tombstone journal |
| approved shared-study corpus | 24 hours | 8 hours | encrypted, access-logged object storage in a separate account/project |
| live and frozen ASR adapters | one accepted training run | 8 hours | encrypted immutable model bundle + signed manifest |
| raw per-patient Awaaz export | no default server backup | not applicable | re-export locally under fresh, purpose-specific consent |
| voice-clone source recording | **must not be recoverable after required deletion** | not applicable | deletion receipt and tombstone only |

## Backup contract

Before a real model may be registered, one encrypted immutable bundle must contain:

1. adapter weights and configuration;
2. the base-model identifier and SHA-256 digest of the exact local base weights;
3. hashes of the verified training archive and purpose-specific governance receipt;
4. split seed and speaker/phrase-disjoint assignment digest;
5. dependency lock digest, source commit, training status, and evaluation status;
6. separate `live` and immutable `day-30-frozen` role pointers;
7. a SHA-256 digest for every bundled file.

Encryption keys must be managed separately from the backup store. Access must be least
privilege and logged. Patient audio, transcripts, identifiers, adapter weights, tokens, and
key material must never appear in Git, CI logs, or a metrics document.

## Deletion survives restore

Backups must not resurrect revoked data or models. Every deletion creates an append-only
tombstone outside the mutable database snapshot, containing only an opaque object ID,
object type, deletion time, and reason code. A restore is incomplete until the newest
tombstone journal has been replayed and every matching audio object, model bundle, cache,
and active registry pointer has been removed again.

Voice-clone source deletion and adapter deletion are permanent. A restored object whose
tombstone cannot be checked remains quarantined and unavailable; uncertainty never revives
it.

## Restore drill

Run this before the first real training job and at least quarterly afterward:

1. restore source from the protected branch and verify the Git bundle;
2. restore the database into an isolated environment with outbound network disabled;
3. restore one synthetic model bundle and verify every manifest digest;
4. replay tombstones and prove deleted fixtures remain absent;
5. verify `live` and `day-30-frozen` pointers resolve to different immutable digests;
6. run the privacy preflight and full backend suite;
7. record actual RPO/RTO, operator, date, input backup IDs, and result outside the repo.

A failed or unrecorded drill blocks real training and deployment. A synthetic dry-run may
exercise the manifest and restore logic, but it is not evidence that patient data or a model
was backed up.

## Policy-event log retention (`awaaz_policy_events`)

This table is the one asset here that is deleted on a schedule rather than on request, and
the reasoning is different enough from the rest of this document to be worth stating.

**What it is.** Awaaz candidate-ranking events: an opaque slate, the propensity of the
action shown, and what the person did. No patient column, no foreign key, no timestamp finer than a
UTC day — D-062. It is not audit data. The audit trail for these interactions is `audit_log`,
which stays append-only and is never swept (INV-8). This log is operational analytics held
under a purpose-specific consent for one declared purpose: offline policy comparison by
`app/ml/rl/offline.py`. Data held for a purpose has the life of that purpose.

**The window: 120 days.** Ninety days of accrual plus thirty days of review lag. Ninety
because an offline estimate is a statement about one named behaviour policy, so rows either
side of a version bump can never be pooled, and because ninety days is the quarterly cadence
this document already sets for the restore drill; thirty because a log exported on the last
day of a cycle still has to be run through `compare_policies` and argued about, and rows
expiring under an open review make its numbers unreproducible. The number is configurable
downward and cannot be configured upward: `MAX_RETENTION_DAYS` equals the default, in the
same idiom as the stringency floors on `EvaluationConfig`.

**The sweep.** `backend/app/services/policy_retention.py`. One bounded `DELETE` per
invocation over `logged_on < cutoff` and nothing else, committed immediately, so it cannot
hold locks across a backlog and an interruption is indistinguishable from not having called
it. It is idempotent — the effect is a function of the day, not of the call count — and it
reports aggregates only: table, window, cutoff, batch limit, rows deleted, expired rows
remaining. Never a row identifier. It runs either from `POST /awaaz/policy/retention/sweep`
under `require_roles(Role.admin)`, which is the routine path because this deployment has no
scheduler, or as `python -m app.services.policy_retention` for a restored database that is
not serving an API.

**What restore means here.** Nothing. That is the useful part: this table needs no tombstone
journal, because its deletion rule is a deterministic predicate, not a list of objects.
A restored snapshot is by definition no newer than the one it replaced, so re-running the
sweep after a restore removes at least everything the pre-restore sweeps removed, and more.
The correct post-restore action for this table is therefore step 4's replay reduced to a
single command: run the sweep. Its RPO and RTO are those of the application database row
above; it introduces no separate recovery source.

**The limitation, stated plainly.** This is expiry, not erasure. Because the table has no
patient column, a person asking to be rid of their events cannot be answered: the server
cannot determine which rows are theirs, and any mechanism that could would have to store the
link the table was deliberately built without — which is the same argument that keeps a
speaker key out of the cluster bootstrap in `offline.py`. The candidate identifiers in a row
are client-minted and opaque and afford no selection either. So a subject-erasure request
against this table can only be answered with the truth: the events cannot be identified, and
they will be gone within 120 days of being written. No deletion receipt is issued for an
individual, because there is no individual object to name in one.
