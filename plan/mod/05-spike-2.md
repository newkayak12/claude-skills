# 05 — Spike 2: prove what plans 06–09 rest on

> Produced by write:plans (2026-10-08). Throwaway code; only the findings file is kept.
> Plan stage only: nothing here has been run. Design-change rule (CLAUDE.md) still applies.

**Goal:** answer five questions with evidence before plans 06 (teams report), 07 (session pane),
08 (guard) and 09 (memo) write a `modules` line. Facts already proven in `00-spike-findings.md`
(modules + command hooks coexist, `-p` has 0 surfaces, `$.plugin.root`, `{ command }` matcher,
no JSON imports, `skill.prompt` skipped by the team policy plugin) are not re-tested.
**Architecture:** one scratch plugin `spike2-mod` outside the repo (`$TMPDIR/spike2/spike2-mod/`,
loaded with `--plugin-dir`, run with `< /dev/null` for nested `claude -p`). One `register.tsx`
with one `/spike2-<n>` command per task, each writing its observation to `$.store` key `s<n>`
and echoing it as `{ text }`. Engine 2.1.293 types: `$.ui.ask`, `$.ui.invalidate`,
`on('prompt.context')`, `on('turn.step')` (streaming, `async function*`), `on('classic.Stop')`,
`on('classic.SubagentStop')`, `Pane`, `Markdown`, `Link`.
**Output:** `plan/mod/05-spike-2-findings.md` — one section per task (`## S1` … `## S5`), each
with: command run, observed output, verdict (YES / NO / PARTIAL), and "if NO → consequence for
plan 0X" (the fallback, stated).

---

### Task 1 (S1): a Pane renders a long `Markdown` body — scroll, truncate or overflow? (plan 06)
**Files:** scratch `spike2-mod/hooks/register.tsx`, `hooks.json`, `.claude-plugin/plugin.json`.
**Interfaces:** `/spike2-1 <n>` opens `$.ui.open({ id: 's1', title: 'S1' })`; a `ui.render` hook
on `{ component: 'Pane', requestId: 's1' }` returns `<Markdown>{body}</Markdown>` where body is
`n` numbered lines `line 00001 …` plus a headed section every 500 lines, `n` ∈ {20000, 100000} chars.
**Blocked by:** none.
**Pass bar:** findings "S1" states, for 20k and 100k chars, in terminal and desktop Code tab:
last line reachable by wheel/keys (scroll), cut with a marker (truncate), or spills outside the
pane (overflow); whether `ui.scroll` fires on the Pane (`on('ui.scroll', { requestId: 's1' })`,
log `e.by`); whether `$.ui.scroll({ in, to: 'end' })` moves it; render lag (ms, `$.clock`). Verdict
YES = 100k scrolls to its last line. If NO → plan 06 keeps the ~20k cap, truncates with a visible
"… N more lines, open report.md" line, and offers the full file path as copyable text.

- [ ] 1: write the command + render hook; `claude plugin validate spike2-mod` → record
- [ ] 2: terminal session: run `/spike2-1 20000` then `100000`; scroll with wheel, PgDn, End
- [ ] 3: desktop Code tab, same two runs
- [ ] 4: record observed behaviour per size and surface in the findings

