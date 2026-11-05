// graph-decisions.mjs: answered / settled decisions, routing of execution-phase questions, openAsk.
//   node --test teams/scripts/test-graph-decisions.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answeredDecisions, chosenOf, normalizeDecision, appendDecisions, planDecisions, settledDecisions,
  routeExecutionQuestions, openAsk,
} from '../mcp/graph-decisions.mjs';
import { node, getNode } from '../mcp/graph-nodes.mjs';

const askNode = (id, owner, decisions, extra = {}) => node(id, 'ask', [], { ask_owner: owner, subgoal_id: owner, state: 'done', result: { decisions }, ...extra });

test('answeredDecisions: scoped to an owner, or every owner tagged decided_for; first answer to a question wins', () => {
  const run = { nodes: [
    askNode('ask:U1:1', 'U1', [{ question: 'q1', chose: 'a' }]),
    askNode('ask:U2:1', 'U2', [{ question: 'q2', chose: 'b' }, { question: 'q1', chose: 'dup' }]),
    node('plan', 'plan'),
  ] };
  assert.deepEqual(answeredDecisions(run, 'U1'), [{ question: 'q1', chose: 'a' }]);
  assert.deepEqual(answeredDecisions(run, 'U9'), []);
  assert.deepEqual(answeredDecisions(run), [
    { question: 'q1', chose: 'a', decided_for: 'U1' }, { question: 'q2', chose: 'b', decided_for: 'U2' },
  ]);
});

test('chosenOf: decided, else default, else the first option; strings pass, objects are JSON', () => {
  assert.equal(chosenOf(null), '');
  assert.equal(chosenOf({ decided: 'x', default: 'y' }), 'x');
  assert.equal(chosenOf({ default: { a: 1 } }), '{"a":1}');
  assert.equal(chosenOf({ options: [{ option: 'first' }, 'second'] }), 'first');
  assert.equal(chosenOf({ options: ['plain'] }), 'plain');
  assert.equal(chosenOf({ options: [] }), '');
});

test('normalizeDecision: question + chose are required; owner/decided_in/source fall back to the defaults', () => {
  assert.equal(normalizeDecision(null), null);
  assert.equal(normalizeDecision({ question: 'q' }), null, 'nothing chosen');
  assert.equal(normalizeDecision({ chose: 'c' }), null, 'no question');
  assert.deepEqual(normalizeDecision({ unknown: ' q ', default: 'd', because: 'b' }, { decided_in: 'PLAN', source: 'default', owner: 'po' }),
    { question: 'q', chose: 'd', because: 'b', owner: 'po', decided_in: 'PLAN', source: 'default' });
  assert.deepEqual(normalizeDecision({ question: 'q', chose: { a: 1 }, owner: 'me' }),
    { question: 'q', chose: '{"a":1}', owner: 'me', decided_in: null, source: null });
});

test('appendDecisions: exact-question dedup, returns only what was added', () => {
  const list = [{ question: 'old', chose: 'x' }];
  const added = appendDecisions(list, [{ question: 'old', chose: 'y' }, { question: 'new', chose: 'z' }, { question: 'new', chose: 'w' }, null], { source: 's' });
  assert.deepEqual(added.map((d) => d.question), ['new']);
  assert.deepEqual(list.map((d) => d.chose), ['x', 'z']);
  assert.deepEqual(appendDecisions(list, undefined), []);
});

test('planDecisions: ask answers (all owners) then unasked defaults of a PLAN run', () => {
  assert.deepEqual(planDecisions(null), []);
  const plan = { nodes: [askNode('ask:U1:1', 'U1', [{ question: 'q1', chose: 'a' }])], unasked: [{ question: 'q2', default: 'd' }, { question: 'q1', default: 'dup' }, { nope: 1 }] };
  const out = planDecisions(plan);
  assert.deepEqual(out.map((d) => [d.question, d.chose, d.source, d.decided_in, d.owner]), [['q1', 'a', 'ask', 'PLAN', 'U1'], ['q2', 'd', 'default', 'PLAN', null]]);
});

test('settledDecisions: the run\'s answers, then the task\'s, each question once, tagged with where it came from', () => {
  const run = { nodes: [askNode('ask:U1:1', 'U1', [{ question: 'q1', chose: 'a' }])],
    task_decisions: [{ question: 'q1', chose: 'dup' }, { question: 'q2', chose: 'b', decided_in: 'PLAN', source: 'ask' }, null] };
  const out = settledDecisions(run);
  assert.deepEqual(out.map((d) => d.question), ['q1', 'q2']);
  assert.equal(out[1].decided_for, 'task/PLAN (ask)');
});

