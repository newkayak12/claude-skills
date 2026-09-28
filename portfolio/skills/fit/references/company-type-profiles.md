# Company Type Profiles

Used by `fit` in **company-type mode** (no JD) — Stage 2 and the per-type scoring — and in **JD mode** only to weight a requirement by the named company's size/stage. Include only the categories relevant to what the user asks.

## The five profiles

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

## Named company

For a named company, reason about its actual engineering culture from **user-supplied** signals (engineering blog, job postings, tech stack) within its type profile — not its reputation. A signal the user did not give is `[확인 필요: ○○]` (e.g. `[확인 필요: 카카오 채용공고 기술스택]`); the company names in the headings above are examples of the type, not facts about those companies' current hiring. A company may sit in two types at once (a ~100명 핀테크 is both 성장기 스타트업 by size and 핀테크/엔터프라이즈 by domain) — score both and say which one dominates for this candidate.

## JD mode use

When a JD names a company or states its size/stage, place it in one or two profiles above and use them only to weight requirements ("Kubernetes preferred" at a 10-person startup ≠ at a 200-person platform team). The profile never adds a requirement the JD does not state, and the weighting is stated in the 🧠 JD note.
