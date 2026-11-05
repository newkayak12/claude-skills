#!/usr/bin/env node
// broker - the team_* tools: owns the harness flow as a node graph and mediates every node's
// execution across vendors.
//
// Two rules shape the whole tool surface:
//
//   1. The orchestrator never holds a payload. It throws the request in, asks what to
//      run next, tells the broker to run it, and gets back a one-line verdict. The
//      goal-spec, upstream handoffs, prior rejection feedback, changed-file lists and
//      evidence all stay on disk. If they accumulated in the orchestrator's context,
//      a long graph with retries would run out of room - the loop would die before the
//      work did.
//
//   2. Whoever executes a node - a vendor CLI or the orchestrator itself - the claimed
//      result meets the same worktree cross-check here. The broker may LOWER stage_ok.
//      It never raises it.
//
// A corollary of (1): the broker composes node prompts itself, from graph state. The
// caller is not allowed to pass one in.
//
// Zero dependencies: MCP's stdio transport is newline-delimited JSON-RPC 2.0.
//
// This file is a facade (card 128): imports and re-exports; a library served by server.mjs, it binds
// no stdin. The code lives in
//   broker-vendors.mjs       vendor registry, ledger, adapter invocation, readiness probe
//   broker-checkpoint.mjs    worktree cross-check, checkpoint / rollback, verify guard
//   broker-routing.mjs       run lookup, knownCwds, hand-off drain, routing
//   broker-normalize.mjs     result normalization, verdict, nodeSucceeded
//   broker-independence.mjs  author != reviewer, finishNode, interruption checkpoint, submit
//   broker-tools.mjs         tool table, handlers, callTool
//   stdio.mjs                the JSON-RPC loop (used by server.mjs)

export { resolveNativeModel } from './broker-routing.mjs';
export { finishNode, computeSubmitResult } from './broker-independence.mjs';
export { BROKER_TOOLS, callBrokerTool } from './broker-tools.mjs';
