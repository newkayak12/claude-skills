---
name: writer-verification
description: >-
  Use when existing writing needs reviewing, proofreading, or improvement.
  Triggers on: "글 검토해줘", "맞춤법 확인", "proofread", "이 문장 자연스러워?", "글 다듬어줘", review
  my writing", "출판 전에 확인해줘", "표현이 어색한 것 같아", "문법 맞아?", "글 퀄리티 봐줘".
scenarios:
  - "이 이메일 자연스러워?"
  - "블로그 포스트 올리기 전에 검토해줘"
  - "Proofread this PR description"
  - "문서 표현이 어색한 것 같아, 봐줘"
  - "이 문장들 맞춤법이랑 스타일 체크해줘"
  - "Does this read naturally to a native speaker?"
compatibility:
  optional:
    - think-tool        # reasoning about which findings most affect reader experience
  remote_mcp_note: >-
    think-tool이 있으면 어떤 발견이 독자 경험에 가장 큰 영향을 미치는지 종합할 때 활용됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
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
