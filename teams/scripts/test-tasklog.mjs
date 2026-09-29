#!/usr/bin/env node
// test-tasklog.mjs - tm_log: follow one ticket's log (design §8, v0.13.0 plan Task 6).
//
// A STORY key tails its latest dispatch's child.driver.log (stream-json) as readable lines; an
// EPIC key tails the task ledger. Only the last `tail` lines come back - read from the file's
// end, never the whole file - and `since` (a byte cursor) returns only what was appended.
//
//   node --test teams/scripts/test-tasklog.mjs

process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.TEAMS_VIEW = '0';
process.env.HARNESS_TEST_NO_DRIVER = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'tm-log-root-'));
process.env.HARNESS_TASKS_DIR = ROOT;
const { readLogTail, renderStreamLine, renderLedgerLine, clampTail, LOG_TAIL_MAX } = await import(join(HERE, '..', 'mcp', 'tasklog.mjs'));
const { callTool } = await import(join(HERE, '..', 'mcp', 'taskmanager.mjs'));

process.on('exit', () => { try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* best-effort */ } });

const RUN = 'abcdef12-0000-0000-0000-000000000000';
const TD = join(ROOT, RUN);
const DRIVERS = join(TD, 'drivers');
const P1_LOG = join(DRIVERS, 'dispatch_P1_1.restart1.stream.jsonl');

const ev = (o) => JSON.stringify(o) + '\n';
mkdirSync(DRIVERS, { recursive: true });
writeFileSync(join(TD, 'task.json'), JSON.stringify({
  run_id: RUN, cwd: ROOT, size: 'L', request: 'r',
  spec: { packages: [{ id: 'P1', title: 'one' }, { id: 'P2', title: 'two' }] },
  nodes: [
    { node_id: 'dispatch:P1:1', stage: 'dispatch', subgoal_id: 'P1', state: 'running',
      child: { cwd: ROOT, run_id: 'c1', driver: { pid: null, log: join(DRIVERS, 'dispatch_P1_1.stream.jsonl') } } },
    // A retried dispatch: tm_log must follow the latest attempt's driver, not the first.
    { node_id: 'dispatch:P1:2', stage: 'dispatch', subgoal_id: 'P1', state: 'running',
      child: { cwd: ROOT, run_id: 'c2', driver: { pid: null, log: P1_LOG } } },
  ],
}));
writeFileSync(join(DRIVERS, 'dispatch_P1_1.stream.jsonl'), ev({ type: 'system', subtype: 'init', model: 'old' }));
writeFileSync(P1_LOG, [
  ev({ type: 'system', subtype: 'init', model: 'claude-x', session_id: '1234567890ab', cwd: '/w' }),
  ...Array.from({ length: 200 }, (_, i) => ev({ type: 'assistant', message: { content: [{ type: 'text', text: `step ${i}` }] } })),
  ev({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } }),
  ev({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: [{ type: 'text', text: '1 failing' }] }] } }),
  ev({ type: 'result', subtype: 'success', num_turns: 7, total_cost_usd: 0.5, result: 'done' }),
].join(''));
writeFileSync(join(TD, 'ledger.jsonl'), [
  ev({ ts: Date.UTC(2026, 8, 28, 1, 2, 3), event: 'tm_open', task_id: RUN }),
  ev({ ts: Date.UTC(2026, 8, 28, 1, 2, 4), event: 'node_finish', task_id: RUN, stage: 'shape', node_id: 'shape', state: 'done' }),
].join(''));

test('a STORY key tails its latest dispatch driver as readable lines, last N only', async () => {
  const r = await callTool('tm_log', { key: 'E-abcdef12/P1', tail: 3 });
  assert.equal(r.kind, 'STORY');
  assert.equal(r.source, 'driver');
  assert.equal(r.key, 'E-abcdef12/P1');
  assert.equal(r.node_id, 'dispatch:P1:2');
  assert.equal(r.log, P1_LOG);
  assert.equal(r.count, 3);
  assert.equal(r.truncated, true);
  assert.deepEqual(r.lines, [
    'assistant -> Bash npm test',
    '<- ERROR 1 failing',
    'result success turns=7 cost=$0.5000: done',
  ]);
  const def = await callTool('tm_log', { key: 'E-abcdef12/P1' });
  assert.equal(def.count, 50, 'default tail is 50');
});

