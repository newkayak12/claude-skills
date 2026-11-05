// taskmanager-plan.mjs - planning cards, shape validation and expansion; split out of taskmanager.mjs (card 128 step 1), moved verbatim.
import { docPaths, latestBySubgoal, livePlanningPkgs, planningPkgs, planningStories, qaPkgs, storyId, storyLabel } from './tickets.mjs';
import { FLOWS, nextIndex, node, pushChain, saveRun, settleFailure } from './graph.mjs';
import { cardDocuments, renderPrd } from './docs.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { record } from './taskstate.mjs';
import { areaClaims, areaOwnershipOverlaps, formatShapeFeedback, pathOverlapProblems, scopesOverlap, shapePrecheck, touchScope } from './shapecheck.mjs';
import { PACKAGE_CHAIN, bullets } from './taskmanager-stages.mjs';
import { killDriver } from './taskmanager-drivers.mjs';

// ---------- planning cards (_repo/docs/plans/2026-09-28-teams-cards-everywhere.md C2-C4, C6) ----------
//
// The EPIC's plan stage (`areas`) splits the request by FEATURE; each area becomes one planning
// STORY card, PLAN-F<n>, dispatched and accepted exactly like a develop package - its own child
// run (the full harness: plan -> setgoal -> critique -> investigate/draft/revise/gate ->
// gate:goal -> report), its own worktree, its own retry on rejection. A card id is one ticket-key
// segment (tickets.mjs's parseTicketKey splits on '/'), so the area rides on it with a '-':
// E-xxxxxxxx/PLAN-F1. `plan-integrate` waits on every card's accept, merges their sections into
// one 10-prd.md and judges it (C4); a rejection sends the offending card(s) back with the gaps.

// The shape an `areas` result has to have for cards to be opened from it.
export function validateAreas(result) {
  const areas = result && Array.isArray(result.areas) ? result.areas : null;
  if (!areas || !areas.length) return ['the plan stage returned no feature areas - there would be no planning card to open'];
  const problems = [];
  areas.forEach((a, i) => {
    if (!a || typeof a !== 'object') { problems.push(`area ${i + 1} is not an object`); return; }
    if (!String(a.title || '').trim()) problems.push(`area ${a.id || i + 1} has no title`);
    if (!String(a.brief || '').trim()) problems.push(`area ${a.id || i + 1} has no brief - its planning card would have no request`);
  });
  return problems;
}

// One area -> one planning card. The card id is PLAN-F<n> by position, whatever id the plan
// stage wrote: positional ids are what keeps a replan's new card from colliding with an old one.
function planningCard(task, area, f) {
  const title = String(area.title || '').trim() || 'the whole request';
  const single = !!area.whole;
  const items = Array.isArray(area.items) ? area.items.map(Number).filter((x) => Number.isInteger(x) && x > 0) : [];
  return {
    id: `PLAN-${f}`,
    area: f,
    area_title: title,
    phase: 'planning',
    flow: 'plan',
    planning_mode: task.planning_mode || 'full',
    title: `PRD: ${title}`,
    brief: single
      ? String(task.request)
      : [`Feature area ${f} - ${title}`, '', String(area.brief || '').trim(), '', 'The whole request this area is one part of (other planning cards own the rest):', String(task.request)].join('\n'),
    acceptance: [
      `the PRD section for feature area ${f} states its goal, its scope and non-goals, its user stories - each with acceptance criteria, ids ${f}-US-1, ${f}-US-2, ... - and its open questions`,
    ],
    deps: [],
    touches: [],
    ...(items.length ? { items } : {}),
  };
}

// Opens a card per area (appending to task.planning_pkgs and task.areas) and returns their
// accept ids. headDeps is what the cards wait on - the areas node, or size for a size-S task.
// An area's deps name earlier areas (by the id the plan stage used, or F<n>); anything else is
// dropped - a dep can only point backwards, so no cycle can be written.
function addPlanningCards(task, areas, headDeps) {
  task.planning_pkgs = planningPkgs(task).slice();
  task.areas = Array.isArray(task.areas) ? task.areas : [];
  const idOf = new Map();
  const acceptIds = [];
  for (const area of areas) {
    const f = `F${task.planning_pkgs.length + 1}`;
    const card = planningCard(task, area, f);
    const deps = (Array.isArray(area.deps) ? area.deps : []).map(String).map((d) => idOf.get(d) || (task.planning_pkgs.some((p) => p.area === d) ? `PLAN-${d}` : null)).filter(Boolean);
    card.deps = [...new Set(deps)];
    if (area.id != null) idOf.set(String(area.id), card.id);
    idOf.set(f, card.id);
    task.planning_pkgs.push(card);
    task.areas.push({ id: f, title: card.area_title, brief: String(area.brief || task.request), ...(card.items ? { items: card.items } : {}) });
    const depAccepts = card.deps.map((d) => { const acc = latestBySubgoal(task, d, 'accept'); return acc ? acc.node_id : `accept:${d}:1`; });
    acceptIds.push(pushChain(task, PACKAGE_CHAIN, card.id, 1, [...headDeps, ...depAccepts], [], {}));
  }
  return acceptIds;
}

