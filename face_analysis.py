import random

def analyze_face(video_file):
    # MVP-safe simulated extraction (replace later with MediaPipe)
    symmetry_score = round(random.uniform(0.85, 1.0), 3)
    eye_openness = round(random.uniform(0.8, 1.0), 3)
    mouth_deviation = round(random.uniform(0.0, 0.15), 3)

    return {
        "symmetry_score": symmetry_score,
        "eye_openness": eye_openness,
        "mouth_deviation": mouth_deviation
    }
