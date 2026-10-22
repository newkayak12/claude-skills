#!/usr/bin/env node
// test-story-ask-engine.mjs - card 49 part C, engine side: tm_ask parks a running STORY's driver,
// a fresh answer node answers from the plan and wiki or forwards, and the forwarded question is an
// ask card a person answers with tm_submit. Event shapes, the answer prompt, parseVerdict and
// validateAsk are storyask.mjs's (test-story-ask.mjs); this file runs them through the real
// engine: tm_ask, daemon.stepOnce, tm_inbox, tm_submit, serviceDeadDriver and the real driver
// respawn (a stub command stands in for `claude -p`, as HARNESS_CHILD_DRIVER does everywhere).
//
// The answer node is never a live model here: stepOnce takes it as `answer` (the injection seam),
// and answerNode itself is driven through HARNESS_ANSWER_DRIVER (a stub command).
//
//   node --test teams/scripts/test-story-ask-engine.mjs

process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.TEAMS_VIEW = '0';
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
const ROOT = mkdtempSync(join(tmpdir(), 'story-ask-root-'));
const SCRATCH = mkdtempSync(join(tmpdir(), 'story-ask-scratch-'));
const STUB_LOG = join(SCRATCH, 'driver-calls.jsonl');
process.env.HARNESS_TASKS_DIR = ROOT;
process.env.STUB_LOG = STUB_LOG;
writeFileSync(join(SCRATCH, 'driver.mjs'), "import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.STUB_LOG, JSON.stringify({ argv: process.argv.slice(2) }) + '\\n');\nsetTimeout(() => {}, 3000); // a resumed driver keeps working: it is not a dead run to restart\n");
process.env.HARNESS_CHILD_DRIVER = `node ${join(SCRATCH, 'driver.mjs')}`;

const tm = await import(join(HERE, '..', 'mcp', 'taskmanager.mjs'));
const graph = await import(join(HERE, '..', 'mcp', 'graph.mjs'));
const daemon = await import(join(HERE, '..', 'mcp', 'daemon.mjs'));
const { callTool } = tm;

process.on('exit', () => { for (const d of [ROOT, SCRATCH]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } } });

const DEAD = 2 ** 22 + 12345;
const Q = 'Are amounts stored in cents or in dollars?';
let seq = 0;

// A size-L task past critique with STORY P1 running: its dispatch node, a child run file whose
// driver pid is dead (a parked driver has exited), accept waiting behind it.
function seedTask({ dispatchState = 'running', opener, extra = {} } = {}) {
  const run_id = `1a2b${String(++seq).padStart(4, '0')}-1111-2222-3333-444444444444`;
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
    ...(opener ? { opener } : {}),
    spec: { acceptance: ['a'], packages: [{ id: 'P1', title: 'module a', flow: 'develop', brief: 'b', acceptance: ['a'], touches: ['a.txt'], deps: [] }] },
    nodes: [done('size', 'size', []), done('shape', 'shape', ['size']), done('critique', 'critique', ['shape']),
      graph.node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', state: dispatchState, child: { run_id: childId, cwd: childCwd, driver: { pid: DEAD, restarts: [], started_at: Date.now() - 1000 } } }),
      graph.node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1' })],
    ...extra,
  }, null, 2));
  return { id: run_id, key: `E-${run_id.slice(0, 8)}/P1`, node: 'dispatch:P1:1', childCwd, childId };
}

