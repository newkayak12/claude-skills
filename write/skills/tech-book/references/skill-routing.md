# Skill routing — which repo skill runs at which stage

Invoke each by name, visibly. "Conditional" rows run only when their condition holds. File paths are relative to this skill's folder.

## Stages

| stage | skill | invoked when | input given | returns | written to |
|---|---|---|---|---|---|
| 0 brief | `think:grill` | always | the request + what the repo/sources already answer | one round of decisions, each with a recommended answer | `brief.md` |
| 1 toc | `think:untangle-thoughts` | always (Outline technique) | brief.md | ordered chapter outline | `toc.md` |
| 1 toc | `think:grill` | presenting the TOC | toc.md | scope / order / depth decisions to approve | `toc.md` (approved) |
| 2 concepts | `think:untangle-thoughts` | always (atoms → clusters → gaps) | toc.md + chapter goal | concepts per chapter, gaps surfaced | `concepts/NN.md`, `glossary.md` |
| 2 / 4 sources | `knowledge:base-builder` | conditional: the user supplied source material | the sources | a vault | `sources/` |
| 2 / 4 sources | `knowledge:query` | conditional: a vault exists | one fact to check | cited answer | the concept or review file |
| 3 draft | `agents:dispatching-parallel-agents` | always | one chapter per agent, `sme:` persona mounted, no worktree | one draft file per agent | `draft/NN.md` |
| 3–4 SME | per `sme:` (table below) | the chapter's subject | concepts/NN.md, then draft/NN.md | draft content; then a fact check | `draft/NN.md`, `review/NN-rK.md` |
| 4 review | `cognition:epistemic-reasoner` | always | every anchor analogy (Instrument 2) and absolute claim (Instrument 1) | mappings that hold / break; overclaims | `review/NN-rK.md` |
| 4 review | `write:writer-verification` | always, review mode, genre `doc` | draft/NN.md + audience from brief | 🔴🟡🟢 findings with fixes | `review/NN-rK.md` |
| 4 review | `../plans/agents/reader-agent.md` | always, ≤ 5 questions per chapter per round | draft/NN.md only + one learning goal as a question | answer + where the text lost them | `review/NN-rK.md` |
| 6 copyedit | `write:writer-verification` | always, one final pass | final/NN.md | remaining 🔴🟡 | `final/NN.md` |
| 6 copyedit | `write:like-me` | conditional: ≥ 2 samples the user wrote alone | final/NN.md + samples | the user's voice | `final/NN.md` |
| 6 figures | `develop:architecture-designer` | conditional: a system/architecture figure | the components and flows | diagram (diagram IR) | `final/fig-N-M.*` |
| done | `completion:verification-before-completion` | always | the Goal line + file listing | isolated verdict | chat |

## SME by subject (`sme:` in toc.md)

| subject | skill | references worth loading |
|---|---|---|
| Postgres / MySQL internals, tuning | `develop:database-optimizer` | `monitoring-postgresql.md`, `postgresql-memory-wal.md`, `postgresql-vacuum-locking.md`, `mysql-memory-io.md`, `monitoring-mysql.md`, `index-design-patterns.md` |
| SQL, dialect differences | `develop:sql-pro` | `dialect-differences.md` (porting traps, type mapping), `query-patterns.md`, `window-functions.md` |
| transactions, isolation, locks | `develop:transaction-boundary-reviewer` | `distributed-patterns.md` |
| connections, pooling, pgBouncer | `develop:connection-pool-tuner` | — |
| MongoDB | **gap — no SME skill** | general persona; every version or behaviour fact sourced from official docs or `[확인 필요]`; `develop:architecture-designer` `database-selection.md` for where it fits |
| domain modelling | `develop:domain-driven-design` | `strategic-design.md`, `bounded-contexts.md`, `ubiquitous-language.md` |
| layering, dependencies, SOLID | `develop:clean-architecture` | `dependency-direction.md`, `components-and-solid.md` |
| code quality, refactoring, review | `develop:clean-code` | `code-smells.md`, `review-framework.md` |
| TDD | `develop:test-driven-development` | `testing-anti-patterns.md` |
| test strategy, suites | `develop:testing-workflow` | — |
| architecture, system design | `develop:architecture-designer` | `architecture-patterns.md`, `system-design.md`, `adr-template.md` |
| operations, SLO, incidents | `develop:sre-engineer` | `slo-and-budgets.md`, `incidents.md`, `monitoring-alerting.md` |

A subject with no row: say so in toc.md (`sme: none — [확인 필요]`) rather than mounting the nearest skill.
