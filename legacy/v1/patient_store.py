import json
import os
from datetime import date

DATA_DIR = "patient_data"

os.makedirs(DATA_DIR, exist_ok=True)

def _path(patient_id):
    return os.path.join(DATA_DIR, f"{patient_id}.json")

def load_patient(patient_id):
    if not os.path.exists(_path(patient_id)):
        return None
    with open(_path(patient_id), "r") as f:
        return json.load(f)

def save_patient(patient_id, data):
    with open(_path(patient_id), "w") as f:
        json.dump(data, f, indent=2)

def is_baseline_done(patient_id):
    data = load_patient(patient_id)
    return data is not None and "baseline" in data

def store_baseline(patient_id, profile, baseline):
    data = {
        "profile": profile,
        "baseline": baseline,
        "created_at": str(date.today()),
        "daily_logs": []
    }
    save_patient(patient_id, data)

def store_daily(patient_id, daily_data):
    data = load_patient(patient_id)
    data["daily_logs"].append(daily_data)
    save_patient(patient_id, data)
