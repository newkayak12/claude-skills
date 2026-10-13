# Doc Types, Audience, Placement, Debt

Good documentation answers the right question for the right person at the right time.

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
