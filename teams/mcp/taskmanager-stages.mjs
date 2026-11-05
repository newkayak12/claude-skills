// taskmanager-stages.mjs - the manager's stages and task creation; split out of taskmanager.mjs (card 128 step 1), moved verbatim.
import { FLOWS, appendDecisions, getNode, loadRunAt, node, openAsk } from './graph.mjs';
import { renderToFile as renderDiagram, validate as validateDiagram } from './diagram.mjs';
import { docPaths, epicKey } from './tickets.mjs';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { record, taskPath, tasksRoot } from './taskstate.mjs';
import { questionLine } from './docs.mjs';
import { readTeamConfig, resolveTeamOptions } from './teamconfig.mjs';
import { randomUUID } from 'node:crypto';
import { hasDeclaredAcceptance, resolvePlanningMode } from './acceptance.mjs';
import { epicSlug, uniqueSlug } from './names.mjs';
import { mutateTask } from './store.mjs';
import { lastRelevantEvent, resolveTaskRef } from './taskmanager-handlers.mjs';
import { git } from './taskmanager-worktree.mjs';
import { currentSessionId, taskState } from './taskmanager-drivers.mjs';
import { writeManagerBriefing } from './taskmanager-prompts.mjs';

// ---------- the manager's stages ----------

// Nodes that mutate something: integrate merges branches. Everything else reads and judges.
const MUTATING = new Set(['integrate']);
// The chain every package expands into. dispatch is executed by this server (worktree +
// child run); accept is a reasoning node judging what the child delivered.
const PACKAGE_CHAIN = ['dispatch', 'accept'];
// A judging node's verdict field; stage_ok alone never completes one of these.
const VERDICT = { critique: 'sound', 'areas-critique': 'sound', dispatch: 'accept', accept: 'accept', integrate: 'verified', gate: 'accept', 'plan-integrate': 'accept' };
// Judging stages whose positive verdict needs evidence (checks[]): a verdict with none is a guess.
const EVIDENCED = new Set(['gate', 'accept', 'integrate', 'plan-integrate', 'areas-critique']);

// The package map, drawn once per shape round beside the docs (20-shape.html + its .json IR).
// Shape's own diagram when it gave a valid one - its seams, its shared contracts - and otherwise
// the plain dependency map read off packages[].deps, so critique and integrate always have one.
// Drawing never fails a shape: a picture is evidence for the judges, not a gate.
export function autoPackageDiagram(packages) {
  const pkgs = (packages || []).filter((p) => !p.repair);
  const byId = new Map(pkgs.map((p) => [String(p.id), p]));
  const depth = new Map();
  const d = (id, seen = new Set()) => {
    if (depth.has(id)) return depth.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const deps = ((byId.get(id) || {}).deps || []).map(String).filter((x) => byId.has(x));
    const v = deps.length ? 1 + Math.max(...deps.map((x) => d(x, seen))) : 0;
    depth.set(id, v);
    return v;
  };
  const rowAt = new Map();
  const nodes = pkgs.map((p) => {
    const col = Math.min(d(String(p.id)), 11);
    const row = rowAt.get(col) || 0;
    rowAt.set(col, row + 1);
    const title = String(p.title || p.id);
    return { id: String(p.id), label: title.length > 48 ? `${title.slice(0, 45)}...` : title, sublabel: String(p.id), kind: 'package', row: Math.min(row, 20), col,
      ...(Array.isArray(p.touches) && p.touches.length ? { note: `touches: ${p.touches.join(', ')}`.slice(0, 400) } : {}) };
  });
  const lastCol = Math.min(Math.max(0, ...nodes.map((n) => n.col)) + 1, 12);
  const edges = [];
  // Transitive edges dropped: P4 -> P3 -> P1 already says P4 builds on P1, and the direct line
  // would run straight through P3's box.
  const reach = (from, to, seen = new Set()) => {
    for (const x of ((byId.get(from) || {}).deps || []).map(String)) {
      if (x === to) return true;
      if (!seen.has(x) && byId.has(x)) { seen.add(x); if (reach(x, to, seen)) return true; }
    }
    return false;
  };
  for (const p of pkgs) {
    const deps = (p.deps || []).map(String).filter((x) => byId.has(x));
    for (const dep of deps) if (!deps.some((o) => o !== dep && reach(o, dep))) edges.push({ from: dep, to: String(p.id), label: 'builds on' });
  }
  nodes.push({ id: 'integration', label: 'integration', kind: 'service', row: 0, col: lastCol });
  // Only the ends of each chain: a package something builds on reaches integration through it.
  const built = new Set(pkgs.flatMap((p) => (p.deps || []).map(String)));
  let ends = pkgs.filter((p) => !built.has(String(p.id))).map((p) => String(p.id));
  const pkgNodes = nodes.filter((n) => n.id !== 'integration');
  if (!ends.length && pkgNodes.length) ends = [pkgNodes.reduce((a, b) => (b.col > a.col ? b : a)).id]; // a cycle has no end
  for (const id of ends) edges.push({ from: id, to: 'integration', label: 'merged', style: 'data' });
  return { type: 'architecture', title: 'Package map', description: 'Read off packages[].deps - shape drew no valid diagram of its own.', nodes, edges };
}

