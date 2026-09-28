---
name: fit
effort: high
description: >-
  Use when judging a portfolio's fit to a JD, or with no JD to company types or a named company.
  Triggers: "이 공고에 맞아?", "JD랑 비교해줘", "어느 회사에 잘 맞아?", "네이버 지원하려는데 어때?",
  "which companies fit me". Not generic "서류 통과할까?" (portfolio-feedback).
scenarios:
  - "Compare my portfolio to this job description — where are the gaps and would I pass the screen?"
  - "Which Korean tech companies would my portfolio appeal to? I don't have a posting yet"
  - "Is my portfolio a good fit for Naver or Kakao?"
  - "이 JD랑 포트폴리오 비교해서 서류 통과 가능성 알려줘"
  - "어느 회사 유형에 내 포트폴리오가 잘 맞는지 분석해줘"
  - "네이버 지원하려는데 내 포트폴리오 핏이 어때?"
compatibility:
  recommended:
    - think-tool
    - mcp-reasoner
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool은 JD 파싱과 포트폴리오 파싱(JD 모드), 포트폴리오 성격 규정과 회사 유형별 핏 점수(회사 유형 모드)에서 체크포인트로 사용됩니다.
    mcp-reasoner는 JD 모드의 갭 심각도 분류(치명/보완 가능/마이너)와 서류 통과 가능성 판단에 사용됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Portfolio Fit — JD mode / company-type mode

## Standing Mandates

**Mode.** A JD in the input → **JD mode**. No JD → **company-type mode**. A JD that comes with a company name runs JD mode; the company feeds the size/stage weighting only. The user never has to pick it, and no mode line precedes the first block — the first block's name shows the mode.

Both modes:
- NEVER supply the candidate's missing fact. When a number, scale, cause, or context is not in the portfolio, write `[확인 필요: ○○]` and stop — no 역산, no plausible value, no candidate values. This binds every advice block too. "API 응답속도 개선" comes out as "API 응답속도 개선 `[확인 필요: 개선 전/후 수치]`", never "40% 개선", and it never counts as a match or a green flag.
- ALWAYS mark every unmeasured line, even one that looks redundant or like a heading for the next bullet. Quote it verbatim and put `[확인 필요: ○○]` on the same line, right after the quote. "Delete it" or "merge it" without the marker is a violation: whether the line is a separate result is itself a missing fact, and only the candidate can supply it.
- NEVER state a company fact the user did not supply. Company signals (blog, postings, stack, size, stage) come only from the input; a missing one is `[확인 필요: ○○]` (e.g. `[확인 필요: 카카오 채용공고 기술스택]`) and the reasoning falls back to the type profile. A recalled or guessed fact is never presented as current.
- NEVER count a technology named only in a Skills/기술 list as evidence. Evidence is a bullet that uses it in context; a listed-but-unused technology is a gap the interviewer will find first.
- NEVER score from general impressions or name recognition. Every score, match, and gap is tied to a quoted portfolio line.
- ALWAYS lead with the judgment and push the evidence back. Each finding is stated once, where its block defines it; front blocks cite it instead of restating it.
- ALWAYS keep a `[확정]` list in a continuing session (excluded companies, judged gaps, facts the candidate already supplied or declined) and check every proposal against it before making it. A settled item is not reopened.
- ALWAYS write in the user's language; the Korean block labels are kept as block names.

