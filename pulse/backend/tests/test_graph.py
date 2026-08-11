"""Ownership traversal and link analysis — the reincarnation pattern periodic review misses."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Entity
from app.services import graph


def _entity(session: Session, name: str) -> Entity:
    entity = session.execute(select(Entity).where(Entity.legal_name == name)).scalars().first()
    assert entity is not None, f"seeded entity {name!r} missing"
    return entity


def test_ubo_traversal_multiplies_ownership_through_a_holding_company(session: Session) -> None:
    halcyon = _entity(session, "Halcyon Wellness Ltd")
    result = graph.ubo_graph(session, halcyon.id, max_hops=3)

    assert result["entity"]["entity_id"] == halcyon.id
    assert result["ubos"], "no beneficial owner reached"
    for ubo in result["ubos"]:
        assert 0.0 < ubo["effective_percentage"] <= 100.0
        assert ubo["chain"]
        assert ubo["hops"] >= 1
    # Ownership held through a holding company must be reached at more than one hop.
    assert any(ubo["hops"] >= 2 for ubo in result["ubos"])
    assert result["gaps"], "unresolved ownership should be reported as a gap"


def test_ubo_traversal_respects_the_hop_limit(session: Session) -> None:
    halcyon = _entity(session, "Halcyon Wellness Ltd")
    deep = graph.ubo_graph(session, halcyon.id, max_hops=3)
    shallow = graph.ubo_graph(session, halcyon.id, max_hops=1)
    assert all(ubo["hops"] <= 1 for ubo in shallow["ubos"])
    assert len(shallow["ubos"]) <= len(deep["ubos"])


def test_link_analysis_flags_the_link_to_the_offboarded_entity(session: Session) -> None:
    halcyon = _entity(session, "Halcyon Wellness Ltd")
    meridian = _entity(session, "Meridian Wellness Ltd")
    assert meridian.status == "offboarded"

    analysis = graph.link_analysis(session, halcyon.id, max_hops=3)
    flags = [f for f in analysis["risk_flags"] if f["flag"] == "linked_to_offboarded_entity"]
    assert flags, "the reincarnation link was not detected"
    assert meridian.id in {flag["entity_id"] for flag in flags}
    flag = next(f for f in flags if f["entity_id"] == meridian.id)
    assert flag["severity"] in {"medium", "high"}
    assert "off-boarded" in flag["detail"]
    assert 0.0 < flag["path_strength"] <= 1.0


def test_link_analysis_paths_are_explainable(session: Session) -> None:
    halcyon = _entity(session, "Halcyon Wellness Ltd")
    analysis = graph.link_analysis(session, halcyon.id, max_hops=3)
    for neighbour in analysis["neighbours"]:
        assert neighbour["path"][0] == "Halcyon Wellness Ltd"
        assert neighbour["links"]
        for link in neighbour["links"]:
            assert link["rel_type"]
            assert link["evidence"]


def test_a_clean_merchant_has_no_offboarded_links(session: Session) -> None:
    clean = _entity(session, "Northwind Retail Limited")
    analysis = graph.link_analysis(session, clean.id, max_hops=2)
    assert not [
        flag for flag in analysis["risk_flags"] if flag["flag"] == "linked_to_offboarded_entity"
    ]
