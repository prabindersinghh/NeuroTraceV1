"""Awaaz — the communication assistant. A second product on the same platform.

Start with `safety.py`. The auto-speak gate there is the constraint the rest is built
around, and it is the difference between assistive technology and putting words in a
disabled person's mouth.
"""
from .convergence import (
    AdapterDrift,
    build_review_queue,
    route_conversational_features,
    should_request_caregiver_review,
)
from .listener import ListenerState, coaching_line, create_listener_session
from .safety import SpeakMode, SpeechProfile, decide, may_auto_speak

__all__ = [
    "AdapterDrift",
    "ListenerState",
    "SpeakMode",
    "SpeechProfile",
    "build_review_queue",
    "coaching_line",
    "create_listener_session",
    "decide",
    "may_auto_speak",
    "route_conversational_features",
    "should_request_caregiver_review",
]
