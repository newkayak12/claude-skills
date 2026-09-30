# Findings — PRD-portfolio-consolidate

Investigate stage for `_repo/docs/plans/portfolio-consolidate/PRD-portfolio-consolidate.md`.
Tree read at HEAD `cbdfcd6` (branch `teams/portfolio-consolidate`, portfolio plugin.json version 2.1.0).
Every finding cites the file (and line where useful) it came from. Anything no source settles is under **Unknowns** with an owner; it must go into the PRD's Open Questions, not be decided in prose.

Line-number note: citations marked (L…) in the portfolio-company keep-list, the portfolio-rewrite keep-list (PR*) and the portfolio-pattern subsection were taken from a concatenated read; subtract 137 (portfolio-company), 141 (portfolio-rewrite) or 149 (portfolio-pattern) to get the in-file line. jd-fit, resume-tailorer, portfolio-feedback, workflow and §4 reference-site line numbers are in-file.

## 0. Requester decisions (decided by the requester in the task context — not open)

- D1. Four backlog items, priority 0-3: `fit` merge, `portfolio-rewrite` absorbs `resume-tailorer`, new `portfolio-feedback-beta`, `job-application-workflow` rewire.
- D2. The merged skill's directory/name is `portfolio/skills/fit` (request text: "one new skill portfolio/skills/fit"). Not an open question.
- D3. Delete `portfolio/skills/jd-fit`, `portfolio/skills/portfolio-company`, `portfolio/skills/resume-tailorer`. Merged skills "keep every capability either had".
- D4. `portfolio-feedback` and `portfolio-pattern` stay UNCHANGED; beta is a lane; promotion is the user's call later; beta must not regress feedback's verdict on the same input.
- D5. Workflow points at `fit`, `portfolio-rewrite`, `mock-interview`, `interview-plan`, `portfolio-feedback`; the 자기소개서/cover-letter step uses `write:writer-verification` draft mode; every experience fact from the user's material, missing ones `[확인 필요]`; no step promises an output no skill produces.
- D6. Judge each deliverable by running it: fresh model + skill + realistic input vs pre-change skill(s) on the same input.
- D7. Fixtures, written under `portfolio/skills/<skill>/evals/` and kept: (a) Korean backend resume/경력기술서 excerpt with one metric-less line ("API 응답속도 개선") and one metric line; (b) JD for a senior backend role at a ~100-person fintech; (c) no JD (company-type path).
- D8. Update every reference to a removed/renamed skill across `portfolio/` (related lists, README.md, KOR.md).
- D9. Do NOT touch `.claude-plugin/marketplace.json` or `portfolio/.claude-plugin/plugin.json` versions (bumped once after the sprint). This overrides `write/skills/writing-skills/SKILL.md` step 8 ("bump the plugin's version").
- D10. `python3 _repo/scripts/validate_plugins.py` must pass.
- D11. The bar = portfolio-feedback Standing Mandates: no invented facts → `[확인 필요: ○○]`, `[확정]` ledger, judgment first, boundary values not flagged.
- D12. Document set = this one PRD (boxed sprint, $40 total).

## 1. Story: fit (merge jd-fit + portfolio-company)

Sources read: `portfolio/skills/jd-fit/SKILL.md` (137 lines), `portfolio/skills/portfolio-company/SKILL.md` (140 lines), `portfolio/README.md` §`jd-fit` (L70-97) and §`portfolio-company` (L99-114), `portfolio/KOR.md` §`jd-fit` (L68-) and §`portfolio-company` (L95-).

