import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";
import type { AuditEvent, AuditStatus, MerchantRow } from "../api";
import { Badge, Card, ErrorBox, Loading, Page, Stat, when } from "../components";
import { useResource } from "../hooks";

export function AuditPage() {
  const status = useResource<AuditStatus>("/audit/verify");
  const events = useResource<AuditEvent[]>("/audit/events?limit=60");
  const merchants = useResource<MerchantRow[]>("/merchants");
  const [entityId, setEntityId] = useState("");
  const [pack, setPack] = useState<unknown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const exportPack = async () => {
    setBusy(true);
    setError(null);
    try {
      setPack(await api.get(`/audit/export/${entityId}`));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (status.loading && !status.data) return <Loading />;
  if (status.error) return <ErrorBox error={status.error} />;

  return (
    <Page
      title="Audit & examiner exports"
      subtitle="Every decision, override and data access is appended to a hash-chained ledger."
      actions={
        <button className="secondary" onClick={() => status.reload()}>
          Re-verify chain
        </button>
      }
    >
      <div className="stats">
        <Stat
          label="Chain integrity"
          value={status.data?.valid ? "verified" : "tampered"}
          tone={status.data?.valid ? "good" : "critical"}
        />
        <Stat label="Events" value={status.data?.events ?? 0} />
        <Stat
          label="First divergence"
          value={status.data?.first_divergence_seq ?? "—"}
          tone={status.data?.first_divergence_seq ? "critical" : undefined}
        />
      </div>
      <p className="mono muted">head {status.data?.head_hash}</p>

      <div className="grid">
        <Card title="Examiner export" hint="one entity, end to end">
          <div className="row">
            <select value={entityId} onChange={(event) => setEntityId(event.target.value)}>
              <option value="">Select a merchant…</option>
              {(merchants.data ?? []).map((row) => (
                <option key={row.entity_id} value={row.entity_id}>
                  {row.display_name}
                </option>
              ))}
            </select>
            <button disabled={busy || entityId === ""} onClick={exportPack}>
              Build pack
            </button>
            {entityId ? <Link to={`/merchants/${entityId}`}>Open Merchant 360</Link> : null}
          </div>
          {error ? <ErrorBox error={error} /> : null}
          {pack ? <pre style={{ maxHeight: 420, marginTop: 12 }}>{JSON.stringify(pack, null, 2)}</pre> : null}
        </Card>

        <Card title="Ledger" hint="newest first" wide>
          {events.error ? <ErrorBox error={events.error} /> : null}
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
              {(events.data ?? []).map((event) => (
                <tr key={event.seq}>
                  <td className="numeric">{event.seq}</td>
                  <td className="small">{when(event.ts)}</td>
                  <td className="small">
                    {event.actor} <Badge value={event.actor_role} />
                  </td>
                  <td className="small">{event.action}</td>
                  <td className="small muted">
                    {event.subject_type} {event.subject_id ?? ""}
                  </td>
                  <td className="mono">{event.hash.slice(0, 12)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </Page>
  );
}
