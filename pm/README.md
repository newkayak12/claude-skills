# pm

**English** · [한국어](KOR.md)

Product management skills for the whole arc of a product decision — finding out what is actually
true about the market and the user, writing it down so engineering can act on it, choosing what
gets built, launching it, and explaining the result to the people who have to live with it. Each
skill is a working method with a named output artifact, not a checklist: a PRD, a RICE-scored
backlog, a GTM canvas, a pitch, a stakeholder map, a learning card.

Most skills declare what they are *not* for and hand off to a sibling skill instead, so the plugin
stays usable when a request lands in the wrong place.

## Install & Uninstall

```bash
/plugin install pm@newkayak12-claude-skills
/plugin uninstall pm@newkayak12-claude-skills
```

Several skills list `think-tool`, `sequential-thinking`, or `mcp-reasoner` as recommended MCP
servers — they run without them, but positioning logic, multi-step chains, and scoring hold up
better when the servers are connected (Claude settings → MCP Servers → add the remote SSE
endpoint).

## Which skill do I want?

**Run the whole process**

| I want to… | Skill |
|---|---|
| Go from market analysis to stakeholder sign-off, step by step | `pm-strategy-workflow` |

**Discovery & research**

| I want to… | Skill |
|---|---|
| Work out which discovery process fits my team at all | `product-discovery` |
| Build continuous discovery habits and validate the four product risks | `inspired-pm` |
| Turn interview notes and verbatims into insight cards with n= counts | `customer-research-synthesis` |
| Write a falsifiable hypothesis and design the smallest test for it | `hypothesis-driven-dev` |
| Map competitors and find the whitespace we can own | `competitive-analysis` |

**Definition & stories**

| I want to… | Skill |
|---|---|
| Write a full PRD engineering can act on | `prd-development` |
| Write one story with Given/When/Then acceptance criteria | `user-story` |
| Generate a story map with backbone, tasks, and release slices | `user-story-mapping` |
| Be walked through story mapping when scope is still fuzzy | `user-story-mapping-workshop` |
| Break an epic into independently shippable stories | `user-story-splitting` |
| Get a fast feasibility read before engineering is pulled in | `technical-feasibility-assessment` |

**Prioritisation & planning**

| I want to… | Skill |
|---|---|
| Rank a backlog defensibly and say what we are not building | `feature-prioritization` |
| Set quarterly goals whose key results are outcomes, not shipped features | `okr-planning` |
| Replace sprints with 6-week cycles, pitches, and a betting table | `shape-up` |

**Launch & growth**

| I want to… | Skill |
|---|---|
| Plan a launch: beachhead, message, channels, phased rollout | `go-to-market-planning` |
| Decide the pricing model, value metric, and tier packaging | `pricing-monetization-strategy` |
| Engineer word-of-mouth into a product or campaign | `contagious` |
| Find out why a number moved before reacting to it | `metrics-interpretation` |
| Close the loop after a launch and write down what we learned | `post-launch-retrospective` |

**Communication**

| I want to… | Skill |
|---|---|
| Explain the roadmap and the "why not this" to a specific audience | `roadmap-communication` |
| Get a specific blocking person to yes | `stakeholder-management` |

## Skills

### `pm-strategy-workflow`

The entry point for a full strategy cycle. It drives seven skills in a fixed order —
`competitive-analysis` → `prd-development` → `feature-prioritization` →
`pricing-monetization-strategy` → `go-to-market-planning` → `roadmap-communication` →
`stakeholder-management` — passing each step's output into the next (the positioning gap feeds the
PRD, the PRD's feature list feeds prioritisation, the prioritised backlog and pricing feed GTM).
Each step has a documented skip condition, and you can enter mid-process by naming the step. Not
for a single deliverable — call that skill directly.

```
신제품 전략을 처음부터 GTM까지 돌리고 싶어. 경쟁사 분석부터 시작하자.
Competitive landscape is 6 months stale, so don't skip Step 1.
```

