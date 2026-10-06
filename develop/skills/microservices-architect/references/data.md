# Owning and Moving Data

## Ownership
One service writes a given piece of data; others read it through that service's API or a replicated copy they treat as a cache. Separate schemas inside one PostgreSQL cluster are an acceptable start if credentials and migrations are per service and no cross-schema queries exist. A shared schema anyone can write is the end of independent deployment.

## Consistency choices
- Inside an aggregate: ACID in one local transaction.
- Across services: eventual consistency, with the business tolerating a visible lag. Ask the domain expert what an inconsistent window costs; often it is cheaper than expected.
- Show users pending states explicitly ("payment processing") rather than hiding the lag.

## Atomic change plus message: the outbox
Writing to the database and then publishing can lose the message on a crash. Instead write the event to an outbox table in the same transaction, and relay it afterwards.
```sql
CREATE TABLE outbox (
  id uuid PRIMARY KEY,
  aggregate_id text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
```
Relay options: a poller using `SELECT ... FOR UPDATE SKIP LOCKED`, or log-based change data capture. Delivery is at-least-once, so consumers keep an inbox/processed-id table.

## Sagas
A saga replaces a distributed transaction with local transactions and compensations.
- Each step has a compensating action for the effects already committed; the last step normally has none.
- Compensation is a business reversal (refund, release stock), not a database rollback; it can itself fail and must be retryable.
- Steps that cannot be undone (email sent) go last, or are made reversible by delaying them.
- Persist saga state (step, correlation id, deadline) so a restart resumes it.
- Two-phase commit across services is avoided: it blocks on coordinator failure and few brokers or stores support it.

Order example: reserve stock, authorise payment, create shipment, confirm. Payment declined triggers stock release, then marks the order rejected.

## Event sourcing
Store the sequence of facts instead of current state; state is a fold over events.
Use when audit history, temporal queries or replay are core requirements. Avoid as a default: it adds schema evolution, projection rebuilds and harder ad hoc queries.
- Append with optimistic concurrency on an expected version per stream.
- Snapshot every N events to bound replay time.
- Evolve schemas by upcasting old events on read; never edit history.

## CQRS
Separate the write model from one or more read models. Introduce when read shapes differ sharply from write shapes or scale differently. Read models are rebuilt from events or change streams; accept staleness and expose version or timestamp so clients can detect it. Not required for event sourcing and not required for outbox.

## Replicated reads
When service A needs service B's data often, subscribe to B's events and keep a narrow local table of only the columns A uses. Record the source version to drop stale updates. Do this instead of runtime joins across the network.

## Partitioning
Choose a key with high cardinality that matches access paths (tenant id, customer id). Cross-partition queries and transactions become expensive; design so the common operation touches one partition. In PostgreSQL, declarative partitioning handles single-node scale; sharding across nodes is a larger step to take only when measurements demand it.
