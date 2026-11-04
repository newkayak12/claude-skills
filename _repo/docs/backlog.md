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

123. **portfolio:feedback runs a fixed reviewer panel of subagents, argued out with brainstorming's debate mode and devils-advocate**
    - Why: user, 2026-11-04: "feedback 스킬에서 쓸 여러 subagent를 구성하자 랜덤 구성하지 말고",
      "거기서 `/think:brainstorming`의 --debate 쓰고 devil's advocate 도 같이 쓰도록하고". Today feedback
      runs in one context and picks one of the four personas in `feedback/references/personas.md` (step 2,
      "present the four … and ask, or choose if told 'you decide'"); no subagents, no clash between readers.
    - Acceptance: the panel is a fixed, named roster written in the skill (each reviewer: persona from
      `personas.md`, what it reads for, model), the same roster every run, never chosen at random or
      improvised per run; each reviewer runs as its own subagent on the same document; their findings are
      argued out through `think:brainstorming`'s debate mode (`think/skills/brainstorming/references/debate.md`:
      diverge → merge → attack/rebut, max 2 rounds) with `think:devils-advocate` as the attack step's method;
      the output adds a `[충돌 / Clashes]` block (who disagreed on which finding, whether it survived) and keeps
      the current Output Template; fewer than 2 subagents alive → the single-context run, said so; one real run
      on a fictional portfolio shows the roster, the clashes and the merged priorities.

