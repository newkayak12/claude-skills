# Routing reference

Detail behind the Routing section of `SKILL.md`. Read when a run needs anything beyond
the balanced default.

## Legacy `ordered` allocation

`allocation: "ordered"` remains the default for direct callers that omit allocation.
`graph_open` then takes `vendor`:

| value | behavior |
|---|---|
| `"auto"` (default) | **stays on `self`** — the candidate list is empty unless you pass `candidates` |
| `"auto"` + `candidates: [...]` | try those vendors in order, fall back to `self` |
| a vendor name | require it — a node returns `vendor-failure` rather than degrading |
| `"self"` | the host dispatches each node to a fresh native agent |

**Registering a vendor does not enrol it in `auto`.** An installed, ready Codex still goes
unused in a bare `graph_open({vendor: "auto"})` call until you name it (`vendor: "codex"`)
or list it in `candidates`.

## Host identity and provenance

The requesting session may be Codex or Claude; its identity does not determine node
ownership. `vendor: "self"` means host-managed execution: dispatch each briefing to a
fresh native agent without inheriting the conversation, then submit its result. The
lead holds only run identifiers, paths, and compact verdicts. Never execute all roles
in the lead's accumulated context. If the host cannot provide fresh role contexts,
use a permitted external executor or report the execution capability as unavailable.

Do not impose equal quotas or assume one vendor is universally better. Fresh context
is required even when the same vendor handles different roles. Verify actual native
executor provenance before submitting; broker executor/model fields record assignment,
not independent proof of which native model the host actually launched.

Use explicit vendor policies or candidates when the task calls for an available external
executor. Do not infer availability from a vendor name or an installed binary; use the
broker's readiness probe. Inside Codex, execute harness stages with native tools rather than
delegating them back into a nested Codex CLI process. A user-supplied vendor, candidate
list, model, or policy overrides the defaults, subject to the host session's execution
constraints.

Both Codex and Claude adapters are bundled. In balanced mode `claude` is a real vendor;
the old alias to `self` exists only in legacy ordered mode. When the selected vendor
is the host, native agents execute it. A Codex host never launches nested Codex CLI.
The broker enforces routing and persists recovery artifacts, but native session isolation
and code snapshot attribution remain caller obligations. No token/spending cap is imposed.

Name the vendor when the run must prove who did the work. Silent degradation is what
lets a graph claim an external vendor implemented something it never touched.

## Per-stage policy

`vendor` and `model` apply to the whole run. `policy` overrides them per stage — this is
how the harness contract (reasoning on a strong model, execution on whatever can actually
write here) gets expressed:

```js
graph_open({
  request, cwd,
  vendor: "self",                         // current session; retain its model
  policy: {
    implement: { vendor: "codex", model: "gpt-5.6-sol" },
    test:      { vendor: "codex" },
  }
})
```

That example is optional external routing from a Claude session. Use a named `codex`
vendor for execution when provenance matters: unlike `auto`, it blocks visibly on
readiness failure instead of silently turning an implement or test node back into
Claude work.

Keys are stage names — `plan`, `setgoal`, `critique`, `implement`, `test`, `gate`,
`report` — plus the optional `gate:goal`. Each entry may set `vendor`, `candidates`,
`sandbox`, `model`. A stage entry wins over the run-level setting; a stage with no entry
inherits it. `graph_next` reports the chosen `model` per ready node.

For a `self` node, launch a fresh native agent at the returned model. Declare supported
models through `native_models` so unsupported tiers are routed away or visibly blocked.

Readiness is a real write probe, not a version check: a sandbox can start, accept the
run, write nothing, and still exit 0.