| Step | Skill | Output |
|---|---|---|
| 1 | `competitive-analysis` | Competitor profiles, positioning gap, "only we" statement |
| 2 | `prd-development` | PRD with problem statement, stories, success metrics |
| 3 | `feature-prioritization` | RICE-scored backlog, MoSCoW split, cycle scope |
| 4 | `pricing-monetization-strategy` | Pricing model, tier structure, WTP validation plan |
| 5 | `go-to-market-planning` | GTM brief, launch sequence, messaging, channels |
| 6 | `roadmap-communication` | Audience-specific roadmap and narrative |
| 7 | `stakeholder-management` | Stakeholder map, influence strategy, comms plan |

---

**Discovery & research**

### `product-discovery`

A routing skill. Diagnoses your team's context with three questions — primary pain, current
practice, team maturity — and points you at continuous discovery (`inspired-pm`) or fixed cycles
(`shape-up`), or shows how to run both at different timescales: Shape Up for "what do we build in
the next six weeks", continuous discovery for "what should we be building at all". It also scores
the current practice 0–10. Not for writing individual hypotheses or running a specific workshop.

```
우리 팀이 스프린트 지옥에 빠져 있고 백로그는 계속 늘어나. Shape Up이 맞을까,
아니면 continuous discovery부터 잡아야 할까? 현재 상태 진단해줘.
```

### `inspired-pm`

Marty Cagan's empowered-team model: weekly continuous discovery instead of a discovery phase,
outcome ownership instead of feature delivery, and validation of all four product risks — value,
usability, feasibility, viability — before anything is committed to build. Use it to assess a
team's discovery practice, convert a feature roadmap into an outcome roadmap, or set up weekly
customer interviews. Not for writing individual stories or running sprint execution.

```
우리 팀이 완전히 feature factory야. 로드맵도 기능 목록이고.
현재 discovery 실천도를 점수 내고, outcome 로드맵으로 바꾸는 첫 단계를 알려줘.
```

### `customer-research-synthesis`

Runs the chain raw data → affinity clusters → Jobs-to-be-Done → insight cards → hypotheses. Every
cluster gets an n= count and a pattern-vs-anecdote verdict, so a single loud interviewee doesn't
become a roadmap item. It can also score an existing synthesis practice 0–10. Not for closed-ended
survey statistics (`metrics-interpretation`) or competitive research (`competitive-analysis`).

```
인터뷰 10건 노트를 붙여넣을게. 어피니티 클러스터를 n= 카운트와 함께 뽑고,
패턴인지 일화인지 판정해서 PRD에 넣을 인사이트 카드로 만들어줘.
```

Output per synthesis run: affinity clusters with counts, pattern/anecdote verdicts, top 3 JTBD,
insight cards (observation + evidence + implication), and recommended hypotheses.

### `hypothesis-driven-dev`

Turns an idea into a falsifiable claim and the smallest experiment that can kill it. Produces the
hypothesis in four-part form, a null hypothesis (the abandonment criteria), the riskiest assumption
to test first, and a matched experiment type — concierge, fake door, prototype, or A/B. Not for
post-launch metric analysis (`metrics-interpretation`) or deciding what to build
(`feature-prioritization`).

```
We're considering an AI summary feature for our support inbox. Write the hypothesis,
name the riskiest assumption, and design the smallest test we could run in two weeks.
```

```
We believe [doing X] for [customer Y] will result in [outcome Z].
We'll know we're right when [measurable signal].
We'll stop if [abandonment criteria].
Riskiest assumption: …   Suggested MVE: fake door / concierge / prototype / A/B
```

### `competitive-analysis`

Six steps from defining the competitive universe (direct, indirect, substitute, emerging) through
a feature matrix, a 2×2 positioning map, a SWOT-lite, to a differentiation strategy — ending in an
"Only [company] can [capability] for [user] because [reason]" statement and a named trade-off.
Feature parity is treated as table stakes, never as the goal. Not for internal tools with no
external competitors, and not a substitute for user research: it shows what competitors built, not
what users need.