### Capability keep-list — jd-fit
- JD1. Build the JD profile before opening the portfolio; build the candidate profile without the JD in view (jd-fit L31, Process 1-2).
- JD2. Split must-have vs nice-to-have before scoring, quoting the JD line behind each; a missing nice-to-have never moves the verdict; a missing must-have is never averaged away (L32).
- JD3. Weight each requirement by company size/stage (L33, Process 1).
- JD4. Quote both sides (JD line + portfolio line) for every match and gap; a one-sided gap is not reported; decode the JD, don't keyword-match (L34).
- JD5. Gap severity 치명적 / 보완 가능 / 마이너 with what closing it takes and how long; mcp-reasoner beam_search beamWidth=3 per gap (L35, Process 5).
- JD6. Judgment first: 서류 통과 가능성 and 지원 여부 조언 first; each gap once in 갭 분석 with ID `G1…`; front blocks cite IDs (L36, Output).
- JD7. `think` on ambiguous match/gap; think required at JD parse and portfolio parse; sequentialthinking for structured comparison (L37, Process 1-3).
- JD8. Skills-list-only technology = gap, not match (L38).
- JD9. Adjacent experience labelled adjacent + the one evidence that would upgrade it (L39).
- JD10. `[확인 필요: ○○]` for any missing number/scale/context, also in 갭 분석 and 포지셔닝; "API 응답속도 개선" → `[확인 필요: 개선 전/후 수치]` (L40).
- JD11. Verdict 통과 / 경계 / 스크린아웃 stated plainly; 스크린아웃 legitimate; 경계 is a label, not a numeric boundary (L41). mcp-reasoner mcts numSimulations=50 for the verdict + one swing factor (Process 7).
- JD12. Five fit dimensions scored /10: 기술 스택, 경험 연차/스케일, 역할 범위, 도메인, 소프트 시그널 (Process 4) + 종합 매칭 점수 X/10.
- JD13. Output blocks in order: 서류 통과 가능성 (+Swing factor) → 지원 여부 조언 → 종합 매칭 점수 → 강한 매칭 포인트 → 갭 분석 → 포트폴리오 포지셔닝 조정 → 역할 해석 → 집계 (L85-121).
- JD14. Closing tally line `판정 <통과|경계|스크린아웃> · 5개 차원 n/10 · 치명적 n · 보완 가능 n · 마이너 n · must-have 미충족 n/m` (L42, L121).
- JD15. 역할 해석: role behind the title, unstated signals, the pain point this hire solves (Process 1, Output L117-118).
- JD16. Standalone inputs: portfolio, full JD, optional company name/stage and role level (L75-79). Write in the user's language (L83).
- JD17. compatibility: recommended think-tool, mcp-reasoner; optional sequential-thinking; `effort: high` (frontmatter).

### Capability keep-list — portfolio-company
- PC1. Company signals (blog, postings, stack) only from what the user supplies; a named company's missing signal → `[확인 필요: ○○]` and reason from the type profile; never present recalled facts as current (L163, L232).
- PC2. Ask for non-negotiables (location, domain, stack) before scoring; if absent, score anyway and mark `[확인 필요: 근무지 / 도메인 / 스택 조건]` in 핵심 신호 (L164).
- PC3. Distinguish 'can apply here' vs 'strong mutual fit here' (L165).
- PC4. No supplied facts; 지원 전 보완할 것 / 포지셔닝 제안 give where + shape only (L166).
- PC5. Never recommend on name recognition alone (L167); never score from general impressions — tie to a portfolio passage (L168).
- PC6. Stage 1 characterize the portfolio with `think`: engineer type (platform builder / product engineer / infra specialist / generalist), strongest and weakest signal, what it doesn't say, candidate profile (unstated → `[확인 필요]`) (L184-194).
- PC7. Stage 2 company-type framework with sequentialthinking (L196-201).
- PC8. Five company-type profiles, each with Looks for / Green flags / Red flags: 대형 플랫폼, 성장기 스타트업 (Series B–D, 50–300명), 핀테크/엔터프라이즈, 글로벌 테크, 개발 도구/플랫폼/OSS; include only relevant types (L203-230).
- PC9. Per type: 핏 점수 X/10, 강한 이유, 약한 이유, 지원 전 보완할 것 (one action) (L245-253).
- PC10. Top 2 fits + type to avoid, judgment first (L238-240).
- PC11. 핵심 신호 3-5 sentences (L242-243).
- PC12. 포지셔닝 제안: 2-3 changes if the target isn't the natural fit (L257-258).
- PC13. Honest about poor fits; `think` when a fit score is unclear (L260-262). Named-company path: list supplied signals used (L255).
- PC14. compatibility: recommended think-tool; optional sequential-thinking; `effort: high`.
- PC15. Named-company trigger ("네이버 지원하려는데 어때?") with no JD (frontmatter description, scenarios).

