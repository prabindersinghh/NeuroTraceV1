# DATASET ACCESS — what to send, today

Three datasets need a human to request them. They gate two of the five models, and the
turnaround is calendar time nobody can compress later. **Send UASpeech first** — it is the
slowest and the only one needing an institutional signature.

Nothing below is blocked on further code. All five training pipelines already run on
synthetic fixtures.

---

## 1. UASpeech — SEND FIRST (1–3 weeks)

**Gates:** `voice_dysarthria_clf` (impaired class)
**Site:** http://www.isle.illinois.edu/sst/data/UASpeech/
**Contact:** Prof. Mark Hasegawa-Johnson, University of Illinois Urbana-Champaign
**Target path:** `data/raw/uaspeech/`

**What you must provide:**
- A signed licence agreement. **It needs a signature from someone with institutional
  authority** — a university department head, or a company director if you are requesting
  as a company. This is the part that takes weeks, so identify the signatory today.
- Institutional affiliation and a work email at that institution. Personal Gmail is usually
  refused.
- A short statement of research purpose.
- An undertaking not to redistribute and not to attempt speaker re-identification.

**Purpose statement to adapt:**

> Non-commercial research on automatic detection of dysarthric speech, for a longitudinal
> post-stroke monitoring tool intended for use in India. We use the corpus to train a
> binary classifier over acoustic features (jitter, shimmer, HNR, DDK rate, articulation
> rate). No audio is redistributed, no attempt is made to identify speakers, and model
> outputs are advisory features within a deterministic clinical engine rather than
> diagnostic decisions.

**If you have no institutional affiliation**, say so in your first email and ask whether an
individual research agreement is possible. Do not sign as an institution you are not part
of — that ends the relationship permanently and these corpora are a small world.

---

## 2. TORGO — send today (days)

**Gates:** `voice_dysarthria_clf` (impaired class)
**Site:** http://www.cs.toronto.edu/~complingweb/data/TORGO/torgo.html
**Contact:** Department of Computer Science, University of Toronto (email address is on
that page; it changes, so take it from the page rather than from here)
**Target path:** `data/raw/torgo/`

**What you must provide:** name, affiliation, and a one-paragraph purpose. Lighter than
UASpeech — usually no signature.

**Email to adapt:**

> Subject: TORGO database access request — post-stroke speech monitoring research
>
> Dear TORGO maintainers,
>
> I am requesting access to the TORGO database for non-commercial research. We are building
> a longitudinal neurological monitoring tool for stroke survivors in India, and are
> training a classifier that produces a dysarthria-likelihood feature from acoustic
> measures we already extract on-device (jitter, shimmer, HNR, DDK rate, articulation
> rate).
>
> We will not redistribute the audio, will not attempt speaker identification, and will
> publish our metrics together with an explicit limitations note — including that TORGO is
> English and predominantly cerebral-palsy dysarthria, while our users are Hindi- and
> Punjabi-speaking stroke survivors.
>
> [name, affiliation, contact]

---

## 3. mPower — same day once certified

**Gates:** `asymmetry_discriminator` — the empirical evidence behind Gate 3
**Site:** https://www.synapse.org/#!Synapse:syn4993293
**Target path:** `data/raw/mpower/`

**Steps, all self-service:**
1. Register at synapse.org.
2. Complete the **Data Use Certification** — a short online quiz on human-subjects data.
3. Agree to the mPower-specific conditions of use.
4. Download the tapping activity export.

**No human approval step.** You can finish this in an afternoon. Do it after sending the
two emails above.

---

## Open, no request needed

Run `./scripts/download_datasets.sh` — LibriSpeech and PhysioNet AF download directly.
Common Voice (Hindi, Punjabi) needs a free Mozilla account for the link but no approval.

---

## Suggested order for today

1. Identify who can sign for UASpeech, and email them. **This is the long pole.**
2. Send the TORGO email.
3. Start the Synapse certification.
4. Run `./scripts/download_datasets.sh` in the background.

## What each unlocks

| Dataset | Model | Consequence if never granted |
|---|---|---|
| UASpeech + TORGO | `voice_dysarthria_clf` | No dysarthria-likelihood feature. The engine still works — it is one advisory feature among many, never a decision. |
| mPower | `asymmetry_discriminator` | Gate 3 keeps resting on the anatomical argument (stroke is focal, Parkinson's is symmetric) without a confusion matrix behind it. Defensible, but weaker to a clinical reviewer. |

Neither is on the critical path to a working product. Both are on the critical path to being
able to *defend* it.
