# Picking a Datastore

Default to PostgreSQL until a concrete access pattern says otherwise; it covers relational data, JSON documents, full-text search and moderate time series in one operated system.

## Start from the access pattern

| Dominant pattern | Candidate | Watch for |
|------------------|-----------|-----------|
| Multi-row transactions, joins, ad hoc queries | PostgreSQL, MySQL | vertical limits; plan read replicas and partitioning before they hurt |
| Aggregate loaded and saved whole, schema varies per record | document store (MongoDB) or a `jsonb` column | cross-document transactions and joins are weaker or costly |
| Lookup by key at very high rate, expiring data, counters | Redis, DynamoDB | no ad hoc querying; the key design is the schema |
| Append-heavy measurements queried by time window | TimescaleDB, InfluxDB | retention, downsampling and cardinality of tags |
| Relevance-ranked text search | OpenSearch/Elasticsearch, or Postgres full-text for small scale | treat as a derived index, not the source of truth |

## Decide with these checks

1. Write the five most important queries and the invariants that must hold atomically. A store that cannot express them is out.
2. Estimate size and growth in rows per day and bytes per row, plus peak reads and writes per second. Many systems fit on one Postgres node.
3. State the consistency you need per operation: read-your-writes, or tolerate staleness.
4. Count the operational cost: who backs it up, upgrades it, restores it, and has done so before.
5. Prefer one source of truth. Extra stores are derived copies with a documented rebuild path.

## Common traps

- Choosing a document store because the schema is "not settled", then re-implementing joins in application code.
- Using a cache as the only copy of data.
- Adding a specialised store for a load that a Postgres index would serve.
