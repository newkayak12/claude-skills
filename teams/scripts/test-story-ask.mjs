// teams/scripts/test-story-ask.mjs - node tests for mcp/storyask.mjs, the pure contract of a
// STORY's question to its TeamLeader (card 49 part C). No model, no server, no file: every
// fixture is a plain object shaped like a task.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newAskId, askedEvent, answeredEvent, answerPrompt, parseVerdict, validateAsk,
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