### Related facts
- jd-fit has a closing tally line; portfolio-company has none (jd-fit L42 vs portfolio-company Output). See Unknown U4.
- The ~100-person fintech JD fixture (D7-b) sits inside portfolio-company's 성장기 스타트업 band (50–300명) and its 핀테크/엔터프라이즈 type (portfolio-company L212, L217) — the no-JD path on the same resume should be expected to reason about both types.
- Combined length 137+140 = 277 lines; `validate_plugins.py` warns (not fails) above 250 lines ("split background content into references/") and, above 200, warns without `effort` or `## Standing Mandates` (validate_plugins.py L199-221). See Unknown U8.

## 2. Story: portfolio-rewrite absorbs resume-tailorer

Sources read: `portfolio/skills/resume-tailorer/SKILL.md` (141 lines), `portfolio/skills/portfolio-rewrite/SKILL.md` (114 lines), README §`resume-tailorer` (L252-277), §`portfolio-rewrite` (L232-), KOR §`resume-tailorer` (L232-), `portfolio/references/ats-rules-korea.md`, `portfolio/references/korea-company-culture-signals.md` (header lines).

### Capability keep-list — resume-tailorer (the JD-tailoring mode)
- RT1. JD keyword analysis before rewriting any section (L25).
- RT2. Gap analysis (current resume vs JD) required before any rewrite; table `JD requires | Resume shows | Gap? (Missing / Weak / Strong)`; high-priority gaps, hidden strengths (same experience in different vocabulary), de-emphasis candidates (L26, L60-69).
- RT3. `[확인 필요: ○○]` for any missing number/cause/date/tool/scope/context; no invention/estimate/역산/candidate values (L27).
- RT4. NEVER alter achievement numbers, scope claims or timeline facts the resume already states (L28).
- RT5. Lead with the JD-fit verdict line `JD 적합도 판정: must-have n개 중 Missing n · Weak n — 최우선 변경: [one change]`; later blocks cite it (L29, L101).
- RT6. Rewrites by purpose — vocabulary, emphasis, order, shape; the fact rule is its only bound (L30).
- RT7. Inputs: resume + full JD required (ask if missing); useful: company name/size/stage, role level, why this company (L40-46).
- RT8. JD analysis: required technical skills (frequency = emphasis), soft-skill/leadership signals, responsibility verbs (reuse where accurate), implicit culture signals (enterprise/chaebol vs startup vs scale) (L48-56); per-company-type table in `portfolio/references/korea-company-culture-signals.md` (L58).
- RT9. Keyword alignment — translate vocabulary, not facts (L75-78).
- RT10. Achievement reframing (XYZ / STAR); reframe passive ("참여했다", "기여했다") and outcome-less bullets; missing number stays `[확인 필요]` (L80-84).
- RT11. Skills section reordered to front-load what the JD names; drop/deprioritize unmentioned skills if space-constrained (L86).
- RT12. Summary/Profile rewrite mirroring the JD's ideal-candidate framing, facts from the resume only (L88).
- RT13. ATS keyword and formatting rules for Korea: `portfolio/references/ats-rules-korea.md` (L90).
- RT14. "What NOT to change" — well-aligned sections left untouched (L92-94, Output).
- RT15. Before/After with actual rewritten text, not suggestions, per section (L73).
- RT16. Output order: 판정 → JD Analysis Summary (5-8 bullets) → Gap Analysis → Section Rewrites (Profile, Experience per role, Skills) → What NOT to Change (L100-126).
- RT17. sequential-thinking optional to enforce JD analysis → gap → rewrite; section rewrites parallel after gap analysis (L38). `effort: high`.

