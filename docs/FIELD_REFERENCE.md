# FIELD_REFERENCE

Every table and field, and what it means in plain language.

---

## `users` — accounts

| Field | Meaning |
|---|---|
| `email`, `pw_hash` | login |
| `role` | `patient` · `caregiver` · `clinician` · `asha_worker` |
| `lang` | preferred language: `en` / `hi` / `pa` |

---

## `patients` — the person being monitored

| Field | Meaning |
|---|---|
| `name`, `age`, `sex` | who they are |
| `stroke_date` | when the stroke happened. Must be ≥ 3 months ago to enrol |
| `stroke_side` | which side of the brain: `left` / `right` / `bilateral` / `unknown` |
| `languages` | languages they read, most preferred first |
| `preferred_hour` | the time of day their check-in normally happens. A session well outside it is flagged as a confounder, not treated as a real change |
| `education_band` | context for the cognitive tasks |
| `pd_diagnosis` | **Blocks enrolment.** Parkinson's changes face, movement and voice together — the same pattern our alert looks for |
| `other_movement_disorder` | **Blocks enrolment**, same reason |
| `deployment_tier` | what hardware they have: phone only / + watch / + shared ASHA kit. Decides which tasks are offered |
| `asha_worker_id` | which community health worker visits this household |
| `baseline_state` | `not_started` / `collecting` / `locked` |

---

## `sessions` — one sitting of the check-in

| Field | Meaning |
|---|---|
| `ts` | when it happened |
| `type` | `daily` / `weekly` / `monthly` |
| `quality_score` | how good the capture was. Poor captures are re-prompted, not scored |
| `identity_verified` | did the on-device check confirm the same person |
| `off_window` | taken well outside their usual time |

---

## `module_results` — what each task produced

| Field | Meaning |
|---|---|
| `module_code` | which task, e.g. `M1` face, `M9` balance |
| `features_json` | **numbers only.** Ratios, timings, angles. Never audio, video or images |
| `quality_flag` | was this task's capture usable |
| `extracted_on_device` | confirms the numbers were computed on the phone |
| `session_position` | which step of the session this was (1–21) |
| `elapsed_seconds_at_task_start` | how far into the session the patient already was |
| `intensity` | which version of the protocol ran: `full` / `standard` / `light` / `research` |
| `paused_before_task` | whether the patient rested immediately before this task |

> **The recording never leaves the phone.** It is turned into these numbers and deleted.

> **Why the last four exist.** A task performed twentieth is performed by a more tired
> person than the same task performed fifth. Fixed ordering makes that a constant the
> baseline absorbs. Changing intensity or pausing moves the task earlier, so the patient is
> *less* tired — which makes the score *better* — which looks like improvement when nothing
> improved. That direction hides decline, so it is recorded on every result.

---

## `baselines` — this person's own normal

| Field | Meaning |
|---|---|
| `median_json`, `mad_json` | their typical value and typical spread, per measurement |
| `trajectory_json` | the recovery trend fitted during the baseline period |
| `n_sessions`, `locked` | how many sittings went in; locked at 12 |
| `window_start`, `window_end` | the period the baseline was built from |
| `reference_median_json` | **the frozen snapshot.** Taken once, when the baseline locks, and never changed again |
| `reference_mad_json` | the spread at that same moment |
| `reference_locked_at` | when the snapshot was taken |

> **Why two copies.** The first follows the person as they recover — good for "is today
> different from recently". The second never moves — needed for "how far are they from where
> they started". A slow decline hides from the first and shows up in the second.

---

## `deviations` — how far today was from normal, per task

| Field | Meaning |
|---|---|
| `mean_abs_z` | overall distance from their normal |
| `lateral_abs_z` | distance from normal **in the left/right difference only** |
| `lateralised` | true when the change is genuinely one-sided |
| `improving` | the change is in the direction of recovery |
| `gateable` | may this task contribute to raising an alert |
| `cusum_stat` | running total, so a small drift over many days accumulates |

---

## `scores` — the day's result

| Field | Meaning |
|---|---|
| `band` | `STABLE` · `WATCH` · `ALERT` · `PATTERN_ATYPICAL` |
| `gate1_passed` | the change lasted more than one session |
| `gate2_passed` | two or more separate abilities changed |
| `gate3_passed` | at least one change is **one-sided** |
| `persistent_domains` | which abilities have kept changing |
| `lateralised_domains` | which of those are one-sided |
| `symmetric_pattern` | changing evenly on both sides — not a stroke pattern |
| `cumulative_drift` | distance from the **frozen** normal |
| `drift_flagged` | day-to-day looks fine, but they are a long way from their established normal |
| `confidence` | lowered by things that muddy the picture: poor sleep, odd timing, short baseline |
| `explanation_en/hi` | what the family reads |
| `clinician_line` | the same finding in clinical terms |

**PATTERN_ATYPICAL** means: face, movement and voice all changed together and evenly, with
nothing one-sided. That is not the stroke pattern, so no stroke alert is raised — the family
is told to discuss other causes with their doctor.

---

## `wearable_data` — readings from the watch

| Field | Meaning |
|---|---|
| `source`, `device_id` | which app and which physical device |
| `metric` | heart rate, irregular rhythm, sleep, steps, SpO₂, blood pressure |
| `value`, `unit` | exactly as the device reported it |

> **We record and trend what the device says. We do not claim to measure it.** The device
> manufacturer holds that claim.

---

## `fall_events` — a fall the watch reported

| Field | Meaning |
|---|---|
| `ts`, `source`, `device_id` | when, and from what |
| `device_confidence` | the **device's** confidence, passed through unchanged |
| `dismissed_by_patient` | they cancelled it on the watch — still recorded |
| `caregiver_notified_at` | when the family was told |
| `acknowledged_at` | when someone confirmed they had checked |

> A fall **skips the scoring engine completely** and goes straight to the family.

---

## `asha_visits` — a community health worker's household visit

| Field | Meaning |
|---|---|
| `asha_worker_id`, `patient_id` | who visited whom |
| `client_visit_id` | the tablet's own reference for the visit |
| `session_id` | the assessment recorded during the visit |
| `synced_at` | when it reached the server |

> Workers are offline for most of a round. `client_visit_id` means a retried upload updates
> the same visit instead of creating a duplicate — duplicates would quietly distort the
> person's baseline.

---

## `questionnaires`

| Instrument | Measures |
|---|---|
| PHQ-2 / PHQ-9 | mood. Item 9 (self-harm) always escalates |
| EAT-10 | swallowing difficulty |
| FSS | fatigue |
| Barthel | independence in daily activities |
| **DHI** | how much dizziness interferes with life. 0–100, three subscales. A change under 18 points is inside the questionnaire's own error |
| **Vertigo log** | how many dizzy attacks, how long each. The earliest thing a family can observe |

---

## `audit_log`

Append-only. Corrections are new records, never edits or deletions.
