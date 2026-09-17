// docs.mjs - §7c's phase markdown, rendered from task.json. Pure render functions plus exactly
// one impure function (writeDocs) that writes them - the engine never reads any of this back
// (md is a rendered view, never a second source of truth, same principle as tickets.mjs's §4).
//
// Scoped to the phases that exist without a planning/qa Team (v0.12+ wires those in - see the
// plan's head): INDEX, the request, the shape, the critique, one page per STORY, the integrate
// round, the goal gate, and the report. 10-planning/10-prd/15-spec-gate/60-qa/65-audit are not
// rendered - there is no data behind them yet, and an empty file would claim a feature that does
// not exist.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  epicKey, storyKey, docPaths, latestBySubgoal, epicTicketState, epicPhase,
  storyTicketState, storyTaskProgress, epicBoardRows,
} from './tickets.mjs';

function bullets(list) {
  return (list || []).map((x) => `- ${x}`).join('\n') || '- (none)';
}
// A cheap monotonic stand-in for a real revision counter - task.json has none (see the plan's
// 발견 6). Grows every time a node finishes, which is exactly when a re-render would differ.
function rev(task) {
  return task.nodes.filter((n) => n.result).length;
}
function frontmatter(key, state, task, now) {
  return ['---', `key: ${key}`, `state: ${state}`, `updated: ${new Date(now).toISOString()}`, `source: task.json@${rev(task)}`, '---', ''].join('\n');
}

export function renderIndex(task, now = Date.now()) {
  const key = epicKey(task.run_id);
  const state = epicTicketState(task);
  const phase = epicPhase(task);
  const rows = epicBoardRows(task);
  const L = [frontmatter(key, state, task, now), `# ${key} — ${String(task.request).slice(0, 60)}`, ''];
  L.push(`state: ${state} · phase: ${phase || '(done)'} · leader: ${task.leader ? `pid ${task.leader.pid}` : '—'}`, '');
  L.push('| key | role | state | tasks | last verdict |', '|---|---|---|---|---|');
  for (const r of rows) L.push(`| ${r.id} | ${r.role} | ${r.state} | ${r.tasks || '—'} | ${r.last_verdict} |`);
  L.push('', '## Sections', '', '- [Request](./00-request.md)');
  if (task.spec) {
    L.push('- [Shape](./20-shape.md)');
    if (task.nodes.some((n) => n.stage === 'critique' && n.result)) L.push('- [Critique](./30-critique.md)');
    for (const p of task.spec.packages) L.push(`- [${p.id}](./40-stories/${p.id}.md)`);
  }
  if (task.nodes.some((n) => n.stage === 'integrate' && n.result)) L.push('- [Integrate](./50-integrate.md)');
  if (task.nodes.some((n) => n.stage === 'gate' && n.subgoal_id === null && n.result)) L.push('- [Goal gate](./70-goal-gate.md)');
  if (task.nodes.some((n) => n.stage === 'report' && n.state === 'done')) L.push('- [Report](./80-report.md)');
  return L.join('\n') + '\n';
}

export function renderRequest(task, now = Date.now()) {
  const key = epicKey(task.run_id);
  const T = (task.team && task.team.opts) || {};
  const L = [frontmatter(key, epicTicketState(task), task, now), '# Request', '', String(task.request), ''];
  L.push('## Context', task.context ? String(task.context) : '(none)', '');
  L.push('## Team snapshot');
  L.push(`- interactive: ${T.interactive === true}`);
  L.push(`- max_parallel_teams: ${T.max_parallel_teams == null ? '—' : T.max_parallel_teams}`);
  L.push(`- roles: planning=${(T.roles && T.roles.planning) === true}, qa=${(T.roles && T.roles.qa) === true}`);
  L.push(`- goal_threshold: ${T.goal_threshold == null ? '—' : T.goal_threshold}`, '');
  L.push('## Size', `- pinned: ${task.size_pinned || '(not pinned)'}`, `- measured: ${task.size || '(pending)'}`);
  L.push(`- flow: ${task.flow !== 'auto' ? task.flow : (task.flow_chosen || 'auto')}`);
  return L.join('\n') + '\n';
}

export function renderShape(task, now = Date.now()) {
  const key = epicKey(task.run_id);
  const L = [frontmatter(key, epicTicketState(task), task, now), '# Shape', ''];
  L.push('Acceptance:', bullets(task.spec.acceptance), '');
  L.push('| id | title | flow | deps | touches |', '|---|---|---|---|---|');
  for (const p of task.spec.packages) {
    L.push(`| ${p.id} | ${p.title || ''} | ${p.flow || 'auto'} | ${(p.deps || []).join(', ') || '—'} | ${(p.touches || []).join(', ') || '—'} |`);
  }
  return L.join('\n') + '\n';
}

export function renderCritique(task, now = Date.now()) {
  const critique = task.nodes.filter((n) => n.stage === 'critique' && n.result).pop();
  const r = critique.result;
  const key = epicKey(task.run_id);
  const L = [frontmatter(key, epicTicketState(task), task, now), '# Critique', ''];
  L.push(`sound: ${r.sound === true}`, '');
  L.push('Blocking:', bullets(r.blocking), '', 'Problems:', bullets(r.problems));
  return L.join('\n') + '\n';
}

