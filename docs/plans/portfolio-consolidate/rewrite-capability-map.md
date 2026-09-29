# rewrite capability map — RT1-17 + PR1-9 → merged portfolio-rewrite

Keep-lists: `PRD-portfolio-consolidate-findings.md` §2. Every ID maps to a passage in `portfolio/skills/portfolio-rewrite/`.
`SKILL` = `portfolio/skills/portfolio-rewrite/SKILL.md`, `REF` = `portfolio/skills/portfolio-rewrite/references/jd-tailoring.md`. Line numbers are at the commit that delivers this map.

## From resume-tailorer (JD-tailoring mode)

| ID | Capability | Passage |
|----|-----------|---------|
| RT1 | JD keyword analysis before rewriting any section | SKILL L38 (Standing Mandates, JD mode: "ALWAYS run the JD analysis and the gap analysis before rewriting any section"); SKILL L73 (Process step 3) |
| RT2 | Gap table `JD requires \| Resume shows \| Gap?` + high-priority gaps, hidden strengths, de-emphasis candidates, before any rewrite | SKILL L38; SKILL L75 (Process step 4); SKILL L153-155 (Output: Gap Analysis); REF §3 L27-42 (table, Missing/Weak/Strong definitions, three lists) |
| RT3 | `[확인 필요: ○○]` for any missing fact; no invention/estimate/역산/candidate values | SKILL L33 (Standing Mandates, both modes); REF L3 and §4 L57 |
| RT4 | Never alter stated numbers/scope/timeline | SKILL L34 (Standing Mandates, both modes); REF §4 L57 ("keeps them character-for-character"); SKILL L165 (template: "stated numbers unchanged") |
| RT5 | `JD 적합도 판정: must-have n개 중 Missing n · Weak n — 최우선 변경: […]` first; later blocks cite it | SKILL L38; SKILL L145-148 (first block, literal labels); SKILL L151 ("citing the 판정"); REF L25 (must-have = 자격요건) and L42 (how the line and 최우선 변경 are computed) |
| RT6 | Rewrite by purpose (vocabulary/emphasis/order/shape); the fact rule is the only bound | SKILL L35 |
| RT7 | Inputs: resume + full JD required (ask if missing); company/size/stage/level/why useful | SKILL L45 (tailor ask without JD → ask for JD); SKILL L71 (Process step 2); REF §1 L5-11 |
| RT8 | JD analysis: skills by frequency, soft signals, responsibility verbs, culture signals + culture-signals reference | SKILL L73 (step 3, links `../../references/korea-company-culture-signals.md`); REF §2 L13-23 |
| RT9 | Keyword alignment translates vocabulary, not facts | SKILL L42 (Mode); SKILL L78; REF §4 L48-51 (example) |
| RT10 | Achievement reframing (XYZ/STAR); passive 참여/기여 and outcome-less bullets reframed; missing number stays a marker | SKILL L42; SKILL L79; REF §4 L53-57 |
| RT11 | Skills reordered to front-load JD names; deprioritize unmentioned skills | SKILL L42; SKILL L80; SKILL L169-170 (template); REF §4 L59 |
| RT12 | Summary/Profile mirroring the JD, resume facts only | SKILL L81; SKILL L159-161 (template); REF §4 L61 |
| RT13 | Korean ATS rules reference | SKILL L82 (links `../../references/ats-rules-korea.md`); REF §4 L63 |
| RT14 | What NOT to change | SKILL L84 (Process step 6); SKILL L174-175 (template, last block); REF §5 L65-67 |
| RT15 | Actual Before/After text per section, not suggestions | SKILL L77 (step 5: "actual Before/After text, not suggestions"); SKILL L159-167 (template); REF §4 L46 |
| RT16 | Output order 판정 → JD Analysis → Gap → Section Rewrites → What NOT to Change | SKILL L143-176 (JD-tailoring Output Template; L145 first/last block rule) |
| RT17 | sequential-thinking optional; parallel section rewrites after gap; `effort: high` | SKILL L3 (`effort: high`); SKILL L20 (compatibility optional sequential-thinking); SKILL L69 |

## From portfolio-rewrite (must survive)

| ID | Capability | Passage |
|----|-----------|---------|
| PR1 | `[확정]` ledger restated at session start; nothing re-proposed | SKILL L37 (Standing Mandates); SKILL L50 (Process step 0); SKILL L139 (template) |
| PR2 | think-diagnosis before rewrite: intent, weakest element, absent XYZ+S letter, phrasing vs missing facts | SKILL L52-55 (Process step 1, shared by both modes) |
| PR3 | Rewrite first, then ask; markers inline, questions after | SKILL L33, L36 (Standing Mandates); SKILL L59 (step 2); SKILL L137 and L172 (question blocks after the rewrite) |
| PR4 | Techniques (XYZ+S, specificity, ownership, decision, outcomes, conflict), same facts on both sides | SKILL L90-116 (Rewriting Principles, "Both modes use them") |
| PR5 | Pattern once, recorded in `[확정]` | SKILL L63 (passage mode step 4); SKILL L86 (JD mode step 7) |
| PR6 | Continuation offer; output in the original's language | SKILL L65, L86, L141, L172 (continuation); SKILL L88 (language) |
| PR7 | Per-passage output 진단 → Before → After → 왜 더 강해졌는가 → Rewriter note → [확인 필요 질문] → [확정]; no 판정 line, no gap table | SKILL L120-141 (Passage-mode Output Template; L122 "No `JD 적합도 판정` line and no gap table") |
| PR8 | portfolio-feedback's writing-mode guard not imported | SKILL L35 |
| PR9 | compatibility: optional think-tool | SKILL L16-19 (compatibility block); SKILL L52 (step 1 calls `think`) |

## Deliberately not carried

- The old README §resume-tailorer example whose After invents "일 활성 사용자 150만 … 35% 개선" (findings §2). It violates RT3; nothing in SKILL or REF reproduces it, and every rewrite example keeps unknown facts as `[확인 필요: ○○]`.
- The L25 clause "JD keyword matching (`resume-tailorer`)". JD tailoring is now in scope, so the "Not for" line (SKILL L29) drops it.
