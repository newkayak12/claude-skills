---
name: rewrite
effort: high
description: >-
  Use when resume or portfolio lines need a stronger rewrite, optionally to a
  JD. Triggers: "이 문장 고쳐줘", "이 부분 어떻게 쓰면 좋아", "더 잘 쓰는 법",
  "임팩트 있게 바꿔줘", "rewrite this portfolio section", "이력서 맞춰줘", "공고에 맞게 고쳐줘",
  "이력서 최적화", "tailor my resume to this JD".
scenarios:
  - "Rewrite this portfolio bullet point to sound more senior"
  - "I have vague impact claims — help me rewrite them with stronger language"
  - "Tailor my resume to this job description — keyword alignment, achievement reframing and skills reordering"
  - "이 문장 더 임팩트 있게 고쳐줘"
  - "이 포트폴리오 섹션 시니어 수준으로 리라이팅 해줘"
  - "이 공고에 맞게 이력서 최적화해줘"
  - "Add metrics to my resume bullets — I'm not sure what numbers I even have"
  - "수치 넣고 싶은데 데이터가 없어"
compatibility:
  recommended: []
  optional:
    - think-tool
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 리라이팅 전 원본 문장의 실제 약점을 진단하는 품질이 높아집니다.
    sequential-thinking이 있으면 JD 모드에서 JD 분석 → 갭 분석 → 섹션 리라이팅 순서를 강제합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Portfolio Section Rewriter

**Not for** overall scoring (`feedback`), holistic writing patterns (`pattern`), or deciding whether to apply to a posting at all (`fit`).

## Standing Mandates

- NEVER supply a fact the user did not give. A missing number, cause, date, tool, scope or context is written `[확인 필요: ○○]` in its place — no invention, no estimate, no 역산, no candidate values. `API 응답속도 개선` becomes `API 응답속도 [확인 필요: 개선 전/후 수치] 개선`, never `40% 개선`.
- NEVER alter an achievement number, scope claim or timeline fact the text already states. `820ms → 310ms` stays `820ms → 310ms` in the After.
- Rewrite by purpose — vocabulary, emphasis, order, shape. The two rules above are the only bound; the writing-mode guard of `feedback` is not imported (default - revisit).
- Rewrite first, then ask: questions follow the rewrite, never replace it.
- Keep the `[확정]` ledger; nothing on it is re-proposed or reopened.
- JD mode: ALWAYS run the JD analysis and the gap analysis before rewriting any section, and ALWAYS lead with the `JD 적합도 판정` line; every later block cites it rather than restating it.

## Mode

**A target JD is optional. Its presence switches the rewrite into JD-tailoring mode**, which performs keyword alignment, achievement reframing (XYZ/STAR, passive 참여/기여 reframed) and skills reordering against that posting. Without a JD, the skill runs passage mode: each pasted passage is strengthened on its own, exactly as below. Both modes cover 이력서 and 포트폴리오 sections.

- JD supplied → JD mode, even if the user only says "고쳐줘".
- User asks to tailor ("공고에 맞게", "tailor to this JD") but gives no JD → ask for the full JD text; do not guess the posting. A company name alone is not a JD.
- No JD, no tailoring ask → passage mode.

## Process

**0. Ledger.** In a continuing session, restate the `[확정]` list before any new work: excluded items, kept wording, numbers already judged over-claimed, and a pattern already called out. Check every proposal against it. Add each decision the user makes to it.

**1. Diagnose (think-tool).** Before rewriting, call `think` if available:
- What is the candidate actually trying to say?
- Which element is weakest: missing numbers, passive ownership, vague outcome, no context, no tradeoff? Which XYZ+S letter is absent?
- What is implied but unstated, and is it fixable by phrasing or does it need facts only the candidate has?

### Passage mode (no JD)

**2. Rewrite with markers.** Produce the rewrite now, not after asking, with `[확인 필요: ○○]` wherever a fact is missing. List the questions after the rewrite.

**3. Apply the techniques** below, then explain what changed and why.

**4. Pattern once.** If the whole document is weak the same way, call it out once as a pattern and record it in `[확정]` so later turns do not repeat it.

**5. Offer continuation**: "이 외에 고치고 싶은 섹션이 있으면 붙여넣어 주세요."

### JD-tailoring mode

If `sequential-thinking` is available, use it to enforce (a) JD analysis → (b) gap analysis → (c) rewrites. After the gap analysis, section rewrites are independent and can be generated in parallel. Full detail and examples: `references/jd-tailoring.md`.

**2. Gather inputs.** Resume/portfolio + full JD text are required; company size/stage, role level and why this role are useful (§1).

**3. Analyze the JD** — required skills (frequency = emphasis), soft-skill and leadership signals, responsibility verbs, implicit culture signals (§2). Per-company-type signals: [`korea-company-culture-signals.md`](../../references/korea-company-culture-signals.md).

**4. Gap analysis** — table `JD requires | Resume shows | Gap?` (Missing / Weak / Strong), then high-priority gaps, hidden strengths, de-emphasis candidates (§3). Compute the 판정 line from the must-have rows.

**5. Rewrite sections**, actual Before/After text, not suggestions (§4):
- **Keyword alignment** — translate vocabulary to the JD's words; facts never move.
- **Achievement reframing** — XYZ/STAR shape; passive "참여했다/기여했다" and outcome-less lines reframed, missing results as markers.
- **Skills reordering** — front-load what the JD names; never add a skill the resume lacks.
- **Summary / Profile** — mirror the JD's ideal-candidate framing with the resume's own facts.
- **ATS** — Korean keyword and format rules: [`ats-rules-korea.md`](../../references/ats-rules-korea.md).

