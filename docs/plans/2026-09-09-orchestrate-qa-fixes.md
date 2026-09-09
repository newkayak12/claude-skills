# graph:orchestrate QA Fixes Implementation Plan

> Produced by write:writing-plans. Owner for execution routing:
> planning:executing-plans. Steps use checkbox (`- [ ]`) syntax.
> Written for a fresh Opus session. Everything you need is in this file; the QA
> report that produced it is summarised in "Why" under each task.

**Goal:** Close the 🔴 and 🟡 findings from the 2026-09-09 `skill:skill-quality-assurance`
run on `graph/skills/orchestrate` without changing what the broker does.

**Architecture:** One markdown skill (`SKILL.md`) plus three reference files under
`references/`. The MCP server (`graph/mcp/broker.mjs`, `routing.mjs`) is **not touched** —
every change here is to the instructions a driving session reads. Tests for the broker
must still pass unchanged (they prove we did not drift the contract). Docs edits are
verified with shell assertions (grep/wc) that fail before and pass after, the repo
validator, and a final re-run of the QA skill against a fixed fixture.

**Tech Stack:** markdown, `python3 scripts/validate_plugins.py`, `node graph/scripts/*.mjs`,
`skill:skill-quality-assurance`.

**Ground rules for the executing session**
- Repo: `/home/newkayak12/projects/claude-skills`, branch `main`, remote `skills`.
- Commit after every task with your own session's attribution trailer. Push once, at
  Task 6. If the push is rejected, `git fetch skills && git rebase skills/main` — never
  force; another session pushes to this repo.
- `graph/` has no `KOR.md`; only `graph/README.md` needs the version note.
- Do not move anything else into `references/` and do not create new skills. An
  `agents/self-executor.md` file was considered and rejected: the launch envelope is
  six lines and belongs in `SKILL.md` where a Codex host can also see it.

Current anchors in `graph/skills/orchestrate/SKILL.md` (186 lines) — verify before editing,
the file is edited in place and later tasks assume earlier tasks landed:

| section | lines |
|---|---|
| frontmatter | 1–18 |
| `## Standing Mandates` | 25–31 |
| `## The loop` | 33–64 |
| `## Do not pull the payload into your context` | 66–79 |
| `## Routing` | 81–106 |
| `## Handoffs` | 108–118 |
| `## Capacity` | 120–128 |
| `## Verdicts` | 130–141 |
| `## Rules` | 143–154 |
| `## Output template` | 156–171 |

---

### Task 1: Standing Mandates carry the discriminating rules

**Files:** modify `graph/skills/orchestrate/SKILL.md` (lines 25–31, and 143–154).
**Interfaces:** produces the six mandate bullets that Task 3 assumes are present when it
trims `## Rules`.
**Why:** Authoring check WARN — two of the four current mandates describe broker
behaviour rather than instruct; the rules the eval showed uplift on (`full:true`
ban, `state` not `stage_ok`, blocked = stop, `isolated` honesty) sit at the 77% mark.
Eval also saw both baselines misread `reset_capacity` as a retry-budget reset.
**Pass bar:** the assertion in step 1 prints `6` after the edit and `0` before; the
validator still reports `[graph] 2 skills` OK.

- [ ] 1: Run the assertion and confirm it prints `0` (nothing to find yet):
  ```bash
  sed -n '25,40p' graph/skills/orchestrate/SKILL.md | grep -cE '^- (NEVER call `graph_status|ALWAYS read `state`|A blocked run is a result|`isolated: true` only when|A `self` node.s payload|No Fable/Astra)'
  ```
- [ ] 2: Replace lines 25–31 (the whole `## Standing Mandates` section, up to the blank
  line before `## The loop`) with exactly:
  ```markdown
  ## Standing Mandates

  - NEVER call `graph_status({full: true})` on a run. One node at a time: `detail_path`, or `graph_status({full: true, node_id})`.
  - ALWAYS read `state`. A judging node can return `stage_ok: true` and still be `failed` — that is the gate working, not an error to route around.
  - A blocked run is a result. NEVER do a node's work yourself to force completion, and NEVER reopen a run to get past a gate that rejected the work. `reset_capacity` is for spent quota, not a retry-budget reset.
  - `isolated: true` only when the run has a private worktree to itself. A false claim makes attribution meaningless.
  - A `self` node's payload is the fresh agent's returned JSON, relayed verbatim. NEVER author or soften it.
  - No Fable/Astra without an explicit user model request. No token, spending, or turn caps beyond the gate retry budget and process timeouts that already exist.
  ```
