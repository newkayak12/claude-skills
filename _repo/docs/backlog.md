# Backlog

How cards get here and how a Sprint pulls them: `.claude/rules/backlog.md`.

Skills sharing a superpowers name are our own rewrites with improved behaviour: improve them,
never retire them as duplicates, and never reference superpowers.

## Ready

Priority (user, 2026-10-17): "사용자 UI친화가 우선순위가 높아" — the UI cards below come first.

### Mods and naming — UI first (design: `_repo/docs/plans/mod/2026-10-16-mod-detail-and-parallel-runs.md`)

46. **Tasks, branches and worktrees named in words a person can read**
    - Why: user, 2026-10-17: "backlog harness의 티캣,을 4522629같은거 말고 자연어로 정하면 더 좋을 것
      같음 사람이 알 수 있게", with an Orca sidebar screenshot: worktrees listed as
      `harness/45422629/P2`, `harness/4607a6a6/PLAN-F3`, `harness/e4aa64a3/PLAN-F5` … — nothing says
      what each is, and finished tasks' worktrees and branches pile up (17+ `harness/*` branches seen).
    - Acceptance: an EPIC gets a short readable slug from its request (e.g. `skeleton-gaps-develop`)
      used in the ticket key, branch and worktree names (`teams/skeleton-gaps-develop/P2-memo-pane`);
      old `E-xxxxxxxx` keys still resolve; a finished task's worktrees and merged branches are
      removed (or listed by `tm_clean`); tests cover naming, collisions and old-key lookup.

