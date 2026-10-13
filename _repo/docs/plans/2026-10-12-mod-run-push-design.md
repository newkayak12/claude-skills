# Push on run outcomes and rejects (harness, graph, teams) — 2026-10-12

Approved by the user 2026-10-12 ("harness, graph, teams 다"; "reject 나면 알려주는게 맞지 그래야 상태를
가늠하지"). Extends `2026-10-12-mod-worktrees-gate-push-design.md` §2 (gate-deny push; on main, unreleased).

## Rule (same in all three mods)

- Send `$.tool.call({ tool: 'PushNotification', message, status: 'proactive' })`; when the result is not
  `pushSent`/`localSent` (user at the terminal, off, no transport) or the call throws, show the same line as
  `$.ui.toast`. One line, ≤ 200 chars, leading with what to act on.
- Once per (run, node/stage/package, kind, attempt). Nothing that happened before this session started.
  Interactive sessions only; every failure is silent (fail open). Progress ("stage started") is never pushed.

## Events

| plugin | push on |
|---|---|
| harness | gate deny (shipped); a **reject**: critique `sound:false`, a QualityGate / goal gate that fails or sends a subgoal back for retry; run **failed** (retries spent); run **complete** (report written) |
| graph | a **reject**: a node verdict that fails and is retried; run **failed** / blocked (retries spent); run **complete** |
| teams | a **reject**: a package gate or QA that fails or sends work back; a person must act (waiting 0 → >0); run **ended** (`daemon_done`). Existing per-event toasts stay. |

Message shape: `<plugin> <run>: <kind> — <node/stage> (<attempt>/<max>)`, e.g.
`harness mods-retire: rejected — QualityGate s2 (1/2)`, `teams T12: QA rejected pkg auth (retry 1)`.

## Done when

Per plugin: tests (each event kind pushes once; repeats and pre-start events do not; not-sent → toast;
throw → toast); `claude plugin test` / `validate` pass; README/KOR mod section + status line; minor bump.
Live: one forced reject per plugin raises the toast in a pty session.
