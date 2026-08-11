import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";
import type { AgentRun, Arp, ArpEvaluation } from "../api";
import { Badge, Card, Empty, ErrorBox, KeyValues, Loading, Page, when } from "../components";
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

  const act = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      runs.reload();
      arps.reload();
    } catch (cause) {
      setNotice((cause as Error).message);
    } finally {
      setBusy(false);
    }
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
                        act(
                          () =>
                            api.post(`/agents/arps/${arp.key}/kill-switch`, {
                              engaged: !arp.kill_switch_engaged,
                              actor: "risk.owner@pulse.example",
                              reason: arp.kill_switch_engaged ? "issue resolved" : "engaged from console",
                            }),
                          arp.kill_switch_engaged ? "Kill switch released." : "Kill switch engaged.",
                        )
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
                    ["Promotion ready", evaluation.data.promotion_ready ? "yes" : "no"],
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
                <h3>Metrics</h3>
                <pre>{JSON.stringify(evaluation.data.metrics, null, 2)}</pre>
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
                        act(
                          () =>
                            api.post(`/agents/runs/${run.id}/review`, {
                              reviewer: REVIEWER,
                              outcome: outcome[run.id] ?? "escalate",
                              note: "Reviewed in console.",
                            }),
                          "Review recorded.",
                        )
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
                        act(
                          () => api.post(`/agents/runs/${run.id}/approve`, { approver: APPROVER }),
                          "Second approval recorded.",
                        )
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
