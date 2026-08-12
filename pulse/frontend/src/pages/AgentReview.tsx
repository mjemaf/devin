import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";
import type { AgentRun, Arp, ArpEvaluation } from "../api";
import { Badge, Card, Empty, ErrorBox, KeyValues, Loading, Page, percent, when } from "../components";
import { useResource } from "../hooks";

const REVIEWER = "analyst@pulse.example";
const APPROVER = "second.line@pulse.example";

export function AgentReview() {
  const runs = useResource<AgentRun[]>("/agents/runs");
  const arps = useResource<Arp[]>("/agents/arps");
  const [selectedArp, setSelectedArp] = useState<string | null>(null);
  const evaluation = useResource<ArpEvaluation>(
    selectedArp ? `/agents/arps/${selectedArp}/evaluation` : null,
  );
  const [outcome, setOutcome] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const act = async (action: () => Promise<string>) => {
    setBusy(true);
    setNotice(null);
    try {
      setNotice(await action());
      runs.reload();
      arps.reload();
      if (selectedArp) evaluation.reload();
    } catch (cause) {
      setNotice((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reviewDisposition = (status: string) => {
    if (status === "pending_approval") return "awaiting second-line approval";
    if (status === "approved") return "agent recommendation accepted, run closed";
    return "analyst overrode the agent recommendation, run closed";
  };

  if (runs.loading && !runs.data) return <Loading />;
  if (runs.error) return <ErrorBox error={runs.error} />;

  return (
    <Page
      title="Agent review & four-eyes"
      subtitle="Recommendations are advisory: a human decides, and customer-detrimental actions need two people."
    >
      {notice ? <p className="muted small">{notice}</p> : null}
      <div className="grid">
        <Card title="Agentic role profiles" hint="autonomy tier and ceiling" wide>
          <table>
            <thead>
              <tr>
                <th>ARP</th>
                <th>Task</th>
                <th>Tier</th>
                <th>Ceiling</th>
                <th>Kill switch</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(arps.data ?? []).map((arp) => (
                <tr key={arp.key}>
                  <td>
                    {arp.key} <span className="muted small">v{arp.version}</span>
                  </td>
                  <td className="small">{arp.task}</td>
                  <td>
                    <Badge value={arp.autonomy_tier} />
                  </td>
                  <td>
                    <Badge value={arp.autonomy_ceiling} />
                  </td>
                  <td>{arp.kill_switch_engaged ? <Badge value="critical" /> : "off"}</td>
                  <td className="row">
                    <button className="tab" onClick={() => setSelectedArp(arp.key)}>
                      Evaluate
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          const updated = await api.post<Arp>(`/agents/arps/${arp.key}/kill-switch`, {
                            engaged: !arp.kill_switch_engaged,
                            actor: "risk.owner@pulse.example",
                            reason: arp.kill_switch_engaged ? "issue resolved" : "engaged from console",
                          });
                          return `${arp.key}: kill switch ${
                            updated.kill_switch_engaged ? "engaged" : "released"
                          }, autonomy tier now ${updated.autonomy_tier.replace(/_/g, " ")}.`;
                        })
                      }
                    >
                      {arp.kill_switch_engaged ? "Release" : "Kill switch"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {selectedArp ? (
          <Card title={`Promotion readiness — ${selectedArp}`} hint="evidence before autonomy">
            {evaluation.loading && !evaluation.data ? <Loading /> : null}
            {evaluation.error ? <ErrorBox error={evaluation.error} /> : null}
            {evaluation.data ? (
              <>
                <KeyValues
                  rows={[
                    ["Current tier", <Badge value={evaluation.data.autonomy_tier} key="tier" />],
                    ["Ceiling", <Badge value={evaluation.data.autonomy_ceiling} key="ceiling" />],
                    ["Next tier", <Badge value={evaluation.data.next_tier} key="next" />],
                    ["Promotion ready", evaluation.data.promotion_ready ? "yes" : "no"],
                    ["Reviewed runs", evaluation.data.reviewed_runs],
                    ["Agreement with humans", percent(evaluation.data.agreement_rate)],
                    ["Severity-1 misses", evaluation.data.severity_1_misses.length],
                    ["p95 latency", `${evaluation.data.p95_latency_ms} ms`],
                  ]}
                />
                <h3>Blockers</h3>
                {evaluation.data.blockers.length === 0 ? (
                  <Empty message="None." />
                ) : (
                  <ul>
                    {evaluation.data.blockers.map((blocker) => (
                      <li key={blocker} className="small">
                        {blocker}
                      </li>
                    ))}
                  </ul>
                )}
                <h3>Success criteria</h3>
                <table>
                  <tbody>
                    {Object.entries(evaluation.data.success_criteria).map(([criterion, value]) => (
                      <tr key={criterion}>
                        <td className="small">{criterion.replace(/_/g, " ")}</td>
                        <td className="numeric">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </Card>
        ) : null}

        <Card title="Review queue" hint="shadow runs never reach a human queue" wide>
          {(runs.data ?? []).length === 0 ? <Empty message="Nothing awaiting review." /> : null}
          {(runs.data ?? []).map((run) => (
            <div key={run.id} className="citation">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="row">
                  <strong>
                    #{run.id} {run.arp_key} v{run.arp_version}
                  </strong>
                  <Badge value={run.mode} />
                  <Badge value={run.status} />
                  <Badge value={run.recommendation} />
                  <span className="muted small">confidence {run.confidence.toFixed(2)}</span>
                  {run.entity_id ? <Link to={`/merchants/${run.entity_id}`}>entity #{run.entity_id}</Link> : null}
                </div>
                <span className="muted small">{when(run.created_at)}</span>
              </div>
              <p className="small">{run.rationale}</p>
              <div className="chips">
                {run.data_accessed.map((item) => (
                  <span className="chip" key={item}>
                    {item}
                  </span>
                ))}
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                {run.status === "pending_review" ? (
                  <>
                    <select
                      value={outcome[run.id] ?? "escalate"}
                      onChange={(event) =>
                        setOutcome((current) => ({ ...current, [run.id]: event.target.value }))
                      }
                      style={{ width: 220 }}
                    >
                      {["approve", "approve_with_conditions", "escalate", "decline"].map((value) => (
                        <option key={value} value={value}>
                          {value.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          const chosen = outcome[run.id] ?? "escalate";
                          const updated = await api.post<AgentRun>(`/agents/runs/${run.id}/review`, {
                            reviewer: REVIEWER,
                            outcome: chosen,
                            note: "Reviewed in console.",
                          });
                          return `Run #${run.id}: recorded ${chosen.replace(/_/g, " ")} against the agent's ${run.recommendation.replace(/_/g, " ")} — ${reviewDisposition(updated.status)}.`;
                        })
                      }
                    >
                      Record review
                    </button>
                  </>
                ) : null}
                {run.status === "pending_approval" ? (
                  <>
                    <span className="muted small">
                      reviewed by {run.reviewer} → {run.human_outcome}
                    </span>
                    <button
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          const updated = await api.post<AgentRun>(`/agents/runs/${run.id}/approve`, {
                            approver: APPROVER,
                          });
                          return `Run #${run.id}: ${updated.human_outcome} approved by ${updated.second_approver} (reviewed by ${updated.reviewer}).`;
                        })
                      }
                    >
                      Approve as second line
                    </button>
                  </>
                ) : null}
                {run.second_approver ? (
                  <span className="muted small">approved by {run.second_approver}</span>
                ) : null}
              </div>
            </div>
          ))}
        </Card>
      </div>
    </Page>
  );
}
