---
name: feedback
effort: high
description: >-
  Use when someone shares a developer portfolio and wants interviewer-grade feedback: screen
  verdict, whether numbers and skills hold up against their material, whether it reads at the
  claimed level. Triggers: "포트폴리오 피드백 해줘", "서류 통과할까", "숫자 근거 있어?", "시니어로 읽혀?",
  "고친 버전 비교", "점수 깎는 거 찾아줘", "더 고칠 거 찾아줘", "관점별 검토".
scenarios:
  - "Review my backend developer portfolio and give me honest feedback"
  - "Audit my portfolio — do the numbers hold up and does the skills list match the projects?"
  - "I call myself senior with 7 years. Does the document actually read senior?"
  - "내 포트폴리오 인터뷰어 관점에서 평가해줘. 서류 통과할지도 같이"
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

- ALWAYS issue the two-reader screen verdict (recruiter 6초 / 엔지니어 30초) inside 총평, before scoring any dimension. Substance scores assume the document gets read; the verdict says whether it does. The recruiter pass uses only the F-pattern visible path — on a deck, the first three slides.
- ALWAYS tally, never adjective. Every convention, consistency, and claim finding is a count (`XYZ+S 2/9`), and every count has a numbered list behind it in your working — a tally you cannot list is not reported. Re-count the side with the higher number.
- ALWAYS lead with the judgment and push the evidence to the back. 총평 → 점수 → 핵심 취약점 → 우선순위 come first; the audit blocks are an appendix. A reader who stops after four blocks has the review.
- ALWAYS state each finding once, in the appendix, with an ID (`C1`, `A2`, `L1`). Front blocks cite the ID and never restate the finding — if a defect appears in four blocks, three of them are padding.
- ALWAYS detect the format first — 이력서 vs 포트폴리오 덱/문서 — and apply only the measures that fit it (§0 of `references/claim-and-consistency.md`). A resume denominator on a 36-slide deck frightens without diagnosing.
- ALWAYS give the content, not only the place ("어디라고 하지 말고 내용을 줘 그래야 이 채팅창만 보고 고치지"): every finding quotes the current text and gives the replacement text, so the candidate can fix it from the review alone — and NEVER supply the fact. When the number, cause, or context is not in the document or the material, the replacement carries `[확인 필요: ○○]`. No 역산, no candidate values, no plausible-sounding reason written as if it were the candidate's experience.
- ALWAYS check claims against the material when it exists (`sources/`, `docs/확정사실.md`, a material folder the user names): §G of `references/claim-and-consistency.md`. A sentence that says more than its record, or contradicts it, is the defect an interviewer finds first. Every "재료에 없음" names the files searched and the words searched for.
- ALWAYS ask instead of flagging when a gap may be a choice: with no rationale on record, the finding is a question tagged `[확인 필요: 의도]`, never a defect; the answer goes into `[확정]`.
- NEVER fire a tally-based red flag on a boundary value. Within 10 points of a provisional threshold, or when one entry moving would cross it, the tally line says `경계 (58%, 기준 ~60%)` and no flag is raised.
- NEVER propose cutting, merging or shortening pages without a ground in the document ("왜 줄여야 하는거야?"), and NEVER cite market generalities ("면접 단골 질문", "요즘 채용 트렌드") as evidence — a finding rests on what the document says.
- NEVER count a portfolio deck's number-free summary or first-page line as a defect: on a deck the first page may lead with the structural why; measured numbers belong in the evidence lines, and a small-scale number weakens more than it shows.
- NEVER reopen a settled decision. In a continuing session keep a `[확정]` list (excluded items, kept items, numbers already judged over-claimed) and check every proposal against it before making it.
- NEVER carry the reviewer posture into writing. When asked to write or rewrite in the candidate's voice, the challenge-every-7 stance stops: check 오타 · 용어 오용 · 문서 간 모순 only, and do not add sentences or claims. Real rewriting is `rewrite`.
- NEVER treat a Skills list as evidence. Each entry with no bullet using it in context counts against 스킬 근거율 and is named.
- NEVER accept a number without a baseline as a claim — it is a certain interview question. Count 완전 주장 (수치·베이스라인·기간·기여 범위) separately from XYZ+S; 완전 주장 caps the Impact score, it never sets it.
- NEVER set the read level from years or title. Read level is the highest ladder rung with two bullets on it; report 레벨 갭 against what the document claims.
- NEVER net red flags against strengths. Front blocks name the top three; the appendix lists every finding, ranked — a cap hides the defects the candidate came for.
- NEVER score Technical Depth from a technology list; challenge every 7+ with the objection a skeptical interviewer would raise, with the same force whether or not the form blocks were harsh.
- NEVER summarize as the coach. The AI-screener summary uses only what the document says — no benefit of the doubt.
- Goal: every review ends with one tally line — `XYZ+S n/m · 완전 주장 n/m · 스킬 근거율 n/m · 날짜 불일치 n · 레벨 갭 ±n · 의사결정 동사 n% (국문일 때) · 불릿/롤 max n` — that the candidate can re-count against their own document.

