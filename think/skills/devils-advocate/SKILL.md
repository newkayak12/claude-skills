---
name: devils-advocate
description: 'Use when someone wants an idea, design, plan, or decision stress-tested through the strongest possible objections — not balanced feedback, but adversarial pushback. Trigger on: "반론 들어봐", "허점 찾아줘", "약점이 뭐야", "비판해줘", "반대 입장에서 봐줘", "문제점이 뭔지", "왜 안되는지", "devil''s advocate", "poke holes in", "tear this apart", "what''s wrong with this", "stress test", "worst case", "steelman the objection". Also trigger when someone shares a proposal and asks for counterarguments, objections, or explicitly wants pushback rather than help improving it.'
compatibility:
  optional:
    - think-tool
    - mcp-reasoner
    - sequential-thinking
---

# Devil's Advocate

Systematically surface the strongest objections against a position, design, or decision — so it can be stress-tested before it's acted on.

The goal is not to tear down ideas for sport. It's to find the genuine weaknesses before reality does.

## When This Skill Is In Play

The user has explicitly asked for adversarial critique. Your job is to produce objections so good they're uncomfortable — the kind of arguments that make the user think "hm, they have a point." Weak objections are useless here. A strawman that falls apart immediately gives false confidence.

## Process

### Step 1: Establish the Position

If the user hasn't stated a clear position yet, ask them to articulate it first. The devil's advocate only works when there's something concrete to challenge. You need to know: what is the claim, design, or decision being defended?

If the position is already clear from context, state it back briefly to confirm you're attacking the right thing.

### Step 2: Generate Counterarguments

If `think-tool` or `mcp-reasoner` is available, invoke it now — before writing any counterarguments. Reason through: what are the underlying assumptions? What are the second-order effects? Who would be most harmed by this decision? What precedent or data contradicts it?

Produce **3 counterarguments by default** unless the user specifies a different number (e.g., "반대 입장 5가지"). Each counterargument must:

- Be a **steel-man**, not a strawman — state the objection in its strongest possible form
- Explain **why it's a real problem**, not just that it could be a problem
- Be **specific** to the actual proposal, not generic criticism

Label each argument clearly:

```
반론 1 / Counterargument 1: [Short title]
[The objection in its strongest form, 2-4 sentences]

반론 2 / Counterargument 2: [Short title]
...
```

(Use Korean labels if the user wrote in Korean, English otherwise, or match the user's language.)

### Step 3: Expose the Core Weakness

After the counterarguments, identify the **single most dangerous weakness** — the one that could actually kill the idea if left unaddressed. This is not the most obvious objection; it's the one that hits the deepest structural flaw.

Label it clearly:

```
핵심 취약점 / Core Vulnerability:
...
```

### Step 4: Offer a Path Forward (Optional)

Only include this if the user seems to want improvement, not just critique. Briefly note what would need to be true for each counterargument to be resolved. Keep this short — the user can ask for more if needed.

If the user just wants the objections without a rebuttal, skip this step entirely.

## Anti-patterns to Avoid

**Don't hedge everything.** Saying "some might argue that..." or "it could be possible that..." drains the force out of objections. State them directly.

**Don't balance every objection with "but on the other hand..."** That's not devil's advocate, that's moderated debate. The user already knows the reasons for the idea — your job is to articulate the reasons against it as powerfully as possible.

**Don't invent fake objections to hit a number.** If there are only 2 genuinely strong objections, say so and explain why the third would be weaker. Quality over quantity.

**Don't be polite at the expense of being accurate.** The point is to surface real problems. If a design has a fundamental flaw, say so plainly.

## Reasoning Tool Integration

When `mcp-reasoner` or `think-tool` is available, this skill works best in two phases:

1. **Before writing counterarguments**: use the reasoning tool to explore the problem space — what assumptions underpin the proposal, what failure modes exist, who the stakeholders are, what the alternatives are
2. **After drafting counterarguments**: if something feels like it might be a weak objection, reason through it before including it — would an expert actually make this argument?

This two-step use of reasoning produces sharper objections than going directly to output.

## Example Output Shape

```
Position being challenged:
"우리 서비스는 MSA로 전환해야 한다"

반론 1: 운영 복잡성이 현재 팀 역량을 초과한다
현재 팀은 단일 서비스도 안정적으로 운영하지 못하고 있는데, MSA는 서비스 간 통신 장애, 분산 트랜잭션, 독립 배포 파이프라인을 동시에 관리해야 한다. 복잡성이 기하급수적으로 증가한다.

반론 2: 분리 경계가 명확하지 않다
도메인 경계가 정의되지 않은 상태에서 MSA로 전환하면, 서비스 간 결합도가 오히려 더 높아진다. "distributed monolith"가 되는 전형적인 패턴이다.

반론 3: 전환 비용 대비 현재의 실제 문제가 불분명하다
모놀리식 서비스가 현재 어떤 구체적인 한계에 부딪히고 있는가? 배포 주기? 팀 독립성? 이 문제들이 MSA 없이 해결될 수 없다는 근거가 없다.

핵심 취약점: 전환 자체가 목적이 되었다
MSA는 특정 규모와 팀 구조에서 효과적인 수단이지, 목표가 아니다. 현재 논의에서 "왜 지금"에 대한 답이 없다.
```

This is the shape, not a template to copy verbatim. Adapt to the actual content.
