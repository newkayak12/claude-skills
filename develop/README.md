# develop

**English** · [한국어](KOR.md)

Engineering skills for the parts of software work that go wrong quietly — a service boundary drawn
in the wrong place, a test that passes for the wrong reason, a pool sized by guesswork, a runbook
nobody wrote until the pager went off. Each skill takes one of those and gives it a process:
diagnose before changing, name the trade-off, verify with evidence rather than assertion.

Five of the 32 skills are **workflow entry points** — they don't do the work themselves, they drive
the specialist skills in a fixed order and let you join mid-process.

## Install & Uninstall

```bash
/plugin install develop@newkayak12-claude-skills
/plugin uninstall develop@newkayak12-claude-skills
```

## Which skill do I want?

**Workflows (entry points)**

| I want to… | Skill |
|---|---|
| Run a full quality cycle: design → domain → tests → performance → docs → ops | `dev-quality-workflow` |
| Design a system end to end, from domain discovery to ADRs | `architecture-workflow` |
| Build a test suite from scratch and stabilize CI | `testing-workflow` |
| Investigate DB slowness across every layer | `database-workflow` |
| Get a service production-ready before launch | `operations-workflow` |

**Testing**

| I want to… | Skill |
|---|---|
| Write a failing test first and prove it can actually fail | `test-driven-development` |
| Add tests to untested code, audit coverage, write a test plan | `test-master` |
| Fix tests that pass locally and fail in CI | `flaky-test-analyzer` |

**Database**

| I want to… | Skill |
|---|---|
| Write or rewrite a query, design a schema, read an EXPLAIN plan | `sql-pro` |
| Fix DB slowness caused by server config, VACUUM, locks, or partitioning | `database-optimizer` |
| Stop "connection pool exhausted" errors and size the pool properly | `connection-pool-tuner` |
| Fix data that goes inconsistent after a partial failure | `transaction-boundary-reviewer` |

**Architecture & domain**

| I want to… | Skill |
|---|---|
| Choose a topology, weigh trade-offs, write ADRs | `architecture-designer` |
| Discover the domain with events before any code exists | `event-storming` |
| Model bounded contexts, aggregates, and a ubiquitous language | `domain-driven-design` |
| Decide whether a service split is real or would just add coupling | `service-boundary-validator` |
| Get business logic out of controllers and frameworks | `clean-architecture` |
| Design or restructure a distributed system | `microservices-architect` |

**Operations & reliability**

| I want to… | Skill |
|---|---|
| Define SLOs, error budgets, alerting, and on-call | `sre-engineer` |
| Run an active incident and write the blameless RCA | `incident-response-playbook` |
| Find the bottleneck before optimizing anything | `performance-profiling-optimization` |
| Stop a slow dependency from taking the caller down | `circuit-breaker-tuner` |
| Test failure tolerance on purpose, with a bounded blast radius | `chaos-engineer` |
| Shrink an image and stop cache-busting the build | `dockerfile-optimizer` |

**Languages & frameworks**

| I want to… | Skill |
|---|---|
| Build a Spring Boot 3.x backend — REST, Security, JPA, WebFlux | `spring-boot-engineer` |
| Write idiomatic Kotlin — coroutines, Flow, KMP, Compose, Ktor | `kotlin-specialist` |
| Build React / Next.js UI with TypeScript and Tailwind | `frontend-developer` |
| Build a CLI with subcommands, flags, and shell completions | `cli-developer` |

**Code quality & documentation**

| I want to… | Skill |
|---|---|
| Get a readability review and a concrete refactor list | `clean-code` |
| Diagnose codebase health and decide where technical debt starts | `pragmatic-programmer` |
| Generate docstrings, JSDoc, or an OpenAPI spec for existing code | `code-documenter` |
| Plan which docs should exist, for whom, and who keeps them current | `documentation-strategy` |

## Skills

### Workflows

### `dev-quality-workflow`

The full engineering quality cycle in six steps, each driven by a specialist skill:
`architecture-designer` → `domain-driven-design` → `test-driven-development` →
`performance-profiling-optimization` → `documentation-strategy` → `incident-response-playbook`.
Every step has a documented skip condition, so an already-approved architecture or a
single-maintainer internal tool drops out of the sequence instead of wasting a pass. Use it for a
greenfield feature or a refactor across several layers — not for a quick bug fix or a single-file
change.

