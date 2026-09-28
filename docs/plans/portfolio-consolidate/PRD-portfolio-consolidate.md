# PRD — portfolio plugin consolidation

Status: draft for the shape stage · Baseline commit: `cbdfcd6` (portfolio 2.1.0) · Findings: [PRD-portfolio-consolidate-findings.md](PRD-portfolio-consolidate-findings.md) (cited below as F§n, keep-list IDs JDn / PCn / RTn / PRn, requester decisions Dn, unknowns Un)

This is the only planning document for this sprint (D12). Vocabulary, contested rules and load conditions are sections of it, not separate documents.

## Domain: Korean tech hiring (서류 전형 → 면접), as seen by a job seeker

The general version of this problem is "merge duplicate prompts". The domain part is what the prompts are *for*. A Korean backend engineer applying to a posting goes through this sequence: 채용 공고 (자격요건 = must-have, 우대사항 = nice-to-have) → 이력서 / 경력기술서 / 포트폴리오 submitted, often through an ATS → 자기소개서 answering the company's own 문항, usually with a 글자 수 limit → 서류 전형 → 직무 면접 → 컬처핏 / 임원 면접. Practices someone in this domain would notice if they were missing:

- **자격요건 vs 우대사항 are not symmetric.** A missing 우대사항 never sinks an application; a missing 자격요건 cannot be averaged away (JD2). Any fit judgment that averages the two reads wrong on the first pass.
- **Company type changes what a line is worth.** A ~100-person fintech (Series B–D band, 50–300명, and 핀테크/엔터프라이즈 at once: PC8) values different evidence than a 대형 플랫폼 or 글로벌 테크, and a candidate without a posting still asks "어디에 넣어야 해?" (PC15).
- **경력기술서 lines without numbers are the norm, and filling them in is fabrication.** "API 응답속도 개선" with no before/after is the typical case. The bar here is to mark it `[확인 필요: 개선 전/후 수치]` (JD10, RT3) and not to make up "35% 개선" (the current README resume-tailorer example does exactly that: F§2).
- **Korean resume conventions:** the subject is dropped (`저는/제가` are not measured), team-credit subjects (`팀에서`) and 피동 (`~되었습니다`) hide ownership, and hedge verbs (`참여`, `기여`, `지원`) mark attribution as missing (F§3).
- **자기소개서 is its own genre.** It is written per 문항, and every experience in it must be one the candidate actually has, because the interviewer will ask about it.

## Problem

The portfolio plugin (`portfolio/skills/`, 10 skills at HEAD) gives a job seeker two or three skills for the same job. The seeker has to know which one to call, and the skills do not always agree with each other.

1. **jd-fit and portfolio-company are both "am I a fit?"** jd-fit judges fit to one posting: must-have/nice-to-have, five dimensions /10, verdict 통과/경계/스크린아웃 (JD1-17). portfolio-company judges fit by company type when there is no posting: five type profiles, Top 2 fits (PC1-15). Both start by profiling the portfolio. The only real difference is whether a JD is present. The README "which skill" table (README L31-37) sends the user to one or the other based on phrasing (F§4).
2. **resume-tailorer and portfolio-rewrite both rewrite the candidate's lines.** resume-tailorer rewrites toward a JD: keyword alignment, achievement reframing, skills reordering (RT1-17). portfolio-rewrite rewrites for strength: XYZ+S, ownership, decision (PR1-9). portfolio-rewrite already names resume-tailorer as its "Not for … JD keyword matching" boundary (portfolio-rewrite SKILL L25), so the seam exists but the user has to cross it by hand.
3. **portfolio-pattern re-measures what portfolio-feedback already tallies.** Pattern's subject-audit ratio is the same metric as feedback's `의사결정 동사 n%` (same verbs, same ~20%, same `저는/제가` exclusion). Pattern's number density overlaps feedback's 완전 주장 수치 element and XYZ+S's Y, but uses a different denominator. Pattern's 피동 count is specified in feedback's own reference (resume-conventions §2) but is missing from feedback's tally line (F§3). If a user runs both, they get two numbers for one property.
4. **job-application-workflow points at the names this sprint removes.** Its steps are `jd-fit` → `portfolio-company` → `resume-tailorer` (+ rewrite) → `interview-plan` (workflow SKILL L34-51). It has no 자기소개서 step. README/KOR describe outputs no skill produces ("company research", "STAR story bank", F§4).

Evidence: findings F§1-F§4. The request states the consolidation directly: "overlapping skills; this sprint consolidates them".

