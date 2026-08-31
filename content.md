# content.md — landing page copy revamp

**What this is.** Replacement copy for `frontend/src/routes/Landing.tsx`, section by section.
The section IDs, order and components stay exactly as they are — only words change. Paste the
blocks marked **COPY** straight in.

**What changed and why.** The current page wins an argument. It does not tell a story, and it
assumes the reader already knows what a stroke leaves behind. This draft keeps every honest
claim and re-frames the page around one person's ninety days, so a visitor with no medical or
technical background can follow it top to bottom without stopping once.

**The rule that governed every sentence.** `docs/CLAIMS_MATRIX.md`. Nothing here asserts
accuracy, lead time, outcome improvement, diagnosis, or a regulatory status. Every external
number is labelled as published literature, in the same sentence, not in a footnote.

---

## The story the page tells

Read the eight beats aloud. If a visitor can retell them, the page worked.

**▸ 1. Someone comes home.** The hospital part is over. That is where the story usually stops
being told — and where recovery actually happens.

**▸ 2. Nobody is watching.** Ninety days pass. One of them has a doctor in it.

**▸ 3. Decline is quiet.** It does not announce itself. It is noticed the day it becomes a
crisis, and by then the question is not "what changed" but "how long has this been going on".

**▸ 4. A normal person's normal is useless here.** A survivor is outside the average range
every single day. That is what a stroke is. So compare them to themselves.

**▸ 5. Being sure is harder than noticing.** Lots of things move three measurements at once.
Agreement is not proof.

**▸ 6. So the system is built to stay quiet.** Three tests must all pass. Improvement never
alarms. One episode, one alert.

**▸ 7. Nothing about the person leaves the phone.** Not by policy — by architecture.

**▸ 8. And the limits are printed on the front of the box.** Because a tool that oversells
itself gets muted, and a muted tool sees nothing.

---

## Bullet system (use consistently, everywhere)

The page currently uses plain grids. Give bullets a job, so a scanner can read only the
bullets and still get the argument.

| Glyph | Means | Use for |
|---|---|---|
| **▸** | a step in the story | narrative beats, how it works |
| **●** | a fact from published literature | every borrowed statistic — always paired with its source label |
| **✓** | something the system does | capabilities, what each role sees |
| **✕** | something it refuses to do | the limits section, the gates |
| **—** | a plain-language gloss | the sentence right after any term a layperson may not know |

One rule: **every ● is followed by its source in the same line.** No exceptions.

---

## 01 · HERO

Current headline is a comparison ("twenty minutes... three minutes is more"). It is clever and
it is second. Lead with the person.

**COPY**

> **Eyebrow:** Post-stroke recovery · measured at home · EN / हिं / ਪੰ
>
> **H1:** He came home in January.
> **H1 (muted):** His next appointment was in April.
>
> **Lead:** Recovery does not happen in a hospital. It happens in a kitchen in Ludhiana, over
> months, with nobody measuring anything. NeuroTrace runs a three-minute neurological check on
> the survivor's own phone each morning and learns what normal looks like *for that one
> person* — so the slow slide that a family only names in hindsight becomes something you can
> see on a Tuesday.
>
> **Buttons:** Open the demo → · See how it decides
>
> **Safety rail (keep verbatim, it is load-bearing):** It reasons over days, so it cannot see
> a stroke that is happening now. Sudden weakness, a drooping face or slurred speech is an
> emergency — call 108 first, always.

*Note:* keep "for that one person" as the emphasised phrase. It is the whole product.

---

## 02 · THE GAP → **"Ninety days, and one of them is measured"**

Keep the `NinetyDays` grid. Rewrite the prose to be concrete, and re-cut the stat strip so
each number lands as a human consequence rather than a percentage.

**COPY**

> **Rule:** 01 · The gap
>
> **H2:** Ninety days between appointments.
> One of them is measured.
>
> **Lead:** A neurologist gets about twenty minutes with a survivor, once every one to three
> months. Everything that goes wrong in between goes wrong slowly — a little less grip, a
> word that will not come, a foot that catches on a step. Each morning looks like yesterday.
> Ninety mornings do not.

