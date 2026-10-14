# trophy telemetry v3 — design (2026-10-13, revised against trophy 0.8.4)

Approved by the user 2026-10-12/13 ("추가 후보 해해"); implementation go-ahead 2026-10-13 ("여기 처리할 거 나머지 합시다").
Consent v2 → v3. Built against trophy 0.8.4 on main. Releases are batched (`_repo/MAINTAINING.md`): this work bumps no
version and adds no README/KOR status line; both come at the batch bump (new behaviour → minor).
Original design: `_repo/docs/plans/mod/04-trophy.md`. This revision applies the 15 problems of the critique in
`.harness-run/trophy-telemetry-v3/02-critique.json` (run parked). Run v3b (`.harness-run/trophy-telemetry-v3b/`) stopped at
its s1 probe: on this machine `classic.PostToolUse` never reaches a user-tier module (below). Revision 3 (user-approved
2026-10-13): MCP counting moves to `tool.call`, and run outcomes are **published by graph, teams and harness** and consumed by
trophy, which no longer reads their MCP JSON, state enums or fallback-check output (§4). The run is `trophy-telemetry-v3c`
(files in `$TMPDIR/trophy-v3c/`), superseding v3b.

Codex: trophy's Codex manifest ships an empty hook overlay (`hooks/codex.json`, "Claude Code only"). Everything
here is Claude-only; `codex.json` and `.codex-plugin/` are not touched (the producer edits in §4 are in the graph,
teams and harness Ink mods, also Claude-only; their `hooks/codex.json` files are not touched either).

## Why
Today's events can't tell which plugin release a usage count belongs to. They don't measure DAU or retention, and they don't give an MCP failure *rate* (only errors are counted). Teams, graph and harness runs can't be judged by how they end. The user also can't tell whether a send happened: nothing records it.

## What changes

### 1. Plugin version on usage events
- At each interactive `session.start`, `loadOwned` already reads marketplace versions (`owned.versions`). Now it also stores
  `trophy.versions: Record<day, Record<plugin, version>>`, keeping only this marketplace's plugins; the last version seen that day wins.
- `buildBatch` adds `plugin_version` to `skill_used` (from the use's plugin), `trigger_result` (from the skill's plugin prefix)
  and `mcp_tool_result`, when known.
- Lookup is the pure `versionOn(versions, day, plugin)`: the **newest `versions` entry on or before that day** that names the
  plugin. A session that crosses midnight UTC writes no entry for the new day, so an exact-day lookup would miss its uses.
  A day before any entry gets no `plugin_version`.
- `Use` and `DayCounts` keep their shape, so the pane, profile.json and old stores are unaffected.

### 2. Daily activity
- `session.start` (interactive only) increments `trophy.activity[day]["<cc>|<os>"]` (the session count) and sets the
  session's `lastActiveDay` atom to that day.
- `prompt.submit` (active only): when today ≠ `lastActiveDay`, it marks `trophy.activity[today]["<cc>|<os>"]` (adds the key
  with 0 if missing; never increments) and sets `lastActiveDay`. So a session left open past midnight UTC still makes its
  later days active. Without this, those days would have `skill_used` but no `daily_active`, and DAU/retention would undercount.
- `sessions` counts each interactive `session.start`, which includes resume, `/clear` and a mod reload if the engine refires
  it. A day reached only through `prompt.submit` sends `sessions: 0`. The README says so.
- `cc` = `$.session.version().base` (already read into `cc`). The engine has no OS API, so
  `os = osOf(await $.env.get('HOME'), await $.env.get('USERPROFILE'))`, both literal keys (`claude plugin validate` lists them):
  - HOME `/Users/…` → `darwin`
  - HOME `/home/…` or `/root` → `linux`
  - HOME `X:\…`, `X:/…` or Git Bash `/c/Users/…` (`/<letter>/…`) → `win32`
  - HOME unset and USERPROFILE set → `win32`. Native Windows Claude Code usually has no HOME.
  - anything else → `other`
- The label is computed once per session (module-level). HOME and USERPROFILE are never stored or sent: only the label is.
- New event `daily_active`, one per (day, cc, os).

