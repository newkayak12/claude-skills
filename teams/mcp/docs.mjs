// docs.mjs - §7c's phase markdown, rendered from task.json. Pure render functions plus exactly
// one impure function (writeDocs) that writes them - the engine never reads any of this back
// (md is a rendered view, never a second source of truth, same principle as tickets.mjs's §4).
//
// v0.12.0 wires planning/qa into the EPIC flow as phase-Teams, and renders three more of §7c's
// 13: 10-planning.md, 10-prd.md, 60-qa.md. Since cards-everywhere (_repo/docs/plans/2026-09-28-teams-
// cards-everywhere.md) planning and QA run as one card per feature area (tickets.mjs's
// planningPkgs/qaPkgs): 10-planning.md and 60-qa.md list every card, and 10-prd.md is the MERGED
// PRD plan-integrate judges - every card's accepted section under its area's heading.
// v0.12.1 adds the third phase-Team, the audit (task.audit_pkg), and with it 65-audit.md - which
// says more than the other two phase-Team pages because an audit's output is a list the manager
// acted on: the unmet user stories it named, and the STORYs those became. 15-spec-gate.md
// (v0.13.0's human gate) is the one file of §7c's 13 still without data behind it, and is not
// rendered - an empty file would claim a feature that does not exist.
import { mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { mode as wikiMode } from './wikibridge.mjs';
import { unfinishedWork } from './taskstate.mjs';
import { loadRun, runState } from './graph.mjs';
import { harnessVerdict } from './harnessrun.mjs';
import {
  epicKey, storyKey, docPaths, latestBySubgoal, epicTicketState, epicPhase,
  storyTicketState, storyTaskProgress, epicBoardRows, packageFiling,
  planningPkgs, livePlanningPkgs, qaPkgs, planningStories, storyId, storyLabel,
} from './tickets.mjs';

// One open question as a line: a package's contradicts_decision says which settled decision it
// found cannot hold, so the next Sprint's planning takes it up instead of reading a bare question.
export function questionLine(q) {
  const text = (q && q.question) || JSON.stringify(q);
  return q && q.contradicts_decision ? `${text} (contradicts: ${q.contradicts_decision})` : text;
}

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
  const cards = livePlanningPkgs(task);
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

// The packages the Sprint's final integration holds (buildRetro's comment says why): the latest
// integrate nothing superseded, if it settled done. Its own record says what it merged
// (prepareIntegration's integration.merged); a round based on a repair merged only the repair,
// whose base is the integrate the repair worked on - that one's merged set is followed. An
// integrate with no record (an older task) is read by its deps, transitively. A package counts
// only while its latest accept stands (not in `unaccepted`).
export function shippedPackages(task, unaccepted = []) {
  const byId = new Map(task.nodes.map((n) => [n.node_id, n]));
  const superseded = new Set(task.nodes.map((n) => n.supersedes).filter(Boolean));
  const live = task.nodes.filter((n) => n.stage === 'integrate' && !superseded.has(n.node_id) && n.state !== 'skipped');
  const last = live[live.length - 1];
  const out = new Set();
  if (!last || last.state !== 'done') return out;
  const pkgs = ((task.spec && task.spec.packages) || []);
  const held = new Set();
  const seen = new Set();
  const collect = (integ) => {
    if (!integ || seen.has(integ.node_id)) return;
    seen.add(integ.node_id);
    const merged = integ.integration && Array.isArray(integ.integration.merged) ? integ.integration.merged : null;
    if (merged) {
      for (const m of merged) held.add(String(m.package));
      if (integ.integration.based_on === 'repair') {
        const rp = pkgs.find((p) => String(p.id) === String(integ.integration.repair_package));
        collect(rp && byId.get(rp.integration_of));
      }
      return;
    }
    const queue = integ.deps.slice();
    const reached = new Set();
    while (queue.length) {
      const id = queue.shift();
      if (reached.has(id)) continue;
      reached.add(id);
      const x = byId.get(id);
      if (!x) continue;
      if (x.stage === 'accept' && x.state === 'done' && x.subgoal_id != null) held.add(String(x.subgoal_id));
      queue.push(...x.deps);
    }
    // A fix-forward round (a filed defect) names only the fix's accept; the tree it rebuilt holds
    // every package the round before it held.
    const prior = byId.get(integ.supersedes);
    if (prior && prior.stage === 'integrate' && prior.state === 'done') collect(prior);
  };
  collect(last);
  const bad = new Set(unaccepted.map((u) => String(u.id)));
  for (const id of held) if (!bad.has(id)) out.add(id);
  return out;
}

// A size-S task's one run shipped when it completed without a settled failure and its goal gate
// accepted - the same three facts renderSReport prints.
function sRunShipped(task) {
  try {
    const run = loadRun(task.s_run.cwd, task.s_run.run_id);
    if (!run) return false;
    const st = runState(run);
    const goals = run.nodes.filter((n) => String(n.node_id).startsWith('gate:goal') && n.state !== 'skipped' && n.result);
    const last = goals[goals.length - 1];
    return st.state === 'complete' && !st.settled && !!(last && last.result.accept === true);
  } catch {
    return false;
  }
}

// A size-S task on the development harness (S1a): the verdict of the run the manager resolved
// (task.harness_run.run), read from that run's own files - never the driver's word.
function harnessOutcome(task) {
  const h = task.harness_run;
  if (!h || !h.run) return null;
  return harnessVerdict(h.run);
}

function harnessShipped(task) {
  const v = harnessOutcome(task);
  return !!(v && v.finished && v.accept);
}

export function buildRetro(task) {
  const packageIds = [...new Set(task.nodes.filter((n) => n.stage === 'dispatch').map((n) => n.subgoal_id))];
  // A node superseded by a reshape or a newer attempt did not fail - it was replaced. Listing
  // those (every package of a discarded shape round, code-sprint-S8) buried the real failures.
  const whatFailed = task.nodes
    .filter((n) => ['failed', 'skipped', 'unreachable'].includes(n.state) && n.result)
    .filter((n) => !/^superseded\b/.test(String(n.result.reason || '')))
    // A size-S task's manager nodes are skipped by design (delegateIfSmall), not failures.
    .filter((n) => !/^size S:/.test(String(n.result.reason || '')))
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
  // What shipped is what the Sprint's final integration holds (M7/M8,
  // _repo/docs/plans/2026-09-28-teams-adversarial-fixes.md): the latest integrate nothing superseded,
  // and only if it settled done - a later failed integrate is not overridden by an earlier pass.
  // Its tree is cumulative, so the done integrates it superseded count too, and every accept its
  // deps reach transitively (a repair's or a defect fix's integrate names only the new accept;
  // the packages before it are reached through that chain). A package ships when it is accepted
  // (its latest accept) and reached. Ids compare as strings: a shape may write numeric ids.
  const shippedPkgs = shippedPackages(task, unaccepted);
  const unshippedRequests = [];
  if (Array.isArray(task.requests) && task.requests.length) {
    const shipped = new Set();
    if (harnessShipped(task)) task.requests.forEach((_, i) => shipped.add(i));
    for (const p of ((task.spec && task.spec.packages) || [])) {
      if (!shippedPkgs.has(String(p.id))) continue;
      for (const i of (Array.isArray(p.backlog) ? p.backlog : [])) if (Number.isInteger(i)) shipped.add(i);
    }
    task.requests.forEach((r, i) => { if (!shipped.has(i)) unshippedRequests.push({ priority: i, request: r }); });
  }
  // The user stories this task did not ship (_repo/docs/plans/2026-09-28-teams-sprint-not-sub-epic.md):
  // work too big for one Sprint is not nested into a sub-EPIC, it carries into the next Sprint as
  // a backlog candidate. A story ships when every package implementing it shipped (one of two is
  // not the story). A size-S task has no packages: its one run shipped all its stories when it
  // completed unsettled with its goal gate accepting, or none.
  const stories = planningStories(task);
  const shippedStories = new Set();
  if (task.s_run && task.s_run.run_id) {
    if (sRunShipped(task)) for (const u of stories) shippedStories.add(storyId(u));
  } else {
    const implementers = new Map();
    for (const p of ((task.spec && task.spec.packages) || [])) {
      for (const s of (Array.isArray(p.implements) ? p.implements : [])) {
        const k = String(s);
        if (!implementers.has(k)) implementers.set(k, []);
        implementers.get(k).push(String(p.id));
      }
    }
    for (const [sid, ids] of implementers) if (ids.every((id) => shippedPkgs.has(id))) shippedStories.add(sid);
  }
  const unfinishedStories = stories
    .filter((u) => storyId(u) && !shippedStories.has(storyId(u)))
    .map((u) => ({ id: storyId(u), title: (u && typeof u === 'object' && u.title) ? String(u.title) : '', card: u.card || null,
      ...(u && typeof u === 'object' && Array.isArray(u.acceptance) ? { acceptance: u.acceptance } : {}) }));
  // Task-level first (escalateBlocking/finishNode record a headless task's questions here, a
  // Dev package's contradicts_decision among them), contradictions ahead: without them the next
  // Sprint never learns that a package found the spec could not hold.
  const taskLevel = (Array.isArray(task.unasked) ? task.unasked : []).filter((q) => q && q.question)
    .map((q) => ({ package_id: q.subgoal_id || (Array.isArray(q.raised_by) ? q.raised_by[0] : null) || null, ...q }));
  const openQuestions = [...taskLevel.filter((q) => q.contradicts_decision), ...taskLevel.filter((q) => !q.contradicts_decision)];
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

// Wiki 변경: the pages under the task's cwd .teams_wiki written while the task ran - a plain file
// walk (never wiki.mjs, never creates .teams_wiki). The window is [created_at, end]; end is the
// report node's finished_at, else the harness run's, else the last node's - never the render
// clock, so a re-render of a finished task is byte-identical. No .teams_wiki -> no section.
function wikiSection(task) {
  const root = join(task.cwd || '', '.teams_wiki');
  const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
  if (!task.cwd || !isDir(root)) return [];
  const done = (task.nodes || []).filter((n) => n.stage === 'report' && n.state === 'done' && n.finished_at).pop();
  const fins = (task.nodes || []).map((n) => n.finished_at).filter(Number.isFinite);
  const end = done ? done.finished_at : (task.harness_run && task.harness_run.finished_at) || (fins.length ? Math.max(...fins) : Infinity);
  const from = Number.isFinite(task.created_at) ? task.created_at : 0;
  const val = (fm, k) => { const m = new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(fm); if (!m) return ''; try { return String(JSON.parse(m[1])); } catch { return m[1].trim(); } };
  const rows = [];
  const walk = (dir, rel) => {
    let ents = [];
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory()) { if (!rel && (e.name === '_proposed' || e.name === '_rejected')) continue; walk(join(dir, e.name), `${rel}${e.name}/`); continue; }
      if (!e.isFile() || !e.name.endsWith('.md') || (!rel && e.name === 'INDEX.md')) continue;
      try {
        const p = join(dir, e.name);
        const m = statSync(p).mtimeMs;
        if (m < from || m > end) continue;
        const fm = (/^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(p, 'utf8')) || [, ''])[1];
        const id = `${rel}${e.name.slice(0, -3)}`;
        rows.push(`${id} — ${val(fm, 'title') || id.split('/').pop()} (${val(fm, 'source') || 'no source'})`);
      } catch { /* a page that vanished mid-walk */ }
    }
  };
  walk(root, '');
  rows.sort();
  return ['', '## Wiki 변경', '', `mode: ${wikiMode()}`, '', 'Pages modified while this task ran:', bullets(rows)];
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
  L.push('', 'Open questions:', bullets(retro.next_backlog.open_questions.map(questionLine)));
  L.push(...wikiSection(task));
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
  L.push(...wikiSection(task));
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
  const raw = runState(run).state;
  // QA left defects or reached no verdict (m4): the task delivered, but not verified clean.
  const st = raw === 'complete' && ((task.unresolved_defects || []).length || (task.qa_not_run || []).length || (task.s_qa && task.s_qa.failed)) ? 'partial' : raw;
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
  // m4: QA ran over a snapshot of the run's working tree; what it found is listed here, since a
  // size-S task has no package to file a fix onto.
  if (qaPkgs(task).length) {
    L.push('## QA', '');
    const lines = qaPkgs(task).map((q) => {
      const acc = latestBySubgoal(task, String(q.id), 'accept');
      const n = acc && acc.result && Array.isArray(acc.result.defects) ? acc.result.defects.length : 0;
      return `${q.id}: ${acc ? acc.state : 'not run'}${n ? ` - ${n} defect(s)` : ''}`;
    });
    L.push(bullets(lines), '');
    const left = task.unresolved_defects || [];
    L.push('Defects QA found (unresolved - a size-S task has no package to fix them in; carry them into the next Sprint):', bullets(left.map((d) => `${d.title}${d.card ? ` (${d.card})` : ''}`)), '');
    for (const q of task.qa_not_run || []) L.push(`- ${q.pass}: QA reached no verdict - ${q.reason}`);
    if (task.s_qa && task.s_qa.failed) L.push(`QA could not run: ${task.s_qa.failed}`, '');
  }
  L.push('## What a size-S task does not do', '');
  const roles = (task.team && task.team.opts && task.team.opts.roles) || {};
  const notes = [];
  if (roles.planning && roles.audit !== false) notes.push('the planning audit runs only on a size-L task (after integration) - it did not run here. Pin size L (tm_open size: "L") to have it.');
  if (roles.qa !== true) notes.push('roles.qa is off, so no QA card ran.');
  notes.push(`the run wrote straight into ${task.s_run.cwd}: no worktree, no branch, nothing committed - review and commit it yourself.`);
  L.push(bullets(notes));
  L.push(...wikiSection(task));
  return L.join('\n') + '\n';
}

