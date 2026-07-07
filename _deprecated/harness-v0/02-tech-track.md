# 02. Tech Track

Purpose: Specify **"how to build it"** before writing code. Artifacts must record not just *the current decision* but also *why this decision was made and what would cause it to be reversed*.

## 2.1 Architecture Design

### What to Produce

Three artifacts as a bundle:
1. **Design Doc** — core decisions for the system as a whole
2. **ADR series** — one per decision, recording *why / when / alternatives considered*
3. **Diagrams** — if you can't draw the architecture from text alone, there are contradictions

→ Templates: [`templates/design-doc.md`](./templates/design-doc.md), [`templates/adr.md`](./templates/adr.md)

### How Far to Draw Diagrams — C4 Model

Simon Brown's C4 model defines diagrams at **4 zoom levels**:

| Level | Name | Shows | Audience |
|---|---|---|---|
| 1 | **Context** | The system as a unit + external users and systems | Everyone, including non-technical |
| 2 | **Container** | *Deployment units* inside the system (web app, API, DB, queue, worker) | Technical |
| 3 | **Component** | *Logical modules* inside a container | Developers |
| 4 | **Code** | Class/function diagrams | Usually generated; not drawn by hand |

**For a solo developer: Level 1 + 2 are required.** Level 3 only for complex containers. Level 4 skip.

### arc42 — Architecture Documentation Template

Gernot Starke's arc42 describes architecture in 12 sections. The full version is heavy, but the *section list* is useful as a checklist:

1. Introduction and Goals
2. Architecture Constraints
3. Context and Scope
4. Solution Strategy
5. Building Block View
6. Runtime View
7. Deployment View
8. Cross-cutting Concepts (logging, security, error handling…)
9. Architectural Decisions (split into ADRs)
10. Quality Requirements
11. Risks and Technical Debt
12. Glossary

→ The solo developer slim version is compressed into one Design Doc template. Use arc42 to *check for gaps*.

### Architecture Style Selection — Primary Fork

| Style | Suitable | Not suitable |
|---|---|---|
| Monolith (Modular) | Solo/early stage, low traffic, domain boundaries unclear | Large teams, clearly separated domains, multi-language |
| Microservices | Large teams, independent deployment needed, clear domain separation | Solo developers (operational overhead explodes) |
| Serverless (FaaS) | Uneven traffic, background jobs, fast prototypes | Long-running tasks, latency-sensitive, low local dev friendliness |
| Event-driven | Async processing dominant, multiple consumers | Simple CRUD, strong consistency required |
| Hexagonal / Clean | Business logic protection essential, adapter replacement likely | Trivial CRUD |

**Default choice for a solo developer**: *Modular Monolith*. Confirm module boundaries are correct before splitting.

### Cross-cutting Concerns — Decide Up Front

Items that require touching *every module* if not decided at the architecture stage:

- **Logging** (format: JSON/structured / levels / correlation ID propagation)
- **Error handling** (exception classification / retry / circuit breaker placement)
- **Authentication / Authorization** (session vs token / permission model)
- **Configuration** (env vs config server / secret management)
- **Observability** (metrics, logs, traces — three pillars)
- **Idempotency** (retry handling for incoming external requests)
- **Timezone & i18n** (store in UTC / locale processing point)

Going through each item and *writing down the answer* enables consistency later.

## 2.2 Tech Stack Selection

### Decision Matrix

*Explicitly state criteria*, assign weights, then compare candidates by score. Choosing by gut means you can't defend the choice later.

| Criterion | Weight | Candidate A | Candidate B | Candidate C |
|---|---|---|---|---|
| Familiarity (critical for solo dev) | 30% | | | |
| Productivity (ecosystem, tooling) | 20% | | | |
| Operational cost (hosting, management) | 15% | | | |
| Performance fit (NFR match) | 15% | | | |
| Hiring/community (career, support) | 10% | | | |
| Lock-in risk | 10% | | | |

### Lock-in Analysis

A technology choice includes the *cost of reversing* that choice.

| Lock-in type | Example | Reversal cost |
|---|---|---|
| Vendor lock-in | AWS DynamoDB, Firebase RTDB | Very high (schema, queries, and management all change) |
| Framework lock-in | Spring, Rails | Medium (library can be abstracted) |
| Language lock-in | Kotlin, Go | Medium–high |
| Library lock-in | Specific ORM, specific client | Low–medium |
| Data lock-in | Proprietary format storage | Very high |

