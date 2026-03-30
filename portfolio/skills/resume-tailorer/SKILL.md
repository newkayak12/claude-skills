---
name: resume-tailorer
description: >-
  Use when someone has a resume and a specific job description and wants the resume rewritten to match that JD — keyword alignment, achievement reframing, and skills reordering.
  Triggers on: "이력서 맞춰줘", "공고에 맞게 고쳐줘", "이력서 최적화", "tailor my resume to this JD", "optimize resume for this job", "keyword align my resume".
  Best for: matching a resume to a specific role's vocabulary; surfacing hidden strengths with the wrong terminology; reordering skills/achievements for maximum relevance to a JD.
  Not for: general resume improvement without a JD (use portfolio-rewrite), overall portfolio assessment (use portfolio-feedback), JD fit scoring (use portfolio-jd).
scenarios:
  - "Tailor my resume to match this job description — keyword alignment and achievement reframing"
  - "Rewrite my resume summary and experience bullets to fit this JD"
  - "Reorder my skills section to match what this company is looking for"
  - "이 공고에 맞게 이력서 최적화해줘"
  - "JD 키워드에 맞게 이력서 고쳐줘"
compatibility:
  recommended: []
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    sequential-thinking이 있으면 JD 분석 → 갭 분석 → 섹션 리라이팅 순서를 강제하여
    갭 분석 전에 리라이팅이 발생하는 문제를 방지합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Resume Tailorer

## When to Use / When Not to Use

**Use when:**
- You have a specific JD and want the resume vocabulary to match it
- Hidden strengths are described with different terms than the JD uses
- You need to reorder skills and achievements to front-load what this company cares about

**Not for:**
- General resume improvement without a JD (use portfolio-rewrite)
- Assessing how well you fit a role (use portfolio-jd)
- Understanding which companies to target (use portfolio-company)

## Process

1. **Gather inputs** — current resume + full JD; company name/stage and role level useful
2. **Analyze the JD** — required tech skills (frequency = emphasis), soft skill signals, responsibility keywords, implicit culture signals
3. **Gap analysis** — JD requirements vs. resume coverage in a table: Missing / Weak / Strong
4. **Produce section rewrites** — Before/After for every section needing change; keyword alignment, achievement reframing, skills reordering
5. **Name what NOT to change** — sections already well-aligned; don't touch them

## Standalone Inputs

Provide both:
1. Current resume (paste or describe key sections)
2. Full JD text

Also useful: company name/stage, role level, why you want this specific role.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Decodes JD: required vs. aspirational; vocabulary signals; cultural cues | Validates that rewrites accurately reflect your real experience |
| Gap analysis: JD requirements vs. resume coverage (table format) | Provides missing context (actual numbers, role scope) |
| Produces Before/After rewrites for each section needing change | Decides which rewrites to use |
| Identifies sections to deemphasize or move for this JD | Applies changes to the actual document |

## Related Skills

- `../portfolio-jd/SKILL.md` — fit assessment before deciding to tailor
- `../portfolio-rewrite/SKILL.md` — general improvement not tied to a specific JD

## Why Generic Resumes Fail

A resume written for everyone is optimized for no one. Recruiters and ATS systems screen against the language of the job description — not against abstract quality. A candidate with the right experience but the wrong vocabulary gets filtered before a human ever reads the file.

Tailoring is not embellishment. It is translation: the same real experience, surfaced in the terms and emphasis the target company uses to describe what they need.

---

## Workflow Note — Sequential Thinking and Parallelization

If `sequential-thinking` is available, use it: (1) analyze JD → (2) gap analysis → (3) rewrite sections. Performing rewrites before completing gap analysis produces unfocused changes.

After gap analysis (Step 2), individual section rewrites (Step 3) are independent and can be generated in parallel.

---

## Step 1 — Gather Inputs

Collect two things before any analysis:
1. The current resume (paste, upload, or describe key sections)
2. The target job description (full JD text preferred — the more specific, the better)

Also useful:
- Company name and approximate size/stage (chaebol, startup, mid-size, global tech)
- Role level targeted (junior, mid, senior, staff, lead)
- Any notes on why they want this specific company or role

If either the resume or the JD is missing, ask for it before proceeding.

