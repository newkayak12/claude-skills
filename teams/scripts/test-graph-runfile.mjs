// graph-runfile.mjs: run files on disk, the transaction rule of saveRun, and the human-action queue.
//   node --test teams/scripts/test-graph-runfile.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  queueHumanAction, peekHumanActions, drainHumanActions, pathOf, saveRun, loadRunAt, loadRun, findRun, listRuns,
} from '../mcp/graph-runfile.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'graph-runfile-'));
const mkRun = (cwd, id, extra = {}) => ({ run_id: id, cwd, nodes: [{ node_id: 'plan', state: 'pending' }], ...extra });

test('pathOf: <cwd>/.teams_output/broker/runs/<id>.json, or the run\'s own store_path', () => {
  assert.equal(pathOf({ cwd: '/p', run_id: 'r1' }), join('/p', '.teams_output', 'broker', 'runs', 'r1.json'));
  assert.equal(pathOf({ cwd: '/p', run_id: 'r1', store_path: '/x/task.json' }), '/x/task.json');
});

test('saveRun writes a child run, loadRun / loadRunAt / findRun / listRuns read it back', () => {
  const cwd = tmp();
  try {
    const run = saveRun(mkRun(cwd, 'r1'));
    assert.ok(existsSync(pathOf(run)));
    assert.equal(loadRun(cwd, 'r1').run_id, 'r1');
    assert.equal(loadRunAt(pathOf(run)).nodes.length, 1);
    assert.equal(loadRun(cwd, 'missing'), null);
    assert.equal(loadRunAt(join(cwd, 'nope.json')), null);
    assert.equal(findRun('r1', [null, join(cwd, 'elsewhere'), cwd]).run_id, 'r1');
    assert.equal(findRun('r1', [join(cwd, 'elsewhere')]), null);
    saveRun(mkRun(cwd, 'r2'));
    assert.deepEqual(listRuns(cwd).map((r) => r.run_id).sort(), ['r1', 'r2']);
    assert.deepEqual(listRuns(join(cwd, 'no-such-dir')), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('saveRun merges onto the disk copy: a node another broker finished is not rolled back to pending', () => {
  const cwd = tmp();
  try {
    const mine = saveRun(mkRun(cwd, 'r1', { nodes: [{ node_id: 'a', state: 'pending' }, { node_id: 'b', state: 'pending' }] }));
    // another broker finishes `a` on disk
    const onDisk = loadRun(cwd, 'r1');
    onDisk.nodes[0].state = 'done';
    writeFileSync(pathOf(mine), JSON.stringify(onDisk));
    mine.nodes[1].state = 'running';
    saveRun(mine);
    const after = loadRun(cwd, 'r1');
    assert.equal(after.nodes.find((n) => n.node_id === 'a').state, 'done', 'the finished node survives');
    assert.equal(after.nodes.find((n) => n.node_id === 'b').state, 'running', 'my own change lands');
    assert.equal(mine.nodes.find((n) => n.node_id === 'a').state, 'done', 'the caller\'s object is made consistent');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('saveRun merges capacity: the higher epoch wins, equal epochs union', () => {
  const cwd = tmp();
  try {
    const run = saveRun(mkRun(cwd, 'r1', { capacity_epoch: 1, unavailable_vendors: { a: 1 } }));
    const disk = loadRun(cwd, 'r1');
    disk.capacity_epoch = 1; disk.unavailable_vendors = { a: 1, b: 2 };
    writeFileSync(pathOf(run), JSON.stringify(disk));
    run.unavailable_vendors = { c: 3 };
    saveRun(run);
    assert.deepEqual(loadRun(cwd, 'r1').unavailable_vendors, { a: 1, b: 2, c: 3 });
    const disk2 = loadRun(cwd, 'r1');
    disk2.capacity_epoch = 5; disk2.unavailable_vendors = { z: 9 };
    writeFileSync(pathOf(run), JSON.stringify(disk2));
    run.capacity_epoch = 2; run.unavailable_vendors = { y: 1 };
    saveRun(run);
    assert.equal(loadRun(cwd, 'r1').capacity_epoch, 5);
    assert.deepEqual(loadRun(cwd, 'r1').unavailable_vendors, { z: 9 });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('saveRun refuses a task (store_path) written outside mutateTask', () => {
  const cwd = tmp();
  try {
    assert.throws(() => saveRun({ run_id: 't', cwd, store_path: join(cwd, 'task.json'), nodes: [] }), /outside mutateTask/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('human-action queue: queue appends, peek reads without deleting, drain reads then removes', () => {
  const cwd = tmp();
  try {
    assert.deepEqual(peekHumanActions(cwd, 'r1'), []);
    assert.deepEqual(drainHumanActions(cwd, 'r1'), [], 'draining an empty queue is a no-op');
    queueHumanAction(cwd, 'r1', { subgoal_id: 'U1', to: 'human' });
    queueHumanAction(cwd, 'r1', { subgoal_id: 'U2', to: 'auto' });
    assert.equal(peekHumanActions(cwd, 'r1').length, 2);
    assert.equal(peekHumanActions(cwd, 'r1').length, 2, 'peek does not consume');
    const file = join(cwd, '.teams_output', 'broker', 'handoffs', 'r1.json');
    assert.ok(existsSync(file));
    assert.deepEqual(drainHumanActions(cwd, 'r1').map((a) => a.subgoal_id), ['U1', 'U2']);
    assert.ok(!existsSync(file), 'the queue file is gone after a drain');
    assert.deepEqual(drainHumanActions(cwd, 'r1'), [], 'an action is never applied twice');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('a corrupt queue file reads as empty rather than throwing', () => {
  const cwd = tmp();
  try {
    const dir = join(cwd, '.teams_output', 'broker', 'handoffs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'r1.json'), '{not json');
    assert.deepEqual(peekHumanActions(cwd, 'r1'), []);
    queueHumanAction(cwd, 'r1', { x: 1 });
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'r1.json'), 'utf8')), [{ x: 1 }]);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