124. **portfolio:manage runs collect → build like the harness: staged, gated, looped n times**
    - Why: user, 2026-11-04: "manage 처리할 때 최초 수집 ~ 빌드까지를 harness 스킬 유사하게 처리할 수 있도록
      하자", "n회 돌게 해서". Today manage's Process is eight steps the model walks in prose (card 54);
      nothing sets done-criteria per step, checks them before the next, or repeats the round.
    - Acceptance: steps 1 (collect) through 7 (build/render) run as one harness-shaped pass — plan the round,
      set checkable done-criteria per step, do the step, check it with `manage.mjs`/`material` commands where
      one exists (judge ≠ actor otherwise), gate before the next step, report the round; the pass repeats n
      times (n given by the user, a default stated in the skill), each round starting from the previous
      round's gate gaps and feedback findings, and stops early when a round's gate finds nothing new;
      the round count, each gate's verdict and what changed per round are written under the workspace's
      `snapshot/` (a record a later session reads); runs headless and without a mod; one real run on a
      fictional workspace with n = 2 shows two rounds, their gates and the diff between them.
    - Scope (user, same day): "manage 이후에는 작게 작게 micro로 수정하고 처리할 예정이니까" — the n-round
      loop is for the first collect → build only; once a deck is built, later changes are micro edits (one
      item, one page, one fix) that run only the step they touch and its gate, not a full round.

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
    - `manage settle --findings <file>` shipped 2026-11-02 (E-1476d4db, redo of E-54884e0c P2): a
      line of under 3 stems never matches, settled needs >= 3 shared stems and >= half the line;
      bad entries error with their index, a path outside the workspace is refused; manage 48/48; real
      CLI run on a fictional workspace settled two paraphrases, kept the unrelated, the 2-stem-line and
      the `## 정정` findings. Left: a finding that reports the deck *breaking* a settled rule ("두 업무가
      한 블록에 섞여 있다") is settled too, since stems cannot tell a violation from a re-raise; the
      SKILL shows `settled` to the user so it can be put back. P3's runbook stays on
      `rescue/e54884e0c-integration` (card 49).

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

### Mods and naming — UI first (design: `_repo/docs/plans/mod/2026-10-16-mod-detail-and-parallel-runs.md`)

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

### Repo and rules

### Subagents and parallel runs — use and clean up (user, 2026-10-17)

### teams plugin bugs

125. **teams retires the web viewer; `/teams-status` is the one live view, raised in quality**
   - Why: user, 2026-11-04, after the 190/110 captures of card 105: "만약 된다면 view.mjs(web으로 보여주는 것)
     은 퇴역시켜도 될거 같아", "저 *-stats view만 더 퀄리티 높히면 될거 같고". Condition ("만약 된다면"): the
     pane handles several EPICs at once (`]`/`[` step EPIC, `j`/`k` STORY row, `g` open) — seen live with
     two running tasks first. The web server is also the stale-process source: teams 0.62.5 sessions kept
     respawning `view.mjs --serve-once-socket` at ~95% CPU (killed three times 2026-11-03, again 2026-11-04).
   - Acceptance: live look with two running EPICs at 190 and 110 shows stepping and row moves work (the
     condition; if it fails, fix the pane before retiring anything); then the browser server goes —
     `view.mjs` HTTP/socket serving, `/register`, `view_url` in tm_open/tm_run replies, the viewer spawn in
     `taskmanager.mjs`, and their mentions in teams skills, README/KOR, CHANGELOG — while `view.mjs --once`
     (the CLI text every non-mod client and the command's `{ text }` read, `compat-claude.md`) stays;
     no `view.mjs` server process starts from any teams path (a test and a `ps` check after a real task);
     the pane's quality pass is named in its own acceptance lines, approved on the demo render (`mod.md`
     UI rule 0).
   - The mod's state socket (user, same day): "--serve-once-socket -> 이건 그냥 써야하니 무조건 소켓 하나로만",
     "scripts/view.mjs 이게 너무 무겁고 자꾸 CPU 점유를 높혀", "엔진 에 통합하되". Seen 2026-11-04: every
     session with a surface starts its own `view.mjs --serve-once-socket` (0.63.0 at 6% CPU, a 0.62.5 one at
     66–95%), beside its own taskmanager/broker/wiki. Acceptance: exactly one state socket per machine
     (per tasks root), shared by every session's mod — a second session connects to it, never starts
     another; it is served by the engine (task-manager / daemon side), not by a separate `view.mjs` process,
     and computes a task's state only when that task's files changed (no full re-read per poll); it exits
     when no session is connected; a test with two clients on one socket, and `ps` showing one server
     with two sessions open; idle CPU of the server under 1% with one running task, measured.
   - The viewer link, now and unconditionally (user, 2026-11-04, on a `http://127.0.0.1:7431/E-478d5e95` in a
     reply: "이렇게 내보이는거 굳이 하지말자"): no tm_* reply carries a viewer URL — `view_url` leaves
     tm_open, tm_run and tm_status (`teams/mcp/taskmanager.mjs`), and the skills that tell Claude to show it
     (`teams/skills/{orchestrate,develop,plan,qa,document}/SKILL.md`) and `teams/docs/configuration*.md`
     stop doing so. Not gated on the pane condition above. Acceptance: `grep -rn 'view_url\|7431' teams`
     hits only `viewserver.mjs`/`view.mjs` (until they retire) and tests asserting its absence.
   - The pane's quality pass (user, 2026-11-04, on the panel doc): "HOME에 돌고 있는 EPIC, STORY 계층으로
     뿌리고 / STORY 선택 시 전체 FLOW, 진행도, subagent 참가 수, 참가 종류 / FLOOR 에 각 Phase에서 돌고 있는
     상세 / Decisions는 Phase 상세에 / Log, Report는 Story 선택시 / 에초에 계층이 잘못됐음 / 조작 키도 wasd,
     enter", then on the mocks "전체적으로 훨씬 나음", "좌우는 필요 없어", "진행합시다". Chosen: F1 of
     `_repo/docs/plans/mod/2026-11-04-teams-pane-panels.md` § 확정안 (mocks beside it in `images/`), no split
     view. Acceptance: the six tabs give way to a page stack — HOME (EPIC → STORY tree, ⚑ zone on top) →
     FLOOR (the EPIC's six phases) → phase detail (running workers, hand-offs, that phase's decisions);
     HOME → STORY detail (node flow, progress, subagents joined and live by kind, attempt × node table) →
     Log / Report; keys `w`/`s` move, `d`/⏎ open, `a` back, `n` next ⚑, `q`/Esc close, ⏎ on a ⚑ opens an
     answer mode where letters are text; mobile gets the same as Buttons; breadcrumb on the first line;
     the selection per level is kept on `a`; ended EPICs stay as folded rows; `⏸` with minutes since the
     last driver output on worker rows, from the engine's stall verdict (not a second rule in the view);
     the last rejection reason and score on STORY rows; a STORY report written by the engine (the pane
     reads it, never composes one); `pane.ts` key tests for every key; demo render of each page at 190 and
     110 approved before the card closes. Not in: split view, retry/cancel keys (the pane stays read-only).

126. **teams agents talk over a per-task message bus (topic = the task key), the pane draws it as threads**
   - Why: user, 2026-11-04: "agent 간 대화는? teams 내에서", then "지금은 mod로 가능하지 않나? 가능하더라도
     별도 bus가 필요할거 같고(message queue 같이 topic은 task 번호로하면 될거 같고)". Today the only
     agent-to-agent path is a STORY's `tm_ask` to the TeamLeader (card 49), parked until answered or
     forwarded to the person; verdicts, QA defects and integrate results show as one-line hand-offs
     (`teams/scripts/lib/view-events.mjs`); packages never talk to each other. A mod cannot carry it: the
     drivers are headless `claude -p` runs where mods do not start (`mod.md` rule 2), and a mod never
     holds the source of truth (rule "does not hold the source of truth").
   - Acceptance: an engine-side bus — append-only per topic under the task (topic `E-xxxxxxxx`, sub-topic
     per STORY or `all`), one message = {ts, from, to, topic, body, reply_to}; publish and read through
     task-manager MCP tools every driver already loads (`tm_ask` becomes one kind of message, not a second
     path); a reader gets only messages after its cursor, so a driver is never re-fed the whole log; who may
     post to whom is written down (package ↔ package on the same EPIC, TeamLeader, person) and a message to
     a parked STORY wakes it like an answer does; the pane shows a thread per STORY (`from → to`, body,
     time) and the band names an unread message to the person; `view.mjs --once` prints the same; tests
     for publish/read/cursor/wake, and one real L task where two packages exchange a message that changes
     what one of them builds.

127. **Every EPIC row reads as its key plus a short natural-language name, never the key alone**
   - Why: user, 2026-11-04, on a pane screenshot with rows `● E-0ad41780 ⑂ c…` and `● E-6ff25a30 ⑂ c…`:
     "EPIC 이름 이렇게 못알아보게 하지 말고 EPIC + 자연어 설명으로". The row's title is the request's first
     words ("Backlog card 125, the state-socket part only…"), and at a narrow pane the key and the `⑂`
     worktree mark take the width, so the name is cut to nothing.
   - Acceptance: the engine writes one short name per EPIC (a few words in the request's language, e.g.
     `mod 상태 소켓 하나로`, `테스트 fixture 격리 · 영역 겹침 차단`) at open, kept in task.json and returned by
     tm_board/tm_status; every surface (pane row, band, board, `view.mjs --once`) shows `E-xxxxxxxx · <name>`;
     when width runs out the name keeps priority over the worktree mark and state columns (key, then at least
     the name's first word, then `⑂`); tests at 190, 110 and a narrow pane on four surfaces; the demo render
     approved by the user (`mod.md` UI rule 0).

121. **teams tests write their fixture tasks under a temp tasks root, never `~/.harness/tasks`**
   - Why: 2026-11-03, `tm_clean` sweep listed tasks `3a3a3bb5`, `d0ee9043` (2026-09-22), `97f05d73`
     (2026-10-07) as running with dead daemons, cwd `$TMPDIR/view-test-repo-*`, and a live `eb955b62`
     (cwd `$TMPDIR/teams-ask-fixture.*`) made by a test run of E-bf0527b7 P2 the same day; the first
     three cancelled by hand. Leaked fixtures sit in every real viewer's and status scan's list. Which
     tests leak is unverified.
   - Acceptance: every teams test that creates a task sets its own tasks root (env or option) under a
     temp dir; a check run of `node --test teams/scripts/test-*.mjs` leaves `~/.harness/tasks` with
     the same entry count before and after.

112. **An area critique's file-ownership overlap blocks instead of passing as soft**
   - Why: 2026-10-31, E-8c671fd9: `areas-critique` saw F2 and F3 both planning the spawn env edit in
     `teams/mcp/taskmanager.mjs` and said "overlap (soft) … Name one owner", verdict `sound`; the
     contradiction reached shape and `critique:3` rejected it as unrunnable, ending the task.
   - Acceptance: an overlap on the same file and lines between areas is a blocking finding that sends
     the areas back with one owner named; a test with two areas claiming one function fails at
     areas-critique, not at critique.

105. **Repo-wide pane and one viewer: UI look and the loose ends** — code defects in E-03e2e513; cards 105 and 106 shipped 2026-10-30 in
    E-f53a8434 (`236eae3d`; goal gate 92; teams 1658/1660 with 2 skips, plugin test 423/423; real run: two
    scratch tasks, one viewer port, 31 ok)
    - Why: shipped: `view-repo.mjs` matches tasks by git common dir, the pane row and band mark another
      worktree's task `⑂ <worktree>`; one `view.mjs` serves many task roots (`/` index, `/E-xxxxxxxx`,
      `/<slug>`, `POST /register`), a second task joins it. User's words: "teams로 하는거 맞음??", "포트가
      아니라 카드 번호로 분기하면 될텐데??? 브라우저". Its report leaves: mod.md UI-done not done (live tmux
      look, 190/110 captures, demo approval); the possessive strip also eats contractions ("It's broken" →
      `it-broken`); `findTask` tries the id prefix before the slug, so a hex-only slug (`cafe`, `add`) opens
      a task by id; the join branch (second standalone `view.mjs`) has no automated test, and the fallback
      test skips when 7431 is held; `listenOn` turns a non-EADDRINUSE error into an unhandled rejection;
      stale comment in `view.mjs` ~356; no Host-header check on `/register`; a long title plus `⑂` mark not
      tested for `…`. The run also saw repo-rules refuse `node -e` containing `=>` (unverified false positive).
    - Code defects fixed 2026-10-31 in E-03e2e513 (`cf509f67`; goal gate 93; teams 1704/1705, 1 skip):
      contractions keep their word (`its-broken`), exact slug beats id prefix, join and fallback tested on
      a scratch default port, listen errors exit 1 with one line, stop-rule comment fixed, `⑂` tail cut to
      `…` tested on 4 surfaces.
    - Live look 2026-10-31 (main checkout, E-7970d4b5 running in `../claude-skills-c108`): the pane and
      band now list the worktree task (was "no task running"); q, Esc and the command again close it.
      Defect: the `⑂ <worktree>` mark is appended after the title (`teams-draw.tsx:219`, `mod.tsx:962`),
      so it is cut off first and never shows at 190 (row `Backlog card 108 (teams plugin), in…`) or 110.
    - Fixed 2026-10-31 in E-d19daa16 (`e9b1d5b0`; goal gate 95; plugin test 431/431): the mark is drawn
      before the title. Live look (E-7e44f783 running in `../claude-skills-c109`): 190 row
      `E-7e44f783  ⑂ claude-skills-c109 · Backlog card…   running  0/0  34s`, band
      `teams · ⑂ claude-skills-c109 · Backlog card 109 …`; 110 row `⑂ claude-sk…`, band `⑂ claude-skills-c…`.
      `node -e '[1,2].map(x => x*2)'` runs, not refused (the earlier refusal not reproduced).
    - Acceptance (left): the user approves the 190/110 captures.

