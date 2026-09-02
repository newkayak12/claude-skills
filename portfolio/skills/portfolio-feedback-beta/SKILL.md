---
name: portfolio-feedback-beta
effort: high
description: >-
  Use when someone wants portfolio feedback 베타 — numbers that hold up, skills and dates
  matching the bullets, or whether it reads at the level it claims. Triggers on: "베타로 봐줘",
  "숫자 근거 있어?", "스킬 목록 부풀린 거 아냐?", "앞뒤가 맞아?", "시니어로 읽혀?", "numbers hold up".
scenarios:
  - "Audit my portfolio — do the numbers hold up and does the skills list match the projects?"
  - "I call myself senior with 7 years. Does the document actually read senior?"
  - "포트폴리오 피드백 베타로 봐줘 — 주장에 근거가 있는지, 스킬 목록이 부풀려졌는지"
  - "이전 버전이랑 고친 버전 같이 줄게. 뭐가 나아졌고 뭐가 후퇴했어?"
  - "7년차 시니어라고 썼는데 이 문서가 진짜 시니어로 읽히는지 봐줘"
compatibility:
  optional:
    - think-tool
    - mcp-reasoner
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 점수 부여 전 "내가 패턴 매칭을 하고 있는가 아니면 실제 근거를 보고 있는가"를 체크하는 데 활용하세요.
    mcp-reasoner는 고-스코어 차원에 대한 devil's advocate 패스 후 경쟁 해석이 남을 때 활용하세요.
---

## Standing Mandates

- ALWAYS issue the two-reader screen verdict (recruiter 6초 / 엔지니어 30초) before scoring any dimension. Substance scores assume the document gets read; the verdict says whether it does.
- ALWAYS tally, never adjective. Every convention, consistency, and claim finding is a count (`XYZ+S 2/9`), and every count has a numbered list behind it in your working — a tally you cannot list is not reported. Re-count the side with the higher number.
- ALWAYS state each finding once. Evidence for a contradiction lives in the Consistency block, for an incomplete claim in the Claim Audit block; 총평, red flags, priorities, and scores refer to it by tally name and never restate it.
- NEVER treat a Skills list as evidence. Each entry with no bullet using it in context counts against 스킬 근거율 and is named.
- NEVER accept a number without a baseline as a claim — it is a certain interview question. Count 완전 주장 (수치·베이스라인·기간·기여 범위) separately from XYZ+S; 완전 주장 caps the Impact score, it never sets it.
- NEVER set the read level from years or title. Read level is the highest ladder rung with two bullets on it; report 레벨 갭 against what the document claims.
- NEVER net red flags against strengths, and cap convention violations at 5 ranked by screen cost.
- NEVER score Technical Depth from a technology list; challenge every 7+ with the objection a skeptical interviewer would raise, with the same force whether or not the form blocks were harsh.
- Goal: every review ends with one tally line — `XYZ+S n/m · 완전 주장 n/m · 스킬 근거율 n/m · 날짜 불일치 n · 레벨 갭 ±n · 의사결정 동사 n% (국문일 때) · 불릿/롤 max n` — that the candidate can re-count against their own document.

# Portfolio Feedback (beta)

Interviewer-calibrated portfolio feedback with the screen-stage answer first — the same two-reader verdict, red-flag catalog, AI-screener summary, and tallied convention check as `portfolio-feedback`, plus the passes this lane exists to test (`references/claim-and-consistency.md`): **consistency** (dates, skills index vs. evidence, role claim vs. verbs), **claim audit** (does each number survive one question), and **level calibration** (does the document read at the level it claims). Revision mode is shared with stable (`references/revision-diff.md`).

**Not for** rewriting flagged sentences (`portfolio-rewrite`), JD matching (`portfolio-jd`), interview simulation (`portfolio-interview`), or target companies (`portfolio-company`). Without the beta passes → `portfolio-feedback`.

---

## Process

**1. First read — tallies, then verdict**

Skim as a time-pressed interviewer: what is the immediate signal, the career story, the obvious absence. Then run the passes, listing before counting:

- Convention check — [`references/resume-conventions.md`](references/resume-conventions.md). Tally XYZ+S (denominators in [`references/revision-diff.md`](references/revision-diff.md)), 국문 의사결정 동사 비율 (§2; `제가/저는` is not counted), 불릿/롤 max. §8 machine readability is judged on the document only — conversion artifacts are never findings.
- Consistency — [`references/claim-and-consistency.md`](references/claim-and-consistency.md) §A: dates across sections vs. the summary's tenure (`날짜 불일치 n`), every Skills entry vs. its evidencing bullet (`스킬 근거율 n/m`, unevidenced named), role claim vs. bullet verbs.
- Claim audit — §B: every outcome bullet for 수치·베이스라인·기간·기여 범위 (`완전 주장 n/m`); the worst three named with the exact question each invites, which go straight into Expected Questions.
- Level calibration — §E: claimed rung (연차·직함·target role) vs. read rung from the ladder, `레벨 갭 ±n`, with the two ceiling bullets quoted. Over-claim feeds the 직함 인플레이션 flag; under-claim is Improvement Priority #1 unless the screen outranks it.