JD mode:
- ALWAYS build the JD profile before opening the portfolio, and the candidate profile without the JD in view. The two profiles must be able to disagree.
- ALWAYS split must-have (자격요건) from nice-to-have (우대사항) before scoring, quoting the JD line that put each on its side. A missing nice-to-have never moves the verdict; a missing must-have is never averaged away by four strong dimensions.
- ALWAYS read a requirement against the company's size and stage — the same phrase gets a different weight at a 10-person startup and a 200-person platform team, and the analysis says why (`references/company-type-profiles.md` § JD mode use).
- ALWAYS quote both sides — the JD line and the portfolio line — for every match and every gap. A gap cited on one side only is a guess and is not reported. Decode the JD; do not keyword-match.
- ALWAYS classify each gap 치명적 / 보완 가능 / 마이너 with what closing it takes and how long, and give it an ID (`G1`, `G2`…).
- ALWAYS call `think` when a match or gap is ambiguous — adjacent experience, partial domain overlap, transferable skills.
- NEVER let adjacent experience pass as an exact match. Label it adjacent and name the one piece of evidence that would upgrade it.
- NEVER round a weak match up to "apply anyway". 통과 / 경계 / 스크린아웃 is stated plainly with what it hinges on; 스크린아웃 is a legitimate output. 경계 is a verdict label, not a numeric boundary marker — there is no cut-off to sit near, so no boundary value is flagged.
- Goal: JD mode ends with one line the candidate can re-check against the JD — `판정 <통과|경계|스크린아웃> · 5개 차원 n/10 · 치명적 n · 보완 가능 n · 마이너 n · must-have 미충족 n/m`. `m` = must-haves in the JD; `n` = must-haves with no evidence at all, i.e. the 치명적 must-have gaps. A must-have that is partly evidenced (adjacent experience, or only part of the requirement shown in a bullet) is a 보완 가능 gap labelled 부분 충족 and is not counted in `n`. The tally is the last line of the answer — nothing follows it.

Company-type mode:
- ALWAYS ask for the candidate's non-negotiables (location, domain, stack) before scoring. If not given, score anyway and mark `[확인 필요: 근무지 / 도메인 / 스택 조건]` in 핵심 신호. That marker is the ask. Do not open with a question or a preamble: the answer's first line is the Top 2 block.
- ALWAYS distinguish 'can apply here' from 'strong mutual fit here'.
- ALWAYS be honest about poor fits — it is more useful than false encouragement.
- NEVER invent a tally line for this mode. It ends with 포지셔닝 제안; there is no `판정 …` line.

**Not for** a generic portfolio review or "서류 통과할까?" with no posting or company in question (`portfolio-feedback`), rewriting portfolio sections (`portfolio-rewrite`), or interview preparation (`interview-plan`, `mock-interview`).

## Process

**0. Pick the mode** from JD presence (Standing Mandates → Mode). In a continuing session, restate the `[확정]` list.

### JD mode

1. **Parse the JD (`think` — required, before reading the portfolio).** Build the JD profile independently:
   - **Real** requirements vs. aspirational (JDs inflate nice-to-haves into requirements constantly)
   - **Must-haves** — what causes immediate rejection; quote the JD line behind each must-have / nice-to-have split
   - The **actual role** behind the title ("Senior backend engineer" at a 15-person Series A ≠ the same at a 500-person platform team); weight by the company's size/stage as given in the input
   - Unstated signals ("Strong communicator" usually means they've been burned by someone who wasn't)
   - The pain point this hire is meant to solve
   > 🧠 **JD note**: "The role is actually looking for X, not just Y as stated."
2. **Parse the portfolio (`think` — required, JD not referenced yet).**
   - The 3 clearest strengths; the 2–3 most significant gaps
   - What it communicates well — and fails to communicate
   - What level and type of role it naturally speaks to
   - **Unmeasured lines**: every bullet with no number, scale, or before/after, quoted verbatim, each with its `[확인 필요: ○○]`. None of them can count as a match.
   > 🧠 **Portfolio note**: the independent read before comparison.
3. **Structured comparison (`sequentialthinking`).** Plan how to handle partially addressed requirements, how to weight must-haves vs. nice-to-haves, and whether the portfolio tells the story this JD is looking for.
4. **Score 5 fit dimensions** (/10 each, plus 종합 매칭 점수):
   - **기술 스택** — exact matches, adjacent (transferable), gaps. Skills-list entries without a using bullet are gaps.
   - **경험 연차 / 스케일** — does the scale match what the role implies? "Large-scale systems experience preferred" is telling you something.
   - **역할 범위** — an IC who executes, or a senior who leads and influences? Does the portfolio show that kind of contribution?
   - **도메인** — fintech, e-commerce, infra, data platforms… Often recoverable, but acknowledged.
   - **소프트 시그널** — "Proactive / ownership / self-directed" differ from "collaborative / process-oriented / strong communicator." Does the portfolio's writing match?
