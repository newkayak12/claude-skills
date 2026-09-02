# portfolio

**English** · [한국어](KOR.md)

Skills for the whole arc of a job application: reading what a job posting actually wants, deciding
where you are competitive, rewriting your materials so your real experience reads at the level it
was, and rehearsing until you can defend it out loud. The skills are deliberately narrow and
non-overlapping — scoring a portfolio, diagnosing its writing patterns, rewriting a sentence, and
matching it to a JD are four different jobs, and each one names the others it is not.

Everything is calibrated for the Korean job market — company-type profiles, ATS rules, and culture
signals live in `references/ats-rules-korea.md` and
`references/korea-company-culture-signals.md`. Analysis output is written in Korean by default.

Several skills use `think-tool` and `mcp-reasoner` as required checkpoints for their
highest-stakes judgments (severity classification, pass/screen-out calls, ownership
classification). Connect them under Claude settings → MCP Servers as remote SSE endpoints.

## Install & Uninstall

```bash
/plugin install portfolio@newkayak12-claude-skills
/plugin uninstall portfolio@newkayak12-claude-skills
```

## Which skill do I want?

| I want to… | Skill |
|---|---|
| Run a whole application from JD to interview day | `job-application-workflow` |
| Know how well I match one specific posting | `portfolio-jd` |
| Decide where to apply when I have no posting yet | `portfolio-company` |
| Get an honest interviewer's read on my portfolio | `portfolio-feedback` |
| Check whether my numbers, skills, dates — and claimed level — hold up | `portfolio-feedback` |
| Find out why my portfolio doesn't read as "ownership" | `portfolio-pattern` |
| Rewrite specific weak sentences to senior level | `portfolio-rewrite` |
| Rewrite my resume to match one JD's vocabulary | `resume-tailorer` |
| Get a week-by-week study plan before interviews | `interview-prep` |
| Practice defending my work in a mock interview | `portfolio-interview` |
| Swap the key colors in a PPTX across every slide | `ppt-keycolor-changer` |

## Skills

### `job-application-workflow`

The entry point. Four steps for one specific role: JD analysis → company research → resume and
portfolio tailoring → interview preparation. Use it when you have a target company and posting in
hand. Skip it for open-ended "what should I do with my career" questions, or when you have already
passed interviews and are negotiating an offer.

```
Coupang backend engineer posting, applying next week. JD is pasted below —
run the whole process with me from JD analysis through interview prep.
```

```
[1] portfolio-jd          JD decoding, must-have vs nice-to-have, fit gaps
      ↓
[2] portfolio-company     culture signals, talking points, red flags
      ↓
[3] resume-tailorer (+ portfolio-rewrite)   tailored resume, cover letter draft
      ↓
[4] interview-prep        STAR story bank, likely questions, questions to ask
```

Each step has a skip condition and a standalone-input fallback, so you can start at Step 4 with
just a JD and a company name. Estimated 3–10 hours for the full run, 30–90 minutes per step.

### `portfolio-jd`

Parses the JD and the portfolio *independently* — comparing too early biases the read toward the
portfolio's own framing — then scores fit across five dimensions: tech stack, experience scale,
role scope, domain, and soft signals. Each gap is classified 치명적 / 보완 가능 / 마이너 with the
reason for that severity. It ends with an honest pass / borderline / screen-out call and the one
factor that would most shift it. Not for company-type matching without a posting
(`portfolio-company`) or resume keyword work (`resume-tailorer`).

```
Here's my portfolio and the full JD for a senior backend role at a Series C fintech.
Score the fit, tell me which gaps are fatal, and be honest about whether I'd pass screening.
```

```
[종합 매칭 점수]  7 / 10
- 기술 스택 8/10   - 경험 스케일 6/10   - 역할 범위 7/10
- 도메인 5/10      - 소프트 시그널 8/10

[갭 분석]
갭: 결제 도메인 경험 없음
심각도: 보완 가능
대응 방법: 커버레터에서 정산 배치 경험을 도메인 인접성으로 프레이밍
```

### `portfolio-company`