// A group's box is drawn as the bounding rectangle of its own members' row/col cells
// (diagram.mjs's validate()) - a node that only shares a row or column with the group, without
// being listed as one of its members, reads as sitting inside that box. Shape sometimes groups
// nodes semantically (e.g. "rewriters" vs "scorers") without noticing its own row/col placement
// leaves one group's members interleaved with another's in the same column, which the bounding
// box always turns into exactly this defect (2026-09-28 portfolio-refresh run: rewriters at
// col 1 rows 0,1,3 bracket scorers' P3 at col 1 row 2, and vice versa). Rather than discard a
// shape that got everything else right, try the repair the validator's own message already
// names ("move it out"): give every flagged node a column past the diagram's current width,
// where no existing group's box can reach it. Attempted only when EVERY problem reported is one
// of these box-containment ones - a diagram with any other defect (a duplicate id, a missing
// edge, a bad label) is not this function's to fix, and it returns null so the caller falls back
// to the plain dependency map exactly as it did before this existed.
const GROUP_BOX_RE = /^node (\S+) \(row \d+, col \d+\) sits inside group /;
export function repairGroups(ir) {
  if (!ir || !Array.isArray(ir.nodes)) return null;
  const problems = validateDiagram(ir);
  if (!problems.length || !problems.every((p) => GROUP_BOX_RE.test(p))) return null;
  const repaired = JSON.parse(JSON.stringify(ir));
  const byId = new Map(repaired.nodes.map((n) => [String(n.id), n]));
  let col = Math.max(0, ...repaired.nodes.map((n) => Number(n.col) || 0));
  const moved = [];
  for (const p of problems) {
    const m = GROUP_BOX_RE.exec(p);
    const n = m && byId.get(m[1]);
    if (!n || moved.includes(n.id)) continue;
    col += 1;
    if (col > 12) return null; // past the grid the renderer draws - give up, auto takes over
    moved.push(n.id);
    n.col = col;
  }
  return validateDiagram(repaired).length ? null : { ir: repaired, moved };
}

// Shape's own map, with the two things the checker refused on real runs mended rather than
// thrown away: a label over the limit (portfolio-consolidate, four edge labels that were whole
// sentences) is cut to fit with the full text kept as the note, and a group whose box would
// swallow a non-member (portfolio-refresh) is dropped - the seams are what the map is for, and
// neither defect touches them. Anything else the checker refuses still falls back to auto.
const LABEL_MAX = 48;
export function mendDiagram(ir) {
  if (!ir || typeof ir !== 'object') return ir;
  const clip = (t) => (String(t).length > LABEL_MAX ? `${String(t).slice(0, LABEL_MAX - 1).trimEnd()}\u2026` : t);
  const out = { ...ir };
  out.nodes = (ir.nodes || []).map((n) => (n && typeof n.label === 'string' && n.label.length > LABEL_MAX
    ? { ...n, label: clip(n.label), note: [n.note, n.label].filter(Boolean).join(' - ') } : n));
  out.edges = (ir.edges || []).map((e) => (e && typeof e.label === 'string' && e.label.length > LABEL_MAX
    ? { ...e, label: clip(e.label), note: [e.note, e.label].filter(Boolean).join(' - ') } : e));
  if (Array.isArray(ir.groups) && ir.groups.length) {
    const groupProblem = (g) => validateDiagram({ ...out, groups: [g] }).some((p) => p.includes(`group ${g.id}`));
    out.groups = ir.groups.filter((g) => !groupProblem(g));
  }
  return out;
}

function drawShape(task, result) {
  // Order matters: clip over-long labels first (mendDiagram with no groups), then keep shape's
  // groups if they are valid or repairGroups can make them valid by moving the flagged nodes -
  // only then fall back to mendDiagram dropping the bad groups, which loses information the
  // repair keeps. Anything still invalid after both falls back to auto.
  const raw = result && result.diagram && typeof result.diagram === 'object' ? result.diagram : null;
  let ir = null, source = null, repaired = null;
  let problems = [];
  if (raw) {
    const clipped = mendDiagram({ ...raw, groups: [] });
    const withGroups = Array.isArray(raw.groups) && raw.groups.length ? { ...clipped, groups: raw.groups } : clipped;
    problems = validateDiagram(withGroups);
    if (!problems.length) { ir = withGroups; source = 'shape'; }
    else {
      const repair = repairGroups(withGroups);
      if (repair) { ir = repair.ir; source = 'shape-repaired'; repaired = repair.moved; }
      else {
        const mended = mendDiagram(raw);
        if (!validateDiagram(mended).length) { ir = mended; source = 'shape'; }
      }
    }
  }
  if (!source) { source = 'auto'; ir = autoPackageDiagram(task.spec && task.spec.packages); }
  try {
    const dir = docPaths(task).dir;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '20-shape.diagram.json'), JSON.stringify(ir, null, 2) + '\n');
    renderDiagram(ir, join(dir, '20-shape.html'));
    task.shape_diagram = { path: join(dir, '20-shape.html'), ir_path: join(dir, '20-shape.diagram.json'), source, ...(problems.length ? { problems: problems.slice(0, 20) } : {}), ...(repaired ? { repaired } : {}) };
  } catch (e) {
    task.shape_diagram = { source, error: String(e && e.message || e).slice(0, 300), ...(problems.length ? { problems: problems.slice(0, 20) } : {}), ...(repaired ? { repaired } : {}) };
  }
  record(task, { event: 'shape_diagram', task_id: task.run_id, source, path: task.shape_diagram.path || null, problems: problems.length });
}

