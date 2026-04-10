---
name: job-application-workflow
description: >-
  Use when preparing for a job application or career transition end-to-end —
  from analyzing a JD through to interview preparation. Triggers on: "job
  application workflow", "이직 준비 전체", "취업 프로세스 시작", "career transition", job
  search process", "이직 프로세스
type: workflow
theme: career
scenarios:
  - "이직 준비 전체 프로세스 해줘"
  - "job application workflow 시작"
  - "취업 준비 처음부터 끝까지"
  - "career transition full process"
estimated_time: "3-10 hours (full), 30-90 min per step"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 JD 분석과 면접 준비에서 더 깊은 인사이트를 줍니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Job Application Workflow

4-step career transition process: analyze → research → tailor → prepare.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| Specific role / company in mind | General "what should I do with my career" |
| Active application in progress | Already passed interviews, negotiating offer |
| Portfolio or resume needs work | Just need one specific document |

---

## Workflow Overview

```
[1] JD Analysis
        ↓
[2] Company Research
        ↓
[3] Resume & Portfolio Tailoring
        ↓
[4] Interview Preparation
```

---

## Steps

### Step 1 — Job Description Analysis
**Skill:** `portfolio-jd`
**Goal:** Decode what the JD is really asking for beneath the surface language
**Output:** Must-have vs nice-to-have breakdown, hidden signals, fit gap analysis
**Input needed:** Paste the JD text

> "Step 1 시작" 또는 "JD 분석해줘" (JD 텍스트 붙여넣기)

---

### Step 2 — Company Research
**Skill:** `portfolio-company`
**Goal:** Understand culture, growth stage, pain points, and decision-makers
**Output:** Company profile, culture signals, talking points, red flags
**Input needed:** Company name + any public info (Glassdoor, LinkedIn, news)
**Skip if:** Internal transfer or referral with strong inside knowledge

> "Step 2 시작" 또는 "company research 해줘"

---

### Step 3 — Resume & Portfolio Tailoring
**Skills:** `resume-tailorer` + `portfolio-rewrite` (if portfolio needed)
**Goal:** Align your materials to Step 1 fit gaps and Step 2 culture signals
**Output:** Tailored resume, updated portfolio sections, cover letter draft
**Skip if:** Materials already tailored to this specific role

> "Step 3 시작" 또는 "이력서 맞춰줘" / "포트폴리오 다듬어줘"

---

### Step 4 — Interview Preparation
**Skill:** `interview-prep`
**Goal:** Prepare stories, answers, and questions for each interview stage
**Input:** JD analysis + company research + your experience
**Output:** STAR story bank, likely questions + answers, questions to ask
**Skip if:** Screening call only (just need a 5-min pitch)

> "Step 4 시작" 또는 "면접 준비해줘"

---

## State Tracking

어느 단계에 있는지 알려주면 바로 합류합니다:
- "JD는 분석했어, company research부터" → Step 2 바로 시작
- "면접 내일인데 prep만" → Step 4로 직행 (이전 단계 output 간략 제공 시 더 좋음)

## Standalone Inputs

앞 단계 output 없이 중간부터 시작할 때:

| Skip 단계 | 대체 입력 |
|-----------|----------|
| Step 1 없이 Step 3 | "이 역할에 필요한 스킬: [직접 나열]" |
| Step 2 없이 Step 4 | "회사에 대해 아는 것: [요약 제공]" |
| Steps 1-2 없이 Step 4 | JD + 회사 이름만 있으면 Step 4 진행 가능 |

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| JD decoding, signal extraction | Decide which roles to pursue |
| Company profile synthesis | Conduct real informational interviews |
| Resume/portfolio rewriting | Verify accuracy, add context I don't have |
| Mock interview questions + answers | Actually go to the interviews |

## Related Skills

- Individual: `portfolio-jd`, `portfolio-company`, `resume-tailorer`, `interview-prep`
- Adjacent: `portfolio-feedback` (external review of materials before applying)
- After: `think:negotiation` (for offer negotiation)