For when you have no specific posting. Characterizes what kind of engineer the portfolio signals,
then scores fit against Korean company types — 대형 플랫폼, 성장기 스타트업, 핀테크/엔터프라이즈,
글로벌 테크, 개발도구/OSS — each with what they *actually* look for versus what they say, plus
green flags and red flags. Names your Top 2 fits and the types where you would struggle. It never
scores fit on name recognition alone, and it asks for your non-negotiables (location, domain,
stack) first.

```
Five years backend, mostly internal platform work at a mid-size company.
No specific posting yet — where would this portfolio actually be competitive?
```

Each company type gets a fit score, the specific portfolio evidence behind it, the specific
mismatch, and one concrete thing to fix before applying there.

### `portfolio-feedback`

Reads your portfolio as an interviewer who has seen a hundred this week — pattern-matching on
what's *missing*, not just what's present. You pick one of four reviewer personas (Staff Engineer /
Startup EM / Enterprise Tech Lead / OSS-DevTools Lead) and it stays in that persona throughout.
Scores five dimensions, then challenges every score of 7 or above with the objection a skeptical
interviewer would raise; only scores that survive stay high. Not for rewriting sentences
(`portfolio-rewrite`) or JD matching (`portfolio-jd`).

```
Review my portfolio as a staff engineer at a large platform company.
Be harsh — I'd rather hear it now than in the interview.
```

Five dimensions: Technical Depth · System Design · Impact and Results · Leadership/Ownership ·
Portfolio Narrative. Score is the highest level *fully* satisfied — partial evidence does not round
up. Output includes the single core vulnerability, the top five questions this persona will ask,
and three prioritized fixes. Rubric and persona details: `references/scoring-rubric.md`,
`references/personas.md`.

```
[차원별 점수]
Technical Depth: 6 / 10
근거: Kafka 도입은 서술되어 있으나 대안 검토와 트레이드오프가 없음
🧠 Devil's advocate: 규모 수치는 인상적이나 본인 기여 범위가 불명확 — 7 → 6
```