// The seams as the drawing states them, in words a judge reads without opening the HTML.
function shapeDiagramLines(task) {
  const sd = task.shape_diagram;
  if (!sd || !sd.ir_path) return [];
  let ir;
  try { ir = JSON.parse(readFileSync(sd.ir_path, 'utf8')); } catch { return []; }
  const label = new Map((ir.nodes || []).map((n) => [n.id, n.label]));
  const L = ['', '## Package map', `${sd.source === 'shape' ? 'Shape drew this map of the packages and what crosses between them' : 'Shape drew no valid map; this one is read off packages[].deps'} - ${sd.path}. Each line below is a seam: check that both sides agree on what crosses it.`];
  for (const e of ir.edges || []) L.push(`- ${e.from} -> ${e.to}${e.label ? `: ${e.label}` : ''}${e.style && e.style !== 'sync' ? ` (${e.style})` : ''}`);
  const shared = (ir.nodes || []).filter((n) => !/^P\d|^integration$/.test(n.id) && n.kind !== 'package');
  if (shared.length) L.push(`Shared between packages: ${shared.map((n) => `${n.id} (${label.get(n.id)})`).join(', ')}`);
  return L;
}

function bullets(list) {
  return (list || []).map((x) => `- ${x}`).join('\n') || '- (none)';
}

// ---------- task creation ----------

// requests[]: a backlog instead of one request (§B.3) - several EPIC-level items, priority =
// array order (index 0 highest). task.requests carries the raw array (the retro and shape's own
// briefing both read it by index); task.request stays the ONE string every size/shape/PLAN
// briefing already reads - this is a second way to WRITE it, not a second thing anything
// downstream has to understand. Single `request` is untouched: this only runs when `requests`
// was actually given.
function composeBacklogRequest(requests) {
  return requests.map((r, i) => `[backlog priority ${i}] ${r}`).join('\n\n');
}

// Light PLAN mode §2.1a: requests[] items may be {request, acceptance: [...]} objects, and
// shared_acceptance: [...] may cover the whole backlog. The criteria are written into the ONE
// request string (as "Acceptance:" blocks, the same layout the free-text parser reads) so every
// briefing that already reads task.request sees them; a call that sends neither field composes
// byte for byte what it always did.
function requestText(r) {
  if (r && typeof r === 'object') {
    const text = String(r.request != null ? r.request : (r.text != null ? r.text : (r.title != null ? r.title : '')));
    const acc = Array.isArray(r.acceptance) ? r.acceptance.map((s) => String(s).trim()).filter(Boolean) : [];
    return acc.length ? `${text}\nAcceptance:\n${acc.map((s) => `- ${s}`).join('\n')}` : text;
  }
  return String(r);
}
function withSharedAcceptance(request, shared) {
  const list = Array.isArray(shared) ? shared.map((s) => String(s).trim()).filter(Boolean) : [];
  return list.length ? `${request}\n\nAcceptance for every item:\n${list.map((s) => `- ${s}`).join('\n')}` : request;
}

