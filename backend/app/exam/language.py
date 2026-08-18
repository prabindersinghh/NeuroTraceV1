"""M5 · aphasia — Domain B. Maps to NIHSS item 9. WEEKLY.

Clinical rationale
------------------
Aphasia is a *language* disorder, distinct from the motor speech disorder in M4. A patient
can have crisp articulation and still be unable to find the word "watch", and the reverse
is equally common. Separating them matters because they localise differently and recover
differently.

The five tasks map onto the standard bedside aphasia examination:

* **Picture description** — connected speech. Words per minute, type-token ratio and mean
  length of utterance separate fluent (Wernicke-type) from non-fluent (Broca-type) output.
* **Naming (10 items)** — confrontation naming is the most sensitive single aphasia test,
  and word-finding *latency* degrades before accuracy does.
* **Repetition (3 phrases)** — spared in transcortical aphasias, impaired in conduction
  aphasia; the dissociation is diagnostic.
* **Comprehension (4 yes/no)** — receptive language, independent of any output ability.
* **Semantic fluency (60s)** — "name as many animals as you can". Sensitive to both
  language and executive function, and one of the earliest measures to decline.

The device transcribes on-device; this module receives the transcript and timings, never
audio.
"""
from __future__ import annotations

import re

import numpy as np

_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)


def _safe(v, default: float = 0.0) -> float:
    try:
        f = float(v)
        return f if np.isfinite(f) else default
    except Exception:
        return default


def tokenise(text: str) -> list[str]:
    return [w.lower() for w in _WORD.findall(text or "")]


def _utterances(text: str) -> list[str]:
    parts = re.split(r"[.!?।]+", text or "")
    return [p.strip() for p in parts if p.strip()]


def connected_speech_features(transcript: str, duration_s: float) -> dict:
    """Fluency measures from a picture description."""
    words = tokenise(transcript)
    if not words or duration_s <= 0:
        return {}

    utterances = _utterances(transcript)
    lengths = [len(tokenise(u)) for u in utterances if tokenise(u)]

    return {
        "words_per_min": _safe(len(words) / (duration_s / 60.0)),
        "total_words": float(len(words)),
        # Lexical diversity. Falls when output becomes empty and formulaic.
        "type_token_ratio": _safe(len(set(words)) / len(words)),
        "mean_length_utterance": _safe(np.mean(lengths)) if lengths else 0.0,
        "utterance_count": float(len(lengths)),
    }


def naming_features(items: list[dict]) -> dict:
    """Confrontation naming.

    Each item: {"correct": bool, "latency_ms": float}. Latency is measured from picture
    onset to speech onset and is the early signal — a patient who still names 10/10 but
    takes twice as long has changed.
    """
    if not items:
        return {}
    correct = [bool(i.get("correct")) for i in items]
    latencies = [float(i.get("latency_ms", 0.0)) for i in items
                 if i.get("latency_ms") and float(i["latency_ms"]) > 0]

    out = {
        "naming_accuracy": _safe(sum(correct) / len(correct)),
        "naming_items": float(len(correct)),
    }
    if latencies:
        out["word_finding_latency"] = _safe(np.median(latencies))
        out["word_finding_latency_cv"] = _safe(np.std(latencies) / (np.mean(latencies) + 1e-9))
    return out


def repetition_features(items: list[dict]) -> dict:
    """Phrase repetition scored by token overlap with the target."""
    if not items:
        return {}
    scores: list[float] = []
    for item in items:
        target = tokenise(item.get("target", ""))
        said = tokenise(item.get("said", ""))
        if not target:
            continue
        matched = sum(1 for w in target if w in said)
        scores.append(matched / len(target))
    if not scores:
        return {}
    return {
        "repetition_accuracy": _safe(np.mean(scores)),
        "repetition_items": float(len(scores)),
    }


def comprehension_features(items: list[dict]) -> dict:
    """Yes/no comprehension. Pure receptive measure, no output required."""
    if not items:
        return {}
    correct = [bool(i.get("correct")) for i in items]
    return {
        "comprehension_score": _safe(sum(correct) / len(correct)),
        "comprehension_items": float(len(correct)),
    }


def fluency_features(words: list[str], duration_s: float = 60.0) -> dict:
    """Semantic (category) fluency.

    Beyond the raw count, the *time course* is informative: healthy performance front-loads
    (easy exemplars first, then slowing). A flat or absent decay curve suggests the patient
    never accessed the rich part of the category at all.
    """
    cleaned = [w.lower().strip() for w in (words or []) if w and w.strip()]
    if not cleaned:
        return {"fluency_count": 0.0}
    unique = list(dict.fromkeys(cleaned))
    out = {
        "fluency_count": float(len(unique)),
        "fluency_repetitions": float(len(cleaned) - len(unique)),
    }
    if len(unique) >= 4 and duration_s > 0:
        half = len(unique) // 2
        out["fluency_first_half"] = float(half)
        out["fluency_second_half"] = float(len(unique) - half)
        out["fluency_decay_ratio"] = _safe((len(unique) - half) / (half + 1e-9))
    return out


def extract_aphasia(raw: dict) -> dict:
    """`raw` = {
        "description": {"transcript": str, "duration_s": float},
        "naming":      [{"correct": bool, "latency_ms": float}, ...],
        "repetition":  [{"target": str, "said": str}, ...],
        "comprehension":[{"correct": bool}, ...],
        "fluency":     {"words": [str], "duration_s": float},
    }
    """
    out: dict[str, float] = {}
    completed = 0

    desc = raw.get("description") or {}
    if desc.get("transcript"):
        feats = connected_speech_features(desc["transcript"], float(desc.get("duration_s", 0)))
        if feats:
            out.update(feats)
            completed += 1

    for key, fn in (("naming", naming_features),
                    ("repetition", repetition_features),
                    ("comprehension", comprehension_features)):
        items = raw.get(key)
        if isinstance(items, list) and items:
            feats = fn(items)
            if feats:
                out.update(feats)
                completed += 1

    fl = raw.get("fluency") or {}
    if fl.get("words"):
        feats = fluency_features(fl["words"], float(fl.get("duration_s", 60.0)))
        if feats:
            out.update(feats)
            completed += 1

    if completed == 0:
        return {"valid": 0.0, "tasks_completed": 0.0}
    out["valid"] = 1.0
    out["tasks_completed"] = float(completed)
    return {k: _safe(v) for k, v in out.items()}


APHASIA_SCORING_KEYS = [
    "words_per_min", "type_token_ratio", "mean_length_utterance",
    "naming_accuracy", "word_finding_latency", "word_finding_latency_cv",
    "repetition_accuracy", "comprehension_score",
    "fluency_count", "fluency_decay_ratio",
]

APHASIA_BAD_DIRECTION = {
    "words_per_min": "down", "type_token_ratio": "down", "mean_length_utterance": "down",
    "naming_accuracy": "down", "word_finding_latency": "up",
    "word_finding_latency_cv": "up", "repetition_accuracy": "down",
    "comprehension_score": "down", "fluency_count": "down", "fluency_decay_ratio": "down",
}
