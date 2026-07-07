# 09. Pre-cycle — Gate for deciding *whether* to start a cycle

Where [`07-looping-mechanics.md`](./07-looping-mechanics.md) covers the loop rules *inside* a cycle, this document checks whether a cycle *deserves to start*. **A cycle started wrong cannot be finished right**.

## 9.1 Why a Pre-cycle gate is needed

The most expensive failure is a *well-executed wrong cycle*.

- Starting a cycle locks weeks to months of time + opportunity cost
- A solo developer's concurrent cycle limit = 1 ([`SD-03`](./situational-rules/self-discipline.md#sd-03-wip--1-work-in-progress-한도))
- Once started, *completion pressure* and *sunk cost* kick in ([`C-06`](./situational-rules/cognitive.md#c-06-sunk-cost--과거-투입은-결정에-영향-주지-않는다))

→ *Which cycle to start* is a more important decision than *how to execute a cycle*.

## 9.1b Cycle type — gates adapt to type

> *(Added in Cycle #001 dogfood F2)* The harness was originally designed with **product cycles** (products with external users) in mind. But not every cycle is a product. Declaring the type upfront prevents the gate checks from being applied awkwardly.

| Type | Definition | Primary user | Gate adaptation |
|---|---|---|---|
| **product** | A product/feature for external users | External n users | Apply §9.2 fully as-is. 5 interviews · Gate 1 product-hypothesis validity |
| **dev-tool** | A tool, automation, or infrastructure for yourself (or the team) | n=1–few self-users | D's "5 interviews" → replaced with *self-dogfooding*. Gate 1 "product hypothesis" → replaced with *"tool-utility hypothesis"* |
| **exploration** | Learning/validation is the goal; the deliverable is *knowledge* | Yourself | A's "problem statement" → *learning question*. Kill criteria tied strongly to *time* (spikes tend to drag) |

### Key differences by type

- **product** — *Falsifiability (D)* matters most. If you can't reach interview subjects, you're blocked at the first step.
- **dev-tool** — Watch for the *self-user trap*: being the primary user makes validation drift toward "I like it." Anchor falsification in *behavior* ("Do I actually *use* it after building it?").
- **exploration** — The goal is *learning*, not completion. Define DoD as "answered the question," not "code works." Set a short time kill.

### Declare type at the top of the Cycle Card

Specify the cycle type explicitly in the Cycle Card metadata. If not declared, **product** is assumed and §9.2 is applied strictly.

## 9.2 Pre-cycle gate checklist

### A. Idea — *problem first, solution second*

- [ ] **Is there a problem statement?** (In the form "users cannot do X" — not "I want to build Y")
- [ ] **Whose problem is it?** At least one concrete Persona hypothesis
- [ ] **How often / how painful?** A rough estimate of Frequency × Severity
- [ ] **What are the current alternatives?** How do users solve this *right now*?
- [ ] **Are you *overly* drawn to a solution?** Self-check against [`C-01`](./situational-rules/cognitive.md#c-01-bias-check-before-strong-commit)

→ Starting with "I want to build Y" leads to *retrofitting problems to fit the solution*. Solution-shopping anti-pattern.

### B. Strategic fit

- [ ] **Does this align with the *learnings* of the previous cycle?** If it's an unrelated new direction — *why* do this now?
- [ ] **Does it leverage your *current strengths*?** Or is it *intentionally* a new domain?
- [ ] **Does it *not conflict* with products currently in operation?** ([`SD-03`](./situational-rules/self-discipline.md#sd-03-wip--1-work-in-progress-한도))

### C. Cost and time outline

- [ ] **Is a time budget *set*?** (Macro loop budget — [`07-looping-mechanics.md §7.9`](./07-looping-mechanics.md#79-사이클-시작-시-loop-적용-체크리스트))
- [ ] **Is a money budget *set*?** (Infrastructure + tools + external interviews, etc.)
- [ ] **Is completion *feasible* with current capacity?** (Check overlap with other responsibilities)
- [ ] **Are kill criteria pre-defined?** ([`07 §7.5`](./07-looping-mechanics.md#75-loop-종료-kill-criteria--사이클을-죽이는-기준))

### D. Falsifiability

- [ ] **Is passing Gate 1 *feasible*?** ([`08 §8.2`](./08-pass-criteria.md#82-gate-1--제품-가설-검증-기준))
- [ ] **Can you *access* 5 people to interview?** (Otherwise the cycle stalls at the first step)
- [ ] **Are hypotheses in *falsifiable* form?** (A non-falsifiable hypothesis cannot be validated)

### E. Self-check

- [ ] **What is the *real motivation* for this cycle?** (Technical curiosity? Escape? External pressure? Market opportunity?)
- [ ] **What is the *regret scenario* six months from now?** (Mini [`C-02`](./situational-rules/cognitive.md#c-02-pre-mortem-before-big-bet) pre-mortem)
- [ ] **What gets *worse* if you *don't* do this cycle?** (A weak answer = weak grounds for starting)

## 9.3 Pre-cycle decision matrix

Apply checklist results to the following matrix.

| Item group | Pass rate | Decision |
|---|---|---|
| A Idea + D Falsifiability | All yes | Can proceed |
| C Cost / time | One or more no | **STOP** — insufficient budget |
| B Strategic fit | All no | Reconsider — *why* do this now? |
| E Self-check — real motivation is *escape* / external pressure | yes | **STOP** — find another solution |

## 9.4 Pre-cycle outputs

On gate pass, produce the *following outputs* and start the cycle.

### 1. Cycle Card (one-page summary)
- Cycle title / start date / time budget
- Core hypotheses (3 or fewer)
- Persona hypothesis
- Success criteria (Gate 1 · 2 numbers — [`08-pass-criteria.md`](./08-pass-criteria.md))
- Kill criteria (Hard + Soft — [`07 §7.5`](./07-looping-mechanics.md#75-loop-종료-kill-criteria--사이클을-죽이는-기준))
- Handover of *preserve / question / discard* from the previous cycle ([`07 §7.4`](./07-looping-mechanics.md#74-inter-loop-carryover--무엇이-살고-무엇이-버려지나))

### 2. Pre-mortem (one page)
- "Six months from now this cycle *failed* — why?" 5 answers
- Pre-mitigation plan for the 1–2 most likely answers

### 3. Pivot Triggers pre-defined
- What *signals* during the cycle should trigger pivot consideration?
- Mapping of possible pivot types per signal ([`07 §7.6`](./07-looping-mechanics.md#76-pivot-트리거--pivot-타입-매핑))

## 9.5 Pre-cycle anti-patterns

Common traps — on detection, *hold the start*.

### Solution-shopping
- Symptom: Starting with "I want to build something with Next.js…"
- Risk: The problem gets *distorted to fit the technology*
- Response: Restart with a problem statement — does Next.js actually fit that problem?

### Idea-flow excess
- Symptom: Starting a new cycle with a new idea every 3 weeks
- Risk: No cycle ever reaches *completion*
- Response: Enforce WIP=1 ([`SD-03`](./situational-rules/self-discipline.md#sd-03-wip--1-work-in-progress-한도)). New ideas go to the *queue*.

### Validation bypass
- Symptom: "I don't need to validate this, I already know"
- Risk: Inside-view overconfidence ([`C-11`](./situational-rules/cognitive.md#c-11-outside-view--비슷한-시도들의-base-rate))
- Response: Outside view — check the base rate of similar attempts

### Escape cycle
- Symptom: Fleeing to *another cycle* because the current one is hard
- Risk: The new cycle repeats the same pattern
- Response: *Explicitly close* the current cycle (including kill) before starting a new one

### Half-baked persona
- Symptom: Vague, like "users in their 20s–30s"
- Risk: No specific interview subjects to validate against
- Response: Narrow to a concrete Persona hypothesis — specific enough to name 5 *reachable* people

## 9.6 *Documenting* the Pre-cycle decision

Do not pass the pre-cycle gate *without a record*.

- **Go**: Save the Cycle Card → start the cycle
- **No-go**: One line of reasoning + where it goes in the queue (re-examine / discard / hand off)
- **Defer**: Specify the hold condition — *what signal* triggers a restart
- Revisit the *No-go / Defer* pile quarterly — the environment may have changed the decision

## 9.7 Pre-cycle skill call pattern

- `pm:pm-strategy-workflow` — big-picture strategy alignment
- `pm:hypothesis-driven-dev` — hypothesis pre-registration
- `think:decision-maker` — Go / No-go / Defer decision
- `cognition:bias-auditor` — E self-check
- `cognition:second-order-thinker` — "If this cycle *succeeds*, what comes next?"

## Related rules
- [`R-PG01`](./06-rules.md) — Process Gate entry
- [`SD-01`, `SD-03`, `SD-07`](./situational-rules/self-discipline.md) — Time-box / WIP / explicit close
- [`C-01`, `C-02`, `C-11`](./situational-rules/cognitive.md) — Bias / Pre-mortem / Outside view
- [`07 §7.5`](./07-looping-mechanics.md#75-loop-종료-kill-criteria--사이클을-죽이는-기준) — Kill criteria

## Related skills
- `pm:pm-strategy-workflow`
- `pm:hypothesis-driven-dev`
- `think:decision-maker`
- `cognition:bias-auditor`
- `cognition:second-order-thinker`
- `self:examined-life` — *real motivation* check