Beyond the interviewer's read, it answers whether the document gets read at all. A quantified
document-convention check (`references/resume-conventions.md` — summary block, bullet budget, XYZ+S
shape, section order, and the ownership rule that differs by language), tallied rather than listed
and capped at the five highest screen-cost violations (`XYZ+S n/m · 의사결정 동사 n%`); an
ATS/parser-safety pass (evidence trapped in tables or images, non-standard section headers, contact
in the PDF header — the document is parsed before it is read); an `[AI 스크리너 요약 / AI Screener
Summary]` — the 3-line summary a screening model would actually generate, plus what of the
candidate's strongest evidence did not survive it; and a two-reader `[서류 스크린 판정 / Screen
Verdict]` grounded in screening research (`references/screen-models.md`): a recruiter 6-second pass
judged only on the F-pattern visible path (Ladders eye-tracking) and an engineer 30-second skim with
typo/tech-name checks (Lerner's calibration data), each 통과/경계/탈락 with the deciding factor —
plus a `[레드 플래그 / Red Flags]` block (경력 갭, 잦은 이직, 직함 인플레이션, 검증 불가 주장 비율 …)
where each flag carries a one-line interview defense; screeners read to reject, so flags are never
netted against strengths.

This screen layer was developed in a `-beta` lane and merged in after two head-to-head benchmarks
(a real 40-page portfolio and the impressive-surface fixture) returned identical dimension scores and
identical core-vulnerability findings on both sides, while the screen pass added real catches the
substance-only review structurally cannot make — an unexplained 8-month gap, a metric that meant two
different things in two documents, a resume with no contact details at all.

Hand it a previous version too and it switches to **revision mode** (`references/revision-diff.md`):
the review opens with a before/after tally table and whether the screen verdict moved, regressions
get their own lines — including claims the rewrite *introduced*, like a summary that now says 설계
over bullets that still say 개발 — and time-windowed claims ("12개월 무사고") are checked against
today's date. Promoted from the beta lane after a v1/v2 head-to-head where the structured diff caught
two regressions the ad hoc comparison missed. Tally denominators are pinned in the same file so two
versions are always counted the same way.

Three more passes, from `references/claim-and-consistency.md`, ask whether the document agrees with
itself: a **consistency cross-check** (dates across sections against the summary's tenure, every
Skills entry against the bullets that would evidence it — `스킬 근거율 n/m` with the unevidenced
entries named, role claims against bullet verbs), a **claim audit** (every outcome bullet checked
for 수치·베이스라인·기간·기여 범위 — `완전 주장 n/m`, worst three named with the exact interview
question each invites; the tally caps the Impact score, it never sets it), and **level
calibration** — the level the document claims (연차, 직함, target role) against the level it reads
at on a four-rung evidence ladder (주니어 / 미드 / 시니어 / 리드), `레벨 갭 ±n` with the two bullets
that set the ceiling. Over-claim is the 직함 인플레이션 flag with a number on it; under-claim is
Improvement Priority #1.

```
7년차 시니어라고 썼는데 이 문서가 진짜 시니어로 읽히는지 봐줘
```

```
레벨 갭: 주장 시니어 / 읽힘 미드 (−1) — 천장: "주문 조회 API 1.2s → 380ms", "중복 차감 주 12건 → 0건"
XYZ+S 0/8 · 완전 주장 2/3 · 스킬 근거율 5/6 · 날짜 불일치 0 · 레벨 갭 −1 · 의사결정 동사 0% · 불릿/롤 max 5
```

Every review ends with that one tally line, and the candidate can re-count it against their own
document: bullets are listed before they are counted, denominators are pinned, each finding is
stated once, and thresholds are labelled provisional (§D, §F). These passes were promoted from the
`-beta` lane after three benchmarks — the first two showed findings parity with one extra finding
(`레벨 갭`) but miscounted tallies; the third, after the counting rules were pinned, matched the
hand-computed ground truth on every tally across both fixtures.

### `portfolio-pattern`

Not what your portfolio says but how it reads. Audits six dimensions: decision-verb ratio
(제안/채택/배제 vs. bare 개발했습니다), agency language, number density, failure-narrative presence, decision visibility,
and verb energy. Use it when you've been told your portfolio "lacks ownership" but nobody could
point at where. Not for rewriting the flagged sentences (`portfolio-rewrite`) or overall scoring
(`portfolio-feedback`).

```
People keep saying my portfolio doesn't show ownership. Analyze the writing patterns
and show me the actual sentences causing that impression.
```

Thresholds it applies: fewer than ~20 % of action sentences carrying a decision verb is worth
calling out in a senior portfolio (the `저는/제가` rate is deliberately *not* measured — subject
omission is normal Korean); a number-free impact-claim rate above 60 % for 5+ years of
experience is a problem. Complete absence of failure or difficulty is itself a signal.

### `portfolio-rewrite`

Takes specific passages and produces Before / After with a 2–4 sentence explanation of what changed
and why it lands differently with an interviewer. It diagnoses the actual weakness first — missing
numbers, passive ownership, no context, no tradeoff, no outcome — and if the facts needed to make
the rewrite specific are missing, it asks rather than inventing metrics. Output is in the same
language as the input.

```
"모니터링 시스템을 구축했습니다" — rewrite this and the three bullets under it
so they read at senior level.
```

| Principle | Weak | Strong |
|---|---|---|
| Specificity | 성능 개선 | N+1 제거로 p99 900ms → 140ms |
| Ownership | 팀에서 진행했습니다 | 제가 설계하고 주도했습니다 |
| Decision, not action | Kafka로 비동기 처리 구현 | RabbitMQ 대신 Kafka를 택한 이유는 순서 보장과 리플레이 |
| Outcome, not activity | 모니터링 구축 | 장애 감지 시간 40분 → 3분 |

### `resume-tailorer`

Resume plus one specific JD. Extracts the JD's required skills (frequency signals emphasis), soft
skill signals, responsibility verbs, and implicit culture cues; runs a gap analysis table
(Missing / Weak / Strong); then produces actual rewritten text — not suggestions — per section,
plus a list of what NOT to change. It never alters achievement numbers, scope claims, or timeline
facts. Tailoring is translation, not embellishment.

```
My resume and this Naver JD. The experience is there but I think I'm describing it
in the wrong vocabulary — align it and tell me what to leave alone.
```

```
## Gap Analysis
| JD requires | Resume shows | Gap? |
|---|---|---|
| 대용량 트래픽 (1M+ DAU) | "백엔드 API 개발" | Weak |

