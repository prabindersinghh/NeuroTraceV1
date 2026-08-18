import pandas as pd

def prepare_reaction_trend(patient_data):
    """
    Returns a DataFrame with date vs reaction_time
    """
    rows = []

    # Baseline
    baseline_rt = patient_data["baseline"]["reaction_time"]
    rows.append({
        "date": "Baseline",
        "reaction_time": baseline_rt
    })

    # Daily entries
    for day in patient_data.get("daily", []):
        rows.append({
            "date": day["date"],
            "reaction_time": day["reaction_time"]
        })

    return pd.DataFrame(rows)
