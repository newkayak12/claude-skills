// docs.mjs - §7c's phase markdown, rendered from task.json. Pure render functions plus exactly
// one impure function (writeDocs) that writes them - the engine never reads any of this back
// (md is a rendered view, never a second source of truth, same principle as tickets.mjs's §4).
//
// v0.12.0 wires planning/qa into the EPIC flow as phase-Teams (taskmanager.mjs's task.planning_pkg
// and task.qa_pkg), and renders three more of §7c's 13: 10-planning.md, 10-prd.md, 60-qa.md.
// v0.12.1 adds the third phase-Team, the audit (task.audit_pkg), and with it 65-audit.md - which
// says more than the other two phase-Team pages because an audit's output is a list the manager
// acted on: the unmet user stories it named, and the STORYs those became. 15-spec-gate.md
// (v0.13.0's human gate) is the one file of §7c's 13 still without data behind it, and is not
// rendered - an empty file would claim a feature that does not exist.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { storyLabel } from './taskmanager.mjs';
import { loadRun, runState } from './graph.mjs';
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
// No `updated:` timestamp here on purpose: task.json carries no per-node completion clock (only
// created_at on the run and started_at/finished_at on the task, neither of which is "when this
// doc was rendered"), and a wall-clock `now` would make rebuild never byte-identical - the one
// property this whole layer exists to prove. `source: task.json@<rev>` already carries the
// freshness signal, and a reader who wants the write time has the file's own mtime.
function frontmatter(key, state, task) {
  return ['---', `key: ${key}`, `state: ${state}`, `source: task.json@${rev(task)}`, '---', ''].join('\n');
}

export function renderIndex(task) {
  const key = epicKey(task.run_id);
  const state = epicTicketState(task);
  const phase = epicPhase(task);
  const rows = epicBoardRows(task);
  const L = [frontmatter(key, state, task), `# ${key} — ${String(task.request).slice(0, 60)}`, ''];
  L.push(`state: ${state} · phase: ${phase || '(done)'} · daemon: ${task.daemon ? `pid ${task.daemon.pid}` : '—'}`, '');
  L.push('| key | role | state | tasks | last verdict |', '|---|---|---|---|---|');
  for (const r of rows) L.push(`| ${r.id} | ${r.role} | ${r.state} | ${r.tasks || '—'} | ${r.last_verdict} |`);
  L.push('', '## Sections', '', '- [Request](./00-request.md)');
  if (task.planning_pkg) L.push('- [Planning](./10-planning.md)', '- [PRD](./10-prd.md)');
  if (task.spec) {
    L.push('- [Shape](./20-shape.md)');
    if (task.nodes.some((n) => n.stage === 'critique' && n.result)) L.push('- [Critique](./30-critique.md)');
    for (const p of task.spec.packages) L.push(`- [${p.id}](./40-stories/${p.id}.md)`);
  }
  if (task.nodes.some((n) => n.stage === 'integrate' && n.result)) L.push('- [Integrate](./50-integrate.md)');
  if (task.qa_pkg) L.push('- [QA](./60-qa.md)');
  if (task.audit_pkg) L.push('- [Planning audit](./65-audit.md)');
  if (task.nodes.some((n) => n.stage === 'gate' && n.subgoal_id === null && n.result)) L.push('- [Goal gate](./70-goal-gate.md)');
  if (task.nodes.some((n) => n.stage === 'report' && n.state === 'done')) L.push('- [Report](./80-report.md)');
  return L.join('\n') + '\n';
}

