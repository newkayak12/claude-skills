# Choosing a System Shape

Pick the shape from the constraints you can name, not from fashion. Start at the simplest row that satisfies them and move down only when a stated constraint forces it.

| Shape | Pays off when | Costs you |
|-------|---------------|-----------|
| Single deployable (monolith) | one team, requirements still moving, one release cadence | one failure domain; build and test time grow with the code |
| Modular monolith | several teams or domains, but release together is acceptable | discipline: module boundaries are enforced by review or build rules, not by the network |
| Services | teams must ship independently, parts have very different scaling or isolation needs | network failures, distributed data, versioned contracts, operational overhead per service |
| Event-driven | producers must not know their consumers; work can be absorbed asynchronously | eventual consistency, harder tracing, duplicate and out-of-order delivery |

## Questions that move you along the table

- How many teams touch the code, and do they block each other's releases?
- Which parts need to scale or fail independently of the rest?
- Can the business tolerate a read that is seconds stale?
- Who will be on call for each extra deployable?

If every answer is "one team, no, no, us", stay on the first row.

## Event-driven notes

- Assume at-least-once delivery. Consumers must be idempotent, for example by recording processed event ids in the same transaction as the side effect.
- Publish from the database transaction that changed the state (a transactional outbox table drained by a relay) instead of writing to the database and the broker separately.
- Version event payloads additively; removing a field breaks unseen consumers.

## Separating reads from writes (CQRS)

Use it when read shape and write shape genuinely diverge: heavy reporting views, very different load, or a write model full of invariants that reads should not pay for. The write side enforces rules and emits changes; the read side holds denormalized projections built from them and may lag.

Skip it for ordinary CRUD. A second model doubles the places a field can be wrong, and every projection needs a rebuild path.

## Smells that the shape is wrong

- Services that must deploy together, or that share one database schema: a distributed monolith.
- A "modular" monolith where modules reach into each other's tables.
- Synchronous call chains three or more hops deep on the request path.
