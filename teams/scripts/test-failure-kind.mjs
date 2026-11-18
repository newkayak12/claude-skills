import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KINDS, classifyFailure, gapSignature, recordFailureKind, environmentEvidence, escalationAsk, rejectionKeys, repeatedGaps } from '../mcp/failure-kind.mjs';

const task = { run_id: 'T-fk', goal_threshold: 90 };
const node = { node_id: 'gate:U1:1', stage: 'gate', subgoal_id: 'U1', state: 'done', attempt: 2, result: { stage_ok: false } };
const denial = (tool_name, file_path) => ({ tool_name, tool_use_id: 't', tool_input: { file_path } });

let root;
const prevDir = process.env.HARNESS_TASKS_DIR;
before(() => { root = mkdtempSync(join(tmpdir(), 'failure-kind-')); process.env.HARNESS_TASKS_DIR = root; });
after(() => {
  if (prevDir === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevDir;
  rmSync(root, { recursive: true, force: true });
});

const ledger = (id) => {
  const f = join(root, id, 'ledger.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

test('KINDS is exactly the seven kinds, in order', () => {
  assert.deepEqual(KINDS, ['capacity', 'environment', 'repeated-identical-rejection', 'below-threshold', 'merge-conflict', 'ended-task', 'unclassified']);
});

test('classify capacity: limit text, routing_blocked_capacity, and a child quota', () => {
  assert.equal(classifyFailure(task, node, { reason: "You've hit your session limit · resets 5:40pm" }), 'capacity');
  assert.equal(classifyFailure(task, node, {}, { stderr: 'Claude: You hit your weekly-opus limit' }), 'capacity');
  assert.equal(classifyFailure(task, node, { routing_blocked_capacity: true }), 'capacity');
  assert.equal(classifyFailure(task, node, { stages: [{ failure_kind: 'quota' }] }), 'capacity');
});

test('classify environment: ENOSPC, a denied write, tool denied, a missing child run file', () => {
  assert.equal(classifyFailure(task, node, { error: 'write failed: ENOSPC' }), 'environment');
  assert.equal(classifyFailure(task, node, {}, { stderr: 'tar: no space left on device' }), 'environment');
  assert.equal(classifyFailure(task, node, { permission_denials: [denial('Write', '/w/a.md')] }), 'environment');
  assert.equal(classifyFailure(task, node, { blocked: 'tool denied' }), 'environment');
  assert.equal(classifyFailure(task, node, { reason: 'child run f38a has no file under /tmp/x/integration' }), 'environment');
});

test('classify repeated-identical-rejection: same non-empty signature as the previous attempt', () => {
  const prev = { accept: false, match_pct: 70, gaps: ['No retry test', 'missing docs'] };
  const now = { accept: false, match_pct: 75, gaps: [' missing DOCS ', 'no retry  test'] };
  assert.equal(classifyFailure(task, node, now, { previous: prev }), 'repeated-identical-rejection');
  assert.equal(classifyFailure(task, node, now, { previousSignature: gapSignature(prev, 90) }), 'repeated-identical-rejection');
  // different gaps are a new rejection, not a repeat
  assert.equal(classifyFailure(task, node, { ...now, gaps: ['other'] }, { previous: prev }), 'below-threshold');
});

test('classify below-threshold: under task.goal_threshold, default 90, first time', () => {
  assert.equal(classifyFailure(task, node, { accept: false, match_pct: 87, gaps: [] }), 'below-threshold');
  assert.equal(classifyFailure({ run_id: 'T' }, node, { accept: false, match_pct: 89, gaps: ['x'] }), 'below-threshold');
  assert.equal(classifyFailure({ run_id: 'T', goal_threshold: 80 }, node, { accept: false, match_pct: 85, gaps: ['x'] }), 'unclassified');
});

test('classify merge-conflict: conflicts non-empty or integrate_conflict set', () => {
  assert.equal(classifyFailure(task, node, { conflicts: ['a.mjs'] }), 'merge-conflict');
  assert.equal(classifyFailure(task, node, { integrate_conflict: { packages: ['P1', 'P2'] } }), 'merge-conflict');
  assert.equal(classifyFailure(task, node, { conflicts: [] }), 'unclassified');
});

test('classify ended-task is a recorded kind, never a classification', () => {
  assert.ok(KINDS.includes('ended-task'));
  for (const r of [{}, { accept: false, match_pct: 10 }, { conflicts: ['x'] }]) assert.notEqual(classifyFailure(task, node, r), 'ended-task');
});

test('classify unclassified: nothing matched', () => {
  assert.equal(classifyFailure(task, node, { stage_ok: false, reason: 'the build was red' }), 'unclassified');
  assert.equal(classifyFailure(task, node, undefined), 'unclassified');
});

test('precedence: a denied write inside a merge is environment only', () => {
  const r = { conflicts: ['a.mjs'], integrate_conflict: true, permission_denials: [denial('Edit', '/w/a.mjs')] };
  assert.equal(classifyFailure(task, node, r), 'environment');
});

test('precedence: capacity beats environment, environment beats repeat, repeat beats below-threshold', () => {
  assert.equal(classifyFailure(task, node, { reason: 'you hit your session limit', error: 'ENOSPC' }), 'capacity');
  const prev = { match_pct: 87, gaps: [] };
  assert.equal(classifyFailure(task, node, { match_pct: 87, gaps: [], error: 'ENOSPC' }, { previous: prev }), 'environment');
  assert.equal(classifyFailure(task, node, { match_pct: 87, gaps: [], conflicts: ['x'] }, { previous: prev }), 'repeated-identical-rejection');
  assert.equal(classifyFailure(task, node, { match_pct: 87, gaps: [], conflicts: ['x'] }), 'below-threshold');
});

test('exemption: a denied write only to engineWrittenPath is not environment; to another path it is', () => {
  const qa = '/wt/qa/60-qa.md';
  const only = { permission_denials: [denial('Write', qa), denial('Write', qa)], blocked: 'tool denied' };
  assert.equal(classifyFailure(task, node, only, { engineWrittenPath: qa }), 'unclassified');
  assert.equal(classifyFailure(task, node, only, {}), 'environment');
  const other = { permission_denials: [denial('Write', qa), denial('Write', '/wt/qa/other.md')] };
  assert.equal(classifyFailure(task, node, other, { engineWrittenPath: qa }), 'environment');
  assert.equal(classifyFailure(task, node, { permission_denials: [denial('Write', '/wt/qa/other.md')] }, { engineWrittenPath: qa }), 'environment');
});

test('a Bash denial is not a denied write', () => {
  const r = { permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'rm -rf x' } }] };
  assert.equal(classifyFailure(task, node, r), 'unclassified');
});

