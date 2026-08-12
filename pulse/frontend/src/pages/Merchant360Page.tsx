import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api";
import type { Merchant360 } from "../api";
import {
  Badge,
  Card,
  Empty,
  ErrorBox,
  KeyValues,
  Loading,
  Page,
  money,
  percent,
  when,
} from "../components";
import { useResource } from "../hooks";

const TABS = ["Summary", "Facts", "Ownership & network", "Screening", "Risk", "Decisions", "History"] as const;
type Tab = (typeof TABS)[number];

export function Merchant360Page() {
  const { entityId } = useParams();
  const { data, error, loading, reload } = useResource<Merchant360>(
    entityId ? `/merchants/${entityId}` : null,
  );
  const [tab, setTab] = useState<Tab>("Summary");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const rescreen = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await api.post<{ hits: unknown[] }>(`/merchants/${entityId}/screen`, {
        actor: "analyst@pulse.example",
      });
      setNotice(`Re-screened: ${result.hits.length} hit(s) on file.`);
      reload();
    } catch (cause) {
      setNotice((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const { entity, merchant, score } = data;

  return (
    <Page
      title={entity.legal_name}
      subtitle={`${entity.entity_type} · ${entity.country ?? "—"} · entity #${entity.id}`}
      actions={
        <div className="row">
          <Badge value={entity.status} />
          {merchant ? <Badge value={merchant.lifecycle_state} /> : null}
          <button className="secondary" onClick={rescreen} disabled={busy}>
            {busy ? "Screening…" : "Re-screen"}
          </button>
          <Link to="/merchants">← Portfolio</Link>
        </div>
      }
    >
      {notice ? <p className="muted small">{notice}</p> : null}
      <div className="tabs">
        {TABS.map((name) => (
          <button
            key={name}
            className={name === tab ? "tab active" : "tab"}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === "Summary" ? (
        <div className="grid">
          <Card title="Identity">
            <KeyValues
              rows={[
                ["Legal name", entity.legal_name],
                ["Trading name", entity.trading_name ?? "—"],
                ["Registration", entity.registration_number ?? "—"],
                ["Address", entity.address ?? "—"],
                ["Website", entity.website ?? "—"],
                [
                  "Resolution confidence",
                  entity.resolution_confidence === null
                    ? "—"
                    : entity.resolution_confidence.toFixed(2),
                ],
                ["Off-boarded reason", entity.offboarded_reason ?? "—"],
              ]}
            />
          </Card>
          <Card title="Commercials">
            {merchant ? (
              <KeyValues
                rows={[
                  ["MCC", `${merchant.mcc ?? "—"} (underwritten ${merchant.underwritten_mcc ?? "—"})`],
                  [
                    "Business model",
                    `${merchant.business_model ?? "—"} (underwritten ${merchant.underwritten_business_model ?? "—"})`,
                  ],
                  ["Segment / region", `${merchant.segment} · ${merchant.region}`],
                  ["Monthly volume", money(merchant.monthly_volume)],
                  ["Chargeback rate", percent(merchant.chargeback_rate)],
                  ["Credit limit", money(merchant.credit_limit)],
                  ["Reserve held", money(merchant.reserve_held)],
                  ["Boarded", when(merchant.boarded_at)],
                  ["Last reviewed", when(merchant.last_reviewed_at)],
                ]}
              />
            ) : (
              <Empty message="Not a boarded merchant — related party only." />
            )}
          </Card>
          <Card title="Risk score" hint={score ? `${score.model_key} v${score.model_version}` : undefined}>
            {score ? (
              <>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="stat-value">{score.value.toFixed(1)}</span>
                  <Badge value={score.band} />
                </div>
                <p className="muted small">
                  Peer percentile {percent(score.peer_percentile)} · as at {when(score.as_of)}
                </p>
              </>
            ) : (
              <Empty message="No score on file." />
            )}
          </Card>
          <Card title="Open work" wide>
            <h3>Cases</h3>
            {data.cases.length === 0 ? (
              <Empty message="No cases." />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Case</th>
                    <th>Type</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Assignee</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cases.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link to="/cases">#{row.id}</Link> {row.title}
                      </td>
                      <td>{row.case_type.replace(/_/g, " ")}</td>
                      <td>
                        <Badge value={row.severity} />
                      </td>
                      <td>
                        <Badge value={row.status} />
                      </td>
                      <td>{row.assignee ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <h3>Alerts</h3>
            {data.alerts.length === 0 ? (
              <Empty message="No alerts." />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Monitor</th>
                    <th>Severity</th>
                    <th>Detail</th>
                    <th className="numeric">Occurrences</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {data.alerts.map((alert) => (
                    <tr key={alert.id}>
                      <td>{alert.monitor_key.replace(/_/g, " ")}</td>
                      <td>
                        <Badge value={alert.severity} />
                      </td>
                      <td className="small">{alert.detail ?? alert.title}</td>
                      <td className="numeric">{alert.occurrences}</td>
                      <td className="small muted">{when(alert.last_seen_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "Facts" ? (
        <div className="grid">
          <Card title="Attributes with provenance" hint="every value carries its source" wide>
            <table>
              <thead>
                <tr>
                  <th>Attribute</th>
                  <th>Value</th>
                  <th>Source</th>
                  <th className="numeric">Confidence</th>
                  <th>As at</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.facts).map(([key, fact]) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td>{JSON.stringify(fact.value)}</td>
                    <td>{fact.source}</td>
                    <td className="numeric">{fact.confidence.toFixed(2)}</td>
                    <td className="small muted">{when(fact.as_of)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Source records" hint="how this entity was resolved" wide>
            <table>
              <thead>
                <tr>
                  <th>System</th>
                  <th>Reference</th>
                  <th>Match method</th>
                  <th className="numeric">Confidence</th>
                  <th>Review required</th>
                </tr>
              </thead>
              <tbody>
                {data.identity.source_records.map((record) => (
                  <tr key={`${record.source_system}-${record.source_ref}`}>
                    <td>{record.source_system}</td>
                    <td>{record.source_ref}</td>
                    <td>{record.match_method}</td>
                    <td className="numeric">{record.match_confidence.toFixed(2)}</td>
                    <td>{record.review_required ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      ) : null}

      {tab === "Ownership & network" ? (
        <div className="grid">
          <Card
            title="Beneficial ownership"
            hint={`${data.ownership.declared_ownership_percentage.toFixed(1)}% accounted for`}
          >
            {data.ownership.ubos.length === 0 ? (
              <Empty message="No beneficial owner established." />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Owner</th>
                    <th className="numeric">Effective %</th>
                    <th className="numeric">Hops</th>
                    <th>Chain</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ownership.ubos.map((ubo) => (
                    <tr key={ubo.entity_id}>
                      <td>
                        <Link to={`/merchants/${ubo.entity_id}`}>{ubo.name}</Link>
                      </td>
                      <td className="numeric">{ubo.effective_percentage.toFixed(1)}</td>
                      <td className="numeric">{ubo.hops}</td>
                      <td className="small muted">{ubo.chain.join(" → ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {data.ownership.gaps.length > 0 ? (
              <>
                <h3>Gaps</h3>
                <ul>
                  {data.ownership.gaps.map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </Card>

          <Card title="Network risk flags" hint={`up to ${data.network.max_hops} hops`}>
            {data.network.risk_flags.length === 0 ? (
              <Empty message="No network risk flags." />
            ) : (
              <ul>
                {data.network.risk_flags.map((flag, index) => (
                  <li key={index}>
                    <Badge value={flag.severity} /> <strong>{flag.flag.replace(/_/g, " ")}</strong>
                    <div className="small muted">{flag.detail}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Related parties" wide>
            <table>
              <thead>
                <tr>
                  <th>Party</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th className="numeric">Hops</th>
                  <th className="numeric">Path strength</th>
                  <th>Path</th>
                </tr>
              </thead>
              <tbody>
                {data.network.neighbours.map((node) => (
                  <tr key={node.entity_id}>
                    <td>
                      <Link to={`/merchants/${node.entity_id}`}>{node.legal_name}</Link>
                    </td>
                    <td>{node.entity_type}</td>
                    <td>
                      <Badge value={node.status} />
                    </td>
                    <td className="numeric">{node.hops}</td>
                    <td className="numeric">{node.path_strength.toFixed(2)}</td>
                    <td className="small muted">{node.path.join(" → ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      ) : null}

      {tab === "Screening" ? (
        <Card title="Screening hits" hint="sanctions, PEP, watchlist, negative file, adverse media" wide>
          {data.screening.length === 0 ? (
            <Empty message="No screening hits." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>List</th>
                  <th>Matched name</th>
                  <th className="numeric">Score</th>
                  <th>Disposition</th>
                  <th>Reviewer</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {data.screening.map((hit) => (
                  <tr key={hit.id}>
                    <td>
                      {hit.list_type}
                      <div className="muted small">{hit.list_name}</div>
                    </td>
                    <td>{hit.matched_name}</td>
                    <td className="numeric">{hit.score.toFixed(2)}</td>
                    <td>
                      <Badge value={hit.disposition} />
                    </td>
                    <td>{hit.reviewed_by ?? "—"}</td>
                    <td className="small">
                      {hit.detail ?? "—"}
                      {hit.demotions.length ? (
                        <div className="chips" style={{ marginTop: 4 }}>
                          {hit.demotions.map((demotion) => (
                            <span className="chip" key={demotion}>
                              demoted: {demotion}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}

      {tab === "Risk" ? (
        <Card title="Score contributions" hint="transparent, additive, explainable" wide>
          {score ? (
            <table>
              <thead>
                <tr>
                  <th>Signal</th>
                  <th className="numeric">Value</th>
                  <th className="numeric">Weight</th>
                  <th className="numeric">Points</th>
                  <th>Explanation</th>
                </tr>
              </thead>
              <tbody>
                {score.contributions.map((row) => (
                  <tr key={row.signal}>
                    <td>{row.signal.replace(/_/g, " ")}</td>
                    <td className="numeric">{row.value}</td>
                    <td className="numeric">{row.weight}</td>
                    <td className="numeric">{row.points.toFixed(1)}</td>
                    <td className="small muted">{row.explanation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty message="No score on file." />
          )}
        </Card>
      ) : null}

      {tab === "Decisions" ? (
        <div className="grid">
          {data.decisions.length === 0 ? <Empty message="No decisions recorded." /> : null}
          {data.decisions.map((decision) => (
            <Card
              key={decision.id}
              title={`${decision.decision_type} · ${decision.outcome}`}
              hint={`${decision.policy} · ${when(decision.as_of)}`}
              wide
            >
              <div className="row">
                <Badge value={decision.outcome} />
                <Badge value={decision.materiality} />
                <Badge value={decision.required_oversight} />
              </div>
              <h3>Reason codes</h3>
              <table>
                <tbody>
                  {decision.reason_codes.map((reason) => (
                    <tr key={reason.code}>
                      <td style={{ width: 260 }}>
                        <strong>{reason.code}</strong>
                        <div className="muted small">
                          {reason.rule_id} · {reason.sop_ref}
                        </div>
                      </td>
                      <td className="small">{reason.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {decision.counterfactuals.length > 0 ? (
                <>
                  <h3>What would change the outcome</h3>
                  <ul>
                    {decision.counterfactuals.map((counterfactual, index) => (
                      <li key={index} className="small">
                        {counterfactual.change ?? JSON.stringify(counterfactual)}
                        {counterfactual.would_become ? ` → ${counterfactual.would_become}` : ""}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </Card>
          ))}
        </div>
      ) : null}

      {tab === "History" ? (
        <Card title="Audit history" hint="hash-chained, newest first" wide>
          <table>
            <thead>
              <tr>
                <th className="numeric">Seq</th>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Subject</th>
                <th>Hash</th>
              </tr>
            </thead>
            <tbody>
              {data.timeline.map((event) => (
                <tr key={event.seq}>
                  <td className="numeric">{event.seq}</td>
                  <td className="small">{when(event.ts)}</td>
                  <td className="small">
                    {event.actor}
                    <div className="muted small">{event.actor_role}</div>
                  </td>
                  <td>{event.action}</td>
                  <td className="small muted">
                    {event.subject_type} {event.subject_id ?? ""}
                  </td>
                  <td className="mono">{event.hash.slice(0, 12)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </Page>
  );
}
