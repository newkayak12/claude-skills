---
name: interview-plan
effort: high
description: >-
  Use when someone needs an interview preparation plan before their
  interview process begins — a study schedule, gap analysis by topic area, and
  STAR story prompts. This is planning, not practice. Triggers on: "interview
  prep plan", "면접 준비 계획".
scenarios:
  - "I have 8 weeks until my Google interview — give me a structured prep plan"
  - "I'm preparing for Kakao backend engineer interviews — what should I study?"
  - "Make me a FAANG interview prep schedule with STAR story prompts"
  - "카카오 백엔드 면접 준비 계획 세워줘"
  - "기술 면접 8주 전인데 어떻게 준비해야 해?"
compatibility:
  recommended: []
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    sequential-thinking이 있으면 컨텍스트 수집 → 회사 캘리브레이션 → 갭 분석 → 플랜 생성 순서를 강제하여
    갭 분석 전에 플랜부터 생성하는 흔한 오류를 방지합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- ALWAYS run gap analysis against the target role before generating the study plan.
- ALWAYS calibrate the plan to the specific company, role, and timeline.
- ALWAYS lead with the one-line plan judgment — weeks available and the top-priority weak area — before the schedule.
- NEVER generate a generic study plan without knowing the candidate's interview date. If it is missing, the plan header says `[확인 필요: 면접 날짜]` and no week count is invented.
- NEVER supply a fact the user did not give. A missing interview date, company type, format, or weak area is written `[확인 필요: ○○]` — never guessed, back-calculated, or filled with a plausible default.
- NEVER write the candidate's answers. STAR prompts ask for the candidate's own situation, action, and result; no example story, no sample answer, no invented metric.
- NEVER conflate interview prep planning (this skill) with interview practice (mock-interview skill).

# Interview Prep Planner

**Not for** live mock interview practice (`mock-interview`), resume tailoring to a JD (`resume-tailorer`), or general portfolio improvement (`portfolio-feedback`, `portfolio-rewrite`).

## Process

1. **Gather context** — experience level, target company/role, timeline, interview format, biggest worry
2. **Calibrate to company type** — FAANG, Korean Tier-1, growth startup, or enterprise — each tests differently
3. **Identify weak areas** — coding, system design, behavioral across specific topic areas
4. **Produce week-by-week plan** — primary focus, daily practice, named resources, measurable weekly milestone
5. **Write STAR story prompts** — 6-8 prompts matched to common behavioral areas, each asking for the candidate's own story
6. **Final week guidance** — consolidation, mock interviews, logistics prep

If `sequential-thinking` is available, use it to enforce the order: (1) gather context → (2) calibrate by company type → (3) identify gaps → (4) generate plan. Skipping gap analysis before planning is the most common failure. Once Step 2 is complete, gap analysis (Step 3) and domain study structure generation (from `references/study-domains.md`) can run in parallel.

### Step 1 — Gather Context

If following portfolio-feedback, jd-fit, or portfolio-company, start here. Before producing any plan, collect:

1. **Background:** How many years of experience? Current/recent role and tech stack?
2. **Target:** Which company or type of company? Which role level? (IC3 vs. Staff, for example)
3. **Timeline:** How many weeks until the interview (or target application date)?
4. **Interview format known?** (e.g., two coding rounds + system design + behavioral, or unknown)
5. **Biggest worry:** What area feels most uncertain right now?

If the user has already provided this, proceed directly to the plan. Do not ask for information already given. Anything still missing after one ask is carried into the plan as `[확인 필요: ○○]` (e.g. `[확인 필요: 면접 형식]`) rather than assumed.

### Step 2 — Company/Role Calibration

Calibrate to the company type the user named. If none was given, write `[확인 필요: 목표 회사 유형]` and do not pick one for them.

**FAANG / Top-Tier (Google, Meta, Amazon, Apple, Netflix-style)**
- Coding: LeetCode medium/hard, emphasis on optimal time/space complexity
- System design: large-scale distributed systems, explicit tradeoff discussion expected
- Behavioral: leadership principles, specific STAR stories required (Amazon especially)
- Bar: correct solution is not enough — interviewers probe complexity, edge cases, alternatives

