# System Design Document Skeleton

Use this order when the deliverable is a full design write-up. Keep each section short; link to ADRs for the reasoning.

1. **Goal and scope** — the problem in two sentences, plus what is explicitly out.
2. **Requirements** — functional capabilities, ranked non-functional targets (see the NFR file), and fixed constraints such as team size, budget, mandated platforms.
3. **Context view** — the system as one box with its users and neighbouring systems.
4. **Container view** — deployable pieces and stores, with the protocol on every arrow. Draw it (Mermaid inline, or the IR flow for something shared).
5. **Key flows** — one sequence per critical path, including the failure branch.
6. **Data** — owned entities per component, source of truth for each, how copies are kept in step.
7. **Capacity and growth** — today's load, the load that breaks the current design, and the first thing to change then.
8. **Security** — trust boundaries, authentication and authorisation points, secrets handling, sensitive data locations.
9. **Failure modes** — for each dependency: what happens when it is slow, down or wrong, and the fallback (timeout, retry with backoff, circuit breaker, degrade).
10. **Operations** — deploy, rollback, metrics, alerts, who is paged.
11. **Decisions and open questions** — ADR links and what is still unresolved, each with an owner.

## Sanity checks before sharing

- Every box has an owner and every arrow a failure behaviour.
- No store is written by two components.
- The design names what it deliberately does not handle yet.
