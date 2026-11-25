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
delete process.env.TEAMS_ASK_TASK_ID; // the pane's env: no driver
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
const { peekHumanActions } = await import(join(HERE, '..', 'mcp', 'graph-runfile.mjs'));

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

// ---------- tm_answer / toolAnswer (F3-AC-19..22). The env is toolAnswer's second argument. ----------

const { toolAnswer } = await import(join(HERE, '..', 'mcp', 'storyanswer.mjs'));
const PERSON_ENV = {};
const DRIVER_ENV = { TEAMS_ASK_TASK_ID: 'the-driver-task' };

// A STORY ask by P1, forwarded to the person and waiting; P2 is a declared sibling.
async function seedStoryAsk() {
  const t = seedTask();
  const task = load(t.id);
  task.spec.packages.push({ ...task.spec.packages[0], id: 'P2', title: 'module b', touches: ['b.txt'] });
  writeFileSync(tm.taskPath(t.id), JSON.stringify(task));
  await callTool('tm_ask', { task_id: t.id, key: t.key, question: Q });
  await daemon.stepOnce(t.id, { judge: async () => { throw new Error('no judge expected'); }, answer: async () => JSON.stringify({ verdict: 'forward', reason: 'unsettled' }) });
  const card = cli('--card', '--task', t.id, '--story', 'P1').out.cards[0];
  const sibling = `E-${t.id.slice(0, 8)}/P2`;
  return { ...t, card, sibling, decisions: [{ question: Q, chose: 'cents' }] };
}
const rawLedger = (id) => readFileSync(join(tm.taskDir(id), 'ledger.jsonl'), 'utf8');

// What an answer wrote: its ledger lines without the run-varying values.
const written = (t, from) => ledger(t.id).slice(from).map((e) => {
  const { ts, since, pid, ...rest } = e;
  return JSON.stringify(rest).split(t.card.ask_id).join('ASK_ID').split(t.id).join('TASK_ID').split(t.id.slice(0, 8)).join('TASK8');
});

test('F3-AC-19: tm_answer and answer.mjs --answer leave equal ledger lines on the same fixture', async () => {
  const a = await seedStoryAsk();
  const b = await seedStoryAsk();
  const [fromA, fromB] = [ledger(a.id).length, ledger(b.id).length];
  const viaTool = await callTool('tm_answer', { task_id: a.id, key: a.card.key, decisions: a.decisions });
  assert.deepEqual(viaTool, { ok: true, key: a.card.key, node_id: a.card.node_id, state: 'done' });
  const viaCli = cli('--answer', '--task', b.id, '--key', b.card.key, '--decisions', JSON.stringify(b.decisions));
  assert.equal(viaCli.out.ok, true, JSON.stringify(viaCli.out));
  const lines = written(a, fromA);
  assert.ok(lines.some((l) => /"event":"answered".*"by":"person"|"by":"person".*"event":"answered"/.test(l)), lines.join('\n'));
  assert.deepEqual(lines, written(b, fromB));
});

test('F3-AC-20, 21: an unknown key and an answered, pending or done ask are refused in the engine\'s own words, nothing written', async () => {
  const t = await seedStoryAsk();
  const refused = (key, re) => {
    const before = rawLedger(t.id);
    const r = toolAnswer({ task_id: t.id, key, decisions: t.decisions }, PERSON_ENV);
    assert.equal(r.ok, false, key);
    assert.match(r.reason, re);
    assert.equal(rawLedger(t.id), before, `${key}: the ledger is untouched`);
  };
  refused(`E-${t.id.slice(0, 8)}/TASK/ask:nope:1`, /has no card waiting on a human/);
  refused('garbage', /TASK key/);
  refused(`E-${t.id.slice(0, 8)}/TASK/accept:P1:1`, /is pending, not waiting_human/);
  refused(`E-${t.id.slice(0, 8)}/TASK/shape`, /is done, not waiting_human/);
  assert.equal(toolAnswer({ task_id: t.id, key: t.card.key, decisions: t.decisions }, PERSON_ENV).ok, true);
  refused(t.card.key, /not waiting_human/);
  assert.match(toolAnswer({ task_id: 'no-such-task', key: t.card.key, decisions: [] }, PERSON_ENV).reason, /unknown task/);
});

test('F3-AC-22: the person is accepted, with no by or by person', async () => {
  for (const by of [undefined, '', 'person']) {
    const t = await seedStoryAsk();
    const r = toolAnswer({ task_id: t.id, key: t.card.key, decisions: t.decisions, by }, PERSON_ENV);
    assert.equal(r.ok, true, `${by}: ${r.reason}`);
  }
});

test('F3-AC-22: a driver with a sibling\'s key is accepted, in both key forms', async () => {
  for (const form of ['short', 'full']) {
    const t = await seedStoryAsk();
    const r = toolAnswer({ task_id: t.id, key: t.card.key, decisions: t.decisions, by: form === 'short' ? 'P2' : t.sibling }, DRIVER_ENV);
    assert.equal(r.ok, true, `${form}: ${r.reason}`);
    assert.equal(ledger(t.id).filter((e) => e.event === 'answered').length, 1);
  }
});

