# Governance keys — the approval boundary for ASR training

**Status: no key is pinned. The runtime refuses every real training command, which is the
correct state until a clinical owner exists.**

Real Awaaz ASR training will not start without a governance receipt signed by a key whose
public half is committed to this repository. This file is the procedure for creating that
key and issuing a receipt. It is written for the person who signs approvals, not for the
person who runs training, and the distinction between those two people is the entire point.

---

## What this mechanism is actually for

The training runtime already refuses a great deal: an unverified archive, a base model whose
hash does not match, a corpus too small or too uniform to split, a missing dependency. Those
checks all answer the question "is this input well-formed". None of them answers "did anybody
agree that this should happen".

A receipt is the answer to the second question, and it is only worth something if the person
running the training cannot produce one. That is why the scheme is asymmetric and why the
public keys live in tracked configuration rather than in an environment variable. An earlier
version used a symmetric HMAC with the trust root supplied by the operator; verifying a
receipt required the same key that signs one, so the check compared the operator's key against
the operator's own declaration of it and passed for anyone who held both. D-059 recorded that
as a known-broken property and D-067 records its replacement.

**If the person who can run training is also the person who commits the key, this mechanism
provides nothing.** It is not a technical control at that point, only a ritual.

---

## Who holds what

| Role | Holds | Never holds |
|---|---|---|
| Clinical owner (stroke neurologist / SLP, per the PRD) | the private key, offline | write access to the training host |
| ML engineer / training operator | the archive, the base model, the GPU host | the private key, in any form, on any machine they can reach |
| The repository | public halves only, in `governance_public_keys.json` | any private key, ever, including an example one |

The private key must not be committed, must not be pasted into an issue, and must not be
stored on a machine that also runs training. A password manager entry or a hardware token is
appropriate. A file in the repo, a shared drive the ML team can read, or a CI secret the
training job can read all defeat the boundary.

---

## Generating the keypair

The clinical owner runs this once, on their own machine. It needs `openssl` and nothing else —
no Python, no repository checkout, no training stack. Every command below was executed and
its output verified against the runtime's own verifier before this file was written.

```bash
# 1. The private key. This file never leaves this machine.
openssl genpkey -algorithm ed25519 -out neurotrace-governance-private.pem
chmod 600 neurotrace-governance-private.pem

# 2. The public half.
openssl pkey -in neurotrace-governance-private.pem -pubout -out neurotrace-governance-public.pem

# 3. The raw 32-byte public key as lowercase hex — this is what goes in the repository.
openssl pkey -in neurotrace-governance-public.pem -pubin -outform DER | tail -c 32 | xxd -p -c 32
```

Step 3 prints exactly 64 hex characters. An Ed25519 public key is 32 bytes; the DER wrapper
adds a fixed 12-byte header, which `tail -c 32` discards. If you get anything other than 64
characters, stop — something is wrong and a malformed key fails the whole file closed rather
than being skipped.

---

## Pinning the public key

Add one entry to `backend/app/ml/train/asr_runtime/governance_public_keys.json`:

```json
{
  "schema_version": 1,
  "keys": [
    {
      "key_id": "clinical-owner-2026",
      "algorithm": "Ed25519",
      "public_key": "<the 64 hex characters from step 3>",
      "not_before": "2026-09-01T00:00:00+00:00",
      "not_after": "2027-09-01T00:00:00+00:00",
      "holder": "Dr A. N. Other, stroke neurologist"
    }
  ]
}
```

Every field is required and every one is a string. `not_before` and `not_after` must be
timezone-aware ISO-8601 instants; a naive timestamp is refused rather than assumed to be UTC,
because assuming a local zone would silently shift a validity window by hours.

**This commit is a governance act, not a configuration change.** It should be made and
reviewed by someone other than the person who will run training, and the review should confirm
that the hex string came from the named holder rather than from whoever opened the pull
request. A key committed by the training operator is indistinguishable, to the runtime, from a
key the operator minted themselves.

Rotation is additive: add the new key with its own `key_id` and a `not_before`, and let the
old one expire. Do not edit a key in place — receipts already issued name the `key_id` they
were signed with.

---

## Issuing a receipt

The operator prepares the receipt body, because it names hashes only they can compute. The
clinical owner reviews it and signs it. Those are two different steps performed by two
different people, and collapsing them is the failure this document exists to prevent.

The receipt is a JSON object carrying, among other fields, the purpose, the approval status,
the data subject, the SHA-256 of the exact archive and of the exact base-model tree, the
consent record, the governance approval, and a validity window. The signature covers the
entire object except the signature value itself — so the algorithm and the `key_id` are
signed, and a receipt cannot be re-pointed at a different pinned key or downgraded to a weaker
algorithm without invalidating it.

The bytes that get signed are the receipt serialised as canonical JSON: keys sorted, no
whitespace, UTF-8, no NaN. In Python that is
`json.dumps(receipt_without_signature_value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")`.
Produce that file, then:

```bash
# The clinical owner signs the canonical bytes. Raw Ed25519 — no digest step, no padding.
openssl pkeyutl -sign \
  -inkey neurotrace-governance-private.pem \
  -rawin -in canonical-receipt.json \
  -out receipt-signature.bin

# 128 hex characters (64 bytes).
xxd -p -c 64 receipt-signature.bin
```

That hex string becomes `signature.signature` in the receipt, alongside
`"algorithm": "Ed25519"` and the `key_id` of the signing key.

`-rawin` matters. Ed25519 signs the message directly; there is no separate hashing step, and
`openssl dgst`-style invocations will produce something that does not verify.

---

## Checking it worked

The runtime refuses with a code and never a traceback, and the codes are specific enough to
diagnose from:

| Refusal | What it means |
|---|---|
| `governance_trust_root_missing` | no key is pinned — the shipped state |
| `governance_key_not_pinned` | the receipt's `key_id` is not in the tracked file |
| `governance_key_not_valid_now` | the pinned key's `not_before` / `not_after` window excludes now |
| `receipt_signature_invalid` | the signature does not verify, or the receipt was edited after signing |
| `signature_runtime_missing` | `cryptography` is not installed on this host |
| `receipt_not_approved` | status, purpose, or the export acknowledgement is wrong |
| `receipt_input_mismatch` | the archive or base-model hash does not match what was approved |
| `receipt_expired` / `receipt_not_yet_valid` | the receipt's own window excludes now |
| `consent_not_active` / `consent_scope_missing` | the consent record does not authorise this |

A receipt that verifies authorises exactly one training run against exactly one archive and
one base-model tree. It is not a standing permission, and re-running against different inputs
requires a new receipt because the hashes are inside the signature.

---

## What this does not give you

Signing authority separated from running authority is necessary and not sufficient. A valid
receipt says a named person approved a specific run; it says nothing about whether the
underlying corpus was consented, whether the cohort is appropriate, or whether the resulting
adapter helps anyone. Those remain the governance work described in `PRD_AWAAZ.md` §10.4 and
§16, and a receipt must never be cited as evidence for them.

Nor does it protect against a clinical owner who signs whatever they are handed. The
mechanism makes approval *attributable*; it cannot make it *considered*.
