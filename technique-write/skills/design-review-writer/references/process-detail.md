# Design Review Writer — Process Detail

Detailed playbook for each Step of `design-review-writer/SKILL.md`. Read the matching section only when you reach that step.

## Step 1 — Frame the topic

Ask:
1. 한 문장으로, 무엇을 만들/바꾸려고 하나요?
2. 왜 지금인가요? (트리거 이벤트, 데드라인, 장애)
3. 이 문서를 누가 읽고 무엇을 결정해야 하나요?

If the answer to (1) is symptomatic (`"속도가 느려서…"`, `"확장이 안 되어서…"`), invoke `problem-reframer` before continuing. A blurry topic produces a blurry §2.

## Step 2 — §2 Background & Context and §3 Goals/Non-Goals

Pull from the user: system state, prior attempts, business pressure, constraints. Then split:
- **Goals** — measurable outcomes for *this* scope
- **Non-Goals** — things reviewers will ask about but you are deliberately excluding

Non-Goals is the most-skipped section and the most-valuable. If the user can't name any, ask: "What would a reviewer probably assume is in scope that isn't?"

## Step 3 — §4 Requirements

Split functional vs. non-functional. Quantify NFRs (latency p99, RPS, RPO/RTO, concurrent users). Replace adjectives with numbers — "fast" becomes "<200ms p99".

## Step 4 — Diverge on alternatives (write §6 before §5)

Invoke `brainstorming` to produce 3-5 candidate designs. Capture each with:
- Name
- One-paragraph sketch
- Strongest reason to adopt
- Strongest reason to reject

Writing §6 before §5 prevents anchoring on the first design that came to mind and back-rationalizing.

Domain hints for which architecture skill to call alongside brainstorming:
- Domain modeling involved → `domain-driven-design`
- Service decomposition → `microservices-architect`
- Topology / database / infrastructure → `architecture-designer`

## Step 5 — Converge and write §5 Proposed Design

Pick one alternative as the proposal. Document:
- **High-Level Architecture** — Mermaid/ASCII diagram or component list
- **Sequence / Flow** — the 1-2 most important runtime scenarios

Prefer Mermaid (`sequenceDiagram`, `flowchart LR`) for diagrams so the doc renders in GitHub/Confluence. Plain ASCII is fine as fallback.

## Step 6 — Stress test, then §7 Trade-offs and §8 Impact Analysis

Run, in order:
1. `devils-advocate` against the Proposed Design
2. `bias-auditor` to check for confirmation bias
3. `assumption-extractor` to surface hidden assumptions in §2-§5

Write trade-offs from what survives. For §7, use `tradeoff-articulator` framing: "We accept X cost in order to gain Y benefit." Avoid one-sided bullet lists.

For §8, invoke `second-order-thinker` to push past first-order ("Service A calls Service B") to second-order ("On-call rotation for Team C now covers a critical path").

## Step 7 — Decide optional sections

Ask the user which apply. Suggest based on signals:

| Signal in §2-§5 | Suggest |
|-----------------|---------|
| Migration from existing system | Migration / Rollout, Rollback |
| SLO mentioned in §4 | Observability |
| Touches PII, auth, payments | Security & Compliance |
| Multiple teams, on-call change | Operational Concerns |
| Unresolved questions remain | Open Questions |
| Has a deadline | Timeline & Milestones |

Empty optional sections train reviewers to skim. Either fill it meaningfully or omit it entirely.

## Step 8 — Assemble and set metadata

- **Author** — the user (ask if unknown)
- **Reviewers** — ask who must sign off
- **Status** — `Draft` initially; flip to `In Review` when shared
- **Created** — today's date (YYYY-MM-DD)
- **Last Updated** — same as Created on first write

Write **§1 Summary last**. A Summary written before the body is a wish, not a summary.

## Fallback when a related skill is not installed

If `brainstorming` / `devils-advocate` / `bias-auditor` / etc. is not available in the user's marketplace install, tell the user:

> "이 단계는 `[skill-name]` 스킬과 함께 쓰면 품질이 올라갑니다. 두 가지 선택지가 있습니다:
> 1. 마켓플레이스(`https://github.com/newkayak12/claude-skills`)에서 해당 플러그인을 설치 → 다시 진행
> 2. 설치 없이 진행 — 제가 스킬 이름에서 유추해 유사한 흐름으로 대신 수행 (품질은 다소 낮을 수 있음)
> 어느 쪽으로 진행할까요?"

Default to option 2 if the user says "그냥 진행" or doesn't respond after one ask.
