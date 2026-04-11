---
name: documentation-strategy
effort: high
description: >-
  Plans and maintains a documentation system across architecture docs, API
  references, runbooks, and onboarding guides — producing a doc coverage map and
  writing or improving the highest-leverage missing content. Use when a
  codebase, API, or team...
scenarios:
  - "Our codebase has no docs and new engineers keep asking the same questions repeatedly"
  - "We have documentation but it's scattered across three wikis and no one knows what's current"
  - "Help me build a documentation strategy for our microservices platform"
  - "신규 엔지니어 온보딩이 너무 오래 걸려, 문서화 전략이 필요해"
  - "문서가 분산되어 있고 오래됐어, 체계를 잡아줘"
compatibility:
  recommended:
    - think-tool
    - sequential-thinking
  optional: []
  remote_mcp_note: >-
    think-tool은 문서 우선순위 결정과 coverage gap 분석에 활용됩니다.
    sequential-thinking은 감사 → 우선순위 → 작성 → 검토 흐름을 단계별로 구조화합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- ALWAYS audit existing docs before recommending new ones — redundant docs are worse than none.
- ALWAYS specify audience and maintenance owner for every doc type recommended.
- NEVER treat all doc types the same — ADRs, runbooks, and onboarding guides serve different readers.
- NEVER recommend creating documentation without a plan for keeping it current.


# Documentation Strategy

Good documentation answers the right question for the right person at the right time.
Bad documentation is worse than none — it misleads with false confidence.

---

## Documentation Taxonomy

Each document type has a distinct audience, purpose, and update cadence.

| Type | Audience | Purpose | Update Trigger |
|------|----------|---------|----------------|
| **Architecture Overview** | New engineers, tech leads, auditors | Understand how the system fits together | Major design changes |
| **API Reference** | Consumers of your API (internal or external) | Know how to call your API correctly | Every API change |
| **Runbook** | On-call engineers under pressure | Execute a specific operation step by step | When the steps change |
| **ADR** (Architecture Decision Record) | Future team members, reviewers | Understand why a decision was made | Written once; amended, not deleted |
| **Onboarding Guide** | New team members | Get productive in < 1 week | Quarterly review + when workflow changes |
| **Decision Log** | Whole team | Lightweight record of minor decisions | Ongoing |
| **RCA / Post-Mortem** | Team + stakeholders | Learn from incidents | After every P0/P1 incident |

---

## Audience-First Approach

Before writing a single word, answer:

1. **Who reads this?** (new hire? experienced engineer? product manager? external developer?)
2. **When do they read it?** (first day? 2am during an incident? planning a new feature?)
3. **What state are they in?** (curious and learning? stressed and time-pressured? skeptical?)
4. **What do they need to walk away with?** (understanding? a decision? a completed action?)

**Audience determines format:**
- Stressed on-call engineer → numbered steps, no prose, commands they can copy
- New hire exploring the system → narrative overview, context, links to more detail
- External API consumer → precise parameter specs, examples for every endpoint, error codes

---

## Docs as Code

### Where docs live

| Scenario | Recommendation |
|----------|---------------|
| Docs that change with code (API docs, runbooks for a service) | In the service repo, co-located with code |
| System-wide architecture docs, ADRs | Dedicated `docs/` repo or monorepo `docs/` folder |
| Operational runbooks accessed during incidents | Wiki (Confluence, Notion) AND linked from repo |
| Onboarding guides | Wiki — easier to edit for non-engineers; reviewed quarterly |

**Rule**: docs that must stay in sync with code belong in the repo. Docs that evolve independently of code belong in the wiki.

### Keeping docs fresh

- **Review docs in PRs**: add a step to your PR template — "Did you update relevant docs?"
- **Doc owners**: each doc has an owner listed in frontmatter or a `CODEOWNERS`-style file.
- **Freshness dates**: add `last_reviewed: YYYY-MM-DD` to long-lived docs. Stale = > 6 months without review.
- **Broken link CI check**: add a link checker to your CI pipeline for docs repos.

---

## Documentation Debt

Documentation debt accumulates silently. Treat it like technical debt.

**Write** when:
- A new system, service, or API launches
- An on-call incident reveals a missing runbook
- The same question is asked by 3+ people

**Update** when:
- A system design decision changes
- A runbook step fails because reality diverged from the doc
- An API changes signature or behavior

