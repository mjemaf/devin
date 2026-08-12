"""Beneficial ownership graph and network / link analysis.

The blind-spots memo's highest-severity gap: single-entity scoring is structurally blind to rings,
bust-outs and off-boarded actors returning behind a new shell. Everything here is deliberately
relational — the answer to "who is this?" includes "and who are they connected to?".
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import networkx as nx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Entity, Merchant, OwnershipEdge, Relationship

UBO_THRESHOLD = 25.0  # percent — the conventional beneficial-ownership disclosure threshold

# How strongly each link type suggests a controlled/coordinated relationship.
LINK_WEIGHTS: dict[str, float] = {
    "shared_director": 0.85,
    "shared_ubo": 0.9,
    "shared_bank_account": 0.95,
    "shared_address": 0.6,
    "shared_device": 0.7,
    "shared_website_registrar": 0.45,
    "shared_phone": 0.55,
    "common_settlement_account": 0.9,
}


@dataclass
class OwnershipPath:
    path: list[dict[str, Any]]
    effective_percentage: float
    min_confidence: float


def _entity_brief(entity: Entity) -> dict[str, Any]:
    return {
        "entity_id": entity.id,
        "legal_name": entity.legal_name,
        "entity_type": entity.entity_type,
        "country": entity.country,
        "status": entity.status,
        "offboarded_reason": entity.offboarded_reason,
    }


def ubo_graph(session: Session, entity_id: int, max_hops: int = 3) -> dict[str, Any]:
    """Walk ownership upwards to ``max_hops``, computing effective (multiplied) ownership."""
    edges = session.execute(select(OwnershipEdge)).scalars().all()
    upstream: dict[int, list[OwnershipEdge]] = {}
    for edge in edges:
        upstream.setdefault(edge.owned_entity_id, []).append(edge)

    paths: list[OwnershipPath] = []
    nodes: dict[int, dict[str, Any]] = {}
    graph_edges: list[dict[str, Any]] = []

    def walk(
        current: int, chain: list[dict[str, Any]], pct: float, confidence: float, depth: int
    ) -> None:
        if depth > max_hops:
            return
        for edge in upstream.get(current, []):
            owner = session.get(Entity, edge.owner_entity_id)
            if owner is None or any(step["entity_id"] == owner.id for step in chain):
                continue
            step = {
                **_entity_brief(owner),
                "percentage": edge.percentage,
                "role": edge.role,
                "source": edge.source,
                "confidence": edge.confidence,
                "hop": depth,
            }
            nodes[owner.id] = _entity_brief(owner)
            graph_edges.append(
                {
                    "from": owner.id,
                    "to": current,
                    "percentage": edge.percentage,
                    "source": edge.source,
                    "type": "ownership",
                }
            )
            effective = pct * (edge.percentage / 100.0)
            new_chain = [*chain, step]
            if owner.entity_type == "person":
                paths.append(
                    OwnershipPath(new_chain, effective * 100.0, min(confidence, edge.confidence))
                )
            walk(owner.id, new_chain, effective, min(confidence, edge.confidence), depth + 1)

    root = session.get(Entity, entity_id)
    if root is None:
        raise LookupError(f"unknown entity {entity_id}")
    nodes[root.id] = _entity_brief(root)
    walk(entity_id, [], 1.0, 1.0, 1)

    ubos = [
        {
            "entity_id": path.path[-1]["entity_id"],
            "name": path.path[-1]["legal_name"],
            "effective_percentage": round(path.effective_percentage, 2),
            "is_ubo": path.effective_percentage >= UBO_THRESHOLD,
            "hops": len(path.path),
            "min_confidence": round(path.min_confidence, 3),
            "chain": [step["legal_name"] for step in path.path],
        }
        for path in paths
    ]
    ubos.sort(key=lambda row: -row["effective_percentage"])

    declared = sum(
        edge.percentage for edge in session.execute(
            select(OwnershipEdge).where(OwnershipEdge.owned_entity_id == entity_id)
        ).scalars()
    )
    gaps: list[str] = []
    if declared < 99.0:
        gaps.append(f"ownership only accounts for {declared:.1f}% of {root.legal_name}")
    if not ubos:
        gaps.append("no natural person reached within the hop limit")
    if any(u["min_confidence"] < 0.8 for u in ubos):
        gaps.append("at least one ownership link is low confidence and needs evidence")

    return {
        "entity": _entity_brief(root),
        "ubos": ubos,
        "nodes": list(nodes.values()),
        "edges": graph_edges,
        "declared_ownership_percentage": round(declared, 2),
        "gaps": gaps,
    }


def _build_graph(session: Session) -> nx.Graph:
    graph = nx.Graph()
    for entity in session.execute(select(Entity)).scalars():
        graph.add_node(entity.id, **_entity_brief(entity))
    for edge in session.execute(select(OwnershipEdge)).scalars():
        graph.add_edge(
            edge.owner_entity_id,
            edge.owned_entity_id,
            rel_type="ownership",
            weight=0.9,
            evidence=f"{edge.percentage:.1f}% ownership ({edge.source})",
        )
    for rel in session.execute(select(Relationship)).scalars():
        graph.add_edge(
            rel.from_entity_id,
            rel.to_entity_id,
            rel_type=rel.rel_type,
            weight=LINK_WEIGHTS.get(rel.rel_type, rel.strength),
            evidence=rel.evidence or rel.rel_type,
        )
    return graph


def link_analysis(session: Session, entity_id: int, max_hops: int = 2) -> dict[str, Any]:
    """Surface hidden links, especially to previously off-boarded or listed entities."""
    graph = _build_graph(session)
    if entity_id not in graph:
        raise LookupError(f"unknown entity {entity_id}")

    lengths = nx.single_source_shortest_path_length(graph, entity_id, cutoff=max_hops)
    neighbours: list[dict[str, Any]] = []
    risk_flags: list[dict[str, Any]] = []

    for other_id, hops in lengths.items():
        if other_id == entity_id:
            continue
        path = nx.shortest_path(graph, entity_id, other_id)
        links = [
            {
                "from": path[i],
                "to": path[i + 1],
                "rel_type": graph.edges[path[i], path[i + 1]]["rel_type"],
                "evidence": graph.edges[path[i], path[i + 1]]["evidence"],
            }
            for i in range(len(path) - 1)
        ]
        strength = 1.0
        for i in range(len(path) - 1):
            strength *= graph.edges[path[i], path[i + 1]]["weight"]
        node = graph.nodes[other_id]
        entry = {
            **node,
            "hops": hops,
            "path_strength": round(strength, 3),
            "path": [graph.nodes[p]["legal_name"] for p in path],
            "links": links,
        }
        neighbours.append(entry)

        if node["status"] == "offboarded":
            risk_flags.append(
                {
                    "flag": "linked_to_offboarded_entity",
                    "severity": "high" if strength >= 0.5 else "medium",
                    "entity_id": other_id,
                    "detail": (
                        f"{node['legal_name']} was off-boarded"
                        f"{' (' + node['offboarded_reason'] + ')' if node['offboarded_reason'] else ''}"
                        f" and is {hops} hop(s) away via "
                        + ", ".join(sorted({link['rel_type'] for link in links}))
                    ),
                    "path_strength": round(strength, 3),
                }
            )

    strong_shared = [
        n
        for n in neighbours
        if n["hops"] == 1
        and any(
            link["rel_type"] in {"shared_bank_account", "shared_director", "shared_ubo"}
            for link in n["links"]
        )
    ]
    if len(strong_shared) >= 3:
        risk_flags.append(
            {
                "flag": "possible_coordinated_group",
                "severity": "high",
                "detail": (
                    f"{len(strong_shared)} entities share a director, UBO or bank account with "
                    "this entity — assess as one exposure, not several"
                ),
                "entities": [n["entity_id"] for n in strong_shared],
            }
        )

    merchant_ids = {
        m.entity_id
        for m in session.execute(
            select(Merchant).where(Merchant.lifecycle_state == "active")
        ).scalars()
    }
    concentrated = [n["entity_id"] for n in neighbours if n["entity_id"] in merchant_ids]
    if len(concentrated) >= 2:
        risk_flags.append(
            {
                "flag": "related_active_merchants",
                "severity": "medium",
                "detail": (
                    f"{len(concentrated)} active merchants are within {max_hops} hops — "
                    "aggregate credit exposure and correlated chargeback risk apply"
                ),
                "entities": concentrated,
            }
        )

    neighbours.sort(key=lambda row: (row["hops"], -row["path_strength"]))
    return {
        "entity": graph.nodes[entity_id],
        "neighbours": neighbours,
        "risk_flags": sorted(
            risk_flags, key=lambda flag: 0 if flag["severity"] == "high" else 1
        ),
        "max_hops": max_hops,
    }