test('a second refusal at 87 with no gaps repeats the first; the first is below-threshold', () => {
  const first = { accept: false, match_pct: 87, gaps: [] };
  const second = { accept: false, match_pct: 87, gaps: [] };
  assert.equal(classifyFailure(task, node, first), 'below-threshold');
  assert.equal(gapSignature(first, 90), 'below goal_threshold 90');
  assert.equal(gapSignature(second, 90), 'below goal_threshold 90');
  assert.equal(classifyFailure(task, node, second, { previous: first }), 'repeated-identical-rejection');
});

test('a refusal not below the floor with no gaps has signature "" and never repeats', () => {
  const r = { accept: false, match_pct: 95, gaps: [], reason: 'no' };
  assert.equal(gapSignature(r, 90), '');
  assert.notEqual(classifyFailure(task, node, r, { previous: r }), 'repeated-identical-rejection');
  assert.notEqual(classifyFailure(task, node, r, { previousSignature: '' }), 'repeated-identical-rejection');
});

test('gapSignature: order, case, whitespace and reason do not matter', () => {
  const a = gapSignature({ gaps: ['Alpha ', 'beta'], reason: 'one' }, 90);
  const b = gapSignature({ gaps: ['BETA', ' alpha'], reason: 'worded differently' }, 90);
  assert.equal(a, b);
  assert.equal(a, 'alpha|beta');
  assert.notEqual(a, gapSignature({ gaps: ['alpha'] }, 90));
  assert.equal(gapSignature({ match_pct: 70, gaps: ['x'] }, 90), 'below goal_threshold 90|x');
});

