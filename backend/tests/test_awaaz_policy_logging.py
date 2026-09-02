"""AWA-FR-014 — the production logging contract that makes offline evaluation possible.

`app/ml/rl/` could always compare candidate-ranking policies offline. Nothing in production
was ever eligible for it: Awaaz recorded no slate, no policy version, no propensity and no
confirmation outcome, so every importance weight had an unknown denominator and no product
event could support a counterfactual claim.

The load-bearing tests here are, in order:

  * `test_a_batch_of_rows_round_trips_into_feedback_the_gate_accepts` — the whole point. If
    stored rows cannot become `LoggedFeedback` objects that `gate_logged_feedback` admits,
    the table is decorative.
  * `test_the_recorded_propensity_is_the_probability_of_the_logged_action` and
    `test_empirical_frequencies_match_the_recorded_propensities` — a propensity that is not
    the probability of the action actually logged mis-specifies every weight and both SNIPS
    and IPS come back wrong with no blocker firing. Frequencies are the only way to check
    that the number written down is the number the sampler used.
  * `test_a_stored_row_carries_no_forbidden_field` — INV-11. Scans the serialised row for
    every class of thing that must not be in it, in the idiom of `test_privacy.py`: assert
    on the shape, and on the values, rather than trusting the column list to stay short.
"""
from __future__ import annotations

import collections
import json
import random
import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.auth.password import hash_password
from app.awaaz.safety import SpeechProfile
from app.ml.rl.contracts import MAX_CANDIDATES, LoggedFeedback
from app.ml.rl.safety import gate_logged_feedback
from app.models import (
    AuditLog, AwaazPolicyEvent, AwaazProfile, MAX_POLICY_CANDIDATES,
    MIN_POLICY_CANDIDATES, Patient, PolicyEventOutcome, Role, StrokeSide, User,
)
from app.routers.awaaz import (
    BEHAVIOUR_POLICY_ID,
    DEFAULT_EXPLORATION_BOUND,
    EXPLORATION_EPSILON,
    MAX_EXPLORATION_EPSILON,
    MAX_NEAR_TIE_MARGIN,
    MIN_EXPLORATION_EPSILON,
    MIN_TOP_ACTION_PROBABILITY,
    NEAR_TIE_MARGIN,
    ExplorationBound,
    eligible_logged_feedback,
    logged_feedback_from,
    rank_and_sample,
)

NOW = datetime(2026, 8, 1, 9, 0, tzinfo=timezone.utc)


# ------------------------------------------------------------------ the behaviour policy
def _slate(scores: list[float]) -> list[tuple[uuid.UUID, float]]:
    """Candidates with fixed, ordered UUIDs so the tie-break is reproducible."""
    return [(uuid.UUID(int=i + 1), score) for i, score in enumerate(scores)]


def test_the_bound_refuses_a_deterministic_configuration():
    """epsilon=0 is the configuration that silently destroys the whole exercise.

    Under pi_0(a|x)=1 no alternative was ever observable, positivity fails and
    `compare_policies` refuses the log with `logging_policy_is_deterministic`. A logger
    built that way would collect data for months and produce nothing, so it is rejected at
    construction rather than discovered at analysis time.
    """
    with pytest.raises(ValueError, match="logging_policy_is_deterministic"):
        ExplorationBound(epsilon=0.0)
    with pytest.raises(ValueError):
        ExplorationBound(epsilon=MIN_EXPLORATION_EPSILON / 2)
    with pytest.raises(ValueError):
        ExplorationBound(epsilon=MAX_EXPLORATION_EPSILON + 0.01)


def test_the_bound_refuses_anything_that_demotes_the_top_candidate():
    """A patient-facing ranker may explore; it may not stop preferring its best answer."""
    with pytest.raises(ValueError, match="top-ranked"):
        ExplorationBound(epsilon=0.15, max_explored=3)
    with pytest.raises(ValueError, match="clearly-worse"):
        ExplorationBound(near_tie_margin=MAX_NEAR_TIE_MARGIN + 0.01)
    with pytest.raises(ValueError, match="clearly-worse"):
        ExplorationBound(near_tie_margin=0.0)
    with pytest.raises(ValueError):
        ExplorationBound(max_explored=1)
    with pytest.raises(ValueError):
        ExplorationBound(max_explored=MAX_POLICY_CANDIDATES + 1)
    # The default must itself satisfy the bound it advertises.
    top = 1.0 - DEFAULT_EXPLORATION_BOUND.epsilon * (
        DEFAULT_EXPLORATION_BOUND.max_explored - 1)
    assert top >= MIN_TOP_ACTION_PROBABILITY


