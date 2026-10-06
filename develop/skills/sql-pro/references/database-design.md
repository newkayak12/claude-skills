# Database Design

## Normal Forms in Practice

Each form removes one kind of redundancy.

- **1NF**: one value per column, no repeating groups (`phone1, phone2`) and no comma-separated lists. Put them in a child table.
- **2NF**: every non-key column depends on the whole key. Relevant for composite keys: `order_item(order_id, product_id, product_name)` stores `product_name` against half the key.
- **3NF**: non-key columns depend on nothing but the key: `customer(id, zip, city)` where city follows from zip belongs in a `zip` table.
- **BCNF**: every determinant is a candidate key; it differs from 3NF only in overlapping-key edge cases.

Design to 3NF, then denormalize deliberately, with a measured reason, a single owner for the copy, and a way to repair drift. Typical sound denormalizations: snapshotting price on an order line (it is history, not a copy), counters maintained transactionally, read models for reports.

## Keys

- Surrogate key (`bigint` identity or UUID) for the primary key; keep natural identifiers as `UNIQUE` constraints so business rules still hold.
- PostgreSQL 10+: `id bigint GENERATED ALWAYS AS IDENTITY`. MySQL: `BIGINT AUTO_INCREMENT`. SQL Server: `BIGINT IDENTITY(1,1)`. Oracle 12c+: `GENERATED ... AS IDENTITY`.
- Random UUIDv4 primary keys fragment clustered or B-tree indexes (notably InnoDB, SQL Server clustered). Time-ordered UUIDs (v7) or bigints avoid that.
- Foreign keys: declare them. Pick `ON DELETE` on purpose: `RESTRICT` / `NO ACTION` by default, `CASCADE` only for true parts-of-aggregate (order lines), `SET NULL` for optional links.
- Composite keys suit pure link tables (`user_role(user_id, role_id)`).

## Constraints

Push invariants into the database so every writer obeys them, not only your Spring service.

- `NOT NULL` by default; nullable only when absence is meaningful.
- `CHECK (qty > 0)`, `CHECK (end_at > start_at)`. MySQL enforces CHECK from 8.0.16; earlier versions parsed and ignored it.
- `UNIQUE` and NULLs: PostgreSQL and MySQL allow many NULLs in a unique index; SQL Server allows only one. PostgreSQL 15+ has `UNIQUE NULLS NOT DISTINCT`.
- Money as `NUMERIC(precision, scale)`/`DECIMAL`, never floating point. Timestamps: store instants as `timestamptz` (PostgreSQL) or UTC `DATETIME`/`datetime2`.
- Enumerations: a lookup table with FK is easy to extend; `CHECK (status IN (...))` is simpler but needs a migration per change.
- Prevent overlapping bookings in PostgreSQL with an exclusion constraint (`EXCLUDE USING gist (room_id WITH =, during WITH &&)`, needs `btree_gist` for the `=` part).

## Modeling Recipes

- **Many-to-many**: link table with both FKs as a composite primary key, plus an index on the second column for reverse lookups.
- **Hierarchy**: adjacency list (`parent_id`) with recursive CTE is the default; use a closure table when subtree queries dominate.
- **Polymorphic references**: avoid `(owner_type, owner_id)` with no FK; use one nullable FK per target with a `CHECK` that exactly one is set, or a shared supertype table.
- **Flexible attributes**: `jsonb` column for sparse, rarely filtered data; real columns for anything you join, filter or constrain.
- **Multi-tenancy**: `tenant_id` in every table and in every unique/composite index, leading column.

## History and Deletion

- **Valid-time rows**: `valid_from`, `valid_to` (half-open interval, `valid_to` NULL or far-future for current), plus a constraint that prevents overlaps for the same entity. "As of" query: `valid_from <= :t AND (valid_to IS NULL OR valid_to > :t)`.
- **Soft delete** (`deleted_at`): every query must remember the filter, and unique constraints collide with deleted rows. Use a partial unique index (`WHERE deleted_at IS NULL`; PostgreSQL, SQL Server filtered index) and consider a view or JPA `@SQLRestriction` to apply the filter centrally. If deleted data is rarely read, move it to an archive table instead.
- **Audit trail**: a `*_history` table written by trigger or by the application in the same transaction, recording actor, time, operation and old/new values. Keep it append-only.

## Evolving a Schema Safely

Ship changes with a migration tool (Flyway or Liquibase) and use expand/contract: add the new nullable column or table, deploy code that writes both, backfill in batches, switch reads, then drop the old structure in a later release. Adding a `NOT NULL` column with a default, or building an index without `CONCURRENTLY`, can lock a hot table; check the behavior of your engine version first.
