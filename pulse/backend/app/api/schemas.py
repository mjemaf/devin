"""Request bodies for the analyst console and partner APIs.

Responses are plain dictionaries assembled by the services: the service output *is* the contract,
and re-declaring it in response models would only invite the two to drift.
"""

from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, Field


class ApplicationIn(BaseModel):
    application_id: str
    legal_name: str
    trading_name: str | None = None
    country: str | None = None
    registration_number: str | None = None
    website: str | None = None
    address: str | None = None
    email: str | None = None
    phone: str | None = None
    director_name: str | None = None
    mcc: str | None = None
    business_model: str | None = None
    segment: str = "smb"
    region: str = "EU"
    expected_monthly_volume: float = 0.0
    jurisdiction: str = "global"
    actor: str = "analyst@pulse.example"


class QuestionIn(BaseModel):
    question: str
    as_of: dt.datetime | None = None
    jurisdictions: list[str] = Field(default_factory=list)
    asked_by: str = "analyst@pulse.example"


class DocumentIn(BaseModel):
    key: str
    title: str
    doc_type: str = "policy"
    text: str
    jurisdiction: str = "global"
    owner: str | None = None
    effective_from: dt.datetime | None = None
    approve: bool = False
    actor: str = "policy.owner@pulse.example"


class ApproveDocumentIn(BaseModel):
    version: int
    actor: str = "policy.owner@pulse.example"


class FeedbackIn(BaseModel):
    feedback: str


class HitReviewIn(BaseModel):
    disposition: str
    rationale: str
    reviewer: str = "analyst@pulse.example"


class ScreenIn(BaseModel):
    include_owners: bool = True
    trigger: str = "manual"
    actor: str = "analyst@pulse.example"


class CaseAssignIn(BaseModel):
    assignee: str
    actor: str = "analyst@pulse.example"


class CaseCloseIn(BaseModel):
    resolution: str
    note: str | None = None
    actor: str = "analyst@pulse.example"


class CaseNoteIn(BaseModel):
    note: str
    actor: str = "analyst@pulse.example"


class AgentReviewIn(BaseModel):
    outcome: str
    note: str | None = None
    reviewer: str = "analyst@pulse.example"


class AgentApproveIn(BaseModel):
    note: str | None = None
    approver: str = "supervisor@pulse.example"


class TierIn(BaseModel):
    tier: str
    rationale: str
    actor: str = "risk.owner@pulse.example"


class KillSwitchIn(BaseModel):
    engaged: bool
    reason: str
    actor: str = "risk.owner@pulse.example"


class ListUpdateIn(BaseModel):
    list_name: str = "OFAC SDN"
    actor: str = "sanctions.feed"


class RegistryChangeIn(BaseModel):
    entity_id: int
    status: str
    detail: str | None = None


class TransactionSignalIn(BaseModel):
    merchant_id: int
    monthly_volume: float | None = None
    chargeback_rate: float | None = None
    business_model: str | None = None
    mcc: str | None = None
    observation: str | None = None


class OffboardIn(BaseModel):
    entity_id: int
    reason: str
    actor: str = "analyst@pulse.example"


class PolicyEvalIn(BaseModel):
    pack: str = "onboarding"
    facts: dict[str, object] = Field(default_factory=dict)
    as_of: dt.date | None = None
    jurisdiction: str = "global"


class ReplayIn(BaseModel):
    topics: list[str] = Field(default_factory=list)
    since: dt.datetime | None = None
    dry_run: bool = True


class RequirementIn(BaseModel):
    entity_id: int
    requirement_type: str
    case_id: int | None = None
    due_days: int | None = None
    rationale: str = ""
    requested_by: str = "analyst@pulse.example"


class RequirementSatisfyIn(BaseModel):
    evidence_id: int
    actor: str = "analyst@pulse.example"


class ApprovalRequestIn(BaseModel):
    subject_type: str = "entity"
    subject_id: int | None = None
    decision_class: str
    action: str
    severity: str = "medium"
    required_role: str = "second_line"
    payload: dict[str, object] = Field(default_factory=dict)
    proposer: str = "analyst@pulse.example"
    proposer_role: str = "analyst"


class ApprovalDecisionIn(BaseModel):
    approve: bool
    rationale: str
    approver: str = "supervisor@pulse.example"
    approver_role: str = "second_line"


class BrokeredActionIn(BaseModel):
    action_type: str
    entity_id: int | None = None
    authority_basis: str
    case_id: int | None = None
    rule_ref: str | None = None
    rule_version: str | None = None
    approval_request_id: int | None = None
    evidence: dict[str, object] = Field(default_factory=dict)
    actor: str = "analyst@pulse.example"
    actor_role: str = "analyst"
    actor_type: str = "human"


class ActionRollbackIn(BaseModel):
    reason: str
    actor: str = "analyst@pulse.example"


class OutcomeLabelIn(BaseModel):
    subject_type: str
    subject_id: int
    label: str
    entity_id: int | None = None
    exit_classification: str | None = None
    predicted: str | None = None
    observed: str | None = None
    arp_key: str | None = None
    note: str | None = None
    labelled_by: str = "analyst@pulse.example"


class AdverseActionIn(BaseModel):
    issued_by: str = "analyst@pulse.example"


class TransactionBatchIn(BaseModel):
    source_platform: str = "acquiring"
    events: list[dict[str, object]] = Field(default_factory=list)


class ContextRequestIn(BaseModel):
    entity_id: int
    scopes: list[str] = Field(default_factory=list)
    actor: str = "analyst@pulse.example"
    role: str = "analyst"
    regions: list[str] = Field(default_factory=lambda: ["global"])
    max_classification: str = "confidential"