# Portfolio Feedback

Interviewer-calibrated portfolio feedback with the screen-stage answer first: a two-reader screen verdict, red-flag catalog with interview defenses, AI-screener summary, and a tallied convention check including ATS/parser safety (`references/screen-models.md`, `references/resume-conventions.md`) — then three passes that ask whether the document agrees with itself (`references/claim-and-consistency.md`): **consistency** (dates, skills index vs. evidence, role claim vs. verbs), **claim audit** (does each number survive one question), and **level calibration** (does it read at the level it claims). Dimension scores, expected questions, and improvement priorities follow, in persona. Revision mode compares a v1/v2 pair (`references/revision-diff.md`).

**Not for** rewriting flagged sentences (`rewrite`), JD matching or target companies (`fit`), or interview simulation (`mock-interview`).

---

## Process

**0. Inputs, format and ledger.** List what is judged: each target with its version and date, and each reference — material, `docs/확정사실.md`, the workspace's own rules (README, style notes). A document older than the target (a resume written for an earlier deck) is named as stale and left out, never judged beside it. Say which format each target is — 이력서 / 경력기술서 / 포트폴리오 덱 / 문서 — and pick the measure set from §0. Restate the `[확정]` list, seeded from 확정사실's settled lines and corrections, before anything else.

**1. First read — tallies, then verdict**

Skim as a time-pressed interviewer: what is the immediate signal, the career story, the obvious absence. Then run the passes, listing before counting:

- Convention check — [`references/resume-conventions.md`](references/resume-conventions.md). Tally XYZ+S (denominators in [`references/revision-diff.md`](references/revision-diff.md)), 국문 의사결정 동사 비율 (§2; `제가/저는` is not counted), 불릿/롤 max. English resumes and 국문 경력기술서 have different subject conventions — don't apply one language's rule to the other. §8 machine readability is judged on the document only — conversion artifacts are never findings.
- Consistency — [`references/claim-and-consistency.md`](references/claim-and-consistency.md) §A: dates across sections vs. the summary's tenure (`날짜 불일치 n`), every Skills entry vs. its evidencing bullet (`스킬 근거율 n/m`, unevidenced named), role claim vs. bullet verbs.
- Claim audit — §B: every outcome bullet for 수치·베이스라인·기간·기여 범위 (`완전 주장 n/m`); every incomplete one listed, the worst three first with the exact question each invites, which go straight into Expected Questions.
- Claims against material — §G, when material exists: every outcome, cause, role and reason sentence set against its record — `근거 있음 / 약함 / 불가`, and for 불가 whether it is an overclaim (says more than the record), a contradiction (says otherwise) or a gap (the record is silent). Tally `재료 대조 불가 n/m`.
- Owner's rules — the settled lines in 확정사실 and the workspace's rules (plain words for developer-only terms or a footnote, no `(추정)` in body text, …): each break is an `F` finding quoting the line and the rule.
- Level calibration — §E: claimed rung (연차·직함·target role) vs. read rung from the ladder, `레벨 갭 ±n`, with the two ceiling bullets quoted. Over-claim feeds the 직함 인플레이션 flag; under-claim is Improvement Priority #1 unless the screen outranks it.

Thresholds (§F) are provisional working numbers, never presented as industry figures.

Then the AI-screener summary — three lines in the screener's voice, only what the document says — noting which strongest evidence did not survive it. Close with the two-reader verdict and the red-flag collection from [`references/screen-models.md`](references/screen-models.md) (재직 회사 약점 노출, 경력 갭, 잦은 이직, 직함 인플레이션, 기간 뭉개기, 검증 불가 주장 비율, 오탈자).

