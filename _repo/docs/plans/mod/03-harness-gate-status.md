# 03 — harness mod: say what the gate is doing before it denies

> Produced by write:plans (2026-10-06). Starts after `00-spike-findings.md` passes and
> `01-gate-heredoc-fix.md` ships (this mod explains the gate's decisions; they should be right
> first). Design-change rule applies (harness behaviour).

**Goal:** in an interactive session the person sees whether the harness gate is armed and
engaged, and can ask why the last call was denied, without reading the hook's source.
**Architecture:** the gate stays the command hook (`harness/hooks/goal-gate.mjs`); it gains one
side effect — on each decision it writes `{ts, tool, target, decision, reason}` to
`.claude/.harness-markers/last-decision.json` (best effort, never throws). The mod reads that
file and `.claude/harness-gate.json` with `$.fs`; it never decides anything itself.
**Tech stack:** node:test (`harness/scripts/test-goal-gate.mjs`); mod API (`$.ui.status`,
`$.fs`, `$.clock.every`, `command.run`, Pane); `claude plugin validate|test`.

---

### Task 1: The gate records its last decision
**Files:** modify `harness/hooks/goal-gate.mjs`, `harness/scripts/test-goal-gate.mjs`.
**Interfaces:** produces `.claude/.harness-markers/last-decision.json` =
`{ ts, session_id, tool, target, decision: 'allow'|'deny', reason }` (only for calls whose
target matched a gated pattern).
**Pass bar:** test: a denied Write on a gated path writes the file with `decision:'deny'` and
the target; an allowed engaged Write writes `allow`; an unwritable markers dir leaves the
hook's stdout and exit code exactly as before.

- [ ] 1: tests (red) → 2: implement inside the existing try, after the decision → 3: green → 4: commit

### Task 2: Status line
**Files:** create `harness/hooks/mod.tsx`, `harness/types/index.d.ts`, `harness/hooks/mod.test.ts`;
modify `harness/hooks/hooks.json` (add `"modules"`), `harness/.claude-plugin/plugin.json`.
**Interfaces:** state `PluginState['harness'] = { last: Decision | null; armed: boolean }`.
Every 5 s (interactive sessions only, as in `02` Task 3): read the config and the decision
file; status text:
- no `.claude/harness-gate.json` → `undefined` (clear)
- armed, last decision `allow` or none → `gate: armed (<n> patterns)`
- last decision `deny` in the past 10 min → `gate: denied <target> — /harness-gate`
**Pass bar:** mod test with `$.fs` mocked for the three cases → the three texts; a read error
→ status unchanged, no throw.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 3: `/harness-gate` explain pane
**Files:** modify `harness/hooks/mod.tsx`, `harness/hooks/mod.test.ts`.
**Interfaces:** command `harness-gate` opens pane `harness-gate` drawing: patterns, window
hours, last decision (tool, target, reason, age), and the three ways to engage the gate
(graph_open, the harness skill, an Agent Team fallback run with plan/spec/critique on disk) —
the same words as the deny message in `goal-gate.mjs`.
**Pass bar:** mod UI test on `terminal` and `desktop` for: no config, armed with no decision,
a recent deny.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 4: Ship
**Files:** `.claude/hooks/goal-gate.mjs` (copy), `harness/README.md`, `harness/KOR.md`,
`harness/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`.
**Pass bar:** `claude plugin validate harness` clean; `claude plugin test harness` green;
`node --test harness/scripts/test-*.mjs` green; validator PASSED; one interactive session in
this repo shows `gate: armed`, then after a deliberately gated Write without engagement shows
the deny line and `/harness-gate` explains it.

- [ ] 1: minor bump by hand (new feature) → 2: copy gate → 3: checks → 4: live check → 5: commit + push