### Capability keep-list — portfolio-rewrite (existing, must survive)
- PR1. `[확정]` ledger restated at start of a continuing session; nothing on it re-proposed (L170, Output L239).
- PR2. Diagnose with `think` before rewriting: intent, weakest element, which XYZ+S letter is absent, fixable by phrasing vs needs candidate facts (L172-175).
- PR3. Rewrite first, then ask; `[확인 필요: ○○]` in place of missing facts; questions listed after (L177, L217).
- PR4. Techniques: XYZ+S shape, specificity, ownership language, decision not just action, outcomes not activities, conflict and resolution — each example holds the same facts on both sides (L187-213).
- PR5. Pattern once — whole-portfolio weakness called out once and recorded in `[확정]` (L181).
- PR6. Continuation offer (L183, L241). Output language = original's (L185).
- PR7. Output per passage: 진단 → Before (verbatim) → After → 왜 더 강해졌는가 (2-4 sentences, technique named) → optional Rewriter note → [확인 필요 질문] → [확정] (L222-239).
- PR8. Writing-mode guard of portfolio-feedback NOT imported (rewrites by purpose, bounded by the marker rule) (L218).
- PR9. No `effort` field today; compatibility optional think-tool (frontmatter).

### Related facts
- portfolio-rewrite already names resume-tailorer as its "Not for … JD keyword matching" boundary (L166) — the absorption direction is the existing boundary.
- resume-tailorer targets an 이력서; portfolio-rewrite targets 포트폴리오 sections (descriptions). The merged scope covers both document types.
- README §resume-tailorer example (L262-277) shows an After that invents facts ("일 활성 사용자 150만 … 35 % 개선") — it violates RT3/D11 and must not be carried into the merged README entry.
- `portfolio/references/ats-rules-korea.md` L3 and `korea-company-culture-signals.md` L3 say "Shared reference for portfolio/ skills (resume-tailorer, portfolio-rewrite, etc.)" — reference sites under D8.

## 3. Story: portfolio-feedback-beta (feedback + pattern measures)

Sources read: `portfolio/skills/portfolio-feedback/SKILL.md` (149 lines), its `references/resume-conventions.md` §2 (L26-42), `references/claim-and-consistency.md` §0, §B, §D, §F, `references/revision-diff.md` L15-32, `evals/evals.json`, `portfolio/skills/portfolio-pattern/SKILL.md` (141 lines), README §portfolio-pattern (L214-).

### What portfolio-feedback already tallies (its tally line, SKILL.md L42 / L131)
`XYZ+S n/m · 완전 주장 n/m · 스킬 근거율 n/m · 날짜 불일치 n · 레벨 갭 ±n · 의사결정 동사 n% (국문일 때) · 불릿/롤 max n`.
- 의사결정 동사 (국문): numerator = 행동 문장 whose verb is 제안·채택·배제·결정·판단; denominator = bullets and summary sentences with an action verb; target ~20%; `제가/저는` not counted (resume-conventions §2 L26-39; revision-diff L18).
- 피동: resume-conventions §2 L33, L38 says to count "피동 문장 수" alongside the decision-verb ratio, but 피동 does NOT appear in feedback's tally line (SKILL.md L42).
- 완전 주장: every outcome bullet checked for 수치·베이스라인·기간·기여 범위; hedge verbs (`기여`, `참여`, `지원`, `함께`) or team subject = attribution missing (claim-and-consistency §B L56-73). It caps the Impact score (§B L75-80).
- XYZ+S: bullets with X, Y (metric), Z, S; denominator every Experience/Projects bullet (revision-diff L17). Not double-counted with 완전 주장 (§B L86-88).
- Boundary rule: flag only ≥10 points past a provisional threshold and not reversible by one entry; otherwise `경계 (값, 기준)` (SKILL.md L33; claim-and-consistency §F).
- Verdict surfaces: two-reader screen verdict (리크루터 6초 / 엔지니어 30초: 통과 / 경계 / 탈락), five dimension scores /10, 핵심 취약점, 개선 우선순위, red flags (SKILL.md L94-131).

