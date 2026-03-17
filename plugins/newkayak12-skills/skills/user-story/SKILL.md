---
name: user-story
description: Create user stories with Mike Cohn format and Gherkin acceptance criteria. Use when turning user needs into development-ready work with clear outcomes and testable conditions.
intent: >-
  Create clear, concise user stories that combine Mike Cohn's user story format with Gherkin-style acceptance criteria. Use this to translate user needs into actionable development work that focuses on outcomes, ensures shared understanding between product and engineering, and provides testable success criteria.
type: component
theme: pm-artifacts
best_for:
  - "Writing user stories with proper acceptance criteria"
  - "Converting requirements into development-ready stories"
  - "Establishing story quality standards across your team"
scenarios:
  - "I need to write a user story for a new notification system in our B2B SaaS app"
  - "Convert this PRD requirement into a properly formatted user story with Gherkin acceptance criteria"
estimated_time: "5-10 min"
---

## Key Concepts

### The Mike Cohn + Gherkin Format
A user story combines:

**Use Case (Mike Cohn format):**
- **As a** [user persona/role]
- **I want to** [action to achieve outcome]
- **so that** [desired outcome]

**Acceptance Criteria (Gherkin format):**
- **Scenario:** [Brief description of the scenario]
- **Given:** [Initial context or preconditions]
- **and Given:** [Additional preconditions]
- **When:** [Event that triggers the action]
- **Then:** [Expected outcome]

### Why This Structure Works
- **User-centric:** Forces focus on who benefits and why
- **Outcome-focused:** "So that" emphasizes the value delivered, not just the action
- **Testable:** Gherkin acceptance criteria are concrete and verifiable
- **Conversational:** Story is the opening for discussion, not the final spec
- **Shared language:** Product, engineering, and QA all understand the format

### Anti-Patterns (What This Is NOT)
- **Not a task:** "As a developer, I want to refactor the database" (this is a tech task, not user value)
- **Not a feature list:** "I want dashboards, reports, and analytics" (this is too big—needs splitting)
- **Not vague:** "I want a better experience" (unmeasurable, no clear outcome)
- **Not a contract:** Stories are placeholders for conversation, not locked-in specs

### When to Use This
- Translating user needs into development work
- Backlog grooming and sprint planning
- Communicating value to engineering and design
- Ensuring testable acceptance criteria exist before development

### When NOT to Use This
- For pure technical debt or refactoring (use engineering tasks instead)
- When stories are too large (split first—see `skills/user-story-splitting/SKILL.md`)
- Before understanding the user problem (write a problem statement first)

---

## Application

### Step 1: Gather Context
Before writing a story, ensure you have:
- **User persona:** Who is this for? (reference `skills/proto-persona/SKILL.md`)
- **Problem understanding:** What need does this address? (reference `skills/problem-statement/SKILL.md`)
- **Desired outcome:** What does success look like?
- **Constraints:** Technical, time, or scope limitations

**If missing context:** Run discovery interviews or problem validation work first.

---

### Optional Helper Script (Template Generator)

If you want a consistent Markdown stub, you can generate one from CLI inputs. This script is deterministic and does not fetch data or write files.

```bash
python3 scripts/user-story-template.py --persona \"trial user\" --action \"log in with Google\" --outcome \"access the app without creating a new password\"
```

---

### Step 2: Write the Use Case

Use `template.md` for the full fill-in structure. Fill in the Use Case section with As a / I want to / so that fields.

**Quality checks:**
- **"As a" specificity:** Is this a specific persona (e.g., "trial user") or generic ("user")?
- **"I want to" clarity:** Is this an action the user takes, or a feature you're building?
- **"So that" outcome:** Does this explain the user's motivation? Or is it just restating the action?

**Common mistakes:**
- ❌ "As a user, I want a login button, so that I can log in" (restating the action)
- ✅ "As a trial user, I want to log in with Google, so that I can access the app without creating a new password"

---

### Step 3: Write the Acceptance Criteria

Use `template.md` for the full fill-in structure. Fill in the Acceptance Criteria section with Scenario / Given / When / Then fields.

**Quality checks:**
- **Multiple Givens are okay:** Preconditions stack up (e.g., "Given I'm logged in" + "Given I have items in my cart")
- **Only one When:** If you need multiple "When" statements, you likely have multiple stories—split them
- **Only one Then:** If you need multiple "Then" statements, you likely have multiple stories—split them
- **Alignment:** Does "When" match "I want to"? Does "Then" match "so that"?

**Red flags:**
- **Multiple Whens/Thens:** Sign of scope creep—split the story (reference `skills/user-story-splitting/SKILL.md`)
- **Vague Thens:** "Then I see improved performance" (unmeasurable—make it specific)

---

### Step 4: Add a Summary

Write a short, memorable summary that captures the story's value:

**Examples:**
- ✅ "Enable Google login for trial users to reduce signup friction"
- ✅ "Bulk delete items to save time for power users"
- ❌ "Add delete button" (feature-centric, not value-centric)

---

### Step 5: Validate and Refine

If think-tool is available, invoke it now to review the completed story against these three criteria:
1. Exactly one `When` and one `Then` in the acceptance criteria
2. The `As a` persona is more specific than "user" or "customer"
3. The `Then` clause is independently falsifiable and does not restate the `When` clause

The think-tool should output PASS or FLAG with a one-sentence reason for each flagged criterion.

- **Read aloud to the team:** Does everyone understand who, what, why?
- **Test acceptance criteria:** Can QA write test cases from this?
- **Check for splitting:** If the story feels too big, use `skills/user-story-splitting/SKILL.md`
- **Ensure testability:** Can you prove "Then" happened?
- **INVEST check:** Is the story Independent, Negotiable, Valuable, Estimable, Small, and Testable?

---

## Examples

See `examples/sample.md` for full examples (good, bad, and split-needed stories).

---

## Common Pitfalls

For detailed pitfall diagnosis and fixes, see `references/pitfalls.md`.

---

## References

### Related Skills
- `skills/user-story-splitting/SKILL.md` — How to break large stories into smaller ones
- `skills/proto-persona/SKILL.md` — Defines the "As a [persona]" section
- `skills/problem-statement/SKILL.md` — Stories should address validated problems
- `skills/epic-hypothesis/SKILL.md` — Epics decompose into user stories

### Optional Helpers
- `skills/user-story/scripts/user-story-template.py` — Deterministic Markdown stub generator (no network access)

### External Frameworks
- Mike Cohn, *User Stories Applied* (2004) — Origin of the "As a / I want / so that" format
- Gherkin (Cucumber) — "Given/When/Then" acceptance criteria format
- INVEST criteria (Independent, Negotiable, Valuable, Estimable, Small, Testable)

### Provenance
- Adapted from `prompts/user-story-prompt-template.md` in the `https://github.com/deanpeters/product-manager-prompts` repo.
