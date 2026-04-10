---
name: portfolio-rewrite
description: >-
  Use when someone wants to rewrite specific portfolio sections into stronger,
  senior-level statements — showing Before/After with explanations. Triggers on:
  "이 문장 고쳐줘", "이 부분 어떻게 쓰면 좋아", "더 잘 쓰는 법", "임팩트 있게 바꿔줘", "rewrite this
  portfolio section",
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

## When to Use / When Not to Use

**Use when:**
- Acting on specific improvement areas from portfolio-feedback
- Rewriting sentences that are vague, passive, or junior-sounding
- Turning impact claims without numbers into specific, measurable statements

**Not for:**
- Overall portfolio scoring (use portfolio-feedback)
- Understanding writing patterns holistically (use portfolio-pattern)
- Keyword matching to a JD (use resume-tailorer)

## Process

1. **Diagnose what's weak** — not just "vague" but specifically: missing numbers, passive ownership, no context, no tradeoff, no outcome
2. **Ask for missing facts** — if numbers or role scope are absent, request them before rewriting
3. **Produce Before/After** — verbatim original + rewritten version + 2-4 sentence explanation of what changed and why
4. **Apply techniques** — specificity, ownership language (저는 → 제가 설계했습니다), decision visibility, outcome framing, conflict-and-resolution
5. **Offer continuation** — invite the user to paste additional sections

## Standalone Inputs

Paste the specific portfolio passage(s) you want rewritten. If numbers or role context are missing, Claude will ask before rewriting.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Diagnoses what is actually weak in the original (not just "it's vague") | Provides missing facts: actual numbers, your specific role, what changed |
| Produces Before/After with explanation of what changed and why | Validates the rewrite is factually accurate |
| Applies techniques: specificity, ownership language, decision visibility, outcome framing | Decides which version to use |
| Flags when a rewrite needs facts you haven't provided yet | Supplies those facts so rewrites are honest, not fabricated |

## Related Skills

- `../portfolio-pattern/SKILL.md` — diagnose patterns before targeted rewriting
- `../portfolio-feedback/SKILL.md` — understand which sections to prioritize for rewriting

---

## Stage 1 — Understand What's There (Think Tool)

Before rewriting anything, call `think` to assess:
- What is the candidate actually trying to say here?
- What is the weakest element: missing numbers, passive ownership, vague outcome, no context, no tradeoff?
- What information might be implied but not stated that the candidate probably *has* and just didn't include?
- Is this fixable with better phrasing, or does it need the candidate to supply missing facts?

If key facts are missing (numbers, your specific role, what changed after), ask for them before rewriting. A well-phrased version of a vague claim is still a vague claim.

> 🧠 **Rewriter note**: Record the diagnosis here if it's non-obvious — what was actually wrong with the original, beyond "it's weak."

---

## Stage 2 — Rewrite

For each passage, produce:

---

**Before:**
> [original text, verbatim]

**After:**
> [rewritten version]

**왜 더 강해졌는가:**
Explain in 2–4 sentences: what changed and why it matters to an interviewer. Be specific about the technique used (added metric, changed subject from "we" to "I", surfaced the decision not just the outcome, added failure-and-recovery arc, etc.)

> 🧠 **Rewriter note**: [only if the reasoning behind the rewrite was non-obvious or required a real judgment call]

---

## Rewriting Principles

**Specificity over generality**
- Weak: "성능 개선"
- Strong: "DB 풀 사이즈 튜닝 및 N+1 쿼리 제거로 p99 응답시간 900ms → 140ms 단축"

**Ownership language**
- Weak: "구현되었습니다", "팀에서 진행했습니다"
- Strong: "제가 설계하고 주도했습니다", "직접 제안하여 도입했습니다"

**Decision, not just action**
- Weak: "Kafka를 사용하여 비동기 처리를 구현했습니다"
- Strong: "메시지 유실 없는 비동기 처리가 필요했고, RabbitMQ 대신 Kafka를 선택한 이유는 파티션 기반 순서 보장과 리플레이 가능성 때문이었습니다"

**Outcomes, not activities**
- Weak: "모니터링 시스템을 구축했습니다"
- Strong: "Grafana + Prometheus 기반 모니터링을 도입해 장애 평균 감지 시간을 40분 → 3분으로 단축했습니다"

**Conflict and resolution**
Senior portfolios that read perfectly smooth feel rehearsed. A sentence that includes what went wrong and how it was resolved is more credible than one that only describes success.

---

## Rules

- If the user hasn't provided the numbers or context to make the rewrite specific, ask first. Don't make up metrics.
- Rewrite in the same language the original was written in (Korean input → Korean output).
- After rewriting, offer: "이 외에 고치고 싶은 섹션이 있으면 붙여넣어 주세요."
- If the entire portfolio is weak in the same way, call it out once as a pattern rather than repeating the same note on every item.
