# PRD — Portfolio skills refresh to the portfolio-feedback bar

Source of every finding cited here: `PRD-portfolio-refresh-findings.md` (cited as F§n). Line numbers refer to HEAD `f3cd5da`.

**Domain.** Korean software-engineer job seeking (이직 / 취업 준비): 이력서, 경력기술서, and 포트폴리오 덱/문서 read by a 서류 전형 screener, then 기술 면접 and 컬처핏 면접. What people in this domain know and a generic "writing assistant" PRD would miss:

- A claim counts as a 완전 주장 only when it carries 수치 · 베이스라인 · 기간 · 기여 범위, and a number without a baseline is "a certain interview question" (F§1, portfolio-feedback L37). A number that is not the candidate's own is worse than no number: the candidate cannot answer the 꼬리 질문 it draws ("그 35%는 어떻게 측정하셨어요?"). So an assistant that fills a blank with a plausible figure hands the candidate a lie they will be asked to defend. This is why `[확인 필요: ○○]` exists.
- A 이력서 and a 포트폴리오 덱 are judged with different measures (F§1, format detection L31). Applying one to the other was a real-session failure.
- The verdict a candidate acts on is 통과 / 경계 / 스크린아웃 (portfolio-jd) or "지원할 만한가". A candidate who stops after the first screen of output must already have it.
- portfolio-feedback's thresholds (e.g. ~60% 스킬 근거율) were set from eval fixtures, not from screening research (F§1, claim-and-consistency.md §F L154-165), and portfolio-pattern's ~20% / 60% cut-offs cite no source at all (F§4). A value of 58% against ~60% is not a 레드 플래그.
- Sessions continue across turns: the candidate pastes one section, fixes it, pastes the next (portfolio-rewrite L130), and a decision already made (e.g. "이 프로젝트는 빼기로 함") must still hold later. Reopening settled decisions is one of the real-session failures c22ed42 records (F§1).

## Problem

`portfolio/skills/portfolio-feedback` was corrected from real user sessions in 1.13.0 (`a1455e7`) and 1.14.0 (`c22ed42`), both 2026-09-02. The commit record names the failures it fixed: the verdict came out as the 9th block, a 58% value fired a flag against a ~60% threshold, one finding appeared four times, blanks were filled with plausible facts, settled decisions were reopened, and the reviewer posture leaked into writing (F§1).

The other eight portfolio skills lack those 1.13-1.14 rules. Five were last touched 2026-08-30; portfolio-rewrite (08-31) and portfolio-pattern (09-01) were changed just before 1.13/1.14 and did not get them; portfolio-jd was changed after (09-10, `a590df9`) and already has `[확인 필요]` and a closing tally line but not the rest (F§4, premise correction). So the request's "not touched since late August" is true for 5 of 8; what is true of all 8 is that none meets the bar:

- `[확정]` appears 0 times in all 8; `확인 필요` appears in only portfolio-jd (F§4).
- resume-tailorer's own examples invent the numbers its mandate forbids: "백엔드 API 개발 및 성능 최적화" becomes "일 활성 사용자 150만 ... 35% 개선", and "레거시 시스템 마이그레이션 참여" becomes "배포 주기를 2주에서 하루로 단축" (F§4, L148-158). That is exactly the "API 응답속도 개선 → 40% 개선" failure the requester named.
- portfolio-jd puts its 서류 통과 verdict at block 6 of 7; portfolio-company puts Top 2 at block 3 (F§4).
- portfolio-pattern flags "Under ~20%" decision verbs and "above 60%" number-free claims with no boundary rule and no provisional label (F§4).
- 7 of 8 put their Stage, Output and Rules sections after Related Skills; only interview-prep has an `Output Template` heading, and it contradicts its own Plan Template (F§4).
- job-application-workflow describes portfolio-company as company research, promises a cover letter no skill produces, and describes interview-prep as producing answers (F§4).

Who has the problem: the candidate, who receives invented numbers, a buried verdict, and reopened decisions from every portfolio skill except portfolio-feedback.

