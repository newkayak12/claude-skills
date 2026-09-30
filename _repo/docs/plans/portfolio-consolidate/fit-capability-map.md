# fit — capability keep-list map (US-1, AC1.4)

Every keep-list ID from [PRD-portfolio-consolidate-findings.md §1](PRD-portfolio-consolidate-findings.md) mapped to the passage in `portfolio/skills/fit/` that carries it. `SKILL.md` line numbers are for the file as delivered by package P1; `profiles` = `references/company-type-profiles.md`.

## From jd-fit (cbdfcd6)

| ID | Capability | Passage in fit |
|----|------------|----------------|
| JD1 | JD profile before portfolio; candidate profile blind to JD | SKILL.md L44 (Standing Mandates, JD mode, 1st bullet); Process JD mode steps 1–2 (L68–80) |
| JD2 | must-have / nice-to-have split with quoted JD line; must-have never averaged away | SKILL.md L45; Process JD step 1 "Must-haves" (L70) |
| JD3 | weight by company size/stage | SKILL.md L31 (Mode: named company feeds size/stage weighting), L46; Process JD step 1 (L71); profiles § "JD mode use" |
| JD4 | quote both sides; one-sided gap not reported; decode, don't keyword-match | SKILL.md L47; Output 강한 매칭 포인트 (L136–137), 갭 분석 `JD: "…" / 포트폴리오: "…"` (L141) |
| JD5 | severity 치명적/보완 가능/마이너 + cost/time; beam_search beamWidth=3 per gap | SKILL.md L48; Process JD step 5 (L88–91); Output 갭 분석 심각도 / 대응 방법 (L142–144) |
| JD6 | judgment first; gap IDs `G1…` cited by front blocks | SKILL.md L39 (both modes), L48 (IDs); Output 서류 통과 가능성 citing gap IDs (L120), 지원 여부 조언 "cite IDs" (L124) |
| JD7 | think at JD parse / portfolio parse / ambiguous match; sequentialthinking comparison | SKILL.md L49; Process JD steps 1, 2 (`think` — required), 3 (`sequentialthinking`) (L68, L75, L81) |
| JD8 | Skills-list-only technology = gap | SKILL.md L37; Process JD step 4 기술 스택 (L83) |
| JD9 | adjacent labelled + upgrading evidence | SKILL.md L50; Output 강한 매칭 포인트 (L137) |
| JD10 | `[확인 필요: ○○]`, incl. `API 응답속도 개선` → `[확인 필요: 개선 전/후 수치]`, also in 갭 분석 and 포지셔닝 | SKILL.md L34; L35 (every unmeasured line marked on the same line, never "delete/merge" without the marker); Process JD step 2 "Unmeasured lines" (L79); Output 포지셔닝 조정 "수치 없는 줄" (L151–152); Process JD step 6 (L92); Output 갭 분석 대응 방법 (L144), 포지셔닝 조정 + example (L147–149) |
| JD11 | 통과/경계/스크린아웃 stated plainly; 스크린아웃 legitimate; 경계 is a label; mcts verdict + swing factor | SKILL.md L51; Process JD step 7 (L93); Output 서류 통과 가능성 + Swing factor (L119–121) |
| JD12 | five dimensions /10 + 종합 매칭 점수 | Process JD step 4 (L82–87); Output 종합 매칭 점수 (L126–134) |
| JD13 | block order 서류 통과 가능성 → 지원 여부 조언 → 종합 매칭 점수 → 강한 매칭 포인트 → 갭 분석 → 포지셔닝 조정 → 역할 해석 → 집계 | SKILL.md L115 ("only the blocks of the running mode, in the order below"); Output JD mode L119–158 in that order |
| JD14 | closing tally line | SKILL.md L52 (Goal); Process JD step 8 (L94); Output 집계 (L157–158) |
| JD15 | 역할 해석: role behind the title, unstated signals, pain point | Process JD step 1 (L71–73); Output 역할 해석 (L154–155) |
| JD16 | inputs (portfolio, full JD, optional company name/stage, role level); user's language | Standalone Inputs 1–2 (L109–110); SKILL.md L41 (user's language) |
| JD17 | compatibility think-tool, mcp-reasoner, sequential-thinking; `effort: high` | frontmatter L3 (`effort: high`), L15–24 (compatibility) |

## From portfolio-company (cbdfcd6)

| ID | Capability | Passage in fit |
|----|------------|----------------|
| PC1 | company signals only from the user; missing → `[확인 필요: ○○]`, reason from type profile; never recalled facts as current | SKILL.md L36; L105 (named company); profiles § "Named company" |
| PC2 | ask non-negotiables, else `[확인 필요: 근무지 / 도메인 / 스택 조건]` in 핵심 신호 | SKILL.md L55; Output 핵심 신호 (L166–167) |
| PC3 | 'can apply' vs 'strong mutual fit' | SKILL.md L56; Output Top 2 block (L163) |
| PC4 | no supplied facts; 보완할 것 / 포지셔닝 give where + shape only | SKILL.md L34 ("binds every advice block too"); Output 지원 전 보완할 것 (L176), 포지셔닝 제안 (L181) |
| PC5 | never on name recognition; every score tied to a portfolio passage | SKILL.md L38; Process company step 3 "each tied to a portfolio line" (L101) |
| PC6 | Stage 1 characterize portfolio with `think` (engineer type, strongest/weakest signal, what it doesn't say, candidate profile with `[확인 필요]`) | Process company-type step 1 (L98–99) |
| PC7 | Stage 2 type framework with sequentialthinking | Process company-type step 2 (L100) |
| PC8 | five type profiles with Looks for / Green / Red flags; relevant types only | profiles § "The five profiles" (all five, verbatim from cbdfcd6); SKILL.md L100 pointer + "Include only the relevant types" |
| PC9 | per type 핏 점수, 강한 이유, 약한 이유, 지원 전 보완할 것 | Process company step 3 (L101); Output 회사 유형별 핏 분석 (L169–176) |
| PC10 | Top 2 + type to avoid, first | Process company step 4 (L102); Output first block of the mode (L162–164) |
| PC11 | 핵심 신호 3–5 sentences | Output 이 포트폴리오의 핵심 신호 (L166–167) |
| PC12 | 포지셔닝 제안 2–3 changes | Process company step 5 (L103); Output 포트폴리오 포지셔닝 제안 (L180–181) |
| PC13 | honest poor fits; `think` when a score is unclear; named company lists supplied signals | SKILL.md L57; Process company step 3 (L101, `think`); L105; Output Fit note line (L178) |
| PC14 | compatibility think-tool (+ optional sequential-thinking); `effort: high` | frontmatter L3, L15–24 |
| PC15 | named-company trigger with no JD | frontmatter description "네이버 지원하려는데 어때?" (L6); scenarios L11, L14; SKILL.md L105 |

## Additions from the bar (portfolio-feedback Standing Mandates, D11)

- `[확정]` ledger in a continuing session — SKILL.md L40, Process step 0 (L64).
- Boundary values not flagged — 경계 stays a verdict label with no numeric cut-off (L51); company-type mode has no tally, so there is no threshold to sit near (L58).
- JD with a named company → JD mode; company only weights (L31) (PRD U4 default).
