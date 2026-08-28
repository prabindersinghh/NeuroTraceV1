# PLAN — caretaker onboarding, linking and scoping

**Status: PLAN ONLY. Nothing in this document has been built.**

The caretaker is the family member who actually holds the phone most days — a son or
daughter, with the patient being their parent. They are not a clinician and not the
existing `caregiver` role (see §1, which is the first thing to settle).

**The one part of this that is not deferrable is the access boundary.** A caretaker
reaching another patient's data is the same class of defect as the six-route bug the
endpoint audit found: a scoping rule that exists in one place and not the others. It is
specified in §5 and pinned in §7, and it is built with the feature, not after it.

Auth polish — password rules, email/phone verification, session management — is explicitly
deferred to a later auth pass. **That deferral covers credential quality, not authorisation.**

---

## 1. The role question, settled first

There is already a `caregiver` role, and it is the *owner* of a patient: `Patient.caregiver_id`
is non-nullable, the caregiver enrols the patient, grants and withdraws all six consents,
creates clinician links, and is the only actor who can erase. Every existing access rule that
says "the owning caregiver" means that row.

**A caretaker is not that.** The flow in this brief is: the patient signs up first, and the
app then creates a caretaker login *for* that patient. So the caretaker arrives second,
attached to an existing patient, and there may eventually be more than one of them (two
siblings sharing the load is the normal case, not an edge case).

**Recommendation: a new `Role.caretaker`, and a new `patient_caretaker_links` table.**
Rejected alternatives, with reasons:

- **Reuse `caregiver` and add rows.** Breaks immediately: `Patient.caregiver_id` is a single
  non-nullable FK, so a second caregiver has nowhere to live, and every "only the owning
  caregiver" check would silently start admitting a second person to consent changes and
  erasure. That is a privilege widening disguised as a reuse.
- **Reuse `patient_clinician_links` with a different `clinician_role`.** The table is named,
  indexed, audited and *queried* as clinician linkage (`clinician_is_linked`,
  `/clinic/patients`, the admin doctor census counts its rows). Putting family in it would
  make the admin doctor census count family members as doctors — a wrong number on an
  operator surface, which is exactly the kind of quiet drift this project keeps finding.

**But the SHAPE is copied deliberately**, field for field, because it has already been
reviewed and it encodes lessons this feature would otherwise re-learn:

```
patient_caretaker_links
  id                uuid pk
  patient_id        uuid  -> patients.id   ON DELETE CASCADE, indexed
  caretaker_id      uuid  -> users.id      ON DELETE CASCADE, indexed
  relationship      enum CaretakerRelationship (SON | DAUGHTER | SPOUSE | SIBLING | OTHER)
  linked_by         uuid  -> users.id      ON DELETE SET NULL
  linked_at         timestamptz  not null
  unlinked_at       timestamptz  NULL = active          <- the whole access rule
  unlinked_by       uuid  -> users.id      ON DELETE SET NULL
  unlink_reason     varchar(400)
  consent_ref       varchar(64)            <- populated AT CREATION, see §3
  INDEX ix_pcl_care_patient_active   (patient_id, unlinked_at)
  INDEX ix_pcl_care_caretaker_active (caretaker_id, unlinked_at)
```

`unlinked_at IS NULL` means active, and revocation **never deletes the row** — the same INV-8
reasoning as the clinician link: who could see this patient, and until when, has to stay
recoverable.

**One difference from the clinician link, on purpose:** `consent_ref` is populated at
creation, not nullable-then-backfilled. D-046 exists because Part 3 shipped links whose
consent lived only in an audit event and needed a migration to reference properly. There is
no reason to repeat that; the consent table already exists.

---

## 2. The onboarding → caretaker-creation flow

The patient onboards professionally first (existing flow, unchanged). The caretaker is
created afterwards, attached to that patient.

