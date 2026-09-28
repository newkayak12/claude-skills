---
name: resume-tailorer
effort: high
description: >-
  Use when someone has a resume and a specific job description and wants the
  resume rewritten to fit that JD. Triggers on: "이력서 맞춰줘", "공고에 맞게 고쳐줘",
  "이력서 최적화", "tailor my resume to this JD".
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
## Standing Mandates

- ALWAYS run JD keyword analysis before rewriting any section.
- NEVER rewrite without a gap analysis between the current resume and JD requirements.
- NEVER supply a fact the user did not give. A missing number, cause, date, tool, scope or context is written `[확인 필요: ○○]` and left for the user. No invention, no estimate, no 역산, no candidate values. "API 응답속도 개선" with no metric comes out as "API 응답속도 개선 [확인 필요: 개선 전/후 수치]", never "40% 개선".
- NEVER alter achievement numbers, scope claims, or timeline facts the resume already states.
- ALWAYS lead with the JD-fit verdict; every later block cites it rather than restating it.
- This skill rewrites by purpose — vocabulary, emphasis, order, shape. The rule above is its only bound; it is not limited to typo/terminology fixes.

# Resume Tailorer

**Not for:** general resume improvement without a JD (`portfolio-rewrite`), assessing fit for a role (`portfolio-jd`), scoring the portfolio's overall strength (`portfolio-feedback`), or choosing target companies (`portfolio-company`). Every rewrite here is grounded in the JD provided; redirect anything broader.

## Process

If `sequential-thinking` is available, use it: (1) analyze JD → (2) gap analysis → (3) rewrite sections. Rewrites produced before the gap analysis are unfocused. After the gap analysis, individual section rewrites are independent and can be generated in parallel.

### 1. Gather Inputs

Collect both before any analysis:
1. The current resume (paste, upload, or describe key sections)
2. The full JD text — the more specific, the better

Also useful: company name and size/stage (chaebol, startup, mid-size, global tech), targeted role level (junior → lead), why this company or role. If the resume or the JD is missing, ask for it before proceeding.

### 2. Analyze the JD

- **Required technical skills** — every technology, language, framework, or tool named. Frequency signals emphasis.
- **Soft skill and leadership signals** — "자기주도적", "협업", "오너십", "빠른 실행력". Not filler: they reveal what the hiring manager values.
- **Responsibility keywords** — the verbs ("설계", "운영", "개선", "리딩", "분석"). The resume uses the same verbs wherever accurate.
- **Implicit culture signals**
  - Formal, process-heavy → enterprise / chaebol: stability, documentation, cross-team coordination
  - Brief, result-focused → startup: ownership, speed, measurable outcomes
  - Mentions scale (DAU, TPS, data volume) → emphasize where the candidate operated at scale — only as far as the resume says

Per-company-type signal table: `../../references/korea-company-culture-signals.md`.

### 3. Gap Analysis

| JD requires | Resume shows | Gap? |
|-------------|--------------|------|
| [skill/keyword] | [what's there now] | Missing / Weak / Strong |

Identify:
- **High-priority gaps** — skills or keywords the JD emphasizes that the resume never mentions
- **Hidden strengths** — matching experience described in different vocabulary
- **De-emphasis candidates** — strong sections irrelevant to this JD that take space from what matters

### 4. Produce Specific Rewrites

For each section needing change, give a Before/After with the actual rewritten text — not suggestions.

**Keyword Alignment** — where the candidate has the experience but the wrong vocabulary, translate it. Translation changes words, not facts.
- JD says: "대용량 트래픽 처리 경험 (1M+ DAU)"
- Before: "백엔드 API 개발 및 성능 최적화"
- After: "[확인 필요: 서비스 규모(DAU)] 서비스의 백엔드 API 개발 및 성능 병목 개선 [확인 필요: 개선 전/후 수치]"

**Achievement Reframing (XYZ / STAR)** — surface results buried in job-description language. XYZ: "X를 Y만큼 달성했다, Z를 통해".
- Before: "레거시 시스템 마이그레이션 참여"
- After: "레거시 시스템 마이그레이션에서 [확인 필요: 본인 담당 범위] 수행, [확인 필요: 마이그레이션 전/후로 달라진 지표·수치]"

Reframe the shape of every achievement that uses passive voice ("참여했다", "기여했다"), does not say what changed because of this person's work, or lacks a number — a missing number is `[확인 필요: ○○]`, never filled in.

**Skills Section** — reorder to front-load what the JD names. Deprioritize or drop skills the JD does not mention if space is constrained.

**Summary / Profile** — rewrite the top summary to mirror the JD's framing of the ideal candidate, using only facts the resume gives. The highest-leverage single edit; recruiters read it first.

**ATS** — keyword matching rules and formatting for the Korean market: `../../references/ats-rules-korea.md`.

### 5. Name What NOT to Change

Sections already well-aligned stay untouched.

## Output Template

Write in the user's language.

```
**JD 적합도 판정:** must-have n개 중 Missing n · Weak n — 최우선 변경: [one change]

## JD Analysis Summary
[Key requirements, emphasis areas, culture signals in 5–8 bullets]

## Gap Analysis
[Missing / Weak / Strong table; hidden strengths; de-emphasis candidates]

## Section Rewrites

### Profile / Summary
Before: [current text]
After:  [rewritten text; gaps as [확인 필요: ○○]]

### Experience — [Company / Role]
Before: [current bullets]
After:  [rewritten bullets]

[Repeat for each section needing change]

### Skills Section
Reordered priority: [new ordering]

## What NOT to Change
[Sections already well-aligned — leave as-is]
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Decodes JD: required vs. aspirational; vocabulary signals; cultural cues | Validate that rewrites reflect your real experience |
| Gap analysis: JD requirements vs. resume coverage (table) | Fill each `[확인 필요]` — actual numbers, role scope |
| Before/After rewrites per section, missing facts left as `[확인 필요]` | Decide which rewrites to use |
| Names sections to de-emphasize, move, or leave alone | Apply changes to the actual document |

## Related Skills

- `../portfolio-jd/SKILL.md` — fit assessment before deciding to tailor
- `../portfolio-rewrite/SKILL.md` — general improvement not tied to a specific JD
- `../portfolio-feedback/SKILL.md` — overall strength and screen verdict
