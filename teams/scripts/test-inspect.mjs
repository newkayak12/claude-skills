// test-inspect.mjs - the read-only "what did this task actually do" surface.
//
// Written after 2026-09-22's inspection: everything below was already on disk and nothing
// surfaced it, which is how "no node ever loaded a skill" survived every run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findTasks, collect, skillsAudit, managerSkillsAsked, childSkillsAsked } from './lib/inspect-collect.mjs';
import { renderReport } from './inspect.mjs';

const RUN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// A workspace shaped exactly like a bench one: <ws>/.harness-tasks/<id>/task.json plus the
// child run under <ws>/.teams_output/broker/runs/<run>.json.
function workspace({ childNodes, taskNodes, roles = { planning: true, qa: false }, childCwd } = {}) {
  const ws = mkdtempSync(join(tmpdir(), 'insp-'));
  const taskId = '11111111-2222-3333-4444-555555555555';
  const taskDir = join(ws, '.harness-tasks', taskId);
  mkdirSync(join(taskDir, 'briefings'), { recursive: true });
  mkdirSync(join(ws, '.teams_output', 'broker', 'runs'), { recursive: true });
  writeFileSync(join(taskDir, 'briefings', 'shape.md'), '# shape briefing\nbody\n');
  const task = {
    run_id: taskId,
    cwd: ws,
    request: 'build the thing',
    size: 'L',
    flow: 'develop',
    team: { opts: { roles, docs_dir: join('.teams_output', 'team') } },
    nodes: taskNodes || [
      { node_id: 'size', stage: 'size', state: 'done', result: { size: 'L', skills_used: ['none'] } },
      { node_id: 'dispatch:PLAN:1', stage: 'dispatch', state: 'running', child: { cwd: childCwd === undefined ? ws : childCwd, run_id: RUN_ID } },
      { node_id: 'shape', stage: 'shape', state: 'pending' },
    ],
  };
  writeFileSync(join(taskDir, 'task.json'), JSON.stringify(task));
  const run = {
    run_id: RUN_ID,
    cwd: ws,
    flow: 'plan',
    mixed: false,
    goal: 'write the PRD',
    spec: { goal: 'write the PRD', acceptance: ['covers it'], subgoals: [{ id: 'U1', kind: 'planning', title: 'rules', acceptance: ['a'], files: ['PRD.md'] }] },
    nodes: childNodes || [
      { node_id: 'plan', stage: 'plan', state: 'done', result: { stage_ok: true } },
      { node_id: 'draft:U1:1', stage: 'draft', state: 'done', result: { stage_ok: true, changed_files: ['PRD.md'], skills_used: ['pm:prd-development'] } },
      { node_id: 'gate:U1:1', stage: 'gate', state: 'done', result: { accept: true, match_pct: 90, skills_used: ['none'] } },
    ],
  };
  writeFileSync(join(ws, '.teams_output', 'broker', 'runs', `${RUN_ID}.json`), JSON.stringify(run));
  return { ws, taskDir, taskId };
}