### 3. MCP tool success counts (on `tool.call`)
Why `tool.call`, not `classic.PostToolUse`: the v3b s1 probe (`$TMPDIR/trophy-v3b-s1.md`, `claude -p` and one pty run,
claude 2.1.296) saw no classic hook fire for a module, not even for Bash; `--debug-file` logs
`classic.PostToolUse bypassed by cc-plugin-sec-default (tier user)`, the same org-policy mechanism as `skill.prompt` in
00-spike-findings. `tool.call` chains did fire. trophy already counts Skill, Bash and Write there, so MCP joins them.

- One new hook `on('tool.call', …)` (no tool filter). It returns `next(e)` at once unless trophy is active and `e.tool`
  starts with `mcp__plugin_`. Otherwise `const r = await next(e)`, then (inside `safe`, `.catch(failOpen)`) it counts and
  returns `r` unchanged. A throw from `next` is rethrown and counts nothing.
- Ownership: `mcp_server` is absent on `tool.call` (probe), so it is the **name prefix**
  `mcp__plugin_<owned plugin>_<declared server>__<tool>` against `owned.servers`. Only plugin-provided servers get the
  `mcp__plugin_` prefix, and only this marketplace's plugins are in `owned.servers`. `ownedMcpTool` keeps its provenance
  check for the PostToolUseFailure branch; the tool.call path uses a prefix-only match.
- Result shape on `tool.call` (v3c probe, `$TMPDIR/trophy-v3c-probe.md`): `{ref, result: string, text: string, isError?}`.
  `r.isError === true` → `.error`, else `.ok`, decided **once, in this one hook**, into
  `trophy.mcpCalls[day]["<plugin>|<tool>"]`. The PostToolUseFailure branch does not touch `mcpCalls` (no double count where it fires).
- **ok means transport ok**, not "did what was asked". A teams tool can return `{error: '…'}` as a normal result, and that
  counts as ok. The README and the event table say so.
- This covers graph-engineering (`graph_*`), knowledge-local (`knowledge_*`), task-manager (`tm_*`), teams-engineering
  (`team_*`) and teams-wiki (`wiki_*`).
- New event `mcp_tool_result`. `diag_mcp_error` and its PostToolUseFailure branch stay unchanged.

### 4. Run outcomes: published by the producers, consumed by trophy
trophy must not be coupled to graph/teams/harness internals (user, 2026-10-13). So trophy parses none of their MCP JSON,
state enums or fallback-check output. Each producer **publishes** a run outcome from the point where its mod already
detects it for its push notification, and trophy **consumes** it. No new detection logic on either side.

**Event shape** (the one shared contract, a `$.state` value each producer owns):

```ts
// declared by each producer in its types/index.d.ts PluginState as `outcome: RunOutcome | null`
type RunOutcome = { system: 'graph' | 'teams' | 'harness'; outcome: 'pass' | 'reject' | 'fail'; at: number /* epoch ms */ }
```

No ids, slugs, paths, titles or counts: only the two fixed labels and a timestamp (`at` makes repeat writes distinct and is
never sent). Allowed values are exactly the unions above; trophy drops anything else.

**Producers** write `$.state.set({ plugin: '<self>', key: 'outcome' }, { system, outcome, at: await $.clock.now() })`
once per run outcome, at the same place and under the same dedupe as the push (so runs written before the session started
publish nothing, as they push nothing). Wrapped fail-open: a failed write never breaks the push or the pane. With trophy
absent nothing reads the value; behaviour is otherwise unchanged.

| producer | existing detection (push point) | pass | reject | fail |
|---|---|---|---|---|
| graph | `graph/hooks/mod.tsx` `events(run)` / `notifyRun` | `complete` | — | `failed` (retries spent), `blocked` (routing) |
| teams | `teams/hooks/mod.tsx` `pushEvent` on `daemon_done` / `daemon_exhausted` | `daemon_done` state `complete` | `daemon_done` state `partial` | `daemon_done` state `blocked`, `daemon_exhausted` |
| harness | `harness/hooks/mod.tsx` `runEvents` / `notifyRuns` (fallback runs; graph runs are left to graph) | `Report complete` | `goal gate failed` (report written) | `subgoal failed` (retries spent) |

- Attempt-level `rejected` events (a node retry, a critique `sound:false`, a gate before the report) are pushes, not run
  outcomes: they publish nothing.