export function renderRequest(task) {
  const key = epicKey(task.run_id);
  const T = (task.team && task.team.opts) || {};
  const L = [frontmatter(key, epicTicketState(task), task), '# Request', '', String(task.request), ''];
  L.push('## Context', task.context ? String(task.context) : '(none)', '');
  L.push('## Team snapshot');
  L.push(`- max_parallel_teams: ${T.max_parallel_teams == null ? '—' : T.max_parallel_teams}`);
  L.push(`- roles: planning=${(T.roles && T.roles.planning) === true}, qa=${(T.roles && T.roles.qa) === true}`);
  L.push(`- goal_threshold: ${T.goal_threshold == null ? '—' : T.goal_threshold}`, '');
  L.push('## Size', `- pinned: ${task.size_pinned || '(not pinned)'}`, `- measured: ${task.size || '(pending)'}`);
  L.push(`- flow: ${task.flow !== 'auto' ? task.flow : (task.flow_chosen || 'auto')}`);
  return L.join('\n') + '\n';
}

// A phase-Team's own dispatch/accept verdict, shared shape between renderPlanning and renderQa -
// both are "how did the phase-Team's run go", where the difference is only which package (and
// what to say about its worktree) each one is reporting on. Returns lines, not a joined string,
// so each caller can append its own closing line before joining once.
function phaseTeamLines(task, pkg, title, worktreeLine) {
  const key = storyKey(task.run_id, pkg.id);
  const state = storyTicketState(task, pkg.id);
  const dispatch = latestBySubgoal(task, pkg.id, 'dispatch');
  const accept = latestBySubgoal(task, pkg.id, 'accept');
  const r = accept && accept.result;
  const L = [frontmatter(key, state, task), `# ${title}`, ''];
  L.push(`state: ${state}`, '');
  if (dispatch && dispatch.child) L.push(worktreeLine(dispatch.child), '');
  L.push('## Last verdict');
  if (r) {
    L.push(`accept: ${r.accept === true} · match_pct: ${r.match_pct == null ? '—' : r.match_pct}`, '');
    L.push('Checks:', bullets(r.checks), '', 'Gaps:', bullets(r.gaps));
  } else {
    L.push('(not judged yet)');
  }
  return L;
}

export function renderPlanning(task) {
  const L = phaseTeamLines(task, task.planning_pkg, 'Planning phase-Team', (child) => `run: ${child.run_id} at ${child.cwd}`);
  L.push('', 'The PRD itself is rendered separately - see [PRD](./10-prd.md).');
  return L.join('\n') + '\n';
}

// Link/citation only (§7c verbatim rule): the PRD's own body lives in the planning phase-Team's
// child run, never copied here or into shape's briefing (taskmanager.mjs's composeTaskPrompt
// makes the same choice for the same reason).
export function renderPrd(task) {
  const pkg = task.planning_pkg;
  const key = storyKey(task.run_id, pkg.id);
  const dispatch = latestBySubgoal(task, pkg.id, 'dispatch');
  const userStories = (dispatch && dispatch.result && Array.isArray(dispatch.result.user_stories)) ? dispatch.result.user_stories : [];
  const L = [frontmatter(key, storyTicketState(task, pkg.id), task), '# PRD', ''];
  L.push('The PRD itself lives in the planning phase-Team\'s own child run; this page links to it and never repeats its body.', '');
  if (dispatch && dispatch.child) L.push(`- run: ${dispatch.child.run_id} at ${dispatch.child.cwd}`, '');
  // Stories arrive as {id, title, acceptance} objects; bullets(String(obj)) printed
  // "[object Object]" on this page long after the same bug was fixed in shape's path (2026-09-22).
  L.push('## User stories', bullets(userStories.map(storyLabel)));
  return L.join('\n') + '\n';
}

export function renderQa(task) {
  return phaseTeamLines(task, task.qa_pkg, 'QA', (child) => `worktree: ${child.cwd} (the integration tree)`).join('\n') + '\n';
}

