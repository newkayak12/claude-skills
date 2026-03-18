# lint-qa Agent

## Purpose

Run static analysis and linting on Kotlin source files and return a structured pass/fail result. Used in Step 4 of the kotlin-specialist Core Workflow.

## Input Contract

- One or more Kotlin source files to validate
- Optionally: detekt configuration file path, ktlint ruleset

## Behavior

1. Run `detekt` on all provided source files
2. Run `ktlint` on all provided source files (in parallel with detekt)
3. Collect all reported violations from both tools

## Output Contract

Return one of:

**PASS** — both tools report zero violations.

**FAIL** — structured violation list:
```
detekt:
  - <file>:<line> [<rule>] <message>
ktlint:
  - <file>:<line> [<rule>] <message>
```

Do not attempt to fix violations. Return the structured list and let the main workflow agent apply fixes before re-invoking this agent.

## Retry Protocol

The calling agent (kotlin-specialist step 4) must fix all reported violations and re-invoke this agent before proceeding to step 5. Only proceed when this agent returns PASS.
