# Resume & Portfolio Document Conventions

Form check, separate from substance scoring. The five dimensions score what the document
says; this checks how it is built. Form defects don't lower a dimension score — they cost
the screen before anyone reads deeply enough to score. Run this pass in under a minute and
report violations flatly; skip anything that passes.

## 1. Summary block

2–3 lines, specific, at the top. It answers "what kind of engineer, at what depth, with
what proof" — not "passionate about clean code."

- Weak: `문제 해결을 좋아하는 백엔드 개발자입니다`
- Strong: `백엔드 5년 · 정산/결제 도메인 · MAU 80만 서비스의 p99 140ms 유지 · Kafka 기반 정산 파이프라인 설계`

No summary at all is acceptable for a portfolio; a generic one is worse than none.

## 2. Subject conventions differ by language — do not mix the rules

- **English resume**: no personal pronouns. Bullets start with the verb.
  `I led the migration` → `Led migration of 40 services to K8s, cutting deploy time 30m → 4m`
- **국문 경력기술서/포트폴리오**: 주어가 오너십의 증거다. `제가/저는`이 행동 문장의 주어로
  드러나야 하고, 피동(`구현되었습니다`)이 기본값이면 결함이다 — `portfolio-pattern`의
  Subject Audit과 같은 기준.

Flag a document that applies one language's rule to the other. An English resume full of
"I" reads junior; a Korean 경력기술서 scrubbed of subjects reads evasive.

## 3. Length and bullet budget

1–2 pages. 3–5 bullets per role; 6+ means the weakest carry no metric — cut those first.
0–3 years: one page. A portfolio (as opposed to a resume) may run longer, but each project
still gets a bullet budget: if a project has 10 bullets, it has 5 bullets and 5 padding.

## 4. XYZ+S bullets

`Accomplished X, measured by Y, by doing Z — in context S.` Target: ~70% of achievement
bullets carry all four.

- Weak: `배포 파이프라인 개선`
- Strong: `배포 소요 30분 → 4분 (X, Y) — 빌드 캐시 분리와 카나리 자동화로 (Z), 일 40회 배포하는 정산 서비스에서 (S)`

The rewrite mechanics live in `portfolio-rewrite`; this pass only counts how many bullets
qualify and names the worst three.

## 5. Section order

Contact → Summary → Experience (most recent first) → Projects/OSS → Education →
Certifications → Skills (optional, last). For developers, Projects/OSS may precede
Experience only when it is genuinely the stronger evidence (early career, career changer).
A Skills section is an index, not evidence — anything that matters must also appear inside
an experience bullet with context (`Kafka` in a list says nothing; the bullet that chose
Kafka over RabbitMQ and says why does).

## 6. Titles and contact hygiene

- Standard titles: Backend Engineer, Senior Software Engineer, Platform Engineer — not
  `코드 장인`, `Tech Wizard`. If the official title undersells the role (SI 파견 직함,
  "연구원" who did full backend ownership), use the standard title and keep the official
  one for the interview explanation.
- Email: name-based address. Flag `dragonslayer93@…`.
- Dates in Month–Year, gaps visible rather than smoothed over.

## 7. Early-career / career-changer framing

Under ~1 year of professional experience: coursework, bootcamp capstones, internships, and
side projects are the experience section — write them with the same XYZ+S discipline
(`사이드 프로젝트 X — 베타 유저 500명, 리텐션 분석으로 핵심 기능 2회 개편`). Career changers
frame prior-field work through an engineering lens (what they automated, measured,
systematized), not as an apology.

## 8. Machine readability (ATS / parser safety)

The document is parsed before it is read — by classic ATS extractors and, increasingly, by
LLM screeners. Content that doesn't survive plain-text extraction doesn't exist.

- **Core content in body text** — anything living only inside tables, multi-column layouts,
  text boxes, or images evaporates in plain-text extraction. Decorative layout is fine;
  evidence in it is not.
- **Standard section headers** — 경력/Experience, 프로젝트/Projects, 학력/Education. A parser
  maps `제가 걸어온 길` or `My Journey` to nothing.
- **Contact in the body** — PDF headers/footers are routinely dropped by extractors. Name,
  email, and links belong in the document body, near the top.
- **Abbreviation + full form once each** — `K8s` alone misses a `Kubernetes` keyword search
  and vice versa. First mention: `Kubernetes(K8s)`; either form after that.
- **Text PDF, never scanned** — export from the editor, don't print-and-scan. If text can't
  be selected in the PDF, the document is invisible to every parser.
- **Consistent date format** — one format throughout (see §6); mixed formats break tenure
  calculation in parsers that compute experience length.
