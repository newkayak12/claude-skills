---
name: portfolio-company
effort: high
description: >-
  Use when someone wants to know which companies or company types their
  portfolio would appeal to — without a specific JD in hand. Triggers on: "which
  companies fit my portfolio", "where should I apply", "어느 회사에 잘 맞아?", "네이버
  지원하려는데 어때?", "어디 써볼 만해?",
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

- ALWAYS read company signals (engineering blog, job postings, tech stack) before scoring fit.
- ALWAYS distinguish 'can apply here' from 'strong mutual fit here'.
- NEVER recommend applying to a company based solely on name recognition.
- NEVER score fit without knowing the candidate's non-negotiables (location, domain, stack).


# Portfolio × Company Fit Analyzer

## When to Use / When Not to Use

**Use when:**
- Deciding where to apply without a specific JD in hand
- Wanting a fit score across multiple company types at once
- Needing honest feedback on where this portfolio would struggle

**Not for:**
- You have a specific job posting (use portfolio-jd)
- You want to rewrite portfolio sections (use portfolio-rewrite)
- You want overall feedback on portfolio quality (use portfolio-feedback)

## Process

1. **Characterize the portfolio** — what type of engineer does it most clearly represent? what are the strongest and weakest signals?
2. **Plan analysis across company types** — identify which types are relevant; what each actually looks for vs. states
3. **Score each company type** — fit score (X/10) + green flags + red flags + one concrete improvement action
4. **Name Top 2 fits and worst fits** — where this portfolio is most and least competitive
5. **Produce positioning suggestions** — if the target isn't the natural fit, what 2-3 changes would move the needle?

## Standalone Inputs

Provide: your portfolio (paste or describe key sections), and optionally any specific company names you're considering.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Characterizes your portfolio type (platform builder, product engineer, etc.) | Decides which companies to target |
| Scores fit across 5 company types with specific evidence | Validates fit signals with network contacts at target companies |
| Names Top 2 best-fit and worst-fit company types | Makes final application decisions |
| Recommends 2-3 portfolio changes to improve fit for a target type | Does the actual relationship building and applying |

## Related Skills

- `../portfolio-jd/SKILL.md` — once you've chosen a target, do JD-specific gap analysis
- `../portfolio-rewrite/SKILL.md` — improve weak sections after identifying positioning gaps
- `../portfolio-feedback/SKILL.md` — overall assessment before company fit analysis

---

## Stage 1 — Characterize the Portfolio (Think Tool)

Before doing any company analysis, call `think` to build a clear profile of what this portfolio signals:

- What kind of engineer does this portfolio most clearly represent? (platform builder, product engineer, infrastructure specialist, generalist, etc.)
- What is the strongest signal in the portfolio? (scale experience, ownership, depth, breadth, communication quality?)
- What is the weakest or most ambiguous signal?
- What does this portfolio *not* say — and would a particular company care?

> 🧠 **Fit note**: Record the core portfolio profile here. Everything downstream depends on this read.

---

## Stage 2 — Company Type Framework (Sequential Thinking)

Call `sequentialthinking` to plan the analysis across company types. Think through:
- Which company categories are relevant for a 5+ year Korean backend engineer?
- What does each type actually look for vs. what they say they look for?
- Which types are this portfolio's natural fit vs. a stretch?

---

## Company Type Profiles

Evaluate fit against the following categories. Adjust which ones are included based on what the user asks — don't force irrelevant categories.

---

### 대형 플랫폼 (네이버, 카카오, 라인, 쿠팡 등)
**What they actually look for:**
- System scale experience (millions of users, high QPS, distributed systems)
- Technical depth and ability to own complex infra decisions
- Evidence of working within large engineering organizations (process, code review culture, RFC/design doc experience)
- Stability and reliability focus

**Green flags**: specific scale numbers, distributed systems experience, performance optimization with before/after metrics
**Red flags**: only small-scale projects, startup-style "we did everything" without depth, no system design evidence

---

### 성장기 스타트업 (Series B–D, 50–300명)
**What they actually look for:**
- Ownership and initiative beyond assigned tasks
- Ability to make good-enough decisions fast
- Cross-functional collaboration, not just backend silo
- Evidence of building something from scratch or scaling it meaningfully

**Green flags**: founding engineer experience, greenfield architecture ownership, business impact language
**Red flags**: only large-company execution work, no initiative signals, heavy process dependency

---

### 핀테크 / 엔터프라이즈 (토스, 카카오뱅크, SI 계열 등)
**What they actually look for:**
- Reliability, compliance awareness, and risk management mindset
- Long-term system maintainability and documentation discipline
- Incident handling and operational maturity
- Consistent track record over flashy projects

**Green flags**: SLA/SLO experience, incident runbooks, security awareness, payment/financial system experience
**Red flags**: hype-driven tech choices without rationale, no mention of operational concerns, short tenure on any project

---

### 글로벌 테크 (Google, Meta, Amazon, Databricks 등 한국 오피스 또는 해외 지원)
**What they actually look for:**
- Algorithmic and systems thinking demonstrable beyond the portfolio
- Clear technical communication (design docs, proposals, cross-team alignment)
- Impact at scope (did work affect many users, many teams, or many systems?)
- Leadership even without title

**Green flags**: technical writing samples, cross-org impact, mentorship, open source contributions
**Red flags**: no evidence of technical communication, individual-only work, no demonstration of scope beyond own team

---

### 개발 도구 / 플랫폼 / 오픈소스 팀
**What they actually look for:**
- API and developer experience intuition
- Public technical communication (blog, talks, OSS contributions)
- Abstraction and interface design thinking
- Empathy for other engineers as users

**Green flags**: OSS contributions, technical blog, API design examples, developer tooling work
**Red flags**: entirely internal product work, no public technical footprint, no developer-facing work experience

---

## Output Structure

Write in Korean. Use this structure:

---

**[이 포트폴리오의 핵심 신호]**
In 3–5 sentences: what kind of engineer does this portfolio most clearly represent? This sets the frame for everything below.

---

**[회사 유형별 핏 분석]**

For each relevant company type:

**[회사 유형명]**
- **핏 점수**: X/10
- **이 유형에서 강한 이유**: [specific evidence from portfolio]
- **이 유형에서 약한 이유**: [specific gap or mismatch]
- **지원 전 보완할 것**: [one concrete action]

Insert `🧠 Fit note` where the fit score required a non-obvious judgment call.

---

**[가장 잘 맞는 회사 유형 Top 2]**
Where this portfolio would be most competitive, and why.

---

**[피해야 할 회사 유형]**
Where this portfolio would likely struggle — not because the person is unqualified, but because the portfolio doesn't speak that company's language yet.

---

**[포트폴리오 포지셔닝 제안]**
If the candidate is targeting a specific company type that isn't their current best fit, what 2–3 changes to the portfolio would move the needle most?

---

## Rules

- Be honest about poor fits. It's more useful than false encouragement.
- Tie every fit judgment to something specific in the portfolio — not general impressions.
- If the user names a specific company, reason about that company's actual engineering culture, not just their reputation.
- Use `think` when a fit score is genuinely unclear — especially when portfolio strengths and company expectations only partially overlap.