## Users

| Skill | Who runs it | What they are trying to get done | What they do today instead |
|---|---|---|---|
| resume-tailorer | Candidate with one 이력서 and one target JD | Rewrite the 이력서 so its keywords and achievements match the JD and pass ATS | Gets Before/After rewrites whose After can carry numbers they never gave |
| portfolio-rewrite | Candidate fixing weak passages of a 포트폴리오, section by section over several turns | Turn a passage into XYZ+S shape without losing their own facts | The skill asks for missing numbers or writes around them with no marker; earlier choices are not carried forward |
| portfolio-jd | Candidate deciding whether to apply to one posting | Know 통과 / 경계 / 스크린아웃 and the one swing factor | Reads six blocks before the verdict |
| portfolio-interview | Candidate rehearsing a mock 기술 면접 turn by turn against a persona | Practise answers and learn what a stronger answer looks like | "Stronger version" can be written with an outcome they never stated; nothing carries decisions across questions |
| interview-prep | Candidate with an 면접 date, planning study weeks | A week-by-week plan and STAR prompts | Gets a skill whose Output Template promises a question bank and written STAR answers it does not produce |
| portfolio-company | Candidate with no JD yet, choosing which company type to target | Fit score per company type, Top 2, what to avoid | Top 2 at block 3; output forced into Korean; told to read company signals it has no source for |
| portfolio-pattern | Candidate (or reviewer) wanting cross-document patterns: 주어, 수치 밀도, 결정 가시성 | See which writing patterns weaken the whole portfolio | Gets flags on boundary values against unsourced thresholds; fix examples add facts ("대안 3안") |
| job-application-workflow | Candidate running the whole 이직 준비 sequence, entering at any step | Know which step they are on and what each step gives them | Step descriptions promise company research, a cover letter, and interview answers that the sub-skills do not produce |

## Solution overview

Each of the eight SKILL.md files is rewritten in place so that a candidate using it sees the same behaviour portfolio-feedback already shows. Where the candidate did not supply a number, cause, date or context, the output says `[확인 필요: ○○]` and stops there. The first thing on screen is the verdict or judgment; details and evidence follow. Where a skill is used across several turns, it keeps a `[확정]` list and restates it before new work, and does not re-propose anything on it. Where a skill scores against a numeric threshold, a value near the threshold is reported as `경계 (값, 기준 ~N%)` rather than as a red flag.

The files also take the repo's authoring shape: description starting "Use when", 2-3 EN and 2-3 KR scenarios, Process → Output Template → What Claude Does / What You Do → Related Skills with Related Skills last, no background section, and no more words than today. Nothing the skill does today is dropped unless it contradicts these rules; the few places where a skill describes a capability that does not exist (interview-prep's Output Template, job-application-workflow's step descriptions) are corrected to what the skill actually does.

Only each skill's own directory changes. Versions, the plugin manifest and README/KOR docs are bumped once after the sprint.

## Success criteria

1. For each of the 8 skills, feeding the resume line "API 응답속도 개선" (no metric) produces output containing `[확인 필요: 개선 전/후 수치]` (or an equally specific `[확인 필요: ...]`) and no invented figure. Checkable by one run per skill, or for skills that never rewrite a line, by the rule text plus examples containing no fact absent from their Before.
2. `grep -c '확인 필요' portfolio/skills/<name>/SKILL.md` ≥ 1 for all 8.
3. `grep -c '확정'` ≥ 1 in portfolio-rewrite, portfolio-interview and job-application-workflow.
4. In every Output Template, the first block is the verdict/judgment.
5. portfolio-pattern contains the boundary rule and marks ~20% and 60% as provisional.
6. `grep '^## '` shows `Process`, `Output Template`, `What Claude Does / What You Do`, `Related Skills` in that order, with `Related Skills` last, and no `Why ...`/Overview/Background heading.
7. `wc -w` of each SKILL.md ≤ its baseline in F§4.
8. Every capability in the story's keep-list is still present.
9. `python3 scripts/validate_plugins.py` passes; `git diff --stat` touches only `portfolio/skills/<name>/`.