**Korean Tier-1 (Kakao, Naver, Line, Coupang)**
- Coding: algorithm-heavy, often implementation-level problems (graph, DP, BFS/DFS)
- System design: architecture of real services, Korean-scale traffic considerations
- Cultural fit: collaborative style, team contribution, communication quality

**Growth-Stage Startups**
- Coding: practical problems, less focus on extreme optimization
- System design: pragmatic choices, speed of delivery vs. scale tradeoff
- Behavioral: ownership, autonomy, self-direction — what did you initiate?

**Enterprise / B2B / Fintech**
- Coding: often take-home or lower difficulty
- System design: reliability, observability, security
- Cultural: process maturity, documentation, stability-oriented decisions

Adjust topic weights to the target. A LeetCode hard solver who cannot discuss distributed systems tradeoffs will not pass a Google system design round.

### Step 3 — Weak Area Identification

Assess each area from the user's own description only:

- **Coding** — Medium LeetCode consistently in 30 minutes? Comfortable with arrays/strings, hash maps, trees, graphs, dynamic programming, sliding window, two pointers, binary search? Communicates reasoning while coding?
- **System Design** — Scopes a system from vague requirements to a concrete design in 45 minutes? Covers API design, data modeling, scalability bottlenecks, caching, failure modes, monitoring? Drives the conversation or waits to be led?
- **Behavioral** — 5–7 distinct STAR stories ready covering ownership, conflict, failure, impact, leadership? Stories specific (numbers, outcomes, personal role) or generic ("we improved the system")?

Flag specific gaps; study time is allocated in proportion to gap severity. An area the user said nothing about is `[확인 필요: ○○ 수준]`, not rated.

### Step 4 — Domain Study Structures

For coding topic sequencing and practice volume, system design core concepts and practice format, and behavioral story coverage, read `references/study-domains.md` after completing Steps 1–3.

### Step 5 — Final Week

No new material in the final week. Focus on:
- Two full mock interviews (coding + system design)
- Tell your STAR stories aloud — hear how they sound, not just how they read
- Re-attempt your three hardest practice problems to rebuild confidence
- Logistics: time zone, Zoom setup, whiteboard tool if virtual, rest

The final week is consolidation, not cramming.

## Output Template

```
# Interview Prep Plan
**판단:** [N]주 확보 · 최우선 약점: [area] — [one clause why]
(날짜 없으면: [확인 필요: 면접 날짜] · 최우선 약점: [area 또는 확인 필요: 약점 영역])
Target: [Company type] [Role] — [N] weeks · Format: [format 또는 확인 필요: 면접 형식]

### Week-by-Week Schedule
**Week 1: [Focus Area]**
- Goal: [Measurable outcome]
- Daily practice: [Specific activity]
- Resources: [Named, specific resources]
- Milestone: [How to verify the week was effective]
[Repeat for each week]

### Topic Priority List (by urgency)
1. [Highest gap / highest weight topic]
2. ...

### STAR Story Prompts (6–8)
1. [Behavioral area] — "Recall a time you [situation type]. What was your role, what did you do, and what changed? Note the result in your own numbers; if you don't have one, mark it [확인 필요: 결과 수치]."
[Prompts only — the candidate writes the stories]

### Final Week Checklist
- [ ] Two full mock interviews (coding + system design)
- [ ] STAR stories told aloud
- [ ] Three hardest problems re-attempted
- [ ] Logistics: time zone, video setup, whiteboard tool, rest
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Calibrates the plan to company type (FAANG, Korean Tier-1, startup, enterprise) | Does the practice problems and mock interviews |
| Identifies weak areas from your described background, marking unknowns `[확인 필요]` | Fills in the missing facts — date, company type, weak areas |
| Produces the week-by-week schedule with measurable milestones | Validates the plan with anyone who has done this interview |
| Writes STAR story prompts for behavioral areas | Writes your own stories from your own experience |

## Related Skills

- `../mock-interview/SKILL.md` — practice answering questions live after building this plan
- `../portfolio-feedback/SKILL.md` — overall portfolio assessment before targeting specific companies
- `../jd-fit/SKILL.md` — JD-specific gap analysis if you have a posting