If `sequential-thinking` is available, use it here to map the portfolio's shape before diving into any one project.

**Revision mode** — when a previous version is supplied or the user says 이전 버전 / 고친 버전 / v2 / "compare": follow `references/revision-diff.md`, adding the §C rows (스킬 근거율 · 완전 주장 · 날짜 불일치 · 레벨 갭). The diff replaces the first impression and stays single-context; the same three-lens panel (step 2) reviews and debates the new version's findings, and everything else is scored on the new version and shortened where unchanged. Regressions include claims the rewrite introduced. If `sequential-thinking` is available, carry the tallies with it so every regression traces to a specific tally change.

**2. Panel and debate** — steps 0–1 ran once, here: inputs, format, tallies, C/A/L/F IDs. Three reviewers with different jobs read on every run, one lens each from [`references/personas.md`](references/personas.md), each as its own subagent: lenses that do different work find different defects, where reviewers doing the same job found the same few. Nobody is chosen at random, improvised, asked for or swapped. Mechanics, attack format, rule S, fallback and the Clashes contract: [`references/panel.md`](references/panel.md). The debate is think:brainstorming's debate mode (`think/skills/brainstorming/references/debate.md`): diverge → merge → attack/rebut, at most 2 rounds, `think:devils-advocate` as the attack method. Claude applies rule S and sets the scores; reviewers do not vote.

| ID | Lens | Reads | Reads for | Model |
|----|------|-------|-----------|-------|
| S | Screener — recruiter 6초 · engineer 30초 · AI screener | the target only | what survives the screen: first three pages, one number in reach, typos, terms in context | sonnet |
| I | Interviewer — "Walk me through that. What did *you* do?" | target + material | every claim against its record (§G): overclaims, contradictions, role inflation, numbers without a baseline — and the question each invites | sonnet |
| O | Owner's bar — the candidate's own standards | target + 확정사실 + workspace rules (+ `noah` when connected) | breaks of the settled rules, a current employer's weakness or internals, terms only developers know, deliberate choices to ask about | sonnet |

Merge, cut and scoring run on the session model. A focus the user names (a company type, a reader) weights merge order and the priorities' Why, never the roster. With no material, I reads the target alone and says so; with no rules on record, O reads for the conventions and red flags.

**3. Score, challenge, output** — [`references/scoring-rubric.md`](references/scoring-rubric.md), five dimensions (Technical Depth · System Design · Impact and Results · Leadership/Ownership · Portfolio Narrative): the band is the highest level *fully* satisfied, the score inside the band is set by the surviving findings charged to that dimension, so a fix moves it. After the debate Claude sets one score per dimension by the rubric; reviewer scores and their quoted evidence are inputs. Challenge every 7+; apply the 완전 주장 ceiling to Impact once, in its devil's-advocate line. If `think-tool` is available, invoke it before each dimension ("real evidence or pattern-matching?"); if `mcp-reasoner` is available and interpretations still compete, beam search (beamWidth=3) to commit.

---

## Output Template

Write in the user's language. Blocks marked *omit* are dropped entirely when empty. Judgment
first, evidence last; front blocks cite appendix IDs and never restate them.

**[리비전 비교 / Revision Diff]** *(revision mode only — replaces 총평)*
Before/after tally table (`revision-diff.md` + §C rows) · one line on verdict movement and what moved it · regressions one line each with the causing sentence · unresolved one line each · fixed items in one line.

**[총평 / First Impression]**
3 sentences — the single strongest signal, the career story, what the interviewer will remember. Then the two-reader verdict:
> **리크루터 (6초 · 덱이면 첫 3장)**: `통과 / 경계 / 탈락` + deciding factor, or `결정 요인 없음`
> **엔지니어 (30초 스킴)**: `통과 / 경계 / 탈락` + deciding factor

**[차원별 점수 / Dimension Scores]**
> **[차원명 / Dimension]: X / 10**
> 근거/Evidence: specific quote or reference
> _(optional) 🧠 Devil's advocate: objection raised and whether it moved the score — the 완전 주장 ceiling appears here for Impact, nowhere else_

**[핵심 취약점 / Core Vulnerability]** — the one structural flaw the interviewer will remember, citing IDs. Then `가역성 / Reversibility: reversible | one-way door — why`. Core vulnerability and reversibility appear here and nowhere else.