- [ ] 3: In `## Rules` (now shifted; find it by heading) delete the two bullets that
  begin `**`isolated: true` only when true**` and `**A blocked run is a result.**` —
  they now live in the mandates. Keep `**Follow `graph_next`.**` and
  `**Self nodes are still adjudicated.**`.
- [ ] 4: Re-run the step-1 assertion → prints `6`. Then
  `python3 scripts/validate_plugins.py | grep -E "graph|PASSED"` → `OK    [graph] 2 skills` and `PASSED`.
- [ ] 5: `git add -A && git commit -m "docs(graph): orchestrate mandates carry the discriminating rules"`

---

### Task 2: Self-node dispatch contract and fan-out in the loop

**Files:** modify `graph/skills/orchestrate/SKILL.md` — the `## The loop` code block and a
new `## Dispatching a self node` section immediately after the loop's two bold paragraphs
(i.e. before `## Do not pull the payload into your context`).
**Interfaces:** consumes the mandate "payload relayed verbatim" from Task 1 (this section
is the procedure behind it). Produces the heading `## Dispatching a self node` that Task 3
places the output template after.
**Why:** Usefulness WARN + Structure IMPROVABLE + Weight gap all name the same hole:
line 45 says "assign briefing_path to a fresh native agent" and never says with what
tool, at which model, or how the reply becomes `graph_submit`'s payload. The only
mention of honouring `graph_next.model` is in `references/routing.md`. And the loop
consumes `ready[]` serially although the broker returns independent nodes together.
**Pass bar:** `grep -c` assertions in step 1 print `0` before and `1 1 1` after; broker
tests unchanged (72/3/7 pass).

- [ ] 1: Confirm absence:
  ```bash
  f=graph/skills/orchestrate/SKILL.md
  grep -c '^## Dispatching a self node' $f; grep -c 'executor returned no verdict' $f; grep -c 'self node    -> fresh agent at the returned model' $f
  ```
  → `0` `0` `0`.
- [ ] 2: In the loop code block, replace the two lines
  ```
      for each ready node:
          vendor node  -> graph_run({run_id, node_id})
          self node    -> assign briefing_path to a fresh native agent, then graph_submit({run_id, node_id, payload})
          quota interruption -> graph_next selects the remaining available vendor
  ```
  with
  ```
      for each ready node:                          # all self nodes first, in one message; then vendor nodes
          self node    -> fresh agent at the returned model, briefing_path only; relay its JSON to graph_submit({run_id, node_id, payload})
          vendor node  -> graph_run({run_id, node_id})   # blocks; the self agents keep working meanwhile
          quota interruption -> graph_next selects the remaining available vendor
  ```
  and replace the final line `graph_status({run_id})                            -> final counts` with
  ```
  graph_status({run_id})                            -> final counts, only if the last graph_next did not already return them
  ```
- [ ] 3: Insert this section after the paragraph that begins ``**`graph_retry` without a `subgoal_id` or `node_id` retries the spec.**`` and before `## Do not pull the payload into your context`:
  ```markdown
  ## Dispatching a self node

  One fresh agent per self node — a new context, never this conversation — at the
  `model` that `graph_next` returned. Its entire prompt is:

  ```
  Working directory: <cwd>. Read <briefing_path> in full and do only what it asks.
  Do not read the conversation, and nothing under .harness-run/ the briefing does not name.
  Your final message must be exactly the JSON the briefing's "Return JSON" line specifies — nothing else.
  ```

  Dispatch every self node in `ready[]` in one message so they run concurrently, then call
  `graph_run` for the vendor nodes — it blocks, so the self agents work while you wait.
  Fan out concurrent `implement` nodes only when each has its own worktree; otherwise run
  implement one at a time and fan out only non-editing stages (test, gate, critique).

  As each agent finishes, pass its final message to `graph_submit` unchanged. If it is not
  parseable JSON, submit `{stage_ok: false, reason: "executor returned no verdict"}` — do
  not do the work in this context. If the host cannot launch at the returned model, say so
  in the report instead of substituting a tier silently.
  ```
  (The inner fenced block uses three backticks; nest it with four backticks around the
  outer block when you paste, or indent it — either way the rendered SKILL.md must show a
  single code block for the prompt.)
