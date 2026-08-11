import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import type { MerchantRow } from "../api";
import { Badge, ErrorBox, Loading, Page, money, percent } from "../components";
import { useResource } from "../hooks";

export function Merchants() {
  const { data, error, loading } = useResource<MerchantRow[]>("/merchants");
  const [query, setQuery] = useState("");
  const [state, setState] = useState("all");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data ?? []).filter((row) => {
      const matchesState = state === "all" || row.lifecycle_state === state;
      const matchesQuery =
        needle === "" ||
        row.display_name.toLowerCase().includes(needle) ||
        row.legal_name.toLowerCase().includes(needle) ||
        (row.mcc ?? "").includes(needle);
      return matchesState && matchesQuery;
    });
  }, [data, query, state]);

  const states = useMemo(
    () => Array.from(new Set((data ?? []).map((row) => row.lifecycle_state))).sort(),
    [data],
  );

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  return (
    <Page
      title="Merchant portfolio"
      subtitle={`${rows.length} of ${data?.length ?? 0} merchants`}
      actions={
        <div className="row">
          <input
            placeholder="Search name or MCC"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ width: 240 }}
          />
          <select value={state} onChange={(event) => setState(event.target.value)} style={{ width: 160 }}>
            <option value="all">All lifecycle states</option>
            {states.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      }
    >
      <table>
        <thead>
          <tr>
            <th>Merchant</th>
            <th>Country</th>
            <th>MCC</th>
            <th>Segment</th>
            <th>Lifecycle</th>
            <th>Last outcome</th>
            <th className="numeric">Monthly volume</th>
            <th className="numeric">Chargebacks</th>
            <th className="numeric">Alerts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.merchant_id}>
              <td>
                <Link to={`/merchants/${row.entity_id}`}>{row.display_name}</Link>
                <div className="muted small">{row.legal_name}</div>
              </td>
              <td>{row.country ?? "—"}</td>
              <td>{row.mcc ?? "—"}</td>
              <td>{row.segment}</td>
              <td>
                <Badge value={row.lifecycle_state} />
              </td>
              <td>
                <Badge value={row.latest_outcome} />
              </td>
              <td className="numeric">{money(row.monthly_volume)}</td>
              <td className="numeric">{percent(row.chargeback_rate)}</td>
              <td className="numeric">{row.open_alerts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Page>
  );
}
