// teamsView / decisionsView: the pure builders behind `view.mjs --once --format teams|decisions`
// (the /teams-status pane, _repo/docs/plans/2026-10-14-mod-status-panes-design.md).
//
//   node --test teams/scripts/test-view-status.mjs
process.env.TZ = 'UTC';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { teamsView, decisionsView } from './lib/view-status.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const NOW = 1_000_000;
const ms = (id, state, extra = {}) => ({ node_id: id, stage: id.split(':')[0], state, executor: null, model: null, ...extra });
const card = (id, title, ticket_state, dispatch, accept = null, extra = {}) => ({
  id, title, phase: null, ticket_key: `E-aaaa/${id}`, ticket_state, dispatch, accept, child: null, ...extra,
});

const MODEL = {
  task_id: 'aaaa-1', ticket: { key: 'E-aaaa' },
  manager_stages: [ms('shape', 'done'), ms('integrate:1', 'pending', { executor: 'claude', model: 'opus', judging_since: NOW - 5000 })],
  packages: [
    card('PLAN-F1', 'plan feature 1', 'DONE', ms('dispatch:PLAN-F1:1', 'done'), ms('accept:PLAN-F1:1', 'done'), { phase: 'planning' }),
    card('P1', 'module a', 'IN_PROGRESS', ms('dispatch:P1:1', 'running', { started_at: NOW - 60000 }), null, {
      child: { nodes: [ms('implement:1:1', 'running', { executor: 'codex', model: 'gpt-5', started_at: NOW - 30000 })] },
    }),
    card('D1', 'b.txt not wired', 'READY', null, null, { origin: 'qa', reporter: 'qa' }),
  ],
  qa: { rounds: [{ ...card('QA-F1', 'QA feature 1', 'IN_PROGRESS', ms('dispatch:QA-F1:1', 'done'), ms('accept:QA-F1:1', 'running', { started_at: NOW - 1000 })), id: 'QA-F1:1' }] },
  audit: { rounds: [{ ...card('AUDIT', 'Planning audit', 'DONE', ms('dispatch:AUDIT:1', 'done'), ms('accept:AUDIT:1', 'done')), id: 'AUDIT:1' }] },
  s_run: null,
};

test('teams: one row per team (planning, develop, qa, audit) with its cards, states and what each does now', () => {
  const v = teamsView(MODEL, { now: NOW });
  assert.deepEqual(v.teams.map((t) => t.team), ['planning', 'develop', 'qa', 'audit']);
  const dev = v.teams.find((t) => t.team === 'develop').cards;
  assert.deepEqual(dev.map((c) => [c.id, c.key, c.state, c.mark]), [['P1', 'E-aaaa/P1', 'IN_PROGRESS', 'running'], ['D1', 'E-aaaa/D1', 'READY', 'pending']]);
  assert.deepEqual(dev[0].now, { node: 'implement', agent: 'codex·gpt-5', elapsed_ms: 30000 }, 'the child run node, not the dispatch');
  assert.equal(dev[1].now, null);
  assert.equal(v.teams.find((t) => t.team === 'planning').cards[0].mark, 'done');
  assert.deepEqual(v.teams.find((t) => t.team === 'qa').cards[0].now, { node: 'accept', agent: null, elapsed_ms: 1000 });
});

test('now: one line per active actor, the EPIC judge included with its vendor·model and elapsed', () => {
  const { now } = teamsView(MODEL, { now: NOW });
  assert.deepEqual(now, [
    { team: 'develop', key: 'E-aaaa/P1', node: 'implement', agent: 'codex·gpt-5', elapsed_ms: 30000 },
    { team: 'qa', key: 'E-aaaa/QA-F1', node: 'accept', agent: null, elapsed_ms: 1000 },
    { team: 'epic', key: 'E-aaaa', node: 'integrate:1', agent: 'claude·opus', elapsed_ms: 5000 },
  ]);
  assert.deepEqual(teamsView({}, { now: NOW }), { now: [], teams: [] });
});