test('classification is deterministic across repeated calls', () => {
  const r = { accept: false, match_pct: 80, gaps: ['b', 'a'], conflicts: ['f'] };
  const opts = { previous: { gaps: ['a'], match_pct: 80 } };
  const kinds = new Set();
  for (let i = 0; i < 20; i++) kinds.add(classifyFailure(task, node, r, opts));
  assert.deepEqual([...kinds], ['below-threshold']);
});

test('recordFailureKind sets result.failure_kind and records failure_classified', () => {
  const t = { run_id: 'T-rec1' };
  const n = { node_id: 'accept:P1:1', state: 'done', attempt: 1, result: { stage_ok: false } };
  assert.equal(recordFailureKind(t, n, 'below-threshold', { via: 'accept' }), 'below-threshold');
  assert.equal(n.result.failure_kind, 'below-threshold');
  assert.deepEqual(ledger('T-rec1').map(({ ts, ...e }) => e), [{ event: 'failure_classified', task_id: 'T-rec1', node_id: 'accept:P1:1', failure_kind: 'below-threshold', via: 'accept' }]);
});

test('recordFailureKind omits via when none is given and merges findings', () => {
  const t = { run_id: 'T-rec2' };
  const n = { node_id: 'n', result: { findings: ['a'] } };
  recordFailureKind(t, n, 'environment', { findings: ['a', 'b'] });
  assert.deepEqual(n.result.findings, ['a', 'b']);
  assert.equal('via' in ledger('T-rec2')[0], false);
});

test('recordFailureKind creates result only for ended-task and leaves state, stage_ok and attempt alone', () => {
  for (const via of ['dispatch', 'retry', 'answer']) {
    const t = { run_id: `T-end-${via}` };
    const n = { node_id: 'dispatch:P1:1', state: 'running', attempt: 3 };
    recordFailureKind(t, n, 'ended-task', { via });
    assert.deepEqual(n, { node_id: 'dispatch:P1:1', state: 'running', attempt: 3, result: { failure_kind: 'ended-task' } });
    assert.equal(ledger(`T-end-${via}`)[0].via, via);
    const done = { node_id: 'x', state: 'done', attempt: 2, result: { stage_ok: true } };
    recordFailureKind(t, done, 'ended-task', { via });
    assert.deepEqual(done, { node_id: 'x', state: 'done', attempt: 2, result: { stage_ok: true, failure_kind: 'ended-task' } });
  }
  const bare = { node_id: 'y' };
  recordFailureKind({ run_id: 'T-bare' }, bare, 'environment');
  assert.equal(bare.result, undefined);
  assert.equal(ledger('T-bare')[0].failure_kind, 'environment');
});

test('recordFailureKind does not throw when the ledger write fails', () => {
  // The task dir exists as a FILE, so appending its ledger cannot succeed.
  mkdirSync(join(root, 'T-bad-parent'), { recursive: true });
  writeFileSync(join(root, 'T-bad-parent', 'ledger.jsonl'), 'x');
  const blocked = { run_id: 'T-blocked' };
  writeFileSync(join(root, 'T-blocked'), 'a file where the task dir should be');
  const n = { node_id: 'n', result: {} };
  assert.doesNotThrow(() => recordFailureKind(blocked, n, 'capacity', { via: 'x' }));
  assert.equal(n.result.failure_kind, 'capacity');
  assert.doesNotThrow(() => recordFailureKind(undefined, undefined, 'capacity'));
  assert.doesNotThrow(() => recordFailureKind(null, { node_id: 'n' }, 'ended-task', { via: 'dispatch' }));
});

test('environmentEvidence orders stage evidence, error text, then ask text', () => {
  const out = environmentEvidence({
    result: {
      defects: [{ title: 'report not written', evidence: 'no 60-qa.md' }],
      findings: ['finding one'],
      evidence: 'an evidence line',
      error: 'Write denied by permissions',
      reason: 'child run abc has no file under /x',
      permission_denials: [denial('Write', '/w/a.md')],
    },
    stderr: 'ENOSPC: no space left on device',
    askText: 'asked: retry?',
  });
  assert.deepEqual(out, [
    'report not written: no 60-qa.md',
    'finding one',
    'an evidence line',
    'Write denied by permissions',
    'write denied: /w/a.md',
    'child run abc has no file under /x',
    'ENOSPC: no space left on device',
    'asked: retry?',
  ]);
});

