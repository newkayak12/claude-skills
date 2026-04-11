---
name: doc-coauthoring
effort: max
description: >-
  Use when starting a substantial written artifact that will be read by others.
  Triggers on: "문서 같이 써줘", "PRD 작성", "design doc", "RFC 초안", "제안서 써야 해",
  technical spec", "decision doc", "write a doc", "문서 작성 도와줘", "spec 써줘".
scenarios:
  - "API 설계 문서 같이 써줘"
  - "이 기능에 대한 PRD 작성해야 해"
  - "Help me write a design doc for this new service"
  - "RFC 초안 작성 도와줘"
  - "팀에 공유할 제안서 써야 해"
  - "Write up a decision doc about our database choice"
compatibility:
  optional:
    - think-tool        # reasoning about section ordering and which section has most unknowns
  remote_mcp_note: >-
    think-tool이 있으면 어떤 섹션부터 시작할지, 어떤 섹션이 가장 불확실한지 체계적으로 판단할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- ALWAYS detect available output format (artifacts vs markdown) in Stage 1 before drafting.
- ALWAYS ask who the primary reader is before drafting any section.
- NEVER draft all sections upfront — complete and validate one section before moving to the next.
- NEVER start writing without knowing the single most important question the document must answer.


# Doc Co-Authoring Workflow

This skill provides a structured workflow for guiding users through collaborative document creation. Act as an active guide, walking users through three stages: Context Gathering, Refinement & Structure, and Reader Testing.

## When to Offer This Workflow

**Trigger conditions:**
- User mentions writing documentation: "write a doc", "draft a proposal", "create a spec", "write up"
- User mentions specific doc types: "PRD", "design doc", "decision doc", "RFC"
- User seems to be starting a substantial writing task

**Initial offer:**
Offer the user a structured workflow for co-authoring the document. Explain the three stages:

1. **Context Gathering**: User provides all relevant context while Claude asks clarifying questions
2. **Refinement & Structure**: Iteratively build each section through brainstorming and editing
3. **Reader Testing**: Test the doc with a fresh Claude (no context) to catch blind spots before others read it

Explain that this approach helps ensure the doc works well when others read it (including when they paste it into Claude). Ask if they want to try this workflow or prefer to work freeform.

If user declines, work freeform. If user accepts, proceed to Stage 1.

## Stage 1: Context Gathering

**Goal:** Close the gap between what the user knows and what Claude knows, enabling smart guidance later.

### Initial Questions

Start by asking the user for meta-context about the document:

1. What type of document is this? (e.g., technical spec, decision doc, proposal)
2. Who's the primary audience?
3. What's the desired impact when someone reads this?
4. Is there a template or specific format to follow?
5. Any other constraints or context to know?

Inform them they can answer in shorthand or dump information however works best for them.

**If user provides a template or mentions a doc type:**
- Ask if they have a template document to share
- If they provide a link to a shared document, use the appropriate integration to fetch it
- If they provide a file, read it

**If user mentions editing an existing shared document:**
- Use the appropriate integration to read the current state
- Check for images without alt-text
- If images exist without alt-text, explain that when others use Claude to understand the doc, Claude won't be able to see them. Ask if they want alt-text generated. If so, request they paste each image into chat for descriptive alt-text generation.

### Info Dumping

Encourage a full context dump: background, related discussions, why alternatives aren't used, org context, timeline, tech dependencies, stakeholder concerns. They don't need to organize it — just get it all out. Accept stream-of-consciousness, links, or channel pointers.

Use integrations (Slack, Drive, etc.) if available to pull context directly. If not, suggest enabling connectors in Claude settings or pasting content manually. Track what's learned and what remains unclear.

When the dump is substantially done, generate 5–10 numbered clarifying questions. Accept shorthand answers (e.g., "1: yes, 2: see #channel"). See `references/context-gathering-tips.md` for detailed guidance on integration handling and context tracking.

**Exit condition:** Sufficient context when edge cases and trade-offs can be asked about without needing basics explained.

When ready, proceed to Stage 2.

## Stage 2: Refinement & Structure

**Goal:** Build the document section by section through brainstorming, curation, and iterative refinement.

**Instructions to user:**
Explain that the document will be built section by section. For each section:
1. Clarifying questions will be asked about what to include
2. 5-20 options will be brainstormed
3. User will indicate what to keep/remove/combine
4. The section will be drafted
5. It will be refined through surgical edits

Start with whichever section has the most unknowns (usually the core decision/proposal), then work through the rest.

**Section ordering:**

If the document structure is clear:
Ask which section they'd like to start with.

Use think-tool to reason explicitly about which section has the most unresolved questions given the context gathered in Stage 1, then suggest starting there. For decision docs, that's usually the core proposal. For specs, it's typically the technical approach. Summary sections are best left for last.

