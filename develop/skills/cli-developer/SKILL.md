---
name: cli-developer
description: >-
  Use when someone needs to build a command-line tool — defining subcommands, flags,
  and argument parsing; adding interactive prompts, progress bars, or shell completions;
  or distributing a cross-platform terminal application.
  Triggers on: "build a CLI", "command-line tool", "terminal app", "argument parsing",
  "shell completion", "interactive prompt", "commander", "click", "typer", "cobra",
  "CLI 개발", "커맨드라인 툴 만들기".
  Best for: Node.js (commander), Python (typer/click), Go (cobra) CLIs.
  Not for: web UI, REST API servers, or SRE pipeline tooling (use sre-engineer for the latter).
compatibility:
  recommended: []
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 커맨드 계층 구조와 UX 설계를 더 체계적으로 검토할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: devops
  triggers: CLI, command-line, terminal app, argument parsing, shell completion, interactive prompt, progress bar, commander, click, typer, cobra
  role: specialist
  scope: implementation
  output-format: code
  related-skills: devops-engineer
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

1. **Analyze UX** — Identify user workflows, command hierarchy, and common tasks. List all commands with expected `--help` output before writing code.
2. **Design commands** — Plan subcommands, flags, arguments, configuration. Confirm flag naming is consistent and no existing signatures are broken.
3. **Select framework** — Node.js: `commander` → `yargs` → `oclif`; Python: `typer` → `click` → `argparse`; Go: `cobra + viper` → `bubbletea` (TUI only)
4. **Implement** — Build with the chosen framework. After wiring commands, run `<cli> --help` to verify help text and `<cli> --version` for version output.
5. **Polish** — Add completions, error messages, progress indicators. Verify TTY detection for color output and graceful SIGINT handling.
6. **Test** — Cross-platform smoke tests; benchmark startup time (target: <50ms).

## Output Template

For each CLI feature, provide:
1. Command structure (main entry point, subcommands)
2. Configuration handling (files, env vars, flags)
3. Core implementation with error handling
4. Shell completion scripts (if applicable)
5. Brief note on UX decisions

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Designs command hierarchy and flag naming | Confirm the UX matches your user workflows |
| Generates framework boilerplate (commander/typer/cobra) | Implement domain-specific business logic |
| Writes TTY detection and SIGINT handling | Test on all target platforms |
| Generates shell completion scripts | Verify completions in your actual shell |
| Recommends cross-platform path handling | Run final distribution and packaging |

## Reference Guide

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Design Patterns | `references/design-patterns.md` | Subcommands, flags, config, architecture |
| Node.js CLIs | `references/node-cli.md` | commander, yargs, inquirer, chalk |
| Python CLIs | `references/python-cli.md` | click, typer, argparse, rich |
| Go CLIs | `references/go-cli.md` | cobra, viper, error handling, testing, build/distribution |
| Go TUI | `references/go-tui.md` | bubbletea, progress bars, spinners |
| UX Patterns | `references/ux-patterns.md` | Progress bars, colors, help text |

## Quick-Start Example (Node.js / commander)

```js
#!/usr/bin/env node
const { program } = require('commander');

program
  .name('mytool')
  .description('Example CLI')
  .version('1.0.0');

program
  .command('greet <name>')
  .description('Greet a user')
  .option('-l, --loud', 'uppercase the greeting')
  .action((name, opts) => {
    const msg = `Hello, ${name}!`;
    console.log(opts.loud ? msg.toUpperCase() : msg);
  });

program.parse();
```

For Python (click/typer) and Go (cobra) examples, see `references/python-cli.md` and `references/go-cli.md`.

## Constraints

**MUST DO:**
- Keep startup time under 50ms
- Support `--help` and `--version` flags
- Use consistent flag naming conventions
- Handle SIGINT (Ctrl+C) gracefully
- Validate user input early
- Detect TTY before applying color output
- Support both interactive and non-interactive modes

**MUST NOT DO:**
- Print logs/diagnostics to stdout when output will be piped (use stderr)
- Break existing command signatures — treat renames as breaking changes
- Require interactive input in CI/CD without non-interactive flag fallbacks
- Hardcode platform-specific paths (use `os.homedir()` / `Path.home()`)
- Ship without shell completions

## Related Skills

- `mcp-builder` — if the CLI wraps an MCP tool
- `sre-engineer` — for integrating CLI tools into SRE pipelines
- `code-documenter` — for documenting CLI commands and flags