// The areas' cards, the planning integrate behind them, and - for a size-L task - shape and
// critique behind that. A size-S task stops at plan-integrate: finish() opens its one run there.
function expandPlanning(task, areas, headDeps, { withShape }) {
  const acceptIds = addPlanningCards(task, areas, headDeps);
  const pi = `plan-integrate:${nextIndex(task, 'plan-integrate')}`;
  task.nodes.push(node(pi, 'plan-integrate', acceptIds, { subgoal_id: null }));
  if (withShape) {
    task.nodes.push(node('shape', 'shape', [pi]));
    task.nodes.push(node('critique', 'critique', ['shape']));
  }
  return pi;
}

// The planning integrate shape (and a reshape) waits on: the latest one nothing superseded.
function planIntegrateHead(task) {
  const live = task.nodes.filter((n) => n.stage === 'plan-integrate' && !task.nodes.some((x) => x.supersedes === n.node_id));
  return live.length ? live[live.length - 1].node_id : null;
}

// Story ids defined more than once across the EPIC, with the cards that define each - the
// deterministic half of plan-integrate's first check, which no judge has to be trusted with.
export function storyDuplicates(stories) {
  const byId = new Map();
  for (const u of stories || []) {
    const id = storyId(u);
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(String((u && u.card) || '?'));
  }
  return [...byId.entries()].filter(([, cards]) => cards.length > 1).map(([id, cards]) => ({ id, cards }));
}

// Mechanical up to the judging, like prepareIntegration: the merged 10-prd.md is written here,
// from every card's accepted section (docs.mjs's renderPrd), and the facts the judge is handed -
// every story by card, and the ids that already collide - are recorded on the node.
export function preparePlanIntegration(task, n) {
  const stories = planningStories(task);
  const path = docPaths(task).prd;
  // The sections this integrate merges, kept on the node: a card's worktree does not outlive
  // tm_clean, and the merged PRD has to (docs.mjs's cardDocuments reads this first).
  n.prd = { docs: livePlanningPkgs(task).flatMap((p) => { const c = cardDocuments(task, p); return c.dispatch ? c.docs.map((x) => ({ card: String(p.id), dispatch: c.dispatch.node_id, path: x.path, text: x.text })) : []; }) };
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderPrd(task));
  } catch (e) {
    record(task, { event: 'prd_merge_write_failed', task_id: task.run_id, node_id: n.node_id, reason: String((e && e.message) || e).slice(0, 200) });
  }
  n.prd = {
    ...n.prd,
    path,
    cards: livePlanningPkgs(task).map((p) => ({ id: String(p.id), title: p.area_title || p.title, stories: stories.filter((u) => u.card === String(p.id)).map(storyId) })),
    stories: stories.map((u) => ({ id: storyId(u), title: (u && u.title) || '', card: u.card })),
    duplicates: storyDuplicates(stories),
  };
  record(task, { event: 'plan_integrate_prepared', task_id: task.run_id, node_id: n.node_id, cards: n.prd.cards.length, stories: n.prd.stories.length, duplicates: n.prd.duplicates.length });
}