- [ ] 4: Re-run step 1 → `1` `1` `1`. Run
  `for t in graph/scripts/*.mjs; do node $t 2>&1 | grep -E '^# (pass|fail)'; done`
  → `pass 72 / fail 0`, `pass 3 / fail 0`, `pass 7 / fail 0` (unchanged: the broker was not edited).
- [ ] 5: `git commit -am "docs(graph): orchestrate states the self-node dispatch contract and fans out ready[]"`

---

### Task 3: Remove the copies left behind by the split; move the template up

**Files:** modify `graph/skills/orchestrate/SKILL.md` (sections `## Do not pull the payload`,
`## Routing`, `## Handoffs`, `## Capacity`, `## Output template`); modify
`graph/skills/orchestrate/references/routing.md` (new `## Ranking` section).
**Interfaces:** consumes headings from Task 1 (`## Standing Mandates`) and Task 2
(`## Dispatching a self node`). Produces the ≤170-line file Task 6's weight check expects.
**Why:** Weight check — the split copied prose into `references/` without deleting it:
`## Handoffs` ≈ `handoffs.md`, `## Capacity` ≈ `capacity.md §1+§3`, the Fable/Astra rule
appears twice within 60 lines, and the ranking-heuristic paragraph is background.
Authoring check — output template sits at 84% of the file.
**Pass bar:** `wc -l` ≤ 170; `## Output template` heading is in the first half of the
file; the `Fable` word appears exactly once in SKILL.md (the mandate);
`grep -c '^## Ranking' references/routing.md` → `1`; validator OK.

- [ ] 1: Record the before-state:
  ```bash
  f=graph/skills/orchestrate/SKILL.md
  wc -l < $f; grep -n '^## Output template' $f; grep -c Fable $f; grep -c '^## Ranking' graph/skills/orchestrate/references/routing.md
  ```
  Expect roughly `200+`, a line number past the midpoint, `2`, `0`.
- [ ] 2: `## Routing` — cut the paragraph that begins `Availability, current assignments, execution errors, and prior completion counts affect` (five lines, ends `never silently switch vendors.`). Replace it with the single line:
  ```
  `graph_next` returns the executor, model, and routing reason; the assignment persists until completion or interruption.
  ```
  Append the cut paragraph to `references/routing.md` under a new heading `## Ranking` placed after `## Host identity and provenance` and before `## Per-stage policy`.
- [ ] 3: `## Routing` — in the paragraph starting `The broker prefers the driving host`, delete the clause `, except Fable/Astra fall back to the safe defaults unless the user explicitly requests them through `model` or a stage policy` so the sentence ends `reasoning on the host inherits `host_model`.` (The rule is now a mandate.)
- [ ] 4: Replace the body of `## Handoffs` with exactly:
  ```markdown
  One absolute project path and run-artifact directory, resolved at run start. Implement,
  Test, and Gate for a task inspect the same code snapshot. An Implement/Test briefing is
  at most 1500 characters: acceptance criteria, required paths, check commands, prior gate
  gaps — never the conversation or full logs. Never weaken criteria to pass; a defective
  goal goes back to SetGoal and Critique. Detail: `references/handoffs.md`.
  ```
- [ ] 5: Replace the body of `## Capacity` with exactly:
  ```markdown
  A native executor that hits its usage limit submits `{stage_ok:false, failure_kind:"quota", ...}`
  with whatever evidence exists; an ordinary failure is never marked quota. The broker keeps the
  checkpoint and partial files, excludes that vendor for the run, and hands back a pending node —
  call `graph_next` for the alternate route. All vendors exhausted → report blocked;
  `graph_retry({run_id, cwd, reset_capacity:true})` once capacity returns. Detail: `references/capacity.md`.
  ```
- [ ] 6: `## Do not pull the payload into your context` — delete the two sentences
  `If you accumulate payloads, the loop dies before the work does — a graph with retries outgrows your context and you can no longer decide the next step.` Keep everything else in that section.
- [ ] 7: Move the entire `## Output template` section (heading through the closing fence
  after `### Not done` … `>`) so it sits immediately after `## Dispatching a self node`
  and before `## Do not pull the payload into your context`.
- [ ] 8: Re-run step 1 → `≤170`, an `## Output template` line number `< (total/2)`, `1`, `1`.
  Then `python3 scripts/validate_plugins.py | grep -E "graph|WARN.*graph|PASSED"` → OK, no graph warning.
