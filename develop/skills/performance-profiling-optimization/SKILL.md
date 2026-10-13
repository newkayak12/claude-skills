---
name: performance-profiling-optimization
effort: high
description: >-
  Use when something is slow and you need data-driven profiling. Triggers on: "API가 느려요", "병목 찾아줘", "메모리 계속 늘어나",
  "p99 latency spike", "profile this endpoint", "high CPU". Not for SQL rewrites or pool sizing.
scenarios:
  - "Our API response times degraded after the last deploy — help me profile and fix it"
  - "Profile this Java service to find memory leaks and CPU hotspots"
  - "Application throughput dropped by 40% — systematic performance investigation needed"
  - "배포 후 API 응답 시간이 느려졌는데 원인을 찾아줘"
  - "메모리 누수와 CPU 병목을 프로파일링해줘"
compatibility:
  recommended:
    - sequential-thinking
    - think-tool
  optional: []
  remote_mcp_note: >-
    sequential-thinking은 베이스라인 측정 → 프로파일링 → 원인 분석 → 수정 → 검증 흐름을 강제합니다.
    think-tool은 여러 병목 후보 중 우선순위를 결정하는 데 활용됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- ALWAYS capture a baseline before touching anything.
- ALWAYS change one thing at a time, so the delta has one cause.
- ALWAYS run the correctness check first — a speedup that changes results does not count.
- NEVER optimize without data or guess at bottlenecks — a guessed fix costs a deploy and often moves the wrong number.
- NEVER keep a change that is neutral or worse — revert it; it still adds complexity and risk.
- NEVER invent a missing metric (percentile, RPS, heap size). Mark `[확인 필요: ○○]` and ask for the measurement; a
  made-up baseline makes every later delta meaningless.
- Goal: a baseline, a profiler-confirmed bottleneck, one change at a time with before/after numbers beyond run-to-run
  variance, and a guard; the closing tally recounts to the change lines.

# Performance Profiling & Optimization

Measure first. Hypothesize second. Profile third. Fix fourth. Verify always. Guard last.

**Not for** SQL rewrites (`develop:sql-pro`), database server tuning (`develop:database-optimizer`) or pool sizing
(`develop:connection-pool-tuner`) — see Escalation Paths. An active production incident goes to
`develop:incident-response-playbook` first.

---

## Investigation Workflow

### Step 1 — Establish a Baseline
Before touching anything, capture current state:
- P50 / P95 / P99 latency (not just average)
- Error rate and error types
- Resource utilization: CPU %, heap used/max, GC frequency, thread pool saturation
- Request rate (RPS/TPS) at the time of degradation

**Output**: a one-line problem statement.
> "P99 API latency is 4.2s under 300 RPS; CPU is 40%, heap is 85% of max, GC pauses avg 800ms."

### Step 2 — Form a Hypothesis
Map symptoms to candidate causes using the table below. Pick the top 2–3.

| Symptom | Likely Cause |
|---------|-------------|
| CPU 100%, low latency variance | Hot loop, serialization overhead, regex |
| High P99, low CPU | Lock contention, thread starvation, GC stop-the-world |
| Memory grows then crashes | Memory leak, unbounded cache, large result sets held in memory |
| IO wait high | Slow DB queries, missing index, full table scans |
| Network latency spikes | DNS resolution, connection setup overhead, chatty API calls |
| GC pause > 200ms | Large old-gen, too-frequent allocation, premature promotion |

### Step 3 — Profile
Target the hypothesis. Don't profile everything at once. Tools by symptom (CPU, memory, IO, network) and bottleneck
signatures with fixes: `references/profiling-tools.md`.

### Step 4 — Fix
One change at a time, so the delta in Step 5 has one cause. Document what you changed and why.
If changes must ship together, measure each alone first.

### Step 5 — Verify
Re-run the same load, same conditions, same duration, that reproduced the problem. Compare against baseline.
- **Correctness check first**: tests pass and output is identical to before. A speedup that changes results
  (dropped work, stale cache, skipped validation) is a bug, so the metric does not count until this passes.