// A planning integrate that refused (C4): each card it named goes back through retryPackage with
// the gaps as feedback (the same budget a rejected accept spends), a feature no card owns opens a
// new card, and a fresh plan-integrate waits on the cards' newest accepts - shape moves behind it.
// Bounded like a reshape: max_retries + 1 planning integrates, then the failure settles.
function replanPlanning(task, n) {
  const rounds = task.nodes.filter((x) => x.stage === 'plan-integrate').length;
  if (rounds > task.max_retries) {
    const unreachable = settleFailure(task, n);
    record(task, { event: 'plan_integrate_settled', task_id: task.run_id, node_id: n.node_id, reason: 'planning integrate budget exhausted', unreachable });
    return null;
  }
  const r = n.result || {};
  const cards = new Set(livePlanningPkgs(task).map((p) => String(p.id)));
  const gapsByCard = new Map();
  const add = (card, gap) => { if (!cards.has(card) || !gap) return; if (!gapsByCard.has(card)) gapsByCard.set(card, []); gapsByCard.get(card).push(gap); };
  for (const d of r.duplicate_ids || []) {
    for (const c of d.cards.slice(1)) add(c, `story id ${d.id} is also defined by ${d.cards[0]}: renumber this card's stories with its own prefix (${String(c).replace(/^PLAN-/, '')}-US-n)`);
  }
  // Every offender of a card lands in one gap set, so one retry message lists all its bad stories.
  for (const p of r.placeholder_acceptance || []) {
    add(String(p.card), `story ${p.story} has acceptance that is a placeholder or a bare id, not a criterion: "${String(p.item).slice(0, 160)}" - write the full criterion text of each AC (F<n>-AC-n: Given ..., When ..., Then ...) in that story's acceptance[], not a pointer to the document and not an id`);
  }
  for (const x of Array.isArray(r.retry) ? r.retry : []) {
    const card = x && x.card != null ? String(x.card) : '';
    const gaps = Array.isArray(x && x.gaps) ? x.gaps.map(String) : [];
    for (const g of gaps.length ? gaps : [r.reason || 'the planning integrate rejected this card']) add(card, g);
  }
  const newAreas = (Array.isArray(r.new_areas) ? r.new_areas : []).filter((a) => a && String(a.title || '').trim() && String(a.brief || '').trim());
  // A feature nobody owns, with no card named and no new area written: it still needs an owner.
  const uncovered = (Array.isArray(r.uncovered) ? r.uncovered : []).map(String).filter(Boolean);
  if (uncovered.length && !newAreas.length && !gapsByCard.size) {
    newAreas.push({ title: 'features no card covered', brief: `The planning integrate found features the request names that no planning card covers:\n${bullets(uncovered)}` });
  }
  const context = [r.reason, ...(r.contradictions || []).map((c) => `contradiction: ${c}`), ...uncovered.map((u) => `uncovered: ${u}`)].filter(Boolean);
  const retried = [];
  for (const [card, gaps] of gapsByCard) {
    const out = retryPackage(task, card, [`The planning integrate (${n.node_id}) sent this card back:`, ...gaps, ...context].join('\n- '));
    if (out.attempt) retried.push(card);
  }
  // A new card waits on what the first cards waited on: the plan stage's split (or size, for a
  // size-S task, which has no split).
  // Behind the split's own gate when it had one (M4): the card waits on what the first cards did.
  const split = task.nodes.filter((x) => x.stage === 'areas' && x.state === 'done').pop();
  const judged = split && task.nodes.find((x) => x.stage === 'areas-critique' && x.state === 'done' && x.deps.includes(split.node_id));
  const opened = newAreas.length ? addPlanningCards(task, newAreas, [judged ? judged.node_id : split ? split.node_id : 'size']) : [];
  // Nothing actionable at all still gets a fresh integrate: the same merge re-judged once more,
  // with the refusal as its feedback, inside the same round budget.
  const accepts = livePlanningPkgs(task).map((p) => { const acc = latestBySubgoal(task, String(p.id), 'accept'); return acc ? acc.node_id : null; }).filter(Boolean);
  const fresh = `plan-integrate:${nextIndex(task, 'plan-integrate')}`;
  task.nodes.push(node(fresh, 'plan-integrate', accepts, {
    subgoal_id: null, supersedes: n.node_id,
    feedback: [r.reason || '', ...[...gapsByCard].map(([c, g]) => `${c}: ${g.join('; ')}`), ...context.slice(1)].filter(Boolean).join('\n- '),
  }));
  for (const x of task.nodes) {
    if (x.node_id === fresh) continue;
    x.deps = x.deps.map((d) => (d === n.node_id ? fresh : d));
    x.after = (x.after || []).map((d) => (d === n.node_id ? fresh : d));
  }
  record(task, { event: 'plan_integrate_replan', task_id: task.run_id, node_id: n.node_id, fresh, retried, opened: opened.map((a) => a.split(':')[1]) });
  return fresh;
}

// A failed `areas` split gets its next attempt the way a failed shape does (autoReshape), with
// the problems as feedback; past max_retries + 1 attempts the failure settles.
function retryAreas(task, feedback) {
  const priors = task.nodes.filter((n) => n.stage === 'areas');
  const attempt = priors.length + 1;
  if (attempt > task.max_retries + 1) {
    // A refused split is a failed critique over a done split (M4): both settle.
    const dead = task.nodes.filter((n) => (n.stage === 'areas' || n.stage === 'areas-critique') && n.state === 'failed' && !n.final);
    const unreachable = dead.flatMap((n) => settleFailure(task, n));
    return { attempt: null, reason: 'retry budget exhausted', unreachable };
  }
  const first = priors[0];
  const id = `areas:${attempt}`;
  task.nodes.push(node(id, 'areas', first ? first.deps.slice() : ['size'], { attempt, feedback: feedback || '' }));
  task.nodes.push(node(`areas-critique:${attempt}`, 'areas-critique', [id], { attempt }));
  return { attempt, reason: '' };
}

// Ownership overlaps the manager counts itself: the mechanical pairs (areaOwnershipOverlaps) plus
// the judge's own "overlap ..." problems that name a file and a call-shaped function, a file-tied
// line range, or two area ids and an owner. A problem that only says "same file" stays advice.
function areaOverlapBlocking(areas, result, have) {
  const soft = (Array.isArray(result.problems) ? result.problems : []).map(String).filter((p) => {
    if (!/^\s*overlap\b/i.test(p)) return false;
    const c = areaClaims({ brief: p });
    if (!c.files.size) return false;
    return c.fns.size > 0 || c.ranges.length > 0 || (new Set(p.match(/\bF\d+\b/g) || []).size >= 2 && /\bowner\b/i.test(p));
  });
  return [...areaOwnershipOverlaps(areas), ...soft].filter((x) => !have.includes(x));
}

// The split an areas-critique judged: the areas node it waits on.
function areasOf(task, critique) {
  return task.nodes.find((x) => x.stage === 'areas' && critique.deps.includes(x.node_id)) || null;
}

