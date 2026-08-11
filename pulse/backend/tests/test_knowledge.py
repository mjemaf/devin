"""Grounding is the control: the platform must cite, and must refuse rather than improvise."""

from __future__ import annotations

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Document, DocumentVersion, KnowledgeQuery
from app.services import knowledge


def test_grounded_answer_cites_the_governing_policy(session: Session) -> None:
    answer = knowledge.ask(
        session,
        "What must we do when beneficial ownership cannot be established?",
        asked_by="test@pulse.example",
    )
    assert answer.grounded is True
    assert answer.citations
    assert "POL-KYB-002" in {citation.document_key for citation in answer.citations}
    for citation in answer.citations:
        assert citation.excerpt.strip()
        assert citation.version >= 1


def test_out_of_scope_question_is_refused_and_logged_as_a_gap(session: Session) -> None:
    answer = knowledge.ask(
        session, "Which team won the 1998 World Cup final?", asked_by="test@pulse.example"
    )
    assert answer.grounded is False
    assert answer.citations == []
    assert answer.answer == knowledge.REFUSAL

    logged = session.execute(
        select(KnowledgeQuery).order_by(KnowledgeQuery.id.desc())
    ).scalars().first()
    assert logged is not None
    assert logged.grounded is False
    gaps = knowledge.knowledge_gaps(session)
    assert any(gap.id == logged.id for gap in gaps)


def test_retrieval_only_returns_approved_versions(session: Session) -> None:
    knowledge.ingest_document(
        session,
        key="POL-DRAFT-999",
        title="Draft Prohibited Sectors Addendum",
        doc_type="policy",
        text=(
            "# Draft addendum\n\nUnobtainium resale is a prohibited business line and every "
            "unobtainium application must be declined immediately.\n"
        ),
        owner="financial-crime-policy",
        approve=False,
        actor="policy.author@pulse.example",
    )
    citations = knowledge.retrieve(session, "Is unobtainium resale prohibited?")
    assert "POL-DRAFT-999" not in {citation.document_key for citation in citations}


def test_effective_dated_retrieval_returns_the_version_in_force(session: Session) -> None:
    """POL-ACC-001 v2 prohibits vape sales; as-of a date before v2 the v1 text must govern."""
    text_v1 = (
        "# Acceptable use\n\n## Restricted sectors\n\nVape and e-cigarette retail is permitted "
        "with enhanced age verification controls and a rolling reserve.\n"
    )
    text_v2 = (
        "# Acceptable use\n\n## Prohibited sectors\n\nVape and e-cigarette retail is prohibited "
        "for new applicants and existing merchants must be exited at renewal.\n"
    )
    knowledge.ingest_document(
        session,
        key="POL-ACC-TEST",
        title="Acceptable Use (test fixture)",
        doc_type="policy",
        text=text_v1,
        owner="financial-crime-policy",
        effective_from=dt.datetime(2025, 1, 1, tzinfo=dt.timezone.utc),
        approve=True,
        actor="policy.owner@pulse.example",
    )
    knowledge.ingest_document(
        session,
        key="POL-ACC-TEST",
        title="Acceptable Use (test fixture)",
        doc_type="policy",
        text=text_v2,
        owner="financial-crime-policy",
        effective_from=dt.datetime(2026, 6, 1, tzinfo=dt.timezone.utc),
        approve=True,
        actor="policy.owner@pulse.example",
    )

    document = session.execute(
        select(Document).where(Document.key == "POL-ACC-TEST")
    ).scalars().one()
    versions = session.execute(
        select(DocumentVersion).where(DocumentVersion.document_id == document.id)
    ).scalars().all()
    assert {version.version for version in versions} == {1, 2}

    def cited_version(as_of: dt.datetime) -> int | None:
        for citation in knowledge.retrieve(session, "vape e-cigarette retail", as_of=as_of):
            if citation.document_key == "POL-ACC-TEST":
                return citation.version
        return None

    assert cited_version(dt.datetime(2026, 3, 1, tzinfo=dt.timezone.utc)) == 1
    assert cited_version(dt.datetime(2026, 7, 1, tzinfo=dt.timezone.utc)) == 2