- teams: `TeamsEvent` carries no state today (`daemon_done` text is `<id> finished: <state>`); `view-events.mjs` adds the
  daemon's `state` as a field on `daemon_done` lines and the type gains `state?`, so the mod maps a field, not text.
- `teams-engineering` child graph runs are graph runs inside a teams task; they are published by the graph mod only if it
  shows them (it reads `.harness-run/broker/` of the cwd). A teams task and its child graph run may both count, under their
  own system; the README says so.

**Consumer** (trophy): three hooks `on('state.set', { plugin: 'graph' | 'teams' | 'harness', key: 'outcome' }, …)`, literal
refs. Each returns `next(e)` first, then, if trophy is active, `outcomeOf(e.value, '<system>')` (pure: the value's `system`
must equal the hooked plugin, `outcome` in the set, else `undefined`) → `trophy.outcomes[day]["<system>|<outcome>"] += 1`.
No `dependencies` in plugin.json (it breaks old installs): trophy declares the three refs in its own `types/index.d.ts`
(local augmentation or a local cast, whichever `claude plugin test`/`validate` accept). trophy works with producers absent
(no writes, no counts).

**Unknown, verified first (stop condition):** whether trophy's `state.set` hook fires for another plugin's write when trophy
does not list it under `dependencies`, under `claude -p --plugin-dir` and interactively. If it does not, the run stops and
these fallbacks go to the user, none picked here:
- (a) **well-known file**: the producer appends one `RunOutcome` JSON line to `~/.claude/trophy/inbox.jsonl`; trophy reads and
  truncates it at `session.start`/`turn.complete`. Works without the engine bus; costs a shared path and a read-truncate race.
- (b) **poll the producer's value**: trophy reads `$.state.get({plugin:'graph',key:'outcome'})` on `turn.complete`. Only if
  cross-plugin `get` works without dependencies; with a single last value it misses outcomes between polls, unless the
  producer keeps day counts instead (`{ day, pass, reject, fail }`), which changes the shape above.

New event `run_outcome` (day, system, outcome, count). It counts **run outcomes the producers' interactive mods saw**,
not runs: pass/(pass+reject+fail) is not a per-run success rate, and the README says so. Known distortions:
- A graph `blocked` that is later resumed and completes counts once as fail and once as pass.
- Runs that end outside an interactive session (`teams run` CLI, `-p`, a session closed before the end) are not counted.
- A producer's dedupe is per session: the same outcome seen by two open sessions counts twice.
- graph and harness publish at most once per (run, outcome) (v3c decision): two failed subgoals, a re-written goal gate, or
  graph `blocked` then `failed` count one `fail`. One run can still count different outcomes (a harness run with a failed
  subgoal and a failed goal gate counts fail and reject). teams publishes under its push key; a `daemon_done` state other than
  complete|partial|blocked publishes nothing. harness events carry the outcome as a field, not parsed from the message.

The old local failure records read harness files and the fallback gate's output; that coupling is closed 2026-10-14. trophy now
records a local `subgoal_failed` (harness `fail`) or `goal_failed` (harness `reject`) entry from the harness's published
`outcome` state only. The v3b slug side fix stays dropped with `harnessSlugOf`/`harnessVerdict`/`runStateOf`/`runsSeen`.

## Event allowlist (v3)
Each event's `properties` is built from explicit keys, never by spreading a stored object. Today `skill_used` spreads `...rest` and `trigger_result` spreads `...c`; both become explicit. Every event also carries `$process_person_profile: false`.

| event | keys |
|---|---|
| `skill_used` | `skill, plugin, day, count, plugin_version?` |
| `trigger_result` | `skill, day, hit, miss, unmatched, plugin_version?` |
| `achievement_unlocked` | `id` |
| `plugins_installed` | `plugin, day` |
| `daily_active` *(new)* | `day, cc_version, os, sessions` |
| `mcp_tool_result` *(new)* | `day, plugin, tool, ok, error, plugin_version?` |
| `run_outcome` *(new)* | `day, system, outcome, count` |
| `diag_skill_error` | `skill, plugin, reason, count, day, plugin_version?, cc_version?` (failures.ts, unchanged) |
| `diag_mcp_error` | `tool, plugin, reason, count, day, plugin_version?, cc_version?` (unchanged) |
| `diag_user_report` | `reason, count, day, skill?, plugin?, plugin_version?, cc_version?` (unchanged) |
| `$exception` | `$exception_message` (scrubbed) |

