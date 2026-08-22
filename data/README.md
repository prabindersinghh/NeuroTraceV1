# Datasets — source, licence, consent

Every dataset used to train anything in this project, and the terms it came under. This
exists because someone will ask, and because the answer should not need reconstructing.

**Nothing in `data/raw/` is committed.** The directory is gitignored. These are other
people's recordings, held under licences that do not permit redistribution.

Fetch with `./scripts/download_datasets.sh`.

---

## Summary

| Dataset | Used for | Licence | Access | Path |
|---|---|---|---|---|
| TORGO | dysarthria classifier (positive) | Research use, by agreement | **Email request** | `data/raw/torgo/` |
| UASpeech | dysarthria classifier (positive) | Signed institutional agreement | **Request form** | `data/raw/uaspeech/` |
| LibriSpeech | dysarthria classifier (control) | CC BY 4.0 | Open | `data/raw/librispeech/` |
| Common Voice hi/pa | dysarthria classifier (control) | CC0 | Open, account needed | `data/raw/commonvoice/{hi,pa}/` |
| PhysioNet AF 2017 | rhythm irregularity | ODC-BY 1.0 | Open | `data/raw/physionet_af2017/` |
| mPower | asymmetry discriminator | Synapse DUC | **Certification** | `data/raw/mpower/` |

**Start the three gated ones first.** UASpeech in particular can take weeks.

---

## Per dataset

### TORGO
Dysarthric and control speech, University of Toronto / Holland Bloorview.
Consent: participants consented to research use and redistribution to researchers under
agreement. Speakers are identified by code only.
**Population caveat:** mostly cerebral palsy and ALS, not stroke. English. n ≈ 8 impaired
speakers. This is a real mismatch with our users and is stated in the model card.

### UASpeech
Dysarthric speech, University of Illinois. Isolated words, close-talking microphone array.
Consent: institutional review, redistribution under signed agreement.
**Population caveat:** cerebral palsy, English, isolated words rather than connected speech.
Our features are extracted from connected speech and sustained phonation, so several do not
transfer cleanly.

### LibriSpeech
Read audiobook speech, from LibriVox public-domain recordings. CC BY 4.0.
Consent: public-domain source material, volunteer readers.
**Caveat:** read speech from healthy adults is an *easy* negative class. A classifier
separating TORGO from LibriSpeech may be separating recording conditions rather than
pathology. Common Voice is included partly to blunt this.

### Common Voice (Hindi, Punjabi)
Crowd-sourced read speech, Mozilla. CC0.
Consent: contributors donate recordings to the public domain.
**Why it is here:** it is the only control set that matches our users' *languages*. Still
read speech and still healthy adults, so the caveat above only partly lifts.

### PhysioNet/CinC 2017 AF Challenge
Single-lead ECG, ~8,500 records, AliveCor device. ODC-BY 1.0.
Consent: de-identified, released for the challenge.
**Modality caveat:** single-lead ECG. We derive intervals from a fingertip or wrist PPG,
which is noisier and far more motion-sensitive. Field performance will be worse than the
published figures, and the model informs an advisory to get an ECG — never a diagnosis.

### mPower
Parkinson's disease mobile study, Sage Bionetworks. Synapse account plus data-use
certification.
Consent: participants consented via an electronic informed-consent flow, with an explicit
sharing choice; only the broad-sharing subset is available.
**Used for:** demonstrating empirically that our asymmetry ratio separates Parkinson's
(bilateral) from stroke (lateralised). This is the evidence behind Gate 3.
**Caveat:** self-selected, smartphone-owning, skews younger and more affluent than our
users. It supports the *direction* of the claim, not a threshold.

---

## The one non-public source

`docs/CLINICAL_REFERENCE.md` records measurements from anonymised medical records of a real
post-stroke patient, shared with consent by a family member of the project owner.

**No identifying information is in this repository** — no name, patient identifier, hospital
identifier, date of birth or address. Only measured values and clinical findings.

Those numbers are calibration targets, not training data. Nothing is trained on them, and
one patient cannot establish sensitivity, specificity or a normal range.

---

## What we do not have

Stated plainly, because the gaps matter more than the holdings:

- **No dysarthric speech from stroke survivors.** Every impaired corpus above is cerebral
  palsy or ALS.
- **No dysarthric speech in Hindi or Punjabi.** Our users' languages appear only in the
  healthy controls.
- **No Indian post-stroke cohort at all.**
- **No labelled deterioration trajectories.** Nothing supervises "this patient got worse" —
  which is why the engine is deterministic and personal-baseline-driven rather than a
  trained classifier.