## Section Rewrites
Before: 백엔드 API 개발 및 성능 최적화
After:  일 활성 사용자 150만 규모 서비스의 백엔드 API 설계 및 병목 구간 35 % 개선
```

ATS keyword rules and per-company-type culture signals: `references/ats-rules-korea.md`,
`references/korea-company-culture-signals.md`.

### `interview-prep`

Planning, not practice. Gathers your background, target, timeline and biggest worry; calibrates to
company type (FAANG, Korean Tier-1, growth startup, enterprise — each tests materially
differently); identifies gaps across coding, system design, and behavioral; then produces a
week-by-week plan where every week has a measurable milestone, plus a 6–8 prompt STAR story bank.
It will not produce a plan without knowing your interview date, and it runs gap analysis before
planning — skipping that is the most common failure.

```
Kakao backend interview in 8 weeks. Six years Spring/JVM, weak on distributed
system design, strong on coding. Build me a prep plan.
```

Final-week rule: no new material. Two full mocks, STAR stories rehearsed aloud, three hardest
problems re-attempted, logistics settled. Topic sequencing and practice volume per domain:
`references/study-domains.md`.

### `portfolio-interview`

A live mock interview grounded in your actual portfolio, in one of four personas. Question types:
anchored (straight from your portfolio), gap probes (what's vague — "팀 전체가 한 건지 본인이
주도한 건지"), depth drills (one level below what you wrote), failure/recovery, and hypothetical
extension. One question at a time, no preview of the list, and it pushes back once on evasive
answers. A coaching note follows each answer; the interview itself stays realistic rather than
therapeutic. Not for building a study plan (`interview-prep`).

```
Mock interview me as an enterprise fintech tech lead, based on this portfolio.
Don't go easy on the reliability questions.
```

Closes with an overall verdict (would this persona advance you), your strongest and weakest
answers, and the one thing to work on before the real interview.

### `ppt-keycolor-changer`

Swaps key colors across an entire PPTX by scanning and replacing raw XML — which catches theme
tokens, gradient stops, chart series, table cells, hyperlinks, and `schemeClr` mappings that the
python-pptx API misses. Discovery always runs first, even when you already know the hex, because
the frequency scan proves the color is in the file and surfaces tonal variants. The mapping table
is confirmed with you before anything is written; output is a new file, never an overwrite.
Requires Python 3.9+ (stdlib only).

```
presentation.pptx의 오렌지 계열 색을 전부 토스 파란색으로 바꿔줘.
바꾸기 전에 어떤 색이 몇 번 쓰였는지 먼저 보여주고.
```

```bash
# Step 1 — discover: frequency table of every hex in the file
python /abs/path/to/skills/ppt-keycolor-changer/scripts/ppt_keycolor_changer.py discover \
  --input "deck.pptx"

# Step 5 — replace, after you confirm the mapping table
python /abs/path/to/skills/ppt-keycolor-changer/scripts/ppt_keycolor_changer.py replace \
  --input   "deck.pptx" \
  --mapping '{"E85E3A":"0064FF","FF8060":"4D96FF","FFB399":"99C2FF"}' \
  --exclude "336699" \
  --suffix  tossblue
```

Built-in presets (main / light / lighter / muted / dark): `toss-vivid`, `toss-soft`, `apple-blue`,
`material-indigo`, `kakao-yellow`, `naver-green`. Source tones are mapped to target tones by HSL
lightness rank so the visual hierarchy survives.

Always preserved unless you explicitly override: `#000000`, `#FFFFFF`, `#F9F9F9`, `#FEFEFE`,
`#FDFDFD`, any color with RGB max − min ≤ 20, and any hue more than 60° from the source. Output is
named `<original>_<suffix>.pptx` and auto-increments to `_v2`, `_v3` rather than overwriting.

Known limits, reported explicitly rather than hidden:

| Limit | Detail |
|---|---|
| Embedded images | PNG/JPEG/WMF/EMF pixels cannot be changed by XML substitution |
| External Excel charts | Series colors defined in a linked `.xlsx` are outside the PPTX |
| Encrypted PPTX | The ZIP cannot be opened — remove the password first |

Every report ends with the image caveat: colors inside inserted images need editing in an image
tool, not here.

---
