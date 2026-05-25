# ADR Writer — Process Detail

Detailed playbook for each Step of `adr-writer/SKILL.md`. Read the matching section only when you reach that step.

## Step 1 — Locate the source

Ask:
1. design review 문서가 있나요? (있다면 경로/링크)
2. 없다면 결정 배경을 3-5줄로 요약해 주세요.

If a Design Review exists, **read it fully** before drafting. Pull:

| Design Review section | → ADR slot |
|-----------------------|------------|
| §2 Background & Context | `Context` |
| §5 Proposed Design | `Decision` (rewritten in declarative form) |
| §6 Alternatives Considered | `Rationale` (rejection reasons summarized) |
| §7 Trade-offs | `Consequences.Negative` |
| §8 Impact Analysis | `Consequences.Positive` and `Consequences.Neutral` |

If no Design Review exists, gather equivalent context interactively. Consider invoking `decision-maker` to clarify the actual decision boundary before drafting.

## Step 2 — Assign the number and status

Scan `docs/adr/` for the highest existing `NNNN-*.md`, then take `NNNN+1`. Pad to 4 digits.

Set status:
- `Proposed` — drafted but not yet approved
- `Accepted` — approved and in effect
- `Deprecated` — no longer in effect but not replaced
- `Superseded by ADR-XXXX` — replaced by a newer ADR

If this ADR supersedes an older one, **also update the old ADR's Status** to `Superseded by ADR-NNNN` in the same change.

## Step 3 — Write `Context`

Describe the situation that forced the decision: system state, constraints, prior failures, deadlines. Write for a smart engineer who joined today and has read the codebase but knows nothing about past discussions. Quantify where possible.

## Step 4 — Write `Decision` in declarative voice

One to three sentences. Active voice. Present tense.

| Reject | Accept |
|--------|--------|
| Postgres가 좋을 것 같다 | Postgres를 주 데이터 저장소로 채택한다 |
| We are thinking about using Kafka | We will use Kafka for inter-service events |
| 모놀리스를 분리하는 방향을 검토한다 | 결제 도메인을 별도 서비스로 분리한다 |

If the user pushes back asking for softer language, hold the line and explain: an ADR is the *commitment artifact*. Softness here causes future readers to re-litigate the decision.

If `writer-verification` is available, invoke it on the Decision section to catch hedging that slipped through.

## Step 5 — Write `Rationale`

Two parts:
1. The core reasons this option was chosen (reference Context constraints by name).
2. A one-line-per-alternative summary of why each was rejected.

Use `tradeoff-articulator` framing for the core reasons: "We accept X cost in order to gain Y benefit."

## Step 6 — Write `Consequences` in three buckets

| Bucket | Meaning | Example |
|--------|---------|---------|
| **Positive** | Benefits we gain from this decision | "Latency budget for writes drops from 200ms to 50ms" |
| **Negative** | Costs/risks we accept | "Operational footprint adds a new HA cluster to maintain" |
| **Neutral** | Changes that aren't clearly good or bad | "All new services must register schemas with the central registry" |

If `Negative` is empty after a first pass, invoke `bias-auditor` to surface the costs. Then ask the user directly: "이 결정으로 우리가 *치르는* 비용이 정말 없나요?"

Neutral is the most-skipped bucket. Use it for changes that are simply *true now* — process changes, new conventions, mandatory registrations — that don't lean positive or negative.

## Step 7 — Write `References`

Link, in order:
- Design Review document (path + title)
- RFCs or external standards consulted
- Prior ADRs (especially if superseded)
- Vendor docs / benchmark reports that informed the decision

If nothing applies, write `(none)` — do not invent.

## Step 8 — Set metadata and save

- **Date**: today (YYYY-MM-DD)
- **Deciders**: names of people who actually decided, not just attendees
- **Related**: Design Review #, RFC #, prior ADR #

Save to `docs/adr/NNNN-<short-slug>.md`. Slug should mirror the decision: `0007-adopt-postgres-as-primary-store.md`.

## Fallback when a related skill is not installed

If `doc-coauthoring` / `writer-verification` / `tradeoff-articulator` / `bias-auditor` / `decision-maker` is not available in the user's marketplace install, tell the user:

> "이 단계는 `[skill-name]` 스킬과 함께 쓰면 품질이 올라갑니다. 두 가지 선택지가 있습니다:
> 1. 마켓플레이스(`https://github.com/newkayak12/claude-skills`)에서 해당 플러그인을 설치 → 다시 진행
> 2. 설치 없이 진행 — 제가 스킬 이름에서 유추해 유사한 흐름으로 대신 수행 (품질은 다소 낮을 수 있음)
> 어느 쪽으로 진행할까요?"

Default to option 2 if the user says "그냥 진행" or doesn't respond after one ask.
