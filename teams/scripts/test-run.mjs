// test-run.mjs - teams/scripts/run.mjs, the headless "teams run" CLI (§4-C of docs/plans/
// 2026-09-21-teams-server-owns-the-loop.md).
//
// Every test here mocks the task layer (`deps.callTool`, and where needed `mustFindTask`/
// `docPaths`) - none of it spawns a real daemon, a real driver, or `claude`. That is exactly
// what run.mjs was built to let a caller reuse (tm_run's open+spawn, tm_wait's poll loop)
// without duplicating; these tests stand in for the task layer entirely so they stay fast and
// hermetic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, exitCodeForState, runHeadless, EXIT } from './run.mjs';

// A Writable-ish stub: collects every emit() line so a test can assert on it without touching
// the real stdout.
function sink() {
  const lines = [];
  return { write: (s) => lines.push(s), lines };
}

function parseJsonLines(lines) {
  return lines.map((l) => JSON.parse(l.trimEnd()));
}

// ---------- parseArgs ----------

test('parseArgs: request is the positional argument, joined if it arrived as several tokens', () => {
  const a = parseArgs(['build', 'the', 'thing']);
  assert.equal(a.request, 'build the thing');
  assert.equal(a.resume, undefined);
  assert.equal(a.json, false);
});

test('parseArgs: --kind and --flow are the same destination, tm_run\'s own `flow`', () => {
  assert.equal(parseArgs(['req', '--kind', 'develop']).flow, 'develop');
  assert.equal(parseArgs(['req', '--flow', 'document']).flow, 'document');
});

test('parseArgs: --kind rejects a value outside tm_run\'s own enum', () => {
  const a = parseArgs(['req', '--kind', 'bogus']);
  assert.match(a.error, /--kind must be one of/);
});

test('parseArgs: --resume takes a task id and no positional request', () => {
  const a = parseArgs(['--resume', 'T1']);
  assert.equal(a.resume, 'T1');
  assert.equal(a.request, undefined);
});

test('parseArgs: --resume and a request together is an error, not a silent pick', () => {
  const a = parseArgs(['--resume', 'T1', 'also a request']);
  assert.match(a.error, /--resume takes no request/);
});

test('parseArgs: no request and no --resume is an error', () => {
  const a = parseArgs([]);
  assert.match(a.error, /a request is required/);
});

test('parseArgs: --budget-usd and --timebox-minutes are coerced to numbers', () => {
  const a = parseArgs(['req', '--budget-usd', '12.5', '--timebox-minutes', '90']);
  assert.equal(a.budgetUsd, 12.5);
  assert.equal(a.timeboxMinutes, 90);
});

test('parseArgs: a non-numeric --budget-usd is rejected', () => {
  const a = parseArgs(['req', '--budget-usd', 'lots']);
  assert.match(a.error, /--budget-usd must be a number/);
});

// --initiative is tm_run's own `initiative` argument (teamconfig.mjs slug-normalizes it
// server-side - this CLI passes the raw string through unchanged, same as --context).
test('parseArgs: --initiative is passed through as a plain string, unset when omitted', () => {
  const a = parseArgs(['req', '--initiative', 'Q1 Roadmap']);
  assert.equal(a.initiative, 'Q1 Roadmap');
  const b = parseArgs(['req']);
  assert.equal(b.initiative, undefined);
});

test('parseArgs: --size only accepts S or L', () => {
  assert.equal(parseArgs(['req', '--size', 'S']).size, 'S');
  assert.match(parseArgs(['req', '--size', 'M']).error, /--size must be S or L/);
});

test('parseArgs: --allocation only accepts ordered or balanced', () => {
  assert.equal(parseArgs(['req', '--allocation', 'balanced']).allocation, 'balanced');
  assert.match(parseArgs(['req', '--allocation', 'random']).error, /--allocation must be one of/);
});

test('parseArgs: an unknown option is rejected rather than swallowed into the request', () => {
  const a = parseArgs(['req', '--nope']);
  assert.match(a.error, /unknown option --nope/);
});

test('parseArgs: --poll-ms must be a positive number', () => {
  assert.equal(parseArgs(['req', '--poll-ms', '1500']).pollMs, 1500);
  assert.match(parseArgs(['req', '--poll-ms', '0']).error, /--poll-ms must be a positive number/);
  assert.match(parseArgs(['req', '--poll-ms', 'nope']).error, /--poll-ms must be a positive number/);
});

test('parseArgs: --json and --help are plain booleans', () => {
  assert.equal(parseArgs(['req', '--json']).json, true);
  assert.equal(parseArgs(['--help']).help, true);
});

// ---------- exitCodeForState ----------

test('exitCodeForState: complete is 0, waiting_human is 2, everything else is 1', () => {
  assert.equal(exitCodeForState('complete'), EXIT.COMPLETE);
  assert.equal(exitCodeForState('waiting_human'), EXIT.WAITING_HUMAN);
  assert.equal(exitCodeForState('blocked'), EXIT.NOT_COMPLETE);
  assert.equal(exitCodeForState('missing'), EXIT.NOT_COMPLETE);
  assert.equal(exitCodeForState(undefined), EXIT.NOT_COMPLETE);
});

// ---------- runHeadless, task layer mocked ----------

function fakeTaskLayer({ waitReplies, inboxCards = [] }) {
  const calls = [];
  let waitCall = 0;
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'tm_run') return { task_id: 'T-open', run_id: 'T-open', docs_dir: '/docs/T-open', state: 'running' };
    if (name === 'tm_wait') {
      const reply = waitReplies[Math.min(waitCall, waitReplies.length - 1)];
      waitCall += 1;
      return reply;
    }
    if (name === 'tm_inbox') return { cards: inboxCards, decided: [] };
    throw new Error(`unmocked tool ${name}`);
  };
  const mustFindTask = ({ task_id }) => ({ run_id: task_id, cwd: '/ws' });
  const docPaths = () => ({ report: '/docs/T-open/80-report.md' });
  return { deps: { callTool, mustFindTask, docPaths }, calls };
}

