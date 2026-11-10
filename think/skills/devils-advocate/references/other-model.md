# Other-model objections — detail

Step 3 of devils-advocate gets one cold objection set from the other model: from Claude Code →
codex, from Codex → claude. Automatic; the user is not asked each time.

## Availability

Skip, and write "other model: not used (<reason>)" on the report line, when:
`SECOND_OPINION_DEPTH` is set · `ask.mjs` not found · the CLI not installed · the call errors or
times out. Then step 3 is ours alone. Never fails the skill.

Find `ask.mjs`: `${CLAUDE_PLUGIN_ROOT}/../agents/scripts/ask.mjs`, else
`ls ~/.claude/plugins/cache/*/agents/*/scripts/ask.mjs | sort -V | tail -1`.

## Brief (scratch file, never in the repo)

- the plan or idea as the user stated it, and its context (constraints that are facts, paths);
- "Give the strongest objections, ranked, each with why it is a problem and the real failure
  pattern it resembles or `no clear precedent`. Then the one deepest flaw."

Leave out: our hidden assumptions, our objections, where we think it is weak, "we like it".

```sh
node <ask.mjs> --to codex --prompt-file <brief.md> --cwd <dir> --timeout 300 [--attach a,b]
```

Codex's sandbox may be down (`sandbox_down: true`): put the material in the brief or `--attach`
the files. `--to claude` takes `--model sonnet`.

## Merge

Write our objections (steps 2–3) before reading its answer. Then merge: same point → one
objection, marked both; otherwise marked `claude` or `codex` (the model that raised it). Settle
each by evidence (a file, a number, a checkable precedent), as `agents:use-codex` step 4; an
objection it raised that we cannot check is kept and labeled unchecked. A precedent it names that
we cannot place is dropped to `no clear precedent`. Core vulnerability and reversibility stay ours.
