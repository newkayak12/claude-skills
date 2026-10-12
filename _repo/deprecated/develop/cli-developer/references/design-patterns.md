# Designing the Command Surface

## Grammar

Pick one shape and hold it everywhere: `tool <noun> <verb> [args] [flags]` (`deployctl release list`) or `tool <verb> <noun>`. Mixing the two is the most common reason users cannot guess a command.

- Two levels is usually enough. A third level means the tool is really two tools.
- Verbs stay uniform across nouns: if one noun has `list`, `show`, `create`, `delete`, the others use the same words, not `ls`/`get`/`add`/`rm` in turn.
- A bare invocation of a group prints that group's help; it does not run something.
- Aliases are fine for ergonomics, but the canonical name is what docs and scripts use.

## Arguments vs flags

- Positional arguments: the thing acted upon, at most two or three, order obvious.
- Flags: everything that modifies behaviour. Anything optional is a flag.
- Long form always (`--output`), short form only for the handful used constantly (`-o`, `-v`, `-q`, `-f`).
- Booleans are presence-only; offer a `--no-<name>` counterpart when the default is on.
- Repeatable flags (`--label a --label b`) beat comma-joined values that need escaping.
- Reserve `-h/--help` and `--version`; never reuse them.
- Destructive operations: ask for confirmation when a TTY is present, and provide `--yes` (or `--force`) to bypass in scripts. Add `--dry-run` wherever the effect is hard to undo.

## Configuration precedence

Resolve each setting from the most specific source down to a default:

1. Flag on the command line
2. Environment variable (`DEPLOYCTL_REGION`)
3. Project file in the working directory
4. User file under the XDG config dir (`~/.config/<tool>/`) or the platform equivalent
5. Built-in default

Rules that save debugging time: print the resolved source with a `config show` style command; never put secrets in flags (they land in shell history and `ps`); accept secrets from env or a file path; validate the merged result once, before any work starts.

## Streams and exit status

- stdout carries the result, and only the result. Progress, warnings, logs: stderr. A pipeline must still work.
- Offer `--output json` (or `-o json`) for anything a script might consume, with stable key names. Human tables may change; JSON shape is a contract.
- Exit status: `0` success; `1` general failure; `2` bad usage (what most parsers already emit); `130` after Ctrl+C (128 + SIGINT's 2). Add tool-specific codes only if callers will branch on them, and document them.
- A failing check that is "expected" (grep-style "no match") deserves its own code distinct from crashes.

## Interactive and non-interactive

Decide interactivity from `isatty` on stdin/stdout, not from guesswork. Every prompt needs a flag or env var that supplies its answer, and when no TTY exists and a required answer is missing, fail with a message naming that flag. Never hang waiting on input in CI.

## Extensibility

The simplest plugin model is the executable-on-PATH convention: `tool foo` runs `tool-foo` if no built-in `foo` exists. It needs no in-process API, works across languages, and is easy to version. Only build in-process plugins when plugins must share state with the host.

## Compatibility

Command names, flag names, output keys, and exit codes are public API. Rename = breaking change: keep the old spelling working for at least one release, print a deprecation notice on stderr, and remove it only in a major version.

## Startup cost

Users feel anything past roughly 100 ms. Keep top-level imports light, defer heavy modules to the command that needs them, and never touch the network during parsing, `--help`, or completion.

## Updates

Do not phone home on every run. If a version check exists, make it opt-out, cached, non-blocking, silent when offline, and disabled when output is not a TTY.
