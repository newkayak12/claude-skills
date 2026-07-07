# Situational — Data Discipline

**Trigger**: DB schema design, migration, backup, retention-period decisions, or adding a sensitive column

## D-01: PII classification — tag at column level

- **Why**: Without a *list* of which columns are personal data, GDPR / K-Personal Information Protection Act compliance is impossible.
- **How**:
  - When adding a new column, tag `PII: Y/N`, `Sensitivity: low/medium/high`, `Purpose: <why collected>`
  - Consider splitting PII columns into a *separate table* (isolated access = reduced exposure surface)
  - Linked to security rule [`security.md#s-07`](./security.md)

## D-02: Retention policy — enforce *in code*

- **Why**: "Delete when no longer needed" is *never kept*. A policy not automated is not a policy.
- **How**:
  - Specify retention period per entity (e.g. User = 30 days after withdrawal, logs = 90 days, payments = 5 years)
  - *Auto-delete or anonymize* via expiry cron job or TTL index (NoSQL)
  - Delete vs anonymize decision: anonymize if needed for analytics, otherwise hard delete

## D-03: Backup tested — an untested restore is no backup at all

- **Why**: "Backup exists" and "backup restores" are different problems. A common pattern in production incidents.
- **How**:
  - Decide backup frequency, retention, and encryption policy (RPO/RTO)
  - **Quarterly restore drill** — restore to actual staging and verify row counts and checksums
  - Document the restore procedure as a runbook

## D-04: Expand / Contract migration — zero downtime

- **Why**: Changing schema in one step *breaks consistency during deployment*. Multi-phase is required for live operation.
- **How**:
  - **Expand**: add new columns/tables (NULL-allowed or with defaults). Old code unchanged.
  - **Migrate**: *write to both* old and new simultaneously. Backfill old data.
  - **Contract**: remove old code → drop old columns/tables
  - *Deploy + verify* at each step. Never combine steps in one PR.

## D-05: Migration scripts are idempotent

- **Why**: Re-running a partially applied migration after failure is common. Non-idempotent scripts break the system.
- **How**:
  - `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`
  - Backfill scripts are *safe to re-run* (where clause processes only unhandled rows)
  - Use the migration tool's transactional support where available

## D-06: Schema changes are backward-compatible first

- **Why**: Clients and other services are *not updated simultaneously*. An incompatible change forces *simultaneous deployment*.
- **How**:
  - Column *addition* is safe. Column *removal* is deferred until the contract step.
  - Column *rename* → 3 steps: add new column + write to both + remove old column.
  - Same principle for API responses. Field *addition* OK; *removal* requires a deprecation period.

## D-07: Foreign keys + Indexes — explicit

- **Why**: Relationships expressed only in code (without FKs) produce *orphan data*. FKs without indexes wreck join performance.
- **How**:
  - If a relationship exists, add FK constraints *by default*. Remove only intentionally when there is a performance issue.
  - *Auto-create index on FK columns* (varies by DBMS — verify)

## D-08: Start normalized — denormalize only with *evidence*

- **Why**: Normalization *guarantees consistency*. Denormalization is a trade against *consistency risk*.
- **How**:
  - Start at 3NF
  - Denormalize only when a measured bottleneck exists
  - Record denormalization decisions in an ADR — *which query, which measurement, which trade-off*

## D-09: Soft delete vs Hard delete — decide explicitly

- **Why**: Both are valid. But mixing them *without an explicit decision* breaks data consistency.
- **How**:
  - Decide per entity (User = soft, ephemeral log = hard)
  - If soft delete is adopted: enforce `WHERE deleted_at IS NULL` *in every query* — omitting it causes *data leakage* or *ghost data*
  - GDPR right-to-be-forgotten requires *hard delete or anonymization*

## D-10: Time zone — store UTC, convert to local only for display

- **Why**: Mixed time zones cause *silent data corruption*. Extremely difficult to debug.
- **How**:
  - DB, logs, messages = UTC + ISO 8601
  - Convert to user time zone only in UI and reports
  - Use timezone-aware types (`TIMESTAMPTZ`, etc.) for any new time column

## D-11: Check data residency requirements

- **Why**: GDPR (EU), K-Personal Information Protection Act, China Cybersecurity Law, etc. may require *per-country storage locations*.
- **How**:
  - If user regions are likely to diversify, review *region-aware data storage* design in advance
  - Record legal requirements as an ADR when selecting a cloud region

## Related skills

- `develop:database-workflow` — DB work entry point
- `develop:database-optimizer` — infrastructure and operations-side DB tuning
- `develop:sql-pro` — query writing and tuning
- `develop:transaction-boundary-reviewer` — transaction and consistency boundaries
