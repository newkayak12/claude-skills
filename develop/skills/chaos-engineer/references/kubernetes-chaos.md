# Cluster faults

## Tool choice

Both main open-source operators work through CRDs, so an experiment is a manifest that can be reviewed and versioned.

- Litmus: `ChaosEngine` binds an app (by namespace, label, kind) to named experiments such as `pod-delete`, with environment variables for duration, interval, and affected percentage. Needs a service account with rights on the target namespace.
- Chaos Mesh: one kind per fault family: `PodChaos` (actions `pod-kill`, `pod-failure`, `container-kill`), `NetworkChaos` (`delay`, `loss`, `partition`, `bandwidth`), `StressChaos`, `IOChaos`, `DNSChaos`, `HTTPChaos`, `TimeChaos`. Targets are chosen with a selector and a `mode` (for instance `one`, `fixed-percent`).

Deleting the experiment resource ends it; keep that in the abort path.

## Pod loss

Hypothesis shape: with N replicas, killing one never drops availability below the SLO.

- Needs: >= 2 replicas, readiness probes that reflect real readiness, spreading across nodes (`topologySpreadConstraints` or anti-affinity), graceful shutdown (Spring Boot `server.shutdown=graceful`, `preStop` delay so endpoints drain first).
- Check restarts do not all land on one node and that startup time fits within traffic expectations.

## Node loss

- Planned: `kubectl drain <node> --ignore-daemonsets --delete-emptydir-data`, then `kubectl uncordon`. Validates PodDisruptionBudgets: a PDB that forbids all disruption blocks the drain, a missing one lets all replicas leave together.
- Unplanned: stop the instance behind the node. Observe how long the control plane takes to mark it NotReady and reschedule; stateful workloads with attached volumes are the slow cases.

## Network between workloads

- `NetworkChaos` partition between two services reveals whether callers time out quickly, open breakers, and recover when the partition heals.
- Delay or loss on one dependency tests retries; confirm retries have budgets and jitter rather than multiplying load.
- Remember service meshes and network policies change the picture; run in the same configuration as production.

## Autoscaling

Generate load while injecting pod loss or CPU stress, and record time from signal to new ready pods. Metrics lag, stabilization windows, and node-provisioning delay usually dominate; compare against the traffic ramp you expect.

## Example: pod-kill experiment (Chaos Mesh)

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: PodChaos
metadata:
  name: orders-pod-kill
  namespace: staging
spec:
  action: pod-kill
  mode: fixed-percent
  value: "33"            # at most a third of matching pods
  selector:
    namespaces: [staging]
    labelSelectors:
      app: orders
```

`pod-kill` is one-shot: deleting the resource does not bring pods back, so cap the blast radius (`value`, selector) up front. For a fault that is held for a period and is undone on deletion, use `pod-failure` with `duration`. For any irreversible fault, write the manual recovery step (reschedule, restore, redeploy) before you start.

## Custom controllers

Delete or corrupt a share of custom resources and confirm the operator reconciles them back. Also stop the operator itself and check that workloads keep serving while it is down.