Every row above also allows `$process_person_profile`.

Value rules:
- `os` ∈ {darwin, linux, win32, other}
- `system` ∈ {harness, graph, teams}
- `outcome` ∈ {pass, reject, fail}
- counts are integers
- `plugin`, `skill` and `tool` come only from this marketplace's manifests

The allowlist lives in `logic.ts` as `EVENT_KEYS` (required and optional keys per event). A test checks the **exact key set of
every event** in a `buildBatch` output that includes `failureEvents` rows. Its fixtures seed stray fields (a `cwd` on a `Use`,
an extra key inside a `Counts`, an extra key in an `activity`/`mcpCalls` cell), and the test asserts that none of them appear.

`BatchStore` gains `versions?`, `activity?`, `mcpCalls?`, `outcomes?`, all **optional** (`{}` inside `buildBatch`). Existing
fixtures (send, consent, failcapture tests) and old stores without these keys behave as before.

## Consent v3
`CONSENT_VERSION = 3`. A v2 yes reads as unasked (the existing `effectiveConsent` rule): the band asks once more, and nothing is sent until it is answered. A no stays no.
In `consent.test.ts`, the "current" cases use `CONSENT_VERSION` (not a literal), and an explicit `2` stays as the "older yes" case.
`failband.test.ts` (a v2 no) passes unchanged.

| key | EN | KO |
|---|---|---|
| consentAsk | 📊 trophy · Send anonymous usage stats? | 📊 trophy · 익명 사용 통계를 보낼까요? |
| consentSent | Sent: skill and tool names · daily counts · run results · error codes · plugin/Claude Code versions · OS type | 보내는 것: 스킬·도구 이름 · 일별 횟수 · 실행 결과 · 오류 코드 · 플러그인/Claude Code 버전 · OS 종류 |
| consentNotSent | Never sent: prompts · file paths · project or task names | 보내지 않는 것: 프롬프트 · 파일 경로 · 프로젝트/작업 이름 |
| telemetryReconsent | unasked (earlier yes — needs re-consent) | unasked (이전 동의 — 재동의 필요) |
| lastSendNone | last send: none yet | 마지막 전송: 아직 없음 |
| lastSend | last send: {at} · days {from}–{through} · {events} events · {result} | 마지막 전송: {at} · {from}–{through} · 이벤트 {events}개 · {result} |
| sendNow | trophy telemetry: yes — sent {events} events ({result}) | trophy telemetry: yes — 이벤트 {events}개 전송 ({result}) |
| sendNotDue | trophy telemetry: yes — nothing due (sent through {through}) | trophy telemetry: yes — 보낼 것 없음 ({through}까지 전송됨) |

## Privacy argument
- No new free text is sent. Every new value is one of: a name from this marketplace's manifests, a release string from the engine, a fixed label, or an integer.
- The OS label is derived from HOME/USERPROFILE, but neither is ever stored or sent. It reveals no more than the User-Agent of any HTTP client.
- Run ids, slugs, task ids and paths never reach trophy from the producers (`RunOutcome` has no such field); paths and
  session ids trophy sees stay local (`failures.local`). No event key can carry them, and the allowlist test proves it.
- Session *counts* per day are sent; session *ids* are not.
- The scope of consent widens (versions, OS type, run results), hence v3: no one keeps sending under a yes given to narrower text.

## Send visibility (bug: "it looks like nothing was sent")
Facts:
- The store has `consent: yes, v2`, `sentThrough: 2026-10-12`, and uses on 10-07, 10-08 and 10-12, so the batch was not empty.
- `sendIfDue` advances `sentThrough` only after `res.ok`, or when the batch is empty (no HTTP call at all).
- Events are dated `<day>T12:00:00Z`.
- No toast or log line ever announces a send. The band's "Send" stores the answer only; the first send waits for the next interactive session start.

Most likely, the send succeeded, and the events appear under 10-07…10-12 in PostHog rather than at send time. Not provable now, because nothing records it.

