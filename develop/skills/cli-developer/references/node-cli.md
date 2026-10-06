# Node.js CLIs

## commander

```js
#!/usr/bin/env node
import { Command, Option } from 'commander';

const program = new Command('deployctl')
  .description('Manage releases')
  .version('0.3.0');

program
  .command('release')
  .argument('<service>', 'service to release')
  .addOption(new Option('-e, --env <name>', 'target').choices(['dev', 'prod']).default('dev'))
  .option('--dry-run', 'print the plan only')
  .action(async (service, opts) => {
    // opts.env, opts.dryRun (camel-cased automatically)
  });

await program.parseAsync();
```

Points worth knowing:
- Use `parseAsync` whenever any action is async, otherwise rejections escape.
- `.requiredOption()` enforces a flag; `.argument('[x]')` is optional, `<x>` required, `<x...>` variadic.
- `program.opts()` reads global options inside subcommands; `.hook('preAction', fn)` is the place for shared setup such as loading config.
- Compose big CLIs by building each subcommand in its own module and calling `.addCommand(sub)`.
- `.exitOverride()` makes commander throw instead of exiting, which is what tests need; `.configureOutput({ writeErr })` redirects its messages.

## yargs

Choose it when you need middleware, coercion pipelines, or `.commandDir()` style auto-loading. Otherwise commander is smaller and starts faster. `oclif` fits when you want generated scaffolding, plugin support and an update story, and accept a heavier install.

## Prompts

`@inquirer/prompts` exposes one function per kind (`input`, `select`, `confirm`, `password`, `checkbox`). Guard every call:

```js
const env = opts.env ?? (process.stdin.isTTY ? await select({ message: 'Env?', choices }) : fail('--env is required without a TTY'));
```

## Output

- Color: `process.stdout.isTTY`, the `NO_COLOR` variable and a `--no-color` flag all gate it. picocolors honours `NO_COLOR` out of the box; with chalk, check `NO_COLOR` yourself before enabling color.
- Spinner (`ora`): `const s = ora('Uploading').start(); ... s.succeed('Uploaded')` or `s.fail(...)`. It writes to stderr and degrades when not a TTY.
- Determinate bars: `cli-progress`; update with a rate-limited tick, not per byte.
- Print results with `console.log`, diagnostics with `console.error`.

## Failure handling

```js
process.on('SIGINT', () => { cleanup(); process.exit(130); });
```

Catch at the entry point once: print `err.message` (stack only under `--debug`), set `process.exitCode` and return, instead of calling `process.exit` mid-flow where it can truncate buffered output.

## Paths and files

Use `node:os` `homedir()` and `node:path` `join`; never concatenate with `/`. Resolve user-supplied paths against `process.cwd()`. For config dirs, honour `XDG_CONFIG_HOME` before falling back to `~/.config`.

## package.json

```json
{
  "name": "deployctl",
  "type": "module",
  "bin": { "deployctl": "./bin/deployctl.js" },
  "engines": { "node": ">=20" },
  "files": ["bin", "dist"]
}
```

Keep the shebang on the bin file; npm creates the shim on Windows. Smoke-test packaging with `npm pack` then installing the tarball.

## Testing

- Unit-test action functions directly; keep parsing a thin layer.
- End-to-end: run the real entry with `execFile('node', ['bin/deployctl.js', ...args])` and assert on stdout, stderr, and exit code separately. `node:test` plus `node:assert` is enough.