```
경쟁사 분석 해줘. 우리는 중소 물류사 대상 WMS고, 주요 경쟁자 4곳 대비
포지셔닝 갭과 "우리만 할 수 있는 것" 문장까지 뽑아줘.
```

Artifacts: **Competitor Profiles** and a **Positioning Gap Summary** (feature matrix + positioning
map + SWOT-lite + differentiation recommendation).

---

**Definition & stories**

### `prd-development`

Eight phases — executive summary, problem statement, personas, strategic context, solution
overview, success metrics, user stories and requirements, out-of-scope and dependencies — with a
fill-in `template.md`, worked per-phase examples in `references/`, and a full sample PRD in
`examples/`. The problem and persona come before any requirement; success metrics come before the
solution list. Not for small bug fixes (overkill) or continuous discovery experiments (use
`hypothesis-driven-dev`).

```
디스커버리 스프린트 결과를 붙여넣을게. 엔지니어가 바로 착수할 수 있는 PRD로
정리해줘. 성공 지표와 out of scope는 특히 분명하게.
```

### `user-story`

Authors a single story in Mike Cohn form ("As a / I want to / so that") with Gherkin acceptance
criteria, validated against INVEST and a one-`When`-one-`Then` rule. Ships a `template.md` and a
deterministic stub generator, `scripts/user-story-template.py`, that writes no files and makes no
network calls. Not for splitting epics (`user-story-splitting`), mapping a whole workflow
(`user-story-mapping`), or pure technical debt.

```
PRD의 "결제 수단 저장" 요구사항을 Given/When/Then 인수 조건이 들어간
유저 스토리로 변환해줘.
```

```bash
python3 scripts/user-story-template.py --persona "trial user" \
  --action "log in with Google" --outcome "access the app without a new password"
```

### `user-story-mapping`

Generates the map when you already have persona, narrative, and workflow: segment and persona →
JTBD narrative → 3–5 backbone activities → steps → tasks → vertical prioritisation into MVP /
Release 2 / Future slices. The backbone must follow the user's workflow, never system or technical
layers. Not for discovering scope interactively — that is the workshop skill.

```
온보딩 플로우 스토리 맵 만들어줘. 페르소나와 워크플로는 아래에 정리해뒀고,
MVP / R2 / Future 슬라이스까지 갈라줘.
```

### `user-story-mapping-workshop`

The facilitated version: up to five adaptive questions, 3–4 enumerated options at each decision
point, discovering scope and personas with you rather than assuming them. Claude proposes the
backbone, tasks, and release slices (Walking Skeleton, R2, R3) and flags technical-layer thinking;
you make the judgment calls and validate feasibility. Not for generating a map from context you
already have, single-feature scoping, or refactoring work with no user workflow.

```
스토리 맵을 처음 만들어봐. 신규 모바일 앱인데 스코프가 아직 흐릿해.
질문 하나씩 던져주면서 같이 진행해줘.
```

### `user-story-splitting`

Applies eight splitting patterns in order — workflow steps, business rules, data variations,
acceptance-criteria complexity, and the rest — stopping at the first one that fits, and checks
that each resulting story is independently deployable and testable. Explicitly not horizontal
slicing (no "front-end story" / "back-end story") and not task decomposition. Not for stories that
are already small or for technical tasks.

```
이 에픽이 한 스프린트에 안 들어가. When 절이 3개야.
어떤 패턴으로 쪼개야 하는지 정하고 독립 배포 가능한 스토리로 분리해줘.
```

### `technical-feasibility-assessment`

A PM-level feasibility read before engineering time is committed. Scores five dimensions — data,
infrastructure, integrations, team skill, time — surfaces the single highest-risk assumption, and
gives a build/buy/partner recommendation with red flags that require engineering before any
commitment. Not engineering estimation, architecture design, or sprint planning.

