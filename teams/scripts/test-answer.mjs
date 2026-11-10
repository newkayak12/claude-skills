// answer.mjs: the engine CLI behind the pane's answer mode (card 125 F2, F2-AC-27, 28, 29). --card returns the
// waiting ask card's own key, questions and options; --answer submits through toolSubmit (the code tm_submit runs).
// Fixtures are temp tasks roots; a stub command stands in for `claude -p` as in test-story-ask-engine.mjs.
//
//   node --test teams/scripts/test-answer.mjs

process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.HARNESS_TEST_NO_DAEMON = '1';
process.env.HARNESS_JUDGE_TIMEOUT_MS = '1500';
delete process.env.HARNESS_TEST_NO_DRIVER;
delete process.env.HARNESS_ANSWER_DRIVER;
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ANSWER = join(HERE, 'answer.mjs');
const ROOT = mkdtempSync(join(tmpdir(), 'answer-root-'));
const SCRATCH = mkdtempSync(join(tmpdir(), 'answer-scratch-'));
process.env.HARNESS_TASKS_DIR = ROOT;
writeFileSync(join(SCRATCH, 'driver.mjs'), 'setTimeout(() => {}, 3000);\n');
process.env.HARNESS_CHILD_DRIVER = `node ${join(SCRATCH, 'driver.mjs')}`;

const tm = await import(join(HERE, '..', 'mcp', 'taskmanager.mjs'));
const graph = await import(join(HERE, '..', 'mcp', 'graph.mjs'));
const daemon = await import(join(HERE, '..', 'mcp', 'daemon.mjs'));
const { callTool } = tm;

process.on('exit', () => { for (const d of [ROOT, SCRATCH]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } } });

const DEAD = 2 ** 22 + 12345;
const Q = 'Are amounts stored in cents or in dollars?';
let seq = 0;