def test_a_clearly_better_candidate_is_never_shown_below_a_worse_one():
    """Not "rarely" — never. Anything outside the near-tie band has probability zero.

    Swept over the full score range so this is a statement about the policy, not about one
    fixture. The second candidate is always more than the margin behind.
    """
    rng = random.Random(7)
    for step in range(0, 51):
        best = 0.49 + step / 100
        candidates = _slate([best, best - NEAR_TIE_MARGIN - 0.01, 0.10])
        for _ in range(200):
            decision = rank_and_sample(candidates, rng=rng)
            assert decision.logged_action_id == candidates[0][0]
            assert decision.logged_action_probability == 1.0
            assert decision.randomised is False


def test_a_clear_winner_is_logged_deterministically_and_flagged():
    """Flagged, not refused. Refusing would select the log on the shape of the slate;
    `offline.py` already fails the whole comparison closed once too many accumulate."""
    decision = rank_and_sample(_slate([0.90, 0.40]), rng=random.Random(1))
    assert decision.randomised is False
    assert decision.logged_action_probability == 1.0
    assert decision.logged_action_id == decision.top_ranked_action_id


def test_near_tied_candidates_are_explored_within_the_documented_bound():
    decision = rank_and_sample(_slate([0.80, 0.78, 0.77, 0.20]), rng=random.Random(0))
    assert decision.randomised is True
    # Top plus at most two alternatives, each at a flat epsilon.
    assert decision.logged_action_probability in (
        pytest.approx(1.0 - 2 * EXPLORATION_EPSILON), pytest.approx(EXPLORATION_EPSILON))
    assert decision.top_ranked_action_id == uuid.UUID(int=1)
    # The offered order leads with the action that was logged, so "logged" and "what the
    # patient saw first" cannot drift apart.
    assert decision.offered_candidate_ids[0] == decision.logged_action_id
    assert set(decision.offered_candidate_ids) == {uuid.UUID(int=i) for i in (1, 2, 3, 4)}


def test_the_recorded_propensity_is_the_probability_of_the_logged_action():
    """Not the top-ranked action's probability. This distinction is the whole contract.

    Swept across every seed that produces each possible draw: whenever a non-top candidate
    is logged, the recorded number must be the small one, and it must be small enough that
    `contracts.LoggedFeedback` accepts it as a non-top action (<= 0.5).
    """
    candidates = _slate([0.80, 0.79, 0.78])
    seen = set()
    for seed in range(300):
        decision = rank_and_sample(candidates, rng=random.Random(seed))
        seen.add(decision.logged_action_id)
        if decision.logged_action_id == decision.top_ranked_action_id:
            assert decision.logged_action_probability == pytest.approx(
                1.0 - 2 * EXPLORATION_EPSILON)
        else:
            assert decision.logged_action_probability == pytest.approx(
                EXPLORATION_EPSILON)
            assert decision.logged_action_probability <= 0.5
    assert len(seen) == 3, "the sampler never reached every explorable candidate"


def test_empirical_frequencies_match_the_recorded_propensities():
    """The only real check that the denominator is the number the sampler used.

    A logger can record any float it likes; nothing downstream can tell a mistaken
    propensity from an honest one. Drawing 40k times with a fixed seed and comparing the
    empirical frequency of each action to the probability recorded alongside it is the
    check that closes that hole.
    """
    candidates = _slate([0.80, 0.79, 0.78])
    rng = random.Random(42)
    counts: collections.Counter = collections.Counter()
    recorded: dict[uuid.UUID, float] = {}
    draws = 40_000
    for _ in range(draws):
        decision = rank_and_sample(candidates, rng=rng)
        counts[decision.logged_action_id] += 1
        recorded.setdefault(
            decision.logged_action_id, decision.logged_action_probability)
        assert recorded[decision.logged_action_id] == pytest.approx(
            decision.logged_action_probability), (
            "the same action was logged with two different propensities")

    assert sum(recorded.values()) == pytest.approx(1.0)
    for action_id, probability in recorded.items():
        empirical = counts[action_id] / draws
        # 3 sigma on a binomial at n=40k is under 0.005 for every probability here.
        assert empirical == pytest.approx(probability, abs=0.01), (
            f"action {action_id} was logged {empirical:.4f} of the time but recorded "
            f"a propensity of {probability}")


