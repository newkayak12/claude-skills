# session plugin, Bundle C: pinned memo mod

Status: design for approval (CLAUDE.md "Design Changes": plan, setgoal, critique, approval, then code). Plugin `session` is shared with other bundles; this doc covers the memo mod only. Principles: `plan/mod/README.md`; API facts: `plan/mod/00-spike-findings.md`, the `plugin-authoring` types (engine 2.1.293).

## Context
Mods exist for mods/diag/trophy. Backlog already names `prompt.compose`/context injection (teams). Compaction summarises the conversation and can drop short asides the user typed ("use staging DB", "do not touch X").

## Problem
A short, user-owned note has no place that is both cheap to write mid-session and guaranteed to reach the model after compaction.

## Design

### Feasibility (what the API does and cannot do)
- Can: `prompt.context` hook gives the blocks of the conversation's first user message, re-read after compaction and `/clear`, cached until `$.ui.invalidate("prompt.context")`. This is the right seam. `prompt.compose` (system prompt, `session` scope) also works but spends the prompt cache and makes user text system-level; rejected. `prompt.submit` `context` works but appends to history on every prompt (token cost grows per turn, compaction can eat it); rejected.
- Can: `$.store` (JSON, cross-session, 4 MiB cap), `$.command.register` + `command.run`, `$.ui.open` pane, `$.session.root()/id()` for scoping, `$.ui.toast`.
- Cannot: the API has no "inject on every prompt, uncacheably" guarantee beyond the blocks above; a block edit mid-conversation only takes effect at the next re-read (invalidate), not retroactively in earlier turns. Cannot show the model's actual rendered request; the mod can only show what it hands to the hook.
- Unverified: whether the pane edits text in place (needs a text input element; check `Pane` props) else edits go through commands only.

### Components
1. Memo store: notes list per scope in `$.store`.
2. Command `/memo`: `add <text>`, `rm <n>`, `list`, `clear`, `scope <session|project|global>`; zero-token answers via `command.run` `{ text }`.
3. Pane "Memo": the exact injected text, per-note token estimate, total vs cap, scope tags. Read-only view plus remove buttons.
4. `prompt.context` hook: appends one block `memo` after core blocks; nothing when empty.

### Data flow
`/memo add` -> store write -> `$.ui.invalidate("prompt.context")` -> next prompt re-renders the block -> model sees it. Compaction/`/clear` re-read the same block from the store, so notes survive.

### Scope & storage
- project: key by `$.session.root()` (default; most notes are repo-bound).
- session: key by `$.session.id()`; dropped on `session.end` unless pinned.
- global: one key; all repos.
Injected order: global, project, session. Each note carries its scope tag in the rendered block so the user can audit.

### Role vs CLAUDE.md and auto-memory
- CLAUDE.md: durable, versioned, team-shared rules. Memo: ephemeral, personal, not committed; a note that outlives a week should be promoted to CLAUDE.md (pane shows note age, hints at 14 days).
- Auto-memory: model-written, model-curated facts. Memo: user-written only, never auto-edited by the model. The mod exposes no model tool in v1.

### Injection rules
- Cap: 8 notes, 280 chars each, 1,200 chars total (about 300 tokens). Over cap: `add` refused with a toast naming the limit; nothing is truncated silently.
- Block is plain text under a fixed header ("User pinned notes, authoritative, set by the user"), no markdown the user did not write.
- Cost: about 300 tokens max, once per conversation (cached in the first message), not per turn.
- Visibility: pane and `/memo list` print the byte-identical block; status line shows `memo N/8 ~T tok` when non-empty.

### Error handling
- Headless (`-p`): no pane or toast; `/memo` text results still work; hook injects from the store as normal. Add via command only.
- Empty: hook returns blocks unchanged; pane shows usage line; no status entry.
- Oversize: refuse at write time; a store already over cap (hand-edited) is truncated at note boundary and the pane flags it.
- Store missing/corrupt/unreadable: treat as empty, never throw into the prompt path, one toast in interactive mode ("memo store unreadable, notes not injected"). A failed hook already passes through (engine).

### Testing (`claude plugin test`)
1. empty store: `prompt.context` result equals input.
2. one project note: block present, after core blocks, with header and scope tag.
3. cap: 9th note, 281-char note, and total-over refused; store unchanged.
4. scope isolation: project A note absent when root is B; global present in both.
5. compaction survival: re-fire `prompt.context` after a simulated compact; block identical.
6. `/memo rm`/`clear` invalidate, block disappears.
7. corrupt store value: hook returns input, no throw.
8. headless: command works with no `$.ui` answers.
9. pane text equals the injected block (golden).

## Done-criteria
- Notes added by command or pane appear in the next prompt's context and after `/compact`.
- Pane output equals injected block exactly.
- Hard caps hold; max cost about 300 tokens, once per conversation.
- Works headless via commands; store failure never blocks a prompt.
- `claude plugin validate` and `tsc` clean; tests above pass.

## Critique
- YAGNI: three scopes may be one too many; keep project + global first, session only if asked? Kept because "survive compaction" is a session-level need.
- Overlap: CLAUDE.md `# ` quick-add and auto-memory cover durable facts; memo justifies itself only as ephemeral and user-owned. Risk: becomes a second CLAUDE.md. Mitigated by caps and age hint.
- Token cost: bounded and cached; but a stale note silently steering the model is the real cost, hence the always-visible status entry.
- Prompt-injection hygiene: memo is user text placed with instruction authority; fine for a single-user store, but a shared `$.store` file edited by another tool would be trusted. Header states origin; no model-writable path.
- Fixed header wording is itself a behaviour change; test it with a bench prompt before shipping.

## Open questions
1. Does `prompt.context` re-fire reliably after auto-compaction (types say yes; verify in a spike)?
2. Can a Pane host a text input, or is `/memo add` the only writer?
3. Is session scope worth keeping in v1?
4. Should project key be git root or `session.root()` (worktrees differ)?
5. Plugin name `session` vs a narrower name once other bundles land.

## Decisions (2026-10-08, approved in brainstorming)

- Ships as a module inside the `session` plugin.
- v1 scopes are project and global only; session scope is dropped.
- `/memo` is the only writer in v1; the pane stays read-only.
- `prompt.context` re-fire after auto-compaction is verified in the shared Task 0 spike.
- Build order: 4th of four — lowest value of the set (overlaps CLAUDE.md / auto-memory); cut first if scope must shrink.