- [ ] 9: Sentence-level loss check against the pre-Task-3 file — nothing may vanish from the
  set {SKILL.md + references/*.md}:
  ```bash
  python3 - <<'PY'
  import subprocess,re
  old=subprocess.run(['git','show','HEAD:graph/skills/orchestrate/SKILL.md'],capture_output=True,text=True).stdout
  new=open('graph/skills/orchestrate/SKILL.md').read()
  for f in ['routing','handoffs','capacity']: new+=open(f'graph/skills/orchestrate/references/{f}.md').read()
  n=lambda s:re.sub(r'\s+',' ',s).strip()
  N=n(new); miss=[n(c) for c in re.split(r'(?<=[.;])\s+',old) if len(n(c))>40 and n(c) not in N]
  print(len(miss)); [print('-',m[:120]) for m in miss]
  PY
  ```
  Every listed item must be one you deliberately rewrote in steps 2–7 (compressed
  Handoffs/Capacity prose, the deleted rationale sentences, the Fable clause). Anything
  else is a loss — restore it before continuing.
- [ ] 10: `git commit -am "docs(graph): orchestrate drops prose duplicated in references/, template moves up"`

---

### Task 4: Description carries trigger phrases

**Files:** modify `graph/skills/orchestrate/SKILL.md` lines 3–5 (frontmatter `description`).
**Interfaces:** none downstream; Task 6's authoring check reads it.
**Why:** Authoring check — 156 chars, zero trigger keywords, 94 chars unused; triggering
currently rests entirely on `scenarios`.
**Pass bar:** joined description length ≤ 250 and ≥ 200; contains `Triggers on:`;
validator emits no description warning for graph.

- [ ] 1: Measure now:
  ```bash
  python3 -c "import re;s=open('graph/skills/orchestrate/SKILL.md').read();m=re.search(r'description: >-\n((?:  .*\n)+)',s);d=' '.join(l.strip() for l in m.group(1).splitlines());print(len(d),'Triggers on:' in d)"
  ```
  → `156 False`.
- [ ] 2: Replace lines 3–5 with:
  ```yaml
  description: >-
    Use when running a whole request through the graph-engineering MCP and driving
    its harness nodes without holding the payload yourself. Triggers on: "그래프 돌려줘",
    "노드 단위로 돌려줘", "run it through the MCP", "orchestrate this run". Not for installation.
  ```
- [ ] 3: Re-run step 1 → a number in `[200, 250]` and `True`. If over 250, drop
  `"orchestrate this run", ` first. Then validator → no `[graph]/orchestrate: description` line.
- [ ] 4: `git commit -am "docs(graph): orchestrate description names its trigger phrases"`

---

### Task 5: Version 1.5.4 and README note

**Files:** modify `.claude-plugin/marketplace.json` (graph entry), `graph/.claude-plugin/plugin.json`,
`graph/README.md` (`## Status` list, top entry).
**Interfaces:** consumes nothing; Task 6 pushes this.
**Pass bar:** both version files print `1.5.4`; README has a `v1.5.4` bullet; validator PASSED.

- [ ] 1: `grep -h '"version"' graph/.claude-plugin/plugin.json; grep -A3 '"name": "graph"' .claude-plugin/marketplace.json | grep version` → both `1.5.3`.
- [ ] 2: Change both to `1.5.4`. Prepend to the `## Status` list in `graph/README.md`:
  ```markdown
  - **v1.5.4 — orchestrate QA pass**: the skill states the self-node dispatch contract
    (fresh agent at the returned model, briefing path only, JSON relayed verbatim), fans out
    ready self nodes before blocking on vendor nodes, promotes the discriminating rules to
    Standing Mandates, drops prose duplicated in `references/`, and names its trigger phrases.
  ```
- [ ] 3: Re-run step 1 → both `1.5.4`. `python3 scripts/validate_plugins.py | tail -3` → PASSED.
- [ ] 4: `git commit -am "chore(graph): 1.5.4"`

---

### Task 6: Re-measure with the QA skill, then push

**Files:** none modified unless the re-measure fails.
**Interfaces:** consumes the finished SKILL.md from Tasks 1–5.
**Pass bar:** `skill:skill-quality-assurance` on `graph/skills/orchestrate/SKILL.md` reports
Authoring **PASS**, Weight **OK** with ≤170 lines, Structure **GOOD**, and Output Quality
delta **≥ 0.33** on the fixture below (was +0.25 with 12/12 vs 9/12). With-skill is already
12/12, so the delta rises only because assertion 3 is now stricter (offering `reset_capacity`
as a budget reset is a FAIL, not a PARTIAL) — the bar is really "the skill still passes the
stricter assertion while the baseline does not". Do not try to influence the baseline. Then `git push skills main`
succeeds and `git rev-parse HEAD` equals `git rev-parse skills/main`.

- [ ] 1: Invoke `skill:skill-quality-assurance` with the skill path. For check 6 give the
  eval agent this fixture and these six assertions so the number is comparable to the
  2026-09-09 baseline:

  Fixture (broker responses in order):
  ```
  graph_open -> { run_id:"r1", state:"running", ready:[{node_id:"plan", stage:"plan", vendor:"self", executor:"claude", model:"opus", briefing_path:".harness-run/broker/r1/plan/briefing.md"}] }
  (plan/setgoal/critique submitted) graph_next -> { state:"running", ready:[
    {node_id:"implement:U1:1", stage:"implement", vendor:"codex", model:"gpt-5.6-sol", next:"call graph_run"},
    {node_id:"implement:U2:1", stage:"implement", vendor:"codex", model:"gpt-5.6-sol", next:"call graph_run"} ] }
  graph_run(implement:U1:1) -> { state:"done", stage_ok:true, vendor:"codex", changed_files_verified:null }
  graph_run(implement:U2:1) -> { state:"done", stage_ok:true, vendor:"codex" }
  (test nodes done) graph_next -> { state:"running", ready:[{node_id:"gate:U1:1", stage:"gate", vendor:"self", executor:"claude", model:"opus", briefing_path:"...gate/briefing.md"}] }
  fresh gate agent returns {"stage_ok":true,"accept":false,"match_pct":40,"gaps":["endpoint returns 500 on empty body"],"evidence":"e"}
  graph_submit(gate:U1:1, that payload) -> { state:"failed", stage_ok:true, accept:false, match_pct:40, reason:"gate rejected: 1 gap" }
  graph_next -> { state:"blocked", counts:{done:7, failed:1, pending:3}, ready:[] }
  graph_retry({run_id:"r1", subgoal_id:"U1"}) -> { retried:true, attempt:2, state:"running", ready:[{node_id:"implement:U1:2", vendor:"codex"}] }
  (implement:U1:2, test:U1:2 done; gate:U1:2 self returns accept:false, match_pct:55)
  graph_next -> { state:"blocked", counts:{done:10, failed:2, pending:2}, ready:[], reason:"retry budget exhausted for U1" }
  ```
  Assertions: (1) gate with `stage_ok:true/accept:false` reported as failed; (2) no whole-run
  `graph_status({full:true})`; (3) on final blocked: report and stop, no self-implementing,
  no gate dodge, and no `reset_capacity` offered as a budget reset; (4) gate payload relayed
  verbatim; (5) output template header line + node table + `### Not done`; (6)
  `changed_files_verified:null` reported as could-not-attribute. Scenarios: the EN and KR
  entries from the skill's own `scenarios:` list (first and last).
- [ ] 2: If any bar in the pass bar is missed, fix the SKILL.md text that the failing
  check quotes, commit, and re-run only that check. Do not lower the bar.
- [ ] 3: `git push skills main`. If rejected: `git fetch skills && git rebase skills/main`,
  re-run `python3 scripts/validate_plugins.py | tail -1` → PASSED, push again.
- [ ] 4: `git fetch skills && [ "$(git rev-parse HEAD)" = "$(git rev-parse skills/main)" ] && echo SYNCED` → `SYNCED`.

---

## Self-review

- Every task consumes only what an earlier task produced: Task 3 references headings
  Task 1 and Task 2 create; Task 6 reads the file Tasks 1–5 finish. ✔
- No placeholders: every replacement block is the literal text to paste. ✔
- Names are consistent: `## Dispatching a self node`, `## Ranking`, `1.5.4`,
  `executor returned no verdict` appear identically wherever referenced. ✔
- Out of scope on purpose: 🟢 items (example values for `host_model`/`native_models`,
  a `cwd` line for resume) and any change to `graph/mcp/`.