const load = (id) => JSON.parse(readFileSync(tm.taskPath(id), 'utf8'));
const ledger = (id) => {
  const f = join(tm.taskDir(id), 'ledger.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const events = (id, ev) => ledger(id).filter((e) => e.event === ev);
const driverCalls = () => (existsSync(STUB_LOG) ? readFileSync(STUB_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(50); }
  return fn();
}
const ask = (t, question = Q, key = t.key) => callTool('tm_ask', { task_id: t.id, key, question });
const step = (t, answer) => daemon.stepOnce(t.id, { judge: async () => { throw new Error('no judge expected'); }, answer });
const verdict = (v) => async () => JSON.stringify(v);

// ---------- (1) tm_ask: schema, refusals, the park ----------

test('tm_ask is registered with exactly task_id, key and question - no sibling or driver field', async () => {
  const listed = await new Promise((resolve) => {
    const r = spawnSync(process.execPath, [join(HERE, '..', 'mcp', 'taskmanager.mjs')], {
      input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n', encoding: 'utf8', env: { ...process.env },
    });
    resolve(JSON.parse(r.stdout.trim().split('\n')[0]).result.tools);
  });
  const t = listed.find((x) => x.name === 'tm_ask');
  assert.ok(t, 'tm_ask is in tools/list');
  assert.deepEqual(Object.keys(t.inputSchema.properties).sort(), ['key', 'question', 'task_id']);
  assert.deepEqual([...t.inputSchema.required].sort(), ['key', 'question', 'task_id']);
});

test('refusals: empty question, EPIC key, TASK key, foreign epic, non-running STORY - each with a reason and no asked written', async () => {
  const t = seedTask();
  const done = seedTask({ dispatchState: 'done' });
  const cases = [
    [t, '   ', t.key, /question is empty/],
    [t, Q, t.key.split('/')[0], /not a STORY key/],
    [t, Q, `${t.key}/U1`, /not a STORY key/],
    [t, Q, 'E-deadbeef/P1', /not a STORY of this task/],
    [t, Q, `${t.key.split('/')[0]}/P9`, /no STORY P9/],
    [done, Q, done.key, /not running/],
  ];
  for (const [task, q, key, why] of cases) {
    await assert.rejects(() => ask(task, q, key), why, `${key} / ${JSON.stringify(q)}`);
    assert.equal(events(task.id, 'asked').length, 0, 'a refusal writes no asked');
    assert.equal((load(task.id).story_asks || []).length, 0, 'a refusal parks nothing');
  }
});

test('a valid call writes asked (verbatim, with a fresh ask_id) and parks the driver: no respawn, no restart spent, not settled', async () => {
  const t = seedTask();
  const before = driverCalls().length;
  const q = `  ${Q}\nsecond line  `;
  const out = await ask(t, q);
  const asked = events(t.id, 'asked');
  assert.equal(asked.length, 1);
  assert.deepEqual({ ...asked[0], at: undefined, ts: undefined }, { ...{ event: 'asked', task_id: t.id, key: t.key, node_id: t.node, question: q, ask_id: out.ask_id }, at: undefined, ts: undefined });
  assert.match(out.ask_id, /^[0-9a-f-]{36}$/);
  // The driver is dead (a parked driver has exited) and the child run is still `running`: the
  // restart path would respawn it; a parked STORY must not be.
  const task = load(t.id);
  const n = task.nodes.find((x) => x.node_id === t.node);
  assert.equal(tm.serviceDeadDriver(task, n.child, n.node_id), false, 'serviceDeadDriver leaves a parked STORY alone');
  assert.equal(tm.dispatchSettled(task, n), false, 'a parked STORY is not settled, so the daemon does not fold it blocked');
  assert.deepEqual(n.child.driver.restarts, []);
  assert.equal(driverCalls().length, before, 'no driver was spawned');
});

test('no cap and no de-dupe: two tm_ask calls from one key write two asked events with different ask_ids', async () => {
  const t = seedTask();
  const a = await ask(t);
  const b = await ask(t);
  assert.notEqual(a.ask_id, b.ask_id);
  assert.deepEqual(events(t.id, 'asked').map((e) => e.ask_id), [a.ask_id, b.ask_id]);
});

// ---------- (2) route answer ----------

test('route answer: one asked and one answered (teamleader, answer) with the same ask_id, no ask card, tm_inbox unchanged, driver resumed with the answer', async () => {
  const t = seedTask();
  const inboxBefore = await callTool('tm_inbox', { task_id: t.id });
  const calls0 = driverCalls().length;
  const { ask_id } = await ask(t);
  let seen = null;
  await step(t, async (task, a) => { seen = { question: a.question, ask_id: a.ask_id }; return JSON.stringify({ verdict: 'answer', answer: 'yes, cents' }); });
  assert.deepEqual(seen, { question: Q, ask_id }, 'the answer node was handed the question verbatim');
  const asked = events(t.id, 'asked');
  const answered = events(t.id, 'answered');
  assert.equal(asked.length, 1);
  assert.equal(answered.length, 1);
  assert.deepEqual({ ...answered[0], at: undefined, ts: undefined }, { event: 'answered', task_id: t.id, key: t.key, node_id: t.node, answer: 'yes, cents', by: 'teamleader', route: 'answer', ask_id, at: undefined, ts: undefined });
  assert.equal(answered[0].ask_id, asked[0].ask_id);
  assert.deepEqual(await callTool('tm_inbox', { task_id: t.id }), inboxBefore, 'no ask card was created');
  assert.ok(!load(t.id).nodes.some((x) => x.stage === 'ask'));
  assert.ok(await until(() => driverCalls().length > calls0), 'the parked driver was resumed');
  const call = driverCalls().at(-1);
  const prompt = call.argv.at(-1);
  assert.match(prompt, /yes, cents/);
  assert.ok(prompt.includes(ask_id));
  assert.ok(prompt.includes(Q));
  assert.deepEqual(load(t.id).nodes.find((x) => x.node_id === t.node).child.driver.restarts, [], 'a resume with an answer spends no restart');
  assert.equal(events(t.id, 'child_driver_restarted').at(-1).reason, 'story_answered');
});

test('the answer node is dispatched once: a second step does not re-run it, and a resumed driver is not respawned again', async () => {
  const t = seedTask();
  await ask(t);
  let runs = 0;
  const answer = async () => { runs += 1; return JSON.stringify({ verdict: 'answer', answer: 'cents' }); };
  const calls0 = driverCalls().length;
  await step(t, answer);
  assert.ok(await until(() => driverCalls().length > calls0), 'the driver was resumed');
  const calls = driverCalls().length;
  await step(t, answer);
  await step(t, answer);
  assert.equal(runs, 1);
  assert.equal(events(t.id, 'answered').length, 1);
  await sleep(200);
  assert.equal(driverCalls().length, calls, 'the answer was delivered once');
});

test('an answered question whose driver is still alive is delivered once it exits (no answer lost)', async () => {
  const t = seedTask();
  await ask(t);
  const task0 = load(t.id);
  task0.nodes.find((x) => x.node_id === t.node).child.driver.pid = process.pid; // alive: has not exited yet
  writeFileSync(tm.taskPath(t.id), JSON.stringify(task0));
  const calls = driverCalls().length;
  await step(t, verdict({ verdict: 'answer', answer: 'cents' }));
  assert.equal(events(t.id, 'answered').length, 1);
  assert.equal(driverCalls().length, calls, 'not spawned over a live driver');
  const task1 = load(t.id);
  task1.nodes.find((x) => x.node_id === t.node).child.driver.pid = DEAD; // it exited
  writeFileSync(tm.taskPath(t.id), JSON.stringify(task1));
  await step(t, verdict({ verdict: 'answer', answer: 'unused' }));
  assert.ok(await until(() => driverCalls().length > calls), 'delivered on the tick after it exited');
  assert.match(driverCalls().at(-1).argv.at(-1), /cents/);
});

// ---------- (3) route forward and the submit pairing ----------

for (const [name, answerFn] of [
  ['a forward verdict', verdict({ verdict: 'forward', reason: 'the plan does not say' })],
  ['a crash (the answer node throws)', async () => { throw new Error('spawn failed'); }],
  ['a timeout (the adapter result)', async () => ({ timedOut: true })],
  ['garbage instead of a verdict', async () => 'I think it is cents'],
]) {
  test(`route forward on ${name}: an ask card in tm_inbox with the question, no answered, the driver stays parked, ask_timeout null`, async () => {
    const t = seedTask({ extra: { ask_timeout: 1000 } });
    const calls0 = driverCalls().length;
    const { ask_id } = await ask(t);
    await step(t, answerFn);
    assert.equal(events(t.id, 'answered').length, 0, 'forward writes no answered');
    const { cards } = await callTool('tm_inbox', { task_id: t.id });
    assert.equal(cards.length, 1);
    const card = cards[0];
    assert.equal(card.stage, 'ask');
    assert.equal(card.ask_id, ask_id);
    assert.equal(card.story_key, t.key);
    assert.equal(card.questions[0].question, Q);
    assert.equal(card.key, `${t.key.split('/')[0]}/TASK/${card.node_id}`);
    assert.equal(card.expires_at, undefined, 'a STORY question never expires');
    const node = load(t.id).nodes.find((x) => x.node_id === card.node_id);
    assert.equal(node.state, 'waiting_human');
    assert.equal(node.ask_id, ask_id);
    assert.equal(node.ask_owner, 'story-P1');
    // no deadline, even past the configured ask_timeout (task.ask_timeout = 1000): wait forever
    assert.deepEqual(tm.expireAsks(load(t.id), Date.now() + 10 ** 9), []);
    assert.equal(tm.nextAskDeadline(load(t.id)), null);
    assert.equal(load(t.id).nodes.find((x) => x.node_id === card.node_id).state, 'waiting_human');
    // the driver stays parked, however many ticks pass
    await step(t, async () => { throw new Error('must not run again'); });
    await sleep(150);
    assert.equal(driverCalls().length, calls0);
    const task = load(t.id);
    const n = task.nodes.find((x) => x.node_id === t.node);
    assert.equal(tm.serviceDeadDriver(task, n.child, n.node_id), false);
    assert.equal(tm.dispatchSettled(task, n), false);
    assert.equal(events(t.id, 'story_ask_forwarded').length, 1);
  });
}

test('tm_submit on the forwarded card writes answered (person, forward, same ask_id), resumes the parked driver, and tm_submit_human carries the ask_id', async () => {
  const t = seedTask();
  const calls0 = driverCalls().length;
  const { ask_id } = await ask(t);
  await step(t, verdict({ verdict: 'forward', reason: 'unsettled' }));
  const { cards } = await callTool('tm_inbox', { task_id: t.id });
  const out = await callTool('tm_submit', { task_id: t.id, key: cards[0].key, payload: { decisions: [{ question: Q, chose: 'cents, as integers' }] } });
  assert.equal(out.state, 'done');
  const answered = events(t.id, 'answered');
  assert.equal(answered.length, 1);
  assert.deepEqual({ ...answered[0], at: undefined, ts: undefined }, { event: 'answered', task_id: t.id, key: t.key, node_id: t.node, answer: 'cents, as integers', by: 'person', route: 'forward', ask_id, at: undefined, ts: undefined });
  const human = events(t.id, 'tm_submit_human');
  assert.equal(human.length, 1);
  assert.equal(human[0].ask_id, ask_id);
  assert.ok(await until(() => driverCalls().length > calls0), 'the parked driver was resumed');
  const prompt = driverCalls().at(-1).argv.at(-1);
  assert.match(prompt, /cents, as integers/);
  assert.ok(prompt.includes(ask_id));
  assert.deepEqual((await callTool('tm_inbox', { task_id: t.id })).cards, [], 'the card is answered');
  assert.equal(events(t.id, 'asked').length, 1);
});

test('a person answer with no text is refused: the card stays waiting and nothing is written', async () => {
  const t = seedTask();
  await ask(t);
  await step(t, verdict({ verdict: 'forward', reason: 'x' }));
  const { cards } = await callTool('tm_inbox', { task_id: t.id });
  await assert.rejects(() => callTool('tm_submit', { task_id: t.id, key: cards[0].key, payload: { decisions: [{ question: Q, chose: '  ' }] } }), /answer/);
  assert.equal(events(t.id, 'answered').length, 0);
  assert.equal((await callTool('tm_inbox', { task_id: t.id })).cards.length, 1);
});

test('an ordinary ask card keeps its tm_submit path: no answered, no ask_id on its tm_submit_human', async () => {
  const t = seedTask();
  const task = load(t.id);
  const dispatchNode = task.nodes.find((x) => x.node_id === 'critique');
  graph.openAsk(task, dispatchNode, [{ question: 'Which flow?', options: ['a', 'b'] }], { owner: 'EPIC', attempt: 1 });
  writeFileSync(tm.taskPath(t.id), JSON.stringify(task));
  const { cards } = await callTool('tm_inbox', { task_id: t.id });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].ask_id, undefined);
  await callTool('tm_submit', { task_id: t.id, key: cards[0].key, payload: { decisions: [{ question: 'Which flow?', chose: 'a' }] } });
  assert.equal(events(t.id, 'answered').length, 0);
  assert.equal('ask_id' in events(t.id, 'tm_submit_human')[0], false);
});