- **Beat the noise**: repeat the runs and compare the delta to run-to-run variance, not one mean. A 3% gain
  inside ±5% variance is a different sample, not a gain.
- **Neutral or worse: revert.** A change that does not measurably help still adds complexity and risk; keep
  only what the numbers prove.
If the fix holds: document it. If not: return to Step 2.

### Step 6 — Guard
Stop the regression from returning. Pick the metric the fix was justified by (e.g. P99 of `/checkout`) and
enforce it: a CI performance budget (fail the build above 800ms P95 in the load test, judged on a median of
repeated runs so variance does not make it flaky) and/or an alert on that metric in production monitoring.
When the guard fires, return to Step 1 and re-baseline.

---

## Making the Case for Performance Work

Frame performance work in cost and user impact terms — not engineering elegance.

**Template**:
> "Current P99 latency is X ms. Industry benchmark / SLA target is Y ms.
> At our traffic of Z RPS, each 100ms of extra latency costs approximately [conversion rate / user satisfaction / infra cost].
> Proposed fix requires [N days]. Expected outcome: P99 drops to W ms, [cost/impact metric] improves by K%."

---

## Escalation Paths

| Bottleneck Found | Escalate To |
|-----------------|-------------|
| DB query performance, missing indexes, slow writes | [`../database-optimizer/SKILL.md`](../database-optimizer/SKILL.md) |
| Connection pool exhaustion, pool sizing | [`../connection-pool-tuner/SKILL.md`](../connection-pool-tuner/SKILL.md) |
| Latency spikes causing downstream failures / cascades | [`../circuit-breaker-tuner/SKILL.md`](../circuit-breaker-tuner/SKILL.md) |
| Production profiling, SLO definition, alerting | [`../sre-engineer/SKILL.md`](../sre-engineer/SKILL.md) |

---

## Quick Reference Checklist

Before declaring the investigation done (recount the tally against the change lines first; fix the verdict line if they differ):
- [ ] Baseline metrics captured before any change
- [ ] Bottleneck confirmed with profiler data (not just hypothesis)
- [ ] Root cause identified (not just symptom)
- [ ] Fix applied one change at a time
- [ ] Correctness check passed; improvement exceeds run-to-run variance (neutral changes reverted)
- [ ] CI budget or alert guards the metric
- [ ] Change documented with before/after numbers
- [ ] Regression test or load test added to prevent recurrence

---

**Stack coverage note:** Tool examples in this skill are JVM (async-profiler, heap dumps, GC logs), Python (py-spy, memory-profiler), and Go (pprof) centric. For Node.js: use `clinic.js` or `--inspect` with Chrome DevTools. For Rust: use `cargo flamegraph` or `perf`. The investigation workflow (measure → hypothesize → profile → fix → verify) applies to all stacks regardless of tooling.

## Output Template

```
## Performance investigation — <service/endpoint>

Problem: <one-line statement with P50/P95/P99, RPS, CPU, heap>
Bottleneck: <profiler evidence: tool, file/graph, top frame>

| # | Change | Correctness | Before | After | Variance | Kept / reverted |
|---|--------|-------------|--------|-------|----------|-----------------|

Guard: <CI budget or alert, metric and threshold>
Gaps: [확인 필요: ○○] ...

<n> changes · <k> kept · <r> reverted · <g> gaps — resolved / unresolved / blocked
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Sets the baseline and states the problem in one line | Provide metrics: latency percentiles, error rate, resource use |
| Forms hypotheses and guides profiling to confirm the bottleneck | Run the profiler in your environment and share the output |
| Proposes one targeted change at a time | Apply the change |
| Verifies the improvement with before/after numbers | Provide post-fix metrics |

## Related Skills

- `develop:sql-pro` — when the bottleneck is one query's text or plan
- `develop:database-optimizer` — when the bottleneck is database infrastructure
- `develop:connection-pool-tuner` — pool exhaustion and latency spikes
- `develop:incident-response-playbook` — when the regression is an active production incident
- `completion:verification-before-completion` — confirm the improvement with fresh evidence
