AGENTIC AUTOMATION OVERSIGHT STANDARD

1. Scope
This standard governs every automated agent that reads customer data, produces a recommendation, or
executes an action in a risk or compliance process. No agent may operate outside a registered
Automated Resolution Pathway.

2. Automated Resolution Pathways
An Automated Resolution Pathway defines, for one agent and one task: the standard operating
procedures it implements; the exact data it is permitted to access; the recommendations it is
permitted to produce; its success criteria including required agreement rate, permitted severity-one
miss rate and latency; its autonomy tier; and its autonomy ceiling. Any request for data outside the
declared data contract must fail, not proceed.

3. Autonomy tiers
Four tiers are defined. Shadow: the agent runs and is logged but its output is not shown to the
analyst and cannot influence a decision. Suggest: the recommendation is shown to a first-line analyst
who decides. Four eyes: the action requires a first-line reviewer and a second, different approver.
Auto bounded: the action may execute automatically within explicit, reversible, low-materiality
limits, with post-hoc sampling.

4. Promotion and demotion
An agent enters service in shadow mode. Promotion to a higher tier requires a minimum population of
reviewed cases, an agreement rate with human outcomes at or above the tier threshold, zero
severity-one misses, and sign-off by the accountable risk owner. Any severity-one miss, a
statistically significant fall in agreement rate, or an unexplained change in input distribution
requires immediate demotion to shadow.

5. Permanent ceilings
The following may never exceed four-eyes autonomy, regardless of measured performance: credit
decisions; adverse actions and the associated notices; account termination; suspicious activity
report filing; discounting a sanctions match; and any action that cannot be reversed.

6. Materiality
The autonomy permitted for an action is bounded by the materiality of that action, assessed from
reversibility, financial exposure, number of customers affected, regulatory notice obligations and
precedent. Model confidence does not raise the permitted autonomy of a high-materiality action.

7. Audit
Every agent run must record the pathway and version, the inputs and data accessed, the models
consulted, the decision path, the recommendation and confidence, the human reviewer and outcome, and
the timestamps. The audit record must be tamper-evident and exportable.

8. Kill switch
Every pathway must have a kill switch that immediately returns the agent to shadow mode. Engaging the
kill switch must be possible by the accountable risk owner without an engineering deployment.

9. Explainability
Every recommendation must be explainable in the language of the policy it implements, citing the
specific rule and standard operating procedure. A recommendation that cannot be explained by
reference to an approved knowledge object may not be surfaced to an analyst.
