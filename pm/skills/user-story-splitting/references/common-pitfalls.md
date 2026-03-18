# Common Pitfalls in Story Splitting

---

## Pitfall 1: Horizontal Slicing (Technical Layers)

**Symptom:** "Story 1: Build the API. Story 2: Build the UI."

**Consequence:** Neither story delivers user value independently.

**Fix:** Split vertically—each story should include front-end + back-end work to deliver a complete user-facing capability.

---

## Pitfall 2: Over-Splitting

**Symptom:** "Story 1: Add button. Story 2: Wire button to API. Story 3: Display result."

**Consequence:** Creates unnecessary overhead and dependencies.

**Fix:** Only split when the story is too large. A 2-day story doesn't need splitting.

---

## Pitfall 3: Meaningless Splits

**Symptom:** "Story 1: First half of feature. Story 2: Second half of feature."

**Consequence:** Arbitrary splits that don't map to user value or workflow.

**Fix:** Use one of the 8 splitting patterns—each split should have a clear rationale.

---

## Pitfall 4: Creating Hard Dependencies

**Symptom:** "Story 2 can't start until Story 1 is 100% done, tested, and deployed."

**Consequence:** No parallelization, slows delivery.

**Fix:** Split in a way that allows independent development. If dependencies are unavoidable, prioritize Story 1.

---

## Pitfall 5: Ignoring the "So That"

**Symptom:** Split stories have the same "so that" statement.

**Consequence:** You've split the action but not the outcome—likely a task decomposition, not a story split.

**Fix:** Ensure each split has a distinct user outcome. If not, reconsider the split pattern.
