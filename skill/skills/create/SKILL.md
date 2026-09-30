---
name: create
effort: high
description: >-
  Use when a new skill should be generated in the same shape as the repo's existing skills. Triggers on: "스킬 만들어줘", "새 스킬 뼈대", "우리 스킬처럼 만들어줘", "create a skill".
scenarios:
  - "Create a skill for reviewing database migrations, shaped like the develop skills"
  - "Scaffold a new skill that looks like the rest of the repo"
  - "create a skill that enforces a stance every turn, like devils-advocate"
  - "스킬 만들어줘 — PR 설명 검토용으로, 기존 스킬이랑 똑같은 모양으로"
  - "새 스킬 뼈대 잡아줘, think 플러그인에 넣을 거야"
  - "우리 스킬처럼 만들어줘. 장애 회고 정리하는 스킬이야"
compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 아키타입을 고르기 전에 이 스킬이 정말 새로 필요한지, 기존 스킬로 충분한지 먼저 따져볼 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Standing Mandates

- ALWAYS read 1-2 exemplars of the chosen archetype and mirror their headings and their order. Do not work from the skeleton alone.
- ALWAYS write the description as "Use when ...", 250 chars or fewer, triggers only. Never summarize the process in it.
- NEVER add filler sections. No Overview, Background, or Philosophy; if a heading is not in the archetype, it does not go in.
- NEVER exceed the archetype's line band. Over the band means cut, not split into a longer file.
- Goal: a reviewer cannot tell the result from its siblings.

# Create

Generates a new SKILL.md shaped like the skills already in this repo, then hands it to the two gates.

**Not for** editing or repairing an existing skill (`write:writing-skills`).

## Process

1. **Intake.** Get the skill's purpose, the situation that should trigger it, and the user's own words for asking. One line each; ask only for what is missing.
2. **Place.** Pick the plugin, then a bare kebab-case name at `<plugin>/skills/<name>/SKILL.md`. Never repeat the plugin name in it (`think/skills/mentor`, not `think-mentor`).
3. **Pick archetype.** Choose from `references/archetypes.md`: technique, persona, workflow, ops, builder, or specialist. State the choice and the line band.
4. **Read exemplars.** Read the archetype's exemplars and 1-2 siblings in the target plugin. When the siblings disagree with the archetype file, the target plugin's siblings win.
5. **Draft.** Write frontmatter (name, description, 2-3 EN and 2-3 KR scenarios, compatibility with a Korean `remote_mcp_note`), then the body in the exemplars' heading order. Body is English; Korean stays in triggers, scenarios, and the note.
6. **Check.** Run the repo's validator (here `python3 _repo/scripts/validate_plugins.py`) and fix every ERROR for the new skill. Count lines against the band.
7. **Hand off.** Run `trigger-validator` on the description, then `quality-assurance` on the whole skill. Fix what they flag and re-run the one that flagged it.
8. **Register.** Follow the repo's update workflow: version bump in `.claude-plugin/marketplace.json`, the plugin's `README.md` and `KOR.md`, commit, push. Where the user has put a hold on any of these, stop before that step.

## Output Template

```
Skill: <plugin>/skills/<name>/SKILL.md
Archetype: <archetype> (<line band>) — exemplars: <paths>
Lines: <n>
Validator: <no ERROR | list>
trigger-validator: <verdict, winning description if rewritten>
quality-assurance: <Top Improvements, each red item resolved>
Registered: <README/KOR/version status>
```

Do NOT ship a skill that has not passed both gates.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Picks the archetype, reads exemplars, drafts to their shape | Confirm the purpose, the plugin, and the trigger phrases |
| Runs the validator and both gates, fixes what they flag | Decide on anything the gates leave as a judgment call |
| Prepares the README, KOR, and version changes for registration | Approve the final draft and any push |

## Related Skills

- `trigger-validator` — scores and rewrites the description; step 7, first half.
- `quality-assurance` — the pre-ship gate; step 7, second half.
- `write:writing-skills` — the authoring rules this skill follows, and the tool for editing an existing skill.