test('environmentEvidence says the stage left no findings when nothing is present', () => {
  assert.deepEqual(environmentEvidence({}), ['the stage left no findings']);
  assert.deepEqual(environmentEvidence({ result: { findings: [], defects: [] }, stderr: '', askText: '' }), ['the stage left no findings']);
  assert.deepEqual(environmentEvidence(), ['the stage left no findings']);
});

test('escalationAsk is a stop-by-default ask card carrying its marker', () => {
  const ask = escalationAsk({ target: 'P2', stage: 'accept', gaps: ['no retry test', 'docs missing'] });
  assert.deepEqual(ask.options, ['stop the stage', 'retry once more with my answer as feedback']);
  assert.equal(ask.default, 'stop the stage');
  assert.deepEqual(ask.escalation, { target: 'P2', stage: 'accept', gaps: ['no retry test', 'docs missing'] });
  assert.match(ask.question, /P2/);
  assert.match(ask.question, /accept/);
  assert.match(ask.question, /no retry test/);
});

// card 129 U2: the repeat comparator. Fixture = E-89982ed5's plan-integrate rounds 1 and 2: the same
// card, the same contradiction pair, the same story ids in reworded prose with different line refs.
const PI_ROUND_1 = {
  accept: false,
  retry: [{ card: 'PLAN-F2', gaps: [
    "Scope: list every spawn site F1 names (taskmanager-drivers.mjs driverArgv and :460, daemon.mjs :102/:240). F2-US-1's test must check --strict-mcp-config.",
    "Out of scope: permit the files F2-US-3, F2-US-4 and F2-US-6 need, at broker-vendors.mjs:88-104.",
    'F2-US-4: say the telemetry fields do not replace the model field.',
  ] }],
  contradictions: [
    'PLAN-F2 vs PLAN-F1: F1 makes broker-tools.mjs:526 a spawn boundary; F2-US-1 requires the lean flags.',
    'PLAN-F2 vs itself: its Out of scope forbids what F2-US-3 needs.',
  ],
};
const PI_ROUND_2 = {
  accept: false,
  retry: [{ card: 'PLAN-F2', gaps: [
    'Scope: list every driver and judge spawn site F1 names: taskmanager-drivers.mjs driverArgv (:45/:54) and :113/:460. F2-US-1 A2.1 must check the flags.',
    'F2-US-1 A2.3: state where the per-session API call count is written, at broker-vendors.mjs:88-104.',
  ] }],
  contradictions: [
    'PLAN-F2 vs PLAN-F1: the adapter path F1 covers would start without the lean flags.',
    'PLAN-F2 vs PLAN-F1 (ledger): F1 writes the model through broker-vendors.mjs:88-104, F2 names tasklog.mjs.',
  ],
};
const PI = { planIntegrate: true };

test('rejectionKeys: reworded plan-integrate prose with the same card, pair and story ids is a repeat', () => {
  assert.deepEqual([...rejectionKeys(PI_ROUND_2, PI)].sort(), ['card:PLAN-F2', 'id:PLAN-F2:F2-US-1', 'pair:PLAN-F1|PLAN-F2']);
  const named = repeatedGaps(PI_ROUND_2, PI_ROUND_1, PI);
  assert.ok(named, 'round 2 names nothing round 1 did not');
  assert.match(named[0], /^PLAN-F2: Scope: list every driver/);
  assert.ok(named.some((x) => x.startsWith('PLAN-F2 vs PLAN-F1')), 'the contradictions are named too');
  assert.deepEqual([...rejectionKeys({ accept: true }, PI)], [], 'an accept holds no key');
  assert.ok(rejectionKeys({ accept: false, contradictions: ['PLAN-F2 vs itself: x'] }, PI).has('pair:PLAN-F2|PLAN-F2'), "'itself' is the card itself");
  assert.ok(rejectionKeys({ accept: false, contradictions: ['PLAN-F1 vs PLAN-F2 (ledger): x'] }, PI).has('pair:PLAN-F1|PLAN-F2'), 'the pair is sorted, a trailing note ignored');
});

