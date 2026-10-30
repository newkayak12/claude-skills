# Backlog

How cards get here and how a Sprint pulls them: `.claude/rules/backlog.md`.

Skills sharing a superpowers name are our own rewrites with improved behaviour: improve them,
never retire them as duplicates, and never reference superpowers.

## Ready

Priority (user, 2026-10-17): "사용자 UI친화가 우선순위가 높아" — the UI cards below come first.
Card 101 comes before them (user, 2026-10-29: "최우선").
The portfolio flow comes before everything (user, 2026-10-30: "전체적으로 계획 한거 백로그로 넣고
우선순위 최상으로 두고 해주세요"): 102, then 103, then 54 (A → C → B, user 2026-10-29: "네네 하시져").
Card 103 (portfolio engine bugs) shipped and closed 2026-10-30 by hand: renumber fences, `쪽`-cell
double replace, collision refusal, write only after verify; material items in `sources/material/`;
untouched chart warnings in check and build (manage 33/33, material 24/24, test_deck 226 ok).
Card 54's flow shipped 2026-10-30 by hand (see the card); then 104. Portfolio is urgent (user,
2026-10-30: "portfolio urgent로"): its cards go before every other card, 101 included.

### portfolio flow — first (design: `_repo/docs/plans/2026-10-30-portfolio-flow.md`)