### write plugin

### knowledge plugin

### portfolio plugin

(cards 102, 103 and 54 moved to the top, 2026-10-30)

### Skeleton and length (one card per skill, next edit)

120. **Every skill optimized: length, trigger accuracy, script speed, code quality — one plugin per Sprint**
    - Why: user, 2026-11-02: "전체적으로 최적화가 필요해보임 모든 스킬", asked what by: "셋 다 + 코드
      퀄리티". This lifts `skill.md`'s "no mass rewrite" for this card. Measured the same day: 115
      skills, 11 frozen (teams-mounted), average 120 lines (target 70% ≈ 84), 2 over 200; descriptions
      loaded each session 25,777 chars (avg 224); plugin descriptions: harness 2,897 chars, write 1,038.
    - Usage survey, same day (Skill calls and `/<plugin>:<skill>` commands in 4,832 local transcripts):
      27 skills used in 3+ sessions, 19 in 1–2, 69 never. Retiring the unused was proposed and
      rejected (user: "은퇴는 반려"): every skill stays; the survey only orders the work (used skills
      first inside a plugin). `harness`/`graph` are out (stable, `repo.md`).
    - Acceptance, per plugin (frozen skills stay out; behaviour kept):
      1. length: each SKILL.md at or under ~84 lines or the reason it is not; background prose and
         repeats moved to `references/` or cut; check-skeleton clean;
      2. trigger: description and plugin description trimmed, each changed description run through a
         routing probe (should-fire and should-not-fire prompts, EN + KR) with before/after counts;
      3. speed: each skill's scripts timed on their tests and a typical call; anything over 1 s
         profiled and fixed or noted;
      4. code quality: scripts reviewed (`develop:clean-code` gate) for dead code, duplication across
         plugins, missing tests for parsing/decisions; fixes with tests;
      5. the plugin's checks from `maintaining.md` with counts, one real run of one changed skill, one
         batch bump per plugin.
    - Order: teams first (user, same day: "teams가 주 대상인데") — its 15 skills (1,647 lines,
      frozen ones included: the user decides for teams) and the teams-mounted skills
      (`agents:agent-task-decomposer`, `cognition:critical-thinking-workflow`, `develop:testing-workflow`),
      and its code: `teams/mcp` 22,232 lines (`taskmanager.mjs` 9,028, `broker.mjs` 2,479, `graph.mjs`
      2,120), `teams/scripts` 43,035 lines over 96 files. Then largest first by lines — develop (36),
      write, portfolio, cognition, think, knowledge, skill, harness, agents, graph, the rest.
    - teams split into Sprints: (a) skills + descriptions, (b) `taskmanager.mjs` split by concern with
      no behaviour change (the test suite is the oracle), (c) broker/graph duplication with
      `graph/mcp`, (d) script speed on the hot paths (`tm_*` calls, `view.mjs`, daemon tick).

