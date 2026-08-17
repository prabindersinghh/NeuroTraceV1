import json
import os
from datetime import datetime

BASELINE_FILE = "baseline.json"


def save_baseline(profile, baseline_data):
    payload = {
        "created_on": datetime.now().strftime("%d %b %Y"),
        "time": datetime.now().strftime("%H:%M"),
        "profile": profile,
        "baseline": baseline_data
    }
    with open(BASELINE_FILE, "w") as f:
        json.dump(payload, f, indent=2)


def load_baseline():
    if not os.path.exists(BASELINE_FILE):
        return None
    with open(BASELINE_FILE, "r") as f:
        return json.load(f)


def reset_baseline():
    if os.path.exists(BASELINE_FILE):
        os.remove(BASELINE_FILE)
