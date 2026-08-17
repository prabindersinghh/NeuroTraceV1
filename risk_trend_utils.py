import pandas as pd

def prepare_risk_trend(patient_data):
    rows = []

    # Baseline is always Low risk
    rows.append({
        "date": "Baseline",
        "risk_level": 0
    })

    for day in patient_data.get("daily", []):
        level = day.get("risk_level", "Low")

        risk_map = {
            "Low": 0,
            "Moderate": 1,
            "High": 2
        }

        rows.append({
            "date": day["date"],
            "risk_level": risk_map.get(level, 0)
        })

    return pd.DataFrame(rows)
