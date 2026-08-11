import { useState } from "react";

import { api } from "../api";
import type { Answer, PolicyPackSummary } from "../api";
import { Badge, Card, ErrorBox, Loading, Page, percent } from "../components";
import { useResource } from "../hooks";

const SUGGESTIONS = [
  "What must we do when a beneficial owner cannot be established?",
  "When is a sanctions hit a true match?",
  "What are the chargeback monitoring thresholds?",
  "Who won the 1998 World Cup?",
];

export function PolicyQA() {
  const packs = useResource<PolicyPackSummary[]>("/platform/policies");
  const [question, setQuestion] = useState(SUGGESTIONS[0]);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async (value: string) => {
    setAsking(true);
    setError(null);
    try {
      setAnswer(await api.post<Answer>("/knowledge/ask", { question: value }));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setAsking(false);
    }
  };

  return (
    <Page
      title="Grounded policy Q&A"
      subtitle="Answers are drawn only from the approved, effective-dated policy corpus — otherwise the assistant refuses."
    >
      <div className="grid">
        <Card title="Ask the corpus" wide>
          <div className="row">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void ask(question);
              }}
              placeholder="Ask about a policy or procedure"
            />
            <button disabled={asking || question.trim() === ""} onClick={() => void ask(question)}>
              {asking ? "Asking…" : "Ask"}
            </button>
          </div>
          <div className="chips" style={{ marginTop: 10 }}>
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                className="chip"
                onClick={() => {
                  setQuestion(suggestion);
                  void ask(suggestion);
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>

          {error ? <ErrorBox error={error} /> : null}

          {answer ? (
            <div style={{ marginTop: 16 }}>
              <div className="row">
                <Badge value={answer.grounded ? "grounded" : "refused"} />
                <span className="muted small">
                  retrieval score {answer.top_score.toFixed(2)} · as at {answer.as_of}
                </span>
              </div>
              <p style={{ whiteSpace: "pre-wrap" }}>{answer.answer}</p>
              {answer.citations.length > 0 ? <h3>Citations</h3> : null}
              {answer.citations.map((citation) => (
                <div className="citation" key={citation.chunk_id}>
                  <div className="row">
                    <strong>{citation.document_title}</strong>
                    <span className="muted small">
                      {citation.document_key} v{citation.version} · {citation.heading} · score{" "}
                      {citation.score.toFixed(2)}
                    </span>
                  </div>
                  <p className="small">{citation.excerpt}</p>
                </div>
              ))}
            </div>
          ) : null}
        </Card>

        <Card title="Policy packs in force" hint="policy-as-code" wide>
          {packs.loading && !packs.data ? <Loading /> : null}
          {packs.error ? <ErrorBox error={packs.error} /> : null}
          {(packs.data ?? []).map((pack) => (
            <details key={`${pack.pack}-${pack.version}`}>
              <summary>
                <strong>{pack.pack}</strong> v{pack.version} · {pack.decision_type} ·{" "}
                {pack.jurisdictions.join(", ")} · {pack.rule_count} rules
                <span className="muted small"> — effective {pack.effective_from}, owner {pack.owner ?? "—"}</span>
              </summary>
              <table>
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Description</th>
                    <th>Outcome</th>
                    <th>Reason code</th>
                    <th>SOP</th>
                  </tr>
                </thead>
                <tbody>
                  {pack.rules.map((rule) => (
                    <tr key={rule.id}>
                      <td>{rule.id}</td>
                      <td className="small">{rule.description}</td>
                      <td>
                        <Badge value={rule.outcome} />
                      </td>
                      <td className="small">{rule.reason_code}</td>
                      <td className="small muted">{rule.sop_ref ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
          <p className="muted small">
            Coverage of the corpus is measured by refusals: every refused question is logged as a
            knowledge gap ({percent(1)} traceable).
          </p>
        </Card>
      </div>
    </Page>
  );
}