5. **Gap analysis.** For each gap call `mcp-reasoner` (beam_search, beamWidth=3) before assigning severity:
   - Beam A: 치명적 — missing a must-have; rejection likely regardless of other strengths
   - Beam B: 보완 가능 — real gap, addressable in cover letter, portfolio framing, or interview
   - Beam C: 마이너 — nice-to-have miss; unlikely to affect screening
6. **Positioning advice** — what to emphasize, downplay, or add for this role; missing facts as `[확인 필요: ○○]`.
7. **Pass / borderline / screen-out judgment.** Call `mcp-reasoner` (mcts, numSimulations=50) — the highest-stakes single output and the one most likely to have competing evidence. Name the one swing factor that would most shift it either way.
8. **Apply / don't-apply advice**, then the closing tally line.

### Company-type mode

1. **Characterize the portfolio (`think` — required first).** What kind of engineer it represents (platform builder, product engineer, infrastructure specialist, generalist); its strongest signal (scale, ownership, depth, breadth, communication); its weakest or most ambiguous signal; what it does *not* say and which company would care; the candidate profile — years, domain, stack, role level as stated, anything unstated `[확인 필요]`. List the unmeasured lines the same way as JD mode step 2.
   > 🧠 **Fit note**: record the core profile here; everything downstream depends on it.
2. **Company-type framework (`sequentialthinking`)**, using the Stage 1 profile: which categories are relevant for this candidate; what each type actually looks for vs. what it says; which are the natural fit vs. a stretch. Profiles — Looks for / Green flags / Red flags for 대형 플랫폼, 성장기 스타트업, 핀테크/엔터프라이즈, 글로벌 테크, 개발 도구/플랫폼/OSS — are in [`references/company-type-profiles.md`](references/company-type-profiles.md). Include only the relevant types.
3. **Score each relevant type** — 핏 점수 X/10 + strong reason + weak reason + one concrete action, each tied to a portfolio line. Use `think` when a score is genuinely unclear (strengths and expectations only partly overlap).
4. **Name Top 2 fits and the type to avoid** — where this portfolio is most and least competitive.
5. **Positioning suggestions** — if the target isn't the natural fit, 2–3 changes that would move the needle.

A named company with no JD runs this mode: place it in its type(s), reason from the signals the user supplied, and list those signals (or `[확인 필요: ○○]`) under that type.

## Standalone Inputs

1. The portfolio / 이력서 / 경력기술서 (paste, upload, or describe key sections)
2. JD mode: the full JD text (the more complete, the better); optionally company name/stage and target role level
3. Company-type mode: optionally company names, their signals (blog, postings, stack), and non-negotiables

## Output Template

Output only the blocks of the running mode, in the order below. Judgment first; later blocks are the evidence.

### JD mode

**[서류 통과 가능성]**
`통과 / 경계 / 스크린아웃` — what it hinges on, citing gap IDs (e.g., "G1 치명적 must-have 미충족").
> **Swing factor**: the one factor that, if changed, would most shift this verdict in either direction.

**[지원 여부 조언]**
Apply / don't apply. If yes, with which changes (cite IDs); if 경계, the one thing that would tip it. 스크린아웃 → say so, and name what would make a future application viable.

**[종합 매칭 점수]**
**X / 10** — one sentence.
- 기술 스택: X/10
- 경험 스케일: X/10
- 역할 범위: X/10
- 도메인: X/10
- 소프트 시그널: X/10

Insert `🧠 JD note` where a score required a non-obvious judgment (including a size/stage weighting).

**[강한 매칭 포인트]**
Each match quotes the portfolio line and the JD requirement it addresses. Adjacent matches labelled adjacent, with the evidence that would upgrade them.