```
We're building the new settlement service from scratch. Run the full dev quality workflow —
architecture is not decided yet, and it goes to production in six weeks.
```

Tell it where you already are and it joins mid-flight: "DDD부터" starts at Step 2, "already
implemented, just check performance" jumps to Step 4.

### `architecture-workflow`

Seven steps from domain discovery to documented decision: `event-storming` (optional if the domain
is well understood) → `domain-driven-design` → `service-boundary-validator` → `clean-architecture`
→ `architecture-designer` → `microservices-architect` (optional if staying on a monolith) →
`technique-write:adr-writer`, which is the one step never skipped. Use it for a new system or a
monolith-to-MSA evaluation; for iterating inside an existing stable architecture, call the
individual skill instead.

```
We're deciding whether to break the order monolith into services. Take me through the
architecture workflow — domain modeling first, and I want ADRs at the end either way.
```

Estimated: 1–3 days for the full run, 2–6 hours per step.

### `testing-workflow`

Three steps: write first → strategize coverage → stabilize CI. Drives
`test-driven-development` → `test-master` → `flaky-test-analyzer`. Step 1 is skipped when you are
adding tests to existing untested code (go straight to Step 2), Step 3 when CI is already green
without re-run workarounds. Not for a single test on already-covered code, and not for tests that
fail *consistently* — those are bugs, not flakiness.

```
Our service has 20% coverage and CI goes red about once a day. Run the testing workflow —
start with the new payment module, then deal with the flaky integration tests.
```

Estimated: 2–8 hours for the full run, 30–120 min per step.

### `database-workflow`

Four steps down the stack: `sql-pro` (query authoring, indexes, EXPLAIN) → `database-optimizer`
(server config, slow query diagnosis) → `connection-pool-tuner` (pool sizing, leak detection) →
`transaction-boundary-reviewer` (isolation levels, `@Transactional` scope, Outbox/Saga). Use it
when production is slow and you do not yet know which layer is at fault. If you already know —
one query, one pool, one transaction — call that skill directly.

```
Production DB latency doubled after last week's release and we can't tell which layer.
Run the database workflow across all four layers.
```

Estimated: 2–6 hours for the full run, 30–90 min per step.

### `operations-workflow`

Four phases — build, observe, harden, respond — over six skills: `dockerfile-optimizer` →
`sre-engineer` → `performance-profiling-optimization` → `circuit-breaker-tuner` → `chaos-engineer`
→ `incident-response-playbook`. Order matters: chaos runs only after circuit breakers are
configured, and it is skipped entirely when no monitoring stack exists. Use it for a pre-launch
readiness review or a service that keeps misbehaving; during an active incident, go straight to
`incident-response-playbook`.

```
New notification service ships to prod next Thursday. Run the operations workflow —
container, SLOs, circuit breakers, and a runbook before launch.
```

Estimated: 4–16 hours for the full run, 1–3 hours per step.

### Testing

### `test-driven-development`

Red-green-refactor with an evidence gate. Before running a RED test you must name the exact
production change that would flip it to failing — a **falsifiability probe**, not a hope — then
watch it fail for that predicted reason. A test that passes immediately means you are exercising
code that already exists; rewrite it. Skip it for throwaway prototypes, generated code, config
files, or when adding tests to untested legacy (use `test-master`).

```
Implement the circuit breaker open/close logic with TDD. For each test, name the breaking
change before you run it and show me the failure output.
```

Every RED cycle produces one record:

| Field | Example |
|---|---|
| Test name | `opens the circuit after 3 consecutive failures` |
| Breaking change named (pre-GREEN) | "removing the failure counter increment" |
| Observed failure reason | `TypeError: breaker.isOpen is not a function` — matches expectation |

The skill runs in two modes. Solo, you keep the record in your own notes and self-check it.
Under `harness:harness`, the record is a durable artifact its QualityGate reads — a missing or
fabricated record fails the gate.

### `test-master`

