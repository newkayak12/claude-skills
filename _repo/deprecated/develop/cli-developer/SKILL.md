---
name: cli-developer
description: >-
  Use when someone needs to build a command-line tool — defining subcommands,
  flags, and argument parsing; adding interactive prompts, progress bars, or
  shell completions; or distributing a cross-platform terminal application.
  Triggers on:.
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
  related-skills: sre-engineer, code-documenter
  output-format: code
  triggers: CLI, command-line tool, terminal app, subcommands, flags, shell completion, interactive prompt, progress bar, oclif, argparse, bubbletea
---

# CLI Developer

## When to Use / When Not to Use

**Use when:**
- Building a new CLI tool with subcommands, flags, config handling
- Adding shell completions, progress bars, or interactive prompts
- Distributing a cross-platform terminal binary

**Do not use when:**
- Building a web UI or REST API
- The task is SRE pipeline integration only (use `sre-engineer`)

## Process

1. **Analyze UX** — Work out who runs this and for what, sketch the command hierarchy, and write the expected `--help` output of every command before any code.
2. **Design commands** — Lay out subcommands, flags, arguments and configuration sources. Check that flag names follow one convention and that no shipped command signature changes.
3. **Select framework** — Node.js: `commander` → `yargs` → `oclif`; Python: `typer` → `click` → `argparse`; Go: `cobra + viper` → `bubbletea` (TUI only)
4. **Implement** — Write the tool on the chosen framework and verify that `<cli> --help` and `<cli> --version` both behave.
5. **Polish** — Add completions, clear error messages and progress feedback; confirm color is gated on a TTY and that SIGINT shuts down cleanly.
6. **Test** — Smoke-test on each target OS and measure cold-start time (goal: under 50ms).

## Output Template

For each CLI feature, provide:
1. Entry point and subcommand layout
2. How configuration is read: files, environment, flags
3. The working code, including error paths
4. Completion scripts for the shells in scope
5. A short rationale for UX choices

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Designs command hierarchy and flag naming | Confirm the UX matches your user workflows |
| Generates framework boilerplate (commander/typer/cobra) | Implement domain-specific business logic |
| Writes TTY detection and SIGINT handling | Test on all target platforms |
| Generates shell completion scripts | Verify completions in your actual shell |
| Recommends cross-platform path handling | Run final distribution and packaging |

## Reference Guide

| Area | File | Read it when |
|------|------|--------------|
| Command surface | `references/design-patterns.md` | Naming, flags, config precedence, exit codes |
| Node.js | `references/node-cli.md` | yargs, commander, inquirer-style prompts, npm publishing |
| Python | `references/python-cli.md` | typer, click, argparse, rich |
| Go | `references/go-cli.md` | viper, cobra, signals, tests, releases |
| Go TUI | `references/go-tui.md` | bubbletea models, bubbles components |
| UX | `references/ux-patterns.md` | Feedback, colour, help text, errors |

## Minimal Example (Node.js, commander)

```js
const { Command } = require('commander');

const cli = new Command('mytool').description('Demo tool').version('1.0.0');

cli
  .command('echo <text>')
  .description('Print text back')
  .option('-u, --upper', 'convert to upper case')
  .action((text, { upper }) => {
    console.log(upper ? text.toUpperCase() : text);
  });

cli.parse();
```

For Python and Go, see the matching files under `references/`.

## Constraints

**MUST DO:**
- Start in under 50ms
- Provide `--help` and `--version`
- Name flags by one consistent convention
- Exit cleanly on SIGINT (Ctrl+C)
- Validate input before doing any work
- Detect TTY before applying color output
- Work both interactively and unattended

**MUST NOT DO:**
- Send logs or diagnostics to stderr, never to stdout that may be piped
- Alter an existing command's signature; a rename counts as a breaking change
- Block on a prompt in CI/CD; every question needs a flag or env fallback
- Hardcode platform-specific paths (use `os.homedir()` / `Path.home()`)
- Ship without shell completions

## Related Skills

- `sre-engineer` — for integrating CLI tools into SRE pipelines
- `code-documenter` — for documenting CLI commands and flags