const TASK = {
  nodes: [
    { node_id: 'shape', stage: 'shape', state: 'done', vendor: 'claude', model: 'opus', result: { packages: [{ id: 'P1', title: 'module a' }, { id: 'P2', title: 'module b' }] } },
    { node_id: 'accept:P1:1', stage: 'accept', subgoal_id: 'P1', state: 'done', result: { accept: true, match_pct: 92 } },
    { node_id: 'integrate:1', stage: 'integrate', state: 'failed', result: { verified: false, reason: 'P2 misses AC 3', gaps: ['AC 3 untested'] } },
  ],
  spec: { packages: [{ id: 'P1' }, { id: 'D1', title: 'b.txt not wired', reporter: 'qa', brief: 'This package fixes...\nTitle: b.txt\nEvidence:\nnode b.mjs prints undefined' }] },
  decisions: [{ question: 'storage?', chose: 'files', owner: 'requester', decided_in: 'EPIC', because: 'no db here' }],
};
const LEDGER = [
  { ts: 1, event: 'node_finish', node_id: 'shape', stage: 'shape', state: 'done' },
  { ts: 2, event: 'verdict', node_id: 'integrate:1', stage: 'integrate', actor: 'claude·opus', verdict: 'judge_failed', score: null, reason: 'judge reply was not valid JSON' },
  { ts: 3, event: 'daemon_rejudge', node_id: 'integrate:1', attempt: 1, reason: 'judge reply was not valid JSON' },
  { ts: 4, event: 'verdict', node_id: 'integrate:1', stage: 'integrate', actor: 'claude·sonnet', verdict: 'reject', score: 70, reason: 'P2 misses AC 3' },
  { ts: 5, event: 'verdict', node_id: 'accept:P1:1', stage: 'accept', subgoal_id: 'P1', attempt: 1, actor: 'claude·opus', verdict: 'accept', score: 92, reason: null },
  { ts: 6, event: 'daemon_retry_opened', package_id: 'P1', attempt: 2, reason: 'tests red', failed_node: 'accept:P1:1' },
  { ts: 7, event: 'defects_filed', reporter: 'qa', origin: 'qa', filed: ['D1'] },
  { ts: 7, event: 'daemon_defects_filed', package_id: 'QA-F1', filed: ['D1'] },
  { ts: 8, event: 'tm_submit_human', key: 'E-aaaa/TASK/critique', node_id: 'critique', answer: 'reject: overlap' },
  { ts: 9, event: 'plan_integrate_resplit', node_id: 'plan-integrate:1', attempt: 2 },
  { ts: 10, event: 'judge_start', node_id: 'x' },
];

test('decisions: a re-judged node keeps its earlier and later verdict, each with actor and reason; the latest carries its gaps', () => {
  const { entries } = decisionsView(TASK, LEDGER);
  const v = entries.filter((e) => e.kind === 'verdict' && e.node === 'integrate:1');
  assert.deepEqual(v.map((x) => [x.actor, x.verdict, x.score, x.reason]), [
    ['claude·opus', 'judge_failed', null, 'judge reply was not valid JSON'],
    ['claude·sonnet', 'reject', 70, 'P2 misses AC 3'],
  ]);
  assert.equal(v[0].gaps, undefined);
  assert.deepEqual(v[1].gaps, ['AC 3 untested']);
  assert.ok(entries.some((e) => e.kind === 'rejudge' && e.node === 'integrate:1'));
});

test('decisions: proposal, retry, defect with evidence, answer, resplit, decisions[] in time order; unknown events dropped', () => {
  const { entries } = decisionsView(TASK, LEDGER);
  assert.deepEqual(entries.map((e) => e.kind), ['proposal', 'verdict', 'rejudge', 'verdict', 'verdict', 'retry', 'defect', 'answer', 'resplit', 'decision']);
  assert.deepEqual(entries[0], { ts: 1, time: '00:00', card: null, node: 'shape', kind: 'proposal', actor: 'claude·opus', text: 'P1 module a; P2 module b' });
  const d = entries.find((e) => e.kind === 'defect');
  assert.deepEqual([d.card, d.title, d.filed_by, d.evidence], ['D1', 'b.txt not wired', 'qa', 'node b.mjs prints undefined']);
  assert.equal(entries.filter((e) => e.kind === 'defect').length, 1, 'defects_filed and the caller line name D1 once');
  assert.deepEqual(entries.find((e) => e.kind === 'answer'), { ts: 8, time: '00:00', card: 'TASK', node: 'critique', kind: 'answer', actor: 'human', text: 'reject: overlap' });
  assert.deepEqual(entries.at(-1), { ts: null, time: null, card: null, node: null, kind: 'decision', actor: 'requester', text: 'storage?: files', reason: 'no db here', decided_in: 'EPIC' });
});

test('decisions: --card narrows to one card (a QA round suffix ignored); nothing for an empty task', () => {
  assert.deepEqual(decisionsView(TASK, LEDGER, { card: 'P1' }).entries.map((e) => e.kind), ['verdict', 'retry']);
  assert.deepEqual(decisionsView(TASK, LEDGER, { card: 'P1:2' }).card, 'P1');
  assert.deepEqual(decisionsView(null, []), { card: null, entries: [] });
});

test('view.mjs --once --format decisions reads task.json and the ledger of --task', () => {
  const root = mkdtempSync(join(tmpdir(), 'view-status-'));
  try {
    mkdirSync(join(root, 't1'));
    writeFileSync(join(root, 't1', 'task.json'), JSON.stringify(TASK));
    writeFileSync(join(root, 't1', 'ledger.jsonl'), LEDGER.map((l) => JSON.stringify(l)).join('\n') + '\n{torn');
    const r = spawnSync('node', [join(HERE, 'view.mjs'), '--tasks-dir', root, '--once', '--format', 'decisions', '--task', 't1', '--card', 'P1'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).entries.map((e) => e.kind), ['verdict', 'retry']);
    const none = spawnSync('node', [join(HERE, 'view.mjs'), '--tasks-dir', root, '--once', '--format', 'decisions', '--task', 'nope'], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(none.stdout), { card: null, entries: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