// tm_open({context_from: <prior task id or ticket key>}) (§B.2): folds a finished task's own
// retro.json - the Retrospective and Next backlog its report stage wrote (docs.mjs's
// renderRetro) - into this task's context, so a new Sprint opens already knowing what the last
// one left unresolved. Best-effort: a prior task with no report yet, an unreadable retro.json,
// or a ref that does not resolve at all leaves context untouched rather than failing tm_open
// over a document that is evidence, not a dependency (the same rule record()/writeDocs already
// follow elsewhere in this file).
// Best-effort by design - a follow-up Sprint still opens without its prior retro - but never
// silent: {text, unresolved} names why nothing was folded in, and tm_open hands that back, so a
// caller who asked for context_from learns it came up empty instead of assuming it did not.
function priorRetroContext(contextFrom) {
  if (!contextFrom) return { text: '', unresolved: null };
  let id = null;
  try { id = resolveTaskRef(contextFrom); } catch { id = null; }
  const prior = id && loadRunAt(taskPath(id));
  if (!prior) return { text: '', unresolved: `no task ${contextFrom} under ${tasksRoot()}` };
  const retroPath = docPaths(prior).retro;
  if (!existsSync(retroPath)) return { text: '', unresolved: `task ${prior.run_id} has no retro.json yet - its report has not run (${retroPath})` };
  try {
    const retro = JSON.parse(readFileSync(retroPath, 'utf8'));
    const L = [`Context from the prior task ${prior.run_id} (${epicKey(prior.run_id)}), "${String(prior.request || '').slice(0, 160)}":`, ''];
    L.push('Retrospective - what failed and why:');
    L.push(bullets((retro.retrospective.what_failed || []).map((f) => `${f.node_id} (${f.stage}): ${f.reason}`)));
    if ((retro.retrospective.retries || []).length) L.push('', 'Retries:', bullets(retro.retrospective.retries.map((r) => `${r.package_id}: ${r.attempts} attempts`)));
    if ((retro.next_backlog.unshipped_requests || []).length) L.push('', 'Next backlog - backlog items not shipped (priority order):', bullets(retro.next_backlog.unshipped_requests.map((r) => `[${r.priority}] ${r.request}`)));
    if ((retro.next_backlog.unfinished_stories || []).length) L.push('', 'Next backlog - user stories the prior Sprint did not ship:', bullets(retro.next_backlog.unfinished_stories.map((u) => `${u.id}${u.title ? ` ${u.title}` : ''}`)));
    L.push('', 'Next backlog - unaccepted packages:');
    L.push(bullets((retro.next_backlog.unaccepted_packages || []).map((p) => `${p.id} (${p.title}): ${p.reason}`)));
    if ((retro.next_backlog.unresolved_defects || []).length) L.push('', 'Unresolved defects:', bullets(retro.next_backlog.unresolved_defects.map((d) => d.title)));
    if ((retro.next_backlog.open_questions || []).length) L.push('', 'Open questions nobody answered:', bullets(retro.next_backlog.open_questions.map(questionLine)));
    // The prior Sprint's accepted work lives on its last verified integration branch, which
    // nothing merges into the project's own branch: code-sprint-S8's main was still at seed after
    // P1+P2 shipped, so a follow-up Sprint branched from HEAD would rebuild on nothing. When that
    // branch exists and HEAD does not already contain it, this task starts from it instead.
    const integ = prior.nodes.filter((n) => n.stage === 'integrate' && n.state === 'done' && n.integration && n.integration.branch).pop();
    let base_ref = null;
    if (integ) {
      const b = integ.integration.branch;
      const exists = git(prior.cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]).ok;
      const merged = exists && git(prior.cwd, ['merge-base', '--is-ancestor', b, 'HEAD']).ok;
      if (exists && !merged) {
        base_ref = b;
        L.push('', `This task starts from the prior task's integration branch ${b} - its accepted work is not on the project's own branch yet. Build on it; do not rebuild it.`);
      }
    }
    // Backlog candidates for this Sprint (sprint-not-sub-epic): handed back by tm_open so the
    // caller can put them to the person - never added to requests on their own.
    const carryover = [
      ...(retro.next_backlog.unshipped_requests || []).map((r) => ({ kind: 'request', priority: r.priority, text: r.request })),
      ...(retro.next_backlog.unfinished_stories || []).map((u) => ({ kind: 'story', id: u.id, text: u.title || u.id, ...(u.card ? { card: u.card } : {}), ...(u.acceptance ? { acceptance: u.acceptance } : {}) })),
    ];
    return { text: L.join('\n'), unresolved: null, base_ref, carryover };
  } catch (e) {
    return { text: '', unresolved: `retro.json of ${prior.run_id} could not be read: ${String((e && e.message) || e)}` };
  }
}

// Other live size-S tasks on the same cwd as `task` (two of them share one checkout, so their
// edits mix in one working tree; the engine's scope verdict counts only each run's own writes).
// Live = status not complete/partial/failed/cancelled/cleaned. Returns their task ids; best-effort, never throws.
export function sharedSizeSLive(task) {
  const out = [];
  if (!task || task.size !== 'S' || !task.cwd) return out;
  let ids = [];
  try { ids = readdirSync(tasksRoot()); } catch { return out; }
  const cwd = resolve(String(task.cwd));
  for (const id of ids) {
    if (id === task.run_id) continue;
    try {
      const t = loadRunAt(taskPath(id));
      if (!t || t.size !== 'S' || !t.cwd || resolve(String(t.cwd)) !== cwd) continue;
      if (lastRelevantEvent(id) === 'clean') continue;
      if (['done', 'complete', 'partial', 'failed', 'cancelled'].includes(taskState(t).state)) continue;
      out.push(id);
    } catch { /* unreadable task: not counted */ }
  }
  return out;
}

function sharedSizeSNote(task) {
  const ids = sharedSizeSLive(task);
  return ids.length ? `warning: other live size-S task(s) share this checkout (${ids.join(', ')}); their edits and yours mix in one working tree; the engine's scope verdict counts only the paths your own run wrote, so theirs never fail yours` : null;
}

