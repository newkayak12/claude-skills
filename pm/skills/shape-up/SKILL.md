---
name: shape-up
description: >-
  Use when a team is stuck in an infinite backlog, cannot ship complete features, or needs a planning process with real tradeoffs and hard commitments. Also use when setting up 6-week cycles, writing pitches, running a betting table, or replacing sprint estimates with appetite-based scoping.
  Triggers on: "shape up", "6-week cycle", "appetite vs estimate", "pitch writing", "betting table", "scope hammering", "hill chart", "백로그 없애기", "6주 사이클", "피치 작성", "베팅 테이블".
  Best for: teams replacing Scrum/sprints, PMs writing shaped pitches, leaders setting up betting table decisions.
  Not for: single-story estimation, daily standups, bug triage prioritization, or OKR goal-setting.
license: MIT
metadata:
  author: wondelai
  version: "1.0.0"
compatibility:
  recommended: []
  optional:
    - think-tool
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 피치 작성 시 토끼굴(rabbit hole)과 no-go 판단의 품질이 높아집니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Shape Up Framework

## When to Use / When Not to Use

**Use when:**
- Team is drowning in a growing backlog and cannot ship complete work
- You need to replace sprint-based planning with a fixed-time, variable-scope model
- Writing or reviewing a shaped pitch before a betting table
- Evaluating whether a team is actually practicing Shape Up or just renaming sprints

**Not for:**
- Individual story estimation or ticket grooming
- Bug triage and hotfix prioritization
- OKR goal-setting or roadmap planning at the portfolio level

## Process

1. **Set appetite** — leadership decides how much time the problem is worth (2 weeks or 6 weeks), before scoping begins
2. **Shape the work** — senior PM/design produces a pitch: problem + rough solution + rabbit holes + explicit no-gos
3. **Betting table** — leadership reviews shaped pitches and places bets; unselected pitches are dropped (no backlog)
4. **Build** — small autonomous team owns the cycle; creates its own task breakdown; tracks via hill charts
5. **Cool-down** — 2-week period between cycles; bug fixes, tech debt, pitch writing for the next cycle

## Output Template

