# Backlog

How cards get here and how a Sprint pulls them: `.claude/rules/backlog.md`.

Skills sharing a superpowers name are our own rewrites with improved behaviour: improve them,
never retire them as duplicates, and never reference superpowers.

## Ready

### Repo and rules

33. **Push hold matches what the rules promise**
    - Why: card 1 (E-e9a37754, 2026-10-16) left gaps: the hold ends at `daemon_done` whatever the
      outcome, while `maintaining.md` says "finished, its report written"; a push from a linked
      worktree is not held; `repo.md` does not say whether plan → critique → approval comes before
      `tm_open` or inside the Sprint.
    - Acceptance: hook and rule say the same thing (a test covers a failed-task case); worktree push
      decided and tested; `repo.md` places the approval step relative to `tm_open`.

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

### teams plugin bugs

25. **Viewer trusts a stale `.view.json`**
    - Why: 2026-10-15 `tm_open` returned `view_url` on port 53388 while nothing listened; the record
      (written 2026-10-07) pointed at a dead viewer, yet `readViewRecord`'s pid-only liveness check
      passed (pid reuse is the likely cause — unverified).
    - Acceptance: `ensureViewer` confirms the port answers before reusing a record, else respawns;
      a test with a live-but-foreign pid and a closed port covers it.

26. **Viewer address a person can read**
    - Why: `http://127.0.0.1:53388/?task=<uuid>` — random port, raw uuid; user asked for it friendlier.
    - Acceptance: a stable, readable address (fixed default port; EPIC key like `E-124098e5` in the
      path instead of the uuid); old uuid links still resolve.

27. **Viewer shows what is running under a task**
    - Why: the view does not say enough about which node, package and driver is working now.
    - Acceptance: for an open EPIC the view shows each running node/STORY, its driver's current
      action (latest `tm_log` line), elapsed time and cost; read-only, from the task files.
    - Also: teams work runs as separate `claude -p` drivers, so the session's agent list shows
      nothing while a task runs; the driving session should see each running driver/subagent
      (a band line or agent-list entry per driver).

28. **A size-S task reads as blocked with nothing moving**
    - Why: E-124098e5 (size S, harness fallback, driver alive) shows `blocked · 0/0`, only `Plan` lit;
      the skipped `areas`/`areas-critique` nodes are read as blocked and the S run's own stages
      (`.harness-run/<slug>/`, `S.stream.jsonl`) are never rendered. The title shows only the first
      backlog item of a multi-item Sprint.
    - Acceptance: an S task with a live driver reads running, its harness stages fill the stage bar,
      and a multi-item backlog title says "N items"; view tests cover it.

29. **Mods show several concurrent runs (harness, teams, graph)**
    - Why: each pane follows one run. harness: the newest live `.harness-run/<run>/` of this
      worktree only (the band counts open runs per stage); teams: the last watched task, else this
      cwd's newest running one; graph: the newest run file. A second run started meanwhile is
      invisible in the pane, and runs in other worktrees (teams L packages) never show.
    - Acceptance: with two runs open, each pane lists both and switches between them by key;
      the band names how many are open; non-mod readouts (`view.mjs --once`, CLIs) list both too;
      `claude plugin test .` passes for each plugin; seen live at 190 and 110 columns.

30. **session Memo pane cannot be closed**
    - Why: `/memo` always calls `$.ui.open` (session/hooks/memo.tsx), so a second `/memo` reopens
      instead of closing, and the pane handles neither Esc nor q — breaks mod rule "closes on Esc,
      q and the command again" (`.claude/rules/mod.md`). teams' pane already toggles (`$.ui.close`).
    - Acceptance: `/memo` toggles; Esc and q close it; a pane test covers all three; seen live.

31. **Mods say what is happening, not just that something is**
    - Why: user, 2026-10-15: "전체적으로 mod가 더 디테일해야할거 같아 일단 있다 그 이상 이하도 아니게보인다".
      Seen today: the harness pane showed a run but not that its critique had rejected the spec
      (4 major findings) and SetGoal was rewriting it; the teams pane read `blocked · 0/0` on a live run.
    - Acceptance: a design doc in `_repo/docs/plans/mod/` first (brainstorm → approval), naming per
      mod (harness, teams, graph, session) what a person must read at a glance — current stage and
      what it is doing now (latest driver action), last verdict and its top finding, progress
      (subgoals/STORYs done of total), elapsed and cost, what happens next / what waits on you.
      Then one card per mod. Folds in 27, 28, 29 where they overlap.
    - Principle (user, same day): "각 스킬에 특화되도록 사용자 친화적으로!" — each mod speaks its own
      skill's language (harness: plan/critique/subgoals; teams: EPIC/STORY/cards; graph: nodes;
      session: memo/guards), not one generic status layout; plain words over engine field names.

### knowledge plugin

33. **knowledge builds a second brain, not only a vault**
    - Why: user, 2026-10-16: "knowledge가 저거랑 비슷할거고 그 활용이 vault, noah지" — reference
      https://github.com/coleam00/second-brain-starter. Its pieces knowledge lacks today: a memory
      layer (persona/soul, user profile, decisions·lessons, daily log), session hooks (SessionStart
      loads memory, PreCompact/SessionEnd capture decisions), hybrid keyword+vector memory search,
      a proactive heartbeat. vault and noah are hand-built instances of it.
    - Acceptance: a design doc in `_repo/docs/plans/` first (brainstorm → approval) mapping each
      reference piece to a knowledge skill (extend, not a new plugin); vault and noah could be
      rebuilt from knowledge skills; nothing of vault or noah's content in this repo.

### Sprint process

32. **Sprint verification sized to the change**
    - Why: E-124098e5 spent $17.74 / 33 turns on four SKILL.md edits; its goal-spec was 65 KB and
      the first critique rejected it (4 major). "One real run" per card drove most of that.
    - Acceptance: the backlog rule says when a card needs a real run (behaviour change) and when
      checks suffice (skeleton/wording); the next skeleton Sprint costs a fraction of this one.

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

## Sprints

| EPIC | Date | Cards | Result |
|---|---|---|---|
| E-124098e5 | 2026-10-15 | 10–13 | shipped `72f0c818`; size S (one harness pass); goal gate 91; $17.74 |
| E-c313c8f1 | 2026-10-15 | 2 | shipped (rules say `origin`); size S; $3.89 |
