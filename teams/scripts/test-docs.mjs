// teams/scripts/test-docs.mjs - golden-file comparison for docs.mjs's renderers, plus a
// rebuild-produces-identical-output check (with no clock argument - the actual production call
// shape, since docs.mjs takes none; that is what makes byte-identical rebuild an honest claim
// rather than one only true under a test harness's fixed clock). The golden fixtures under
// teams/scripts/fixtures/docs-golden/ are generated once by running the real renderer and are
// then locked in - the usual way a golden test is bootstrapped.
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

// A task well past goal-gate, with a rejected-then-retried P1 and an accepted P2, PLUS all three
// phase-Teams turned on - exercises every renderer renderAll would reach for a task this far
// along, v0.12.0's three (10-planning/10-prd/60-qa) and v0.12.1's 65-audit.md included.
//
// The tail follows a full v0.12.1 loop rather than stopping at the first goal gate: audit round 1
// found US-2 unmet and filed D1, D1 was delivered, integrate:2 rebuilt the tree, and QA and the
// audit each ran a second round over it before the goal gate - which is the order the engine
// itself produces (taskmanager.mjs's integrate-completion and accept-completion hooks), not a
// shape invented for the fixture.
function fixtureTask(cwd) {
  return {
    run_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    cwd,
    request: 'change a.txt and b.txt together',
    context: 'from the requester: keep both in sync',
    team: { opts: { docs_dir: '.teams_output/team', max_parallel_teams: 2, roles: { planning: true, qa: true }, goal_threshold: 90 } },
    size: 'L', size_pinned: null, flow: 'develop', flow_chosen: 'develop',
    daemon: { pid: 4242 },
    planning_pkg: { id: 'PLAN', phase: 'planning', flow: 'plan', title: 'PRD', brief: 'change a.txt and b.txt together', acceptance: ['PRD covers the request'], deps: [], touches: [] },
    qa_pkg: { id: 'QA', phase: 'qa', flow: 'qa', integration_of: 'integrate:1', title: 'QA', brief: 'Run the goal-level QA pass over the integrated result.', acceptance: ['the integrated result has been exercised end to end'], deps: [], touches: [] },
    audit_pkg: { id: 'AUDIT', phase: 'audit', flow: 'audit', integration_of: 'integrate:2', title: 'planning audit', brief: 'Cross-check what was built against the PRD.', acceptance: ['every user story in the PRD is judged against the integrated result'], deps: [], touches: [] },
    spec: {
      acceptance: ['both modules build together'],
      packages: [
        { id: 'P1', title: 'module a', flow: 'develop', deps: [], touches: ['a.txt'], implements: ['US-1'], priority: 0 },
        { id: 'P2', title: 'module b', flow: 'develop', deps: ['P1'], touches: ['b.txt'], implements: ['US-2'], priority: 1 },
        { id: 'D1', title: 'US-2 -> b.txt was never wired to the exported path', flow: 'develop', reporter: 'planning-audit', deps: [], touches: ['b.txt'] },
      ],
    },
    nodes: [
      node('size', 'size', [], { state: 'done', result: { stage_ok: true, size: 'L' } }),
      node('dispatch:PLAN:1', 'dispatch', ['size'], { subgoal_id: 'PLAN', attempt: 1, state: 'done', result: { stage_ok: true, accept: true, match_pct: 95, checks: ['PRD written -> covers the request'], gaps: [], user_stories: ['US-1', 'US-2'] }, child: { cwd, run_id: 'plan1', branch: null, driver: { pid: 9, log: '/log/PLAN.jsonl' } } }),
      node('accept:PLAN:1', 'accept', ['dispatch:PLAN:1'], { subgoal_id: 'PLAN', attempt: 1, state: 'done', result: { stage_ok: true, accept: true, match_pct: 95, checks: ['PRD reviewed -> covers the request'], gaps: [] } }),
      node('shape', 'shape', ['accept:PLAN:1'], { state: 'done', result: { stage_ok: true } }),
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
      node('dispatch:QA:1', 'dispatch', ['integrate:1'], { subgoal_id: 'QA', attempt: 1, state: 'done', result: { stage_ok: true, accept: true, match_pct: 93, checks: ['exercised the integrated tree -> no defects found'], gaps: [] }, child: { cwd: '/wt/integration', run_id: 'qa1', branch: 'harness/aaaaaaaa/integration', driver: { pid: 10, log: '/log/QA.jsonl' } } }),
      node('accept:QA:1', 'accept', ['dispatch:QA:1'], { subgoal_id: 'QA', attempt: 1, state: 'done', result: { stage_ok: true, accept: true, match_pct: 93, checks: ['QA report reviewed -> no defects'], gaps: [] } }),
      node('dispatch:AUDIT:1', 'dispatch', ['accept:QA:1'], { subgoal_id: 'AUDIT', attempt: 1, state: 'done', result: { stage_ok: true, accept: true, match_pct: 91, checks: ['read the PRD against the tree -> US-2 unmet'], gaps: [] }, child: { cwd: '/wt/integration', run_id: 'audit1', branch: 'harness/aaaaaaaa/integration', driver: { pid: 11, log: '/log/AUDIT.jsonl' } } }),
      node('accept:AUDIT:1', 'accept', ['dispatch:AUDIT:1'], { subgoal_id: 'AUDIT', attempt: 1, state: 'done', result: { stage_ok: true, accept: true, match_pct: 91, checks: ['audit report reviewed -> one story unmet'], gaps: [], unmet: ['US-2 -> b.txt was never wired to the exported path'], filed: ['D1'] } }),
      node('dispatch:D1:1', 'dispatch', [], { subgoal_id: 'D1', attempt: 1, state: 'done', result: { stage_ok: true }, child: { cwd: '/wt/D1', run_id: 'd1', branch: 'harness/aaaaaaaa/D1', driver: { pid: 12, log: '/log/D1.jsonl' } } }),
      node('accept:D1:1', 'accept', ['dispatch:D1:1'], { subgoal_id: 'D1', attempt: 1, state: 'done', result: { stage_ok: true, accept: true, match_pct: 94, checks: ['the reproduction no longer reproduces'], gaps: [] } }),
      node('integrate:2', 'integrate', ['accept:D1:1'], {
        subgoal_id: null, state: 'done', supersedes: 'accept:AUDIT:1',
        result: { stage_ok: true, verified: true, checks: ['build -> ok'], conflicts: [] },
        integration: { cwd: '/wt/integration-2', branch: 'harness/aaaaaaaa/integration-2', merged: [{ package: 'P1', branch: 'harness/aaaaaaaa/P1', commit: 'c0ffee1' }, { package: 'P2', branch: 'harness/aaaaaaaa/P2', commit: 'c0ffee2' }, { package: 'D1', branch: 'harness/aaaaaaaa/D1', commit: 'c0ffee3' }] },
      }),
      node('dispatch:QA:2', 'dispatch', ['integrate:2'], { subgoal_id: 'QA', attempt: 2, state: 'done', result: { stage_ok: true, accept: true, match_pct: 94, checks: ['re-exercised the integrated tree -> no defects'], gaps: [] }, child: { cwd: '/wt/integration-2', run_id: 'qa2', branch: 'harness/aaaaaaaa/integration-2', driver: { pid: 13, log: '/log/QA.restart1.jsonl' } } }),
      node('accept:QA:2', 'accept', ['dispatch:QA:2'], { subgoal_id: 'QA', attempt: 2, state: 'done', result: { stage_ok: true, accept: true, match_pct: 94, checks: ['QA report reviewed -> no defects'], gaps: [] } }),
      node('dispatch:AUDIT:2', 'dispatch', ['accept:QA:2'], { subgoal_id: 'AUDIT', attempt: 2, state: 'done', result: { stage_ok: true, accept: true, match_pct: 96, checks: ['reread the PRD against the rebuilt tree -> every story met'], gaps: [] }, child: { cwd: '/wt/integration-2', run_id: 'audit2', branch: 'harness/aaaaaaaa/integration-2', driver: { pid: 14, log: '/log/AUDIT.restart1.jsonl' } } }),
      node('accept:AUDIT:2', 'accept', ['dispatch:AUDIT:2'], { subgoal_id: 'AUDIT', attempt: 2, state: 'done', result: { stage_ok: true, accept: true, match_pct: 96, checks: ['audit report reviewed -> every story met'], gaps: [], unmet: [], filed: [] } }),
      node('gate:goal:1', 'gate', ['accept:AUDIT:2'], { subgoal_id: null, state: 'done', result: { stage_ok: true, accept: true, match_pct: 96, checks: ['reread the request -> matches'], gaps: [], spec_drift: [] } }),
      node('report', 'report', [], { after: ['gate:goal:1'], state: 'done', result: { stage_ok: true, handoff: 'Both modules delivered and integrated; goal gate accepted at 96%.' } }),
    ],
  };
}

