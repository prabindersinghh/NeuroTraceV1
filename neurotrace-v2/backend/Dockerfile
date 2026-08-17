# NeuroTrace backend — Python 3.11 (mediapipe 0.10.14 has no 3.12 wheels).
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libgl1 / libglib2.0-0  -> OpenCV + MediaPipe runtime
# ffmpeg / libsndfile1    -> librosa & soundfile audio decoding (webm/ogg from the browser)
# build-essential         -> praat-parselmouth sdist fallback if no wheel matches
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        ffmpeg \
        libsndfile1 \
        libgl1 \
        libglib2.0-0 \
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

RUN useradd --create-home --uid 10001 neurotrace \
    && mkdir -p /app/media \
    && chown -R neurotrace:neurotrace /app
USER neurotrace

ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

# Migrations run at boot so a fresh Render/Railway deploy converges on its own.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
