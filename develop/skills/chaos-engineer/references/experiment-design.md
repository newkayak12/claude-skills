# Designing an experiment

An experiment is a falsifiable claim about the system plus a controlled way to try to break it.

## Write the claim first

Form: "While <fault> hits <scope> for <duration>, <user-visible signal> stays within <bound>."

- Pick the signal from what users feel: success ratio of a key endpoint, p99 latency, order-completion rate. CPU or pod counts are diagnostics, not steady state.
- Bound it with numbers taken from the SLO, not guessed. Example: checkout success >= 99.5%, p99 < 800 ms.
- Say what you expect the mechanism to be (retry, failover, load shedding). If the mechanism is unknown, the hypothesis is a hope; investigate first.

## Experiment sheet

| Field | Content |
|---|---|
| Claim | the sentence above |
| Fault | one failure type, one parameter set |
| Scope | environment, service, share of instances or traffic |
| Duration | fixed upper bound |
| Observe | dashboards and queries open before start |
| Abort | numeric trigger and the exact command that stops it |
| Owner | who can press stop, who is on call |

## Choosing scope

Grow the blast radius in rungs, advancing only when the previous rung confirmed the claim:

1. one instance in a dev or staging environment
2. a fraction of instances in staging, with synthetic load
3. one instance in production, off-peak
4. a small traffic slice in production, such as a canary or one tenant

Reduce scope again after any surprise. Never skip a rung because the fault "is harmless".

## Abort conditions

- Tie them to the same metrics as the claim, with a margin: stop when the signal crosses the bound, not after it has been bad for ten minutes.
- Prefer an automatic stop (alarm-driven) over a human watching a graph. A person is the backup.
- Rehearse the stop path before injecting: the command works, the credentials work, and measured time to recovery after stopping is known.
- Faults that live outside your control plane (iptables rules, tc qdiscs, paused containers) need an explicit undo step listed in the sheet.

## Before running

- Baseline held steady for a full window beforehand; otherwise results are not interpretable.
- No concurrent deploys, migrations, or other experiments.
- Stakeholders told; support knows the time window.
- Verdict recorded as confirmed, refuted, or inconclusive. A refuted claim is the productive outcome; file the fix and rerun after it.