### portfolio-pattern's measures (SKILL.md)
- Six dimensions, not four: Subject Audit, Agency Language, Number Density, Failure Narrative, Decision Visibility, Verb Tense and Energy (L191, L223-245). The request names four: passive-voice ratio, subject audit, number density, decision visibility.
- Subject audit: team-credit subject (flag when dominant), no-subject active (normal), no-subject passive (flag); the reported ratio is the decision-verb ratio (제안 / 채택 / 배제 / 결정 / 도입 판단), ~20% provisional; never measure `저는/제가` (L223-228).
- Agency language (passive/피동): ~되었습니다/~되었고/~되어, vague participation (관여/참여/기여 without what), directed work (맡았습니다 without why) (L230-233). Output reports "수동/피동 표현: count, examples" (L260) — a count, not a ratio.
- Number density: impact claims with vs without a concrete number; number-free rate >60% for 5+ yr portfolio is a problem, provisional + boundary rule (L235-239, L182).
- Decision visibility: visible vs implied choices ("A 대신 B를 선택한 이유는…") (L243, L263) — qualitative, not a tally.
- Mcp-reasoner beam for contested ownership (개인 오너십 / 팀 크레딧 / 소유권 회피) (L212-217).

### Overlap map (facts only; the decision is Unknown U2)
- Pattern's subject-audit ratio metric == feedback's `의사결정 동사 n%` (same verb list minus `도입 판단` vs `판단`, same ~20%, same `제가/저는` exclusion).
- Pattern's passive count is named in feedback's reference (§2 "피동 문장 수") but absent from feedback's tally line.
- Pattern's number density (number present/absent per impact claim) overlaps the 수치 element of 완전 주장 and the Y of XYZ+S, but with different denominators ("impact claims" vs "outcome bullets" vs "all Experience/Projects bullets").
- Pattern's decision visibility overlaps rewrite's "Decision, not just action" and feedback's decision-verb count only partially (visibility = alternatives/reason, not verb).

### Related facts
- A copy of feedback must also copy `references/` (six files) — the SKILL.md links them relatively (SKILL.md L31, L60-67, L73, L82). evals/ exists as the fixture-format precedent (`skill_name`, `evals[] {id, prompt, expected_output, files, assertions[]}`).
- Beta-lane precedent (user memory index, "Beta track promotion policy" and "Portfolio beta lane 2"): -beta skills are an experimental lane, merged only when benchmark-better, promotion is the user's call; the previous portfolio-feedback-beta was promoted into stable 1.13.0 and its dir deleted.

## 4. Story: job-application-workflow rewire

Sources read: `portfolio/skills/job-application-workflow/SKILL.md` (98 lines), `portfolio/skills/mock-interview/SKILL.md`, `portfolio/skills/interview-plan/SKILL.md`, `write/skills/writer-verification/SKILL.md`, README §job-application-workflow (L45-67), KOR §job-application-workflow (L42-62), `_repo/docs/plans/portfolio-refresh/PRD-portfolio-refresh.md` (US-8, Non-goals, Open Q 7).

### Current workflow shape
- 4 steps: Step 1 JD Match · `jd-fit`; Step 2 Company-Type Fit · `portfolio-company` (skip if company fixed); Step 3 Tailoring · `resume-tailorer` (+ `portfolio-rewrite`); Step 4 Interview Preparation · `interview-plan` (L34-51). `[확정]` restated on entry; missing facts `[확인 필요]` (L32). `type: workflow` required by validator for names containing "workflow" (validate_plugins.py L223-224).
- `mock-interview` and `portfolio-feedback` are only "Adjacent" in Related Skills (L97); no cover-letter step exists.
- The prior sprint deliberately removed the cover-letter promise and kept 4 steps because "no skill produces" a cover letter (portfolio-refresh PRD L24, L196, Open Q 7). D5 now reintroduces a cover-letter step via `write:writer-verification` — a requester decision that supersedes that non-goal.

### writer-verification draft mode (what the step can promise)
- Draft mode triggered by "write X for me"/outline (L49-52); gathers material, drafts, runs five passes, loops until 🔴🟡 = 0 or 3 rounds, delivers final text + a three-line loop note (L77-99, L118-125).
- "NEVER invent a fact while drafting or fixing. Every number, cause, name … comes from the material or from the author" (L32). It has NO `[확인 필요]` marker convention; its genres are `pr · commit · doc · blog · message` (L54) — no 자기소개서/cover-letter genre. The `[확인 필요]` rule of D5 must be stated by the workflow step itself.
- writer-verification lives in the `write` plugin — a cross-plugin dependency from portfolio.

