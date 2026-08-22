# CLINICAL_REFERENCE

Calibration targets for the digital equivalents of clinical tests, transcribed from a
17-page neuro-otology assessment plus two MRI reports.

**Source.** Anonymised reference patient, consented — records shared by a family member of
the project owner for calibration use. No name, patient identifier, hospital identifier,
accession number, referring physician, hospital name, or full date appears in this
repository. Dates are month-and-year only. Pinned by `backend/tests/test_privacy.py`
(INV-11).

**What these are for.** Every number our modules produce had, until now, only ever been
checked against synthetic data we generated ourselves — which proves the arithmetic is
self-consistent and says nothing about whether it corresponds to anything real. These are
measurements from an actual post-stroke patient taken on clinical instruments.

**What these are NOT.** One patient is not a validation set. They are calibration targets
and sanity bounds. They cannot establish sensitivity, specificity, or a normal range, and
every model card must say so.

**Normal/abnormal classifications are the instrument's own**, taken from the report's
summary page — not our judgement. Where we disagree with the classification we say so
explicitly rather than silently re-labelling.

---

## A. Reference patient profile

| Field | Value |
|---|---|
| Age band | 80–85 (listed 82 on the vestibular report, 83 on the MRI reports) |
| Sex | Male |
| Region | Punjab, India |
| First language | Punjabi |
| Stroke | January 2026 |
| Assessment | August 2026 (~7 months post-stroke) |
| Height | 162 cm |
| Weight | 59 kg |
| BMI | 22.48 |
| BP lying | 109/60 mmHg |
| BP standing | 114/68 mmHg |
| Pulse lying | 70 bpm |
| Pulse standing | 70 bpm |

**No orthostatic drop.** BP *rises* on standing and pulse is unchanged. Orthostatic
hypotension is not a contributor in this patient — see GAP_ANALYSIS §3.5.

---

## B. Imaging findings

### Brain MRI (plain, 3T)

Technique: axial T1w, T2w, FLAIR, SWI; T2W coronal and sagittal; additional diffusion
and ADC.

| Observation | Territory |
|---|---|
| **Encephalomalacic changes with surrounding gliosis in the LEFT CEREBELLAR HEMISPHERE** | Posterior — vertebrobasilar (PICA/SCA) |
| **Encephalomalacic changes with surrounding gliosis in BILATERAL OCCIPITAL REGIONS** | Posterior — bilateral PCA |
| Confluent and focal signal alteration in bilateral frontal paraventricular white matter, hyperintense on T2w/FLAIR, **no diffusion restriction** → chronic microangiopathic change | Small-vessel, not a territorial infarct |
| Generalised dilatation of bilateral ventricles and sulci | Global atrophy (not hydrocephalus) |
| Prominent retrocerebellar CSF space in the midline | Incidental |
| Mucosal thickening, right maxillary sinus | Incidental |

Reported **normal**: both cerebral hemispheres otherwise (grey–white differentiation);
thalami, basal ganglia and internal capsules both sides; corpus callosum; pituitary and
infundibulum; cerebellar hemispheres and vermis otherwise; medulla, pons, midbrain in all
sequences; both CP angles and the cisternal portions of the V/VII/VIII nerve complexes;
basal cisterns; flow voids in major intracranial arteries and dural venous sinuses. No
Chiari malformation or basal invagination.

**Note the absence.** There is no anterior-circulation infarct on this scan — thalami,
basal ganglia and internal capsules are explicitly normal. That matters because the history
reports right-limb weakness and speech difficulty from the January event (§E). Those
deficits have no imaging correlate here, seven months on.

### Cervical spine MRI (plain)

Technique: T1W, T2W sagittal then axial; additional STIR sagittal.

| Observation |
|---|
| Straightening of the cervical curvature |
| Disc desiccation with multilevel marginal osteophytes at all levels |
| Facet joint arthrosis at multiple levels; vertebral bodies and posterior elements otherwise normal in size, shape and signal; no bony destruction |
| Disc osteophyte complex at **C3–4** mildly indenting the thecal sac |
| Disc osteophyte complex at **C5–6** indenting the thecal sac |
| Disc osteophyte complex at **C6–7** indenting the thecal sac with narrowing of the **right** neural foramen |
| Visualised spinal cord: normal calibre and signal intensity |
| Paraspinal soft tissues normal; atlantoaxial articulation normal |

