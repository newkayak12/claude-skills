// graph-expand.mjs: expandSubgoals (chains, fold, goal gate, report) and computeWriteScope.
//   node --test teams/scripts/test-graph-expand.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandSubgoals, computeWriteScope } from '../mcp/graph-expand.mjs';
import { createRun, getNode } from '../mcp/graph-nodes.mjs';

const withRun = (opts, fn) => {
  const cwd = mkdtempSync(join(tmpdir(), 'graph-expand-'));
  try { return fn(createRun({ cwd, request: 'r', ...opts })); } finally { rmSync(cwd, { recursive: true, force: true }); }
};
const ids = (run) => run.nodes.map((n) => n.node_id);

test('one subgoal: its chain, a goal gate straight on the subgoal gate, and the report behind the gate', () => {
  withRun({}, (run) => {
    expandSubgoals(run, [{ id: 'U1' }]);
    assert.deepEqual(ids(run).slice(3), ['implement:U1:1', 'test:U1:1', 'gate:U1:1', 'gate:goal:1', 'report']);
    assert.deepEqual(getNode(run, 'implement:U1:1').deps, ['critique']);
    assert.deepEqual(getNode(run, 'gate:goal:1').deps, ['gate:U1:1'], 'no reduce for a single subgoal');
    assert.deepEqual(getNode(run, 'report').after, ['gate:goal:1'], 'order-only, not a data edge');
  });
});

test('several subgoals: reduce folds the gates, the goal gate depends on reduce and keeps the gates as `after`', () => {
  withRun({ goal_judges: 2 }, (run) => {
    expandSubgoals(run, [{ id: 'U1' }, { id: 'U2', deps: ['U1'], kind: 'document' }]);
    assert.deepEqual(getNode(run, 'implement:U2:1') || null, null, 'a document subgoal has a document chain');
    assert.deepEqual(getNode(run, 'draft:U2:1').deps, ['critique', 'gate:U1:1']);
    assert.deepEqual(getNode(run, 'reduce').deps, ['gate:U1:1', 'gate:U2:1']);
    assert.deepEqual(getNode(run, 'gate:goal:1').deps, ['reduce']);
    assert.deepEqual(getNode(run, 'gate:goal:1').after, ['gate:U1:1', 'gate:U2:1']);
    assert.ok(getNode(run, 'gate:goal:1b'), 'two judges');
    assert.deepEqual(getNode(run, 'report').after, ['gate:goal:1', 'gate:goal:1b']);
  });
});

test('a re-expansion after a spec retry takes the next round so retired ids are not re-pushed', () => {
  withRun({}, (run) => {
    expandSubgoals(run, [{ id: 'U1' }]);
    run.nodes.push({ node_id: 'critique:2', stage: 'critique', state: 'done', deps: [], after: [] });
    expandSubgoals(run, [{ id: 'U1' }]);
    assert.ok(getNode(run, 'implement:U1:2') && getNode(run, 'gate:goal:2') && getNode(run, 'report:2'));
    assert.deepEqual(getNode(run, 'implement:U1:2').deps, ['critique:2'], 'it hangs off the live critique');
  });
});

test('a STORY-level assignee covers each subgoal without its own, and an interactive run parks the author node', () => {
  withRun({ interactive: true, subgoal_assignee: { by: 'user', who: 'kim' } }, (run) => {
    const spec = [{ id: 'U1' }, { id: 'U2', assignee: { by: 'user', who: 'own' } }];
    expandSubgoals(run, spec);
    assert.equal(spec[0].assignee.who, 'kim');
    assert.equal(spec[1].assignee.who, 'own', 'a subgoal pinned already keeps its own');
    assert.equal(getNode(run, 'implement:U1:1').assignment.who, 'kim');
    assert.equal(getNode(run, 'implement:U2:1').assignment.who, 'own');
    assert.equal(getNode(run, 'test:U1:1').assignment, undefined, 'a judging stage is never pinned');
  });
});

test('computeWriteScope: reads the subgoal gates off deps and after, and reports collisions over changed_files', () => {
  withRun({}, (run) => {
    run.spec = { subgoals: [{ id: 'U1', files: ['a.mjs'] }, { id: 'U2', files: ['a.mjs'] }] };
    expandSubgoals(run, run.spec.subgoals);
    getNode(run, 'implement:U1:1').result = { changed_files: ['a.mjs'] };
    getNode(run, 'implement:U2:1').result = { changed_files: ['a.mjs', 'b.mjs'] };
    const viaDeps = computeWriteScope(run, getNode(run, 'reduce'));
    const viaAfter = computeWriteScope(run, getNode(run, 'gate:goal:1'));
    assert.deepEqual(viaAfter, viaDeps, 'either wiring reads the same gates');
    assert.ok(JSON.stringify(viaDeps).includes('a.mjs'), 'the shared file shows up');
  });
});

test('computeWriteScope: a node with no subgoal gates, or a run with no spec, finds nothing to collide', () => {
  const out = computeWriteScope({ nodes: [] }, { deps: [], after: [] });
  for (const v of Object.values(out)) assert.ok(Array.isArray(v) && v.length === 0);
});