```
1. Patient completes onboarding.                        (existing, untouched)

2. Owning caregiver opens "Add a family member".
   Supplies: caretaker name, relationship, and ONE contact identifier
             (email or phone — see the auth deferral below).

3. Server, in ONE transaction:
     a. create users row, role = caretaker, no usable password yet
     b. create patient_caretaker_links row (active)
     c. grant CARETAKER_SHARING consent, capture the new consents.id
     d. write link.consent_ref = that id
     e. AuditLog "caretaker.link.granted" with the consent_ref
   Any failure rolls the whole thing back. A user account that exists without its
   link, or a link without its consent, is precisely the half-created state that
   produces a cohort nobody can reason about later.

4. Server returns a one-time invite token. The caretaker sets their own credential.
```

**Who is allowed to perform step 2 — decide before building.** The brief says "the app
creates a caretaker login", which does not name an actor. The defensible default is **the
owning caregiver only**, mirroring `create_link`'s rule that a clinician cannot link
themselves. A caretaker must never be able to create another caretaker, or the link stops
being an access control the moment one account is compromised. **Flagged for the owner:** if
the intent is that the *patient* adds their own family member, that is a different rule and
needs saying, because a patient account is the least protected one in the system.

**The auth deferral, stated precisely.** Step 4 needs an invite mechanism, and invite tokens
are auth. Until the auth pass:
- the account is created **disabled** (no usable password hash) and cannot log in;
- therefore steps 1–3 are safe to build now and step 4 is stubbed;
- **and the scoping in §5 is built and tested anyway**, against caretaker accounts created
  directly in tests. The boundary must be provably correct *before* the first real caretaker
  can log in, not after.

---

## 3. Consent: one new value, no parallel mechanism

Add exactly one value to the existing `ConsentType` enum:

```python
#: C7 — sharing this patient's full clinical picture with a linked family caretaker.
#: Same shape and same enforcement path as CLINICIAN_SHARING: withdrawing it stops
#: caretaker access immediately, independently of whether the link row is still active.
CARETAKER_SHARING = "CARETAKER_SHARING"
```

- Additive migration, widening the `consent_type_enum` CHECK constraint. Follow the
  widen → (no rewrite needed) → narrow pattern and pass the **bare** constraint name to
  `batch_alter_table` — passing the rendered name doubles the prefix, the trap 0003, 0012 and
  0015 all hit.
- **Not** default-OFF. C4/C5 are default-OFF because the product does not need them to
  function; a caretaker who cannot see anything is not a feature. It is granted explicitly at
  link creation (§2 step 3c) and is withdrawable from the same settings surface as the others.
- `services/consent.py` needs no structural change: `CURRENT_VERSIONS` is built with a dict
  comprehension over `ConsentType`, so the new value picks up a version automatically.
- Withdrawal semantics are already correct and inherited for free — `set_consent` mutates the
  in-force row's `withdrawn_at` rather than writing a new decision.

**Do not** add a `caretaker_can_view` boolean anywhere. A second mechanism for the same
question is how the two end up disagreeing.

---

## 4. The notification channel (WhatsApp), as health-adjacent PII

A caretaker's WhatsApp number is not contact metadata. Combined with the link it says *this
person is caring for a stroke survivor*, which is a health inference about a named
individual. It is treated accordingly.

```
caretaker_channels
  id              uuid pk
  caretaker_id    uuid -> users.id ON DELETE CASCADE, indexed
  patient_id      uuid -> patients.id ON DELETE CASCADE, indexed   <- see below
  channel         enum NotificationChannel (WHATSAPP | SMS | EMAIL)
  destination     varchar(190)      the number/address
  verified_at     timestamptz       NULL until the channel is proven reachable
  created_at      timestamptz
  revoked_at      timestamptz       NULL = active
```

Four rules, each with a reason:

1. **Scoped per patient, not just per caretaker.** A caretaker linked to two parents should be
   able to route each one's updates differently, and — more importantly — erasing one patient
   must remove that patient's channel without touching the other.
