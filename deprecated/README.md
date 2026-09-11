# deprecated

Plugins that are no longer published to the marketplace. The files stay here so their frameworks can
be read and lifted; nothing routes to them.

| Plugin | Skills | Unpublished | Note |
|---|---|---|---|
| `self` | 12 | `fef3604` (2026-08-27), unlinked deliberately 2026-09-11 | self-understanding: values, fears, identity, motivation, shadow, `talk` counseling persona |
| `leadership` | 5 | `fef3604` (2026-08-27), unlinked deliberately 2026-09-11 | IC/manager leveling and 1-on-1 preparation |

They were absent from `.claude-plugin/marketplace.json` from `fef3604` onward — a release commit that
mentioned neither — and the removal was confirmed as intended on 2026-09-11.

## Rules

- No live plugin references `self:` or `leadership:` any more. A skill that wants one of these
  capabilities carries it directly instead of routing to a plugin the user cannot install.
- `think:mentor` absorbed the parts that were load-bearing for it — values conflict, avoidance,
  identity, motivation, shadow, and the boundary that used to hand a painful session to `self:talk`.
  See its `## Moves` table and `references/moves.md`.
- The validator does not check this directory, and these versions are frozen at their last published value (`self` 1.1.3, `leadership` 1.1.2). If one comes
  back, move it out, add it to `marketplace.json`, and give it a `KOR.md` — `self` never had one.
- `pm/` is hidden from the marketplace (`dab44e5`) but **not** deprecated: `planning:roadmap-planning`,
  `develop:operations-workflow`, `develop:incident-response-playbook` and
  `think:deep-thinking-workflow` still route to `pm:` skills. Leave it where it is.
