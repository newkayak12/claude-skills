---
name: incident-response-playbook
effort: high
description: >-
  Use when a production incident is active or needs a post-mortem. Triggers on: "장애 났어", "프로덕션 터졌어", "포스트모템 써줘",
  "severity 분류", "prod is down", "write an RCA". Not for SLO setup or chaos tests.
scenarios:
  - "We just had a production outage and need a structured incident response process"
  - "Help me create an on-call runbook for database failures"
  - "Design an incident response playbook for our SRE team"
  - "프로덕션 장애가 발생했는데 대응 프로세스가 없어"
  - "온콜 런북과 인시던트 대응 플레이북을 만들어줘"
compatibility:
  recommended:
    - sequential-thinking
    - think-tool
  optional: []
  remote_mcp_note: >-
    sequential-thinking은 탐지 → 트리아지 → 완화 → RCA 단계를 순서대로 진행할 때 유용합니다.
    think-tool은 장애 원인 분석과 우선순위 판단에 활용됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- ALWAYS classify severity before any other action — severity drives escalation and communication cadence.
- ALWAYS separate mitigation (restore service) from investigation (find root cause) — do not block one on the other.
- NEVER assign blame to individuals in post-mortems — focus on systemic factors; naming a person teaches the team to
  hide the next failure.
- NEVER skip the timeline reconstruction step in RCA; gaps in the timeline are often the cause.
- NEVER state a root-cause step without an `Evidence:` line, and NEVER fill a timeline or impact gap with a plausible
  guess. Mark `[확인 필요: ○○]` or `hypothesis`; a guessed cause sends the action items at the wrong fix.
- Goal: severity declared, mitigation separate from investigation, and an RCA whose every cause step has evidence or a
  `hypothesis` tag; the closing tally recounts to the cause-chain lines.

# Incident Response Playbook

**Not for** SLO or alert setup (`develop:sre-engineer`), failure-injection tests (`develop:chaos-engineer`), or finding
the code defect behind the failure (`develop:bug-diagnoser`).

## Severity Classification

| Severity | Definition | Response Time | Example |
|----------|-----------|---------------|---------|
| **P0** | Full service down; all users affected; revenue/data at risk | Immediate — page on-call now | Checkout API 100% error rate |
| **P1** | Major feature broken; significant user subset affected | < 15 min | Payment processing failing for 30% of users |
| **P2** | Degraded performance or partial feature failure | < 1 hour | Search latency 10x normal; some timeouts |
| **P3** | Minor issue; workaround available; low user impact | Next business day | Dashboard chart missing for 5% of users |

**Escalate up, not down.** When in doubt, treat as higher severity.

## Process

### Phase 1 — Detect

Detection sources, most to least reliable: alert, synthetic monitor, user report, team member — see [`references/background.md`](references/background.md#detection-sources).

Declare a provisional severity from the table, then open an incident channel, even if still diagnosing.

### Phase 2 — Triage (target: < 5 min for P0/P1)

Answer these questions fast:

1. **What is broken?** (service, endpoint, feature)
2. **Who is affected?** (all users / subset / internal only)
3. **When did it start?** (check deploy history, config changes, upstream alerts)
4. **What changed recently?** (deployments, feature flags, infra changes, dependency updates)
5. **What is the blast radius?** (data corruption? revenue loss? SLA breach?)

**Triage output**: severity confirmed or raised + incident commander assigned.

### Phase 3 — Communicate

Communicate before you know the answer; silence is worse than "we're investigating." Update every 15–30 min for P0/P1.
Slack and status-page templates, and what not to say publicly: `references/comms-templates.md`.

### Phase 4 — Mitigate

Outcome: **reduce user impact now**, even if the root cause isn't fully understood.

Common mitigation actions (rollback, flag off, scale out, shed load, redirect traffic, restore) with when-to-use and risk: [`references/background.md`](references/background.md#common-mitigation-actions).

**Mitigation ≠ Fix.** Document that mitigation is a temporary measure. The real fix comes after the incident.

### Phase 5 — Resolve

Exit criteria for "Resolved":
- [ ] Error rate back to baseline
- [ ] Latency back to baseline
- [ ] All monitors green
- [ ] No new alerts firing
- [ ] Affected users notified (if required)
- [ ] Incident channel archived or closed

### Phase 6 — Learn (RCA / Post-Mortem)

Target: publish RCA within 48–72 hours for P0/P1. Full template (summary, timeline, root cause, contributing factors,
action items): `references/rca-template.md`. Root cause is written as causal steps (A → B → C), each with an
`Evidence:` line — the log, metric, trace or diff that shows it; no evidence means mark it `hypothesis`, not fact.

#### Quick RCA (P2/P3 only)

P0/P1 use the full template. For P2/P3 a half page is enough:

```markdown
## Quick RCA: <Title> (P2/P3)
**Date / Duration / Services**:
**What happened + impact** (2 lines):
**Cause chain** (each step with `Evidence:`):
**Fix applied**:
**Follow-up** (1-3 items, owner + date):
```

#### Runbooks

A runbook is 3 lines (Means / First check / Escalate to) — format and example in `references/runbook-format.md`. When closing an incident where a runbook was used, refresh it: fix wrong steps, add the missing check, then link the update in the Action Items.

#### When Root Cause Traces to a Product Decision

If the timeline shows the trigger was a feature behaving as designed (a rollout that hit an untested segment, a launch assumption that didn't hold), the RCA's Action Items (`references/rca-template.md`) won't stop a recurrence. Add one RCA line instead: `Product decision to revisit: [decision] — flag to [feature owner] for the next planning cycle.` This skill stops at naming the decision; validating the hypothesis and deciding iterate-vs-pivot is a product-side call.

## Incident Commander Checklist

Severity declared, channel opened, responders assigned, first comms sent, mitigation running, 15–30 min cadence, resolution confirmed, RCA scheduled, runbook refreshed — full checklist: [`references/background.md`](references/background.md#incident-commander-checklist).

## Output Template

```
## Incident — <title> [P0|P1|P2|P3]

Status: Investigating / Identified / Mitigating / Resolved · IC: <name or [확인 필요: ○○]>
Impact: <who, how, since HH:MM UTC>
Mitigation: <action, time, risk> · Cause chain: <A -> B -> C, each with Evidence: or hypothesis>
Gaps: [확인 필요: ○○] ...

<n> cause steps (<e> with evidence · <h> hypothesis) · <a> action items · <g> gaps
```

Before sending, recount the cause steps and action items against the RCA; fix the tally if they differ.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Classifies severity and drafts triage steps | Declare severity and open the incident channel |
| Drafts Slack/status updates | Send them; keep the 15-30 min update cadence |
| Proposes mitigation options | Execute and approve the mitigation |
| Writes the blameless RCA in the post-mortem format | Confirm timeline and root cause; schedule the RCA |

## Related Skills

- `develop:database-optimizer` — DB corruption, query issues, slow DB
- `develop:performance-profiling-optimization` — when the incident is a performance regression
- `develop:sre-engineer` — observability gaps, SLOs, alerting, runbooks
- `develop:chaos-engineer` — test failure modes before they happen
- `develop:bug-diagnoser` — when the cause is a code defect to reproduce and fix
- `develop:documentation-strategy` — where to store and maintain the RCA