2. **Deleted on erasure.** `services/erasure.py` gains `caretaker_channels` to its
   `_PATIENT_SCOPED` sweep. This is the half most likely to be forgotten, because the row is
   keyed on a *user* as well as a patient; `DATA_INVENTORY.md` gets a row saying so.
   The **link itself is revoked, not deleted**, exactly as clinician links are.
3. **Invisible to admin (D-041).** No admin surface may return a destination, a count of
   destinations per patient, or anything from which one could be derived. `/admin/doctors`
   already sets the precedent for what operational metadata about *staff* is allowed;
   caretakers are family, and family are not staff.
4. **Never in an audit `meta_json`.** `audit_log` is append-only and survives erasure by
   design (D-050). Writing a phone number into it would make that number un-erasable — the
   retention property becomes a liability the moment the field holds PII. Log
   `channel_id`, never `destination`.

**Outbound content is a separate decision, flagged not assumed.** What a WhatsApp message
actually *says* is a clinical-communication question — the existing rule is that WATCH does
not notify and no message reassures (`lib/notify.ts`). Reuse those rules; do not invent a
second notification vocabulary. Sending band names to a third-party messaging provider is an
egress decision that deserves its own line in `SECURITY.md`.

---

## 5. Scoping — the part that is not deferred

**One function, mirroring `clinician_may_access_patient` exactly:**

```python
async def caretaker_may_access_patient(session, caretaker_id, patient_id) -> bool:
    """Active link AND current C7 consent. Neither alone is sufficient."""
    if not await caretaker_is_linked(session, caretaker_id, patient_id):
        return False
    return await consent_currently_granted(session, patient_id,
                                           ConsentType.CARETAKER_SHARING)
```

and `caretaker_is_linked` must be callable from **nowhere else**, so no route can obtain the
link check without the consent check. That single-choke-point property is what made the
clinician fix hold, and it is the property to verify in review.

`get_patient_for_user` in `auth/deps.py` gains one branch:

```python
if not allowed and user.role is Role.caretaker:
    allowed = await caretaker_may_access_patient(session, user.id, patient.id)
```

**Routes that inherit this for free** (they already depend on `get_patient_for_user`):
`GET/PATCH /patients/{id}`, `GET /dashboard/{id}`, `GET /report/{id}`, `GET /trace/{id}`,
`GET /audit/{id}`, the Awaaz patient-scoped routes, `/vitals`, `/adherence`, `/wearable/*`,
`/sessions/{patient_id}/*`.

**Routes that must be changed by hand — these are the six-route lesson:**

| Route | Why it does not inherit |
|---|---|
| `GET /patients` | Explicit per-role dispatch. Needs a `caretaker` branch joining active links **and** filtering on C7, exactly like the clinician branch. **The `else: return []` fallthrough must stay** — that is what stopped the original leak. |
| `sessions.py:_assert_can_access` | Resolves the patient from a session, so it cannot use the dependency. Already mirrors `get_patient_for_user`; add the caretaker branch **in the same commit**. |
| `wearable.py:acknowledge_fall` | Same shape. Decide deliberately whether a caretaker may acknowledge a fall — clinically they probably should, since they are the person in the house. |
| `dashboard.py:acknowledge_alert` | Currently `require_roles(Role.clinician)`. **Recommend NOT extending to caretakers**: acknowledging an alert is a clinical action that closes a loop. A caretaker seeing it is right; a caretaker silencing it is not. |
| `/consents/*` | `_require_owning_caregiver` must stay caregiver-only. A caretaker must not be able to grant or withdraw their own access. |
| `DELETE /patients/{id}` | Erasure stays owning-caregiver only. |

**"Sees everything" means everything clinical, not everything administrative.** The brief says
nothing is hidden from family, and that is right for bands, drivers, trends, confounders,
reports and history. It does not extend to consent management, erasure, or linking other
people — those are the owner's controls, and a caretaker holding them would make the caregiver
role meaningless.

---

## 6. Migration plan

Two migrations, **kept separate** — the same discipline as 0014/0015:

