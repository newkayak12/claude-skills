// test-run.mjs - teams/scripts/run.mjs, the headless "teams run" CLI (§4-C of _repo/docs/plans/
// 2026-09-21-teams-server-owns-the-loop.md).
//
// Every test here mocks the task layer (`deps.callTool`, and where needed `mustFindTask`/
// `docPaths`) - none of it spawns a real daemon, a real driver, or `claude`. That is exactly
// what run.mjs was built to let a caller reuse (tm_run's open+spawn, tm_wait's poll loop)
// without duplicating; these tests stand in for the task layer entirely so they stay fast and
// hermetic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs, exitCodeForState, runHeadless, EXIT, keepAwakeArgv,
  isLimitNotice, limitResumeAt, findLimitNotices, sleepUntil, RESET_GRACE_MS,
} from './run.mjs';

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

test('exitCodeForState: complete is 0, waiting_human is 2, partial is 3, everything else is 1', () => {
  assert.equal(exitCodeForState('complete'), EXIT.COMPLETE);
  assert.equal(exitCodeForState('partial'), EXIT.PARTIAL);
  assert.equal(EXIT.PARTIAL, 3);
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

// ---------- --resume-on-limit (ported from scripts/bench/drive.sh) ----------
//
// Every test below runs on a fake clock: `deps.now` reads it and `deps.sleep` advances it, so a
// five-hour reset costs nothing and the order of sleeps is observable.

function fakeClock(start) {
  const c = { t: start, sleeps: [] };
  c.now = () => c.t;
  c.sleep = async (ms) => { c.sleeps.push(ms); c.t += ms; };
  return c;
}

test('parseArgs: --resume-on-limit is off by default; --max-resumes defaults to 6 and must be a non-negative integer', () => {
  const a = parseArgs(['req']);
  assert.equal(a.resumeOnLimit, false);
  assert.equal(a.maxResumes, 6);
  const b = parseArgs(['--resume', 'T1', '--resume-on-limit', '--max-resumes', '2']);
  assert.equal(b.resumeOnLimit, true);
  assert.equal(b.maxResumes, 2);
  assert.equal(parseArgs(['req', '--max-resumes', '0']).maxResumes, 0);
  assert.match(parseArgs(['req', '--max-resumes', '-1']).error, /--max-resumes/);
  assert.match(parseArgs(['req', '--max-resumes', '1.5']).error, /--max-resumes/);
});

test('isLimitNotice: every window a limit names counts - session, usage, weekly, 5-hour - and codex\'s wording', () => {
  for (const t of [
    "You've hit your session limit · resets 5:40pm (UTC)",
    "You've hit your usage limit. Upgrade to Pro or try again at 4:21 AM.",
    "You've hit your weekly limit · resets Oct 1, 9am (UTC)",
    "You've hit your 5-hour limit · resets 11:50pm (Asia/Seoul)",
    "You've hit your limit",
    'usage_limit_reached',
  ]) assert.equal(isLimitNotice(t), true, t);
  for (const t of ['', 'tests failed: 3 of 12', 'rate_limit_error unit test failed', null, undefined]) {
    assert.equal(isLimitNotice(t), false, String(t));
  }
});

test('limitResumeAt: the named reset in its own zone, plus the 3-minute grace', () => {
  const since = Date.parse('2026-09-24T10:00:00Z');
  assert.equal(limitResumeAt("You've hit your session limit · resets 5:40pm (UTC)", since),
    Date.parse('2026-09-24T17:40:00Z') + RESET_GRACE_MS);
  // 11:50pm in Seoul (UTC+9) is 14:50 UTC the same day.
  assert.equal(limitResumeAt("You've hit your 5-hour limit · resets 11:50pm (Asia/Seoul)", since),
    Date.parse('2026-09-24T14:50:00Z') + RESET_GRACE_MS);
  // Minutes are optional ("resets 3pm").
  assert.equal(limitResumeAt('resets 3pm (UTC)', since), Date.parse('2026-09-24T15:00:00Z') + RESET_GRACE_MS);
});

test('limitResumeAt: a clock time already behind `since` is tomorrow\'s (a 23:55 notice saying 4:50am)', () => {
  const since = Date.parse('2026-09-24T23:55:00Z');
  assert.equal(limitResumeAt('resets 4:50am (UTC)', since), Date.parse('2026-09-25T04:50:00Z') + RESET_GRACE_MS);
});

test('limitResumeAt: no parseable time falls back to 30 minutes after the hit, as drive.sh did', () => {
  const since = Date.parse('2026-09-24T10:00:00Z');
  assert.equal(limitResumeAt("You've hit your limit", since), since + 30 * 60 * 1000 + RESET_GRACE_MS);
});

test('findLimitNotices: parked drivers (size-S and package) whatever their text; failed nodes only on limit wording', () => {
  const task = {
    harness_run: { waiting_capacity: { reason: 'codex credit spent', since: 5 } },
    nodes: [
      { node_id: 'dispatch:P1:1', stage: 'dispatch', subgoal_id: 'P1', state: 'running', child: { waiting_capacity: { reason: 'resets 3pm (UTC)', since: 6 } } },
      { node_id: 'dispatch:P2:1', stage: 'dispatch', subgoal_id: 'P2', state: 'failed', finished_at: 7, result: { stage_ok: false, reason: "driver died: You've hit your weekly limit" } },
      { node_id: 'dispatch:P3:1', stage: 'dispatch', subgoal_id: 'P3', state: 'failed', finished_at: 8, result: { stage_ok: false, reason: 'tests failed' } },
      { node_id: 'integrate:1', stage: 'integrate', state: 'failed', finished_at: 9, result: { stage_ok: false, judge_failed: true, reason: "raw: You've hit your session limit · resets 5:40pm (UTC)" } },
    ],
  };
  const got = findLimitNotices(task);
  assert.deepEqual(got.map((x) => [x.package_id ?? x.node_id, !!x.parked]), [
    ['S', true], ['P1', true], ['P2', false], ['integrate:1', false],
  ]);
  assert.equal(got.find((x) => x.package_id === 'P2').since, 7);
  assert.deepEqual(findLimitNotices({ nodes: [{ node_id: 'x', state: 'failed', result: { reason: 'boom' } }] }), []);
  assert.deepEqual(findLimitNotices(null), []);
});

test('findLimitNotices: one notice per package - the newest failed attempt, and a parked one over a failed one', () => {
  const got = findLimitNotices({ nodes: [
    { node_id: 'dispatch:P1:1', stage: 'dispatch', subgoal_id: 'P1', state: 'failed', finished_at: 1, result: { reason: 'usage limit, resets 1pm (UTC)' } },
    { node_id: 'dispatch:P1:2', stage: 'dispatch', subgoal_id: 'P1', state: 'failed', finished_at: 2, result: { reason: 'usage limit, resets 2pm (UTC)' } },
    { node_id: 'dispatch:P2:1', stage: 'dispatch', subgoal_id: 'P2', state: 'failed', finished_at: 3, result: { reason: 'session limit' } },
    { node_id: 'dispatch:P2:2', stage: 'dispatch', subgoal_id: 'P2', state: 'running', child: { waiting_capacity: { reason: 'parked', since: 1 } } },
  ] });
  assert.equal(got.length, 2);
  assert.match(got.find((x) => x.package_id === 'P1').reason, /2pm/);
  assert.equal(got.find((x) => x.package_id === 'P2').parked, true);
});

test('sleepUntil: steps of at most a minute against the clock, and stops when told to', async () => {
  const c = fakeClock(0);
  assert.equal(await sleepUntil(150000, { now: c.now, sleep: c.sleep }), true);
  assert.deepEqual(c.sleeps, [60000, 60000, 30000]);
  const d = fakeClock(0);
  assert.equal(await sleepUntil(-1, { now: d.now, sleep: d.sleep }), true);
  assert.deepEqual(d.sleeps, [], 'a time already passed does not sleep at all');
  let n = 0;
  const e = fakeClock(0);
  assert.equal(await sleepUntil(10 * 60000, { now: e.now, sleep: e.sleep, shouldStop: () => ++n > 2 }), false);
  assert.equal(e.sleeps.length, 2);
});

// A task layer whose tm_wait replies come in rounds: each tm_retry that resumes something moves
// to the next round. `tasks[round]` is what mustFindTask hands back after that round settles.
function limitTaskLayer({ rounds, tasks, retry }) {
  const calls = [];
  let round = 0;
  let inRound = 0;
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'tm_run') return { task_id: 'T-open', docs_dir: '/docs/T-open' };
    if (name === 'tm_wait') {
      const list = rounds[Math.min(round, rounds.length - 1)];
      const reply = list[Math.min(inRound, list.length - 1)];
      inRound += 1;
      return reply;
    }
    if (name === 'tm_retry') {
      const r = retry(args, round);
      if (r && r.retried) { round += 1; inRound = 0; }
      return r;
    }
    if (name === 'tm_inbox') return { cards: [] };
    throw new Error(`unmocked tool ${name}`);
  };
  const mustFindTask = () => tasks[Math.min(round, tasks.length - 1)];
  const docPaths = () => ({ report: '/docs/T-open/80-report.md' });
  return { deps: { callTool, mustFindTask, docPaths }, calls };
}

