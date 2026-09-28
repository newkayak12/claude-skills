---
name: portfolio-company
effort: high
description: >-
  Use when someone wants to know which companies or company types their
  portfolio would appeal to — without a specific JD in hand. Triggers on: "which
  companies fit my portfolio", "where should I apply", "어느 회사에 잘 맞아?", "네이버
  지원하려는데 어때?", "어디 써볼 만해?".
scenarios:
  - "Which Korean tech companies would my portfolio appeal to?"
  - "Is my portfolio a good fit for Naver or Kakao?"
  - "Tell me where I should be applying based on my portfolio"
  - "어느 회사 유형에 내 포트폴리오가 잘 맞는지 분석해줘"
  - "네이버 지원하려는데 내 포트폴리오 핏이 어때?"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 회사 유형별 핏 점수 판단 품질이 높아집니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- ALWAYS take company signals (engineering blog, job postings, tech stack) from what the user supplies. When a named company's signal is not given, write `[확인 필요: ○○]` (e.g. `[확인 필요: 카카오 채용공고 기술스택]`) and reason from the type profile — never present a recalled or guessed company fact as current.
- ALWAYS ask for the candidate's non-negotiables (location, domain, stack) before scoring. If they are not given, score anyway and mark them `[확인 필요: 근무지 / 도메인 / 스택 조건]` in 핵심 신호.
- ALWAYS distinguish 'can apply here' from 'strong mutual fit here'.
- NEVER supply a fact the portfolio lacks. 지원 전 보완할 것 and 포지셔닝 제안 say *where* and *what shape*; a missing number, scale, or outcome is `[확인 필요: ○○]` — "API 응답속도 개선" becomes "API 응답속도 개선 `[확인 필요: 개선 전/후 수치]`", never "40% 개선". No 역산, no candidate values.
- NEVER recommend applying to a company based solely on name recognition.
- NEVER score from general impressions — tie every judgment to a specific portfolio passage.

# Portfolio × Company Fit Analyzer

**Not for** a specific job posting (`portfolio-jd`), rewriting sections (`portfolio-rewrite`), or overall portfolio quality (`portfolio-feedback`).

Provide: your portfolio; optionally company names, their signals (blog, postings, stack), and your non-negotiables.

## Process

1. **Characterize the portfolio** (Stage 1).
2. **Plan analysis across company types** (Stage 2).
3. **Score each company type** — fit score (X/10) + strong reason + weak reason + one concrete action.
4. **Name Top 2 fits and worst fit** — where this portfolio is most and least competitive.
5. **Produce positioning suggestions** — if the target isn't the natural fit, 2-3 changes that would move the needle.

### Stage 1 — Characterize the Portfolio (Think Tool)

Call `think` first to profile what this portfolio signals:

- What kind of engineer does it represent? (platform builder, product engineer, infrastructure specialist, generalist)
- Strongest signal? (scale experience, ownership, depth, breadth, communication quality?)
- Weakest or most ambiguous signal?
- What does it *not* say — and would a particular company care?
- Candidate profile: years, domain, stack, role level — as stated in the portfolio; anything unstated is `[확인 필요]`.

> 🧠 **Fit note**: Record the core profile here; everything downstream depends on it.

### Stage 2 — Company Type Framework (Sequential Thinking)

Call `sequentialthinking`, using the Stage 1 candidate profile:
- Which company categories are relevant for this candidate profile?
- What does each type actually look for vs. what they say they look for?
- Which types are this portfolio's natural fit vs. a stretch?

### Company Type Profiles

Include only the categories relevant to what the user asks.

**대형 플랫폼 (네이버, 카카오, 라인, 쿠팡 등)**
- Looks for: system scale experience (millions of users, high QPS, distributed systems); technical depth and ownership of complex infra decisions; working within large engineering organizations (process, code review culture, RFC/design doc experience); stability and reliability focus
- Green flags: specific scale numbers, distributed systems experience, performance optimization with before/after metrics
- Red flags: only small-scale projects, startup-style "we did everything" without depth, no system design evidence

**성장기 스타트업 (Series B–D, 50–300명)**
- Looks for: ownership and initiative beyond assigned tasks; good-enough decisions made fast; cross-functional collaboration, not a backend silo; building something from scratch or scaling it meaningfully
- Green flags: founding engineer experience, greenfield architecture ownership, business impact language
- Red flags: only large-company execution work, no initiative signals, heavy process dependency

**핀테크 / 엔터프라이즈 (토스, 카카오뱅크, SI 계열 등)**
- Looks for: reliability, compliance awareness, risk management mindset; long-term maintainability and documentation discipline; incident handling and operational maturity; consistent track record over flashy projects
- Green flags: SLA/SLO experience, incident runbooks, security awareness, payment/financial system experience
- Red flags: hype-driven tech choices without rationale, no operational concerns, short tenure on any project

**글로벌 테크 (Google, Meta, Amazon, Databricks 등 한국 오피스 또는 해외 지원)**
- Looks for: algorithmic and systems thinking demonstrable beyond the portfolio; clear technical communication (design docs, proposals, cross-team alignment); impact at scope (many users, teams, or systems); leadership without title
- Green flags: technical writing samples, cross-org impact, mentorship, open source contributions
- Red flags: no evidence of technical communication, individual-only work, no scope beyond own team

**개발 도구 / 플랫폼 / 오픈소스 팀**
- Looks for: API and developer experience intuition; public technical communication (blog, talks, OSS); abstraction and interface design thinking; empathy for other engineers as users
- Green flags: OSS contributions, technical blog, API design examples, developer tooling work
- Red flags: entirely internal product work, no public technical footprint, no developer-facing work

For a named company, reason about its actual engineering culture from user-supplied signals within its type profile — not its reputation.

## Output Template

Write in the user's language. Judgment first; later blocks are the evidence.

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

Insert `🧠 Fit note` where the fit score required a non-obvious judgment call. For a named company, list the supplied signals used, or `[확인 필요: ○○]`.

**[포트폴리오 포지셔닝 제안]**
If the target type isn't the best fit, 2–3 changes that move the needle most — section and shape, never a number the portfolio lacks.

**Rules**
- Be honest about poor fits. It's more useful than false encouragement.
- Use `think` when a fit score is genuinely unclear — especially when portfolio strengths and company expectations only partially overlap.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Characterizes your portfolio type (platform builder, product engineer, etc.) | Decides which companies to target |
| Scores fit across 5 company types with specific evidence | Supplies company signals (blog, postings, stack) and your non-negotiables |
| Names Top 2 best-fit and worst-fit company types first | Validates fit signals with network contacts at target companies |
| Leaves missing facts as `[확인 필요]` instead of inventing them | Fills the blanks and makes final application decisions |

## Related Skills

- `../portfolio-jd/SKILL.md` — once you've chosen a target, do JD-specific gap analysis
- `../portfolio-rewrite/SKILL.md` — improve weak sections after identifying positioning gaps
- `../portfolio-feedback/SKILL.md` — overall assessment before company fit analysis
