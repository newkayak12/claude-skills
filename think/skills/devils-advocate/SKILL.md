---
name: devils-advocate
description: >-
  Use when someone wants their idea, plan, or decision stress-tested with the
  strongest possible objections. Triggers on: "반론 던져줘", "약점 찾아줘", "이 계획 문제점이
  뭐야?", "devil's advocate 해줘", "결함 찾아줘", "비판해줘", "이 아이디어 왜 틀렸어?", "steel-man the
  opposite view".
scenarios:
  - "MSA로 전환하자는 계획, 반론 세 가지 던져줘"
  - "이 설계의 약점이 뭔지 공격적으로 말해줘"
  - "Play devil's advocate on our go-to-market strategy"
  - "우리 제품 아이디어 왜 실패할 수 있는지 말해줘"
  - "이 결정에 반대하는 가장 강력한 주장이 뭐야?"
  - "Punch holes in this architecture proposal"
compatibility:
  optional:
    - think-tool        # pre-counterargument reasoning about assumptions and second-order effects
    - mcp-reasoner      # for systematically evaluating whether objections are genuinely strong
    - sequential-thinking  # for multi-step adversarial analysis
  remote_mcp_note: >-
    think-tool이 있으면 반론을 작성하기 전에 제안의 근본 가정과 2차 효과를 체계적으로 탐색할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
related:
  - problem-reframer
  - decision-maker
  - brainstorming
---

# Devil's Advocate

Systematically surface the strongest objections against a position, design, or decision — so it can be stress-tested before it's acted on.

The goal is not to tear down ideas for sport. It's to find the genuine weaknesses before reality does.

## Process

### Step 1: Establish the Position

If the user hasn't stated a clear position, ask them to articulate it first. Devil's advocate only works when there's something concrete to challenge. State it back briefly to confirm you're attacking the right thing.

### Step 2: Reason Before Writing

If `think-tool` or `mcp-reasoner` is available, invoke it before writing any counterarguments. Explore: what are the underlying assumptions? What are the second-order effects? Who is most harmed by this decision? What precedent or data contradicts it? This produces sharper, more specific objections than going directly to output.

### Step 3: Generate Counterarguments

Produce **3 counterarguments by default** unless the user specifies otherwise. Each must:

- Be a **steel-man** — the objection in its strongest possible form
- Be **specific** to the actual proposal, not generic criticism
- Explain **why it's a real problem**, not just that it could be one

Label each argument with:
- **Type** — what kind of problem this is:
  - `[structural]` — a flaw in the design itself
  - `[assumption]` — the plan rests on something that may not be true
  - `[execution]` — the idea is sound but carrying it out is risky
  - `[timing]` — the approach may be right but wrong for now
- **Severity** — how dangerous this objection is if unaddressed:
  - `low` — manageable with a mitigation plan
  - `medium` — needs a deliberate response before proceeding
  - `high` — could derail the plan if ignored
  - `critical` — alone could kill the proposal

```
반론 1 / Counterargument 1: [Short title] [type] · severity: X
[The objection in its strongest form, 2-4 sentences]

반론 2 / Counterargument 2: [Short title] [type] · severity: X
...
```

(Use Korean labels if the user wrote in Korean, English otherwise.)

### Step 4: Expose the Core Weakness

After the counterarguments, identify the **single most dangerous weakness** — the one that hits the deepest structural flaw, not just the most obvious one.

```
핵심 취약점 / Core Vulnerability:
...
```

### Step 5: Path Forward (if helpful)

Only include if the user seems to want improvement, not just critique. For each `high` or `critical` objection, briefly note what would need to be true for it to be resolved. Keep this short.

If the user just wants objections, skip entirely.

## Anti-patterns to Avoid

**Don't hedge.** "Some might argue that..." drains force from objections. State them directly.

**Don't balance.** "But on the other hand..." is moderated debate, not devil's advocate. The user already knows the reasons for the idea. Your job is to articulate the reasons against it as powerfully as possible.

**Don't invent weak objections to hit a number.** If there are only 2 genuinely strong objections, say so. Quality beats count.

**Don't be polite at the expense of accuracy.** If a design has a fundamental flaw, say so plainly.

## Example Output Shape

```
Position being challenged:
"우리 서비스는 MSA로 전환해야 한다"

반론 1: 운영 복잡성이 현재 팀 역량을 초과한다 [execution] · severity: high
현재 팀은 단일 서비스도 안정적으로 운영하지 못하고 있는데, MSA는 서비스 간 통신 장애, 분산 트랜잭션, 독립 배포 파이프라인을 동시에 관리해야 한다. 복잡성이 기하급수적으로 증가한다.

반론 2: 분리 경계가 명확하지 않다 [structural] · severity: critical
도메인 경계가 정의되지 않은 상태에서 MSA로 전환하면, 서비스 간 결합도가 오히려 더 높아진다. "distributed monolith"가 되는 전형적인 패턴이다.

반론 3: 전환 비용 대비 현재의 실제 문제가 불분명하다 [assumption] · severity: medium
모놀리식 서비스가 현재 어떤 구체적인 한계에 부딪히고 있는가? 배포 주기? 팀 독립성? 이 문제들이 MSA 없이 해결될 수 없다는 근거가 없다.

핵심 취약점: 전환 자체가 목적이 되었다
MSA는 특정 규모와 팀 구조에서 효과적인 수단이지, 목표가 아니다. 현재 논의에서 "왜 지금"에 대한 답이 없다.
```

This is the shape, not a template to copy verbatim. Adapt to the actual content.

## Related Skills

- `problem-reframer` — 반론이 모두 표면적 문제를 지적한다면, 문제 정의 자체가 틀렸을 수 있을 때
- `decision-maker` — 반론을 검토한 후 최종 옵션 중 하나를 선택해야 할 때
- `brainstorming` — 반론으로 기존 방향이 무너졌고 새 아이디어를 처음부터 탐색해야 할 때