// ---------- (4) the answer node: limits, tools, the seam ----------

test('answerArgv: read tools only (Read, Grep, Glob, wiki_search, wiki_get), the other servers denied, and HARNESS_ANSWER_DRIVER replaces the whole line', () => {
  const argv = daemon.answerArgv({ stage_skills: null });
  assert.equal(argv[0], 'claude');
  assert.ok(argv.includes('-p'));
  assert.ok(argv.includes('--tools=Read,Grep,Glob'), '--tools in its `=` form: the variadic flag must not swallow the prompt');
  const denied = argv.find((x) => x.startsWith('--disallowedTools=')).slice('--disallowedTools='.length);
  for (const d of ['mcp__plugin_teams_task-manager', 'mcp__plugin_teams_teams-engineering', 'mcp__plugin_teams_teams-wiki__wiki_write', 'mcp__plugin_teams_teams-wiki__wiki_propose', 'mcp__plugin_teams_teams-wiki__wiki_accept']) {
    assert.ok(denied.split(/[ ,]/).includes(d), `${d} is denied`);
  }
  assert.ok(!/wiki_search|wiki_get/.test(denied), 'the two wiki read tools are not denied');
  process.env.HARNESS_ANSWER_DRIVER = 'node /x/stub.mjs a';
  try { assert.deepEqual(daemon.answerArgv({}), ['node', '/x/stub.mjs', 'a']); } finally { delete process.env.HARNESS_ANSWER_DRIVER; }
});

