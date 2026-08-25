# fallback — the six-stage engine when the Workflow tool is absent

The engine (`pipeline.js`) needs the **Workflow runtime** (`agent()`, `parallel()`,
`pipeline()`). Some environments (plain Agent SDK, certain harnesses, CI) don't expose it.
This file is the **Workflow-less fallback**: the same six stages, the same contract, driven
by the **Agent tool** instead — you (the orchestrator) dispatch a fresh subagent per stage and
the stages hand work to each other through **files in a run directory**, never through your
context.

**Selection rule (hard):** use this ONLY when the Workflow tool is unavailable in this runtime.
If Workflow exists, run `pipeline.js` — behavior is then byte-for-byte the current engine.
Never run both. You detect this yourself: no `Workflow` tool in your toolset → this file.

## Why files, not your context (context-pollution rule)

You are a **thin dispatcher**. You hold only: the request, the run-directory path, and the
short manifest. Every stage's real output is written to a file by the subagent that produced
it; the next stage's subagent is given **paths to read**, not pasted content. You never inline
a plan, a spec, a diff, or a transcript into your own context or into a prompt. This is what
keeps a long run from polluting the orchestrator — the "team" shares state on disk, not in
your window. If you find yourself about to paste a stage's full output forward, stop and pass
the path instead.

## The run directory (the team's shared state)

Pick a slug for the request and create `RUN=.harness-run/<slug>/` at the start. Every stage
writes exactly the artifacts below; the completion check (`fallback-check.mjs`) reads them.

```
.harness-run/<slug>/
  manifest.json              # {request, context?, max_retries, subgoals:[{id,order}], stages:{...}}
  providers.json             # optional provider readiness, e.g. {codex:{ready:true,implement:true,test:true}}
  01-plan.md                 # Plan stage output
  02-goal-spec.json          # SetGoal output — MUST parse, MUST match goal-spec.md schema
  02-critique.json           # critic verdict {sound, problems[]}
  subgoals/<id>/
    impl-<n>.md              # Implement handoff for attempt n (≤1500 chars: paths, names, interfaces)
    impl-<n>.codex.events.jsonl  # optional Codex --json event stream when Implement used Codex
    impl-<n>.codex.json      # optional Codex final summary when Implement used Codex
    test-<n>.json            # Test evidence {verified, checks[]} for attempt n
    test-<n>.codex.events.jsonl  # optional Codex --json event stream when Test used Codex
    test-<n>.codex.json      # optional Codex final summary when Test used Codex
    gate-<n>.json            # QualityGate verdict {pass, reason, gaps[]} for attempt n
    result.json              # {id, passed, attempts}
  04-goal-gate.json          # goal-level verdict {match_pct, pass, reason}
  05-report.md               # Report stage output
```

## 0. Open the run (no magic strings)

There is **no sentinel and no edit-gate** in this fallback (an earlier version keyed off a
literal sentinel string; it leaked out of docs/descriptions and false-positived, so it was
removed). Instead:

1. Create `RUN=.harness-run/<slug>/` and write `manifest.json` with the request, `max_retries`
   (default 2), and empty `subgoals`/`stages`.
2. Detect external providers. Invoke `harness:codex-control` and resolve
   `codex-exec-adapter.mjs` from an explicit path, `harness/engine/`,
   `.claude/harness/engine/`, or the plugin root named in the project's `CLAUDE.md` Harness
   block. If `node "$ADAPTER" --detect --cwd "$PWD" --output "$RUN/providers.json"` exits 0,
   Codex may be selected for Implement/Test stages. If it fails, keep the JSON report if written.
   With `codex_provider=auto`, later selected Codex routes may explicitly degrade to Claude
   fallback; with `codex_provider=required`, a selected Codex route must fail the stage as a
   provider failure instead of silently falling back.
3. Create a `TaskCreate` checklist — one item per stage now, one per subgoal after SetGoal — so
   "invoked the skill but did nothing" is visibly an unfinished checklist.
4. You may only tell the user the run is **done** after `fallback-check.mjs RUN` prints
   `COMPLETE` (see §7). Missing or degenerate artifacts ⇒ the check fails ⇒ not done. This is
   the anti-bypass: skipping stages leaves their files absent, and the check names them.

## 1. Plan (opus)

Dispatch one Agent (model: opus). Prompt it to invoke `agents:agent-task-decomposer`, act as a
systems analyst, and decompose the request into independently-verifiable, dependency-mapped
units — **without doing the work**. It reads `.claude/conventions/**` if present and lists the
rules that constrain the work, plus per-unit deterministic checks (commands, files). It
**writes its result to `RUN/01-plan.md`** and returns only that path + a one-line summary.