**Stat strip — keep the four numbers, change the labels so they say what they mean:**

> ● **39–47%** — develop thinking and memory problems after a stroke *(published incidence
> range)*
> ● **~60%** — still cannot speak or be understood the way they used to, six months on
> *(published incidence range)*
> ● **11–41%** — develop depression after a stroke *(published incidence range)*
> ● **1 in 4** — will have a second one *(published incidence range)*
>
> **Caption:** Published incidence ranges from the literature. Not measurements taken by this
> product.

---

## 02b · NEW — **The case studies** (insert as a band inside §02, or as its own section)

Three real ones. They are not decoration; each proves a different part of the argument, and
each is checkable.

**COPY — card 1: the person this was built for**

> ● **Punjab, 2026.** A man in his eighties has a stroke in January. His first full
> neuro-otology assessment happens in August — seven months later, seventeen pages of it. The
> report finds real, measurable problems. It also cannot say when any of them started.
> **That gap is the product.** Every calibration target in this system comes from that one
> anonymised, consented record.
> *(One patient is a calibration reference, not a validation set. It cannot establish accuracy
> and we do not claim it does — see `docs/CLINICAL_REFERENCE.md`.)*

**COPY — card 2: this is not a rare problem**

> ● **Ludhiana, 2010–2013.** A population-wide stroke registry ran in this city under WHO
> surveillance methodology and counted roughly **140 first-ever strokes per 100,000 people per
> year**, mean age 59. It also found survivors in rural areas doing measurably worse than
> survivors in the city — same illness, different follow-up.
> **The gap is geographic, and it is where the phones already are.**
> *(Ludhiana Population-Based Stroke Registry, published in _Neurology_ and the _Annals of
> Indian Academy of Neurology_.)*

**COPY — card 3: why we do not hand this job to the family**

> ● **The ATTEND trial — 14 Indian hospitals, 1,250 patients, published in _The Lancet_,
> 2017.** Families were trained to deliver rehabilitation at home. At six months the outcome
> was **47.0% versus 47.4%** — statistically identical to usual care.
> **Reading that honestly:** goodwill and training are not the missing piece. Families are
> already doing everything they can. What is missing is *measurement* — and a clinician on the
> other end of it. NeuroTrace does not ask a family to be a therapist. It asks the phone to be
> an instrument, and sends the finding to someone qualified to act on it.

*This third card is the emotional and strategic centre of the page. It says: we read the
evidence, including the evidence that the obvious idea failed, and we built the other thing.*

---

## 03 · WHOSE NORMAL

The argument is right; the language is a step too abstract. Ground it, then keep the
two-plate comparison exactly as it is.

**COPY**

> **Rule:** 02 · Whose normal
>
> **H2:** Normal is a person, not a population.
>
> **Lead:** Ask a machine whether this man's right hand is normal and it will say no — today,
> tomorrow, and every day for the rest of his life. That is what a stroke is. A tool built on
> population averages therefore does one of two things: it screams every morning until someone
> switches it off, or it is widened so far that it can no longer see anything at all.
>
> So we do not ask that question. We ask a smaller one, every morning: **is this different
> from* his *last twelve mornings?**

**Plate captions (keep):**
> ✕ **Against a population** — flagged every single day. Useless by the end of the first week.
> ✓ **Against themselves** — flat for eighteen days, then days 19–21 move. Same data. Different
> question.

---

## 04 · THE SECOND PROBLEM

Strongest section on the page. Only add the plain-language gloss.

**COPY**

> **Eyebrow:** The second problem
>
> **H2:** Three measurements agreeing looks like overwhelming proof.
> *(muted)* Sometimes it is proof of the wrong thing.
>
> **Lead:** Parkinson's disease slows the hand, quietens the voice and flattens the face — all
> at once, and it is common in exactly the age group we monitor. On agreement alone it would
> produce our loudest, most confident alert, for a condition this product does not monitor and
> cannot help with. Confidence built on things moving together is not confidence. It is a
> coincidence with good manners.
>
> — **The tell is sides.** A stroke damages one side of the brain, so it usually shows up on
> one side of the body. A condition affecting the whole nervous system does not pick a side.