**[갭 분석]**
Each gap once, with an ID:
- `G1` 갭: [what's missing or underrepresented] — JD: "…" / 포트폴리오: "…" or 없음
- 심각도: 치명적 / 보완 가능 / 마이너 (must-have / nice-to-have)
- 근거: why this severity
- 대응 방법: how to address in portfolio, cover letter, or interview, and how long it takes. A missing number or scale is `[확인 필요: ○○]` — never a suggested value.

**[포트폴리오 포지셔닝 조정]**
How to frame experience for *this* role: emphasize, downplay, add before applying. Shape and placement only — no number, volume, or outcome the portfolio does not already state.

Example: "이 JD는 데이터 파이프라인 경험을 중요하게 보는데(G2), [프로젝트명]의 ETL 작업을 앞에 배치하고 처리한 데이터 볼륨을 명시하세요 — `[확인 필요: 일 처리 데이터 볼륨]`."

End the block with **수치 없는 줄**. It lists every unmeasured line from Process step 2, one per line, in this shape:
- "API 응답속도 개선" `[확인 필요: 개선 전/후 수치 — 아래 bullet과 별개 성과인지]` — 매칭 아님

**[역할 해석]**
What the role is actually looking for beyond the literal JD — the role behind the title, unstated signals, the pain point this hire solves. 3–5 sentences.

**[집계]**
`판정 <통과|경계|스크린아웃> · 5개 차원 n/10 · 치명적 n · 보완 가능 n · 마이너 n · must-have 미충족 n/m` — last line, no note after it.

### Company-type mode

**[가장 잘 맞는 회사 유형 Top 2 / 피해야 할 회사 유형]**
- Top 1, Top 2: type + one line why it is most competitive there — 'can apply' vs 'strong mutual fit'.
- 피해야 할 유형: where it would likely struggle — not because the person is unqualified, but because the portfolio doesn't speak that company's language yet.

**[이 포트폴리오의 핵심 신호]**
3–5 sentences: what kind of engineer this portfolio represents. Non-negotiables stated, or `[확인 필요: 근무지 / 도메인 / 스택 조건]`.

**[회사 유형별 핏 분석]**
For each relevant company type:

**[회사 유형명]**
- **핏 점수**: X/10
- **이 유형에서 강한 이유**: [specific evidence from portfolio]
- **이 유형에서 약한 이유**: [specific gap or mismatch]
- **지원 전 보완할 것**: [one concrete action — where and what shape; missing facts as `[확인 필요: ○○]`]

Insert `🧠 Fit note` where the score required a non-obvious judgment call. For a named company, list the supplied signals used, or `[확인 필요: ○○]`.

**[포트폴리오 포지셔닝 제안]**
If the target type isn't the best fit, 2–3 changes that move the needle most — section and shape, never a number the portfolio lacks. End with **수치 없는 줄**, in the same shape as JD mode.

No tally line follows in this mode.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Picks the mode from JD presence | Provides the portfolio, and the JD if you have one |
| JD mode: decodes the JD, scores 5 dimensions with both sides quoted, classifies gaps 치명적 / 보완 가능 / 마이너 | Validates the gap assessment with network contacts if possible |
| JD mode: gives an honest 통과 / 경계 / 스크린아웃 verdict with its swing factor and the tally line | Decides whether to apply and what to change |
| Company-type mode: characterizes the portfolio, scores relevant types, names Top 2 and the type to avoid first | Supplies company signals (blog, postings, stack) and your non-negotiables; decides which companies to target |
| Leaves missing facts as `[확인 필요]` instead of inventing them | Fills the blanks — or leaves them out — and does the referral / relationship work |

## Related Skills

- `../portfolio-rewrite/SKILL.md` — act on the gaps and positioning changes identified here
- `../portfolio-feedback/SKILL.md` — overall portfolio assessment not tied to a role or company
- `../interview-plan/SKILL.md` — build a prep plan once a target is chosen
- `../mock-interview/SKILL.md` — practice the questions the gaps will draw
