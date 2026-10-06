# Python CLIs

## Choosing

| Need | Use |
|------|-----|
| Type hints drive the interface, quick to write | Typer |
| Fine-grained control, decorators, plugin ecosystem | Click (Typer is built on it) |
| Zero dependencies, tiny scripts | argparse |

## Typer

```python
import typer
from typing import Annotated

app = typer.Typer(no_args_is_help=True)
releases = typer.Typer(help="Release operations")
app.add_typer(releases, name="release")

@releases.command("create")
def create(
    service: Annotated[str, typer.Argument(help="Service name")],
    env: Annotated[str, typer.Option("--env", "-e", envvar="DEPLOYCTL_ENV")] = "dev",
    dry_run: Annotated[bool, typer.Option(help="Plan only")] = False,
):
    if env not in {"dev", "prod"}:
        typer.echo(f"unknown env: {env}", err=True)
        raise typer.Exit(code=2)
    ...

if __name__ == "__main__":
    raise SystemExit(app())
```

- Parameters without defaults become required; `bool` options get `--flag/--no-flag` automatically.
- `typer.Exit(code=n)` ends cleanly with a status; `typer.Abort()` is for "user said no".
- Use `Enum` or `Literal`-style choices instead of hand validation where you can.

## Click

```python
import click

@click.group()
@click.option("--verbose", "-v", count=True)
@click.pass_context
def cli(ctx, verbose):
    ctx.obj = {"verbose": verbose}

@cli.command()
@click.argument("service")
@click.option("--env", type=click.Choice(["dev", "prod"]), default="dev", show_default=True)
@click.pass_obj
def release(obj, service, env):
    click.echo(f"releasing {service} to {env}")
```

`click.echo(..., err=True)` for stderr; `click.confirm(..., abort=True)` for yes/no; `click.ClickException("msg")` produces a clean error with exit code 1.

## argparse

```python
p = argparse.ArgumentParser(prog="deployctl")
sub = p.add_subparsers(dest="cmd", required=True)
rel = sub.add_parser("release")
rel.add_argument("service")
rel.add_argument("--env", choices=["dev", "prod"], default="dev")
args = p.parse_args()
```

It exits with status 2 on usage errors by itself. Dispatch with `rel.set_defaults(func=run_release)` and then `args.func(args)`.

## Rich output

`rich.console.Console()` for styled text, `rich.table.Table` for tabular data, `rich.progress.track(iterable)` for a quick bar, `console.status("working")` for a spinner. Create a second `Console(stderr=True)` for diagnostics. Rich turns styling off by itself when stdout is piped or redirected. `tqdm` is the lightweight alternative when only a bar is wanted.

## Interrupts and errors

```python
def main():
    try:
        app()
    except KeyboardInterrupt:  # Ctrl+C
        raise SystemExit(130)
```

Let domain errors derive from one base class and translate them to a message plus exit code at the top level; show the traceback only with `--debug`.

## Configuration

`pathlib.Path.home() / ".config" / "deployctl"`, or `platformdirs.user_config_dir` for correct per-OS locations. Parse TOML with the standard `tomllib` (3.11+). Merge in the precedence order from `design-patterns.md`.

## Packaging

```toml
[project]
name = "deployctl"
version = "0.3.0"
requires-python = ">=3.11"
dependencies = ["typer>=0.9"]

[project.scripts]
deployctl = "deployctl.cli:app"
```

Install for development with `pip install -e .`; ship end users `pipx install` or a zipapp.

## Testing

```python
import typer.testing as tt
r = tt.CliRunner().invoke(app, ["release", "create", "api", "--env", "prod"])
assert r.exit_code == 0 and "api" in r.output
```

Click has the same `click.testing.CliRunner`. Test exit codes for each error path, not just the happy one.