test('routeExecutionQuestions: a default is recorded in run.unasked; a contradiction or no safe default blocks; settled is dropped', () => {
  const run = { nodes: [askNode('ask:U1:1', 'U1', [{ question: 'settled?', chose: 'a' }])] };
  const n = node('implement:U1:1', 'implement', [], { subgoal_id: 'U1' });
  const out = routeExecutionQuestions(run, n, [
    { question: 'has default', default: 'yes' },
    { question: 'many options', options: ['a', 'b'] },
    { question: 'lonely' },
    { question: 'settled?', default: 'x' },
    { question: 'settled?', contradicts_decision: 'it does not hold' },
    { question: '' },
  ]);
  assert.deepEqual(out.decided.map((d) => [d.question, d.decided]), [['has default', 'yes'], ['many options', null]]);
  assert.deepEqual(out.blocking.map((b) => [b.question, b.blocking]), [['lonely', 'no_safe_default'], ['settled?', 'contradicts_decision']]);
  assert.equal(run.unasked.length, 2);
  assert.equal(run.blocking_questions.length, 2);
  routeExecutionQuestions(run, n, [{ question: 'lonely' }]);
  assert.equal(run.blocking_questions.length, 2, 'a blocking question is kept once');
});

const investigate = () => node('investigate:U1:1', 'investigate', [], { subgoal_id: 'U1', state: 'done' });
const askRun = () => {
  const inv = investigate();
  return { run: { nodes: [inv, node('draft:U1:1', 'draft', [inv.node_id], { subgoal_id: 'U1' })] }, inv };
};

test('openAsk: only decidable questions make a card; the consumer is rewired to wait on it; a second call is a no-op', () => {
  const { run, inv } = askRun();
  assert.deepEqual(openAsk(run, null, [{ question: 'q', default: 'd' }]), []);
  assert.deepEqual(openAsk(run, inv, [{ question: 'no options, no default' }]), []);
  const ids = openAsk(run, inv, [{ question: 'q', options: ['a', 'b'], to: 'po' }]);
  assert.deepEqual(ids, ['ask:U1:1']);
  const card = getNode(run, 'ask:U1:1');
  assert.deepEqual([card.state, card.deps, card.ask_owner, card.assignment.who], ['waiting_human', ['investigate:U1:1'], 'U1', 'po']);
  assert.deepEqual(getNode(run, 'draft:U1:1').deps, ['ask:U1:1']);
  assert.deepEqual(openAsk(run, inv, [{ question: 'q2', default: 'd' }]), [], 'one card per owner and attempt');
});

test('openAsk: one card per answering owner, suffixed b, c; an already-settled question is not asked again', () => {
  const { run, inv } = askRun();
  run.task_decisions = [{ question: 'settled', chose: 'x' }];
  const ids = openAsk(run, inv, [
    { question: 'q1', default: 'd', to: 'po' }, { question: 'q2', default: 'd', to: 'sre' }, { question: 'q3', default: 'd', to: 'po' }, { question: 'settled', default: 'd' },
  ]);
  assert.deepEqual(ids, ['ask:U1:1', 'ask:U1:1b']);
  assert.deepEqual(getNode(run, 'ask:U1:1').questions.map((q) => q.question), ['q1', 'q3']);
  assert.deepEqual(getNode(run, 'draft:U1:1').deps, ['ask:U1:1', 'ask:U1:1b']);
  const { run: run2, inv: inv2 } = askRun();
  run2.task_decisions = [{ question: 'settled', chose: 'x' }];
  assert.deepEqual(openAsk(run2, inv2, [{ question: 'settled', default: 'd' }]), [], 'nothing left to ask');
});

test('openAsk: opts.blocking keeps an option-less question; opts.story stamps the card and leaves consumers alone', () => {
  const { run, inv } = askRun();
  const ids = openAsk(run, inv, [{ question: 'must decide' }], { blocking: true, owner: 'EPIC', attempt: 2, story: { ask_id: 'a1', key: 'E/P1' } });
  assert.deepEqual(ids, ['ask:EPIC:2']);
  const card = getNode(run, 'ask:EPIC:2');
  assert.deepEqual([card.ask_id, card.story_key, card.attempt], ['a1', 'E/P1', 2]);
  assert.deepEqual(getNode(run, 'draft:U1:1').deps, ['investigate:U1:1'], 'a story card holds only its parked driver');
});
