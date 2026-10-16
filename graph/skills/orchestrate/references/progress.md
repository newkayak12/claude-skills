# Progress and verdicts

Moved out of `SKILL.md`. Read it when mirroring a run into a task list or when reading a verdict field.

## Show the graph while it runs

A run is long and mostly silent, and the user cannot see inside it. Mirror the graph into
whatever live progress surface the host has — a task list is the usual one:

- Each `graph_next` — open a task per newly ready node, subject `<node_id> · <vendor>/<model>`.
- On dispatch — that task to `in_progress`.
- On the verdict — `completed`, with the short `reason` appended when it failed.

The graph already carries the dependencies, so the surface ends up shaped like the run: nodes
waiting, one moving, the rest done. On a host with no such surface, print the same three
columns as plain lines instead:

```
✅ implement:U1:1  codex/gpt-5.6-sol   files verified
❌ gate:U1:1       self/opus           rejected, 40% — retrying U1
⏳ test:U2:1       codex/gpt-5.6-sol   running
```

Either way the vocabulary is the same and it is small: `node_id`, `vendor`/`model`, `state`,
and the short `reason`. Never open a payload to enrich a line — no gap text, no evidence, no
`detail_path` read. **A line you cannot write from the verdict is a line you do not write.**

## Verdicts

| field | meaning |
|---|---|
| `stage_ok` | adjudicated. Never report a value above what the broker returned. |
| `verified` | test nodes: the checks ran and passed |
| `accept`, `match_pct`, `gap_count` | gate nodes |
| `changed_files_verified` | `true`/`false` under `isolated`; `null` in a shared worktree unless contradicted |
| `contradicted_files` | claimed files the worktree does not show — these fail the node |

`null` verification means "could not attribute": neither a pass nor a failure. Say so
rather than rounding it up.