Writes, improves, and audits tests — unit, integration, E2E, performance, security — and produces
coverage-gap analysis, test plans, and defect reports. Reach for it when tests need to be added to
code that has none, or when coverage exists but nobody knows what it actually covers. Not for
work already under a TDD cycle (use `test-driven-development`), and not for debugging one specific
flaky test (use `flaky-test-analyzer`).

```
This legacy billing module has no tests. Audit what's testable, write a test plan by
risk, then add unit and integration tests for the highest-risk paths first.
```

### `flaky-test-analyzer`

Diagnoses tests that pass some runs and fail others, then fixes the cause rather than adding a
retry. Triages the failure category first, reproduces the test in isolation over 20 runs, and
reproduces it under different orderings to catch inter-test pollution. Not for tests that fail
consistently — that is a bug — and not for writing new tests.

```
These three integration tests fail in CI maybe one run in five, always green locally.
Find the actual cause — I don't want another retry wrapper.
```

### Database

### `sql-pro`

Authors and rewrites SQL: joins, CTEs, window functions, recursive queries, plus schema design,
normalization, and dialect migration between PostgreSQL, MySQL, and SQL Server. Also reads EXPLAIN
plans for a slow query and flags any feature that needs a minimum engine version. Not for
server-level config bottlenecks (use `database-optimizer`) or pool exhaustion (use
`connection-pool-tuner`).

```
This report query does a full scan on a 50M-row table and takes 5 minutes. Rewrite it
with CTEs and window functions, and tell me which indexes it needs. Postgres 15.
```

### `database-optimizer`

Handles the slowness that is *not* about how the query is written: server memory and I/O
configuration, lock contention, VACUUM and statistics maintenance, partitioning design, and
cloud-managed database limits. Captures an `EXPLAIN (ANALYZE, BUFFERS)` baseline before changing
anything. Not for rewriting a slow query (use `sql-pro`) or pool exhaustion (use
`connection-pool-tuner`).

```
Our RDS Postgres degrades every afternoon — queries are fine in isolation. Check server
config, autovacuum, and lock contention, and capture a baseline before any change.
```

### `connection-pool-tuner`

Diagnoses intermittent connection failures, latency spikes under traffic, and pool exhaustion, then
sizes and configures the pool — `maximumPoolSize`, `minimumIdle`, `connectionTimeout`,
`maxLifetime` — for HikariCP, pgBouncer, or similar, with leak detection. It works symptom-first
against a diagnosis table. Not when the root cause is slow SQL (use `sql-pro`) or server-level
memory/IO config (use `database-optimizer`).

```
Spring Boot service throws "connection pool exhausted" at peak, about 500 concurrent
users, Postgres has max_connections 200. Size HikariCP properly and check for leaks.
```

### `transaction-boundary-reviewer`

Reviews isolation levels, atomicity gaps, and overly wide transactions when data goes inconsistent
after a partial failure or when locks and timeouts appear under load. Identifies which ACID
property is at risk first, then maps what actually runs inside `@Transactional` — external I/O
inside a transaction, N+1 queries, missing `rollbackFor`, lost updates. Not for slow queries (use
`sql-pro`) or pool exhaustion (use `connection-pool-tuner`).

```
After a timeout last night, orders were created but payments weren't. Review our
@Transactional boundaries and tell me whether this needs Outbox or a Saga.
```

### Architecture & domain

### `architecture-designer`

Makes and documents architectural decisions from scratch: system topology (monolith, modular
monolith, microservices), scalability trade-offs, database and infrastructure selection, and ADRs
for every significant choice. It evaluates alternatives explicitly and plans for failure modes
rather than listing benefits. Not for internal layer dependency rules (use `clean-architecture`),
bounded-context modeling (use `domain-driven-design`), or writing implementation code.

```
Greenfield analytics platform, 50k events/sec at peak, small team. Compare topologies,
recommend a stack with rationale, and write ADRs for the database and queue choices.
```

Output: requirements summary (functional + non-functional) → Mermaid architecture diagram → key
decisions in ADR format with trade-offs → technology recommendations with rationale → risks and
mitigations.

### `event-storming`

Facilitates domain discovery through events, in three levels: Big Picture (whole domain, bounded
contexts, pain points), Process Level, then Design Level. Use it when starting a new product,
untangling a legacy system, or when someone asks where domain modeling should even begin. Not when
the domain is already well modeled and stable, and not for producing code — run it first, then
hand off to `microservices-architect` or `spring-boot-engineer`.