Central spinal canal dimensions: **C2–3 10.3 mm · C3–4 10.1 mm · C4–5 10.2 mm ·
C5–6 8.9 mm · C6–7 10.2 mm**

Impression: cervical spondylotic changes; disc osteophyte complex at C3–4, C5–6, C6–7.

**Clinically relevant to us:** C5–6 at 8.9 mm is borderline stenotic. Cervical cord
compression is an alternative explanation for the bilaterally abnormal toe vibration (§D)
that does not require invoking the posterior circulation at all.

---

## C. Measured values, per instrument

### C.1 Summary classifications (the instrument's own)

| Test | Sub-measure | Result |
|---|---|---|
| SVV | Static | Normal |
| SVV | Dynamic clockwise | **ABNORMAL** |
| SVV | Dynamic anti-clockwise | Normal |
| CCG | Tandem sway | Normal |
| CCG | Romberg | Normal |
| CCG | Unterberger sway | **ABNORMAL** |
| CCG | Angular deviation | Normal |
| CCG | Body spin | Normal |
| VNG | Spontaneous, gaze L/R/up/down | No nystagmus |
| VNG | Head-shaking, Valsalva, hyperventilation | No nystagmus |
| VNG | Skew deviation | Normal |
| Saccade | Latency | **ABNORMAL** |
| Saccade | Velocity | **ABNORMAL** |
| Saccade | Precision | Normal |
| Caloric | Canal paresis | NA (not calculable) |
| Caloric | Total SPV | 14 °/s |
| Positional | Horizontal R/L, Dix-Hallpike R/L | No nystagmus; torsion absent |

**Only three things are abnormal on this entire battery:** SVV dynamic clockwise,
Unterberger sway, and saccade latency + velocity.

### C.2 Subjective Visual Vertical (degrees)

| Test | T-1 | T-2 | T-3 | T-4 | T-5 | T-6 | Average | Class |
|---|---|---|---|---|---|---|---|---|
| Vertical static | 3.0 | 1.0 | 2.0 | 0.0 | 2.5 | 3.0 | **1.92** (absolute) | Normal |
| Vertical clockwise | 3.5 | 5.0 | 6.5 | 9.5 | 12.5 | 17.5 | **8.00** | **ABNORMAL** |
| Vertical anti-clockwise | 5.5 | −5.0 | −3.0 | −7.5 | 0.0 | 0.0 | **−1.50** | Normal |

The clockwise trials rise monotonically 3.5 → 17.5°: the error grows with every
repetition rather than scattering. That progression is the finding, not the mean alone.

### C.3 Craniocorpography

| Measure | Value | Class |
|---|---|---|
| Displacement (Unterberger) | **105 cm** | — |
| Sway (Unterberger) | **17 cm** | **ABNORMAL** |
| Angular deviation (Unterberger) | **Right 5°** | Normal |
| Body axis spin (Unterberger) | **Left 1°** | Normal |
| Exposure time (Unterberger) | 48 s | — |
| Sway (tandem walking) | **13 cm** | Normal |
| Romberg | — | Normal |

Plot-derived: the Unterberger trace is a dense, high-frequency lateral scribble with
limited forward progression; the tandem-walking trace is a broader oscillation. Both plots
carry an "Abnormal Range" band, with sway plotted against a scale topping at 50 cm and
displacement against 350 cm.

### C.4 Smooth pursuit — gain (%)

| Cycle | Right eye 0.1 Hz | Left eye 0.1 Hz | Right eye 0.2 Hz | Left eye 0.2 Hz |
|---|---|---|---|---|
| Gain left cycle | 113 | 102 | 95 | 90 |
| Gain right cycle | 119 | 103 | 123 | 109 |

All gains 0.90–1.23. **Normal**, and not flagged on the summary page.

### C.5 Random saccade, horizontal

| Measure | Left cycle / right eye | Left cycle / left eye | Right cycle / right eye | Right cycle / left eye |
|---|---|---|---|---|
| Target movements | 9 | 9 | 10 | 10 |
| Accepted saccades | 8 | 8 | 8 | 8 |
| **Latency (ms)** | **337** | **370** | **309** | **333** |
| **Velocity (°/s)** | **214** | **184** | **277** | **304** |
| Precision (%) | 98 | 94 | 112 | 106 |

Derived, and this is the most useful block in the whole report for us:

