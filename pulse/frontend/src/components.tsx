import type { ReactNode } from "react";

export function Page({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

export function Card({
  title,
  hint,
  children,
  wide,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={wide ? "card card-wide" : "card"}>
      <div className="card-head">
        <h2>{title}</h2>
        {hint ? <span className="muted small">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={tone ? `stat-value tone-${tone}` : "stat-value"}>{value}</div>
    </div>
  );
}

const TONES: Record<string, string> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
  decline: "critical",
  refer: "high",
  approve_with_conditions: "medium",
  approve: "good",
  open: "high",
  in_review: "medium",
  closed: "good",
  pending_review: "high",
  pending_approval: "medium",
  approved: "good",
  rejected: "critical",
  offboarded: "critical",
  terminated: "critical",
  active: "good",
  boarded: "good",
  true_match: "critical",
  false_positive: "good",
  shadow: "low",
  suggest: "medium",
  four_eyes: "high",
  auto_bounded: "good",
};

export function Badge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="muted">—</span>;
  const tone = TONES[value] ?? "neutral";
  return <span className={`badge tone-${tone}`}>{value.replace(/_/g, " ")}</span>;
}

export function Empty({ message }: { message: string }) {
  return <p className="muted">{message}</p>;
}

export function Loading() {
  return <p className="muted">Loading…</p>;
}

export function ErrorBox({ error }: { error: string }) {
  return <p className="error">{error}</p>;
}

export function KeyValues({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function money(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export function when(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString();
}
