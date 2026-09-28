---
name: portfolio-jd
effort: high
description: >-
  Use when someone provides both a portfolio and a specific job description and
  wants to know how well they match — gap analysis, fit score, and positioning
  advice for that exact role. Triggers on: "이 공고에 맞아?", "JD랑 비교해줘", "이 포지션 지원해도
  돼?".
scenarios:
  - "Compare my portfolio to this job description — where are the gaps?"
  - "I want to apply to this JD — how well does my portfolio match and what should I fix?"
  - "Score my portfolio against this job posting across tech stack, scale, and role scope"
  - "이 공고에 내 포트폴리오가 맞는지 갭 분석해줘"
  - "이 JD랑 포트폴리오 비교해서 서류 통과 가능성 알려줘"
compatibility:
  recommended:
    - think-tool
    - mcp-reasoner
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool은 JD 파싱(Stage 1)과 포트폴리오 파싱(Stage 2)에서 필수 체크포인트로 사용됩니다.
    mcp-reasoner는 갭 심각도 분류(치명/보완 가능/마이너)와 서류 통과 가능성 판단에 사용됩니다 — 이 두 가지가 이 스킬의 가장 중요한 판단입니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Portfolio × JD Gap Analyzer

## Standing Mandates

- ALWAYS build the JD profile before opening the portfolio, and the candidate profile without the JD in view. Comparing while parsing bends the JD toward whatever the portfolio happens to contain — the two profiles must be able to disagree.
- ALWAYS split must-have from nice-to-have before scoring anything, and say which line of the JD put each one on which side. A missing nice-to-have never moves the verdict, and a missing must-have is never averaged away by four strong dimensions.
- ALWAYS read a requirement against the company's size and stage. "Kubernetes experience preferred" at a 10-person startup and at a 200-person platform team are different requirements; the same phrase gets a different weight and the analysis says why.
- ALWAYS quote both sides — the JD line and the portfolio line — for every match and every gap. A gap with a citation on only one side is a guess, and it is not reported. Decode the JD; do not just match keywords.
- ALWAYS classify each gap 치명적 / 보완 가능 / 마이너 with what closing it actually takes and how long. An unclassified gap is not advice the candidate can act on before the deadline.
- ALWAYS lead with the judgment. 서류 통과 가능성 and 지원 여부 조언 come first; each gap is stated once, in 갭 분석, with an ID (`G1`, `G2`…), and front blocks cite the ID instead of restating it.
- ALWAYS call `think` when a match or gap is ambiguous — adjacent experience, partial domain overlap, or transferable skills.
- NEVER count a technology named in a Skills list as a match. Evidence is a bullet that uses it in context; a listed-but-unused technology is a gap the interviewer will find first.
- NEVER let adjacent experience pass as an exact match. Label it adjacent, and name the one piece of evidence that would upgrade it.
- NEVER supply the candidate's missing fact. When a number, scale, or context is not in the portfolio, write `[확인 필요: ○○]` and stop — no 역산, no plausible value. This binds 갭 분석 and 포지셔닝 too: never suggest a number, volume, or outcome the portfolio lacks. "API 응답속도 개선" comes out with `[확인 필요: 개선 전/후 수치]`, not "40% 개선".
- NEVER round a weak match up to "apply anyway". 통과 / 경계 / 스크린아웃 is stated plainly with what it hinges on, and 스크린아웃 is a legitimate output of this skill. 경계 is a verdict label here, not a numeric boundary marker — there is no cut-off to sit near.
- Goal: every analysis ends with one line the candidate can re-check against the JD — `판정 <통과|경계|스크린아웃> · 5개 차원 n/10 · 치명적 n · 보완 가능 n · 마이너 n · must-have 미충족 n/m`.

**Not for** company-type matching without a specific JD (`portfolio-company`), resume keyword tailoring (`resume-tailorer`), or general portfolio improvement not tied to a role (`portfolio-feedback`).

## Process

1. **Parse the JD (`think` — required, before reading the portfolio).** Build the JD profile independently:
   - **Real** requirements vs. aspirational (JDs inflate nice-to-haves into requirements constantly)
   - **Must-haves** — what causes immediate rejection; quote the JD line behind each must-have / nice-to-have split
   - The **actual role** behind the title ("Senior backend engineer" at a 15-person Series A ≠ the same at a 500-person platform team); weight by company size/stage
   - Unstated signals ("Strong communicator" usually means they've been burned by someone who wasn't)
   - The pain point this hire is meant to solve
   > 🧠 **JD note**: "The role is actually looking for X, not just Y as stated."
2. **Parse the portfolio (`think` — required, JD not referenced yet).**
   - The 3 clearest strengths; the 2–3 most significant gaps
   - What it communicates well — and fails to communicate
   - What level and type of role it naturally speaks to
   > 🧠 **Portfolio note**: the independent read before comparison.
3. **Structured comparison (`sequentialthinking`).** Plan how to handle partially addressed requirements, how to weight must-haves vs. nice-to-haves, and whether the portfolio tells the story this JD is looking for.
4. **Score 5 fit dimensions:**
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

## Standalone Inputs

1. Your portfolio (paste, upload, or describe key sections)
2. The full JD text (the more complete, the better)
3. Optionally: company name/stage and target role level

## Output Template

Write in the user's language (Korean labels below are kept as block names). Judgment first; front blocks cite gap IDs (`G1`…) and never restate the gap.

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

Insert `🧠 JD note` where a score required a non-obvious judgment.

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

**[역할 해석]**
What the role is actually looking for beyond the literal JD. 3–5 sentences.

**[집계]**
`판정 <통과|경계|스크린아웃> · 5개 차원 n/10 · 치명적 n · 보완 가능 n · 마이너 n · must-have 미충족 n/m`

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Decodes JD: real requirements vs. aspirational nice-to-haves | Provides the actual portfolio content |
| Scores fit across 5 dimensions with evidence quoted from both sides | Validates gap assessment with network contacts if possible |
| Classifies each gap: 치명적 / 보완 가능 / 마이너, marks missing facts `[확인 필요]` | Supplies the facts marked `[확인 필요]` — or leaves them out |
| Gives concrete positioning advice for this specific role | Decides whether to apply and what to change |
| Gives an honest 통과 / 경계 / 스크린아웃 verdict with its swing factor | Does the relationship building to get referrals |

## Related Skills

- `../portfolio-rewrite/SKILL.md` — act on specific gap areas identified here
- `../resume-tailorer/SKILL.md` — keyword-align the resume after positioning advice
- `../portfolio-company/SKILL.md` — company type fit analysis if no specific JD yet
