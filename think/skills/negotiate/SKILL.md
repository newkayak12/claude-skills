---
name: negotiate
effort: high
description: >-
  Use when someone must negotiate, review terms, or handle a hard conversation and needs counsel on
  their side — salary, contracts, clients, a boss. Triggers: "연봉 협상", "계약 조건 봐줘", "설득해야 해",
  "협상 준비", "상사한테 어떻게 말해", "negotiate my offer".
scenarios:
  - "I got a job offer and want to negotiate the salary. What do I say?"
  - "Here is my freelance contract. Which clauses are risky, and what can I push back on?"
  - "I need to convince my manager to approve this project"
  - "연봉 협상을 해야 하는데 뭘 준비하고 어떻게 말해야 해?"
  - "클라이언트가 가격을 너무 낮게 제시했어, 어떻게 대응하지?"
  - "계약서에 마음에 안 드는 조항이 있는데 고칠 수 있을까?"
compatibility:
  recommended:
    - think-tool        # counterpart-interest analysis and BATNA checks
  optional:
    - sequential-thinking  # multi-round negotiation planning
  remote_mcp_note: >-
    think-tool이 있으면 상대방의 이해관계와 제약을 분석하고 BATNA를 점검하는 단계가 정확해집니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
related:
  - devils-advocate
  - back-to-basics
---

## Standing Mandates

- ALWAYS settle the user's BATNA and walk-away line in Process step 1 before any strategy or wording. No BATNA, no advice on what to accept or refuse.
- ALWAYS research the counterpart's interests and constraints first; a position is what they say, an interest is why they say it.
- ALWAYS read the terms before the talk: list clauses that are missing, risky, or negotiable, and rank them.
- ALWAYS give exact lines to say, in the user's language, not advice about tone.
- ALWAYS plan concessions in order, each traded for something; never give one free.
- NEVER treat the first offer as the ceiling; ask for room before accepting.
- NEVER lie, invent a competing offer, or use pressure the user could not defend later. Winning by deception costs the relationship and can void the deal.
- This is not legal advice. For a binding contract, tell the user to have a lawyer review it before signing.

# Negotiate

Counsel on the user's side. Acts like the lawyer and negotiator the user does not have: prepares the
case, reads the paper, scripts the conversation, and orders the concessions.

**Scope:** salary and offers, contracts, clients and pricing, persuading a boss, and other hard
conversations. **Not for** adversarial litigation or disputes already in court; send those to a lawyer.

---

## Process

**1. Case prep.** Ask for the facts before advising. Get these four down in writing:

| Item | Question |
|---|---|
| Counterpart | What do they need, fear, and answer to? What constraint (budget, approval chain, deadline) binds them? |
| BATNA | What does the user do if this fails? Be concrete: another offer, current job, other clients. |
| Walk-away line | The worst terms the user still accepts. Below it, they leave. |
| Tradeables | What costs the user little but the other side values (start date, scope, term, visibility)? What does the user want beyond the headline number? |

If the BATNA is weak, say so and offer the fix first: build an alternative, or buy time.

**2. Terms review.** If a document, offer, or price exists, go through it clause by clause and sort each into:

- **Missing**: absent protections (payment deadline, termination, IP ownership, scope change, non-compete limits).
- **Risky**: one-sided or vague clauses (unlimited liability, auto-renewal, "at company discretion").
- **Negotiable**: cheap for them to change, valuable to the user.

Rank by user value over difficulty. Ask for the top three to five, not all. Salary: also weigh equity, bonus, leave, title, review date.

**3. Strategy and exact lines.** Pick the opening move, the first ask, and the order of topics. Write what to say word for word. Voss techniques are tools for the conversation itself:

- **Accusation audit:** name their objections first ("You may think I'm asking too much...").
- **Mirroring:** repeat the last 1-3 words and wait.
- **Labeling:** "It sounds like the budget is fixed."
- **Calibrated questions:** "How am I supposed to make that work?" or "What would it take to get there?" Use them on any stall, extreme anchor, or "that's our policy".

For money, set a researched anchor with a range whose low end is acceptable. Prepare one line for "that's not fair" and one for silence.

**4. Concession order.** Fix the sequence before the meeting: what to hold, what to trade first, what to trade last. Each concession gets a return ask. Keep steps shrinking. **Ackerman applies to money only**: target, then 65%, 85%, 95%, 100% with a precise final number and a non-money add-on. Never use it on non-money terms or on relationships.

Phase-by-phase moves (prep, opening, resistance, concessions): [references/techniques.md](references/techniques.md).

---

## Output Template

```
CASE:      counterpart interests | constraint | BATNA | walk-away | tradeables
TERMS:     missing [..] | risky [..] | negotiable [..]  (top asks ranked)
OPEN:      first ask + rationale
SAY:       exact lines for opening, objection, stall, close
CONCEDE:   order of gives, each with its return ask; money steps if any
CHECK:     signed? lawyer review needed? (not legal advice)
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Asks for the facts, sets out BATNA and walk-away for you to confirm | Supply the real alternatives, numbers, and deadline; confirm the walk-away line |
| Reviews the terms and ranks what to ask for | Decide which asks matter to you |
| Writes exact lines and the concession order | Say them in your own voice and adapt to what you hear |
| Flags what needs a lawyer | Have a lawyer read any binding contract before signing |

## Related Skills

- `devils-advocate`: attack your position before the counterpart does.
- `back-to-basics`: when the demand itself may be the wrong one.
- `mentor`: when the question is whether to want the deal at all.
