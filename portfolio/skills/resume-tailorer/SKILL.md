---
name: resume-tailorer
description: |
  Tailors a resume or CV to a specific job description — aligns keywords, reframes achievements,
  and adjusts signals for the target company's culture and role requirements.
  This is JD-specific targeting, not general writing improvement (see portfolio-rewrite for that).
  Takes the user's current resume + the target JD and produces concrete before/after rewrites.
  Korean market focus with awareness of chaebols, startups, and global tech companies hiring in Korea.
  Trigger on: "이력서 맞춤", "resume tailoring", "공고에 맞게", "JD 기반 수정",
  "서류 통과", "이력서 최적화", "채용 공고 맞춤".
  Do not give generic resume advice — analyze the specific JD and produce specific rewrites.
---

# Resume Tailorer

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
