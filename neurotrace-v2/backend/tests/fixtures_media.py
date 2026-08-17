"""Real audio/video/reaction fixtures for the end-to-end API test.

These are not stand-ins for features — they are actual WAV files and actual WebM videos
that go through librosa + Praat and MediaPipe FaceMesh exactly like a browser upload does.

`drift` is the decline dial:
  voice    — more jitter, more shimmer, more breath noise, longer and more frequent pauses
  reaction — slower median RT, more variability, more lapses, steeper fatigue slope
  face     — one mouth corner sags, the way unilateral facial weakness presents

Measured deviations at drift 0.0 / 1.0 / 2.2 (voice, face, reaction):
  0.22-1.09 / 2.42-6.00 / 2.66-6.00 — comfortably either side of DEV_THRESHOLD=2.0.
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

SR = 16000
FRAME_W = FRAME_H = 192
VIDEO_FPS = 15
VIDEO_FRAMES = 20


# --------------------------------------------------------------------------- voice
def _voiced(rng: np.random.Generator, seconds: float, f0: float,
            jitter: float, shimmer: float, breath: float) -> np.ndarray:
    n = max(1, int(seconds * SR))
    t = np.arange(n)

    # instantaneous pitch: slow vibrato + cycle-to-cycle jitter
    vibrato = 2.5 * np.sin(2 * np.pi * 5.0 * t / SR)
    jit = rng.normal(0.0, jitter * f0, n)
    jit = np.convolve(jit, np.ones(24) / 24, mode="same")
    phase = 2.0 * np.pi * np.cumsum(f0 + vibrato + jit) / SR

    sig = np.sin(phase) + 0.5 * np.sin(2 * phase) + 0.25 * np.sin(3 * phase)

    # amplitude shimmer
    am = 1.0 + shimmer * rng.normal(0.0, 1.0, n)
    sig *= np.convolve(am, np.ones(64) / 64, mode="same")

    # breathiness lowers HNR
    sig += rng.normal(0.0, breath, n)

    # gentle fade so segment edges do not click
    edge = min(400, n // 4) or 1
    env = np.ones(n)
    env[:edge] = np.linspace(0, 1, edge)
    env[-edge:] = np.linspace(1, 0, edge)
    return sig * env


def write_wav(path: Path, rng: np.random.Generator, drift: float = 0.0) -> Path:
    """A short spoken-sentence surrogate: voiced segments separated by pauses."""
    jitter = 0.004 + 0.010 * drift
    shimmer = 0.03 + 0.09 * drift
    breath = 0.02 + 0.10 * drift

    n_segments = 5
    seg_len = 0.62 - 0.10 * drift          # slower, shorter bursts as speech degrades
    pause_len = 0.16 + 0.30 * drift        # and longer gaps between them

    pieces: list[np.ndarray] = []
    for i in range(n_segments):
        f0 = 128.0 + rng.normal(0.0, 2.0)
        pieces.append(_voiced(rng, seg_len * rng.uniform(0.9, 1.1), f0, jitter, shimmer, breath))
        if i < n_segments - 1:
            gap = int(pause_len * rng.uniform(0.85, 1.15) * SR)
            pieces.append(rng.normal(0.0, 1e-4, max(1, gap)))

    y = np.concatenate(pieces)
    y = 0.6 * y / (np.max(np.abs(y)) + 1e-9)

    pcm = np.clip(y * 32767.0, -32768, 32767).astype("<i2")
    _write_wav_bytes(path, pcm, SR)
    return path


def _write_wav_bytes(path: Path, pcm: np.ndarray, sr: int) -> None:
    """16-bit mono PCM WAV — written by hand so the fixtures need no audio writer."""
    import struct

    data = pcm.tobytes()
    with path.open("wb") as fh:
        fh.write(b"RIFF")
        fh.write(struct.pack("<I", 36 + len(data)))
        fh.write(b"WAVEfmt ")
        fh.write(struct.pack("<IHHIIHH", 16, 1, 1, sr, sr * 2, 2, 16))
        fh.write(b"data")
        fh.write(struct.pack("<I", len(data)))
        fh.write(data)


# --------------------------------------------------------------------------- face
def write_face_video(path: Path, rng: np.random.Generator, drift: float = 0.0) -> Path:
    """A drawn face MediaPipe reliably detects.

    Per-frame wobble is present on every day, including baseline days, so the baseline
    standard deviation is realistic rather than ~0 (which would make any later frame look
    like a huge z-score).
    """
    writer = cv2.VideoWriter(
        str(path), cv2.VideoWriter_fourcc(*"VP80"), VIDEO_FPS, (FRAME_W, FRAME_H)
    )
    if not writer.isOpened():  # pragma: no cover - codec missing
        raise RuntimeError("OpenCV cannot write VP8 WebM on this build")

    cx0, cy0 = FRAME_W // 2, FRAME_H // 2
    droop = int(round(6 * drift))  # left mouth corner sags as drift rises

    for i in range(VIDEO_FRAMES):
        dx, dy = rng.normal(0, 1.1), rng.normal(0, 1.1)
        cx, cy = int(cx0 + dx), int(cy0 + dy)
        frame = np.full((FRAME_H, FRAME_W, 3), 210, np.uint8)

        cv2.ellipse(frame, (cx, cy), (54, 72), 0, 0, 360, (176, 148, 128), -1)   # face
        cv2.ellipse(frame, (cx, cy + 62), (30, 22), 0, 0, 360, (176, 148, 128), -1)  # chin

        blink = 3 if i % 9 == 4 else 6                                           # eye aperture
        for sx in (-20, 20):
            cv2.ellipse(frame, (cx + sx, cy - 16), (11, blink), 0, 0, 360, (250, 250, 250), -1)
            cv2.circle(frame, (cx + sx, cy - 16), 4, (30, 30, 30), -1)
            cv2.ellipse(frame, (cx + sx, cy - 30), (13, 4), 0, 200, 340, (70, 50, 40), 2)  # brow

        cv2.ellipse(frame, (cx, cy + 8), (7, 12), 0, 0, 360, (150, 122, 104), -1)  # nose

        left = (cx - 22, cy + 38 + droop)
        right = (cx + 22, cy + 38)
        cv2.line(frame, left, (cx, cy + 44), (96, 52, 52), 3)
        cv2.line(frame, (cx, cy + 44), right, (96, 52, 52), 3)

        writer.write(frame)

    writer.release()
    return path


# --------------------------------------------------------------------------- reaction
def reaction_payload(rng: np.random.Generator, drift: float = 0.0) -> dict:
    """12 trials, as the browser tap game emits them."""
    n = 12
    base = 420.0 + 210.0 * drift
    spread = 34.0 + 130.0 * drift
    fatigue = 4.0 + 26.0 * drift              # RT creeping up across the run

    latencies = base + rng.normal(0.0, spread, n) + fatigue * np.arange(n)
    n_lapses = int(round(2 * drift))
    for idx in rng.choice(n, size=min(n_lapses, n), replace=False):
        latencies[idx] *= 2.6                 # attention lapse

    return {
        "latencies_ms": [float(max(120.0, v)) for v in latencies],
        "misses": int(round(2 * drift)),
        "false_starts": 0,
    }