| Derived measure | Value |
|---|---|
| Leftward latency (mean of both eyes) | ~353 ms |
| Rightward latency (mean of both eyes) | ~321 ms |
| **Latency asymmetry** | **~0.095** |
| Leftward velocity (mean) | ~199 °/s |
| Rightward velocity (mean) | ~290 °/s |
| **Velocity asymmetry** | **~0.37** |
| Precision leftward / rightward | ~96% / ~109% |

Normal saccade latency is ~200 ms and normal peak velocity for saccades of this amplitude
is several hundred °/s; 309–370 ms with 184–304 °/s is why both were flagged. Precision
sits near 100% either way, hence "Normal".

**Leftward saccades are both slower and later than rightward** — a directional asymmetry
consistent with the left cerebellar lesion.

### C.6 Caloric

| Irrigation | SPV (°/s) | Fixation index |
|---|---|---|
| Right warm | −10 | — (not calculable) |
| Left warm | **0** | — |
| Right cold | 4 | — |
| Left cold | **0** | — |
| Canal paresis (%) | NA | |
| **Total SPV** | **14 °/s** | |

**Both left irrigations produced no response at all.** Canal paresis could not be computed
because the total response is too small to derive a ratio from. Total SPV of 14 °/s is low
in absolute terms. The picture is bilateral vestibular hypofunction, worse on the left.

### C.7 Nystagmus batteries — all zero

Spontaneous, gaze (left/right/up/down horizontal and vertical), head-shaking, Valsalva,
hyperventilation, positional Dix-Hallpike (right/left, horizontal and vertical), and
positional supine head roll (right/left, horizontal and vertical): **right-eye SPV 0,
right-eye beats 0, left-eye SPV 0, left-eye beats 0** throughout. Skew deviation: movement
of the uncovered eye — **No**.

---

## D. Bedside neurological examination

| Test | Left | Right |
|---|---|---|
| Finger–nose | **Normal** | **Normal** |
| Heel–knee–shin | **Normal** | **Normal** |
| Dysdiadochokinesia | **Normal** | **Normal** |
| Joint position | **Normal** | **Normal** |
| Toe vibration | **ABNORMAL** | **ABNORMAL** |

The four normals matter as much as the abnormal. They are precisely the four tests our M8
coordination module implements — see GAP_ANALYSIS §3.3.

---

## E. Symptom burden

| Item | Value |
|---|---|
| Vertigo — number of attacks | **60** |
| Vertigo — duration per attack | **15 minutes** |
| Progression of symptoms | Unsteadiness |
| Hearing loss (patient-reported) | Worse |
| Hearing loss (audiometry) | Left worse, right worse |
| Tinnitus | No |
| Headaches | No |

**Clinical note (paraphrased, no identifiers):** the patient had a stroke in January,
after which they developed speech difficulties and reduced muscle strength in the right
limb.

### Dizziness Handicap Inventory

| Subscale | Score | Max |
|---|---|---|
| Physical | **6** | 28 |
| Emotional | **8** | 36 |
| Functional | **14** | 36 |
| **Total** | **28** | 100 |

Banding as printed: **16–34 mild · 36–52 moderate · 54+ severe.** Total 28 = mild handicap.

The burden is predominantly *functional*, not physical — 14 of 28 points. A patient who is
not physically much impaired but whose life is substantially restricted.

---

## F. Calibration mapping

