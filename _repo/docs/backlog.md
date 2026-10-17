# Backlog

How cards get here and how a Sprint pulls them: `.claude/rules/backlog.md`.

Skills sharing a superpowers name are our own rewrites with improved behaviour: improve them,
never retire them as duplicates, and never reference superpowers.

## Ready

### Repo and rules

44. **Wording left behind by the E-e4aa64a3 merges**
    - Why: E-746e822f report (2026-10-17): `skill:trigger-validator` "Applying Changes" still says
      bump; harness SKILL/README keep goal-gate wording P4 changed; `validate_plugins.py` gained 2
      WARNs (description length: `think:back-to-basics` 330, `think:redefine-problem` 328 chars);
      `repo.md` Design-changes step 3 carries the approval-before-`tm_open` clause that belongs above
      the list.
    - Acceptance: validator 0 WARN; the four spots reworded; checks only (wording, per backlog rule).

### teams plugin bugs

45. **Two teams tests fail on main**
    - Why: on main before and after the 2026-10-17 merge: "Claude adapter starts fresh, keeps cwd,
      uses explicit efficient model, and imposes no spending cap" and "S1: the harness driver loads the
      graph and harness plugins" (1242 tests, 2 fail). Cause unverified.
    - Acceptance: `node --test teams/scripts/test-*.mjs` 0 fail.

39. **One unaccepted package must not strand the accepted ones**
    - Why: 2026-10-16 E-e4aa64a3 accepted 7/8 packages and E-59a16f4f 1/4, yet both settled with
      integrate, QA and the goal gate unreachable — nothing merged; the session had to open
      E-746e822f to integrate by hand. Seen causes: (a) P8's gate nodes were denied Bash, found no
      defect, and returned accept:false because `attacks[]` was empty; (b) accept nodes "failed even
      though verdict accept=true" (E-e4aa64a3 P2 try 1, E-59a16f4f P1 try 3 at 87% < threshold 90);
      (c) a pre-existing failing test (stale goal-gate parity) held every harness package under 90.
    - Acceptance: when retries run out on some packages, integrate runs over the accepted ones and
      the report names the rest "not done" (as the budget stop already does); a gate node denied a
      tool reports `blocked: tool denied`, not a reject; a failure that reproduces on the base is
      excluded from a package's score; tests cover all three.

### Mods — detail and polish (design: `_repo/docs/plans/mod/2026-10-16-mod-detail-and-parallel-runs.md`)

Why, in the user's words: "전체적으로 mod가 더 디테일해야할거 같아 일단 있다 그 이상 이하도 아니게보인다"
(2026-10-15); "각 스킬에 특화되도록 사용자 친화적으로!"; "팀즈 하네스 그래프 병렬 실행 시 모드 어떻게
그릴지 고민하기"; "실제 사용 유아이같이 고도로 발달하고 사람이 보기좋게가 가장 중요 정보도 다
표현하고"; "저렇게 디테일하게 mod를 만들고 공을 들이자는거야" (scrothers/statusline as the bar,
2026-10-16). Folds in former cards 27, 29, 31. Each card's acceptance is the design doc §4 card of
the same letter, plus: the three-row band, priority-drop segments, dark/light theme, a `demo` fixture
(`minimal`/`full`/`parallel`/`narrow`), seen live at 190 and 110, README/KOR shot. UI/UX first
(user: "저건 뭘하는지 눈에 캐릭터로 보이잖아 그런 직관적인걸 원하는거야 UIUX를 고려하자고"): a glance,
not a read — each worker's state is one icon and colour (spinner while acting; no character faces, user:
"캐릭터눈 딱히 크게 필요는 없긴 한뎅"), and the user sees the `demo` render before a card is done.

40. **H. harness pane says what the run is doing** — design §4 H. Engine fields (`now.json`,
    `--list`, severity) merged 2026-10-17; the mod is not built. Check first: `fallback-check --list`
    reported stage "critique" while the manifest said plan and setgoal were done (unverified stale read).
41. **T. teams pane shows every STORY at work** — design §4 T (card 28 merged; the page does not
    render `model.harness` yet), plus the design's
    "teams Floor" section: a Floor tab where each worker is a desk whose glyph follows its action, with
    a hand-off feed (user: "pixel-agents 이런 느낌으로 서로 협업하느널 봤으면 좋겠어"); several open
    EPICs listed and switchable (user: "teams 여러개 돌렸을 때 대응 안되어 있는거 같고"); a task with no
    live driver reads stalled, not `IN_PROGRESS` (seen: 9-day-old tasks still IN_PROGRESS).
42. **G. graph pane: own band, owned runs, last step** — design §4 G. Broker fields merged
    2026-10-17; no `runs --list` readout yet; the mod is not built.
43. **S. session memo and guard read as live state** — design §4 S. Card 30 merged (memo toggles,
    Esc/q close); README/KOR still say "read-only Memo pane" and `memo-pane.png` is stale.

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

### Overlaps

14. **planning:roadmap-planning keeps a reason to exist**
    - Why: 0 inbound refs, 241 lines, planning plugin has 2 skills.
    - Acceptance: kept with a stated boundary and under 200 lines, or retired with a restore row in
      `_repo/deprecated/` (check age and direct use first — no refs is not unused).

### Skeleton and length (one card per skill, next edit)

24. **Remaining skeleton gaps** — `node _repo/scripts/check-skeleton.mjs` lists 22 non-frozen skills
    (2026-10-17: Process 11, Output Template 13, Related Skills 4, over 200 lines 3). Acceptance:
    count falls each Sprint; no mass rewrite.

## Frozen (do not pull)

- `teams:orchestrate` (204 lines) and teams skills missing sections (`plan`, `qa`, `document`,
  `develop`) — frozen until teams decides.
- `cognition:critical-thinking-workflow` — teams mounts it.
- `agents:agent-task-decomposer` (210 lines, missing Process / Output Template / Related Skills) —
  teams mounts it; former card 20.

## Sprints

| EPIC | Date | Cards | Result |
|---|---|---|---|
| E-124098e5 | 2026-10-15 | 10–13 | shipped `72f0c818`; size S (one harness pass); goal gate 91; $17.74 |
| E-c313c8f1 | 2026-10-15 | 2 | shipped (rules say `origin`); size S; $3.89 |
| E-e9a37754 | 2026-10-16 | 1 | shipped `03c69989`; size S; $6.81 |
| E-2136f280 | 2026-10-16 | 6 | shipped `d3ddb002`; size S; $5.04 |
| E-e4aa64a3 | 2026-10-16 | 33, 25, 26, 28, 7, 8, 9, 30, 32, 16, 18, 19, 23 | partial (7/8 accepted, nothing merged; card 39); $78.32 |
| E-59a16f4f | 2026-10-16 | 40 H, 42 G | partial (engine fields only); $27.38 |
| E-746e822f | 2026-10-17 | merge of the two above | shipped `5692bb74`; size S; $9.65; all suites at or above baseline |
| E-45422629 | 2026-10-17 | 21, 22 | blocked at QA; the two skills taken from its integration tree by the session (196 / 158 lines; QA test/ junk left out); $27.57 |
| E-4607a6a6 | 2026-10-17 | 39, 45, 44, 40–43 | nothing built: plan-integrate rejected the F5/F6 (graph/teams pane) seam 3 times; $60.57 |
