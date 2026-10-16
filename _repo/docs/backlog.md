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

28. **A size-S task reads as blocked with nothing moving**
    - Why: E-124098e5 (size S, harness fallback, driver alive) shows `blocked · 0/0`, only `Plan` lit;
      the skipped `areas`/`areas-critique` nodes are read as blocked and the S run's own stages
      (`.harness-run/<slug>/`, `S.stream.jsonl`) are never rendered. The title shows only the first
      backlog item of a multi-item Sprint.
    - Acceptance: an S task with a live driver reads running, its harness stages fill the stage bar,
      and a multi-item backlog title says "N items"; view tests cover it.

30. **session Memo pane cannot be closed**
    - Why: `/memo` always calls `$.ui.open` (session/hooks/memo.tsx), so a second `/memo` reopens
      instead of closing, and the pane handles neither Esc nor q — breaks mod rule "closes on Esc,
      q and the command again" (`.claude/rules/mod.md`). teams' pane already toggles (`$.ui.close`).
    - Acceptance: `/memo` toggles; Esc and q close it; a pane test covers all three; seen live.

### Mods — detail and polish (design: `_repo/docs/plans/mod/2026-10-16-mod-detail-and-parallel-runs.md`)

Why, in the user's words: "전체적으로 mod가 더 디테일해야할거 같아 일단 있다 그 이상 이하도 아니게보인다"
(2026-10-15); "각 스킬에 특화되도록 사용자 친화적으로!"; "팀즈 하네스 그래프 병렬 실행 시 모드 어떻게
그릴지 고민하기"; "실제 사용 유아이같이 고도로 발달하고 사람이 보기좋게가 가장 중요 정보도 다
표현하고"; "저렇게 디테일하게 mod를 만들고 공을 들이자는거야" (scrothers/statusline as the bar,
2026-10-16). Folds in former cards 27, 29, 31. Each card's acceptance is the design doc §4 card of
the same letter, plus: the three-row band, priority-drop segments, dark/light theme, a `demo` fixture
(`minimal`/`full`/`parallel`/`narrow`), seen live at 190 and 110, README/KOR shot.

34. **H. harness pane says what the run is doing** — design §4 H.
35. **T. teams pane shows every STORY at work** — design §4 T (after card 28).
36. **G. graph pane: own band, owned runs, last step** — design §4 G.
37. **S. session memo and guard read as live state** — design §4 S (after card 30).

### knowledge plugin

34. **knowledge builds a second brain, not only a vault**
    - Why: user, 2026-10-16: "knowledge가 저거랑 비슷할거고 그 활용이 vault, noah지" — reference
      https://github.com/coleam00/second-brain-starter. Its pieces knowledge lacks today: a memory
      layer (persona/soul, user profile, decisions·lessons, daily log), session hooks (SessionStart
      loads memory, PreCompact/SessionEnd capture decisions), hybrid keyword+vector memory search,
      a proactive heartbeat. vault and noah are hand-built instances of it.
    - Acceptance: a design doc in `_repo/docs/plans/` first (brainstorm → approval) mapping each
      reference piece to a knowledge skill (extend, not a new plugin); vault and noah could be
      rebuilt from knowledge skills; nothing of vault or noah's content in this repo.
    - Principle (user, same day): "외부에 노출되는 스킬을 줄이고 내부적으로 진행하면 좋을 듯" — few
      user-facing entry skills; the builders run inside them, not as separate triggers.
      The user must be able to use it easily without knowing the internals (user: "사용자는 내부를
      모르고 편하게 써야만한다") — no internal skill, stage or file name is something they must know or say.

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

16. **Skill-meta boundary**
    - Why: `write:writing-skills` and `skill:create/audit/quality-assurance/trigger-validator` cite only
      each other; `quality-assurance` and `trigger-validator` lack Process and Output Template.
    - Acceptance: each has a "not for" naming its neighbours; no two share a trigger phrase; both
      missing skeletons filled.

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