### Reference sites naming jd-fit / portfolio-company / resume-tailorer (grep over portfolio/ at HEAD, excluding the three deleted dirs)
- `portfolio/skills/job-application-workflow/SKILL.md` L34, L38, L43, L96.
- `portfolio/skills/interview-plan/SKILL.md` L36 (resume-tailorer), L51 (jd-fit, portfolio-company), L156 (jd-fit).
- `portfolio/skills/mock-interview/SKILL.md` L26 (jd-fit).
- `portfolio/skills/portfolio-rewrite/SKILL.md` L25 (resume-tailorer; in-file line, re-checked in the revise stage).
- `portfolio/skills/portfolio-feedback/SKILL.md` L48 (jd-fit, portfolio-company), L149 (jd-fit) — D4 says UNCHANGED (Unknown U1).
- `portfolio/skills/portfolio-pattern/SKILL.md` L36 (jd-fit), L141 (`../jd-fit/SKILL.md`) — D4 says UNCHANGED (Unknown U1).
- `portfolio/references/ats-rules-korea.md` L3, `portfolio/references/korea-company-culture-signals.md` L3 (resume-tailorer).
- `portfolio/README.md` L31, L32, L37 (which-skill table), L58, L60, L62 (workflow diagram), L70-97 (§jd-fit incl. L80-81), L99-114 (§portfolio-company), L123 (jd-fit in §portfolio-feedback), L252-277 (§resume-tailorer).
- `portfolio/KOR.md` L30, L31, L36, L56, L58, L60, L68-77, L95-, L117, L232-.
- `portfolio/.claude-plugin/plugin.json` L3 (inside portfolio/, so the reference grep hits it) description ("JD fit (jd-fit) … company-type fit … resume tailoring") and `.claude-plugin/marketplace.json` L101 (same string) — D9 excludes version edits; description edits unresolved (Unknown U3).
- Outside portfolio/: only `_repo/docs/plans/portfolio-refresh/*` (historical; not a reference site) and `.teams_output/`.
- README/KOR workflow diagram (README L58-64, KOR L56-62) and prose ("JD analysis → company research", "culture signals, talking points, red flags", "STAR story bank, likely questions, questions to ask") promise outputs the skills do not produce (portfolio-company does no company research — workflow SKILL L39; interview-plan writes STAR prompts, not answers — interview-plan L28). D5's "no step promises an output no skill produces" applies to these lines too.

## 5. Gate and verification facts

- `_repo/scripts/validate_plugins.py` passes at HEAD ("OK [portfolio] 10 skills", "PASSED — all 14 plugins are installable").
- It checks per skill dir: SKILL.md exists; frontmatter `name`, `description` (with "Use when"/"Use before"/"Use after"/"Apply when"), `scenarios`, `compatibility`; `type: workflow` for names containing "workflow". Warnings only: description >250 chars, >250 lines, >200 lines without `effort` / `## Standing Mandates` (L159-224). Dirs ending `-workspace` are skipped.
- It does NOT check dangling references to deleted skills, nor `name` == directory name. D8 needs its own grep gate (e.g. `grep -rn "jd-fit\|portfolio-company\|resume-tailorer" portfolio/` = 0 outside allowed exceptions).
- Authoring rules (write/skills/writing-skills/SKILL.md L67-93; repo CLAUDE.md): description starts "Use when" and states triggers only; scenarios 2-3 EN + 2-3 KR; body order Process → Output Template → What Claude Does / What You Do → Related Skills; nothing titled Overview/Background before Process. Step 6 gates (`skill:skill-trigger-validator`, `skill:skill-quality-assurance`) — the portfolio-refresh PRD recorded them as not installed here (refresh PRD Non-goals); not re-verified in this run.
- Pre-change baselines for the run-it comparisons exist only in git once dirs are deleted: `git show cbdfcd6:portfolio/skills/<name>/SKILL.md` (HEAD commit).
- Fixture precedent: `portfolio/skills/portfolio-feedback/evals/evals.json` + `evals/files/*.md` (9 fixture files).

## Unknowns (carry into the PRD's Risks/Open Questions with the owner named)

