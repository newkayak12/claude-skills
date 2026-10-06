---
name: security-auditor
effort: high
description: >-
  Use when auditing a feature, paths, or a whole service for exploitable flaws in auth, input handling, secrets, or
  payments — each finding traced entry→sink. Triggers on: "is this exploitable", "보안 점검", "취약점 찾아줘".
scenarios:
  - "Audit the checkout and order APIs for anything an attacker could actually exploit"
  - "Before we launch, check auth, input handling, secrets, and payments in this service"
  - "결제랑 주문 API 보안 점검해줘, 실제로 뚫리는 것만"
  - "출시 전에 인증, 입력 처리, 시크릿 위주로 취약점 찾아줘"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 입력이 sink까지 도달하는 경로를 단계별로 추적하는 데 도움이 됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- NEVER report a finding without a traced path: attacker-controlled entry point → each hop (`file:line`) → sink. A
  pattern match is not a vulnerability. Measured 2026-10-06 on a four-route Express fixture: a review without this skill
  listed 10 findings, 6 of them hardening items with no attacker path, and the real exploits sat among them. A long
  list is how real findings get ignored. Hardening with no path goes to the dropped list, not the findings.
- NEVER print a secret value. Report `path:line` and the key name only (`stripeSecretKey`, prefix `sk_live_`).
- Read-only. Fixes are proposed, not applied.

Goal: every reported finding has a recountable path and a fix; everything considered and not reported is listed with
its reason; the tally line recounts to both lists.

# Security Auditor

**Not for:** the pending branch diff before merge — Claude Code's built-in `/security-review` covers that quickly;
idempotency, double-spend, and atomicity of payment writes (`develop:transaction-boundary-reviewer`); Spring Security
configuration how-to (`develop:spring-boot-engineer`, `references/security.md`); writing security tests
(`develop:test-master`); dependency CVE scanning — recommend the ecosystem's audit command (`npm audit`,
`./gradlew dependencyCheckAnalyze`), never invent its output.

## Process

1. **Scope.** The feature, paths, or service the user named. Say what is out of scope (infra, token issuer, DB schema)
   when it is not in the repo.
2. **Map.** List entry points (routes, webhooks, queue consumers, uploads, CLI args, third-party responses) and trust
   boundaries. Find where authentication and authorization are enforced — router-level middleware, filter chains,
   base controllers — before calling any route unprotected.
3. **Sweep** the areas the code touches with [`references/checklist.md`](references/checklist.md): auth, input,
   secrets, payment trust boundary, config and dependencies. Each hit is a candidate, not a finding.
4. **Triage** every candidate with four questions:
   1. Is the input attacker-controlled? (Constant, enum, allowlist, or trusted config is not a source.)
   2. Does it reach the sink past existing controls (validation, ORM binding, middleware)?
   3. What is the blast radius — who triggers it, what do they get, which boundary does it cross?
   4. Can the attacker perform every step from their position?
   All four yes → finding. A hop you could not read → finding with `Needs verification`, naming the hop. Otherwise →
   dropped, with the question it failed.
5. **Report** highest severity first. Severity by exploitability, not by pattern:

| Severity | Meaning |
|---|---|
| Critical | Unauthenticated RCE, auth bypass, or mass data exposure |
| High | Authenticated exploit crossing a trust boundary (IDOR into other users, client-set price, SQLi behind login) |
| Medium | Needs unusual preconditions, or impact limited to the attacker's own data or availability |
| Low | Real path, minor impact |

If nothing is exploitable, say so in one line. Do not pad with hardening items to look thorough.

## Output Template

```
## Security Audit — <scope>

### [High] <title> (CWE-###, A0#:2025)
Location:   path/to/file:LINE
Path:       <entry> → <file:line> → <file:line> → <sink>
Impact:     <who, what they get, which boundary>
Fix:        <concrete change>
Confidence: Confirmed (every hop quoted) | Needs verification (unread hop: <which>)

### Dropped
- <candidate> (file:line) — failed Q<n>: <one line>

Out of scope: <what was not in the repo>
Tally: Critical n · High n · Medium n · Low n · dropped n
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Maps entry points and where auth is enforced | Name the scope and what is deployed where |
| Traces each candidate to its sink, drops the unreachable | Re-run the traced path for every Critical/High before fixing |
| Writes severity by exploitability and a concrete fix | Decide fix order and rotate any exposed secret |
| Recommends the dependency audit command | Run it and share the output if you want it triaged |

## Related Skills

- `/security-review` (built in) — quick pass over the pending branch diff.
- `develop:transaction-boundary-reviewer` — payment idempotency, double-spend, atomic writes.
- `develop:spring-boot-engineer` — Spring Security configuration (`references/security.md`).
- `develop:test-master` — turn a confirmed finding into a regression test.
- `develop:bug-diagnoser` — a finding that also misbehaves for normal users.