**6. Name what NOT to change** — well-aligned sections, each with the gap row it satisfies.

**7. Pattern once and offer continuation**, as in passage mode.

Write in the language of the original (Korean input → Korean output).

### Rewriting Principles

Every pair below holds the same facts on both sides; what the Weak side lacks stays a marker. Both modes use them.

**XYZ+S — the bullet-level target shape**
`Accomplished X, measured by Y, by doing Z — in context S.` Most weak bullets are missing Y (the metric) or S (why the context made it hard). A bullet with all four rarely needs more words, it needs the right four.
- Weak: `배포 파이프라인 개선 (빌드 캐시 분리, 카나리 자동화, 30분 → 4분, 정산 서비스 일 40회 배포)`
- Strong: `배포 소요 30분 → 4분 (X, Y) — 빌드 캐시 분리와 카나리 자동화로 (Z), 일 40회 배포하는 정산 서비스에서 (S)`

**Specificity over generality**
- Weak: "성능 개선"
- Strong: "[확인 필요: 적용한 조치]로 [확인 필요: 측정 지표와 개선 전/후 수치] 개선"
- Finding the number: `references/metric-discovery.md` — metric types, discovery questions, data sources. Claude asks; it never proposes a value.

**Ownership language**
- Weak: "구현되었습니다", "팀에서 진행했습니다"
- Strong: "제가 [확인 필요: 직접 맡은 범위 — 설계/제안/주도 중 무엇]을 맡아 진행했습니다"

**Decision, not just action**
- Weak: "메시지 유실 방지를 위해 Kafka(파티션 순서 보장, 리플레이)로 비동기 처리를 구현했습니다. RabbitMQ도 검토했습니다"
- Strong: "메시지 유실 없는 비동기 처리가 필요했고, RabbitMQ 대신 Kafka를 선택한 이유는 파티션 기반 순서 보장과 리플레이 가능성 때문이었습니다"

**Outcomes, not activities**
- Weak: "Grafana + Prometheus로 모니터링 시스템을 구축했습니다"
- Strong: "Grafana + Prometheus 모니터링을 도입해 [확인 필요: 도입 전/후 달라진 지표와 수치]"

**Conflict and resolution**
Perfectly smooth portfolios feel rehearsed; what went wrong and how it was resolved is more credible than pure success — but both come from the candidate, or stay `[확인 필요: ○○]`.

## Output Template

### Passage mode (no JD)

No `JD 적합도 판정` line and no gap table. For each passage, in this order:

**진단 / Diagnosis** — one line: the weakest element (e.g. "Y 없음 — 성과가 수치 없이 활동으로만 적힘").

**Before:**
> [original text, verbatim]

**After:**
> [rewritten version, missing facts as `[확인 필요: ○○]`]

**왜 더 강해졌는가:**
2–4 sentences: what changed and why it matters to an interviewer, naming the technique (changed subject from "we" to "I", surfaced the decision, reshaped to XYZ+S, added failure-and-recovery arc).

> 🧠 **Rewriter note**: [only if the diagnosis or rewrite needed a real judgment call]

**[확인 필요 질문]** *(omit when none)* — one question per marker, in the order they appear. For a missing number, ask the metric type and where the data might live (`references/metric-discovery.md`), never a value. A figure the user gives themselves is carried as written, tagged `(본인 추정)`, logged in `[확정]`; without a baseline `feedback` still counts it incomplete. "모르겠어요" or no data: the marker stays, or suggest dropping or merging the line.

**[확정]** *(continuing session)* — the restated list plus anything settled this turn, including a pattern call-out already made.

Close with the continuation offer.

### JD-tailoring mode

The first block is the 판정 line: one line, labels kept literally (`JD 적합도 판정:`, `must-have n개 중`, `Missing n · Weak n`, `최우선 변경:`) even when the rest is Korean prose. The last block is What NOT to Change. Questions, `[확정]` and the continuation offer go inside the Section Rewrites block, never after What NOT to Change.

```
**JD 적합도 판정:** must-have n개 중 Missing n · Weak n — 최우선 변경: [one change, naming the section/line]

## JD Analysis Summary
[Key requirements, emphasis areas, culture signals in 5–8 bullets, citing the 판정]

## Gap Analysis
| JD requires | Resume shows | Gap? |
[Missing / Weak / Strong rows; hidden strengths; de-emphasis candidates]

## Section Rewrites

### Profile / Summary
Before: [current text]
After:  [rewritten text; gaps as [확인 필요: ○○]]

### Experience — [Company / Role]
Before: [current bullets, verbatim]
After:  [rewritten bullets; stated numbers unchanged]

[Repeat for each section needing change]

### Skills Section
Reordered priority: [new ordering]

[확인 필요 질문] — one per marker · [확정] (continuing session) · continuation offer

## What NOT to Change
[Sections already well-aligned — leave as-is, with the gap row each satisfies]
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Diagnoses what is actually weak in the original (not just "it's vague") | Fill each `[확인 필요]` with real numbers, your specific role, what changed |
| JD mode: decodes the JD and builds the gap table before any rewrite | Supply the full JD text; confirm must-have vs 우대 reading |
| Produces Before/After with explanation of what changed and why | Validate the rewrite is factually accurate |
| Keeps the `[확정]` list and never re-proposes what is on it | Say what is settled, excluded or kept; decide which version to use |

## Related Skills

- `../pattern/SKILL.md` — diagnose patterns before targeted rewriting
- `../feedback/SKILL.md` — understand which sections to prioritize for rewriting
- `../fit/SKILL.md` — fit to a posting or company type, before deciding to tailor
