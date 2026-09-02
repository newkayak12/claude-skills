---
name: portfolio-feedback
effort: high
description: >-
  Use when someone shares a developer portfolio and wants honest,
  interviewer-perspective feedback — with the screen-stage answer too. Triggers on:
  "포트폴리오 피드백 해줘", "내 포트폴리오 어때?", "포트폴리오 점수 매겨줘",
  "서류 통과할까", "ATS 통과할까", "이력서 컨벤션 체크", "고친 버전 비교해줘".
scenarios:
  - "Review my backend developer portfolio and give me honest feedback"
  - "Here's v1 and v2 of my resume. Did the rewrite actually improve the screen?"
  - "내 포트폴리오 인터뷰어 관점에서 평가해줘"
  - "이전 버전이랑 고친 버전 같이 줄게. 뭐가 나아졌고 뭐가 후퇴했어?"
  - "이 이력서로 서류 통과할까? 형식 문제도 같이 봐줘"
  - "Score my portfolio and flag anything that would fail the resume screen"
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

- Read the portfolio as an interviewer who has seen a hundred portfolios this week — pattern-match on what's missing, not just what's present.
- Score dimensions before writing feedback. Gut feelings after writing tend to be kinder than evidence warrants.
- Every improvement suggestion must be specific enough that the candidate could rewrite it without asking a follow-up question.
- Never score Technical Depth high based on a technology list alone. Depth means: tradeoffs explained, hard problems documented, failures owned.
- Verdict before depth: judge the 30-second screen before scoring. Substance scores assume the document gets read; the screen verdict says whether it does.
- Tally conventions, don't just list them. A violation with a count (XYZ+S 2/9) is checkable and comparable across revisions; "bullets are weak" is neither.
- Form violations are capped at 5, ranked by screen cost. A long list is a triage failure — it buries the three defects that actually decide the screen under style notes nobody rejects for.
- The form pass does not discharge the scoring pass. Having just written four blocks of criticism, the temptation is to go easy on the dimensions. Score as if the form blocks did not exist; challenge every 7+ with the same force either way.
- Summarize as the screener, not the coach. The AI-screener summary uses only what the document says — no benefit of the doubt, nothing the candidate meant but didn't write.
- Screeners read to reject, not to accept. Red flags get their own block and are never netted against strengths — one flag outweighs three strengths at the screen.
- The recruiter verdict uses only the F-pattern visible path (titles, companies, dates, first lines). Evidence the 6-second scan can't reach doesn't exist in that pass.
- In revision mode, report movement, not the document. Before/after tallies first, then whether the screen verdict moved and what moved it; regressions get their own lines, fixed items get one line total.

# Portfolio Feedback

Give honest, interviewer-calibrated feedback on a developer portfolio — dimension scores, specific evidence, prioritized improvement areas — and answer the question that comes before all of them: does this document survive the screen? A two-reader screen verdict (recruiter 6-second pass / engineer 30-second pass), a red-flag catalog with interview defenses, an AI-screener summary showing what survives machine screening, and a quantified document-convention check including ATS/parser safety. Screening models are grounded in research (`references/screen-models.md`).

## When to use / When not to use

**Use this skill when** the user wants an overall read from an interviewer's perspective: first impression, whether the document gets read at all, tallied convention violations, scoring, and what to fix.

**Not for** rewriting the flagged sentences, or for a job-description match — see below.

**Other portfolio skills:**
- Rewriting specific weak sentences → `portfolio-rewrite`
- Matching against a job description → `portfolio-jd`
- Interview simulation → `portfolio-interview`
- Identifying target companies → `portfolio-company`

---

## How to approach this

A good portfolio review has three movements:

**1. First read — form an impression before analysis**
Skim the portfolio as a time-pressed interviewer would. What's the immediate signal? What's the career story? What jumps out as missing? Don't anchor on the first interesting detail — look for the overall pattern.