**Delete** when:
- The system it documents no longer exists
- The doc has been superseded and the old version causes confusion
- It's a stub that was never filled in (replace with a "to be written" notice or remove entirely)

**The cost of wrong documentation**: an engineer follows an outdated runbook during an incident and makes things worse. Stale docs are actively harmful.

---

## Template Set

### Template 1 — Architecture Overview

```markdown
# <System Name> — Architecture Overview

**Last reviewed**: YYYY-MM-DD
**Owner**: @<name>
**Status**: Current / Outdated / In Progress

## Purpose
What problem does this system solve? One paragraph.

## System Diagram
[Link to diagram or embed image]

## Key Components
| Component | Technology | Responsibility |
|-----------|------------|----------------|
| API Gateway | Kong | Auth, rate limiting, routing |
| Order Service | Java / Spring Boot | Order lifecycle management |
| ... | | |

## Data Flow
Step-by-step description of a request through the system.
1. Client sends request to API Gateway
2. ...

## Key Design Decisions
- Decision: <what was decided>. Rationale: <why>. See: [ADR-042](../adrs/ADR-042.md)

## Known Limitations
- ...

## Related Docs
- [API Reference](./api-reference.md)
- [Runbook: Deploy](./runbooks/deploy.md)
```

### Template 2 — Runbook

```markdown
# Runbook: <Operation Name>

**Service**: <service name>
**Last tested**: YYYY-MM-DD
**Owner**: @<name>
**Severity**: Routine / Urgent / Emergency

## When to use this runbook
<One sentence describing the situation that triggers this runbook>

## Prerequisites
- [ ] Access to <system/tool>
- [ ] <env var or credential> configured

## Steps

### 1. Verify the problem
```bash
<command>
```
Expected output: `<what you should see>`
If you see `<something else>`, go to Step X.

### 2. <Next step title>
```bash
<command>
```

## Rollback
If this operation needs to be undone:
```bash
<rollback command>
```

## Escalate if
- The steps above don't resolve the issue after <time>
- You see <unexpected behavior>
Contact: @<on-call rotation> or #<incident-channel>
```

### Template 3 — Onboarding Guide

```markdown
# Onboarding Guide: <Team/Service Name>

**Last reviewed**: YYYY-MM-DD
**Owner**: @<name>

## Week 1 Goals
By end of week 1, you should be able to:
- [ ] Run the service locally
- [ ] Make and merge a small PR
- [ ] Understand the team's deployment process
- [ ] Know who to ask for what

## Environment Setup
1. Clone the repo: `git clone <url>`
2. Install dependencies: `<command>`
3. Set up env vars: copy `.env.example` to `.env`, fill in values from <secret manager>
4. Run locally: `<command>`
5. Verify: `<health check url>` should return `{"status": "ok"}`

## Key Systems to Know
| System | What it is | Where to learn more |
|--------|-----------|---------------------|
| <Service A> | <description> | [Architecture doc](./architecture.md) |

## Team Norms
- PRs: reviewed within 24h; use the PR template
- Deployments: [deploy runbook](./runbooks/deploy.md)
- Incidents: [incident playbook](../incident-response-playbook/SKILL.md)

## Who to Ask
| Topic | Person |
|-------|--------|
| Infrastructure / deployments | @<name> |
| Product questions | @<name> |
| Security | @<name> |
```

---

## Practical Workflow

### Starting a documentation project from scratch

1. Audit what exists (even informal). Don't duplicate.
2. Identify the highest-pain gap (most asked question, most recent incident gap, newest service with no docs).
3. Pick one doc type. Write it to the relevant template.
4. Get one reviewer who matches the target audience — not the author.
5. Merge and announce. A doc no one knows exists doesn't help.
6. Add it to the relevant index/README.

### Docs in the PR workflow

Add to your team's PR template:
```markdown
## Documentation
- [ ] No docs changes needed
- [ ] Updated existing doc: [link]
- [ ] Added new doc: [link]
```

---

## Escalation Paths

| Need | Go To |
|------|-------|
| Architectural decisions to document | [`../adr-writer/SKILL.md`](../adr-writer/SKILL.md) |
| System design → architecture docs | [`../architecture-designer/SKILL.md`](../architecture-designer/SKILL.md) |
| Inline code documentation | [`../code-documenter/SKILL.md`](../code-documenter/SKILL.md) |
| Incident RCA to store and maintain | [`../incident-response-playbook/SKILL.md`](../incident-response-playbook/SKILL.md) |
