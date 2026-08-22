# GAP_ANALYSIS

What our implementation would and would not have found in the anonymised reference patient.
All values from `CLINICAL_REFERENCE.md`.

---

## 3.1 What we WOULD detect

| Clinical abnormality | Value | Module | Feature | Confidence |
|---|---|---|---|---|
| Unterberger sway | 17 cm | M9 | `unterberger_sway_path_cm` | High — same quantity, same units |
| Saccade latency prolonged | 309–370 ms | M3 | `saccade_latency_{dir}`, `saccade_latency_mean` | Moderate — ±33 ms at 30 fps, but 350 ms vs a ~200 ms norm is far outside that error |
| Saccade velocity reduced | 184–304 °/s | M3 | `saccade_velocity_{dir}` | Low as an absolute; **high as an asymmetry** (see below) |
| Saccade directional asymmetry | ~0.37 velocity, ~0.10 latency | M3 | `saccade_velocity_asymmetry`, `saccade_latency_asymmetry` | **High — and this is what satisfies Gate 3** |
| Vertigo burden | 60 attacks × 15 min | — | `VERTIGO_LOG` | High — identical instrument |
| Handicap | DHI 28 (phys 6, emo 8, func 14) | — | `DHI` | High — identical instrument |
| Progressive unsteadiness | reported | M9 + frozen reference | `cumulative_drift` | Moderate — depends on capture cadence |

**Three domains would carry signal**: `posterior_vestibular` (M9 sway + M3 saccades),
plus symptom burden, plus `cranial_nerves` if the bilateral hearing loss were captured —
which it currently is not (§3.2).

## 3.2 What we would MISS

| Missed | In scope? | Justification |
|---|---|---|
| Caloric SPV, canal paresis, fixation index | **Correctly out** | Requires irrigating the ear canal at controlled temperature. There is no phone equivalent and pretending otherwise would be dishonest |
| Dix-Hallpike, supine head roll | **Correctly out** | Provocative manoeuvres that deliberately induce vertigo in an unsupervised elderly patient. Refusing to do this is a safety decision, not a capability gap |
| Skew deviation | **Correctly out** | Needs a physical cover and an examiner watching the uncovered eye |
| Head-shaking nystagmus | **Correctly out** | Requires eye recording during/after head shaking; the shaking itself is provocative |
| Bilateral hearing loss | **GAP — should close** | Both patient-reported *and* audiometry-confirmed, in a patient with occipital and cerebellar infarcts. A caregiver-reported per-ear change scale costs nothing and we do not have it |
| SVV (static + dynamic) | **GAP — should evaluate** | Dynamic clockwise was one of only three abnormalities on the entire battery. A phone can render a settable line |
| Toe vibration | **GAP — but see caveat** | Abnormal bilaterally. Phone haptics are uncalibrated; also possibly cervical, not posterior (§3.5) |
| CCG displacement, body-axis spin, exposure time | **GAP — cheap to close** | Displacement and exposure time are already derivable from the trace we capture. Body spin needs the shoulder line |
| Speech difficulty, right-limb weakness | **Partly covered** | M4/M5 and M6/M7 exist. Not measured at this assessment, so we cannot say whether we would have detected them |

## 3.3 THE FALSE-NEGATIVE CHECK

The four classic cerebellar bedside tests were **all normal**: finger–nose, heel–knee–shin,
dysdiadochokinesia, joint position. Our M8 coordination module implements exactly those
four. Yet the patient had 60 vertigo attacks, worsening unsteadiness, abnormal Unterberger
sway and abnormal saccade latency *and* velocity.

Run mechanically against the engine:

```
SCENARIO 1 — M8 coordination alone, real bedside results (all normal)
  -> band=STABLE   gate1=False gate2=False gate3=False   persistent=[]

SCENARIO 2 — pre-amendment system, no posterior_vestibular domain
  -> band=STABLE                            <-- the gap the amendment closes

SCENARIO 3 — the real patient as measured, current system
  -> band=ALERT    gate1=True gate2=True gate3=True
     persistent  = ['cranial_nerves', 'posterior_vestibular']
     lateralised = ['posterior_vestibular']
     coordination_gait in persistent? False
```

