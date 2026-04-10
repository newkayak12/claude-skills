---
name: leadership-workflow
description: >-
  Use when someone wants to run the full IC growth cycle or the full manager
  development cycle — from understanding level expectations through to
  high-quality growth conversations. Triggers on: "IC growth cycle", "manager
  development cycle",
type: workflow
theme: engineering-leadership
scenarios:
  - "I'm preparing for a promotion conversation and want the full IC growth process"
  - "I was just promoted to manager — help me set up a proper development practice"
  - "Performance review cycle starts soon — walk me through the full process"
  - "승진 대화를 앞두고 IC 성장 전체 과정을 밟고 싶어"
  - "매니저가 됐는데 팀원 성장 프로세스를 제대로 세우고 싶어"
  - "성과 평가 시즌이 다가와서 전체 과정을 준비하고 싶어"
estimated_time: "IC track: 2-4 hours total; Manager track: 2-5 hours total"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 레벨 증거가 실제 해당 레벨 기준을 충족하는지,
    현재 레벨의 우수 성과인지 구분하는 판단 품질이 높아집니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Leadership Workflow

Two independent tracks. Choose the one that matches your role — or run both if you're a manager who also wants to model the IC side.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| Performance review cycle approaching | Single step only — use the individual skill |
| IC preparing promotion conversation | Already have strong evidence log and clear gaps |
| New manager setting up dev practice | Team is small, informal process works fine |
| Manager assessing reports before calibration | Just need 1-on-1 agenda help |

---

## Workflow Overview

```
Choose your track — or run both.

IC TRACK                              MANAGER TRACK
--------                              -------------
[IC-1] leveling-ic                    [M-1] leveling-manager
Understand your level,                Assess your reports' levels,
map the gap, build                    build promotion cases,
evidence log                          prepare for calibration
        |                                     |
[IC-2] 1-on-1-ic                      [M-2] 1-on-1-manager
Prepare the promotion                 Run growth conversations
conversation; drive                   that develop your reports
career topics in 1-on-1s              and surface blockers

        COMBINED USE CASE
        -----------------
        IC + Manager in the same cycle:
        IC-1 → IC-2 (IC prepares)
        M-1 → M-2  (Manager prepares)
        Both meet in the 1-on-1 with aligned context
```

---

## IC Track

### Step IC-1 — Leveling and Evidence
**Skill:** `leveling-ic`
**Goal:** Understand your current level, map the gap to the next, and build a STAR-format evidence log
**Input:** Your current level title, target level, and any rubric or career ladder your company uses
**Output:** Self-assessment by rubric dimension; evidence log with tagged STAR entries; gap statement; 5-phase readiness score
**Skip if:** You already have a strong evidence log and clear gap diagnosis — go straight to IC-2

> "IC-1 시작" or "레벨업 준비 — 증거 로그부터 만들어줘"

---

### Step IC-2 — 1-on-1 Preparation
**Skill:** `1-on-1-ic`
**Goal:** Drive the promotion conversation and career development topics in your 1-on-1s; give and receive feedback effectively
**Input:** Evidence log and gap diagnosis from IC-1; a specific 1-on-1 coming up (or recurring frustrations with how 1-on-1s are going)
**Output:** Prepared 1-on-1 agenda; drafted upward feedback using SBI model; promotion conversation talking points; 1-on-1 practice score
**Skip if:** You already run strong, agenda-driven 1-on-1s and just needed the evidence work from IC-1

> "IC-2 시작" or "매니저와 커리어 대화 준비해줘"

---

## Manager Track

### Step M-1 — Assess and Build Promotion Cases
**Skill:** `leveling-manager`
**Goal:** Evaluate your reports' levels fairly, build evidence-based promotion cases, and prepare for calibration
**Input:** Your direct reports' current and target levels, evidence you've observed, and your company's level rubric
**Output:** Per-engineer level assessment by rubric dimension; promotion case draft (executive summary + evidence by dimension + developmental areas); calibration arguments; "not-yet" communication with specific gap and path
**Skip if:** Calibration is far out and you're in ongoing evidence-collection mode — use 1-on-1-manager to build evidence, then return here

> "M-1 시작" or "팀원 레벨 평가 및 승진 케이스 작성 시작"

---

### Step M-2 — Run Growth 1-on-1s
**Skill:** `1-on-1-manager`
**Goal:** Transform 1-on-1s from status updates into growth conversations that develop your reports and surface real blockers
**Input:** What you've learned about each report's level and gaps from M-1; the current state of your 1-on-1 practice
**Output:** Per-report 1-on-1 agenda; 3-5 coaching questions specific to each situation; 1-on-1 practice score with highest-leverage improvement; SBI feedback statements; follow-through commitments
**Skip if:** Your 1-on-1 practice is already strong (8+/10) and you only needed the leveling work from M-1

> "M-2 시작" or "팀원 성장 1on1 준비해줘"

---

## State Tracking

어느 단계에 있는지 알려주면 바로 합류합니다:
- "IC 트랙, 이미 증거 로그 있어" → IC-2로 바로
- "매니저, 캘리브레이션 2주 남았어" → M-1 집중
- "두 트랙 다 필요해" → IC-1 → M-1 → IC-2 → M-2

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Explains level criteria per rubric dimension | Has the actual promotion conversation |
| Writes STAR evidence entries from your examples | Collects real evidence through direct observation |
| Drafts promotion cases and calibration arguments | Advocates in the calibration room |
| Generates coaching questions for specific situations | Builds the trust that makes feedback land |
| Scores current practice, names highest-leverage improvement | Makes judgment calls on timing and readiness |

## Related Skills

- `self:self-discovery-workflow` — identity and values context beneath career decisions
- `think:deep-thinking-workflow` — structured thinking on career direction choices
- `pm:stakeholder-management` — when calibration requires organizational influence
