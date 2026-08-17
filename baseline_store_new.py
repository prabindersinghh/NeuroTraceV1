# baseline_store.py
import json
import os

BASELINE_FILE = "baseline.json"

def save_baseline(data):
    with open(BASELINE_FILE, "w") as f:
        json.dump(data, f)

def load_baseline():
    if os.path.exists(BASELINE_FILE):
        with open(BASELINE_FILE, "r") as f:
            return json.load(f)
    return None

def reset_baseline():
    if os.path.exists(BASELINE_FILE):
        os.remove(BASELINE_FILE)
