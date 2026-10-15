# Backlog

One session is one Sprint: take cards from the top into `tm_open({requests})` (array order =
priority), pass `context_from` the prior Sprint, and at close delete shipped cards and put
`carryover_candidates` back on top. Each card: title, why, acceptance.

## Ready

1. **Rules follow teams, not the removed harness gate**
   - Why: harness governance was removed (2026-10-15); `repo.md`, `maintaining.md` and
     `.claude/hooks/repo-rules.mjs` still speak of the goal gate, harness runs and `05-report.md`.
   - Acceptance: no rule names the goal gate or `.claude/harness-gate.json`; the change loop reads
     backlog → Sprint → report; repo-rules' push hold keys on open teams tasks or is removed;
     `node _repo/scripts/test-repo-rules.mjs` passes.

2. **harness:remove deadlocks under its own gate**
   - Why: with the gate on, Claude cannot run `remove.mjs` (Bash naming a `.mjs` counts as a write)
     nor edit `.claude/settings.json` — only a user `!` command gets out.
   - Acceptance: a session with the gate engaged runs `harness:remove` to completion; a test covers it.

3. **harness:remove deletes .gitignore lines it does not own**
   - Why: it removed `.harness-run/` and `.claude/settings.local.json`, which this repo listed itself.
   - Acceptance: remove only deletes lines inside its own marker; a test with pre-existing lines keeps them.

4. **Goal gate treats any `.mjs` named in Bash as a write**
   - Why: `grep --include="*.mjs"` and read-only `node x.mjs` were denied.
   - Acceptance: read-only commands naming a gated extension pass; a script that writes gated files still denies.

5. **Retire or rename the superpowers duplicates**
   - Why: `agents:dispatching-parallel-agents`, `agents:subagent-driven-development`,
     `completion:verification-before-completion` load beside superpowers skills of the same name.
   - Acceptance: each is retired, renamed, or merged; teams refs (verification-before-completion: 4)
     still resolve; validator passes.

6. **Decide the planning plugin**
   - Why: 2 skills; `roadmap-planning` has 0 inbound refs; `executing-plans` overlaps `write:plans`.
   - Acceptance: plugin kept with a stated boundary, or merged/retired with a restore row in `_repo/deprecated/`.

7. **One home for spec writing**
   - Why: `develop:spec-driven-development` (0 refs) and `write:spec` overlap.
   - Acceptance: one owns spec writing; the other points to it or is retired.

8. **Draw the skill-meta boundary**
   - Why: `write:writing-skills` and `skill:create/audit/quality-assurance/trigger-validator` only cite each other.
   - Acceptance: each has a one-line "not for" naming the others; no two share a trigger.

9. **Rules name the right remote**
   - Why: `maintaining.md` says `skills`; the only remote is `origin`.
   - Acceptance: rules and remote agree.

10. **Section skeleton on skills next edited**
    - Why: 30 skills lack Output Template, 28 Process, 13 Related Skills (teams-mounted excluded).
    - Acceptance: a check script lists them; the count falls each Sprint; no mass rewrite.

11. **Trim skills over 200 lines**
    - Why: target is ~87 (70% of the 124 average); 7 exceed 200 (deck-builder, base-builder,
      roadmap-planning, dispatching-parallel-agents, graph:orchestrate, agent-task-decomposer, teams:orchestrate).
    - Acceptance: each under 200 with detail moved to `references/`; one real run per changed skill.

12. **Clean leftover top-level dirs**
    - Why: ignored `mods/` (only `.claude-plugin/types`) and `_reference/` sit at the top level.
    - Acceptance: `mods/` deleted; `_reference/` kept or moved by decision.

13. **Commit or ignore `.claude/conventions/`**
    - Why: teams install created conventions, but `.gitignore` ignores `.claude/conventions/`.
    - Acceptance: decided and the ignore line matches.
