// taskmanager-prompts.mjs - child-run context and the briefings; split out of taskmanager.mjs (card 128 step 1), moved verbatim.
import { docPaths, latestBySubgoal, livePlanningPkgs, phaseOfId, planningPkgs, planningStories, qaPkgs, storyLabel } from './tickets.mjs';
import { detectDeclaredAcceptance, renderAcceptanceTemplate } from './acceptance.mjs';
import { SCRATCH_RULE } from './layout-guard.mjs';
import { dirname, join } from 'node:path';
import { taskDir, unfinishedWork } from './taskstate.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exclusionLine, resolveBase } from './basefail.mjs';
import { formatList, gateIntegrity } from './gateintegrity.mjs';
import { taskFigure } from './drivercost.mjs';
import { ACCEPT_EXTRA, CONTRACT, MANAGER_CONVENTION_STAGES, stageSkills } from './stagecontract.mjs';
import { conventionsBlock } from './conventions.mjs';
import { BRAINSTORM_LIGHT, MUTATING, bullets, shapeDiagramLines } from './taskmanager-stages.mjs';
import { areasOf, planningStoryLines, shapeAnalysis } from './taskmanager-plan.mjs';
import { packageOf } from './taskmanager-worktree.mjs';
import { notDoneIds } from './taskmanager-repair.mjs';

// Array.isArray rather than a truthiness check: a shape that returns "skills":
// "develop:kotlin-specialist" as a bare string would otherwise be spread through the briefing one
// character per bullet, and the package would look like it had asked for twenty skills.
function packageSkills(pkg) {
  return (Array.isArray(pkg && pkg.skills) ? pkg.skills : []).map(String).filter(Boolean);
}

// What a package's child run is told beyond its own brief: the package contract, and the
// reports of the packages it depends on. Not the whole request - that is what the brief
// is for - and never another package's spec.
// What the live critique said about ONE package. A critique that passes (sound: true) can still
// name problems - idol-beta-ask1's critique:2 said "raise P4 to at least 10,000 hold+pay flows at
// capacity 100", and P4 was dispatched with its acceptance unchanged at 5,000/50: problems[] was
// read by nobody after the critique node finished. Matched by the package id as a whole word.
export function critiqueNotesFor(task, pkgId) {
  const c = task.nodes.filter((n) => n.stage === 'critique' && n.state === 'done' && n.result).pop();
  if (!c || !pkgId) return [];
  const re = new RegExp(`(^|[^A-Za-z0-9_])${String(pkgId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_]|$)`);
  const all = [...(c.result.problems || []), ...(c.result.blocking || [])]
    .map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
  return all.filter((t) => re.test(t));
}

// The Sprint's box ({budget_usd, timebox_minutes}) when one is set, or null.
function boxedOpts(task) {
  const o = (task.team && task.team.opts) || {};
  return Number.isFinite(o.budget_usd) || Number.isFinite(o.timebox_minutes) ? o : null;
}

