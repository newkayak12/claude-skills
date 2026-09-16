# lintcfg

A tiny config-file linter: `lintcfg check <file>` validates a `key=value` config against a
fixed schema and reports one of a small set of exit codes.

## Packages

- `packages/codes` — the canonical exit-code table (`EXIT_CODES`). The one place these numbers
  are defined; `packages/parser` names failures by these keys, `packages/cli` maps them back to
  the numbers here.
- `packages/parser` — `parseConfig(text)`, pure parsing and validation.
- `packages/cli` — `bin/lintcfg.mjs`, the command-line entry point.

## Config format

```
name=my-service
port=8080
timeout=30
```

Three required keys: `name` (non-empty string), `port` (integer 1-65535), `timeout` (integer
>= 0). Blank lines and lines starting with `#` are ignored. Any other key is rejected.

## Usage

```
node packages/cli/bin/lintcfg.mjs check my-service.cfg
OK name=my-service port=8080 timeout=30
```

## Exit codes

Every exit code `lintcfg` can return, taken from `packages/codes`:

| Code            | Number | When                                            |
|-----------------|--------|--------------------------------------------------|
| `OK`            | 0      | the config is valid                               |
| `PARSE_ERROR`   | 2      | a line has no `=`, or the file cannot be read     |
| `MISSING_FIELD` | 3      | `name`, `port` or `timeout` is absent              |
| `BAD_TYPE`      | 4      | `port` or `timeout` is not a valid integer         |
| `UNKNOWN_FIELD` | 5      | a key other than `name`, `port`, `timeout` appears |

## Running the CLI from outside this tree

`lintcfg` works the same way no matter how it is invoked — with the path as given, with its
`realpath`, or through a symlink (e.g. an npm `bin` link). It does not gate execution on
comparing `import.meta.url` to `process.argv[1]`, which breaks on macOS whenever the invoking
path resolves through the `/var` → `/private/var` symlink.

```
node /absolute/path/to/packages/cli/bin/lintcfg.mjs check my-service.cfg
node "$(realpath /absolute/path/to/packages/cli/bin/lintcfg.mjs)" check my-service.cfg
```

Both of the above print the same line and exit with the same code.