---

## 05 · THE DECISION (gates)

Label each gate with the mistake it prevents, in words a family member would use.

**COPY**

> **Rule:** 03 · The decision
>
> **H2:** Three gates. All three, or it is not an alert.
>
> **Lead:** A false alarm does not cost one notification. It costs the product — a tool that
> cried wolf gets muted, and a muted tool detects nothing at all. Each gate refuses one
> specific way this system could be fooled.
>
> ✕ **Not a bad night.** A change has to hold. One rough morning is a rough morning.
> ✕ **Not one flaky sensor.** More than one measurement has to agree.
> ✕ **Not a whole-body effect.** Something has to have a side. *(§04 is why.)*
>
> ✓ **And getting better never alerts.** A recovering patient drifts enormously from a
> baseline set when they were worse. That is the largest signal this engine will ever see, and
> it is good news. It stays silent.

---

## 06 · THE RUN

**COPY**

> **Rule:** 04 · Twenty-one days
>
> **H2:** One alert for the episode. Not one every morning.
>
> **Lead (new, one line):** Scrub the days. Watch the moment three gates line up — and watch
> the eighteen days before it, where the system had reason to be suspicious and said nothing.

---

## 07 · ON DEVICE

Currently the most technical section. Lead with the promise, not the mechanism.

**COPY**

> **Rule:** 05 · On the phone
>
> **H2:** There is no place on our server to put a video of your father.
>
> **Lead:** The camera work happens inside the phone's own browser. It measures the face and
> the body, keeps the numbers, and throws the picture away in the same instant. What syncs is
> a list of measurements — no face, no voice, no video.
>
> — This is not a promise somebody has to remember to keep. **There is no upload route for
> audio, video or images anywhere in the API, and no column in the database that could hold
> one.** A configuration mistake cannot leak a recording that was never sent.
>
> ✓ The session finishes with no signal at all and syncs later, because the model is served
> from our own origin and stored on the device.

*(Keep the FaceMeshShowcase caption verbatim. The reason it gives for having no stock
photograph is one of the best paragraphs on the page.)*

---

## 08 · WHAT IT MEASURES

Add one sentence so the "HAS A SIDE / NO SIDE" tags are self-explanatory.

**COPY**

> **Rule:** 06 · What it measures
>
> **H2:** Seven domains can raise a flag. Four of them carry a side.
>
> **Lead:** Twenty-one tasks. Six run every morning inside the three-minute budget; the rest
> are weekly or monthly. Speech and language have no left or right — a person's voice cannot
> be weak *on the left*. So they can support a one-sided finding. They can never create one.

---

## 09 · THE CARE NETWORK

Give each role its human stake in one clause before the feature list.

**COPY**

> **Rule:** 07 · One morning, four views
>
> **H2:** Four people. Four different views of the same morning.
>
> ✓ **The survivor** — who is tired of being tested. One button, one short session, and never
> a score. A number in front of the person being measured changes what they do next.
> ✓ **The caregiver** — who is guessing. A band, one sentence on what changed, and what to do
> about it. Anything that could innocently explain the change is printed, not hidden.
> ✓ **The clinician** — who has twenty minutes and forty patients. A ranked list, the gate
> states, which side, the drift against a frozen reference, and an audit trail.
> ✓ **The ASHA worker** — who has a bag and a scooter. A household list with what is due.
> Works offline, and safe to sync twice.

**Awaaz block — keep the structure, tighten the framing:**

> **Awaaz — so they can be understood**
>
> A communication board for survivors whose speech was affected. It runs on the speech profile
> the daily check-in already produces, so it behaves differently depending on *what kind* of
> problem the stroke left behind.
>
> ✓ **Dysarthria** — the muscles are affected; the thought is completely intact. He knows the
> word. His mouth will not make it. Confident speech is spoken aloud automatically.
> ✕ **Aphasia** — the language system itself is affected, and the word that comes out may not
> be the word that was meant. So the system only ever *offers* candidates, and speaks nothing
> until the patient taps one. Putting words into a mouth that cannot take them back is the one
> thing this feature must never do, and the rule is enforced on the server, not in the app.