**Confirmed: M8 alone returns nothing, and `posterior_vestibular` is what fires.**
Coordination never enters the persistent set — the alert does not depend on it at all.

Fixture corrections made against the real values:

- `REFERENCE_DHI_RESPONSES` now reproduces physical 6 / emotional 8 / functional 14. The
  previous fixture totalled 28 but distributed it as phys 12, emo 4, func 12 — nearly the inverse.
- Added `test_the_reference_burden_is_predominantly_functional`, because the *shape* of the
  DHI is the clinically interesting part and a total-only assertion cannot see it.

## 3.4 DISCREPANCIES — codebase vs source

Every one of these was found by reading the images against what we had written.

| # | Item | We had | Source says | Severity |
|---|---|---|---|---|
| **D-1** | DHI subscales | physical 12 / emotional 4 / functional 12 | **6 / 8 / 14** | **High** — inverted the clinical picture. Fixed |
| **D-2** | Angular deviation classification | "the laterality signal", implied abnormal | **Normal** (5° right is within this device's norms) | **High** — our stated Gate 3 mechanism for this patient is not what actually fired |
| **D-3** | Tandem-walk sway | listed as a calibration target, implied abnormal | **Normal** (13 cm) | Medium |
| **D-4** | Which CCG measure was abnormal | not stated | **Unterberger sway only** | Medium |
| **D-5** | Saccade values | "abnormal", qualitative | latency **309–370 ms**, velocity **184–304 °/s**, precision **94–112%** | **High** — we now have real numbers where we had none |
| **D-6** | Saccade asymmetry | not recorded | leftward slower/later: velocity asym **~0.37** | **High** — this is the actual lateralised finding |
| **D-7** | Smooth pursuit | "recorded" | **Normal**, gains 0.90–1.23 | Medium — we must not invent a pursuit deficit |
| **D-8** | Caloric | absent from our doc | **Left areflexia** (LW 0, LC 0), total SPV 14, CP not calculable | **High** — a major finding we never recorded |
| **D-9** | SVV | absent from our doc | dynamic CW **ABNORMAL**, mean 8.00°, monotonic 3.5→17.5° | **High** — one of only three abnormalities |
| **D-10** | Narrative: "every deficit lives in balance and oculomotor" | asserted | History reports **speech difficulty and right-limb weakness** from the January stroke | **High** — the claim is false as written |
| **D-11** | CCG extras | absent | displacement **105 cm**, body spin **left 1°**, exposure **48 s** | Low |
| **D-12** | Age | 82 | 82 on the vestibular report, **83** on the MRI reports | Low — use a band |
| **D-13** | Orthostatic BP | not recorded | **109/60 → 114/68**, pulse 70→70: *no* drop | Low, but see §3.5 |
| **D-14** | Cervical spine | not recorded | C5–6 canal **8.9 mm**, multilevel spondylosis | Medium — alternative cause for the vibration finding |
| **D-15** | Vertigo count | 60 × 15 min | **confirmed** | None |
| **D-16** | Unterberger 17 cm / tandem 13 cm / 5° right | as transcribed | **confirmed** | None |

**On D-2, which matters most.** Our documentation presented Unterberger angular deviation
as the mechanism by which `posterior_vestibular` satisfies Gate 3. In this patient the
angular deviation was classified *normal*, and the genuine lateralised signal is the
**saccade velocity asymmetry (~0.37)** from M3. The domain still fires and still fires
one-sidedly — but via the eye, not the feet. The design holds; our explanation of it did
not, and a reviewer checking our claim against this report would have caught us.

**On D-10.** The correction matters beyond tidiness. The patient is not a pure posterior
presentation — he had anterior-type deficits too. The lesson is narrower than we wrote: not
"deficits live only in balance and oculomotor", but "the four cerebellar bedside tests were
normal, so a coordination-only module finds nothing". That is still the failure the
amendment closes, and it is now stated truthfully.

## 3.5 NEW candidates — recommend only, do not build

**1 · Subjective Visual Vertical — RECOMMEND, highest value of the five**
Dynamic clockwise was one of only three abnormalities in the entire battery, with a
striking monotonic rise (3.5→17.5°). A phone renders a line, the patient rotates it to
upright, we record the error. Static SVV needs only a dark room and a tilted line; dynamic
needs a rotating background, which a phone can also draw.
*Feasibility* high · *Clinical value* high — it is a graviceptive-pathway measure nothing
else we have touches · *Risk* low; a rotating field can provoke mild nausea, so it needs a
stop control · **Recommend for the next amendment.**

**2 · Fixation suppression / fixation index — DO NOT BUILD**
The index is computed from a caloric response. Without the irrigation there is nothing to
suppress. A "fixation test" without the caloric stimulus would be a different measurement
wearing the same name.

**3 · Head-shaking, patient-performed — DO NOT BUILD**
The clinical value is in the *nystagmus* afterwards, which needs VNG goggles. What remains
is asking an unsteady 82-year-old to shake their head — provocative, unsupervised, and it
measures nothing we could record. A symptom question ("does turning your head quickly bring
it on?") already exists inside the DHI.

**4 · Positional symptom reporting — RECOMMEND, small**
Not Dix-Hallpike. Simply: which positions bring it on — rolling over, lying down, looking
up. Caregiver-loggable, zero risk, and it distinguishes positional from spontaneous
vertigo, which is the single most useful triage split in dizziness. Two questions appended
to the vertigo log.
*Feasibility* trivial · *Value* moderate–high · *Risk* none · **Recommend.**

**5 · Postural BP — RECOMMEND for TIER_2/3 only, and note the evidence here is null**
This patient showed **no orthostatic drop** — BP rose on standing and pulse was flat. So
these records do *not* support orthostatic hypotension as a mechanism for him. It remains a
real fall-risk and vertigo contributor in the wider population, and TIER_3 already has a
cuff. Honest framing: we are recommending it on general grounds, not on this patient's
evidence.
*Feasibility* requires a cuff · *Value* moderate · *Risk* low · **Recommend at TIER_2/3.**

**6 · Vibration sense via phone haptics — DO NOT BUILD (yet)**
Toe vibration was abnormal bilaterally, so the target is real. But a clinical test uses a
128 Hz tuning fork against bone with a graded amplitude. Phone haptic motors vary by handset
generation, are not amplitude-calibrated, and the foot cannot be coupled to the phone the
way a fork couples to the malleolus. We would produce a number that varies with the handset
more than with the patient.

**And the confound.** This patient's C5–6 canal measures 8.9 mm with multilevel spondylosis.
Bilateral abnormal vibration in an 83-year-old with cervical stenosis is at least as likely
to be dorsal-column/cervical as posterior-circulation. Building a vibration test would risk
attributing a cervical finding to the stroke we are monitoring.
*Feasibility* low · *Value* real but confounded · *Risk* misattribution · **Do not build.
Revisit only with a calibrated external actuator.**

**7 · Hearing change self-report — RECOMMEND (already specified as v3 E3, not built)**
Confirmed worse in both ears by patient *and* audiometry. A three-option per-ear monthly
question costs nothing. Full pure-tone screening needs calibrated levels and headphones and
should stay optional.

### Recommended order
1. Positional symptom questions (trivial, appended to the vertigo log)
2. Hearing-change self-report (v3 E3, specified, unbuilt)
3. SVV (highest measurement value; needs a PLAN — new module, new domain question)
4. Postural BP at TIER_2/3
5. CCG displacement + exposure time (already derivable from the captured trace)

Items 3 and 5 touch `registry.py` and are therefore structural: **PLAN first, per the
working discipline. Nothing here has been built.**
