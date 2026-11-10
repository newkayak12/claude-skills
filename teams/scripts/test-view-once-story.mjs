// `view.mjs --once --format story|story-report --text`: the same facts as the payloads, as text for a client with
// no pane (F2-AC-49). The labels in the JSON payloads are keys and numbers; the text is English, as the engine writes it.
//
//   node --test teams/scripts/test-view-once-story.mjs
process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.TZ = 'UTC';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { node } from '../mcp/graph.mjs';

const VIEW = join(dirname(fileURLToPath(import.meta.url)), 'view.mjs');
const write = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };

function fixture({ done = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'view-once-story-'));
  const tasks = join(root, 'tasks');
  const id = 'aaaaaaaa-0001';
  const dir = join(tasks, id);
  const cwd = join(root, 'proj');
  const cdir = join(root, 'wt');
  mkdirSync(cwd, { recursive: true });
  write(join(cdir, '.teams_output', 'broker', 'runs', 'c-P1.json'), JSON.stringify({
    run_id: 'c-P1', flow: 'develop', max_retries: 2, spec: { subgoals: [{ id: 'U1', title: 'unit' }] },
    nodes: [node('plan', 'plan', [], { state: 'done' }), node('implement:U1:1', 'implement', ['plan'], { state: 'running', subgoal_id: 'U1', executor: 'claude', model: 'opus' }),
      node('gate:U1:1', 'gate', ['implement:U1:1'], { state: 'pending', subgoal_id: 'U1' })],
  }));
  const child = { run_id: 'c-P1', cwd: cdir, driver: { pid: process.pid, log: join(dir, 'drivers', 'dispatch_P1_1.stream.jsonl'), restarts: [] } };
  write(join(dir, 'task.json'), JSON.stringify({
    run_id: id, kind: 'task', cwd, request: 'r', created_at: Date.now(), store_path: join(dir, 'task.json'),
    spec: { packages: [{ id: 'P1', title: 'story P1', deps: [] }] },
    nodes: [node('size', 'size', [], { state: 'done' }), node('shape', 'shape', ['size'], { state: 'done' }), node('critique', 'critique', ['shape'], { state: 'done' }),
      node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', state: done ? 'done' : 'running', child }),
      node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1', state: done ? 'done' : 'pending', ...(done ? { result: { accept: true, match_pct: 90, reason: 'ok' } } : {}) })],
  }));
  return { tasks, id, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const once = (f, format, ...more) => {
  const r = spawnSync(process.execPath, [VIEW, '--once', '--format', format, '--tasks-dir', f.tasks, '--task', f.id, '--story', 'P1', ...more], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};

test('F2-AC-49: --format story --text prints the FLOW, node progress, participants and grid as one line each', () => {
  const f = fixture();
  try {
    const out = once(f, 'story', '--text');
    const lines = out.trimEnd().split('\n');
    assert.match(lines[0], /^\S+\s+story P1\s+running/);
    assert.equal(lines[1], 'flow: plan:done setgoal:pending critique:pending implement:running test:pending gate:pending');
    assert.equal(lines[2], 'nodes: this try 1/3 · total 1/3');
    assert.match(lines[3], /^participants \(nodes\): total 1 claude\/opus · live 1 claude\/opus$/);
    assert.match(lines[4], /^attempt 1: plan:done setgoal:- critique:- implement:running test:- gate:pending$/);
    assert.ok(lines.some((l) => /^worker P1: \w+( \d+m)?$/.test(l)), out);
    // the JSON of the same call carries keys and numbers, never a sentence
    const p = JSON.parse(once(f, 'story'));
    assert.deepEqual(p.flow.map((x) => x.key), ['plan', 'setgoal', 'critique', 'implement', 'test', 'gate']);
    assert.equal(p.progress.try_total, 3);
  } finally { f.cleanup(); }
});

test('F2-AC-49: --format story-report --text is the report as written once finished, else the "not available" line', () => {
  const open = fixture();
  try { assert.equal(once(open, 'story-report', '--text'), 'P1: not available yet (appears after the gate passes)\n'); } finally { open.cleanup(); }
  const f = fixture({ done: true });
  try {
    const out = once(f, 'story-report', '--text');
    assert.match(out, /P1/);
    assert.equal(JSON.parse(once(f, 'story-report')).text.trimEnd(), out.trimEnd());
  } finally { f.cleanup(); }
});

test('the usage line names --story and the two formats', () => {
  const r = spawnSync(process.execPath, [VIEW, '--help'], { encoding: 'utf8' });
  assert.match(r.stdout, /story\|story-report --task <id> --story <Pn>/);
});