test('findTasks accepts a bench workspace, a task directory, and a tasks root alike', () => {
  const { ws, taskDir } = workspace();
  try {
    assert.equal(findTasks(ws).length, 1, 'a workspace: found under .harness-tasks/');
    assert.equal(findTasks(taskDir).length, 1, 'the task directory itself');
    assert.equal(findTasks(join(ws, '.harness-tasks')).length, 1, 'a tasks root');
    assert.deepEqual(findTasks(join(ws, 'nope')), [], 'a path that does not exist is empty, not an error');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('the report names, per node, the method it was told to load and the method it reported', () => {
  const { ws, taskDir } = workspace();
  try {
    const f = findTasks(taskDir)[0];
    const model = collect(f.dir, f.task);
    const shape = model.manager.nodes.find((n) => n.node_id === 'shape');
    assert.deepEqual(shape.skills_asked, ['develop:domain-driven-design', 'develop:architecture-designer']);
    assert.equal(shape.skills_used, null, 'a node that never ran reported nothing');
    assert.equal(shape.files.prompt, join(taskDir, 'briefings', 'shape.md'), 'its briefing on disk is named');

    const draft = model.children[0].nodes.find((n) => n.node_id === 'draft:U1:1');
    assert.ok(draft.skills_asked.includes('pm:prd-development'), `${draft.skills_asked}`);
    assert.deepEqual(draft.skills_used, ['pm:prd-development']);
    assert.deepEqual(draft.changed_files, ['PRD.md']);

    const text = renderReport(model);
    assert.match(text, /pm:prd-development/);
    assert.match(text, /PRD\.md/);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('the skills audit reports a named-but-never-loaded skill, which is the 0.18.0 bug', () => {
  const { ws, taskDir } = workspace();
  try {
    const model = collect(findTasks(taskDir)[0].dir, findTasks(taskDir)[0].task);
    const audit = skillsAudit(model);
    const dda = audit.skills.find((r) => r.skill === 'develop:domain-driven-design');
    assert.equal(dda.asked, 1);
    assert.equal(dda.used, 0);
    assert.ok(audit.never_loaded.includes('develop:domain-driven-design'));
    assert.ok(!audit.never_loaded.includes('pm:prd-development'), 'a skill a node did load is not reported as never loaded');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('a node that answered "none" counts as reporting, not as silence', () => {
  const { ws, taskDir } = workspace();
  try {
    const model = collect(findTasks(taskDir)[0].dir, findTasks(taskDir)[0].task);
    assert.equal(model.skills.nodes_reporting, 3, 'size, draft and gate each carried a skills_used field - "none" is an answer');
    assert.equal(model.skills.nodes_silent, 1, 'only the plan node finished without the field');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('a child run is still found when the workspace was moved away from the cwd the node recorded', () => {
  const { ws, taskDir } = workspace({ childCwd: '/nonexistent/old/path' });
  try {
    const model = collect(findTasks(taskDir)[0].dir, findTasks(taskDir)[0].task);
    assert.equal(model.children.length, 1);
    assert.ok(!model.children[0].missing, 'the run file is found under the task cwd and the workspace');
    assert.equal(model.children[0].nodes.length, 3);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('files a node reported writing are collected with the node that claimed each', () => {
  const { ws, taskDir } = workspace();
  try {
    const model = collect(findTasks(taskDir)[0].dir, findTasks(taskDir)[0].task);
    assert.equal(model.artifacts.length, 1);
    assert.equal(model.artifacts[0].path, 'PRD.md');
    assert.ok(model.artifacts[0].by[0].endsWith('draft:U1:1'));
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('the phase-document tree is listed with what exists and what does not', () => {
  const { ws, taskDir } = workspace();
  try {
    mkdirSync(join(ws, '.teams_output', 'team'), { recursive: true });
    writeFileSync(join(ws, '.teams_output', 'team', '10-prd.md'), '# prd\n');
    const model = collect(findTasks(taskDir)[0].dir, findTasks(taskDir)[0].task);
    const byName = Object.fromEntries(model.docs.files.map((f) => [f.name, f.exists]));
    assert.equal(byName['10-prd.md'], true);
    assert.equal(byName['65-audit.md'], false);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('managerSkillsAsked and childSkillsAsked honour an override and a spec-named method', () => {
  assert.deepEqual(managerSkillsAsked({ stage_skills: false }, { node_id: 'shape', stage: 'shape' }), []);
  assert.deepEqual(managerSkillsAsked({ stage_skills: { shape: ['x:y'] } }, { node_id: 'shape', stage: 'shape' }), ['x:y']);
  const run = { flow: 'develop', spec: { subgoals: [{ id: 'U1', kind: 'subgoal', skills: ['mine:own'] }] } };
  assert.ok(childSkillsAsked(run, { node_id: 'implement:U1:1', stage: 'implement' }).includes('mine:own'),
    "a spec that names its own method replaces the kind's, for the hand that writes");
  assert.ok(childSkillsAsked(run, { node_id: 'gate:U1:1', stage: 'gate' }).includes('think:devils-advocate'),
    "a judge keeps the family's method, not the author's");
});