## 2. SetGoal (opus) — author spec, adversarial critic, one revision

1. Dispatch one Agent (opus), given the path `RUN/01-plan.md` to read, to author a **goal-spec**
   (schema: `goal-spec.md`): `goal`, goal-level `acceptance[]`, `subgoals[]` (`id`, `title`,
   `persona?`, `skills[]`, optional `implement_provider`/`test_provider`, `acceptance[]`,
   `test[]`, `deps[]`), `max_retries`. It **writes
   `RUN/02-goal-spec.json`** (valid JSON) and returns the path. Two hard rules on every
   `acceptance`/`test` entry: (a) it checks that unit's **own artifacts** (named files, outputs,
   interfaces) — never whole-repo state (`git diff/status` across the repo, aggregate counts),
   which concurrent work can change and no single subgoal can satisfy deterministically; (b) an
   aspirational or arbitrary-threshold target (a chosen % reduction, subjective quality words) is
   a **soft goal**, not a hard pass/fail bar — the judge treats every listed entry as hard, so
   restate it concretely or drop it.
   If `RUN/providers.json` says `codex.ready=true`, prefer
   `"implement_provider":"codex"` and `"test_provider":"codex"` for code-editing,
   repository-inspection, build/test, and refactor subgoals. Keep Plan, SetGoal,
   QualityGate, and Report on Claude. If Codex is absent or not ready, omit provider fields.
2. Dispatch a **separate** Agent (opus) invoking `think:devils-advocate` to refute it; it reads
   the spec path and **writes `RUN/02-critique.json`** `{sound, problems[]}`. It must flag two
   unwinnable-gate patterns: acceptance/test tied to global/shared repo state instead of the
   unit's own artifacts, and arbitrary-% or subjective targets written as hard bars.
3. If `sound:false`, dispatch **one** revision Agent (opus) to rewrite `RUN/02-goal-spec.json`
   in place. Reject a degenerate spec (empty subgoals / empty acceptance / placeholder titles)
   and re-author once.

Record the subgoal ids + linear order (next section) into `manifest.json`.

## 3. Order the subgoals — STRICT LINEAR SEQUENCE

Topologically sort `subgoals` by `deps` into a **single linear order**; break ties by spec
order. This fallback does **not** run parallel waves — subgoals execute one after another. On
an unsatisfiable cycle, append the remainder in spec order and note it in `manifest.json`.

Add one `TaskCreate`-style checklist item per subgoal in that exact order. Exactly one is
`in_progress` at a time; mark it `completed` only after its QualityGate passes (or retries
exhaust), then start the next.

## 4. Per subgoal — Implement → Test → QualityGate, looped (bounded by max_retries)

For the current subgoal `<id>`, loop attempt `n` from 1 up to `max_retries` (default 2):

1. **Implement (provider-routed: Codex or Sonnet fallback).** If `implement_provider === "codex"` and
   `RUN/providers.json` shows Codex ready, write `RUN/subgoals/<id>/impl-<n>.prompt.md`
   with the same instructions the Agent path would receive, then run:
   `node "$ADAPTER" --cwd "$PWD" --prompt-file RUN/subgoals/<id>/impl-<n>.prompt.md --events-output RUN/subgoals/<id>/impl-<n>.codex.events.jsonl --output RUN/subgoals/<id>/impl-<n>.codex.json --sandbox workspace-write`.
   Then copy or summarize the Codex JSON `last_message` into `RUN/subgoals/<id>/impl-<n>.md`
   as the normal handoff. Do not redo Codex's work with Claude when Codex succeeds. If Codex is
   not ready or exits non-zero, record that in the handoff. With `codex_provider=required`, stop
   the attempt as provider failure; with `auto`, explicitly mark the stage degraded and only then
   fall back to the normal Agent path. Otherwise dispatch an Agent as the subgoal's `persona`, told to invoke its
   `skills[]`, follow `.claude/conventions/**`, and read the paths of completed dependencies'
   `result.json`/`impl-*.md` for context (pass **paths**, not content). It does the work, edits
   files, and **writes its handoff to `RUN/subgoals/<id>/impl-<n>.md`** (≤1500 chars).