function childContext(task, pkg) {
  const lines = [];
  lines.push(`This run is package ${pkg.id} (${pkg.title}) of a larger task managed outside this worktree.`);
  if (pkg.repair) {
    // The one package that is not private to itself. Said plainly, because the defect it is
    // here for cannot be seen from any single package's tree: every other child was told to
    // stay inside its own paths, and this one has to be told the opposite in as many words.
    lines.push(`This worktree is the COMBINED tree of every package in this task: all of their branches are already merged here, and you are on the integration branch itself.`);
    lines.push(`The goal-level integration checks were run on this tree and FAILED. What failed is in your request above. Your job is to make those checks pass.`);
    lines.push(`Every package's files are yours to touch - that is the point of this package. The defect lives in the seam between packages, which is why no package could repair it in its own worktree.`);
    lines.push(`Do not undo another package's work to get the checks green. Reconcile them: change the least that makes the combined tree true.`);
  } else if (pkg.phase === 'planning') {
    // Without this the planning run reads a request that says "implement ..." and does exactly
    // that (first real-vendor run, 2026-09-22: the PLAN child opened implement/test/gate chains
    // and started building the CLI). The request is the thing to PLAN, not the thing to do.
    // One planning card per feature area (_repo/docs/plans/2026-09-28-teams-cards-everywhere.md C2/C3):
    // the card is told which area is its own, what its section must hold, and how to number its
    // stories so they stay unique across the EPIC once plan-integrate merges every card.
    const cards = planningPkgs(task);
    const f = pkg.area || 'F1';
    if (cards.length > 1) {
      lines.push(`This is planning card ${pkg.id}, one of ${cards.length} (${cards.map((c) => `${c.id}: ${c.area_title || c.title}`).join('; ')}). Your feature area is ${f} - ${pkg.area_title || pkg.title}. The other cards plan the other areas in parallel; plan yours, and name a dependency on another area as an open question rather than planning it here.`);
    }
    lines.push(`Your deliverable is this area's PRD section, and it always has these parts: its Goal; its Scope and its non-goals (headed "Out of scope"); its User stories, each with acceptance criteria an engineer can build and a tester can check, numbered ${f}-US-1, ${f}-US-2, ... so no other card's ids can collide with yours; and its Open questions. The manager merges every card's section into one PRD (10-prd.md) and judges the merged document for colliding ids, contradictions between areas and features no card covers. Return the stories as user_stories[] - a section with none is rejected.`);
    lines.push(`This is the planning phase-Team. The request above describes work that OTHER packages will build later; your deliverable is this request's planning documents - not the implementation. The PRD is the floor of that set: the problem, the users, user stories with acceptance criteria an engineer can build from, scope and non-goals, risks and open questions. ${boxedOpts(task) ? 'This Sprint is boxed, so the set is the PRD alone: vocabulary, contested rules and load conditions go into sections of it rather than documents of their own.' : 'Nothing limits you to one document, and the run decides its own set: when this request\'s domain has a vocabulary, rules people will argue about, or a stated load condition, those belong in documents of their own rather than compressed into the PRD or dropped into its Out of scope.'}`);
    lines.push(`Each document in that set is investigated before it is written: its first stage reads the project tree, whatever material this request names or attaches, and the domain's own sources where they are reachable, and comes back with findings that cite where each one came from plus the decisions no source could answer. Those unanswered ones are carried into the documents as open questions with owners. Do not let them be answered by invention instead - a rule a user story rests on that nobody decided is missing whether it is written down or not, and this stage exists because the runs before it wrote hundreds of confident lines naming none of their domain's actual rules.`);
    lines.push(`Change no source files. This run works in its own worktree, private to this card and branched from the project; the planning documents and the findings files written beside them are the deliverable, and nothing else you write is kept. The user_stories[] you return are what the manager merges and hands to the shape stage that splits the work into packages.`);
    // The planner never knew a box existed: code-sprint-P2 wrote four planning documents for a
    // four-item code backlog and spent ~$14.5 of a $15 Sprint before a single package ran.
    const box = boxedOpts(task);
    if (box) {
      const parts = [Number.isFinite(box.budget_usd) ? `$${box.budget_usd}` : null, Number.isFinite(box.timebox_minutes) ? `${box.timebox_minutes} minutes` : null].filter(Boolean).join(' and ');
      lines.push(`This Sprint is boxed at ${parts} for everything - planning is the first thing that box pays for, and every package is built out of what is left. Size the document set to what the packages need to be built right: a backlog whose items already state their behaviour and acceptance needs one PRD, not a set. Planning that spends the box leaves nothing built.`);
    }
    // Light PLAN mode (_repo/docs/plans/2026-09-28-teams-light-plan.md §2.2): the backlog already
    // declared its acceptance, so the PRD is a transfer of it, laid out here deterministically
    // for template-fill to place and for the gate to check coverage against.
    if (pkg.planning_mode === 'light') {
      lines.push(`This PLAN runs in LIGHT mode (${task.planning_mode_reason || 'roles.planning'}): the backlog already declares its acceptance criteria, so there is no draft or revise stage. investigate still reads the sources first and still names every unknown; template-fill then copies the criteria below into ONE PRD - one user story per backlog item, in order, every shared rule applied to every item or marked N/A with the finding that says why - and the gate checks that transfer item by item.`);
      // roles.planning: 'light' set by hand skips detection at tm_open; parse the request once
      // here so a backlog the parser can read still gets its numbered checklist.
      const parsed = task.declared_acceptance ? null : detectDeclaredAcceptance({ request: task.request });
      const det = task.declared_acceptance || (parsed && parsed.declared ? parsed : null);
      // A card that owns only some backlog items (its area's `items`, from the plan stage) is
      // handed only those, numbered as they are in the backlog, plus every shared rule.
      const own = det && Array.isArray(pkg.items) && pkg.items.length
        ? { ...det, items: (det.items || []).map((it, i) => ({ ...it, n: i + 1 })).filter((it) => pkg.items.includes(it.n)) }
        : det;
      const tpl = renderAcceptanceTemplate(own && own.items && own.items.length ? own : det);
      lines.push(tpl
        ? `Declared acceptance (copy verbatim; the R- and A-numbers are the gate's checklist):\n${tpl}`
        : `Declared acceptance: light mode was set explicitly and no structured criteria were found in the request - transfer the acceptance the request states, in its own words, item by item.`);
    }
  } else if (pkg.phase === 'qa') {
    lines.push(pkg.s_snapshot
      ? `This worktree is a snapshot of the size-S run's working tree (commit ${String(pkg.s_snapshot).slice(0, 12)}): everything that run wrote, committed here so QA can exercise it without touching the project tree itself.`
      : `This worktree is the COMBINED tree of every package in this task: all of their branches are already merged here, on the integration branch itself.`);
    lines.push(qaPkgs(task).length > 1
      ? `This is QA card ${pkg.id}, one of ${qaPkgs(task).length} run in parallel over the same integrated result - one per feature area (${qaPkgs(task).map((q) => q.id).join(', ')}). Yours is feature area ${pkg.area || '?'}: exercise its user stories (in your request above) the way a user would and report what you find.`
      : `This is the goal-level QA pass over the integrated result. Exercise it the way a user would and report what you find.`);
    lines.push(`Where the result is model instructions - a skill, a prompt, an agent definition - using it the way a user would means running it: hand a fresh model (a subagent, or \`claude -p\`) the changed file and a realistic input, and read the output; run the pre-change version (git show <base>:<path>) on the same input and report what changed, better or worse. Reading the file is a review, not QA.`);
    lines.push(`Write only your own report - src/ and every package's delivered files are read-only here. ${SCRATCH_RULE} This is a review, not a repair: a defect you find is reported, not fixed.`);
  } else if (pkg.phase === 'audit') {
    lines.push(`This worktree is the COMBINED tree of every package in this task: all of their branches are already merged here, on the integration branch itself.`);
    lines.push(`This is planning's own second pass over this EPIC, taken after integration. Read the tree against the PRD's user stories in your request above and judge each one: satisfied, partially satisfied, or missing.`);
    lines.push(`You have no edit rights here - not over the tree and not over the PRD. Change no files. ${SCRATCH_RULE} An unmet story is reported, not fixed: the manager files it as its own STORY.`);
  } else {
    lines.push(task.base_ref
      ? `The worktree is private to this package and branched from ${task.base_ref} - the prior Sprint's integrated work, which this task builds on; integration happens later, elsewhere.`
      : `The worktree is private to this package and branched from the project's HEAD; integration happens later, elsewhere.`);
  }
  lines.push('');
  lines.push('Package acceptance - what the manager will judge this run against:');
  lines.push(bullets(pkg.acceptance));
  // §6.2-2 (_repo/docs/plans/2026-09-28-teams-light-plan.md): what the task already decided, in the
  // session, in the engine's own brainstorm, or in PLAN. Same tone 0.28.0's ask answers reached
  // a draft with - a rule to write, not a question to reopen.
  if ((task.decisions || []).length) {
    lines.push('');
    lines.push('Decided already — settled, write as rules, not open questions:');
    lines.push(bullets(task.decisions.map((d) => `${d.question} -> ${d.chose}${d.because ? ` (${d.because})` : ''} [${d.decided_in || 'task'}, ${d.source || 'decided'}]`)));
    if (pkg.phase !== 'planning') lines.push('If this package finds that one of these cannot hold, say so with "contradicts_decision" on the question you raise - never by quietly building the opposite.');
  }
  const notes = critiqueNotesFor(task, pkg.id);
  if (notes.length) {
    lines.push('');
    lines.push('The critique of the plan noted this about your package. They are advice, not acceptance: address each one that fits, or say in your handoff why not. The manager\'s accept reads the same list:');
    lines.push(bullets(notes));
  }
  if (pkg.repair && (pkg.touches || []).length) {
    lines.push('');
    lines.push('Paths the packages of this task own. All of them are in scope here:');
    lines.push(bullets(pkg.touches));
  } else if ((pkg.touches || []).length) {
    lines.push('');
    lines.push('Paths this package owns. Stay inside them; another package owns the rest:');
    lines.push(bullets(pkg.touches));
  }
  // Method for the whole child run, named by shape because shape is the stage that knows what
  // each package IS - a CLI package and a reference-document package want different method,
  // and the manager's own STAGE_SKILLS table cannot know which is which. The precedence has to
  // be restated here rather than left to the child: its nodes never see the manager's briefing,
  // so this context is the only place they hear it.
  const skills = packageSkills(pkg);
  if (skills.length) {
    lines.push('');
    lines.push('Method for this package — load each of these that is available, then work the way it says:');
    lines.push(bullets(skills));
    lines.push('A skill that is not installed here is skipped without comment or substitute. Its own output template does not apply - each node\'s own "Required output" is the only shape it may return - and neither does its "what you do / what I do" half: nobody is reading this but the machine that called you, so ask nothing and finish the work yourself.');
  }
  for (const d of pkg.deps || []) {
    const acc = task.nodes.filter((n) => n.subgoal_id === String(d) && n.stage === 'dispatch' && n.state === 'done' && n.result).pop();
    if (acc && acc.result) {
      lines.push('');
      lines.push(`Delivered by package ${d}, which this one depends on (branch ${acc.result.branch || '?'}):`);
      lines.push(String(acc.result.report || acc.result.reason || '').slice(0, 3000));
    }
  }
  if (task.context) {
    lines.push('');
    lines.push('From the requester:');
    lines.push(task.context);
  }
  return lines.join('\n');
}

