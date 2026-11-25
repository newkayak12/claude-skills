// teams/scripts/test-story-ask.mjs - node tests for mcp/storyask.mjs, the pure contract of a
// STORY's question to its TeamLeader (card 49 part C). No model, no server, no file: every
// fixture is a plain object shaped like a task.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newAskId, askedEvent, answeredEvent, answerPrompt, parseVerdict, validateAsk, evidenceKinds, evidenceAnswer,
} from '../mcp/storyask.mjs';

const RUN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const KEY = 'E-aaaaaaaa/P1';
const taskWith = (state) => ({
  run_id: RUN_ID,
  nodes: [
    { id: 'dispatch:P1:0', subgoal_id: 'P1', stage: 'dispatch', state: 'done' },
    { id: 'dispatch:P1:1', subgoal_id: 'P1', stage: 'dispatch', state },
    { id: 'dispatch:P2:0', subgoal_id: 'P2', stage: 'dispatch', state: 'running' },
  ],
});
const LONG = `line one\nline two — 한글 😀\n${'x'.repeat(5200)}\n  trailing  `;

test('newAskId returns a fresh non-empty ledger-safe string each call', () => {
  const a = newAskId();
  const b = newAskId();
  assert.equal(typeof a, 'string');
  assert.ok(a.length > 0);
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.equal(JSON.stringify({ ask_id: a }).includes('\n'), false);
});

test('askedEvent has exactly the D3 keys and keeps the question byte-identical', () => {
  const ev = askedEvent({ task_id: 't1', key: KEY, node_id: 'dispatch:P1:1', question: LONG, ask_id: 'ask1' });
  assert.deepEqual(Object.keys(ev).sort(), ['ask_id', 'event', 'key', 'node_id', 'question', 'task_id']);
  assert.equal(ev.event, 'asked');
  assert.equal(ev.question, LONG);
  assert.equal(ev.key, KEY);
  assert.equal(ev.task_id, 't1');
  assert.equal(ev.node_id, 'dispatch:P1:1');
});

test('askedEvent throws on a missing required field', () => {
  const ok = { task_id: 't1', key: KEY, node_id: 'n', question: 'q', ask_id: 'a' };
  for (const k of Object.keys(ok)) {
    assert.throws(() => askedEvent({ ...ok, [k]: undefined }), new RegExp(k), `missing ${k}`);
    assert.throws(() => askedEvent({ ...ok, [k]: '' }), new RegExp(k), `empty ${k}`);
  }
  assert.throws(() => askedEvent(), /askedEvent/);
});

test('answeredEvent has exactly the D3 keys and keeps the answer byte-identical', () => {
  const ev = answeredEvent({
    task_id: 't1', key: KEY, node_id: 'dispatch:P1:1', answer: LONG, ask_id: 'ask1', by: 'teamleader', route: 'answer',
  });
  assert.deepEqual(Object.keys(ev).sort(), ['answer', 'ask_id', 'by', 'event', 'key', 'node_id', 'route', 'task_id']);
  assert.equal(ev.event, 'answered');
  assert.equal(ev.answer, LONG);
  assert.equal(ev.by, 'teamleader');
  assert.equal(ev.route, 'answer');
});

test('answeredEvent throws on a missing field, a by or a route outside the allowed set', () => {
  const ok = { task_id: 't1', key: KEY, node_id: 'n', answer: 'a', ask_id: 'x', by: 'person', route: 'forward' };
  assert.equal(answeredEvent(ok).by, 'person');
  assert.equal(answeredEvent(ok).route, 'forward');
  for (const k of Object.keys(ok)) assert.throws(() => answeredEvent({ ...ok, [k]: undefined }), new RegExp(k), `missing ${k}`);
  assert.throws(() => answeredEvent({ ...ok, by: 'driver' }), /by/);
  assert.throws(() => answeredEvent({ ...ok, by: 'Person' }), /by/);
  assert.throws(() => answeredEvent({ ...ok, route: 'sibling' }), /route/);
  assert.throws(() => answeredEvent({ ...ok, route: undefined }), /route/);
});

