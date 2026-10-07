# 04 — trophy: Steam-style achievements for skill use

> Produced by write:plans (2026-10-07) from the think:brainstorming session of the same day.
> Owner for execution routing: planning:executing-plans. Steps use checkbox (`- [ ]`) syntax.
> Design-change rule still applies (CLAUDE.md "Design Changes"): this is the plan stage; the
> design was approved by the user on 2026-10-07.

**Goal:** a person using this marketplace's skills unlocks achievements (toast on unlock, a
`/achievements` pane, `trophy:list` in conversation), sees which skills their prompts should
have triggered, and — only if they opt in — sends anonymous daily counts to the maintainer's
PostHog project.

**Architecture:** a new plugin `trophy` whose hooks module is the whole runtime: one
`skill.prompt` hook records each skill expansion (it fires for `/name`, the Skill tool and
preloads alike), pure functions turn the log into unlocks and trigger hit/miss counts, and a
`session.start` step sends yesterday's aggregate to PostHog when the person said yes. The
catalog of achievements and the trigger-phrase index are data files in the plugin; the index is
generated from every `SKILL.md` by a repo script. The module mirrors its profile to a JSON file
so the `trophy:list` skill can read it.

**Tech stack:** hooks module API 2.1.292 (`skill.prompt`, `prompt.submit`, `turn.complete`,
`session.start`, `ui.render` Pane/AbovePrompt, `$.store`, `$.fs`, `$.http.fetch`,
`$.command.register`), `claude plugin validate|test`, `tsc -p`, node:test for the index script,
PostHog capture `/batch/` endpoint (US Cloud).

---

## Decisions fixed by the brainstorming (do not reopen while executing)

- Opt-in, default off; asked once in an interactive session; what is sent is shown before asking.
- Sent: random install id, skill name, day, counts, trigger hit/miss counts, achievement ids,
  scrubbed mod errors. Never sent: prompt text, cwd, project names, file paths, IP (PostHog
  project 649943 has "Discard client IP data" on).
- PostHog: host `https://us.i.posthog.com`, project token
  `phc_r4NATbMFBZvmQYiJ8MPMJSWHprgbsTkbCddtc6aYAoUg` (write-only, public by design). No
  personal API key anywhere in the repo.
- A failed send is kept and retried the next day, silently.
- Every hook fails open (`.catch(($, e, next) => next(e))`).
- **Non-interactive sessions record nothing.** `session.start` `isInteractive === false`
  (every `claude -p`, so every teams/graph adapter session) leaves the module idle. This
  resolves "headless records only" vs "teams adapter sessions don't count" from the design:
  teams adapters are `claude -p` and have no marker of their own, so the simple rule is the
  one that keeps both promises.