const T0 = Date.parse('2026-09-24T10:00:00Z');
const BLOCKED = { state: 'blocked', cursor: 5, counts: { failed: 1 }, transitions: [] };
const COMPLETE = { state: 'complete', cursor: 9, counts: { done: 3 }, transitions: [] };

test('resume-on-limit: a size-S run parked on "resets 11:50pm (Asia/Seoul)" sleeps to the reset + grace, reset_capacity, then completes', async () => {
  const hit = Date.parse('2026-09-24T12:00:00Z'); // 21:00 in Seoul
  const clock = fakeClock(hit + 1000);
  const parked = { harness_run: { waiting_capacity: { reason: "You've hit your 5-hour limit · resets 11:50pm (Asia/Seoul)", since: hit } }, nodes: [] };
  const { deps, calls } = limitTaskLayer({
    rounds: [[BLOCKED], [COMPLETE]],
    tasks: [parked, { nodes: [] }],
    retry: (args) => (args.reset_capacity ? { retried: true, resumed: ['S'] } : { retried: false }),
  });
  const out = sink();
  const result = await runHeadless({ request: 'build it', pollMs: 10, json: true, resumeOnLimit: true, maxResumes: 6 },
    { ...deps, now: clock.now, sleep: clock.sleep }, () => false, out);
  assert.equal(result.exitCode, EXIT.COMPLETE);
  assert.equal(result.resumes, 1);
  assert.equal(clock.t, Date.parse('2026-09-24T14:50:00Z') + RESET_GRACE_MS, 'woke exactly at the reset plus grace');
  assert.ok(clock.sleeps.every((ms) => ms <= 60000), 'slept in minute steps');
  const retry = calls.find((c) => c.name === 'tm_retry');
  assert.deepEqual(retry.args, { task_id: 'T-open', reset_capacity: true });
  // tm_wait resumes from the cursor it had, not from zero.
  const waits = calls.filter((c) => c.name === 'tm_wait');
  assert.equal(waits[1].args.cursor, 5);
  const events = parseJsonLines(out.lines);
  const limit = events.find((e) => e.event === 'limit');
  assert.equal(limit.resume_at, new Date(Date.parse('2026-09-24T14:50:00Z') + RESET_GRACE_MS).toISOString());
  assert.ok(events.some((e) => e.event === 'limit_resumed' && e.resume === 1));
  assert.equal(events.at(-1).limit_resumes, 1);
});