```
로드맵 확정 전에 이 AI 추천 기능의 기술 타당성 빠르게 봐줘.
현재 스택으로 2스프린트 안에 가능한지, 어디가 제일 위험한지.
```

```
Feasibility Signal: [High / Medium / Low / Unknown]
- Data / Infrastructure / Integrations / Team Skill / Time: [Low|Medium|High risk] — rationale
Make vs. Buy: [Build / Buy / Partner] — reasoning
Red flags requiring engineering consultation: …
Recommended next step: …
```

---

**Prioritisation & planning**

### `feature-prioritization`

Three frameworks for three situations: RICE for scoring a large backlog quantitatively, MoSCoW for
drawing a hard in/out line on a release, and a Value-Risk-Effort grid for fast workshop
prioritisation. Includes forced-ranking techniques for the "everything is P1" failure mode. Scoring
criteria are agreed before anything is scored, and impact is estimated separately from effort. Not
for communicating the resulting roadmap (`roadmap-communication`) or setting goals
(`okr-planning`).

```
백로그 50개인데 P1이 절반이야. RICE로 점수 내고 이번 분기 스코프를 잘라줘.
안 하기로 한 것과 그 이유도 같이.
```

```
Priority | Feature            | RICE  | Rationale                          | Quarter
P1       | Guided onboarding  | 3,200 | Drives the activation KR directly  | Q2
P3       | Dark mode          | 420   | Community request, low KR impact   | Q3
Deferred | 3rd-party integr.  | —     | Vendor API not ready               | Q4
```

Every list also carries the criteria used, what is *not* being built and why, the OKR each item
serves, and a review date.

### `okr-planning`

Doerr's model end to end: qualitative objectives, measurable key results, the committed-vs-stretch
distinction, cascading company → team without pure top-down assignment, and CFRs (conversations,
feedback, recognition) — without which OKRs decay into a spreadsheet. The recurring correction is
outcome KRs over output KRs; "features shipped" is not a key result. Not for tactical backlog
ordering inside a cycle or sprint task tracking.

```
이번 분기 팀 OKR 초안이야. KR이 전부 "기능 출시" 형태인데 outcome으로 다시 써주고,
회사 목표와의 정렬도 확인해줘.
```

### `shape-up`

Basecamp's cycle model: appetite (a time budget set before scoping) instead of estimates, shaping
into a pitch, a betting table that replaces the backlog, autonomous teams that scope-hammer their
own work, hill charts, and a two-week cool-down. Use it to write pitches, run the betting table, or
move a team off sprints. Not for single-story estimation, standups, bug triage, or goal-setting.

```
Shape Up 피치 써줘. 문제는 대량 주문 취소 처리고 appetite는 6주.
rabbit hole과 no-go를 명시적으로 뽑아줘.
```

```
Pitch: [Name]
Appetite: [1-2 weeks / 6 weeks]
Problem: [one paragraph]
Solution sketch: [fat-marker — what it does, not how it's built]
Rabbit holes: [named traps, declared off-limits]
No-gos: [explicit exclusions]
```

---

**Launch & growth**

### `go-to-market-planning`

Five steps: pick the beachhead segment with a prioritisation grid (pain intensity × reach ease ×
strategic value), craft the core message, select channels, define a three-phase rollout (beta →
limited → full) with a success gate per phase, and set launch metrics that are kept separate from
product health metrics. Ships pre-launch and launch-day checklists. Not for minor releases that
need only a release note, and not for pre-PMF products where a broad launch is premature.

```
6주 뒤 출시야. 비치헤드 세그먼트부터 정하고, 메시지·채널·베타→제한→전체
롤아웃 단계와 각 단계 성공 기준까지 GTM 브리프로 만들어줘.
```

Artifacts: a **GTM Canvas** and a **Rollout Plan** (phase table with audience, goal, success gate).

### `pricing-monetization-strategy`