// The planning integrate asked for the split itself to be redone (M4): every live card is retired
// - kept as history, dropped from the PRD, the stories, QA and shape's coverage - and the plan
// stage splits again, judged again by areas-critique before any new card runs. Its cards open
// behind a fresh plan-integrate that supersedes this one, and shape moves behind that
// (expandAcceptedSplit). Bounded by the areas budget: with no split attempt left the refusal is
// handled like any other (replanPlanning).
function resplitPlanning(task, n) {
  const attempts = task.nodes.filter((x) => x.stage === 'areas').length;
  if (attempts + 1 > task.max_retries + 1) return replanPlanning(task, n);
  const retired = [];
  for (const p of livePlanningPkgs(task)) {
    p.retired = { by: n.node_id, at: Date.now() };
    retired.push(String(p.id));
  }
  for (const a of (task.areas || [])) if (retired.includes(`PLAN-${a.id}`)) a.retired = true;
  for (const x of task.nodes) {
    if (!retired.includes(String(x.subgoal_id))) continue;
    if (x.state === 'running' && x.child && killDriver(x.child.driver)) {
      record(task, { event: 'child_driver_killed', task_id: task.run_id, node_id: x.node_id, reason: `retired by ${n.node_id} (resplit)` });
    }
    if (x.state === 'pending' || x.state === 'running') {
      x.state = 'skipped';
      x.result = { stage_ok: false, reason: `superseded: retired by ${n.node_id}, which asked for the feature split to be redone` };
    }
    if (x.state === 'failed') x.final = true;
  }
  n.resplit = { retired };
  n.final = true;
  task.resplit_from = n.node_id;
  const fb = [`The planning integrate (${n.node_id}) refused the split itself - its cards were retired:`, n.result && n.result.reason,
    ...((n.result && n.result.contradictions) || []).map((c) => `contradiction: ${c}`),
    ...((n.result && n.result.uncovered) || []).map((u) => `uncovered: ${u}`)].filter(Boolean).join('\n- ');
  const out = retryAreas(task, fb);
  record(task, { event: 'plan_integrate_resplit', task_id: task.run_id, node_id: n.node_id, retired, attempt: out.attempt });
  return out.attempt ? `areas:${out.attempt}` : null;
}

// A judged split's cards: the first open them with shape and critique behind; a re-split's open
// behind a fresh plan-integrate that supersedes the refused one, and whatever waited on that one
// (shape) waits on the fresh one.
function expandAcceptedSplit(task, critique) {
  const split = areasOf(task, critique);
  if (!split || !split.result || livePlanningPkgs(task).length) return null;
  const hasShape = task.nodes.some((x) => x.stage === 'shape');
  const pi = expandPlanning(task, split.result.areas, [critique.node_id], { withShape: !hasShape });
  const old = task.resplit_from;
  if (old) {
    const fresh = task.nodes.find((x) => x.node_id === pi);
    fresh.supersedes = old;
    for (const x of task.nodes) {
      if (x.node_id === pi) continue;
      x.deps = x.deps.map((d) => (d === old ? pi : d));
      x.after = (x.after || []).map((d) => (d === old ? pi : d));
    }
    delete task.resplit_from;
  }
  record(task, { event: 'planning_cards_opened', task_id: task.run_id, node_id: critique.node_id, cards: livePlanningPkgs(task).map((p) => p.id), plan_integrate: pi });
  return pi;
}

// What the merged PRD says, for a run or a judge that must build or check against it: where it
// is, and every user story with its acceptance. Shared by the size-S run (C6), shape's briefing
// and the audit/QA cards.
function planningStoryLines(stories) {
  return stories.map((u) => {
    const acc = u && typeof u === 'object' && Array.isArray(u.acceptance) ? u.acceptance : [];
    return [`- ${storyLabel(u)}${u && u.card ? ` (${u.card})` : ''}`, ...acc.map((x) => `  - ${x}`)].join('\n');
  }).join('\n') || '- (none)';
}

// ---------- shape validation and expansion ----------

// userStories is the merged PRD's stories - every planning card's accepted user_stories[]
// (tickets.mjs's planningStories) - passed by finish(), so this stays a pure function of what it
// is handed. undefined/null skips the check entirely (a caller with no planning to check against;
// the engine itself always passes the list now that planning always runs).
// touchScope / scopesOverlap / pathOverlapProblems / shapePrecheck live in shapecheck.mjs, which
// the shape stage can also run on a draft (node shapecheck.mjs --prd ... --shape ...).

// Two packages claim a path in common, by the rule validateShape uses for shape's packages.
function touchesOverlap(a, b) {
  const scopes = (p) => ((p && p.touches) || []).map((t) => touchScope(String(t).replace(/\/+$/, '')));
  const theirs = scopes(b);
  return scopes(a).some((x) => theirs.some((y) => scopesOverlap(x, y)));
}

// Every id a STORY key can name, cards first (m8): tm_ticket's refusal listed only the shape's
// packages and said "none yet" while planning cards were running.
function knownIds(task) {
  return [...planningPkgs(task), ...((task.spec && task.spec.packages) || []), ...qaPkgs(task), ...(task.audit_pkg ? [task.audit_pkg] : [])].map((p) => String(p.id));
}

