# risk_engine.py

def calculate_risk(baseline, current):
    score = 0

    if current["avg_pause"] > baseline["avg_pause"] * 1.3:
        score += 1
    if current["pitch_variance"] > baseline["pitch_variance"] * 1.3:
        score += 1
    if current["symmetry_score"] < baseline["symmetry_score"] * 0.9:
        score += 1
    if current["reaction_time"] > baseline["reaction_time"] * 1.25:
        score += 1

    return {
        "risk_level": ["Low", "Moderate", "High"][min(score, 2)],
        "risk_score": score
    }