### Task 2 (S2): `prompt.context` re-fires after auto-compaction and `/clear`; `invalidate` takes effect next turn (plan 09)
**Files:** `spike2-mod/hooks/register.tsx`.
**Interfaces:** `on('prompt.context', async ($, e, next) => { n++; $.store.set('s2', { n, at }); const r = await next(e); return { ...r, blocks: [...r.blocks, { id: 'spike2-memo', text: `MEMO v${v}` }] } })` — check the exact
`PromptContextBlock` shape in the types before writing; `/spike2-2 bump` sets `v++` then
`$.ui.invalidate('prompt.context')`.
**Blocked by:** none.
**Pass bar:** findings "S2" has, with the model asked each time "what does the MEMO block say?"
(or the hook's call counter): (a) hook runs on turn 1; (b) runs again after `/compact` AND after
an auto-compaction (fill context past the threshold, or lower it with
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` — record the setting used); (c) runs again after `/clear` and the
block is present; (d) after `/spike2-2 bump`, the next turn shows `v2`, not `v1`. If (b) or (c) NO
→ plan 09 re-injects from `session.start` + `turn.start` with a per-turn "memo present?" check, or
falls back to a `prompt.compose` section. If (d) NO → memo edits apply after `/clear` only; say so
in the command's reply.

- [ ] 1: write the hook + `bump` command; validate
- [ ] 2: interactive: turn 1, ask for MEMO text → record counter and answer
- [ ] 3: `/compact`, ask again; then force an auto-compaction, ask again → record
- [ ] 4: `/clear`, ask again → record; `/spike2-2 bump`, ask on the next turn → record

### Task 3 (S3): `$.ui.ask` from a `tool.call` hook under bypass and default mode; under `-p` (plan 08)
**Files:** `spike2-mod/hooks/register.tsx`.
**Interfaces:** `on('tool.call', { tool: 'Bash' }, async ($, e, next) => { if (!/spike2-ask/.test(e.input.command)) return next(e); try { const a = await $.ui.ask('Run?', ['Run','Cancel']); $.store.set('s3', { a }) } catch (err) { $.store.set('s3', { err: String(err) }) } return next(e) })`
(mirror `tool-call.ts` example for the `e` shape; add `.catch` per shared rule 3).
**Blocked by:** none.
**Pass bar:** findings "S3" has three rows — default mode, `--permission-mode bypassPermissions`,
`claude -p … --permission-mode bypassPermissions` — each with: dialog shown (Y/N), answer returned,
or the rejection text and timing under `-p` (immediate reject vs hang; use `timeout 60`). Also
record whether `tool.check` `ask` is auto-allowed under bypass (one extra hook returning `{ ask }`)
— plan 08 cites this. If ask is NOT shown under bypass → plan 08 drops confirm-rules in bypass and
keeps hard `{ deny }` only. If `-p` hangs → plan 08 must gate on `(await $.session.surfaces()).length > 0`
and `{ deny }` otherwise (shared rule 2).

- [ ] 1: write the hook; validate
- [ ] 2: interactive default mode: ask Claude to run `echo spike2-ask` → record
- [ ] 3: interactive bypass mode, same → record
- [ ] 4: `timeout 60 claude -p "run echo spike2-ask" --plugin-dir … < /dev/null` → record exit, stderr, `s3`

### Task 4 (S4): `classic.Stop`/`SubagentStop` input incl. `background_tasks`; `turn.step` timing (plan 07)
**Files:** `spike2-mod/hooks/register.tsx`.
**Interfaces:** `on('classic.Stop', ($, e, next) => { store e.background_tasks, e.session_crons, e.last_assistant_message length; return next(e) })`; same for `classic.SubagentStop` (log `agent_id`);
`on('turn.step', async function* ($, e, next) { const t0 = Date.now(); const r = yield* next(e); log({ index: e.index, ms: Date.now()-t0, keys: Object.keys(r) }); return r })`.
**Blocked by:** none.
**Pass bar:** findings "S4" answers: (a) `classic.Stop` reaches a module (yes/no) and
`background_tasks` has entries when a `run_in_background` Bash is still running at Stop; (b)
`classic.SubagentStop` reaches it with `agent_id`; (c) `turn.step` fires once per model step (a
turn with 3 tool calls → count), what `TurnStepResult` carries (no duration field expected → the
wall-clock `ms` above is the measure), and the overhead of a pass-through generator. If (a) NO →
plan 07's orphan watcher polls `$.process.run(['ps', …])` on `turn.complete` instead. If (c) per-step
NO → plan 07 times turns with `turn.start`→`turn.complete` only.

- [ ] 1: write the three hooks; validate
- [ ] 2: `claude -p` run starting `sleep 120` in background then ending the turn → record Stop payload
- [ ] 3: a prompt that spawns a subagent → record SubagentStop payload
- [ ] 4: a 3-tool-call turn → record `turn.step` count and `ms` per index

### Task 5 (S5): a `file://` Link in a Pane — click behaviour in terminal and desktop (plan 07)
**Files:** `spike2-mod/hooks/register.tsx`.
**Interfaces:** `/spike2-5` opens Pane `s5` with `<Link href="file:///tmp/spike2-s5.md">`,
a `<Link href="file:///tmp/spike2-s5.md" label="labelled">`, and a plain `https://example.com`
Link for contrast; the command first writes `/tmp/spike2-s5.md` via `$.fs.write`.
**Blocked by:** none.
**Pass bar:** findings "S5" states per surface (terminal, desktop Code tab): link drawn as link or
plain text (the types say a non-`https` href on a remote surface is drawn plain), what a click does
(opens default app / editor / nothing / error), and whether Cmd-click differs. If NO (nothing opens
or drawn plain) → plan 07 shows the path as copyable `<Text>` with the "open in your editor" hint
and no Link.

- [ ] 1: write the command; validate
- [ ] 2: terminal: click each link (and Cmd-click) → record
- [ ] 3: desktop Code tab: same → record

### Task 6: Write the findings
**Files:** create `plan/mod/05-spike-2-findings.md`.
**Blocked by:** Tasks 1–5.
**Pass bar:** five sections `## S1` … `## S5`, each with command, observed output excerpt,
verdict and "if NO → consequence for plan 0X"; a closing "Plan changes" list naming each of
06–09 step that must change; README.md "Shared rules" updated only if a finding contradicts one.

- [ ] 1: write → 2: re-read `06-*.md` … `09-*.md` and fix any step that relied on a disproved assumption