export function renderStory(task, pkgId, now = Date.now()) {
  const pkg = (task.spec.packages || []).find((p) => String(p.id) === String(pkgId));
  const key = storyKey(task.run_id, pkgId);
  const state = storyTicketState(task, pkgId);
  const dispatch = latestBySubgoal(task, pkgId, 'dispatch');
  const accept = latestBySubgoal(task, pkgId, 'accept');
  const r = accept && accept.result;
  const L = [frontmatter(key, state, task, now), `# ${pkgId} — ${(pkg && pkg.title) || ''}`, ''];
  L.push(`state: ${state} · tasks: ${storyTaskProgress(task, pkgId) || '—'} · reporter: ${pkg && pkg.repair ? 'repair' : 'shape'}`, '');
  if (dispatch && dispatch.child) L.push(`worktree: ${dispatch.child.cwd} on branch ${dispatch.child.branch}`, '');
  L.push('## Last verdict');
  if (r) {
    L.push(`accept: ${r.accept === true} · match_pct: ${r.match_pct == null ? '—' : r.match_pct}`, '');
    L.push('Checks:', bullets(r.checks), '', 'Gaps:', bullets(r.gaps));
  } else {
    L.push('(not judged yet)');
  }
  if (dispatch && dispatch.child && dispatch.child.driver) L.push('', '## Driver', `log: ${dispatch.child.driver.log}`);
  return L.join('\n') + '\n';
}

export function renderIntegrate(task, now = Date.now()) {
  const n = task.nodes.filter((x) => x.stage === 'integrate' && x.result).pop();
  const r = n.result;
  const key = epicKey(task.run_id);
  const L = [frontmatter(key, epicTicketState(task), task, now), `# Integrate (${n.node_id})`, ''];
  L.push(`verified: ${r.verified === true}`, '');
  if (n.integration) L.push(`branch: ${n.integration.branch}`, 'Merged:', bullets((n.integration.merged || []).map((m) => `${m.package}: ${m.branch} -> ${m.commit}`)), '');
  L.push('Checks:', bullets(r.checks), '', 'Conflicts:', bullets(r.conflicts));
  return L.join('\n') + '\n';
}

export function renderGoalGate(task, now = Date.now()) {
  const n = task.nodes.filter((x) => x.stage === 'gate' && x.subgoal_id === null && x.result).pop();
  const r = n.result;
  const key = epicKey(task.run_id);
  const L = [frontmatter(key, epicTicketState(task), task, now), `# Goal gate (${n.node_id})`, ''];
  L.push(`accept: ${r.accept === true} · match_pct: ${r.match_pct == null ? '—' : r.match_pct}`, '');
  L.push('Checks:', bullets(r.checks), '', 'Gaps:', bullets(r.gaps), '', 'Spec drift:', bullets(r.spec_drift));
  return L.join('\n') + '\n';
}

export function renderReport(task, now = Date.now()) {
  const n = task.nodes.find((x) => x.stage === 'report' && x.state === 'done');
  const key = epicKey(task.run_id);
  const L = [frontmatter(key, 'DONE', task, now), '# Report', ''];
  L.push(String((n.result && n.result.handoff) || ''));
  return L.join('\n') + '\n';
}

// Every file this task currently has data for, keyed by its full path. A shape not yet done
// means only INDEX + request exist; a fresh gate:goal round adds the goal-gate file; and so on -
// nothing is ever rendered ahead of the data that would back it.
export function renderAll(task, now = Date.now()) {
  const paths = docPaths(task);
  const files = { [paths.index]: renderIndex(task, now), [paths.request]: renderRequest(task, now) };
  if (task.spec) {
    files[paths.shape] = renderShape(task, now);
    if (task.nodes.some((n) => n.stage === 'critique' && n.result)) files[paths.critique] = renderCritique(task, now);
    for (const p of task.spec.packages) files[paths.story(p.id)] = renderStory(task, String(p.id), now);
  }
  if (task.nodes.some((n) => n.stage === 'integrate' && n.result)) files[paths.integrate] = renderIntegrate(task, now);
  if (task.nodes.some((n) => n.stage === 'gate' && n.subgoal_id === null && n.result)) files[paths.goalGate] = renderGoalGate(task, now);
  if (task.nodes.some((n) => n.stage === 'report' && n.state === 'done')) files[paths.report] = renderReport(task, now);
  return files;
}

// The one write site. rebuild:true deletes the EPIC's whole docs directory first, so a stale
// file from a superseded package (a reshape that dropped it) cannot linger - every remaining
// call writes fresh files over whatever is there.
export function writeDocs(task, opts = {}) {
  const files = renderAll(task, opts.now);
  if (opts.rebuild) {
    try { rmSync(docPaths(task).dir, { recursive: true, force: true }); } catch { /* nothing to remove */ }
  }
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return Object.keys(files);
}
