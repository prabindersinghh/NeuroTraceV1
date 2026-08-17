"""NeuroTrace intelligence core.

speech.py / face.py / reaction.py / baseline.py / scoring.py / explain.py are ported
byte-for-byte from the verified reference implementation — do not change their logic.

`speech` and `face` are intentionally NOT re-exported here: importing them pulls in
librosa / mediapipe / OpenCV, which are only needed at capture time. Import them
directly (`from app.ml import speech`) at the point of use.
"""
from . import baseline, explain, reaction, scoring

__all__ = ["baseline", "explain", "reaction", "scoring"]
