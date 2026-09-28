---
name: job-application-workflow
description: >-
  Use when preparing a job application or career transition end-to-end, from
  JD match to interview preparation. Triggers on:
  "job application workflow", "이직 준비 전체", "취업 프로세스 시작", "career
  transition", "job search process".
type: workflow
theme: career
scenarios:
  - "이직 준비 전체 프로세스 해줘"
  - "job application workflow 시작"
  - "취업 준비 처음부터 끝까지"
  - "career transition full process"
  - "Take me from JD match to interview prep for this role"
estimated_time: "3-10 hours (full), 30-90 min per step"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 JD 매칭과 면접 준비가 깊어집니다.
---

# Job Application Workflow

match → target → tailor → prepare. **Not for** open-ended career direction, offer negotiation (`think:negotiation`), or one document alone (use that step's skill).

## Process

**On entry, at any step or session:** restate the `[확정]` list (target role, excluded companies/projects, numbers already judged); never reopen a settled item. A fact a step needs but was not given (the JD for Step 1, a metric) is `[확인 필요: ○○]`, never assumed.

**Step 1 — JD Match** · `jd-fit`
Needs a portfolio and a JD. Judges fit: pass likelihood, gaps by severity, positioning, apply or not.
> "Step 1 시작" / "JD랑 비교해줘"

**Step 2 — Company-Type Fit** · `portfolio-company`
Scores the portfolio against company types: best fits, types to avoid. No company research.
**Skip if:** the target company is already fixed (internal transfer, referral).
> "Step 2 시작" / "어느 회사에 잘 맞아?"

**Step 3 — Tailoring** · `resume-tailorer` (+ `portfolio-rewrite` when a 포트폴리오 is in play)
From Step 1-2 results: tailored 이력서 sections; 포트폴리오 passages go to `portfolio-rewrite`.
**Skip if:** materials already tailored to this role.
> "Step 3 시작" / "이력서 맞춰줘" / "포트폴리오 다듬어줘"

**Step 4 — Interview Preparation** · `interview-plan`
A study plan by timeline and weak area, plus STAR prompts the candidate fills. Planning, not practice.
**Skip if:** screening call only (a 5-min pitch is enough).
> "Step 4 시작" / "면접 준비해줘"

### State Tracking

Say where you are; the workflow joins there:
- "JD는 분석했어, 회사 유형부터" → Step 2
- "면접 내일인데 prep만" → Step 4 (earlier outputs help if given)

Carry `[확정]` forward on every hand-off; add only what the user settles.

### Standalone Inputs

| Skipped | Substitute input |
|---------|------------------|
| Step 1 before Step 3 | "이 역할에 필요한 스킬: [직접 나열]" |
| Step 2 before Step 4 | "회사에 대해 아는 것: [요약 제공]" |
| Steps 1-2 before Step 4 | JD + company name are enough |

## Output Template

User's language, judgment first.

**[현재 위치 / Where You Are]**
Current step · next step and the decision it needs (e.g. "Step 1 done — 지원 권장, gap 2개; Step 3 needs: 이력서 원본").

**[확정]**
Target role · excluded companies/projects · numbers already judged.

**[이번 단계 결과 / This Step]**
The sub-skill's output.

**[확인 필요]** *(omit when none)*
One per line — what the next step cannot proceed without.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| JD fit judgment, gap severity | Decide which roles to pursue |
| Company-type fit scoring | Research the actual company |
| 이력서/포트폴리오 rewriting | Fill every `[확인 필요]` |
| Study plan and STAR prompts | Write the stories, go to the interviews |

## Related Skills

- Steps: `jd-fit`, `portfolio-company`, `resume-tailorer`, `portfolio-rewrite`, `interview-plan`
- Adjacent: `portfolio-feedback` (review materials before applying), `mock-interview` (mock interview practice)
- After: `think:negotiation` (offer negotiation)