## User Stories

Rules shared by every story (each story's acceptance cites them as R1-R9 and adds its own):

- **R1 — no invented fact.** A missing number, cause, date or context is written `[확인 필요: ○○]`, never invented, estimated or 역산 (back-calculated), and no candidate values are offered. Example: "API 응답속도 개선" with no metric comes out with `[확인 필요: 개선 전/후 수치]`, not "40% 개선". Every illustrative example whose After adds a fact absent from its Before is rewritten to use the marker (decided by default - revisit with portfolio skill maintainer). Source: portfolio-feedback L32, L106, L140.
- **R2 — judgment first.** The Output Template's first block is the verdict/judgment; evidence and details follow and are cited, not restated. Source: portfolio-feedback L29-30, L88-89.
- **R3 — description** starts with "Use when" and states triggers only.
- **R4 — scenarios** 2-3 EN and 2-3 KR.
- **R5 — section order** `## Process` → `## Output Template` → `## What Claude Does / What You Do` → `## Related Skills`, and Related Skills is the last section: Stage/Step/Rules sections that sit after it today move ahead of it. "When to Use" is kept only as a short "Not for" line like portfolio-feedback. The output heading is `Output Template`, not `Output` (all three decided by default - revisit with portfolio skill maintainer).
- **R6 — no background.** No `Why ... Fails`, Overview or Background section.
- **R7 — length.** `wc -w` of SKILL.md ≤ the current count (words, not lines; the CLAUDE.md 70% target is not applied — decided by default - revisit with portfolio skill maintainer).
- **R8 — keep capabilities.** Every capability in the story's keep-list survives unless it contradicts R1-R7 or the story's own acceptance.
- **R9 — scope.** Only `portfolio/skills/<name>/` changes.

Applicability of the two conditional bar items (decided by default - revisit with portfolio skill maintainer): the `[확정]` ledger applies only where multi-turn use is evident in the skill — portfolio-rewrite, portfolio-interview, job-application-workflow. The boundary rule applies only where a numeric threshold exists — portfolio-pattern. portfolio-jd and portfolio-company score X/10 but state no numeric cut-off, so the boundary rule is N/A for them (F§5).

### US-1 — resume-tailorer (`portfolio/skills/resume-tailorer/SKILL.md`)

As a candidate tailoring my 이력서 to one JD, I want every rewrite to keep only facts I gave, so that I can defend each line in 면접.

Acceptance:
1. R1 in Standing Mandates, and the "reframe every achievement that lacks a number" instruction (L160-163) becomes "reframe the shape; a missing number is `[확인 필요: ○○]`".
2. The Keyword Alignment and Achievement Reframing examples (L148-158: "150만", "35% 개선", "2주에서 하루로") are rewritten so the After adds no number, tool or scope absent from the Before; the gaps are `[확인 필요: ...]`.
3. The rewriting-mode guard of portfolio-feedback (오타·용어·모순 only) is not imported; this skill rewrites, bound by R1 (default - revisit with portfolio skill maintainer).
4. R2: Output Template opens with a one-line verdict of JD fit (e.g. the number of Missing/Weak must-haves and the top change), then JD Analysis Summary → Gap Analysis → Section Rewrites → What NOT to Change.
5. R3-R7; baseline 1362 words. R4 today: 3 EN + 2 KR, already compliant. `## Why Generic Resumes Fail` removed; `## What This Skill Does Not Do` folded into a Not-for line or Rules ahead of Related Skills.
6. No `[확정]` ledger (single-pass skill). No boundary rule (no numeric threshold).
7. R8 keep-list: JD keyword analysis (skill frequency, soft-skill signals, responsibility verbs, implicit culture signals); Missing/Weak/Strong gap table; hidden strengths; de-emphasis candidates; Before/After per section; XYZ reframing; skills reorder; summary rewrite; What NOT to change; pointers to `portfolio/references/ats-rules-korea.md` and `korea-company-culture-signals.md`; sequential-thinking note.
8. Check: `grep -c '확인 필요'` ≥ 1; `grep -E '150만|35%|2주에서 하루'` finds nothing; R9.

### US-2 — portfolio-rewrite (`portfolio/skills/portfolio-rewrite/SKILL.md`)

As a candidate rewriting my 포트폴리오 section by section, I want each rewrite to mark what only I can fill and to remember what we already settled, so that I am not asked the same thing twice or handed numbers I never had.

Acceptance:
1. R1 replaces "request them before rewriting / ask first" as the only move: the rewrite is produced with `[확인 필요: ○○]` in place of the missing number or role scope, and the question is listed after. The Weak/Strong teaching pairs ("p99 900ms → 140ms", "40분 → 3분") either keep the Weak side's facts or become `[확인 필요]` (R1 example rule).
2. `[확정]` ledger: in a continuing session the skill restates the `[확정]` list (excluded items, kept wording, numbers already judged over-claimed) before new work and checks each proposal against it; nothing on it is re-proposed. Wording follows portfolio-feedback L34, L54.
3. The pattern call-out ("call it out once as a pattern") is recorded in `[확정]` so it is not repeated in later turns.
4. The writing-mode guard is not imported (default - revisit with portfolio skill maintainer); R1 bounds it.
5. R2: Output Template opens with the one-line diagnosis of the weakest element, then Before / After / 왜 더 강해졌는가.
6. R3-R7; baseline 910 words. Stage 1, Stage 2, Rewriting Principles and Rules move ahead of Related Skills.
7. No boundary rule (no threshold).
8. R8 keep-list: weak-element diagnosis with think-tool; XYZ+S target shape; five techniques (specificity, ownership language, decision not action, outcomes not activities, conflict and resolution); same-language output; offer continuation for more sections.
9. Check: `grep -c '확인 필요'` ≥ 1; `grep -c '확정'` ≥ 1; R9.

### US-3 — portfolio-jd (`portfolio/skills/portfolio-jd/SKILL.md`)

As a candidate deciding whether to apply to one posting, I want the 서류 통과 verdict first, so that I can decide in one screen.

Acceptance:
1. R1 is already present (Mandate L38); kept, and the 갭 분석 / 포지셔닝 blocks follow it (no suggested number the portfolio lacks).
2. R2: Output Template reorders to 서류 통과 가능성 (통과 / 경계 / 스크린아웃 + the one swing factor) and 지원 여부 조언 first, then 종합 매칭 점수, 강한 매칭, 갭 분석, 포지셔닝, 역할 해석. Front blocks cite gap IDs, not restate them.
3. Boundary rule: N/A (no numeric cut-off). The verdict label 경계 is kept; the `경계 (값, 기준)` marker is not introduced here (default - revisit with portfolio skill maintainer).
4. Output language becomes the user's language, replacing "Write in Korean" (default - revisit with portfolio skill maintainer).
5. No `[확정]` ledger (multi-turn not evident).
6. R3-R7; baseline 1762 words. R4 today 3 EN + 2 KR, compliant. Rules that repeat Standing Mandates are merged, not duplicated.
7. R8 keep-list: independent JD then portfolio profiles (think-tool); must-have / nice-to-have with the JD line quoted; company size/stage weighting; adjacent ≠ exact; 치명적 / 보완 가능 / 마이너 severity with mcp-reasoner beam; positioning advice; mcts pass/borderline judgment with one swing factor; apply/don't-apply advice; 스크린아웃 as legitimate output; closing tally line (L40); skills-list-is-not-evidence and quote-both-sides mandates.
8. Check: first block of Output Template names 통과/경계/스크린아웃; `grep -c 'Write in Korean'` = 0; R9.

### US-4 — portfolio-interview (`portfolio/skills/portfolio-interview/SKILL.md`)

As a candidate in a mock 기술 면접, I want coaching that shows a stronger shape without inventing my outcomes, and that remembers what we settled between questions.

Acceptance:
1. R1 in the coaching note and in the closing `[보완이 필요한 답변]` block: "what a stronger version would have looked like" gives the structure and marks the candidate's missing number/outcome as `[확인 필요: ○○]`.
2. `[확정]` ledger: across questions and in a continuing session the skill keeps and restates a `[확정]` list (persona chosen, stories already judged, numbers already challenged) and does not re-ask or reopen them.
3. R2: the closing feedback opens with `[인터뷰 총평]` including the would-you-advance judgment in one line (already first; kept first).
4. No boundary rule (no numeric threshold).
5. R3-R7; baseline 1089 words. Stages 1-4 and Rules move ahead of Related Skills; closing feedback becomes the Output Template.
6. R8 keep-list: sequential-thinking interview plan; personas A-D (or inherited from portfolio-feedback); five question types with Korean examples; in-character opening without question preview; one-question-at-a-time and one-push-back rule; private coaching note; think-tool on ambiguous answers; 5-7 question wrap-up; 4-block closing feedback.
7. Check: `grep -c '확인 필요'` ≥ 1; `grep -c '확정'` ≥ 1; R9.

### US-5 — interview-prep (`portfolio/skills/interview-prep/SKILL.md`)

As a candidate with a 면접 date, I want a study plan and STAR prompts built from my own stories, so that I prepare, not memorise answers someone wrote for me.

Acceptance:
1. The Output Template is replaced by the Plan Template's shape: week-by-week plan with milestones, topic priority list, STAR story prompts (6-8), final-week checklist. The question bank, written STAR responses and clarity/specificity/impact scoring are removed as the contradicting half (default - revisit with portfolio skill maintainer).
2. R1: STAR prompts ask for the candidate's own situation/result; any missing fact in context (interview date, target company type, weak area) is `[확인 필요: ○○]`, and the existing "never a generic plan without the interview date" mandate stays.
3. R2: the Output Template opens with the one-line judgment of the plan (weeks available and the top-priority weak area).
4. No `[확정]` ledger (multi-turn not evident beyond context gathering). No boundary rule.
5. R3-R7; baseline 1406 words. `## Why Generic Prep Fails` removed. R4 is already 3 EN + 2 KR. The description's trigger list is English only (L7-8); adding Korean triggers is allowed within R7 but not required (default - revisit with portfolio skill maintainer).
6. R8 keep-list: 5-question context gathering without re-asking; company-type calibration (FAANG / Korean Tier-1 / Growth startup / Enterprise-Fintech); weak-area assessment across coding, system design, behavioral; week plan; topic priority; STAR prompts; final-week guidance; `references/study-domains.md` pointer; sequential-thinking ordering.
7. Check: `grep -ciE 'question bank|STAR responses'` = 0; `grep -c '확인 필요'` ≥ 1; R9.

### US-6 — portfolio-company (`portfolio/skills/portfolio-company/SKILL.md`)

As a candidate with no JD yet, I want the best-fit company types first and no fit claim resting on company facts nobody gave, so that I target the right 회사 유형.

Acceptance:
1. R2: Output Template opens with Top 2 company types and the type to avoid, then 핵심 신호, 회사 유형별 핏 분석, 포지셔닝 제안.
2. R1: company signals (engineering blog, postings, stack) are user-supplied; when absent they are `[확인 필요: ○○]`, and the "ALWAYS read company signals" mandate is reworded accordingly (default - revisit with portfolio skill maintainer). The candidate's non-negotiables (location, domain, stack) are asked for or marked `[확인 필요]` before scoring; 지원 전 보완할 것 / 포지셔닝 제안 never supplies a number the portfolio lacks.
3. Output language is the user's language, replacing "Write in Korean"; the Stage 2 hard-coded "5+ year Korean backend engineer" is replaced by the candidate profile from Stage 1 (default - revisit with portfolio skill maintainer).
4. Boundary rule: N/A (X/10 with no numeric cut-off). No `[확정]` ledger.
5. R3-R7; baseline 1293 words.
6. R8 keep-list: portfolio characterization (think-tool); 5 company-type profiles with what-they-look-for / green / red flags; per-type score + strong/weak reason + one action; Top 2 and worst fits; 2-3 positioning changes; "can apply vs strong mutual fit"; specific-company reasoning when names are given.
7. Check: first block names Top 2; `grep -c 'Write in Korean'` = 0; `grep -c '확인 필요'` ≥ 1; R9.

### US-7 — portfolio-pattern (`portfolio/skills/portfolio-pattern/SKILL.md`)

As a candidate reading cross-document patterns, I want a pattern flagged only when it clearly passes its threshold, so that I do not rewrite my 포트폴리오 over a 58% against ~60%.

Acceptance:
1. Boundary rule: the ~20% decision-verb and 60% number-free thresholds are labelled provisional (set from eval fixtures, not screening research, not presented as industry numbers). A flag fires only when the value is ≥10 points past the threshold and moving one entry would not bring it back; otherwise the tally says `경계 (58%, 기준 ~60%)` and no flag is raised. Same wording as claim-and-consistency.md §F (default - revisit with portfolio skill maintainer).
2. R1: the fix example "'팀에서 Kafka를 도입했습니다' → '대안 3안을 비교해 Kafka를 채택했습니다'" is rewritten so "대안 3안" becomes `[확인 필요: 검토한 대안]`; 패턴별 개선 제안 never adds a fact.
3. R2: Output Template opens with the one-line signal verdict (today last, 시그널 요약) and the most important finding, then per-dimension analysis, Top 3, fixes.
4. No `[확정]` ledger.
5. R3-R7; baseline 1276 words. Adds a Rules/Standing Mandates block only within the word budget.
6. R8 keep-list: six dimensions (subject audit, agency language, number density, failure narrative, decision visibility, verb energy); think-tool per dimension; mcp-reasoner 3-beam ownership classification; ratios; Top 3 with quotes; per-pattern fix; signal summary; no 저는/제가 rate (224957b).
7. Check: `grep -c '경계'` ≥ 1; `grep -c 'provisional\|잠정'` ≥ 1; `grep -c '대안 3안'` = 0 unless inside `[확인 필요]`; R9.

### US-8 — job-application-workflow (`portfolio/skills/job-application-workflow/SKILL.md`)

As a candidate running the whole 이직 준비 sequence across sessions, I want each step to describe what that step's skill really gives me and to carry settled decisions forward, so that I do not wait for a cover letter that never comes.

Acceptance:
1. Keeps 4 steps; each description matches its sub-skill: Step 1 portfolio-jd needs portfolio + JD; Step 2 portfolio-company scores the portfolio against company types (no company research, no Glassdoor/LinkedIn input); Step 3 resume-tailorer (+ portfolio-rewrite when a 포트폴리오 is in play, as today) produces tailored 이력서 sections and rewritten 포트폴리오 passages (no cover letter); Step 4 interview-prep produces a study plan and STAR prompts (not questions + answers; mock practice is portfolio-interview in Related Skills). portfolio-feedback and portfolio-interview stay adjacent, not steps (default - revisit with portfolio skill maintainer).
2. `[확정]` ledger: State Tracking carries a `[확정]` list across steps and sessions (target role, excluded companies/projects, numbers already judged) and restates it on entry at any step.
3. R1: facts missing between steps (e.g. the JD for Step 1) are `[확인 필요: ○○]`, never assumed.
4. R2: Output Template opens with where the candidate is and the next step's verdict/decision.
5. R3-R7; baseline 604 words. `## Workflow Overview` / `## Steps` become `## Process`; `## Output Template` added. R4: today 1 clearly EN ("career transition full process") + 2 KR + 1 mixed ("job application workflow 시작"); the mixed one is counted as KR, so one EN scenario is added and one KR dropped or kept to stay within 2-3 each (default - revisit with portfolio skill maintainer).
6. No boundary rule.
7. R8 keep-list: 4-step sequence with skip conditions; Step 3's portfolio-rewrite hand-off; mid-process entry; standalone-input substitution table; `think:negotiation` hand-off.
8. Check: `grep -ci 'cover letter'` = 0; `grep -c '확정'` ≥ 1; `grep '^## '` includes Process and Output Template; R9.

## Scope and Non-Goals

In scope: the 8 SKILL.md files named in US-1..US-8, each changed by its own package, plus any file inside that skill's own `portfolio/skills/<name>/` directory (e.g. interview-prep's `references/study-domains.md`).