function stubAnswer(body) {
  const f = join(SCRATCH, `answer-${++seq}.mjs`);
  writeFileSync(f, body);
  return `node ${f}`;
}
const resultLine = (text) => `console.log(JSON.stringify({ type: 'result', result: ${JSON.stringify(text)} }));\n`;

test('answerNode through a stub command: an answer verdict is read from the result event; a crash, empty output and a timeout all become a forward', async () => {
  const task = load(seedTask().id);
  const a = { ask_id: 'x', key: 'E-1/P1', node_id: 'dispatch:P1:1', question: Q };
  const run = async (body) => {
    process.env.HARNESS_ANSWER_DRIVER = stubAnswer(body);
    try { return (await import(join(HERE, '..', 'mcp', 'storyask.mjs'))).parseVerdict(await daemon.answerNode(task, a)); } finally { delete process.env.HARNESS_ANSWER_DRIVER; }
  };
  assert.deepEqual(await run(resultLine('{"verdict":"answer","answer":"yes, cents (PRD section 3)"}')), { verdict: 'answer', answer: 'yes, cents (PRD section 3)' });
  assert.equal((await run(resultLine('{"verdict":"forward","reason":"not in the plan"}'))).verdict, 'forward');
  assert.equal((await run('process.exit(3);\n')).verdict, 'forward', 'a crash forwards');
  assert.equal((await run('console.log("");\n')).verdict, 'forward', 'empty output forwards');
  const t0 = Date.now();
  assert.equal((await run('setTimeout(() => {}, 20000);\n')).verdict, 'forward', 'a timeout forwards');
  assert.ok(Date.now() - t0 < 12000, 'killed at the judge limit, not left running');
});