```
We're rebuilding the warehouse system and nobody agrees on how receiving actually works.
Run an event storming session — start at Big Picture and get us to bounded contexts.
```

### `domain-driven-design`

Aligns code structure with business concepts: ubiquitous language, bounded contexts, aggregates,
entities vs. value objects, domain events, and context mapping. Reach for it when domain experts
and developers are using the same words for different things, or when service boundaries need to
come out of domain analysis. Not for architecture layering (use `clean-architecture`), coupling
validation of existing services (use `service-boundary-validator`), or simple CRUD apps.

```
Our "Order" means three different things across teams. Build a ubiquitous language,
define bounded contexts, and draw the context map with integration patterns.
```

### `service-boundary-validator`

Answers "should this be its own service?" by evidence rather than instinct. Maps synchronous call
graphs, shared databases, and bidirectional dependencies; audits which service creates, reads,
updates, and deletes each entity; checks each service against one team with the cognitive-load
test; then recommends merge, split, convert to async, or fix ownership. Not for designing
boundaries from scratch — run `event-storming` first, then `microservices-architect`.

```
We want to pull inventory out of the order service. Validate the split: they share three
tables and call each other synchronously in both directions.
```

### `clean-architecture`

Separates concerns across layers — entities, use cases, interface adapters, frameworks/drivers —
and enforces the dependency rule when business logic has leaked into HTTP handlers or the ORM. It
scores the current architecture 0–10, names each dependency-rule violation, and designs ports and
adapters so the use cases are testable without the framework. Not for code-level naming and
function size (use `clean-code`), bounded-context modeling (use `domain-driven-design`), or simple
scripts.

```
Our controllers are 400 lines and query JPA repositories directly. Score the current
layering, list the dependency violations, and show me the ports-and-adapters refactor.
```

### `microservices-architect`

Designs and evaluates distributed systems: monolith decomposition, service boundaries via DDD,
sync vs. async communication, data strategy, resilience, and observability. It starts by asking
whether microservices are warranted at all — with no CI/CD, no container orchestration, and fewer
than two independent squads it recommends a modular monolith instead. Not for implementation code
(use `spring-boot-engineer`).

```
E-commerce monolith, 12 engineers in three squads, Kubernetes already in place. Design
the decomposition — service boundaries, communication patterns, and data ownership.
```

### Operations & reliability

### `sre-engineer`

Establishes production reliability practice: SLIs and SLOs with error budgets, golden-signal
alerting and dashboards, incident runbooks, toil reduction, and capacity planning. It confirms
your observability stack before generating any config — reference examples default to
Prometheus/Kubernetes. Not for designing chaos experiments (use `chaos-engineer`) or provisioning
infrastructure.

```
Define SLOs and error budgets for our three user-facing APIs, then give me golden-signal
alerts and an on-call rotation. We're on Datadog, not Prometheus.
```

### `incident-response-playbook`

Runs the developer-side incident lifecycle: detect → triage → communicate → mitigate → resolve →
learn. Severity is classified before anything else, because it drives escalation and update
cadence, and mitigation is kept separate from investigation so neither blocks the other. RCAs are
blameless and always include a reconstructed timeline. Use it during an active incident or when
building the playbook in advance.

```
Checkout has been erroring for 8 minutes. Classify severity, give me the Slack update to
post right now, and set up the mitigation vs. investigation split.
```

| Severity | Definition | Response time |
|---|---|---|
| P0 | Full service down; revenue or data at risk | Immediate — page on-call |
| P1 | Major feature broken for a significant user subset | < 15 min |
| P2 | Degraded performance or partial feature failure | < 1 hour |
| P3 | Minor issue with a workaround | Next business day |

Also ships Slack and status-page update templates and a full RCA format (summary, timeline, root
cause, contributing factors, what went well, action items).

### `performance-profiling-optimization`

Measure first, hypothesize second, profile third, fix fourth, verify always. Establishes a
baseline, matches the symptom to a likely cause, profiles CPU/memory/IO/network with concrete tool
guidance, applies one targeted change, and re-measures. Use it when there is a real, observed
performance problem — not a suspicion.

