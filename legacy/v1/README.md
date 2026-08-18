# NeuroTrace v1 — Streamlit prototype (superseded)

The original proof of concept. Kept for reference; **not** the app you want to run.

It was a single Streamlit process with local JSON storage and no real accounts — enough to
show that a voice + face + reaction check-in could produce a usable risk signal, and not
much more. Everything here was rebuilt properly in the repo root: see the
[project README](../../README.md).

## What changed in v2

| | v1 (here) | v2 (repo root) |
|---|---|---|
| Stack | Streamlit, one process | FastAPI + async SQLAlchemy + PostgreSQL, React frontend |
| Storage | local JSON files | relational schema with Alembic migrations |
| Accounts | a name field | JWT auth, bcrypt, patient / caregiver / clinician roles |
| Baseline | global-ish thresholds | per-patient mean/std frozen after 4 valid days |
| Alerting | score crosses a line | ≥2 modalities deviating for ≥3 consecutive days |
| Explanations | English only | English + Hindi, top-3 ranked drivers |
| Tests | none | 105, including a real-media end-to-end HTTP journey |

## Running it (if you really want to)

```bash
cd legacy/v1
python -m venv .venv && .venv/Scripts/activate
pip install -r requirements.txt
streamlit run app.py
```

It writes `patient_data/` and `baseline.json` into whatever directory you launch it from.
Those paths are gitignored.