50. **A failure toast says what failed, why, and what happens next** — built (E-910c1de2, merged by
    hand 2026-10-21, `f8eb7de0`..`3578e337`); open until the person sees the toast demo (`mod.md` rule 0)
    - Why: user, 2026-10-17: "야 토스트 failed 된거 떴는데 뭘 실패했는지 내용을 알 수가 없잖아". The teams
      toast is the event's `text` from `view.mjs --format events`, only `E-6b073e8a critique:2 failed
      (attempt 2)`. The ledger already holds the reason on the `verdict` event of the same node
      (`reason`: "unjudgeable - P2-RUN1 tests portfolio:feedback with input the skill does not
      handle…") and the next step on the following event (`auto_reshape` → shape:3). Most of these are
      the engine correcting itself, so a bare "failed" alarms for nothing.
    - Acceptance: a `node_finish` failed event carries a short reason (from its verdict, ≤1 line,
      cut with `…`) and the next step (`retrying as shape:3`, `retry 2/3`, `needs you`, `gave up`);
      the toast and push show both; a self-correcting retry reads as info, not as failure; the
      same in graph and harness toasts; `view.mjs` test covers the event text.

Mods, in the user's words: "전체적으로 mod가 더 디테일해야할거 같아 일단 있다 그 이상 이하도 아니게보인다"
(2026-10-15); "각 스킬에 특화되도록 사용자 친화적으로!"; "팀즈 하네스 그래프 병렬 실행 시 모드 어떻게
그릴지 고민하기"; "실제 사용 유아이같이 고도로 발달하고 사람이 보기좋게가 가장 중요 정보도 다
표현하고"; "저렇게 디테일하게 mod를 만들고 공을 들이자는거야" (scrothers/statusline as the bar,
2026-10-16). Folds in former cards 27, 29, 31. Each card's acceptance is the design doc §4 card of
the same letter, plus: the three-row band, priority-drop segments, dark/light theme, a `demo` fixture
(`minimal`/`full`/`parallel`/`narrow`), seen live at 190 and 110, README/KOR shot. UI/UX first
(user: "저건 뭘하는지 눈에 캐릭터로 보이잖아 그런 직관적인걸 원하는거야 UIUX를 고려하자고"): a glance,
not a read — each worker's state is one icon and colour (spinner while acting; no character faces, user:
"캐릭터눈 딱히 크게 필요는 없긴 한뎅"), and the user sees the `demo` render before a card is done.
Cards 40–43: E-cec6daae (2026-10-18) stopped in planning; its PRDs and the boundary rulings are
`_repo/docs/plans/mod/2026-10-18-f{1..4}-*-prd.md` and `2026-10-20-f1-f4-boundaries.md` — build from
those, one card per EPIC (43 first; 40 and 41 before 42).

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
43. **S. session memo and guard read as live state** — in E-f40c89a8 — design §4 S. E-6ab58cc6 P3 put the fields in
    (2026-10-17) but the demo reads as a dump (user: "사람이 보기 좋게!"): note and its age on separate
    lists, "21 days old 21d old", guard rows unaligned, no colour by source. Close only after the
    `mod.md` rule 0 polish and the user's look at the demo. Card 30 merged (memo toggles,
    Esc/q close); README/KOR still say "read-only Memo pane" and `memo-pane.png` is stale.

53. **smart-compact holds its threshold inside a long turn**
    - Why: 2026-10-18, building Phantom with the threshold at 40% the context reached ~45%: smart-compact
      checks only on `turn.complete` (reason answer), so one turn of dozens of tool calls (build, test,
      release, install) is never checked until it ends; the recap adds more on top. Cause verified
      (`session/hooks/compact.tsx` turn.complete handler; README "Smart compact").
    - Acceptance: usage is also checked between tool calls; at or over the threshold mid-turn the
      recap + compact runs at the next point compact accepts, before the next answer; a test drives a
      turn that crosses the threshold mid-way; seen once live.
    - Also (2026-10-18, Mac): toast "smart-compact: could not compact, left to auto-compact". The
      compact retry gives up after 20 × 500 ms and its `catch {}` drops the error, so the log says only
      `compact-failed`. Acceptance: the log keeps the last compact error; the retry waits for the turn
      to end (not a fixed 10 s); a test where compact rejects past 10 s still compacts.

49. **Mods put subagent-to-subagent communication to work**
    - Why: user, 2026-10-17: "mod 추가로 subagent 간 의사소통하는거 더 적극적으로 활용할 수 있는 방법
      찾아보자". Today teams workers are separate `claude -p` drivers that hand work over only through
      files (ledger, reports); the session sees none of it live, and workers cannot ask each other.
    - Design approved 2026-10-17: `_repo/docs/plans/mod/2026-10-17-subagent-communication.md` §6
      (user: "Agent 같 메시징 통로를 적극적으로 사용", B now, questions through the TeamLeader, no
      mid-turn nudge, nothing to the person when unattached).
    - Acceptance: spike settles delivery to a `claude -p` session by id mid-turn (report in the
      doc); B: a run's ask reaches the person's band as `⚑ P2 asks you…` within one tick, answered
      through `tm_submit`, works with `modules` removed; C: a STORY's question to the TeamLeader is
      answered or forwarded and recorded as `asked`/`answered` in `ledger.jsonl`, with tests; the
      Floor feed (card 41) shows both.

### Repo and rules

47. **A skill that analyses requirements and splits them**
    - Why: user, 2026-10-17: "요건을 분석하고 분할하는 스킬도 하나 backlog에" (asked first: "요건을
      decompose 하는 스킬 우리 있나?"). Today the job is spread: `write:plans` (tickets),
      `develop:spec-driven-development` (US/AC, then code), `agents:agent-task-decomposer` (agent
      subtasks; teams-mounted, frozen), teams' planning stage (internal).
    - Acceptance: a short design first — extend one of these or a new skill (repo rule: no new skill
      when one can be extended); input a raw requirement or 기획서, output analysed requirements
      (actors, rules, open questions) split into independently deliverable items with acceptance;
      one real run on a sample 기획서.

48. **graph + harness into teams (plan: `_repo/docs/plans/2026-10-17-graph-harness-into-teams.md`)**
    - Why: user, 2026-10-17: "결과적으로 하위호환을 위해서 harness, graph를 두지만 (stable) 장기적인
      방향은 teams"; evaluation by a seeded matrix with repeated runs ("여러 번 돌려보는게 맞을거 같음").
    - Acceptance: the plan's Tasks 1–9 with their pass bars; after UI cards (user priority).

### Subagents and parallel runs — use and clean up (user, 2026-10-17)

51. **Every subagent, driver and worktree started is reaped when its work ends, and a cap holds
    the machine**
    - Why: user, 2026-10-17: "서브에이전트 때문에 컴퓨터 문제가 있었던거 같음 왜 정리를 안하는거임?" —
      "비상이라 지웠고"; "서브에이전트 쓰고 지우는 것에 대한 강화 내용 추가". Seen that day: 6 teams
      EPICs (each a daemon plus up to 3 parallel `claude -p` drivers, each in its own worktree) and 3
      background Agent subagents ran at once; the person had to delete worktrees and branches by hand.
      After that the 5 daemons stayed alive, and every `tm_*` call respawned them, and the respawned
      daemons started new drivers and judges into worktrees that no longer existed (verified: pids
      14809/14868/48191 drivers, 50833 judge). The session took 40+ minutes to stop them.
    - Acceptance:
      - Rules (`maintaining.md` "Agents working in the repo"): a cap on what runs at once across the
        session — teams EPICs plus Agent subagents (number stated); before opening another, count live
        drivers (`ps`) and wait if at the cap; when an agent's result is taken, its worktree and branch
        are removed in the same step; a session ends with `ps` showing no driver, daemon or judge it
        started and `git worktree list` showing only main.
      - teams part shipped 2026-10-18 (E-32e8068c, merged `8e3a7550`): `tm_cancel`, `max_live_drivers`
        (default 4), stop on a gone worktree. Left: the session mod reap line below; the rules part is in.
      - session mod (`agents.tsx` reap): lists live subagents, teams drivers and worktrees with age, and
        reaps the finished ones in one action.

52. **Release the tm_clean fix: record `clean` even when nothing was removed**
    - Why: 2026-10-17, installed teams 0.57.0 records `clean` only when it removed a worktree or
      branch (`taskmanager.mjs:2420`). After the person deleted worktrees by hand, `tm_clean` removed
      nothing, wrote no `clean`, and the push hold never released; the session had to run main's
      `taskmanager.mjs` over stdio. Main already has the fix, unreleased.
    - Acceptance: teams batch bump carries it; `tm_clean` on an already-clean task appends `clean` and
      the push hold releases (test exists on main — confirm it runs in the suite).

### teams plugin bugs

39. **Finish card 39: tool denial in the task manager's own judges, base exclusion before scoring**
    - Why: E-64cda2b0 (merged by hand 2026-10-20, `2c160959`..`ebbe1787`) shipped subset integrate,
      `basefail.mjs` and the adapter's `blocked: tool denied`, but its report leaves: (a) the task
      manager's stream-json judges (accept/gate nodes it runs itself) still read a denial as a reject
      — E-64cda2b0's own P1 failed that way; (b) base exclusion is applied after the judge scored the
      attempt, so it helps only the next attempt. The run itself also stranded P3/P4 — the fix
      landed only after it.
    - Root cause of the gate denials, found 2026-10-21: `claude-exec-adapter.mjs` gave `--verify`
      gates Bash on `--tools` under `--permission-mode dontAsk` with no allow rule, so every Bash call
      was denied (live probe without the shell's `claude` alias). Fixed `eeff7b52`; installed 0.57.0
      hot-patched until the next teams bump.
    - Acceptance: a task-manager judge denied Bash reads `blocked: tool denied` (test); excluded base
      failures are removed from the briefing before the judge scores.

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

### portfolio plugin

54. **portfolio runs one flow on managed material: collect → write → render → feedback**
    - Why: user, 2026-10-18: "포트폴리오 스킬에 매니징 있니? 그니까 글감을 모으고 관리하고 그걸 바탕으로
      내 문제로 쓰고 그걸 deckbuilder로 렌더링하고 다시 그걸 portfolio feedback으로 하고 이런 플로가
      있어야 할거 같은데 글감 관리 못하고 그냥 무작위로 하니까 계속 헛짓거리를 하던데". Today portfolio
      has deck-builder, feedback, fit, rewrite, pattern, interview skills but nothing keeps the material
      (episodes, problems, numbers, evidence) between sessions, and no skill chains the four steps.
    - Acceptance: a design doc first (brainstorm → approval); material is collected and kept in one
      store the later steps read (no re-asking, no random picks); writing draws each problem from that
      store; deck-builder renders it; feedback findings go back onto the material and the loop repeats;
      one user-facing entry, internals hidden (card 34 principle); one real run end to end.
    - Decided (user, 2026-10-18): "내가 준 재료를 바탕으로 글감 모으고 각 글감을 기록하는 형식을 만들자
      포트폴리오 온리니까" — material comes only from what the user hands over; one record format per
      material item; the store belongs to portfolio, not knowledge.
    - Format (user, same day): "글감마다 폴더, 세부 내용마다 md로" — `material/<id>/` per item, one md
      per part (meta, problem, decision, result, learned, gaps, history). Nice to have later: knowledge
      can build over these folders. Order: "글감모으기부터 시작" — collection first.

### Skeleton and length (one card per skill, next edit)

24. **Remaining skeleton gap: harness:harness** — `node _repo/scripts/check-skeleton.mjs` lists 1 non-frozen
    skill (2026-10-17, after merging E-6b073e8a and E-69f230a3: 20 → 1): `harness:harness` missing Output
    Template and Related Skills. Acceptance: 0 skeleton problems; no mass rewrite.

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
| E-95de6173 | 2026-10-17 | 39, 45, 44, 40–43 | stopped in plan (machine overload, worktrees deleted); 6/7 PLAN sections kept on `rescue/95de6173-plan-*`; $37 |
| E-6b073e8a | 2026-10-17 | 24 (develop, portfolio, think, harness) | stopped at QA; integration kept on `rescue/6b073e8a-skeleton`; $19 |
| E-69f230a3 | 2026-10-17 | 24 (knowledge) | stopped at goal gate; integration kept on `rescue/69f230a3-knowledge`; $17 |
| E-2146f402 | 2026-10-17 | 46 | stopped before build (PLAN only); $11 |
| E-041cf197 | 2026-10-17 | 50 | stopped in build; PLAN on `rescue/95de6173-plan-F1` (041cf197's PLAN-F1); $10 |
| E-c2808479 | 2026-10-17 | 14 | shipped `524ecff0`; size S; $6.21 |
| E-32e8068c | 2026-10-18 | 51 (teams), 45 | shipped by hand `8e3a7550` (P1's gate could not re-run tests: card 39); teams suite 1265, 0 fail; $41 |
| E-6ab58cc6 | 2026-10-18 | 40, 43 | running |
