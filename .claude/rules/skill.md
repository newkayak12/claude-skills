# Skill — what it is

A skill is a procedure the model follows inside a conversation: the steps, the judgment at each
step, the gates it must pass, and what it produces. It lives at `<plugin>/skills/<name>/SKILL.md`,
with `references/` for detail and `scripts/` (or the plugin's `mcp/`) for anything mechanical.

## What a skill owns
- The work and its order: what to ask, what to read, what to decide, when to stop.
- The artifacts: files, ledgers and run records (`deck.pdf`, `.harness-run/<slug>/05-report.md`,
  teams `task.json` and `ledger.jsonl`). These are the source of truth anything else reads.
- Enforcement a person must not skip, in a form every client sees (engine check, MCP refusal,
  plain command hook).
- Parsing and decisions in node/python with their own tests — never only in prose.

## What a skill does not do
- Draw UI, wait on a pane, or depend on a mod being installed. It runs the same headless
  (`claude -p`), in Codex, and in older Claude Code builds.
- Leave out a record a viewer would need: if a person must later see who decided what and why, the
  skill's engine writes that field.

## Writing one
Full guide: `write/skills/writing-skills/SKILL.md`. Every skill starts from
`_repo/coding-guidelines.md`; apply it when a skill is created or next edited — no mass rewrite.
teams-mounted skills stay frozen until teams decides.

- `description` starts with `Use when` — it is the trigger.
- `scenarios`: EN + KR variants, 2-3 each.
- Sections: Process → Output Template → What Claude Does / What You Do → Related Skills.
- No background explanations — the skill name is the context. Target 70% of the current average length.
- No new skill when an existing one can be split or extended.
- A behaviour change needs one real run before it is done.