export function validateShape(spec, userStories) {
  const problems = [];
  if (!spec || typeof spec !== 'object') return ['shape returned no packages object'];
  if (!Array.isArray(spec.acceptance) || !spec.acceptance.length) problems.push('shape has no goal-level acceptance criteria');
  const packages = spec.packages;
  if (!Array.isArray(packages) || !packages.length) {
    problems.push('shape has no packages - there would be nothing to dispatch');
    return problems;
  }
  if (packages.length === 1) problems.push('shape has one package: a request that fits one run is size S and needs no manager');
  const ids = new Set();
  for (const p of packages) {
    const id = p && p.id != null ? String(p.id) : '';
    if (!id) { problems.push('a package has no id'); continue; }
    if (ids.has(id)) problems.push(`duplicate package id ${id}`);
    // The cards own these ids (m8): a develop package named PLAN-F1, QA-F2 or AUDIT would collide
    // with a card's nodes, ticket key and worktree.
    if (/^(PLAN|QA)(-|$)|^AUDIT$/i.test(id)) problems.push(`package id ${id} is reserved for the planning/QA/audit cards - name develop packages P1, P2, ...`);
    ids.add(id);
    if (!p.title) problems.push(`package ${id} has no title`);
    if (!p.brief) problems.push(`package ${id} has no brief - its child run would have no request`);
    if (!Array.isArray(p.acceptance) || !p.acceptance.length) problems.push(`package ${id} has no acceptance criteria`);
    if (p.flow != null && !FLOWS[p.flow]) problems.push(`package ${id} has unknown flow ${p.flow}`);
  }
  for (const p of packages) {
    const id = p && p.id != null ? String(p.id) : '';
    for (const d of (p && p.deps) || []) {
      const dep = String(d);
      if (dep === id) problems.push(`package ${id} depends on itself`);
      else if (!ids.has(dep)) problems.push(`package ${id} depends on ${dep}, which is not in the shape`);
    }
  }
  // Overlapping touches is what integration conflicts are made of; say so before dispatch.
  // Containment counts, not only equality: idol-pm-4 (2026-09-23) passed with P1 owning
  // src/identity/module.ts and P2 owning src/identity/**, one file claimed twice in two spellings.
  problems.push(...pathOverlapProblems(packages));
  const edges = new Map(packages.map((p) => [String(p.id), ((p.deps || []).map(String)).filter((d) => ids.has(d))]));
  const state = new Map();
  const walk = (id, path) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') { problems.push(`dependency cycle: ${[...path.slice(path.indexOf(id)), id].join(' -> ')}`); return; }
    state.set(id, 'open');
    for (const d of edges.get(id) || []) walk(d, [...path, id]);
    state.set(id, 'done');
  };
  for (const id of ids) walk(id, []);
  // §5's completeness check: every user story planning produced must be implemented by some
  // package, or it silently falls through the crack between "planning decided it" and "shape
  // scheduled it". Only checked when planning actually ran (userStories is an array, not null).
  if (Array.isArray(userStories)) {
    const claims = (p) => (Array.isArray(p && p.implements) ? p.implements.map(String) : []);
    const covered = new Set(packages.flatMap(claims));
    const missing = userStories.map(storyId).filter((u) => u && !covered.has(u));
    if (missing.length) problems.push(`user stories not implemented by any package: ${missing.join(', ')}`);
    // Union coverage alone is satisfied by a shape where everyone claims everything, and that
    // is what a real one did: idol-pm-2 (2026-09-22) had P1 and P6 each claim all four stories,
    // so the check passed over a split that said nothing about who owns what. These two read the
    // same field for what it is meant to mean - what this package delivers, not what it touches.
    const ids = userStories.map(storyId).filter(Boolean);
    if (ids.length && packages.length > 1) {
      for (const p of packages) {
        const mine = new Set(claims(p));
        // A package that owns only rule one's shared artifacts - the composition root, a shared
        // contract - delivers no story itself. Requiring implements[] of it made the shape lie:
        // idol-pm-4 (2026-09-23) pinned US-7 on its foundation package to pass, and when shape:2
        // told the truth (P1 and P7 with no story) this check rejected it.
        const enables = new Set((Array.isArray(p && p.enables) ? p.enables : []).map(String).filter((u) => ids.includes(u)));
        if (!mine.size && !enables.size) problems.push(`package ${p.id} implements no user story: every package in a planned task delivers some part of the PRD, or it is not in this shape - a package that owns only shared artifacts other packages build on lists the stories it makes possible in enables[] instead`);
        // With one story the claim cannot be told from "delivers the story"; other packages may enable it.
        else if (ids.length > 1 && ids.every((u) => mine.has(u))) problems.push(`package ${p.id} claims every user story (${ids.join(', ')}): implements[] is what this package delivers, not what it touches - a package that delivers all of them is the whole job, not a package`);
      }
    }
    // Acceptance IDs ride under their story (sdd step 3, option A: no new field): a package that
    // implements a story carries that story's AC-n, ID-prefixed, in its own acceptance[]. Only
    // checked when the PRD wrote AC-n at all, so a PRD without them is untouched.
    // shapecheck.mjs reads who carries which AC: missing, carried by two packages, unknown. Its
    // path overlaps are already in problems above, so they are not added a second time.
    const pre = shapePrecheck({ packages }, userStories);
    problems.push(...pre.problems.filter((x) => !pre.overlaps.includes(x)));
  }
  return problems;
}

