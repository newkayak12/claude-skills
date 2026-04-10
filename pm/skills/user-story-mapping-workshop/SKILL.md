---
name: user-story-mapping-workshop
description: >-
  Use when someone wants to be guided interactively through building a story map
  — step by step through scope, personas, backbone activities, tasks, and
  release slices via adaptive questions. Triggers on: "walk me through story
  mapping", "help me
type: interactive
scenarios:
  - "Walk me through creating a story map for our new mobile app — I'm not sure where to start"
  - "Help me run a story mapping workshop for our team's Q3 feature set"
  - "I have a flat backlog and want to convert it to a story map with release slices"
  - "스토리 맵 처음 만드는데 같이 도와줘"
  - "유저 스토리 맵 워크숍 진행해줘"
compatibility:
  recommended:
    - think-tool
    - sequential-thinking
  optional: []
  remote_mcp_note: >-
    think-tool이 있으면 백본 활동이 기술 레이어가 아닌 사용자 워크플로우를 반영하는지 검증할 수 있고,
    sequential-thinking이 있으면 질문 간 상태를 유지하며 수정 사항이 후속 출력에 정확히 반영됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## When to Use / When Not to Use

**Use when:**
- Starting a new product or major feature and scope is not yet clear
- Reframing an existing flat backlog into a visual, narrative map
- Aligning stakeholders on scope, MVP, and release slices
- Running a facilitated planning session with a team

**Not for:**
- Generating a map when context is already defined (use user-story-mapping)
- Single-feature or single-story scoping
- Technical refactoring work with no user workflow

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Asks 5 adaptive questions to discover scope, personas, and activities | Provides context and makes judgment calls |
| Generates backbone activities from answers | Approves or modifies the backbone |
| Proposes tasks per activity with priority ordering | Confirms priorities reflect real user needs |
| Draws release slices (Walking Skeleton, R2, R3) | Validates scope feasibility with engineering |
| Flags anti-patterns (technical layers vs. user workflow) | Presents the final map to the team |

## Related Skills

- `../user-story-mapping/SKILL.md` — use this when context is already defined and you want a map produced directly
- `../user-story/SKILL.md` — tasks from the map become individual user stories
- `../user-story-splitting/SKILL.md` — large tasks need splitting before authoring stories

## Key Concepts

### What is a User Story Map?

A story map (Jeff Patton) organizes user stories in **two dimensions**:

**Horizontal axis (left to right):** Activities arranged in narrative/workflow order—the sequence you'd use explaining the system to someone

**Vertical axis (top to bottom):** Priority within each activity, with the most essential tasks at the top

**Structure:**
```
Backbone (Activities across top)
↓
User Tasks (descending vertically by priority)
↓
Details/Acceptance Criteria (at the bottom)
```

### Key Principles

**The Backbone:** Essential activities form the system's structural core—these aren't prioritized against each other; they're the narrative flow.

**Walking Skeleton:** The highest-priority tasks across all activities form the minimal viable product—the smallest end-to-end functionality.

**Ribs:** Supporting tasks descend vertically under each activity, indicating priority through placement.

**Left-to-Right, Top-to-Bottom Build Strategy:** Build incrementally across all major features rather than completing one feature fully before starting another.

### Why This Works
- **Visual communication:** Story maps remain displayed as information radiators, maintaining focus on the big picture
- **Narrative structure:** Organizes by user workflow, not technical architecture
- **Release planning:** Horizontal slices reveal MVPs and incremental releases
- **Gap identification:** Reveals missing functionality that flat backlogs obscure

### Anti-Patterns (What This Is NOT)
- **Not a Gantt chart:** Story maps show priority, not time estimates
- **Not technical architecture:** Maps follow user workflow, not system layers (UI → API → DB)
- **Not a project plan:** It's a discovery and communication tool, not a schedule

### When to Use This
- Starting a new product or major feature
- Reframing an existing backlog (moving from flat list to visual map)
- Aligning stakeholders on scope and priorities
- Planning MVP or incremental releases

### When NOT to Use This
- Single-feature projects (story map overkill)
- When backlog is already well-understood and prioritized
- For technical refactoring work (no user workflow to map)

---

### Facilitation Protocol

Use one-question-at-a-time turns with plain-language prompts. Offer numbered options at each step so the user can respond quickly. Include `Other (specify)` when the enumerated choices don't cover the user's case. Handle interruptions gracefully — if the user pauses mid-flow, resume from the last answered question. If there is a conflict between general facilitation practice and the domain logic below, follow this file's domain logic.

If sequential-thinking is available, use it to maintain backbone state across turns so that user modifications at Q3 propagate correctly into Q4 and Q5, preventing stale activity names from appearing in task and slice outputs.

## Application

This interactive skill asks **up to 5 adaptive questions**, offering **3-4 enumerated options** at each step.

Use `template.md` for the facilitation agenda and outputs checklist.

Interaction pattern: Use one-step-at-a-time flow with numbered recommendations at decision points and quick-select options for regular questions. If the user asks for a single-shot output, skip the multi-turn facilitation.

---

### Step 0: Gather Context (Before Questions)

**Agent suggests:**

Before we create your story map, let's gather context:

**Product/Feature Context:**
- What system or feature are you mapping?
- Product concept, PRD draft, or existing backlog
- Website copy, positioning materials, or user flows
- Existing user stories (if transitioning from flat backlog)

**User Context:**
- Target personas or user segments
- User research, interviews, or journey maps
- Jobs-to-be-done or problem statements

**You can paste this content directly, or describe the system briefly.**

---

### Question 1: Define Scope