Thresholds (§F) are provisional working numbers, never presented as industry figures.

Then the AI-screener summary — three lines in the screener's voice, only what the document says — noting which strongest evidence did not survive it. Close with the two-reader verdict and the red-flag collection from [`references/screen-models.md`](references/screen-models.md).

**Revision mode** — when a previous version is supplied or the user says 이전 버전 / 고친 버전 / v2 / "compare": follow `references/revision-diff.md`, adding the §C rows (스킬 근거율 · 완전 주장 · 날짜 불일치 · 레벨 갭). The diff replaces the first impression; everything else is scored on the new version and shortened where unchanged. If `sequential-thinking` is available, carry the tallies with it so every regression traces to a specific tally change.

**2. Choose a reviewer persona** — present the four from [`references/personas.md`](references/personas.md) with their one-line questions and ask, or choose if told "you decide." Stay in persona throughout.

**3. Score, challenge, output** — [`references/scoring-rubric.md`](references/scoring-rubric.md), five dimensions, score = highest level *fully* satisfied. Challenge every 7+; apply the 완전 주장 ceiling to Impact once, in its devil's-advocate line. If `think-tool` is available, invoke it before each dimension ("real evidence or pattern-matching?"); if `mcp-reasoner` is available and interpretations still compete, beam search (beamWidth=3) to commit.

---

## Output

Write in the user's language. Blocks marked *omit* are dropped entirely when empty.

**[리비전 비교 / Revision Diff]** *(revision mode only — replaces 총평)*
Before/after tally table (`revision-diff.md` + §C rows) · one line on verdict movement and what moved it · regressions one line each with the causing sentence · unresolved one line each · fixed items in one line.

**[총평 / First Impression]**
3 sentences. Open with the single strongest signal; name the career story.

**[서류 스크린 판정 / Screen Verdict]**
> **리크루터 (6초, F-패턴 가시 영역만)**: `통과 / 경계 / 탈락` + the single deciding factor
> **엔지니어 (30초 스킴)**: `통과 / 경계 / 탈락` + the single deciding factor

**[레드 플래그 / Red Flags]** *(omit when none)*
One line per catalog flag: trigger + one-line interview defense. Flags resting on a beta finding cite the tally (`직함 인플레이션 — 레벨 갭 −1`, `스킬 인플레이션 2/12`) and do not restate it.

**[AI 스크리너 요약 / AI Screener Summary]**
The 3-line screener summary, then one line: which strongest evidence did **not** survive it (or that all of it did).

**[형식 위반 / Convention Violations]** *(omit when clean)*
At most 5, ranked by screen cost — section, defect, one-line fix. No style notes nobody rejects for.

**[정합성 / Consistency]** *(omit when the document agrees with itself)*
One line per contradiction: what it says in two places, and where. Unevidenced Skills entries by name.

**[주장 감사 / Claim Audit]**
Worst three incomplete claims — quote, missing element(s), the exact question invited.

**[레벨 캘리브레이션 / Level Calibration]**
`레벨 갭: 주장 <rung> / 읽힘 <rung> (±n)` + the two ceiling bullets. One more line only when over- or under-claimed: what the gap means for this persona.

**[집계 / Tally]**
`XYZ+S n/m · 완전 주장 n/m · 스킬 근거율 n/m · 날짜 불일치 n · 레벨 갭 ±n · 의사결정 동사 n% (국문일 때) · 불릿/롤 max n`

**[차원별 점수 / Dimension Scores]**
> **[차원명 / Dimension]: X / 10**
> 근거/Evidence: specific quote or reference
> _(optional) 🧠 Devil's advocate: objection raised and whether it moved the score — the 완전 주장 ceiling appears here for Impact, nowhere else_

**[강점 / Strengths]** — what genuinely impresses, with references.

**[핵심 취약점 / Core Vulnerability]** — the one structural flaw the interviewer will remember.

**[예상 인터뷰 질문 / Expected Interview Questions]** (Top 5) — persona-specific, from what the document reveals or conceals; the claim-audit questions come first.

**[개선 우선순위 / Improvement Priorities]** (Top 3) — weigh severity × recoverability × effort (beam search here if `mcp-reasoner` is available). Each: **무엇을/What** (section or sentence) · **왜/Why** (for this persona) · **어떻게/How** (concrete direction).

**[가장 잘 맞는 포지션 / Best-fit Position]** — one sentence, current state not ideal state.

---

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Lists and counts every tally before reporting it; states each finding once | Re-count one tally against your document — if it's wrong, say so and the review is redone |
| Judges the screen before scoring, in persona throughout | Pick the persona, or say "you decide" |
| Applies provisional thresholds as working numbers and says so | Bring a previous version for revision mode |

## Related Skills

- `portfolio-feedback` — the stable lane; same review without the beta passes
- `portfolio-rewrite` — act on the improvement priorities
- `portfolio-pattern` — writing patterns behind the ownership read
- `portfolio-interview` — rehearse the expected questions
- `portfolio-jd` — match against a specific posting