// The audit's own page. phaseTeamLines carries the shared "how did the phase-Team's run go"
// half; what is particular to the audit is below it - the unmet stories are the audit's actual
// product, and the filed[] list is read from the accept node rather than recomputed from the
// package list, because a later round's STORYs would be indistinguishable from this one's.
export function renderAudit(task) {
  const rounds = task.nodes.filter((n) => n.stage === 'accept' && String(n.subgoal_id) === String(task.audit_pkg.id) && n.result);
  const last = rounds.length ? rounds[rounds.length - 1].result : {};
  // Unmet is the latest round's - an earlier round's unmet story was either filed or is still
  // unmet, and either way the latest round is the current truth. Filed is every round's, because
  // the STORYs a first round filed are still this audit's doing after a second round found none.
  const filed = rounds.flatMap((n) => (n.result.filed || []).map(String));
  const L = phaseTeamLines(task, task.audit_pkg, 'Planning audit', (child) => `worktree: ${child.cwd} (the integration tree)`);
  L.push('', `rounds: ${rounds.length}`);
  L.push('', '## Unmet user stories (latest round)', bullets((last.unmet || []).map((u) => (u && u.title) || String(u))));
  L.push('', '## STORYs filed', bullets(filed.map((id) => `[${id}](./40-stories/${id}.md)`)));
  return L.join('\n') + '\n';
}

export function renderShape(task) {
  const key = epicKey(task.run_id);
  const L = [frontmatter(key, epicTicketState(task), task), '# Shape', ''];
  L.push('Acceptance:', bullets(task.spec.acceptance), '');
  L.push('| id | title | flow | deps | touches |', '|---|---|---|---|---|');
  for (const p of task.spec.packages) {
    L.push(`| ${p.id} | ${p.title || ''} | ${p.flow || 'auto'} | ${(p.deps || []).join(', ') || '—'} | ${(p.touches || []).join(', ') || '—'} |`);
  }
  return L.join('\n') + '\n';
}

export function renderCritique(task) {
  const critique = task.nodes.filter((n) => n.stage === 'critique' && n.result).pop();
  const r = critique.result;
  const key = epicKey(task.run_id);
  const L = [frontmatter(key, epicTicketState(task), task), '# Critique', ''];
  L.push(`sound: ${r.sound === true}`, '');
  L.push('Blocking:', bullets(r.blocking), '', 'Problems:', bullets(r.problems));
  return L.join('\n') + '\n';
}