def test_equal_scores_break_ties_reproducibly_rather_than_by_arrival_order():
    """Without the UUID tie-break, `top_ranked_action_id` would depend on request order and
    would stop being a reproducible property of the scores."""
    forward = _slate([0.80, 0.80, 0.80])
    reversed_order = list(reversed(forward))
    assert (
        rank_and_sample(forward, rng=random.Random(3)).top_ranked_action_id
        == rank_and_sample(reversed_order, rng=random.Random(3)).top_ranked_action_id
    )


def test_the_slate_bounds_agree_with_the_offline_contract():
    """A slate this table accepts and `contracts.py` rejects would be silently unloggable."""
    assert MAX_POLICY_CANDIDATES == MAX_CANDIDATES
    assert MIN_POLICY_CANDIDATES == 2


# ------------------------------------------------------------------ fixtures
async def _patient(session, *, profile: str = "dysarthria_dominant"
                   ) -> tuple[User, Patient]:
    caregiver = User(email=f"c-{uuid.uuid4().hex[:8]}@example.com",
                     pw_hash=hash_password("a-real-password"), role=Role.caregiver)
    session.add(caregiver)
    await session.flush()
    patient = Patient(
        caregiver_id=caregiver.id, name="Ramesh", age=67,
        stroke_date=NOW - timedelta(days=200), stroke_side=StrokeSide.left,
        languages=["en"],
    )
    session.add(patient)
    await session.flush()
    session.add(AwaazProfile(patient_id=patient.id, speech_profile=profile))
    await session.commit()
    return caregiver, patient


async def _headers(client, caregiver) -> dict:
    resp = await client.post("/auth/login", json={
        "email": caregiver.email, "password": "a-real-password"})
    return {"Authorization": f"Bearer {resp.json()['tokens']['access_token']}"}


def _decision_body(candidate_ids: list[uuid.UUID], scores: list[float],
                   event_id: uuid.UUID) -> dict:
    return {
        "event_id": str(event_id),
        "candidates": [
            {"candidate_id": str(cid), "score": score}
            for cid, score in zip(candidate_ids, scores)
        ],
        "requires_confirmation": True,
        "policy_logging_consent": True,
    }


async def _log_one_event(client, headers, patient, *, scores=(0.80, 0.79, 0.78),
                         outcome="selected", select_logged=True):
    """Run the two-request flow once and return (decision body, outcome body)."""
    event_id = uuid.uuid4()
    ids = [uuid.uuid4() for _ in scores]
    decision = await client.post(
        f"/awaaz/{patient.id}/policy/decision",
        json=_decision_body(ids, list(scores), event_id), headers=headers)
    assert decision.status_code == 200, decision.text
    drawn = decision.json()

    body: dict = {"event_id": str(event_id), "outcome": outcome, "actor": "patient"}
    if outcome == "selected":
        body["selected_action_id"] = (
            drawn["logged_action_id"] if select_logged
            else drawn["offered_candidate_ids"][-1])
        body["confirmation_observed"] = True
        body["output_spoken"] = True
    elif outcome == "rejected":
        body["rejected_action_ids"] = [drawn["logged_action_id"]]
    logged = await client.post(
        f"/awaaz/{patient.id}/policy/outcome", json=body, headers=headers)
    assert logged.status_code == 200, logged.text
    return drawn, logged.json()


# ------------------------------------------------------------------ INV-11
#: Column and key names that must never exist on this row. Checked as names, because a
#: forbidden field added later will arrive with an ordinary-looking name and no test that
#: only inspects values would notice it.
FORBIDDEN_KEY = re.compile(
    r"patient|user|caregiver|subject|text|transcript|utterance|phrase|word|lang"
    r"|audio|wav|media|sha|hash|capture|duration|latency|ms\b|seconds|elapsed"
    r"|dwell|tap|touch|timing|timestamp|\bts\b|created_at|updated_at"
    r"|profile|score|confidence|band|deviation|alert|diagnosis|clinical|severity"
    r"|name|email|phone|address|location|lat\b|lon\b",
    re.IGNORECASE,
)

