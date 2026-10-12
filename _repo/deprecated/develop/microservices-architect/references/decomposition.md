# Finding the Seams

## Cut along language, not along tables
A boundary is real when the same word stops meaning the same thing. "Product" in Catalog is a description with images; in Inventory it is a SKU with a count; in Billing it is a price line. Three meanings, three candidate contexts. Start from event storming output or from interviews, and list the terms that diverge.

Signals a cut is good:
- One team can explain the whole context without consulting another.
- Most changes (>80% of a typical sprint) touch a single context.
- The context can be unavailable for a minute without halting the others' core flows.
- Its data has one writer.

Signals it is bad:
- Two contexts must deploy together to ship a feature.
- A "service" is a thin CRUD wrapper over one table.
- Every read needs three synchronous lookups to assemble.

## Sizing
Size by cognitive load and change cadence, not by lines of code. A useful ceiling: a new engineer on the owning team can hold the model in their head within a couple of weeks. Too small shows up as chatty calls and distributed transactions for trivial operations.

## Team shape
Structure follows communication. Decide the owning team first; a service with no owning team, or with two, is a defect. Inverse approach: when the desired architecture is known, reorganise teams to match it before splitting code.

## Relationship types between contexts
| Relationship | Use when |
|---|---|
| Customer/supplier | Downstream can negotiate the upstream contract |
| Conformist | Upstream is external or powerful; accept its model |
| Anti-corruption layer | Upstream model would pollute yours; translate at the edge |
| Published language | Many consumers; version a shared schema |
| Shared kernel | Avoid; only for a tiny, jointly owned library |

## Pre-split checks
1. Draw the dependency graph of modules inside the monolith; cycles must be broken first.
2. Identify which tables each module writes; any table with two writers needs an owner decision.
3. Find joins that cross the proposed boundary; each becomes an API call, a replicated read model, or a reason to move the line.
4. Check transaction scope: operations that must be atomic across the line signal a wrong line (or a saga).

## Migrating from a monolith
Strangler approach: put a routing facade in front, move one capability at a time behind it, retire the old path once traffic is zero.
1. Choose a capability with low coupling and real business value as the pilot.
2. Introduce the seam in-process first (interface plus separate module with its own schema).
3. Extract, run both paths with shadow traffic or a percentage rollout, compare results.
4. Move the data last; use dual writes or change data capture during the overlap, never both without reconciliation.

## Failure patterns
- Distributed monolith: lockstep releases, shared database, synchronous call chains.
- Entity services: one service per noun, behaviour scattered across callers.
- Premature split: boundaries guessed before the domain is understood; merging back is cheaper than living with wrong cuts.
- Shared libraries carrying domain logic, which couples release trains.