- U1. Owner: requester/PO. D4 (feedback and pattern UNCHANGED) conflicts with D8 (update every reference across portfolio/): feedback L48/L149 and pattern L36/L141 name jd-fit/portfolio-company. Options: (a, recommended) leave both files byte-identical and record the stale references as a known exception in the grep gate, fixed at beta promotion; (b) allow a references-only edit to those lines; (c) fix them only inside portfolio-feedback-beta.
- U2. Owner: domain expert. Exact non-overlap boundary between pattern's four measures and feedback's tally. Options: (a, recommended) subject audit → reuse feedback's `의사결정 동사` (no new tally) plus a team-subject count; passive → add `피동 n` (already specified by resume-conventions §2) to the tally line; number density → reported but defined over 완전 주장's denominator and not counted into Impact twice; decision visibility → qualitative appendix note, not a tally; (b) add all four as separate tally fields with their own denominators; (c) fold them into existing fields only.
- U3. Owner: requester. Are the `description` strings in `portfolio/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (which name jd-fit, company-type fit, resume tailoring) in scope? D9 excludes only versions. Options: (a, recommended) leave both files untouched and update descriptions with the post-sprint version bump; (b) edit descriptions now.
- U4. Owner: domain expert. fit's output shape across modes: which verdict/tally in the no-JD path (jd-fit has `판정…` tally; company has none), and what happens with a JD plus a named company or a company-type question plus a JD. Options: (a, recommended) mode chosen by JD presence; JD mode keeps jd-fit's blocks + tally; no-JD mode keeps portfolio-company's blocks with Top 2 first and no invented tally; (b) one unified template with mode-specific blocks.
- U5. Owner: PO. What "beta's verdict must match feedback's" compares, and what counts as match given model nondeterminism: screen verdict only, dimension scores, or all shared tallies; single run or N runs. Options: (a, recommended) two-reader screen verdict and every shared tally equal, dimension scores within ±1, same model, one run each, rerun once on mismatch; (b) exact equality on all; (c) screen verdict only.
- U6. Owner: PO. Workflow step list and order. Request names five skills plus a cover-letter step; current workflow has 4 steps with mock-interview/portfolio-feedback as adjacent only. Options: (a, recommended) fit → portfolio-feedback → portfolio-rewrite (±JD) → 자기소개서 (writer-verification draft) → interview-plan → mock-interview, each with skip conditions; (b) keep 4 core steps, add the cover-letter step and list feedback/mock-interview as optional side steps.
- U7. Owner: implementation lead. Where the shared fixtures live: D7 says under `portfolio/skills/<skill>/evals/` but (a) and (b) are used by fit, portfolio-rewrite and portfolio-feedback-beta. Options: (a, recommended) one copy per skill's `evals/files/` (self-contained dirs, duplication accepted); (b) one canonical copy in one skill, others reference it by relative path. Fixture (c) "no JD" is a prompt condition, not a file.
- U8. Owner: implementation lead. Size of merged SKILL.md files (fit ~277 lines of source; rewrite+tailorer ~255) vs the 250-line warning and CLAUDE.md's "70% of current average length". Options: (a, recommended) move portfolio-company's five company-type profiles (and tailorer's JD-analysis detail) to `references/` inside the skill dir; (b) accept the validator warning.
- U9. Owner: PO. Which writer-verification genre and material the cover-letter step passes (no 자기소개서 genre exists; draft mode has no `[확인 필요]` convention). Options: (a, recommended) genre `doc`, material = user's resume/portfolio + JD + fit result, and the workflow step states the `[확인 필요: ○○]` rule and forbids facts not in that material; (b) request a new genre in write plugin (out of scope — touches write/).
- U10. Owner: PO. Whether portfolio-feedback-beta is listed in README/KOR "Which skill do I want?" and its description triggers — the same triggers as stable feedback would make both fire. Options: (a, recommended) listed in a separate "beta lane" line, description triggered only by explicit "beta" requests; (b) not listed in README/KOR at all.
- U11. Owner: implementation lead. Who/what runs the fresh-model comparisons and how results are recorded (evals.json assertions vs a written comparison note), and whether the absent gate skills (skill-trigger-validator, skill-quality-assurance) are required. No source in the tree defines a comparison-record format beyond evals.json.
