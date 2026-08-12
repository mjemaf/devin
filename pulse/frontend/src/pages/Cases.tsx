import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";
import type { AlertRow, CaseDetail, CaseRow } from "../api";
import { Badge, Card, Empty, ErrorBox, Loading, Page, when } from "../components";
import { useResource } from "../hooks";

const ANALYST = "analyst@pulse.example";

export function Cases() {
  const caseList = useResource<CaseRow[]>("/cases");
  const alerts = useResource<AlertRow[]>("/monitoring/alerts");
  const [selected, setSelected] = useState<number | null>(null);
  const detail = useResource<CaseDetail>(selected ? `/cases/${selected}` : null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const act = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      detail.reload();
      caseList.reload();
    } catch (cause) {
      setNotice((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sweep = () =>
    act(async () => {
      const result = await api.post<{ alerts_raised: number }>("/monitoring/sweep", {});
      alerts.reload();
      return result;
    }, "Monitoring sweep complete.");

  if (caseList.loading && !caseList.data) return <Loading />;
  if (caseList.error) return <ErrorBox error={caseList.error} />;

  const rows = caseList.data ?? [];

  return (
    <Page
      title="Cases & alerts"
      subtitle={`${rows.filter((row) => row.status !== "closed").length} open of ${rows.length}`}
      actions={
        <button className="secondary" onClick={sweep} disabled={busy}>
          Run monitoring sweep
        </button>
      }
    >
      {notice ? <p className="muted small">{notice}</p> : null}
      <div className="grid">
        <Card title="Case queue" hint="SLA breaches first" wide>
          <table>
            <thead>
              <tr>
                <th>Case</th>
                <th>Merchant</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Assignee</th>
                <th>SLA due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <button className="tab" onClick={() => setSelected(row.id)}>
                      #{row.id}
                    </button>
                    <div className="small">{row.title}</div>
                  </td>
                  <td>
                    <Link to={`/merchants/${row.entity_id}`}>{row.entity_name ?? row.entity_id}</Link>
                  </td>
                  <td className="small">{row.case_type.replace(/_/g, " ")}</td>
                  <td>
                    <Badge value={row.severity} />
                  </td>
                  <td>
                    <Badge value={row.status} />
                  </td>
                  <td className="small">{row.assignee ?? "unassigned"}</td>
                  <td className="small">
                    {when(row.sla_due_at)}
                    {row.sla_breached ? (
                      <div>
                        <Badge value="critical" />
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {selected ? (
          <Card title={`Case #${selected}`} hint="working file" wide>
            {detail.loading && !detail.data ? <Loading /> : null}
            {detail.error ? <ErrorBox error={detail.error} /> : null}
            {detail.data ? (
              <>
                <div className="row">
                  <Badge value={detail.data.case.status} />
                  <Badge value={detail.data.case.severity} />
                  <span className="muted small">{detail.data.case.title}</span>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      act(
                        () =>
                          api.post(`/cases/${selected}/assign`, {
                            assignee: ANALYST,
                            actor: ANALYST,
                          }),
                        `Case assigned to ${ANALYST}.`,
                      )
                    }
                  >
                    Assign to me
                  </button>
                  <button
                    disabled={busy || detail.data.case.status === "closed"}
                    onClick={() =>
                      act(
                        () =>
                          api.post(`/cases/${selected}/close`, {
                            resolution: "reviewed_no_action",
                            actor: ANALYST,
                            note: "Reviewed in console.",
                          }),
                        "Case closed.",
                      )
                    }
                  >
                    Close case
                  </button>
                </div>

                <h3>Add a note</h3>
                <div className="row">
                  <input
                    value={note}
                    placeholder="What did you check?"
                    onChange={(event) => setNote(event.target.value)}
                    style={{ maxWidth: 420 }}
                  />
                  <button
                    disabled={busy || note.trim() === ""}
                    onClick={() =>
                      act(async () => {
                        await api.post(`/cases/${selected}/notes`, { note, actor: ANALYST });
                        setNote("");
                      }, "Note added.")
                    }
                  >
                    Add note
                  </button>
                </div>

                <h3>Activity</h3>
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Actor</th>
                      <th>Action</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.data.events.map((event, index) => (
                      <tr key={index}>
                        <td className="small">{when(event.at)}</td>
                        <td className="small">{event.actor}</td>
                        <td>{event.action}</td>
                        <td className="small">{event.note ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <h3>Linked screening hits</h3>
                {detail.data.screening_hits.length === 0 ? (
                  <Empty message="None." />
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>List</th>
                        <th>Matched name</th>
                        <th className="numeric">Score</th>
                        <th>Disposition</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.screening_hits.map((hit) => (
                        <tr key={hit.id}>
                          <td>{hit.list_name}</td>
                          <td>{hit.matched_name}</td>
                          <td className="numeric">{hit.score.toFixed(2)}</td>
                          <td>
                            <Badge value={hit.disposition} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            ) : null}
          </Card>
        ) : null}

        <Card title="Open alerts" hint="continuous monitoring" wide>
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
                  <th className="numeric">Occurrences</th>
                  <th>Case</th>
                </tr>
              </thead>
              <tbody>
                {alerts.data.map((alert) => (
                  <tr key={alert.alert_id}>
                    <td>
                      <Link to={`/merchants/${alert.entity_id}`}>{alert.entity_name ?? alert.entity_id}</Link>
                    </td>
                    <td className="small">{alert.monitor_key.replace(/_/g, " ")}</td>
                    <td>
                      <Badge value={alert.severity} />
                    </td>
                    <td className="small">{alert.detail ?? alert.title}</td>
                    <td className="numeric">{alert.occurrences}</td>
                    <td>
                      {alert.case_id ? (
                        <button className="tab" onClick={() => setSelected(alert.case_id)}>
                          #{alert.case_id}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Card>
      </div>
    </Page>
  );
}
