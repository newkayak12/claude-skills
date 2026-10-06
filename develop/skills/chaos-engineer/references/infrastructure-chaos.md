# Host, network and cloud faults

Typical stack assumed: Spring Boot services on Kotlin, PostgreSQL, a managed cloud. Each section lists what the fault teaches and one way to inject it.

## Slow or lossy network

What it exposes: missing client timeouts, retry storms, connection pool starvation (HikariCP waits up to `connectionTimeout` before failing).

- Between services without touching hosts: a TCP proxy with injectable "toxics" (Toxiproxy supports latency with jitter, bandwidth limit, timeout, and connection reset). Point the service's datasource or client URL at the proxy.
- On a Linux host: `tc qdisc add dev eth0 root netem delay 200ms 50ms loss 5%`, undone with `tc qdisc del dev eth0 root`. Requires root; scope it with a filter if the host also carries management traffic.
- Increase the fault gradually: 50 ms, 200 ms, 1 s, then total blackhole. Note which step first breaks the claim.

## Dependency down

- Database: stop the PostgreSQL primary or fail over a replica; watch how long writes error, whether the pool recovers without restart, and whether transactions in flight are retried safely (idempotency).
- Cache: stop Redis; the system should degrade to the database without exhausting it.
- Third-party API: have the proxy return errors or hang; verify the circuit breaker opens and a fallback is served.

## Resource exhaustion

- `stress-ng --cpu 4 --cpu-load 80 --timeout 300s` for CPU, `--vm 2 --vm-bytes 70%` for memory, `--hdd 2` for disk writes.
- Fill a disk with a large file on the data volume to see how logging, WAL, and temp files behave at 100%.
- Watch for throttling-driven latency, OOM kills, and whether autoscaling reacts before users do.

## Zone or region loss

- Cloud fault services (for example AWS Fault Injection Service) provide experiment templates with actions such as stopping or terminating instances, and stop conditions bound to CloudWatch alarms. Use the stop condition as the automatic abort.
- Without such a service, simulate a zone by terminating all instances of one zone or by blocking its subnet with network ACLs, then restore the ACL.
- Verify: traffic shifts to survivors, remaining zones have capacity for the extra load (N+1 sizing), and data stores keep quorum.

## Name resolution and certificates

- DNS: make a dependency's hostname resolve to nothing or to a dead address. JVM caches successful lookups per its `networkaddress.cache.ttl` setting (30 seconds by default without a SecurityManager; with one, forever), so a service may not notice for a while; test that expectation.
- Certificates: issue a short-lived certificate in a test environment and let it expire; confirm monitoring warns well before and that renewal is automated.

## Containers

Docker-level tools (Pumba) can kill, pause, delay, or drop packets for matching containers on a schedule. Useful in Compose-based test environments; use the Kubernetes tooling instead once on a cluster.