test('resume-on-limit: a package folded failed on a limit is retried by package_id; a stale reset resumes without sleeping', async () => {
  const hit = Date.parse('2026-09-24T12:00:00Z');
  const clock = fakeClock(hit + 6 * 3600 * 1000); // read long after the 1pm reset
  const failed = { nodes: [{ node_id: 'dispatch:P2:1', stage: 'dispatch', subgoal_id: 'P2', state: 'failed', finished_at: hit,
    result: { stage_ok: false, reason: "You've hit your session limit · resets 1pm (UTC)" } }] };
  const { deps, calls } = limitTaskLayer({
    rounds: [[BLOCKED], [COMPLETE]],
    tasks: [failed, { nodes: [] }],
    retry: (args) => (args.package_id === 'P2' ? { retried: true, attempt: 2 } : { retried: false }),
  });
  const result = await runHeadless({ resume: 'T-x', pollMs: 10, json: false, resumeOnLimit: true, maxResumes: 6 },
    { ...deps, now: clock.now, sleep: clock.sleep }, () => false, sink());
  assert.equal(result.exitCode, EXIT.COMPLETE);
  assert.deepEqual(clock.sleeps, []);
  assert.deepEqual(calls.filter((c) => c.name === 'tm_retry').map((c) => c.args), [{ task_id: 'T-x', package_id: 'P2' }],
    'no reset_capacity call when nothing is parked');
});

test('resume-on-limit: off by default - a limit-blocked task exits 1 with no wait and no retry', async () => {
  const clock = fakeClock(T0);
  const { deps, calls } = limitTaskLayer({
    rounds: [[BLOCKED]],
    tasks: [{ harness_run: { waiting_capacity: { reason: 'resets 3pm (UTC)', since: T0 } }, nodes: [] }],
    retry: () => { throw new Error('must not retry'); },
  });
  const result = await runHeadless({ request: 'build it', pollMs: 10, json: false }, { ...deps, now: clock.now, sleep: clock.sleep }, () => false, sink());
  assert.equal(result.exitCode, EXIT.NOT_COMPLETE);
  assert.equal(calls.some((c) => c.name === 'tm_retry'), false);
  assert.deepEqual(clock.sleeps, []);
});