test('since: the previous cursor returns only lines appended after it; a half-written line waits', async () => {
  const first = await callTool('tm_log', { key: 'E-abcdef12/P1', tail: 1 });
  const again = await callTool('tm_log', { key: 'E-abcdef12/P1', since: first.cursor });
  assert.deepEqual(again.lines, []);
  assert.equal(again.cursor, first.cursor);
  appendFileSync(P1_LOG, ev({ type: 'assistant', message: { content: [{ type: 'text', text: 'more' }] } }) + '{"type":"assi');
  const next = await callTool('tm_log', { key: 'E-abcdef12/P1', since: first.cursor });
  assert.deepEqual(next.lines, ['assistant says: more']);
  assert.equal(next.truncated, false);
  appendFileSync(P1_LOG, 'stant","message":{"content":[{"type":"text","text":"tail"}]}}\n');
  const last = await callTool('tm_log', { key: 'E-abcdef12/P1', since: next.cursor });
  assert.deepEqual(last.lines, ['assistant says: tail'], 'the split line is returned whole once finished');
});

test('raw:true returns the exact NDJSON lines', async () => {
  const r = await callTool('tm_log', { key: 'E-abcdef12/P1', tail: 1, raw: true });
  assert.equal(JSON.parse(r.lines[0]).type, 'assistant');
});

test('an EPIC key tails the ledger, one "HH:MM:SS event k=v" line per record', async () => {
  const r = await callTool('tm_log', { key: 'E-abcdef12' });
  assert.equal(r.kind, 'EPIC');
  assert.equal(r.source, 'ledger');
  assert.deepEqual(r.lines, ['01:02:03 tm_open', '01:02:04 node_finish node_id=shape stage=shape state=done']);
});

test('a STORY with no dispatch yet is an empty reply with a note, not an error', async () => {
  const r = await callTool('tm_log', { key: 'E-abcdef12/P2' });
  assert.deepEqual(r.lines, []);
  assert.equal(r.log, null);
  assert.match(r.note, /no driver has started/);
});

test('unknown package, unknown EPIC and TASK keys are refused with a reason', async () => {
  await assert.rejects(() => callTool('tm_log', { key: 'E-abcdef12/P9' }), /no package P9/);
  await assert.rejects(() => callTool('tm_log', { key: 'E-ffffffff' }), /no EPIC starting with ffffffff/);
  await assert.rejects(() => callTool('tm_log', { key: 'E-abcdef12/P1/U1' }), /does not follow a TASK key/);
});

test('readLogTail reads from the end in chunks: a big file, a small tail, and a missing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tm-log-tail-'));
  try {
    const p = join(dir, 'big.log');
    // ~1.3 MB, many 64 KiB chunks, with multi-byte characters straddling chunk boundaries.
    writeFileSync(p, Array.from({ length: 20000 }, (_, i) => `line ${i} 한글 ${'x'.repeat(50)}`).join('\n') + '\n');
    const r = readLogTail(p, 2);
    assert.deepEqual(r.lines.map((l) => l.split(' ')[1]), ['19998', '19999']);
    assert.equal(r.cursor, r.size);
    assert.equal(r.truncated, true);
    const whole = readLogTail(p, 100000);
    assert.equal(whole.lines.length, 20000);
    assert.equal(whole.lines[0].split(' ')[1], '0');
    assert.equal(whole.truncated, false);
    const gone = readLogTail(join(dir, 'nope'), 5);
    assert.equal(gone.missing, true);
    assert.deepEqual(gone.lines, []);
    // A cursor past the end (the file was replaced) starts over rather than returning nothing.
    const small = join(dir, 'small.log');
    writeFileSync(small, 'a\nb\n');
    assert.deepEqual(readLogTail(small, 10, 999).lines, ['a', 'b']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renderers never throw: non-JSON, unknown types, rate limits, init', () => {
  assert.equal(renderStreamLine('panic: boom'), 'panic: boom');
  assert.equal(renderStreamLine(JSON.stringify({ type: 'stream_event', subtype: 'x' })), 'stream_event x');
  assert.equal(renderStreamLine(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', rateLimitType: 'five_hour' } })), 'rate_limit allowed_warning five_hour');
  assert.equal(renderStreamLine(JSON.stringify({ type: 'system', subtype: 'init', model: 'm', session_id: 'abcdefghij' })), 'init model=m session=abcdefgh');
  assert.match(renderStreamLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'y'.repeat(1000) }] } })), /\.\.\.$/);
  assert.equal(renderLedgerLine('not json'), 'not json');
  assert.equal(clampTail(undefined), 50);
  assert.equal(clampTail(0), 50);
  assert.equal(clampTail(10 ** 6), LOG_TAIL_MAX);
});

