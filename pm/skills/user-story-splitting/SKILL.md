---
name: user-story-splitting
description: >-
  Use when a user story, epic, or feature is too large to estimate, sequence, or
  release independently — breaking it into smaller, independently deliverable
  stories using proven split patterns. Triggers on: "split this story", "story
  is too big",
type: component
scenarios:
  - "This user story is too big for one sprint — help me split it using splitting patterns"
  - "Break this epic into smaller, independently deliverable stories"
  - "My story has 3 When clauses — how do I split it?"
  - "너무 큰 유저 스토리를 분리해줘"
  - "에픽을 독립적으로 배포 가능한 스토리들로 분해해줘"
compatibility:
  recommended: []
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 분리된 스토리가 독립적으로 배포 가능하고 사용자 가치를 전달하는지 검증 품질이 높아집니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## When to Use / When Not to Use

**Use when:**
- Story is too large for a single sprint
- Multiple "When" or "Then" statements exist in acceptance criteria
- Epic needs to be broken into independently deliverable increments
- Team cannot estimate or agree on story scope

**Not for:**
- Stories that are already small and well-scoped (don't over-split)
- Technical tasks and refactoring items with no user value
- Splitting that would create hard dependencies between new stories

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Applies 8 splitting patterns to the original story | Provides the original story and context |
| Writes split stories in full As a/I want/So that + Gherkin format | Validates that each split delivers real user value |
| Validates splits against INVEST criteria | Confirms splits can be developed and tested independently |
| Flags splits that fail "independently deliverable" test | Prioritizes which splits go into which sprint |

## Process

1. **Provide the original story** — in As a / I want / So that + Gherkin format
2. **Apply the 8 splitting patterns in order** — stop when one fits (workflow steps, business rules, data variations, acceptance criteria complexity, major effort, external dependencies, DevOps steps, or TADs)
3. **Write each split story** — full user story format with acceptance criteria
4. **Validate each split** — against the 5 INVEST criteria; especially: independently deliverable and distinct user value
5. **Check completeness** — splits combined should equal the original; nothing lost in translation

## Output Template

```
### Split using [Pattern Name]

**Split 1:** [Summary title]
- As a [persona], I want to [action], so that [outcome]
- Given: [preconditions] | When: [action] | Then: [outcome]

**Split 2:** [Summary title]
- As a [persona], I want to [action], so that [outcome]
- Given: [preconditions] | When: [action] | Then: [outcome]

INVEST check:
- Independent: [Yes / No — note if dependency exists]
- Valuable: [Yes / No — each split delivers user value]
- Small: [Yes / No — fits in one sprint?]
```

## Related Skills

- `../user-story/SKILL.md` — format for writing split stories
- `../user-story-mapping/SKILL.md` — story map tasks often need splitting before authoring

## Application

This is not arbitrary slicing — it's strategic decomposition that preserves user value while reducing complexity.

## Key Concepts

### The Story Splitting Framework
Based on Richard Lawrence and Peter Green's "Humanizing Work Guide to Splitting User Stories," the framework provides 8 systematic patterns for splitting work:

1. **Workflow steps:** Split along sequential steps in a user's journey
2. **Business rule variations:** Split by different rule scenarios (permissions, calculations, etc.)
3. **Data variations:** Split by different data types or inputs
4. **Acceptance criteria complexity:** Split when multiple "When" or "Then" statements exist
5. **Major effort:** Split by technical milestones or implementation phases
6. **External dependencies:** Split along dependency boundaries (APIs, third parties, etc.)
7. **DevOps steps:** Split by deployment or infrastructure requirements
8. **Tiny Acts of Discovery (TADs):** When none of the above apply, use small experiments to unpack unknowns

### Why Split Stories?
- **Faster feedback:** Smaller stories ship sooner, allowing earlier validation
- **Reduced risk:** Less to build = less that can go wrong
- **Better estimation:** Small stories are easier to estimate accurately
- **Maintain flow:** Keeps work moving through the sprint without bottlenecks
- **Testability:** Smaller scope = easier to write and run tests

### Anti-Patterns (What This Is NOT)
- **Not horizontal slicing:** Don't split into "front-end story" and "back-end story" (each story should deliver user value)
- **Not task decomposition:** Stories aren't tasks ("Set up database," "Write API")
- **Not arbitrary chopping:** Don't split "Add user management" into "Add user" and "Management" (meaningless)

### When to Use This
- Story is too large for a single sprint
- Multiple "When" or "Then" statements in acceptance criteria
- Epic needs to be broken down into deliverable increments
- Team can't reach consensus on story size or scope
- Story has multiple personas or workflows bundled together

### When NOT to Use This
- Story is already small and well-scoped (don't over-split)
- Splitting would create dependencies that slow delivery
- The story is a technical task (use engineering task breakdown instead)

---

## Application

### Step 1: Identify the Original Story
Start with the story/epic/feature that needs splitting. Ensure it's written using the user story format (reference `skills/user-story/SKILL.md` or `skills/epic-hypothesis/SKILL.md`).

```markdown
### Original Story:
[Story formatted with use case and acceptance criteria]
```

---

### Step 2: Apply the Splitting Logic

Use `template.md` for the full fill-in structure and output format.

Work through the 8 splitting patterns in order. Stop when you find one that applies.

See `references/splitting-patterns.md` for a worked example of each pattern.

---

### Step 3: Write the Split Stories

For each split, write a complete user story using the format from `skills/user-story/SKILL.md`:

```markdown
### Split 1 using [Pattern Name]:

#### User Story [ID]:
- **Summary:** [Brief title]

**Use Case:**
- **As a** [persona]
- **I want to** [action]
- **so that** [outcome]

**Acceptance Criteria:**
- **Scenario:** [Description]
- **Given:** [Preconditions]
- **When:** [Action]
- **Then:** [Outcome]
```

---

### Step 4: Validate the Splits

If think-tool is available, invoke it now to reason through each validation question before committing to output. This surfaces splits that fail the "independently deliverable" or "distinct user outcome" tests before finalizing.

Ask these questions:
1. **Does each split deliver user value?** (Not just "front-end done")
2. **Can each split be developed independently?** (No hard dependencies)
3. **Can each split be tested independently?** (Clear acceptance criteria)
4. **Is each split small enough for a sprint?** (1-5 days of work)
5. **Do the splits, when combined, equal the original?** (Nothing lost in translation)

If any answer is "no," revise.

---

## Examples

See `examples/sample.md` for full splitting examples.

Mini example excerpt:

```markdown
### Original Story:
As a team admin, I want to manage team members so that I can control access.

### Suggested Splits (Acceptance Criteria Complexity):
1. Invite new team members
2. Remove team members
3. Update team member roles
```

---

## Common Pitfalls

See `references/common-pitfalls.md` for symptom / consequence / fix entries for the 5 most common splitting mistakes.

---

## References

### Related Skills
- `skills/user-story/SKILL.md` — Format for writing the split stories
- `skills/epic-hypothesis/SKILL.md` — Epics often need splitting before becoming stories
- `skills/jobs-to-be-done/SKILL.md` — Helps identify meaningful splits along user jobs

### External Frameworks
- Richard Lawrence & Peter Green, *The Humanizing Work Guide to Splitting User Stories* — Origin of the 8 splitting patterns
- Bill Wake, *INVEST in Good Stories* (2003) — Criteria for well-formed stories (Independent, Negotiable, Valuable, Estimable, Small, Testable)
- Mike Cohn, *User Stories Applied* (2004) — Story decomposition techniques

### Provenance
- Adapted from `prompts/user-story-splitting-prompt-template.md` in the `https://github.com/deanpeters/product-manager-prompts` repo.

---

**Skill type:** Component
**Suggested filename:** `user-story-splitting.md`
**Suggested placement:** `/skills/components/`
**Dependencies:** References `skills/user-story/SKILL.md`, `skills/epic-hypothesis/SKILL.md`
**Applies to:** User stories, epics, and any work that's too large to complete in a single sprint