test('rejectionKeys: same card with a new story id is not a repeat', () => {
  const worse = { ...PI_ROUND_2, retry: [{ card: 'PLAN-F2', gaps: [...PI_ROUND_2.retry[0].gaps, 'F2-US-5 has no acceptance'] }] };
  assert.equal(repeatedGaps(worse, PI_ROUND_1, PI), null);
  const otherCard = { ...PI_ROUND_2, retry: [...PI_ROUND_2.retry, { card: 'PLAN-F3', gaps: ['x'] }] };
  assert.equal(repeatedGaps(otherCard, PI_ROUND_1, PI), null, 'a new card is new');
  const otherPair = { ...PI_ROUND_2, contradictions: ['PLAN-F2 vs PLAN-F3: y'] };
  assert.equal(repeatedGaps(otherPair, PI_ROUND_1, PI), null, 'a new pair is new');
});

test('rejectionKeys: package gaps reworded with the same AC ids are a repeat, a new AC id is not', () => {
  const a1 = { accept: false, gaps: ['AC-3 not covered by any test (a.mjs:10)', 'F1-AC-2: the error path is missing'] };
  const a2 = { accept: false, gaps: ['no test for AC-3 at b.mjs:99-101', 'the error path of F1-AC-2 is still absent'] };
  assert.deepEqual([...rejectionKeys(a1)].sort(), ['id:AC-3', 'id:F1-AC-2']);
  assert.deepEqual(repeatedGaps(a2, a1), a2.gaps);
  assert.deepEqual(repeatedGaps({ accept: false, gaps: [a2.gaps[0]] }, a1), [a2.gaps[0]], 'the same gaps with one fixed is a repeat');
  assert.equal(repeatedGaps({ accept: false, gaps: [...a2.gaps, 'AC-4 missing'] }, a1), null);
  // id-less prose compares by its normalised text: line refs and trailing punctuation do not count.
  const p1 = { accept: false, gaps: ['The retry loop never backs off (x.mjs:12).'] };
  assert.ok(repeatedGaps({ accept: false, gaps: ['the retry loop never backs off (x.mjs:99)'] }, p1));
  assert.equal(repeatedGaps({ accept: false, gaps: ['the retry loop is unbounded'] }, p1), null, 'a reworded id-less gap is a new key');
});

test('rejectionKeys: floor-only refusals compare by the judge reason', () => {
  const f = { floor: 90 };
  const low = (judge_reason, match_pct = 87) => ({ accept: true, match_pct, gaps: [], judge_reason, reason: `match_pct ${match_pct} below the goal threshold 90` });
  assert.deepEqual([...rejectionKeys(low('Tests cover only half of the cases.'), f)], ['reason:tests cover only half of the cases']);
  assert.deepEqual(repeatedGaps(low('tests cover only half of the cases'), low('Tests cover only half of the cases.', 85), f), ['tests cover only half of the cases']);
  assert.equal(repeatedGaps(low('docs are missing'), low('tests cover only half of the cases'), f), null);
  assert.deepEqual([...rejectionKeys({ accept: true, match_pct: 95, gaps: [] }, f)], [], 'an accept at or over the floor holds no key');
  assert.deepEqual([...rejectionKeys({ accept: false, gaps: [] }, f)], [], 'a refusal with no words compares to nothing');
});

test('repeatedGaps: null on an empty set or a new key, the named gaps on a subset', () => {
  assert.equal(repeatedGaps({ accept: false, gaps: [] }, { accept: false, gaps: ['AC-1 x'] }), null, 'empty current');
  assert.equal(repeatedGaps({ accept: false, gaps: ['AC-1 x'] }, { accept: false, gaps: [] }), null, 'empty previous');
  assert.equal(repeatedGaps({ accept: false, gaps: ['AC-1 x', 'AC-2 y'] }, { accept: false, gaps: ['AC-1 x'] }), null, 'a new key');
  assert.equal(repeatedGaps(undefined, undefined), null);
  assert.deepEqual(repeatedGaps({ accept: false, gaps: ['AC-1 again'] }, { accept: false, gaps: ['AC-1 x', 'AC-2 y'] }), ['AC-1 again']);
});