---

## Step 2 — Analyze the JD

Extract and categorize what the JD is actually asking for:

### Required Technical Skills
List every specific technology, language, framework, or tool named. Note which appear multiple times — frequency signals emphasis.

### Soft Skill and Leadership Signals
What language does the JD use? ("취업규칙 준수", "자기주도적", "협업", "오너십", "빠른 실행력") — these are not filler. They reveal the culture and what the hiring manager actually values.

### Responsibility Keywords
What verbs does the JD use? ("설계", "운영", "개선", "리딩", "분석") — the resume should use the same verbs to describe the candidate's experience wherever accurate.

### Implicit Signals
- Is the JD formal and process-heavy? → enterprise / chaebol: emphasize stability, documentation, cross-team coordination
- Is it brief and result-focused? → startup: emphasize ownership, speed, measurable outcomes
- Does it mention scale (DAU, TPS, data volume)? → emphasize where the candidate has operated at scale

---

## Step 3 — Gap Analysis

Compare the JD requirements against the current resume:

| JD requires | Resume shows | Gap? |
|-------------|--------------|------|
| [skill/keyword] | [what's there now] | Missing / Weak / Strong |

Identify:
- **High-priority gaps:** skills or keywords the JD emphasizes and the resume does not mention at all
- **Hidden strengths:** experience the candidate has that matches JD requirements but is described with different vocabulary
- **Deemphasis candidates:** resume sections that are strong but irrelevant to this JD — they take space from what matters

---

## Step 4 — Produce Specific Rewrites

For each section that needs change, produce a Before/After. Do not give suggestions — give the actual rewritten text.

### Keyword Alignment
Where the candidate has the experience but the wrong vocabulary, translate it.

Example:
- JD says: "대용량 트래픽 처리 경험 (1M+ DAU)"
- Before: "백엔드 API 개발 및 성능 최적화"
- After: "일 활성 사용자 150만 규모 서비스의 백엔드 API 설계 및 병목 구간 35% 개선"

### Achievement Reframing (XYZ / STAR Format)
Achievements buried in job-description language need to be surfaced as results.

XYZ format: "X를 Y만큼 달성했다, Z를 통해"
- Before: "레거시 시스템 마이그레이션 참여"
- After: "레거시 모놀리식 시스템을 마이크로서비스로 마이그레이션, 배포 주기를 2주에서 하루로 단축 (Jenkins CI/CD 파이프라인 구축)"

Reframe every achievement that:
- Uses passive voice ("참여했다", "기여했다")
- Lacks a number
- Does not say what changed because of this person's work

### Skills Section
Reorder skills to front-load what the JD explicitly names. Remove or deprioritize skills not mentioned in the JD if space is constrained.

### Summary / Profile Section
If the resume has a top summary, rewrite it to mirror the JD's framing of the ideal candidate. This is the highest-leverage single edit — recruiters read it first.

---

## Culture-Fit Signal Adjustment

For the full per-company-type signal table (Chaebol, Korean tech unicorn, Global tech, Early-stage startup), read `../../references/korea-company-culture-signals.md`.

---

## ATS Considerations

For full ATS keyword matching rules and formatting guidance for the Korean job market, read `../../references/ats-rules-korea.md`.

---

## Output Format

Produce the tailored output as:

```
## JD Analysis Summary
[Key requirements, emphasis areas, culture signals in 5–8 bullets]

## Gap Analysis
[Table of JD requirements vs. current resume coverage]

## Section Rewrites

### Profile / Summary
Before: [current text]
After:  [rewritten text]

### Experience — [Company / Role]
Before: [current bullets]
After:  [rewritten bullets]

[Repeat for each section needing change]

### Skills Section
Reordered priority: [new ordering]

## What NOT to Change
[Sections that are already well-aligned — leave them as-is]
```

---

## What This Skill Does Not Do

This skill does not improve general writing quality regardless of JD — that is portfolio-rewrite.

This skill does not assess the portfolio's overall strength or score it — that is portfolio-feedback.

This skill does not help select which companies to target — that is portfolio-company.

Every rewrite here is grounded in the specific JD provided. If the user wants a more general improvement, redirect to the appropriate skill.
