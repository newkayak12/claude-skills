// taskmanager-handlers.mjs - the tool handlers: events, wait, board, open, run, retry, file, status; split out of taskmanager.mjs (card 128 step 1), moved verbatim.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { applyPinAction, authorStage, currentAttempt, getNode, kindOf, loadRun, loadRunAt, peekHumanActions, queueHumanAction, retryReport, runState, saveRun, unmetDeps } from './graph.mjs';
import { taskFigure } from './drivercost.mjs';
import { dirname, join, resolve } from 'node:path';
import { docPaths, epicBoardRows, epicKey, epicPhase, epicTicketState, initiativeKey, latestBySubgoal, packageFiling, parseTicketKey, planningPkgs, planningStories, qaPkgs, storyBlockedReason, storyKey, storyLinks, storyTaskProgress, storyTicketState, taskKey, ticketSnapshot } from './tickets.mjs';
import { driverAlive, record, resolveHarnessRun, taskDir, taskPath, tasksRoot } from './taskstate.mjs';
import { graphRunPath } from './harnessrun.mjs';
import { liveProc, registryProcesses, sameProcess } from './livecap.mjs';
import { logReply, renderLedgerLine, renderStreamLine } from './tasklog.mjs';
import { mutateRun, mutateTask } from './store.mjs';
import { mode as wikiMode } from './wikibridge.mjs';
import { writeDocs } from './docs.mjs';
import { askTimeoutMs } from './taskmanager-asks.mjs';
import { budgetStatus, ensureAutoParallel } from './taskmanager-budget.mjs';
import { cleanTask, noDriver, packageOf } from './taskmanager-worktree.mjs';
import { clearCapacity, fileDefects, integrateToRepair, openRepair } from './taskmanager-repair.mjs';
import { createTask, mustFindTask, sharedSizeSNote, withTask } from './taskmanager-stages.mjs';
import { daemonExhaustedNext, driverStderrTail, managerState, nextSpawnAttempt, noDaemon, serviceDaemon, spawnDaemon, taskState } from './taskmanager-drivers.mjs';
import { finish, verdict } from './taskmanager-finish.mjs';
import { harnessInfo, openHarnessRun, serviceHarnessRun, spawnHarnessDriver, toolNextHarness } from './taskmanager-harness.mjs';
import { knownIds, retryAreas, retryPackage, retryShape, shapeAnalysis, shapeFeedback } from './taskmanager-plan.mjs';
import { readIntent, respawnDriver, toolNext } from './taskmanager-claims.mjs';

