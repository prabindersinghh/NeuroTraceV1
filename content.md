# NeuroTrace landing page — content specification

**Reference site:** [neuro-trace-v1.vercel.app](https://neuro-trace-v1.vercel.app/)
**Observed:** 2026-08-31
**Status:** The copy below records the deployed landing page. A final section identifies
differences from the current branch and claims that require review before the next deploy.

## 1. Content strategy

### Audience

- Stroke survivors and family caregivers.
- Clinicians, ASHA workers, hospital partners, and evaluators.
- Technical reviewers assessing whether the product's claims match its architecture.

### Desired reader takeaway

> NeuroTrace measures short, repeatable signals at home, compares a patient with their own
> learned baseline, and refuses to alert unless a change persists, spans independent domains,
> and carries laterality. It reports observations rather than diagnosis and cannot detect an
> acute event.

### Voice

- Calm, direct, and human.
- Evidence-conscious rather than promotional.
- Plain English with clinical terms explained in context.
- Short headlines that make one claim at a time.
- Concrete failure cases instead of generic feature promises.
- Explicit about uncertainty, scope, synthetic data, and untested surfaces.

### Writing rules

1. Say “measures,” “reports,” “shows,” or “flags”; do not say “diagnoses,” “predicts a
   stroke,” “proves,” or “keeps you safe.”
2. Never use “you are fine,” “all clear,” or “nothing to worry about,” including translated
   variants.
3. Describe a seeded/synthetic visual every time it appears.
4. Keep the acute-emergency instruction visible near the first product promise.
5. Distinguish published population ranges from NeuroTrace results.
6. Use “their own baseline/history” consistently; do not imply a population-normal model.
7. Describe the three gates in the same order: persistence → cross-modality → laterality.
8. Never imply that an aphasic patient's speech can be completed or spoken without their
   confirmation.
9. Do not publish a duration, population, privacy, model, dataset, regulatory, or device
   validation claim without evidence and a named owner.

## 2. Metadata and navigation

### Deployed metadata

- **Title:** `NeuroTrace — a ~3-minute neurological exam, at home, every day`
- The current branch has already changed the title and description to a 90-second promise;
  see Section 16.

### Header

- Brand: `NeuroTrace`
- Section links:
  - `The gap`
  - `Whose normal`
  - `The decision`
  - `21 days`
  - `On the phone`
  - `What it measures`
  - `Limits`
- Secondary action: `Log in`
- Primary action: `Open the demo`
- Accessibility link: `Skip to content`

## 3. Hero

### Eyebrow

`POST-STROKE RECOVERY · MEASURED AT HOME · EN / हिं / ਪੰ`

### Headline

> Twenty minutes of neurology,
> every three months.
> Three minutes a day is more.

### Supporting copy

> Recovery happens at home, where nobody is measuring anything. NeuroTrace runs a
> three-minute neurological check on the survivor's own phone each morning and learns what
> normal looks like for that one person.

### Actions

- `Open the demo →`
- `See how it decides`

### Emergency caveat

> It reasons over days, so it cannot see a stroke that is happening now. Sudden weakness, a
> drooping face or slurred speech is an emergency — call 108 first, always.

### Hero instrument labels

- `SEVEN DOMAINS · ONE PERSON`
- `DAY 18`
- `SEEDED DEMO RUN · RUN YOUR POINTER ACROSS IT TO INSPECT ONE MORNING`
- Scroll cue: `THE ARGUMENT`

Screen-reader descriptions list the seven lanes and whether each carries a left/right side.

## 4. Section 01 — The gap

### Label

`01 · THE GAP`

### Headline

> Ninety days between
> appointments. One of them
> is measured.

### Body

> A neurologist sees a survivor for about twenty minutes, once every one to three months.
> What goes wrong in between goes wrong slowly — and is noticed when it has become a crisis.

### Ninety-day visual labels

- Sparse state: `■ EXAMINED · □ EIGHTY-NINE DAYS NOBODY LOOKED`
- Complete state: `■ NINETY MORNINGS, THREE MINUTES EACH`

### Incidence cards

| Figure | Label |
|---|---|
| `39–47%` | develop post-stroke cognitive impairment |
| `~60%` | still have aphasia or dysarthria past six months |
| `11–41%` | develop post-stroke depression |
| `1 in 4` | has a second stroke |

Qualifier: `PUBLISHED INCIDENCE RANGES. NOT MEASUREMENTS TAKEN BY THIS PRODUCT.`

## 5. Section 02 — Whose normal

### Label

`02 · WHOSE NORMAL`

### Headline

> Normal is a person,
> not a population.

### Body

> A stroke survivor is outside the population's normal range on the day they come home and
> on every day after — that is what a stroke is. So a population threshold either fires
> every morning until someone mutes it, or is widened until it can no longer see anything.
> We compare each morning to that person's own last twelve sessions instead.

### Comparison panels

- `AGAINST A POPULATION`
  - `Flagged every single day. Useless by the end of the first week.`
- `AGAINST THEMSELVES`
  - `Flat for eighteen days, then days 19–21 move. Same data, different reference.`

Canvas labels include `POPULATION NORMAL — 5th to 95th`, `HE IS DOWN HERE. EVERY SINGLE
DAY.`, `THEIR OWN NORMAL RANGE`, and `DAYS 19–21`.

## 6. The second problem — Laterality

### Eyebrow

`THE SECOND PROBLEM`

### Headline

> Three domains agreeing
> looks like overwhelming
> evidence.
> Sometimes it is evidence
> of the wrong thing.

### Body

> Parkinson's slows the hand, quietens the voice and flattens the face — all at once, and it
> is common in the age band we monitor. Persistence and corroboration alone would make it our
> most confident alert, for a condition this product does not monitor and cannot help with.

### Comparison A

- Title: `PARKINSON'S`
- Caption: `Three domains deviate, persistently, by the same amount on both sides.`
- Rows: `Face`, `Voice · NO SIDE`, `Hand`
- Verdict: `SYMMETRIC → PATTERN_ATYPICAL, NOT AN ALERT`

### Comparison B

- Title: `A STROKE`
- Caption: `The same three domains, the same magnitude — but the deviation has a side.`
- Rows: `Face`, `Voice · NO SIDE`, `Hand`
- Verdict: `ONE-SIDED → GATE 3 SATISFIED`

## 7. Section 03 — The decision

### Label

`03 · THE DECISION`

### Headline

> Three gates. All three,
> or it is not an alert.

### Body

> A false alarm does not cost one notification — it costs the product, because a muted tool
> detects nothing. Each gate refuses a specific way this system could have been fooled.
> Pick one.

### Gate-board labels

- `LAST 5 SESSIONS`
- `|z| ≥ 2.0`
- Domains: `Cranial nerves · FACE`, `Motor speech · VOICE`, `Motor · HANDS`
- Legend: `FILLED = OUTSIDE THEIR OWN BAND · TICK = THE FINDING CARRIES A LEFT/RIGHT SIDE`
- Gates:
  1. `Gate 1 · Persistence`
  2. `Gate 2 · Cross-modality`
  3. `Gate 3 · Laterality`
- States: `PASSED`, `STOPS HERE`, `NOT REACHED`

### Scenario: A bad night

- Title: `One poor session`
- Body: `He slept badly, the room was dim, and the capture was noisy. The face module
  deviates hard — on exactly one morning.`
- Band: `WATCH`
- Verdict: `Gate 1 stops it. One session is an event; two consecutive sessions are a
  finding. Recorded, visible to the clinician, silent to the family.`

### Scenario: A hoarse throat

- Title: `Every speech feature at once`
- Body: `A chest infection moves jitter, shimmer, breathiness, phonation time and pa-ta-ka
  rate together for three days. Five features agreeing looks like overwhelming evidence.`
- Band: `WATCH`
- Verdict: `Gate 2 stops it. Those five features are correlated — they are one domain, not
  five opinions. Corroboration has to come from anatomy that could not fail for the same
  reason.`

### Scenario: Parkinson's

- Title: `Three domains, and the wrong disease`
- Body: `Bradykinesia, hypophonia and masked facies arrive together and persist. Face,
  voice and hand all deviate for days. Under persistence and corroboration alone this is the
  highest-confidence alert this system can produce.`
- Band: `PATTERN_ATYPICAL`
- Verdict: `Gate 3 stops it — and this is the gate that earns its keep. A stroke damages
  one hemisphere and shows a side: one mouth corner, one hand. This is symmetric on every
  axis, so it is reported as a different pattern pointing at a different referral, not
  escalated as a stroke.`

### Scenario: The real thing

- Title: `Persistent, corroborated, one-sided`
- Body: `The same three domains, the same two days — but the deviation lives in the
  asymmetry features. The left corner, the left hand.`
- Band: `ALERT`
- Verdict: `All three. The family is told once, in their language, what changed and what to
  do — and not told again tomorrow while the band holds.`

### Recovery note

**Heading:** `And an improving trajectory never alerts.`

> A recovering patient deviates enormously from a baseline taken when they were worse. That
> is the largest signal this engine will ever see, and it is success.

## 8. Section 04 — Twenty-one days

### Label and heading

- `04 · TWENTY-ONE DAYS`
- `One alert for the episode. Not one every morning.`

### Instrument labels

- `SEEDED RUN · SEED 42`
- `DAY 01 / 21`
- Bands: `BASELINE`, `STABLE`, `WATCH`, `ALERT`
- Repeat state: `NO SECOND NOTIFICATION`
- Gate chips: `GATE 1`, `GATE 2`, `GATE 3`

### Day 1–15 narration

- Heading: `Collecting`
- Body: `Nothing is judged yet. A baseline needs twelve valid sessions before the engine
  has any opinion about what is normal for this person.`

### Day 16–18 narration

- Heading: `Inside the band`
- Body: `Three sessions against a learned baseline. Every domain sits inside its own range.
  Nothing is sent to anyone.`

### Day 19 narration

- Heading: `Three domains moved — and it is still not an alert`
- Body: `Face, voice and hand all broke the band this morning — the moment a threshold
  system would have called the family. Gate 1 is not satisfied: one session is an event.`

### Day 20 narration

- Heading: `The same three, a second consecutive session, and a side`
- Body: `Persistence, corroboration and laterality are all satisfied. The family is notified
  once, in their own language, with what changed and what to do.`

### Day 21 narration

- Heading: `The band holds. Nobody is notified again`
- Body: `Day twenty-one deviates as clearly as day twenty. The clinician sees it; the family
  does not get a second alarm about something they have already been told.`

### Caregiver message

> “Please check on them today. What changed: one corner of the mouth sat lower than the
> other, and the eyebrows lifted unevenly. These changes have shown up across more than one
> kind of check, on more than one day.”

Caption: `WHAT THE CAREGIVER'S PHONE SHOWS. NO NUMBER APPEARS IN IT — THE WORDING MODEL IS
NEVER GIVEN ONE.`

## 9. Section 05 — On the phone

### Label and headline

- `05 · ON THE PHONE`

> The server has no endpoint
> that accepts a recording.

### Body

> Landmarks and audio features are computed in the browser and the frames are dropped in the
> same tick. What syncs is a dictionary of numbers.

> This is not a policy someone has to remember. There is no upload route for audio, video or
> images anywhere in the API, and no column in the database that could hold one — so a
> deployment mistake cannot leak a recording that was never sent.

> The session completes in airplane mode and syncs later, because the model is served from
> our own origin and precached.

### Pipeline

1. **Capture** — `The camera and microphone run a task. Nothing is written to disk.`
2. **Extract, on device** — `MediaPipe landmarks and audio DSP turn the signal into numbers,
   in the browser.`
3. **Compare to their own history** — `Twelve sessions of their own past. Never a population
   average.`
4. **Three gates** — `Persistence, then corroboration, then a side.`
5. **Say it in their language** — `One guardrailed sentence in English, Hindi or Punjabi:
   what changed, and what to do.`

### Face diagram/live demo

- Labels: `BROW SYMMETRY`, `EYE APERTURE`, `MOUTH CORNER DROP`, `← LEFT / RIGHT`
- Prompt: `Diagram above. Run the real thing on your own face:`
- Action: `Use my camera`
- Explanation:

> The panel above is a labelled diagram, and says so. Turn on your camera and it is replaced
> by the real landmarker — the same pinned model the daily check-in loads — running on your
> face, in your browser. There is no stock portrait here on purpose: a real person's face
> under a medical overlay, on a page about stroke, is a claim nobody in a photo library
> consented to.

## 10. Section 06 — What it measures

### Label and headline

- `06 · WHAT IT MEASURES`

> Seven domains can raise a flag.
> Four of them carry a side.

### Body

> Twenty-one tasks. Six run every day inside the three-minute budget; the rest are weekly or
> monthly. Speech and language have no left or right — they can back up a one-sided finding,
> never establish one.

### Gating domains

| Domain | Copy | Modules | Side |
|---|---|---|---|
| Cranial nerves | Smile symmetry, mouth droop, eye aperture — and the forehead raise, which separates a stroke from Bell's palsy | M1 · M2 | Has a side |
| Motor speech | Voice quality, how long a breath lasts, and how regular “pa-ta-ka” stays | M4 | No side |
| Language | Naming, comprehension, word finding. A different lesion from slurred speech, so a separate domain | M5 | No side |
| Motor | Tap rate per hand, the left-right ratio, and arm drift | M6 · M7 | Has a side |
| Coordination & gait | Finger-to-nose, rapid alternating movement, walking and turning | M8 · M9 | Has a side |
| Posterior / vestibular | Eye-jump speed and delay, pursuit, standing sway, and their sense of upright | M3 · M9 · M21 | Has a side |
| Cognition | Reaction time and how variable it is; recall and visual attention | M10 · M11 · M12 | No side |

### Recorded but non-gating

- **Mood, fatigue & function · M13 · M14 · M15 · M16** — `PHQ-2, fatigue, daily
  function, swallowing. Recorded daily and shown to the clinician — but never gates an
  alert.`
- **Vitals & prevention · M17 · M18 · M19 · M20** — `Fingertip PPG rhythm, blood
  pressure, adherence, symptom report. Recorded daily and shown to the clinician — but
  never gates an alert.`

## 11. Section 07 — One morning, four views

### Label and headline

- `07 · ONE MORNING, FOUR VIEWS`

> Four people. Four different
> views of the same morning.

### Role cards

- **Survivor:** `One button and a short session. Never a score — a number in front of the
  person being measured changes what they do next.`
- **Caregiver:** `A band, one sentence about what changed, and what to do. Confounders
  printed, not hidden.`
- **Clinician:** `A ranked roster, gate states, laterality, drift against a frozen reference,
  and an audit log.`
- **ASHA worker:** `A household list with due items. Offline-first, and safe to sync twice.`

### Awaaz card

- Eyebrow: `A CAPABILITY INSIDE THE SYSTEM`
- Heading: `Awaaz — so they can be understood`
- Intro:

> A communication board for survivors whose speech was affected. It runs on the speech
> profile the daily check-in already produces, so it behaves differently for a muscle
> problem than for a language one.

- Dysarthria:

> **Dysarthria** — the muscles are affected, the message is intact. Confident speech is
> spoken aloud automatically.

- Aphasia:

> **Aphasia** — the language system is affected, and the intended words may not be the ones
> produced. So the system only ever offers candidates, and nothing is spoken until the
> patient taps one. Putting words into a mouth that cannot veto them is the one thing this
> feature must never do, and the rule is enforced on the server.

## 12. Section 08 — What we do not claim

### Label and headline

- `08 · WHAT WE DO NOT CLAIM`
- `The limits are part of the product.`

### Intro

> A monitoring tool that oversells itself is worse than no tool, because the family stops
> looking. So these are here, in onboarding, and in the app.

### Limit cards

1. **It does not diagnose, and it does not detect stroke.**
   `It measures findings against a person's own history and reports what changed. Every
   trained model publishes its metrics and a limitations note.`

2. **Three of the five models are trained on synthetic data today.**
   `Labelled synthetic in the repository, in each model card, and here, while dataset access
   is pending. The face and pose landmarkers are production models, pinned by content hash.`

3. **It cannot see an acute stroke.**
   `So the FAST card renders after every session and on every dashboard — always, not only
   when the band is high. An acute symptom report bypasses the engine entirely.`

4. **Nothing may assert wellness.**
   `“You are fine”, “all clear”, “nothing to worry about” are forbidden in three languages,
   enforced by a test that sweeps the shipped source.`

5. **It is for one population, deliberately.**
   `Anterior-circulation ischemic stroke, three or more months post-discharge, clinically
   stable, living at home. Enrolment below three months is refused in one place, so no other
   route can bypass it.`

6. **Nothing has run on a physical phone yet.**
   `Camera framing and pose scaling at 1.5 m are desktop-browser only so far. It is the
   largest untested surface in the product, and it is written down as such.`

## 13. Closing call to action

### Headline

> Nobody can watch someone
> for ninety days.
> Three minutes a day, they can.

### Actions

- `Open the demo →`
- `Log in`

### Closing visual caption

`NINETY MORNINGS · THREE MINUTES EACH · NOTHING LEAVES THE PHONE`

## 14. Footer

- `Built for families in Punjab. Works offline. Nothing identifiable leaves the phone.`
- `engine deterministic · seed 42`

## 15. Localization guidance

- The deployed landing narrative is English, with `EN / हिं / ਪੰ` signaling product-language
  support.
- Do not treat that signal as proof that every landing-page paragraph has been translated or
  clinically reviewed.
- Hindi and Punjabi versions should be written/reviewed by native speakers and an SLP, not
  produced by literal machine translation.
- Preserve claim strength: “reports a change” must not become “detects disease” in another
  language.
- Preserve the dysarthria/aphasia distinction and mandatory confirmation rule exactly.
- Emergency language must use locally verified service wording and must never imply that the
  app itself placed or connected a call.

## 16. Required copy decisions before the next deployment

### 16.1 Duration promise — blocking

The live site consistently says three minutes. The current branch consistently says ninety
seconds in `Landing.tsx`, `index.html`, the PWA description, and the closing caption. Select
one evidenced duration and use it everywhere. Do not average, alternate, or write “about
three minutes” unless the measured protocol supports it.

### 16.2 Model-data status — blocking

The live limits chapter says three of five models use synthetic data. The repository's
tracked ML metric artifacts are now all required to declare `synthetic`, and their current
truth state must be generated from artifacts rather than remembered in landing-page prose.
Replace the fixed count with artifact-backed wording or update it whenever model-card truth
changes.

### 16.3 Population scope — blocking

The live limit says anterior-circulation ischemic stroke only, while later repository
decisions and product documents discuss posterior/cerebellar scope. A clinical owner must
resolve the intended-use statement. The landing page, onboarding, enrollment gate, PRD, and
clinical protocol must then use the same population.

### 16.4 Privacy absolutes — legal/privacy review

The statements “nothing leaves the phone,” “nothing identifiable leaves the phone,” and “no
endpoint accepts a recording” are powerful architectural claims. They need exact scope:

- ordinary neurological capture versus separately consented Awaaz export/voice-clone paths;
- raw media versus identifiers/account data/derived features;
- current implementation versus planned capability;
- local export versus network upload.

Do not weaken a real invariant, but do not use a broader sentence than the evidence proves.

### 16.5 Medical-device wording — regulatory review

The current branch adds “not a medical device” in the hero and footer. Classification is not
established by copy alone and depends on intended use, claims, jurisdiction, and deployment.
Use regulator/legal-approved language rather than treating the phrase as a disclaimer that
removes obligations.

### 16.6 Awaaz auto-speak wording — safety review

“Confident speech is spoken aloud automatically” is incomplete. Auto-speak also requires a
dysarthria-dominant assessed profile, explicit enablement, and a validated threshold. Mixed,
aphasia-dominant, and unassessed profiles must always confirm. Update the public copy to
match that contract before personalized ASR is demonstrated.

### 16.7 Physical-device evidence

Keep the statement that nothing has run on a physical phone until a named test matrix,
date, build, device, and results exist. When evidence arrives, replace it with a precise
tested-device statement rather than deleting the limitation silently.

## 17. Content acceptance checklist

- One duration promise across metadata, hero, section copy, visual captions, README, and PWA.
- Incidence statistics have current sources and remain labelled as external ranges.
- Product population matches the clinical protocol and enrollment enforcement.
- Acute-emergency copy is visible before the first scroll.
- No diagnostic, wellness, or guaranteed-outcome claim appears.
- Every synthetic/seeded visual is labelled beside the visual.
- Model-data copy is generated from or checked against current artifacts.
- Awaaz dysarthria/aphasia copy matches the server invariant.
- Privacy copy has been reviewed against every API, local export, backup, and planned voice
  path.
- Hindi and Punjabi claims have native-speaker and clinical review.
- Button labels remain consistent: `Open the demo`, `See how it decides`, `Log in`, and
  `Use my camera`.
- All authored headline breaks are verified at phone and desktop widths.