## Users

All users are job seekers. Most are Korean-speaking backend/software engineers with a 이력서 / 경력기술서 / 포트폴리오 in hand.

| User | Trying to get done | Does today instead |
|------|--------------------|--------------------|
| **Seeker with a JD** | "Should I apply to this posting, and what will sink me at 서류?" | Calls `jd-fit`. If they phrase it as "이 회사 어때?" they get `portfolio-company`, which ignores the JD. |
| **Seeker without a JD** | "What kind of company does my portfolio fit? Where should I aim?" or "네이버 지원하려는데 어때?" with no posting | Calls `portfolio-company`. |
| **Seeker mid-rewrite** | Make weak lines stronger, and when a target posting exists, bend the resume toward it without changing a fact | Calls `portfolio-rewrite` for strength, then separately `resume-tailorer` for the JD. The two outputs have different formats and different `[확정]` handling. |
| **Seeker requesting feedback** | "Would this pass 서류? What is weakest?", with the writing-pattern read (피동, subject, numbers, decisions) included | Calls `portfolio-feedback`, then `portfolio-pattern`, and gets the decision-verb ratio twice. |
| **Seeker running the whole application** | One guided path from posting to interview, including 자기소개서 | Follows `job-application-workflow`, which names three skills that will no longer exist and has no 자기소개서 step. |
| **Maintainer (secondary)** | Keep the plugin installable and every cross-reference live | Relies on `scripts/validate_plugins.py`, which does not detect references to deleted skills (F§5). |

## Solution overview

**One fit skill instead of two.** The seeker calls `fit` with a portfolio. If they attach a JD, `fit` judges fit to that posting exactly as jd-fit did: 서류 통과 가능성 first, must-have kept separate from nice-to-have, five dimensions, gap IDs, and the closing tally. If there is no JD, it judges fit by company type exactly as portfolio-company did: Top 2 types first, per-type 핏 점수, what to fix before applying. JD presence picks the mode. The seeker does not have to choose. jd-fit and portfolio-company are deleted.

**Rewrite that can tailor.** `portfolio-rewrite` keeps working as it does today. When the seeker also gives a target JD, the same skill switches into JD-tailoring mode: it analyses the JD first, shows the gap table, opens with the JD 적합도 판정 line, then does keyword alignment, achievement reframing and skills reordering. It never changes a number, scope or date the resume states, and it never fills a missing number. resume-tailorer is deleted.

**A beta feedback lane and a rewired workflow.** A new `portfolio-feedback-beta` is a copy of portfolio-feedback that also reports portfolio-pattern's four measures (피동, subject audit, number density, decision visibility), with each property counted once. Stable portfolio-feedback and portfolio-pattern do not change. The beta triggers only when "beta" is asked for explicitly, and promoting it is the user's decision later. `job-application-workflow` now walks fit → portfolio-feedback → portfolio-rewrite (±JD) → 자기소개서 via `write:writer-verification` draft mode → interview-plan → mock-interview. Every step promises only what its named skill produces.

## Success criteria

- SC1. `portfolio/skills/` contains `fit/` and `portfolio-feedback-beta/`, and no longer contains `jd-fit/`, `portfolio-company/` or `resume-tailorer/`.
- SC2. Every capability in keep-lists JD1-17, PC1-15, RT1-17 and PR1-9 can be located in the merged skill (its SKILL.md or its own `references/`). The build package's PR/notes contain a table from each ID to a passage.
- SC3. On the fixtures (see *Fixtures* below), a fresh model running the merged or new skill reaches the same judgment as a fresh model running the pre-change skill(s) from `git show cbdfcd6:…`, per the parity rules in each story.
- SC4. `grep -rn "jd-fit\|portfolio-company\|resume-tailorer" portfolio/` returns only the five whitelisted lines listed in US-4 (unchanged portfolio-feedback, portfolio-pattern and plugin.json).
- SC5. `python3 scripts/validate_plugins.py` prints `PASSED` after every build package.
- SC6. `git diff cbdfcd6 -- portfolio/skills/portfolio-feedback portfolio/skills/portfolio-pattern .claude-plugin/marketplace.json portfolio/.claude-plugin/plugin.json` is empty.
- SC7. Each output of every job-application-workflow step matches an output block of the skill named at that step.

### Fixtures (requester decision D7) and who uses them

