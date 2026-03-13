---
name: writer-verification
description: Use when asked to review, proofread, check, or verify written text — blog posts, emails, reports, docs, marketing copy, Korean or English writing. Trigger on words like 검수, 교정, 검토, 맞춤법, 퇴고, review, proofread, "이거 봐줘", "고쳐줘", "어색하지 않아?". Always run all four passes in order.
---

# Writer Verification

**Core rule:** Every finding must include original → fix + reason. Pointing out without fixing is half a review.

**MCP usage by mode:**
- **Inline mode only (< 300 chars):** If `mcp__claude_ai_sequential-thinking__sequentialthinking` is available, use it to structure the four passes as sequential steps.
- **Both modes:** If `mcp__claude_ai_think-tool__think` is available, use it before each pass to reason through the text and audience before acting.

---

## Execution Mode

Count the characters in the submitted text first.

**< 300 chars — inline:** Read `references/passes.md` and run all four passes sequentially.

**≥ 300 chars — parallel subagents:** Dispatch all four in the same turn. Wait for all to return, then aggregate.

| Pass | Agent | Inputs |
|------|-------|--------|
| 1. Spelling & Grammar | `agents/grammarian.md` | text, language |
| 2. Writing Patterns | `agents/editor.md` | text |
| 3. Expression & Style | `agents/copywriter.md` | text, purpose, audience |
| 4. Reader Perspective | `agents/reader.md` | text, audience |

If a Korean spelling issue is uncertain, load `references/korean-spelling.md`.

---

## Output Format

```
## Spelling & Grammar
- [fix] "됬어요" → "됐어요"

## Writing Patterns
- [warning] Para 1: 3 sentences starting with "그리고" → reorder or drop connectors

## Expression & Style
- [fix] "혁신적인 솔루션을 제공합니다" → "배포 시간을 50% 단축하는 자동화 도구를 제공합니다"

## Reader Perspective
- [check] Adjust tech-term density in para 2 for general audience

## Summary
[2-3 lines: strengths + top improvement points]
```

Priority: 🔴 Must fix (meaning errors, logic gaps) · 🟡 Recommended (patterns, phrasing) · 🟢 Optional (style preference)
