// teams/scripts/test-docs.mjs - golden-file comparison for docs.mjs's renderers, plus a
// rebuild-produces-identical-output check. The golden fixtures under
// teams/scripts/fixtures/docs-golden/ are generated once (see fixtures/docs-golden/GENERATE.mjs)
// by running the real renderer and are then locked in - the usual way a golden test is bootstrapped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { node } from '../mcp/graph.mjs';
import { renderAll, writeDocs } from '../mcp/docs.mjs';
import { docPaths } from '../mcp/tickets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, 'fixtures', 'docs-golden');
const NOW = 1758000000000; // fixed clock: every render in this file must be byte-identical run to run

// A task well past goal-gate, with a rejected-then-retried P1 and an accepted P2 - exercises
// every renderer renderAll would reach for a task this far along.
function fixtureTask(cwd) {
  return {
    run_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    cwd,
    request: 'change a.txt and b.txt together',
    context: 'from the requester: keep both in sync',
    team: { opts: { docs_dir: '.teams_output/team', interactive: false, max_parallel_teams: 2, roles: { planning: false, qa: false }, goal_threshold: 90 } },
    size: 'L', size_pinned: null, flow: 'develop', flow_chosen: 'develop',
    leader: { pid: 4242 },
    spec: {
      acceptance: ['both modules build together'],
      packages: [
        { id: 'P1', title: 'module a', flow: 'develop', deps: [], touches: ['a.txt'] },
        { id: 'P2', title: 'module b', flow: 'develop', deps: ['P1'], touches: ['b.txt'] },
      ],
    },
    nodes: [
      node('size', 'size', [], { state: 'done', result: { stage_ok: true, size: 'L' } }),
      node('shape', 'shape', ['size'], { state: 'done', result: { stage_ok: true } }),
      node('critique', 'critique', ['shape'], { state: 'done', result: { stage_ok: true, sound: true, blocking: [], problems: ['P1 and P2 could be one package'] } }),
      node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', attempt: 1, state: 'done', result: { stage_ok: true }, child: { cwd: '/wt/P1', run_id: 'c1', branch: 'harness/aaaaaaaa/P1', driver: { pid: 1, log: '/log/P1.jsonl' } } }),
      node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1', attempt: 1, state: 'failed', result: { stage_ok: true, accept: false, match_pct: 60, checks: ['built -> missing tests'], gaps: ['no test coverage'], reason: 'no test coverage' } }),
      node('dispatch:P1:2', 'dispatch', ['dispatch:P1:1'], { subgoal_id: 'P1', attempt: 2, state: 'done', result: { stage_ok: true }, child: { cwd: '/wt/P1', run_id: 'c1b', branch: 'harness/aaaaaaaa/P1', driver: { pid: 2, log: '/log/P1.restart1.jsonl' } } }),
      node('accept:P1:2', 'accept', ['dispatch:P1:2'], { subgoal_id: 'P1', attempt: 2, state: 'done', result: { stage_ok: true, accept: true, match_pct: 92, checks: ['built -> tests pass'], gaps: [] } }),
      node('dispatch:P2:1', 'dispatch', ['accept:P1:2'], { subgoal_id: 'P2', attempt: 1, state: 'done', result: { stage_ok: true }, child: { cwd: '/wt/P2', run_id: 'c2', branch: 'harness/aaaaaaaa/P2', driver: { pid: 3, log: '/log/P2.jsonl' } } }),
      node('accept:P2:1', 'accept', ['dispatch:P2:1'], { subgoal_id: 'P2', attempt: 1, state: 'done', result: { stage_ok: true, accept: true, match_pct: 95, checks: ['built -> ok'], gaps: [] } }),
      node('integrate:1', 'integrate', ['accept:P1:2', 'accept:P2:1'], {
        subgoal_id: null, state: 'done',
        result: { stage_ok: true, verified: true, checks: ['build -> ok'], conflicts: [] },
        integration: { cwd: '/wt/integration', branch: 'harness/aaaaaaaa/integration', merged: [{ package: 'P1', branch: 'harness/aaaaaaaa/P1', commit: 'c0ffee1' }, { package: 'P2', branch: 'harness/aaaaaaaa/P2', commit: 'c0ffee2' }] },
      }),
      node('gate:goal:1', 'gate', ['integrate:1'], { subgoal_id: null, state: 'done', result: { stage_ok: true, accept: true, match_pct: 96, checks: ['reread the request -> matches'], gaps: [], spec_drift: [] } }),
      node('report', 'report', [], { after: ['gate:goal:1'], state: 'done', result: { stage_ok: true, handoff: 'Both modules delivered and integrated; goal gate accepted at 96%.' } }),
    ],
  };
}

function goldenPath(name) { return join(GOLDEN, name); }
function readGolden(name) { return readFileSync(goldenPath(name), 'utf8'); }

test('renderAll produces exactly the files this fixture has data for, matching the golden fixtures byte for byte', () => {
  const task = fixtureTask('/proj');
  const files = renderAll(task, NOW);
  const expectedNames = ['INDEX.md', '00-request.md', '20-shape.md', '30-critique.md', '40-stories/P1.md', '40-stories/P2.md', '50-integrate.md', '70-goal-gate.md', '80-report.md'];
  const paths = docPaths(task);
  const expectedPaths = new Set([paths.index, paths.request, paths.shape, paths.critique, paths.story('P1'), paths.story('P2'), paths.integrate, paths.goalGate, paths.report]);
  assert.deepEqual(new Set(Object.keys(files)), expectedPaths);
  for (const name of expectedNames) {
    assert.equal(files[join(paths.dir, name)], readGolden(name), `${name} did not match its golden file`);
  }
});

test('writeDocs({rebuild:true}) reproduces byte-identical files - the property that matters, not any one file\'s content', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'docs-rebuild-'));
  try {
    const task = fixtureTask(cwd);
    const first = writeDocs(task, { rebuild: true, now: NOW });
    const firstBytes = Object.fromEntries(first.map((p) => [p, readFileSync(p, 'utf8')]));
    const second = writeDocs(task, { rebuild: true, now: NOW });
    assert.deepEqual(second.sort(), first.sort(), 'rebuild wrote the same set of files');
    for (const p of second) assert.equal(readFileSync(p, 'utf8'), firstBytes[p], `${p} changed on rebuild`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('writeDocs without rebuild leaves a stale file from a dropped package - rebuild:true is what clears it', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'docs-stale-'));
  try {
    const task = fixtureTask(cwd);
    writeDocs(task, { rebuild: true, now: NOW });
    const paths = docPaths(task);
    task.spec.packages = task.spec.packages.filter((p) => p.id !== 'P2'); // P2 dropped by a reshape
    const withoutRebuild = writeDocs(task, { now: NOW });
    assert.ok(readdirSync(join(paths.dir, '40-stories')).includes('P2.md'), 'stale file survives a non-rebuild write');
    assert.ok(!withoutRebuild.includes(paths.story('P2')), 'but renderAll itself no longer names it');
    writeDocs(task, { rebuild: true, now: NOW });
    assert.ok(!readdirSync(join(paths.dir, '40-stories')).includes('P2.md'), 'rebuild:true removes it');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