- Out of this cycle: think debate pane (#3) and session retro card (#4) — backlog.

## File structure

| Path | Owns |
|------|------|
| `_repo/scripts/build-trophy-index.mjs` (new) | reads `*/skills/*/SKILL.md` + `.claude-plugin/marketplace.json`, writes `trophy/data/triggers.json` |
| `_repo/scripts/test-build-trophy-index.mjs` (new) | node:test for the extractor + freshness check |
| `trophy/.claude-plugin/plugin.json` (new) | manifest, `"types": "./types/index.d.ts"` |
| `trophy/hooks/hooks.json` (new) | `{ "modules": ["./mod.tsx"] }` only — trophy has no command hooks |
| `trophy/hooks/mod.tsx` (new) | the module: hooks, UI, send |
| `trophy/hooks/logic.ts` (new) | pure functions: `recordUse`, `evaluate`, `matchTriggers`, `closeTurn`, `buildBatch`, `scrub` |
| `trophy/hooks/*.test.ts` (new) | `claude plugin test` cases |
| `trophy/types/index.d.ts` (new) | `PluginState['trophy']` contract |
| `trophy/data/achievements.json` (new) | the catalog |
| `trophy/data/triggers.json` (generated) | `{ skill, plugin, phrases[] }[]` |
| `trophy/skills/list/SKILL.md` (new) | `trophy:list` |
| `trophy/README.md`, `trophy/KOR.md` (new) | user docs incl. the telemetry disclosure |
| `.claude-plugin/marketplace.json` (modify) | add `trophy` 0.1.0 |
| `plan/mod/00-spike.md` (modify) | Task 6 below |

## Data shapes (used by every task below)

```ts
// $.store keys (survive sessions, global to the user)
'trophy.installId'  : string                       // crypto.randomUUID() on first interactive start
'trophy.consent'    : 'unasked' | 'yes' | 'no'
'trophy.uses'       : Use[]                        // last 5000
'trophy.unlocked'   : Record<string, string>       // achievement id -> ISO date
'trophy.triggers'   : Record<string /*day*/, Record<string /*skill*/, { hit: number; miss: number; unmatched: number }>>
'trophy.errors'     : { day: string; message: string }[]   // scrubbed, last 50
'trophy.sentThrough': string                       // last day (YYYY-MM-DD) sent

type Use = { skill: string; plugin: string; day: string; session: string; ts: number }

// $.state (this session) — declared in trophy/types/index.d.ts
PluginState['trophy'] = { active: boolean; turnMatched: string[]; turnFired: string[]; tab: 'trophies' | 'triggers' }

// achievements.json entry
type Achievement = {
  id: string; title: string; description: string; hidden?: true;
  rule:
    | { kind: 'first_use'; plugin: string }
    | { kind: 'collect'; count: number; plugin?: string }        // distinct skills
    | { kind: 'combo'; sequence: string[] }                      // in order, same session, gaps allowed
    | { kind: 'streak'; days: number }                           // consecutive days with ≥1 use
    | { kind: 'repeat'; skill: string; count: number }           // total uses of one skill
}
```

## The starting catalog (`trophy/data/achievements.json`)

| id | title | rule |
|----|-------|------|
| `first-blood` | 첫 스킬 | collect 1 |
| `first-think` … one per plugin | `<plugin>` 입문 | first_use, for each of the 13 marketplace plugins (13 entries) |
| `collector-10` | 수집가 | collect 10 |
| `collector-30` | 도감 채우는 중 | collect 30 |
| `thinker` | 생각하는 사람 | collect 5, plugin `think` |
| `full-cycle` | 설계부터 검증까지 | combo `think:brainstorming` → `write:plans` → `harness:harness` |
| `red-green` | 빨강 다음 초록 | combo `develop:test-driven-development` → `completion:verification-before-completion` |
| `streak-7` | 일주일 개근 | streak 7 |
| `streak-30` | 한 달 개근 | streak 30 |
| `punching-bag` | 샌드백 (hidden) | repeat `think:devils-advocate` 3 |
| `night-owl` is **not** in v0.1 | — | needs local time-of-day; the module has `ts` but no timezone rule agreed — backlog |

---

### Task 0: Spike additions (prove before Task 3)
**Files:** modify `plan/mod/00-spike.md` (append Task 6), and its findings file.
**Interfaces:** produces the facts Tasks 3, 7 and 9 rely on.
**Blocked by:** none (runs with the rest of 00).
**Pass bar:** `00-spike-findings.md` has a "Task 6" section answering each, with the command
and output:
(a) `skill.prompt` fires for a typed `/think:brainstorming` AND for a model Skill-tool call, and
the exact value of `e.skill` in each (prefixed `think:brainstorming` or bare `brainstorming`);
(b) `session.start` `isInteractive` is `false` under `claude -p`;
(c) `$.fs.write` can create `<HOME>/.claude/trophy/profile.json` (HOME via `$.env.get`);
(d) `$.http.fetch('https://us.i.posthog.com/batch/', { method: 'POST', ... })` returns 200 with
one test event, visible in PostHog Activity;
(e) a module can `import` a sibling `./logic.ts`. If (e) fails, Task 2 inlines `logic.ts` into
`mod.tsx` and tests import from `mod.tsx`.

- [ ] 1: append Task 6 to `00-spike.md` with the five questions → 2: run in the scratch `spike-mod` → 3: record → 4: commit

### Task 1: Trigger index script
**Files:** create `_repo/scripts/build-trophy-index.mjs`, `_repo/scripts/test-build-trophy-index.mjs`.
**Interfaces:** produces `trophy/data/triggers.json` = `[{ skill: "think:brainstorming", plugin: "think", phrases: ["어떻게 만들지?", ...] }]`
— phrases are the double-quoted strings after `Triggers on:` or `Triggers:` in the
frontmatter `description`, lower-cased, trimmed, sorted; skills with no trigger line are listed
with `phrases: []`; `--check` exits 1 when the file on disk differs from what it would write.
**Blocked by:** none.
**Pass bar:** `node --test _repo/scripts/test-build-trophy-index.mjs` green with: a fixture
`SKILL.md` using `Triggers on:` and one using `Triggers:` both extracted; a multi-line folded
(`>-`) description extracted; a skill under a plugin missing from `marketplace.json` skipped;
`--check` exits 0 right after a write and 1 after one phrase is changed. Running it on the repo
lists 110 skills, 90 with phrases.

- [ ] 1: tests (red) → 2: implement (no deps; frontmatter parsed by hand like `validate_plugins.py` does) → 3: green → 4: generate the real file → 5: commit

### Task 2: Plugin skeleton that loads and does nothing
**Files:** create `trophy/.claude-plugin/plugin.json`, `trophy/hooks/hooks.json`,
`trophy/hooks/mod.tsx`, `trophy/hooks/logic.ts`, `trophy/types/index.d.ts`,
`trophy/data/achievements.json` (the catalog above, all 22 entries), `trophy/hooks/skeleton.test.ts`.
**Interfaces:** produces the `PluginState['trophy']` contract and `session.start`:
`if (!e.isInteractive) return next(e)`; else set `active = true`, create `trophy.installId` if
absent, register `/achievements` and `/trophy-telemetry`.
**Blocked by:** Task 0 (e).
**Pass bar:** `claude plugin validate trophy` clean and lists `session.start`; `tsc -p trophy`
clean; test: `isInteractive: false` → no command registered, no store write; `true` → both
commands registered and `installId` is a UUID that a second start keeps unchanged.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 3: Record each skill use
**Files:** modify `mod.tsx`, `logic.ts`; create `trophy/hooks/record.test.ts`.
**Interfaces:** `recordUse(uses, skill, now, session) → Use[]` (appends, caps at 5000, sets
`plugin` = part before `:` or `''`). Hook: `on('skill.prompt', ...)` — when `active`, skill's
plugin is in `triggers.json`'s plugin set, append; push to `turnFired`; always `return next(e)`
unchanged.
**Blocked by:** Task 2; Task 0 (a) for the exact `e.skill` form (if bare, map bare → prefixed
through `triggers.json`; a bare name owned by two plugins is recorded with `plugin: ''`).
**Pass bar:** test: a `skill.prompt` for `think:brainstorming` → one `Use` stored and the
returned `{ text }` deep-equal to `next`'s; a skill from another marketplace → nothing stored;
`active: false` → nothing stored; a throwing store → the prompt text still returned.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 4: Unlocks and toasts
**Files:** modify `mod.tsx`, `logic.ts`; create `trophy/hooks/evaluate.test.ts`.
**Interfaces:** `evaluate(uses, catalog, unlocked, today) → string[]` (ids newly met, never one
already in `unlocked`). Called right after each recorded use; each new id → store date →
`$.ui.toast('🏆 <title> — <description>')` (hidden ones show their real title once unlocked).
**Blocked by:** Task 3.
**Pass bar:** one test per rule kind with a met and an unmet log (10 cases); `full-cycle` met
only when the three skills appear in order within one `session`; `streak-7` met by 7
consecutive `day`s and not by 7 days with a gap; evaluating the same log twice returns `[]` the
second time; three new unlocks in one call → three toasts.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 5: Trigger hit/miss
**Files:** modify `mod.tsx`, `logic.ts`; create `trophy/hooks/triggers.test.ts`.
**Interfaces:** `matchTriggers(text, index) → string[]` (skills whose any phrase is a
case-insensitive substring of `text`; text starting with `/` matches nothing — a typed command
is not a natural-language trigger). `closeTurn(matched, fired) → { hit[], miss[], unmatched[] }`
(hit = in both, miss = matched not fired, unmatched = fired not matched). `prompt.submit`
sets `turnMatched`, clears `turnFired`, returns `next(e)` unchanged; `turn.complete` adds the
`closeTurn` result to today's `trophy.triggers` counts.
**Blocked by:** Task 1, Task 3.
**Pass bar:** test: prompt `"이거 설계해줘 기능 설계해줘"` + `think:brainstorming` fired → its
`hit` +1; same prompt, nothing fired → `miss` +1; no match, `develop:bug-diagnoser` fired →
`unmatched` +1; prompt `/think:grill` → no match recorded; the submitted text reaching `next`
is identical.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 6: `/achievements` pane
**Files:** modify `mod.tsx`; create `trophy/hooks/pane.test.ts`.
**Interfaces:** `command.run` `achievements` → `$.ui.open({ id: 'trophy', title: 'Achievements' })`.
`ui.render` Pane `trophy`: header `n / 22 해금`, Buttons `[업적] [트리거]` switching `tab`.
업적 tab: unlocked rows `🏆 title · YYYY-MM-DD`, locked rows `🔒 title  ▓▓░░░ 2/5`
(progress from the same rule as `evaluate`), hidden locked rows `🔒 ???`. 트리거 tab: last 7
days summed per skill, three lists — most hit, most missed (the routing gaps), never fired.
**Blocked by:** Task 4, Task 5.
**Pass bar:** UI test looped over `['terminal', 'desktop']`: an empty profile draws `0 / 22 해금`
and 22 locked rows with 1 `???`; a profile with `first-blood` draws its date; pressing
`[트리거]` draws the three lists; the pane is never opened by anything but the command.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 7: Profile mirror and `trophy:list`
**Files:** modify `mod.tsx`; create `trophy/skills/list/SKILL.md`, `trophy/hooks/mirror.test.ts`.
**Interfaces:** after every store change, write `<HOME>/.claude/trophy/profile.json` =
`{ updated, unlocked, progress: { id: [have, need] }, triggers7d }` (no `uses`, no session ids).
`trophy:list` (description starts `Use when`, EN+KR scenarios, Process → Output Template →
What Claude Does / What You Do → Related Skills): read that file and
`trophy/data/achievements.json`, print the same three groups as the pane as a table; file
missing → say the mod records only in interactive Claude Code ≥ 2.1.292 and stop.
**Blocked by:** Task 6; Task 0 (c).
**Pass bar:** test: one unlock → file written with that id and no `uses` key;
`python3 _repo/scripts/validate_plugins.py` PASSED with the new skill; a manual run of
`trophy:list` on a fixture file prints the table.

- [ ] 1: tests (red) → 2: implement + SKILL.md → 3: green + validator → 4: commit

### Task 8: Consent
**Files:** modify `mod.tsx`; create `trophy/hooks/consent.test.ts`.
**Interfaces:** `ui.render` AbovePrompt while `consent === 'unasked'` and `active`: one row
`trophy: 익명 사용 통계를 보낼까요? (스킬명·일별 횟수만, 프롬프트·경로 없음)` + Buttons
`[보내기] [안 보내기] [내용 보기]`; `[내용 보기]` opens a pane with the exact JSON of
yesterday's batch (Task 9's `buildBatch`). `/trophy-telemetry on|off|status` sets/reads
`consent`. No other path sets `yes`.
**Blocked by:** Task 2. (`[내용 보기]` needs Task 9's `buildBatch` — implement the button in
Task 9's commit if this lands first.)
**Pass bar:** UI test: `unasked` → the row with three buttons; `[안 보내기]` → `consent: 'no'`
and the band gone; `/trophy-telemetry status` answers the current value.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 9: Daily send
**Files:** modify `mod.tsx`, `logic.ts`; create `trophy/hooks/send.test.ts`.
**Interfaces:** `scrub(message) → string` (replaces `/Users/<x>/`, `/home/<x>/`,
`C:\Users\<x>\` with `~/`, drops anything after 300 chars). `buildBatch(store, through) → { api_key, batch: Event[] }`
for days after `sentThrough` up to yesterday: `skill_used {skill, plugin, day, count}`,
`trigger_result {skill, day, hit, miss, unmatched}`, `achievement_unlocked {id}`,
`$exception {$exception_message}` from `trophy.errors`; every event has
`distinct_id: installId` and `properties.$process_person_profile: false`. In `session.start`
(active, `consent === 'yes'`, `sentThrough` < yesterday): `$.http.fetch` POST to
`https://us.i.posthog.com/batch/`; `ok` → `sentThrough` = yesterday, `errors` cleared;
anything else → nothing changes. Every hook's `.catch` also appends `scrub(e.message)` to
`trophy.errors`.
**Blocked by:** Task 3, Task 5, Task 8; Task 0 (d).
**Pass bar:** test with `$.http.fetch` mocked: `consent: 'no'` or `'unasked'` → fetch called
0 times; `'yes'` → once, and the body matches a stored snapshot; a fixture whose uses carry
cwd-like strings and an error `at /Users/kim/proj/x.ts` → the body contains no `/Users/`, no
prompt text, no `session` value; fetch returning 500 → `sentThrough` unchanged and the next
start sends the same days; a second start the same day → 0 fetches.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 10: Docs and release
**Files:** create `trophy/README.md`, `trophy/KOR.md` (what it does, how to view, **what is
sent, where, how to turn it off**, PostHog IP discard); modify `.claude-plugin/marketplace.json`
(add `trophy` 0.1.0, category `productivity`), `plan/mod/README.md` (row 4).
**Blocked by:** Tasks 1–9.
**Pass bar:** `claude plugin validate trophy` and `claude plugin test trophy` green;
`tsc -p trophy` clean; `node _repo/scripts/build-trophy-index.mjs --check` exits 0;
`python3 _repo/scripts/validate_plugins.py` PASSED; one real interactive session with
`--plugin-dir trophy`: typing `/think:brainstorming` shows the `first-blood` toast,
`/achievements` shows it unlocked, and after opting in with a backdated `sentThrough` the
events appear in PostHog Activity — transcript excerpt + screenshot saved in
`.harness-run/trophy/`. Push and version bump wait for the user's review.

- [ ] 1: docs → 2: all checks → 3: real session → 4: commit (no push)
