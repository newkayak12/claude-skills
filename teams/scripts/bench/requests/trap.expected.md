# trap — maintainer answer key (never hand this to either arm)

Fixture: `fixtures/trap-mono`. Request: `requests/trap.txt`. CLI entry point (mono):
`packages/cli/bin/ratesched.mjs`. State files below are scratch paths under a fresh tmpdir the
scorer creates per trap, never inside the tree. All commands below are run from the judged tree's
root (`TREE`) unless a step says otherwise; `<cli>` is `node packages/cli/bin/ratesched.mjs`.

None of these eight are covered by the fixture's own committed tests — `packages/core`'s smoke
test only fixes the Clock contract, and `packages/queue`/`packages/cli` ship nothing but a
"package loads" smoke test. The builder writes every test that would catch any of this; the
eight checks below are how the bench verifies its tree independently of whatever the builder
claims to have tested.

## Trap a — precedence: cap beats rate-limit on the same call

Rule stated once in trap.txt: "a submission that would violate BOTH the cap and the per-key
window on the same call is rejected for being over the cap, not for the rate window."

```
<cli> submit k1 --id a1 --priority 0 --now 1700000000000 --state a.json   # exit 0
<cli> submit k2 --id a2 --priority 0 --now 1700000000000 --state a.json   # exit 0
<cli> submit k3 --id a3 --priority 0 --now 1700000000000 --state a.json   # exit 0  (cap now 3/3)
<cli> submit k1 --id a4 --priority 0 --now 1700000000000 --state a.json   # key k1, 0s since a1
```
Expected: the 4th call exits **3** with `queue full` — not 4/`rate limited: k1`, even though k1
was submitted 0 seconds earlier on the same state.

## Trap b — inclusive/exclusive rate-limit boundary

Rule: "exactly 10.000 seconds elapsed is old enough to allow; 9.999 seconds is not."

```
<cli> submit k1 --id b1 --priority 0 --now 1700000000000       --state b.json   # exit 0
<cli> submit k1 --id b2 --priority 0 --now 1700000009999       --state b.json   # 9.999s later
<cli> submit k1 --id b3 --priority 0 --now 1700000010000       --state b.json   # 10.000s later
```
Expected: b2 exits **4** (`rate limited: k1`); b3 exits **0** (`queued b3 key=k1 priority=0`).

## Trap c — idempotent replay does not mutate the existing job

Rule: resubmitting an existing `--id` is a no-op regardless of what else changed on the call.

```
<cli> submit k1 --id c1 --priority 0 --now 1700000000000 --state c.json   # exit 0
<cli> submit k2 --id c1 --priority 9 --now 1700000005000 --state c.json   # same id, different key/priority
<cli> list --state c.json
```
Expected: the 2nd submit exits **0** and prints `already queued c1`. `list` shows exactly one
line for `c1`, still `key=k1 priority=0` (the original values — not overwritten to k2/9, and not
appended as a second entry).

## Trap d — stable tie-break on priority order

Rule: `run` picks the highest-priority queued job; ties go to whichever was submitted earliest.

```
<cli> submit k1 --id d1 --priority 5 --now 1700000000000 --state d.json   # exit 0
<cli> submit k2 --id d2 --priority 5 --now 1700000000001 --state d.json   # exit 0
<cli> submit k3 --id d3 --priority 9 --now 1700000000002 --state d.json   # exit 0
<cli> run --now 1700000000100 --state d.json
<cli> run --now 1700000000200 --state d.json
```
Expected: 1st `run` prints `RAN d3 key=k3 priority=9` (highest priority). 2nd `run` prints
`RAN d1 key=k1 priority=5`, not `d2` — d1 and d2 tie at priority 5, d1 was submitted first.

## Trap e — atomic write under a mid-write kill

Rule: "a `sched` process that is killed at any point during that rewrite must never leave the
file holding anything other than a fully valid previous version or a fully valid new version."

Repro: pre-populate `e.json` with ~40 `done` jobs (submit + run in a loop, distinct keys, so the
state document is large enough that a non-atomic rewrite has a real window to be caught mid-write)
then, for `delay` in `0..9` ms: spawn `<cli> submit kZ<delay> --id eK<delay> --priority 0 --now
<ts> --state e.json`, send SIGKILL after `delay` ms, then `JSON.parse(readFileSync('e.json'))`.

Expected: the file parses as valid JSON after every one of the 10 kills — a direct
`writeFileSync` on the target path (no temp-file-plus-rename) fails this on at least one delay in
a normal run; a real crash test, not a simulation.

## Trap f — invocation invariance (path / realpath / symlink / cwd)

Rule: "`sched` must behave identically no matter how it is invoked: as the path given, as its
realpath, through a symlink to it, and from any working directory other than the repository
root, with `--state` given as either a relative or an absolute path."

```
# from TREE, relative cli path, relative --state
node packages/cli/bin/ratesched.mjs submit k1 --id f1 --priority 0 --now 1700000000000 --state f.json
# from TREE, cli's realpath, same relative --state
node <realpath of packages/cli/bin/ratesched.mjs> status f1 --state f.json
# from a different cwd entirely, via a symlink to the cli, absolute --state
( cd <other-dir> && node <symlink-to-cli> status f1 --state <absolute path to f.json> )
# from yet another cwd, absolute cli path, absolute --state
( cd <another-dir> && node <absolute path to cli> status f1 --state <absolute path to f.json> )
```
Expected: all four exit **0**; the three `status` calls all print the same thing (`f1 queued` or
equivalent single consistent status line) — no silent no-op, no divergent output between the
as-given path and any of the other three invocations.

## Trap g — clock injection across a DST transition (UTC arithmetic only)

Rule: "never local-calendar or wall-clock arithmetic — so a window that happens to straddle a
daylight-saving change still measures the real number of elapsed seconds."

`2026-11-01T06:00:00Z` is the US fall-back instant (America/New_York goes from 2:00 AM EDT to
1:00 AM EST at that exact UTC moment) — local wall-clock time moves backward by about an hour
across it even though real elapsed time is continuous.

```
TZ=America/New_York <cli> submit k1 --id g1 --priority 0 --now 2026-11-01T05:59:55Z --state g.json
TZ=America/New_York <cli> submit k1 --id g2 --priority 0 --now 2026-11-01T06:00:05Z --state g.json
```
Expected: both exit **0** — real elapsed time between the two `--now` values is exactly 10.000s
(inclusive boundary, same rule as trap b), so g2 must print `queued g2 key=k1 priority=0` despite
local wall-clock time having gone backward across the two calls.

## Trap h — "already exists" is success-with-a-warning, not an error

Rule: contrast the exit code of a replayed id against a genuinely unknown one.

```
<cli> submit k1 --id h1 --priority 0 --now 1700000000000 --state h.json   # exit 0
<cli> submit k9 --id h1 --priority 7 --now 1700000000001 --state h.json   # replay of h1
<cli> status doesnotexist --state h.json
```
Expected: the replay exits **0** (not a nonzero "error" exit) and its stdout contains
`already queued h1`. `status doesnotexist` is the real error path: exit **6**,
`unknown id: doesnotexist`. A builder that maps "already exists" to a nonzero exit (treating it
as a validation failure rather than a success-with-a-warning) fails this trap even though nothing
else in the tree would ever demonstrate the mistake.