| Fixture | Content | Used by |
|---------|---------|---------|
| **(a) resume excerpt** | Korean backend 경력기술서 excerpt. It contains a metric-less line `API 응답속도 개선` and at least one line with a metric (e.g. `주문 API p95 820ms → 310ms, 3개월`), plus enough context lines (role, 연차, stack) for fit to profile the candidate. | US-1 (both modes), US-2 (both modes), US-3 |
| **(b) JD** | JD for a senior backend role at a ~100-person fintech, with explicit 자격요건 and 우대사항. | US-1 (JD mode), US-2 (JD mode) |
| **(c) no JD** | Prompt condition, not a file: fixture (a) given with no posting and no company named, so both runs of a comparison get the identical prompt (default - revisit with PO). | US-1 (company-type mode), US-2 (no-JD mode) |

Placement: one copy of (a) and (b) in each using skill's `evals/files/`, with `evals/evals.json` in the format used by `portfolio-feedback/evals/` (`skill_name`, `evals[] {id, prompt, expected_output, files, assertions[]}`) (default - revisit with implementation lead). The fixtures are kept after the sprint.

Pre-change baselines: `git show cbdfcd6:portfolio/skills/<jd-fit|portfolio-company|resume-tailorer|portfolio-rewrite|portfolio-feedback>/SKILL.md` (plus that skill's `references/`). The old directories are deleted during the sprint, so git is the only source of the baselines (F§5).

Run-it rule for every comparison: a *fresh* model (a new subagent that has not seen this PRD or the diff) is given only the skill under test and the fixture. The pre-change skill gets the same fixture, the same model and one run each. Reading or diffing the two texts does not count as a comparison.

## User stories

### US-1 — `fit`: one skill judges fit with or without a JD

**Description.** As a job seeker, I call one skill with my portfolio. If I attach a JD, it tells me whether I pass 서류 for that posting and what gaps would sink me. If I don't, it tells me which company types my portfolio fits and which to avoid. It replaces `portfolio/skills/jd-fit` and `portfolio/skills/portfolio-company` with `portfolio/skills/fit` (name decided by the requester, D2).

**Rules this story rests on**
- Mode is picked by JD presence. JD present → JD mode: jd-fit's output blocks in jd-fit's order (JD13) and its closing tally (JD14). No JD → company-type mode: portfolio-company's blocks with Top 2 + type to avoid first (PC10), and **no tally line is invented** for this mode. When a JD comes with a named company, JD mode runs and the company name feeds the size/stage weighting (JD3, JD16) (default - revisit with domain expert).
- The five company-type profiles and other long reference detail may move into `portfolio/skills/fit/references/` so the SKILL.md stays under the 250-line validator warning (default - revisit with implementation lead).
- Standing Mandates of the bar (D11): no invented facts → `[확인 필요: ○○]`, judgment first, `경계` is a label and not a numeric boundary.

**Capability keep-list** (full wording and source lines in F§1)
- From jd-fit: JD1 JD profile before portfolio, candidate profile blind to JD · JD2 must-have / nice-to-have split with quoted JD line, must-have never averaged away · JD3 weighting by company size/stage · JD4 both-sides quoting, decode not keyword-match · JD5 gap severity 치명적/보완 가능/마이너 + closing cost + beam_search per gap · JD6 judgment first, gap IDs `G1…` cited by front blocks · JD7 think at JD parse / portfolio parse / ambiguous match, sequentialthinking comparison · JD8 skills-list-only = gap · JD9 adjacent experience labelled + upgrading evidence · JD10 `[확인 필요]` incl. `API 응답속도 개선` → `[확인 필요: 개선 전/후 수치]` · JD11 verdict 통과/경계/스크린아웃 + mcts verdict + one swing factor · JD12 five dimensions /10 + 종합 매칭 점수 · JD13 output block order · JD14 closing tally line · JD15 역할 해석 (role behind the title, pain point) · JD16 inputs, user's language · JD17 compatibility think-tool/mcp-reasoner/sequential-thinking, `effort: high`.
- From portfolio-company: PC1 company signals only from what the user supplies, never recalled facts as current · PC2 ask non-negotiables, else `[확인 필요: 근무지 / 도메인 / 스택 조건]` · PC3 "can apply" vs "strong mutual fit" · PC4 where + shape only, no supplied facts · PC5 never on name recognition, every score tied to a portfolio passage · PC6 portfolio characterisation (engineer type, strongest/weakest signal, what it doesn't say) · PC7 type framework with sequentialthinking · PC8 five type profiles with Looks for / Green / Red flags, relevant types only · PC9 per-type 핏 점수, 강한/약한 이유, one 보완 action · PC10 Top 2 + type to avoid first · PC11 핵심 신호 3-5 sentences · PC12 포지셔닝 제안 2-3 changes · PC13 honest poor fits, supplied signals listed for a named company · PC14 compatibility, `effort: high` · PC15 named-company trigger with no JD.

**Acceptance**
- AC1.1 `portfolio/skills/fit/SKILL.md` exists with frontmatter `name: fit`, a `description` starting `Use when` that covers both the JD and the no-JD/named-company triggers, 2-3 EN + 2-3 KR scenarios, `compatibility`, `effort: high`, a `## Standing Mandates` section, and body order Process → Output Template → What Claude Does / What You Do → Related Skills.
- AC1.2 With a JD supplied, the skill judges fit **to that posting**: its output opens with 서류 통과 가능성 (통과/경계/스크린아웃 + swing factor) and ends with the `판정 … · 5개 차원 n/10 · 치명적 n · 보완 가능 n · 마이너 n · must-have 미충족 n/m` tally.
- AC1.3 Without a JD, the skill judges fit **by company type**: its output opens with Top 2 fits + type to avoid, followed by per-type 핏 점수 / 강한 이유 / 약한 이유 / 지원 전 보완할 것, and contains no `판정 …` tally line.
- AC1.4 Every ID JD1-17 and PC1-15 maps to a passage in `portfolio/skills/fit/` (SKILL.md or its `references/`). The mapping table is delivered with the package.
- AC1.5 `portfolio/skills/jd-fit/` and `portfolio/skills/portfolio-company/` no longer exist.
- AC1.6 **Run-it, JD mode:** a fresh model given `fit/SKILL.md` + fixtures (a)+(b), and a fresh model given `cbdfcd6:jd-fit/SKILL.md` + the same fixtures, produce the same 통과/경계/스크린아웃 verdict and the same must-have 미충족 count. Each dimension score is within ±1. The `API 응답속도 개선` line appears as `[확인 필요: …]` in both and as a match in neither (it has no number).
- AC1.7 **Run-it, no-JD mode:** a fresh model given `fit/SKILL.md` + fixture (a) under condition (c), and a fresh model given `cbdfcd6:portfolio-company/SKILL.md` + the same input, name the same Top 2 company types (order may differ) and the same type to avoid. Neither run states a company fact the input did not supply.
- AC1.8 `fit/evals/evals.json` holds at least the two runs above as evals with assertions, and `fit/evals/files/` holds fixtures (a) and (b).

### US-2 — `portfolio-rewrite` absorbs `resume-tailorer`

**Description.** As a job seeker rewriting my resume or portfolio, I use one skill. Without a JD it strengthens my lines as today. With a target JD it tailors them to that posting (keyword alignment, achievement reframing, skills reordering) without changing a single fact. `portfolio/skills/resume-tailorer` is deleted.

**Rules this story rests on**
- The JD is optional. Its presence switches on tailoring mode. Without it, output is exactly today's portfolio-rewrite shape (PR7).
- In tailoring mode, the gap analysis (RT2) and the JD 적합도 판정 line (RT5) come before any rewrite. The merged scope covers 이력서 and 포트폴리오 sections.
- Fact rule, both modes: a stated number, scope or date is never altered (RT4). A missing one is `[확인 필요: ○○]` and is never estimated (RT3, PR3). The README resume-tailorer example that invents "150만 … 35%" is not carried over (F§2).
- JD-analysis detail may move to `portfolio/skills/portfolio-rewrite/references/` to stay under 250 lines (default - revisit with implementation lead). The shared `portfolio/references/ats-rules-korea.md` and `korea-company-culture-signals.md` stay where they are and are linked.

**Capability keep-list** (full wording and source lines in F§2)
- From resume-tailorer (tailoring mode): RT1 JD keyword analysis first · RT2 gap table `JD requires | Resume shows | Gap?` + high-priority gaps, hidden strengths, de-emphasis candidates · RT3 `[확인 필요]`, no invention/estimate/역산 · RT4 never alter stated numbers/scope/timeline · RT5 `JD 적합도 판정: must-have n개 중 Missing n · Weak n — 최우선 변경: […]` first, later blocks cite it · RT6 rewrite by purpose (vocabulary/emphasis/order/shape) · RT7 inputs (resume + full JD; company/size/stage/level/why useful) · RT8 JD analysis (skills by frequency, soft signals, responsibility verbs, culture signals) + culture-signals reference · RT9 keyword alignment translates vocabulary, not facts · RT10 achievement reframing (XYZ/STAR), passive 참여/기여 reframed · RT11 skills reordered to front-load JD names · RT12 Summary/Profile mirroring the JD · RT13 Korean ATS rules reference · RT14 What NOT to change · RT15 actual Before/After text per section · RT16 output order 판정 → JD Analysis → Gap → Section Rewrites → What NOT to Change · RT17 sequential-thinking optional, parallel section rewrites after gap, `effort: high`.
- From portfolio-rewrite (must survive): PR1 `[확정]` ledger restated, nothing on it re-proposed · PR2 think-diagnosis before rewrite (absent XYZ+S letter; phrasing vs missing facts) · PR3 rewrite first, then ask; `[확인 필요]` inline, questions after · PR4 techniques (XYZ+S, specificity, ownership, decision, outcomes, conflict) with the same facts on both sides · PR5 pattern once, recorded in `[확정]` · PR6 continuation offer, original's language · PR7 per-passage output 진단 → Before → After → 왜 더 강해졌는가 → Rewriter note → [확인 필요 질문] → [확정] · PR8 feedback's writing-mode guard not imported · PR9 compatibility think-tool.

**Acceptance**
- AC2.1 `portfolio-rewrite/SKILL.md` states that an optional target JD switches the rewrite into JD-tailoring mode, and that mode performs keyword alignment, achievement reframing and skills reordering.
- AC2.2 In JD mode the output opens with the `JD 적합도 판정:` line, followed by the JD analysis summary and the gap table, before any section rewrite. It ends with What NOT to Change.
- AC2.3 Without a JD, the output is per passage in PR7's block order, with no `JD 적합도 판정` line and no gap table.
- AC2.4 Every ID RT1-17 and PR1-9 maps to a passage in `portfolio/skills/portfolio-rewrite/` (SKILL.md or its `references/`). The mapping table is delivered.
- AC2.5 `portfolio/skills/resume-tailorer/` no longer exists. `portfolio-rewrite/SKILL.md` L25 ("Not for … JD keyword matching (`resume-tailorer`)") no longer names resume-tailorer; JD keyword matching is now in scope, so the clause is removed.
- AC2.9 The merged frontmatter keeps both skills' entry points: the `description` covers portfolio-rewrite's triggers and resume-tailorer's ("이력서 맞춰줘", "공고에 맞게 고쳐줘", "이력서 최적화", "tailor my resume to this JD"), the scenarios include at least one JD-tailoring case in EN and in KR, and `effort: high` is set (RT17).
- AC2.6 **Run-it, JD mode:** a fresh model given the merged skill + fixtures (a)+(b), and a fresh model given `cbdfcd6:resume-tailorer/SKILL.md` + the same fixtures, report the same Missing and Weak counts in the 판정 line and mark the same 최우선 변경 target area. In both, `API 응답속도 개선` is rewritten with `[확인 필요: …]` for the number, and the metric-bearing line keeps its original numbers unchanged.
- AC2.7 **Run-it, no-JD mode:** a fresh model given the merged skill + fixture (a) under condition (c), and a fresh model given `cbdfcd6:portfolio-rewrite/SKILL.md` + the same input, name the same missing XYZ+S element for `API 응답속도 개선`. Neither run introduces a number, cause or scope absent from the fixture. The metric line's numbers are identical Before and After.
- AC2.8 `portfolio-rewrite/evals/evals.json` holds the two runs above with assertions, and `evals/files/` holds (a) and (b).

### US-3 — `portfolio-feedback-beta`: feedback plus pattern's measures, each counted once

**Description.** As a job seeker asking for feedback, I get the screen verdict and the writing-pattern read in one pass, without the same property counted twice. This is a new beta-lane skill at `portfolio/skills/portfolio-feedback-beta`. `portfolio-feedback` and `portfolio-pattern` stay byte-identical (D4). Promotion is the user's call later (beta-lane policy, F§3).

**Rules this story rests on: the non-overlap boundary** (default - revisit with domain expert)
- **Subject audit:** reuse feedback's existing `의사결정 동사 n%` (same verb list, same ~20% provisional target, `저는/제가` not measured) and add a team-subject count. No second decision-verb ratio.
- **Passive-voice (피동):** add `피동 n` to the tally line. It is a count, as feedback's resume-conventions §2 already specifies and pattern reports. It covers `~되었습니다/~되었고/~되어`.
- **Number density:** reported over 완전 주장's denominator (outcome bullets). It is not a new field that re-scores Impact: it must not cap or move the Impact score a second time, and it is not re-counted into XYZ+S.
- **Decision visibility:** a qualitative note in the appendix (visible vs implied choice), not a tally field.
- Pattern's other two dimensions (Failure Narrative, Verb Tense and Energy) are not in the request and are not added (see Scope and non-goals).
- The boundary rule stays in force: flag only ≥10 points past a provisional threshold and not reversible by one entry. Otherwise report `경계 (값, 기준)`.
- The beta description triggers only on explicit "beta" requests, and it is listed on a separate beta-lane line in README/KOR (default - revisit with PO).
- The copy includes feedback's `references/` (six files), since the SKILL.md links them relatively.
- The copied SKILL.md inherits feedback's L48 (`jd-fit`) and L149 (`jd-fit`) references. In the beta they are re-pointed to `fit`. The beta is a new file, so the "unchanged" rule does not cover it, and leaving them would put two more dead names past the grep gate (AC4.4).

**Capability keep-list.** Everything portfolio-feedback has at `cbdfcd6` (it is a copy), plus pattern's four named measures under the boundary above. Feedback's tally at HEAD: `XYZ+S n/m · 완전 주장 n/m · 스킬 근거율 n/m · 날짜 불일치 n · 레벨 갭 ±n · 의사결정 동사 n% · 불릿/롤 max n` (F§3).

**Acceptance**
- AC3.1 `portfolio/skills/portfolio-feedback-beta/` exists, containing a SKILL.md (frontmatter `name: portfolio-feedback-beta`, description triggered by explicit "beta" requests) and a copy of feedback's `references/`. `diff -r` against `portfolio-feedback/` shows only the changes this story names (frontmatter, the four measures, the L48/L149 re-pointing, evals).
- AC3.2 The beta SKILL.md's tally line contains every field of feedback's tally line plus `피동 n` and a team-subject count, and no second decision-verb ratio. The SKILL.md defines number density over 완전 주장's denominator and states that it does not adjust the Impact score or the XYZ+S count. Decision visibility is specified only as an appendix note, never as a tally field.
- AC3.3 `git diff cbdfcd6 -- portfolio/skills/portfolio-feedback portfolio/skills/portfolio-pattern` is empty.
- AC3.4 **Run-it, non-regression:** fixture (a) is given to a fresh model running `portfolio-feedback` and to a fresh model running `portfolio-feedback-beta` (same model, one run each). The two outputs agree at document level on the two-reader screen verdict (리크루터 6초 / 엔지니어 30초, each 통과/경계/탈락), every shared tally field value, and each of the five dimension scores within ±1. They also agree line by line: both treat `API 응답속도 개선` as a 완전 주장 miss and the metric-bearing line as complete. On a mismatch, both are rerun once, and the story fails if the mismatch persists (default - revisit with PO).
- AC3.5 In the beta run, `API 응답속도 개선` is counted once as a 완전 주장 miss. It is not additionally penalised through number density. The metric-bearing line is not flagged by number density.
- AC3.6 `portfolio-feedback-beta/evals/evals.json` holds the comparison run above with assertions, and `evals/files/` holds fixture (a).

### US-4 — `job-application-workflow` rewired to current names, with a 자기소개서 step

**Description.** As a seeker running the whole application, I follow one workflow whose every step calls a skill that exists and promises only what that skill produces. It now includes a 자기소개서 step whose experiences all come from my own material.

**Rules this story rests on**
- Step order (default - revisit with PO), each with a skip condition: **fit** (skip if the fit decision is already made) → **portfolio-feedback** (skip if already reviewed) → **portfolio-rewrite**, with JD for tailoring (skip if no rewrite wanted) → **자기소개서** via `write:writer-verification` draft mode (skip if the posting asks for none, or if the `write` plugin is not installed, in which case the step says so rather than drafting without the skill) → **interview-plan** (skip if screening call only, as today at workflow SKILL L50) → **mock-interview** (skip if no rehearsal wanted).
- 자기소개서 step: passes genre `doc`. Material = the user's resume/portfolio, the JD (including the 문항 text), and the fit result (default - revisit with PO). The step itself states the rule: every experience fact must come from the user's material, and a missing fact is written `[확인 필요: ○○]` and never invented. writer-verification has no such marker convention and no 자기소개서 genre (F§4), so the rule must live in the workflow step.
- The workflow keeps `type: workflow`, restates `[확정]` on entry, and marks missing facts `[확인 필요]` (existing behaviour, F§4).
- `portfolio-feedback` and `portfolio-pattern` are not edited, so their lines naming jd-fit/portfolio-company stay. They are whitelisted in the reference grep gate and fixed at beta promotion (default - revisit with requester/PO). `portfolio/.claude-plugin/plugin.json` L3 sits inside `portfolio/` and names `jd-fit`; it is whitelisted for the same reason (manifest untouched this sprint).

**Reference sites to update** (grep at `cbdfcd6`, F§4). Each must name `fit`, `portfolio-rewrite` or another current skill, or be removed:
- `portfolio/skills/job-application-workflow/SKILL.md` L34, L38, L43, L96 (step table and Related Skills)
- `portfolio/skills/interview-plan/SKILL.md` L36 (resume-tailorer), L51 (jd-fit, portfolio-company), L156 (jd-fit)
- `portfolio/skills/mock-interview/SKILL.md` L26 (jd-fit)
- `portfolio/skills/portfolio-rewrite/SKILL.md` L25 (resume-tailorer), handled with US-2 (AC2.5)
- `portfolio/references/ats-rules-korea.md` L3, `portfolio/references/korea-company-culture-signals.md` L3 (resume-tailorer)
- `portfolio/README.md` L31, L32, L37 (which-skill table), L58-64 (workflow diagram), L70-97 (§jd-fit, incl. L80-81), L99-114 (§portfolio-company), L123 (jd-fit in §portfolio-feedback), L252-277 (§resume-tailorer), plus a beta-lane line for US-3
- `portfolio/KOR.md` L30, L31, L36, L56-62, L68-77, L95- (§portfolio-company), L117, L232- (§resume-tailorer), mirroring README
- `portfolio/skills/portfolio-feedback-beta/SKILL.md`: its copies of feedback L48 and L149, handled with US-3
- **Whitelisted, not edited (the five lines AC4.4 allows):** `portfolio/skills/portfolio-feedback/SKILL.md` L48, L149; `portfolio/skills/portfolio-pattern/SKILL.md` L36, L141; `portfolio/.claude-plugin/plugin.json` L3
- **Outside the grep, also not edited:** `.claude-plugin/marketplace.json` L101 carries the same description string as plugin.json L3 (default - revisit with requester; both updated with the post-sprint bump)

**Acceptance**
- AC4.1 Every step-table entry in `job-application-workflow/SKILL.md` names one of `fit`, `portfolio-feedback`, `portfolio-rewrite`, `write:writer-verification`, `interview-plan`, `mock-interview`, in the order above, each with a skip condition. No step names `jd-fit`, `portfolio-company` or `resume-tailorer`, including the Related Skills list (today L96).
- AC4.2 The 자기소개서 / cover-letter step names `write:writer-verification` in draft mode, genre `doc`, lists its material (resume/portfolio, JD with 문항 text, fit result), and states the rule that every experience fact comes from the user's material, with missing ones marked `[확인 필요: ○○]`. Its skip condition covers the `write` plugin being absent.
- AC4.3 For each step, the output the workflow promises is an output block of the named skill at the post-sprint tree. README/KOR no longer promise "company research" or a "STAR story bank" / written answers.
- AC4.4 `grep -rn "jd-fit\|portfolio-company\|resume-tailorer" portfolio/` returns exactly the five whitelisted lines: portfolio-feedback L48, L149; portfolio-pattern L36, L141; `.claude-plugin/plugin.json` L3.
- AC4.5 README.md and KOR.md change together: both have the same sections for `fit`, the merged `portfolio-rewrite`, and the beta-lane line, and neither has a section for a deleted skill.
- AC4.6 `python3 scripts/validate_plugins.py` passes.

## Scope and non-goals

**Scope boundaries (decided by the requester)**
- **No version or manifest edits.** `.claude-plugin/marketplace.json` and `portfolio/.claude-plugin/plugin.json` are not touched this sprint. Versions (and, by default, the stale description strings) are bumped once after the sprint (D9). This overrides writing-skills step 8. The "update README + KOR" part of the repo update workflow still applies.
- **Gate carried into every build package:** `python3 scripts/validate_plugins.py` must pass (D10; it prints `PASSED — all 14 plugins are installable` at `cbdfcd6`), together with the reference grep of AC4.4. The validator does not detect dangling references (F§5), so the grep is what catches them. A package that runs before US-4 lands may leave reference sites outside its own story for US-4; the grep's five-line result is required once all four stories are merged.
- **No edits to portfolio-feedback or portfolio-pattern** (D4). Their stale references wait for beta promotion.
- **Beta promotion is not part of this sprint.** Merging portfolio-feedback-beta into portfolio-feedback, or deleting portfolio-pattern, is the user's call after benchmarking (D4).

**Domain practices deliberately not built**
- **자기소개서 글자 수 enforcement and 문항-by-문항 structure.** writer-verification counts no characters and has no 자기소개서 genre. The workflow passes the 문항 text as material but does not promise a length-compliant answer. Adding a genre would touch the `write/` plugin, which is outside `portfolio/`.
- **Company research.** fit reasons only from signals the user supplies (PC1). It does not look up 기업 블로그, 채용 공고 history or 잡플래닛-type reviews.
- **portfolio-pattern's Failure Narrative and Verb Tense/Energy dimensions** are not folded into the beta, because the request names four measures. They remain available in stable portfolio-pattern.
- **영문 이력서 / global-application conventions** beyond what the existing skills already handle, 연봉 협상, and 레퍼런스 체크 prep are not in any story.
- **Automated eval harness.** The run-it comparisons are run by a fresh subagent and recorded in evals.json. No runner script is built.

## Risks and open questions

The run that wrote this PRD was not interactive, so every question the investigation raised (U1-U11 in the findings) was settled by its most conservative supported option and written as a rule marked "(default - revisit with <owner>)". None is left open. Each is listed here with its owner, so a reader who expects it as an open question finds where it was settled.

**Questions, settled by default** (owner can revisit)
- Merged skill's directory/name: `portfolio/skills/fit`, `name: fit`, decided by the requester in the request text (D2). The request does not leave it ambiguous. Owner if revisited: PO.
- Non-overlap boundary between pattern's four measures and feedback's tally: decided as the US-3 boundary (default - revisit with domain expert).
- The UNCHANGED feedback/pattern vs "update every reference" conflict: whitelist (default - revisit with requester/PO).
- plugin.json / marketplace.json description strings: untouched (default - revisit with requester).
- fit's mode selection and output per mode: US-1 rules (default - revisit with domain expert).
- Meaning of "beta matches feedback": AC3.4 (default - revisit with PO).
- Workflow step order, and the 자기소개서 genre/material: US-4 rules (default - revisit with PO).
- Fixture placement and SKILL.md length handling: one copy per skill, long detail in the skill's `references/` (default - revisit with implementation lead).
- Beta listing and triggers: separate beta-lane line, explicit "beta" trigger only (default - revisit with PO).
- Recording the run-it comparisons (U11): evals.json assertions, plus a comparison note in the package's commit/PR body quoting both runs' verdict and tally lines. The writing-skills step-6 gate skills (`skill-trigger-validator`, `skill-quality-assurance`) were recorded as not installed here by the portfolio-refresh PRD; a package that finds them absent skips them and says so (default - revisit with implementation lead).
- Fixture (c) carries no company context (default - revisit with PO). Adding "핀테크 쪽 생각 중" would change which types lead and make the pre/post runs non-comparable unless both get it.

**Risks**
- R1. **Nondeterminism can mask or fake a regression.** One run each plus one rerun (AC3.4) can pass a real drift or fail on noise. Mitigation: same model, verdict and tallies compared exactly, dimension scores ±1. Owner: PO.
- R2. **Baselines exist only in git after deletion.** A package that deletes a directory before running its pre-change comparison must pull the baseline with `git show cbdfcd6:…`. Owner: implementation lead.
- R3. **Merged SKILL.md length.** fit's sources total ~277 lines and rewrite+tailorer ~255. If the move to `references/` hides a keep-list item, AC1.4/AC2.4 catch it only if the mapping table is honest. Owner: implementation lead.
- R4. **Cross-plugin dependency.** The workflow now depends on `write:writer-verification`. A user without the write plugin gets a step that cannot run; the US-4 skip condition (AC4.2) covers it, but only if the step checks for the skill instead of silently drafting ad hoc. Owner: PO.
- R5. **Trigger collision.** If fit's description is too broad it may steal portfolio-feedback's "서류 통과할까?" triggers, and the beta may collide with stable feedback. The beta's explicit-"beta" trigger addresses the second collision only. Owner: domain expert.
- R6. **Stale lines stay live until promotion.** portfolio-feedback and portfolio-pattern keep pointing at `jd-fit` (including `../jd-fit/SKILL.md`, a dead relative link) until beta promotion. Owner: requester/PO.