function goldenPath(name) { return join(GOLDEN, name); }
function readGolden(name) { return readFileSync(goldenPath(name), 'utf8'); }

test('renderAll produces exactly the files this fixture has data for (13/14 - only 15-spec-gate.md excluded), matching the golden fixtures byte for byte', () => {
  const task = fixtureTask('/proj');
  const files = renderAll(task);
  const expectedNames = ['INDEX.md', '00-request.md', '10-planning.md', '10-prd.md', '20-shape.md', '30-critique.md', '40-stories/P1.md', '40-stories/P2.md', '40-stories/D1.md', '50-integrate.md', '60-qa.md', '65-audit.md', '70-goal-gate.md', '80-report.md', 'retro.json'];
  const paths = docPaths(task);
  const expectedPaths = new Set([paths.index, paths.request, paths.planning, paths.prd, paths.shape, paths.critique, paths.story('P1'), paths.story('P2'), paths.story('D1'), paths.integrate, paths.qa, paths.audit, paths.goalGate, paths.report, paths.retro]);
  assert.deepEqual(new Set(Object.keys(files)), expectedPaths);
  for (const name of expectedNames) {
    assert.equal(files[join(paths.dir, name)], readGolden(name), `${name} did not match its golden file`);
  }
});

// The one claim the byte-for-byte comparison above makes but does not spell out: 65-audit.md is
// the page that carries what the audit actually produced, and a STORY a FIRST round filed stays
// on it after a second round found nothing (renderAudit aggregates filed[] over rounds and takes
// unmet[] from the latest).
test('65-audit.md links the STORY the audit filed in an earlier round, and shows the latest round\'s unmet list', () => {
  const task = fixtureTask('/proj');
  const page = renderAll(task)[docPaths(task).audit];
  assert.match(page, /## STORYs filed\n- \[D1\]\(\.\/40-stories\/D1\.md\)/);
  assert.match(page, /rounds: 2/);
  assert.match(page, /## Unmet user stories \(latest round\)\n- \(none\)/);
  assert.match(renderAll(task)[docPaths(task).story('D1')], /reporter: planning-audit/);
});

test('writeDocs({rebuild:true}) reproduces byte-identical files from engine state alone, with no clock passed - the actual production call shape', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'docs-rebuild-'));
  try {
    const task = fixtureTask(cwd);
    const first = writeDocs(task, { rebuild: true });
    const firstBytes = Object.fromEntries(first.map((p) => [p, readFileSync(p, 'utf8')]));
    const second = writeDocs(task, { rebuild: true });
    assert.deepEqual(second.sort(), first.sort(), 'rebuild wrote the same set of files');
    for (const p of second) assert.equal(readFileSync(p, 'utf8'), firstBytes[p], `${p} changed on rebuild even though task.json did not`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('writeDocs without rebuild leaves a stale file from a dropped package - rebuild:true is what clears it', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'docs-stale-'));
  try {
    const task = fixtureTask(cwd);
    writeDocs(task, { rebuild: true });
    const paths = docPaths(task);
    task.spec.packages = task.spec.packages.filter((p) => p.id !== 'P2'); // P2 dropped by a reshape
    const withoutRebuild = writeDocs(task);
    assert.ok(readdirSync(join(paths.dir, '40-stories')).includes('P2.md'), 'stale file survives a non-rebuild write');
    assert.ok(!withoutRebuild.includes(paths.story('P2')), 'but renderAll itself no longer names it');
    writeDocs(task, { rebuild: true });
    assert.ok(!readdirSync(join(paths.dir, '40-stories')).includes('P2.md'), 'rebuild:true removes it');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// The PRD page printed "[object Object]" for every story long after the same bug was fixed in
// shape's path (2026-09-22): user_stories arrive from gate:goal as {id, title, acceptance}
// objects, and this page rendered them straight through bullets(). Found by reading the page a
// real run produced, not by a test - which is why this one exists.
test('the PRD page lists user stories by id, never as [object Object]', async () => {
  const { renderPrd } = await import('../mcp/docs.mjs');
  const task = {
    run_id: 'aaaaaaaa-1111-2222-3333-444444444444',
    cwd: '/tmp/x',
    request: 'build a thing',
    planning_pkg: { id: 'PLAN', title: 'PRD', phase: 'planning' },
    nodes: [{
      node_id: 'dispatch:PLAN:1', stage: 'dispatch', subgoal_id: 'PLAN', state: 'done',
      child: { run_id: 'cccccccc-1111-2222-3333-444444444444', cwd: '/tmp/x' },
      result: {
        accept: true,
        user_stories: [
          { id: 'US-1', title: 'Fan queue admission', acceptance: ['a'] },
          { id: 'US-2', title: 'Atomic hold', acceptance: ['b'] },
        ],
      },
    }],
  };
  const page = renderPrd(task);
  assert.doesNotMatch(page, /\[object Object\]/, page);
  assert.match(page, /US-1 - Fan queue admission/);
  assert.match(page, /US-2 - Atomic hold/);
});