## Frozen (do not pull)

- `harness` and `graph` plugins are stable: no more changes (user, 2026-11-02: "harness, graph 는
  stable로 더이상 수정 금지"). Card 48 (graph + harness into teams) stops here: Tasks 2–4 (graph
  critique rounds, goal gate, Codex fallback; E-c5c109e3) and Task 6's first half (eac1f097) shipped,
  Tasks 5–9 and the 162-run matrix are not run. teams keeps its own engine copies; the long-term
  direction stays teams (user, 2026-10-17).

- `teams:orchestrate` (204 lines) and teams skills missing sections (`plan`, `qa`, `document`,
  `develop`) — frozen until teams decides.
- `cognition:critical-thinking-workflow` — teams mounts it.
- `agents:agent-task-decomposer` (210 lines, missing Process / Output Template / Related Skills) —
  teams mounts it; former card 20.

## Sprints

| EPIC | Date | Cards | Result |
|---|---|---|---|
| — | 2026-11-04 | 101, 81 closed on evidence | 101: E-bf0527b7 (teams 0.62.7) ran `dispatch:P1:2` and `dispatch:P2:2` together from 05:45 (spawned 1 s apart) and P3:2 with P2:3 from 07:19, no `auto_parallel_decreased`; 81: E-a9953265 (size S, teams 0.63.0) `scope_verdict` `own_record: true`, Codex `apply_patch` limit stays named in teams README/KOR |
| E-a9953265 | 2026-11-04 | 122 (75 closed without code) | shipped `4761717a`; size S; goal gate 93; test-diagram 118/118 in 34 s (was 148 s on the card, 210–323 s under load); one Chrome shared over CDP only in the suite, the CLI path unchanged |
| E-bf0527b7 | 2026-11-03 | 113, 49 rest, 94 rest, 84 rest | shipped `45251683..e93a5b31` by hand (cancelled in Build, ~$80): P1 (113) accepted 92 — one viewer per tasks root reused by live pid, finished tasks cached by mtime/size, 5 min idle exit; P2 (49) live forwarded STORY ask in the ledger and the band shot, stalled twice in a tmux wait (taken from attempt 3); P3 (94) 85 at retry 4, its one gap (P1's golden test scrubbed instead of recut) fixed by hand; P4 (84 design doc) never ran. teams 1792/1793 (1 skip), plugin test 445/445; 3 usage-limit parks. E-96699aa4 cancelled in PLAN to pin the viewer design |
| E-16e58ff6 | 2026-11-03 | 114 | shipped `0cdfee82` by hand (task blocked): P1 accepted; P2 rejected 3× only for touching P1's test-diagram.mjs (pixel window 420x40→420x100); merged tree test-diagram 118/118, check-copies ok, validate 15/15; 2 usage-limit parks; test-diagram 148 s (card 122) |
| E-c4d76843 | 2026-11-02 | 119 | shipped `cf910d02`; size S; goal gate 94; cache/memo tests 2/2 (falsified), `events` with an old `--since` 2.9 s → 0.18 s byte-identical; repo-rules refuses inline-script repo writes (263 ok); teams 1778/1779 (1 skip); a perl `>>` false positive fixed after the gate; `--cwd` now includes a task whose collect fails but task.json reads (untested) |
| E-3a668d18 | 2026-11-02 | 118 | shipped in teams 0.62.7; size S; goal gate 91; `retryReport` reruns only a failed report (avoid_executors, different_vendor), size-S driver not respawned on an unchanged blocked run (`harness_run_stuck`), tm_retry retries it; red-first tests; teams 1776/1777 (1 skip); no live end-to-end run of a failing report yet |
| E-db189f56 | 2026-11-02 | 117 | shipped `68eabfac` in teams 0.62.6; size S; goal gate 85 (partial: thin CPU margin, caches untested → card 119); incremental ledger store, per-tick shared bases, `view-once-<version>.sock`; 3 sessions 60 s: 4 s CPU over 62 s (~6.5%, was ~45%), 114 asks, 0 non-200; teams 1767/1768 (1 skip), mod 442/442 |
| E-1476d4db | 2026-11-02 | 102 (settle) | shipped `608cbe82`; size S; run blocked at its report node (card 118), CLI check run by hand; manage 48/48 |
| E-bd74d6ca, E-6a0d66eb | 2026-11-02 | 116 | shipped `3bb316f0`, `16fd5a62` in teams 0.62.5; size S; goal gates 88 (partial: `teams` format compared with its render time masked) and 95; one shared server on `~/.harness/view-once.sock`; `events` 2.4 s → 0.17 s (stats ledgers first); live, 3 sessions: one server in 60/60 samples, no `--once` spawns, server ~45% of a core (was ~80% for one session before the events fix); teams 1756/1757 (1 skip), mod 441/441; sharing across sessions left for card 117 |
| E-0b44dd5c | 2026-11-02 | 115 | shipped `61b4b681` as hotfix teams 0.62.4; size S; goal gate 93; mod tests 439/439, teams 1745/1746 (1 skip); live: plain home folder 0/60 samples with `view.mjs`, this repo 59/60; a stray `/tmp/.teams_output` (2026-09-23) makes every folder under `/tmp` count as teams |
| E-eb930c1a | 2026-11-01 | 100 (theme) | blocked at integrate (D2/P1 conflict in test-diagram.mjs); merged by hand `38c416b1`, test-diagram 112/112; P2's renders partial (print theme roles by shade only); approval of the theme PNGs left |
| E-6e771dea | 2026-11-01 | 81 rest | shipped `edfad21d`; size S; goal gate 94; chained own-write test 9/9, limits in README/KOR/CHANGELOG; live `own_record:true` left (needs a session on the bumped teams) |
| E-7d6199b9 | 2026-11-01 | 107 | shipped `69b2015e`; size S; goal gate 92; bare `tm_retry` resumes an exhausted dead daemon on its run dir; parent-kill survival test; test-taskmanager 373/373, teams 1736/1737 (1 skip); cause of the session-exit kill still unverified |
| E-e6f71ab7 | 2026-11-01 | 110 | shipped `2e5da3c4`; size S; goal gate 90; gate 29/29 with env cleared and inherited (the 15/6 split was inherited `HARNESS_NODE=1`); real hook run: other session DENY, opener ALLOW; a task with no opener id still unlocks (legacy) |
| E-51309bd7 | 2026-11-01 | 111 | shipped `c0b3808e`; size S; goal gate 93; shapecheck 22/22, teams 1726/1727 (1 skip) |
| E-15aeadfe | 2026-11-01 | 110, 107, 81 rest | partial, $22.98, planning only: plan-integrate refused F2/F3 both owning the teams docs; PRD reused by the three size-S runs above |
| E-da411582, E-7626467d, E-b0b206cc | 2026-11-01 | 100, 49 | stopped in planning: 100 on the card-111 AC clash (reopened as E-eb930c1a with unique AC numbering); 49 sized too small, then the AC check again (rerun after the bump) |
| E-54884e0c | 2026-10-31 | 100, 102 rest, 49 rest | blocked (goal gate 82/90); 100's colour work taken by hand (test-diagram 92/92), 102's `settle` and 49's runbook not taken |
| E-8c671fd9 | 2026-10-31 | 110, 107, 81 rest | partial: planning only, critique failed shape 3; findings on the cards |
| E-d50a6887 | 2026-10-31 | 108 | tests only, no version bump: poll non-overlap test (`mod.test.ts`: no second `--once` while the first runs) and a load-independent perf test (`test-view-once-perf.mjs`: second call reads only the open task, 300 ms bar opt-in via `VIEW_ONCE_PERF=1`) |
| E-2694667a | 2026-10-30 | 108 | partial: teams 0.62.1, `--once` filters before collecting and indexes finished tasks (`.view-index.json`), rebased onto 0.62.0's repo-wide matcher; real status call 7.96 s → 0.40 s; 300 ms fixture test is best-of-10 (single calls flaked 306–399 ms under suite load); poll overlap guard left (108) |
| E-a7996a31 | 2026-10-30 | 87 rest | shipped `5639b260`; size S; goal gate 91; limit named in the PRD gate prompt (a Jaccard ≥ 0.63 rule passed both tests but missed the one real paraphrase, J=0.38, so declined); teams 1681/1682 |
| E-233f8dca | 2026-10-30 | 81 rest | shipped `2fc9e26c`; size S; goal gate 90; own-write hook + fallback-route verdict gates; teams 1679/1680, plugin test 411/411 |
| E-0a2ab67f | 2026-10-31 | 101 first tick | shipped (merge of `1945e0d2`); size S; goal gate 95; test-taskmanager 371/371 in run; real width-2 Sprint left |
| E-7e44f783 | 2026-10-31 | 109 | shipped `8b001fe1`; size S; goal gate 93 (r1 82); cause verified by test, not ledger (E-ea14c9c4 cleaned): `settleQaRound` deduped by title and repro only; teams 1717/1719 (1 load wall-clock fail, card 108) |
| E-d19daa16 | 2026-10-31 | 105 ⑂ mark | shipped `e9b1d5b0`; size S; goal gate 95; plugin test 431/431; captures awaiting approval |
| E-7970d4b5 | 2026-10-31 | 108 | merged `cba67113` locally, then reverted: another session shipped card 108 first as teams 0.62.1 (E-2694667a), kept that one; size S; 32.3 s → 0.38 s, but its wall-clock tests went red under load |
| E-f53a8434 | 2026-10-30 | 105, 106 | shipped `236eae3d`; size S; goal gate 92; teams 1658/1660, plugin test 423/423; UI look left on card 105 |
| E-ce2bcff4 | 2026-10-30 | 101 | merged `9d4bd6a2` locally, then reverted `0cb18fbf`: another session shipped card 101 first as teams 0.61.5 (E-ea14c9c4), kept that one; size S, goal gate 92 |
| E-db7e3226 | 2026-10-30 | 94 defects | shipped `15a95196`; size S (resumed from E-4f12f406); goal gate 91; plugin test 411/411; captures awaiting approval |
| E-ea14c9c4 | 2026-10-30 | 101 | partial: teams 0.61.5 `e4502d68` taken by hand (P1, D1–D5, D13, P2; teams 1660/1660); integrate:3 blocked on duplicate QA defects (card 109); first tick and a real width-2 run left (101); $61.49 |
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