// Lines shaped exactly like portfolio-consolidate-8518d5dd's real driver streams (teams 0.35.1):
// a usage-limit death is a result with subtype "success" AND is_error true - it rendered
// "result success ERROR ..." - and ~1250 of that run's ~3500 lines were subagent/background
// events that rendered as bare "system task_progress" / "tool_progress" with nothing to read.
test('real driver stream shapes: an errored result, subagent progress and heartbeats read as what happened', () => {
  const r = (o) => renderStreamLine(JSON.stringify(o));
  assert.equal(r({ type: 'result', subtype: 'success', is_error: true, num_turns: 1, total_cost_usd: 0, result: "You've hit your session limit · resets 4:50am (UTC)" }),
    "result ERROR turns=1 cost=$0.0000: You've hit your session limit · resets 4:50am (UTC)");
  assert.equal(r({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 50 }), 'result ERROR error_max_turns turns=50');
  assert.equal(r({ type: 'result', subtype: 'success', num_turns: 13, total_cost_usd: 3.592, result: 'ok' }), 'result success turns=13 cost=$3.5920: ok');
  assert.equal(r({ type: 'system', subtype: 'task_started', task_id: 'a8ff34dbe9d2f73e0', description: 'Run test:U1:2 node', subagent_type: 'general-purpose' }),
    'subagent a8ff34db started: Run test:U1:2 node');
  assert.equal(r({ type: 'system', subtype: 'task_progress', task_id: 'a8ff34dbe9d2f73e0', description: 'Reading briefings/test_U1_2.md', usage: { tool_uses: 1 }, last_tool_name: 'Read' }),
    'subagent a8ff34db: Reading briefings/test_U1_2.md');
  assert.equal(r({ type: 'system', subtype: 'task_updated', task_id: 'ac552d32594eaafb2', patch: { status: 'completed', end_time: 1 } }), 'subagent ac552d32 completed');
  assert.equal(r({ type: 'system', subtype: 'task_notification', task_id: 'ac552d32594eaafb2', status: 'completed', summary: '**Top 1** 핀테크\n- x' }),
    'subagent ac552d32 completed: **Top 1** 핀테크 - x');
  assert.equal(r({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 252, estimated_tokens_delta: 202 }), 'thinking ~252 tokens');
  assert.equal(r({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ description: 'JD mode run: new fit' }, { description: 'No-JD run' }] }),
    'background tasks (2): JD mode run: new fit; No-JD run');
  assert.equal(r({ type: 'system', subtype: 'background_tasks_changed', tasks: [] }), 'background tasks (0)');
  assert.equal(r({ type: 'tool_progress', tool_name: 'Agent', elapsed_time_seconds: 90, heartbeat: true }), 'tool_progress Agent 90s');
  assert.equal(r({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'teams:orchestrate' } }] } }), 'assistant -> Skill teams:orchestrate');
  assert.equal(r({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: 1790589000, rateLimitType: 'five_hour' } }), 'rate_limit allowed five_hour');
  assert.equal(r({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1790589000, rateLimitType: 'five_hour' } }),
    `rate_limit rejected five_hour resets=${new Date(1790589000 * 1000).toISOString().slice(11, 16)}Z`);
});