#: Names the regex above would otherwise hit for the wrong reason. Each is justified.
ALLOWED_DESPITE_THE_PATTERN = {
    # "speech_profile" contains no identifier: it is the same coarse four-value enum
    # `contracts.LoggedFeedback` already carries, and the offline gate admits only one of
    # its values, so a log without it would be entirely ineligible.
    "speech_profile",
}


async def test_a_stored_row_carries_no_forbidden_field(session, client):
    """INV-11, by serialising and scanning — `test_privacy.py`'s idiom.

    Both directions: no forbidden NAME on the row, and none of the identifying VALUES that
    exist elsewhere in this patient's record appear in it. The patient is given a name and
    the slate ids are unrelated to anything the patient said, so a leak of either kind
    shows up as a substring.
    """
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    await _log_one_event(client, headers, patient)

    row = (await session.scalars(select(AwaazPolicyEvent))).one()
    serialised = {
        column.name: getattr(row, column.name)
        for column in AwaazPolicyEvent.__table__.columns
    }

    columns = set(serialised)
    assert ALLOWED_DESPITE_THE_PATTERN <= columns, (
        "the carve-out list names a column that no longer exists — it must not rot into a "
        "blanket exemption")
    offenders = [
        name for name in serialised
        if name not in ALLOWED_DESPITE_THE_PATTERN and FORBIDDEN_KEY.search(name)
    ]
    assert offenders == [], (
        "awaaz_policy_events grew a column that can carry an identifier, free text, media "
        f"metadata, a timing signal, or a clinical outcome: {offenders}"
    )

    blob = json.dumps(serialised, default=str)
    for identifying in (patient.name, str(patient.id), caregiver.email,
                        str(caregiver.id), "Ramesh"):
        assert identifying not in blob, (
            "an identifying value from elsewhere in this patient's record reached the "
            "policy event row"
        )

    # Nothing on this table is wide enough or loose enough to hold a sentence.
    for column in AwaazPolicyEvent.__table__.columns:
        if column.name in ("candidate_action_ids", "rejected_action_ids"):
            continue          # JSON, but only ever lists of UUID strings — asserted below
        length = getattr(column.type, "length", None)
        assert length is None or length <= 64, (
            f"{column.name} is wide enough to hold free text")
    for value in (*row.candidate_action_ids, *row.rejected_action_ids):
        uuid.UUID(value)      # raises unless every element is an opaque UUID


async def test_the_table_has_no_patient_column_or_foreign_key(session):
    """The deliberate omission, asserted so nobody restores it as a convenience.

    A patient column would make cohort work and a per-patient split possible, and would also
    make the log a per-person record of what a disabled person tried to say. That trade is
    refused. The cost — repeated-speaker dependence stays unaddressed, exactly as
    `offline.LIMITATIONS` says — is real and is the price of INV-11.
    """
    table = AwaazPolicyEvent.__table__
    assert list(table.foreign_keys) == []
    assert not any("patient" in column.name for column in table.columns)


