"""INVARIANTS — the rules that must never break.

Each is numbered to match `docs/ARCHITECTURE.md`. A test here failing is not a bug in the
test; it means a rule the product depends on has been broken somewhere else.
"""
from __future__ import annotations

import inspect
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
APP = BACKEND / "app"


def _python_sources(root: Path):
    for path in sorted(root.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        yield path, path.read_text(encoding="utf-8")


# --------------------------------------------------------------------------- INV-1
#: Media types that carry a recognisable human being.
RAW_MEDIA_MARKERS = (
    "UploadFile",
    "multipart/form-data",
    "File(",
)


def test_inv1_no_endpoint_accepts_raw_media():
    """INV-1 — RAW MEDIA NEVER LEAVES THE PHONE.

    Audio, video and frames are captured, turned into numbers, and discarded on the device.
    Only derived features and scores reach the server.

    This is the product's central privacy claim and it is also what makes the on-device
    story true rather than aspirational. The moment one endpoint accepts an upload "just
    for debugging", the claim is false for every patient on that build, and nobody outside
    this repo can tell.

    So it is enforced structurally: no route may accept a file upload at all.
    """
    offenders: list[str] = []
    for path, source in _python_sources(APP):
        for marker in RAW_MEDIA_MARKERS:
            if marker in source:
                for i, line in enumerate(source.splitlines(), 1):
                    if marker in line and not line.lstrip().startswith("#"):
                        offenders.append(f"{path.relative_to(BACKEND)}:{i}: {line.strip()}")
    assert not offenders, (
        "An endpoint appears to accept raw media. Raw audio/video/frames must never be "
        "uploaded — extract features on the device and post numbers.\n  "
        + "\n  ".join(offenders)
    )


def test_inv1_module_results_store_numbers_only():
    """The features column must hold scalars, not blobs."""
    from app.models import ModuleResult

    column = ModuleResult.__table__.c.features_json
    assert column.type.__class__.__name__ == "JSON", (
        "features_json must be JSON — a binary column here would be a place to hide media")
    assert not any(
        c.type.__class__.__name__ in ("LargeBinary", "BLOB")
        for c in ModuleResult.__table__.columns
    ), "no binary column may exist on module_results"


def test_inv1_no_table_has_a_binary_column():
    """Nowhere in the schema is there a place raw media could be persisted."""
    from app.models import Base

    binary = [
        f"{table.name}.{column.name}"
        for table in Base.metadata.tables.values()
        for column in table.columns
        if column.type.__class__.__name__ in ("LargeBinary", "BLOB")
    ]
    assert binary == [], f"binary columns found, media could be stored here: {binary}"


def test_inv1_no_registered_route_declares_a_binary_request_body():
    """The same invariant, checked against the app FastAPI actually built (Part 5.2).

    The scan above reads source text for three markers. That catches the obvious way in,
    but it is a grep: it would miss a schema field typed `bytes`, a custom media type, or
    any future mechanism that does not spell `UploadFile`. This asserts against the
    generated OpenAPI document instead — every route as REGISTERED, with its real request
    body — so a media-shaped parameter is caught regardless of how it was written.
    """
    from app.main import app

    schema = app.openapi()
    offenders: list[str] = []

    # 1. No operation may declare a binary/multipart request body.
    for path, methods in schema.get("paths", {}).items():
        for method, operation in methods.items():
            body = operation.get("requestBody") or {}
            for content_type in (body.get("content") or {}):
                if content_type.startswith(("multipart/", "image/", "audio/", "video/")) \
                        or content_type == "application/octet-stream":
                    offenders.append(f"{method.upper()} {path} accepts {content_type}")

    # 2. No component schema may carry a binary-format property. This is what a `bytes`
    #    field on a Pydantic model renders as, and it is the shape the grep cannot see.
    for name, component in (schema.get("components", {}).get("schemas", {})).items():
        for prop_name, prop in (component.get("properties") or {}).items():
            if prop.get("format") == "binary":
                offenders.append(f"schema {name}.{prop_name} is binary")

    assert not offenders, (
        "A registered route or schema can carry raw media. INV-1 says audio, video and "
        "frames are turned into numbers on the device and never uploaded.\n  "
        + "\n  ".join(offenders)
    )


# --------------------------------------------------------------------------- INV-2
def test_inv2_an_alert_always_has_a_lateralised_finding():
    """INV-2 — no ALERT without a one-sided change. See gates.py for why (Parkinson's).

    Asserted on BEHAVIOUR, not on source text. The earlier version grepped
    `inspect.getsource(evaluate_gates)` for "gate3_passed" and produced a false failure
    when a stale .pyc left the code object's line numbers pointing into a reshuffled file —
    `getsource` handed back a neighbouring function entirely. An invariant that cries wolf
    is an invariant somebody disables, so this now drives the engine and checks the answer.
    """
    from app.engine.deviation import LATERAL_THRESHOLD, ModuleDeviation
    from app.engine.gates import (
        BAND_ALERT,
        DEV_THRESHOLD,
        MIN_LATERALISED_DOMAINS,
        SessionDeviations,
        evaluate_gates,
    )

    assert MIN_LATERALISED_DOMAINS >= 1
    high = DEV_THRESHOLD + 1.5

    def session(lateral: float):
        c = SessionDeviations(session_id="inv2")
        for i, domain in enumerate(("cranial_nerves", "motor")):
            c.modules[f"M{i}"] = ModuleDeviation(
                module_code=f"M{i}", domain=domain, mean_abs_z=high, computed=True,
                has_laterality=True, lateral_abs_z=lateral,
                lateralised=lateral > LATERAL_THRESHOLD,
            )
        return c

    # Two domains, sustained, but SYMMETRIC -> must not reach ALERT.
    symmetric = evaluate_gates([session(0.2)] * 3)
    assert symmetric.gate2_passed is True
    assert symmetric.gate3_passed is False
    assert symmetric.band != BAND_ALERT

    # The same magnitudes, one-sided -> ALERT.
    lateralised = evaluate_gates([session(high)] * 3)
    assert lateralised.band == BAND_ALERT
    assert lateralised.gate3_passed is True
    assert lateralised.lateralised_domains


# --------------------------------------------------------------------------- INV-3
def test_inv3_the_acute_path_never_touches_the_engine():
    """INV-3 — acute symptoms and falls bypass scoring entirely.

    Both are events, not trends. Routing either through the gates would mean waiting for a
    second corroborating domain across two sessions while somebody needs help now.
    """
    for module in ("app/safety/acute.py", "app/routers/wearable.py"):
        source = (BACKEND / module).read_text(encoding="utf-8")
        assert "evaluate_gates" not in source, f"{module} must not call the gate"
        assert "compute_module_deviation" not in source, f"{module} must not score"


# --------------------------------------------------------------------------- INV-4
def test_inv4_the_frozen_reference_is_written_once():
    """INV-4 — the reference baseline is snapshot at lock and never updated.

    If it were ever updated it would inherit the exact blind spot it exists to cover: an
    adaptive yardstick cannot see a decline it has been following.
    """
    source = (BACKEND / "app/services/session_pipeline.py").read_text(encoding="utf-8")
    assert "row.reference_locked_at is None" in source, (
        "the snapshot must be guarded on being unset — otherwise it is an update")


# --------------------------------------------------------------------------- INV-5
def test_inv5_vendor_device_readings_are_never_restated_as_our_measurement():
    """INV-5 — we own the trend, the device vendor owns the measurement."""
    source = (BACKEND / "app/routers/wearable.py").read_text(encoding="utf-8")
    assert "claim_notice" in source
    assert source.count("claim_notice") >= 2, (
        "every wearable response must carry the claim boundary")


# --------------------------------------------------------------------------- INV-6
def test_inv6_server_side_authorisation_on_every_scoped_route():
    """INV-6 — the UI is never the security boundary."""
    for module in ("app/routers/asha.py", "app/routers/wearable.py",
                   "app/routers/dashboard.py"):
        source = (BACKEND / module).read_text(encoding="utf-8")
        assert ("require_roles" in source or "get_patient_for_user" in source), (
            f"{module} has no server-side authorisation dependency")


# --------------------------------------------------------------------------- INV-7
def test_inv7_migrations_never_lose_rows():
    """INV-7 — see tests/test_tiers_wearables_asha.py for the full account.

    Migration 0005 emptied the database on its first run: Alembic's SQLite batch mode drops
    the original table, and with `PRAGMA foreign_keys` on that cascaded into every child.
    """
    source = (BACKEND / "alembic" / "env.py").read_text(encoding="utf-8")
    assert "make_engine(" not in source
    assert "foreign_key_check" in source


# --------------------------------------------------------------------------- INV-8
def test_inv8_audit_rows_are_append_only():
    """INV-8 — corrections are new records, never edits or deletes."""
    from app.models import AuditLog

    assert not hasattr(AuditLog, "updated_at"), (
        "an audit row with an updated_at invites in-place editing")
    for path, source in _python_sources(APP):
        assert "delete(AuditLog)" not in source, f"{path} deletes audit rows"


# --------------------------------------------------------------------------- INV-10
def test_inv10_every_module_has_a_declared_tier_placement():
    """INV-10 — no module may be orphaned by a clinical amendment.

    Every exam module must declare which hardware it needs, and every module must be
    reachable by at least one tier. A module reachable by zero tiers is offered to nobody
    and fails silently: no error, no empty battery, just a measurement that never happens.

    This exists because module placement has drifted three times, each time as a side
    effect of a clinical change rather than a deliberate tier decision. Tier tests assert
    placement, and placement is exactly what clinical work moves.
    """
    from app.exam.registry import MODULES, TIER_CAPABILITIES, modules_for_tier

    known_devices = set().union(*TIER_CAPABILITIES.values())

    for code, module in MODULES.items():
        assert module.requires_device, f"{code} has no requires_device"
        assert module.requires_device in known_devices, (
            f"{code} requires '{module.requires_device}', which no tier provides. "
            f"Either add it to TIER_CAPABILITIES or use one of {sorted(known_devices)}."
        )

    # ...and each is actually offered somewhere.
    for code, module in MODULES.items():
        reachable = [
            tier for tier in TIER_CAPABILITIES
            if code in modules_for_tier(module.schedule, tier)
        ]
        assert reachable, (
            f"{code} is reachable by ZERO tiers — it would be offered to nobody, with no "
            f"error and no empty battery to notice. Declare its placement."
        )


def test_inv10_every_task_has_a_device_assignment_where_the_module_splits():
    """A partially-runnable module must assign EVERY task, not just the awkward ones.

    An unassigned task silently inherits the module default, which is how a task that
    needs supervision ends up offered to someone standing alone with their eyes shut.
    """
    from app.exam.registry import MODULES, TIER_CAPABILITIES

    known_devices = set().union(*TIER_CAPABILITIES.values())

    for code, module in MODULES.items():
        if not module.task_devices:
            continue
        missing = [t for t in module.tasks if t not in module.task_devices]
        assert not missing, (
            f"{code} splits by task but leaves {missing} unassigned; they would silently "
            f"inherit requires_device='{module.requires_device}'."
        )
        unknown = [t for t in module.task_devices if t not in module.tasks]
        assert not unknown, f"{code}.task_devices names tasks it does not have: {unknown}"
        for task, device in module.task_devices.items():
            assert device in known_devices, (
                f"{code}.{task} requires '{device}', which no tier provides")


def test_inv10_a_deferred_task_is_always_surfaced_as_visit_work():
    """Deferred must mean 'routed to someone', never 'quietly absent'.

    The failure this pins: M9's walking and stepping tasks were dropped off the ASHA
    worker's list when the module became phone-runnable. Those two tasks carry every one of
    M9's laterality features, so losing them would have converted posterior_vestibular into
    a domain that can never satisfy Gate 3 — breaking the amendment's core mechanism rather
    than merely reducing coverage.
    """
    from app.exam.registry import (
        MODULES,
        TIER_CAPABILITIES,
        tasks_deferred_for_tier,
        visit_workload_for_tier,
    )

    for tier in TIER_CAPABILITIES:
        workload = visit_workload_for_tier(tier)
        for code, module in MODULES.items():
            if not module.task_devices:
                continue
            deferred = tasks_deferred_for_tier(code, tier)
            if deferred:
                assert code in workload, (
                    f"{code} has deferred tasks {deferred} on {tier} but does not appear "
                    f"in the visit workload — they would reach nobody")
                assert set(deferred) <= set(workload[code])


def test_inv10_laterality_survives_or_is_explicitly_deferred():
    """A lateralisable module must never lose its laterality features silently.

    Either the tier can run the tasks those features come from, or the tasks appear as
    visit work. Anything else means the domain quietly stops being able to establish a
    focal finding, and Gate 3 can never pass on it.
    """
    from app.exam.registry import (
        MODULES,
        TIER_CAPABILITIES,
        tasks_for_tier,
        visit_workload_for_tier,
    )

    for tier in TIER_CAPABILITIES:
        workload = visit_workload_for_tier(tier)
        for code, module in MODULES.items():
            if not module.lateral_keys or not module.task_devices:
                continue
            runnable = tasks_for_tier(code, tier)
            for key in module.lateral_keys:
                source = next((t for t in module.tasks if key.startswith(t)), None)
                if source is None:
                    continue
                assert source in runnable or source in workload.get(code, []), (
                    f"{code} laterality feature '{key}' comes from task '{source}', which "
                    f"{tier} cannot run and which is not on the visit list. The domain "
                    f"would silently lose its ability to establish a side."
                )


def test_inv10_a_task_needing_supervision_can_never_be_marked_unsupervised():
    """Surfaced by probing the other INV-10 guards: they did NOT catch this.

    Nothing stopped a task being reassigned to `phone`. For most tasks that is a genuine
    improvement in reach. For the balance tasks it would ask a patient to close their eyes,
    narrow their base and take fifty steps on the spot with nobody within reach — a
    one-word change that reads as a convenience win and is a fall risk.

    "Runs on a phone" describes the camera, not whether it is safe to do alone.
    """
    from app.exam.registry import MODULES, SUPERVISED_DEVICES, SUPERVISED_TASKS

    for code, module in MODULES.items():
        for task, device in module.task_devices.items():
            if task in SUPERVISED_TASKS:
                assert device in SUPERVISED_DEVICES, (
                    f"{code}.{task} needs someone present but is assigned '{device}'. "
                    f"That would offer it to a patient alone. Use one of "
                    f"{sorted(SUPERVISED_DEVICES)}."
                )
        # A module with no task split is governed by its module-level device.
        if not module.task_devices:
            unsupervised = [t for t in module.tasks if t in SUPERVISED_TASKS]
            if unsupervised:
                assert module.requires_device in SUPERVISED_DEVICES, (
                    f"{code} contains supervised tasks {unsupervised} but requires only "
                    f"'{module.requires_device}'")


# --------------------------------------------------------------------------- INV-14
def test_inv14_daily_pulse_modules_hold_identical_positions_across_both_protocols():
    """INV-14 — A MODULE'S POSITION ON THE FATIGUE CURVE IS THE SAME IN EVERY SESSION TYPE.

    This is the two-protocol form of the rule `session_plan.py` has always enforced within
    one protocol: ordering is part of the measurement, not presentation (D-027). If finger
    tapping always runs at the same position, every session's tapping is measured at the
    same point on the fatigue curve, the patient's own baseline absorbs that offset, and
    position becomes a constant. A constant cannot confound.

    Two session types break that guarantee unless it is enforced. `SessionObservation`
    (engine/baseline.py) carries a module's raw feature values into its baseline with NO
    position adjustment — the median and MAD are computed directly over whatever the module
    measured. So if M7 sat at position 4 in Daily Pulse and position 15 in Comprehensive,
    its baseline would silently blend readings taken fresh with readings taken tired: two
    different physiological states averaged into one "normal".

    That is the same silent-corruption shape INV-2's laterality gate and D-043's cadence
    thresholds each guard against on a different axis. It degrades in the dangerous
    direction too — a rested reading looks like improvement, which MASKS decline.

    Enforced by construction in `session_plan.py`: both protocols are DERIVED from the one
    `PROTOCOL` tuple, with the six Daily Pulse modules pinned to positions 1-6 in each. This
    test pins the property itself, so a future hand-written second protocol cannot quietly
    reintroduce the confound. D-044.
    """
    from app.exam.session_plan import (
        COMPREHENSIVE_STEPS,
        DAILY_PULSE_MODULES,
        DAILY_PULSE_STEPS,
    )

    pulse = [(s.module, s.task, s.position) for s in DAILY_PULSE_STEPS]
    embedded = [
        (s.module, s.task, s.position)
        for s in COMPREHENSIVE_STEPS
        if s.module in DAILY_PULSE_MODULES
    ]

    assert pulse == embedded, (
        "A Daily Pulse module sits at a different position depending on session type. "
        "Its baseline would then mix fresh-position and fatigued-position readings, and "
        "the error masks decline rather than causing a false alarm.\n"
        f"  Daily Pulse:   {pulse}\n"
        f"  In Comprehensive: {embedded}"
    )
    # And the positions must be the leading block, not merely equal somewhere in the middle:
    # anything inserted before them would shift the whole fatigue curve underneath them.
    assert [p for _, _, p in pulse] == list(range(1, len(pulse) + 1)), (
        "Daily Pulse steps must occupy positions 1..N. If a comprehensive-only step were "
        "inserted ahead of them, every Daily Pulse module would move down the fatigue "
        "curve in Comprehensive sessions only."
    )
