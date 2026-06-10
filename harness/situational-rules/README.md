# Situational Rules

Unlike the always-on rules in `06-rules.md`, the rules in this folder are referenced **only when the relevant situation arises**. There is no need to keep all of them open throughout a cycle — when a trigger occurs, open only the relevant area.

## Triggers per file

| File | Trigger — *reference when* |
|---|---|
| [`security.md`](./security.md) | Working with authentication, authorization, PII, tokens, encryption, external communication, or secrets |
| [`data.md`](./data.md) | DB schema design, migration, backup, retention-period decisions, or adding a sensitive column |
| [`operations.md`](./operations.md) | Just before release / while operating / when setting Performance budget, Observability, or agreeing on SLO/SLA |
| [`cognitive.md`](./cognitive.md) | Decision paralysis / strong pull toward one option / just before a big bet or irreversible decision |
| [`self-discipline.md`](./self-discipline.md) | Cycle is stretching / WIP exceeds 1 / release keeps being postponed / writing code instead of validating |

## Core principles go in `06-rules.md`

If applying a rule from this folder influences an ADR or Design Doc, that decision is formally recorded under the `R-DD01` (write ADR) rule in `06-rules.md`. Situational rules *complement the always-on rules without conflicting with them*.

## Progressive Adoption

Do not adopt all 5 areas at once. As you run cycles, adopt 1–2 areas that you encounter most often first. When adopting, record:

- Which area was adopted
- Why now (what event was the trigger)
- Whether to maintain it in the next cycle
