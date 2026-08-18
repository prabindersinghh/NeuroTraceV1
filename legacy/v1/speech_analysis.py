# speech_analysis.py
# speech_analysis.py
# speech_analysis.py
import numpy as np

def extract_speech_features(audio_file):
    """
    Simulated speech feature extraction (MVP-safe).
    Replace with Azure Speech SDK later.
    """

    avg_pause = round(float(np.random.uniform(0.3, 0.8)), 2)
    pitch_variance = round(float(np.random.uniform(0.2, 0.7)), 2)
    slur_probability = round(float(np.random.uniform(0.05, 0.25)), 2)
    breath_irregularity = round(float(np.random.uniform(0.1, 0.4)), 2)

    return {
        "avg_pause": avg_pause,
        "pitch_variance": pitch_variance,
        "slur_probability": slur_probability,
        "breath_irregularity": breath_irregularity
    }
