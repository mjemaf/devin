import { Link } from "react-router-dom";

import type { AlertRow, Overview } from "../api";
import { Badge, Card, ErrorBox, Empty, Loading, Page, Stat, money, percent, when } from "../components";
import { useResource } from "../hooks";

export function Dashboard() {
  const overview = useResource<Overview>("/platform/overview");
  const alerts = useResource<AlertRow[]>("/monitoring/alerts");

  if (overview.loading && !overview.data) return <Loading />;
  if (overview.error) return <ErrorBox error={overview.error} />;
  if (!overview.data) return null;

  const data = overview.data;

  return (
    <Page
      title="Portfolio risk overview"
      subtitle="Know · detect · act — one view over onboarding, monitoring, credit and off-boarding."
    >
      <div className="stats">
        <Stat label="Merchants" value={data.portfolio.merchants} />
        <Stat label="Active" value={data.portfolio.active} tone="good" />
        <Stat label="Monthly volume" value={money(data.portfolio.monthly_volume)} />
        <Stat
          label="Weighted chargebacks"
          value={percent(data.portfolio.weighted_chargeback_rate)}
          tone={data.portfolio.weighted_chargeback_rate > 0.01 ? "high" : "good"}
        />
        <Stat label="Open cases" value={data.queues.open} tone={data.queues.open ? "high" : "good"} />
        <Stat label="Open alerts" value={data.alerts.open} tone={data.alerts.open ? "medium" : "good"} />
        <Stat label="Actionable hits" value={data.screening.actionable_hits} />
        <Stat
          label="Audit chain"
          value={data.audit.valid ? `verified · ${data.audit.events}` : "BROKEN"}
          tone={data.audit.valid ? "good" : "critical"}
        />
      </div>

      <div className="grid">
        <Card title="Case queue" hint={`${data.queues.closed} closed`}>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th className="numeric">Open</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.queues.by_type).map(([type, count]) => (
                <tr key={type}>
                  <td>{type.replace(/_/g, " ")}</td>
                  <td className="numeric">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small" style={{ marginTop: 10 }}>
            SLA breached: {data.queues.sla_breached.length}
          </p>
        </Card>

        <Card title="Automation posture" hint="agentic oversight">
          <table>
            <tbody>
              <tr>
                <td>Registered ARPs</td>
                <td className="numeric">{data.automation.arps.length}</td>
              </tr>
              {data.automation.arps.map((arp) => (
                <tr key={arp.key}>
                  <td className="small muted">
                    {arp.key}
                    {arp.kill_switch_engaged ? " · kill switch" : ""}
                  </td>
                  <td className="numeric">
                    <Badge value={arp.autonomy_tier} />
                  </td>
                </tr>
              ))}
              <tr>
                <td>Awaiting analyst review</td>
                <td className="numeric">{data.automation.pending_reviews}</td>
              </tr>
              <tr>
                <td>Awaiting second approval</td>
                <td className="numeric">{data.automation.pending_approvals}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted small" style={{ marginTop: 10 }}>
            <Link to="/agents">Open the agent review queue →</Link>
          </p>
        </Card>

        <Card title="Provider spend" hint={`cache hit rate ${percent(data.provider_spend.cache_hit_rate)}`}>
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th className="numeric">Calls</th>
                <th className="numeric">Cost</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.provider_spend.by_provider).map(([provider, spend]) => (
                <tr key={provider}>
                  <td>{provider}</td>
                  <td className="numeric">{spend.calls}</td>
                  <td className="numeric">{spend.cost.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Peer cohorts" hint="MCC · segment — a merchant is judged against its peers" wide>
          <table>
            <thead>
              <tr>
                <th>Cohort</th>
                <th className="numeric">Merchants</th>
                <th className="numeric">Median risk</th>
                <th className="numeric">P90 risk</th>
                <th className="numeric">Median chargebacks</th>
                <th className="numeric">Worst chargebacks</th>
                <th>Risk outliers</th>
              </tr>
            </thead>
            <tbody>
              {data.cohorts.map((cohort) => (
                <tr key={cohort.cohort}>
                  <td>{cohort.cohort}</td>
                  <td className="numeric">{cohort.merchants}</td>
                  <td className="numeric">{cohort.median_risk_score.toFixed(1)}</td>
                  <td className="numeric">{cohort.p90_risk_score.toFixed(1)}</td>
                  <td className="numeric">{percent(cohort.median_chargeback_rate)}</td>
                  <td className="numeric">{percent(cohort.max_chargeback_rate)}</td>
                  <td>{cohort.outliers.length ? cohort.outliers.join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Recent decisions" wide>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Outcome</th>
                <th>Materiality</th>
                <th>Policy</th>
                <th>Reasons</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_decisions.map((decision) => (
                <tr key={decision.id}>
                  <td>{when(decision.as_of)}</td>
                  <td>
                    <Link to={`/merchants/${decision.entity_id}`}>{decision.decision_type}</Link>
                  </td>
                  <td>
                    <Badge value={decision.outcome} />
                  </td>
                  <td>
                    <Badge value={decision.materiality} />
                  </td>
                  <td className="small muted">{decision.policy}</td>
                  <td>
                    <div className="chips">
                      {decision.reason_codes.map((code) => (
                        <span className="chip" key={code}>
                          {code}
                        </span>
                      ))}
                      {decision.reason_codes.length === 0 ? <span className="muted">—</span> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Latest alerts" wide>
          {alerts.error ? <ErrorBox error={alerts.error} /> : null}
          {alerts.data && alerts.data.length === 0 ? <Empty message="No open alerts." /> : null}
          {alerts.data && alerts.data.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Monitor</th>
                  <th>Severity</th>
                  <th>Detail</th>
                  <th className="numeric">Seen</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {alerts.data.slice(0, 8).map((alert) => (
                  <tr key={alert.alert_id}>
                    <td>
                      <Link to={`/merchants/${alert.entity_id}`}>{alert.entity_name ?? alert.entity_id}</Link>
                    </td>
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
          ) : null}
        </Card>

        {data.knowledge_gaps.length > 0 ? (
          <Card title="Knowledge gaps" hint="questions the corpus could not answer" wide>
            <ul>
              {data.knowledge_gaps.map((gap, index) => (
                <li key={index}>
                  {gap.question} <span className="muted small">— {gap.asked_by}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </Page>
  );
}
