# v1 → v2 migration audit

Every file from the original Streamlit prototype, judged against `PRD.md` / `TRD.md` (v2).
Verdicts are honest: where the v1 code was a placeholder rather than working logic, this
says so plainly.

| File | Verdict | Reasoning |
|---|---|---|
| `app.py` (317 L) | **DELETE** | Streamlit is server-rendered. v2 requires a PWA doing on-device MediaPipe + Web Audio with a service worker and an offline queue — Streamlit can do none of that. Of the 317 lines, ~120 are CSS overrides. No transferable logic. |
| `auth.py` (18 L) | **DELETE** | A text box that accepts any string as identity. No password, hash, session or token. v2 needs JWT access+refresh, bcrypt and three role guards — already built; nothing to migrate. |
| `patient_store.py` (38 L) | **DELETE** | One JSON file per patient on local disk. The *concept* (profile + baseline + daily log) survives as the `patients` / `sessions` / `baselines` tables. |
| `baseline_store.py` (28 L) | **DELETE** | A single global `baseline.json` — structurally one patient per installation. |
| `baseline_store_new.py` (19 L) | **DELETE** | Near-duplicate of the above and strictly worse (drops the timestamp and profile). Dead even in v1: `app.py` imports neither module. |
| `speech_analysis.py` (22 L) | **DELETE** | Returns `np.random.uniform()`. Its own docstring: *"Simulated speech feature extraction (MVP-safe). Replace with Azure Speech SDK later."* Not working logic — a stub that fabricates four numbers. Replaced by real jitter / shimmer / HNR / DDK / MPT extraction. |
| `face_analysis.py` (13 L) | **DELETE** | Returns `random.uniform()`. Comment: *"replace later with MediaPipe"*. Replaced by real MediaPipe FaceMesh geometry, including the forehead-raise central-vs-peripheral discriminator. |
| `reaction_game.py` (59 L) | **CONCEPT PORTED, CODE DELETED** | The idea (random delay → stimulus → measure tap latency) is correct and is reimplemented. The implementation cannot be salvaged: it measures `time.time()` across a Streamlit `st.rerun()` server round-trip, so it times the network and the rerender, not the person. It also ran **one** trial, yielding no variability — and RT coefficient of variation is the single most sensitive cognitive marker. v2 runs 12 trials and computes CoV, IQR, lapse rate and decay slope. |
| `risk_engine.py` (18 L) | **DELETE — precisely what v2 exists to replace** | Fixed multipliers (`> baseline*1.3`, `< baseline*0.9`) evaluated on a **single day**, summed into a 0–3 score. No persistence requirement, no cross-modality requirement, no dispersion statistic — one noisy morning trips it. This is the false-alarm generator that the two-gate design replaces. |
| `explainability.py` (22 L) | **CONCEPT PORTED, CODE DELETED** | The shape — *"this feature moved in the bad direction → emit this sentence"* — is right and survives as the `TEMPLATES` table in `app/ml/explain.py`, extended to EN + HI, ranked by magnitude and direction-filtered. The v1 hardcoded thresholds go with the risk engine. |
| `trend_utils.py` (23 L) | **DELETE** | pandas frame → `st.line_chart`. Replaced by the `/dashboard` trend series rendered in Recharts. Also reads `patient_data["daily"]` while `patient_store` writes `daily_logs` — the key never matches, so v1's trend chart was permanently empty. |
| `risk_trend_utils.py` (26 L) | **DELETE** | Same shape, same latent `daily` vs `daily_logs` key bug. |

## Summary

- **Keep as-is:** none
- **Port and extend:** 2 (`reaction_game`, `explainability`) — as *concepts*; both already
  reimplemented, the original code is not reusable
- **Delete:** 12 of 12 files

The blunt finding: the two modules that would have been worth migrating —
`speech_analysis.py` and `face_analysis.py` — never extracted anything. They call
`random.uniform()`. v1 was a UI shell around simulated numbers, which is exactly why the
`reference/ml/*.py` modules were written and why those are the real inheritance.

What genuinely carries forward is the **reference ML** (`speech`, `face`, `reaction`,
`baseline`, `scoring`, `explain`) — ported byte-for-byte and verified SHA256-identical —
plus the v2 backend, auth, database and frontend already built on top of it.

Everything above remains recoverable from git history at commit `c349e61`.
