# Reframing Techniques

Seven techniques for reframing a problem statement. Each is independent — select 2–3 most applicable to the problem at hand. Do NOT run all 7 sequentially; that produces redundant output.

---

## 1. Assumption Reversal

List the assumptions baked into the problem, then flip each one.

Example: "Users aren't adopting our feature."
- Assumption: users know the feature exists → Reverse: what if they never discovered it?
- Assumption: the feature solves a real need → Reverse: what if there is no actual need?
- Assumption: adoption is the right metric → Reverse: what if low adoption means users solved it another way and are fine?

---

## 2. 5 Whys for Problem Framing

Ask "why is this a problem?" five times, not to find a root cause, but to find the level at which it is worth solving.

Example: "Our deployment takes 45 minutes."
- Why is that a problem? → It slows down iteration.
- Why is slow iteration a problem? → We can't respond to user feedback quickly.
- Why does that matter? → Competitors ship fixes faster.
- Why does that matter? → We lose users to competitors.
- Why does that matter? → Revenue is threatened.

Result: The real problem is competitive response time, not deployment duration. The solution space expands.

---

## 3. Constraint Removal Experiment

Ask: "If the constraint that makes this hard simply did not exist, what would you do?" Then work backward from that answer.

Example: "We can't refactor this legacy codebase — there's no time."
- Remove the constraint: if you had unlimited time, what would you do? → Rewrite the auth module cleanly.
- Work backward: is there a scope small enough to do that rewrite in one week? → Maybe just the token validation logic.
- Reframe: "How do we incrementally replace the auth module without a big-bang refactor?"

---

## 4. Perspective Shift

Examine the problem through the eyes of a different stakeholder, role, or expert.

Perspectives to try:
- The end user who never complains (silent sufferer)
- A competitor who solved this already
- Someone from a completely different industry (what would a logistics company do?)
- Your future self one year from now looking back
- The person who would be happiest if this problem never got solved (who benefits from the status quo?)

---

## 5. Problem Inversion

Instead of asking "how do I achieve X?", ask "how would I guarantee X never happens / always fails?"

Then invert the answers to find what you must do or avoid.

Example: "How do we improve team communication?"
- Inversion: "How would we guarantee communication breaks down completely?"
  - Never write decisions down
  - Have no shared vocabulary
  - Reward people for hoarding information
- Invert: document decisions, build shared vocabulary, make information sharing visible and rewarded.

---

## 6. Level Shifting

Zoom out (abstract) or zoom in (concrete) from where you are currently working.

- Zooming out: "We're fixing a bug in the payment flow" → "We're reducing failed transactions" → "We're making revenue reliable."
- Zooming in: "User engagement is low" → "Which specific screen has the highest drop-off?" → "What happens in the 10 seconds after the user lands on that screen?"

The right level to solve a problem is rarely the level at which it first appears.

---

## 7. Reframe the Goal

Ask whether the stated goal is actually the goal, or a proxy for it.

Example: "We need to write more tests."
- Is test count the goal? No.
- Underlying goal: confidence that code behaves correctly.
- Reframe: "How do we gain confidence that critical paths behave correctly?" (Answer might include tests, but also monitoring, types, or formal review.)
