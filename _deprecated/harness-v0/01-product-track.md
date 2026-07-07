# 01. Product Track

Purpose: **Confirm in writing "why / for whom / what to build."** If you can't write it down before coding, it isn't clear in your head either.

## 1.1 Persona Definition

### What

Create a *concrete individual* representing the target customer. Not an abstract "20-something office worker" but a specific person: "**Kim OO, 27, 4-year backend developer, 2–3 hours on side projects every Saturday.**"

### Common Mistakes

- **Persona is too broad**: "developers." Too abstract to make any decision from.
- **Persona is demographics only**: age/gender/job with no *behavior, motivation, or context*.
- **Persona is yourself**: The trap solo developers fall into most often. "I'll use it myself" is not validation.

### Stronger Alternative: Jobs-to-be-Done (JTBD)

If Persona answers *who*, JTBD answers *what job that person hires our product to finish*. Clay Christensen's framing:

> "People don't buy products. **They hire products to make progress in their lives.**"

JTBD sentence template:

> When **[situation]**, I want to **[motivation]**, so I can **[expected outcome]**.

Example: *When I'm reviewing a long PR at the end of the day, I want to surface only the structural changes first, so I can decide whether to block or skim the rest.*

Why JTBD is better: **More stable under change than Persona.** A person's age changes; the job they want done (progress) stays stable.

### Artifact Format

- Persona cards × 1–3 (name, photo/emoji, one-line definition, weekly routine, 3 frustration points, tools/alternatives, 1–2 JTBD sentences)
- JTBD sentences × 5–10 (prioritized)

## 1.2 Service Concept Definition

### What

If you cannot write in **one sentence** "we provide [what] to [whom] via [how]," the concept is not settled.

### Tools

**Value Proposition Canvas** (Strategyzer)
- Left side (Customer Profile): Jobs / Pains / Gains
- Right side (Value Map): Products & Services / Pain Relievers / Gain Creators
- Both sides must *interlock* for the value proposition to hold.

**Lean Canvas** (Ash Maurya — startup variant of Business Model Canvas)
- 9 boxes: Problem / Customer Segments / UVP / Solution / Channels / Revenue / Cost / Key Metrics / Unfair Advantage
- Most useful boxes for a solo developer: **Problem**, **UVP**, **Key Metrics**.

### Unique Value Proposition Check

After writing the UVP one-liner, ask yourself:
1. Does this sentence still make sense if you swap your product name for a competitor's? → If so, it's not *unique*.
2. Does this sentence directly address someone's *deal-breaker* pain? → If not, it's a "nice to have."

## 1.3 Requirements Gathering

### Channels

| Channel | What you get | Limitation |
|---|---|---|
| 1:1 interviews (5–7 people) | Motivation, context, language | Risk of over-generalization |
| Survey | Frequency, ratios | Weak at capturing motivation |
| Observation (watching users work) | Unconscious behavior, workarounds | Time-consuming |
| Analytics data (if available) | Actual behavior | Missing the "why" |
| Competitive / alternative analysis | Gaps, differentiators | Risk of copying |

### Interview Question Patterns

**Bad question**: "Would you use this feature if it existed?" → Future-assumption questions get "yes" from almost everyone. Useless.

**Good questions**:
- "When was the last time you did X? Walk me through exactly what you did." (past behavior)
- "Was there ever a time that didn't work out? How did you get around it?" (workaround → signal of a real pain point)
- "What was happening right before you started doing that today?" (trigger identification)

→ **The Mom Test** (Rob Fitzpatrick) principle: ask about **past behavior**, not future opinions.

### Artifacts

- Interview notes (raw)
- Affinity diagram or coding results (insight n=X format)
- List of "heard hypotheses" (candidates to pass to the validation gate)

## 1.4 SRS / RFP — Requirements Definition

### Term Clarification

- **RFP** (Request for Proposal): Document the client sends to an outsourcer. "Please build this."
- **SRS** (Software Requirements Specification): Specifies *what the system must do*. Standard: IEEE 830 or its successor ISO/IEC/IEEE 29148:2018.

For a solo developer, RFP is usually unnecessary. Write SRS only.

### SRS Structure (lean version)

1. **Introduction** — purpose, scope, definitions/abbreviations, references
2. **Overall description** — product context, personas, assumptions/constraints
3. **Functional requirements (FR)** — behaviors the system must perform. Usually expressed as use cases or user stories.
4. **Non-functional requirements (NFR)** — quality attributes describing *how* the system must behave.
5. **External interfaces** — external systems, APIs, UI outlines.
6. **Data requirements** — core entities, retention periods, consistency requirements.

