"""Exam modules M1-M20 — TRD §4.

The authoritative Python implementations. The PWA mirrors this maths on-device so raw
media never leaves the phone; `tests/test_js_python_parity.py` pins the two together.
"""
from .registry import (
    DAILY,
    DAILY_MODULES,
    MODULES,
    MONTHLY,
    MONTHLY_MODULES,
    WEEKLY,
    WEEKLY_MODULES,
    ExamModule,
    bad_direction,
    daily_battery_seconds,
    get_module,
    modules_for,
    scoring_keys,
)

__all__ = [
    "DAILY", "DAILY_MODULES", "MODULES", "MONTHLY", "MONTHLY_MODULES",
    "WEEKLY", "WEEKLY_MODULES", "ExamModule", "bad_direction",
    "daily_battery_seconds", "get_module", "modules_for", "scoring_keys",
]