function toolEvents(a) {
  const task = mustFindTask(a);
  const since = Number(a.since) || 0;
  const limit = Number.isInteger(a.limit) && a.limit > 0 ? a.limit : 50;
  let lines = [];
  try { lines = readFileSync(join(taskDir(task.run_id), 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { lines = []; }
  const events = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e && e.ts > since);
  return { task_id: task.run_id, count: events.length, events: events.slice(-limit) };
}

// An awaited sleep that ends early when `signal` aborts (the client's notifications/cancelled).
// The listener is removed whichever way it ends.
function abortableSleep(ms, signal) {
  if (!(ms > 0) || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

// tm_wait's own read of the ledger: every `node_finish` record() emits (finish(), above) is
// already the transition a caller wants - node_id, stage, state, stage_ok - so tm_wait reads
// that stream back rather than keeping a second cursor-indexed log of its own.
function nodeTransitionsSince(task, since) {
  let lines = [];
  try { lines = readFileSync(join(taskDir(task.run_id), 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { lines = []; }
  return lines
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && e.event === 'node_finish' && e.ts > since);
}

const WAIT_MS_MAX = 300000;
// tm_wait: the bounded long-poll a caller uses to follow a daemon-driven task without holding
// its state in its own context (§4-A of the design doc). Unlike the old tm_next({wait_ms}) it
// replaces, this never drives anything itself - it only reads the ledger and re-raises a dead
// daemon (serviceDaemon, the same call every other tm_* entry makes) so a caller that keeps
// calling tm_wait is enough, on its own, to keep a task alive across a daemon crash.
async function toolWait(a, signal) {
  const budget = Math.min(Math.max(Number(a.max_ms) || 60000, 0), WAIT_MS_MAX);
  const since = Number(a.cursor) || 0;
  const until = Date.now() + budget;
  let task = mustFindTask(a);
  let events = nodeTransitionsSince(task, since);
  while (!events.length && Date.now() < until && !signal?.aborted && taskState(task).state === 'running') {
    await abortableSleep(Math.min(2000, until - Date.now()), signal);
    // A fresh read each iteration (the daemon writes task.json from its own process), and the lock
    // only for this one serviceDaemon - never across the sleep.
    task = withTask(a, (fresh) => { serviceDaemon(fresh); return fresh; });
    events = nodeTransitionsSince(task, since);
  }
  const st = taskState(task);
  const cursor = events.length ? events[events.length - 1].ts : since;
  return {
    task_id: task.run_id,
    state: st.state,
    ...(st.partial ? { partial: true, partial_reasons: st.partial_reasons } : {}),
    counts: st.counts,
    ...(st.rejudge_at ? { rejudge_at: new Date(st.rejudge_at).toISOString(), note: 'a judge could not judge; the daemon re-judges it then - keep waiting, the task is not blocked' } : {}),
    cursor,
    timed_out: events.length === 0 && st.state === 'running',
    transitions: events.map((e) => ({ node_id: e.node_id, stage: e.stage, state: e.state, stage_ok: e.stage_ok === true, ts: e.ts })),
  };
}

// The last state board.jsonl recorded for each key. Read rather than remembered: the two
// writers are in different processes, so an in-memory guard would not see the other's line.
function lastLoggedStates(path) {
  const last = new Map();
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const e = JSON.parse(line); if (e && e.key) last.set(String(e.key), String(e.to)); } catch { /* torn line */ }
    }
  } catch { /* no board yet */ }
  return last;
}

// The PRD's required sections, and the headings a document is allowed to call them. The
// contract names them exactly; a real run renamed two ("Goals (measurable)" for Success
// criteria, "Non-Goals" for Out of scope), dropped Solution overview entirely, and gate:goal
// accepted it at 95% (idol-pm-2, 2026-09-22). A judge will not check a structural requirement
// reliably, and it does not need to: this is a grep. The alternatives are the renames a reader
// would accept without blinking - anything further afield is a section that is missing.
const PRD_SECTIONS = [
  // C3 (_repo/docs/plans/2026-09-28-teams-cards-everywhere.md): every planning card's section states
  // its goal. "goal" alone, since "goals" already names Success criteria below.
  ['Goal', ['goal', 'objective', '목표']],
  ['Problem', ['problem', 'problem statement', '문제']],
  ['Target users', ['target users', 'users', 'personas', 'users / personas', '대상 사용자']],
  ['Solution overview', ['solution overview', 'solution', 'overview', 'proposed solution', '솔루션']],
  ['Success criteria', ['success criteria', 'success metrics', 'goals', 'goals (measurable)', 'measurable goals', '성공 기준']],
  ['User stories', ['user stories', 'stories', '유저 스토리']],
  ['Out of scope', ['out of scope', 'non-goals', 'non goals', 'scope & non-goals', 'scope and non-goals', '비목표']],
  ['Open questions', ['open questions', 'open items', 'risks & open questions', 'risks and open questions', '미해결 질문']],
];

// Headings the PRD does not carry, under any of the names above, at any level. Reads the files
// the planning run reported writing; a file it cannot read is not evidence of absence, so an
// unreadable PRD yields no complaint here (the zero-stories check already covers the empty case).
// The stories a PRD carries, read from the document itself. The child's goal gate is asked to
// return them as user_stories[], and portfolio-consolidate's (2026-09-28) did not - it accepted a
// PRD with four well-formed stories under "## User stories" and returned none, so the fold threw
// the whole planning run away and paid for a second one. The document is the source; the gate's
// list is a convenience. Stories are "US-n" lines (heading or bullet) inside that section; each
// one's acceptance is the bullets under its "Acceptance" label, or every bullet when it has none.
export function prdStories(cwd, paths) {
  let text = '';
  for (const rel of paths || []) {
    if (!/\.md$/i.test(String(rel)) || /-findings\.md$/i.test(String(rel))) continue;
    try { text += `\n${readFileSync(resolve(cwd, String(rel)), 'utf8')}`; } catch { /* unreadable */ }
  }
  const sec = text.match(/^##\s+user stories[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im);
  if (!sec) return [];
  const stories = [];
  let cur = null, inAcc = false;
  for (const line of sec[1].split('\n')) {
    // An area prefix is part of the id (C3: "F2-US-1" keeps ids unique across merged cards).
    const head = line.match(/^(?:#{2,6}\s*|[-*]\s*)?\**\s*((?:[A-Za-z][A-Za-z0-9]*-)?US-\d+)\b\**\s*[\u2014:\-\u2013]*\s*(.*)$/);
    if (head) {
      cur = { id: head[1], title: head[2].replace(/\*+/g, '').trim(), acceptance: [], all: [] };
      stories.push(cur); inAcc = false; continue;
    }
    if (!cur) continue;
    if (/^\s*\**\s*acceptance\b/i.test(line)) { inAcc = true; continue; }
    if (/^\s*\*\*[^*]+\*\*/.test(line) && !/^\s*[-*]\s/.test(line)) { inAcc = false; continue; }
    const b = line.match(/^\s*[-*]\s+(.*)$/);
    if (b) { cur.all.push(b[1].trim()); if (inAcc) cur.acceptance.push(b[1].trim()); }
  }
  return stories.map(({ all, ...st }) => ({ ...st, acceptance: st.acceptance.length ? st.acceptance : all, source: 'prd' }));
}

// Drops from each story's acceptance[] the criteria that are the run's own goal-level document
// acceptance (copied verbatim from spec.acceptance), unless the request declared that same text.
// Pure; stories are mapped, never removed, and one without an acceptance array is left as it is.
const docAcNorm = (s) => String(s).replace(/^\s*(?:[A-Za-z]\d+-)?AC-\d+(?:\s*\[[^\]]*\])?\s*[:\-–—]?\s*/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
export function stripDocumentAcceptance(stories, docAcceptance, declared) {
  const docSet = new Set((docAcceptance || []).map(docAcNorm));
  const declaredSet = new Set((declared || []).map(docAcNorm));
  return (stories || []).map((s) => {
    if (!s || typeof s !== 'object' || !Array.isArray(s.acceptance)) return s;
    return { ...s, acceptance: s.acceptance.filter((x) => !(docSet.has(docAcNorm(x)) && !declaredSet.has(docAcNorm(x)))) };
  });
}

// The floor every planning card's section meets whatever its mode (C3): goal, scope and
// non-goals, user stories, open questions. A light card's template (prompts.mjs's template-fill)
// writes exactly these plus Problem; a full card's PRD_CONTRACT writes all of PRD_SECTIONS.
const CARD_SECTIONS = new Set(['Goal', 'User stories', 'Out of scope', 'Open questions']);

export function missingPrdSections(cwd, paths, mode = 'full') {
  let text = '';
  for (const rel of paths || []) {
    try { text += `\n${readFileSync(resolve(cwd, String(rel)), 'utf8')}`; } catch { /* unreadable */ }
  }
  // No PRD text at all is every section missing, not none (m1): a card that wrote no document
  // was accepted because an empty text had no heading to find missing.
  const headings = (text.match(/^#{1,6} .*$/gm) || []).map((h) => h.replace(/^#+\s*/, '').replace(/[:：].*$/, '').trim().toLowerCase());
  return PRD_SECTIONS
    .filter(([canonical]) => mode !== 'light' || CARD_SECTIONS.has(canonical))
    // Goal matches only at the start of a heading: "Non-goals" contains the word and is not one.
    .filter(([canonical, names]) => !headings.some((h) => names.some((n) => h === n || h.startsWith(canonical === 'Goal' ? n : `${n} `) || (canonical !== 'Goal' && h.includes(n)))))
    .map(([canonical]) => canonical);
}

// A ticket is three things and they have to agree: its state (tickets.mjs over task.json), its
// history (board.jsonl) and its body (docs.mjs's pages). Until now only the first was ever
// right - board.jsonl froze at tm_open and not one page was written, because both hung off MCP
// tool calls that the daemon, which owns the loop since v0.16.0, does not make. idol-pm-1
// (2026-09-22) ran 81 minutes with a DONE story still reading READY and an empty docs directory.
// This is the one place the whole surface is brought forward, called from the tool boundary and
// from the daemon's step alike. writeDocs is a pure re-render, so calling it often is cheap and
// idempotent; a failure to write evidence never fails the run that produced it.
export function syncTickets(task, before, by) {
  appendBoardTransitions(task, before, by);
  try { writeDocs(task); } catch { /* evidence, not a dependency - same rule as record() */ }
}

export function appendBoardTransitions(task, before, by) {
  const after = ticketSnapshot(task);
  const path = join(taskDir(task.run_id), 'board.jsonl');
  // Two writers now reach this: finish(), which snapshots around one node settling, and the
  // daemon, which snapshots around a whole step containing it. Their windows overlap, so the
  // same move is seen twice. The board is the ground truth for what it has already said, so a
  // transition into a state a key is already logged at is a re-observation, not a new move.
  const logged = lastLoggedStates(path);
  for (const [key, to] of Object.entries(after)) {
    const from = before[key] || null;
    if (from === to) continue;
    if (logged.get(key) === to) continue;
    try {
      mkdirSync(taskDir(task.run_id), { recursive: true });
      appendFileSync(path, JSON.stringify({ ts: Date.now(), key, from, to, by: String(by || 'tm') }) + '\n');
    } catch { /* the board is evidence, not a dependency - same rule as record() */ }
  }
}

// A no-task_id tm_board row, shared by the flat listing and every initiative group below it -
// one function so the two can never disagree about what an epic row looks like.
function epicRow(t) {
  return { key: epicKey(t.run_id), slug: t.slug || null, task_id: t.run_id, title: String(t.request).slice(0, 60), state: epicTicketState(t), phase: epicPhase(t) };
}

function toolBoard(a) {
  if (!a.task_id) {
    let ids = [];
    try { ids = readdirSync(tasksRoot()); } catch { ids = []; }
    const tasks = ids.map((id) => loadRunAt(taskPath(id))).filter(Boolean)
      .sort((x, y) => (y.created_at || 0) - (x.created_at || 0));
    // Grouping/display only, and only when at least one task actually has one - a project that
    // never sets `initiative` gets exactly today's flat `{epics}` shape, byte for byte (every
    // test that pins it keeps passing unmodified). `groups` orders by first appearance in the
    // (already created_at-desc) task list, an ungrouped `null` bucket included whenever any real
    // EPIC has no initiative of its own, so no EPIC silently drops off the board either surface.
    if (!tasks.some((t) => t.initiative)) return { epics: tasks.map(epicRow) };
    const bySlug = new Map();
    for (const t of tasks) {
      const slug = t.initiative || null;
      if (!bySlug.has(slug)) bySlug.set(slug, []);
      bySlug.get(slug).push(epicRow(t));
    }
    return {
      epics: tasks.map((t) => ({ ...epicRow(t), initiative: t.initiative || null })),
      groups: [...bySlug.entries()].map(([slug, epics]) => ({ initiative: slug, key: slug ? initiativeKey(slug) : null, epics })),
    };
  }
  const task = mustFindTask(a);
  // One collectDriverCosts call per task_id lookup - cheap (drivers/ is a handful of files even
  // on a large task), the same reason tm_status now pays it too.
  const figure = taskFigure(taskDir(task.run_id), task);
  const driverTotal = figure.live;
  return {
    key: epicKey(task.run_id),
    slug: task.slug || null,
    task_id: task.run_id,
    title: String(task.request).slice(0, 80),
    state: epicTicketState(task),
    phase: epicPhase(task),
    daemon: task.daemon ? { pid: task.daemon.pid, alive: driverAlive(task.daemon) } : null,
    cost: { usd: figure.spend, turns: driverTotal.turns, sessions: driverTotal.sessions },
    stories: epicBoardRows(task),
    doc_path: docPaths(task).index,
  };
}

// The EPIC half of a ticket key (E-xxxxxxxx) resolved to the run id it names - an 8-hex
// prefix match over tasksRoot(). Shared by tm_ticket and tm_board so both resolve an EPIC
// prefix identically and fail identically on an unknown one; a second copy of this lookup is
// how the two tools would drift apart again.
function findEpicByPrefix(epic8) {
  let ids = [];
  try { ids = readdirSync(tasksRoot()); } catch { ids = []; }
  const found = ids.find((id) => id.startsWith(epic8));
  if (!found) throw new Error(`no EPIC starting with ${epic8}`);
  return found;
}

// tm_board's task_id: accepts a full run id unchanged, or the ticket key E-xxxxxxxx (§8),
// resolved through findEpicByPrefix exactly as tm_ticket resolves its key's EPIC half.
// Anything else is passed through for mustFindTask to reject with its own "unknown task" error.
function resolveTaskRef(raw) {
  const s = String(raw || '');
  const m = /^E-([0-9a-f]{8})$/.exec(s);
  return m ? findEpicByPrefix(m[1]) : s;
}

// Resolves a ticket key into its task and, when present, package/subgoal segments - the same
// three-way split tm_assign needs (STORY for a package, TASK for a subgoal). One parser
// (tickets.mjs's parseTicketKey) plus one EPIC lookup, so tm_ticket and tm_assign can never
// again resolve the same key two different ways - the bug parseTicketKey's own header
// documents (a TASK key's "Pn/subgoalId" silently read as one greedy STORY pkgId).
function resolveTicketRef(key) {
  const parsed = parseTicketKey(key);
  if (!parsed || !parsed.epic8) throw new Error(`unrecognized ticket key "${key}": expected E-xxxxxxxx, E-xxxxxxxx/Pn, E-xxxxxxxx/Pn/subgoalId, or I-<slug>`);
  const found = findEpicByPrefix(parsed.epic8);
  const task = mustFindTask({ task_id: found });
  return { task, pkgId: parsed.pkgId, subgoalId: parsed.subgoalId };
}

// tm_ticket on an I-<slug> key: every EPIC under that initiative, same shape epicRow (tm_board)
// already renders, plus each one's own cost - a person asking "how's this initiative doing"
// wants the group's spend as much as its state. Throws on an initiative nothing was ever opened
// under, the same "unknown key" treatment findEpicByPrefix gives an unrecognized EPIC prefix.
function ticketForInitiative(slug) {
  let ids = [];
  try { ids = readdirSync(tasksRoot()); } catch { ids = []; }
  const epics = ids.map((id) => loadRunAt(taskPath(id))).filter(Boolean)
    .filter((t) => t.initiative === slug)
    .sort((x, y) => (y.created_at || 0) - (x.created_at || 0))
    .map((t) => {
      const figure = taskFigure(taskDir(t.run_id), t);
      return { ...epicRow(t), cost: { usd: figure.spend, turns: figure.live.turns, sessions: figure.live.sessions } };
    });
  if (!epics.length) throw new Error(`no EPIC found under initiative "${slug}"`);
  return { key: initiativeKey(slug), kind: 'INITIATIVE', initiative: slug, epics };
}

function toolTicket(a) {
  const key = String(a.key || '');
  const parsedForInitiative = parseTicketKey(key);
  if (parsedForInitiative && parsedForInitiative.initiative) return ticketForInitiative(parsedForInitiative.initiative);
  const { task, pkgId, subgoalId } = resolveTicketRef(key);
  if (!pkgId) {
    return {
      key: epicKey(task.run_id), task_id: task.run_id, kind: 'EPIC',
      title: String(task.request).slice(0, 160),
      state: epicTicketState(task), phase: epicPhase(task),
      daemon: task.daemon ? { pid: task.daemon.pid, alive: driverAlive(task.daemon) } : null,
      doc_path: docPaths(task).index,
    };
  }
  const pkg = packageOf(task, pkgId);
  if (!pkg) throw new Error(`no package ${pkgId} in ${epicKey(task.run_id)} (cards and packages: ${knownIds(task).join(', ') || 'none yet'})`);
  // A TASK key resolves the package it belongs to (§8's tm_ticket table has no TASK row of its
  // own yet) - the card itself is reachable through tm_inbox (waiting on a human) or the child
  // run's own team_status, not this tool.
  if (subgoalId) {
    throw new Error(`tm_ticket does not render a TASK key ("${key}") yet - see its STORY (${storyKey(task.run_id, pkgId)}) instead, or tm_inbox if ${key} is waiting on a human`);
  }
  const dispatch = latestBySubgoal(task, pkgId, 'dispatch');
  const accept = latestBySubgoal(task, pkgId, 'accept');
  return {
    key: storyKey(task.run_id, pkgId), task_id: task.run_id, kind: 'STORY',
    title: pkg.title,
    state: storyTicketState(task, pkgId),
    blocked_reason: storyBlockedReason(task, pkgId),
    tasks: storyTaskProgress(task, pkgId),
    worktree: dispatch && dispatch.child ? { cwd: dispatch.child.cwd, branch: dispatch.child.branch } : null,
    last_verdict: accept && accept.result ? { accept: accept.result.accept, match_pct: accept.result.match_pct, gaps: accept.result.gaps || [] } : null,
    ...packageFiling(pkg),
    links: storyLinks(task, pkgId),
    // Which of this STORY's subgoals a human owns right now - tm_assign's own read-back, and
    // the only place a card's `who` is visible outside tm_inbox (which only lists a card once
    // it is actually waiting_human, not merely pinned for a future attempt).
    human_assignments: humanAssignments(task, pkgId),
    doc_path: docPaths(task).story(pkgId),
  };
}

// tm_log({key, tail?, since?, raw?}): the log a ticket key already points at, tailed and rendered
// (tasklog.mjs). EPIC -> ledger.jsonl; STORY -> its latest dispatch's child.driver.log (S -> the
// size-S task's s_run driver). No dispatch yet is not an error: an empty reply naming why.
function toolLog(a) {
  const key = String(a.key || '');
  const { task, pkgId, subgoalId } = resolveTicketRef(key);
  const opts = { tail: a.tail, since: a.since, raw: a.raw === true };
  if (!pkgId) {
    return { key: epicKey(task.run_id), task_id: task.run_id, kind: 'EPIC', source: 'ledger', node_id: null, alive: task.daemon ? driverAlive(task.daemon) : null,
      ...logReply(join(taskDir(task.run_id), 'ledger.jsonl'), { ...opts, render: renderLedgerLine }) };
  }
  if (subgoalId) throw new Error(`tm_log does not follow a TASK key ("${key}") - its STORY's driver log (${storyKey(task.run_id, pkgId)}) carries every stage of that child run`);
  let child = null;
  let nodeId = null;
  if (pkgId === 'S' && (task.harness_run || task.s_run)) {
    child = task.harness_run || task.s_run; nodeId = 'S';
  } else {
    if (!packageOf(task, pkgId)) throw new Error(`no package ${pkgId} in ${epicKey(task.run_id)} (cards and packages: ${knownIds(task).join(', ') || 'none yet'})`);
    const dispatch = latestBySubgoal(task, pkgId, 'dispatch');
    child = dispatch && dispatch.child; nodeId = dispatch ? dispatch.node_id : null;
  }
  const driver = child && child.driver;
  const head = { key: pkgId === 'S' ? `${epicKey(task.run_id)}/S` : storyKey(task.run_id, pkgId), task_id: task.run_id, kind: 'STORY', source: 'driver', node_id: nodeId };
  if (!driver || !driver.log) {
    return { ...head, log: null, exists: false, alive: null, count: 0, truncated: false, cursor: 0, lines: [],
      note: `no driver has started for ${head.key} yet - nothing to follow until its dispatch opens` };
  }
  return { ...head, alive: driverAlive(driver), ...logReply(driver.log, { ...opts, render: renderStreamLine }) };
}

// Which of a STORY's subgoals a human owns, read off the child run's own spec (tm_ticket's
// human_assignments field). [] before the package has a child run/spec at all - nothing to pin
// to a human yet, the same guard tm_assign itself has to make.
function humanAssignments(task, pkgId) {
  const dispatch = latestBySubgoal(task, pkgId, 'dispatch');
  if (!dispatch || !dispatch.child) return [];
  const child = loadRun(dispatch.child.cwd, dispatch.child.run_id);
  if (!child || !child.spec) return [];
  return (child.spec.subgoals || [])
    .filter((s) => s.assignee)
    .map((s) => ({ subgoal_id: String(s.id), who: (s.assignee && typeof s.assignee === 'object' ? s.assignee.who : null) || null }));
}

// tm_assign({task_id, key, to}): the pin path, at runtime, for the same `assignee` field a
// shape/spec can already carry (graph.mjs's applyHumanPin/releaseHumanPin, shared with
// expandSubgoals/retrySubgoal so a rejected human-authored subgoal's next attempt is pinned
// again automatically - see graph.mjs's own comment on why). A STORY key (E-xxxxxxxx/Pn) pins
// every subgoal currently in that package's child run; a TASK key (E-xxxxxxxx/Pn/subgoalId)
// pins just the one. Only the kind's AUTHOR stage ever carries the pin - applyHumanPin enforces
// that, not this function - so a judging stage can never be assigned to the human who did the
// work being judged. The child itself is never saved here: this function only PREVIEWS the pin
// (against a read-only loadRun, through applyPinAction - the same function the broker uses to
// apply it for real) and queues the instruction for the broker to pick up - see graph.mjs's
// queueHumanAction and this file's own header, rule 2.
// Two transactions on purpose: the STORY pin on the package commits first and survives a throw in
// the child-run half below (the pre-store code saved it and then could throw on a missing child run).
function toolAssign(a) {
  withTask(a, (task) => assignOnTask(task, a, { pinOnly: true }));
  return withTask(a, (task) => assignOnTask(task, a));
}

function assignOnTask(task, a, { pinOnly = false } = {}) {
  const key = String(a.key || '');
  const parsed = parseTicketKey(key);
  if (!parsed || !parsed.pkgId) throw new Error(`tm_assign needs a STORY or TASK key (E-xxxxxxxx/Pn[/subgoalId]), got "${key}"`);
  const { pkgId, subgoalId } = parsed;

  const toRaw = a.to;
  const toHuman = toRaw === 'human' || (toRaw && typeof toRaw === 'object' && toRaw.executor === 'human');
  const toAuto = toRaw === 'auto';
  if (!toHuman && !toAuto) throw new Error(`tm_assign({to}) must be "human", {executor: "human", who}, or "auto" to release - got ${JSON.stringify(toRaw)}`);
  const who = a.who || (toRaw && typeof toRaw === 'object' ? toRaw.who : null) || null;

  // A STORY pin also lives on the package itself, so the card stays the human's across a
  // re-dispatch and can be taken before it ever dispatched - a READY card is the one a person
  // picks up off the board, and refusing it until a driver was already on it was backwards.
  // openChild hands pkg.assignee to the child run it opens.
  const pkg = !subgoalId ? packageOf(task, pkgId) : null;
  if (!subgoalId && !pkg) throw new Error(`no package ${pkgId} in ${epicKey(task.run_id)}`);
  if (pkg) {
    if (toAuto) delete pkg.assignee;
    // {by: 'user'} is what applyHumanPin (graph.mjs) reads to tell this pin apart from the
    // SAME field a shape/setgoal writes on its own - the user just called tm_assign, so this
    // one always parks regardless of run.interactive (§7); an unmarked assignee is the model's.
    else pkg.assignee = { by: 'user', ...(who ? { who } : {}) };
  }
  if (pinOnly) return null; // the second transaction repeats the pin above as a no-op
  const dispatch = latestBySubgoal(task, pkgId, 'dispatch');
  if (!dispatch || !dispatch.child) {
    if (subgoalId) throw new Error(`${key} has no child run yet - pin its STORY (${storyKey(task.run_id, pkgId)}) instead, which holds until it dispatches`);
    record(task, { event: 'tm_assign', task_id: task.run_id, key, to: toAuto ? 'auto' : 'human', who, nodes: [] });
    return { key, kind: 'STORY', to: toAuto ? 'auto' : 'human', who, assigned: [] };
  }
  const child = loadRun(dispatch.child.cwd, dispatch.child.run_id);
  // A STORY pin also becomes the child run's own run-level pin (graph.mjs's applyStoryPin), so it
  // reaches the subgoals the package's setgoal has not produced yet - every package runs
  // plan/setgoal/critique first, so a freshly dispatched child has no subgoal to pin.
  if (!subgoalId && child) queueHumanAction(dispatch.child.cwd, dispatch.child.run_id, { kind: 'story_pin', to: toAuto ? 'auto' : 'human', who });
  if (!subgoalId && child && !child.spec) {
    record(task, { event: 'tm_assign', task_id: task.run_id, key, to: toAuto ? 'auto' : 'human', who, nodes: [] });
    return { key, kind: 'STORY', to: toAuto ? 'auto' : 'human', who, assigned: [], note: 'the package has not produced subgoals yet; the pin applies to them when its setgoal does' };
  }
  if (!child || !child.spec) throw new Error(`${key}'s child run has no spec yet - shape/setgoal has not produced subgoals to pin`);

  // Anything this task already queued for the broker but has not drained yet (a prior tm_assign
  // this same tick, before any team_next/team_submit/team_status touched the run) is replayed
  // onto this read-only copy first, through the same applyPinAction the loop below uses for its
  // own pin - otherwise this call's preview would be computed against a child that is stale by
  // exactly the pins this task itself just queued.
  for (const pending of peekHumanActions(dispatch.child.cwd, dispatch.child.run_id)) {
    if (pending.kind === 'pin') applyPinAction(child, pending);
  }

  const ids = subgoalId ? [subgoalId] : (child.spec.subgoals || []).map((s) => String(s.id));
  if (subgoalId && !ids.some((id) => id === subgoalId)) throw new Error(`no subgoal ${subgoalId} in ${storyKey(task.run_id, pkgId)}'s child run`);

  const assigned = [];
  for (const sid of ids) {
    const sg = child.spec.subgoals.find((s) => String(s.id) === sid);
    if (!sg) throw new Error(`no subgoal ${sid} in ${storyKey(task.run_id, pkgId)}'s child run`);
    const attempt = currentAttempt(child, sid);
    const action = { kind: 'pin', subgoal_id: sid, attempt, to: toAuto ? 'auto' : 'human', who };
    applyPinAction(child, action); // preview only - child is never saved, see below
    queueHumanAction(dispatch.child.cwd, dispatch.child.run_id, action);
    const nodeId = `${authorStage(kindOf(sg))}:${sid}:${attempt}`;
    const live = getNode(child, nodeId);
    assigned.push({ subgoal_id: sid, node_id: nodeId, state: live ? live.state : null, assignment: (live && live.assignment) || null });
  }
  // Not saveRun(child): the broker is the one writer of a child run file (this file's own header,
  // rule 2). queueHumanAction leaves the pin as a manager-owned handoff instead of writing it here
  // directly - the 0.27.3 review (2026-09-24) caught this saveRun(child) writing the child from
  // the manager's process. The broker applies it for real, through applyPinAction (the exact
  // function the preview above just ran), the next time anything calls mustFindRun for this run -
  // team_next's own promoteWaitingHuman is what actually parks the card once ingestHandoff has
  // set its assignment (broker.mjs).
  record(task, { event: 'tm_assign', task_id: task.run_id, key, to: toAuto ? 'auto' : 'human', who, nodes: assigned.map((x) => x.node_id) });
  return { key, kind: subgoalId ? 'TASK' : 'STORY', to: toAuto ? 'auto' : 'human', who, assigned };
}

// tm_inbox({task_id?}): the two sections design §7 names - waiting (I must act) and
// decided-for-you (auto-decided, with a way to object). `cards` is every waiting_human node,
// read straight off the state graph.mjs's promoteWaitingHuman already parked - no second list
// to keep in sync. `decided` is every node applyHumanPin (graph.mjs) routed to an AI instead of
// parking because the pin was the MODEL's (a shape/setgoal assignee, not tm_assign) and the run
// was not interactive - graph.mjs's own auto_decided_pin record on the node, surfaced here so a
// person can see what was defaulted and object (tm_assign it to themselves) instead of the
// decision being invisible. Scans every package's child run (dispatch.child) for a node in
// either state; a task with no packages dispatched yet simply contributes none. Both sorted
// oldest-first.
// One node -> one card/decided entry, shared by every run this scans (a package's child run
// AND, since 0.29.0, the manager graph itself - task.json is a run too). `pid` is the STORY
// this node's key sits under, or the literal 'TASK' for a manager-level node with no package.
// A run-level node (subgoal_id null - setgoal/plan/critique/gate:goal, or the manager's own
// shape/critique/accept/integrate/gate/gate:goal) has no subgoal id to key off, so the key's
// last segment falls back to the node's own node_id - still unique, still a valid TASK key
// (parseTicketKey only requires a third segment, never that it name a real subgoal).
function inboxEntry(task, pid, run, n) {
  const sg = run.spec && (run.spec.subgoals || []).find((s) => String(s.id) === String(n.subgoal_id));
  // An `ask` card is keyed by its own node id, never by its subgoal. Since 0.28.7 one subgoal's
  // questions are split into one card per owner (idol-beta-ask1 raised five for U4 alone), so a
  // subgoal-keyed card is ambiguous - and tm_submit, handed an ambiguous key, would apply one
  // owner's answers to another owner's card. The third key segment already accepts a node id
  // (toolSubmitHuman's own fallback branch), so this needs no new addressing scheme, only an
  // unambiguous one. A pinned author card stays subgoal-keyed: there is only ever one per
  // subgoal, and that is the key 0.27.3 documented.
  const key = taskKey(task.run_id, pid, n.stage === 'ask' ? n.node_id : (n.subgoal_id || n.node_id));
  if (n.state === 'waiting_human') {
    return { card: {
      key,
      task_id: task.run_id,
      node_id: n.node_id,
      // Three kinds of card park here and they ask for different things: a pinned author stage
      // wants the work done (0.27.3), an `ask` node wants one decision picked from named
      // candidates (graph.mjs's openAsk, generalized past investigate in 0.29.0), a `human_gate`
      // node wants an accept/reject with reasons (graph.mjs's promoteHumanGates). `stage` and
      // `human_gate` are what tell them apart; `questions` is only ever present on the second.
      stage: n.stage,
      ...(n.human_gate ? { human_gate: true } : {}),
      title: (sg && sg.title) || String(n.subgoal_id || n.node_id),
      acceptance: (sg && sg.acceptance) || [],
      ...(n.stage === 'ask' ? { questions: n.questions || [] } : {}),
      // A running STORY's forwarded question (tm_ask): which question it is and whose it is.
      ...(n.stage === 'ask' && n.ask_id ? { ask_id: n.ask_id, story_key: n.story_key } : {}),
      briefing_path: n.briefing_path || null,
      who: (n.assignment && n.assignment.who) || null,
      since: n.waiting_since || null,
      ...(n.stage === 'ask' && !n.ask_id && askTimeoutMs(task) && n.waiting_since ? { expires_at: n.waiting_since + askTimeoutMs(task) } : {}),
    } };
  }
  // An ask nobody answered before ask_timeout: decided for the person, so it is listed with the
  // other decided-for-you entries (expireAsks) - object by re-deciding it yourself.
  if (n.stage === 'ask' && n.result && n.result.by === 'timeout') {
    return { decided: {
      key,
      task_id: task.run_id,
      node_id: n.node_id,
      stage: n.stage,
      title: (sg && sg.title) || String(n.subgoal_id || n.node_id),
      who: (n.assignment && n.assignment.who) || null,
      reason: `ask_timeout: nobody answered within ${n.result.timed_out_after_ms}ms - defaults applied`,
      decisions: n.result.decisions || [],
      since: n.finished_at || null,
    } };
  }
  if (n.auto_decided_pin) {
    return { decided: {
      key,
      task_id: task.run_id,
      node_id: n.node_id,
      stage: n.stage,
      title: (sg && sg.title) || String(n.subgoal_id || n.node_id),
      who: n.auto_decided_pin.who || null,
      reason: n.auto_decided_pin.reason,
      since: n.auto_decided_pin.at || null,
    } };
  }
  return null;
}

// tm_inbox({task_id?}): the two sections design §7 names - waiting (I must act) and
// decided-for-you (auto-decided, with a way to object). `cards` is every waiting_human node,
// read straight off the state graph.mjs's promoteWaitingHuman/promoteHumanGates already parked
// - no second list to keep in sync. `decided` is every node applyHumanPin/promoteHumanGates
// (graph.mjs) routed past a person instead of parking, because the run is not interactive -
// graph.mjs's own auto_decided_pin record on the node, surfaced here so a person can see what
// was defaulted and object instead of the decision being invisible. Scans every package's
// child run (dispatch.child) AND, since 0.29.0, the task's own manager graph (task.nodes) - a
// task with no packages dispatched yet, and one with none of its own manager-level cards
// either, simply contributes none. Both sorted oldest-first.
function toolInbox(a) {
  const ids = a.task_id ? [String(a.task_id)] : (() => { try { return readdirSync(tasksRoot()); } catch { return []; } })();
  const cards = [];
  const decided = [];
  for (const tid of ids) {
    const task = loadRunAt(taskPath(tid));
    if (!task) continue;
    for (const n of task.nodes) {
      const entry = inboxEntry(task, 'TASK', task, n);
      if (entry && entry.card) cards.push(entry.card);
      if (entry && entry.decided) decided.push(entry.decided);
    }
    const packages = [...planningPkgs(task), ...qaPkgs(task), task.audit_pkg, ...((task.spec && task.spec.packages) || [])].filter(Boolean);
    for (const pkg of packages) {
      const pid = String(pkg.id);
      const dispatch = latestBySubgoal(task, pid, 'dispatch');
      if (!dispatch || !dispatch.child) continue;
      const child = loadRun(dispatch.child.cwd, dispatch.child.run_id);
      if (!child) continue;
      // A card already answered (a person's tm_submit, or expireAsks) but not yet drained by the
      // broker is not waiting on anybody any more.
      const answered = new Set(peekHumanActions(dispatch.child.cwd, dispatch.child.run_id).filter((x) => x.kind === 'submit').map((x) => x.node_id));
      for (const n of child.nodes) {
        if (answered.has(n.node_id)) continue;
        const entry = inboxEntry(task, pid, child, n);
        if (entry && entry.card) cards.push(entry.card);
        if (entry && entry.decided) decided.push(entry.decided);
      }
    }
  }
  cards.sort((x, y) => (x.since || 0) - (y.since || 0));
  decided.sort((x, y) => (x.since || 0) - (y.since || 0));
  return { cards, decided };
}

// tm_docs's whole job: call docs.mjs's single write site. No rendering logic lives here, and no
// second write site is introduced - writeDocs takes no clock, so this stays a pure function of
// task.json every time it is called (rebuild or not).
function toolDocs(a) {
  const task = mustFindTask(a);
  const written = writeDocs(task, { rebuild: a.rebuild === true });
  return { task_id: task.run_id, rebuild: a.rebuild === true, written };
}

// tm_clean({task_id?, dry_run?}) — §14 C-11: "EPIC DONE 시 tm_clean({task_id}) 하나만 추가."
// With task_id: refuses (throws) a task that is not yet in a terminal state - complete or
// blocked, the same distinction serviceDaemon already reads off taskState/managerState. dry_run
// defaults false there (an explicit target means the caller already decided). Without task_id:
// every task under tasksRoot() is swept, a running one is skipped rather than refusing the whole
// call, and dry_run defaults true (list candidates, change nothing) since nobody named one task
// to act on. Idempotent either way: a worktree or branch already gone from a prior call reads as
// already_clean, not an error.
function toolClean(a) {
  if (a.task_id) {
    const task = mustFindTask(a);
    const dryRun = a.dry_run === undefined ? false : !!a.dry_run;
    const st = taskState(task).state;
    if (st === 'running') {
      const alive = task.daemon && driverAlive(task.daemon);
      throw new Error(`task ${task.run_id} is running (daemon ${alive ? `alive, pid ${task.daemon.pid}` : 'not tracked as alive'}) - tm_clean only cleans a task in a terminal state (complete or blocked); check tm_status/tm_wait first`);
    }
    return cleanTask(task, dryRun);
  }
  const dryRun = a.dry_run === undefined ? true : !!a.dry_run;
  let ids = [];
  try { ids = readdirSync(tasksRoot()); } catch { ids = []; }
  const tasks = ids.map((id) => loadRunAt(taskPath(id))).filter(Boolean);
  const results = tasks.map((task) => {
    const st = taskState(task).state;
    if (st === 'running') return { task_id: task.run_id, state: st, skipped: true, reason: 'running' };
    return { state: st, ...cleanTask(task, dryRun) };
  });
  return { dry_run: dryRun, tasks: results };
}

// tm_cancel({task_id}) - stop a task for good (backlog card 51). The order is the point:
//   1. one transaction saves task.cancelled and, in the same commit, clears every spawning token
//      and in-flight `open` claim, so nothing new starts from here on (reserveSpawn, advanceDispatches
//      and the daemon loop all read the marker);
//   2. the daemon, every driver and every judge are killed, and each pid is confirmed dead - the
//      pids are re-collected after each round, since an open that was mid-effect may have spawned one
//      more - before ANYTHING is appended, so a late daemon write cannot land after `clean`;
//   3. the task's own child graph runs are retired (undoOpen's marking, scoped to n.child);
//   4. a report stub, then daemon_done {state:'cancelled'} (what the dispatch gate reads), then
//      `clean` as the last ledger event (what the push hold reads).
// Worktrees and branches stay for a later tm_clean. A complete, cancelled or cleaned task is a
// no-op that reports the state. Async only so the event loop can reap the children it just killed.
const CANCEL_RELEVANT = ['tm_open', 'tm_retry', 'daemon_spawned', 'daemon_done', 'clean'];

function lastRelevantEvent(taskId) {
  let lines = [];
  try { lines = readFileSync(join(taskDir(taskId), 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { return null; }
  for (let i = lines.length - 1; i >= 0; i--) {
    try { const e = JSON.parse(lines[i]); if (CANCEL_RELEVANT.includes(e.event)) return e.event; } catch { /* torn line */ }
  }
  return null;
}

// Every process this task is known to have started and that is still the process recorded.
function taskProcesses(taskId) {
  const task = loadRunAt(taskPath(taskId));
  const out = [];
  const add = (p, role) => { if (p && Number.isInteger(p.pid)) out.push({ role, pid: p.pid, started_at: p.started_at, command: p.command }); };
  if (task) {
    add(task.daemon, 'daemon');
    add(task.daemon && task.daemon.keep_awake, 'keep_awake');
    for (const n of task.nodes || []) {
      add(n.child && n.child.driver, `driver:${n.node_id}`);
      add(n.judging && n.judging.proc, `judge:${n.node_id}`);
    }
    add(task.harness_run && task.harness_run.driver, 'driver:S');
    add(task.s_run && task.s_run.driver, 'driver:S');
  }
  // An open that spawned its driver and never applied it is known only to its intent.
  try {
    for (const f of readdirSync(join(taskDir(taskId), 'opening'))) {
      const intent = readIntent(taskId, f.replace(/\.json$/, ''));
      if (intent) add(intent.driver, `driver:${intent.node_id || 'open'}`);
    }
  } catch { /* no intents */ }
  for (const p of registryProcesses(taskId)) add(p, `reserved:${p.where}`);
  const seen = new Set();
  return out.filter((p) => {
    if (seen.has(p.pid)) return false;
    seen.add(p.pid);
    // keep_awake is a caffeinate this server started, not a process whose identity was recorded.
    return p.role === 'keep_awake' ? liveProc(p.pid) : sameProcess(p) && liveProc(p.pid);
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function stopTaskProcesses(taskId) {
  const killed = [];
  for (let round = 0; round < 5; round++) {
    const procs = taskProcesses(taskId);
    if (!procs.length) return killed;
    for (const sig of ['SIGTERM', 'SIGKILL']) {
      for (const p of procs) {
        if (!liveProc(p.pid)) continue;
        // A driver is a group leader (detached): the whole subtree goes. A judge is not.
        try { process.kill(-p.pid, sig); } catch { try { process.kill(p.pid, sig); } catch { /* gone */ } }
        if (!killed.some((k) => k.pid === p.pid)) killed.push({ role: p.role, pid: p.pid });
      }
      for (let i = 0; i < 60 && procs.some((p) => liveProc(p.pid)); i++) await delay(50);
      if (!procs.some((p) => liveProc(p.pid))) break;
    }
  }
  await delay(30); // let the event loop reap what it just killed
  const left = taskProcesses(taskId);
  if (left.length) throw new Error(`tm_cancel could not stop ${left.map((p) => `${p.role} (pid ${p.pid})`).join(', ')}; the cancel marker is saved and nothing was written after it - run tm_cancel again`);
  return killed;
}

async function toolCancel(a) {
  const found = mustFindTask(a);
  const id = found.run_id;
  const state = taskState(found).state;
  const last = lastRelevantEvent(id);
  // A cancel that stopped after its marker (a pid it could not kill) is not finished: it resumes.
  if (state === 'complete' || last === 'clean') {
    return { task_id: id, state, noop: true, reason: `the task is ${state}${last === 'clean' ? ' and already cleaned' : ''}; there is nothing to cancel` };
  }
  // 1. the marker and the cleared reservations, in one commit
  const was = withTask(a, (task) => {
    const before = taskState(task).state;
    if (!task.cancelled) {
      task.cancelled = { at: Date.now(), by: 'tm_cancel', was: before };
      for (const h of [task.daemon, task.harness_run, task.s_run, ...task.nodes.map((n) => n.child)].filter(Boolean)) delete h.spawning;
      for (const n of task.nodes) {
        if (!n.claim || n.claim.op !== 'open') continue;
        delete n.claim;
        if (n.stage === 'dispatch' && n.state === 'running' && !n.child) n.state = 'pending';
      }
      record(task, { event: 'tm_cancel', task_id: task.run_id, was: before });
    }
    return task.cancelled.was;
  });
  // 2. every pid dead, confirmed, before anything is appended
  const killed = await stopTaskProcesses(id);
  // 3. the task's own child runs, by its own child pointers
  const task = loadRunAt(taskPath(id));
  let retired = 0;
  for (const n of [...task.nodes.filter((x) => x.child), ...(task.s_run ? [{ node_id: 'S', child: task.s_run }] : [])]) {
    try {
      mutateRun(join(n.child.cwd, '.teams_output', 'broker', 'runs', `${n.child.run_id}.json`), (r) => {
        r.retired = { by: 'teams', node_id: n.node_id, reason: 'cancelled by tm_cancel', at: Date.now() };
      });
      retired++;
    } catch { /* the run never got a file, or it is gone */ }
  }
  // 4. the stub, then the two closing events
  const report = docPaths(task).report;
  if (!existsSync(report)) {
    mkdirSync(dirname(report), { recursive: true });
    writeFileSync(report, [
      `# Report — cancelled`, '',
      `Task ${epicKey(id)} was cancelled with tm_cancel at ${new Date(task.cancelled.at).toISOString()} (it was ${was}). No report stage ran; nothing here was judged.`, '',
      `## What was stopped`, '',
      ...(killed.length ? killed.map((k) => `- ${k.role} (pid ${k.pid})`) : ['- no live process was left']), '',
      `## What is left`, '',
      `- Worktrees and branches stay as they are until tm_clean.`,
      `- ${retired} child graph run(s) were retired.`, '',
    ].join('\n'));
  }
  record({ run_id: id }, { event: 'daemon_done', task_id: id, state: 'cancelled', cancelled: true });
  record({ run_id: id }, { event: 'clean', task_id: id, cancelled: true, removed_worktrees: [], removed_branches: [], kept_branches: [] });
  return { task_id: id, state: 'cancelled', was, killed, retired_runs: retired, report, note: 'worktrees and branches stay until tm_clean' };
}

export function requireRunnable(task, nodeId) {
  const n = getNode(task, nodeId);
  if (!n) throw new Error(`unknown node ${nodeId}`);
  if (n.stage === 'dispatch') {
    if (n.state !== 'running') throw new Error(`dispatch ${n.node_id} is ${n.state}; only a running dispatch can be folded`);
    return n;
  }
  if (n.state !== 'pending') throw new Error(`node ${n.node_id} is ${n.state}, not pending`);
  const missing = unmetDeps(task, n);
  if (missing.length) throw new Error(`node ${n.node_id} is blocked on ${missing.join(', ')}`);
  return n;
}

// Shared by tm_open and tm_run: create the task and, when the caller pinned size, resolve the
// size node right away exactly like a measured S/L would. Returns {task, delegated} -
// delegated is delegateIfSmall's own return - null since a size-S task plans first (C6): the
// pin opens its one planning card, and the caller drives the manager graph exactly as for L.
// This is the one place tm_open and tm_run's task-creation paths meet, so a step both need
// belongs here, not copied into each of them.
async function openTaskAndMaybePin(a, eventName) {
  const task = createTask(a);
  record(task, { event: eventName, task_id: task.run_id, cwd: task.cwd, flow: task.flow, size_pinned: task.size_pinned, ...(task.size_pin_source ? { size_pin_source: task.size_pin_source } : {}), ...(task.context_from_unresolved ? { context_from_unresolved: task.context_from_unresolved } : {}) });
  if (!task.size_pinned) return { task, delegated: null };
  // The pinned size is finished on a fresh read: the daemon may have run since record() above.
  const pinned = mutateTask(task.run_id, (fresh) => pinSize(fresh));
  return { ...pinned, delegated: withHarnessFields(pinned.delegated, task.run_id) };
}

function pinSize(task) {
  const n = task.nodes.find((x) => x.node_id === 'size');
  const out = finish(task, n, {
    stage_ok: true, size: task.size_pinned, size_source: 'pinned', sizing: [],
    handoff: task.size_pin_source === 'boxed-backlog'
      ? 'Size pinned L: this is a backlog held to a budget/timebox, and the box can only stop by leaving the lowest-priority packages undispatched. Nothing was measured; shape decides the packages from the backlog and the tree.'
      : task.size_pinned === 'L'
      ? 'Size pinned L by the entry: the user said the request must be split into packages. Nothing was measured; shape decides the packages from the request and the tree.'
      : 'Size pinned S by the entry: the user said one run must carry it.',
    evidence: 'no measurement: pinned by the caller',
  });
  const delegated = delegateIfSmall(task, n, out);
  return { task, delegated };
}

// tm_open: kept for the existing skill path and this whole test suite, byte-for-byte compatible
// under noDaemon() (every test that drives a task by hand sets it). With a daemon in play, this
// does NOT also call toolNext() itself for an L task - toolNext opens ready dispatches and would
// race the very daemon this call just spawned into opening the same node twice. So the shapes
// diverge on purpose: noDaemon() gets the old, fully-driven reply (ready[]/children[]); a real
// daemon gets a thin pointer, and the caller reads progress with tm_status/tm_board/tm_wait
// instead - the daemon and package drivers do the rest.
async function toolOpen(a) {
  const { task, delegated } = await openTaskAndMaybePin(a, 'tm_open');
  const shared = sharedSizeSNote(task);
  const notes = [...((task.team && task.team.notes) || []), ...(shared ? [shared] : [])];
  const extra = { ...(task.context_from_unresolved ? { context_from_unresolved: task.context_from_unresolved } : {}), ...(task.carryover_candidates ? { carryover_candidates: task.carryover_candidates } : {}), ...(notes.length ? { notes } : {}) };
  if (delegated) return { ...delegated, docs_dir: docPaths(task).dir, ...extra };
  if (noDaemon()) return { ...toolNext({ task_id: task.run_id }), ...extra };
  return { task_id: task.run_id, state: managerState(task).state, docs_dir: docPaths(task).dir, ...extra };
}

// tm_run: the non-driving entry point §4/§10-1 of the design doc asks for - open, spawn the
// daemon, hand back a pointer, never block and never self-drive. Always this shape, daemon
// spawned or not (noDaemon() only stops the process from actually starting; a test that wants
// to drive a tm_run-created task by hand still can, through tm_next/tm_submit, exactly as it
// would for a tm_open-created one).
async function toolRun(a) {
  const { task, delegated } = await openTaskAndMaybePin(a, 'tm_run');
  const extra = { ...(task.context_from_unresolved ? { context_from_unresolved: task.context_from_unresolved } : {}), ...(task.carryover_candidates ? { carryover_candidates: task.carryover_candidates } : {}) };
  const shared = sharedSizeSNote(task);
  const notes = [...((task.team && task.team.notes) || []), ...(shared ? [shared] : [])];
  if (shared) extra.notes = notes;
  return {
    task_id: task.run_id,
    run_id: task.run_id,
    docs_dir: docPaths(task).dir,
    state: delegated ? delegated.state : managerState(task).state,
    ...extra,
  };
}

// Size S goes to the development harness (_repo/docs/plans/2026-09-28-teams-long-loop.md S1): no
// planning card, feature split, shape or critique - the harness plans, sets goals, critiques,
// implements, tests and gates it with its own stages, claude and codex taking part. The task
// stays on disk as the pointer to that run. The reply's tm_next harness fields (driver, next, ...)
// are added by withHarnessFields once the transaction has committed and the driver is spawned.
export function delegateIfSmall(task, n, out) {
  if (!(n.stage === 'size' && n.state === 'done' && task.size === 'S')) return null;
  if (task.harness_run || task.s_run) return null;
  for (const x of task.nodes) {
    if (x.node_id === 'size') continue;
    if (x.state === 'pending') { x.state = 'skipped'; x.result = { stage_ok: false, reason: 'size S: the development harness runs it - no planning card, feature split, shape or critique stages' }; }
  }
  openHarnessRun(task);
  saveRun(task);
  return { ...out, task_state: 'harness' };
}

// Outside any transaction, after the one that called delegateIfSmall: its reply plus tm_next's
// harness fields, read from the committed task (the driver applySpawn wrote). Other replies pass.
function withHarnessFields(reply, taskId) {
  if (!reply || reply.task_state !== 'harness') return reply;
  return { ...reply, ...withTask({ task_id: taskId }, (task) => toolNextHarness(task)) };
}

// The retry itself is one transaction on a fresh read; the tm_next that every reply carries runs
// after it commits (toolNext owns its own transactions and must never run inside one).
function toolRetry(a) {
  const res = withTask(a, (task) => retryTask(task, a));
  return { ...res, ...toolNext({ task_id: res.task_id }) };
}

function retryTask(task, a) {
  if (task.cancelled) throw new Error('task cancelled');
  // A driver parked waiting_capacity after a usage-limit death spent no restart; the way back
  // is not a retried package but a cleared wait, once the caller believes capacity is back.
  // Clears every waiting child (or just package_id's, or task.s_run for a size-S task) and
  // respawns its driver - none of that counts against driver_restarts.
  if (a.reset_capacity === true) {
    const resumed = clearCapacity(task, a.package_id != null ? String(a.package_id) : null);
    saveRun(task);
    record(task, { event: 'tm_reset_capacity', task_id: task.run_id, resumed });
    return { task_id: task.run_id, retried: resumed.length > 0, resumed, reason: resumed.length ? '' : 'nothing in this task is waiting on provider capacity' };
  }
  // A size-S task whose harness driver died past its budget: a fresh driver on the same run,
  // with a fresh restart budget - the same move tm_retry makes for a spent package.
  if (task.harness_run && a.package_id == null) {
    const h = task.harness_run;
    const st = taskState(task);
    if (st.state !== 'blocked') return { task_id: task.run_id, retried: false, reason: `the harness run is ${st.state}` };
    if (a.avoid_executors != null && !Array.isArray(a.avoid_executors)) throw new Error('avoid_executors must be an array of executor names');
    // Stuck on a failed report: re-pend just that node on the run (the graph run file is the
    // source of truth), then give it a driver. Subgoal nodes are not touched.
    let retriedNode = null;
    if (h.stuck && h.stuck.node) {
      const stuckRun = resolveHarnessRun(task);
      if (stuckRun && stuckRun.route === 'graph') {
        const path = graphRunPath(stuckRun.cwd, stuckRun.run_id);
        const out = mutateRun(path, (disk) => {
          disk.store_path = path; // retryReport's saveRun accepts the transaction's own object
          try { return retryReport(disk, '', { node_id: h.stuck.node, avoid_executors: a.avoid_executors, different_vendor: a.different_vendor === true }); } finally { delete disk.store_path; }
        });
        if (!out.refused && !out.attempt) {
          return { task_id: task.run_id, retried: false, reason: out.reason };
        }
        if (!out.refused) retriedNode = h.stuck.node;
      }
    }
    delete h.exhausted;
    delete h.stuck; // the person asked for another driver on this run
    if (!noDriver()) {
      // tm_retry_harness is recorded by the apply, with the new driver's pid.
      const run = resolveHarnessRun(task);
      const attempt = nextSpawnAttempt(h);
      respawnDriver(task, 'S', h, {
        attempt, reason: 'tm_retry', restarts: [],
        spawn: (t) => spawnHarnessDriver(t, { resume: true, run, attempt }),
        event: (t, fresh) => ({ event: 'tm_retry_harness', task_id: t.run_id, pid: fresh.pid, ...(retriedNode ? { node: retriedNode } : {}) }),
      });
    } else {
      record(task, { event: 'tm_retry_harness', task_id: task.run_id, pid: h.driver && h.driver.pid, ...(retriedNode ? { node: retriedNode } : {}) });
    }
    saveRun(task);
    return { task_id: task.run_id, retried: true };
  }
  // A size-L task whose daemon died past driver_restarts with its manager graph still running:
  // nothing is wrong with the shape, so a bare tm_retry gives the daemon a fresh budget on the
  // same run instead of re-planning. A graph that is itself blocked falls through to retryShape.
  const noSelector = a.package_id == null && a.repair !== true && !(Array.isArray(a.repackage) && a.repackage.length);
  if (noSelector && !task.s_run && !task.harness_run && task.daemon && task.daemon.exhausted === true
    && !driverAlive(task.daemon) && managerState(task).state === 'running') {
    task.daemon.exhausted = false;
    task.daemon.restarts = 0;
    const spawned = noDaemon() ? false : spawnDaemon(task, { reset: true });
    saveRun(task);
    if (!spawned && !noDaemon()) return { task_id: task.run_id, target: 'daemon', retried: false, reason: 'the daemon could not be started (task directory gone or a spawn already under way)' };
    record(task, { event: 'tm_retry', task_id: task.run_id, target: 'daemon' });
    return { task_id: task.run_id, target: 'daemon', retried: true };
  }
  // Two children pass and the merge fails: that is nobody's failure but the shape's. The
  // packages that collided go back to shape as one instruction - make them one package, or
  // order them so the later one builds on the earlier - with the conflicting files as the
  // evidence. Worktrees of ids the new shape keeps are reused with their delivered commits.
  if (Array.isArray(a.repackage) && a.repackage.length) {
    const ids = a.repackage.map(String);
    const unknown = ids.filter((id) => !packageOf(task, id));
    if (unknown.length) throw new Error(`repackage names packages not in the shape: ${unknown.join(', ')}`);
    const failed = task.nodes.filter((n) => n.state === 'failed' && n.result && (n.result.conflicts || []).length).pop();
    const fb = [
      `Repackage ${ids.join(' and ')}: they conflicted at integration and cannot be independent packages.`,
      `Either shape them as ONE package, or make one depend on the other so it starts from the other's delivered branch.`,
      ...(failed ? [`Conflicting files: ${failed.result.conflicts.join(', ')}`, failed.result.reason || ''] : []),
      ...ids.map((id) => { const p = packageOf(task, id); return `${id} (${p.title}) declared touches: ${(p.touches || []).join(', ') || '(none)'}`; }),
      `Worktrees of package ids you keep are reused with the work they already delivered.`,
    ].filter(Boolean).join('\n- ');
    const out = retryShape(task, fb);
    record(task, { event: out.attempt ? 'tm_repackage' : 'tm_settle', task_id: task.run_id, packages: ids, attempt: out.attempt });
    return { task_id: task.run_id, target: 'shape', repackage: ids, retried: !!out.attempt, attempt: out.attempt || undefined, reason: out.reason, unreachable: out.unreachable };
  }
  // An integrate that refused over a seam has no package to blame: reopening one puts the child
  // back in its own worktree, where the offending claim is still true and the defect is not
  // reproducible. The repair package is the route out, and `package_id: "integration"` is the
  // alias for it because that is what the first real task to reach this wedge reached for.
  if (a.repair === true || (a.package_id != null && String(a.package_id) === 'integration')) {
    const target = integrateToRepair(task);
    if (target.error) throw new Error(target.error);
    const out = openRepair(task, target.node);
    record(task, { event: out.package_id ? 'tm_repair' : 'tm_settle', task_id: task.run_id, package_id: out.package_id, integrate: target.node.node_id });
    return { task_id: task.run_id, target: out.package_id || target.node.node_id, package_id: out.package_id || undefined, repair: true,
      repairs: target.node.node_id, retried: !!out.package_id, attempt: out.package_id ? 1 : undefined,
      reason: out.reason, unreachable: out.unreachable };
  }
  if (!a.package_id) {
    // Before shape exists, "retry the plan" means the plan stage's feature split (C2).
    const split = task.nodes.filter((n) => (n.stage === 'areas' || n.stage === 'areas-critique') && n.state === 'failed' && n.result && !n.final).pop();
    if (split && !task.nodes.some((n) => n.stage === 'shape')) {
      const out = retryAreas(task, [split.result.reason || '', ...(split.result.area_problems || []), ...(split.result.blocking || [])].filter(Boolean).join('\n- '));
      saveRun(task);
      record(task, { event: out.attempt ? 'tm_retry' : 'tm_settle', task_id: task.run_id, target: 'areas', attempt: out.attempt });
      return { task_id: task.run_id, target: 'areas', retried: !!out.attempt, attempt: out.attempt || undefined, reason: out.reason, unreachable: out.unreachable };
    }
    const source = task.nodes.filter((n) => (n.stage === 'critique' || n.stage === 'shape') && n.state === 'failed' && n.result).pop();
    const out = retryShape(task, source && source.result ? shapeFeedback(source) : '');
    record(task, { event: out.attempt ? 'tm_retry' : 'tm_settle', task_id: task.run_id, target: 'shape', attempt: out.attempt });
    return { task_id: task.run_id, target: 'shape', retried: !!out.attempt, attempt: out.attempt || undefined, reason: out.reason, unreachable: out.unreachable };
  }
  const pid = String(a.package_id);
  // A package id the shape never named would open a phantom package with a dispatch that can
  // only fail. The first task to reach a failed integrate probed `package_id: "integrate"`.
  // Planning and QA cards are packages too (C2/C7): tm_retry({package_id: "PLAN-F2"}) reopens one.
  const known = [...planningPkgs(task), ...((task.spec && task.spec.packages) || []), ...qaPkgs(task), ...(task.audit_pkg ? [task.audit_pkg] : [])].map((p) => String(p.id));
  if (!known.includes(pid)) throw new Error(`no package ${pid} in the shape (packages: ${known.join(', ') || 'none yet'}); a failed integrate is retried through the package its checks blame, or reshaped with repackage`);
  const judged = task.nodes.filter((n) => n.subgoal_id === pid && n.result && (n.stage === 'accept' || n.state === 'failed'));
  const last = judged[judged.length - 1];
  const fb = last && last.result ? [last.result.reason || '', ...(last.result.gaps || [])].filter(Boolean).join('\n- ') : '';
  const out = retryPackage(task, pid, fb);
  record(task, { event: out.attempt ? 'tm_retry' : 'tm_settle', task_id: task.run_id, package_id: pid, attempt: out.attempt });
  return { task_id: task.run_id, target: pid, package_id: pid, retried: !!out.attempt, attempt: out.attempt || undefined, reason: out.reason, unreachable: out.unreachable };
}

function toolFile(a) {
  return withTask(a, (task) => fileStories(task, a));
}

function fileStories(task, a) {
  if (!task.spec || !Array.isArray(task.spec.packages)) throw new Error('this task has no shape yet - tm_file needs an existing package list to file a STORY beside');
  const stories = Array.isArray(a.stories) ? a.stories : [];
  if (!stories.length) throw new Error('tm_file needs at least one story in stories[]');
  const out = fileDefects(task, stories, { reporter: 'user', origin: 'tm_file' });
  record(task, { event: 'tm_file', task_id: task.run_id, filed: out.filed, integrate: out.integrate });
  return { task_id: task.run_id, filed: out.filed, integrate: out.integrate };
}

// Every package dispatch (and its restarts) logs to <taskDir>/drivers/dispatch_<node_id>_*.
// spawnChildDriver's own nodeIdLabel is the dispatch node_id itself (e.g. "dispatch:P1:1"),
// sanitized to "dispatch_P1_1" - so a package's OWN total, across every attempt a retry ever
// opened, is exactly the streams collectDriverCosts already found whose filename starts with
// "dispatch_<pkgId>_". Reused, not re-derived: this is the same accounting driverCostOf/
// collectDriverCosts do for the RESOURCE view (drivercost.mjs), just grouped one level up.
// Plus the node sessions of every child run this package's dispatches opened (node_streams
// are keyed <child run_id>/<node>/<attempt>), since a package's work is mostly those.
function packageCostRollup(driverTotal, pkgId, task) {
  const prefix = `dispatch_${String(pkgId).replace(/[^A-Za-z0-9._-]/g, '_')}_`;
  const matches = driverTotal.streams.filter((s) => (String(s.stream).split(/[\\/]/).pop() || '').startsWith(prefix));
  const runIds = new Set(((task && task.nodes) || []).filter((n) => n.stage === 'dispatch' && n.subgoal_id === pkgId && n.child && n.child.run_id).map((n) => String(n.child.run_id)));
  const nodeMatches = (driverTotal.node_streams || []).filter((s) => runIds.has(String(s.stream).split('/')[0]));
  const all = [...matches, ...nodeMatches];
  return {
    id: pkgId,
    cost_usd: +all.reduce((a, s) => a + s.cost_usd, 0).toFixed(4),
    turns: all.reduce((a, s) => a + s.turns, 0),
  };
}

function toolStatus(a) {
  if (!a.task_id) {
    let ids = [];
    try { ids = readdirSync(tasksRoot()); } catch { ids = []; }
    const tasks = ids.map((id) => loadRunAt(taskPath(id))).filter(Boolean)
      .sort((x, y) => (y.created_at || 0) - (x.created_at || 0))
      .map((t) => { const s = t.cancelled || t.worktree_gone ? taskState(t) : runState(t); return { task_id: t.run_id, cwd: t.cwd, state: s.state, counts: s.counts, size: t.size, request: String(t.request).slice(0, 160), created_at: new Date(t.created_at).toISOString() }; });
    return { root: tasksRoot(), tasks };
  }
  let task = mustFindTask(a);
  if (a.full) {
    if (a.node_id) { const n = getNode(task, String(a.node_id)); if (!n) throw new Error(`unknown node ${a.node_id}`); return { task_id: task.run_id, node: n }; }
    return task;
  }
  // The same account view.mjs's header already shows (view-collect.mjs's collectTask, same
  // collectDriverCosts call) - a caller polling tm_status only never had this at all, so a run
  // like awake-beta-ref1's $53.93 / 222 turns sat visible only in the raw driver logs.
  const figure = taskFigure(taskDir(task.run_id), task);
  const driverTotal = figure.live;
  const wikiFields = { wiki: { mode: wikiMode() } };
  const costFields = { cost: { usd: figure.spend, turns: driverTotal.turns, sessions: driverTotal.sessions, drivers_usd: driverTotal.drivers_usd, nodes_usd: driverTotal.nodes_usd, ...(driverTotal.estimated_usd ? { estimated_usd: driverTotal.estimated_usd } : {}) } };
  if (task.harness_run) {
    // tm_status is not a board tool: a verdict first read here renders its report and retro here.
    const before = ticketSnapshot(task);
    let changed = false;
    task = withTask(a, (fresh) => { changed = serviceHarnessRun(fresh); return fresh; });
    if (changed) syncTickets(task, before, 'tm_status');
    const ts = taskState(task);
    return {
      task_id: task.run_id,
      slug: task.slug || null,
      cwd: task.cwd,
      state: ts.state,
      ...(ts.partial_reasons ? { partial: true, partial_reasons: ts.partial_reasons } : {}),
      ...(ts.reason ? { reason: ts.reason } : {}),
      counts: {},
      size: task.size,
      flow: task.flow !== 'auto' ? task.flow : (task.flow_chosen || 'auto'),
      harness: harnessInfo(task),
      packages: [],
      cards: cardsStatus(task),
      ...costFields,
      ...wikiFields,
      daemon: task.daemon ? { pid: task.daemon.pid, alive: driverAlive(task.daemon), log: task.daemon.log, stderr: task.daemon.stderr, spawn_count: task.daemon.spawn_count, restarts: task.daemon.restarts || 0, exhausted: !!task.daemon.exhausted, stderr_tail: driverStderrTail(task.daemon) } : null,
      team: task.team || null,
    };
  }
  if (task.s_run) {
    const run = loadRun(task.s_run.cwd, task.s_run.run_id);
    const cs = run ? runState(run) : { state: 'missing', counts: {} };
    // A legacy size-S task (S2): read from its run file only.
    const ts = taskState(task);
    return {
      task_id: task.run_id,
      slug: task.slug || null,
      cwd: task.cwd,
      state: ts.state,
      ...(ts.partial_reasons ? { partial_reasons: ts.partial_reasons } : {}),
      counts: cs.counts,
      size: task.size,
      flow: task.flow !== 'auto' ? task.flow : (task.flow_chosen || 'auto'),
      s_run: { cwd: task.s_run.cwd, run_id: task.s_run.run_id,
        ...(task.s_run.driver ? { driver: { ...task.s_run.driver, alive: driverAlive(task.s_run.driver) } } : {}),
        ...(task.s_run.waiting_capacity ? { waiting_capacity: task.s_run.waiting_capacity } : {}),
        ...(task.s_run.stalled_since ? { stalled_since: task.s_run.stalled_since } : {}) },
      packages: [],
      cards: cardsStatus(task),
      ...costFields,
      ...wikiFields,
      daemon: task.daemon ? { pid: task.daemon.pid, alive: driverAlive(task.daemon), log: task.daemon.log, stderr: task.daemon.stderr, spawn_count: task.daemon.spawn_count, restarts: task.daemon.restarts || 0, exhausted: !!task.daemon.exhausted, stderr_tail: driverStderrTail(task.daemon) } : null,
      team: task.team || null,
    };
  }
  const state = taskState(task);
  return {
    task_id: task.run_id,
    slug: task.slug || null,
    cwd: task.cwd,
    state: state.state,
    ...(state.partial ? { partial: true, partial_reasons: state.partial_reasons } : {}),
    ...(daemonExhaustedNext(task) ? { next: daemonExhaustedNext(task) } : {}),
    counts: state.counts,
    size: task.size,
    flow: task.flow !== 'auto' ? task.flow : (task.flow_chosen || 'auto'),
    packages: task.spec ? task.spec.packages.map((p) => p.id) : [],
    // The planning and QA cards (C2/C7) - never in `packages`, which stays shape's own id list.
    cards: cardsStatus(task),
    // Same facts critique's briefing sees, surfaced here too - so a human polling status catches
    // a bloated foundation package or a fully-serial shape without opening the briefing file.
    ...(task.spec ? (() => {
      const sa = shapeAnalysis(task.spec.packages || []);
      return { shape: { max_parallel_width: sa.max_parallel_width, fully_serial: sa.fully_serial, touches_median: sa.touches_median, bloated: sa.bloated } };
    })() : {}),
    // Per-package total (every attempt/restart that package ever spawned), separate from
    // `packages` above so that field - already pinned elsewhere as a plain id list - never
    // changes shape.
    package_costs: task.spec ? task.spec.packages.map((p) => packageCostRollup(driverTotal, p.id, task)) : [],
    // Why a package with nothing running is not making progress - tm_ticket already surfaces
    // this per-STORY (storyBlockedReason, tickets.mjs); tm_status lists every package that IS
    // blocked, in one place, without a caller having to poll tm_ticket per package id. Includes
    // 'upstream_defect' (§upstream_defects) - a package rewired to wait on a fix STORY it itself
    // filed against an upstream dependency, not a blind retry - alongside the existing
    // unmet_deps/capacity/human_wait/restart_exhausted reasons. Only entries that ARE blocked;
    // an unblocked task reads exactly as it did before this field existed.
    blocked: task.spec ? task.spec.packages
      .map((p) => ({ package_id: p.id, blocked_reason: storyBlockedReason(task, p.id) }))
      .filter((b) => b.blocked_reason) : [],
    ...costFields,
    ...wikiFields,
    nodes: task.nodes.filter((n) => (a.node_id ? n.node_id === a.node_id : true)).map((n) => (n.state === 'pending' || n.state === 'running'
      ? { node_id: n.node_id, stage: n.stage, state: n.state, deps: n.deps, after: n.after || [],
          ...(n.child ? { child: { ...n.child, ...(n.child.driver ? { driver: { ...n.child.driver, alive: driverAlive(n.child.driver) } } : {}) } } : {}),
          ...(n.stage === 'dispatch' && n.state === 'running' && !n.child ? { opening: true } : {}) }
      : verdict(task, n))),
    daemon: task.daemon ? { pid: task.daemon.pid, alive: driverAlive(task.daemon), log: task.daemon.log, stderr: task.daemon.stderr, spawn_count: task.daemon.spawn_count, restarts: task.daemon.restarts || 0, exhausted: !!task.daemon.exhausted, stderr_tail: driverStderrTail(task.daemon) } : null,
    team: task.team || null,
    // Only present when max_parallel_teams is actually 'auto' - a task pinned to a fixed number
    // reads exactly as it did before this controller existed. `current` is the effective cap
    // advanceDispatches is using RIGHT NOW; `reason` names why it last moved (a clean-streak
    // window, or the pushback text/cluster that halved it - updateAutoParallel).
    // Both stay absent until spec.packages exists (no shape, no width yet). The ticks are the last
    // AIMD_TICKS_KEEP advanceDispatches passes: {ts, width, running, ready_waiting}.
    ...(() => {
      if (!(task.team && task.team.opts && task.team.opts.max_parallel_teams === 'auto')) return {};
      const ap = ensureAutoParallel(task);
      if (!ap) return {};
      return { auto_parallel: ap, auto_parallel_ticks: Array.isArray(task.auto_parallel_ticks) ? task.auto_parallel_ticks : [] };
    })(),
    // Only present when either knob is actually set - a task that never asked for a budget or
    // timebox reads exactly as it did before this existed.
    ...((task.team && task.team.opts && (task.team.opts.budget_usd != null || task.team.opts.timebox_minutes != null)) ? { budget: budgetStatus(task) } : {}),
  };
}

// tm_status's view of the cards that are not shape's packages: one planning card and one QA
// card per feature area (_repo/docs/plans/2026-09-28-teams-cards-everywhere.md C2/C7), each with its
// ticket state, plus where the merged PRD is and how many user stories it holds.
function cardsStatus(task) {
  const row = (p) => ({ id: String(p.id), area: p.area || null, title: p.area_title || p.title || '', state: storyTicketState(task, String(p.id)) });
  return {
    planning: planningPkgs(task).map(row),
    qa: qaPkgs(task).map(row),
    prd: planningPkgs(task).length ? docPaths(task).prd : null,
    user_stories: planningStories(task).length,
  };
}


export { lastRelevantEvent, resolveTaskRef, toolAssign, toolBoard, toolCancel, toolClean, toolDocs, toolEvents, toolFile, toolInbox, toolLog, toolOpen, toolRetry, toolRun, toolStatus, toolTicket, toolWait, withHarnessFields };