test('asked and answered built with the same ask_id pair on it', () => {
  const id = newAskId();
  const q = askedEvent({ task_id: 't', key: KEY, node_id: 'n', question: 'q?', ask_id: id });
  const a = answeredEvent({ task_id: 't', key: KEY, node_id: 'n', answer: 'a', ask_id: id, by: 'teamleader', route: 'answer' });
  assert.equal(q.ask_id, a.ask_id);
  assert.equal(q.key, a.key);
});

test('parseVerdict maps a bare or fenced answer verdict to answer, text unmodified', () => {
  const text = '  Yes - integer cents.\nSee plan §4.  ';
  assert.deepEqual(parseVerdict(JSON.stringify({ verdict: 'answer', answer: text })), { verdict: 'answer', answer: text });
  const fenced = '```json\n' + JSON.stringify({ verdict: 'answer', answer: text }) + '\n```';
  assert.deepEqual(parseVerdict(fenced), { verdict: 'answer', answer: text });
  const surrounded = 'Here you go:\n```json\n{"verdict":"answer","answer":"cents"}\n```\n';
  assert.deepEqual(parseVerdict(surrounded), { verdict: 'answer', answer: 'cents' });
});

test('parseVerdict maps a valid forward to forward and keeps its reason', () => {
  assert.deepEqual(parseVerdict('{"verdict":"forward","reason":"plan is silent"}'), { verdict: 'forward', reason: 'plan is silent' });
  assert.equal(parseVerdict('{"verdict":"forward"}').verdict, 'forward');
});

test('parseVerdict forwards on malformed JSON, blank or non-string answer, unknown verdict', () => {
  const cases = [
    '{"verdict":"answer","answer":',
    'not json at all',
    '{"verdict":"answer","answer":""}',
    '{"verdict":"answer","answer":"   \\n "}',
    '{"verdict":"answer","answer":42}',
    '{"verdict":"answer"}',
    '{"verdict":"maybe","answer":"x"}',
    '{"answer":"x"}',
    '[1,2]',
    'null',
    '"answer"',
  ];
  for (const raw of cases) {
    const v = parseVerdict(raw);
    assert.equal(v.verdict, 'forward', raw);
    assert.equal(typeof v.reason, 'string', raw);
    assert.ok(v.reason.length > 0, raw);
  }
});

test('parseVerdict forwards on empty, null, undefined and non-string input and never throws', () => {
  for (const raw of ['', '   ', null, undefined, 42, {}, [], true]) {
    assert.equal(parseVerdict(raw).verdict, 'forward');
  }
});

test('parseVerdict forwards on crash and timeout markers, even one wrapping an answer shape', () => {
  for (const raw of [
    { error: 'timeout' }, { timedOut: true }, { crashed: true }, { ok: false, error: 'spawn failed' },
    'TIMEOUT', 'timed out', '[crash] node exited 1', 'claude: error: killed',
  ]) {
    assert.equal(parseVerdict(raw).verdict, 'forward', JSON.stringify(raw));
  }
  assert.equal(parseVerdict({ timedOut: true, text: '{"verdict":"answer","answer":"yes"}' }).verdict, 'forward');
});

test('validateAsk accepts a running STORY and exposes no sibling or driver input', () => {
  const r = validateAsk({ task: taskWith('running'), key: KEY, question: 'is amount in cents?' });
  assert.equal(r.ok, true);
  assert.equal(r.pkgId, 'P1');
  assert.equal(r.key, KEY);
  const extra = validateAsk({
    task: taskWith('running'), key: KEY, question: 'q', sibling: 'E-aaaaaaaa/P2', driver: 'x', target: 'P2', to: 'P2',
  });
  assert.deepEqual(extra, r);
  assert.equal(extra.ok, true);
  assert.equal(extra.pkgId, 'P1');
  assert.equal(extra.key, KEY);
  assert.equal('sibling' in extra || 'driver' in extra || 'target' in extra, false);
});