Non-goals:

- Edits outside each story's own `portfolio/skills/<name>/` directory. In particular `.claude-plugin/marketplace.json`, `portfolio/.claude-plugin/plugin.json`, `portfolio/README.md` and `portfolio/KOR.md` are excluded this sprint; versions and docs are bumped once after the sprint (requester decision; overrides writing-skills step 8).
- portfolio-feedback itself and `portfolio/references/*` — the bar is copied, not changed.
- The writing-mode guard in the rewriting skills (US-1, US-2): they rewrite by purpose; R1 bounds them instead.
- New numeric thresholds or score→verdict cut-offs for portfolio-jd and portfolio-company: none exists in any source, and inventing one is the failure this sprint removes.
- New skills (cover letter, company research): the request is a refresh and the repo has too many skills already; the workflow is corrected to not promise them.
- Sourcing the unsourced heuristics in interview-prep (LeetCode medium in 30 minutes, 45-minute system design) and portfolio-company profiles: kept as they are; not introduced by this sprint.
- Running `skill:skill-trigger-validator` / `skill:skill-quality-assurance`: not installed here. Acceptance is verified by this PRD's per-story checks, `scripts/validate_plugins.py`, and the grep checks (decided by default - revisit with sprint manager).

## Open Questions

No question is left open in this run: it is non-interactive, and each unknown the investigate stage raised (F Unknowns 1-15) was settled by its recommended option and is written above as a rule marked "default - revisit". They are listed here so the owner can revisit them, not as undecided work.

