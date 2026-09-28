---
name: portfolio-rewrite
description: >-
  Use when someone wants to rewrite specific portfolio sections into stronger,
  senior-level statements — showing Before/After with explanations. Triggers on:
  "이 문장 고쳐줘", "이 부분 어떻게 쓰면 좋아", "더 잘 쓰는 법", "임팩트 있게 바꿔줘", "rewrite this
  portfolio section".
scenarios:
  - "Rewrite this portfolio bullet point to sound more senior"
  - "Make this section show more ownership and impact"
  - "I have vague impact claims — help me rewrite them with stronger language"
  - "이 문장 더 임팩트 있게 고쳐줘"
  - "이 포트폴리오 섹션 시니어 수준으로 리라이팅 해줘"
compatibility:
  recommended: []
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 리라이팅 전 원본 문장의 실제 약점을 진단하는 품질이 높아집니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Portfolio Section Rewriter

**Not for** overall scoring (`portfolio-feedback`), holistic writing patterns (`portfolio-pattern`), or JD keyword matching (`resume-tailorer`).

## Process

**0. Ledger.** In a continuing session, restate the `[확정]` list before any new work: excluded items, kept wording, numbers already judged over-claimed, and a pattern already called out. Check every proposal against it; nothing on the list is re-proposed or reopened. Add each decision the user makes to it.

**1. Diagnose (think-tool).** Before rewriting, call `think` if available:
- What is the candidate actually trying to say?
- Which element is weakest: missing numbers, passive ownership, vague outcome, no context, no tradeoff? Which XYZ+S letter is absent?
- What is implied but unstated, and is it fixable by phrasing or does it need facts only the candidate has?

**2. Rewrite with markers.** Produce the rewrite now, not after asking. Where a number, cause, date, context or role scope is missing, write `[확인 필요: ○○]` in its place — never invent, estimate or back-calculate it, and offer no candidate values. `API 응답속도 개선` becomes `API 응답속도 [확인 필요: 개선 전/후 수치] 개선`, not `40% 개선`. List the questions after the rewrite.

**3. Apply the techniques** below, then explain what changed and why.

**4. Pattern once.** If the whole portfolio is weak the same way, call it out once as a pattern and record it in `[확정]` so later turns do not repeat it.

**5. Offer continuation**: "이 외에 고치고 싶은 섹션이 있으면 붙여넣어 주세요."

Write in the language of the original (Korean input → Korean output).

### Rewriting Principles

Every pair below holds the same facts on both sides; what the Weak side lacks stays a marker.

**XYZ+S — the bullet-level target shape**
`Accomplished X, measured by Y, by doing Z — in context S.` Most weak bullets are missing Y (the metric) or S (why the context made it hard). A bullet with all four rarely needs more words, it needs the right four.
- Weak: `배포 파이프라인 개선 (빌드 캐시 분리, 카나리 자동화, 30분 → 4분, 정산 서비스 일 40회 배포)`
- Strong: `배포 소요 30분 → 4분 (X, Y) — 빌드 캐시 분리와 카나리 자동화로 (Z), 일 40회 배포하는 정산 서비스에서 (S)`

**Specificity over generality**
- Weak: "성능 개선"
- Strong: "[확인 필요: 적용한 조치]로 p99 응답시간 [확인 필요: 개선 전/후 수치] 단축"

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

### Rules

- Rewrite, then ask: questions follow the rewrite, never replace it.
- The writing-mode guard of `portfolio-feedback` is not imported; this skill rewrites by purpose, bounded by the marker rule (default - revisit).

## Output Template

For each passage, in this order:

**진단 / Diagnosis** — one line: the weakest element (e.g. "Y 없음 — 성과가 수치 없이 활동으로만 적힘").

**Before:**
> [original text, verbatim]

**After:**
> [rewritten version, missing facts as `[확인 필요: ○○]`]

**왜 더 강해졌는가:**
2–4 sentences: what changed and why it matters to an interviewer, naming the technique (changed subject from "we" to "I", surfaced the decision, reshaped to XYZ+S, added failure-and-recovery arc).

> 🧠 **Rewriter note**: [only if the diagnosis or rewrite needed a real judgment call]

**[확인 필요 질문]** *(omit when none)* — one question per marker, in the order they appear.

**[확정]** *(continuing session)* — the restated list plus anything settled this turn, including a pattern call-out already made.

Close with the continuation offer.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Diagnoses what is actually weak in the original (not just "it's vague") | Fill each `[확인 필요]` with real numbers, your specific role, what changed |
| Produces Before/After with explanation of what changed and why | Validate the rewrite is factually accurate |
| Applies techniques: specificity, ownership language, decision visibility, outcome framing | Decide which version to use |
| Keeps the `[확정]` list and never re-proposes what is on it | Say what is settled, excluded or kept |

## Related Skills

- `../portfolio-pattern/SKILL.md` — diagnose patterns before targeted rewriting
- `../portfolio-feedback/SKILL.md` — understand which sections to prioritize for rewriting
