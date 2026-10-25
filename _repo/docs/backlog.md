# Backlog

How cards get here and how a Sprint pulls them: `.claude/rules/backlog.md`.

Skills sharing a superpowers name are our own rewrites with improved behaviour: improve them,
never retire them as duplicates, and never reference superpowers.

## Ready

Priority (user, 2026-10-17): "사용자 UI친화가 우선순위가 높아" — the UI cards below come first.

### Mods and naming — UI first (design: `_repo/docs/plans/mod/2026-10-16-mod-detail-and-parallel-runs.md`)

65. **Flaky tests under load: name them when they recur**
    - Why: card 65 rest shipped 2026-10-22 (E-7e3a46f0: exit-code rule in the teams setgoal prompt,
      `markOf` form and all guidance markers pinned). The one-off failures (teams 1369/1, graph 198/1,
      plugin-test "Loading" 5000 ms) did not reproduce in 3+3 runs (1416/1416, 200/200, 206/206).
    - Recurred 2026-10-23 (E-9f85c789): one "daemon/planning" test failed once under load, then passed
      1471/1471; the report did not name it.
    - Acceptance: the next recurrence names the test and its cause; fixed or marked with that cause.

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
Cards 40–43 and 50 shipped and approved 2026-10-22 (harness, teams, graph, session panes; failure
toasts).

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
    - B merged 2026-10-22 (E-73f703e6; band demo approval and README shot pending): the poll delivers live (`RESULT LIVE-POLL`);
      the send is held by Claude Code, see card 63. C merged 2026-10-22 (E-d1e2fa27 P1-P3, integrated by hand: P2's third attempt failed at plan with
      its retry budget spent; merged tree teams 1474/1474, mod 212/212; a forwarded answer gives one
      `you -> P3` line in the Floor feed). Left: B's band demo approval and README shot; a forwarded
      ask with nobody attached waits forever (decision U-5) — say so in the README; a `tm_open` live pass of C.

### Repo and rules

47. **Split write:plans into requirements, PRD and ADR skills, mounted in teams**
    - Why: user, 2026-10-17: "요건을 분석하고 분할하는 스킬도 하나 backlog에"; 2026-10-25: "write:plan을
      prd, adr, 요구사항 분석으로 나누고 각각 핏하게 해서 teams에 넣고"; approved "진행하자".
    - Design: `_repo/docs/plans/2026-10-25-split-write-plans.md` (all three in `write`).
    - Acceptance: the design doc's done criteria 1-5.

48. **graph + harness into teams (plan: `_repo/docs/plans/2026-10-17-graph-harness-into-teams.md`)**
    - Why: user, 2026-10-17: "결과적으로 하위호환을 위해서 harness, graph를 두지만 (stable) 장기적인
      방향은 teams"; evaluation by a seeded matrix with repeated runs ("여러 번 돌려보는게 맞을거 같음").
    - Acceptance: the plan's Tasks 1–9 with their pass bars; after UI cards (user priority).
    - Tasks 2–4 merged 2026-10-25 (E-c5c109e3): critique rounds with severity, per-run `now` and run
      list order, goal gate and Codex fallback in graph; graph 281/281 (main was 200), goal gate all
      passed. Next: Tasks 5–6, the bench — ask the person about its cost first.

### Subagents and parallel runs — use and clean up (user, 2026-10-17)

### teams plugin bugs

67. **`harness/scripts/test-goal-gate.mjs` fails inside a teams node (HARNESS_NODE=1)**
    - Why: 2026-10-25, E-c5c109e3's integrate gate read "82 ok, 19 failed" on main and on the
      integration tree, failed, and its repair R1 blocked the Sprint; the same script prints `all passed`
      with HARNESS_NODE unset (verified). Every teams integrate in this repo that runs it fails the same way.
    - Acceptance: the test clears HARNESS_NODE for its own child runs (or the gate prompt runs it
      with `env -u HARNESS_NODE`), and `HARNESS_NODE=1 node harness/scripts/test-goal-gate.mjs` prints `all passed`.

### knowledge plugin

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
    - Step 1 shipped 2026-10-21 (`portfolio:material`, `666b7283`): tests 17/17; real run on fictional
      material made 2 items × 7 parts + index, re-run changed nothing. Its six leftovers fixed
      2026-10-22 (id no longer repeats the title, index links folders, a figure citing a document not
      handed over is `근거 없음`, `gaps` counts open questions, `수치 없음` line for no-figure episodes,
      a merged second source is recorded and matches `same`): tests 20/20, real run confirmed each.
    - Step 2 (user, 2026-10-21, with a PRD and session findings from real deck work kept outside the repo —
      real names in them): "이건 portfolio 작업하는건데 스킬로 빼버리고 deck-builder, portfolio-feedback
      등 사용해서 강화하게 하고" — a new `portfolio:manage` skill owns skeleton → deck.mdx, versions
      (snapshot before every edit), evidence order and the user's corrections, a decision gate, a page-
      reference renumber engine (tested, incl. the double-replace regression), the "to align" table; it
      calls `material`, `feedback`/`pattern`/`rewrite` and `deck-builder` (check; build/render only when
      told) to strengthen the deck. Fixtures fictional; no real names or employer data in the repo.
    - Step 2 shipped 2026-10-21 by hand (user: "portfolio는 바로 해줘요", "manage를 하나의 wf로";
      E-6a0c881d cancelled; `.claude/teams-dispatch.json` now allows `portfolio/**`): `portfolio:manage`
      is the one entry; engine tests 9/9; a real run on a fictional workspace swapped two pages with
      every reference right and no hand fix (the first run found four engine bugs, fixed and tested).
      First run on the user's own workspace (2026-10-25, user report): the engine could not read it —
      `## N쪽 ·` headings, a `## 구성` section before the pages, `#` block headings riding with the
      previous page, quoted history lines renumbered, template under `template/`, the README's own
      `## skeleton` table. Fixed in portfolio 2.9.3 (manage 15/15, fictional workspace run: block
      swap, snapshot row by column name). Left for the user's workspace (v4.5.1): `version:` line,
      one `## N` heading per appendix page 22-27; then re-run `verify` there.

### Skeleton and length (one card per skill, next edit)

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
| E-5ad30c36 → E-f169fb8c | 2026-10-18 → 21 | 54 step 1 | P1+P2 accepted; P3 (real run) failed 3× because the run's evidence was deleted before gates could read it; merged by hand `666b7283`, run by hand; $43.7 |
