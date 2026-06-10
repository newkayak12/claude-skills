# 00. Harness Engineering — Concept and Full Map

## 0.1 User Definition (original preserved)

> In development, **Product Planning** (Persona definition → Service concept definition → Requirements gathering → Requirements definition (RFP, SRS) → User Journey Map → MVP scope definition) → **Validation Loop** → **Technical Planning** (Architecture design → Tech stack selection → DB design) → **Validation Loop** refers to this process.

## 0.2 The Term "Harness Engineering"

"Harness" originally meant a horse harness — the coupling device that transfers a horse's power to a carriage. In software, it appears in **test harness** (auxiliary code wrapping test execution) and **execution harness** (a shell that orchestrates tasks). Here the meaning is extended to: **"the combined structure of steps, artifacts, and validation gates that a developer needs to take a product idea through to a real system."**

This is not an industry-standard term. The closest external concepts are:

- **Double Diamond** (UK Design Council): Discover → Define → Develop → Deliver. Two diverge/converge cycles.
- **Dual-Track Agile** (Marty Cagan / Jeff Patton): Discovery and Delivery tracks in parallel, each with its own artifacts and gates.
- **Lean Startup** (Eric Ries): Build–Measure–Learn loop. Validation determines next step.
- **Shape Up** (Basecamp): Shaping → Betting → Building. Fix the shape before committing.

This harness is closest to **Dual-Track + Lean validation loops** compressed for a solo developer.

## 0.2b Relationship to Böckeler's "Harness Engineering" (namesake)

The closest external work that established "harness" in an *AI coding context* is Birgitta Böckeler / Thoughtworks' **Harness Engineering for Coding Agents** ([martinfowler.com](https://martinfowler.com/articles/harness-engineering.html)). Core definition:

> **Agent = Model + Harness.** The harness is *everything except the model* — the shell of guides and sensors that steers the agent toward quality output.

Her taxonomy:

| Axis | Categories |
|---|---|
| Control direction | **Guide** (feedforward — steer *before* action) / **Sensor** (feedback — observe and self-correct *after* action) |
| Execution mode | **Computational** (deterministic: linter, tests, type checker, ms) / **Inferential** (semantic AI analysis, slow, non-deterministic, rich) |
| Improvement | **Steering Loop** — when issues recur, humans improve the harness (the harness itself can also be built by agents) |
| Regulatory categories | **Maintainability / Architecture Fitness / Behaviour** (all *code quality*) |

### Our Position — Same Lineage, One Layer Up

Our scenario itself is *"Agent (Claude) = Model + Harness (this project)"*. This harness is therefore **a harness that steers a coding agent through the *entire product development cycle***. In Böckeler's vocabulary:

- Chapter 13's *"code-enforced vs narrative judgment"* = her *Computational vs Inferential* (converged independently — external validation of the design)
- Chapter 13's *black box logging* = *Sensor (feedback)*
- pre-cycle gates · Tier A injection = *Guide (feedforward)*
- `findings.md` → retro → carryover = *Steering Loop*

**Differentiator (this project's contribution)**: Böckeler's 3 regulatory categories are all *code quality*. We add a **4th category — Product / Process Validation**: "Was it validated *before* building · was it killed when it should be · is the hypothesis falsifiable · was WIP respected?" This *extends harness engineering upward from code to product process*.

This relationship directly addresses `devils-advocate.md`'s `CV-1` (author = enforcer = target) — Böckeler says *"humans bring organisational alignment that a harness cannot replace, while the harness reduces supervision toil."* We move the enforcer *from person to code* while leaving judgment with the human. This is the basis for the boundary in Chapter 13 §3.

## 0.3 Two Tracks and Two Validation Loops

```
┌──────────────────────────────────────────────────────────────┐
│ PRODUCT TRACK  (why / for whom / what)                       │
│                                                              │
│  Persona ─→ Service Concept ─→ Requirements ─→ SRS/RFP       │
│      │                                            │          │
│      └────────────→ User Journey Map ←────────────┘          │
│                          │                                   │
│                          ▼                                   │
│                     MVP Scope                                │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
                  ╔══════════════════════╗
                  ║  VALIDATION LOOP 1   ║   ← product hypothesis validation
                  ║  (Product hypothesis) ║      Fake-door / Wizard of Oz
                  ║                       ║      Concierge / Prototype
                  ╚══════════╤═══════════╝       Interview-driven
                             │
                       Pivot / Persevere
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│ TECH TRACK  (how)                                            │
│                                                              │
│   Architecture ─→ Tech Stack ─→ DB Design                    │
│        │              │            │                         │
│        └──────────────┴────────────┘                         │
│                       │                                      │
│                       ▼                                      │
│                  Design Doc + ADRs                           │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
                  ╔══════════════════════╗
                  ║  VALIDATION LOOP 2   ║   ← tech hypothesis validation
                  ║  (Tech hypothesis)   ║       Spike / POC
                  ║                      ║       Perf benchmark
                  ╚══════════╤═══════════╝       Threat model / Chaos
                             │
                             ▼
                         BUILD
```

## 0.4 Why Separate the Two Tracks

**Product track artifacts deal with "people"; tech track artifacts deal with "systems."** Mixing both in one document blurs both. A solo developer in particular tends to immediately merge the two tracks in their head — without deliberately writing them separately, they end up coding without knowing *why* a feature is needed.

Separation principles:

| Track | Primary artifacts | What is validated | On failure |
|---|---|---|---|
| Product | Persona, JTBD, UJM, SRS, MVP scope | **Value/necessity** — is this the real problem, does this solution address it | Pivot (different problem / solution / customer) |
| Tech | Design Doc, ADR, architecture diagrams, data model | **Feasibility/performance/risk** — can it be built technically, can it be operated | Stack change / architecture simplification / scope reduction |

## 0.5 Why Validation Loops Are Gates

Skipping a loop and moving to the next track causes common failures:

- **Moving to tech without product validation**: Built a sophisticated architecture, but the problem itself was mis-defined. Sunk cost keeps you solving the wrong problem.
- **Moving to build without tech validation**: The MVP collapses at demo stage due to performance/scale/integration issues. Demo looked fine but the product is unusable.

Each loop is the step for confirming **"is this a real problem / does this actually work"** in the **cheapest possible way** — not a step for producing more artifacts. Five interviews, one fake-door page, one core-path POC is often enough.

## 0.6 Artifact Checklist (at a glance)

**Product Track**
- [ ] Initial Persona (1–3)
- [ ] Service Concept one-liner (Lean Canvas or Value Proposition Canvas)
- [ ] Raw requirements (interview notes, surveys, analytics data)
- [ ] SRS / RFP (FR + NFR separated)
- [ ] User Journey Map (as-is + to-be)
- [ ] MVP Scope (RICE or MoSCoW priority + first release slice)
- [ ] **Validation Gate 1**: hypothesis definition + validation results

**Tech Track**
- [ ] Design Doc (1 document — core decisions bundle)
- [ ] ADR series (one per decision)
- [ ] Architecture diagrams (C4 Context + Container minimum)
- [ ] Tech stack decision matrix
- [ ] Data model (Conceptual ER → Logical → Physical)
- [ ] NFR spec (performance/availability/security/observability numbers)
- [ ] **Validation Gate 2**: core-path Spike/POC results + risk assessment

## 0.7 The Problem This Harness Solves

A tool for a solo developer to force themselves to not skip the planning phase. The better someone is at coding, the faster they want to jump to code. This harness deliberately slows that acceleration — but the design must ensure that one full cycle finishes *in days, not weeks*. Otherwise it gets avoided.