Principles:
- **Accept vendor lock-in only when** the cost/benefit gap is large enough to justify it (e.g., BigQuery's analytics performance).
- **Data lock-in is the most dangerous.** Keeping data in standard formats (SQL, S3-compatible object storage) makes other forms of lock-in more tolerable.

### Build vs Buy vs Borrow

| Decision | When appropriate |
|---|---|
| Build (do it yourself) | Core differentiator / not available externally / license burden |
| Buy (SaaS or paid library) | Non-differentiating area / time saved outweighs cost |
| Borrow (OSS) | Proven, actively maintained OSS exists / license compatible |

Don't build what isn't core differentiation — auth, payment, email, search: SaaS is almost always the right call.

### Record Decisions with ADRs

Each major decision gets one ADR. Format (Michael Nygard original):
- **Title** (including number)
- **Status** (Proposed / Accepted / Deprecated / Superseded by ADR-XXX)
- **Context** (why a decision is needed)
- **Decision** (what was decided)
- **Consequences** (positive/negative outcomes, trade-offs)

MADR (Markdown ADR) adds **Considered Options** and **Decision Drivers** for richer documentation. → Template: [`templates/adr.md`](./templates/adr.md)

## 2.3 DB Design

### Three-Level Modeling

| Level | Artifact | Who reads it |
|---|---|---|
| Conceptual | ER diagram (conceptual entities) | Domain experts + developers |
| Logical | Normalized schema (PK, FK, types, constraints) | Developers |
| Physical | DDL (indexes, partitioning, storage) | Developers + DBA |

→ Skipping these levels and going straight to Physical means **the domain model becomes dependent on DB implementation details**. Writing out the Conceptual level forces domain understanding.

### Normalization vs Denormalization

| | Normalization (3NF+) | Denormalization |
|---|---|---|
| Pros | Data consistency, easy updates | Read performance, simpler queries |
| Cons | Join complexity, harder to trace writes and reads | Update cost, consistency risk |
| Default | **Start normalized for OLTP** | OLAP, read-heavy, reporting |

**Principle**: Start normalized → identify bottlenecks by measurement → denormalize *intentionally, only when there is evidence*.

### Query-driven Design (NoSQL/KV)

For KV/Document/Wide-column DBs, **query patterns determine schema**. List *what queries will be issued* before designing the model (patterns like single-table design).

- DynamoDB single-table design: all entities in one table with PK/SK combinations. Only works when query patterns are *fixed*.
- MongoDB: embedding vs referencing — *embed data that is read together*, *reference data that updates independently or is large*.

### Indexes — Physical Level

- **Every FK is an index candidate** (join performance)
- **Columns frequently in WHERE / ORDER BY / GROUP BY**
- **Low-selectivity columns are not worth single-column indexes** (e.g., boolean) — consider composite or partial indexes
- **Indexes add write cost** — 5 indexes can make INSERT 5× slower

### Transaction Boundaries

- Transaction boundaries must align with *service consistency boundaries*. Transactions that cross domain boundaries become distributed transactions or must be split into sagas.
- ACID vs BASE: monolith + relational DB gets ACID for free. Once distributed, *eventual consistency* requires explicit agreement.

### Data Governance — Decide at the Start

- **PII / sensitive data identification**: which columns are personal data? Encryption, hashing, access control rules.
- **Retention**: how long to store? Automatic deletion policy.
- **Audit trail**: need to track who changed what, when?
- **Backup & recovery**: RPO (how much data loss is acceptable) / RTO (how fast to recover).
- **Data residency**: GDPR, local privacy laws, etc.

## 2.4 Track Artifact Checklist

- [ ] Design Doc × 1 (system-wide decisions)
- [ ] ADR series (one per major decision, minimum 5 recommended)
- [ ] C4 Context + Container diagrams
- [ ] (Optional) Component diagram — complex containers only
- [ ] Tech stack decision matrix + lock-in analysis
- [ ] Cross-cutting concerns decision notes per item (logging/error/auth/config/observability/idempotency/timezone)
- [ ] NFR numbers (response time P95/P99, availability %, concurrent users, …)
- [ ] Conceptual ER → Logical schema → Physical DDL
- [ ] Data governance notes (PII, retention, audit, backup, residency)
- [ ] *Tech hypothesis list* to pass to Validation Gate 2 (3–5 items)
