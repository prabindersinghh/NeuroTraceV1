"""Temporary storage for uploaded audio/video.

Privacy rule (TRD §7): raw media exists only long enough to extract features. With
DELETE_RAW_MEDIA=true — the default — the file is removed in a finally block, so it goes
away even if extraction raises.
"""
from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import HTTPException, UploadFile, status

from ..config import settings

logger = logging.getLogger("neurotrace.media")

CHUNK = 1024 * 1024

# Browsers label MediaRecorder output inconsistently; map to an extension the decoders
# recognise. Anything unknown keeps .bin — librosa/OpenCV sniff content, not names.
_SUFFIX_BY_TYPE = {
    "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/wave": ".wav",
    "audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a", "audio/aac": ".aac", "audio/flac": ".flac",
    "video/webm": ".webm", "video/mp4": ".mp4", "video/x-matroska": ".mkv",
    "video/quicktime": ".mov", "video/ogg": ".ogv",
}


def _suffix_for(upload: UploadFile) -> str:
    content_type = (upload.content_type or "").split(";")[0].strip().lower()
    if content_type in _SUFFIX_BY_TYPE:
        return _SUFFIX_BY_TYPE[content_type]
    suffix = Path(upload.filename or "").suffix.lower()
    return suffix if suffix and len(suffix) <= 6 else ".bin"


async def _save(upload: UploadFile, kind: str) -> Path:
    settings.media_dir.mkdir(parents=True, exist_ok=True)
    target = settings.media_dir / f"{kind}_{uuid.uuid4().hex}{_suffix_for(upload)}"
    written = 0
    try:
        with target.open("wb") as fh:
            while chunk := await upload.read(CHUNK):
                written += len(chunk)
                if written > settings.max_upload_bytes:
                    raise HTTPException(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        f"{kind} upload exceeds {settings.max_upload_bytes // (1024 * 1024)}MB",
                    )
                fh.write(chunk)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()

    if written == 0:
        target.unlink(missing_ok=True)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Empty {kind} upload")
    return target


@asynccontextmanager
async def stored_upload(upload: UploadFile, kind: str):
    """Yield a path to the saved upload, then delete it if DELETE_RAW_MEDIA is set."""
    path = await _save(upload, kind)
    try:
        yield path
    finally:
        if settings.delete_raw_media:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                logger.warning("could not delete raw media %s", path.name)