// Slugs a new EPIC in `cwd` must not take: those of the repo's other tasks, and any teams/<slug>/
// branch namespace already in the repo. Best-effort: a git failure takes nothing.
function takenSlugs(cwd) {
  const taken = new Set();
  let ids = [];
  try { ids = readdirSync(tasksRoot()); } catch { ids = []; }
  // Same repo = same git common dir (a linked worktree shares its main checkout's); when git cannot
  // say, the old same-cwd rule stands.
  const common = (dir) => {
    const r = git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    return r.ok && r.out ? resolve(r.out) : null;
  };
  const mine = common(cwd);
  for (const id of ids) {
    const t = loadRunAt(taskPath(id));
    if (!t || !t.slug || !t.cwd) continue;
    // A cleaned task has let go of its slug; any branch it kept under it is still caught by the ref scan below.
    if (lastRelevantEvent(id) === 'clean') continue;
    const tcwd = resolve(String(t.cwd));
    if (tcwd === cwd || (mine && common(tcwd) === mine)) taken.add(t.slug);
  }
  const refs = git(cwd, ['for-each-ref', '--format=%(refname)', 'refs/heads/teams/']);
  if (refs.ok) for (const ref of refs.out.split('\n')) { const s = ref.split('/')[3]; if (s) taken.add(s); }
  return taken;
}