```
Pitch: [Name]
Appetite: [Small batch 1-2 weeks / Big batch 6 weeks]
Problem: [One paragraph — what user/business pain are we solving?]
Solution sketch: [Fat-marker description — what the product does, not how it's built]
Rabbit holes: [Named traps — things that would suck the team in for weeks; declare them off-limits]
No-gos: [Explicit exclusions — what is OUT of this pitch]
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Generates pitch structure from a described problem | Validates solution sketch with engineering before betting |
| Identifies likely rabbit holes from described scope | Runs the betting table with leadership authority |
| Scores team's Shape Up practice (0-10) with gap analysis | Enforces cycle end — no extensions |
| Explains framework concepts (appetite, hill charts, etc.) | Decides which pitches get funded |
| Produces diagnostic questions for your team | Protects cool-down from overflow work |

## Related Skills

- `../technical-feasibility-assessment/SKILL.md` — reality-check appetite before the betting table
- `../prd-development/SKILL.md` — pitch can feed into a lightweight PRD
- `../feature-prioritization/SKILL.md` — use before betting table to identify strongest candidates

## Core Principle

**Fixed time, variable scope — and appetite, not estimates.** Traditional planning asks "how long will this take?" and produces fictional estimates that are always wrong. Shape Up asks "how much time are we willing to invest in this?" and produces a real constraint that forces good decisions. If a feature isn't worth six weeks of time, it isn't worth building as imagined.

**The foundation:** Shape Up has three phases that repeat every cycle. Shaping: senior people define the work at the right level of detail — enough to unblock the team, not so much that it removes creative latitude. Betting: leadership chooses which shaped pitches to fund for the next cycle. Building: small teams execute with full autonomy for six weeks, then the cycle ends regardless of completeness.

## Scoring

**Goal: 10/10.** When evaluating a team's Shape Up practice, rate 0-10. A 10/10 means the team consistently ships in six-week cycles with properly shaped pitches, a real betting table, and healthy cool-down periods. Always provide the current score and specific improvements needed.

- **9-10:** Shaped pitches with appetite and rabbit-holes named; real betting table; teams scope-hammer independently; hill charts used
- **7-8:** Six-week cycles exist but shaping is thin; betting table is rubber-stamp; teams still ask for extensions
- **5-6:** Cycles present but backlog thinking persists; pitches are feature specs not problem+solution shapes
- **3-4:** Sprints renamed to cycles; estimates still used; scope never hammered; PM still controls decisions mid-cycle
- **1-2:** No fixed cycles; continuous flow; backlog drives prioritization; "we'll finish when we're done" culture

## The Shape Up Framework

### 1. Appetite

**Core concept:** Appetite is how much time the company is willing to spend on something, set before shaping begins. It is not an estimate of how long the work will take. It is a business decision about value. A "small batch" appetite is 1-2 weeks; a "big batch" appetite is up to six weeks.

**Why it works:** Estimates are predictions that teams struggle to make accurately and that become anchors even when wrong. Appetite is a constraint that forces honest scoping: "What can we build that solves the problem within this time box?" If the answer is "nothing good," the project doesn't happen — and that's the correct outcome.

**Key insights:**
- Appetite is set by leadership before shaping, not after
- A pitch that exceeds appetite is not funded — it is reshaped or dropped
- Small appetite (1-2 weeks) suits well-understood problems; big appetite (6 weeks) suits novel territory
- Appetite prevents scope creep: "That's a good idea, but it's outside our appetite — should we revisit in a future cycle?"
- "How long will this take?" is the wrong question; "What's this problem worth to us?" is the right one

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Pitch definition | Set appetite first | "We're willing to spend two weeks on improved search. What can we build in that time?" |
| Scope decision | Use appetite as filter | "Adding autocomplete would take 3 more weeks — that exceeds our appetite, so it's out" |
| Leadership conversation | Frame as business decision | "Is this problem worth 6 weeks? If yes, let's shape it. If not, let's not." |
| Mid-cycle expansion | Hard no to scope creep | "That's a great idea — put it in the pool for next cycle. We're not expanding this one." |
| Team sizing | Match to appetite | Small batch (1-2 weeks) = 1 designer + 1 engineer; big batch (6 weeks) = 1 designer + 2 engineers |

### 2. Shaping

**Core concept:** Shaping is the work done by senior product and design people before a project is pitched for betting. The output is a pitch: a rough, fat-marker sketch of the solution that defines the problem, the approach, the rabbit holes to avoid, and the explicit boundaries of what's not included. Shaped work is "rough but resolved."

**Why it works:** Unformed projects ("we should improve onboarding") give teams no direction and produce wasted time. Over-specified projects (wireframe-level specs) remove creative latitude and prevent teams from finding better solutions. Shaped work provides just enough definition to de-risk the project without prescribing the implementation.

**Key insights:**
- Fat-marker sketches are intentionally rough — they communicate structure, not pixels
- A pitch has five parts: problem, appetite, solution sketch, rabbit holes, no-gos
- Rabbit holes are places where the solution could suck you in for weeks — name them and decide not to go there
- No-gos are explicit decisions about what's out of scope — as important as what's in scope
- Shaping happens in cool-down, not during active cycles — shapers are not builders
- "Resolved" means the key risks and design decisions are made — teams won't hit a wall they can't solve

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Pitch writing | Five-part structure | Problem: "Users can't find past invoices." Appetite: 2 weeks. Solution: filterable invoice history. Rabbit holes: don't rebuild the filter component. No-gos: export to CSV is out. |
| Fat-marker sketching | Rough wireframe, not pixel design | Box labeled "invoice list with filters" — not a full Figma mockup |
| Rabbit hole identification | Name the traps | "If we try to support custom date ranges, we'll spend a week on edge cases — use preset ranges only" |
| No-go definition | Explicit scope exclusions | "Mobile support is not in this pitch — web only" |
| Shaping review | Stress-test the pitch | "What's the hardest technical part? Have we talked to an engineer about whether the approach works?" |

### 3. The Betting Table

**Core concept:** The betting table is a short meeting (usually two hours) at the end of cool-down where leadership places bets on which pitches to fund for the next cycle. There is no backlog — unselected pitches either return for future consideration or are dropped. Every cycle starts clean.

**Why it works:** Backlogs are graveyards for good ideas and anchors for bad ones. They grow without limit and create the illusion that every idea will eventually be built. The betting table forces honest prioritization: what is important enough to fund right now? Everything else waits or disappears, which is healthy.

**Key insights:**
- The betting table has real authority — what's decided there is what gets built, no changes mid-cycle
- No backlog means no zombie projects — if an idea is worth it, it gets re-pitched; if not, it's gone
- Pitches are presented by the shaper; the table asks questions and places bets
- "Not this cycle" is a complete answer — not a deferral with a promise
- Leadership must be willing to kill ideas they personally like if they don't beat competing bets
- The betting table is not a review meeting — decisions are made, not deferred

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Cycle kick-off | Betting table outputs cycle plan | "This cycle: Team A gets the invoice history pitch (2 weeks) + notifications pitch (4 weeks)" |
| Pitch selection | Compare pitches, not ROI scores | "Between improved search and invoice history, which serves our strategy better right now?" |
| No-backlog discipline | Drop unselected pitches | "The API redesign pitch wasn't selected — if we want it next cycle, it needs to be re-pitched" |
| Unexpected work | Protect the cycle | "A bug fix emerged — is it urgent enough to cancel a bet? If not, it goes to cool-down" |
| Leadership buy-in | Real authority, no second-guessing | "The table decided — no mid-cycle additions without canceling an existing bet" |

### 4. Building (Autonomous Teams)

**Core concept:** Once a bet is placed, the team owns the problem with full autonomy for the cycle. They do their own design, their own scoping, their own task breakdown. Managers don't assign tasks. PMs don't review wireframes mid-cycle. The team reports via hill charts, not status meetings.

**Why it works:** Autonomy activates the team's full intelligence. When teams receive pre-solved problems (specs, wireframes, task lists), they become executors instead of problem-solvers, and the senior people's proximity to the problem is wasted. When teams own the problem, they find better solutions than any pre-shaping could have produced.

**Key insights:**
- Teams break down the shaped work themselves — no task list from management
- Hill charts replace burndown charts: left side = figuring it out; right side = executing; peak = fully known
- Tasks move uphill (increasing understanding) before they move downhill (execution)
- Teams use scope hammering to cut work that's nice-to-have but not core to the shaped outcome
- "Circuit breaker": if the project isn't shippable by cycle end, the work doesn't ship — no extensions
- When something unexpected surfaces, teams decide: is it a rabbit hole to avoid, or core to the outcome?

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Task breakdown | Team-driven, not PM-assigned | Monday: team reads pitch → divides work → creates their own task list |
| Progress reporting | Hill charts, not status meetings | "Filters: 80% uphill (still figuring out edge cases). Invoice list: 40% downhill (executing)." |
| Scope discovery | Hammer scope, not time | "Adding sort-by-amount doubles the work — the pitch didn't require it, so we cut it" |
| Unexpected complexity | Circuit breaker decision | "This feature won't be ready in 6 weeks — do we ship what's done or cancel? The bet doesn't extend." |
| Mid-cycle questions | Team decides | "Design question came up — team makes the call, doesn't wait for PM approval" |

### 5. Cool-Down

**Core concept:** Cool-down is the 2-week period between six-week cycles. It has no assigned projects. Teams use it to fix bugs, explore ideas, do technical maintenance, write pitches, and recover. The betting table happens during cool-down to prepare the next cycle.

**Why it works:** Continuous sprints with no breathing room produce burnout and technical debt. Cool-down is structured recovery and preparation time. It also serves as the shaping window — senior people shape the next cycle's pitches without competing with ongoing build work.

**Key insights:**
- Cool-down is real time off from assigned work — not overflow from the last cycle
- Bug fixes happen in cool-down unless the bug is severe enough to interrupt a cycle
- Engineers use cool-down to address technical debt they've been carrying
- Pitches for the next cycle are written and reviewed during cool-down
- The betting table happens at the end of cool-down, just before the next cycle starts
- Cool-down length (2 weeks) is fixed — it doesn't shrink to fit delayed work

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Cool-down activities | No assigned projects | "Team A: free to fix bugs, explore tech debt, write pitches — no new deliverables" |
| Pitch preparation | Shape next cycle's work | "Design lead uses cool-down to shape the new onboarding pitch for the betting table" |
| Bug triage | Cool-down is the fix window | "User-reported bugs from last cycle get fixed now, not during build cycles" |
| Betting table timing | End of cool-down | "Betting table happens Friday of cool-down week 2 — cycle starts Monday" |
| Technical maintenance | Scheduled, not stolen | "Engineers dedicate cool-down to upgrading the test framework — no guilt, no pressure" |

## Common Mistakes

| Mistake | Why It Fails | Fix |
|---------|-------------|-----|
| Using estimates instead of appetite | Estimates become commitments; appetite is a business decision | Set appetite first: "What's this worth to us?" not "How long will this take?" |
| Maintaining a backlog | Backlogs grow forever; every item carries hidden weight | Drop unselected pitches; if important, re-pitch next cycle |
| Over-specifying pitches | Removes team creative latitude; wastes shaping time on details | Fat-marker only: problem + rough solution + rabbit holes + no-gos |
| Extending cycles | Normalizes the pattern; the circuit breaker loses meaning | Hard stop at cycle end; ship what's ready or cancel the bet |
| Managers assigning tasks mid-cycle | Defeats team autonomy; signals distrust | Teams own their task breakdown; managers see hill charts, not task lists |
| Skipping cool-down | Burnout accumulates; no time to shape next cycle | Protect cool-down as non-negotiable; it's part of the rhythm, not optional |
| Treating Shape Up as sprint planning | Sprints are output-focused; Shape Up is outcome-focused | The cycle is defined by a bet on a problem, not a list of user stories |

## Quick Diagnostic

| Question | If No | Action |
|----------|-------|--------|
| Is appetite set before shaping begins? | Teams estimate after scoping, not before | Leadership sets appetite first: "Is this a 2-week or 6-week problem?" |
| Do pitches include explicit rabbit holes and no-gos? | Teams fall into unplanned complexity | Add rabbit hole and no-go sections to every pitch before betting |
| Is there a real betting table with authority? | PMs maintain a backlog and sequence it | Replace backlog with betting table; unselected pitches are dropped |
| Do teams own their task breakdown? | PM or manager assigns tasks | Teams read the pitch and create their own breakdown on day one |
| Are cycles ending without extensions? | Circuit breaker is theoretical, not practiced | Hard stop at cycle end; ship what's ready; re-pitch unfinished work |
| Is cool-down protected from overflow work? | Cool-down is used to finish last cycle's work | Enforce cool-down as free time; shape-only activities |
| Are hill charts used instead of burndown? | Team has no visibility into "figuring it out" vs "executing" | Introduce hill charts for each scope in the cycle |

## Further Reading

- [*"Shape Up: Stop Running in Circles and Ship Work That Matters"*](https://basecamp.com/shapeup) by Ryan Singer — free to read online at basecamp.com/shapeup
- [*"It Doesn't Have to Be Crazy at Work"*](https://www.amazon.com/Doesnt-Have-Be-Crazy-Work/dp/0062874780) by Jason Fried & David Heinemeier Hansson — the philosophy behind Shape Up

## About the Author

**Ryan Singer** led product strategy at Basecamp for over 15 years and developed Shape Up as the internal method Basecamp used to build and ship products including Basecamp itself, HEY (email), and other tools. Shape Up was published online for free in 2019 after being practiced internally for over a decade. Singer developed the methodology in response to the specific failures of Scrum and Agile sprints as practiced in most organizations: estimation theater, infinite backlogs, and the loss of creative problem-solving in favor of task execution. Basecamp (now 37signals) continues to use Shape Up and has become a case study in calm, sustainable, high-quality product development.
