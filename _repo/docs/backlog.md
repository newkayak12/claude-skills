# Backlog

One session is one Sprint: take cards from the top into `tm_open({requests})` (array order =
priority), pass `context_from` the prior Sprint, and at close delete shipped cards and put
`carryover_candidates` back on top. Each card: title, why, acceptance.

Skills sharing a superpowers name are our own rewrites with improved behaviour: improve them,
never retire them as duplicates, and never reference superpowers.

## Ready

### Repo and rules

1. **Rules follow teams, not the removed harness gate**
   - Why: harness governance was removed (2026-10-15); `repo.md`, `maintaining.md` and
     `.claude/hooks/repo-rules.mjs` still speak of the goal gate, harness runs and `05-report.md`.
   - Acceptance: no rule names the goal gate or `.claude/harness-gate.json`; the change loop reads
     backlog → Sprint → report; repo-rules' push hold keys on open teams tasks or is removed;
     `node _repo/scripts/test-repo-rules.mjs` passes.

2. **Rules name the right remote**
   - Why: `maintaining.md` says `skills`; the only remote is `origin`.
   - Acceptance: rules and `git remote -v` agree.

3. **Maintenance vault is reachable or the rule says where it is**
   - Why: `maintaining.md` points to `../claude-skills-knowledge`; nothing is there on this machine.
   - Acceptance: the vault path in the rules exists, or the rule names how to get it.

4. **Commit or ignore `.claude/conventions/`**
   - Why: teams install created conventions, but `.gitignore` ignores `.claude/conventions/`.
   - Acceptance: decided; the ignore line matches the decision.

5. **Clean leftover top-level dirs**
   - Why: ignored `mods/` (only `.claude-plugin/types`) and `_reference/` sit at the top level.
   - Acceptance: `mods/` deleted; `_reference/` kept or moved by decision.

6. **Skeleton check script**
   - Why: no check lists skills missing Process / Output Template / What Claude Does / Related Skills
     or over 200 lines; today's counts (30 / 28 / 13; 7 over 200) were measured by hand.
   - Acceptance: `_repo/scripts/` gains a report-only check (not a CI failure); teams-mounted
     skills listed separately as frozen.

### harness plugin bugs

7. **harness:remove deadlocks under its own gate**
   - Why: with the gate on, Claude cannot run `remove.mjs` (Bash naming a `.mjs` counts as a write)
     nor edit `.claude/settings.json` — only a user `!` command gets out.
   - Acceptance: a session with the gate engaged runs `harness:remove` to completion; a test covers it.

8. **harness:remove deletes .gitignore lines it does not own**
   - Why: it removed `.harness-run/` and `.claude/settings.local.json`, which this repo listed itself.
   - Acceptance: remove only deletes lines inside its own marker; a test with pre-existing lines keeps them.

9. **Goal gate treats any `.mjs` named in Bash as a write**
   - Why: `grep --include="*.mjs"` and read-only `node x.mjs` were denied.
   - Acceptance: read-only commands naming a gated extension pass; a script that writes gated files still denies.

### Our rewrites of superpowers-named skills

10. **agents:dispatching-parallel-agents to the skeleton**
    - Why: missing all four sections; 219 lines.
    - Acceptance: four sections in order; under 200 lines, detail in `references/`; one real run.

11. **agents:subagent-driven-development to the skeleton**
    - Why: missing Process and Output Template; 189 lines.
    - Acceptance: four sections in order; one real run.

12. **completion:verification-before-completion to the skeleton**
    - Why: missing all four sections; teams cites it in 4 places.
    - Acceptance: four sections in order; every teams reference still resolves; one real run.

13. **planning:executing-plans to the skeleton and a boundary with write:plans**
    - Why: missing all four sections; `write:plans` writes the plan, this one runs it — not said in either.
    - Acceptance: four sections; each skill's description names the other in a "not for".

### Overlaps

14. **planning:roadmap-planning keeps a reason to exist**
    - Why: 0 inbound refs, 241 lines, planning plugin has 2 skills.
    - Acceptance: kept with a stated boundary and under 200 lines, or retired with a restore row in
      `_repo/deprecated/` (check age and direct use first — no refs is not unused).

15. **One home for spec writing**
    - Why: `develop:spec-driven-development` (0 refs) and `write:spec` overlap.
    - Acceptance: one owns spec writing; the other's description points to it or it is retired.

16. **Skill-meta boundary**
    - Why: `write:writing-skills` and `skill:create/audit/quality-assurance/trigger-validator` cite only
      each other; `quality-assurance` and `trigger-validator` lack Process and Output Template.
    - Acceptance: each has a "not for" naming its neighbours; no two share a trigger phrase; both
      missing skeletons filled.

17. **think:devils-advocate vs cognition overlap**
    - Why: overlaps `cognition:critical-thinking-workflow` (teams mounts the latter — frozen).
    - Acceptance: devils-advocate's description says what it is not, pointing to the workflow; workflow untouched.

18. **think:redefine-problem vs think:back-to-basics**
    - Why: both answer "the approach feels wrong"; redefine-problem also lacks Process and Output Template.
    - Acceptance: distinct triggers; redefine-problem gets its skeleton.

### Skeleton and length (one card per skill, next edit)

19. **graph:install** — missing all four sections. Acceptance: four sections.
20. **agents:agent-task-decomposer** — missing all four sections; 210 lines. Acceptance: four sections, under 200.
21. **portfolio:deck-builder** — 249 lines. Acceptance: under 200, detail in `references/`, one real run.
22. **knowledge:base-builder** — 247 lines. Acceptance: under 200, detail in `references/`, one real run.
23. **graph:orchestrate** — 212 lines, no Process. Acceptance: Process section, under 200.
24. **Remaining skeleton gaps** — whatever card 6's check lists after cards 10–23, excluding
    teams-mounted skills. Acceptance: count falls each Sprint; no mass rewrite.

## Frozen (do not pull)

- `teams:orchestrate` (204 lines) and teams skills missing sections (`plan`, `qa`, `document`,
  `develop`) — frozen until teams decides.
- `cognition:critical-thinking-workflow` — teams mounts it.
