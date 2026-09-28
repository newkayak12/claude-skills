# JD-Tailoring Mode — Detail

Loaded by `../SKILL.md` when a target JD is supplied. Every step below sits under the SKILL.md Standing Mandates: no fact is supplied, and no stated number, scope or date is altered.

## 1. Gather Inputs

Collect both before any analysis:
1. The current resume or portfolio section (paste, upload, or describe key sections)
2. The full JD text — the more specific, the better

Also useful: company name and size/stage (chaebol, startup, mid-size, global tech), targeted role level (junior → lead), why this company or role. If the resume or the JD is missing, ask for it before proceeding. Company facts come only from what the user or the JD supplies.

## 2. Analyze the JD

- **Required technical skills** — every technology, language, framework, or tool named. Frequency signals emphasis.
- **Soft skill and leadership signals** — "자기주도적", "협업", "오너십", "빠른 실행력". Not filler: they reveal what the hiring manager values.
- **Responsibility keywords** — the verbs ("설계", "운영", "개선", "리딩", "분석"). The resume uses the same verbs wherever accurate.
- **Implicit culture signals**
  - Formal, process-heavy → enterprise / chaebol: stability, documentation, cross-team coordination
  - Brief, result-focused → startup: ownership, speed, measurable outcomes
  - Mentions scale (DAU, TPS, data volume) → emphasize where the candidate operated at scale — only as far as the resume says

Per-company-type signal table: `../../../references/korea-company-culture-signals.md`.

**must-have vs nice-to-have.** Lines under 자격요건 / 필수 / Requirements are must-have and are what the 판정 line counts. 우대사항 / Preferred lines are nice-to-have: they appear in the gap table, marked (우대), but are not in the must-have n (default - revisit).

## 3. Gap Analysis

| JD requires | Resume shows | Gap? |
|-------------|--------------|------|
| [skill/keyword, quoted from the JD] | [what's there now, quoted from the resume] | Missing / Weak / Strong |

- **Missing** — the resume never mentions it.
- **Weak** — present only as a skills-list entry, adjacent experience, or an activity line with no evidence of the depth the JD asks for.
- **Strong** — a resume line shows it directly.

Then identify:
- **High-priority gaps** — skills or keywords the JD emphasizes that the resume never mentions
- **Hidden strengths** — matching experience described in different vocabulary
- **De-emphasis candidates** — strong sections irrelevant to this JD that take space from what matters

The 판정 line is computed from this table: `must-have n개 중 Missing n · Weak n`, and 최우선 변경 names the single highest-leverage edit. By default that is the Summary/Profile rewrite (§4), because recruiters read it first; name a different section only when a must-have row is Missing and no summary sentence can honestly cover it (default - revisit).

## 4. Rewrite Techniques (JD mode)

For each section needing change, give a Before/After with the actual rewritten text — not suggestions.

**Keyword Alignment** — where the candidate has the experience but the wrong vocabulary, translate it. Translation changes words, not facts.
- JD says: "대용량 트래픽 처리 경험 (1M+ DAU)"
- Before: "백엔드 API 개발 및 성능 최적화"
- After: "[확인 필요: 서비스 규모(DAU)] 서비스의 백엔드 API 개발 및 성능 병목 개선 [확인 필요: 개선 전/후 수치]"

**Achievement Reframing (XYZ / STAR)** — surface results buried in job-description language. XYZ: "X를 Y만큼 달성했다, Z를 통해".
- Before: "레거시 시스템 마이그레이션 참여"
- After: "레거시 시스템 마이그레이션에서 [확인 필요: 본인 담당 범위] 수행, [확인 필요: 마이그레이션 전/후로 달라진 지표·수치]"

Reframe the shape of every achievement that uses passive voice ("참여했다", "기여했다"), does not say what changed because of this person's work, or lacks a number — a missing number is `[확인 필요: ○○]`, never filled in. A line that already carries numbers keeps them character-for-character; only the words around them move.

**Skills Section** — reorder to front-load what the JD names. Deprioritize or drop skills the JD does not mention if space is constrained. Never add a skill the resume does not list.

**Summary / Profile** — rewrite the top summary to mirror the JD's framing of the ideal candidate, using only facts the resume gives. The highest-leverage single edit; recruiters read it first. If the resume has no summary, write one from its own lines, with missing facts as markers.

**ATS** — keyword matching rules and formatting for the Korean market: `../../../references/ats-rules-korea.md`.

## 5. What NOT to Change

Sections already well-aligned stay untouched. Name them, with the gap-table row they satisfy.