test('validateAsk refuses a blank or non-string question', () => {
  for (const question of ['', '  \n ', null, undefined, 5, {}]) {
    const r = validateAsk({ task: taskWith('running'), key: KEY, question });
    assert.equal(r.ok, false);
    assert.match(r.reason, /question/);
  }
});

test('validateAsk refuses EPIC, TASK, bare, foreign-epic and malformed keys', () => {
  for (const key of ['E-aaaaaaaa', 'E-aaaaaaaa/P1/U1', 'P1', '', null, undefined, 'E-bbbbbbbb/P1', 'E-aaaaaaaa/', 'E-aaaaaaaa/P1/', 'I-foo']) {
    const r = validateAsk({ task: taskWith('running'), key, question: 'q' });
    assert.equal(r.ok, false, String(key));
    assert.match(r.reason, /key|STORY/, String(key));
  }
});

test('validateAsk refuses a STORY whose latest dispatch node is not running, and an unknown STORY', () => {
  for (const state of ['pending', 'done', 'failed', 'skipped', 'unreachable']) {
    const r = validateAsk({ task: taskWith(state), key: KEY, question: 'q' });
    assert.equal(r.ok, false, state);
    assert.match(r.reason, /running/, state);
  }
  assert.equal(validateAsk({ task: taskWith('running'), key: 'E-aaaaaaaa/P9', question: 'q' }).ok, false);
  // the latest dispatch node decides, not an earlier running one
  const t = taskWith('done');
  t.nodes[0].state = 'running';
  assert.equal(validateAsk({ task: t, key: KEY, question: 'q' }).ok, false);
});

test('validateAsk never throws on a missing or malformed input', () => {
  for (const input of [undefined, null, {}, { task: null, key: KEY, question: 'q' }, { task: {}, key: KEY, question: 'q' }]) {
    assert.equal(validateAsk(input).ok, false);
  }
});

test('answerPrompt carries the question verbatim, both pointers, read-only tools and the verdict shapes', () => {
  const q = 'is amount in cents?\n(second line) 한글';
  const p = answerPrompt({ question: q, planPath: '.teams_output/team/E-aaaaaaaa/10-prd.md', wikiHint: 'wiki_search "money"' });
  assert.equal(typeof p, 'string');
  assert.ok(p.includes(q));
  assert.ok(p.includes('.teams_output/team/E-aaaaaaaa/10-prd.md'));
  assert.ok(p.includes('wiki_search "money"'));
  for (const tool of ['Read', 'Grep', 'Glob', 'wiki_search', 'wiki_get']) assert.ok(p.includes(tool), tool);
  assert.match(p, /no file may be written/i);
  assert.match(p, /no other tool/i);
  assert.match(p, /only from the plan and the wiki/i);
  assert.ok(p.includes('{"verdict":"answer","answer":"..."}'));
  assert.ok(p.includes('{"verdict":"forward","reason":"..."}'));
  assert.match(p, /nothing else/i);
  for (const banned of ['Edit', 'Write', 'Bash']) assert.equal(new RegExp(`\\b${banned}\\b`).test(p.replace(/no file may be written/i, '')), false, banned);
});

test('answerPrompt works with only a question and refuses a blank one', () => {
  const p = answerPrompt({ question: 'q?' });
  assert.ok(p.includes('q?'));
  assert.throws(() => answerPrompt({ question: '  ' }), /question/);
  assert.throws(() => answerPrompt(), /question/);
});

