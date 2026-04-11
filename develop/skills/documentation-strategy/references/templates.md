# Documentation Templates

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
