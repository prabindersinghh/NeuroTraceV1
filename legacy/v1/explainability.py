# explainability.py

def explain_risk(baseline, current, risk):
    reasons = []

    if current["avg_pause"] > baseline["avg_pause"] * 1.3:
        reasons.append("Speech pauses increased beyond personal baseline")

    if current["pitch_variance"] > baseline["pitch_variance"] * 1.3:
        reasons.append("Voice pitch stability has reduced")

    if current["symmetry_score"] < baseline["symmetry_score"] * 0.9:
        reasons.append("Facial symmetry deviation detected")

    if current["reaction_time"] > baseline["reaction_time"] * 1.25:
        reasons.append("Reaction time slower than usual")

    return {
        "summary": f"Overall neurological risk assessed as {risk['risk_level']}",
        "reasons": reasons,
        "disclaimer": "This system detects deviation trends, not diagnoses"
    }
