# Security — Part 5.5

Auth model, role matrix, CORS, secrets, backup/recovery, and incident response.

Last updated: 2026-08-28. Companion documents: `ENDPOINT_DATA_AUDIT.md` (every route and
its gate), `DATA_INVENTORY.md` (what is stored and how it is deleted), `SBOM.md`
(dependencies and their advisory notes).

---

## Authentication

**JWT bearer tokens**, `PyJWT`, access + refresh pair issued by `/auth/login` and
`/auth/register`, refreshed at `/auth/refresh`. Lifetimes are configurable and exposed
(without secrets) at `/auth/config`.

**Passwords**: bcrypt at 12 rounds via `passlib`, truncated explicitly at 72 bytes so a long
password cannot raise. See `SBOM.md` finding 2 — `passlib` is unmaintained and this is why
`bcrypt` is pinned at 4.0.1.

**Registration is role-restricted server-side.** `/auth/register` accepts `caregiver` and
`patient` only. `clinician`, `asha_worker` and `admin` are provisioned by
`POST /admin/users` (admin-only, audited) or by the seed. Until 2026-08-24 the role came
from the request body, so a stranger could self-assign `clinician` and read every patient's
name — that is D-040, and this restriction is the fix.

---

## Authorisation

**INV-6: enforced server-side on every scoped route. UI hiding is never the boundary.**

### Role matrix

| Role | Can see | Can do |
|---|---|---|
| `patient` | their own check-in only | run the battery. No scores, no band, no dashboard. |
| `caregiver` | only their own patients: status, "what changed", report, confounders, trends, FAST | enrol, run exams, log symptoms/vertigo, acknowledge falls, grant/withdraw consent, erase |
| `clinician` | **only linked, C3-consented patients**: trajectory, drivers, baseline review, audit, export | acknowledge alerts, CONFIRM/EXTEND/FLAG_CONCERN a baseline |
| `asha_worker` | **only assigned households**: name, age, village, due modules | run deep assessment, sync visits. Never bands or history. |
| `admin` | **operational only**: counts, band distribution, gate funnel, identity-flag rate, audit trail (patient refs truncated to 8 chars), clinician census | provision privileged accounts. **No patient clinical content at all.** |

### The clinician access rule, precisely

A clinician may read a patient only when **both** hold:

1. an **active** row in `patient_clinician_links` (`unlinked_at IS NULL`), created by the
   owning caregiver — a clinician cannot link themselves; and
2. **C3 (`CLINICIAN_SHARING`) consent currently in force** (Part 4).

Both are checked in one place, `app.auth.deps.clinician_may_access_patient`. A link answers
"is there a relationship"; consent answers "may it see data right now". Withdrawing consent
takes effect immediately without touching the link, and revoking the link takes effect
without touching consent.

**This centralisation is itself the security control.** The Part 5.1 audit found six routes
that had each reimplemented the access check locally and never received the Part 3.2 fix —
including one (`sessions.py:_assert_can_access`) that still granted any clinician account
read **and write** access to any patient's raw module features. Every one of those call
sites now delegates to the single function. See `ENDPOINT_DATA_AUDIT.md` for the full list
and the regression tests that pin each.

### Admin is deliberately not a superuser

`get_patient_for_user` does not special-case `admin`. An administrator who can read patient
records is a backdoor around INV-11 with a friendlier name, and in a product whose central
claim is that raw data never leaves the device, an "admin sees everything" panel would be
the loudest possible contradiction. Admin surfaces return counts and events by construction,
and `test_no_admin_response_contains_patient_identifying_data` asserts the shape so adding a
patient name to any admin payload fails the build.

The one admin surface carrying names is `/admin/doctors` — a roster of **staff**, with
patient involvement expressed as an integer count and **no drill-down route anywhere**.

### Documented exceptions to INV-6

Two, both deliberate:

1. **`GET /awaaz/listen/{token}`** — no auth. The unguessable 128-bit token *is* the
   capability. TTL-capped, revocable, returns a caregiver-chosen alias rather than the
   enrolled patient name, exposes at most 5 recent confirmed utterances from the last 24h.
   A stranger helping an aphasic person speak cannot be asked to create an account. The
   mitigation is that the page carries no patient identity, so a forwarded link leaks a
   first name the caregiver chose.
2. **`GET /safety/fast`, `GET /safety/symptoms`** — public and static. Emergency guidance
   must never return 401.