```
API P99 went from 120ms to 900ms after Tuesday's deploy, CPU is flat. Baseline it,
profile, and tell me the one change to make before we touch anything.
```

Symptom-to-cause table it starts from:

| Symptom | Likely cause |
|---|---|
| CPU 100%, low latency variance | Hot loop, serialization overhead, regex |
| High P99, low CPU | Lock contention, thread starvation, GC stop-the-world |
| Memory grows then crashes | Leak, unbounded cache, large result sets held in memory |
| IO wait high | Slow queries, missing index, full table scans |

Findings escalate outward: DB query issues to `database-optimizer`, pool exhaustion to
`connection-pool-tuner`, cascading latency to `circuit-breaker-tuner`, SLO/alerting to
`sre-engineer`.

### `circuit-breaker-tuner`

Configures and tunes circuit breakers, bulkheads, timeouts, and fallbacks so a slow or failing
downstream stops exhausting the caller's threads and connections. Sets `failureRateThreshold`,
`waitDurationInOpenState`, and `minimumNumberOfCalls`, chooses between COUNT_BASED and TIME_BASED
sliding windows, and fixes HALF_OPEN probe behavior when the breaker trips on false positives.
Not for slow SQL or missing indexes, and not for chaos experiment design (use `chaos-engineer`).

```
Our payment breaker opens several times a day even though the provider is healthy —
p99 there is 800ms. Retune the thresholds, window, and HALF_OPEN probes.
```

### `chaos-engineer`

Designs controlled failure experiments — network latency, pod deletion, zone outages — with a
stated hypothesis, steady-state metrics, a bounded blast radius, safety controls, and a scripted
rollback; also plans game day exercises. It refuses to proceed without a monitoring stack, because
steady state cannot be verified without metrics. Not for responding to an active incident (use
`incident-response-playbook` or `sre-engineer`).

```
Plan a game day for our Kubernetes checkout path: pod kills first, then AZ loss. Keep the
blast radius to 5% of traffic and give me the abort criteria.
```

### `dockerfile-optimizer`

Analyzes an existing Dockerfile and returns concrete before/after fixes for layer caching, image
size, build speed, and security. Two passes: note every finding across the 8 checks first, then
apply fixes — so one visible issue does not get fixed while interacting issues are missed. Not for
Kubernetes manifests, docker-compose orchestration, or runtime security policy (AppArmor, seccomp).

```
Our image is 1.8GB and every code change re-runs npm install. Here's the Dockerfile —
find everything wrong first, then give me the rewritten version.
```

Covers base image selection (alpine / distroless / slim / full), multi-stage builds, layer
ordering, `.dockerignore`, non-root users, and secrets leaking into layers. Reference material:
`references/antipatterns.md`, `references/dockerignore-template.md`.

### Languages & frameworks

### `spring-boot-engineer`

Builds and extends Java backends on Spring Boot 3.x: REST APIs, Spring Security 6 and
authentication, Spring Data JPA, WebFlux reactive endpoints, caching, transaction management, and
validation. It designs data access and security before coding and confirms the plan first, then
implements with constructor injection and layered structure. Not for service decomposition
decisions (use `microservices-architect`); pair with `kotlin-specialist` for Kotlin idioms.

```
Build the REST API for our member service — JWT auth with Spring Security 6, JPA
persistence, bean validation, and a consistent error response shape.
```

### `kotlin-specialist`

Idiomatic Kotlin: coroutines and Flow, structured concurrency and cancellation, Kotlin
Multiplatform layout, Android with Jetpack Compose, Ktor servers, and type-safe DSLs. It designs
sealed classes and data models first, then verifies cancellation propagates and null safety holds.
Not for a Spring Boot Java backend (use `spring-boot-engineer`); Android work here targets Compose,
not XML layouts.

```
Convert this Java service to Kotlin and make the async paths coroutine-based — I want
proper scope handling and cancellation, not GlobalScope everywhere.
```

### `frontend-developer`

Builds and fixes UI: React components, layouts, client-side interactivity, data-fetching hooks,
styling, and forms. Defaults to Next.js App Router, TypeScript, and Tailwind unless the project
says otherwise; defines prop/state/API types before implementing, and builds top-down from the
layout shell. Not for Vue, Svelte, or Angular, and not for backend APIs.