function createTask(a) {
  if (a.child_driver !== undefined || a.s_driver !== undefined) {
    throw new Error('child_driver and s_driver were removed in 0.10.0: the driving session never drives a child run or the manager loop. Open the task and watch tm_status / tm_events; the daemon and package drivers do the rest.');
  }
  const requests = Array.isArray(a.requests) && a.requests.length ? a.requests.map(requestText) : null;
  if (!requests && (a.request == null || String(a.request).trim() === '')) {
    throw new Error('tm_open needs either request (a string) or requests (a non-empty array of strings), not neither');
  }
  if (requests && a.request != null && String(a.request).trim() !== '') {
    throw new Error('tm_open takes request OR requests, not both - requests: [...] IS the several-item form of request');
  }
  const cwd = resolve(String(a.cwd));
  const teamFile = readTeamConfig(cwd);
  const team = resolveTeamOptions(a, teamFile.config);
  const T = team.opts;
  const taskId = randomUUID();
  const priorRetro = priorRetroContext(a.context_from);
  // A backlog held to a box is only boxable as packages: enforceBudget stops by leaving the
  // lowest-priority PACKAGES undispatched, and a size-S task has none, so an S backlog ran past
  // its budget to the end (code-sprint-S1, 2026-09-26: the ledger backlog measured S, as the
  // monorepo fixtures do). Pinned L here unless the caller pinned a size itself.
  const boxedBacklog = !!(requests && requests.length > 1 && (T.budget_usd != null || T.timebox_minutes != null));
  // roles.planning: true | 'light' | 'auto' (_repo/docs/plans/2026-09-28-teams-light-plan.md §2.5)
  // -> which PLAN chain every planning card runs. 'auto' reads the raw arguments (structured
  // fields first, the free-text parser second) and picks light or full. false is refused
  // (_repo/docs/plans/2026-09-28-teams-cards-everywhere.md C5): teamconfig.mjs dropped it with a note,
  // and resolvePlanningMode reads it as 'auto' - planning always produces its deliverables.
  const planning = resolvePlanningMode(T.roles.planning, a);
  const task = {
    run_id: taskId,
    kind: 'task',
    store_path: taskPath(taskId),
    cwd,
    // Optional grouping ABOVE the EPIC (teamconfig.mjs's own `initiative` key, already
    // slug-normalized there) - display/grouping only (tm_board, tm_ticket's `I-<slug>` key); no
    // scheduling or execution ever reads it. null (the default) keeps every EPIC ungrouped,
    // exactly today's behaviour.
    initiative: T.initiative,
    // The readable label of this EPIC (names.mjs), set once from the first request and used in its
    // branch and worktree names. A task without one (opened before it existed) keeps harness/<id8>/*.
    slug: uniqueSlug(epicSlug(requests ? requests[0] : String(a.request)), takenSlugs(cwd)),
    // Who opened the task: the person's session id, which drivers and the band need (§7 of _repo/docs/plans/mod/2026-10-17-subagent-communication.md); the MCP env is the only source.
    opener: { session_id: currentSessionId(), entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT || null },
    request: withSharedAcceptance(requests ? composeBacklogRequest(requests) : String(a.request), a.shared_acceptance),
    requests, // null for the ordinary single-request task - the byte-for-byte compat case.
    context: [priorRetro.text, a.context || ''].filter(Boolean).join('\n\n'),
    ...(priorRetro.unresolved ? { context_from_unresolved: priorRetro.unresolved } : {}),
    ...(priorRetro.carryover && priorRetro.carryover.length ? { carryover_candidates: priorRetro.carryover } : {}),
    // Where package and integration worktrees branch from (see priorRetroContext). null = HEAD.
    base_ref: priorRetro.base_ref || null,
    // HEAD of the project when the task opened: the baseline the gate-integrity list is judged against.
    base_commit: (() => { const r = git(cwd, ['rev-parse', 'HEAD']); return r.ok && r.out ? r.out : null; })(),
    flow: FLOWS[a.flow] ? a.flow : 'auto',
    flow_chosen: null,
    size: null,
    // The user said, in their own words, that this must be split (L) or must stay one run
    // (S): the size node is recorded as pinned and never measured. Mirrors the flow pin.
    size_pinned: ['S', 'L'].includes(a.size) ? a.size : (boxedBacklog ? 'L' : null),
    size_pin_source: ['S', 'L'].includes(a.size) ? 'caller' : (boxedBacklog ? 'boxed-backlog' : null),
    // false turns method off entirely; an object overrides STAGE_SKILLS per stage.
    stage_skills: a.skills === false ? false : (a.skills && typeof a.skills === 'object' ? a.skills : null),
    max_retries: T.max_retries,
    // How many times a package's dead driver is respawned on the SAME child run_id before the
    // dispatch is folded blocked. A usage-limit death never spends this budget - see
    // serviceDeadDriver.
    driver_restarts: T.driver_restarts,
    // See serviceStalledDriver/serviceDeadDriver and teamconfig.mjs's own comments: stall_minutes
    // flags (then, at 3x, kills) a driver that is alive but making no progress;
    // restart_period_minutes turns driver_restarts from a flat forever counter into a sliding
    // window.
    stall_minutes: T.stall_minutes,
    restart_period_minutes: T.restart_period_minutes,
    // Whether the single run a size-S request becomes is opened isolated. It is a tm_open
    // argument because the manager, not the entry skill, is what opens that run.
    isolated: a.isolated === true,
    // Same story as isolated: an entry skill pinned to 'develop' or 'document' says whether the
    // other kind may appear in the spec at all. Carried on the task, for that same size-S run.
    mixed: a.mixed !== false,
    // The floor the manager's own goal gate's match_pct must clear - same meaning, same
    // default, as the graph engine's run.goal_threshold.
    goal_threshold: T.goal_threshold,
    // Whether this EPIC's runs may stop and ask a person. Carried on the task as well as in
    // child_opts so tm_status can show it without opening a child run.
    interactive: T.interactive === true,
    // ms an `ask` card (this task's own or any child run's) may wait before expireAsks answers
    // it with its defaults, `by: 'timeout'`. null = forever. Only the manager reads it - it owns
    // the clock for every run under it, so it is not threaded into child_opts.
    ask_timeout: T.ask_timeout,
    // gate:human (0.29.0): which judging stages of THIS task's own manager graph (shape,
    // critique, accept, integrate, gate, gate:goal live in task.nodes - task.json is itself a
    // run, graph.mjs's promoteHumanGates works over it unmodified) a person must accept or
    // reject. Also threaded into child_opts below so every package's own child run gates the
    // same stages inside its own chain.
    human_gates: Array.isArray(T.human_gates) ? T.human_gates.slice() : [],
    // Set once a daemon is spawned for this task (serviceDaemon/spawnDaemon): {pid, started_at,
    // log, stderr, exit, command, spawn_count, restarts, exhausted}. null under noDaemon().
    daemon: null,
    // .claude/team.json project defaults, layered under explicit tm_open arguments - see
    // teamconfig.mjs. Recorded here (not just applied) so tm_status can show where each
    // resolved option came from.
    team: { opts: T, sources: team.sources, notes: team.notes, file_status: teamFile.status },
    // Everything a child run needs to route the way the parent's session routes.
    child_opts: {
      vendor: T.vendor,
      allocation: T.allocation,
      host_vendor: a.host_vendor || null,
      host_model: a.host_model || null,
      native_models: a.native_models || null,
      model: a.model || null,
      policy: a.policy && typeof a.policy === 'object' ? a.policy : {},
      candidates: a.candidates || null,
      sandbox: a.sandbox || null,
      // T already layers team.json under an explicit tm_open arg (teamconfig.mjs's
      // resolveTeamOptions), the same precedence vendor/allocation above already rely on -
      // so reading T here, not `a` with its own hardcoded fallback, is what keeps a project's
      // pinned goal_threshold/max_retries from being silently dropped for every child run.
      max_retries: T.max_retries,
      auto_reassign: a.auto_reassign !== false,
      goal_threshold: T.goal_threshold,
      // Read from T, not `a`, for the same reason max_retries/goal_threshold above are: a
      // project that pinned interactive in team.json means every child run, not just the
      // manager. This is the value graph.mjs's createRun turns into run.interactive, which is
      // what openAsk consults.
      interactive: T.interactive === true,
      // Same reasoning as interactive just above - a package's own child run gates the same
      // stages createRun's own chain has (critique, gate, gate:goal) that the project named.
      human_gates: Array.isArray(T.human_gates) ? T.human_gates.slice() : [],
      // team_open's own tool boundary (broker.mjs) defaults this to 2; createRun's own bare
      // default is 1, deliberately - see graph.mjs's createRun and the commit that introduced
      // goal_judges, 858e0b9: "createRun itself still defaults goal_judges to 1, so a caller
      // that builds runs directly - the TaskManager's per-package child runs among them - is
      // unaffected unless it asks otherwise". That was not an oversight left for this fix:
      // bumping this default to 2 was tried here first and broke 18 of this suite's existing
      // tests (every helper that drives a child to its report submits exactly one gate:goal:N -
      // a second, letter-suffixed sibling never gets a verdict and the round never settles). The
      // bug this fixes is narrower than the default: before this line, tm_open had no
      // `goal_judges` argument at all, so no caller could raise a package's judge count above 1
      // even by asking - every EPIC package was pinned to single-judge with no escape hatch.
      // Keeping createRun's own default here is consistent with that precedent AND lets an
      // explicit tm_open({goal_judges}) argument reach every child run for the first time. Not
      // yet a team.json key - teamconfig.mjs's TEAM_DEFAULTS is out of scope for this change.
      goal_judges: Number.isInteger(a.goal_judges) && a.goal_judges > 0 ? a.goal_judges : 1,
      // Read from T for the same reason interactive/goal_threshold above are: a project that
      // pins retry_policy in team.json means every child run's own retrySubgoal, not just this
      // task's own retryPackage (which reads task.team.opts.retry_policy directly - see
      // retryPackage). graph.mjs's createRun turns this into run.retry_policy.
      retry_policy: T.retry_policy === 'rollback' ? 'rollback' : 'continue',
    },
    created_at: Date.now(),
    spec: null,
    // Set only for a size-S task: {cwd, run_id, driver, spawn_count,
    // waiting_capacity?} for the one graph run the manager opened and is driving with a
    // headless session, mirroring a package's n.child.
    s_run: null,
    // The planning cards (_repo/docs/plans/2026-09-28-teams-cards-everywhere.md C2): one STORY card
    // per feature area, PLAN-F1, PLAN-F2, ... - opened by the `areas` node's result (expandPlanning),
    // or by delegateIfSmall for a size-S task (C6: one card). Stashed here, never in
    // task.spec.packages (which shape owns, and which is still null while planning runs);
    // packageOf and tickets.mjs's planningPkgs read them from here.
    planning_pkgs: [],
    // The feature areas the plan stage split the request into ({id: 'F1', title, brief, ...}),
    // in card order. QA splits by the same areas (C7).
    areas: [],
    // 'full' | 'light', and why - tm_status/the docs read these. The declared criteria are kept
    // only for a light run: each card's PLAN context renders them.
    planning_mode: planning.mode,
    planning_mode_reason: planning.reason,
    ...(planning.mode === 'light' && planning.detection && planning.detection.declared
      ? { declared_acceptance: { via: planning.detection.via, items: planning.detection.items, shared: planning.detection.shared } }
      : {}),
    // size, then the plan stage. Everything after `areas` - the planning cards, plan-integrate,
    // shape and critique - is pushed once the areas are known (expandPlanning).
    nodes: [node('size', 'size', []), node('areas', 'areas', ['size']), node('areas-critique', 'areas-critique', ['areas'])],
  };
  openBrainstorm(task, a, T);
  // Created through the store like every other task write; the object returned is the one written.
  return mutateTask(task.store_path, (fresh) => Object.assign(fresh, task), { create: true });
}