---

## 10 · WHAT WE DO NOT CLAIM

Keep all six. Do not soften one word. This section is the page's credibility, and it is the
reason the rest of it can be believed.

**COPY — intro only**

> **Rule:** 08 · What we do not claim
>
> **H2:** The limits are part of the product.
>
> **Lead:** A monitoring tool that oversells itself is worse than no tool at all, because the
> family relaxes and stops looking. So every limit below also appears in onboarding and inside
> the app — not only here, where it is easiest to be brave about them.

**Then the existing six cards, each prefixed ✕, verbatim.**

---

## 11 · CLOSE

**COPY**

> **H2:** Nobody can watch someone for ninety days.
> *(muted)* Three minutes a morning, they can.
>
> **Buttons:** Open the demo → · Log in
>
> **Caption under the finished grid:** ninety mornings · three minutes each · nothing leaves
> the phone
>
> **Footer:** Built for families in Punjab. Works offline. Nothing identifiable leaves the
> phone.

---

## Two things to decide before this ships

**1. The reference patient card (§02b, card 1).** It is the most affecting thing on the page
and it is a real person's record. The repo version is anonymised and consented for
*calibration*; a public marketing page is a different use. **Get explicit sign-off from the
family member who shared it before publishing card 1.** If that is not available, the card
still works with the specifics removed: *"A survivor in Punjab has a stroke in January. His
first full assessment is in August."* No age, no month-level dates. INV-11 is satisfied either
way — no identifier appears in either version — but consent and INV-11 are different questions
and only one of them is enforced by a test.

**2. Named public figures.** Considered and left out: John Fetterman (2022 stroke, auditory
processing and aphasia, publicly discussed), Jill Bolte Taylor (neuroanatomist, eight years to
full recovery, self-documented). Both are real, public and on-message. Both also mean putting
a named living person's medical history on a commercial page they never agreed to appear on.
The three case studies above make the same points using a consented record, a public registry
and a published trial. **Recommendation: keep them out.**

---

## Compliance check

| Section | Risk | Status |
|---|---|---|
| Hero | narrative framing | ✓ no accuracy or timing claim |
| §02 stats | borrowed figures | ✓ labelled "published incidence ranges", per-line |
| §02b Ludhiana | external registry | ✓ attributed, described as incidence not our measurement |
| §02b ATTEND | external trial | ✓ attributed, reported result is the actual published result |
| §02b reference patient | INV-11 | ✓ no identifier; consent question flagged above |
| §07 | privacy claim | ✓ architectural, verifiable in the API surface (INV-1) |
| §10 | synthetic models | ✓ unchanged, still states it in three places |
| everywhere | INV-13 | ✓ no regulatory status asserted or implied |

Nothing in this file claims sensitivity, specificity, lead time, agreement with a clinical
instrument, or improved outcomes. If a later edit adds one, it belongs in NEEDS EVIDENCE in
`docs/CLAIMS_MATRIX.md` first, and it needs `docs/ML_STATUS.md` to say the model behind it is
trained on real data.

## Sources

- [Ludhiana Population-Based Stroke Registry — incidence and outcome, *Neurology*](https://www.neurology.org/doi/10.1212/WNL.0000000000002335)
- [Ludhiana registry — urban vs rural stroke profile and outcome](https://pubmed.ncbi.nlm.nih.gov/31008330/)
- [ATTEND: family-led rehabilitation after stroke in India, *The Lancet* 2017](https://eprints.whiterose.ac.uk/121993/9/final%20THELANCET-D-17-00592R1.pdf)
- [Stroke in India: systematic review of incidence, prevalence, case fatality](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8821978/)
- Reference patient: `docs/CLINICAL_REFERENCE.md` (in-repo, anonymised, consented)
- Post-stroke incidence ranges in §02: `README.md` lines 41–43, unchanged
