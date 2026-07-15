<!-- harness:begin v1 -->
## Harness

This project uses the harness plugin for substantial changes.

- **Substantial or risky changes** (multi-file, gated paths, anything with a quality
  bar) go through the six-stage engine — do not hand-roll the flow:
  `Workflow({ scriptPath: "<harness plugin root>/engine/pipeline.js", args: { request: "<the request>" } })`
- **Conventions are law:** read `.claude/conventions/**` before implementing; they feed
  the engine's acceptance criteria and verification commands.
- **Gate:** edits matching the patterns in `.claude/harness-gate.json` are blocked by a
  PreToolUse hook unless the harness is engaged this session (fail-open on errors).
  If blocked, run the harness instead of retrying the edit.
- Trivial edits (typos, single-line fixes, docs) do not need the engine.
<!-- harness:end -->