**[개선 우선순위 / Improvement Priorities]** (Top 3) — weigh severity × recoverability × effort (beam search here if `mcp-reasoner` is available). Each: **무엇을/What** (the page and the current text, quoted) · **왜/Why** (for the lens that raised it, or the user's focus) · **어떻게/How** (the replacement text; missing facts as `[확인 필요: ○○]`) · `근거: <appendix ID>` (one surviving finding, e.g. `근거: A1`).

**[예상 인터뷰 질문 / Expected Interview Questions]** (Top 5) — each tagged with the lens (S · I · O) that asks it; the claim-audit and material questions (`A1…`) come first.

**[강점 / Strengths]** — what genuinely impresses, with references.

**[가장 잘 맞는 포지션 / Best-fit Position]** — one sentence, current state not ideal state.

---

**부록 / Appendix** — evidence, each finding once, with an ID. Every appendix line starts with its ID and a space (`C1 `, `A1 `, `L1 `, `R1 `, `F1 `) — no bullet, no bold before it.

**[충돌 / Clashes]** — the only record of the debate. First a panel line: `패널 / Panel: S Screener · I Interviewer · O Owner's bar — sonnet, <n> rounds`. Then one line per contested finding: `<finding ID> — <who disagreed> — survived|dropped` (the ID is always `[CALRF]\d+`), where who-disagreed carries each attack's steel-man, type, severity and precedent (`panel.md`). A dropped finding appears here and nowhere else. No contest: `충돌 없음 / no clashes`. Panel not run: `패널 미실행 / panel could not run — single-context review`. Detail: `references/panel.md`.

**[레드 플래그 / Red Flags]** *(omit when none)* — `R1…` one line per catalog flag that clears its threshold with margin: trigger + one-line interview defense. Tally-backed flags cite the tally.

**[정합성 / Consistency]** *(omit when the document agrees with itself)* — `C1…` one line per contradiction: what it says in two places, and where. Unevidenced Skills entries by name.

**[주장 감사 / Claim Audit]** — `A1…` every incomplete claim and every material 불가, worst first — quote, missing element(s) or the record it breaks (`[재료 01/A1: …]`), the exact question invited, the replacement text.

**[레벨 캘리브레이션 / Level Calibration]** — `L1` `레벨 갭: 주장 <rung> / 읽힘 <rung> (±n)` + the two ceiling bullets. One more line only when over- or under-claimed.

**[형식 위반 / Convention Violations]** *(omit when clean)* — `F1…` every one, ranked by screen cost — the quoted line, the convention or owner's rule it breaks, the replacement text.

**[AI 스크리너 요약 / AI Screener Summary]** — 3 lines in the screener's voice, then which strongest evidence did **not** survive it.

**[집계 / Tally]**
`XYZ+S n/m · 완전 주장 n/m · 재료 대조 불가 n/m · 스킬 근거율 n/m · 날짜 불일치 n · 레벨 갭 ±n · 의사결정 동사 n% (국문일 때) · 불릿/롤 max n` — resume set; deck set per §0. Boundary values marked `경계 (값, 기준)`.

**[처리표 / Fix Table]** — last, one row per surviving finding, so the review is worked from one table: `| ID | 쪽 | 지금 | 고칠 문장 | 상태 |`, 상태 one of `바로` (the fix needs no new fact) · `확인` (carries `[확인 필요]`) · `준비` (nothing to change; prepare the answer). In a workspace, the whole review is also written to `feedback/YYYY-MM-DD.md`, this table included.

---

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Lists and counts every tally before reporting it; states each finding once, in the appendix | Re-count one tally against your document — if it's wrong, say so and the review is redone |
| Leaves missing facts as `[확인 필요]` instead of writing a plausible one | Fill the blanks — only you know the number |
| Judges the screen before scoring; runs the fixed S · I · O panel, applies rule S, sets each score | Name a focus only if one matters most — it orders the fixes, the panel stays the same |
| Sets every claim against your material and quotes the record it breaks | Answer the `[확인 필요: 의도]` questions — a choice you made stops being raised |
| Applies provisional thresholds as working numbers and says so | Bring a previous version for revision mode |

## Related Skills

- `rewrite` — act on the improvement priorities
- `pattern` — writing patterns behind the ownership read
- `mock-interview` — rehearse the expected questions
- `fit` — match against a specific posting
