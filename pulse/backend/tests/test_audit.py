"""The audit chain has to be tamper-evident, not merely complete."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditEvent, Entity
from app.services import audit


def test_chain_is_valid_after_the_full_seed(session: Session) -> None:
    status = audit.verify(session)
    assert status["valid"] is True
    assert status["events"] > 0
    assert status["head_hash"]


def test_append_links_each_event_to_its_predecessor(session: Session) -> None:
    head = session.execute(
        select(AuditEvent).order_by(AuditEvent.seq.desc())
    ).scalars().first()
    assert head is not None

    event = audit.append(
        session,
        actor="test@pulse.example",
        action="test.event_appended",
        subject_type="platform",
        payload={"note": "chain linkage"},
    )
    assert event.prev_hash == head.hash
    assert event.seq == head.seq + 1
    assert audit.verify(session)["valid"] is True


def test_payload_tampering_is_detected(session: Session) -> None:
    event = audit.append(
        session,
        actor="test@pulse.example",
        action="test.decision_recorded",
        subject_type="platform",
        payload={"outcome": "approve", "exposure": 10_000},
    )
    original_payload = dict(event.payload)
    seq = event.seq

    event.payload = {"outcome": "decline", "exposure": 10_000}
    session.flush()
    status = audit.verify(session)
    assert status["valid"] is False
    assert status["first_divergence_seq"] == seq

    event.payload = original_payload
    session.flush()
    assert audit.verify(session)["valid"] is True


def test_deleting_an_event_breaks_the_chain(session: Session) -> None:
    keep = audit.append(
        session,
        actor="test@pulse.example",
        action="test.first",
        subject_type="platform",
        payload={"n": 1},
    )
    victim = audit.append(
        session,
        actor="test@pulse.example",
        action="test.second",
        subject_type="platform",
        payload={"n": 2},
    )
    trailing = audit.append(
        session,
        actor="test@pulse.example",
        action="test.third",
        subject_type="platform",
        payload={"n": 3},
    )
    assert audit.verify(session)["valid"] is True

    victim_state = (victim.seq, victim.actor, victim.action, victim.subject_type, victim.payload)
    session.delete(victim)
    session.flush()
    status = audit.verify(session)
    assert status["valid"] is False
    assert status["first_divergence_seq"] == trailing.seq

    seq, actor, action, subject_type, payload = victim_state
    restored = AuditEvent(
        seq=seq,
        actor=actor,
        actor_role="system",
        action=action,
        subject_type=subject_type,
        subject_id=None,
        payload=payload,
        prev_hash=keep.hash,
        hash=trailing.prev_hash,
    )
    session.add(restored)
    session.flush()
    assert audit.verify(session)["valid"] is True


def test_examiner_export_is_json_safe_and_carries_chain_status(session: Session) -> None:
    import json

    halcyon = session.execute(
        select(Entity).where(Entity.legal_name == "Halcyon Wellness Ltd")
    ).scalars().one()
    pack = audit.export_entity_pack(session, halcyon.id)

    assert pack["entity_id"] == halcyon.id
    assert pack["chain_status"]["valid"] is True
    assert pack["audit_events"]
    assert pack["decisions"]
    json.dumps(pack)  # an examiner pack that cannot be serialised is not a deliverable


def test_entity_timeline_is_ordered_and_scoped(session: Session) -> None:
    halcyon = session.execute(
        select(Entity).where(Entity.legal_name == "Halcyon Wellness Ltd")
    ).scalars().one()
    timeline = audit.entity_timeline(session, halcyon.id)
    assert timeline
    sequences = [row["seq"] for row in timeline]
    assert sequences == sorted(sequences, reverse=True), "history reads newest first"
    assert all(row["subject_id"] == halcyon.id or row["subject_type"] != "entity" for row in timeline)