```
Build a dashboard page in our Next.js app — server-side data fetch, filter controls,
responsive table, and proper loading and error states.
```

### `cli-developer`

Builds command-line tools: subcommand hierarchy, flags and argument parsing, interactive prompts,
progress bars, shell completions, and cross-platform distribution. It lists every command with its
expected `--help` output before writing code and checks that flag naming stays consistent and no
existing signatures break. Not for web UIs or REST APIs, and not for SRE pipeline integration alone
(use `sre-engineer`).

```
Build a CLI that manages our deployment configs across environments — subcommands for
list/diff/apply, a --dry-run flag, and zsh completions.
```

Framework defaults: Node.js `commander` → `yargs` → `oclif`; Python `typer` → `click` → `argparse`;
Go `cobra + viper`, with `bubbletea` for TUIs only.

### Code quality & documentation

### `clean-code`

Reviews and refactors code for the people who have to read it later. It scores the code 0–10,
states the score explicitly, then lists specific violations by category — names, functions,
comments, error handling, tests — with the refactor for each. Use it for PR feedback, legacy
cleanup, or naming decisions. Not for architectural layer decisions (use `clean-architecture`),
domain modeling (use `domain-driven-design`), or performance work (profile first).

```
Review this 300-line service class for readability. Give me the score, the specific
smells, and the refactor in priority order — I only have an afternoon.
```

### `pragmatic-programmer`

Diagnoses codebase and practice health across seven principles — DRY, orthogonality, technical debt
strategy, estimation, knowledge portfolio and the rest — scores each 0–10, then ranks the
highest-impact violations so debt work has a defensible starting point. Use it for engineering
retrospectives and debt strategy. Not for code-level naming (use `clean-code`), structural
architecture decisions (use `architecture-designer`), or domain modeling.

```
We have three years of accumulated debt and everyone has a different theory about what's
worst. Score the codebase against the principles and tell me where to start.
```

### `code-documenter`

Creates documentation that does not exist yet: docstrings and JSDoc for functions and classes,
OpenAPI/Swagger specs generated from an existing API, doc sites, READMEs, and tutorials. It asks
for format preferences and exclusions first, and follows existing conventions in the codebase —
defaulting to Google style for Python and JSDoc for TypeScript/JS when none are found. Not for
architectural decision records (use `technique-write:adr-writer`) or planning a doc system (use
`documentation-strategy`).

```
This module has no docs at all. Add docstrings to the public API, generate an OpenAPI
spec from the controllers, and write a README that gets a new engineer running.
```

### `documentation-strategy`

Plans a documentation system rather than writing one more page: audits what already exists,
produces a coverage map, and writes the highest-leverage missing content. Every recommended doc
gets a named audience and a maintenance owner, and nothing is recommended without a plan for
keeping it current — bad docs mislead with false confidence, which is worse than none.

```
Our docs are spread over three wikis and half are stale. Audit what we have, map the
gaps by audience, and tell me which five documents are actually worth maintaining.
```

Doc types it distinguishes, each with its own audience and update trigger:

| Type | Audience | Update trigger |
|---|---|---|
| Architecture Overview | New engineers, tech leads, auditors | Major design changes |
| API Reference | API consumers | Every API change |
| Runbook | On-call engineers under pressure | When the steps change |
| ADR | Future team members, reviewers | Written once; amended, not deleted |
| Onboarding Guide | New team members | Quarterly + workflow changes |

## MCP

Most skills declare `compatibility` in their frontmatter. `think-tool` is recommended wherever a
trade-off has to be weighed explicitly — architecture patterns, SLO targets, isolation levels,
circuit breaker thresholds, chaos blast radius. `sequential-thinking` is recommended where step
order is the point: baseline → change → verify in the database and performance skills, detect →
triage → mitigate → RCA in incident response, and every `*-workflow`. `mcp-reasoner` appears as
optional on the highest-stakes design skills.

If the tools are not connected, add the remote SSE endpoints under Claude 설정 → MCP Servers. The
skills work without them; the judgment steps are just less structured.

---
