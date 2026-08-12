/** Typed client for the Pulse API. Only the fields the console renders are declared. */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }
  return (await response.json()) as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
};

export interface ReasonCode {
  code: string;
  text?: string;
  rule_id?: string;
  sop_ref?: string;
}

export interface Overview {
  portfolio: {
    merchants: number;
    active: number;
    terminated: number;
    monthly_volume: number;
    exposure: number;
    weighted_chargeback_rate: number;
  };
  queues: {
    open: number;
    closed: number;
    by_severity: Record<string, number>;
    by_type: Record<string, number>;
    sla_breached: { id: number; title: string; severity: string }[];
    median_hours_to_close: number | null;
  };
  alerts: { open: number; by_severity: Record<string, number> };
  screening: { actionable_hits: number };
  automation: { arps: Arp[]; pending_reviews: number; pending_approvals: number };
  audit: { valid: boolean; events: number; head_hash: string };
  recent_decisions: {
    id: number;
    entity_id: number;
    decision_type: string;
    outcome: string;
    policy: string;
    materiality: string | null;
    reason_codes: string[];
    as_of: string;
  }[];
  cohorts: {
    cohort: string;
    merchants: number;
    median_risk_score: number;
    p90_risk_score: number;
    median_chargeback_rate: number;
    max_chargeback_rate: number;
    outliers: string[];
  }[];
  provider_spend: {
    total_calls: number;
    total_cost: number;
    cache_hit_rate: number;
    by_provider: Record<string, { calls: number; cost: number }>;
  };
  knowledge_gaps: { question: string; asked_by: string; as_of: string }[];
}

export interface MerchantRow {
  merchant_id: number;
  entity_id: number;
  display_name: string;
  legal_name: string;
  country: string | null;
  mcc: string | null;
  segment: string;
  region: string;
  business_model: string | null;
  lifecycle_state: string;
  entity_status: string;
  monthly_volume: number;
  chargeback_rate: number;
  open_alerts: number;
  latest_outcome: string | null;
}

export interface Fact {
  value: unknown;
  source: string;
  confidence: number;
  as_of: string;
}

export interface GraphNode {
  entity_id: number;
  legal_name: string;
  entity_type: string;
  country: string | null;
  status: string;
  offboarded_reason: string | null;
}

export interface Ownership {
  entity: GraphNode;
  ubos: {
    entity_id: number;
    name: string;
    effective_percentage: number;
    is_ubo: boolean;
    hops: number;
    min_confidence: number;
    chain: string[];
  }[];
  nodes: GraphNode[];
  edges: { from: number; to: number; percentage: number; source: string; type: string }[];
  declared_ownership_percentage: number;
  gaps: string[];
}

export interface Network {
  entity: GraphNode;
  max_hops: number;
  neighbours: (GraphNode & { hops: number; path_strength: number; path: string[] })[];
  risk_flags: {
    flag: string;
    severity: string;
    entity_id: number;
    detail: string;
    path_strength: number;
  }[];
}

export interface ScreeningHit {
  id: number;
  list_type: string;
  list_name: string;
  programme: string | null;
  matched_name: string;
  score: number;
  disposition: string | null;
  reviewed_by: string | null;
  detail: string | null;
  trigger: string | null;
  demotions: string[];
  score_components: Record<string, number>;
  subject_entity_id: number | null;
}

export interface ScreeningQueueHit extends Omit<ScreeningHit, "id"> {
  hit_id: number;
  entity_id: number;
  entity_name: string | null;
  severity: string;
  review_rationale: string | null;
  created_at: string;
}

export interface Decision {
  id: number;
  decision_type: string;
  outcome: string;
  policy: string;
  materiality: string | null;
  reason_codes: ReasonCode[];
  counterfactuals: { reason_code?: string; change?: string; would_become?: string }[];
  required_oversight: string | null;
  agent_run_id: number | null;
  as_of: string;
}