test('answerNode is handed the prompt: the question verbatim, the plan path and the wiki hint', async () => {
  const task = load(seedTask().id);
  const out = join(SCRATCH, 'prompt.txt');
  process.env.HARNESS_ANSWER_DRIVER = stubAnswer(`import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(out)}, process.argv.at(-1));\nconsole.log(JSON.stringify({ type: 'result', result: '{"verdict":"forward","reason":"r"}' }));\n`);
  try { await daemon.answerNode(task, { ask_id: 'x', key: 'k', node_id: 'n', question: Q }); } finally { delete process.env.HARNESS_ANSWER_DRIVER; }
  const prompt = readFileSync(out, 'utf8');
  assert.ok(prompt.includes(Q));
  assert.ok(prompt.includes(task.cwd), 'the plan pointer is under the task docs dir');
  assert.match(prompt, /wiki_search/);
});

// ---------- (5) headless: nothing is pushed to an unattached person; the card is still in tm_inbox ----------

const ASKMSG = join(HERE, 'ask-message.mjs');
function plan(env) {
  const sessions = join(SCRATCH, 'sessions');
  mkdirSync(sessions, { recursive: true });
  const r = spawnSync(process.execPath, [ASKMSG, '--send-plan', '--self', 'drv-9'], {
    encoding: 'utf8', env: { ...process.env, TEAMS_RUNS_DIR: 'off', HARNESS_TASKS_DIR: ROOT, TEAMS_SESSIONS_DIR: sessions, TEAMS_OPENER_SESSION_ID: '', TEAMS_TASK_ID: '', ...env },
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
const session = (over = {}) => {
  const dir = join(SCRATCH, 'sessions');
  mkdirSync(dir, { recursive: true });
  for (const f of ['live.json', 'dead.json']) rmSync(join(dir, f), { force: true });
  writeFileSync(join(dir, over.pid === DEAD ? 'dead.json' : 'live.json'), JSON.stringify({ pid: process.pid, sessionId: 's-1', kind: 'interactive', ...over }));
};

for (const route of ['answer', 'forward']) {
  test(`unattached, route ${route}, fully headless: --send-plan prints [] for no opener id, an sdk-kind session and a dead pid`, async () => {
    const t = seedTask({ opener: { session_id: 's-1', entrypoint: 'cli' } });
    await ask(t);
    await step(t, route === 'answer' ? verdict({ verdict: 'answer', answer: 'cents' }) : verdict({ verdict: 'forward', reason: 'r' }));
    const cards = (await callTool('tm_inbox', { task_id: t.id })).cards;
    assert.equal(cards.length, route === 'forward' ? 1 : 0);
    if (route === 'forward') assert.equal(cards[0].questions[0].question, Q);
    const env = { TEAMS_OPENER_SESSION_ID: 's-1', TEAMS_TASK_ID: t.id };
    assert.deepEqual(plan({}), [], 'no TEAMS_OPENER_SESSION_ID');
    session({ kind: 'sdk' });
    assert.deepEqual(plan(env), [], 'an sdk-kind session');
    session({ pid: DEAD });
    assert.deepEqual(plan(env), [], 'a dead pid');
    assert.equal(events(t.id, 'asked').length, 1, 'both routes ran without any surface');
  });
}

test('control: with a live interactive opener the same card is planned for sending, so the [] above means something', async () => {
  const t = seedTask({ opener: { session_id: 's-1', entrypoint: 'cli' } });
  await ask(t);
  await step(t, verdict({ verdict: 'forward', reason: 'r' }));
  session({});
  const sent = plan({ TEAMS_OPENER_SESSION_ID: 's-1', TEAMS_TASK_ID: t.id });
  assert.equal(sent.length, 1);
  assert.ok(sent[0].text.includes(Q));
});

// ---------- (6) one definition: storyask.mjs is imported, never redefined ----------

test('storyask.mjs owns askedEvent, answeredEvent, answerPrompt, parseVerdict, validateAsk and newAskId: no second definition in the engine files', () => {
  for (const f of ['taskmanager.mjs', 'daemon.mjs', 'graph.mjs', 'broker.mjs', 'prompts.mjs']) {
    const src = readFileSync(join(HERE, '..', 'mcp', f), 'utf8');
    for (const name of ['askedEvent', 'answeredEvent', 'answerPrompt', 'parseVerdict', 'validateAsk', 'newAskId']) {
      assert.ok(!new RegExp(`(function|const|let)\\s+${name}\\b`).test(src), `${f} redefines ${name}`);
    }
  }
});
