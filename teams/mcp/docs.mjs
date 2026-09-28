// docs.mjs - §7c's phase markdown, rendered from task.json. Pure render functions plus exactly
// one impure function (writeDocs) that writes them - the engine never reads any of this back
// (md is a rendered view, never a second source of truth, same principle as tickets.mjs's §4).
//
// v0.12.0 wires planning/qa into the EPIC flow as phase-Teams, and renders three more of §7c's
// 13: 10-planning.md, 10-prd.md, 60-qa.md. Since cards-everywhere (docs/plans/2026-09-28-teams-
// cards-everywhere.md) planning and QA run as one card per feature area (tickets.mjs's
// planningPkgs/qaPkgs): 10-planning.md and 60-qa.md list every card, and 10-prd.md is the MERGED
// PRD plan-integrate judges - every card's accepted section under its area's heading.
// v0.12.1 adds the third phase-Team, the audit (task.audit_pkg), and with it 65-audit.md - which
// says more than the other two phase-Team pages because an audit's output is a list the manager
// acted on: the unmet user stories it named, and the STORYs those became. 15-spec-gate.md
// (v0.13.0's human gate) is the one file of §7c's 13 still without data behind it, and is not
// rendered - an empty file would claim a feature that does not exist.
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { storyLabel, storyId, unfinishedWork } from './taskmanager.mjs';
import { loadRun, runState } from './graph.mjs';
import {
  epicKey, storyKey, docPaths, latestBySubgoal, epicTicketState, epicPhase,
  storyTicketState, storyTaskProgress, epicBoardRows, packageFiling,
  planningPkgs, qaPkgs, planningStories,
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
  if (planningPkgs(task).length) L.push('- [Planning](./10-planning.md)', '- [PRD](./10-prd.md)');
  if (task.spec) {
    L.push('- [Shape](./20-shape.md)');
    if (task.nodes.some((n) => n.stage === 'critique' && n.result)) L.push('- [Critique](./30-critique.md)');
    for (const p of task.spec.packages) L.push(`- [${p.id}](./40-stories/${p.id}.md)`);
  }
  if (task.nodes.some((n) => n.stage === 'integrate' && n.result)) L.push('- [Integrate](./50-integrate.md)');
  if (qaPkgs(task).length) L.push('- [QA](./60-qa.md)');
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
  // roles.planning may also be 'light' or 'auto' (light PLAN mode): shown as set, with the mode it resolved to.
  const P = T.roles ? T.roles.planning : undefined;
  L.push(`- roles: planning=${typeof P === 'string' ? `${P}${task.planning_mode ? ` (${task.planning_mode})` : ''}` : P === true}, qa=${(T.roles && T.roles.qa) === true}`);
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

// One section per card, sharing phaseTeamLines' "how did this card's run go" block, so a page
// over three planning (or QA) cards reads as three short verdicts under one heading.
function cardsPage(task, cards, title, worktreeLine, intro) {
  const key = epicKey(task.run_id);
  const L = [frontmatter(key, epicTicketState(task), task), `# ${title}`, ''];
  if (intro) L.push(intro, '');
  L.push('| card | area | state |', '|---|---|---|');
  for (const p of cards) L.push(`| ${p.id} | ${p.area_title || p.title || ''} | ${storyTicketState(task, String(p.id))} |`);
  for (const p of cards) {
    const heading = `${p.id} — ${p.area_title || p.title || ''}`;
    const lines = phaseTeamLines(task, p, heading, worktreeLine);
    // phaseTeamLines opens with its own frontmatter for a standalone page; one page, one header,
    // and each card's headings one level down under the page's own.
    L.push('', ...lines.slice(lines.indexOf(`# ${heading}`)).map((x) => (/^#{1,5} /.test(x) ? `#${x}` : x)));
  }
  return L;
}

export function renderPlanning(task) {
  const cards = planningPkgs(task);
  const pis = task.nodes.filter((n) => n.stage === 'plan-integrate');
  const L = cardsPage(task, cards, 'Planning', (child) => `run: ${child.run_id} at ${child.cwd}`,
    `${cards.length} planning card(s), one per feature area, each running the full harness in its own worktree; the planning integrate merges their sections into [the PRD](./10-prd.md) and judges it.`);
  L.push('', '## Planning integrate', '');
  if (!pis.length) L.push('(not opened yet)');
  for (const n of pis) {
    const r = n.result || {};
    L.push(`- ${n.node_id}: ${n.state}${r.accept === undefined ? '' : ` · accept=${r.accept === true}`}${r.reason ? ` · ${String(r.reason).slice(0, 160)}` : ''}`);
    for (const d of r.duplicates || []) L.push(`  - duplicate: ${d}`);
    for (const c of r.contradictions || []) L.push(`  - contradiction: ${c}`);
    for (const u of r.uncovered || []) L.push(`  - uncovered: ${u}`);
  }
  return L.join('\n') + '\n';
}

// The planning card's own PRD files, read from its worktree - the latest dispatch its accept let
// through (or the latest with a result, before any accept). Findings files are the investigate
// stage's working notes, not the PRD; they stay in the card's tree.
// The merge a planning integrate made is snapshotted on its node (taskmanager.mjs's
// preparePlanIntegration, n.prd.docs, keyed by the dispatch it read): a card's worktree is a
// package worktree tm_clean removes once the task is done, and 10-prd.md must still say what the
// merged PRD was. The snapshot wins for the dispatch it was taken from; anything newer is read live.
export function cardDocuments(task, p) {
  const id = String(p.id);
  const dispatches = task.nodes.filter((n) => n.stage === 'dispatch' && n.subgoal_id === id && n.result && n.child);
  const accepted = dispatches.filter((d) => { const a = task.nodes.find((x) => x.stage === 'accept' && x.subgoal_id === id && (x.attempt || 1) === (d.attempt || 1)); return a && a.state === 'done'; });
  const d = accepted.length ? accepted[accepted.length - 1] : dispatches[dispatches.length - 1];
  if (!d) return { dispatch: null, docs: [] };
  for (const pi of task.nodes.filter((n) => n.stage === 'plan-integrate' && n.prd && Array.isArray(n.prd.docs)).reverse()) {
    const snap = pi.prd.docs.filter((x) => x.dispatch === d.node_id);
    if (snap.length) return { dispatch: d, docs: snap.map((x) => ({ path: x.path, text: x.text })) };
  }
  const docs = [];
  for (const rel of d.result.prd_paths || []) {
    if (!/\.md$/i.test(String(rel)) || /-findings\.md$/i.test(String(rel))) continue;
    try { docs.push({ path: String(rel), text: readFileSync(resolve(d.child.cwd, String(rel)), 'utf8') }); } catch { /* not readable: its stories are listed instead */ }
  }
  return { dispatch: d, docs };
}

// C4: the ONE PRD of this EPIC - every planning card's accepted section, merged under its feature
// area's heading (each card's own headings demoted one level), with the whole EPIC's user stories
// listed first so a reader and plan-integrate's judge see every id and the card that owns it in
// one place. Written by preparePlanIntegration before the planning integrate is judged, and
// re-rendered with every other page as the run moves; a card's documents stay in its own worktree
// and are read from there.
export function renderPrd(task) {
  const cards = planningPkgs(task);
  const key = epicKey(task.run_id);
  const stories = planningStories(task);
  const L = [frontmatter(key, epicTicketState(task), task), '# PRD', ''];
  L.push(`Merged from ${cards.length} planning card(s), one per feature area: ${cards.map((p) => `${p.id} (${p.area_title || p.title})`).join(', ') || '(none)'}.`, '');
  // Stories arrive as {id, title, acceptance} objects; bullets(String(obj)) printed
  // "[object Object]" on this page long after the same bug was fixed in shape's path (2026-09-22).
  L.push('## User stories', bullets(stories.map((u) => `${storyLabel(u)} (${u.card})`)), '');
  for (const p of cards) {
    const { dispatch, docs } = cardDocuments(task, p);
    L.push(`## ${p.area || p.id} — ${p.area_title || p.title}`, '');
    L.push(`card: ${storyKey(task.run_id, p.id)} · ${storyTicketState(task, String(p.id))}${dispatch && dispatch.child ? ` · run ${dispatch.child.run_id} at ${dispatch.child.cwd}` : ''}`, '');
    if (!docs.length) {
      const mine = stories.filter((u) => u.card === String(p.id));
      L.push(dispatch ? '(no readable PRD document in this card\'s worktree - its stories as it returned them:)' : '(not planned yet)');
      if (mine.length) L.push(bullets(mine.map(storyLabel)));
      L.push('');
      continue;
    }
    for (const doc of docs) {
      if (docs.length > 1) L.push(`### ${doc.path}`, '');
      const depth = docs.length > 1 ? '##' : '#';
      L.push(doc.text.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n').map((x) => (/^#{1,4} /.test(x) ? `${depth}${x}` : x)).join('\n').trim(), '');
    }
  }
  return L.join('\n') + '\n';
}

export function renderQa(task) {
  const cards = qaPkgs(task);
  return cardsPage(task, cards, 'QA', (child) => `worktree: ${child.cwd} (the integration tree)`,
    `${cards.length} QA card(s), one per feature area, run in parallel over the integrated tree; their defects are filed together as fix STORYs once the whole round has settled.`).join('\n') + '\n';
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
  // packageFiling (tickets.mjs) - the same reporter/origin epicBoardRows and tm_ticket render -
  // rather than a second, narrower re-derivation (this used to inline (pkg && pkg.reporter) ||
  // (pkg && pkg.repair ? 'repair' : 'shape'), which never named a phase-Team package's 'engine'
  // default at all).
  const filing = packageFiling(pkg || {});
  L.push(`state: ${state} · tasks: ${storyTaskProgress(task, pkgId) || '—'} · reporter: ${filing.reporter}${filing.origin ? ` (${filing.origin})` : ''}`, '');
  if (dispatch && dispatch.child) L.push(`worktree: ${dispatch.child.cwd} on branch ${dispatch.child.branch}`, '');
  // What this STORY is for and what it is judged against, then every attempt with the first
  // thing that sank it: before this the page held only the LAST verdict, so a person could not
  // follow a user story to the attempts that failed it (the sweep of idol-beta-ask1: P3's
  // rejected attempt 1 and the commit that fixed it appeared nowhere a person would read).
  const implementsIds = (pkg && Array.isArray(pkg.implements)) ? pkg.implements : [];
  const backlog = (pkg && Array.isArray(pkg.backlog) && Array.isArray(task.requests))
    ? pkg.backlog.filter((i) => Number.isInteger(i) && task.requests[i] != null).map((i) => `[${i}] ${task.requests[i]}`) : [];
  if (implementsIds.length || backlog.length) {
    L.push('## Implements');
    if (implementsIds.length) L.push(`user stories: ${implementsIds.join(', ')}`);
    if (backlog.length) L.push('backlog items:', bullets(backlog));
    L.push('');
  }
  if (pkg && Array.isArray(pkg.acceptance) && pkg.acceptance.length) L.push('## Acceptance', bullets(pkg.acceptance), '');
  const accepts = task.nodes.filter((n) => n.stage === 'accept' && String(n.subgoal_id) === String(pkgId) && n.result)
    .sort((a, b) => (a.attempt || 1) - (b.attempt || 1));
  if (accepts.length > 1 || (accepts[0] && accepts[0].result.accept !== true)) {
    L.push('## Attempts');
    for (const a of accepts) {
      const ar = a.result || {};
      const d = task.nodes.find((n) => n.node_id === a.node_id.replace(/^accept:/, 'dispatch:'));
      const why = String(ar.reason || (Array.isArray(ar.gaps) && ar.gaps[0]) || (d && d.result && d.result.reason) || '').replace(/\s+/g, ' ').slice(0, 240);
      L.push(`- attempt ${a.attempt || 1}: ${a.state === 'done' && ar.accept === true ? 'accepted' : a.state}${ar.match_pct != null ? ` (${ar.match_pct})` : ''}${ar.commit ? ` · ${String(ar.commit).slice(0, 7)}` : ''}${why && !(ar.accept === true) ? ` — ${why}` : ''}`);
    }
    L.push('');
  }
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
  // The user stories this task did not ship (docs/plans/2026-09-28-teams-sprint-not-sub-epic.md):
  // work too big for one Sprint is not nested into a sub-EPIC, it carries into the next Sprint as
  // a backlog candidate. A story shipped when an accepted package implements it and an integrate
  // settled done after it; a task with no packages (size S) shipped all or none of them.
  const stories = planningStories(task);
  const shippedStories = new Set();
  const pkgs = (task.spec && Array.isArray(task.spec.packages)) ? task.spec.packages : [];
  const integrated = task.nodes.some((n) => n.stage === 'integrate' && n.state === 'done');
  if (!pkgs.length) {
    if (!unfinishedWork(task) && runState(task).state === 'complete') for (const u of stories) shippedStories.add(storyId(u));
  } else if (integrated) {
    for (const p of pkgs) {
      if (!packageIds.includes(p.id) || unaccepted.some((u) => String(u.id) === String(p.id))) continue;
      for (const s of (Array.isArray(p.implements) ? p.implements : [])) shippedStories.add(String(s));
    }
  }
  const unfinishedStories = stories
    .filter((u) => storyId(u) && !shippedStories.has(storyId(u)))
    .map((u) => ({ id: storyId(u), title: (u && typeof u === 'object' && u.title) ? String(u.title) : '', card: u.card || null,
      ...(u && typeof u === 'object' && Array.isArray(u.acceptance) ? { acceptance: u.acceptance } : {}) }));
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
      // What the box left undone (unfinishedWork) - the next Sprint's context_from reads this.
      ...((() => { const p = unfinishedWork(task); return p ? { partial_reasons: p.partial_reasons } : {}; })()),
    },
    next_backlog: {
      ...(Array.isArray(task.requests) ? { unshipped_requests: unshippedRequests } : {}),
      unfinished_stories: unfinishedStories,
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
  L.push('User stories not shipped (carry into the next Sprint):', bullets(retro.next_backlog.unfinished_stories.map((u) => `${u.id}${u.title ? ` ${u.title}` : ''}`)), '');
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
  L.push('User stories not shipped (carry into the next Sprint):', bullets(retro.next_backlog.unfinished_stories.map((u) => `${u.id}${u.title ? ` ${u.title}` : ''}`)), '');
  L.push('Unaccepted packages:', bullets(retro.next_backlog.unaccepted_packages.map((p) => `${p.id} (${p.title}): ${p.reason}`)));
  return L.join('\n') + '\n';
}

// A size-S task's work is its one child run, not the manager graph: the manager's own nodes are
// all skipped by design. slack-list (2026-09-27) read BLOCKED with "(none)" as the blocker while
// tm_status said complete, because the blocked branch read the manager graph. This reads the
// run - its state, its report, its goal verdict and drift - and says plainly what a size-S task
// does not do: QA and the audit do not run (planning does - one card, C6), and the run writes
// straight into the project's working tree, uncommitted, with no worktree or branch.
export function renderSReport(task) {
  const key = epicKey(task.run_id);
  const run = loadRun(task.s_run.cwd, task.s_run.run_id);
  if (!run) return null;
  const st = runState(run).state;
  const L = [frontmatter(key, st === 'complete' ? 'DONE' : st.toUpperCase(), task), `# Report — size S (${st})`, ''];
  const report = run.nodes.filter((n) => n.stage === 'report' && n.state === 'done' && n.result).pop();
  if (report) L.push(String(report.result.handoff || report.result.summary || report.result.reason || '').trim() || '(the run\'s report stage returned no text)', '');
  const goals = run.nodes.filter((n) => String(n.node_id).startsWith('gate:goal') && n.result);
  const last = goals[goals.length - 1];
  if (last) {
    const r = last.result;
    L.push('## Goal gate', '', `${last.node_id}: ${r.accept ? 'accepted' : 'refused'}${r.match_pct != null ? ` at ${r.match_pct}` : ''}`);
    if ((r.gaps || []).length) L.push('', 'Gaps:', bullets(r.gaps));
    if ((r.spec_drift || []).length) L.push('', 'Asked for by the request, not delivered (spec drift):', bullets(r.spec_drift));
    if ((r.observations || []).length) L.push('', 'Observations:', bullets(r.observations));
    L.push('');
  }
  // C6: a size-S task is planned like any other - its planning card and PRD are its own pages.
  if (planningPkgs(task).length) {
    L.push('## Planning', '', `${planningPkgs(task).map((p) => p.id).join(', ')} planned this run; the PRD it built from is [10-prd.md](./10-prd.md), with ${planningStories(task).length} user stor${planningStories(task).length === 1 ? 'y' : 'ies'}.`, '');
  }
  L.push('## What a size-S task does not do', '');
  const roles = (task.team && task.team.opts && task.team.opts.roles) || {};
  const on = ['qa', 'audit'].filter((r) => roles[r] === true || (r === 'audit' && roles.planning && roles.audit !== false));
  const notes = [];
  if (on.length) notes.push(`roles ${on.join(', ')} are on, but QA and the planning audit run only on a size-L task (after integration) - neither ran here. Pin size L (tm_open size: "L") to have them.`);
  notes.push(`the run wrote straight into ${task.s_run.cwd}: no worktree, no branch, nothing committed - review and commit it yourself.`);
  L.push(bullets(notes));
  return L.join('\n') + '\n';
}

// Every file this task currently has data for, keyed by its full path. A shape not yet done
// means only INDEX + request exist; a fresh gate:goal round adds the goal-gate file; and so on -
// nothing is ever rendered ahead of the data that would back it.
export function renderAll(task) {
  const paths = docPaths(task);
  const files = { [paths.index]: renderIndex(task), [paths.request]: renderRequest(task) };
  if (planningPkgs(task).length) {
    files[paths.planning] = renderPlanning(task);
    files[paths.prd] = renderPrd(task);
  }
  if (task.spec) {
    files[paths.shape] = renderShape(task);
    if (task.nodes.some((n) => n.stage === 'critique' && n.result)) files[paths.critique] = renderCritique(task);
    for (const p of task.spec.packages) files[paths.story(p.id)] = renderStory(task, String(p.id));
  }
  if (task.nodes.some((n) => n.stage === 'integrate' && n.result)) files[paths.integrate] = renderIntegrate(task);
  if (qaPkgs(task).length) files[paths.qa] = renderQa(task);
  if (task.audit_pkg) files[paths.audit] = renderAudit(task);
  if (task.nodes.some((n) => n.stage === 'gate' && n.subgoal_id === null && n.result)) files[paths.goalGate] = renderGoalGate(task);
  const sReport = task.s_run && task.s_run.run_id ? renderSReport(task) : null;
  if (sReport) {
    files[paths.report] = sReport;
  } else if (task.nodes.some((n) => n.stage === 'report' && n.state === 'done')) {
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
