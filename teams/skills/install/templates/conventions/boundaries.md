# boundaries — what must not be touched casually

Plan/SetGoal treat these as hard constraints; violations fail the QualityGate.

## Do not modify without explicit user approval
- <!-- fill: e.g. "db/migrations/** (append-only)", "public API contracts under api/" -->

## Off-limits entirely
- <!-- fill: e.g. "vendored code under third_party/", "generated files (*.gen.*)" -->

## Requires a dependent update when changed
- <!-- fill: e.g. "changing config schema requires updating docs/config.md" -->
