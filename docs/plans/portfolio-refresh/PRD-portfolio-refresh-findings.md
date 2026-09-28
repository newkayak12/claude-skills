# Findings — PRD-portfolio-refresh

Investigate stage for `PRD-portfolio-refresh.md`. Every finding cites the file (and line where useful) it came from. Anything no source settled is under **Unknowns** with an owner — the drafter must carry those into Open Questions, not state them as fact.

Line numbers refer to the file as it stands at HEAD `f3cd5da` on branch `teams/portfolio-refresh`.

## 1. The bar — portfolio/skills/portfolio-feedback/SKILL.md (149 lines, 2028 words)

Last changed: `c22ed42` 2026-09-02 (1.14.0), `a1455e7` 2026-09-02 (1.13.0). The commit message for c22ed42 records the real-session failures it fixed: the verdict came out as the 9th block, resume denominators were applied to a deck, a 58% value fired a flag against a ~60% threshold, one finding appeared four times, and *after the review* blanks were filled with plausible facts, settled decisions were reopened, and the reviewer posture leaked into writing.

These rules are what "the bar" means (quoted from Standing Mandates, L25-42):

- **No invented facts** (L32): "make an improvement specific about *where* and *what shape* — and NEVER supply the fact. When the number, cause, or context is not in the document, write `[확인 필요: ○○]` and stop. No 역산, no candidate values, no plausible-sounding reason written as if it were the candidate's experience." The Output template repeats it in Improvement Priorities (L106). What Claude Does (L140) says: "Leaves missing facts as `[확인 필요]` instead of writing a plausible one" / You: "Fill the blanks — only you know the number".
- **[확정] ledger** (L34): "NEVER reopen a settled decision. In a continuing session keep a `[확정]` list (excluded items, kept items, numbers already judged over-claimed) and check every proposal against it before making it." Process step 0 (L54): "In a continuing session, restate the `[확정]` list before anything else."
- **Judgment first** (L29): "ALWAYS lead with the judgment and push the evidence to the back. 총평 → 점수 → 핵심 취약점 → 우선순위 come first; the audit blocks are an appendix. A reader who stops after four blocks has the review." Output (L88-89): "Judgment first, evidence last; front blocks cite appendix IDs and never restate them."
- **Each finding once, with an ID** (L30): findings live once in the appendix with IDs (`C1`, `A2`, `L1`); front blocks cite the ID.
- **Boundary rule** (L33): "NEVER fire a tally-based red flag on a boundary value. Within 10 points of a provisional threshold, or when one entry moving would cross it, the tally line says `경계 (58%, 기준 ~60%)` and no flag is raised." Fuller statement: `portfolio/skills/portfolio-feedback/references/claim-and-consistency.md` §F L154-165 — thresholds are provisional (set from eval fixtures, "not from screening research"), must not be presented as industry numbers, and a tally-backed flag fires only when ≥10 points past the threshold *and* one entry moving would not bring it back.
- **Writing-mode guard** (L35): "NEVER carry the reviewer posture into writing. When asked to write or rewrite in the candidate's voice ... check 오타 · 용어 오용 · 문서 간 모순 only, and do not add sentences or claims. Real rewriting is `portfolio-rewrite`."
- **Skills list is not evidence** (L36); **number without baseline is not a claim** (L37, 완전 주장 = 수치·베이스라인·기간·기여 범위); **read level from bullets, not years/title** (L38).
- **Format detection first** (L31): 이력서 vs 포트폴리오 덱/문서 decides the measure set.
- **One re-countable tally line** at the end (L42).

Structural observations about the bar itself (relevant because the PRD tells engineers to copy its shape):
- It has a `# Portfolio Feedback` intro paragraph (L44-48) between Standing Mandates and Process — a descriptive summary, arguably "background".
- Its output section is titled `## Output` (L86), not `## Output Template`.
- Sections: Standing Mandates → Process → Output → What Claude Does / What You Do → Related Skills; nothing after Related Skills.
- Scenarios: 3 EN + 3 KR (L9-14). Description starts "Use when" (L5).

