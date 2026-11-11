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
Portfolio cards are worked in their own session (user, 2026-11-11: "port쪽은 정리해줘 다른 세션에서
할거고"); a teams session skips that section and starts with teams (same day: "teams부터"), in the
order under "teams plugin bugs".

### portfolio flow — own session (design: `_repo/docs/plans/2026-10-30-portfolio-flow.md`)

Cards 123 (feedback panel) and 124 (manage n-round loop) shipped 2026-11-05 by hand on fix/port (manage 93/93;
real run n=2 on the fixture: two rounds, `gate.order: recorded`, a panel of one sonnet subagent per reviewer
each round, `nothing_new` at round 2). Left open: D24, whether a round waiting on the user ends the loop (the
PRD does not say). E-ae7d3226 cleaned.

Order of the cards below (user, 2026-11-10: "1. 일단 포폴쪽만 먼저하고 2. resume는 조금 천천히
3. 각 스킬 점검하고 / feedback은 성능을 향상시키는 방향으로"): 136 (renderer, later:
"렌더러 종속성은 나중에"), then 139. Cards 141-144 shipped 2026-11-11 in portfolio 2.15.0 (manage
`sync`/`verify-build`, only structure waits, manage 106/106; material `update`/`item-pages`, 28/28;
pattern two-version fixed keys read by `compare`, 6/6; rewrite untagged figures, mock-interview
question-list mode, workflow routes a deck to manage; one real `claude -p` run each, fictional
workspaces). Left from them: the "피드백 써줘" collision with `write:plans` is unprobed; `material
update` takes ledger items only, not `material/<id>/` folders; a skeleton slot is assumed to be a
`key: value` line under a `## … @sN` heading (confirm on the real workspace); the "five skills with no
description" listing symptom is unexplained (all 12 have one, 175-249 chars). Card 138 (check each portfolio skill) closed 2026-11-10: two read-only
opus audits of all ten skills against the workspace and its sessions; `check-skeleton.mjs` 0 problems
for portfolio; every gap went into 136, 137 and 139-144. Shipped by hand 2026-11-10 (user: "teams 없이
직접"), on main unreleased: 140 `cbe5fef4` (manage reads NFD-named files; real workspace confirmed facts
0 → 35), 137 `a603630b` `6ed273f6` (feedback: claims vs material, S·I·O lenses, fix table; blind bench
actionable 16% → 93%, planted defects 10/11 → 11/11), 136 minus the renderer `63a459ce` (`place:`, run
colour and `sup`, `captions:`/`panel_margin:`, UNO render with the East Asian / Latin spacing off —
real deck lone commas 316 → 0, engine version printed).

136. **deck-builder's render brings its own renderer to a machine with none (later)**
    - Why: the rest of the card shipped 2026-11-10 (`63a459ce`). Left: the renderer itself.
      Render's spacing fix needs a python that imports `uno` beside the renderer; without one it
      converts as before and says so.
    - Renderer on a new machine (user, 2026-11-10: "LibreOffice 없이는 동작을 안하지 않냐", "나눔 폰트
      기본 내장하고 libre는 자동으로 설치하거나 내재화 하거나 렌더러를 우리가 구현하던가", "docker가
      안갖춰져 있으면 그것도 못하지 않아?"). Today `render` and every SVG picture slot need `soffice` on
      PATH or `DECK_RENDER_DOCKER`; the Korean image used here (`deck-render-kr`) has no Dockerfile in
      the repo. Nanum fonts are already bundled (`assets/fonts/`, OFL). Decided direction, not yet
      approved: no own renderer (a PPTX layout engine is LibreOffice again); `render` finds `soffice`
      on PATH, else fetches a pinned LibreOffice into the plugin cache once (Linux AppImage; macOS the
      `.app` copied out of the dmg; checksum-verified; asks once before a ~300 MB download), and uses
      docker only when `DECK_RENDER_DOCKER` is set. Unverified: an AppImage exists for the pinned
      version; a dmg-extracted app runs headless past Gatekeeper/quarantine.
    - Acceptance: on a machine with no LibreOffice and no docker, render fetches the pinned build
      and renders, the spacing off (one real run on Linux, one on macOS); `test_render.py` with
      counts. Also carried from the shipped part: the real workspace drops its
      `postbuild_layout.py` once its deck.mdx moves to `place:`, `{sup}` and the two options (the
      user's call; build alone placed 42 captions and 20 panel pictures there, 2026-11-10).

139. **Resume build lays out what the template means, not only its text (later)**
    - Why: same review. Shipped 2026-11-10: the template photo survives build. Still patched by hand
      after every build (`postbuild_resume.py`, macOS `sips`, so not on Linux): career section on a
      new page, company lines larger, space under description/stack/role lines, photo replaced by
      the deck's. The user also asked for a different section order (2026-11-09). User,
      2026-11-10: "resume는 조금 천천히" — after 136-144.
    - Acceptance: those layout rules expressible in `resume.md` or read from the template;
      `test_resume.py` with counts; one real run with no post-build script.

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
      through `write:like-me` (`d1b2cf8f`, SKILL only). Left: the user's own template, two texts they
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

134. **`repo-rules.mjs` denies a repo write reached through a symlinked path, even when its parent directory is new**
   - Why: carryover of card 131 (E-f1f5fcf7, 2026-11-10, report §5). With the entry checks fixed, `echo x >
     <symlinked-prefix>/teams/a.md` and `cd <symlinked clone> && sed -i ... teams/mcp/x.mjs` pass under `tmpdir()`
     and are denied under `realpath(tmpdir())`. Cause named by the report, unverified here: the `samePath` fallback
     to `resolve()` at `.claude/hooks/repo-rules.mjs:304` when the parent does not exist, and `cd` targets are not
     canonicalized. The test now resolves its fixture root (`root = realpathSync(mkdtempSync(...))`), so no test pins
     this; with the old root line the test gives 269 ok / 2 FAIL (`write: absolute repo path`, `write: cd into the
     repo from outside it`).
   - Acceptance: a test with a symlinked, non-canonical root denies both writes; `node
     _repo/scripts/test-repo-rules.mjs` 0 FAIL.

132. **A mod or plugin hook skipped by another plugin's hook is known and its loss is covered**
   - Why: seen 2026-11-10 in a live session: "session: its classic.SessionStart hook was skipped.
     "cc-plugin-sec-default" runs first and sent the event on past it", and the same for trophy's `skill.prompt`, after
     a skill was invoked, and later for trophy's `classic.UserPromptExpansion` (`trophy/hooks/mod.tsx:546`) on a
     typed `/backlog`, and 2026-11-11 for trophy's `classic.PostToolUseFailure` after a refused tm_open. The session one is `session/hooks/ensure-trophy.sh`. `trophy/hooks/mod.tsx:440` already
     expects the `skill.prompt` skip and `:565` covers only a typed skill. What is lost for a skill the model invokes,
     and for `ensure-trophy.sh`, is unverified.
   - Acceptance: one live session under that policy states, per skipped hook, what stops working; a model-invoked skill
     is either recorded by trophy (a `plugin test` case on the path that sees it) or the gap is stated in trophy's
     README/KOR; `ensure-trophy.sh`'s job has a path that does not depend on the skipped event, or is retired.

### Subagents and parallel runs — use and clean up (user, 2026-10-17)

### teams plugin bugs

Order (user, 2026-11-06: "125, 130, 129 128순으로"): 125 → 130 → 129 → 128's leftovers.

145. **tm_open takes `request` and `requests` together when they say the same thing, so callers stop failing on it**
    - Why: user, 2026-11-10 (trophy Failures tab screenshot: "이거 backlog에 쌓아주고"). `mcp_error ·
      tm_open` "tm_open takes request OR requests, not both" recorded 7 times, 2026-10-16 to 10-31.
      Thrown at `teams/mcp/taskmanager-stages.mjs` ~338 whenever both are non-empty. Which caller
      sends both is unverified (the Sprint skill documents `requests` at `teams/skills/sprint/SKILL.md`
      ~42; a session also passing `request` as the Sprint title is the likely shape).
    - Acceptance: `request` equal to `requests[0]`, or used as a title beside `requests`, is accepted
      (or the error says which one to drop, with the caller's own values); every skill that calls
      tm_open shows one form only; a test for both shapes; `node --test teams/scripts/test-*.mjs`
      with counts.

146. **tm_clean on a running task waits or says how, instead of failing the call**
    - Why: same screenshot. `mcp_error · tm_clean` "task … is running (daemon alive, pid …) — tm_clean
      only cleans a task in a terminal state" on 2026-10-21 and 10-26
      (`teams/mcp/taskmanager-handlers.mjs` ~651). The caller cleaned before the task ended; which
      skill or session did is unverified.
    - Acceptance: the skills that reap (orchestrate, sprint, maintaining's "Reap" rule) call
      tm_wait to a terminal state before tm_clean, or tm_clean takes `wait: true`; the refusal stays
      for an explicit clean of a live task; a test; teams tests with counts.

147. **trophy's Failures tab says what failed and groups repeats**
    - Why: same screenshot. `outcome · goal_failed · —` and `outcome · subgoal_failed · —` (2026-11-09)
      carry no target and no text: `trophy/hooks/failures.ts` ~85-90 maps the harness outcome to a
      reason only. The same tm_open error fills seven rows one under another.
    - Acceptance: an outcome row names the task/run and the failed gate or subgoal (what the harness
      outcome carries); identical reason + target rows fold into one with a count and the last date;
      `claude plugin test` with counts; one live look at the tab (mod.md "A UI change is done when").

125. **teams retires the web viewer; `/teams-status` is the one live view, raised in quality** — E-8faf33b9 blocked on a PRD merge bug (fixed `899dba47`); E-701e2856 (2026-11-07, $35.82) planned
   it again (5 cards 88–94, plan-integrate accepted) and stopped partial at shape:3 (see card 129). Now one
   size-S task per feature area, in order F1 → F5 → F3 → F4 → F2, each from its section of that PRD (kept
   at `tmp/card125/F<n>.md` until the card closes). F1 shipped `c8328deb` (E-7b9c49d9, gate 95; teams
   2116/2114, 2 skip; plugin test 453/453; Status line kept at `tmp/card125/status-F1.md` for the bump).
   F5 shipped `69c87a22` (E-efbb047d, gate 96; plugin test 465/465, teams 2114/0/2); live look on a pane
   surface after the bump. F3 shipped (E-dcacc53c, gate 93; teams 2170/2168, 2 skip; plugin test 465/465;
   $35.52 of $30); a real EPIC through Build is still to be watched in the pane. F4 shipped partial
   (E-a6936957, gate 88; teams 2184/2182, 2 skip; plugin test 546/546; $32.47 of $30): the Decisions thread
   draws actor `human` and engine-composed reasons (`size S · develop`, `resplit → areas:N`, `never
   dispatched`) in English; carried into F2, which replaces that page (`tmp/card125/F4-gaps.md`).
   F2 shipped `286bf598` (E-b2f3c230, gate 93; plugin test 565/565, teams 2220/0/2; $41.88 of $40), F4 gaps
   closed. Demo renders approved (user, 2026-11-10: "125 고"). Live look 2026-11-10 in tmux at 190 and 110 on
   E-f1f5fcf7 (size S): open by command and band, w/s/d/a/l, close by Esc, q and the command again all work;
   five defects found. E-bcc5a0fe (2026-11-11, size S, gate 90, $37 of $40) shipped `4aab562f`, unbumped:
   `⏎ submit` gone from the keys footer and truncation keeps `a back`/`q close`; FLOOR and Phase detail follow
   the running stage (size-S Plan: 1 working on Plan, driver listed); the crumb keeps its tail and the EPIC
   title shortens; HOME draws a size-S EPIC once; Esc while answering drops the draft and says so;
   `answer.mjs` on a task with no nodes says so; `foldPackageHistory` takes the highest attempt;
   `test-docs.mjs` asserts both halves of "left over"; STORY report Judge row draws `tests pass`. Checked by
   hand: plugin test 626/626, teams 2224/0/2 of 2226, validate 15/15, check-copies ok. Renders of every page
   at 190/110 en/ko in `tmp/card125/renders-fix/` (52) approved (user, 2026-11-11: "고").
   Still to do: the STORY report header's `accepted 91/80` stays English under KR; the close command answering `pane opened` (did not reproduce live in
   E-bcc5a0fe, two-copies cause ruled out under `--plugin-dir`; cause unknown, watch for it on the installed
   build); the host still draws a bare ⏎ after the keys Input outside answer mode (host behaviour, room kept
   for it); a look in the Claude app or Desktop; "→ you" vs "→ me" wording; README/KOR shots with the batch
   bump. Also open from the F2 report: EPIC report render stays 7 lines (no verdict or result) and FLOOR lacks
   role counts and "STORY n / subagent n" (the engine does not send them).
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
     Shipped `b6d338ef` (E-0ad41780) except the CPU bar on the real root: one server per root, idle-out,
     detached from the starting session; measured 2026-11-04 18:30 on `~/.harness/tasks` (1108 entries):
     no clients 0.07%, one session's 3 s events + status poll ~4% (synthetic root 0.85%). The rest shipped
     `bb9b643f` (E-066abb46, gate 91): real-root poll 1.55% → 0.38%, server log, relative
     `HARNESS_TASKS_DIR` in the mod, default-on CPU guard. Socket part done.
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
     Mocks approved again (user, 2026-11-06: "panemock good , 영, 한으로 노출 조정할 수 있으면 좋겠고"):
     every page's text switches between English and Korean from the pane itself (one key, shown in the
     footer, kept across reopen in `$.state`; the default stays Claude Code's `language` setting,
     `teams/hooks/mod.tsx:494`); no string outside the one two-language table; a `pane.ts` test per page
     renders both languages with no label left in the other one.
   - The command's chat text (user, 2026-11-05, on `/teams-status` printing the whole status block —
     `teams: E-258fa3e5 …`, `RUNNING ▰▰▱▱…`, `▸ Build · …` and every row — into the chat beside the pane):
     "채팅에 … 같이 그리지 마라 mobile이 아니라면". Acceptance: on terminal, desktop and vscode the command
     opens/closes the pane and returns nothing to the chat (at most one line); on mobile it keeps the text;
     headless `{ text }` unchanged (`mod.md` rule 7); a `claude plugin test` case per surface.
   - Wrong state in the pane (seen 2026-11-05 10:31, E-258fa3e5): it read `STALLED`, phase `Plan`, `Progress
     0%` and only QA cards under "Up next" while P1–P3 had been dispatched at 10:10 and their three drivers
     were writing output; a later open showed `RUNNING`, Build, 17%. Cause unverified (stale read before
     `/reload-plugins`, or the stall verdict read from the planning cards). Acceptance: the pane's state
     and phase come from the engine's own status for the task, a test with dispatched packages and an old
     planning-card mtime shows Build and not STALLED.
   - Progress that moves (user, 2026-11-05, on `Progress 17%` staying for hours while P1–P3 passed:
     "왜 아직도 17%?", then "이것도 backlog"): `teams/scripts/lib/view-dashboard.mjs:50` counts only finished
     stages (1 of 6 = 17%), so Build reads 17% until all eight packages pass. Acceptance: progress counts
     work inside the running stage (accepted packages / packages for Build, QA cards for QA), shown as
     stage and package count (`Build 3/8`); a test with 3 of 8 packages accepted reads above 17%.
     Same for a size-S task (seen 2026-11-05 on E-1140cdb9: 17% while SG1 was implemented and under
     test): progress comes from the harness run's `now.json` and subgoals (`SG1 test · 1/2`), with a test.

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

128. **teams serves one MCP server, its internals split into modules by concern** — shipped on main, unreleased: P1–P3 `f46cfa6d` (E-258fa3e5), taskmanager facade + 14 modules
   `85175bbc` (E-1140cdb9, gate 95), one server `teams/mcp/server.mjs` `9db4e615` (E-d26f7a29, gate 91;
   suite 2140/2137, plugin test 448/448, real `claude -p --plugin-dir` lists 33 tools from one server).
   Async abortable `tm_wait` and the stale comments shipped `bb9b643f` (E-066abb46).
   Left: release note on the tool prefix change
   (`mcp__plugin_teams_task-manager__*` → `mcp__plugin_teams_teams__*`, allowlists stop matching); one real
   S and one real L task on the installed merged server after the batch bump; `ps` one teams process.
   - Why: user, 2026-11-04: "teams의 mcp 하나의 서버로 통합 및 노출 내부 mjs 코드 스플릿으로 가독성 및
     유지보수성 증가". Today `teams/.claude-plugin/plugin.json` starts three servers per session —
     `teams-engineering` (`mcp/broker.mjs`, 2,479 lines), `task-manager` (`mcp/taskmanager.mjs`, 9,028 lines,
     280 top-level functions, 97 exports) and `teams-wiki` (`mcp/wiki.mjs`) — each with its own copy of the
     stdio loop (`handle`/`callTool`/`emit`, broker 2327–2440, taskmanager 8924–9028, wiki 627–631), and the
     copies have drifted (broker handles `notifications/cancelled` and progress, taskmanager does not).
     Engine analysis of the same day ranked the splits: the manager prompts (`composeTaskPrompt` 4305–4788),
     `finish` per stage (5059–5359), the tool schema table + `dispatch` (5404–5654, 8891), the worktree/git
     cluster (2388–2913), the driver/daemon process cluster (3051–3500), one verdict-field map (five copies).
     Supersedes card 120's teams parts (b) and (c); goes with the absorb plan
     (`_repo/docs/plans/2026-11-04-teams-absorbs-harness-graph.md`), whose run layer is the broker.
   - Acceptance: one `mcpServers` entry in teams; every tool now reachable (`tm_*`, `team_*`, `wiki_*`) is
     listed by it under its current name (a test compares the tool list before and after); one stdio loop
     with cancel and progress for every tool; `taskmanager.mjs` and `broker.mjs` reduced to wiring, each
     concern in its own module with its own test file, no file over ~1,500 lines; no behaviour change —
     `node --test teams/scripts/test-*.mjs` at the pre-change count with 0 failures, `claude plugin test`,
     and one real S and one real L task run on the merged server; `ps` shows one teams MCP process per
     session.

129. **teams tells failure kinds apart instead of retrying every failure the same way**
   - Why: five engine defects seen in the portfolio Sprint E-478d5e95 (cards 123/124, 2026-11-04/05), reported
     by that session; common cause (its words): "엔진이 모든 실패를 '다시 하면 되는 것'으로만 다룬다". Causes
     below are as reported, unverified here.
   - Seen again 2026-11-11, E-89982ed5 (card 130, L, $15.74, partial in planning): plan-integrate rejected 3 times
     for the same two PLAN-F2 gaps (broker spawn sites out of F2's Scope; `tasklog.mjs` named as the ledger
     writer), each round saying only F2 must change; F2's attempts 2-3 did not close them, and the partial reason
     names `dispatch:PLAN-F2:2` "no retry left" although attempt 3 was accepted 92%.
   - Seen 2026-11-06, E-8faf33b9 (card 125, L, $47.29, blocked at 09:23): all five planning cards accepted
     90–95, then plan-integrate rejected 3 times and the task blocked with "no retry route is left". Round 3
     was an engine artefact, not a planning gap (verified): `10-prd.md` holds F4 twice (lines 637 and 792)
     because `cardDocuments` (`teams/mcp/docs.mjs:167`) keeps `prd_paths` entries by their string, and the
     card listed `10-prd-F4.md` and its absolute path. The judge blamed PLAN-F4 and the integrate budget ran
     out. The report stage then failed with no reason. Acceptance: `prd_paths` deduped by resolved path,
     a test with a relative and an absolute path to one file; an engine-made defect in the merged document
     does not spend the planning card's integrate round; a failed report stage records its reason.
     Dedupe and report reason shipped `899dba47` (E-beccd3c6, gate 95).
   - Seen 2026-11-07, E-701e2856 (card 125 again, $35.82): planning accepted, then shape failed 3 times on
     its structural check and the task ended partial. The PRD held 25+ stories and 187 ACs, and shape must copy
     every AC verbatim into a package; each round dropped a different handful (round 1: AC-15, F4-AC-28..31;
     round 2: F2-AC-27, F3-AC-4/5, AC-7; round 3: five stories unassigned). Some ACs carry no area prefix
     (`AC-15`, `AC-7`), so the check matched them to the wrong story. Acceptance: shape's repair round is
     told only the missing ids and keeps the rest of its last shape (no fresh redo); AC ids are area-prefixed
     at plan-integrate; a test with a 150-AC PRD where round 2 fixes round 1's misses.
     1. Usage limit: a driver hit the 5-hour limit, parked on `waiting_capacity`, and never resumed by itself
        after the limit reset — twice, the second for hours.
        The opposite seen 2026-11-08/09 on E-b2f3c230 (weekly limit, "resets Nov 10 at 6pm"): the daemon cleared the
        park and respawned the driver 46 times (`reset_capacity`, about every 33 min at the end) before the reset time,
        each re-parked within seconds. Acceptance 1 also means no respawn before the stated reset time.
     2. QA can never pass: a QA card's done condition is a subagent writing `report.md`, which Claude Code
        denies a subagent by default; QA failed three times on that, and the engine retried it as an
        implementation failure.
     3. Pass under the bar: goal gate threshold 90, P3 accepted at 87; what it left out surfaced later as 28
        QA defects.
     4. Defect fixes conflict: each fix package branched from the same base with no integrate between them;
        D8, D12, D13 and D15 touched the same files and conflicted at merge.
     5. `tm_retry` on a task that ended blocked spawned no daemon; a new Sprint had to be opened.
        Seen again 2026-11-05 on E-258fa3e5, cause verified: the daemon (pid 21066) exited at
        `daemon_done` but stayed a zombie (`<defunct>`, STAT Z) because its parent, a long-lived
        `taskmanager.mjs` MCP server of another session (pid 54355), never reaped it; `driverAlive`
        (signal 0) counts a zombie as alive, so `serviceDaemon` never respawned it and tm_status
        reported `daemon alive`. Also seen: `tm_retry({package_id: P4})` twice in a row left two
        dispatches (P4:4 respawned by the second call, P4:5 new) driving one worktree; and P4:4
        started on a stale base (P3+P1 only, not P2) though the retry came after the deps changed.
        6. Two parallel packages edited the same function of a test file (`test-defaults.mjs`, P2 and
        P3, both after an ask answer allowed the edit) and P4's base merge failed → `dispatch_failed`
        → `daemon_done`, task blocked for 2 h with nobody told (no push notification, band unchanged).
   - Acceptance: each failure is classified (capacity, permission/environment, below-threshold, merge
     conflict, ended task) and recorded on the node, and each kind has its own path, with a test per path —
     1. a `waiting_capacity` dispatch resumes on its own once the limit's reset time passes (daemon tick),
        no `tm_retry` needed;
     2. a QA report is written by a path the driver is allowed to write (or by the engine from the QA
        result), and a denied write is classified as environment, not retried as implement;
     3. no package or gate accepts with `match_pct` below `goal_threshold` (a test with 87 vs 90);
     4. fix packages touching the same files run in series or branch from the last accepted fix, and an
        integrate runs between waves; a test with two fixes on one file merges clean;
     5. `tm_retry` on an ended blocked task starts its daemon and continues from the blocked node; a
        zombie daemon pid reads as dead (check process state, or reap: spawn the daemon so the
        server waits on it); a package retry supersedes and kills the previous dispatch's driver,
        never respawns it, and rebases the worktree on the deps' current heads;
     6. a blocked task notifies the person (push notification and band) the moment it stops;
     then one real L task where a fix wave and a QA pass complete with no hand merge.

130. **teams spends less per task: model per stage, lean driver sessions, a default budget** — E-89982ed5 (2026-11-11, L, $15.74) stopped partial in planning, no code: PRDs F1 (model per stage), F2 (lean sessions), F3 (budget) accepted and pinned on `rescue/card130-prd-f{1,2,3}`; plan-integrate failed 3× on F2 (see card 129). Light PLAN chain confirmed (A4.3). Next run starts from those PRDs with F2's two gaps decided; real-L cost comparison left to the card 129 Sprint
   - Why: E-258fa3e5 (cards 128 + 125 leftovers, opened 2026-11-05 09:25) cost $14.4 over 28 sessions
     before shape started (planning only). Again 2026-11-05: E-066abb46 (size S, Sonnet) spent $48.39 of a
     $25 budget, `budget_stopped` only after the gate passed (197 min); `/teams-status` showed the same
     task at "Cost $21.84 · Budget $21.84 of $25.00" (2026-11-06), so the pane's cost disagrees with the
     ledger's `spend` (cause unverified). Cost sources named in the session (2026-11-05), checked where
     marked:
     1. Every node is a fresh `claude -p` session that re-reads the rule files and the global CLAUDE.md
        (@MCP.md, ORCHESTRATOR.md, …); planning alone runs investigate, draft, gate and integrate per card
        (unverified which files load).
     2. Judges are separate sessions too — judge, each critique round, goal gate — each re-reading the same docs.
     3. Nearly everything runs on Opus: 6 of 9 ledger actors read `claude·claude-opus-5-5` (checked).
        Implement and test on Opus multiply the cost.
     4. Large files read whole: card 128's 9,000-line `taskmanager.mjs` re-read by every node.
     5. Identical retries (card 129: QA failing three times for one reason) are spent cost.
   - Acceptance:
     - model per stage in `team.json` / tm_open (implement and test on Sonnet, plan and judges on Opus by
       default), recorded per node in the ledger; a test that an implement node starts with the Sonnet model;
     - drivers start without the user's global CLAUDE.md and unrelated plugins (only teams' own skills and
       the project's rules); a test on the spawn command, and a before/after of input tokens per session on
       one real S task;
     - confirm `roles.planning: "auto"` ran the light PLAN chain when every request declared acceptance
       (E-258fa3e5 did); if not, fix and test;
     - a default `budget_usd` in this repo's `.claude/team.json` (today `null`);
     - `budget_usd` also bounds a size-S run: E-1140cdb9 (S, budget $20, on Sonnet) spent $40.94 and
       `budget_stopped` fired only at the end, since the stop only holds back new packages and S has
       none; the S driver is stopped at the budget like a package, with a test;
     - node prompts point at file regions (line ranges, symbols) instead of whole large files where the
       stage allows;
     - one real L task's cost compared to E-258fa3e5's per-stage cost, numbers in the report.
   - Measured 2026-11-05 on E-258fa3e5's P3 driver: a fresh session starts at 54k tokens of context —
     12 plugins, 93 skills, 124 tools, 12 claude.ai connectors (Notion, Slack, Figma, Datadog, …) and the
     sec/telemetry plugins — and re-sends it on every API call (144 calls, 54k→85k each, 22M cache-read).
     `driverArgv` (`teams/mcp/taskmanager.mjs` ~3084) passes `--setting-sources project` but every
     STAGE_SKILLS plugin dir, no `--strict-mcp-config`, no `--model`. The Sonnet rule existed only for
     subagents in this repo; E-258fa3e5 was also opened without tm_open's `model`.
   - Direction (user, same day): "모든 컨텍스트를 주지 않고 필요할 때 Leader가 주면 될거 같은데" — a driver
     starts lean (its stage's skills only, no connectors) and the TeamLeader hands it a doc, region or rule
     when it asks, instead of every driver carrying everything. Acceptance adds: drivers spawn with
     `--strict-mcp-config` and only the stage's plugin dirs; start context under 20k tokens (measured from
     the init stream); a context request goes through the leader (tm_ask or card 126's bus) and is logged.
   - Shape (user, same day): "한 세션에 많은걸 주지 말고 차라리 여러 번 세션을 sonnet으로 자주 여는게 나을거
     같아" — many short Sonnet sessions, one small job each (one node or one subgoal step), instead of one
     long driver session carrying a whole child run (P3's driver: 144 calls, context grown to 85k).
     Acceptance adds: a session ends when its node ends and the next node gets a fresh one with only that
     node's brief; per-session call count and peak context recorded in the ledger; the real L task shows
     a lower peak context and cost per package than E-258fa3e5.

105. **Repo-wide pane and one viewer: UI look and the loose ends** — code defects in E-03e2e513; cards 105 and 106 shipped 2026-10-30 in
    E-f53a8434 (`32db1917`; goal gate 92; teams 1658/1660 with 2 skips, plugin test 423/423; real run: two
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
    - Code defects fixed 2026-10-31 in E-03e2e513 (`e552afcb`; goal gate 93; teams 1704/1705, 1 skip):
      contractions keep their word (`its-broken`), exact slug beats id prefix, join and fallback tested on
      a scratch default port, listen errors exit 1 with one line, stop-rule comment fixed, `⑂` tail cut to
      `…` tested on 4 surfaces.
    - Live look 2026-10-31 (main checkout, E-7970d4b5 running in `../claude-skills-c108`): the pane and
      band now list the worktree task (was "no task running"); q, Esc and the command again close it.
      Defect: the `⑂ <worktree>` mark is appended after the title (`teams-draw.tsx:219`, `mod.tsx:962`),
      so it is cut off first and never shows at 190 (row `Backlog card 108 (teams plugin), in…`) or 110.
    - Fixed 2026-10-31 in E-d19daa16 (`5cf0bbda`; goal gate 95; plugin test 431/431): the mark is drawn
      before the title. Live look (E-7e44f783 running in `../claude-skills-c109`): 190 row
      `E-7e44f783  ⑂ claude-skills-c109 · Backlog card…   running  0/0  34s`, band
      `teams · ⑂ claude-skills-c109 · Backlog card 109 …`; 110 row `⑂ claude-sk…`, band `⑂ claude-skills-c…`.
      `node -e '[1,2].map(x => x*2)'` runs, not refused (the earlier refusal not reproduced).
    - Acceptance (left): the user approves the 190/110 captures.

133. **teams is measured against gstack and cursor/plugins in one written report**
   - Why: user, 2026-11-10: "https://github.com/garrytan/gstack, https://github.com/cursor/plugins 분석 Fable5.2로
     + teams와 대조(Fable5.2) 및 리포트 작성(Opus 5.5)".
   - Acceptance: analysis of each repo and the contrast with teams run as subagents on Fable (the user named Fable
     5.2), the report written on Opus 5.5; each repo is read at a pinned commit and every claim about it cites a
     file there; the contrast covers what teams does (stages and gates, task/EPIC/STORY model, drivers and
     parallel runs, human asks, the pane and band, cost and budget, install and config) and says per row which
     side does it, how, and whether teams should take it; borrowed ideas are named as ideas, no code copied;
     the report lands in `_repo/docs/plans/` dated, and what teams should take
     is listed at its end for the user to choose (no cards filed without that choice).

135. **The two resume tests in `teams/scripts/bench/test-drive-gh.mjs` finish under their 60 s limit**
   - Why: seen 2026-11-10 while checking card 131: `node --test teams/scripts/bench/test-*.mjs` 78 pass / 2 fail,
     both in `test-drive-gh.mjs` ("a gh-* job that hit a usage limit is resumed by resume.sh in the hashed
     workspace", "resume of a non gh-* workspace works through the same arguments"), each cut at 60 s with exit
     `null`. The same 2 fail at `bc4a8601`, before card 131's change. The load average was 84 on 8 cores; whether
     they pass on an idle machine is unverified.
   - Acceptance: both tests pass on an idle machine, or the hang is found and fixed; `node --test
     teams/scripts/bench/test-*.mjs` 0 fail.

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
  critique rounds, goal gate, Codex fallback; E-c5c109e3) and Task 6's first half (0ae40e03) shipped,
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
| E-f1f5fcf7 | 2026-11-10 | 131 | shipped `5a9644c8`; size S; goal gate 90; entry checks of `repo-rules.mjs` and bench `harvest.mjs` compare real paths (reap.mjs form); test-repo-rules 188 ok / 75 FAIL → 271 ok / 0 FAIL, 8 new symlink/space entry cases; 0 FAIL needed the test's fixture root resolved to its real path (lead's decision, no person reachable), the write-through-symlink defect it hid is card 134; validate 15/15, check-copies ok, test-harvest 3/3 |
| E-066abb46 | 2026-11-05 | 125 (socket rest), 128 (tm_wait, comments) | shipped `bb9b643f`; size S on Sonnet; goal gate 91; state server skips unchanged tasks (fixture 2.10% → 0.90%, real root 1.55% → 0.38%), server log, mod resolves relative tasks dir, CPU guard default-on passed 3 suites of 2154 (only fail W2 hygiene from a stray `.teams_wiki/`); `tm_wait` awaited + abortable, `team_status`/`wiki_list` answer behind it (red on baseline); plugin test 453/453, view/server tests 386/387 (1 skip); spend $48 of $25 budget (card 130); thin CPU margin, 60 s safety-net rebuild |
| E-d26f7a29 | 2026-11-05 | 128 step 2 | shipped `9db4e615`; one MCP server `teams/mcp/server.mjs`, 33 tools; gate 91 |
| E-0ad41780 | 2026-11-04 | 125 (socket part) | shipped `b6d338ef`; size S; goal gate 90; `teams/mcp/stateserver.mjs` one socket per tasks root, mod dials it (proto=1, 409 → `--once`), `view.mjs --serve-once-socket` removed, `--once` unchanged (view tests 334/334); s1 and s3 each needed a second attempt (flaky CPU test → opt-in `TEAMS_STATE_PERF=1`; server died with its tmux session → detached, SIGHUP ignored); teams 1827/1829 (2 skip), plugin test 448/448 (re-run by hand); real-root CPU ~4% per polling session, not <1% — left on card 125; critique ended at its 2-round cap with 3 majors open; driver paused 1 h on the 5-hour limit; Codex unreachable |
| E-6ff25a30 | 2026-11-04 | 121, 112 | shipped `ea50578a`; size S; goal gate 82 fail → one repair (edit-claim overlap only) → 91; `test-taskmanager.mjs` file-level temp tasks root (temp-HOME suite leaves 0 entries; a real-HOME run went 1105 → 1108 with other tasks live, not attributed); `areas-critique` blocks an edit-ownership overlap naming one owner; teams 1813/1814 (1 skip, 0 fail, re-run by hand), plugin test 445/445 (task's count); last critique round's fixes not re-critiqued; Codex unreachable, Claude did all nodes |
| — | 2026-11-04 | 101, 81 closed on evidence | 101: E-bf0527b7 (teams 0.62.7) ran `dispatch:P1:2` and `dispatch:P2:2` together from 05:45 (spawned 1 s apart) and P3:2 with P2:3 from 07:19, no `auto_parallel_decreased`; 81: E-a9953265 (size S, teams 0.63.0) `scope_verdict` `own_record: true`, Codex `apply_patch` limit stays named in teams README/KOR |
| E-a9953265 | 2026-11-04 | 122 (75 closed without code) | shipped `4e9fbbcc`; size S; goal gate 93; test-diagram 118/118 in 34 s (was 148 s on the card, 210–323 s under load); one Chrome shared over CDP only in the suite, the CLI path unchanged |
| E-bf0527b7 | 2026-11-03 | 113, 49 rest, 94 rest, 84 rest | shipped `58af948f..e7f52a79` by hand (cancelled in Build, ~$80): P1 (113) accepted 92 — one viewer per tasks root reused by live pid, finished tasks cached by mtime/size, 5 min idle exit; P2 (49) live forwarded STORY ask in the ledger and the band shot, stalled twice in a tmux wait (taken from attempt 3); P3 (94) 85 at retry 4, its one gap (P1's golden test scrubbed instead of recut) fixed by hand; P4 (84 design doc) never ran. teams 1792/1793 (1 skip), plugin test 445/445; 3 usage-limit parks. E-96699aa4 cancelled in PLAN to pin the viewer design |
| E-16e58ff6 | 2026-11-03 | 114 | shipped `4195a423` by hand (task blocked): P1 accepted; P2 rejected 3× only for touching P1's test-diagram.mjs (pixel window 420x40→420x100); merged tree test-diagram 118/118, check-copies ok, validate 15/15; 2 usage-limit parks; test-diagram 148 s (card 122) |
| E-c4d76843 | 2026-11-02 | 119 | shipped `fcf2a59f`; size S; goal gate 94; cache/memo tests 2/2 (falsified), `events` with an old `--since` 2.9 s → 0.18 s byte-identical; repo-rules refuses inline-script repo writes (263 ok); teams 1778/1779 (1 skip); a perl `>>` false positive fixed after the gate; `--cwd` now includes a task whose collect fails but task.json reads (untested) |
| E-3a668d18 | 2026-11-02 | 118 | shipped in teams 0.62.7; size S; goal gate 91; `retryReport` reruns only a failed report (avoid_executors, different_vendor), size-S driver not respawned on an unchanged blocked run (`harness_run_stuck`), tm_retry retries it; red-first tests; teams 1776/1777 (1 skip); no live end-to-end run of a failing report yet |
| E-db189f56 | 2026-11-02 | 117 | shipped `ea4445fa` in teams 0.62.6; size S; goal gate 85 (partial: thin CPU margin, caches untested → card 119); incremental ledger store, per-tick shared bases, `view-once-<version>.sock`; 3 sessions 60 s: 4 s CPU over 62 s (~6.5%, was ~45%), 114 asks, 0 non-200; teams 1767/1768 (1 skip), mod 442/442 |
| E-1476d4db | 2026-11-02 | 102 (settle) | shipped `7270477e`; size S; run blocked at its report node (card 118), CLI check run by hand; manage 48/48 |
| E-bd74d6ca, E-6a0d66eb | 2026-11-02 | 116 | shipped `86bd2fe8`, `30a8222d` in teams 0.62.5; size S; goal gates 88 (partial: `teams` format compared with its render time masked) and 95; one shared server on `~/.harness/view-once.sock`; `events` 2.4 s → 0.17 s (stats ledgers first); live, 3 sessions: one server in 60/60 samples, no `--once` spawns, server ~45% of a core (was ~80% for one session before the events fix); teams 1756/1757 (1 skip), mod 441/441; sharing across sessions left for card 117 |
| E-0b44dd5c | 2026-11-02 | 115 | shipped `4fc2480b` as hotfix teams 0.62.4; size S; goal gate 93; mod tests 439/439, teams 1745/1746 (1 skip); live: plain home folder 0/60 samples with `view.mjs`, this repo 59/60; a stray `/tmp/.teams_output` (2026-09-23) makes every folder under `/tmp` count as teams |
| E-eb930c1a | 2026-11-01 | 100 (theme) | blocked at integrate (D2/P1 conflict in test-diagram.mjs); merged by hand `89e8c161`, test-diagram 112/112; P2's renders partial (print theme roles by shade only); approval of the theme PNGs left |
| E-6e771dea | 2026-11-01 | 81 rest | shipped `d24fff8d`; size S; goal gate 94; chained own-write test 9/9, limits in README/KOR/CHANGELOG; live `own_record:true` left (needs a session on the bumped teams) |
| E-7d6199b9 | 2026-11-01 | 107 | shipped `b5fa4852`; size S; goal gate 92; bare `tm_retry` resumes an exhausted dead daemon on its run dir; parent-kill survival test; test-taskmanager 373/373, teams 1736/1737 (1 skip); cause of the session-exit kill still unverified |
| E-e6f71ab7 | 2026-11-01 | 110 | shipped `2c01a0cb`; size S; goal gate 90; gate 29/29 with env cleared and inherited (the 15/6 split was inherited `HARNESS_NODE=1`); real hook run: other session DENY, opener ALLOW; a task with no opener id still unlocks (legacy) |
| E-51309bd7 | 2026-11-01 | 111 | shipped `51175e60`; size S; goal gate 93; shapecheck 22/22, teams 1726/1727 (1 skip) |
| E-15aeadfe | 2026-11-01 | 110, 107, 81 rest | partial, $22.98, planning only: plan-integrate refused F2/F3 both owning the teams docs; PRD reused by the three size-S runs above |
| E-da411582, E-7626467d, E-b0b206cc | 2026-11-01 | 100, 49 | stopped in planning: 100 on the card-111 AC clash (reopened as E-eb930c1a with unique AC numbering); 49 sized too small, then the AC check again (rerun after the bump) |
| E-54884e0c | 2026-10-31 | 100, 102 rest, 49 rest | blocked (goal gate 82/90); 100's colour work taken by hand (test-diagram 92/92), 102's `settle` and 49's runbook not taken |
| E-8c671fd9 | 2026-10-31 | 110, 107, 81 rest | partial: planning only, critique failed shape 3; findings on the cards |
| E-d50a6887 | 2026-10-31 | 108 | tests only, no version bump: poll non-overlap test (`mod.test.ts`: no second `--once` while the first runs) and a load-independent perf test (`test-view-once-perf.mjs`: second call reads only the open task, 300 ms bar opt-in via `VIEW_ONCE_PERF=1`) |
| E-2694667a | 2026-10-30 | 108 | partial: teams 0.62.1, `--once` filters before collecting and indexes finished tasks (`.view-index.json`), rebased onto 0.62.0's repo-wide matcher; real status call 7.96 s → 0.40 s; 300 ms fixture test is best-of-10 (single calls flaked 306–399 ms under suite load); poll overlap guard left (108) |
| E-a7996a31 | 2026-10-30 | 87 rest | shipped `fb090792`; size S; goal gate 91; limit named in the PRD gate prompt (a Jaccard ≥ 0.63 rule passed both tests but missed the one real paraphrase, J=0.38, so declined); teams 1681/1682 |
| E-233f8dca | 2026-10-30 | 81 rest | shipped `3cc7db00`; size S; goal gate 90; own-write hook + fallback-route verdict gates; teams 1679/1680, plugin test 411/411 |
| E-0a2ab67f | 2026-10-31 | 101 first tick | shipped (merge of `583c46e3`); size S; goal gate 95; test-taskmanager 371/371 in run; real width-2 Sprint left |
| E-7e44f783 | 2026-10-31 | 109 | shipped `8aa01310`; size S; goal gate 93 (r1 82); cause verified by test, not ledger (E-ea14c9c4 cleaned): `settleQaRound` deduped by title and repro only; teams 1717/1719 (1 load wall-clock fail, card 108) |
| E-d19daa16 | 2026-10-31 | 105 ⑂ mark | shipped `5cf0bbda`; size S; goal gate 95; plugin test 431/431; captures awaiting approval |
| E-7970d4b5 | 2026-10-31 | 108 | merged `a7a64564` locally, then reverted: another session shipped card 108 first as teams 0.62.1 (E-2694667a), kept that one; size S; 32.3 s → 0.38 s, but its wall-clock tests went red under load |
| E-f53a8434 | 2026-10-30 | 105, 106 | shipped `32db1917`; size S; goal gate 92; teams 1658/1660, plugin test 423/423; UI look left on card 105 |
| E-ce2bcff4 | 2026-10-30 | 101 | merged `95bfa881` locally, then reverted `fc5c7d95`: another session shipped card 101 first as teams 0.61.5 (E-ea14c9c4), kept that one; size S, goal gate 92 |
| E-db7e3226 | 2026-10-30 | 94 defects | shipped `d64b8956`; size S (resumed from E-4f12f406); goal gate 91; plugin test 411/411; captures awaiting approval |
| E-ea14c9c4 | 2026-10-30 | 101 | partial: teams 0.61.5 `f343148d` taken by hand (P1, D1–D5, D13, P2; teams 1660/1660); integrate:3 blocked on duplicate QA defects (card 109); first tick and a real width-2 run left (101); $61.49 |
| E-eb3d399f | 2026-10-29 | 100 | partial: P2 + D1 shipped and P1 taken by hand from its worktree (`47dcc4d8`); P1 'blocked: tool denied' ×3 on the 0.60.1 engine, P3/P4 unreachable; $48.72 |
| E-124098e5 | 2026-10-15 | 10–13 | shipped `0b842b46`; size S (one harness pass); goal gate 91; $17.74 |
| E-c313c8f1 | 2026-10-15 | 2 | shipped (rules say `origin`); size S; $3.89 |
| E-e9a37754 | 2026-10-16 | 1 | shipped `9b45c9d5`; size S; $6.81 |
| E-2136f280 | 2026-10-16 | 6 | shipped `7a0b0525`; size S; $5.04 |
| E-e4aa64a3 | 2026-10-16 | 33, 25, 26, 28, 7, 8, 9, 30, 32, 16, 18, 19, 23 | partial (7/8 accepted, nothing merged; card 39); $78.32 |
| E-59a16f4f | 2026-10-16 | 40 H, 42 G | partial (engine fields only); $27.38 |
| E-746e822f | 2026-10-17 | merge of the two above | shipped `e1bb0667`; size S; $9.65; all suites at or above baseline |
| E-45422629 | 2026-10-17 | 21, 22 | blocked at QA; the two skills taken from its integration tree by the session (196 / 158 lines; QA test/ junk left out); $27.57 |
| E-4607a6a6 | 2026-10-17 | 39, 45, 44, 40–43 | nothing built: plan-integrate rejected the F5/F6 (graph/teams pane) seam 3 times; $60.57 |
| E-95de6173 | 2026-10-17 | 39, 45, 44, 40–43 | stopped in plan (machine overload, worktrees deleted); 6/7 PLAN sections kept on `rescue/95de6173-plan-*`; $37 |
| E-6b073e8a | 2026-10-17 | 24 (develop, portfolio, think, harness) | stopped at QA; integration kept on `rescue/6b073e8a-skeleton`; $19 |
| E-69f230a3 | 2026-10-17 | 24 (knowledge) | stopped at goal gate; integration kept on `rescue/69f230a3-knowledge`; $17 |
| E-2146f402 | 2026-10-17 | 46 | stopped before build (PLAN only); $11 |
| E-041cf197 | 2026-10-17 | 50 | stopped in build; PLAN on `rescue/95de6173-plan-F1` (041cf197's PLAN-F1); $10 |
| E-c2808479 | 2026-10-17 | 14 | shipped `ec07498b`; size S; $6.21 |
| E-32e8068c | 2026-10-18 | 51 (teams), 45 | shipped by hand `10015def` (P1's gate could not re-run tests: card 39); teams suite 1265, 0 fail; $41 |
| E-6ab58cc6 | 2026-10-18 | 40, 43 | running |
| E-5ad30c36 → E-f169fb8c | 2026-10-18 → 21 | 54 step 1 | P1+P2 accepted; P3 (real run) failed 3× because the run's evidence was deleted before gates could read it; merged by hand `666b7283`, run by hand; $43.7 |
| E-c80fa0ea, E-1515b84f, E-0e4ef843 → E-1fdeb52d | 2026-10-25 → 26 | 47 | shipped `49d9d3a4`, `2497e9aa`, `dd479d63`; size S ×4 (E-0e4ef843 stopped at implement, finished by E-1fdeb52d); teams 1482/1482; four routing probes match |
| E-2bb23da3 | 2026-10-25 | 71, 72, 73 | shipped `914225ba`; size S; gaps → cards 77, 78 |
| E-23b35fe3, E-0baf8e75 | 2026-10-26 | 74 (tests) | shipped `92b464d8`, `6cbfbc5d`; size S ×2; part A blocked only on the shared-checkout scope check (card 81) |
| E-d9a9ede4 | 2026-10-26 | 78, 79, 80 | shipped `a79c2209`; size S; repo-rules 80 ok, teams mod 361; q closes the empty pane, seen live |
| E-53a84277 | 2026-10-26 | 81 (part), 77 | shipped `b446157a`; size S; teams 1492/1492 (5× taskmanager 315/315); flaky test named: judge-stream cleanup `ENOTEMPTY` (cause inferred) |
| E-82cdb580 | 2026-10-26 | 48 Task 5 | shipped `a0fa82be`; size S; AXES.md sha256 9580dbfd…; 27 problems, bench 52/52 |
| E-d93aa063 | 2026-10-26 | 76 (part) | shipped `f7ce6de4`; size S; teams 1513/1513 |
| E-3f6657e7 | 2026-10-26 | 75 (part) | shipped `18b0d420`; size S; large-context live check left on card 75 |
| E-27be4005 | 2026-10-26 | 48 Task 6 (first half) | shipped `0ae40e03`; size S; dry run gh-defect-2 ~$0.36 per arm; batch bump `c2225c52` |
| E-57170ac9 | 2026-10-27 | 83, 82 (76 closed: shape passed on attempt 2) | P2 shipped `3e84d81a` (bench 80/80); P1 judged accept 3× but settled blocked on a denied extra command (card 85), taken by hand `5c876e67` (teams 1530/1530); cancelled at QA-F1's 11 defects |
| E-7d212456 | 2026-10-27 | 85 | shipped `2abe90b2`; size L, every stage first try; teams 1541/1541; QA's top-level `test/` scratch left out (card 86) |
| E-398db286 | 2026-10-27 | 86, 81 | shipped `db529b9e` by hand (cancelled in Build): P1 (86) accepted on attempt 2; P2 (81, part) judged accept 90 but settled blocked by the installed 0.60.1 engine (card 85 fix not installed yet); teams 1561/1561; ~$19 |
| E-fa84630b | 2026-10-27 | 84 (two defects) | nothing shipped: both PRD cards accepted, critique:3 rejected P1 for carrying the planning card's document criteria the PRD folded into its stories (card 87); $5.97 |
| E-77926c5f | 2026-10-27 | 87, 89 | nothing shipped: both PRD cards accepted; shape failed 3× (P1 and P3 both touch `teams/mcp/taskmanager.mjs`; one owner per path by design). Cards touching the same engine file go in separate Sprints |
| E-22c3af14 | 2026-10-27 | 91 | nothing shipped: pinned L, PRD with one story; shape refused 1 package (fits S) and 2 packages (one claims every story) (card 92); reopened unpinned |
| E-b1aee623 | 2026-10-28 | 91 | shipped `2e72969f`; size S (unpinned); goal gate 95; accept scores only the package's own acceptance (`scopeGaps`, `out_of_scope[]`); teams 1565/1565; ~$3.5 |
| E-861e1089 | 2026-10-28 | 87 (part) | shipped `0d0ec3f7`; size S; document criteria filtered from the PRD stories by exact text; teams 1567/1567; ~$3 |
| E-db523454 | 2026-10-28 | 92 | shipped `4cb97d0d`; size S; goal gate 96; "claims every user story" needs 2+ stories; teams 1568/1568; ~$2 |
| E-8b9c417d | 2026-10-28 | 84 (two defects) | shipped `1babb2bd`; P1 accepted; P2 met its own acceptance but rejected 3× for P3's live look (card 91), taken from its branch; live look done in session; integration branch held QA scratch under `test/` (0.60.1 engine, card 86 fix not installed) — not merged; teams 1570/1570, plugin test 375/375; $27.5 |
| E-0ad09a55 | 2026-10-28 | 88 (part) | shipped `84358723`; size S; goal gate 90; repro gate for QA defects and audit unmet (rerun in the integration tree, a passing one dropped); teams 1577/1577; $3.72 |
| E-11f56074 | 2026-10-29 | 81 rest, 99 (87 check) | partial, size L, ~$24: both packages' gates "blocked: tool denied" (installed engine lacks 8a682c0f); work taken from the worktrees by hand. 99: hook refuses writes only in this repo's common dir, repo-rules 231/231, live: scratch repo pass, repo deny. 81: engine scope verdict recorded on finish. teams 1633/1633. PRD had no document criteria (87) |
| E-f2173f01 | 2026-10-29 | 94 rest | size S; one status word per STORYs row, title shrinks last (≥24 at 86 cols); live look 84-col pane, shot sent; plugin test 399/399, teams 1631/1631; awaiting the user's approval |
| E-fa72c6e8 D11 | 2026-10-28 | 97 rest | taken from the cancelled Sprint's D11 branch (`rescue/fa72c6e8-D11`): a command the project's PreToolUse hook refuses (QA probing `rm -f $QAF1_UNSET/…`) is not a needed denial, so it no longer blocks a node; live probe doc `_repo/docs/2026-10-28-hook-deny-permission-denials.md`; teams 1631/1631 |
| E-75270ef1 | 2026-10-28 | 88 rest, 96 | shipped `a05663b2` (committed by the run); audit unmet items need a runnable repro; a dropped defect stays dropped on rescue/retry; task.base_commit at tm_open; size-S prompt names gateintegrity; teams 1626/1626 |
| E-ca39279f | 2026-10-28 | 97, 98 | size S; one filing holds a defect once (same trimmed title or repro.command); `harnessVerdict` refuses an accept under goal_threshold (the graph's floor-5 band let 85 pass at 90) and the size-S prompt passes the threshold; teams 1618/1618 |
| E-a0b849a2 | 2026-10-28 | 95 | size S; goal gate 85 (under threshold 90, card 98); a QA/audit-filed package records `base_branch` = the filing pass's integration branch and branches from it; teams 1615/1615 |
| E-f69222d8 | 2026-10-28 | 90 rest | size S; goal gate 93; `>|`, absolute repo targets from outside, bare `cd`/`cd -`/`pushd`/`popd`/subshell tracking; repo-rules 217/217; live hook run: 4 deny, 2 pass as listed |
| E-a193d3ec | 2026-10-28 | 94 defects | shipped `a7ec1188`; STORYs reason on its own line, a repackaged story shows its current attempt; teams 1613/1613, plugin test 396/396 |
| E-692f3092 | 2026-10-28 | 94 | shipped `a8d0de16`; teams-status attempts, judge score vs threshold, cost and retry spend, drivers, denials, defects filed/dropped; teams 1610/1610, plugin test 381/381 |
| E-fa72c6e8 | 2026-10-28 | 90 | cancelled by the user in QA round 2, integration-3 taken; `enforcement.md` + repo hook refuses unquoted `rm $VAR` and in-place Bash writes; repo-rules 204/204; rest is card 90, duplicate filing card 97; ~$79 |
| E-f27382fa | 2026-10-28 | 89 | shipped `a9212cdb`; size S; goal gate 90; `gateintegrity.mjs` + gate:goal section; real run `--baseline HEAD~30` lists card 85's two replaced tests; teams 1591/1591 |