2. **Test (provider-routed: Codex or Sonnet fallback).** If `test_provider === "codex"` and Codex is ready, write
   `RUN/subgoals/<id>/test-<n>.prompt.md` and run a **separate** Codex process with
   `--events-output RUN/subgoals/<id>/test-<n>.codex.events.jsonl` and
   `--output RUN/subgoals/<id>/test-<n>.codex.json`. The prompt must forbid trusting the
   Implement narrative and require deterministic checks from `test[]`. Convert the final
   Codex report into the normal `RUN/subgoals/<id>/test-<n>.json` evidence shape
   `{verified, checks[], evidence}`. Do not re-run Codex's checks with Claude when Codex
   succeeds. If Codex is unavailable or fails, `required` records `verified:false` as provider
   failure; `auto` explicitly marks degradation and only then falls back to the normal Test
   Agent. Otherwise dispatch a **separate** Agent invoking
   `completion:verification-before-completion`. It does NOT trust the executor's narrative — it
   runs the subgoal's `test[]` with Bash and Reads the claimed artifacts, then **writes
   `RUN/subgoals/<id>/test-<n>.json`** `{verified, checks[]}`.
3. **QualityGate (opus).** Dispatch a **separate** Agent invoking `think:devils-advocate` to
   judge the subgoal against its `acceptance[]`, weighing the independent test evidence over
   the account. It **writes `RUN/subgoals/<id>/gate-<n>.json`** `{pass, reason, gaps[]}`.

If `pass`, write `RUN/subgoals/<id>/result.json` `{id, passed:true, attempts:n}`, mark the task
`completed`, move on. If not, feed the verdict's `reason`/`gaps` into the next Implement as
`Previous attempt was rejected. Fix:` and retry until pass or retries exhaust — then write
`{passed:false, attempts:n}` and continue. **No-progress early stop:** if attempt `n`'s
`gate-<n>.json` has the same `gaps`/`reason` as attempt `n-1`'s, the repair achieved nothing —
stop now, write `{passed:false, attempts:n, stalled:true}`, and continue (still capped by
`max_retries`; this only exits sooner, never runs longer).

## 5. Goal-level QualityGate (opus) — match_pct ≥ 90, repair-and-regate

After all subgoals, dispatch one Agent (opus, `think:devils-advocate`) that reads the run
directory and judges the **assembled whole** against goal-level `acceptance[]`, scoring
`match_pct` (0–100, holistic — not an average of subgoal pass/fail). It **writes
`RUN/04-goal-gate.json`** `{match_pct, pass, reason}`. If `match_pct < 90`, dispatch a repair
Implement using the same provider-routing rule as Implement stages, then re-gate — up to
`max_retries` times. If a re-gate
returns the same `gaps`/`reason` as the pass before it, the repair made no progress — stop early
rather than spending the remaining repair passes on an identical gap. `pass` is `match_pct >= 90`.

## 6. Report (sonnet)

Dispatch one Agent (sonnet) as an honest engineering status reporter that reads the run
directory: outcome first (did the goal pass, `match_pct`), then per-subgoal PASS/FAIL with
reasons, then failures and what remains. No invented claims. It **writes `RUN/05-report.md`**.
Relay this report to the user, surfacing failed subgoals and a failing goal gate honestly.

## 7. Completion check (the objective done-signal)

Run `node harness/engine/fallback-check.mjs RUN`. It deterministically verifies every required
artifact exists and is non-degenerate (plan present; goal-spec parses with goal/acceptance/
subgoals; every manifest subgoal has a `result.json` and ≥1 test evidence; goal-gate parses
with a `match_pct`; report present). It prints `COMPLETE` (exit 0) or lists what is
missing/degenerate (exit 1). **Only report the run as done on `COMPLETE`.** On failure, resume
the named stage — the run directory makes it resumable without redoing passed subgoals.

## Contract (identical to `pipeline.js` — never relax)

- **judge ≠ actor** — Test and QualityGate agents are always separate from the Implement agent.
- **model/provider pins** — Plan/SetGoal/QualityGate = opus; Implement/Test =
  provider-routed (Codex when selected, Sonnet only as explicit fallback); Report = sonnet.
- **bounded loops** — per-subgoal and goal-level loops both capped by `max_retries`.
- **deterministic Test** — evidence from Bash/Read, never the executor's narrative.
- **goal-level gate** — `match_pct >= 90` before Report.
- **thin orchestrator** — stages exchange work via `RUN/` files (paths in prompts), not via
  your context.
- **provider separation** — if Codex is used, Implement and Test are distinct `codex exec`
  processes with separate prompts and artifacts; QualityGate remains Claude/Opus.

## What's necessarily weaker than the Workflow path (say it honestly)

- Control flow is orchestrated by you, not a deterministic script — ordering is guaranteed (§3)
  but concurrency isn't; subgoals run sequentially, so it is slower.
- Enforcement is a nudge, not a wall. The completion check makes "invoked but didn't run"
  **detectable and resumable** (missing artifacts are named), which is strictly better than the
  old sentinel — but a determined bypass (dispatch a do-nothing subagent, fabricate an
  artifact, edit via Bash) is not closable in the same trust domain. Fail-open by design.