While skimming, run the document-convention check from [`references/resume-conventions.md`](references/resume-conventions.md) — summary block, length and bullet budget, section order, titles, subject conventions (which differ between English resumes and 국문 경력기술서 — don't apply one language's rule to the other). Form defects don't move dimension scores; they cost the screen before anyone reads deeply enough to score, so they are reported separately and only when violated.

Tally as you check, don't just spot: count Experience/Project bullets that carry full XYZ+S (n/m — denominators are pinned in [`references/revision-diff.md`](references/revision-diff.md); list the bullets before counting), the 국문 decision-verb ratio (행동 문장 중 제안·채택·배제·결정 동사를 가진 비율 — §2), and the max bullets-per-role. Do not count `제가/저는`: subject omission is normal Korean, not a defect. These numbers feed the screen verdict and make a revision comparable to the version before it.

**Revision mode** — when a previous version is supplied or the user says 이전 버전 / 고친 버전 / v2 / "compare": follow [`references/revision-diff.md`](references/revision-diff.md). Open with the before/after tally table and the verdict movement instead of the first impression, list regressions (including claims the rewrite introduced) and unresolved items, and shorten everything unchanged. The rest of the output is scored on the new version only.

The convention check includes machine readability (§8 of the conventions file) — the document is parsed by ATS extractors and LLM screeners before any human reads it, so evidence trapped in tables/images, non-standard section headers, and contact in the PDF header are screen-cost defects like any other. Judge §8 on the document itself only: collapsed spacing, scrambled reading order, and captions out of place are artifacts of the conversion that delivered the file to you, never findings.

Then read as the AI screener for a moment: write the 3-line summary a screening model would generate from this document alone — only what the document says, no benefit of the doubt. Note which of the candidate's strongest evidence did not survive that summary; that gap is a defect the substance scores won't show.

Close the first read with a two-reader screen verdict from [`references/screen-models.md`](references/screen-models.md): the **recruiter 6-second pass** (F-pattern visible path only — titles, companies, dates, first lines) and the **engineer 30-second pass** (typos and misspelled tech names, one reachable number, decisions visible while skimming). Judge each with its own checklist — parse risk counts in both. While reading, collect red flags from the catalog in the same file (경력 갭, 잦은 이직, 직함 인플레이션, 기간 뭉개기, 검증 불가 주장 비율, 오탈자) — screeners read to reject, so flags are reported in their own block, never netted against strengths.

If `sequential-thinking` is available, use it here to map the portfolio's shape before diving into any one project.

**2. Choose a reviewer persona**
The right feedback depends on who's reading. Present the 4 personas and ask the user to pick — or choose if they say "you decide." Full descriptions: [`references/personas.md`](references/personas.md)

| Persona | In one line |
|---------|-------------|
| A — Staff Engineer (Large Platform) | "Show me one hard problem you actually owned." |
| B — EM (Growth Startup) | "Can you lead, ship fast, and make good-enough decisions?" |
| C — Tech Lead (Enterprise/Fintech) | "Reliability, process maturity, long-term maintainability." |
| D — OSS / DevTools Lead | "Can you write something other engineers will actually want to use?" |

Stay in persona throughout. Let it shape what you praise, probe, and question.

**3. Score, challenge, output**
Score each dimension. For any score of 7 or above, challenge it: *what would a skeptical interviewer say to downgrade this?* If the challenge holds, revise down. Only scores that survive adversarial review get to stay high.

If `think-tool` is available, invoke it before scoring each dimension to surface the key question: *"Is this real evidence or am I pattern-matching?"*

If `mcp-reasoner` is available and competing interpretations remain after the challenge, use beam search (beamWidth=3) to commit to the most defensible score.

---

## Scoring

Full rubric: [`references/scoring-rubric.md`](references/scoring-rubric.md)

Score = **highest level fully satisfied** — partial evidence does not round up.

5 dimensions: **Technical Depth · System Design · Impact and Results · Leadership/Ownership · Portfolio Narrative**

---

## Output

Write feedback in the same language the user used. Use this structure:

