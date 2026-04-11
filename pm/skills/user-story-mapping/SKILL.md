---
name: user-story-mapping
effort: high
description: >-
  Use when someone wants to generate a structured user story map directly from
  existing context — outputting a two-dimensional artifact with backbone
  activities, steps, tasks, and release slices. Triggers on: "user story map",
  "story map", "backbone
type: component
scenarios:
  - "Generate a user story map for our onboarding flow — we have a persona and the workflow defined"
  - "Build a story map with backbone activities and release slices for our checkout product"
  - "Create a two-dimensional story map with MVP and future release tiers"
  - "우리 서비스의 유저 스토리 맵 만들어줘"
  - "백본 활동과 릴리스 슬라이스를 포함한 스토리 맵 생성해줘"
compatibility:
  recommended: []
  optional:
    - think-tool
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 MVP vs. 미래 릴리스 범위 우선순위 판단 품질이 높아집니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- ALWAYS organize backbone activities by user workflow, not by system or technical layers.
- ALWAYS validate that the backbone represents real user goals before adding tasks.
- NEVER create a story map without a persona anchoring the user perspective.
- NEVER leave all tasks at equal priority — release slices must cut horizontally across the map.


## When to Use / When Not to Use

**Use when:**
- You have persona, workflow, and product context in hand and want a map generated
- Planning MVP vs. future release scope with horizontal release slices
- Visualizing an existing flat backlog as a two-dimensional narrative

**Not for:**
- Interactive discovery of personas and scope (use user-story-mapping-workshop)
- Authoring individual user stories (use user-story)
- Technical backlog grooming or task breakdown

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Generates backbone activities from provided context | Validates activities match actual user workflow |
| Produces tasks per activity with vertical priority | Confirms priority with the team |
| Proposes MVP / Release 2 / Future release slices | Approves release scope with stakeholders |
| Identifies gaps or missing steps in the map | Validates map accuracy with design and engineering |

## Related Skills

- `../user-story-mapping-workshop/SKILL.md` — use when you need facilitation to discover scope and personas
- `../user-story/SKILL.md` — tasks from the map become individual user stories
- `../user-story-splitting/SKILL.md` — large tasks from the map may need splitting before authoring

## Framework Background

See `references/framework-overview.md` for the Jeff Patton model, anti-patterns, and use criteria.

---

## Application

### Step 1: Define the Context

Use `template.md` for the full fill-in structure.

#### Segment
Who are you building for?

```markdown
### Segment:
- [Specify the target segment, e.g., "Small business owners using DIY accounting software"]
```

**Quality checks:**
- **Specific:** Not "users" but "enterprise IT admins" or "freelance designers"

---

#### Persona
Provide details about the persona within this segment (reference `skills/proto-persona/SKILL.md`).

```markdown
### Persona:
- [Describe the persona: demographics, behaviors, pains, goals]
```

**Example:**
- "Sarah, 35-year-old freelance graphic designer, manages 5-10 client projects at once, struggles with invoicing and payment tracking, wants to spend less time on admin and more time designing"

---

### Step 2: Define the Narrative
What is the user trying to accomplish? Frame this as a Jobs-to-be-Done statement (reference `skills/jobs-to-be-done/SKILL.md`).

```markdown
### Narrative:
- [Concise narrative of the persona's objective, e.g., "Complete a client project from kickoff to final payment"]
```

**Quality checks:**
- **Outcome-focused:** Not "use the product" but "deliver a client project on time and get paid"
- **One sentence:** If it takes more than one sentence, the scope may be too broad

---

### Step 3: Identify Activities (Backbone)
List 3-5 high-level activities the persona engages in to fulfill the narrative. These form the backbone of your map.

```markdown
### Activities:
1. [Activity 1, e.g., "Negotiate project scope and pricing"]
2. [Activity 2, e.g., "Execute design work"]
3. [Activity 3, e.g., "Deliver final assets to client"]
4. [Activity 4, e.g., "Send invoice and receive payment"]
5. [Activity 5, optional]
```

