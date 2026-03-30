---
name: first-principles
description: >-
  Use when the current approach feels fundamentally wrong, inherited constraints need questioning,
  or someone wants to reason from the ground up.
  Triggers on: "왜 이렇게 해야 해?", "기본부터 다시 생각해", "first principles", "가정을 의심해봐",
  "이 방식 자체가 맞는 건지", "처음부터 다시 설계하면?", "why does it have to be this way?".
  Best for: cost-reduction challenges, architectural redesigns, questioning inherited constraints.
  Not for: routine decisions where existing solutions already work — reserve for novel situations.
scenarios:
  - "왜 배포가 2주나 걸려야 해? 진짜 필수적인 단계가 뭐야?"
  - "배터리 비용이 왜 이렇게 비싸야 해? 원재료부터 생각해보자"
  - "Why does onboarding have to take 3 weeks?"
  - "이 아키텍처가 당연하다는 가정을 버리고 처음부터 설계하면 어때?"
  - "We keep optimizing the wrong thing — what do we actually know for certain?"
  - "레거시 제약 없이 설계하면 어떻게 될까?"
compatibility:
  recommended:
    - think-tool        # Lens A decomposition and Lens C adversarial stress-testing
  optional:
    - mcp-reasoner      # for systematically evaluating reconstructed alternatives
  remote_mcp_note: >-
    think-tool이 있으면 Lens A 분해(가정 열거)와 Lens C 합성(반론 테스트)을 체계적으로 수행할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
license: MIT
metadata:
  author: wondelai
  version: "1.0.0"
---

# First Principles Thinking

A framework for stripping away assumptions, analogies, and inherited constraints to reason from the ground up. Based on two complementary traditions: Aristotle's philosophical method of decomposing to irreducible truths, and the practical reconstruction approach used by Elon Musk, Charlie Munger, and the Farnam Street mental models community.

## Core Principle

**Most thinking is analogy-based. First principles thinking is the exception — and the competitive advantage.** Reasoning by analogy means "this is like that, so we do what others do." Reasoning by first principles means "what do we actually know to be true? What can we build from that?" The former is fast and usually wrong in novel situations. The latter is slow and usually right.

**The foundation:** There are two paths. Path A: Aristotelian decomposition — identify the primary premises, the most fundamental things that cannot be derived from anything more basic. If you can question it, it's not a first principle yet. Path B: Practical reconstruction — Musk's approach of breaking down something into its raw materials and costs, then asking: "Could we build this from scratch, given what we actually know?" Path C synthesizes both: decompose to truth (A), reconstruct from truth (B), then challenge the reconstruction with adversarial questioning.

## Scoring

**Goal: 10/10.** When analyzing a problem, assumption, or decision using first principles, rate the analysis 0-10. A 10/10 means the thinker has fully decomposed the assumption space (A), reconstructed from verifiable truths (B), and stress-tested the synthesis (C). Always provide the current score and specific improvements needed.

- **9-10:** All assumptions surfaced, decomposed to verifiable truths, reconstruction is novel and well-supported
- **7-8:** Good decomposition but reconstruction stays close to existing solutions; synthesis feedback is shallow
- **5-6:** Some assumptions challenged, but analogical reasoning still dominant; "because that's how it's done" appears
- **3-4:** Surface-level questioning without reaching foundational truths; first principles named but not applied
- **1-2:** Pure analogy-based reasoning; inherited constraints accepted without examination

## The Three Lenses

### Lens A — Philosophical Decomposition (Aristotle)

**Core concept:** Aristotle held that knowledge rests on "primary premises" — facts so fundamental they cannot be derived from anything more basic. First principles thinking means tracing any claim, assumption, or constraint back to these irreducible truths. If you can still ask "but why?" — you haven't reached a first principle.

**Why it works:** Most constraints are inherited — from convention, past decisions, or "that's how the industry works." Decomposition forces you to separate what is physically or logically true from what is merely conventional. This creates a clean foundation from which genuinely new solutions become visible.

**Key insights:**
- A first principle answers "why?" with physics, logic, or empirically verified fact — not precedent or convention
- The Socratic method is the tool: keep asking "why?" until the chain terminates in something undeniable
- "We've always done it this way" is never a first principle — it's a red flag that decomposition hasn't happened
- First principles exist in a domain: what's primary in physics may not be primary in economics
- The goal is not to reach nihilism ("nothing is certain") but to find the stable floor of a specific argument

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Cost assumption | Ask "what does this physically require?" | "Battery packs are expensive" → decompose to raw materials: cobalt, lithium, carbon — what do those actually cost? |
| Process assumption | Ask "what is the actual constraint?" | "Deployment takes 2 weeks" → what step actually takes 2 weeks, and is that step physically necessary? |
| Market assumption | Ask "what do customers actually want?" | "Users want feature X" → what outcome are they seeking? Is X the only path to that outcome? |
| Organizational assumption | Ask "why does this team exist?" | "We need a QA team" → what failure mode does QA solve? Could that be solved upstream? |
| Technical assumption | Ask "what is physically impossible?" | "We can't process real-time" → what is the actual latency constraint? Is it hardware, architecture, or convention? |

### Lens B — Practical Reconstruction (Musk / Munger)

**Core concept:** After decomposing to raw truths, the reconstruction question is: "Given only what we know to be true, how would we build this from scratch?" This is Elon Musk's explicit method — applied to rockets, batteries, and transport. Charlie Munger's mental models serve as reconstruction tools: inversion, second-order effects, opportunity cost, compound interest.

**Why it works:** Reconstruction without inherited constraints produces solutions that look nothing like existing ones. SpaceX rockets look different because they were designed from physics, not from "how rockets have been built." The reconstruction phase is where radical cost reduction and novel architectures emerge.

