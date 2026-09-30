# deprecated

Plugins that are no longer published to the marketplace, and unused skills and artifacts of live plugins. The files stay here so their frameworks can
be read and lifted; nothing routes to them.

| Plugin | Skills | Unpublished | Note |
|---|---|---|---|
| `self` | 12 | `fef3604` (2026-08-27), unlinked deliberately 2026-09-11 | self-understanding: values, fears, identity, motivation, shadow, `talk` counseling persona |
| `leadership` | 5 | `fef3604` (2026-08-27), unlinked deliberately 2026-09-11 | IC/manager leveling and 1-on-1 preparation |
| `pm` | 22 | `dab44e5` (2026-08-30, hidden); moved here 2026-09-28 | product management; think/planning/develop now carry what they used (planning 1.2.0 absorbed hypothesis, prioritization and problem-validation parts), teams inlined its PRD contract at 0.20.0 |
| `harness-beta` | 2 | `d396f2d` (2026-09-08), its only commit | routing idea (classifier choosing Agent Team vs. Dynamic Workflow) absorbed into `graph` |
| `technique-write` | 2 | 2026-09-30 | fixed-template Design Review and ADR; now formats of `write:plans` (`write/skills/plans/references/formats/`) |

## Skills and artifacts (moved 2026-09-29, `docs/plans/2026-09-29-repo-tidy.md`)

The plugins below are still live. Only these pieces of them were unused, meaning no workflow, skill or code routed to them, so they moved here with their contents unchanged.

| Path | What | Plugin version that dropped it |
|---|---|---|
| `develop/skills/pragmatic-programmer` | codebase-health diagnosis across seven principles | develop 1.5.4 |
| `think/skills/microinteractions` | UI micro-moment design | think 1.3.3 |
| `cognition/skills/thinking-style-profiler` | personal thinking-pattern profile | cognition 1.1.4 |
| `artifacts/think-devils-advocate-workspace` | generated benchmark output of devils-advocate iteration 1 | — |
| `docs/diagrams/` | teams architecture and first-run diagrams nothing cites | — |

## Merged into `write:plans` (2026-09-30)

`write/skills/writing-plans` was renamed `write/skills/plans` and became the one entry for plan-first writing; its Step 0 picks the purpose. These three moved here unchanged; their content lives on under `write/skills/plans/references/`.

| Path | Now |
|---|---|
| `write/skills/doc-coauthoring` | `plans` document purpose — `references/document.md`, `agents/reader-agent.md` |
| `write/skills/technical-blog-writer` | `plans` blog purpose — `references/examples/blog.md` |
| `write/skills/sbi-writer` | `plans` feedback purpose — `references/examples/sbi.md` |

They were absent from `.claude-plugin/marketplace.json` from `fef3604` onward — a release commit that
mentioned neither — and the removal was confirmed as intended on 2026-09-11.

## Rules

- No live plugin references `self:`, `leadership:`, `harness-beta:`, or `pm:` any more. A skill that wants
  one of these capabilities carries it directly instead of routing to a plugin the user cannot install.
- `think:mentor` absorbed the parts that were load-bearing for it — values conflict, avoidance,
  identity, motivation, shadow, and the boundary that used to hand a painful session to `self:talk`.
  See its `## Moves` table and `references/moves.md`.
- `harness-beta` explored a classifier choosing between a role-isolated Agent Team and a Dynamic
  Workflow per request; it never advanced past its first commit. `graph` picked up that routing idea
  and is the place to look for it now.
- The validator does not check this directory, and these versions are frozen at their last published value (`self` 1.1.3, `leadership` 1.1.2). If one comes
  back, move it out, add it to `marketplace.json`, and give it a `KOR.md` — `self` never had one.
