# NeuroTrace backend — Python 3.11.
# The 3.11 pin was mediapipe's; mediapipe is gone (see app/ml/__init__.py). Kept because
# 3.11 is the verified environment, not because anything here still requires it.
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# ffmpeg / libsndfile1  -> librosa & soundfile audio decoding (webm/ogg from the browser)
# build-essential       -> praat-parselmouth sdist fallback if no wheel matches
# libgl1 / libglib2.0-0 are GONE with OpenCV/MediaPipe. Do not re-add them to "fix" an
# import error: on this backend that error means something is trying to process media
# server-side, which is INV-1.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        ffmpeg \
        libsndfile1 \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY alembic.ini .
COPY alembic ./alembic
COPY app ./app
COPY tests ./tests
COPY pytest.ini .

# No /app/media. Nothing wrote to it, and a writable media directory on this server is a
# standing invitation to break INV-1.
RUN useradd --create-home --uid 10001 neurotrace \
    && chown -R neurotrace:neurotrace /app
USER neurotrace

ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

# Migrations run at boot so a fresh Render/Railway deploy converges on its own.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