- **`0018_caretaker_links.py`** — purely additive: `Role` enum widened with `caretaker`,
  `patient_caretaker_links`, `caretaker_channels`, plus indexes. No existing row touched.
- **`0019_caretaker_consent.py`** — the `consent_type_enum` CHECK widening. A constraint
  rewrite, isolated so the risk sits in one small reviewable migration.

Both must round-trip `upgrade head` → `downgrade base` (INV-7, both directions), and both must
be checked with `alembic upgrade --sql` against Postgres — rendering is not running (D-014).
`Role` is stored via `native_enum=False` (VARCHAR + CHECK), so widening it is a constraint
rewrite too, not a Postgres `ADD VALUE`.

---

## 7. The tests that pin it

Mirror `test_patient_clinician_link.py`, which is the template: **assert the absence of the
bad behaviour, not just the presence of the good one.**

```
test_caretaker_link.py

  # the boundary — the reason this is not deferred
  a caretaker gets 403 on a patient they are NOT linked to          <- the headline
  ... across dashboard, report, trace, audit, sessions/modules,
      finalize, vitals, adherence, wearable  (parametrised over routes,
      so a NEW patient-scoped route added later without scoping fails here)
  an unlinked caretaker sees an empty list from GET /patients
  a caretaker linked to patient A gets 403 on patient B while A still works
      ^ the two-patient case: proves it is scoping, not a blanket deny

  # the feature
  a linked, consented caretaker reads the full dashboard, report and trends
  a linked caretaker sees ONLY their own patient in GET /patients

  # consent is load-bearing, not decorative
  withdrawing C7 blocks a STILL-LINKED caretaker immediately
      ^ leave the link active on purpose, or the test proves nothing
  withdrawing C7 removes the patient from the caretaker's list
  re-granting C7 restores access
  a caretaker CANNOT grant or withdraw their own C7            (403)
  a caretaker CANNOT link another caretaker                     (403)
  a caretaker CANNOT erase the patient                          (403)

  # the link is a record, not a toggle
  revoking a link sets unlinked_at and keeps the row; access stops
  link + revoke both write audit rows
  link creation populates consent_ref (no nullable-then-backfill; D-046)

  # PII handling
  erasure deletes caretaker_channels and revokes the link without deleting it
  no admin route returns a destination, or any count derived from one
      ^ extend test_no_admin_response_contains_patient_identifying_data with a
        real linked caretaker + channel present, the way the doctor census test
        was extended — the leak-tempting shape has to be in the fixture
  no audit meta_json anywhere contains a destination string

  # the single choke point
  caretaker_is_linked is called from exactly one place: inside
  caretaker_may_access_patient        (source assertion, same idiom as
                                       test_baseline_phase.py's pins)
```

The last one is worth writing even though it looks like a style check. It is the property
that would have prevented the six-route bug, and a source assertion is the only thing that
catches a *new* route calling the link check directly.

---

## 8. Out of scope for this plan

- Password rules, verification, session management, invite-token expiry — the auth pass.
- What the WhatsApp message says, and the provider integration — needs its own decision and a
  `SECURITY.md` egress entry.
- Any caretaker-facing UI beyond noting that the existing caregiver dashboard is the natural
  starting point.
- Multiple caretakers per patient is **supported by the schema** but the UI for managing more
  than one is not planned here.

## 9. Open questions for the owner

1. **Who creates the caretaker** — owning caregiver only (recommended), or may the patient?
2. **May a caretaker acknowledge an alert or a fall?** Recommendation: fall yes, alert no.
3. **Is the caregiver also a caretaker in practice?** In many households the son who enrols
   the parent *is* the family member. If so, the caregiver already has full access and the
   caretaker role is for *additional* family — worth confirming, because it changes whether
   this feature is common or occasional.
4. **C7 default on withdrawal of C2** (`DATA_PROCESSING`): if the underlying processing
   consent is withdrawn, should C7 be treated as moot? Currently each consent is independent;
   this is the one place that independence may be surprising.