→ Slim template: [`templates/srs.md`](./templates/srs.md)

### NFRs Are the Most Often Missing

FRs get written naturally, but leaving NFRs unspecified means "why is this slow?" becomes a problem of *unresolved standards*, not a bug.

**7 NFR categories (FURPS+)**:
- **Functionality** (security, interoperability beyond core function)
- **Usability** (learning time, accessibility)
- **Reliability** (availability %, MTBF, fault tolerance)
- **Performance** (response time, throughput, resources)
- **Supportability** (testability, maintainability, i18n, installation)
- "+": Implementation / Interface / Operations / Packaging / Legal

ISO/IEC 25010 is more precise, but FURPS+ works for a first pass. → Details at [`04-unknowns.md`](./04-unknowns.md#nfr-taxonomy).

### FR Writing Unit

**User Story** format:
> As a [persona], I want [capability], so that [outcome].

**Acceptance Criteria** — Gherkin:
> Given [precondition], When [action], Then [observable outcome].

A story without clear acceptance criteria is *incomplete* — there's no way to judge whether it's done.

## 1.5 User Journey Map (UJM)

### What

A diagram that lays out the steps a persona takes from *starting trigger* to *goal achieved* on a time axis, marking **actions, touchpoints, thoughts, emotions, and pain points** at each step.

### Distinctions from Similar Tools

| Tool | Perspective | View | Scope |
|---|---|---|---|
| User Journey Map | User-centered | External (what the user sees) | One person's journey |
| Service Blueprint | Service-provider-centered | External + Internal (back-office/systems) | front-stage + back-stage |
| Experience Map | User-centered (product-agnostic) | External | Broader, includes life *before* the product |

→ At MVP stage, **one UJM** is sufficient. Consider expanding to a Service Blueprint after entering operations.

### How to Create

1. **Define phases**: Awareness → Consideration → Onboarding → Usage → Renewal/Churn
2. **Actions per phase**: what the user *actually* does
3. **Touchpoints**: screens, emails, calls, physical objects the user encounters
4. **Thoughts and emotions**: direct quotes or ↑↓ indicators
5. **Pain points**: *at least one* per phase. If a phase has none, be suspicious — is it truly painless, or did you miss something?
6. **Opportunities**: where we can intervene at each pain point

### Artifacts

- As-is UJM — how the user currently gets things done with workaround tools
- To-be UJM — how the user experience looks with our product
- The *difference* between the two maps is exactly what we need to build.

## 1.6 MVP Scope Definition

### Original Meaning of MVP

Eric Ries's definition: **"The version of a product that enables a full turn of the Build–Measure–Learn loop with minimum effort."**

→ *Viable* in "minimum viable" means "the customer can perceive value," not "barely any features." Even with few features, an MVP must *clearly deliver some value*.

### Two Common Traps

- **Confusing MVP with MMP (Minimum Marketable Product)**: MMP is the minimum *sellable* product. MVP is the minimum *learnable* product. They are different. MVP is smaller than MMP.
- **"Thin everything" vs "thick some"**: Spotify's bicycle–scooter–car analogy. Choose the simplest form that delivers *the full value in one go* — giving users car parts separately leaves them unable to drive.

### Scope Decision Tools

**MoSCoW**: Must / Should / Could / Won't (this release). Fastest method.

**RICE score**: Reach × Impact × Confidence ÷ Effort. Use when you need quantitative comparison.

**Story Mapping** (Jeff Patton):
- Horizontal axis: user journey (backbone activities)
- Vertical axis: priority (within each activity)
- *Horizontal slice* = release slice. Lay out R1 (MVP), R2, R3 in order.

→ **Story Mapping fits a solo developer best.** It connects naturally to UJM and forces the bicycle-to-car progression.

### MVP Exit Criterion

Exit is defined by **"what learning is complete"**, not "how many features are done." The result of Validation Loop 1 determines: enter the next cycle or pivot.

## 1.7 Track Artifact Checklist

- [ ] Persona cards × 1–3 (with JTBD sentences)
- [ ] Service Concept one-liner + Value Proposition Canvas or Lean Canvas
- [ ] Interview notes (5–7 people)
- [ ] SRS — FR (user stories + AC) + NFR (FURPS+ 7-category check)
- [ ] User Journey Map (as-is + to-be)
- [ ] MVP scope — first slice of Story Map or MoSCoW Must bundle
- [ ] *Hypothesis list* to pass to Validation Gate 1 (3–5 items)
