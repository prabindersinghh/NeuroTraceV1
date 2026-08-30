"""Voice clone from a family archive clip — XTTS-v2 / Indic TTS fine-tune. Awaaz D1.

A caregiver uploads any two minutes of the patient speaking before the stroke: a wedding
video, a WhatsApp voice note, a recorded phone call. The phrase board then speaks in that
voice instead of a stock one.

WHY THIS IS WORTH THE TROUBLE
-----------------------------
A synthetic voice makes a person sound like a machine to their own family. Their own voice,
even imperfectly reproduced, is the difference between a device speaking on their behalf and
them speaking. For someone who has lost speech, that distinction is most of the point.

WHAT MAKES IT DANGEROUS
-----------------------
This is impersonation technology. A cloned voice can say anything, and the family cannot
tell it from the real thing — that is the whole design goal. Three constraints follow, and
they are enforced elsewhere in the codebase rather than assumed here:

  - **Consent is recorded**, from the patient where they can give it. `VoiceSample.consent_by`
    holds who authorised it.
  - **The source audio is destroyed** once the adapter is trained, and the deletion is
    timestamped in `VoiceSample.audio_deleted_at`.
  - **A clone is deletable on request, permanently.** No archived copy, no "disabled but
    retained".

The uploaded clip is the one piece of raw audio that reaches a server, because cloning
cannot run on a phone. That is a deliberate, documented exception to INV-1 (DECISIONS
D-014) — single-purpose, separately consented, deleted after use — not a hole in it.

THE PRODUCT DOES NOT DEPEND ON IT
---------------------------------
Until a clone exists the board can use a stock browser voice. The clone is an upgrade,
never a prerequisite. Pre-rendered offline speech is a separate delivery milestone; this
planning script does not produce audio assets.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path

from .common import DATA_DIR, MODELS_DIR, SEED, redact_patient_label

#: Below this, XTTS-v2 produces a voice that is recognisably wrong — close enough to be
#: unsettling, not close enough to be theirs. Refusing is kinder than shipping it.
MIN_CLIP_SECONDS = 90.0
#: Beyond this we gain little and hold more of someone's voice than we need.
MAX_CLIP_SECONDS = 600.0

#: Candidate backends. Sarvam is evaluated for Indic quality because XTTS-v2's Hindi is
#: passable and its Punjabi is not, and most of our users speak Punjabi at home.
BACKENDS = {
    "xtts_v2": {
        "model": "coqui/XTTS-v2",
        "languages": ["en", "hi"],
        "note": "Strong zero-shot cloning. Punjabi is not supported and Hindi carries an "
                "audible English prosody.",
    },
    "indic_tts_finetune": {
        "model": "ai4bharat/indic-tts",
        "languages": ["hi", "pa", "en"],
        "note": "Punjabi support is the reason this exists. Needs a fine-tune rather than "
                "zero-shot, so it wants the full two minutes.",
    },
    "sarvam": {
        "model": "sarvam-ai/bulbul",
        "languages": ["hi", "pa", "en"],
        "note": "Best Indic prosody of the three in informal listening. Hosted API, so "
                "using it means the clip leaves our infrastructure — a decision that "
                "needs consent language of its own before it can ship.",
    },
}

#: Punjabi first: it is the language most of our patients are actually comforted in, and
#: the one the general-purpose models handle worst.
DEFAULT_BACKEND_BY_LANG = {"pa": "indic_tts_finetune", "hi": "indic_tts_finetune",
                           "en": "xtts_v2"}


@dataclass(slots=True)
class CloneSpec:
    patient_id: str
    lang: str
    backend: str
    clip_seconds: float
    provenance: str
    seed: int = SEED
    #: Phrases a production pipeline must pre-render before claiming offline support.
    prerender_phrases: tuple[str, ...] = (
        "I need help", "Water", "Toilet", "I am in pain", "I am fine",
    )


class ClipRejected(ValueError):
    """The clip cannot produce a voice worth giving to a family."""


def validate_clip(duration_seconds: float, lang: str) -> None:
    if duration_seconds < MIN_CLIP_SECONDS:
        raise ClipRejected(
            f"This recording is {duration_seconds:.0f} seconds. We need at least "
            f"{MIN_CLIP_SECONDS:.0f} seconds of them speaking clearly to build a voice "
            "that sounds like them. A shorter clip produces something close enough to be "
            "unsettling and not close enough to be theirs. Any recording works - a "
            "wedding video, a voice note, a phone call."
        )
    if duration_seconds > MAX_CLIP_SECONDS:
        raise ClipRejected(
            f"That is longer than we need. {MAX_CLIP_SECONDS / 60:.0f} minutes is plenty - "
            "please trim it, so we hold no more of their voice than the job requires."
        )
    if lang not in ("en", "hi", "pa"):
        raise ClipRejected(f"No voice backend supports '{lang}' yet.")


def choose_backend(lang: str) -> str:
    return DEFAULT_BACKEND_BY_LANG.get(lang, "xtts_v2")


def build_spec(patient_id: str, lang: str, clip_seconds: float,
               provenance: str) -> CloneSpec:
    validate_clip(clip_seconds, lang)
    return CloneSpec(
        patient_id=patient_id, lang=lang, backend=choose_backend(lang),
        clip_seconds=clip_seconds, provenance=provenance,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--patient", default="synthetic-patient")
    parser.add_argument("--lang", default="pa", choices=["en", "hi", "pa"])
    parser.add_argument("--seconds", type=float, default=120.0)
    parser.add_argument("--provenance", default="family wedding video")
    parser.add_argument("--out", type=Path, default=MODELS_DIR)
    parser.add_argument("--data", type=Path, default=DATA_DIR / "raw" / "voice_samples")
    args = parser.parse_args()

    if args.data.exists():
        raise SystemExit(
            "Voice-clone training is not implemented. A local sample path was supplied, "
            "so no planning artifact, clone, or non-synthetic claim was written."
        )
    synthetic = True
    # The artifact is tracked, so it records a redacted label, never what was typed.
    spec = build_spec(
        redact_patient_label(args.patient), args.lang, args.seconds, args.provenance
    )
    backend = BACKENDS[spec.backend]

    payload = {
        "model": "voice_clone",
        "synthetic": synthetic,
        "spec": asdict(spec),
        "backend": {"name": spec.backend, **backend},
        "backends_considered": BACKENDS,
        "safeguards": [
            "Consent is recorded against the sample (VoiceSample.consent_by).",
            "Source audio is destroyed after training; the deletion is timestamped "
            "(VoiceSample.audio_deleted_at).",
            "A clone is permanently deletable on request - no archived copy.",
            "Emergency phrases must be pre-rendered and cached before the product reports "
            "offline speech support.",
        ],
        "limitations": [
            "This is impersonation technology. A cloned voice can say anything and the "
            "family cannot distinguish it from the real thing - that is the design goal, "
            "and it is why consent and deletion are enforced rather than encouraged.",
            "XTTS-v2 does not support Punjabi, which most of our patients speak at home. "
            "Punjabi routes to an Indic fine-tune that needs the full clip.",
            "A pre-stroke recording is not always available, and families without one "
            "correlate with families with less money. The product must work identically "
            "without a clone, and it does - the board falls back to a stock voice.",
            "Quality is judged by informal listening, not by a published MOS. We have not "
            "run a listening study and should not imply that we have.",
        ],
    }
    if synthetic:
        payload["limitations"].insert(0, (
            "SYNTHETIC RUN. No voice sample was present; this exercises the pipeline and "
            "produces no voice."))

    args.out.mkdir(parents=True, exist_ok=True)
    path = args.out / "voice_clone.metrics.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(f"  patient     {spec.patient_id}")
    print(f"  language    {spec.lang}")
    print(f"  backend     {spec.backend}  ({backend['note']})")
    print(f"  clip        {spec.clip_seconds:.0f}s from '{spec.provenance}'")
    print(f"  planned     {len(spec.prerender_phrases)} phrases need offline pre-rendering")
    print("\nwrote", path)


if __name__ == "__main__":
    main()
