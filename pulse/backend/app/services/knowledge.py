"""Risk & Compliance Knowledge + Policy Intelligence — the first use case.

Two invariants are enforced here rather than asked for in a prompt:

* **Effective dating.** Retrieval only sees versions that were approved and in force at
  ``as_of``, so "what did the rule say in March?" is answerable and any decision is replayable.
* **Grounded or silent.** An answer is composed exclusively from retrieved chunks and carries a
  citation per sentence. Below the grounding threshold the platform refuses and records the
  question as a knowledge gap.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import re
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Chunk, Document, DocumentVersion, KnowledgeQuery, utcnow
from app.services import audit
from app.services.retrieval import BM25Index

_HEADING = re.compile(r"^\s*(\d+(?:\.\d+)*\.?\s+.+|[A-Z][A-Z \-&/]{4,})\s*$")


@dataclass
class Citation:
    document_key: str
    document_title: str
    version: int
    chunk_id: int
    heading: str | None
    score: float
    excerpt: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "document_key": self.document_key,
            "document_title": self.document_title,
            "version": self.version,
            "chunk_id": self.chunk_id,
            "heading": self.heading,
            "score": round(self.score, 4),
            "excerpt": self.excerpt,
        }


@dataclass
class GroundedAnswer:
    question: str
    answer: str
    grounded: bool
    top_score: float
    citations: list[Citation] = field(default_factory=list)
    as_of: dt.datetime = field(default_factory=utcnow)

    def as_dict(self) -> dict[str, Any]:
        return {
            "question": self.question,
            "answer": self.answer,
            "grounded": self.grounded,
            "top_score": round(self.top_score, 4),
            "citations": [c.as_dict() for c in self.citations],
            "as_of": self.as_of,
        }


def chunk_text(text: str, target_chars: int = 700) -> list[tuple[str | None, str]]:
    """Split on headings, then on size. Headings are kept so citations are human-meaningful."""
    sections: list[tuple[str | None, list[str]]] = [(None, [])]
    for line in text.splitlines():
        if _HEADING.match(line) and line.strip():
            sections.append((line.strip(), []))
        else:
            sections[-1][1].append(line)

    chunks: list[tuple[str | None, str]] = []
    for heading, lines in sections:
        body = "\n".join(lines).strip()
        if not body:
            continue
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
        buffer = ""
        for paragraph in paragraphs:
            candidate = f"{buffer}\n\n{paragraph}".strip() if buffer else paragraph
            if len(candidate) > target_chars and buffer:
                chunks.append((heading, buffer))
                buffer = paragraph
            else:
                buffer = candidate
        if buffer:
            chunks.append((heading, buffer))
    return chunks


def ingest_document(
    session: Session,
    *,
    key: str,
    title: str,
    doc_type: str,
    text: str,
    jurisdiction: str = "global",
    owner: str | None = None,
    effective_from: dt.datetime | None = None,
    approve: bool = False,
    actor: str = "system",
) -> DocumentVersion:
    """Create the next version of a knowledge object. Prior versions are never mutated."""
    document = session.execute(select(Document).where(Document.key == key)).scalar()
    if document is None:
        document = Document(
            key=key, title=title, doc_type=doc_type, jurisdiction=jurisdiction, owner=owner
        )
        session.add(document)
        session.flush()

    previous = _latest_version(session, document.id)
    version_number = (previous.version + 1) if previous else 1
    effective_from = effective_from or utcnow()

    version = DocumentVersion(
        document_id=document.id,
        version=version_number,
        status="approved" if approve else "draft",
        effective_from=effective_from,
        text=text,
        checksum=hashlib.sha256(text.encode("utf-8")).hexdigest(),
        approved_by=actor if approve else None,
    )
    session.add(version)
    session.flush()

    for ordinal, (heading, body) in enumerate(chunk_text(text)):
        session.add(
            Chunk(
                document_version_id=version.id, ordinal=ordinal, heading=heading, text=body
            )
        )
    session.flush()

    if approve and previous is not None and previous.effective_to is None:
        previous.effective_to = effective_from
        previous.status = "retired"

    audit.append(
        session,
        actor=actor,
        action="knowledge.version_created",
        subject_type="document",
        subject_id=document.id,
        payload={
            "key": key,
            "version": version_number,
            "status": version.status,
            "checksum": version.checksum,
            "effective_from": effective_from,
        },
    )
    _invalidate_index()
    return version


def approve_version(
    session: Session, *, document_key: str, version: int, actor: str
) -> DocumentVersion:
    document = session.execute(select(Document).where(Document.key == document_key)).scalar()
    if document is None:
        raise LookupError(f"unknown document {document_key}")
    target = session.execute(
        select(DocumentVersion).where(
            DocumentVersion.document_id == document.id, DocumentVersion.version == version
        )
    ).scalar()
    if target is None:
        raise LookupError(f"unknown version {document_key} v{version}")

    current = _latest_approved(session, document.id)
    if current is not None and current.id != target.id and current.effective_to is None:
        current.effective_to = target.effective_from
        current.status = "retired"
    target.status = "approved"
    target.approved_by = actor
    session.flush()

    audit.append(
        session,
        actor=actor,
        action="knowledge.version_approved",
        subject_type="document",
        subject_id=document.id,
        payload={"key": document_key, "version": version},
    )
    _invalidate_index()
    return target


def _latest_version(session: Session, document_id: int) -> DocumentVersion | None:
    return session.execute(
        select(DocumentVersion)
        .where(DocumentVersion.document_id == document_id)
        .order_by(DocumentVersion.version.desc())
        .limit(1)
    ).scalar()


def _latest_approved(session: Session, document_id: int) -> DocumentVersion | None:
    return session.execute(
        select(DocumentVersion)
        .where(
            DocumentVersion.document_id == document_id,
            DocumentVersion.status == "approved",
        )
        .order_by(DocumentVersion.version.desc())
        .limit(1)
    ).scalar()


# ---------------------------------------------------------------------------------------
# Retrieval
# ---------------------------------------------------------------------------------------

_INDEX_CACHE: dict[str, tuple[BM25Index, dict[int, dict[str, Any]]]] = {}


def _invalidate_index() -> None:
    _INDEX_CACHE.clear()


def _build_index(
    session: Session, as_of: dt.datetime, jurisdictions: tuple[str, ...]
) -> tuple[BM25Index, dict[int, dict[str, Any]]]:
    cache_key = f"{as_of.isoformat()}|{','.join(jurisdictions)}"
    cached = _INDEX_CACHE.get(cache_key)
    if cached is not None:
        return cached

    stmt = (
        select(Chunk, DocumentVersion, Document)
        .join(DocumentVersion, Chunk.document_version_id == DocumentVersion.id)
        .join(Document, DocumentVersion.document_id == Document.id)
        .where(
            DocumentVersion.status.in_(("approved", "retired")),
            DocumentVersion.effective_from <= as_of,
        )
    )
    index = BM25Index()
    meta: dict[int, dict[str, Any]] = {}
    for chunk, version, document in session.execute(stmt).all():
        if version.effective_to is not None and version.effective_to <= as_of:
            continue
        if jurisdictions and document.jurisdiction not in jurisdictions:
            continue
        index.add(chunk.id, f"{document.title} {chunk.heading or ''} {chunk.text}")
        meta[chunk.id] = {
            "document_key": document.key,
            "document_title": document.title,
            "version": version.version,
            "heading": chunk.heading,
            "text": chunk.text,
        }
    _INDEX_CACHE[cache_key] = (index, meta)
    return index, meta


def retrieve(
    session: Session,
    question: str,
    *,
    as_of: dt.datetime | None = None,
    top_k: int | None = None,
    jurisdictions: tuple[str, ...] = (),
) -> list[Citation]:
    settings = get_settings()
    as_of = as_of or utcnow()
    index, meta = _build_index(session, as_of, jurisdictions)
    hits = index.search(question, top_k=top_k or settings.retrieval_top_k)
    citations: list[Citation] = []
    for chunk_id, score in hits:
        info = meta[chunk_id]
        citations.append(
            Citation(
                document_key=info["document_key"],
                document_title=info["document_title"],
                version=info["version"],
                chunk_id=chunk_id,
                heading=info["heading"],
                score=score,
                excerpt=_excerpt(info["text"], question),
            )
        )
    return citations


def _excerpt(text: str, question: str, max_sentences: int = 3) -> str:
    from app.services.retrieval import tokenize

    query_terms = set(tokenize(question))
    sentences = [s.strip() for s in re.split(r"(?<=[.;:])\s+", text) if s.strip()]
    ranked = sorted(
        sentences,
        key=lambda s: -len(query_terms & set(tokenize(s))),
    )
    chosen = [s for s in ranked[:max_sentences] if query_terms & set(tokenize(s))]
    if not chosen:
        chosen = sentences[:1]
    ordered = [s for s in sentences if s in chosen]
    return " ".join(ordered)[:800]


REFUSAL = (
    "Not answerable from the approved knowledge base. No approved policy, regulation or scheme "
    "rule in force at the requested date covers this question, so no answer is given. The "
    "question has been logged as a knowledge gap for the policy owner."
)


def ask(
    session: Session,
    question: str,
    *,
    as_of: dt.datetime | None = None,
    asked_by: str = "unknown",
    jurisdictions: tuple[str, ...] = (),
) -> GroundedAnswer:
    settings = get_settings()
    as_of = as_of or utcnow()
    citations = retrieve(session, question, as_of=as_of, jurisdictions=jurisdictions)
    top_score = citations[0].score if citations else 0.0
    grounded = top_score >= settings.grounding_threshold

    if grounded:
        answer = _compose(question, citations)
    else:
        answer = REFUSAL
        citations = []

    record = KnowledgeQuery(
        question=question,
        answer=answer,
        grounded=grounded,
        top_score=top_score,
        citations=[c.as_dict() for c in citations],
        as_of=as_of,
        asked_by=asked_by,
    )
    session.add(record)
    session.flush()
    audit.append(
        session,
        actor=asked_by,
        action="knowledge.question_answered" if grounded else "knowledge.question_refused",
        subject_type="knowledge_query",
        subject_id=record.id,
        payload={
            "question": question,
            "grounded": grounded,
            "top_score": round(top_score, 4),
            "citations": [
                {"document_key": c.document_key, "version": c.version, "chunk_id": c.chunk_id}
                for c in citations
            ],
            "as_of": as_of,
        },
    )
    return GroundedAnswer(
        question=question,
        answer=answer,
        grounded=grounded,
        top_score=top_score,
        citations=citations,
        as_of=as_of,
    )


def _compose(question: str, citations: list[Citation]) -> str:
    """Extractive composition: every sentence traceable to a cited chunk.

    With ``LLM_PROVIDER=local`` the composer is deterministic, which is what makes the grounding
    eval suite a meaningful regression gate. A hosted model may replace the phrasing, never the
    source selection.
    """
    lines = [f"Grounded answer to: {question}"]
    for citation in citations:
        if citation.score < citations[0].score * 0.35:
            continue
        marker = f"[{citation.document_key} v{citation.version}"
        marker += f" · {citation.heading}]" if citation.heading else "]"
        lines.append(f"- {citation.excerpt} {marker}")
    return "\n".join(lines)


def knowledge_gaps(session: Session, limit: int = 20) -> list[KnowledgeQuery]:
    """Refused questions, newest first — the policy owner's backlog."""
    return list(
        session.execute(
            select(KnowledgeQuery)
            .where(KnowledgeQuery.grounded.is_(False))
            .order_by(KnowledgeQuery.created_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