export function renderStory(task, pkgId) {
  const pkg = (task.spec.packages || []).find((p) => String(p.id) === String(pkgId));
  const key = storyKey(task.run_id, pkgId);
  const state = storyTicketState(task, pkgId);
  const dispatch = latestBySubgoal(task, pkgId, 'dispatch');
  const accept = latestBySubgoal(task, pkgId, 'accept');
  const r = accept && accept.result;
  const L = [frontmatter(key, state, task), `# ${pkgId} — ${(pkg && pkg.title) || ''}`, ''];
  L.push(`state: ${state} · tasks: ${storyTaskProgress(task, pkgId) || '—'} · reporter: ${(pkg && pkg.reporter) || (pkg && pkg.repair ? 'repair' : 'shape')}`, '');
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

export function renderIntegrate(task) {
  const n = task.nodes.filter((x) => x.stage === 'integrate' && x.result).pop();
  const r = n.result;
  const key = epicKey(task.run_id);
  const L = [frontmatter(key, epicTicketState(task), task), `# Integrate (${n.node_id})`, ''];
  L.push(`verified: ${r.verified === true}`, '');
  if (n.integration) L.push(`branch: ${n.integration.branch}`, 'Merged:', bullets((n.integration.merged || []).map((m) => `${m.package}: ${m.branch} -> ${m.commit}`)), '');
  L.push('Checks:', bullets(r.checks), '', 'Conflicts:', bullets(r.conflicts));
  return L.join('\n') + '\n';
}

export function renderGoalGate(task) {
  const n = task.nodes.filter((x) => x.stage === 'gate' && x.subgoal_id === null && x.result).pop();
  const r = n.result;
  const key = epicKey(task.run_id);
  const L = [frontmatter(key, epicTicketState(task), task), `# Goal gate (${n.node_id})`, ''];
  L.push(`accept: ${r.accept === true} · match_pct: ${r.match_pct == null ? '—' : r.match_pct}`, '');
  L.push('Checks:', bullets(r.checks), '', 'Gaps:', bullets(r.gaps), '', 'Spec drift:', bullets(r.spec_drift));
  return L.join('\n') + '\n';
}

function packageTitle(task, id) {
  const pkg = ((task.spec && task.spec.packages) || []).find((p) => String(p.id) === String(id));
  return pkg ? pkg.title : String(id);
}

// §B.2 (Scrum Guide mapping audit: no retro) - the retro bridge. Pure, like every other builder
// in this file: reads task.nodes/task.spec and, best-effort, every dispatch's own child run for
// its unasked[] (graph.mjs's openAsk/reviewIndependence sibling mechanism - a run that decided a
// question by default rather than asking records it there), and returns the same
// {retrospective, next_backlog} shape both renderReport's prose and renderRetro's JSON build
// from, so the two can never say something different about the same task.
// A node's own account of why, from whichever field its contract argues in: critique refuses in
// blocking/problems, integrate in unowned, gates in gaps - reason alone left critique blank.
function whyOf(r) {
  if (!r) return '';
  if (r.reason) return String(r.reason);
  for (const k of ['blocking', 'gaps', 'problems', 'unowned']) {
    if (Array.isArray(r[k]) && r[k].length) return r[k].map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('; ');
  }
  return '';
}

export function buildRetro(task) {
  const packageIds = [...new Set(task.nodes.filter((n) => n.stage === 'dispatch').map((n) => n.subgoal_id))];
  // A node superseded by a reshape or a newer attempt did not fail - it was replaced. Listing
  // those (every package of a discarded shape round, code-sprint-S8) buried the real failures.
  const whatFailed = task.nodes
    .filter((n) => ['failed', 'skipped', 'unreachable'].includes(n.state) && n.result)
    .filter((n) => !/^superseded\b/.test(String(n.result.reason || '')))
    .map((n) => ({ node_id: n.node_id, stage: n.stage, package_id: n.subgoal_id || null, reason: whyOf(n.result).slice(0, 300) }));
  const retries = packageIds
    .map((id) => ({ package_id: id, attempts: task.nodes.filter((n) => n.stage === 'dispatch' && n.subgoal_id === id).length }))
    .filter((r) => r.attempts > 1);
  const defectsLeft = (task.unresolved_defects || []).map((d) => ({ title: d.title, evidence: d.evidence || '', reporter: d.reporter || '' }));
  const unaccepted = [];
  for (const id of packageIds) {
    const accepts = task.nodes.filter((n) => n.stage === 'accept' && n.subgoal_id === id);
    const latest = accepts[accepts.length - 1];
    const ok = !!(latest && latest.state === 'done' && latest.result && latest.result.accept === true);
    if (!ok) {
      unaccepted.push({
        id, title: packageTitle(task, id),
        reason: latest ? String((latest.result && latest.result.reason) || `state: ${latest.state}`) : 'never dispatched',
      });
    }
  }
  // Which backlog items (requests[] indices) did not ship: an item is shipped when an accepted
  // package declares it in its own `backlog` (shape's field). Without any declaration - or with
  // no package at all, a Sprint stopped before shape - nothing can be shown shipped, so the whole
  // backlog carries forward rather than silently vanishing from the next Sprint's context.
  const unshippedRequests = [];
  if (Array.isArray(task.requests) && task.requests.length) {
    const shipped = new Set();
    for (const p of ((task.spec && task.spec.packages) || [])) {
      if (unaccepted.some((u) => String(u.id) === String(p.id))) continue;
      if (!packageIds.includes(p.id)) continue;
      for (const i of (Array.isArray(p.backlog) ? p.backlog : [])) if (Number.isInteger(i)) shipped.add(i);
    }
    task.requests.forEach((r, i) => { if (!shipped.has(i)) unshippedRequests.push({ priority: i, request: r }); });
  }
  const openQuestions = [];
  for (const n of task.nodes.filter((x) => x.stage === 'dispatch' && x.child)) {
    try {
      const child = loadRun(n.child.cwd, n.child.run_id);
      for (const q of (child && Array.isArray(child.unasked) ? child.unasked : [])) openQuestions.push({ package_id: n.subgoal_id, ...q });
    } catch { /* worktree may be long gone by report time - evidence, not a dependency */ }
  }
  return {
    task_id: task.run_id,
    epic_key: epicKey(task.run_id),
    request: String(task.request || ''),
    ...(Array.isArray(task.requests) ? { requests: task.requests } : {}),
    // Where this task's accepted work is: its last verified integration branch. Nothing merges it
    // into the project's own branch, so a person (or the next Sprint's context_from) needs the name.
    integration_branch: ((task.nodes.filter((n) => n.stage === 'integrate' && n.state === 'done' && n.integration).pop() || {}).integration || {}).branch || null,
    retrospective: {
      what_failed: whatFailed,
      retries,
      defects_left: defectsLeft,
      ...(task.budget_stopped ? { budget_stopped: task.budget_stopped } : {}),
    },
    next_backlog: {
      ...(Array.isArray(task.requests) ? { unshipped_requests: unshippedRequests } : {}),
      unaccepted_packages: unaccepted,
      unresolved_defects: defectsLeft,
      open_questions: openQuestions,
    },
  };
}

export function renderRetro(task) {
  return `${JSON.stringify(buildRetro(task), null, 2)}\n`;
}

export function renderReport(task) {
  const n = task.nodes.find((x) => x.stage === 'report' && x.state === 'done');
  const key = epicKey(task.run_id);
  const L = [frontmatter(key, 'DONE', task), '# Report', ''];
  L.push(String((n.result && n.result.handoff) || ''));
  const retro = buildRetro(task);
  L.push('', '## Retrospective', '', 'What failed and why:');
  L.push(bullets(retro.retrospective.what_failed.map((f) => `${f.node_id} (${f.stage}): ${f.reason}`)));
  L.push('', 'Retries:', bullets(retro.retrospective.retries.map((r) => `${r.package_id}: ${r.attempts} attempts`)));
  L.push('', 'Defects left:', bullets(retro.retrospective.defects_left.map((d) => d.title)));
  if (retro.integration_branch) L.push('', `The accepted work is on branch \`${retro.integration_branch}\`. Nothing has merged it into the project's own branch - merge it to keep it; a follow-up Sprint opened with context_from builds on it either way.`);
  L.push('', '## Next backlog', '');
  if (retro.next_backlog.unshipped_requests) L.push('Backlog items not shipped:', bullets(retro.next_backlog.unshipped_requests.map((r) => `[${r.priority}] ${r.request}`)), '');
  L.push('Unaccepted packages:');
  L.push(bullets(retro.next_backlog.unaccepted_packages.map((p) => `${p.id} (${p.title}): ${p.reason}`)));
  L.push('', 'Unresolved defects:', bullets(retro.next_backlog.unresolved_defects.map((d) => d.title)));
  L.push('', 'Open questions:', bullets(retro.next_backlog.open_questions.map((q) => q.question || JSON.stringify(q))));
  return L.join('\n') + '\n';
}

// A task that stopped short of its report still owes a person an account: what blocks it, and
// the one call that would move it. Before this a blocked task left no 80-report.md at all
// (idol-pm-1/2, seam-beta-D2, code-sprint-S5/S6) and the reason sat in task.json and the ledger.
// Rendered only while blocked with no report done; a later report overwrites it.
export function renderBlockedReport(task) {
  const key = epicKey(task.run_id);
  const L = [frontmatter(key, 'BLOCKED', task), '# Report — blocked', ''];
  L.push('This task stopped before its report. Nothing below was judged by a report stage; it is read straight off the task.', '');
  const blockers = task.nodes.filter((n) => (n.state === 'failed' || n.state === 'unreachable') && n.result);
  L.push('## What blocks it', '');
  L.push(bullets(blockers.map((n) => {
    const r = n.result || {};
    const why = String(r.reason || (Array.isArray(r.gaps) && r.gaps.length ? r.gaps.join('; ') : '') || (Array.isArray(r.blocking) && r.blocking.length ? r.blocking.join('; ') : '') || '(no reason recorded)');
    return `${n.node_id} (${n.state}): ${why.slice(0, 400)}`;
  })));
  const pkgs = [...new Set(blockers.filter((n) => n.subgoal_id && (n.stage === 'dispatch' || n.stage === 'accept')).map((n) => n.subgoal_id))];
  const moves = pkgs.map((id) => `tm_retry({task_id: "${task.run_id}", package_id: "${id}"}) - another attempt of ${id}`);
  if (blockers.some((n) => n.stage === 'integrate' || String(n.node_id).startsWith('gate:goal'))) moves.push(`tm_retry({task_id: "${task.run_id}", package_id: "integration"}) - a repair pass over the integrated tree`);
  if (blockers.some((n) => n.stage === 'shape' || n.stage === 'critique')) moves.push('the shape/critique problems above are decisions about the split itself - settle them and reopen the task (a person decides; the retries are spent)');
  L.push('', '## What would move it', '');
  L.push(bullets(moves.length ? moves : ['no retry route is left - read the reasons above and decide']));
  const retro = buildRetro(task);
  L.push('', '## Next backlog', '');
  if (retro.next_backlog.unshipped_requests) L.push('Backlog items not shipped:', bullets(retro.next_backlog.unshipped_requests.map((r) => `[${r.priority}] ${r.request}`)), '');
  L.push('Unaccepted packages:', bullets(retro.next_backlog.unaccepted_packages.map((p) => `${p.id} (${p.title}): ${p.reason}`)));
  return L.join('\n') + '\n';
}

// Every file this task currently has data for, keyed by its full path. A shape not yet done
// means only INDEX + request exist; a fresh gate:goal round adds the goal-gate file; and so on -
// nothing is ever rendered ahead of the data that would back it.
export function renderAll(task) {
  const paths = docPaths(task);
  const files = { [paths.index]: renderIndex(task), [paths.request]: renderRequest(task) };
  if (task.planning_pkg) {
    files[paths.planning] = renderPlanning(task);
    files[paths.prd] = renderPrd(task);
  }
  if (task.spec) {
    files[paths.shape] = renderShape(task);
    if (task.nodes.some((n) => n.stage === 'critique' && n.result)) files[paths.critique] = renderCritique(task);
    for (const p of task.spec.packages) files[paths.story(p.id)] = renderStory(task, String(p.id));
  }
  if (task.nodes.some((n) => n.stage === 'integrate' && n.result)) files[paths.integrate] = renderIntegrate(task);
  if (task.qa_pkg) files[paths.qa] = renderQa(task);
  if (task.audit_pkg) files[paths.audit] = renderAudit(task);
  if (task.nodes.some((n) => n.stage === 'gate' && n.subgoal_id === null && n.result)) files[paths.goalGate] = renderGoalGate(task);
  if (task.nodes.some((n) => n.stage === 'report' && n.state === 'done')) {
    files[paths.report] = renderReport(task);
    files[paths.retro] = renderRetro(task);
  } else if (task.nodes.length > 1 && runState(task).state === 'blocked') {
    files[paths.report] = renderBlockedReport(task);
    files[paths.retro] = renderRetro(task);
  }
  return files;
}

// The one write site. rebuild:true deletes the EPIC's whole docs directory first, so a stale
// file from a superseded package (a reshape that dropped it) cannot linger - every remaining
// call writes fresh files over whatever is there.
export function writeDocs(task, opts = {}) {
  const files = renderAll(task);
  if (opts.rebuild) {
    try { rmSync(docPaths(task).dir, { recursive: true, force: true }); } catch { /* nothing to remove */ }
  }
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return Object.keys(files);
}