// Signals, not a validator: the shapes validateShape lets through can still be a foundation
// package holding nine scopes while its siblings hold two, or a strict chain no sibling could
// have started earlier - a real small app can legitimately be one linear chain, so this never
// fails the shape itself. It only computes facts for critique to weigh against the brief.
// Evidence: awake-beta-ref1 (P1<-P2<-P3<-P4, P1 owned contracts+policy+tests, 3 attempts) and
// idol-beta-pm4 (P1 owned kernel+contracts+app+a whole catalog domain) both passed validateShape
// clean; critique named the frozen-contract risk in ref1's problems[] but never blocking[].
//
// touches breadth is `touches[].length` - how many scopes a package claims. bloat fires when a
// package's breadth is >= 2x the sibling median AND >= BLOAT_FLOOR, so a 2-vs-1 split on a
// two-package task (median 1, floor unmet) does not trip it - only a package that is really
// carrying disproportionate scope does.
const BLOAT_FLOOR = 4;

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// max_parallel_width: the DAG's widest round, the same readiness graph.mjs itself would compute
// - a package is ready once every package it deps on has already been placed in an earlier
// round. phase-Teams (QA/audit) are never in `packages` (expandPackages adds task.qa_pkgs
// separately, after shape/critique have already reasoned about the shape), so nothing here
// needs to exclude them by hand. A cycle (already a validateShape problem) just stops the walk
// early - this is a signal, not a second validator, so it degrades rather than throws.
export function shapeAnalysis(packages) {
  const pkgs = Array.isArray(packages) ? packages : [];
  const ids = new Set(pkgs.map((p) => String(p && p.id)));
  const touches = pkgs.map((p) => (Array.isArray(p && p.touches) ? p.touches.length : 0));
  const m = median(touches);
  const bloated = pkgs
    .map((p, i) => ({ id: p && p.id != null ? String(p.id) : `#${i}`, touches: touches[i] }))
    .filter((p) => p.touches >= BLOAT_FLOOR && p.touches >= 2 * m);

  const deps = new Map(pkgs.map((p) => [String(p.id), ((p && p.deps) || []).map(String).filter((d) => ids.has(d) && d !== String(p.id))]));
  const placed = new Set();
  let width = 0;
  for (let round = 0; placed.size < deps.size && round <= deps.size; round += 1) {
    const ready = [...deps.keys()].filter((id) => !placed.has(id) && deps.get(id).every((d) => placed.has(d)));
    if (!ready.length) break; // a cycle - validateShape already reports it
    width = Math.max(width, ready.length);
    for (const id of ready) placed.add(id);
  }
  return {
    package_count: pkgs.length,
    touches_median: m,
    max_parallel_width: pkgs.length ? width : 0,
    bloated,
    fully_serial: pkgs.length > 1 && width === 1,
  };
}

function expandPackages(task, packages) {
  const live = task.nodes.filter((n) => n.stage === 'critique' && n.state !== 'skipped').pop();
  const critiqueDep = live ? live.node_id : 'critique';
  const round = Math.max(1, ...packages.map((p) => nextIndex(task, `dispatch:${String(p.id)}`)));
  const acceptIds = [];
  for (const p of packages) {
    const id = String(p.id);
    const deps = (p.deps || []).map((d) => `accept:${d}:${round}`);
    acceptIds.push(pushChain(task, PACKAGE_CHAIN, id, round, [critiqueDep, ...deps], [], {}));
  }
  const integrateId = `integrate:${nextIndex(task, 'integrate')}`;
  task.nodes.push(node(integrateId, 'integrate', acceptIds, { subgoal_id: null }));
  // roles.qa (§2): QA runs over the integrated tree, between integrate and the goal gate - one
  // QA card per feature area (_repo/docs/plans/2026-09-28-teams-cards-everywhere.md C7), the same areas
  // planning split by, in parallel. Each reuses repairWorktree rather than a fresh worktree, since
  // QA's tree IS the integration tree. The goal gate waits on every one of them.
  let goalGateDeps = [integrateId];
  if (task.team && task.team.opts && task.team.opts.roles && task.team.opts.roles.qa) {
    task.qa_pkgs = qaCards(task, integrateId);
    goalGateDeps = task.qa_pkgs.map((q) => pushChain(task, PACKAGE_CHAIN, q.id, round, [integrateId], [], {}));
  }
  const goalGate = `gate:goal:${nextIndex(task, 'gate:goal')}`;
  const reportId = round === 1 ? 'report' : `report:${round}`;
  task.nodes.push(node(goalGate, 'gate', goalGateDeps, { subgoal_id: null }));
  task.nodes.push(node(reportId, 'report', [], { after: [goalGate] }));
  return saveRun(task);
}