test('evidenceKinds classifies each of the three kinds, and several together in a fixed order', () => {
  const cases = [
    ['P3 needs the count of mcp/server.mjs processes now.', ['process_count']],
    ['How many teams mcp/server.mjs processes are running?', ['process_count']],
    ['How many server.mjs processes are running right now?', ['process_count']],
    ['Is there a bus_message ledger line?', ['ledger_lines']],
    ['P3 needs the bus_message ledger lines verbatim from ledger.jsonl.', ['ledger_lines']],
    ['Please send me the bus_message ledger lines, ts 1795490820889 and 1795490836895.', ['ledger_lines']],
    ['Please give me the live by_stage cost so far from drivercost.mjs taskFigure plus costByStage.', ['cost_by_stage']],
    ['What is the cost by stage so far?\nHow many server.mjs processes are running?', ['process_count', 'cost_by_stage']],
  ];
  for (const [q, kinds] of cases) assert.deepEqual(evidenceKinds(q), kinds, q);
});

test('evidenceKinds is null for anything outside the three kinds: plan, opinion, decision, mixed, extra request', () => {
  const cases = [
    'Which plan should package P2 follow?',
    'Are amounts stored in cents or in dollars?',
    'Do you think the retry design is right?',
    'May I drop the review stage?',
    'cost by stage is high - should we drop the review stage?',
    'the ledger shows two server.mjs processes; which one should I keep?',
    'How many teams mcp/server.mjs processes are running, and should I restart them?',
    'Give me the cost by stage. Is that acceptable?',
    'Why is the cost by stage so high?',
    'Please approve the cost by stage.',
    'Give me the cost by stage or the bus_message ledger lines.',
    'Please give me the cost by stage and the open ps sample timestamp.',
    'Please give me the cost by stage 줄여도 되나요',
    'Give me the cost by stage for P2.',
    'How many processes are running?',
    // judgements and requests worded from filler words only
    'Is the server process count right?',
    'Is cost by stage what we need?',
    'And is the cost by stage what we need?',
    'Tell me, is cost by stage what we need?',
    'Are we running the server.mjs process count?',
    'Is this what we need, a cost_recorded ledger line?',
    'We need a cost_recorded ledger line.',
    'Give me the cost by stage, right?',
    // the two verbatim E-de2a5672 questions: each also asks for things outside the three kinds
    "P3 needs, for cards 126/128: (1) the open and mid-run ps samples (timestamp, count of mcp/server.mjs in the tm_open session's process tree, command lines if count != 1); none were posted to E-de2a5672/P3. (2) the two bus_message ledger lines verbatim (P1 probe ts 1795490820889; P1->P2 note ts 1795490836895). (3) cost_recorded by_stage so far. Anything you cannot send I will write as 'pending teamleader' / 'relayed from handoff'.",
    "P3 cannot read the state dir from its worktree. Please give me, as they are now: (a) the number of cost_recorded events in ledger.jsonl; (b) the live by_stage cost so far from drivercost.mjs taskFigure plus costByStage, with each stage's USD, the sum, the spend figure, the estimated figure, the difference and the ISO time you took them; (c) the ISO timestamp of the open ps sample; (d) the first-hand value of task.json bus_reads['E-de2a5672/P2']. If a value does not exist yet, say so plainly and I will record it as such.",
    '', '   ', undefined, null, 5,
  ];
  for (const q of cases) assert.equal(evidenceKinds(q), null, String(q));
});

test('evidenceAnswer words only the kinds asked, with every line verbatim', () => {
  const facts = {
    at: '2026-11-26T00:00:00.000Z',
    process_count: 4,
    ledger: { lines: ['{"ts":1,"event":"bus_message","body":"  a  "}'], omitted: 3 },
    cost: { by_stage: { dispatch_package: 1.5, node_review: 0.25 }, spend: 1.75, estimated: true },
  };
  const all = evidenceAnswer(['process_count', 'ledger_lines', 'cost_by_stage'], facts);
  for (const part of [facts.at, 'processes on this machine: 4\n',facts.ledger.lines[0], '3 earlier ones omitted', 'dispatch_package: 1.5', 'node_review: 0.25', 'spend: 1.75 (estimated)']) assert.ok(all.includes(part), part);
  const one = evidenceAnswer(['cost_by_stage'], { at: facts.at, cost: facts.cost });
  assert.equal(/processes|ledger/.test(one), false);
});