## 2. Authoring rules — write/skills/writing-skills/SKILL.md (146 lines) and repo CLAUDE.md

- writing-skills Process step 3: `description` "opens with 'Use when' and states triggering conditions only — never a summary of what the skill does internally"; `scenarios` 2-3 EN, 2-3 KR; `compatibility` only if an MCP tool genuinely changes the outcome.
- Step 4: body order `Process`, `Output Template`, `What Claude Does / What You Do`, `Related Skills` — "other sections may sit between them, but these four stay in that sequence and nothing titled Overview or Background sits ahead of `Process`." It does not say whether sections may follow `Related Skills`.
- Step 8 says ship housekeeping bumps `.claude-plugin/marketplace.json` and README — **overridden for this sprint by the requester** (decided by the requester in this task's context): do NOT touch `.claude-plugin/marketplace.json`, `portfolio/.claude-plugin/plugin.json`, `portfolio/README.md`, `portfolio/KOR.md`; versions/docs are bumped once after the sprint.
- Step 6 gates (`skill:skill-trigger-validator`, `skill:skill-quality-assurance`) — neither is in this session's available skill list; not reachable here.
- Repo `CLAUDE.md` "Skill Authoring Rules": "No background explanations — skill name is the context"; "Target: 70% of current average length"; every skill needs Process → Output Template → What Claude Does / What You Do → Related Skills.
- `scripts/validate_plugins.py` checks only that description contains "Use when" (L11, L183) and that `scenarios` is present (L191). It does not check scenario counts, section order, or length. Currently PASSES for all 14 plugins.
- `.claude/conventions/` referenced by writing-skills does not exist in this worktree.

## 3. Requester-decided acceptance (from the task context — decided by the requester)

For every item: no invented facts via `[확인 필요: ○○]` (example: resume line "API 응답속도 개선" with no metric → `[확인 필요: 개선 전/후 수치]`, never "40% 개선"); `[확정]` list kept and restated in continuing sessions *where the skill has multi-turn use*; verdict first, details after; no red flag on a boundary value *where the skill scores against a threshold*; writing-skills authoring rules; "not longer than it is now"; keep every existing capability not contradicted; edit only the skill's own directory.

## 4. Target skills — current state

Last-touched dates from `git log -1 -- portfolio/skills/<name>`. Line counts / words from `wc`.

| Skill | Lines / words | Last commit | Supporting files |
|---|---|---|---|
| resume-tailorer | 225 / 1362 | 4e62239 2026-08-30 (description repair only) | none; points to `portfolio/references/korea-company-culture-signals.md`, `ats-rules-korea.md` (both exist) |
| portfolio-rewrite | 131 / 910 | 439bfca 2026-08-31 (added XYZ+S principle) | none |
| portfolio-jd | 222 / 1762 | **a590df9 2026-09-10** (added Standing Mandates incl. `[확인 필요]`, 1.14.1) | none |
| portfolio-interview | 180 / 1089 | 4e62239 2026-08-30 | none |
| interview-prep | 218 / 1406 | 4e62239 2026-08-30 | `references/study-domains.md` |
| portfolio-company | 208 / 1293 | 4e62239 2026-08-30 | none |
| portfolio-pattern | 190 / 1276 | 224957b 2026-09-01 (dropped 저는/제가 rate for decision-verb rate) | none |
| job-application-workflow | 127 / 604 | 4e62239 2026-08-30 | none |

**Premise correction:** the request says the others "have not been touched since late August". True for 5 of 8. portfolio-rewrite (08-31) and portfolio-pattern (09-01) were touched just before 1.13/1.14 (09-02) and neither got the 1.14 rules. portfolio-jd was touched *after* 1.14 (09-10) and already has part of the bar. The Problem statement should say "lack the 1.13-1.14 rules" and not claim all eight are untouched since August.

**Shared structural pattern (7 of 8):** a short summary block (When to Use → Process → Standalone Inputs → What Claude Does / What You Do → Related Skills) at the top, then the detailed Stage/Step sections, output section, and Rules *after* Related Skills. None of the 8 has a section titled `Output Template` in the required position except interview-prep. `grep` shows 0 occurrences of `[확정]` in all 8, and 0 of `확인 필요` in 7 of 8 (portfolio-jd has 1).

### resume-tailorer
- Frontmatter: description "Use when" ✓; scenarios 3 EN + 2 KR ✓ (L9-13).
- Mandates (L25-28): "never invent or inflate achievements"; "NEVER alter achievement numbers, scope claims, or timeline facts". No `[확인 필요]` convention.
- **Its own examples contradict its mandate and the bar:** Step 4 Keyword Alignment (L148-151) turns "백엔드 API 개발 및 성능 최적화" into "일 활성 사용자 150만 규모 ... 병목 구간 35% 개선" — numbers not in the Before. Achievement Reframing (L157-158) turns "레거시 시스템 마이그레이션 참여" into "배포 주기를 2주에서 하루로 단축 (Jenkins ...)". L160-163 tells Claude to reframe every achievement that "Lacks a number". This is exactly the "API 응답속도 개선 → 40% 개선" failure the requester names.
- Section order: Process (L45) → WCD/WYD (L61) → Related Skills (L70) → then background `## Why Generic Resumes Fail` (L75-79), Workflow Note, Steps 1-4, Culture-fit, ATS, `## Output Format` (L185), `## What This Skill Does Not Do` (L217). Output comes after Related Skills; background section present.
- Output (L187-213): JD Analysis Summary → Gap Analysis → Section Rewrites → What NOT to Change. No verdict line up front.
- Single-turn by its Process; asks for missing resume/JD (L102). No threshold scoring (gap table uses Missing/Weak/Strong labels only).
- Capabilities to keep: JD keyword analysis (skills frequency, soft-skill signals, responsibility verbs, implicit culture signals), gap table Missing/Weak/Strong, hidden strengths, deemphasis candidates, Before/After per section, XYZ reframing, skills reorder, summary rewrite, "what NOT to change", culture-signal + ATS reference pointers, sequential-thinking note.

### portfolio-rewrite
- Frontmatter: "Use when" ✓; scenarios 3 EN + 2 KR ✓. No `effort` field (the others except pattern/workflow have `effort: high`).
- No Standing Mandates section.
- Fact handling: Process step 2 (L265 in combined read; file L40) "if numbers or role scope are absent, request them before rewriting"; Rules "ask first. Don't make up metrics." No `[확인 필요]` placeholder — its only move is to ask, so a rewrite either stalls or is produced without a marker.
- Rewriting Principles use illustrative Weak/Strong pairs with numbers (e.g. "p99 900ms → 140ms", "40분 → 3분") — these are generic teaching examples, not claims about the user, but they show the Strong version always carrying a number.
- **Multi-turn:** Process step 5 "Offer continuation — invite the user to paste additional sections"; Rules: offer "이 외에 고치고 싶은 섹션이 있으면 붙여넣어 주세요." Rules also: "If the entire portfolio is weak in the same way, call it out once as a pattern" (cross-turn memory implied).
- Output: Before / After / 왜 더 강해졌는가 per passage (Stage 2). No verdict line.
- Section order: Process → WCD/WYD → Related Skills → Stage 1, Stage 2, Rewriting Principles, Rules after. No Output Template heading.
- portfolio-feedback L35 names portfolio-rewrite as where "real rewriting" happens.
- Capabilities to keep: diagnosis of the weak element, think-tool diagnosis, XYZ+S target shape, five techniques (specificity, ownership language, decision not action, outcomes not activities, conflict and resolution), same-language output, pattern call-out.

### portfolio-jd
- Frontmatter: "Use when" ✓; scenarios 3 EN + 2 KR ✓; `effort: high`.
- Already at the bar on: `[확인 필요: ○○]` (Mandate L38), skills list ≠ evidence (L36), quote both sides (L34), end tally line (L40: `판정 <통과|경계|스크린아웃> · 5개 차원 n/10 · 치명적 n · 보완 가능 n · 마이너 n · must-have 미충족 n/m`).
- **Scores against thresholds:** 5 fit dimensions X/10 + 종합 X/10; verdict 통과 / 경계 / 스크린아웃; gap severity 치명적 / 보완 가능 / 마이너. No numeric threshold is stated for how scores map to the verdict, and no boundary rule. "경계" here is a verdict label, not the portfolio-feedback boundary marker — the two meanings would collide.
- **Not judgment-first:** Output Structure (L148-214 of file): 역할 해석 → 종합 매칭 점수 → 강한 매칭 → 갭 분석 → 포지셔닝 → 서류 통과 가능성 → 지원 여부 조언. The verdict is block 6 of 7.
- Output language forced: "Write in Korean" (bar says "Write in the user's language").
- Section order: When to Use → Process → WCD/WYD → Related Skills → Stages → Fit Dimensions → Output Structure → Rules (Rules repeat the Mandates).
- Multi-turn: not stated in the skill.
- Capabilities to keep: independent JD then portfolio profiles (think-tool required), must-have/nice-to-have split with the JD line cited, company size/stage weighting, adjacent ≠ exact, 3-tier gap severity with mcp-reasoner beam, positioning advice, mcts pass/borderline judgment and the one swing factor, apply/don't-apply advice, 스크린아웃 as legitimate output.

### portfolio-interview
- Frontmatter: "Use when" ✓; scenarios 3 EN + 2 KR ✓. No `effort` field. No Standing Mandates.
- **Clearly multi-turn:** one question at a time, wait for answer, coaching note after each, wrap up after 5-7 questions (Stage 3).
- Fact risk: closing block `[보완이 필요한 답변]` asks for "what a stronger version would have looked like" — the place where an invented number/outcome would be written into the candidate's answer. Nothing forbids it today.
- Judgment: closing `[인터뷰 총평]` "Would you advance this candidate?" comes first in the closing block ✓, but no explicit verdict scale (e.g. 통과/경계/탈락) and no threshold scoring.
- Personas A-D (Staff Eng / EM Startup / Enterprise TL / OSS DevTools) — same four as portfolio-feedback `references/personas.md`.
- Section order: Process → WCD/WYD → Related Skills → Stages 1-4 → Rules. No Output Template heading.
- Capabilities to keep: sequential-thinking interview plan, persona selection (or inherit from portfolio-feedback), five question types with Korean examples, in-character opening without question preview, one-push-back rule, private coaching note block, think-tool on ambiguous answers, 4-block closing feedback.

### interview-prep
- Frontmatter: "Use when" ✓; scenarios 3 EN + 2 KR ✓; **trigger list is English only** ("interview prep plan", L7-8) while two scenarios are Korean.
- Mandates L26-29 include "NEVER generate a generic study plan without knowing the candidate's interview date."
- **Internal contradiction:** `## Output Template` (file L64-70) lists question bank (10-15 questions) / STAR responses "with specific examples" / feedback scoring "on clarity, specificity, and impact" / improvement plan — but Process and Step 4 Plan Template produce a week-by-week plan, topic priority list, STAR *prompts*, final-week checklist, and the description says "This is planning, not practice." The Output Template describes a different skill.
- Fact risk: "STAR responses — structured answers ... with specific examples" would require writing the candidate's stories for them.
- Background section `## Why Generic Prep Fails` (file L87-91) after Related Skills.
- Company calibration (FAANG / Korean Tier-1 / Growth startup / Enterprise-Fintech) and "LeetCode medium in 30 minutes", "45 minutes" system design scoping — these are unsourced heuristics inside the skill (not introduced by this sprint).
- Multi-turn: Step 1 "Do not ask for information already given" — gathering context may span turns; no explicit continuing-session use.
- Threshold scoring: none except the Output Template's "scoring on clarity, specificity, and impact" (no scale).
- Capabilities to keep: context gathering (5 questions), company-type calibration, weak-area assessment across coding/system design/behavioral, week-by-week plan with milestones, topic priority list, STAR story bank (6-8 prompts), final-week guidance, `references/study-domains.md` pointer, sequential-thinking ordering.

### portfolio-company
- Frontmatter: "Use when" ✓; scenarios 3 EN + 2 KR ✓; `effort: high`.
- Mandates L26-29: "ALWAYS read company signals (engineering blog, job postings, tech stack) before scoring fit" — whether the skill has any tool to read these is not stated; "NEVER score fit without knowing the candidate's non-negotiables (location, domain, stack)" — but Standalone Inputs asks only for the portfolio and optional company names.
- **Scores:** 핏 점수 X/10 per company type (5 types listed; WCD says "Scores fit across 5 company types"). No threshold stated for what counts as Top 2 / avoid; no boundary rule.
- Output Structure: 핵심 신호 → 회사 유형별 핏 분석 → Top 2 → 피해야 할 유형 → 포지셔닝 제안. Top-2 verdict is block 3; not judgment-first.
- "Write in Korean" forced. Stage 2 hard-codes "a 5+ year Korean backend engineer".
- Fact risk: 지원 전 보완할 것 / 포지셔닝 제안 can suggest adding numbers the portfolio lacks.
- Section order: Process → WCD/WYD → Related Skills → Stages → Company Type Profiles → Output Structure → Rules.
- Capabilities to keep: portfolio characterization (think-tool), 5 company-type profiles with what-they-look-for / green / red flags, per-type score + strong/weak reason + one action, Top 2 and worst fits, 2-3 positioning changes, "can apply vs strong mutual fit" distinction, specific-company reasoning.

### portfolio-pattern
- Frontmatter: "Use when" ✓; scenarios 3 EN + 2 KR ✓. No `effort` field. No Standing Mandates.
- **Scores against thresholds:** decision-verb ratio "Under ~20% is the signal worth calling out" (Subject Audit); number-free impact claim rate "For a 5+ year portfolio ... above 60% is a problem" (Number Density). No boundary rule; thresholds not labelled provisional; no source for either number in the skill.
- Already aligned with portfolio-feedback on not measuring the 저는/제가 rate (224957b, 2026-09-01) — portfolio-feedback L60 says the same.
- Output Structure: 패턴 분석 요약 ("Start with the most important finding") → 항목별 분석 → Top 3 → 패턴별 개선 제안 → 시그널 요약. Summary-first already, but the one-line signal/verdict is last.
- Fact risk: 패턴별 개선 제안 example rewrites "'팀에서 Kafka를 도입했습니다'를 '대안 3안을 비교해 Kafka를 채택했습니다'로" — "대안 3안" is a fact not in the original.
- Section order: Process → WCD/WYD → Related Skills → Stages → Dimensions → Output Structure (ends the file; no Rules).
- Multi-turn: not stated.
- Capabilities to keep: six dimensions (subject audit, agency language, number density, failure narrative, decision visibility, verb energy), think-tool per dimension, mcp-reasoner 3-beam ownership classification, ratios, Top 3 patterns with quotes, per-pattern concrete fix, signal summary.

### job-application-workflow
- Frontmatter: "Use when" ✓; `type: workflow`, `theme`, `estimated_time`; scenarios are 2 KR ("이직 준비 전체 프로세스 해줘", "취업 준비 처음부터 끝까지") + 1 EN ("career transition full process") + 1 mixed ("job application workflow 시작") — whether that is 2 EN or 1 EN is ambiguous.
- No `## Process` heading (uses `## Workflow Overview` + `## Steps`); no `## Output Template`. Has WCD/WYD and Related Skills.
- One-line intro "4-step career transition process: analyze → research → tailor → prepare."
- **Multi-turn by design:** `## State Tracking` — joins at whatever step the user is on. No `[확정]` carry-over between steps.
- **Step descriptions contradict the sub-skills as they exist now:**
  - Step 2 says `portfolio-company` does "Company research ... culture, growth stage, pain points, and decision-makers", input "Company name + any public info (Glassdoor, LinkedIn, news)", output "Company profile, culture signals, talking points, red flags". The actual portfolio-company scores the *portfolio* against company *types* without a JD.
  - Step 3 output "cover letter draft" — no portfolio skill produces a cover letter.
  - Step 4 says `interview-prep` outputs "likely questions + answers"; interview-prep's own description says "planning, not practice"; WCD row "Mock interview questions + answers" matches portfolio-interview, which is not a step.
  - Step 1 = portfolio-jd, which requires a portfolio *and* a JD; the step asks only for the JD.
  - portfolio-feedback and portfolio-pattern are only "Adjacent", not steps.
- Threshold scoring: none of its own.
- Capabilities to keep: 4-step sequence with skip conditions, state tracking / mid-process entry, standalone-input substitution table, `think:negotiation` hand-off.

## 5. Which bar items apply where (only what the sources show)

| Skill | Multi-turn evident in SKILL.md? | Threshold scoring evident? |
|---|---|---|
| resume-tailorer | No (single pass) | No numeric threshold |
| portfolio-rewrite | Yes — "offer continuation", paste more sections | No |
| portfolio-jd | Not stated | Yes — X/10 scores, 통과/경계/스크린아웃, but no numeric cut-off written |
| portfolio-interview | Yes — Q&A loop | No numeric |
| interview-prep | Possibly (context gathering), not stated | No numeric |
| portfolio-company | Not stated | Yes — X/10 per type, no cut-off written |
| portfolio-pattern | Not stated | Yes — ~20% decision-verb, 60% number-free |
| job-application-workflow | Yes — State Tracking across steps | No |

## Unknowns (carry to Open Questions — owner: portfolio skill maintainer unless noted)

1. Does "not longer than it is now" mean lines or words, and does the CLAUDE.md "70% of current average length" target apply here?
2. Must the detailed Stage/Step/Output/Rules sections that currently sit *after* Related Skills move ahead of it (writing-skills is silent on sections after Related Skills)? Does "When to Use / When Not to Use" count as background ahead of Process?
3. Output heading name: `Output Template` (writing-skills, CLAUDE.md) vs `Output` (the bar skill itself)?
4. Which skills get the `[확정]` ledger: only those with evident multi-turn use (rewrite, interview, workflow), or also jd/company/pattern/tailorer when re-run in the same session?
5. Boundary rule for portfolio-jd and portfolio-company: they have no numeric thresholds; is the rule N/A, or should a score→verdict mapping be added (new rule, not in any source)? Also the label clash: portfolio-jd's verdict "경계" vs the boundary marker `경계 (값, 기준)`.
6. portfolio-pattern's ~20% and 60% thresholds have no stated source — mark them provisional like §F? Apply the same 10-point / one-entry boundary rule?
7. Should the workflow's step descriptions be corrected to match the sub-skills (portfolio-company is type-fit not company research; no cover letter; interview-prep is planning) — "keep every capability" vs "don't describe capabilities that don't exist"? Should portfolio-feedback / portfolio-interview become steps?
8. interview-prep's Output Template vs Plan Template contradiction — which one is the capability to keep?
9. resume-tailorer / portfolio-rewrite / portfolio-pattern illustrative examples: must every example that adds a number or fact to the Before be rewritten with `[확인 필요: ...]`, or only rules text? (resume-tailorer's are clearly contradicting; rewrite's Weak/Strong pairs are generic teaching.)
10. Language: portfolio-jd and portfolio-company force "Write in Korean"; the bar writes in the user's language. Change or keep?
11. Should the writing-mode guard (portfolio-feedback L35: check 오타·용어·모순 only, add no sentences or claims) be carried into portfolio-rewrite / resume-tailorer, whose purpose *is* rewriting? Sources only define it for the reviewer skill.
12. portfolio-company's "ALWAYS read company signals (engineering blog ...)" — is web access expected, or is this user-supplied input?
13. job-application-workflow scenarios: does "job application workflow 시작" count as EN? (Affects whether a 2nd/3rd EN scenario is required.)
14. The request's premise "not touched since late August": portfolio-jd was changed 2026-09-10 — owner: requester — confirm the Problem wording and that portfolio-jd still gets a story (the backlog lists it at priority 2).
15. The two gate skills writing-skills defers to (`skill:skill-trigger-validator`, `skill:skill-quality-assurance`) are not installed in this session — how is acceptance verified per package (manual checklist, validate_plugins.py, evals)? Owner: sprint manager.
