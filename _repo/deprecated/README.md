# deprecated

Retired plugins, skills and artifacts. The files are not in the tree; git history keeps every one of them.
Each row gives the last commit that contained the item and the command that brings it back.

Restore: run the command, then move the files where they belong (a plugin to the repo root, a skill back into its plugin's `skills/`), add a plugin to `.claude-plugin/marketplace.json`, and give it a `KOR.md`.

| Item | What | Last commit holding it | Restore |
|---|---|---|---|
| `self` (plugin, 12 skills) | self-understanding: values, fears, identity, shadow, `talk`; load-bearing parts absorbed by `think:mentor` | `c2c26bd9` | `git checkout c2c26bd9 -- _repo/deprecated/self` |
| `leadership` (plugin, 5 skills) | IC/manager leveling and 1-on-1 preparation | `c2c26bd9` | `git checkout c2c26bd9 -- _repo/deprecated/leadership` |
| `pm` (plugin, 22 skills) | product management; parts absorbed by planning, think, develop | `c2c26bd9` | `git checkout c2c26bd9 -- _repo/deprecated/pm` |
| `harness-beta` (plugin) | classifier choosing Agent Team vs. Dynamic Workflow; routing idea absorbed into `graph` | `c2c26bd9` | `git checkout c2c26bd9 -- _repo/deprecated/harness-beta` |
| `mods` (plugin) | retired at 0.3.0; features moved to `session` and `trophy` | `eba3ff3a` | `git checkout eba3ff3a -- _repo/deprecated/mods` |
| `technique-write` (plugin) | Design Review and ADR templates; now formats of `write:plans` | `c2c26bd9` | `git checkout c2c26bd9 -- _repo/deprecated/technique-write` |
| `assist` (plugin) | beta decision assistance, unpublished 2026-10-12 | `7e299e97` | `git checkout 7e299e97 -- assist` |
| `portfolio/skills/feedback-beta` | beta lane closed 2026-09-02, promoted into `feedback` 1.13.0 | `63142c35` | `git checkout 63142c35 -- portfolio/skills/feedback-beta` |
| `planning/skills/roadmap-planning` | quarterly roadmap workflow with roadmap-coordinator agent; retired 2026-10-17: never invoked in any session log, no skill or agent depends on it, 241 lines over the 200 target | `08247eb7` | `git checkout 08247eb7 -- planning/skills/roadmap-planning` |
| `develop/skills/pragmatic-programmer` | codebase-health diagnosis across seven principles | `bf4e49f3` | `git checkout bf4e49f3 -- _repo/deprecated/develop/skills/pragmatic-programmer` |
| `develop/code-documenter` | docstring and API documentation skill | `bf4e49f3` | `git checkout bf4e49f3 -- _repo/deprecated/develop/code-documenter` |
| `develop/dev-quality-workflow` | staged dev quality workflow | `bf4e49f3` | `git checkout bf4e49f3 -- _repo/deprecated/develop/dev-quality-workflow` |
| `develop/microservices-architect` | microservice design skill | `bf4e49f3` | `git checkout bf4e49f3 -- _repo/deprecated/develop/microservices-architect` |
| `think/skills/microinteractions` | UI micro-moment design | `c2c26bd9` | `git checkout c2c26bd9 -- _repo/deprecated/think/skills/microinteractions` |
| `think/skills/deep-thinking-workflow` | staged ideate-critique-converge workflow | `c2c26bd9` | `git checkout c2c26bd9 -- _repo/deprecated/think/skills/deep-thinking-workflow` |
| `cognition/skills/thinking-style-profiler` | personal thinking-pattern profile | `c2c26bd9` | `git checkout c2c26bd9 -- _repo/deprecated/cognition/skills/thinking-style-profiler` |
| `write/skills/doc-coauthoring` | merged into `write:plans` (document purpose) | `c2c26bd9` | `git checkout c2c26bd9 -- _repo/deprecated/write/skills/doc-coauthoring` |
| `write/skills/technical-blog-writer` | merged into `write:plans` (blog purpose) | `c2c26bd9` | `git checkout c2c26bd9 -- _repo/deprecated/write/skills/technical-blog-writer` |
| `write/skills/sbi-writer` | merged into `write:plans` (feedback purpose) | `c2c26bd9` | `git checkout c2c26bd9 -- _repo/deprecated/write/skills/sbi-writer` |
| `artifacts/think-devils-advocate-workspace` | generated benchmark output of devils-advocate iteration 1 | `c2c26bd9` | `git checkout c2c26bd9 -- _repo/deprecated/artifacts` |
| `docs/diagrams` | teams architecture and first-run diagrams nothing cites | `c2c26bd9` | `git checkout c2c26bd9 -- _repo/deprecated/docs` |

No live plugin references `self:`, `leadership:`, `harness-beta:`, `pm:` or `assist:`. A skill that wants one of these capabilities carries it directly.