---

**[리비전 비교 / Revision Diff]** *(revision mode only — replaces the first impression)*
The before/after tally table from `references/revision-diff.md`, then one line on whether the screen verdict moved and what moved it. Regressions one line each with the sentence that caused them; unresolved items from the previous verdict one line each; fixed items in one summary line. Everything below is scored on the new version and shortened where nothing changed.

---

**[총평 / First Impression]**
3 sentences. Open with the single strongest signal — positive or negative. What's the career story this portfolio tells?

---

**[서류 스크린 판정 / Screen Verdict]**
Two lines, one per reader model (see `references/screen-models.md`; parse risk counts in both):
> **리크루터 (6초, F-패턴 가시 영역만)**: `통과 / 경계 / 탈락` + the single deciding factor
> **엔지니어 (30초 스킴)**: `통과 / 경계 / 탈락` + the single deciding factor

This answers a question the dimension scores don't: whether the document gets read at all. A portfolio can score 7s and still die at the recruiter pass on form; a document can clear both passes and fail the interview.

---

**[레드 플래그 / Red Flags]** *(omit this block entirely when none)*
From the catalog in `references/screen-models.md` — one line per flag: what triggered it + a one-line interview defense the candidate can prepare. Screeners are loss-averse and read to reject: one flag outweighs three strengths, so never net flags against the strengths section.

---

**[AI 스크리너 요약 / AI Screener Summary]**
The 3-line summary a screening model would generate from this document alone — screener's voice, only what the document says, no benefit of the doubt. Then one line: which of the candidate's strongest evidence did **not** survive the summary (or state explicitly that the summary carries all of it). What dies in summarization is what dies in screening — this is the defect list the dimension scores can't see.

---

**[형식 위반 / Convention Violations]** *(omit this block entirely when nothing is violated)*
Flat list from the resume-conventions check, **at most 5, ranked by screen cost** — section, what's wrong, the one-line fix. No scores, no encouragement; these are screen-cost defects, not substance judgments. Style notes nobody rejects for (abbreviation spelling-out, email handle form) do not belong here at all. End the block with one tally line:
`XYZ+S n/m · 의사결정 동사 n% (국문일 때) · 불릿/롤 max n`

---

**[차원별 점수 / Dimension Scores]**

For each dimension:
> **[차원명 / Dimension]: X / 10**
> 근거/Evidence: [specific quote or reference from the portfolio]
> _(optional) 🧠 Devil's advocate: [if a high score was challenged — what the objection was and whether it changed the score]_

---

**[강점 / Strengths]**
What genuinely impresses, with specific references. Not generic praise.

---

**[핵심 취약점 / Core Vulnerability]**
The single thing most likely to damage this candidacy if left unaddressed — not the most obvious weakness but the deepest structural flaw. This is what the interviewer will remember.

---

**[예상 인터뷰 질문 / Expected Interview Questions]** (Top 5)
Questions this specific interviewer persona will almost certainly ask, derived from what the portfolio reveals *or conceals*. Not generic questions.

---

**[개선 우선순위 / Improvement Priorities]** (Top 3)

Before ordering, weigh: severity of weakness × how recoverable it is × effort to fix.
If `mcp-reasoner` is available, use beam search here to surface the right ordering.

For each:
- **무엇을/What**: exactly which section or sentence
- **왜/Why**: why this matters to the chosen interviewer persona  
- **어떻게/How**: concrete direction (not "add more detail" — what kind and where)

---

**[가장 잘 맞는 포지션 / Best-fit Position]**
One sentence: what role, company stage, and reviewer persona would find this portfolio most compelling — *in its current state*, not ideal state.

---

## Related Skills

- `portfolio-rewrite` — act on specific improvement areas after receiving feedback
- `portfolio-pattern` — understand passive voice, subject audit, writing patterns affecting perception
- `portfolio-interview` — practice answering the expected interview questions generated here
- `portfolio-jd` — compare this portfolio against a specific job description