---

## The invariants as security controls

| | |
|---|---|
| **INV-1** | Raw media never leaves the device. No endpoint accepts an upload, no table has a binary column, and no registered route declares a binary request body — three independent tests. This is the product's central privacy claim: the moment one endpoint accepts an upload "just for debugging", the claim is false for every patient on that build and nobody outside the repo can tell. |
| **INV-8** | Audit is append-only. No code path deletes from `audit_log`. Erasure *adds* to it. |
| **INV-11** | No patient identifier in this repository. Enforced by `test_privacy.py`, plus a `git push` preflight (`scripts/preflight_push.sh`, 7 checks) because untracked real medical photos live under the git root. **Never bypass the preflight** — a failure is the invariant working. |

---

## CORS

Configured in `app/main.py` from settings, origin-allowlisted rather than `*`. The
frontend origin (`neuro-trace-v1.vercel.app`) and local dev origins are the intended
entries. **Verify the deployed allowlist does not contain a wildcard** before any real-data
deployment — with credentialed requests a wildcard is both a vulnerability and invalid.

## Secrets

- Supplied by environment variable only (`pydantic-settings`); `.env` is git-ignored and
  never committed.
- `JWT_SECRET`, `DATABASE_URL` and `DEMO_PASSWORD` are the security-relevant ones.
- **`DEMO_MODE` must be `false` in any deployment carrying real patients.** `POST /demo/seed`
  is public by design and returns demo credentials in plaintext; the flag is the real
  control. It seeds a synthetic patient only, so it is not a data-exposure risk in itself —
  the risk is leaving a public seeding endpoint enabled.
- No secret is logged. No secret appears in any API response.

## Transport

HTTPS end to end in deployment (Railway and Vercel both terminate TLS). The camera and
microphone APIs the exam depends on require a secure context, so HTTP is not merely
discouraged — the product does not function over it, except on `localhost`.

## Backup and recovery

Neon Postgres provides point-in-time recovery; the retention window is whatever the Neon
plan gives and **should be confirmed against the actual plan rather than assumed**.

Migration safety is the recovery property that has actually been exercised here:
- Every migration round-trips `upgrade head` → `downgrade base` cleanly, tested.
- **INV-7: migrations never lose rows**, both directions.
- Rendering a migration is not running it (D-014): `alembic upgrade --sql` emits `op.execute`
  text unchanged, so a SQLite-ism renders identically for Postgres and only fails when a real
  Postgres parses it. Two did, on the first Neon boot.
  `backend/tests/test_migration_portability.py` guards this.
- A deploy reporting SUCCESS is not a healthy app. Check `/health` for `database: up`, then
  run `scripts/verify_deploy.sh`.

## Incident response — outline

1. **Contain.** Revoke the affected credential (rotate `JWT_SECRET` to invalidate all
   sessions at once; rotate `DATABASE_URL` if the database is implicated). Set
   `DEMO_MODE=false` if it is not already.
2. **Assess scope from the audit trail.** `audit_log` is append-only and survives patient
   erasure, so "who accessed what, when" is answerable. `/admin/audit` gives an operator
   the tail without exposing clinical content; `GET /audit/{patient_id}` gives the
   per-patient view to an authorised caller.
3. **Determine what could have been exposed.** Consult `DATA_INVENTORY.md`. Note that
   **no raw audio, video or images exist server-side at all** (INV-1) — that bounds the
   worst case substantially, and it is the main reason the architecture is shaped this way.
4. **Notify** per the applicable obligations. `docs/INTENDED_USE.md` is the frozen statement
   of what this product is and is not; do not make new claims under pressure.
5. **Fix, with a test.** The house rule: any structural rule gets a numbered INV and a test.
   A fix without a test is how the same incident recurs.
6. **Record it** in `docs/CHANGELOG.md` with what was verified, not what is believed.

## Known gaps

- **No rate limiting** on `/auth/login`. Brute-force protection relies on bcrypt cost alone.
  Worth adding before real-patient deployment.
- **No account lockout** or failed-attempt tracking.
- **No live dependency-advisory scan** has been run — see `SBOM.md`.
- **`python-multipart` is installed but unused** — removing it would make INV-1
  structurally enforced rather than test-enforced. See `SBOM.md` finding 1.
- **No time-based retention policy.** Nothing expires automatically; data persists until
  erasure is requested. See `DATA_INVENTORY.md`.