// One QA card per feature area (C7): QA-F1 exercises what PLAN-F1's user stories promised, on the
// integrated tree. A task.json from before the split (no areas) still gets exactly one card.
export function qaCards(task, integrateId) {
  const stories = planningStories(task);
  const cards = livePlanningPkgs(task);
  const areas = cards.length ? cards : [{ id: 'PLAN-F1', area: 'F1', area_title: 'the whole request' }];
  return areas.map((p, i) => {
    // A task from before planning cards (one planning_pkg with id 'PLAN') has no area: its QA card
    // is QA-F<n> by position, never QA-PLAN (m7).
    const f = p.area || (/^PLAN-F\d+$/.test(String(p.id)) ? String(p.id).slice(5) : `F${i + 1}`);
    const mine = stories.filter((u) => u.card === String(p.id));
    // This area's AC-n, verbatim: the card is judged per criterion, not per generic sentence.
    const acItems = mine.flatMap((u) => (Array.isArray(u.acceptance) ? u.acceptance : []).map(String).filter((x) => /\bAC-\d+\b/.test(x)));
    return {
      id: `QA-${f}`, area: f, area_title: p.area_title || p.title || f, phase: 'qa', flow: 'qa', integration_of: integrateId,
      title: `QA: ${p.area_title || p.title || f}`,
      brief: [
        `Run the QA pass for feature area ${f} (${p.area_title || p.title || f}) over the integrated result: exercise it the way a user would and report defects.`,
        areas.length > 1 ? `Other QA cards cover the other feature areas; this card owns the stories below. A defect you meet outside them is still reported.` : '',
        '',
        'User stories this card exercises, each with the acceptance it is judged against:',
        planningStoryLines(mine),
      ].filter((x) => x !== '').join('\n'),
      acceptance: acItems.length ? acItems : [`every user story of feature area ${f} has been exercised end to end on the integrated result, and defects, if any, are reported`],
      deps: [], touches: [],
    };
  });
}

// The feedback a reshape carries from the node that failed. A shape refused by the mechanical
// pre-check already says everything in shape_problems (its `reason` is the same list joined after
// "unusable shape:"), so the list goes once, every problem on its own line.
function shapeFeedback(source) {
  const r = (source && source.result) || {};
  if (source && source.stage === 'shape' && Array.isArray(r.shape_problems) && r.shape_problems.length) {
    return formatShapeFeedback([...r.shape_problems, ...(r.blocking || []), ...(r.problems || [])]);
  }
  return [r.reason || '', ...(r.blocking || []), ...(r.shape_problems || []), ...(r.problems || [])].filter(Boolean).join('\n- ');
}

function retryShape(task, feedback) {
  const priors = task.nodes.filter((n) => n.stage === 'shape');
  const attempt = priors.length + 1;
  if (attempt > task.max_retries + 1) {
    const dead = task.nodes.filter((n) => (n.stage === 'shape' || n.stage === 'critique') && n.state === 'failed' && !n.final);
    const unreachable = dead.flatMap((n) => settleFailure(task, n));
    return { task: saveRun(task), attempt: null, reason: 'retry budget exhausted', unreachable };
  }
  for (const n of task.nodes) {
    if (n.node_id === 'size') continue;
    if (n.state === 'pending' || n.state === 'failed') {
      n.state = 'skipped';
      n.result = n.result || { stage_ok: false, reason: `superseded by shape attempt ${attempt}` };
    }
  }
  task.spec = null;
  // A reshape splits the same merged PRD again: it waits on the planning integrate the first
  // shape waited on (already done), not on size - the stories it must cover are that one's.
  task.nodes.push(node(`shape:${attempt}`, 'shape', [planIntegrateHead(task) || 'size'], { attempt, feedback: feedback || '' }));
  task.nodes.push(node(`critique:${attempt}`, 'critique', [`shape:${attempt}`], { attempt }));
  return { task: saveRun(task), attempt, reason: '' };
}

// The dispatch that opened this package in the CURRENT shape round: expandPackages gives every
// first dispatch of a round the live critique as a dep. A reshape leaves the old round's nodes
// skipped in place, so "the first dispatch of this package" is the discarded round's.
function roundDispatch(task, pkgId) {
  const critique = task.nodes.filter((n) => n.stage === 'critique' && n.state !== 'skipped').pop();
  const mine = task.nodes.filter((x) => x.subgoal_id === pkgId && x.stage === 'dispatch');
  return (critique && mine.find((x) => x.deps.includes(critique.node_id))) || mine[0] || null;
}