// ---------- briefings ----------

export function briefingPath(task, n) {
  return join(taskDir(task.run_id), 'briefings', `${n.node_id.replace(/[^A-Za-z0-9._-]/g, '_')}.md`);
}

// The manager-graph twin of broker.mjs's writeHumanBriefing: the card a person reads for a
// node openAsk or promoteHumanGates just parked on task.nodes directly (shape/critique/accept/
// integrate/gate/gate:goal - not a package's child run). Best-effort like its sibling - a
// failed write leaves tm_inbox to fall back on the node's own fields, not a hard error.
export function writeManagerBriefing(task, n) {
  if (!n) return;
  try {
    const p = briefingPath(task, n);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, composeTaskPrompt(task, n));
    n.briefing_path = p;
  } catch { /* tm_inbox falls back to tm_status full:true */ }
}

export function composeTaskPrompt(task, n) {
  const L = [];
  L.push(`# ${n.stage} node ${n.node_id} (task manager)`);
  L.push('');
  L.push(`Project directory: ${task.cwd}`);
  L.push(MUTATING.has(n.stage)
    ? `You may run commands and change files only inside the integration worktree named below.`
    : `This is a reasoning node. Read what you need under the project directory; do not modify project files.`);
  L.push('');
  L.push(`You ARE this node of the task manager. Do the stage work directly with your own tools.`);
  L.push(`Do not re-enter the harness from inside it: no team_open, no tm_open, no broker or adapter call.`);
  L.push(`Child runs are opened and driven around you, never by you.`);
  L.push('');
  L.push(`## Request`);
  L.push(task.request);
  if (task.context) { L.push(''); L.push(`## Context from the requester`); L.push(task.context); }
  // requests[] (§B.3): the request above is already the whole backlog, "[backlog priority N] ..."
  // per item, N=0 highest - shape is the one stage that has to act on the ordering, by setting
  // each package's own `priority` (its existing field: array position already decides dispatch
  // order, advanceDispatches' own sort) consistent with which backlog item it implements. Nothing
  // downstream needs telling twice: critique/accept/gate:goal only ever read the packages shape
  // already ordered.
  if (n.stage === 'shape' && Array.isArray(task.requests) && task.requests.length) {
    L.push('');
    L.push(`## Backlog priority`);
    L.push(`This request is a backlog of ${task.requests.length} items in priority order (item 0 is highest). Give every package a \`priority\` consistent with which backlog item(s) it implements - a package serving only a low-priority item gets a high priority NUMBER, so it is the one left undispatched if budget_usd/timebox_minutes runs out before everything ships (advanceDispatches dispatches ascending priority first). Also give every package \`backlog: [N, ...]\` - the backlog priority numbers it implements - so the retro can name which backlog items shipped and which carry into the next Sprint.`);
  }
  if (task.size || task.flow_chosen || task.flow !== 'auto') {
    L.push('');
    L.push(`## Sizing`);
    if (task.size) L.push(`size: ${task.size}`);
    L.push(`flow: ${task.flow !== 'auto' ? `${task.flow} (fixed by the entry)` : task.flow_chosen ? `${task.flow_chosen} (chosen by size)` : 'auto'}`);
  }
  if (n.stage === 'shape' && livePlanningPkgs(task).length) {
    const userStories = planningStories(task);
    const pi = task.nodes.filter((x) => x.stage === 'plan-integrate' && x.state === 'done').pop();
    L.push('');
    L.push(`## Planning`);
    // The merged PRD (C4): every planning card's section in one document, judged by the planning
    // integrate. A link, never the body (§7c "payload를 main에 올리지 않는다").
    L.push(`${livePlanningPkgs(task).length} planning card(s) - ${livePlanningPkgs(task).map((p) => `${p.id} (${p.area_title || p.title})`).join(', ')} - ran ahead of this stage, one per feature area, and the planning integrate merged their sections into one PRD at ${docPaths(task).prd}${pi ? ` (${pi.node_id} accepted it)` : ''}. Read it there - it is the reasoning behind the stories below, and its body is not repeated here.`);
    L.push(`Planning split by FEATURE. Your split is the second one and its criterion is OWNERSHIP - which tree, which team touches it: one story may become two packages, or two stories one package.`);
    L.push(`User stories it produced - every "packages[].implements[]" this stage returns must together cover all of these, by id:`);
    L.push(bullets(userStories.map((u) => `${storyLabel(u)}${u.card ? ` (${u.card})` : ''}`)));
    if (userStories.some((u) => u && Array.isArray(u.acceptance) && u.acceptance.some((x) => /\bAC-\d+\b/.test(String(x))))) {
      L.push(`Their acceptance (AC-n) - copy each item verbatim, ID-prefixed, into the acceptance[] of the package that implements (or enables) its story; the shape is refused if one is left out:\n${planningStoryLines(userStories)}`);
      L.push(`The shape is checked mechanically for three things: each AC id in exactly one package, no AC left out, and no path in two packages' touches[]. If you can run commands, check a draft first: node ${join(dirname(fileURLToPath(import.meta.url)), 'shapecheck.mjs')} --prd ${docPaths(task).prd} --shape <draft json>`);
    }
    // What the judges said while letting it through. A gap named on an ACCEPTED node used to go
    // nowhere at all - gaps travelled only on rejection - so accept:PLAN calling the PRD "a
    // generic high-demand ticketing PRD with 'idol concert' in the title" (idol-pm-1,
    // 2026-09-22) reached no later stage and changed nothing about what got built.
    const carried = [];
    for (const p of livePlanningPkgs(task)) {
      const d = latestBySubgoal(task, String(p.id), 'dispatch');
      const acc = latestBySubgoal(task, String(p.id), 'accept');
      carried.push(...((d && d.result && d.result.gaps) || []), ...((acc && acc.result && acc.result.gaps) || []), ...((acc && acc.result && acc.result.observations) || []));
    }
    if (pi && pi.result) carried.push(...(pi.result.observations || []), ...(pi.result.contradictions || []).map((c) => `contradiction left open: ${c}`));
    const open = [...new Set(carried.filter(Boolean).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))))];
    if (open.length) {
      L.push('');
      L.push(`The PRD was accepted WITH these gaps still open. They were not blocking, and they are not yours to fix - but a package split that ignores them ships them:`);
      L.push(bullets(open));
    }
  }
  // The EPIC's plan stage (C2): what it splits, and what earlier attempts were refused for.
  if (n.stage === 'areas') {
    const size = task.nodes.filter((x) => x.stage === 'size' && x.result).pop();
    if (size && size.result && size.result.handoff) { L.push(''); L.push(`## From size`); L.push(size.result.handoff); }
    if (task.declared_acceptance) {
      L.push('');
      L.push(`## Declared acceptance`);
      L.push(`The request is a backlog that already declares its acceptance (light planning): give every area its "items", and put every backlog item in exactly one area.`);
      L.push(renderAcceptanceTemplate(task.declared_acceptance));
    }
  }
  // M4: the split this gate judges, as the plan stage returned it.
  if (n.stage === 'areas-critique') {
    const split = areasOf(task, n);
    const areas = (split && split.result && Array.isArray(split.result.areas)) ? split.result.areas : [];
    L.push('');
    L.push(`## The feature split (${split ? split.node_id : 'missing'})`);
    for (const [i, a] of areas.entries()) {
      L.push(`### ${a.id || `F${i + 1}`} — ${a.title || '(no title)'}`);
      L.push(String(a.brief || '(no brief)'));
      if ((a.deps || []).length) L.push(`deps: ${a.deps.join(', ')}`);
      if ((a.items || []).length) L.push(`backlog items: ${a.items.join(', ')}`);
    }
    if (split && split.result && split.result.handoff) { L.push(''); L.push(`Plan stage's handoff: ${split.result.handoff}`); }
    if (split && split.feedback) { L.push(''); L.push(`This split is a retry. What the earlier one was refused for:`); L.push(split.feedback); }
  }
  // The planning integrate (C4): the merge the manager made, and the facts no judge is trusted with.
  if (n.stage === 'plan-integrate') {
    const prd = n.prd || {};
    L.push('');
    L.push(`## The merged PRD`);
    L.push(`${prd.path || docPaths(task).prd} - every planning card's accepted section, merged by the manager. Read it whole; the cards are below.`);
    for (const c of prd.cards || []) {
      const d = latestBySubgoal(task, c.id, 'dispatch');
      L.push(`### ${c.id} — ${c.title}`);
      L.push(`Stories: ${(c.stories || []).join(', ') || '(none)'}`);
      if (d && d.child) L.push(`Its worktree: ${d.child.cwd}${d.result && (d.result.prd_paths || []).length ? ` (${d.result.prd_paths.join(', ')})` : ''}`);
    }
    if ((prd.duplicates || []).length) {
      L.push('');
      L.push(`Story ids the manager already found defined twice - check (1) fails on these whatever else you find:`);
      L.push(bullets(prd.duplicates.map((x) => `${x.id}: ${x.cards.join(', ')}`)));
    }
    L.push('');
    L.push(`## The feature split`);
    L.push(bullets((task.areas || []).filter((a) => !a.retired).map((a) => `${a.id} - ${a.title}: ${String(a.brief || '').split('\n')[0].slice(0, 200)}`)));
  }
  if (task.spec && ['critique', 'integrate', 'gate', 'report'].includes(n.stage)) {
    L.push('');
    L.push(`## Goal-level acceptance`);
    L.push(bullets(task.spec.acceptance));
    L.push('');
    L.push(`## Packages`);
    // The manager-level reduce (item 4): the most recent integrate's declared per-package fold -
    // every attempt a package went through, folded through the same registry foldChild uses, not
    // just the latest dispatch's own snapshot below. Present once at least one integrate has
    // settled; gate:goal and report are exactly the stages that need a package's whole history,
    // not only where it landed.
    const foldedIntegrate = task.nodes.filter((x) => x.stage === 'integrate' && x.result && x.result.package_fold).pop();
    const fold = foldedIntegrate ? foldedIntegrate.result.package_fold : null;
    for (const p of task.spec.packages || []) {
      L.push(`### ${p.id} — ${p.title}${p.flow ? ` (${p.flow})` : ''}`);
      if ((p.deps || []).length) L.push(`Depends on: ${p.deps.join(', ')}`);
      if ((p.touches || []).length) L.push(`Touches: ${p.touches.join(', ')}`);
      // Shown so critique can attack the method the same way it attacks the split: a package
      // handed a skill that fits nothing it does is a defect in the shape, not in the child.
      if (packageSkills(p).length) L.push(`Method: ${packageSkills(p).join(', ')}`);
      L.push(`Acceptance:`);
      L.push(bullets(p.acceptance));
      const d = task.nodes.filter((x) => x.subgoal_id === String(p.id) && x.stage === 'dispatch' && x.result).pop();
      if (d && d.result) L.push(`Branch: ${d.result.branch || '?'} · child ${d.result.child_run_id || '?'} · ${d.state}${d.result.accept === undefined ? '' : ` accept=${d.result.accept}`}`);
      const f = fold && fold[String(p.id)];
      if (f) {
        L.push(`Folded across ${f.attempts} attempt(s): accept=${f.accept === undefined ? '?' : f.accept}`
          + `${f.match_pct !== undefined ? ` match=${f.match_pct}%` : ''}`
          + `${(f.changed_files || []).length ? ` · ${f.changed_files.length} file(s) changed` : ''}`
          + `${(f.defects || []).length ? ` · ${f.defects.length} defect(s)` : ''}`);
      }
      L.push('');
    }
    // Facts, not a verdict (§ shapeAnalysis) - handed to critique so it sees, unprompted, exactly
    // what the audit found only after the fact: awake-beta-ref1's P1 owning 9 scopes on a
    // strictly serial chain, named in problems[] but never blocking[]. Shown only to critique -
    // integrate/gate/report already have the merged tree or the child reports to judge from, and
    // repeating package-count-and-width facts there would be noise, not evidence.
    if (n.stage === 'critique') {
      const sa = shapeAnalysis(task.spec.packages || []);
      L.push(`## Shape analysis`);
      L.push(`${sa.package_count} packages, touches median ${sa.touches_median}, max parallel width ${sa.max_parallel_width}${sa.fully_serial ? ' — fully serial: every package waits on the one before it' : ''}.`);
      L.push(sa.bloated.length
        ? `Bloated: ${sa.bloated.map((b) => `${b.id} owns ${b.touches} scopes (touches median is ${sa.touches_median})`).join('; ')}.`
        : `No package's touches breadth is 2x the sibling median or more.`);
      L.push('');
    }
  }
  if (n.stage === 'accept') {
    const pkg = packageOf(task, n.subgoal_id);
    const d = task.nodes.find((x) => x.subgoal_id === n.subgoal_id && x.stage === 'dispatch' && (x.attempt || 1) === (n.attempt || 1));
    if (pkg) {
      L.push('');
      L.push(`## Package ${pkg.id} — ${pkg.title}`);
      L.push(`Acceptance:`);
      L.push(bullets(pkg.acceptance));
      if ((pkg.touches || []).length) L.push(`Touches: ${pkg.touches.join(', ')}`);
      const notes = critiqueNotesFor(task, pkg.id);
      if (notes.length) {
        // Advisory, not acceptance: a passing critique's problems[] are what it let through. Read as
        // gaps they became a second acceptance list - code-beta-X5's P1 met every acceptance bullet,
        // was rejected at 82 for an unwritten JSDoc critique had suggested, and the retry gates
        // repeated it as "the explicitly-named blocking gap": three dispatches, 38 minutes.
        L.push(`The plan's critique noted this about ${pkg.id} (the child was told the same). These are advisory - the package is judged against its Acceptance above. Name any left unaddressed without a reason in "observations"; do not reject for them alone:`);
        L.push(bullets(notes));
      }
      // Scoping only: an unmet criterion that is a sibling's is out_of_scope here (CONTRACT.accept),
      // so the judge needs each sibling's id, title and acceptance to answer belongs_to. A normal
      // package alone: phase and repair packages are judged against the whole task or their own fix.
      const siblings = (!pkg.phase && !pkg.repair)
        ? ((task.spec && task.spec.packages) || []).filter((p) => String(p.id) !== String(pkg.id) && !p.phase && !p.repair)
        : [];
      if (siblings.length) {
        L.push('');
        L.push(`## Other packages (judged by their own accept, not here)`);
        for (const p of siblings) {
          L.push(`### ${p.id} — ${p.title}`);
          L.push(bullets(p.acceptance));
        }
        L.push(`${pkg.id} is judged only against its own Acceptance above, never against these.`);
      }
    }
    // QA and AUDIT judge the INTEGRATED result against the whole task, not one package of their
    // own - pkg.acceptance above is deliberately a generic one-liner ("exercise it end to end")
    // because their scope is everything, not a slice. Left at that, this judge's only basis for
    // a verdict was that one-liner plus the child's own self-report below: structurally unable to
    // tell a QA pass that ran three trivial cases and declared no defects from one that actually
    // exercised the goal. What it needs to tell the difference is what the task actually promised
    // and what the develop packages themselves claimed they would deliver - the same facts
    // critique/integrate/gate already see (line ~1871), scoped here to QA/AUDIT alone rather than
    // widening that stage gate onto every accept: an ordinary package's own accept (P1, a repair)
    // is already handed exactly the package it is judging and needs nothing about its siblings'
    // verdicts or dispatch state to do that job (it is shown their id, title and acceptance above,
    // for scoping only), and accept is the highest-frequency node type in this task - drowning all
    // of them in a full sibling-package dump would make each judge less, not more.
    // Deliberately NOT included: every package's branch/child_run_id/dispatch state (routing
    // plumbing, not a check the judge can act on), other accept nodes' own verdicts (one judge's
    // opinion is not evidence for another), and critique's or integrate's full transcripts (a
    // different question than "did QA/AUDIT do their job", answered by the report/gate stages
    // that already exist for it).
    if (task.spec && pkg && (pkg.phase === 'qa' || pkg.phase === 'audit')) {
      L.push('');
      L.push(`## Goal-level acceptance`);
      L.push(bullets(task.spec.acceptance));
      L.push('');
      L.push(`## What the develop packages promised`);
      for (const p of task.spec.packages || []) {
        L.push(`### ${p.id} — ${p.title}`);
        if ((p.touches || []).length) L.push(`Touches: ${p.touches.join(', ')}`);
        L.push(`Acceptance:`);
        L.push(bullets(p.acceptance));
        L.push('');
      }
      if (pkg.phase === 'audit') {
        // The merged PRD's stories - every planning card's (C4), not one package's.
        L.push(`## User stories from the PRD`);
        L.push(bullets(planningStories(task).map(storyLabel)));
      }
    }
    if (d && d.result) {
      const r = d.result;
      L.push('');
      L.push(`## What the child run delivered`);
      L.push(`child run ${r.child_run_id} at ${r.child_cwd} on branch ${r.branch} — ${r.child_state}`);
      L.push(`Its goal gate: accept=${r.accept} match=${r.match_pct === undefined ? '?' : r.match_pct + '%'}`);
      // A failure an earlier attempt's accept found on the base commit too (excludeBaseFailures) is
      // not briefed as this package's gap; it is listed apart so nothing is dropped silently.
      const onBase = (task.base_exclusions && task.base_exclusions[String(n.subgoal_id)]) || [];
      const ownGaps = (r.gaps || []).filter((g) => !onBase.some((e) => String(g).includes(e.test)));
      if (ownGaps.length) L.push(`Gaps it named:\n${bullets(ownGaps)}`);
      if (onBase.length) L.push(`Not counted against this package:\n${bullets(onBase.map(exclusionLine))}`);
      if ((r.spec_drift || []).length) L.push(`Spec drift it named:\n${bullets(r.spec_drift)}`);
      // The child's set fold (its own `reduce` node, plus the deterministic write-scope check
      // recorded onto it - item 1/2 of the reducer plan): what its parallel subgoals collided
      // on, carried up from foldChild's set_findings so this package's own accept sees it too.
      if (r.set_findings) {
        const sf = r.set_findings;
        if ((sf.collisions || []).length) L.push(`Files its subgoals both wrote with no single owner:\n${bullets(sf.collisions.map((c) => `${c.file || c}`))}`);
        if ((sf.undeclared || []).length) L.push(`Files on disk no subgoal declared:\n${bullets(sf.undeclared)}`);
        if ((sf.orphans || []).length) L.push(`Artifacts left by a superseded attempt:\n${bullets(sf.orphans)}`);
        const ws = sf.write_scope;
        if (ws && ((ws.collisions || []).length || (ws.undeclared_writers || []).length || (ws.heading_collisions || []).length)) {
          L.push(`Deterministic write-scope check also found:`);
          L.push(bullets([
            ...ws.collisions.map((c) => `${c.file}: written by ${c.written_by.join(', ')}, declared by ${c.declared_by.length ? c.declared_by.join(', ') : '(nobody)'}`),
            ...ws.undeclared_writers.map((u) => `${u.subgoal_id} wrote ${u.file}, declared by ${u.declared_owners.join(', ')}`),
            ...ws.heading_collisions.map((h) => `${h.file}: ${h.subgoals.join(' & ')} — ${h.reason}`),
          ]));
        }
      }
      // §5b: a QA package's own execute node(s), read directly off the child run (foldChild's
      // defectsFound) regardless of whether the child ever reached a goal-gate verdict about
      // them. The qa accept contract (below) tells this agent to relay every one of these into
      // its own "defects" field - this is the list it must not drop any of.
      if ((r.defects || []).length) L.push(`Defects it reported:\n${bullets(r.defects)}`);
      // §upstream_defects: foldChild carries these through regardless of which package's child
      // reported them (not QA/audit-only, unlike r.defects above) - the accept contract (above)
      // tells this judge to relay every one of them into its own JSON verbatim.
      if ((r.upstream_defects || []).length) {
        L.push(`Upstream defects it reported:\n${bullets(r.upstream_defects.map((d) => `${d && d.package ? `${d.package}: ` : ''}${(d && d.title) || String(d)}${d && d.evidence ? ` -> ${d.evidence}` : ''}`))}`);
      }
      if ((r.changed_files || []).length) L.push(`Files it reported changing:\n${bullets(r.changed_files)}`);
      L.push(`Its report:`);
      // The report names the same failures: its lines about an excluded base failure are dropped too.
      L.push(r.report ? String(r.report).split('\n').filter((line) => !onBase.some((e) => line.includes(e.test))).join('\n') : '(no report)');
      L.push('');
      L.push(`Verify in the worktree at ${r.child_cwd}. The report is a claim; the tree is the evidence.`);
    }
  }
  if (n.stage === 'integrate' && n.integration) {
    L.push('');
    L.push(`## Integration worktree`);
    L.push(`${n.integration.cwd} on branch ${n.integration.branch}, created from ${n.integration.based_on === 'repair' ? `the repaired integration branch of package ${n.integration.repair_package}` : n.integration.based_on === 'base_ref' ? `${n.integration.base_ref}, the prior Sprint's integrated work` : `the project's HEAD`}.`);
    L.push(`Already merged, in dependency order:`);
    L.push(bullets((n.integration.merged || []).map((m) => `${m.package}: ${m.branch} -> ${m.commit}`)));
    if ((n.integration.already_applied || []).length) {
      L.push(`Already in the tree (their change is present, so they were not merged again; not missing):`);
      L.push(bullets(n.integration.already_applied.map((m) => `${m.package}: ${m.branch}`)));
    }
    if ((n.integration.package_tests || []).length) {
      L.push(`Each package's own test command, run by the manager in this combined tree before you were called - facts, not claims. A package whose own tests fail here is not integrated, whatever the root runner says:`);
      L.push(bullets(n.integration.package_tests.map((t) => `${t.package}: \`${t.command}\` -> exit ${t.exit}${t.summary ? ` (${t.summary})` : ''}`)));
    }
    // Restored: 0.30.2 (06575cb) dropped this line while inserting the scope note below, and every
    // integrate judge since ran without being told what its job was.
    L.push(`Run the goal-level checks there. Read the seams: where one package's output meets another's input.`);
  }
  // A budget/timebox sweep reintegrates over only what accepted. Judged against the whole goal
  // that set can never verify - code-sprint-S5's integrate:2 refused because the skipped P3/P4's
  // work was "unowned", which is exactly what the sweep already recorded, and the task ended
  // blocked with no report. Here the question is whether the kept packages work together.
  // The same scope holds for the goal gate that judges that reintegration.
  if ((n.stage === 'integrate' || String(n.node_id).startsWith('gate:goal'))
      && task.budget_stopped && (task.budget_stopped.skipped_packages || []).length) {
    const verdictField = n.stage === 'integrate' ? 'verified' : 'accept';
    L.push('');
    L.push(`## Scope: the Sprint's box ran out`);
    L.push(`budget_usd/timebox_minutes stopped this task. Packages ${task.budget_stopped.skipped_packages.join(', ')} were never dispatched and are carried to the next Sprint - their work is absent BY DESIGN, not a defect. Judge only the packages that were merged: that they work together and meet their own acceptance, and the goal-level criteria they alone can satisfy. Set ${verdictField} true if they do. Name the skipped work (in unowned or gaps) for the record, but it is not a reason to refuse.`);
  }
  // The same for a spent retry budget (reintegrateExhausted): the packages left out are named, and
  // QA's card is told they are outside what it exercises.
  const notDone = notDoneIds(task);
  const qaCard = n.stage === 'accept' && phaseOfId(task, n.subgoal_id) === 'qa';
  if (notDone.length && (n.stage === 'integrate' || String(n.node_id).startsWith('gate:goal') || qaCard)) {
    L.push('');
    L.push(`## Scope: packages not done`);
    L.push(`${notDone.join(', ')} ${notDone.length > 1 ? 'are' : 'is'} not done: a package spent its retry budget and the rest wait on it. Their work is absent from the merged tree BY DESIGN, not a defect of the packages that were merged.`);
    L.push(qaCard
      ? `${notDone.join(', ')} ${notDone.length > 1 ? 'are' : 'is'} outside QA's scope: do not file their missing work as a defect; name it in observations.`
      : `Judge only the packages that were merged: that they work together and meet their own acceptance, and the goal-level criteria they alone can satisfy. Set ${n.stage === 'integrate' ? 'verified' : 'accept'} true if they do. Name the missing work in gaps for the record; it is not a reason to refuse.`);
  }
  // Distinct from skipped_packages above: a QA/AUDIT pass that WAS dispatched (once, or through
  // every retry the box allowed) but never produced a verdict before budget/timebox stopped the
  // Sprint - the goal gate's dependency on its accept node was rewired straight to integrate
  // (closeStoppedToReport), so nothing upstream of this node says QA/AUDIT is missing unless it
  // is stated here. This is a fact, not a suggestion: a judge or report that stays silent about
  // it is the exact silent-pass this note exists to prevent. The task still completes - roles.qa
  // being on and QA not reaching a verdict is scope the box cut, the same way a skipped package
  // is, not grounds by itself to refuse accept or withhold the report.
  if (task.budget_stopped && (task.budget_stopped.qa_not_run || []).length
      && (n.stage === 'integrate' || String(n.node_id).startsWith('gate:goal') || n.stage === 'report')) {
    L.push('');
    L.push(`## Scope: ${task.budget_stopped.qa_not_run.map((q) => q.pass).join(', ')} did not run`);
    for (const q of task.budget_stopped.qa_not_run) {
      L.push(`${q.pass}: not run - ${q.reason} (last attempt: ${q.node_id}). budget/timebox stopped the Sprint before ${q.pass} reached a verdict.`);
    }
    L.push(n.stage === 'report'
      ? `List this explicitly under an "unresolved" or "known gaps" section of the report - not folded into the cost or retro line only. Do not describe the Sprint as fully verified.`
      : `Record it in gaps - "${task.budget_stopped.qa_not_run.map((q) => q.pass).join('/')}: not run (budget/timebox)" - even though it is not a reason by itself to refuse. Do not treat the absence of a ${task.budget_stopped.qa_not_run.map((q) => q.pass).join('/')} verdict as equivalent to a passing one.`);
  }
  // A QA card spent past its retries (rescueQaRound): the goal gate no longer waits on it, so
  // nothing else says that area went unexercised.
  if ((task.qa_not_run || []).length && (String(n.node_id).startsWith('gate:goal') || n.stage === 'report')) {
    const names = task.qa_not_run.map((q) => q.pass).join(', ');
    L.push('');
    L.push(`## Scope: QA card ${names} reached no verdict`);
    for (const q of task.qa_not_run) L.push(`${q.pass}: retries exhausted - ${q.reason} (last attempt: ${q.node_id}). Its feature area was not exercised by QA.`);
    L.push(n.stage === 'report'
      ? 'List this under what did not ship or was not verified. Do not describe the Sprint as fully QA-verified.'
      : `Record "${names}: QA reached no verdict" in gaps. The absence of that verdict is not a pass.`);
  }
  // The goal gate judges the merged tree: list where it weakened a test or a guard against the
  // base. An inventory only - best-effort, no section when there is no tree, no git or no finding.
  if (String(n.node_id).startsWith('gate:goal')) {
    try {
      const integ = task.nodes.filter((x) => x.stage === 'integrate' && x.state === 'done' && x.integration && x.integration.cwd && x.integration.branch).pop();
      if (integ) {
        const sha = resolveBase({ cwd: integ.integration.cwd, branch: integ.integration.branch, baseRef: task.base_ref });
        const findings = gateIntegrity({ cwd: integ.integration.cwd, baseline: sha });
        if (findings.length) {
          L.push('');
          L.push('## Gate integrity');
          L.push(`The merged tree weakens these places against the base ${sha.slice(0, 12)} (tag, file:line, text):`);
          L.push(formatList(findings).trimEnd());
          L.push('A listed hunk with no reason in the diff or in the packages\' reports is a gap: name it in gaps, and it weighs against accept. A justified hunk (e.g. a test deleted together with its source, the reason in the report) is not a gap. The list is an inventory and does not by itself refuse the merge.');
        }
      }
    } catch { /* best-effort: no integrate node, not git, git error */ }
  }
  // The same facts tm_status/tm_wait/daemon_done carry as partial_reasons once this report is done.
  const partial = n.stage === 'report' ? unfinishedWork(task) : null;
  if (partial) {
    L.push('');
    L.push('## This task closes partial');
    L.push('It stopped short of the goal. The task will read `partial`, not `complete`; open the report by saying so, and list each of these under what did not ship:');
    for (const r of partial.partial_reasons) L.push(`- ${r}`);
  }
  if (n.stage === 'report') {
    // The same account tm_status/tm_board and view.mjs's header now show (collectDriverCosts,
    // drivercost.mjs) - stated here explicitly so 80-report.md (docs.mjs's renderReport, which
    // relays this node's own `report` string verbatim) actually says what the task cost instead
    // of that number sitting only in the raw drivers/*.stream.jsonl logs.
    const reportCost = taskFigure(taskDir(task.run_id), task);
    const liveCost = reportCost.live;
    L.push('');
    L.push(`## Cost and turns`);
    L.push(`Total across every session this task spawned: $${reportCost.spend.toFixed(2)} ($${liveCost.drivers_usd.toFixed(2)} driver and manager sessions + $${liveCost.nodes_usd.toFixed(2)} node sessions), ${liveCost.turns} turns, ${liveCost.sessions} sessions.`);
    L.push(`State this in the report - it is the one place a person reads it without opening a raw driver log.`);
  }
  if (['gate', 'report'].includes(n.stage)) {
    L.push('');
    L.push(`## Every node in this task`);
    L.push(`Judge from these facts. A node that failed, was skipped, or became unreachable is part of the outcome.`);
    for (const x of task.nodes) {
      if (!x.result || x.node_id === n.node_id) continue;
      const r = x.result;
      const v = [x.state,
        r.accept === undefined ? '' : `accept=${r.accept}`,
        r.verified === undefined ? '' : `verified=${r.verified}`,
        r.sound === undefined ? '' : `sound=${r.sound}`,
        r.match_pct === undefined ? '' : `match=${r.match_pct}%`].filter(Boolean).join(' ');
      L.push(`### ${x.node_id} (${x.stage}) — ${v}`);
      if (r.branch) L.push(`Branch: ${r.branch}${r.commit ? ` @ ${r.commit}` : ''}`);
      if (r.integration_branch) L.push(`Integration branch: ${r.integration_branch}`);
      if ((r.merged || []).length) L.push(`Merged:\n${bullets(r.merged)}`);
      if ((r.conflicts || []).length) L.push(`Conflicts:\n${bullets(r.conflicts)}`);
      if ((r.conflicting_packages || []).length) L.push(`Conflicting packages: ${r.conflicting_packages.join(', ')}`);
      if ((r.checks || []).length) L.push(`Checks:\n${bullets(r.checks)}`);
      if (r.handoff) L.push(r.handoff);
      if (r.report) L.push(r.report);
      if (r.evidence) L.push(`Evidence: ${r.evidence}`);
      const gaps = r.gaps || [...(r.blocking || []), ...(r.problems || [])];
      if (gaps.length) L.push(`Gaps:\n${bullets(gaps)}`);
      if ((r.exclusions || []).length) L.push(`Not counted against ${x.subgoal_id || x.node_id}:\n${bullets(r.exclusions)}`);
      if (r.reason) L.push(`Reason: ${r.reason}`);
      L.push('');
    }
  }
  if (n.stage === 'shape' || n.stage === 'critique') {
    const size = task.nodes.filter((x) => x.stage === 'size' && x.result).pop();
    if (size && size.result) {
      L.push('');
      L.push(`## From size`);
      if ((size.result.sizing || []).length) L.push(`Measured:\n${bullets(size.result.sizing)}`);
      if (size.result.handoff) L.push(size.result.handoff);
    }
    const shape = n.stage === 'critique' ? task.nodes.filter((x) => x.stage === 'shape' && x.result && x.state === 'done').pop() : null;
    if (shape && shape.result && shape.result.handoff) { L.push(''); L.push(`## From shape`); L.push(shape.result.handoff); }
    if (n.stage === 'critique') L.push(...shapeDiagramLines(task));
  }
  if (n.stage === 'integrate') L.push(...shapeDiagramLines(task));
  // task.decisions (§6.2/§6.5): shape splits the work and accept judges it, so both must hold
  // the packages to what the task already settled.
  if ((task.decisions || []).length && ['areas', 'areas-critique', 'plan-integrate', 'shape', 'critique', 'accept'].includes(n.stage)) {
    L.push('');
    L.push(`## Decided already`);
    L.push(`Settled for this whole task - treat each as a rule, not an open question:`);
    L.push(bullets(task.decisions.map((d) => `${d.question} -> ${d.chose}${d.because ? ` (${d.because})` : ''} [${d.decided_in || 'task'}, ${d.source || 'decided'}]`)));
  }
  // §6.5-3: the requester skipped the brainstorm, so the engine guessed - the report leads with
  // what it guessed, so a person can overturn any of it at a glance.
  const selfDecided = (task.decisions || []).filter((d) => d.source === 'self-brainstorm');
  if (n.stage === 'report' && selfDecided.length) {
    L.push('');
    L.push(`## Decided by the engine itself`);
    L.push(`Nobody brainstormed this request with the requester, so the engine settled these from the request alone. Open the report with this list, under the heading "Decided by the engine itself", before anything else:`);
    L.push(bullets(selfDecided.map((d) => `${d.question} -> ${d.chose}${d.because ? ` (${d.because})` : ''}`)));
  }
  // The project's own rules reach the manager's judging stages too: shape splits the work and
  // accept/gate judge the result, and until now neither could see a project rule at all -
  // conventions.mjs was wired into the child graph's stages only (2026-09-22).
  if (MANAGER_CONVENTION_STAGES.has(n.stage)) {
    const conv = conventionsBlock(task.cwd, { stage: 'manager' });
    if (conv) { L.push(''); L.push(conv); }
  }
  const skills = stageSkills(task, n);
  if (skills.length) {
    L.push('');
    L.push(`## Method`);
    L.push(`Load these skills first and work the way they say, each one that is available to you:`);
    L.push(bullets(skills));
    L.push(`A skill that is not installed here is simply skipped - do not look for a substitute, and never stop to report a missing one.`);
    L.push(`Two rules outrank everything a skill says. Its output template does not apply: the "Required output" below is the only shape you may return. And its "what you do / what I do" half does not apply: nobody is reading this but the machine that called you, so ask no questions, offer no choices, and finish the work yourself.`);
    L.push(`List in "skills_used" the ones you actually loaded, or ["none"].`);
  }
  if (n.feedback) {
    L.push('');
    L.push(`## Previous attempt was rejected — fix this`);
    L.push(n.feedback);
  }
  L.push('');
  L.push(`## Required output`);
  L.push(n.node_id.startsWith('gate:goal') ? CONTRACT['gate:goal'] : CONTRACT[n.stage]);
  if (n.stage === 'brainstorm' && n.brainstorm_mode === 'light') L.push(BRAINSTORM_LIGHT);
  if (n.stage === 'accept') {
    const judged = packageOf(task, n.subgoal_id);
    if (judged && ACCEPT_EXTRA[judged.phase]) L.push(ACCEPT_EXTRA[judged.phase]);
  }
  L.push('');
  L.push(`Return that JSON object and nothing else.`);
  return L.join('\n');
}

export { boxedOpts, childContext };