async def test_the_audit_trail_records_the_action_without_a_join_key(session, client):
    """audit_log carries patient_id and a microsecond ts. If it also carried the event id,
    the join back onto the policy row would be exact and this table's anonymity would be
    worth nothing."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    _, logged = await _log_one_event(client, headers, patient)

    rows = list(await session.scalars(select(AuditLog).where(
        AuditLog.action.in_(
            ("awaaz.policy_event.decide", "awaaz.policy_event.log")))))
    assert {row.action for row in rows} == {
        "awaaz.policy_event.decide", "awaaz.policy_event.log"}
    assert all(row.patient_id == patient.id and row.actor_id == caregiver.id
               for row in rows)
    blob = json.dumps([row.meta_json for row in rows])
    assert logged["id"] not in blob
    for candidate_id in logged["candidate_action_ids"]:
        assert candidate_id not in blob


# ------------------------------------------------------------------ the API surface
async def test_authorisation_is_enforced_on_both_routes(session, client):
    """INV-6. Unauthenticated, and authenticated-as-somebody-else, on every scoped route."""
    caregiver, patient = await _patient(session)
    other_caregiver, other_patient = await _patient(session)
    headers = await _headers(client, caregiver)
    stranger = await _headers(client, other_caregiver)

    event_id = uuid.uuid4()
    body = _decision_body([uuid.uuid4(), uuid.uuid4()], [0.80, 0.79], event_id)
    assert (await client.post(
        f"/awaaz/{patient.id}/policy/decision", json=body)).status_code == 401
    assert (await client.post(
        f"/awaaz/{patient.id}/policy/decision", json=body,
        headers=stranger)).status_code == 403

    drawn = await client.post(f"/awaaz/{patient.id}/policy/decision",
                              json=body, headers=headers)
    assert drawn.status_code == 200, drawn.text
    outcome = {"event_id": str(event_id), "outcome": "phrase_board_fallback"}
    assert (await client.post(
        f"/awaaz/{patient.id}/policy/outcome", json=outcome)).status_code == 401
    assert (await client.post(
        f"/awaaz/{patient.id}/policy/outcome", json=outcome,
        headers=stranger)).status_code == 403
    # The stranger owns their own patient, so authorisation passes there and the pending
    # decision must still not be reachable — it belongs to a different person.
    assert (await client.post(
        f"/awaaz/{other_patient.id}/policy/outcome", json=outcome,
        headers=stranger)).status_code == 404
    assert (await session.scalar(select(AwaazPolicyEvent))) is None


async def test_consent_and_the_confirmation_path_are_both_required(session, client):
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    ids = [uuid.uuid4(), uuid.uuid4()]

    body = _decision_body(ids, [0.80, 0.79], uuid.uuid4())
    body["policy_logging_consent"] = False
    refused = await client.post(f"/awaaz/{patient.id}/policy/decision",
                                json=body, headers=headers)
    assert refused.status_code == 409
    assert "consent" in refused.text.lower()

    body = _decision_body(ids, [0.80, 0.79], uuid.uuid4())
    body["requires_confirmation"] = False
    refused = await client.post(f"/awaaz/{patient.id}/policy/decision",
                                json=body, headers=headers)
    assert refused.status_code == 409
    assert "confirmation" in refused.text.lower()
    assert (await session.scalar(select(AwaazPolicyEvent))) is None


async def test_no_endpoint_accepts_media_or_text(session, client):
    """INV-1 and INV-11 at the boundary. Unknown keys are rejected rather than ignored —
    an ignored `text` field still travels through the request log."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    event_id, ids = uuid.uuid4(), [uuid.uuid4(), uuid.uuid4()]

    smuggled = _decision_body(ids, [0.80, 0.79], event_id)
    smuggled["candidates"][0]["text"] = "I need the toilet"
    assert (await client.post(f"/awaaz/{patient.id}/policy/decision", json=smuggled,
                              headers=headers)).status_code == 422
    smuggled = _decision_body(ids, [0.80, 0.79], event_id)
    smuggled["audio_sha256"] = "ab" * 32
    assert (await client.post(f"/awaaz/{patient.id}/policy/decision", json=smuggled,
                              headers=headers)).status_code == 422

    ok = await client.post(f"/awaaz/{patient.id}/policy/decision",
                           json=_decision_body(ids, [0.80, 0.79], event_id),
                           headers=headers)
    assert ok.status_code == 200
    outcome = {"event_id": str(event_id), "outcome": "corrected",
               "corrected_text": "water"}
    assert (await client.post(f"/awaaz/{patient.id}/policy/outcome", json=outcome,
                              headers=headers)).status_code == 422