**Key insights:**
- Start reconstruction with the physical/logical floor established in Lens A
- Munger's inversion: "What would guarantee failure?" then avoid those things
- Second-order thinking: what happens after the first consequence? And after that?
- Opportunity cost always applies: every choice forecloses alternatives — name them explicitly
- The reconstruction doesn't have to be optimal immediately — it has to be grounded and improvable
- "What would this look like if it were easy?" is a reconstruction trigger

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Cost reduction | Rebuild from raw inputs | "Battery at $200/kWh" → materials cost $80/kWh → gap is manufacturing overhead → that's where to focus |
| Architecture redesign | Ignore existing systems, design for the problem | "What if we had no legacy constraints? What would we build?" |
| Inversion | Name the failure modes | "What would make our product definitely fail?" → invert to derive success requirements |
| Second-order | Trace consequences forward | "We reduce price → more customers → higher support volume → quality drops → churn → price reduction fails" |
| Opportunity cost | Name what you're giving up | "Building feature X" → what 3 things could we build instead, and which is highest value? |

### Lens C — Synthesis and Challenge

**Core concept:** The synthesis lens takes the decomposed truths (A) and the reconstructed solution (B) and stress-tests the combination. Where does the reconstruction rely on assumptions that survived Lens A's scrutiny? Where does it introduce new assumptions? What are the strongest counterarguments?

**Why it works:** Even rigorous first principles work can produce blind spots when the reconstructed solution is emotionally compelling. Lens C introduces adversarial distance — treating the reconstruction as a hypothesis to be falsified, not a conclusion to be defended.

**Key insights:**
- Apply devil's advocate: what would a smart critic say about this reconstruction?
- Test the reconstruction against real constraints: time, people, capital, regulation
- Identify which assumptions survive from A and which new ones were introduced in B
- The synthesis is not about killing the reconstruction — it's about knowing its failure conditions
- "Under what conditions would this reconstruction be wrong?" is the core synthesis question
- Synthesis produces a strengthened position, not a destroyed one — it's pressure-testing, not rejection

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Assumption audit | List assumptions introduced in reconstruction | "We assumed manufacturing at scale — does that hold at year 1?" |
| Adversarial test | Strongest counterargument | "The smartest critic of this plan would say: ___" |
| Failure conditions | When would this be wrong? | "This approach fails if latency requirements are under 10ms — is that possible?" |
| Completeness check | What did we not decompose? | "We challenged cost but not regulatory assumptions — what does regulation actually require?" |
| Conviction calibration | What would change our mind? | "What evidence would make us abandon this reconstruction?" |

## Common Mistakes

| Mistake | Why It Fails | Fix |
|---------|-------------|-----|
| Stopping decomposition too early | "Battery packs are expensive" is not a first principle — it's an observation | Keep asking "why?" until you reach physics, verified data, or logical necessity |
| Reconstructing within existing constraints | You decomposed but rebuilt the same solution | Explicitly list every constraint and ask which ones are truly fixed vs. conventional |
| Skipping Lens C | The reconstruction feels right, so stress-testing is skipped | Always find the three strongest counterarguments before finalizing |
| Mistaking convention for truth | "The FDA requires this" — but what specifically? | Decompose regulatory constraints: what exactly is mandated vs. interpreted practice? |
| Analogy creep in reconstruction | "This is like how Uber did it" — analogy re-enters | Call it out: "Is this a first principles reason, or are we back to analogy?" |
| Using first principles for routine decisions | Overkill for known problems with known solutions | Reserve for novel situations, large bets, or problems where existing solutions are failing |

## Quick Diagnostic

| Question | If No | Action |
|----------|-------|--------|
| Have you written down every assumption? | Assumptions are implicit and unexamined | Make a full assumption list before decomposing |
| Have you traced each assumption to a first principle? | You stopped at "because that's how it works" | Apply Lens A: keep asking "why?" until you reach physics or logic |
| Does the reconstruction start from the floor, not from existing solutions? | Reconstruction still looks like the incumbent | Explicitly ignore all existing solutions and build from the truths you found |
| Have you named what you're giving up? (opportunity cost) | Alternatives are invisible | List the top 3 alternatives and why this reconstruction beats them |
| Have you found the three strongest counterarguments? | The reconstruction is undefeated because unchallenged | Apply Lens C: argue against your own reconstruction |
| Do you know the conditions under which this is wrong? | You're defending rather than understanding | Name the specific conditions that would falsify the reconstruction |

## Further Reading

This skill synthesizes insights from several foundational sources:

- [*"Nicomachean Ethics"*](https://www.amazon.com/Nicomachean-Ethics-Aristotle/dp/0872204642) by Aristotle — the source of primary premises and foundational reasoning
- [*"Poor Charlie's Almanack"*](https://www.amazon.com/Poor-Charlies-Almanack-Charles-Expanded/dp/1578645018) by Charlie Munger — mental models, inversion, and latticework thinking
- [*"The Great Mental Models Vol. 1"*](https://www.amazon.com/Great-Mental-Models-Thinking-Concepts/dp/1999449002) by Shane Parrish (Farnam Street) — practical synthesis of first principles models
- Elon Musk interviews on first principles reasoning (widely available; no single text)

## About the Tradition

First principles reasoning originates with Aristotle, who argued in the *Posterior Analytics* that all knowledge rests on primary premises that are true, necessary, and immediate. The method was revived in modern practice most visibly by Elon Musk, who described it publicly in a 2013 TED interview: "I think it's important to reason from first principles rather than by analogy... you boil things down to the most fundamental truths and then reason up from there." Charlie Munger's lifelong practice of building a "latticework of mental models" is the parallel tradition in investing and decision-making. Shane Parrish's Farnam Street community has systematized both traditions into a practical curriculum for everyday decisions.
