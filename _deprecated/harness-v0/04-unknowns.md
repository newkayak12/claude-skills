# 04. Unknowns — Frameworks Developers May Not Know Well

Developers (especially solo) tend to have deep knowledge on the code/systems side, but the following areas are often encountered by name without real-world application. Each item is covered briefly, with pointers for where to dig deeper.

## 4.1 Continuous Discovery (Teresa Torres)

### Core Claim

Discovery is not something done only at *project start* — it continues as a *weekly rhythm*. Every product team member runs *at least one* customer interview per week.

### Opportunity Solution Tree (OST)

A tree for visualizing goals:

```
                  Outcome (north star metric)
                        │
        ┌───────────────┼───────────────┐
   Opportunity1   Opportunity2   Opportunity3   ← customer pain points / desires
        │              │               │
   ┌────┼────┐    ┌────┴────┐     ┌────┼────┐
  Sol1 Sol2 Sol3  Sol4    Sol5   Sol6 Sol7 Sol8  ← solution candidates (diversity is key)
        │
    Experiment   ← experiment to validate the solution
```

**Core principles**:
- Opportunities must be written in *customer language*. Don't write them as solutions.
- *Multiple solutions* per opportunity — if only one came to mind, you haven't diverged enough.
- Every solution must be *validated via experiment* before moving forward.

### Solo Developer Application

One interview per week may be too much, but **one per two weeks** is realistic. Drawing an OST makes *the assumptions you're working under* visible, so unvalidated assumptions are apparent at a glance.

## 4.2 Four Product Risks (Marty Cagan, *Inspired*)

Every product decision must reduce at least one of these 4 risks:

| Risk | Question | Who validates |
|---|---|---|
| **Value** | Will customers buy/use it? | PM / Product |
| **Usability** | Can they use it? | Design |
| **Feasibility** | Can we build it? | Engineering |
| **Viability** | Can our business sustain it? (legal, marketing, sales, finance) | Business |

→ A solo developer must validate all 4 themselves. *State explicitly which risk is greatest* at the start of each cycle.

## 4.3 NFR Taxonomy

### FURPS+ (HP, 1992)
- **F**unctionality (security, interoperability beyond core function)
- **U**sability (learnability, efficiency, aesthetics, consistency)
- **R**eliability (availability, MTBF, accuracy)
- **P**erformance (response time, throughput, resource usage)
- **S**upportability (testability, maintainability, scalability, i18n, installation, monitoring)
- **+**: Design / Implementation / Interface / Operations / Packaging / Legal constraints

### ISO/IEC 25010 (Product Quality Model)

8 characteristics:
1. Functional Suitability
2. Performance Efficiency
3. Compatibility
4. Usability
5. Reliability
6. Security
7. Maintainability
8. Portability

→ First pass with FURPS+ → use ISO 25010 if major gaps appear. In practice, **writing numbers is what matters** — not "fast" but "P95 response 200ms".

## 4.4 C4 Model (Simon Brown)