Fix:
1. `sendIfDue` returns what happened:
   - **not due** (no yes, or `sentThrough >= yesterday`): returns `{ due: false, through: sentThrough }` and leaves
     `trophy.lastSend` untouched, so the record of the real send survives a later `on`/Send on the same day. No fetch.
   - **due**: stores and returns `trophy.lastSend = { at: ISO, from: string|null, through, events: n, result:
     'ok'|'http_<status>'|'empty'|'error', error?: scrub(msg) }`. There is no separate `status`: `result` carries it.
     An empty batch is recorded as `empty` (no fetch); a thrown fetch as `error` with the scrubbed message.
   - `lastSend` is local only and never put in a batch.
2. `/trophy-telemetry status` stays **one line**, per the repo's mod rule that an interactive command returns one line at most:
   `trophy telemetry: <answer> · <lastSend | lastSendNone>`.
3. **`/trophy-telemetry on` and the band's Send button run `sendIfDue` at once.**
   - `on` replies on one line: `sendNow` after a due send, `sendNotDue` when nothing is due. The button shows the same
     line as a toast.
   - Why: it sends only the finished days (up to yesterday) that the preview pane already shows, so it adds no data and no new class of send. It gives the person immediate proof. Without it, the first send waits for an unknown next session.
   - `sentThrough` makes it idempotent with the session-start send.
   - A module-level in-flight promise guards against two sends at once (button + session start).
   - `off` never sends.
   - **Change to 04-trophy.** That design fixed "the send happens at `session.start`; a failed send is kept and retried the
     next day, silently". v3 changes it, with the user's approval: a send also happens at once on `on`/Send, and it is
     announced (reply or toast) and recorded (`lastSend`). A failed send still changes nothing and is tried again at the next
     start or `on`.
4. The README's "Once a day (at the start of the first interactive session after midnight UTC)…" paragraph and its
   "A failed send is kept and tried again the next day" line are **rewritten** (EN and KO together): a send happens at once
   on yes, then at the first interactive start of each new UTC day; events are dated by the day they count, not by the send
   time; a failed send is tried again at the next start or `on`; `status` shows the last send.

## Limits (design + README)
- Under an org policy that bypasses user-tier classic hooks (as on this machine), the existing
  `classic.PostToolUseFailure` branch is dead: no `diag_mcp_error` and no Skill `is_error` diag from it. It is kept
  (out of scope here) because it works where no such policy applies.
- `mcp_tool_result.error` (tool.call, every isError) and `diag_mcp_error` (PostToolUseFailure, only where it fires) are
  separate counts and can disagree; neither is derived from the other.
- Parallel MCP calls each run get→set on `trophy.mcpCalls` (as do near-simultaneous outcome writes on `trophy.outcomes`),
  so concurrent events can drop a count: an undercount, the same pattern `record()` already has.
- Run outcomes exist only where the producer's mod runs (interactive, Claude Code) and only for what it detects today
  (graph: the newest run its tick reads).
- Local `subgoal_failed`/`goal_failed` entries now come from the harness mod's published outcome, so coverage shifts: the
  harness mod scans only the cwd's `.harness-run`; the old tmp-path exclusion is gone (a scratch run under cwd counts); a
  plugin-less embedded harness install publishes nothing, so no record; harness polls on mtime after session start and
  publishes once per (run, outcome) per session, so two failed subgoals give one entry and the record has no slug/subgoal/path
  (`Entry.local` keeps those fields for stored older entries); and `appendEntry` dedupes the same reason within 5 s without a
  target, so a `subgoal_failed` and a repeat inside 5 s in one session count once.
- A call the engine never hands to `tool.call` (or whose `next` throws, e.g. an interrupt) is not counted.

## Out of scope
- `surface` (terminal/desktop), model names, token or cost counts.
- Counting runs in non-interactive sessions (trophy stays idle there by design).
- Run durations, attempt counts, or per-subgoal results; keeping the latest state per run id and counting at send.
- Pruning the per-day maps (`versions`, `activity`, `mcpCalls`, `outcomes`). They share the unpruned `triggers` map's growth;
  not blocking.
- Changing PostHog's project or IP settings.
- Backfilling versions for days before v3 ships: those days send without `plugin_version`.
- A version bump or status line (batch bump).