// A size-L task past critique with STORY P1 running (a dead parked driver), as test-story-ask-engine.mjs seeds it.
function seedTask() {
  const run_id = `3c4d${String(++seq).padStart(4, '0')}-1111-2222-3333-444444444444`;
  const cwd = mkdtempSync(join(SCRATCH, 'proj-'));
  const childCwd = mkdtempSync(join(SCRATCH, 'wt-'));
  const childId = `c-${run_id.slice(0, 8)}-P1`;
  const runs = join(childCwd, '.teams_output', 'broker', 'runs');
  mkdirSync(runs, { recursive: true });
  writeFileSync(join(runs, `${childId}.json`), JSON.stringify({
    run_id: childId, flow: 'develop', max_retries: 2, cwd: childCwd, spec: { subgoals: [{ id: 'U1', title: 'unit' }] },
    nodes: [graph.node('implement:U1:1', 'implement', [], { state: 'pending', subgoal_id: 'U1' })],
  }));
  const path = tm.taskPath(run_id);
  mkdirSync(dirname(path), { recursive: true });
  const done = (id, stage, deps) => graph.node(id, stage, deps, { state: 'done', result: { stage_ok: true } });
  writeFileSync(path, JSON.stringify({
    run_id, kind: 'task', store_path: path, cwd, request: 'r', created_at: Date.now(),
    flow: 'develop', flow_chosen: 'develop', size: 'L', max_retries: 2, driver_restarts: 2,
    spec: { acceptance: ['a'], packages: [{ id: 'P1', title: 'module a', flow: 'develop', brief: 'b', acceptance: ['a'], touches: ['a.txt'], deps: [] }] },
    nodes: [done('size', 'size', []), done('shape', 'shape', ['size']), done('critique', 'critique', ['shape']),
      graph.node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', state: 'running', child: { run_id: childId, cwd: childCwd, driver: { pid: DEAD, restarts: [], started_at: Date.now() - 1000 } } }),
      graph.node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1' })],
  }, null, 2));
  return { id: run_id, key: `E-${run_id.slice(0, 8)}/P1` };
}

const load = (id) => JSON.parse(readFileSync(tm.taskPath(id), 'utf8'));
const ledger = (id) => {
  const f = join(tm.taskDir(id), 'ledger.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const cli = (...args) => {
  const r = spawnSync(process.execPath, [ANSWER, ...args], { encoding: 'utf8', env: { ...process.env } });
  return { status: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout.trim().split('\n').at(-1)) : null, stderr: r.stderr };
};

// An ordinary ask card (two questions, one with options) opened on the critique node.
function seedAsk() {
  const t = seedTask();
  const task = load(t.id);
  graph.openAsk(task, task.nodes.find((x) => x.node_id === 'critique'), [{ question: 'Which flow?', options: ['develop', 'document'] }, { question: 'Which name?', options: ['a', 'b'] }], { owner: 'EPIC', attempt: 1 });
  writeFileSync(tm.taskPath(t.id), JSON.stringify(task));
  return t;
}

test('importing taskmanager-claims.mjs for toolSubmit opens no server and the CLI exits on its own', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import { toolSubmit } from ${JSON.stringify(join(HERE, '..', 'mcp', 'taskmanager-claims.mjs'))}; process.stdout.write(typeof toolSubmit);`], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'function');
});

test('F2-AC-27: --card returns the waiting ask card\'s own key, its questions and their options', () => {
  const t = seedAsk();
  const { status, out } = cli('--card', '--task', t.id);
  assert.equal(status, 0);
  assert.equal(out.ok, true);
  assert.equal(out.cards.length, 1);
  const c = out.cards[0];
  assert.match(c.key, new RegExp(`^E-${t.id.slice(0, 8)}/TASK/ask:`));
  assert.notEqual(c.key, t.key, 'the ask card\'s key is not the STORY\'s');
  assert.deepEqual(c.questions, [{ question: 'Which flow?', options: ['develop', 'document'] }, { question: 'Which name?', options: ['a', 'b'] }]);
  assert.equal(c.ask_id, null);
  // by key, and by a STORY that has no ask card: nothing
  assert.equal(cli('--card', '--task', t.id, '--key', c.key).out.cards[0].key, c.key);
  const none = cli('--card', '--task', t.id, '--story', 'P1');
  assert.equal(none.out.ok, false);
  assert.match(none.out.reason, /no ask card waiting for P1/);
});

test('F2-AC-27, 28: --answer submits one decisions[] entry per question through toolSubmit; the card clears', () => {
  const t = seedAsk();
  const card = cli('--card', '--task', t.id).out.cards[0];
  const decisions = JSON.stringify(card.questions.map((q, i) => ({ question: q.question, chose: q.options[i] })));
  const { out } = cli('--answer', '--task', t.id, '--key', card.key, '--decisions', decisions);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.key, card.key);
  assert.equal(out.state, 'done');
  // the same record tm_submit writes
  const human = ledger(t.id).filter((e) => e.event === 'tm_submit_human');
  assert.equal(human.length, 1);
  assert.equal(human[0].key, card.key);
  // nothing waits any more
  assert.equal(cli('--card', '--task', t.id).out.ok, false);
  const node = load(t.id).nodes.find((n) => n.node_id === card.node_id);
  assert.deepEqual(node.result.decisions.map((d) => d.chose), ['develop', 'b']);
});

test('F2-AC-29: an ask card without a decisions array is refused with the engine\'s own reason, and stays waiting', () => {
  const t = seedAsk();
  const card = cli('--card', '--task', t.id).out.cards[0];
  for (const extra of [[], ['--decisions', '"just text"'], ['--decisions', '{"a":1}']]) {
    const { out } = cli('--answer', '--task', t.id, '--key', card.key, ...extra);
    assert.equal(out.ok, false);
    assert.match(out.reason, /payload needs decisions\[\]/);
  }
  assert.equal(cli('--answer', '--task', t.id, '--key', card.key, '--decisions', '{oops').out.reason, '--decisions is not valid JSON');
  assert.equal(cli('--card', '--task', t.id).out.cards.length, 1, 'the card is still waiting');
  assert.equal(ledger(t.id).filter((e) => e.event === 'tm_submit_human').length, 0);
});

test('F2-AC-29: an empty chose on a STORY ask is refused, nothing is written, and the draft can be sent again', async () => {
  const t = seedTask();
  await callTool('tm_ask', { task_id: t.id, key: t.key, question: Q });
  await daemon.stepOnce(t.id, { judge: async () => { throw new Error('no judge expected'); }, answer: async () => JSON.stringify({ verdict: 'forward', reason: 'unsettled' }) });
  const found = cli('--card', '--task', t.id, '--story', 'P1');
  assert.equal(found.out.ok, true, JSON.stringify(found.out));
  const card = found.out.cards[0];
  assert.equal(card.story_key, t.key);
  assert.ok(card.ask_id);
  assert.deepEqual(card.questions.map((q) => q.question), [Q]);
  const refused = cli('--answer', '--task', t.id, '--key', card.key, '--decisions', JSON.stringify([{ question: Q, chose: '  ' }]));
  assert.equal(refused.out.ok, false);
  assert.match(refused.out.reason, /STORY's question: its answer needs text/);
  assert.equal(ledger(t.id).filter((e) => e.event === 'answered').length, 0);
  assert.equal(cli('--card', '--task', t.id, '--story', 'P1').out.cards.length, 1, 'still waiting');
  // the draft, sent again with text, is accepted and records the answer
  const ok = cli('--answer', '--task', t.id, '--key', card.key, '--decisions', JSON.stringify([{ question: Q, chose: 'cents' }]));
  assert.equal(ok.out.ok, true, JSON.stringify(ok.out));
  assert.equal(ledger(t.id).filter((e) => e.event === 'answered').length, 1);
});

test('an unknown card, an unknown task and a missing flag are refused or reported, never thrown', () => {
  const t = seedAsk();
  assert.equal(cli('--answer', '--task', t.id, '--key', `E-${t.id.slice(0, 8)}/TASK/ask:nope:1`, '--decisions', '[]').out.ok, false);
  assert.match(cli('--answer', '--task', t.id, '--key', 'garbage', '--decisions', '[]').out.reason, /TASK key/);
  const unknown = cli('--card', '--task', 'no-such-task');
  assert.equal(unknown.out.ok, false);
  assert.equal(cli('--card', '--task', t.id, '--key', 'E-x/TASK/ask:zz:1').out.ok, false);
  assert.equal(cli('--card').status, 2);
  assert.equal(cli('--task', t.id).status, 2);
  assert.equal(cli('--answer', '--task', t.id).status, 2);
});
