---
name: writer-verification
description: Use when asked to review, proofread, check, or verify written text — blog posts, emails, reports, docs, marketing copy, Korean or English writing. Trigger on words like 검수, 교정, 검토, 맞춤법, 퇴고, review, proofread, "이거 봐줘", "고쳐줘", "어색하지 않아?". Always run all four passes in order.
---

# Writer Verification

**Core rule:** Every finding must include original → fix + reason. Pointing out without fixing is half a review.

**MCP usage by mode:**
- **Inline mode only (< 300 chars):** If sequential-thinking is available, use it to structure the four passes as sequential steps.
- **Both modes:** If think-tool is available, use it before each pass to reason through the text and audience before acting.
- **Parallel mode, before Summary:** If think-tool is available, invoke it before writing the Summary section to identify which findings most affect the reader's experience.

---

## Execution Mode

Count the characters in the submitted text first.

**< 300 chars — inline:** Read `references/passes.md` and run all four passes sequentially. If `agents/*.md` are updated, update `references/passes.md` in sync — they are the inline-mode mirror.

**≥ 300 chars — parallel subagents:** Dispatch all four in the same turn. Wait for all to return, then aggregate.

| Pass | Agent | Inputs |
|------|-------|--------|
| 1. Spelling & Grammar | `agents/grammarian.md` | text, language |
| 2. Writing Patterns | `agents/editor.md` | text |
| 3. Expression & Style | `agents/copywriter.md` | text, purpose, audience |
| 4. Reader Perspective | `agents/reader.md` | text, audience |

If a Korean spelling issue is uncertain, load `references/korean-spelling.md`.

**Aggregation rules (parallel mode):**
- Deduplicate by location: if two passes flag the same span, keep the higher-severity finding and note both sources
- Conflicting severity: elevate to the higher level (🔴 beats 🟡 beats 🟢)
- Conflicting fixes: surface both options with attribution (e.g., `[grammarian] fix A / [copywriter] fix B`)
- If mcp-reasoner is available, invoke it during aggregation to resolve ambiguous conflicts before producing the final report (Ambiguous = two passes flag the same span for incompatible reasons, e.g., grammarian says rewrite for subject agreement while copywriter says cut the sentence entirely for vagueness — invoke mcp-reasoner to choose)

---

## Output Format

See `references/output-format.md` for the full template and examples.

Priority: 🔴 Must fix (meaning errors, logic gaps) · 🟡 Recommended (patterns, phrasing) · 🟢 Optional (style preference)
