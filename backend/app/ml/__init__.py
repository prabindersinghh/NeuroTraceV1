"""NeuroTrace intelligence core.

WHAT IS ACTUALLY LIVE HERE IS `speech.py`, AND ONLY VIA `app/exam/speech_tasks.py`.

`scoring.py` and `face.py` were deleted, and the reason is worth keeping. `scoring.py` was
a SECOND, complete alert implementation — bands, a sustained-deviation window, a
cross-modality requirement — with **no laterality gate at all**, so it could raise an ALERT
on a symmetric Parkinsonian decline that INV-2 and `engine/gates.py` exist to keep out. It
had no caller outside its own tests. A reader who found it first would have believed it was
the product. The live gate is `app/engine/gates.py`; nothing else decides a band.

`face.py` took a VIDEO PATH and opened it with OpenCV — server-side media processing, which
is the exact shape INV-1 forbids. It also had no caller, and it was the only reason
`mediapipe`, `opencv-python` and `protobuf` were runtime dependencies (and the only reason
this backend was pinned to Python 3.11 and numpy 1.x). Feature extraction happens in the
browser via `@mediapipe/tasks-vision`; the server receives numbers.

`baseline.py`, `explain.py` and `reaction.py` are the same class of thing — superseded by
`app/engine/` — and are kept only until their tests are ported. Do not build on them.

`speech` is intentionally NOT re-exported here: importing it pulls in librosa, which is
only needed at capture time. Import it directly at the point of use.
"""
from . import baseline, explain, reaction

__all__ = ["baseline", "explain", "reaction"]
