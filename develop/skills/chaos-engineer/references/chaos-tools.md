# Tooling and automation

## Picking a tool

| Need | Fits |
|---|---|
| Random instance termination in a cloud fleet | Chaos Monkey, or a small script against the cloud API |
| Managed, audited fault injection with stop conditions | cloud-provider fault service or a commercial platform such as Gremlin |
| Kubernetes-native faults as manifests | Litmus, Chaos Mesh |
| Per-connection network faults for a test | Toxiproxy |
| Host-level resource stress | stress-ng, tc netem |

Choose the narrowest tool that expresses the fault; each extra agent is extra blast radius.

## A minimal random-kill script

Principle: list candidates by tag, exclude anything not opted in, cap the count, log every victim, and run only inside a schedule window.

1. List instances carrying `chaos=opt-in`.
2. Compute `ceil(share * count)` with a hard cap of one or two.
3. Pick at random, record id and time, terminate.
4. Emit an event to the monitoring system so graphs show the marker.

Opt-in tags beat opt-out lists: new services are safe by default.

## Chaos in the pipeline

Run experiments after deploy to staging, with a smoke-level steady-state check as pass/fail.

Sketch of a GitHub Actions job:

1. deploy candidate to staging
2. apply the experiment manifest
3. query the metrics API for the steady-state signal during the window (fail the job when out of bound)
4. delete the manifest in an `if: always()` step
5. upload the report

Keep these tests few and deterministic. A flaky chaos gate teaches the team to ignore it.

## Visibility

- Annotate dashboards at experiment start and end.
- Keep a log of experiments: date, claim, result, ticket. Re-run old claims on a cadence, since systems drift.
- Surface "days since last successful run" per critical dependency to find coverage gaps.