If user doesn't know what sections they need:
Based on the type of document and template, suggest 3-5 sections appropriate for the doc type.

Ask if this structure works, or if they want to adjust it.

**Once structure is agreed:**

Create the initial document structure with placeholder text for all sections.

**If access to artifacts is available:**
Use `create_file` to create an artifact. This gives both Claude and the user a scaffold to work from.

Inform them that the initial structure with placeholders for all sections will be created.

Create artifact with all section headers and brief placeholder text like "[To be written]" or "[Content here]".

Provide the scaffold link and indicate it's time to fill in each section.

**If no access to artifacts:**
Create a markdown file in the working directory. Name it appropriately (e.g., `decision-doc.md`, `technical-spec.md`).

Inform them that the initial structure with placeholders for all sections will be created.

Create file with all section headers and placeholder text.

Confirm the filename has been created and indicate it's time to fill in each section.

**For each section:**

### Step 1: Clarifying Questions

Announce work will begin on the [SECTION NAME] section. Ask 5-10 clarifying questions about what should be included:

Generate 5-10 specific questions based on context and section purpose.

Inform them they can answer in shorthand or just indicate what's important to cover.

### Step 2: Brainstorming

For the [SECTION NAME] section, brainstorm [5-20] things that might be included, depending on the section's complexity. Look for:
- Context shared that might have been forgotten
- Angles or considerations not yet mentioned

Generate 5-20 numbered options based on section complexity. At the end, offer to brainstorm more if they want additional options.

### Step 3: Curation

Ask which points should be kept, removed, or combined. Request brief justifications to help learn priorities for the next sections.

Provide examples:
- "Keep 1,4,7,9"
- "Remove 3 (duplicates 1)"
- "Remove 6 (audience already knows this)"
- "Combine 11 and 12"

**If user gives freeform feedback** (e.g., "looks good" or "I like most of it but...") instead of numbered selections, extract their preferences and proceed. Parse what they want kept/removed/changed and apply it.

### Step 4: Gap Check

Based on what they've selected, ask if there's anything important missing for the [SECTION NAME] section.

### Step 5: Drafting

Use `str_replace` to replace the placeholder text for this section with the actual drafted content.

Announce the [SECTION NAME] section will be drafted now based on what they've selected.

**If using artifacts:**
After drafting, provide a link to the artifact.

Ask them to read through it and indicate what to change. Note that being specific helps learning for the next sections.

**If using a file (no artifacts):**
After drafting, confirm completion.

Inform them the [SECTION NAME] section has been drafted in [filename]. Ask them to read through it and indicate what to change. Note that being specific helps learning for the next sections.

**Key instruction for user (include when drafting the first section):**
Provide a note: Instead of editing the doc directly, ask them to indicate what to change. This helps learning of their style for future sections. For example: "Remove the X bullet - already covered by Y" or "Make the third paragraph more concise".

### Step 6: Iterative Refinement

As user provides feedback:
- Use `str_replace` to make edits (never reprint the whole doc)
- **If using artifacts:** Provide link to artifact after each edit
- **If using files:** Just confirm edits are complete
- If user edits doc directly and asks to read it: mentally note the changes they made and keep them in mind for future sections (this shows their preferences)

**Continue iterating** until user is satisfied with the section.

### Quality Checking

After 3 consecutive iterations with no substantial changes, ask if anything can be removed without losing important information.

When section is done, confirm [SECTION NAME] is complete. Ask if ready to move to the next section.

**Repeat for all sections.**

### Near Completion

As approaching completion (80%+ of sections done), announce intention to re-read the entire document and check for:
- Flow and consistency across sections
- Redundancy or contradictions
- Anything that feels like "slop" or generic filler
- Whether every sentence carries weight

Read entire document and provide feedback.

**When all sections are drafted and refined:**
Announce all sections are drafted. Indicate intention to review the complete document one more time.

Review for overall coherence, flow, completeness.

Provide any final suggestions.

Ask if ready to move to Reader Testing, or if they want to refine anything else.

## Stage 3: Reader Testing

**Goal:** Verify the document works for readers without authoring context.

**If sub-agents available (Claude Code):** Predict 5-10 reader questions, test each with a fresh Claude instance (ReaderAgent in `agents/reader-agent.md`), report gaps, loop back to refinement.

**If no sub-agents (claude.ai):** Follow `references/manual-reader-testing.md`.

**Exit condition:** Reader Claude consistently answers questions correctly without surfacing new gaps.


## Output Template

For each document, Claude produces:
1. **Document structure** — outline with section headings and logical flow
2. **Draft content** — full prose for each section, calibrated to audience and tone
3. **Review comments** — suggestions for clarity, gaps, and factual accuracy
4. **Revision log** — summary of changes made in each iteration

## Tips for Effective Guidance

See `references/guidance-tips.md` for tone, deviation handling, context management, artifact management, and quality guidance.