| Clinical measure | Instrument | Value | Our module | Our feature | Approximable? | Why |
|---|---|---|---|---|---|---|
| Unterberger sway | CCG | 17 cm | M9 | `unterberger_sway_path_cm` | **YES** | Head-path length from pose; same quantity |
| Tandem-walk sway | CCG | 13 cm | M9 | `tandem_walk_sway_path_cm` | **YES** | Same |
| Angular deviation | CCG | R 5° | M9 | `unterberger_angular_deviation_deg` | **YES** | Net heading from the trace |
| Displacement | CCG | 105 cm | M9 | *not implemented* | **PARTIAL** | Computable from the same trace; we do not emit it |
| Body axis spin | CCG | L 1° | M9 | *not implemented* | **PARTIAL** | Needs shoulder-line rotation, not just head centroid |
| Exposure time | CCG | 48 s | M9 | *not implemented* | **YES** | Trivially the capture duration |
| Romberg | CCG | Normal | M9 | `romberg_quotient` | **YES** | Eyes-open vs eyes-closed sway ratio |
| Saccade latency | VNG | 309–370 ms | M3 | `saccade_latency_{dir}` | **PARTIAL** | ±33 ms resolution at 30 fps; usable for trend, not for an absolute threshold |
| Saccade velocity | VNG | 184–304 °/s | M3 | `saccade_velocity_{dir}` | **PARTIAL** | Systematically understated at phone frame rates — `velocity_confidence` 0.00 at 30 fps |
| Saccade precision | VNG | 94–112% | M3 | `saccade_precision_{dir}` | **YES** | Landing error as a fraction of required amplitude |
| Smooth pursuit gain | VNG | 0.90–1.23 | M3 | `pursuit_gain` | **YES** | Eye velocity / target velocity |
| SVV static | SVV | 1.92° | — | *none* | **PARTIAL** | A phone can render a settable line — see GAP §3.5 |
| SVV dynamic CW | SVV | 8.00° | — | *none* | **PARTIAL** | Needs a rotating background; feasible, unbuilt |
| Caloric SPV | Caloric | 14 °/s total | — | *none* | **NO** | Requires irrigating the ear canal with water or air at controlled temperature |
| Canal paresis | Caloric | NA | — | *none* | **NO** | Same |
| Fixation index | Caloric | — | — | *none* | **NO** | Derived from a caloric response we cannot evoke |
| Dix-Hallpike | Positional | Normal | — | *none* | **NO** | A provocative manoeuvre that deliberately induces vertigo. We will not instruct an unsupervised patient to do this |
| Supine head roll | Positional | Normal | — | *none* | **NO** | Same |
| Head-shaking nystagmus | VNG | None | — | *none* | **NO** | Requires eye recording during and after head shaking |
| Spontaneous / gaze nystagmus | VNG | None | — | *none* | **PARTIAL** | Front camera could detect gross nystagmus; sub-degree SPV needs VNG goggles |
| Skew deviation | Cover test | Normal | — | *none* | **NO** | Needs a physical cover and an examiner |
| Finger–nose etc. | Bedside | Normal | M8 | coordination features | **PARTIAL** | Touchscreen proxies, not the clinical test |
| Toe vibration | Bedside | Abnormal bilaterally | — | *none* | **PARTIAL** | Phone haptics are uncalibrated — see GAP §3.5 |
| DHI | Questionnaire | 28 (phys 6, emo 8, func 14) | — | `DHI` | **YES** | Identical instrument |
| Vertigo attacks | History | 60 × 15 min | — | `VERTIGO_LOG` | **YES** | Caregiver-logged |
| Hearing | Audiometry | Bilateral worse | — | *none* | **NO** | Needs calibrated output levels |
| BP lying/standing | Manual | 109/60 → 114/68 | — | *none* | **PARTIAL** | Needs a cuff; TIER_2/3 only |

---

## G. Validation checklist

For each YES/PARTIAL measure: what our digital version should produce for a patient like
this, and how we would know we were wrong.

| Measure | Expected digital output | We are wrong if... |
|---|---|---|
| `unterberger_sway_path_cm` | 15–20 cm | < 5 cm or > 60 cm — the head-width scaling is broken |
| `tandem_walk_sway_path_cm` | 11–16 cm | Exceeds the Unterberger value; tandem walking is the shorter task |
| `unterberger_angular_deviation_deg` | +4 to +6° (rightward) | Sign flips, or magnitude > 15° |
| `romberg_quotient` | ~1.0–1.5 | > 3 — this patient's Romberg was *normal* |
| `saccade_latency_mean` | 300–380 ms | < 250 ms — we would be measuring anticipations, not responses |
| `saccade_latency_asymmetry` | ~0.10 | > 0.4 with symmetric input |
| `saccade_velocity_asymmetry` | ~0.37 | < 0.1 — we would be missing the one lateralised ocular finding |
| `saccade_precision_*` | 0.90–1.10 | Far from 1.0; precision was normal here |
| `pursuit_gain` | 0.90–1.25 | < 0.6 — we would be inventing a pursuit deficit this patient does not have |
| `DHI` total / subscales | 28 (phys 6, emo 8, func 14) | Any subscale mismatch: the item→subscale map is wrong |
| `VERTIGO_LOG` | 60 attacks, 900 min | Attack count off — the minimum-duration filter is mis-set |

**The single most important check:** a full battery on this patient must produce a
**lateralised** posterior finding from **M3 saccade asymmetry** (~0.37 velocity), *not*
from M9 angular deviation — his angular deviation was classified normal. See
GAP_ANALYSIS §3.4, discrepancy D-2.
