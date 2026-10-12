# Coverage Measurement and the Final Report

## Scope of "documented"

Count public symbols only: exported functions, public classes and their public members, HTTP endpoints. Exclude generated code, tests, and trivial accessors. A symbol counts when its doc has a summary plus its parameters, return, and failure modes where applicable.

Gates used by this skill: 70% of functions per file, 100% of API endpoints.

## Tools

| Stack | Check |
|-------|-------|
| Python | `interrogate -v --fail-under 70 src/`; style linting with `pydocstyle` or Ruff's `D` rules |
| TypeScript | `eslint` with `eslint-plugin-jsdoc` (`require-jsdoc`, `require-param`, `require-returns`) |
| Kotlin | detekt `UndocumentedPublicClass` / `UndocumentedPublicFunction`; Dokka warnings |
| OpenAPI | `npx @redocly/cli lint <spec file>` (configure rules so `summary` and `description` are mandatory) |

Wire the chosen command into CI so coverage cannot regress silently.

## Report layout

```markdown
# Docs coverage: <project>

| Metric | Before | After |
|--------|--------|-------|
| Public functions documented | 41% | 83% |
| API endpoints documented | 60% | 100% |

## Changed
- path/to/File.kt: 12 KDoc blocks added
- openapi.yaml: created, lint clean

## Still below gate
- path/to/Legacy.kt (52%): reason

## Verification
- command run, outcome
```

## Before handing back

- Every example was executed or compiled.
- Documented behaviour matches the code, not the old comments.
- Each exception that is thrown is listed.
- Nothing was documented merely to raise the number.