**Agent asks:**
"What are you mapping? (What's the scope?)"

**Offer 4 enumerated options:**

1. **Entire product** — "Full end-to-end system from discovery to completion" (Common for new products or full rewrites)
2. **Major feature area** — "Specific workflow within a larger product (e.g., 'onboarding,' 'checkout,' 'reporting')" (Common for feature launches)
3. **User journey** — "Specific user goal or job-to-be-done (e.g., 'hire a contractor,' 'file taxes')" (Common for JTBD-driven mapping)
4. **Redesign/refactor** — "Existing product/feature being rebuilt or simplified" (Common for legacy system modernization)

**Or describe your specific scope.**

**User response:** [Selection or custom]

---

### Question 2: Identify Users/Personas

**Agent asks:**
"Who are the primary users for this map? (List personas or user segments.)"

**Offer 4 enumerated options:**

1. **Single persona** — "One primary user type (e.g., 'small business owner')" (Simplifies mapping, good for MVP)
2. **Multiple personas, shared workflow** — "Different user types, same core activities (e.g., 'buyer' and 'seller' both browse listings)" (Common for marketplaces)
3. **Multiple personas, different workflows** — "Different user types with distinct workflows (e.g., 'admin' vs. 'end user')" (Requires separate maps or swim lanes)
4. **Roles within organization** — "Different job functions (e.g., 'PM,' 'designer,' 'engineer')" (Common for internal tools)

**Or describe your users.**

**Adaptation:** Use personas from context provided in Step 0 (proto-personas, JTBD, etc.)

**User response:** [Selection or custom]

---

### Question 3: Generate Backbone (Activities)

**Agent says:**
"Let's build the backbone—the narrative flow of activities users perform to accomplish their goal."

**Agent generates 5-8 activities** based on scope (Q1) and users (Q2), arranged left-to-right in workflow order.

Before presenting backbone activities to the user: if think-tool is available, invoke it to check — "Do any of these activity names map to a technical layer (frontend, backend, API, database, deployment) rather than a user workflow step?" If yes, regenerate before surfacing.

**Example (if Scope = "E-commerce checkout"):**

```
Backbone Activities (left to right):

1. Browse Products
2. Add to Cart
3. Review Cart
4. Enter Shipping Info
5. Enter Payment Info
6. Confirm Order
7. Receive Confirmation
```

**Agent asks:**
"Does this backbone capture the full workflow? Should we add, remove, or reorder activities?"

**User response:** [Approve, modify, or add custom activities]

---

### Question 4: Generate User Tasks (Under Each Activity)

**Agent says:**
"Now let's add user tasks under each activity, organized by priority (top = must-have, bottom = nice-to-have)."

**Agent generates 3-5 user tasks per activity**, arranged vertically by priority.

**Example (for Activity 2: "Add to Cart"):**

```
Add to Cart (Activity)
├─ Add single item to cart (must-have, walking skeleton)
├─ Adjust quantity (must-have)
├─ Add multiple items at once (should-have)
├─ Save item for later (nice-to-have)
└─ Add gift wrapping (nice-to-have)
```

**Agent repeats for all backbone activities**, showing the full map.

**Agent asks:**
"Does this capture the key tasks? Are priorities correct (top = MVP, bottom = later releases)?"

**User response:** [Approve, modify, or add custom tasks]

---

### Question 5: Identify Release Slices (Walking Skeleton + Increments)

**Agent says:**
"Let's define release slices by drawing horizontal lines across the map."

**Agent generates 3 release slices:**

**Release 1 (Walking Skeleton):** Top-priority tasks across all activities—minimal end-to-end functionality

**Release 2 (Next Increment):** Second-priority tasks that enhance the core workflow

**Release 3 (Polish/Expansion):** Third-priority tasks (nice-to-haves, edge cases, optimizations)

**Example:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Release 1 (Walking Skeleton):
- Browse products (basic list view)
- Add single item to cart
- Review cart (line items + total)
- Enter shipping info (name, address)
- Enter payment info (credit card only)
- Confirm order (basic confirmation)
- Receive email confirmation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Release 2 (Enhanced):
- Product filtering/search
- Adjust quantity in cart
- Save for later
- Multiple shipping options
- Multiple payment methods
- Order tracking link
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Release 3 (Polish):
- Product recommendations
- Guest checkout
- Gift wrapping
- Promo codes
- Advanced payment options
- Post-purchase surveys
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Agent asks:**
"Do these release slices make sense? Should we adjust scope or priorities?"

**User response:** [Approve or modify]

---

### Output: User Story Map

After completing the flow, generate the map using the structure in `references/output-template.md`.

---

## Examples

Anti-patterns: see `references/examples.md` for a good (user-workflow) and bad (technical-layers) story map.

---

## Common Pitfalls

Anti-patterns: see `references/pitfalls.md` for symptom/consequence/fix patterns.

---

## References

### Related Skills
- `skills/user-story-mapping/SKILL.md` — Component skill with story mapping template
- `skills/user-story/SKILL.md` — Converts map tasks into detailed user stories
- `skills/proto-persona/SKILL.md` — Defines users for mapping
- `skills/jobs-to-be-done/SKILL.md` — Informs backbone activities

### External Frameworks
- Jeff Patton, *User Story Mapping* (2014) — Origin of story mapping framework
- Jeff Patton, "The New User Story Backlog is a Map" (blog) — Explains backbone concept

### Provenance
- Derived from `skills/user-story/SKILL.md`, `skills/user-story-splitting/SKILL.md`, and `skills/user-story-mapping/SKILL.md`.
