---
name: cli-developer
description: >-
  Use when building a command-line tool — subcommands, flags, prompts, progress bars, shell completions, cross-platform
  distribution. Triggers on: "CLI 도구 만들어줘", "서브커맨드 설계", "build a CLI". Not for web UIs or REST APIs.
scenarios:
  - "Build a CLI tool that manages deployment configurations across environments"
  - "I need to create a command-line interface for our internal developer tools"
  - "Help me design a CLI with subcommands, flags, and interactive prompts"
  - "CLI 도구를 만들어줘 — 배포 설정을 관리하는 커맨드라인 앱"
  - "개발자용 내부 CLI 툴 설계를 도와줘"
compatibility:
  recommended: []
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 커맨드 계층 구조와 UX 설계를 더 체계적으로 검토할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
license: MIT
metadata:
  domain: devops
  version: "1.1.0"
  scope: implementation
  role: specialist
  related-skills: sre-engineer, documentation-strategy
  output-format: code
  triggers: CLI, command-line tool, terminal app, subcommands, flags, shell completion, interactive prompt, progress bar, oclif, argparse, bubbletea
---

## Standing Mandates

- NEVER write code before the expected `--help` of every command is written down. The command surface is the public
  API: scripts and muscle memory depend on it, so it is cheaper to argue about on paper than after release.
- NEVER change a shipped command's name, flag or exit code in place; a rename is a breaking change. Add the new form,
  keep the old as an alias, and say so.
- NEVER call the tool done from reading the code. Run `<cli> --help`, `<cli> --version`, one failing input, and one
  piped run (`<cli> ... | cat`, stdin not a TTY), and quote the output and exit codes; a run you could not do is
  `not run: <what>`. Prompts that block in CI and colour codes in a pipe show only in those runs.
- NEVER write diagnostics or progress to stdout; stdout is data that may be piped, so logs and errors go to stderr.
- NEVER hardcode a platform path (`~`, `/tmp`, `C:\`); use `os.homedir()` / `Path.home()` / the platform's config dir.
- Missing facts (target OSes, shells, who runs it, startup budget, config sources) are `[확인 필요: ○○]`; do not pick
  them silently. Startup time is measured and reported against the user's budget; a fixed number such as 50 ms is
  realistic for a Go binary and not for a Node or Python one.
- Goal: every command has help text, an exit-code contract and a non-interactive path, and the closing tally recounts
  to the command list.

# CLI Developer

**Not for** web UIs or REST APIs, SRE pipeline integration alone (`develop:sre-engineer`), or the written docs around
the tool (`develop:documentation-strategy`).

## Process

1. **Analyze UX** — who runs it, for what; sketch the command hierarchy; write each command's expected `--help`.
2. **Design commands** — subcommands, flags, arguments, config sources and precedence (flag > env > file > default);
   one flag-naming convention; no shipped signature changes.
3. **Select framework** — Node.js `commander` → `yargs` → `oclif`; Python `typer` → `click` → `argparse`; Go
   `cobra + viper`, `bubbletea` for a TUI only.
4. **Implement** — validate input before any work; every question has a flag or env fallback; exit cleanly on SIGINT.
5. **Polish** — completions for the shells in scope, clear errors, progress feedback; colour only when stdout is a TTY.
6. **Test** — run the commands from the Mandates on each target OS and measure cold start.
7. **Recount** — count commands, those with help text, a documented exit code, and a non-interactive path; fix the
   tally if it differs.

## Output Template

```
## <tool>

1. Entry point and subcommand layout
2. Config: files, environment, flags, precedence
3. Code, including error paths and exit codes
4. Completion scripts for <shells>
5. UX rationale, one line per choice

Open: [확인 필요: ○○] ...

Commands <n> · help text <h> · exit codes <e> · non-interactive <i> · completions <shells>
Run: --help ok · --version ok · piped ok · cold start <ms> (budget <ms>) | not run: <what>
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Designs hierarchy and flag naming | Confirm it matches your users' workflows |
| Generates framework boilerplate and completions | Implement the domain logic |
| Handles TTY detection, SIGINT, paths | Test on your target OSes and shells |

## Reference Guide

| Area | File | Read it when |
|------|------|--------------|
| Command surface | `references/design-patterns.md` | Naming, flags, config precedence, exit codes |
| Node.js | `references/node-cli.md` | commander, yargs, prompts, npm publishing |
| Python | `references/python-cli.md` | typer, click, argparse, rich |
| Go | `references/go-cli.md` | viper, cobra, signals, tests, releases |
| Go TUI | `references/go-tui.md` | bubbletea models, bubbles components |
| UX | `references/ux-patterns.md` | Feedback, colour, help text, errors |

## Related Skills

- `develop:sre-engineer` — wiring the tool into SRE pipelines
- `develop:documentation-strategy` — documenting commands and flags