async def test_a_retried_decision_returns_the_same_draw(session, client):
    """Resampling on retry would mean the propensity we eventually write was not the
    probability of the action the patient was actually shown."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    event_id, ids = uuid.uuid4(), [uuid.uuid4() for _ in range(3)]
    body = _decision_body(ids, [0.80, 0.79, 0.78], event_id)

    first = await client.post(f"/awaaz/{patient.id}/policy/decision",
                              json=body, headers=headers)
    for _ in range(5):
        again = await client.post(f"/awaaz/{patient.id}/policy/decision",
                                  json=body, headers=headers)
        assert again.json() == first.json()

    # A different slate under the same event id is a different decision, not a retry.
    other = _decision_body([uuid.uuid4(), uuid.uuid4()], [0.80, 0.79], event_id)
    assert (await client.post(f"/awaaz/{patient.id}/policy/decision", json=other,
                              headers=headers)).status_code == 409


async def test_a_retried_outcome_writes_exactly_one_append_only_row(session, client):
    """INV-8. A retry lands on the same row; a differing report is refused, not applied."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    event_id, ids = uuid.uuid4(), [uuid.uuid4() for _ in range(3)]
    drawn = (await client.post(
        f"/awaaz/{patient.id}/policy/decision",
        json=_decision_body(ids, [0.80, 0.79, 0.78], event_id),
        headers=headers)).json()

    body = {"event_id": str(event_id), "outcome": "selected",
            "selected_action_id": drawn["logged_action_id"],
            "confirmation_observed": True, "output_spoken": True}
    first = await client.post(f"/awaaz/{patient.id}/policy/outcome",
                              json=body, headers=headers)
    assert first.status_code == 200, first.text
    for _ in range(3):
        again = await client.post(f"/awaaz/{patient.id}/policy/outcome",
                                  json=body, headers=headers)
        assert again.status_code == 200
        assert again.json() == first.json()

    revised = dict(body, outcome="rejected", selected_action_id=None,
                   rejected_action_ids=[drawn["logged_action_id"]],
                   confirmation_observed=False, output_spoken=False)
    conflict = await client.post(f"/awaaz/{patient.id}/policy/outcome",
                                 json=revised, headers=headers)
    assert conflict.status_code == 409
    assert "already logged" in conflict.text.lower()

    rows = list(await session.scalars(select(AwaazPolicyEvent)))
    assert len(rows) == 1
    assert rows[0].outcome == "selected"
    # Retrying the decision after the row exists must also be idempotent, and must return
    # the propensity that was actually stored rather than drawing a new one.
    replay = await client.post(
        f"/awaaz/{patient.id}/policy/decision",
        json=_decision_body(ids, [0.80, 0.79, 0.78], event_id), headers=headers)
    assert replay.json()["logged_action_probability"] == pytest.approx(
        rows[0].logged_action_probability)


async def test_an_outcome_without_a_drawn_decision_is_refused(session, client):
    """A row whose denominator nobody drew is worse than no row."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    refused = await client.post(
        f"/awaaz/{patient.id}/policy/outcome",
        json={"event_id": str(uuid.uuid4()), "outcome": "phrase_board_fallback"},
        headers=headers)
    assert refused.status_code == 404
    assert "propensity" in refused.text.lower()


async def test_a_row_that_contradicts_the_confirmation_gate_is_refused(session, client):
    """INV-9 as an observation. Append-only means a contradictory row is permanent, so it
    is refused at write time rather than filtered at read time."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    event_id, ids = uuid.uuid4(), [uuid.uuid4() for _ in range(3)]
    drawn = (await client.post(
        f"/awaaz/{patient.id}/policy/decision",
        json=_decision_body(ids, [0.80, 0.79, 0.78], event_id),
        headers=headers)).json()

    spoken_unconfirmed = {
        "event_id": str(event_id), "outcome": "selected",
        "selected_action_id": drawn["logged_action_id"],
        "confirmation_observed": False, "output_spoken": True}
    refused = await client.post(f"/awaaz/{patient.id}/policy/outcome",
                                json=spoken_unconfirmed, headers=headers)
    assert refused.status_code == 409
    assert "confirm" in refused.text.lower()

    confirmed_nothing = {"event_id": str(event_id), "outcome": "rejected",
                         "rejected_action_ids": [drawn["logged_action_id"]],
                         "confirmation_observed": True}
    assert (await client.post(f"/awaaz/{patient.id}/policy/outcome",
                              json=confirmed_nothing,
                              headers=headers)).status_code == 409

    stranger_candidate = {"event_id": str(event_id), "outcome": "selected",
                          "selected_action_id": str(uuid.uuid4()),
                          "confirmation_observed": True}
    assert (await client.post(f"/awaaz/{patient.id}/policy/outcome",
                              json=stranger_candidate,
                              headers=headers)).status_code == 409
    assert (await session.scalar(select(AwaazPolicyEvent))) is None