Six steps: understand the value exchange, select the pricing model, choose the value metric (the
thing you actually charge for), design the tier packaging, then validate willingness to pay via Van
Westendorp, conjoint, competitor benchmarking, or sales/CS interviews. Ends with common pricing
anti-patterns. Not for services engagements or contractually locked pricing — and it gives the
framework, not the WTP data; you still have to talk to customers.

```
seat 기반에서 usage 기반으로 옮기는 게 맞는지 판단해줘. B2B SaaS고,
가치 지표 후보와 3단계 요금제 구조, WTP 검증 계획까지.
```

Artifacts: a **Pricing Model Recommendation** and a **Packaging Structure** (tier-by-tier).

### `contagious`

Berger's STEPPS framework — Social Currency, Triggers, Emotion, Public, Practical Value, Stories —
applied to a product, feature, or campaign, scored 0–10 with the trigger mechanism named
explicitly: what real-world cue makes someone mention this. It works from the premise that only 7%
of word-of-mouth happens online. Not for paid acquisition, SEO/performance marketing, or viral
coefficient math.

```
우리 온보딩 플로우가 왜 입소문이 안 나는지 STEPPS로 진단하고 점수 매겨줘.
공유를 유발할 트리거를 제품 안에 어떻게 심을지도 제안해줘.
```

### `metrics-interpretation`

A three-step investigation for a number that moved: confirm the change is real (instrumentation,
seasonality, noise), segment top-down to find the cause, then match the action to the cause type.
Includes the common traps — correlation vs. causation, survivorship, Simpson's paradox territory —
and a symptom → likely cause → first check diagnostic table. Not for defining which metrics to
track, or for evaluating a specific launch (`post-launch-retrospective`).

```
지난주 conversion이 15% 떨어졌어. 계측 문제인지 실제인지부터 확인하고,
세그먼트별로 원인 좁혀서 이해관계자용 메모까지 써줘.
```

Output formats: a **metric change memo** for stakeholders, and an **A/B test result summary** with
a ship decision.

### `post-launch-retrospective`

Closes the Build-Measure-Learn loop against the hypothesis written *before* launch. Produces the
hypothesis validation check, a four-section retro (What We Shipped / What Metrics Moved / What We
Learned / What We'd Do Differently), a failure-type diagnosis that distinguishes launch failure
from hypothesis failure from measurement failure, a portable learning card for the team wiki, and
explicit handoffs to prioritisation or research. Not for diagnosing a metric drop unrelated to a
launch (`metrics-interpretation`).

```
3주 전에 출시한 기능인데 활성화 지표가 안 움직였어. 사전 성공 기준과 대조해서
가설 실패인지 런칭 실패인지 판정하고, 러닝 카드까지 만들어줘.
```

---

**Communication**

### `roadmap-communication`

About *what to say*. Reformats the same roadmap per audience — narrative + dependencies for
engineering, an OKR-linked summary for executives, Now/Next/Later for customers, a sales enablement
card for sales — and supplies the sequencing rationale, pre-written answers to predictable
pushback, the four honest answers to "why not my feature", and scripts for a pivot, a delay, or a
scope cut. For the person doing the blocking rather than the message, use `stakeholder-management`.

```
우선순위가 바뀐 이유를 설명하는 로드맵 업데이트가 필요해. 임원용 한 장과
고객용 Now/Next/Later 두 벌로 만들어주고, 날짜 약속은 피해줘.
```

### `stakeholder-management`

About *who*. Maps stakeholders on an influence × interest 2×2, sets communication cadence per
quadrant, diagnoses the type of resistance before attempting persuasion, pre-wires decisions 1:1
before any group meeting, and gives a formula for saying no — acknowledge, explain the trade-off,
offer an alternative, keep the door open — plus conflict patterns and a last-resort escalation
path. For crafting the roadmap message itself, use `roadmap-communication`.

```
VP가 이 기능을 계속 밀어붙여서 로드맵이 흔들려. 이해관계자 맵부터 그리고,
저항 유형을 진단해서 승인 미팅 전에 뭘 해야 하는지 알려줘.
```

---