test('resume-on-limit: a blocked task with no limit in it stays blocked - no wait, no retry', async () => {
  const clock = fakeClock(T0);
  const { deps, calls } = limitTaskLayer({
    rounds: [[BLOCKED]],
    tasks: [{ nodes: [{ node_id: 'dispatch:P1:1', stage: 'dispatch', subgoal_id: 'P1', state: 'failed', result: { reason: 'tests failed' } }] }],
    retry: () => { throw new Error('must not retry'); },
  });
  const result = await runHeadless({ request: 'r', pollMs: 10, json: false, resumeOnLimit: true, maxResumes: 6 },
    { ...deps, now: clock.now, sleep: clock.sleep }, () => false, sink());
  assert.equal(result.exitCode, EXIT.NOT_COMPLETE);
  assert.equal(calls.some((c) => c.name === 'tm_retry'), false);
});

test('resume-on-limit: gives up after --max-resumes and exits 1', async () => {
  const clock = fakeClock(T0);
  const parked = { harness_run: { waiting_capacity: { reason: "You've hit your limit", since: T0 } }, nodes: [] };
  const { deps, calls } = limitTaskLayer({
    rounds: [[BLOCKED]], // every round blocks on the limit again
    tasks: [parked],
    retry: () => ({ retried: true, resumed: ['S'] }),
  });
  const out = sink();
  const result = await runHeadless({ request: 'r', pollMs: 10, json: true, resumeOnLimit: true, maxResumes: 2 },
    { ...deps, now: clock.now, sleep: clock.sleep }, () => false, out);
  assert.equal(result.exitCode, EXIT.NOT_COMPLETE);
  assert.equal(result.resumes, 2);
  assert.equal(calls.filter((c) => c.name === 'tm_retry').length, 2);
  const events = parseJsonLines(out.lines);
  assert.match(events.find((e) => e.event === 'limit_gave_up').reason, /--max-resumes 2/);
});

test('resume-on-limit: gives up when the limit has no resume route (a manager judge) or tm_retry resumes nothing', async () => {
  const clock = fakeClock(T0);
  const judge = { nodes: [{ node_id: 'integrate:1', stage: 'integrate', state: 'failed', finished_at: T0, result: { judge_failed: true, reason: "You've hit your session limit" } }] };
  const one = limitTaskLayer({ rounds: [[BLOCKED]], tasks: [judge], retry: () => { throw new Error('must not retry'); } });
  const out1 = sink();
  const r1 = await runHeadless({ request: 'r', pollMs: 10, json: true, resumeOnLimit: true, maxResumes: 6 },
    { ...one.deps, now: clock.now, sleep: clock.sleep }, () => false, out1);
  assert.equal(r1.exitCode, EXIT.NOT_COMPLETE);
  assert.deepEqual(clock.sleeps, [], 'no point sleeping for something that cannot be resumed');
  assert.match(parseJsonLines(out1.lines).find((e) => e.event === 'limit_gave_up').reason, /no resume route for integrate:1/);

  const parked = { harness_run: { waiting_capacity: { reason: "You've hit your limit", since: T0 } }, nodes: [] };
  const two = limitTaskLayer({ rounds: [[BLOCKED]], tasks: [parked], retry: () => ({ retried: false, resumed: [] }) });
  const out2 = sink();
  const r2 = await runHeadless({ request: 'r', pollMs: 10, json: true, resumeOnLimit: true, maxResumes: 6 },
    { ...two.deps, now: clock.now, sleep: clock.sleep }, () => false, out2);
  assert.equal(r2.exitCode, EXIT.NOT_COMPLETE);
  assert.match(parseJsonLines(out2.lines).find((e) => e.event === 'limit_gave_up').reason, /resumed nothing/);
});

test('resume-on-limit: SIGINT during the reset wait detaches with 130 and says the task is still blocked', async () => {
  const clock = fakeClock(T0);
  const parked = { harness_run: { waiting_capacity: { reason: 'resets 3pm (UTC)', since: T0 } }, nodes: [] };
  const { deps, calls } = limitTaskLayer({ rounds: [[BLOCKED]], tasks: [parked], retry: () => { throw new Error('must not retry'); } });
  let stop = false;
  const sleep = async (ms) => { clock.t += ms; stop = true; };
  const out = sink();
  const result = await runHeadless({ request: 'r', pollMs: 10, json: false, resumeOnLimit: true, maxResumes: 6 },
    { ...deps, now: clock.now, sleep }, () => stop, out);
  assert.equal(result.exitCode, EXIT.SIGINT);
  assert.equal(calls.some((c) => c.name === 'tm_retry'), false);
  assert.match(out.lines.join(''), /waiting out a usage limit/);
  assert.match(out.lines.join(''), /--resume T-open --resume-on-limit/);
});

test('keepAwakeArgv: caffeinate waits on this pid on darwin, nothing elsewhere', () => {
  assert.deepEqual(keepAwakeArgv('darwin', 123), ['caffeinate', ['-i', '-w', '123']]);
  assert.equal(keepAwakeArgv('linux', 123), null);
});
