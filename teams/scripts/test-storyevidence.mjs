#!/usr/bin/env node
// test-storyevidence.mjs - storyevidence.mjs: the engine answers an evidence ask itself, and leaves
// it to the answer node when it is not one or a source cannot be read. Fake ledger, cost and
// process sources in a temp HARNESS_TASKS_DIR; no model, no driver, no real ps.
//
//   node --test teams/scripts/test-storyevidence.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const ROOT = mkdtempSync(join(tmpdir(), 'story-evidence-'));
process.env.HARNESS_TASKS_DIR = ROOT;
process.env.TEAMS_RUNS_DIR = 'off';
process.env.HARNESS_TEST_NO_DAEMON = '1';
process.env.HARNESS_TEST_NO_DRIVER = '1';
process.on('exit', () => { try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* best-effort */ } });

const { selfAnswerStoryAsks } = await import('../mcp/storyevidence.mjs');
const tm = await import('../mcp/taskmanager.mjs');
const graph = await import('../mcp/graph.mjs');

const Q = {
  process_count: 'P1 needs the count of mcp/server.mjs processes now.',
  ledger_lines: 'P1 needs the bus_message ledger lines verbatim from ledger.jsonl.',
  cost_by_stage: 'Please give me the live by_stage cost so far.',
};
const BUS_LINE = '{"ts":1795490820889,"event":"bus_message","body":"  probe, verbatim  "}';
const PS = [
  '  PID COMMAND',
  '  101 node /repo/teams/mcp/server.mjs --root /other/project --token=SENTINEL',
  '  102 /opt/n/bin/node /home/u/.claude/plugins/cache/m/teams/0.65.0/mcp/server.mjs',
  '  103 node /repo/graph/mcp/server.mjs',
  '  104 claude -p --mcp-config {"args":["/repo/teams/mcp/server.mjs"]} run node /repo/teams/mcp/server.mjs',
].join('\n');
const FAKE = {
  processes: () => PS,
  cost: () => ({ spend: 1.5, estimated: false, live: { streams: [{ stream: 'dispatch_P1.stream.jsonl', cost_usd: 1.5 }] } }),
};
const dead = () => false;

let seq = 0;
function seed(question) {
  const run_id = `5e1f${String(++seq).padStart(4, '0')}-1111-2222-3333-444444444444`;
  const path = tm.taskPath(run_id);
  mkdirSync(dirname(path), { recursive: true });
  const key = `E-${run_id.slice(0, 8)}/P1`;
  writeFileSync(path, JSON.stringify({
    run_id, kind: 'task', store_path: path, cwd: ROOT, request: 'r', flow: 'develop', size: 'L',
    spec: { acceptance: ['a'], packages: [] },
    nodes: [graph.node('dispatch:P1:1', 'dispatch', [], { subgoal_id: 'P1', state: 'running', child: { run_id: 'c', cwd: ROOT } })],
    story_asks: [{ ask_id: `ask-${seq}`, key, pkg: 'P1', node_id: 'dispatch:P1:1', question, state: 'pending', at: Date.now() }],
  }));
  appendFileSync(join(tm.taskDir(run_id), 'ledger.jsonl'), `${BUS_LINE}\n{"ts":2,"event":"other"}\n{"torn\n`);
  return run_id;
}
const load = (id) => JSON.parse(readFileSync(tm.taskPath(id), 'utf8'));
const events = (id) => {
  const f = join(tm.taskDir(id), 'ledger.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
};
const answered = (id) => events(id).filter((e) => e.event === 'answered');

function forwarded(id) {
  assert.equal(load(id).story_asks[0].state, 'pending', 'left unclaimed for the answer node');
  assert.deepEqual(events(id).map((e) => e.event), ['bus_message', 'other'], 'nothing was written');
}

const expected = {
  process_count: [/processes on this machine: 2$/],
  ledger_lines: [/ledger\.jsonl lines \(verbatim\): 1\n/],
  cost_by_stage: [/dispatch_package: 1\.5/, /spend: 1\.5/],
};
for (const [kind, patterns] of Object.entries(expected)) {
  test(`a ${kind} ask is answered by the engine as teamleader, route answer`, () => {
    const id = seed(Q[kind]);
    assert.equal(selfAnswerStoryAsks(id, dead, FAKE), true);
    const [e] = answered(id);
    assert.equal(answered(id).length, 1);
    assert.equal(e.by, 'teamleader');
    assert.equal(e.route, 'answer');
    for (const re of patterns) assert.match(e.answer, re);
    // No command text from the process listing, in the answer or in anything stored for the task.
    const commandText = /SENTINEL|\/other\/project|server\.mjs (?:--|run)|\/repo\/|\/opt\/n\/|claude -p/;
    assert.doesNotMatch(e.answer, commandText);
    assert.doesNotMatch(JSON.stringify([load(id), events(id)]), commandText);
    if (kind === 'ledger_lines') assert.ok(e.answer.split('\n').includes(BUS_LINE), 'the line is verbatim');
    assert.notEqual(load(id).story_asks[0].state, 'pending');
    assert.equal(selfAnswerStoryAsks(id, dead, FAKE), false, 'answered once');
  });
}

test('the default ledger reader reads the task ledger', () => {
  const id = seed(Q.ledger_lines);
  assert.equal(selfAnswerStoryAsks(id, dead), true);
  assert.ok(answered(id)[0].answer.includes(BUS_LINE));
});

test('a question that is not classified is left for the answer node and nothing is read', () => {
  const id = seed('cost by stage is high - should we drop the review stage?');
  const boom = () => { throw new Error('must not be read'); };
  assert.equal(selfAnswerStoryAsks(id, dead, { processes: boom, ledger: boom, cost: boom }), false);
  forwarded(id);
});

const fail = () => { throw new Error('unreadable'); };
for (const [name, question, readers] of [
  ['the process listing fails', Q.process_count, { processes: fail }],
  ['the ledger is missing', Q.ledger_lines, { ledger: () => readFileSync(join(ROOT, 'no-such', 'ledger.jsonl'), 'utf8') }],
  ['taskFigure throws', Q.cost_by_stage, { cost: fail }],
  ['one source of two fails', `${Q.process_count} ${Q.cost_by_stage}`, { cost: fail }],
  ['a named ledger line is not there', 'Send me the bus_message and cost_recorded ledger lines.', {}],
  ['no ledger line is named', 'Send me the ledger lines.', {}],
  ['a named ts is not there', 'Send me the ledger lines ts 1111111111111.', {}],
]) {
  test(`forwarded when ${name}`, () => {
    const id = seed(question);
    assert.equal(selfAnswerStoryAsks(id, dead, { ...FAKE, ...readers }), false);
    forwarded(id);
  });
}

test('self-answering and forwarding place no hold and write no hold event', () => {
  for (const q of [Q.cost_by_stage, 'Which flow should we use?']) {
    const id = seed(q);
    selfAnswerStoryAsks(id, dead, FAKE);
    assert.equal('hold' in load(id), false);
    assert.deepEqual(events(id).filter((e) => /^task_/.test(e.event)), []);
  }
});