→ See [`02-tech-track.md`](./02-tech-track.md#21-architecture-design) for details.

Key point: **Context → Container → Component → Code** four zoom levels. *Don't draw all levels* — stop at the level you need.

## 4.5 arc42

→ The 12-section checklist is in [`02-tech-track.md`](./02-tech-track.md#arc42--architecture-documentation-template).

arc42 vs C4:
- **C4**: diagram notation
- **arc42**: architecture document *structure* (diagrams + text)
- They are complementary — embedding C4 diagrams inside arc42 is the standard combination.

## 4.6 ADR Format Variants

| Format | Characteristics |
|---|---|
| **Nygard** (original) | Status / Context / Decision / Consequences. Shortest. |
| **MADR** (Markdown ADR) | + Considered Options, Decision Drivers. Richer. |
| **Tyree & Akerman** | + Constraints, Assumptions, Implications, Notes. Full version. |

→ Start with **MADR** for balance. Too light loses the *why*; too heavy means it won't get written.

## 4.7 Traceability Matrix

A **traceability** matrix linking requirements ↔ design ↔ code ↔ tests. Standard: IEEE 830 / IREB CPRE.

| Req ID | Description | Design Section | Code Module | Test Case |
|---|---|---|---|---|
| FR-101 | Login SSO | DES-3.2 | auth/sso.kt | TC-201, TC-202 |

→ A lightweight version is sufficient for a solo developer. The key is finding **requirements with no tests** and **code with no requirements**.

## 4.8 Gherkin & Acceptance Criteria

Acceptance criteria notation from BDD (Behavior-Driven Development):

```gherkin
Feature: Login
  As a registered user
  I want to log in with email/password
  So that I can access my data

  Scenario: Login with valid credentials
    Given the user has completed registration
    When they enter the correct email and password
    Then they are redirected to the dashboard
    And a session token is issued

  Scenario: Wrong password
    Given the user has completed registration
    When they enter an incorrect password
    Then a "credentials do not match" message is shown
    And the account is locked for 5 minutes after 5 failures
```

→ A bridge between natural language and tests. Tools like Cucumber, SpecFlow turn this into *executable specifications*.

## 4.9 North Star Metric & AARRR

### North Star Metric

Express product *health* with a single metric. The reference point for every decision.

Conditions for a good NSM:
- **Reflects user value** (not just revenue)
- **Leading indicator** (not lagging)
- **The team can influence it**

Examples: Spotify uses *Time spent listening*, Airbnb uses *Nights booked*, Slack uses *Messages sent within team*.

### AARRR (Pirate Metrics, Dave McClure)

5 stages of a startup funnel:
- **A**cquisition — how did they find out?
- **A**ctivation — did they have a first value experience?
- **R**etention — do they come back?
- **R**eferral — do they recommend?
- **R**evenue — do they pay?

→ A solo developer doesn't need to track all of them. Pick one — *identify the weakest stage* and focus there.

## 4.10 Story Mapping (Jeff Patton)

→ See [`01-product-track.md`](./01-product-track.md#scope-decision-tools) for details.

Key points:
- **Backbone activities** (major steps of the user journey) on the horizontal axis
- *Detailed tasks* under each backbone activity, sorted vertically by priority
- *Horizontal slice* = release slice (R1=MVP, R2, R3)

Solves the problem of a flat backlog — which has priority but no *flow*.

## 4.11 Story Splitting Patterns

How to split large user stories into units that are *independently deployable*:

| Pattern | Example |
|---|---|
| **Workflow steps** | "checkout" → "show cart" / "enter address" / "payment" / "confirmation" |
| **Business rule variations** | "discount" → "coupon only" → "coupon + points" → "VIP tier" |
| **Happy / Unhappy path** | Happy path first, error handling in the next slice |
| **Data variations** | "payment method" → "card only" → "Kakao Pay" → "international card" |
| **Operations (CRUD)** | "Read only" → "Create" → "Update" → "Delete" |
| **Interface variations** | "desktop only" → "mobile web" → "app" |
| **Defer performance** | "just make it work" → "caching" → "optimization" |

(Simplified from Richard Lawrence's pattern catalog)

## 4.12 Lean Canvas vs Value Proposition Canvas

| | Lean Canvas | Value Proposition Canvas |
|---|---|---|
| Author | Ash Maurya | Strategyzer (Osterwalder) |
| Purpose | Full business model | Value proposition ↔ customer fit |
| Boxes | 9 | 2 canvases (3 sections each) |
| Best used | Early concept definition | Refining value proposition after Persona |

→ Use Lean Canvas to capture *everything* on one page, then draw a VPC if the area to narrow down is the *value proposition*.

## 4.13 Dual-Track Agile

A model that runs Discovery and Delivery *in parallel*:

```
Discovery: [interview] → [prototype] → [validate] → ...
Delivery:     [sprint N]    [sprint N+1]    [sprint N+2]    ...
                ↑              ↑              ↑
            validated backlog flows in
```

Core: *Only* validated results from the Discovery track flow into the Delivery track — unvalidated ideas do not enter.

Solo developer application: Allocate *fixed time* each week (e.g., Friday morning) to Discovery. The rest of the week is Delivery.

## 4.14 Wardley Mapping (for those who want to go deeper)

Simon Wardley's strategy map. Positions value chain components by *evolution stage* (genesis → custom → product → commodity).

- Visualizes what to *build* vs what to *buy*
- Shows the direction components evolve over time

→ Not an immediately necessary tool for a solo developer. Worth drawing once when building a *platform or SaaS* product.

## 4.15 RACI (Responsibility Model) — Applied to Yourself as a Solo

| Activity | Responsible | Accountable | Consulted | Informed |
|---|---|---|---|---|
| Persona definition | Self | Self | 5 interviewees | Beta users |
| Architecture decision | Self | Self | (mentor/reviewer) | Future self |

→ Even solo, being conscious that *"my future self must be Informed"* makes documentation feel natural.

## 4.16 Acceptance Criteria vs Definition of Done (DoD)

Easy to confuse:

- **Acceptance Criteria**: conditions for this *story* to be accepted — *varies per feature*
- **Definition of Done**: *universal completion criteria* applied to all work — e.g., "tests pass + code review + docs updated + staging deploy"

→ A solo developer writing a short, strong DoD creates an agreement with their future self.

## 4.17 ATAM — Architecture Tradeoff Analysis Method

SEI (Software Engineering Institute)'s architecture evaluation method. Core:

1. Business goals → Quality attributes (mapped to NFRs)
2. Assign *scenarios* to each quality attribute ("P95 200ms under 10K concurrent users")
3. Evaluate *trade-offs* of architecture decisions per scenario
4. **Sensitivity points**: decisions with strong impact on a quality attribute
5. **Trade-off points**: improving one attribute degrades another

→ The full version is overkill for a solo developer. Borrowing only the *scenario-based evaluation* principle is sufficient.

## 4.18 Summary — 5 Things to Learn First

No need to know everything. **Pick just 5 to apply in the next cycle**:

1. **JTBD** — Complements Persona. The *why they hire* perspective.
2. **Opportunity Solution Tree** — Forces solution diversity, makes assumptions visible.
3. **FURPS+** — Check NFRs across 7 categories. Prevents omissions.
4. **C4 Context + Container** — Two architecture diagrams.
5. **MADR** — Standardized ADR format.

Everything else: go deep *only when that specific cycle requires it*.
