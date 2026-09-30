---
name: job-application-workflow
description: >-
  Use when preparing a job application or career transition end-to-end, from
  JD fit through 자기소개서 to mock interview. Triggers on:
  "job application workflow", "이직 준비 전체", "취업 프로세스 시작", "career
  transition", "job search process".
type: workflow
theme: career
scenarios:
  - "이직 준비 전체 프로세스 해줘"
  - "job application workflow 시작"
  - "취업 준비 처음부터 끝까지"
  - "career transition full process"
  - "Take me from JD fit to a mock interview for this role"
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

fit → review → tailor → write → prepare → practice. **Not for** open-ended career direction, offer negotiation (`think:negotiate`), or one document alone (use that step's skill).

## Process

**On entry, at any step or session:** restate the `[확정]` list (target role, excluded companies/projects, numbers already judged); never reopen a settled item. A fact a step needs but was not given (the JD, a metric, a date) is `[확인 필요: ○○]`, never assumed.

**Step 1 — Fit** · `fit`
With a JD: 서류 통과 가능성, gaps by severity, positioning, apply or not. Without one: best company types and types to avoid, from the signals you give (no company research).
**Skip if:** the target is already fixed and judged.
> "Step 1 시작" / "JD랑 비교해줘" / "어느 회사에 잘 맞아?"

**Step 2 — Review** · `feedback`
Interviewer-grade verdict on the materials: screen verdict, whether numbers and skills hold up, level read.
**Skip if:** the materials were reviewed since their last change.
> "Step 2 시작" / "포트폴리오 피드백 해줘"

**Step 3 — Tailoring** · `rewrite`
Before/After rewrites of 이력서·포트폴리오 lines; with the Step 1 JD it tailors to that posting (keywords, achievement reframing, skills order). Missing numbers stay `[확인 필요]`.
**Skip if:** materials already tailored to this role.
> "Step 3 시작" / "이력서 맞춰줘" / "이 문장 고쳐줘"

**Step 4 — 자기소개서** · `write:writer-verification` (draft mode, genre `doc`)
Material: the tailored 이력서/포트폴리오, the JD with each 문항's text, the Step 1 result. Every experience fact comes from that material — including when things happened, who did them ("혼자", "주도" only if the material says so), why, how, and what the candidate learned; a missing one is `[확인 필요: ○○]`, never written as if it happened. The limit is a ceiling, not a target: stop where the material stops rather than pad. Before handing over, trace each sentence of the draft to the material line it rests on; a sentence with no line is cut or becomes `[확인 필요]`, and the trace goes under the draft. Character limits are not counted — check each 문항's limit yourself.
**Skip if:** the posting has no 자기소개서, or the `write` plugin is not installed.
> "Step 4 시작" / "자소서 써줘"

**Step 5 — Interview Plan** · `interview-plan`
A study plan by timeline and weak area, plus STAR prompts you fill. Planning, not practice.
**Skip if:** screening call only (a 5-min pitch is enough).
> "Step 5 시작" / "면접 준비 계획 세워줘"

**Step 6 — Mock Interview** · `mock-interview`
A live interview grounded in your materials, one question at a time, with coaching per answer.
**Skip if:** no interview scheduled yet.
> "Step 6 시작" / "모의 면접 해줘"

### State Tracking

Say where you are; the workflow joins there:
- "JD는 분석했어, 이력서부터" → Step 3
- "면접 내일인데 prep만" → Step 5 (earlier outputs help if given)

Carry `[확정]` forward on every hand-off; add only what the user settles.

### Standalone Inputs

| Skipped | Substitute input |
|---------|------------------|
| Step 1 before Step 3 | the JD itself, or "이 역할에 필요한 스킬: [직접 나열]" |
| Step 3 before Step 4 | the current 이력서/포트폴리오 as is |
| Steps 1-4 before Step 5 | JD + company name are enough |

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
| Fit judgment (JD or company type), gap severity | Decide which roles to pursue; research the actual company |
| Review and rewrite of 이력서/포트폴리오 | Fill every `[확인 필요]` |
| 자기소개서 drafts from your material only | Check each 문항's length and truth |
| Study plan, STAR prompts, mock interview | Write the stories, go to the interviews |

## Related Skills

- Steps: `fit`, `feedback`, `rewrite`, `write:writer-verification`, `interview-plan`, `mock-interview`
- Adjacent: `pattern` (how the writing reads), `deck-builder` (portfolio deck as pptx)
- After: `think:negotiate` (offer negotiation)
