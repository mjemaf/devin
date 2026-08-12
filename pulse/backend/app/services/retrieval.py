"""Lexical BM25 retrieval over approved, effective-dated knowledge chunks.

Kept dependency-free on purpose: the retrieval index is a platform asset that must not be locked
to a vendor. A dense retriever is added alongside (hybrid), never instead.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass

_TOKEN = re.compile(r"[a-z0-9]+")
_STOPWORD_TEXT = """
a an and are as at be by can do does for from has have how i if in is it its may must not of on
or our shall should than that the their there these this to was we what when where which who why
will with you your
"""
_STOPWORDS = frozenset(_STOPWORD_TEXT.split())

K1 = 1.5
B = 0.75


def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in _STOPWORDS and len(t) > 1]


@dataclass
class IndexedChunk:
    chunk_id: int
    tokens: list[str]
    counts: Counter[str]


class BM25Index:
    def __init__(self) -> None:
        self.chunks: list[IndexedChunk] = []
        self.df: Counter[str] = Counter()
        self.avg_len: float = 0.0

    def add(self, chunk_id: int, text: str) -> None:
        tokens = tokenize(text)
        self.chunks.append(IndexedChunk(chunk_id, tokens, Counter(tokens)))
        for term in set(tokens):
            self.df[term] += 1
        total = sum(len(c.tokens) for c in self.chunks)
        self.avg_len = total / len(self.chunks) if self.chunks else 0.0

    def _idf(self, term: str) -> float:
        df = self.df.get(term, 0)
        return math.log(1 + (len(self.chunks) - df + 0.5) / (df + 0.5))

    def search(self, query: str, top_k: int = 5) -> list[tuple[int, float]]:
        query_terms = tokenize(query)
        if not query_terms or not self.chunks:
            return []
        scored: list[tuple[int, float]] = []
        for chunk in self.chunks:
            length = len(chunk.tokens) or 1
            score = 0.0
            for term in query_terms:
                tf = chunk.counts.get(term, 0)
                if not tf:
                    continue
                denom = tf + K1 * (1 - B + B * length / (self.avg_len or 1))
                score += self._idf(term) * (tf * (K1 + 1)) / denom
            if score > 0:
                scored.append((chunk.chunk_id, score))
        scored.sort(key=lambda pair: -pair[1])
        # Normalise against the best a chunk could score if it covered *every* query term,
        # including terms absent from the corpus. Excluding unseen terms would make a question the
        # corpus only partially covers ("what licensing applies to crypto custody?") look as well
        # supported as one it answers outright, which is how a system starts bluffing.
        if scored:
            ceiling = sum(self._idf(term) * (K1 + 1) / (1 + K1) for term in set(query_terms))
            if ceiling > 0:
                scored = [(cid, min(1.0, score / ceiling)) for cid, score in scored]
        return scored[:top_k]
