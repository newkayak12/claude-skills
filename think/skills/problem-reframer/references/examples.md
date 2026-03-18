# Worked Examples

These examples show the problem-reframer skill applied end-to-end across software and non-software domains. Each example names the technique(s) used so you can see which reframing produced which insight.

---

## Software / Engineering

### "Our API is too slow"

**Stated problem:** "Our API is too slow — we need to optimize the database queries."

Reframing questions:
- Is the API actually slow, or does it feel slow because of no loading state in the UI? (Assumption reversal)
- Is query optimization the right level? What if the API is called 10x more than it needs to be? (Level shifting)
- If you could cache everything, what would change? If you could remove the endpoint entirely, what breaks? (Constraint removal)

Reframed problem: "Why is this endpoint being called at all — can the client hold state instead of fetching repeatedly?"

---

### "We can't agree on a technical direction"

**Stated problem:** "We can't agree on a technical direction in our team."

Reframing questions:
- Are you disagreeing about the solution, or about the problem you're solving? (Level shifting)
- Who benefits from the disagreement continuing? (Perspective shift — who holds status quo power?)
- What decision would you make if you had to ship something in 48 hours? (Constraint removal)

Reframed problem: "We haven't written down what we're optimizing for, so every proposal is evaluated against a different hidden goal."

---

## Non-Software

### "I don't have time to exercise"

**Stated problem:** "I don't have time to exercise."

Reframing questions:
- Is time actually the constraint, or is it activation energy / decision fatigue? (Assumption reversal)
- Why do you want to exercise — what is the underlying goal? (5 Whys)
- How would you guarantee you never exercise? (Inversion: make it inconvenient, require special gear, schedule it when you're tired)

Reframed problem: "Exercise isn't integrated into anything I already do — it requires a separate decision every time."

---

### "Can't find a job in a new field"

**Stated problem:** "I can't find a job in a new field — no one will hire me without experience."

Reframing questions:
- Is experience the real barrier, or is it that hiring managers can't evaluate you? (Assumption reversal)
- What if you reframed the target: instead of a job, what if the first goal is one paid project? (Level shifting)
- Who hires people with zero experience in any field, and why? (Perspective shift)

Reframed problem: "I need credibility signals that aren't a resume — what creates credibility in this field?"
