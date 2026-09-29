# Alex Chen — Senior Backend Engineer

## Summary
8 years building distributed systems. Led teams of 3-8 engineers. Passionate about high-throughput data pipelines, event-driven architectures, and developer tooling.

Tech: Go, Python, Rust (hobby), Kafka, Flink, Cassandra, Redis, Kubernetes, Terraform, AWS/GCP.

## Experience

### TechCorp (2020–present) — Staff Engineer
- **Led the migration** of our real-time analytics pipeline from batch (daily) to streaming (< 2s latency), enabling personalization features for 40M+ users
- Designed and owned the event ingestion service processing **12M events/sec at peak**
- Introduced distributed tracing (Jaeger) across 30+ services, reducing MTTR from ~4 hours to ~35 min
- Mentored 5 engineers, 2 of whom were promoted to senior during my tenure
- Drove adoption of feature flags (LaunchDarkly) across product engineering

### FastData Inc. (2017–2020) — Senior Engineer
- Core contributor to open-source stream processing library (2.1k GitHub stars)
- Built connector framework used by 200+ enterprise customers
- On-call rotation lead; wrote runbooks for 15 failure modes

### StartupX (2016–2017) — Backend Engineer
- Early hire (#4); built the initial API and auth layer
- Helped scale from 0 to 500k users in 8 months

## Select Projects

### Real-time Recommendation Engine (TechCorp)
Replaced a batch ML recommendation system with an online feature store + real-time scoring pipeline. Tech: Flink, Redis, Kafka, gRPC, Python (model serving), Go (gateway).

**What I did**: Designed the data model for the feature store, wrote the feature computation jobs, and drove the production rollout across 4 product surfaces.

**Outcome**: Latency p99 dropped from 800ms to 45ms. Click-through rate on recommendations improved. (I don't have the exact business metric — the data science team owns that.)

### Distributed Tracing Rollout
The 30+ service mesh had no observability. I proposed and drove Jaeger adoption end-to-end: instrumented 12 services myself, wrote the instrumentation guide, held office hours for 3 months.

**Outcome**: MTTR down from ~4h to ~35min. On-call happiness survey went from 3.2 to 4.1/5.

## Education
B.S. Computer Science, UC San Diego

## Open Source
- Contributor to open-source stream processing library (50+ merged PRs, 12 issues filed/resolved)
- Author of a small Go HTTP middleware library (380 stars)

## Writing
4 internal design docs (distributed, not public). One conference talk at an internal summit.