test('runHeadless: opens via tm_run, polls tm_wait, exits 0 complete with a report path', async () => {
  const { deps, calls } = fakeTaskLayer({
    waitReplies: [
      { state: 'running', cursor: 10, transitions: [{ node_id: 'shape', stage: 'shape', state: 'done', stage_ok: true, ts: 1 }] },
      { state: 'complete', cursor: 20, counts: { done: 4 }, transitions: [] },
    ],
  });
  const out = sink();
  const result = await runHeadless({ request: 'build it', pollMs: 10, json: false }, deps, () => false, out);
  assert.equal(result.exitCode, EXIT.COMPLETE);
  assert.equal(result.taskId, 'T-open');
  assert.equal(calls[0].name, 'tm_run');
  assert.equal(calls.filter((c) => c.name === 'tm_wait').length, 2);
  const text = out.lines.join('');
  assert.match(text, /opened T-open/);
  assert.match(text, /shape \(shape\) -> done/);
  assert.match(text, /COMPLETE/);
  assert.match(text, /80-report\.md/);
});

test('runHeadless: --initiative reaches tm_run\'s own args unchanged; omitted when not passed', async () => {
  const { deps, calls } = fakeTaskLayer({ waitReplies: [{ state: 'complete', cursor: 1, counts: {}, transitions: [] }] });
  await runHeadless({ request: 'build it', pollMs: 10, json: false, initiative: 'Q1 Roadmap' }, deps, () => false, sink());
  assert.equal(calls[0].name, 'tm_run');
  assert.equal(calls[0].args.initiative, 'Q1 Roadmap');

  const { deps: deps2, calls: calls2 } = fakeTaskLayer({ waitReplies: [{ state: 'complete', cursor: 1, counts: {}, transitions: [] }] });
  await runHeadless({ request: 'build it', pollMs: 10, json: false }, deps2, () => false, sink());
  assert.equal('initiative' in calls2[0].args, false);
});

test('runHeadless: blocked is a non-zero exit', async () => {
  const { deps } = fakeTaskLayer({
    waitReplies: [{ state: 'blocked', cursor: 5, counts: { failed: 1 }, transitions: [] }],
  });
  const result = await runHeadless({ request: 'build it', pollMs: 10, json: false }, deps, () => false, sink());
  assert.equal(result.exitCode, EXIT.NOT_COMPLETE);
});

test('runHeadless: waiting_human exits with its own distinct code and prints the pending card', async () => {
  const { deps } = fakeTaskLayer({
    waitReplies: [{ state: 'waiting_human', cursor: 7, counts: {}, transitions: [] }],
    inboxCards: [{ key: 'E-1/P1/U1', stage: 'ask', title: 'pick a plan', questions: [{ question: 'trim whitespace?' }] }],
  });
  const out = sink();
  const result = await runHeadless({ request: 'build it', pollMs: 10, json: false }, deps, () => false, out);
  assert.equal(result.exitCode, EXIT.WAITING_HUMAN);
  assert.notEqual(result.exitCode, EXIT.COMPLETE);
  assert.notEqual(result.exitCode, EXIT.NOT_COMPLETE);
  const text = out.lines.join('');
  assert.match(text, /waiting on a human/);
  assert.match(text, /pick a plan/);
  assert.match(text, /trim whitespace\?/);
});

test('runHeadless: --resume skips tm_run and waits on the given task id directly', async () => {
  const { deps, calls } = fakeTaskLayer({
    waitReplies: [{ state: 'complete', cursor: 1, counts: { done: 1 }, transitions: [] }],
  });
  const result = await runHeadless({ resume: 'T-existing', pollMs: 10, json: false }, deps, () => false, sink());
  assert.equal(result.taskId, 'T-existing');
  assert.equal(calls.some((c) => c.name === 'tm_run'), false);
  assert.equal(calls[0].name, 'tm_wait');
  assert.equal(calls[0].args.task_id, 'T-existing');
  assert.equal(result.exitCode, EXIT.COMPLETE);
});

test('runHeadless: SIGINT detaches without stopping the daemon - no further tm_wait calls, exit 130', async () => {
  const { deps, calls } = fakeTaskLayer({
    waitReplies: [{ state: 'running', cursor: 1, counts: {}, transitions: [] }],
  });
  const out = sink();
  const result = await runHeadless({ request: 'build it', pollMs: 10, json: false }, deps, () => true, out);
  assert.equal(result.exitCode, EXIT.SIGINT);
  assert.equal(calls.some((c) => c.name === 'tm_wait'), false, 'detaches before the first wait, not mid-wait');
  assert.match(out.lines.join(''), /detached - the daemon keeps driving T-open/);
  assert.match(out.lines.join(''), /--resume T-open/);
});

test('runHeadless: --json emits one JSON object per line, including a final event with the exit code', async () => {
  const { deps } = fakeTaskLayer({
    waitReplies: [{ state: 'complete', cursor: 3, counts: { done: 2 }, transitions: [] }],
  });
  const out = sink();
  const result = await runHeadless({ request: 'build it', pollMs: 10, json: true }, deps, () => false, out);
  const events = parseJsonLines(out.lines);
  assert.equal(events[0].event, 'open');
  const final = events.at(-1);
  assert.equal(final.event, 'final');
  assert.equal(final.state, 'complete');
  assert.equal(final.exit_code, result.exitCode);
  assert.equal(final.report, '/docs/T-open/80-report.md');
});
