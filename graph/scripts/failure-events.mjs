#!/usr/bin/env node
// The failed / reshaped / blocked events of a graph run file, with the reason and next step the
// mod shows. The mod renders these fields and decides nothing (.claude/rules/mod.md).
//
//   node graph/scripts/failure-events.mjs <run.json>
//
// Prints a JSON array of {key, kind, node, attempt, what, reason, next_step, severity}; `[]` on any
// error, exit 0 (a mod guard fails open). next_step is `retry A/B`, `retrying as setgoal:N`,
// `gave up` (a `final: true` failed node, which is what a graph_settle leaves in the run file, or a
// routing_blocked run), or null (nothing decided yet). graph has no human wait, so never `needs you`.
// The engine records no spec-retry field: a spec retry is read from the shape retrySpec leaves,
// a critique skipped with its own result next to a setgoal of the following attempt.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runState } from '../mcp/graph.mjs';

export const REASON_MAX = 120;
export const NO_REASON = 'no reason recorded';
const DEFAULT_MAX_RETRIES = 2; // createRun's default, for a run file without max_retries
const GAVE_UP = 'gave up';
const SUPERSEDED = /^superseded by spec attempt/; // retrySpec's note on a node it retired unrun

// one line, at most REASON_MAX chars: whitespace runs become one space, a longer text ends in …
export function oneLine(text) {
  const line = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (line === '') return NO_REASON;
  return line.length > REASON_MAX ? `${line.slice(0, REASON_MAX - 1)}…` : line;
}

export function failureEvents(run) {
  const budget = (Number.isInteger(run.max_retries) ? run.max_retries : DEFAULT_MAX_RETRIES) + 1;
  const out = [];
  const add = (kind, n, nextStep) =>
    out.push({
      key: `${run.run_id}:${n.node_id}:${kind}:${n.attempt}`,
      kind,
      node: n.node_id,
      attempt: n.attempt,
      what: n.node_id,
      reason: oneLine(n.result?.reason),
      next_step: nextStep,
      severity: nextStep === GAVE_UP ? 'failure' : 'info',
    });

  for (const n of run.nodes) {
    if (n.state !== 'failed' || n.final === true) continue;
    // a rejected critique is retried by retrySpec, never as a node: its next step is the reshape event
    const retry = n.attempt + 1 <= budget && n.stage !== 'critique' ? `retry ${n.attempt + 1}/${budget}` : null;
    add('rejected', n, retry);
  }
  for (const n of run.nodes) {
    if (n.stage !== 'critique' || n.state !== 'skipped' || !n.result || SUPERSEDED.test(n.result.reason ?? '')) continue;
    const next = run.nodes.find((x) => x.stage === 'setgoal' && x.attempt === n.attempt + 1);
    if (next !== undefined) add('reshaped', n, `retrying as setgoal:${next.attempt}`);
  }
  // graph_settle (the broker's ledger event) leaves `final: true` on the failed node: that mark is
  // the run-file record of it, and it counts whatever the run does next (the order-only report
  // runs on after a settle, so the run is rarely `blocked` by then)
  const spent = run.nodes.find((n) => n.state === 'failed' && n.final === true);
  if (spent !== undefined) add('failed', spent, GAVE_UP);
  else if (run.routing_blocked && runState(run).state === 'blocked') {
    const stuck = run.nodes.find((n) => n.state === 'failed') ?? run.nodes[0];
    if (stuck !== undefined) add('blocked', stuck, GAVE_UP);
  }
  return out;
}

function main(file) {
  let events = [];
  try {
    const run = JSON.parse(readFileSync(file, 'utf8'));
    if (Array.isArray(run.nodes)) events = failureEvents(run);
  } catch {
    // unreadable or invalid: no events
  }
  process.stdout.write(`${JSON.stringify(events)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv[2]);