test('F3-AC-22: own ask, a driver with no by, person or teamleader, and an unknown by are refused with the ledger byte-equal', async () => {
  const t = await seedStoryAsk();
  const before = rawLedger(t.id);
  const cases = [
    ['P1', DRIVER_ENV, /may not answer its own ask/],
    [t.key, DRIVER_ENV, /may not answer its own ask/],
    ['P1', PERSON_ENV, /may not answer its own ask/],
    [undefined, DRIVER_ENV, /a driver must pass its own STORY key/],
    ['person', DRIVER_ENV, /a driver must pass its own STORY key/],
    ['teamleader', DRIVER_ENV, /a driver must pass its own STORY key/],
    ['somebody', DRIVER_ENV, /by must be person, teamleader or a STORY key/],
  ];
  for (const [by, env, re] of cases) {
    const r = toolAnswer({ task_id: t.id, key: t.card.key, decisions: t.decisions, by }, env);
    assert.equal(r.ok, false, String(by));
    assert.match(r.reason, re);
    assert.equal(rawLedger(t.id), before, `${by}: nothing written`);
  }
  assert.equal(cli('--card', '--task', t.id, '--story', 'P1').out.cards.length, 1, 'still waiting');
});

// P1's child run holds a waiting ask (ask:U1:1) its own driver raised; task also declares sibling P2.
function seedChildAsk() {
  const t = seedTask();
  const task = load(t.id);
  task.spec.packages.push({ ...task.spec.packages[0], id: 'P2', title: 'module b', touches: ['b.txt'] });
  writeFileSync(tm.taskPath(t.id), JSON.stringify(task));
  const { cwd, run_id } = task.nodes.find((n) => n.node_id === 'dispatch:P1:1').child;
  const childPath = join(cwd, '.teams_output', 'broker', 'runs', `${run_id}.json`);
  const child = JSON.parse(readFileSync(childPath, 'utf8'));
  const inv = graph.node('investigate:U1:1', 'investigate', [], { state: 'done', subgoal_id: 'U1', result: { stage_ok: true } });
  child.nodes.unshift(inv);
  graph.openAsk(child, inv, [{ question: Q, options: ['cents', 'dollars'] }]);
  writeFileSync(childPath, JSON.stringify(child));
  const snapshot = () => ({
    task: readFileSync(tm.taskPath(t.id), 'utf8'),
    ledger: existsSync(join(tm.taskDir(t.id), 'ledger.jsonl')) ? rawLedger(t.id) : '',
    child: readFileSync(childPath, 'utf8'),
    pending: peekHumanActions(cwd, run_id),
  });
  return { ...t, e: `E-${t.id.slice(0, 8)}`, snapshot, decisions: [{ question: Q, chose: 'cents' }] };
}

const assertRefused = (t, args, env, re) => {
  const before = t.snapshot();
  const r = toolAnswer({ task_id: t.id, decisions: t.decisions, ...args }, env);
  const label = `by ${args.by}, key ${args.key}`;
  assert.equal(r.ok, false, label);
  assert.match(r.reason, re, label);
  assert.deepEqual(t.snapshot(), before, `${label}: nothing written`);
};

test('F3-AC-22: a driver may not answer any card of its own STORY\'s child run, by any key or by spelling', () => {
  const t = seedChildAsk();
  assert.deepEqual(t.snapshot().pending, []);
  for (const by of ['P1', `${t.e}/P1`]) {
    for (const key of [`${t.e}/P1`, `${t.e}/P1/U1`, `${t.e}/P1/ask:U1:1`]) {
      assertRefused(t, { key, by }, DRIVER_ENV, /may not answer its own ask/);
    }
  }
});

test('F3-AC-22: a driver may not answer a manager card opened for its own package', () => {
  const t = seedChildAsk();
  const task = load(t.id);
  graph.openAsk(task, task.nodes.find((n) => n.node_id === 'accept:P1:1'), [{ question: Q, options: ['cents', 'dollars'] }]);
  writeFileSync(tm.taskPath(t.id), JSON.stringify(task));
  const ask = task.nodes.find((n) => n.stage === 'ask');
  assertRefused(t, { key: `${t.e}/TASK/${ask.node_id}`, by: 'P1' }, DRIVER_ENV, /may not answer its own ask/);
});

test('F3-AC-22: by must be a package this task has, spelled exactly, under any env', () => {
  const t = seedChildAsk();
  for (const by of ['P01', 'P001', 'P999', `${t.e}/P01`, 'E-deadbeef/P2']) {
    for (const env of [DRIVER_ENV, PERSON_ENV]) {
      assertRefused(t, { key: `${t.e}/P1/U1`, by }, env, /by must be person, teamleader or a STORY key/);
    }
  }
});

test('F3-AC-22: P01 on P1\'s own STORY ask is refused', async () => {
  const t = await seedStoryAsk();
  const before = rawLedger(t.id);
  const r = toolAnswer({ task_id: t.id, key: t.card.key, decisions: t.decisions, by: 'P01' }, DRIVER_ENV);
  assert.equal(r.ok, false);
  assert.equal(rawLedger(t.id), before);
});

test('F3-AC-22: a sibling driver and the person may answer P1\'s child card', () => {
  for (const [by, env] of [['P2', DRIVER_ENV], [undefined, PERSON_ENV], ['person', PERSON_ENV]]) {
    const t = seedChildAsk();
    const r = toolAnswer({ task_id: t.id, key: `${t.e}/P1/U1`, decisions: t.decisions, by }, env);
    assert.equal(r.ok, true, `${by}: ${r.reason}`);
    assert.equal(t.snapshot().pending.length, 1);
  }
});

test('a task with no nodes: --card and --answer report a clear reason', () => {
  const id = `no-nodes-${++seq}`;
  const path = tm.taskPath(id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ run_id: id, kind: 'task' }));
  for (const args of [['--card'], ['--answer', '--key', 'anything']]) {
    const r = cli(...args, '--task', id);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.equal(r.out.ok, false);
    assert.match(r.out.reason, /no nodes yet/);
    assert.doesNotMatch(r.out.reason, /is not iterable|Cannot read/);
  }
});