// §6.5 (_repo/docs/plans/2026-09-28-teams-light-plan.md): where the person comes in first is not
// PLAN's ask - PLAN runs in a detached daemon that cannot know whether anyone is there - but the
// entry skill's brainstorm with the user, just before it calls tm_open. What they settled
// arrives as tm_open({decisions}) and becomes the first entries of task.decisions. When they
// skipped it (no decisions[] at all), the engine holds the brainstorm itself: a `brainstorm`
// judging node right after size, ahead of whatever size fed (PLAN, or shape with planning off).
// Rewired by dep rather than by building a second node list, so it sits in front of whichever
// chain createTask above built. A size-S task skips it with every other manager node
// (delegateIfSmall) - the development harness gets task.decisions in its driver's prompt.
// `brainstorm: false` (team.json or tm_open) turns the node off; decisions[] still apply.
const BRAINSTORM_LIGHT = `LIGHT mode: the request already declares its backlog and acceptance criteria. Do not re-plan it - restate "intent" and "scope" only, return "approaches": [] and leave "chose"/"because" empty, list only assumptions the criteria leave open, and ask at most 2 questions (only what the criteria contradict or leave to the requester).`;

function openBrainstorm(task, a, T) {
  task.decisions = [];
  const given = Array.isArray(a.decisions);
  task.session_brainstorm = given;
  if (given) appendDecisions(task.decisions, a.decisions, { owner: 'requester', decided_in: 'session', source: 'brainstorm' });
  if (given || T.brainstorm === false) return;
  for (const x of task.nodes) {
    if (x.node_id !== 'size' && x.deps.includes('size')) x.deps = x.deps.map((d) => (d === 'size' ? 'brainstorm' : d));
  }
  const b = node('brainstorm', 'brainstorm', ['size']);
  // §6.5-4: a backlog that already states its acceptance gets an intent/scope-only brainstorm -
  // the same detector light PLAN uses, run on the raw arguments so it holds with planning off too.
  if (task.declared_acceptance || hasDeclaredAcceptance(a)) b.brainstorm_mode = 'light';
  task.nodes.splice(1, 0, b);
}

