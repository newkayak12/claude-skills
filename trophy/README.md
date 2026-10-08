# trophy

**English** · [한국어](KOR.md)

Steam-style achievements for using this marketplace's skills. Use a skill and a toast and a gold card
above the prompt (8 s) tell you what you unlocked; `/achievements` shows what you have, what is locked and how far along you are, and which
of your prompts contained a skill's trigger phrase without the skill running. It also keeps a local
record of this marketplace's skills and MCP tools failing (the **Failures** tab). Anonymous daily counts and
fixed error codes go to the maintainer only if you say yes. Off by default.

It is a Claude Code hooks module (`hooks/mod.tsx`). It needs Claude Code 2.1.292 or later and an
interactive session; removing the `modules` line from `hooks/hooks.json` leaves nothing behind.

## Install & Uninstall

```bash
/plugin install trophy@newkayak12-claude-skills
/plugin uninstall trophy@newkayak12-claude-skills
```

The UI is in English by default and switches to Korean when Claude Code's `language` setting is Korean; the consent question lists the same data in both languages. This file and [KOR.md](KOR.md) move together.

## Use

| I want to… | Do |
|---|---|
| See my achievements and progress | `/achievements` (a pane: **Achievements**, **Triggers** and **Failures** tabs) |
| See what failed | the **Failures** tab, or **View** on the `✘ N trophy <last failure>` row above the prompt |
| Report a problem with the last skill | `/trophy-bug <note>` (the note stays local; only the code `user_report` can be sent) |
| See them in the conversation | the `trophy:list` skill (reads `~/.claude/trophy/profile.json`) |
| Turn anonymous counts on / off / check | `/trophy-telemetry on`, `off`, `status` |

A skill use is recorded when it runs: typed as `/name`, called by the model through the Skill tool, or
preloaded. The 80 achievements are in `data/achievements.ts`: first use of each plugin, collecting
1–100 distinct skills (overall and per plugin), streaks from 3 to 365 days, repeat counts of
favourite skills, 15 skill combos in one session, and 5 hidden ones.

A failure is recorded when one of this marketplace's skills fails to load or reports no success, one of
its MCP tools fails, or a harness run writes a failed subgoal or goal gate (harness outcomes stay local).
Each record keeps the failing plugin's version and the Claude Code release. The raw error text stays on
your machine; the **Copy** button copies it as a bug body.

Sessions that are not interactive (`claude -p`, so every teams/graph adapter session) record nothing.

## Telemetry — what is sent, where, and how to stop it

**Nothing is sent unless you opt in.** The first interactive session shows one line above the prompt
asking; `[Show contents]` shows the exact JSON of the next send before you decide. Until you answer, nothing
leaves your machine. Declining is remembered; it is never asked again. The answer is saved with the
version of the question (v2 names error codes): a yes given to the older question (v1) is asked once more,
and trophy sends nothing until you answer. A no is never re-asked.

Once a day (at the start of the first interactive session after midnight UTC) the plugin sends the
previous days' events to PostHog (`https://us.i.posthog.com/batch/`, the maintainer's project). Per day:

| Event | Properties |
|---|---|
| `skill_used` | skill name, plugin name, day, count |
| `trigger_result` | skill name, day, counts of: prompt had its trigger phrase and the skill ran / did not run / ran without a phrase |
| `achievement_unlocked` | achievement id |
| `plugins_installed` | plugin name, day — one per plugin of this marketplace whose skills the session lists |
| `diag_*` | skill, plugin, MCP tool name, error code (`reason`), `count`, `day`, the plugin's version (`plugin_version`) and the Claude Code release (`cc_version`) — fixed codes; no messages, paths or prompts. |
| `$exception` | the message of a failure inside this module, with every file path replaced by `<path>`, 300 characters at most |

Every event also carries a random install id (made on first run, not derived from you or your
machine) and `$process_person_profile: false`. **Never sent:** prompt text, working directory,
project or file names, file paths, session ids, your username or email. The PostHog project discards
client IP addresses ("Discard client IP data" is on); the project token in the code is write-only.

A failed send is kept and tried again the next day.

**Turn it off:** `/trophy-telemetry off` (stored in the Claude Code store; takes effect at once), or
uninstall the plugin. `/trophy-telemetry status` shows the current answer. Locally, everything the
mod keeps is in Claude Code's plugin store and `~/.claude/trophy/profile.json` (achievements and
counts, no prompts).

## Skills

### `trophy:list`

Prints the same lists as the pane as a table, from `~/.claude/trophy/profile.json`: unlocked
achievements with dates, locked ones with progress bars (hidden ones as `???`), and the 7-day trigger
view (most hit, most missed, never fired).

## Limits

- Organizations whose policy skips user-level `skill.prompt` hooks still record: the plugin also
  listens to the Skill tool call and to the typed-command expansion; one use is counted once.
- Achievements are counted from the day you install; there is no backfill.

## Status log

- 0.4.0 — the diag plugin is folded in and removed: trophy records failures itself (**실패** tab, `✘` row,
  `/trophy-bug`) and, on the same yes, sends `diag_*` codes with the plugin and Claude Code versions.
  Every other plugin of this marketplace now lists trophy in `dependencies`, so installing one installs trophy.

- 0.3.0 — gold unlock card in the band for 8 s; ▰▱ progress bars on locked achievements; Ink-style panes and consent band.
- 0.2.1 — the consent band no longer hides the bands beneath it.
- 0.2.0 — consent text v2 names error codes; the answer is stored with its version, a v1 yes is
  asked once more and nothing is sent until answered. `diag_*` rows listed in the telemetry table.
- 0.1.1 — typed `/skill` commands are recorded: under a team organization `skill.prompt` and
  `UserPromptExpansion` are skipped for user-tier hooks, so the typed command is now read from
  `prompt.submit` (raw or expanded form).
- 0.1.0 — first release.