| # | Unknown (F Unknowns) | Rule now in this PRD | Owner |
|---|---|---|---|
| 1 | Length unit / 70% target | Words, ≤ current; 70% not applied (R7) | portfolio skill maintainer |
| 2 | Sections after Related Skills; When-to-Use as background | Move all ahead; When-to-Use → short Not-for line (R5) | portfolio skill maintainer |
| 3 | `Output` vs `Output Template` | `Output Template` (R5) | portfolio skill maintainer |
| 4 | Which skills get `[확정]` | rewrite, interview, workflow only | portfolio skill maintainer |
| 5 | Boundary rule for jd/company; 경계 label clash | N/A; verdict label kept (US-3, US-6) | portfolio skill maintainer |
| 6 | pattern thresholds provisional + boundary rule | Yes, §F wording (US-7) | portfolio skill maintainer |
| 7 | Correct workflow step descriptions; add steps | Correct; keep 4 steps (US-8) | portfolio skill maintainer |
| 8 | interview-prep Output vs Plan Template | Plan Template, STAR prompts only (US-5) | portfolio skill maintainer |
| 9 | Examples that add facts | Rewrite every one (R1) | portfolio skill maintainer |
| 10 | Forced Korean output | User's language (US-3, US-6) | portfolio skill maintainer |
| 11 | Writing-mode guard in rewriting skills | Not imported; R1 applies (US-1, US-2) | portfolio skill maintainer |
| 12 | company signals: web access? | User-supplied or `[확인 필요]` (US-6) | portfolio skill maintainer |
| 13 | "job application workflow 시작" EN or KR | Counted KR; add one EN scenario (US-8) | portfolio skill maintainer |
| 14 | Premise "untouched since late August" | Problem says "lack the 1.13-1.14 rules"; portfolio-jd keeps its story (US-3) | requester |
| 15 | Verification without the gate skills | PRD checks + validate_plugins.py + greps | sprint manager |
