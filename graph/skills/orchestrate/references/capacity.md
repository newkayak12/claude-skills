# Capacity failure and recovery

Detail behind the capacity mandate in `SKILL.md`.

## Reporting a usage limit

For a native executor that hits its provider usage limit, submit
`{stage_ok:false, failure_kind:"quota", ...}` with available handoff/evidence. Never
mark an ordinary implementation failure as quota.

External adapter diagnostics are classified by the broker, at execution time and at
readiness probe time alike — a vendor rejected for spent capacity is recorded as such
rather than as a broken vendor.

## What the broker retains

It preserves a checkpoint, raw result/log paths, partial working files, and the original
goal; it excludes that vendor for the run and returns a pending, recoverable node. Call
`graph_next` to receive the alternate route.

The next fresh session reads the checkpoint and inspects the current files before
continuing. This is artifact-based recovery, not a portable vendor session transcript.
Each external invocation has a unique artifact directory, so retries do not overwrite
earlier output. Reopening the MCP process does not discard the run or checkpoints.

## Coming back

If all permitted vendors are exhausted, report blocked. Once capacity is restored:

- `graph_retry({run_id, cwd, reset_capacity:true})` clears capacity exclusions and the
  readiness cache on their own — including a vendor rejected at probe time before it ran
  anything — and re-ranks work that has not been dispatched.
- Adding `node_id` also reopens that interrupted node.

Neither can reopen completed nodes or bypass a rejected Gate. Keep `run_id` and `cwd`
to resume after restarting the client.