102. **portfolio checks the deck's claims against the material in an engine, both ways**
    - Why: debate 2026-10-29 (10 personas + noah), verified in code: material marks `근거 없음` /
      `user-stated` (material/SKILL.md:49, parts.md:31-32) but manage's skeleton step only says "each
      claim citing its material item" (manage/SKILL.md:65-67); `verify` checks only heading order and
      page refs (manage.mjs:249-259); feedback counts "30분 → 4분" as a complete claim by shape alone
      (claim-and-consistency.md:66-67); 9b compares scores only (manage.mjs:262-269); the decision
      gate and "plausible cause → `[확인 필요]`" are prose only (manage/SKILL.md:76-80, principles.md).
      The user's own rejections in real deck work: sentences giving a reason or solution they never
      said ("얘기한 적이 없어"), judgment lines with no ground ("왜?!"), AI tone; and the other way,
      real work left out because it had no document ("기록을 안 남긴 것뿐").
    - Acceptance: an engine check (node, tested) over skeleton/deck.mdx and `material/`:
      1. every claim line names a material id; a number not in that item, or marked `근거 없음`, fails;
      2. a third state `본인 확인(기록 없음)` passes and is listed, never dropped as unsupported;
      3. a reason/cause/solution sentence with no source in the item is listed `[확인 필요]`;
      4. the reverse list: results in included material items that no page carries;
      5. 9b `compare` reports a claim that lost its ground as worse, whatever the score;
      6. a narrow tone check (AI-tone phrases and judgment lines not in the material), not a full rewrite;
      7. structure decisions in `확정사실.md` (blocks never mixed, a writing basis such as "write the
         in-progress chapter as if done") are not re-raised by feedback or drift checks.
      Fictional fixtures only; manage tests with counts; one real run on a fictional workspace.
    - Shipped 2026-10-30 by hand (`manage claims`, `compare --claims-before/--claims-after`, material
      label `본인 확인`): manage 29/29, material 23/23; real CLI run on a fictional workspace copy found
      the `근거 없음` figure, the reason the item does not give, and the item no page cites. deck.mdx
      checked too since 2026-10-30 (`claims --file deck.mdx`, cites in the slide comment; manage 37/37;
      real CLI run caught the `근거 없음` figure on slide 2). Left: a feedback finding against a
      `settled` line is dropped by the SKILL step, not by the engine; reason grounding is a word-stem
      share (≥ half), a heuristic.

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
    - Step 2 shipped 2026-10-21 (`portfolio:manage`, the one entry; history in git) and fixed for the
      user's own workspace in portfolio 2.9.3 (manage 15/15). Left for the user's workspace (v4.5.1):
      `version:` line, one `## N` heading per appendix page 22-27; then re-run `verify` there.
    - Flow (user, 2026-10-30, design doc above): "1. 글감 수집 2. 글감 정리(뭘 쓰고 안쓰고 각 글감의
      대표를 뭘로 잡을거고) 3. 초안 작성(skeleton) 4. 퇴고(다양한 시점에서 퇴고 진행) 5. template분석
      (palette, style …) 6. deck으로 작성(세부 스타일 조정) 7. 렌더(pptx + pdf: 검토, 재렌더) 8. 피드백
      진행". Missing today and added here:
      - step 2 `select`: `sources/선정.md` (글감 · 쓰임 본문/부록/제외 · 쪽 · 이유 · 대표), material
        status `raw → selected | excluded`; exclusions live only there, not in `확정사실.md`; draft reads
        only selected items;
      - step 4: viewpoints in order (recruiter 6초 → engineer 30초 → interviewer attack via
        `mock-interview` → the user's bar via noah), each a numbered edit list;
      - step 5: `template/분석.md` from catalog's Palette/Type/Voice plus style rules; `write:diagram`
        figures take its colours;
      - step 7: PNG previews under `build/preview/`, `build/검토.md` per page (쪽 · 본 것 · 문제 →
        다음렌더-지침); a re-render applies every 지침 row first;
      - step 8: `feedback` on the rendered PDF saved to `snapshot/feedback/deck-vX.Y.Z.md`; an
        indefensible claim goes onto its item's `gaps`, a restored real result onto the item as
        `본인 확인(기록 없음)`; the next round starts at 2 or 4. Kept small (no three-level follow-up
        tree: "과한데?"). feedback proposes no cut or merge without a ground ("왜 줄여야 하는거야?") and
        cites no market generalities ("과장하지마");
      - `layout` lists the new files as missing (created on request); manage's Process renumbered 1–8.
      First-page numbers (V1, user 2026-10-29): the summary line need not carry a number; measured
      numbers sit in the evidence lines; small-scale numbers are dropped; feedback stops counting a
      number-free first line as a defect.
    - Flow shipped 2026-10-30 by hand: manage Process is the eight steps; `scaffold`, `selection`,
      `keep-render` (previews live in `build/pages/`, regenerated per build, so they are kept under
      `snapshot/render/deck-vX.Y.Z/` with `검토.md`, not `build/`), claims reads `선정.md`
      (`excluded`, `unselected`); material statuses `selected`/`excluded`; feedback: no cut without a
      ground, no market generalities, no number required on a deck's first line. manage 36/36,
      material 24/24; real CLI run on a fictional scratch workspace (scaffold → material init and
      `selected` → selection → keep-render). Left: one run end to end on the user's own workspace
      (v4.5.1 `version:` line and appendix headings first, as above); viewpoints, template analysis
      and deck feedback are SKILL steps, run by the model, not engine checks.

104. **portfolio writes a resume from the built deck and its sources: a Word template, docx, then pdf**
    - Why: user, 2026-10-30: "deck build 된거 기준으로 source랑 같이 resume로 가는 것도 만들면 좋을 듯
      똑같이 template 바탕으로 word 형식으로 쓰고 pdf로 내보내는". Today the deck flow ends at
      deck.pptx/pdf; a resume is written apart, from scratch, with no tie to the deck's settled
      claims or the material.
    - Decided (user, 2026-10-30: "manage 네"): a `manage` step 9, not a separate skill; it reuses the
      material, `선정.md` and `claims`.
    - Acceptance: a design note first (brainstorm → approval: what the
      resume carries from the deck vs from `sources/`); the user's own `.docx` template is the base,
      as `template.pptx` is for the deck (catalog its styles, never a built-in look); every resume
      claim cites its material item and passes the same `claims` check (`선정.md` decides what goes
      in); `resume.docx` written into `build/`, exported to `resume.pdf` (LibreOffice, as `render`);
      the resume conventions in `feedback/references/resume-conventions.md` checked; tests with
      counts on a fictional template and workspace; one real run end to end.
    - Shipped 2026-10-30 by hand (design `_repo/docs/plans/2026-10-30-portfolio-resume.md`, approved
      "확인"): `scripts/resume.py` catalog / build / render (deck-builder's renderer), `claims --file
      resume.md`; test_resume 17/17 with the PDF rendered in docker (deck-render-kr), manage 38/38.
      User, same day: "docx를 올리면 안된다고", "내가 준 실제 자료를 올리면 안된다고", "pptx도 이전에
      준거 올리지 말라구" — `.gitignore` takes `*.docx`, `*.pptx`, `*.pdf`; resume.py refuses a template,
      resume.md or output a git repository would carry (tested); no real material was ever in the repo
      (history checked: the one tracked `template.pptx` is an empty fixture). Defaults taken: 2 pages,
      Korean only. User, same day: "like-me 쓰고 똑같이" — skeleton, deck.mdx and resume.md lines all go
      through `write:like-me` (`78da36b3`, SKILL only). Left: the user's own template, two texts they
      wrote alone, and one real run on their workspace; the
      resume-conventions check is the model's (feedback), not an engine check.

### teams parallelism — first

106. **teams view `--once` reads only open tasks, not every task ever run**
    - Why: 2026-10-30, the machine (12 cores) was saturated: view.mjs ~540% CPU. Verified: one
      `view.mjs --once --format status --cwd <repo>` takes 7.8 s wall / 6.1 s CPU, because
      `runningModels` (`teams/scripts/view.mjs` L102) runs `collectTask` on every one of the 2098 dirs
      in `~/.harness/tasks` (239 MB, never pruned) before filtering on state and cwd; `floorTasks`
      does the same walk. 22 open sessions' status lines and panes spawn ~30 of these every 20 s, so the
      cost grows with every task ever run. Also seen: 43 detached `--tasks-dir` viewers (ppid 1, up to
      38 days old, ~2.6 GB RSS, idle CPU), all from teams 0.60.x or the repo copy before `21a52358`
      (card 83's idle exit) — none from 0.61.x, so the leak is fixed and only the old processes remain.
    - Acceptance: `--once --format status|events|summary` reads `task.json` state and cwd first and
      builds a model only for a matching open task (or keeps an index of open tasks); on a fixture
      tasks dir with 2000 finished tasks one call stays under 0.3 s (tested); a status-line poll does
      not start a new process while the previous one still runs.

101. **teams runs ready packages at the width shape allows — rest: the first tick, and one real Sprint at width 2+**
    - Why: user, 2026-10-29: "harness, graph, teams 각 phase를 병렬로 할 수는 없는건가?", then "네네 그리고
      최우선". Shipped in teams 0.61.5 (`e4502d68`, E-ea14c9c4): pushback only from error-shaped events
      (`allowed_warning` and a leading BOM handled), start width from the shape, `auto_parallel_ticks` in
      tm_status, `parallel_width_changed` on a width or `ready_waiting` change; teams 1660/1660.
      Left: QA's D9/D14/D15 also asked that the first tick write an event when packages already wait
      (`recordAutoParallelTick` writes nothing without a previous tick) — not taken. E-ea14c9c4 itself ran
      on the 0.61.4 engine: it halved 2→1 at `dispatch:P1:1` (a judge reason text matched) and never ran
      two dispatches at once.
    - Acceptance: the first tick with `ready_waiting > 0` writes one `parallel_width_changed` (tested);
      one real Sprint on teams 0.61.5+ shows two ready packages running at once (ledger: two `dispatch`
      open together, no `auto_parallel_decreased` from a usage number or a reason text).

105. **teams QA files one defect once, and integrate takes overlapping fixes instead of blocking**
    - Why: E-ea14c9c4, 2026-10-30: QA-F1 filed 15 defects for 4 findings (docs D4/D6/D8/D11, ready_waiting
      D5/D7/D9/D12/D14/D15, release D10 = P2); every one was built and accepted (~$61 for the Sprint),
      then `integrate:3` stopped `blocked` on a conflict between the docs duplicates. Taken by hand:
      P1, D1–D5, D13 and P2; the duplicates dropped. Cause unverified (0.61.3 says "a defect is filed
      once per QA filing"; these came from one `defects_filed` event).
    - Acceptance: a QA filing whose findings name the same file and AC files one defect (test with the
      E-ea14c9c4 titles); integrate drops a package whose diff is already in the integration tree, or
      settles one conflict as a repair package instead of `blocked`; tested.

### Mods and naming — UI first (design: `_repo/docs/plans/mod/2026-10-16-mod-detail-and-parallel-runs.md`)

93. **teams web viewer gets a Town tab: an isometric pixel office where each node works as a character**
    - Why: user, 2026-10-28: "https://github.com/rafapetter/agent-town 이거 느낌 UI로 visualiazation",
      "teams에 할 수 있지 않아?", and a reference image (isometric pixel office: people at desks with CRT
      monitors, coffee bar, speech bubbles `</>!`, `λ→`, 💡) — "teams에 이런 느낌으로". agent-town: one
      `<canvas>`, procedural pixel art (no sprite sheets), integer zoom with smoothing off, rAF loop, BFS
      walking between rooms, speech bubbles. Supersedes for this view the 2026-10-26 "캐릭터를 그리라는 소리는
      아냐" (that was the mod pane; the user asks for characters here).
    - Where: the `view.mjs` server page (`view_url`), a Town tab beside the existing views; data from the
      same `/state.json`. The terminal pane stays Ink (no pixels in a terminal); the Remote Control app is not a
      mod surface (card 74), so no pane there.
    - Acceptance: isometric floor with one desk zone per stage (Plan, Build, Integrate, QA, Gate, Report) and
      a coffee corner for idle; each live node (size/shape/critique, PLAN-Fn, Pn, QA, AUDIT, judge) is a
      procedurally coloured pixel character that walks to its stage's desk when it starts, types while running,
      shows a bubble with what it does (`</>` build, `λ→` plan, 🔍 QA, ⚖ judge), ✔/✘ on accept/reject, 💤 when
      stalled, and leaves when done; crisp at any size (integer zoom); no runtime dependency, no external image;
      a node-side test of the scene model (who sits where from a state.json fixture) and one live look with a
      screenshot of a real running task. Quality bar: the reference image — not boxes with names.
    - Parked 2026-10-28, user: "아..애매하다 안되지", "애매하다 skill 레벨로 하기에는 너무 애매하네". The reference
      quality needs drawn sprite assets (procedural canvas gives agent-town level, not the image); not pulled
      until the person decides where the art comes from.

94. **teams-status shows the numbers that explain a run: attempts and judge scores, cost and time, stalls, quality**
    - Why: user, 2026-10-28: "teams-status 조금 더 의미있는 지표 노출해서 개선해야겠더라". In E-8b9c417d the
      pane showed P2 "failed" three times; why (judge 88/90, "belongs to P3") was only in the ledger.
    - Acceptance (computed in node, `view-summary.mjs`; the mod renders it): per STORY attempt n/max, last judge
      score vs threshold and its one-line reason; cost and wall time per STORY and stage, retry spend apart,
      spend vs budget when set; stalled drivers (minutes since progress), live drivers vs cap, tool denials,
      nodes out of retries; QA defects filed vs dropped (card 88), test count baseline → now, out-of-scope
      writes. Each shows on the Home/STORYs tabs at 190 and 110 columns without wrapping; tests in
      `test-view-summary.mjs`; one live look approved by the user.
    - Shipped `110de5ff` (E-692f3092, 2026-10-28; teams 1610/1610, plugin test 381/381). Live look on E-fa72c6e8
      (pane 86 cols) found three defects, not yet approved: (1) STORYs title cut to ~10 chars plus a stray
      "->…", reason cut to 3 chars ("Eve…"); (2) a story re-run after `tm_retry` repackage reads "rejected 3/3"
      on STORYs while Home lists it "In progress"; (3) "judge 93 vs 90" with "rejected" and no visible why.

84. **The teams pane is a real dashboard on every surface: Ink on the terminal, Svg on desktop, mobile and vscode** — both terminal defects fixed `7e051a4b` (E-8b9c417d; live look 2026-10-28: Plan ✔, no digits after 2 1 0); left: phone/desktop look
    - Why: user, 2026-10-26, after `/teams-status` over Remote Control showed a 42-row text dump on the phone:
      "이따위로 나올거면 뭣하러 하냐", "Claude desktop app에서 UI 그릴 수 있는걸로 아는데", "mobile도 그렇고",
      "씨발 못해? terminal도, claude app, desktop도". References given: a Grafana-style metrics board
      (tiles + time series), a harness diagram (stages as columns of cards), a terminal agent dashboard
      (EPIC tabs with %, agent tree with timers, task list, session stats, activity log, approval prompt),
      github.com/HarnessMD/munder-difflin (agents as live avatars, envelopes between them, kanban command
      center), revfactory.github.io/harness-animation (numbered stage pipeline, fan-out/fan-in, polished
      cards). Mod API 2.1.310: `desktop`, `mobile`, `vscode` carry `Svg`; terminal carries `Raster`/`Image`/`Client`.
      Prerequisite: the app must attach as a surface (`session.attach`); it did not over Remote Control (card 74).
      User, same day: "캐릭터를 그리라는 소리는 아냐 무조건 내가 준것같은 퀄리티 높은 UI를 제공하란거야 기본으로" —
      no avatars; the references' quality is the default bar for every mod UI, not an option.
    - Acceptance: a design doc with the demo render approved by the user first (`mod.md` UI rule 0);
      terminal pane = EPIC tabs, node pipeline with state and timers, STORY kanban, stats (cost, budget,
      drivers), activity log, waiting-ask line; desktop/mobile/vscode = the same data as an Svg pipeline
      (fan-out packages, fan-in integrate) with metric tiles; every field from node (`view.mjs`/engine), none
      inferred in tsx; seen live on terminal and in the app (phone screenshot), 190/110 columns, README shots.
    - Done 2026-10-26 (teams 0.61.0): Home tab first (key `0`); terminal Ink board seen live in tmux at 190
      and 110 columns (narrow pane lists tiles and lanes one per line); Svg board for desktop/mobile/vscode,
      mounted in tests and rendered in Chromium; README shots `pane-home.png`, `pane-home-app.png`; EPIC
      titled by its backlog cards. Seen live 2026-10-27 (E-398db286 in Build, both PRDs, plan-integrate,
      shape and critique done): stage 1 Plan still shows ◉ running and the bar 0%, "0/6 stages" — the
      Plan stage is not marked done once Build starts. Cause verified: a retried manager node leaves its
      first attempt `skipped` (`shape`, `critique` beside done `shape:2`, `critique:2`), and `nodeState`
      (`teams/scripts/lib/view-stages.mjs`) maps `skipped` to pending, so `stagesOf` (view-summary.mjs)
      merges Plan to running; a superseded attempt must not count. Same look, 08:17: the STORYs tab lists
      only P2 (`rejected 3/3`), not P1 which passed; a digit pressed to switch tabs is also echoed in the
      footer input (`1 ⏎ submit`, `12 ⏎ submit`). Causes unverified.
      Terminal render approved 2026-10-27 on the live shots (Home, Floor, STORYs), user: "훨깔끔 좋아". Left: no design doc; the Svg not yet seen in the Claude desktop app (this
      machine has none); the phone gets text only until the app attaches (card 74); demo approval by the user.

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
      `you -> P3` line in the Floor feed). B's band demo approved by Claude on delegation 2026-10-26 (fixture render at 190/110: `⚑ P2 asks you: … +1`, title ends in `…`). Left: B's README shot from a live ask; a `tm_open` live pass of C (U-5 already in README/KOR).
    - User, 2026-10-30: "mod 서브에이전트 통신 네" — go ahead with what is left. Town (93) is still being
      thought over ("Town고민 중"); 48 waits ("나머지 대기").

### Repo and rules

48. **graph + harness into teams (plan: `_repo/docs/plans/2026-10-17-graph-harness-into-teams.md`)**
    - Why: user, 2026-10-17: "결과적으로 하위호환을 위해서 harness, graph를 두지만 (stable) 장기적인
      방향은 teams"; evaluation by a seeded matrix with repeated runs ("여러 번 돌려보는게 맞을거 같음").
    - Acceptance: the plan's Tasks 1–9 with their pass bars; after UI cards (user priority).
    - Tasks 2–4 merged 2026-10-25 (E-c5c109e3): critique rounds with severity, per-run `now` and run
      list order, goal gate and Codex fallback in graph; graph 281/281 (main was 200), goal gate all
      passed. Tasks 5–6 (axes, problems, arm, one-problem dry run) — E-53b9426b (user, 2026-10-25:
      "하자하자") shipped nothing: plan-integrate failed 3× on F1/F2 contradictions (slug `denied` vs
      `denied-blocked`, cases.tsv status column, median-of-runs vs per-problem win count, `limit_hit`);
      $17.21. Next: Task 5 alone as size S, then Task 6's arm and dry run; the full 3× matrix from the
      session under the driver cap. Minimum effect sizes still placeholders (1 of 3 problems for axes 1-6,
      1 field for 7-8, 20% for 9) — the run takes them as defaults and the report names them.
    - Task 6 first half shipped (eac1f097, E-27be4005): graph-harness/graph-base arms, ghscore.mjs,
      authors pinned to sonnet. Full 162-run matrix started 2026-10-26 08:52Z; a real run costs
      ~$1.5 and ~6 min per arm (dry run was $0.36), so the matrix is ~$240 and ~16 h.

### Subagents and parallel runs — use and clean up (user, 2026-10-17)

### teams plugin bugs

87. **A paraphrased document criterion still gets into user stories** (rest of card 87)
    - Why: `stripDocumentAcceptance` (eb3a1c49) drops only an exact-text match. The real L run E-11f56074
      (2026-10-29) had none in its PRD (0 "Given the PRD section" lines; its F2 judge noted a repeated bullet
      "a card-87 check could trip on"), so the exact-match fix holds on a real run; a paraphrase is untested.
    - Acceptance: a paraphrase case caught (test) or named as a limit in the PRD gate prompt.

75. **smart-compact fires on the same context % the person sees in the status line** — part in E-3f6657e7 (6d5809b2)
    - 2026-10-26: smart-compact now computes `round((input + cache_creation + cache_read) / window * 100)`, the
      formula the status line's `used_percentage` matched at 6% (Claude Code 2.1.310), and `/smart-compact`
      shows %, threshold and tokens. The ~40 vs 21 gap was not reproduced at small context; whether
      `used_percentage` leaves that formula at large context is unverified. Left: the live check at ≥ 200k
      tokens (steps in `~/.harness/tasks/3f6657e7-*/harness-report.md`, copied: compare `ctx:N%` with
      `/smart-compact` at a turn end, then `/smart-compact 10` and `/smart-compact log`).
    - 2026-10-26 02:48, this session at 176,919 tokens: the status line's input read `used_percentage: 18`
      on a 1,000,000 window — the formula holds at 177k; threshold 30, so no fire was correct. User said
      "스마트 컴팩트 또안됐음"; which session and number they saw is unverified.
    - 2026-10-26 09:41, session a2af697f (Opus 5.5, process started 2026-10-25 03:13, threshold 30): user
      "이세션 30%인데 40%넘음". Last response's input 83,641 tokens (2 + 959 + 82,680) = 42% of 200k, 8% of
      1M — the status line is on a 200k base, smart-compact's window is 1M (or the process still runs the
      pre-6d5809b2 module loaded on 10-25). Cause unverified; `/smart-compact` in that session shows which.
    - Why: user, 2026-10-25: "smart-compact 발동 시점 정리 한 번 더 하자 지금 이세션 40인거보면" — the
      person read about 40 while smart-compact's own log for the session said 21% at 09:32 against a 30%
      threshold, so it never fired. The last response's input was 225,153 tokens: smart-compact divides by
      the model's 1M window (`$.session.usage().context.percent`, 23%), the status line script prints
      `context_window.used_percentage`, a different base (cause of the exact number unverified).
    - Acceptance: smart-compact compares the threshold with the number the status line shows (or the status
      line shows smart-compact's number), checked in one live session where both read the same at a turn
      end; `/smart-compact` prints the current %, the threshold and the token count behind them.

81. **Two size-S runs in one checkout do not fail each other's scope check** — part in 747e9306 (E-53a84277)
    and 88cf55ed (E-398db286): `teams/mcp/scope.mjs` baselines already-dirty paths; `scope.mjs verdict --baseline
    --scope` computes pass/fail in node (exit 0/1, out-of-scope paths listed; real run: a foreign path dirty
    before the baseline passes, a new out-of-scope path fails) and the size-S prompt makes its exit status the
    scope result. E-11f56074 (2026-10-29, taken from P1's worktree; its gate was blocked by the card 97
    denial defect): the engine computes the verdict on the finish read (`computeScopeVerdict`, scope from the
    plan/setgoal paths, `ownVerdict` over `.harness-run/writes/<run>.jsonl`) and records a `scope_verdict`
    event; the model no longer runs the CLI, so a foreign write no longer fails the run. Left: nothing writes
    the own-write record yet (the verdict falls back to git-only, recorded not gating); two runs editing the
    same file not isolated.
    - Why: 2026-10-26, E-23b35fe3 (card 74 part A) failed its U4 clean-scope check three times because
      E-0baf8e75 (part B) was editing session/think/trophy in the same main checkout; part A's own work
      passed (teams 357, graph 175, harness 199) and was committed by hand. Size S writes into the
      checkout, so two at once share `git status`.
    - Acceptance: a size-S scope check counts only paths its own run touched (or tm_open refuses a second
      size-S task on a checkout that already has one live), with a test.

74. **Every mod's UI draws on terminal, desktop, mobile and vscode (`mod.md` rule 8) — teams first** — tests in
    55e2dcc3 (teams 357, graph 175, harness 199) and bfe0022c (session 699, think 53, trophy 149), all four
    surfaces mounted; tmux 190/110 seen for the teams pane. README/KOR surface lines in all six (96ead92d
    for teams, think); terminal shots unchanged, so none retaken. Demo approval delegated to Claude
    2026-10-26 (user: "너가좀 하세여"). Left: the live look in the Claude app over Remote Control — this
    machine has no app or signed-in browser, so it waits for the person (steps in
    `~/.harness/tasks/{23b35fe3,0baf8e75}-*/harness-report.md`).
    - Why (all mods): user, 2026-10-25: "얘 모든 mod로 그리는 UI는 모바일, 데스크탑, 다 대응할 수 있어야 해요".
      Scan the same day: graph, harness, session, teams, think and trophy tests mount `terminal` and at
      most `desktop`; none mounts `mobile` or `vscode` (6 of 6 mods).
    - Acceptance (all mods): each mod's tests mount every pane, band, card and toast on all four
      surfaces; elements outside the shared six are behind an `e.surface` check; one live look per
      mod in the Claude app over Remote Control; README/KOR say the surfaces.
    - Why: user, 2026-10-25, watching this session from the Claude app over Remote Control: "claude app에서
      rc로 보는데 teams-status는 노출이 안되는구조야?" — the command answered only "teams: pane opened /
      closed" and nothing showed in the app. The mod API knows `desktop` and `mobile` surfaces
      (`$.session.surfaces()`); whether the teams pane draws on them is unverified.
    - Acceptance: with the session open in the app, `/teams-status` shows the EPIC list there (the pane on a
      surface that draws it, else the `view.mjs --once` text as the command's answer); `claude plugin test`
      mounts the pane on `desktop` and `mobile`; the terminal pane is unchanged.
    - Why: live look failed 2026-10-26, phone (Claude app over Remote Control). User: "씨발 안나오네",
      "리모트로 안나오잖아", "제대로 안만든거 뭐냐". The phone shows only `teams: pane opened` — no pane, no board
      text. The text fallback (`wantsStatusText`, `teams/hooks/pane.ts:50`) fires only when a non-terminal
      surface is in `$.session.surfaces()`, and the app was not in that roster, so the same symptom as
      2026-10-25 shipped unchanged. Why the app does not attach (no `session.attach`) is unverified.
    - Acceptance: over Remote Control, `/teams-status` puts the board on the phone even when the app is
      not an attached surface (the fallback does not hang on `surfaces()` alone); proved by a phone
      screenshot, not by `claude plugin test` mounts.
    - Proof 2026-10-26 (teams 0.61.0 session, Remote Control on, the person on the phone): at `/teams-status`
      `$.session.surfaces()` read `["terminal"]` and `session.attach` never fired — the Claude app over Remote
      Control is not a mod surface on 2.1.310, so no pane or Svg can reach it; only the command's `{ text }`
      does. 0.61.0 answers with the board as text (`view.mjs --once --format board`). Left: a phone
      screenshot of that text; whether a later Claude Code build attaches the app (then the Svg board
      shows there) — a Claude Code gap, not fixable in the mod.

### write plugin

100. **write:diagram draws figures that look finished, not merely checked** — rest in E-f673c006
    - Why: user, 2026-10-29: "write:diagram 퀄리티 떨어짐"; asked what, they picked all four: 투박함, 배치가
      엉성함, 내용이 틀리거나 부족, 유형 선택이 별로. Seen in the last figures it drew (fig-9-2 roll-pointer
      chain, fig-13-1 two-session lock wait): every box the same grey/white with one stroke and no type
      hierarchy; timeline boxes stretched to the full lane width whatever their text; the point of fig-13-1
      (A's X lock makes B wait until A's COMMIT) has no line from the lock to the wait, the wait is a thin
      dotted stub, and "UPDATE 재개 · 0행" is unexplained; nothing marks the one thing the caption claims.
    - Acceptance: (1) a style layer: colour roles (the claim's elements in one accent, context muted),
      corner radius, two stroke weights, title/label/sub-label type scale, boxes sized to their text;
      (2) the IR names the claim's elements and `check` refuses a figure where none is accented; timeline
      draws the cause edge (holder's lock → waiter) and the wait span to the release; (3) the type choice
      is written with its reason in the Output Template and refused when the point is parallel attributes;
      (4) fig-9-2 and fig-13-1 redrawn, before/after shown to the user and approved;
      `node write/skills/diagram/scripts/test-diagram.mjs` passes with the count reported.
    - Partly shipped 2026-10-29 in E-eb3d399f (`13b988d5`, test-diagram 60/60): (1) style layer, (2) `claim`
      accent and its refusal, wait span, `holder`/`resume` fields, (3) type with reason and the table
      refusal. Left: the `holder` cause edge is drawn as a straight line from holder to waiter, so `check`
      refuses it whenever steps lie in the rows between (fig-13-1: through A@t5 and B@t6) — route it along
      the lane gap instead; the wait span stops short of the holder's COMMIT with nothing tying the two;
      a lane's text wraps early once a `resume` takes its gutter ("UPDATE 205 · X 잠금 획득" on two lines);
      then (4): fig-9-2 and fig-13-1 shown to the user and approved (rebuilt IRs kept outside the repo).
    - Rest shipped 2026-10-30 from E-f673c006 (blocked at goal gate 86/90, integration-2 taken by hand;
      test-diagram 69/69): the holder edge is a right-angle path along the lane gap, the wait span ends
      at the release step's box edge, a resume note no longer wraps other labels. Left: `check` tests
      only the first line of a wrapped resume note, so an edge through its second line passes; a
      backward cause edge in a narrow lane gap (QA D1b) is not routed clear; then (4) the user's
      approval of the two after-PNGs.

### knowledge plugin

### portfolio plugin

(cards 102, 103 and 54 moved to the top, 2026-10-30)

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
| E-ea14c9c4 | 2026-10-30 | 101 | partial: teams 0.61.5 `e4502d68` taken by hand (P1, D1–D5, D13, P2; teams 1660/1660); integrate:3 blocked on duplicate QA defects (card 105); first tick and a real width-2 run left (101); $61.49 |
| E-eb3d399f | 2026-10-29 | 100 | partial: P2 + D1 shipped and P1 taken by hand from its worktree (`13b988d5`); P1 'blocked: tool denied' ×3 on the 0.60.1 engine, P3/P4 unreachable; $48.72 |
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
| E-c80fa0ea, E-1515b84f, E-0e4ef843 → E-1fdeb52d | 2026-10-25 → 26 | 47 | shipped `f5d6cc63`, `ac84b75b`, `a2fdad3d`; size S ×4 (E-0e4ef843 stopped at implement, finished by E-1fdeb52d); teams 1482/1482; four routing probes match |
| E-2bb23da3 | 2026-10-25 | 71, 72, 73 | shipped `d0b8f470`; size S; gaps → cards 77, 78 |
| E-23b35fe3, E-0baf8e75 | 2026-10-26 | 74 (tests) | shipped `55e2dcc3`, `bfe0022c`; size S ×2; part A blocked only on the shared-checkout scope check (card 81) |
| E-d9a9ede4 | 2026-10-26 | 78, 79, 80 | shipped `dbade549`; size S; repo-rules 80 ok, teams mod 361; q closes the empty pane, seen live |
| E-53a84277 | 2026-10-26 | 81 (part), 77 | shipped `747e9306`; size S; teams 1492/1492 (5× taskmanager 315/315); flaky test named: judge-stream cleanup `ENOTEMPTY` (cause inferred) |
| E-82cdb580 | 2026-10-26 | 48 Task 5 | shipped `df102aa5`; size S; AXES.md sha256 9580dbfd…; 27 problems, bench 52/52 |
| E-d93aa063 | 2026-10-26 | 76 (part) | shipped `ff3d9073`; size S; teams 1513/1513 |
| E-3f6657e7 | 2026-10-26 | 75 (part) | shipped `6d5809b2`; size S; large-context live check left on card 75 |
| E-27be4005 | 2026-10-26 | 48 Task 6 (first half) | shipped `eac1f097`; size S; dry run gh-defect-2 ~$0.36 per arm; batch bump `f4d455a1` |
| E-57170ac9 | 2026-10-27 | 83, 82 (76 closed: shape passed on attempt 2) | P2 shipped `91f32cf4` (bench 80/80); P1 judged accept 3× but settled blocked on a denied extra command (card 85), taken by hand `21a52358` (teams 1530/1530); cancelled at QA-F1's 11 defects |
| E-7d212456 | 2026-10-27 | 85 | shipped `d8d9eebb`; size L, every stage first try; teams 1541/1541; QA's top-level `test/` scratch left out (card 86) |
| E-398db286 | 2026-10-27 | 86, 81 | shipped `88cf55ed` by hand (cancelled in Build): P1 (86) accepted on attempt 2; P2 (81, part) judged accept 90 but settled blocked by the installed 0.60.1 engine (card 85 fix not installed yet); teams 1561/1561; ~$19 |
| E-fa84630b | 2026-10-27 | 84 (two defects) | nothing shipped: both PRD cards accepted, critique:3 rejected P1 for carrying the planning card's document criteria the PRD folded into its stories (card 87); $5.97 |
| E-77926c5f | 2026-10-27 | 87, 89 | nothing shipped: both PRD cards accepted; shape failed 3× (P1 and P3 both touch `teams/mcp/taskmanager.mjs`; one owner per path by design). Cards touching the same engine file go in separate Sprints |
| E-22c3af14 | 2026-10-27 | 91 | nothing shipped: pinned L, PRD with one story; shape refused 1 package (fits S) and 2 packages (one claims every story) (card 92); reopened unpinned |
| E-b1aee623 | 2026-10-28 | 91 | shipped `e0032b0f`; size S (unpinned); goal gate 95; accept scores only the package's own acceptance (`scopeGaps`, `out_of_scope[]`); teams 1565/1565; ~$3.5 |
| E-861e1089 | 2026-10-28 | 87 (part) | shipped `eb3a1c49`; size S; document criteria filtered from the PRD stories by exact text; teams 1567/1567; ~$3 |
| E-db523454 | 2026-10-28 | 92 | shipped `f5a54fe8`; size S; goal gate 96; "claims every user story" needs 2+ stories; teams 1568/1568; ~$2 |
| E-8b9c417d | 2026-10-28 | 84 (two defects) | shipped `7e051a4b`; P1 accepted; P2 met its own acceptance but rejected 3× for P3's live look (card 91), taken from its branch; live look done in session; integration branch held QA scratch under `test/` (0.60.1 engine, card 86 fix not installed) — not merged; teams 1570/1570, plugin test 375/375; $27.5 |
| E-0ad09a55 | 2026-10-28 | 88 (part) | shipped `12668c8f`; size S; goal gate 90; repro gate for QA defects and audit unmet (rerun in the integration tree, a passing one dropped); teams 1577/1577; $3.72 |
| E-11f56074 | 2026-10-29 | 81 rest, 99 (87 check) | partial, size L, ~$24: both packages' gates "blocked: tool denied" (installed engine lacks e9fc32eb); work taken from the worktrees by hand. 99: hook refuses writes only in this repo's common dir, repo-rules 231/231, live: scratch repo pass, repo deny. 81: engine scope verdict recorded on finish. teams 1633/1633. PRD had no document criteria (87) |
| E-f2173f01 | 2026-10-29 | 94 rest | size S; one status word per STORYs row, title shrinks last (≥24 at 86 cols); live look 84-col pane, shot sent; plugin test 399/399, teams 1631/1631; awaiting the user's approval |
| E-fa72c6e8 D11 | 2026-10-28 | 97 rest | taken from the cancelled Sprint's D11 branch (`rescue/fa72c6e8-D11`): a command the project's PreToolUse hook refuses (QA probing `rm -f $QAF1_UNSET/…`) is not a needed denial, so it no longer blocks a node; live probe doc `_repo/docs/2026-10-28-hook-deny-permission-denials.md`; teams 1631/1631 |
| E-75270ef1 | 2026-10-28 | 88 rest, 96 | shipped `fc9ea16c` (committed by the run); audit unmet items need a runnable repro; a dropped defect stays dropped on rescue/retry; task.base_commit at tm_open; size-S prompt names gateintegrity; teams 1626/1626 |
| E-ca39279f | 2026-10-28 | 97, 98 | size S; one filing holds a defect once (same trimmed title or repro.command); `harnessVerdict` refuses an accept under goal_threshold (the graph's floor-5 band let 85 pass at 90) and the size-S prompt passes the threshold; teams 1618/1618 |
| E-a0b849a2 | 2026-10-28 | 95 | size S; goal gate 85 (under threshold 90, card 98); a QA/audit-filed package records `base_branch` = the filing pass's integration branch and branches from it; teams 1615/1615 |
| E-f69222d8 | 2026-10-28 | 90 rest | size S; goal gate 93; `>|`, absolute repo targets from outside, bare `cd`/`cd -`/`pushd`/`popd`/subshell tracking; repo-rules 217/217; live hook run: 4 deny, 2 pass as listed |
| E-a193d3ec | 2026-10-28 | 94 defects | shipped `bd8e0702`; STORYs reason on its own line, a repackaged story shows its current attempt; teams 1613/1613, plugin test 396/396 |
| E-692f3092 | 2026-10-28 | 94 | shipped `110de5ff`; teams-status attempts, judge score vs threshold, cost and retry spend, drivers, denials, defects filed/dropped; teams 1610/1610, plugin test 381/381 |
| E-fa72c6e8 | 2026-10-28 | 90 | cancelled by the user in QA round 2, integration-3 taken; `enforcement.md` + repo hook refuses unquoted `rm $VAR` and in-place Bash writes; repo-rules 204/204; rest is card 90, duplicate filing card 97; ~$79 |
| E-f27382fa | 2026-10-28 | 89 | shipped `cf13b16a`; size S; goal gate 90; `gateintegrity.mjs` + gate:goal section; real run `--baseline HEAD~30` lists card 85's two replaced tests; teams 1591/1591 |