export interface Merchant360 {
  entity: {
    id: number;
    legal_name: string;
    trading_name: string | null;
    entity_type: string;
    country: string | null;
    status: string;
    address: string | null;
    website: string | null;
    registration_number: string | null;
    resolution_confidence: number | null;
    offboarded_reason: string | null;
  };
  merchant: {
    id: number;
    display_name: string;
    lifecycle_state: string;
    mcc: string | null;
    underwritten_mcc: string | null;
    business_model: string | null;
    underwritten_business_model: string | null;
    segment: string;
    region: string;
    monthly_volume: number;
    chargeback_rate: number;
    credit_limit: number;
    reserve_held: number;
    review_cadence_days: number;
    boarded_at: string | null;
    last_reviewed_at: string | null;
  } | null;
  facts: Record<string, Fact>;
  identity: {
    source_records: {
      source_system: string;
      source_ref: string;
      match_confidence: number;
      match_method: string;
      review_required: boolean;
    }[];
  };
  ownership: Ownership;
  network: Network;
  screening: ScreeningHit[];
  score: {
    model_key: string;
    model_version: string;
    value: number;
    band: string;
    peer_percentile: number;
    contributions: {
      signal: string;
      value: number;
      weight: number;
      points: number;
      explanation: string;
    }[];
    as_of: string;
  } | null;
  decisions: Decision[];
  alerts: {
    id: number;
    monitor_key: string;
    severity: string;
    title: string;
    detail: string | null;
    status: string;
    occurrences: number;
    last_seen_at: string;
  }[];
  cases: {
    id: number;
    case_type: string;
    severity: string;
    status: string;
    title: string;
    assignee: string | null;
    created_at: string;
  }[];
  timeline: AuditEvent[];
}

export interface AuditEvent {
  seq: number;
  ts: string;
  actor: string;
  actor_role: string;
  action: string;
  subject_type: string;
  subject_id: number | null;
  payload: Record<string, unknown>;
  hash: string;
  prev_hash?: string;
}

export interface CaseRow {
  id: number;
  entity_id: number;
  entity_name: string | null;
  case_type: string;
  severity: string;
  status: string;
  title: string;
  assignee: string | null;
  sla_due_at: string | null;
  sla_breached: boolean;
  created_at: string;
  closed_at: string | null;
  resolution: string | null;
  created_by: string | null;
}

export interface CaseDetail {
  case: CaseRow & { notes?: unknown };
  events: { actor: string; action: string; note: string | null; at: string }[];
  alerts: {
    id: number;
    monitor_key: string;
    severity: string;
    title: string;
    detail: string | null;
    status: string;
    created_at: string;
  }[];
  screening_hits: ScreeningHit[];
}

export interface AlertRow {
  alert_id: number;
  entity_id: number;
  entity_name: string | null;
  monitor_key: string;
  severity: string;
  title: string;
  detail: string | null;
  signals: Record<string, unknown>;
  status: string;
  case_id: number | null;
  occurrences: number;
  created_at: string;
  last_seen_at: string;
}

export interface AgentRun {
  id: number;
  arp_key: string;
  arp_version: number;
  entity_id: number | null;
  case_id: number | null;
  mode: string;
  recommendation: string;
  confidence: number;
  rationale: string;
  status: string;
  reviewer: string | null;
  human_outcome: string | null;
  review_note: string | null;
  second_approver: string | null;
  decision_path: unknown;
  data_accessed: string[];
  models_consulted: string[];
  citations: string[];
  created_at: string;
}

export interface Arp {
  key: string;
  version: number;
  task: string;
  sop_refs: string[];
  data_contract: string[];
  success_criteria: Record<string, number>;
  permitted_recommendations: string[];
  autonomy_tier: string;
  autonomy_ceiling: string;
  kill_switch_engaged: boolean;
  validated_by: string | null;
  validated_at: string | null;
  tier_history: {
    from?: string;
    to?: string;
    actor?: string;
    rationale?: string;
    at?: string;
    kill_switch?: boolean;
  }[];
}

export interface ArpEvaluation {
  arp: string;
  version: number;
  autonomy_tier: string;
  autonomy_ceiling: string;
  kill_switch_engaged: boolean;
  reviewed_runs: number;
  agreement_rate: number;
  severity_1_misses: number[];
  p95_latency_ms: number;
  next_tier: string | null;
  promotion_ready: boolean;
  blockers: string[];
  success_criteria: Record<string, number>;
}

export interface Answer {
  question: string;
  answer: string;
  grounded: boolean;
  top_score: number;
  as_of: string;
  citations: {
    document_key: string;
    document_title: string;
    heading: string;
    excerpt: string;
    score: number;
    version: string | number;
    chunk_id: number;
  }[];
}

export interface AuditStatus {
  valid: boolean;
  events: number;
  head_hash: string;
  first_divergence_seq?: number | null;
}

export interface PolicyPackSummary {
  pack: string;
  version: string;
  decision_type: string;
  owner: string | null;
  effective_from: string;
  jurisdictions: string[];
  rule_count: number;
  rules: {
    id: string;
    description: string;
    outcome: string;
    reason_code: string;
    sop_ref: string | null;
  }[];
}
