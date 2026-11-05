#!/usr/bin/env node
// teams-engineering - local stdio MCP server that owns the harness flow as a node graph and
// mediates every node's execution across vendors.
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
// This file is a facade (card 128): imports, re-exports and the entry-point wiring. The code lives in
//   broker-vendors.mjs       vendor registry, ledger, adapter invocation, readiness probe
//   broker-checkpoint.mjs    worktree cross-check, checkpoint / rollback, verify guard
//   broker-routing.mjs       run lookup, knownCwds, hand-off drain, routing
//   broker-normalize.mjs     result normalization, verdict, nodeSucceeded
//   broker-independence.mjs  author != reviewer, finishNode, interruption checkpoint, submit
//   broker-tools.mjs         tool table, handlers, callTool
//   stdio.mjs                the JSON-RPC loop

import { isEntryPoint } from './pluginroots.mjs';
import { serve } from './stdio.mjs';
import { BROKER_TOOLS, callBrokerTool } from './broker-tools.mjs';

export { resolveNativeModel } from './broker-routing.mjs';
export { finishNode, computeSubmitResult } from './broker-independence.mjs';
export { BROKER_TOOLS, callBrokerTool } from './broker-tools.mjs';

const SERVER = { name: 'teams-engineering', version: '1.0.0' };
const DEFAULT_PROTOCOL = '2025-06-18';

// Only run the stdio server when this file is the process entry point - the same guard
// taskmanager.mjs (`isMain`) and daemon.mjs (`RUN_AS_MAIN`) already use, from the one module all
// three now import it from (pluginroots.mjs's isEntryPoint) rather than each carrying its own
// copy. Needed here for a new reason as of 0.27.4: taskmanager.mjs imports this module directly,
// for computeSubmitResult - a human's tm_submit({key}) gets the exact worktree cross-check
// team_submit gives anyone else, read-only, without re-implementing it (see that function's own
// comment, and graph.mjs's queueHumanAction for what replaced the direct child-run writes the
// 2026-09-24 review caught). An import must never also bind stdin, or the TaskManager process
// would start a second, silently-conflicting JSON-RPC loop reading ITS OWN stdin as this file's.
const isMain = isEntryPoint(import.meta.url);

if (isMain) {
  serve({ serverInfo: SERVER, protocolVersion: DEFAULT_PROTOCOL, tools: BROKER_TOOLS, call: callBrokerTool });
}