// The brainstorm node's result, written into task.decisions (§6.5-3). Everything the engine
// settled on its own is source 'self-brainstorm'; the questions go to one ask card when the task
// is interactive (finish's own questions[] block opens it - `to` is flattened here so the card is
// ONE card, not one per owner) and are otherwise decided by their defaults right here.
function foldBrainstorm(task, n, result) {
  const self = { owner: 'engine', decided_in: 'brainstorm', source: 'self-brainstorm' };
  const list = task.decisions || (task.decisions = []);
  const entries = [];
  if (result.intent) entries.push({ question: 'What is this task for (intent)?', chose: String(result.intent) });
  const scope = result.scope && typeof result.scope === 'object' ? result.scope : {};
  if (Array.isArray(scope.in) && scope.in.length) entries.push({ question: 'What is in scope?', chose: scope.in.map(String).join('; ') });
  if (Array.isArray(scope.out) && scope.out.length) entries.push({ question: 'What is out of scope?', chose: scope.out.map(String).join('; ') });
  if (result.chose) entries.push({ question: 'Which approach?', chose: String(result.chose), because: result.because || '' });
  (Array.isArray(result.assumptions) ? result.assumptions : []).forEach((x, i) => entries.push({ question: `Assumption ${i + 1}`, chose: String(x) }));
  appendDecisions(list, entries, self);
  const qs = (Array.isArray(result.questions) ? result.questions : []).filter((q) => q && q.question);
  if (!qs.length) return;
  if (task.interactive) n.result = { ...n.result, questions: qs.map((q) => ({ ...q, to: 'requester' })) };
  else appendDecisions(list, qs, self);
}

// §6.2-4: blocking questions a package child run could not decide (graph.mjs's
// routeExecutionQuestions) stand ONCE for the whole EPIC, on a task-level card - never one card
// per package. Exact-question dedup against every earlier EPIC card and task.decisions; a
// question already on a card still waiting makes this package's accept wait on that same card.
// Not interactive: nobody would ever answer the card, so the question is recorded on
// task.unasked (the report's "decided for you" list) and nothing parks - the same rule
// applyHumanPin and promoteHumanGates already follow for a headless run.
function escalateBlocking(task, n, questions) {
  const decided = new Set((task.decisions || []).map((d) => d.question));
  const cards = task.nodes.filter((x) => x.stage === 'ask' && x.ask_owner === 'EPIC');
  const onCard = new Map();
  for (const c of cards) for (const q of c.questions || []) onCard.set(q.question || q.unknown, c);
  const accept = task.nodes.find((x) => x.stage === 'accept' && x.subgoal_id === n.subgoal_id && (x.attempt || 1) === (n.attempt || 1));
  const fresh = [];
  for (const q of questions) {
    if (!q || !q.question || decided.has(q.question)) continue;
    const c = onCard.get(q.question);
    if (c) {
      if (c.state === 'waiting_human' && accept && !accept.deps.includes(c.node_id) && !(accept.after || []).includes(c.node_id)) {
        accept.after = [...(accept.after || []), c.node_id];
      }
      continue;
    }
    if (!fresh.some((f) => f.question === q.question)) fresh.push({ ...q, raised_by: [String(n.subgoal_id)] });
  }
  if (!fresh.length) return [];
  if (!task.interactive) {
    task.unasked = [...(task.unasked || []), ...fresh.map((q) => ({ ...q, node_id: n.node_id, decided: q.default !== undefined ? q.default : null }))];
    return [];
  }
  const ids = openAsk(task, { ...n, subgoal_id: undefined }, fresh.map((q) => ({ ...q, to: 'requester' })), { owner: 'EPIC', attempt: cards.length + 1, blocking: true });
  for (const id of ids) writeManagerBriefing(task, getNode(task, id));
  return ids;
}

export function mustFindTask(a) {
  // resolveTaskRef turns the ticket key E-xxxxxxxx into the run id it names (§8) - the same
  // 8-hex-prefix match tm_ticket resolves its key with. Every task_id-taking tool goes through
  // this one lookup (including callTool's own serviceDaemon call, which calls mustFindTask ahead
  // of dispatch), so a ticket key works anywhere a run id already did, tm_board included.
  const id = resolveTaskRef(a.task_id);
  const task = id && loadRunAt(taskPath(id));
  if (!task) throw new Error(`unknown task ${a.task_id}`);
  return task;
}

// The handler form of store.mjs mutateTask (2026-10-02 task-store review, U4): resolves the task
// ref exactly as mustFindTask does, then runs fn on a FRESH read inside the store lock and commits
// what fn left in its argument. A helper's own saveRun(task) of that same object is a no-op inside
// the transaction; fn throwing writes nothing and drops every record() it made. fn is synchronous
// and must not call an own-transaction function (advanceDispatches, prepareReadyIntegrations,
// foldDispatch, toolNext): those run their effects outside the lock, so call them after this.
function withTask(a, fn) {
  const id = resolveTaskRef(a.task_id);
  if (!id || !existsSync(taskPath(id))) throw new Error(`unknown task ${a.task_id}`);
  return mutateTask(id, fn);
}


export { BRAINSTORM_LIGHT, EVIDENCED, MUTATING, PACKAGE_CHAIN, VERDICT, bullets, createTask, drawShape, escalateBlocking, foldBrainstorm, shapeDiagramLines, sharedSizeSNote, withTask };