async def test_the_row_records_the_slate_the_policy_the_propensity_and_the_outcome(
        session, client):
    """AWA-FR-014's acceptance criterion, on a real row."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    drawn, logged = await _log_one_event(client, headers, patient)

    row = (await session.scalars(select(AwaazPolicyEvent))).one()
    assert row.behavior_policy_id == BEHAVIOUR_POLICY_ID
    assert len(row.candidate_action_ids) == 3
    assert row.candidate_action_ids[0] == str(row.logged_action_id)
    assert str(row.logged_action_id) == drawn["logged_action_id"]
    assert row.logged_action_probability == pytest.approx(
        drawn["logged_action_probability"])
    assert str(row.top_ranked_action_id) == drawn["top_ranked_action_id"]
    assert row.speech_profile == SpeechProfile.dysarthria_dominant.value
    assert row.confirmation_required is True
    assert row.emergency is False
    assert row.outcome == PolicyEventOutcome.selected.value
    assert row.logged_on == datetime.now(timezone.utc).date()
    assert logged["randomised"] is row.randomised


# ------------------------------------------------------------------ THE ROUND TRIP
async def test_a_batch_of_rows_round_trips_into_feedback_the_gate_accepts(
        session, client):
    """The whole point. Stored rows become `LoggedFeedback` that the offline gate ADMITS.

    Without this, everything above is a table nobody can use. The batch deliberately mixes
    outcomes — the patient taking the logged candidate, taking a different one, rejecting,
    correcting, and leaving for the phrase board — because a log containing only agreement
    would pass this test and support no comparison at all.
    """
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)

    plan = [("selected", True), ("selected", False), ("rejected", None),
            ("corrected", None), ("phrase_board_fallback", None)] * 4
    for outcome, select_logged in plan:
        await _log_one_event(client, headers, patient, outcome=outcome,
                             select_logged=bool(select_logged))

    rows = list(await session.scalars(select(AwaazPolicyEvent)))
    assert len(rows) == len(plan)

    feedback = eligible_logged_feedback(rows)
    assert len(feedback) == len(rows)
    for item in feedback:
        assert isinstance(item, LoggedFeedback)
        gate = gate_logged_feedback(item)
        assert gate.allowed, f"the gate refused a real product row: {gate.blockers}"

    # And the propensity survived the trip as the LOGGED action's probability.
    for row, item in zip(sorted(rows, key=lambda r: r.id.int),
                         sorted(feedback, key=lambda f: f.event_id.int)):
        assert item.logged_action_id == row.logged_action_id
        assert item.logged_action_probability == row.logged_action_probability
        if item.top_ranked_action_id != item.logged_action_id:
            assert item.logged_action_probability <= 0.5
    # Canonical JSON is what an append-only export would sign; nothing free-text in it.
    assert "Ramesh" not in feedback[0].canonical_json()


async def test_an_event_with_no_explicit_signal_is_logged_but_never_becomes_feedback(
        session, client):
    """Recorded so the log is not selected on the outcome; skipped at export because
    inactivity is not a preference."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    await _log_one_event(client, headers, patient, outcome="no_explicit_signal")
    await _log_one_event(client, headers, patient, outcome="rejected")

    rows = list(await session.scalars(select(AwaazPolicyEvent)))
    assert len(rows) == 2
    silent = next(r for r in rows
                  if r.outcome == PolicyEventOutcome.no_explicit_signal.value)
    with pytest.raises(ValueError, match="no explicit patient signal"):
        logged_feedback_from(silent)
    assert len(eligible_logged_feedback(rows)) == 1


async def test_a_caregiver_actor_is_retained_and_refused_as_patient_preference(
        session, client):
    """It is not silently promoted to the patient's own preference; the gate blocks it."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    event_id, ids = uuid.uuid4(), [uuid.uuid4() for _ in range(3)]
    drawn = (await client.post(
        f"/awaaz/{patient.id}/policy/decision",
        json=_decision_body(ids, [0.80, 0.79, 0.78], event_id),
        headers=headers)).json()
    assert (await client.post(f"/awaaz/{patient.id}/policy/outcome", json={
        "event_id": str(event_id), "outcome": "selected", "actor": "caregiver",
        "selected_action_id": drawn["logged_action_id"],
        "confirmation_observed": True}, headers=headers)).status_code == 200

    row = (await session.scalars(select(AwaazPolicyEvent))).one()
    gate = gate_logged_feedback(logged_feedback_from(row))
    assert gate.allowed is False
    assert "caregiver_label_is_not_patient_preference" in gate.blockers


async def test_a_profile_outside_the_mvp_is_logged_and_gated_out(session, client):
    """The row is honest about the profile; the gate, not the logger, decides eligibility."""
    caregiver, patient = await _patient(session, profile="aphasia_dominant")
    headers = await _headers(client, caregiver)
    await _log_one_event(client, headers, patient, outcome="rejected")

    row = (await session.scalars(select(AwaazPolicyEvent))).one()
    assert row.speech_profile == SpeechProfile.aphasia_dominant.value
    gate = gate_logged_feedback(logged_feedback_from(row))
    assert "profile_outside_dysarthria_mvp" in gate.blockers