// A size-S task's report on the development harness (S1/S1a): what the harness run itself
// says - its report, its goal gate - once it finished, or why it stopped once its driver died past
// its budget. null while it is still running: nothing is rendered ahead of the data.
export function renderHarnessReport(task) {
  const h = task.harness_run;
  const v = harnessOutcome(task);
  const finished = !!(v && v.finished);
  if (!finished && !h.exhausted) return null;
  const st = finished ? (v.accept ? 'complete' : 'partial') : 'blocked';
  const L = [frontmatter(epicKey(task.run_id), st === 'complete' ? 'DONE' : st.toUpperCase(), task), `# Report — size S on the development harness (${st})`, ''];
  let text = '';
  try { text = readFileSync(h.report_path, 'utf8').trim(); } catch { /* the driver did not copy it */ }
  if (!text && v) text = String(v.report_text || '').trim();
  if (finished) L.push(text || '(the harness run wrote no report text)', '');
  else L.push('The harness driver died past its restart budget before the run finished. tm_retry({task_id}) gives it a fresh driver on the same run.', '');
  if (v && v.readable) {
    L.push('## Goal gate', '', `${v.accept ? 'accepted' : 'not accepted'}${v.match_pct != null ? ` at ${v.match_pct}` : ''}`);
    if ((v.gaps || []).length) L.push('', 'Gaps:', bullets(v.gaps));
    L.push('');
  }
  const run = h.run;
  L.push('## Harness run', '', bullets([
    run ? (run.route === 'graph' ? `graph run ${run.run_id} at ${run.cwd}` : `Agent Team fallback run at ${run.run_dir}`) : 'no run was recorded',
    `the run wrote straight into ${h.cwd}: no worktree, no branch, nothing committed - review and commit it yourself.`,
  ]));
  L.push(...wikiSection(task));
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
  // A size-S task's report and retro wait for its QA verdicts (m4): until then the run's own
  // account is not the task's.
  // A legacy size-S task (S2) reports from its run alone; its QA cards are not waited on.
  const hReport = task.harness_run ? renderHarnessReport(task) : null;
  const sReport = !hReport && task.s_run && task.s_run.run_id ? renderSReport(task) : null;
  if (hReport) {
    files[paths.report] = hReport;
    files[paths.retro] = renderRetro(task);
  } else if (task.harness_run) {
    // Still running: no report or retro yet.
  } else if (sReport) {
    files[paths.report] = sReport;
    // A size-S task owes the next Sprint the same retro an L task does (M6).
    files[paths.retro] = renderRetro(task);
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