**Quality checks:**
- **Sequential:** Activities happen in order (left-to-right)
- **User actions:** Describe what the user *does*, not what the product *provides*
- **3-5 activities:** Too few = oversimplified, too many = overwhelming

> Parallelism note: Once activities are confirmed, steps for each activity can be
> generated concurrently. Similarly, once steps are finalized, tasks for each step
> across all activities can be generated in parallel.

---

### Step 4: Break Activities into Steps
For each activity, list 3-5 steps that detail how the activity is carried out.

```markdown
### Steps:

**For Activity 1: [Activity Name]**
- Step 1: [Detail step 1, e.g., "Review client brief"]
- Step 2: [Detail step 2, e.g., "Draft project proposal"]
- Step 3: [Detail step 3, e.g., "Negotiate timeline and budget"]
- Step 4: [Optional step 4]
- Step 5: [Optional step 5]

**For Activity 2: [Activity Name]**
- Step 1: [Detail step 1]
- Step 2: [Detail step 2]
...
```

**Quality checks:**
- **Actionable:** Each step is something the user does
- **Observable:** You could watch someone perform this step
- **Logical sequence:** Steps follow a natural order

---

### Step 5: Break Steps into Tasks
For each step, list 5-7 tasks that must be completed.

```markdown
### Tasks:

**For Activity 1, Step 1: [Step Name]**
- Task 1: [Detail task 1, e.g., "Read client brief document"]
- Task 2: [Detail task 2, e.g., "Identify key deliverables"]
- Task 3: [Detail task 3, e.g., "Note budget constraints"]
- Task 4: [Detail task 4, e.g., "Clarify timeline expectations"]
- Task 5: [Detail task 5, e.g., "List open questions for client"]
- Task 6: [Optional task 6]
- Task 7: [Optional task 7]

**For Activity 1, Step 2: [Step Name]**
- Task 1: [Detail task 1]
...
```

**Quality checks:**
- **Granular:** Tasks are small, specific actions
- **User-facing or behind-the-scenes:** Include both (e.g., "Send email" and "Receive confirmation")
- **Prioritizable:** You'll prioritize tasks vertically (top = essential, bottom = nice-to-have)

---

### Step 6: Prioritize Vertically
Arrange tasks top-to-bottom by priority:
- **Top rows:** MVP / Release 1 (must-have)
- **Middle rows:** Release 2 (important but not critical)
- **Bottom rows:** Future / Nice-to-have

Draw horizontal "release lines" to demarcate scope.

If think-tool is available, invoke it now: reason about trade-offs in MVP vs. future-release scope before committing to the vertical prioritization.

---

### Step 7: Identify Gaps and Opportunities
Review the map and ask:
- Are there missing steps or tasks?
- Are there pain points we're not addressing?
- Are there opportunities to delight users?
- Do all activities flow logically?

If sequential-thinking is available, invoke it now: re-read the completed map step by step and reason about missing steps, logical discontinuities, or activities that may be miscategorized before finalizing output.

---

## Output Format

Use `template.md` as the canonical output structure. Render the map as follows:
- Place Segment, Persona, and Narrative at the top before the backbone
- Render activities as `###` headers
- Render steps as `-` bullets under each activity header
- Render tasks as indented `-` bullets with release labels (MVP / Release 2 / Future)

---

## Examples

See `examples/sample.md` for a full story map example.

---

## Common Pitfalls

See `references/pitfalls.md` for symptom/consequence/fix patterns when map quality is low.

---

## References

### Related Skills
- `skills/proto-persona/SKILL.md` — Defines the persona for the story map
- `skills/jobs-to-be-done/SKILL.md` — Informs the narrative and activities
- `skills/user-story/SKILL.md` — Tasks from the map become user stories
- `skills/problem-statement/SKILL.md` — Problem statement frames the narrative

### External Frameworks
- Jeff Patton, *User Story Mapping* (2014) — Origin of the story mapping technique
- Teresa Torres, *Continuous Discovery Habits* (2021) — Opportunity solution trees (complementary to story maps)

### Provenance
- Adapted from `prompts/user-story-mapping.md` in the `https://github.com/deanpeters/product-manager-prompts` repo.