function retryPackage(task, pkgId, feedback) {
  const prior = task.nodes.filter((n) => n.subgoal_id === pkgId && n.stage === 'accept');
  const attempt = Math.max(0, ...prior.map((n) => n.attempt || 1)) + 1;
  // The budget is per shape round. idol-pm-4 (2026-09-23) reshaped twice, and counting every
  // accept node ever pushed spent a retry of each package on rounds it never ran in.
  const first = roundDispatch(task, pkgId);
  const spent = attempt - ((first && first.attempt) || 1);
  if (spent > task.max_retries) {
    // Recorded before settleFailure writes the integrate off: reintegrateExhausted needs to know
    // which packages are not done once the rest has finished.
    if (((task.spec && task.spec.packages) || []).some((p) => !p.repair && String(p.id) === String(pkgId))) {
      const ex = task.exhausted || (task.exhausted = { packages: [] });
      if (!ex.packages.includes(String(pkgId))) ex.packages.push(String(pkgId));
    }
    const dead = task.nodes.filter((n) => n.subgoal_id === pkgId && n.state === 'failed' && !n.final);
    // Settle first, save second: an object literal evaluates left to right, and a save that
    // runs before the settling writes the unsettled graph.
    const unreachable = dead.flatMap((n) => settleFailure(task, n));
    return { task: saveRun(task), attempt: null, reason: 'retry budget exhausted', unreachable };
  }
  const prevAccept = `accept:${pkgId}:${attempt - 1}`;
  for (const n of task.nodes) {
    if (n.subgoal_id !== pkgId || (n.attempt || 1) !== attempt - 1) continue;
    // Nothing downstream will ever read what this attempt's driver is still doing, and it holds
    // the worktree the next attempt continues in. Stop it before the fresh dispatch opens.
    if (n.stage === 'dispatch' && n.child && killDriver(n.child.driver)) {
      record(task, { event: 'child_driver_killed', task_id: task.run_id, node_id: n.node_id, pid: n.child.driver.pid, reason: `superseded by attempt ${attempt}` });
    }
    if (n.state === 'pending') {
      n.state = 'skipped';
      n.result = { stage_ok: false, reason: `superseded by attempt ${attempt}` };
    }
  }
  // Deps come from this round's dispatch. Copying the package's first-ever dispatch wired
  // idol-pm-4's retries to `critique` and `accept:P1:1` - both skipped by the reshape - so four
  // retries sat pending forever and the daemon ended the task blocked with budget left.
  const baseDeps = first ? first.deps.slice() : ['critique'];
  // rollback (_repo/docs/plans/2026-09-23-teams-reducer-human-rollback.md §5, item 3): the new
  // dispatch's worktree (openChild, ensureWorktree) is the SAME one every attempt of this
  // package ever ran in - "continue" is what happens if rollback_to is left unset here, exactly
  // as it always has. When the task's retry_policy is 'rollback', point the new attempt at the
  // last commit this package actually had accepted (commitWorktree only ever commits on
  // accept:true - taskmanager.mjs's foldChild), or its worktree's own base commit if none of its
  // attempts ever passed. openChild performs the actual reset when it sees this field on a
  // reused worktree.
  const policy = (task.team && task.team.opts && task.team.opts.retry_policy) === 'rollback' ? 'rollback' : 'continue';
  let rollbackTo = null;
  if (policy === 'rollback') {
    const goodAccepts = task.nodes.filter((n) => n.subgoal_id === pkgId && n.stage === 'accept' && n.state === 'done' && n.result && n.result.commit);
    const lastGood = goodAccepts.sort((a, b) => (a.attempt || 1) - (b.attempt || 1)).pop();
    const anyDispatch = task.nodes.find((n) => n.subgoal_id === pkgId && n.stage === 'dispatch' && n.base_commit);
    rollbackTo = (lastGood && lastGood.result.commit) || (anyDispatch && anyDispatch.base_commit) || null;
  }
  const accept = pushChain(task, PACKAGE_CHAIN, pkgId, attempt, baseDeps, [], { feedback: feedback || '' });
  if (rollbackTo) {
    const dispatchNode = task.nodes.find((x) => x.node_id === `dispatch:${pkgId}:${attempt}`);
    if (dispatchNode) dispatchNode.rollback_to = rollbackTo;
  }
  for (const n of task.nodes) {
    if (n.node_id === accept) continue;
    n.deps = n.deps.map((d) => (d === prevAccept ? accept : d));
    n.after = (n.after || []).map((d) => (d === prevAccept ? accept : d));
  }
  // An integrate that failed its checks and blamed this package stays failed forever unless
  // someone re-judges the combined tree once the package is redone - the same wedge the graph
  // engine had with a rejected gate:goal. Open a fresh integrate over the same accepts (now
  // pointing at the new attempt) and move the goal gate behind it. The first docs task to
  // reach this point ended blocked with every document delivered and no route forward.
  for (const old of task.nodes.filter((x) => x.stage === 'integrate' && x.state === 'failed' && !x.final && x.deps.includes(accept))) {
    if (task.nodes.some((x) => x.supersedes === old.node_id)) continue;
    const fresh = `integrate:${nextIndex(task, 'integrate')}`;
    const fb = [feedback, old.result && old.result.reason, ...((old.result && old.result.gaps) || [])].filter(Boolean).join('\n');
    task.nodes.push(node(fresh, 'integrate', old.deps.slice(), { subgoal_id: null, feedback: fb, supersedes: old.node_id }));
    for (const n of task.nodes) {
      if (n.node_id === fresh) continue;
      n.deps = n.deps.map((d) => (d === old.node_id ? fresh : d));
      n.after = (n.after || []).map((d) => (d === old.node_id ? fresh : d));
    }
  }
  return { task: saveRun(task), attempt, reason: '', ...(rollbackTo ? { rollback_to: rollbackTo } : {}) };
}


export { areaOverlapBlocking, areasOf, expandAcceptedSplit, expandPackages, expandPlanning, knownIds, planningStoryLines, replanPlanning, resplitPlanning, retryAreas, retryPackage, retryShape, shapeFeedback, touchesOverlap };
