# CLI UX Rules

## Feedback timing

| Expected wait | Show |
|---------------|------|
| under ~1 s | nothing |
| a few seconds, unknown length | spinner with a verb phrase ("Fetching manifests") |
| known total, longer | progress bar with count, percent, and ETA if reliable |
| minutes, multiple stages | one line per stage as it finishes |

Do not animate when output is not a terminal; print periodic plain lines instead. Always end with a result line saying what happened and what it touched.

## Colour

- Meaning first: red for errors, yellow for warnings, green for success, dim for secondary detail. Never carry meaning by colour alone; keep a word or symbol ("error:", "ok").
- Disable colour when stdout/stderr is not a TTY, when `NO_COLOR` is set (any non-empty value), when `TERM=dumb`, or with `--no-color`. Many tools also honour `FORCE_COLOR` to override.
- Stick to the 16 standard ANSI colours unless there is a reason; they adapt to the user's theme.
- Avoid red/green as the only distinction.

## Help text

Lead with a one-line purpose, then usage, commands, flags, and two or three realistic examples. Examples are what people read first.

```
Release a service to an environment.

Usage:
  deployctl release <service> [flags]

Flags:
  -e, --env string   target environment (default "dev")

Examples:
  deployctl release api --env prod
```

Group flags when there are many. Show defaults. Point to docs only after the examples. `-h` on any subcommand must work, and a typo should suggest the closest command.

## Error messages

Say what failed, why, and what to try, in that order, in plain words, on stderr.

```
error: cannot read config ./deployctl.toml: permission denied
hint: run `chmod u+r deployctl.toml` or pass --config <path>
```

- No stack traces by default; keep them behind `--debug`.
- Name the offending value and the accepted ones.
- One error, one message; do not echo the same failure at each layer.
- Usage mistakes show a one-line usage hint, not the whole manual.

## Prompts

Ask only what cannot be defaulted. Offer a default in brackets, accept Enter for it, validate right away and re-ask, mask secrets. Prefer single-select lists to free text when options are finite. Every prompt must have a flag equivalent; skip prompts completely when stdin is not a TTY.

## Machine and human output

Tables for people: aligned columns, header row, truncate long cells with an ellipsis only on a TTY. For scripts: `--output json`, one object per line for streams (JSON Lines), or `--quiet` printing bare identifiers. Do not mix informational chatter into those modes.

## Verbosity

Default is quiet-ish: results and warnings. `-v` adds steps; `-vv` or `--debug` adds request details and timings. `-q` suppresses everything but errors. Redact tokens in all levels.

## Interrupts and long operations

On Ctrl+C: stop work, restore the cursor and terminal state, clean temporary files, exit 130. A second Ctrl+C may force-quit. Make long operations resumable or idempotent so re-running is safe.

## Docs

Ship `--help` as the source of truth; generate man pages and shell completions from the same command definitions so they cannot drift.
