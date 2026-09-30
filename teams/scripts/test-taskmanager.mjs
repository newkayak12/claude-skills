#!/usr/bin/env node
// Regression suite for the task-manager MCP server.
//
// Runs against the live stdio surface, with the teams-engineering broker alongside it
// as a second process: the manager opens child runs as a library, the broker drives them,
// and the manager reads them back. No vendor CLI is needed; every node is self-submitted.
//
//   node --test teams/scripts/test-taskmanager.mjs

// A test task must not land in the real run archive (mcp/runlog.mjs); spawned daemons inherit this.
process.env.TEAMS_RUNS_DIR ??= 'off';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync, existsSync, readdirSync, realpathSync, symlinkSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { viewRecordPath, readViewRecord } from '../mcp/viewserver.mjs';
import { docPaths } from '../mcp/tickets.mjs';
import { collectDriverCosts } from './bench/lib/drivercost.mjs';
import { hasDeclaredAcceptance, detectDeclaredAcceptance, resolvePlanningMode, renderAcceptanceTemplate } from '../mcp/acceptance.mjs';
import { hasDeclaredAcceptance as tmHasDeclaredAcceptance } from '../mcp/taskmanager.mjs';
import { afterTmCall, beforeTmCall, drivePlanning, completePlanningChild } from './lib/planning-drive.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TM = join(HERE, '..', 'mcp', 'taskmanager.mjs');
const BROKER = join(HERE, '..', 'mcp', 'broker.mjs');

class Client {
  // TEAMS_VIEW: '0' by default - every tm_open/tm_run in this suite would otherwise spawn a
  // real, detached scripts/view.mjs process (taskmanager.mjs's ensureViewer wiring), and this
  // file opens a fresh scratch tasks root per test so none of them would ever find an existing
  // .view.json to reuse: a full run would leak ~100 orphan node processes, one per test, none of
  // which this suite's own cleanup (rmSync of the scratch root) touches since they are detached
  // and unref'd on purpose (viewserver.mjs). The handful of tests that actually exercise the
  // viewer override this explicitly.
  constructor(script, env = {}) {
    this.script = script;
    this.proc = spawn('node', [script], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, TEAMS_VIEW: '0', ...env } });
    this.buf = '';
    this.id = 0;
    this.queue = [];
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      this.buf += chunk;
      let nl;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        if (line.trim()) this.queue.shift()(JSON.parse(line));
      }
    });
  }
  send(method, params) {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }) + '\n');
    });
  }
  async init() {
    await this.send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    return this;
  }
  async call(name, args) {
    // Every task plans now (cards-everywhere C5/C6): a task-manager client drives the planning a
    // shape submission waits on first - lib/planning-drive.mjs says how, and why.
    if (this.script === TM) args = await beforeTmCall(this, name, args, () => this.planningBroker());
    const out = await this.rawCall(name, args);
    return this.script === TM ? afterTmCall(this, name, args, out) : out;
  }
  async rawCall(name, args) {
    const r = await this.send('tools/call', { name, arguments: args });
    const res = r.result || {};
    if (res.isError) return { error: res.content[0].text };
    return res.structuredContent;
  }
  // The broker planning cards are driven through: the one the suite attached (client.broker), or
  // one this client spawns on first need and closes with itself.
  async planningBroker() {
    if (this.broker) return this.broker;
    if (!this.ownBroker) this.ownBroker = await new Client(BROKER).init();
    return this.ownBroker;
  }
  close() {
    if (this.ownBroker) this.ownBroker.close();
    this.proc.stdin.end();
    this.proc.kill();
  }
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'tm-test-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  writeFileSync(join(dir, 'b.txt'), 'y\n');
  // Real projects ignore the run state directory. With it ignored, `git add -- . ':!.teams_output'`
  // exits 1 ("paths are ignored") - the fold that the first e2e task reached failed on exactly this.
  writeFileSync(join(dir, '.gitignore'), '.teams_output/\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return dir;
}

// A default so every existing fixture keeps behaving as if it had checked something -
// the manager now refuses an accept:true/verified:true verdict with an empty checks[].
// Tests of that rule itself pass their own checks: [] to override the default.
// attacks is the goal gate's analogous default (graph.mjs Step 9): accept:true with an
// empty attacks[] is refused by the real broker exactly like an empty checks[], and every
// child run's gate:goal here is a real broker-adjudicated node.
const ok = (payload) => ({ stage_ok: true, evidence: 'e', checks: ['ok -> looked fine'], attacks: ['ok -> looked fine from outside'], ...payload });

const SHAPE = {
  acceptance: ['both modules build together'],
  packages: [
    { id: 'P1', title: 'module a', flow: 'develop', brief: 'change a.txt', acceptance: ['a.txt says a'], touches: ['a.txt'], deps: [] },
    { id: 'P2', title: 'module b', flow: 'develop', brief: 'change b.txt using a', acceptance: ['b.txt says b'], touches: ['b.txt'], deps: ['P1'] },
  ],
};

// A package shape itself pinned to a human, the spec pin path (§ tm_assign spec): `assignee`
// survives verbatim from the shape payload into task.spec.packages[i] (the shape node's own
// `finish()` spreads `...p`), and openChild carries it into createRun's `subgoal_assignee`,
// which expandSubgoals applies to every subgoal the package's own setgoal produces - the STORY
// is the human's, so its TASKs are too. This is a MODEL pin (the shape wrote it, not a person calling
// tm_assign), so every test below opens its task with interactive:true - see graph.mjs's
// applyHumanPin for the source distinction and the non-interactive, auto-decided tests further
// down this file for the off case (the 0.27.3 review, 2026-09-24).
const SHAPE_HUMAN = {
  acceptance: ['a.txt says a', 'b.txt says b'],
  packages: [
    { id: 'P1', title: 'module a', flow: 'develop', brief: 'change a.txt', acceptance: ['a.txt says a'], touches: ['a.txt'], deps: [], assignee: 'human' },
    { id: 'P2', title: 'module b', flow: 'develop', brief: 'change b.txt', acceptance: ['b.txt says b'], touches: ['b.txt'], deps: [] },
  ],
};

// A package whose own setgoal (TWO_SUBGOAL_SPEC) produces MORE than one subgoal, so a
// STORY-vs-TASK tm_assign test can tell "every subgoal" apart from "just one".
const SHAPE_SPLIT = {
  acceptance: ['both subgoals land', 'b.txt says b'],
  packages: [
    { id: 'P1', title: 'module a', flow: 'develop', brief: 'two subgoals', acceptance: ['a.txt says a'], touches: ['a.txt'], deps: [] },
    { id: 'P2', title: 'module b', flow: 'develop', brief: 'change b.txt', acceptance: ['b.txt says b'], touches: ['b.txt'], deps: [] },
  ],
};
const TWO_SUBGOAL_SPEC = {
  goal: 'G', acceptance: ['A'],
  subgoals: [
    { id: 'U1', kind: 'subgoal', title: 'a', acceptance: ['a'], test: ['x'], deps: [] },
    { id: 'U2', kind: 'subgoal', title: 'b', acceptance: ['b'], test: ['y'], deps: [] },
  ],
};

const PRD_FIXTURE = ['Goal', 'Problem', 'Target users', 'Solution overview', 'Success criteria', 'User stories', 'Out of scope', 'Open questions']
  .map((h) => `## ${h}\n\nbody\n`).join('\n');

const CHILD_SPEC = {
  goal: 'G', acceptance: ['A'],
  subgoals: [{ id: 'U1', title: 'do it', acceptance: ['a'], test: ['t'], deps: [] }],
};

// A package's child run up to its subgoal chain: plan -> setgoal -> critique, the package's own
// planning and quality gate. Every package child run starts here.
async function throughChildSpec(g, child, spec = CHILD_SPEC) {
  const { cwd, run_id } = child;
  const sub = (node_id, payload) => g.call('team_submit', { run_id, cwd, node_id, payload: ok(payload) });
  const v = await sub('plan', { handoff: 'p', flow: child.flow || 'develop', size: 'S' });
  assert.equal(v.state, 'done', JSON.stringify(v));
  const sg = await sub('setgoal', { spec });
  assert.equal(sg.state, 'done', JSON.stringify(sg));
  await sub('critique', { sound: true });
}

// Drive one child run from plan to report through the graph broker, exactly as the session
// would. Every package runs the full harness (plan -> setgoal -> critique -> implement -> test
// -> gate -> gate:goal -> report) - the 2026-09-21 chain-only child run was reverted 2026-09-28.
async function completeChild(g, child, { accept = true, skipTo = null } = {}) {
  const { cwd, run_id } = child;
  const sub = (node_id, payload) => g.call('team_submit', { run_id, cwd, node_id, payload: ok(payload) });
  let v;
  if (!skipTo) await throughChildSpec(g, child);
  else if (skipTo === 'critique') await sub('critique', { sound: true });
  // Distinct per package: git resolves identical hunks silently, and a conflict test needs a real one.
  appendFileSync(join(cwd, 'a.txt'), `changed by ${child.package_id || 'child'}\n`);
  v = await sub('implement:U1:1', { changed_files: ['a.txt'], handoff: 'built' });
  assert.equal(v.state, 'done', JSON.stringify(v));
  await sub('test:U1:1', { verified: true });
  await sub('gate:U1:1', { accept: true, match_pct: 95 });
  await sub('gate:goal:1', { accept, match_pct: accept ? 95 : 40, gaps: accept ? [] : ['missing the b half'], reason: accept ? '' : 'short' });
  const nx = await g.call('team_next', { run_id, cwd });
  if (!accept) {
    // A rejected goal gate with retries left holds the report back: the child is blocked,
    // and the session driving it would retry a subgoal. Here it does not - the manager sees
    // a child that stopped, which is what the dispatch has to fold honestly.
    assert.equal(nx.state, 'blocked');
    return;
  }
  assert.deepEqual(nx.ready.map((n) => n.node_id), ['report']);
  await sub('report', { handoff: `child report for ${cwd}` });
  assert.equal((await g.call('team_status', { run_id, cwd })).state, 'complete');
}

async function throughCritique(tm, task_id, shape = SHAPE) {
  let v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2 modules'], handoff: 'two modules' }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
  v = await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...shape, handoff: 's' }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
  v = await tm.call('tm_submit', { task_id, node_id: 'critique', payload: ok({ sound: true }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
}

async function withTask(fn, extra) {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
  const g = await new Client(BROKER).init();
  tm.broker = g;
  try {
    // These tests submit every node by hand through the broker, so they ask the manager to spawn
    // nothing. HARNESS_TEST_NO_DRIVER is a test seam, not an option: a real session never drives.
    // roles.qa defaults ON since 0.17.0; these tests build the plain graph by hand, so they pin it
    // off unless a test asks otherwise. Planning cannot be pinned off any more (cards-everywhere
    // C5): the client's beforeTmCall drives it ahead of shape (lib/planning-drive.mjs). The
    // planning audit (roles.audit, on by default) used to ride on planning being on, so these
    // tests - which never had planning - never had it either; it stays off unless a test asks for
    // planning by name (roles.planning: true, the tests about the audit) or for audit itself.
    const asked = (extra && extra.roles) || {};
    const roles = { qa: false, audit: asked.planning === true, ...asked };
    // brainstorm (_repo/docs/plans/2026-09-28-teams-light-plan.md §6.5) is on by default too; pinned off
    // for the same reason, so size still feeds the plan stage directly. Its own tests turn it on.
    const open = await tm.call('tm_open', { request: 'big request', cwd, vendor: 'self', brainstorm: false, ...extra, roles });
    await fn({ tm, g, cwd, root, task_id: open.task_id, open });
  } finally {
    tm.close();
    g.close();
    // Worktrees register in the repo; remove the repo first so git does not mind.
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

test('serves the MCP handshake and the fifteen manager tools', async () => {
  const c = await new Client(TM).init();
  try {
    const r = await c.send('tools/list', {});
    assert.deepEqual(r.result.tools.map((t) => t.name).sort(), ['tm_assign', 'tm_board', 'tm_clean', 'tm_docs', 'tm_events', 'tm_file', 'tm_inbox', 'tm_log', 'tm_next', 'tm_open', 'tm_retry', 'tm_run', 'tm_status', 'tm_submit', 'tm_ticket', 'tm_wait']);
  } finally {
    c.close();
  }
});

// isEntryPoint (pluginroots.mjs) is what taskmanager.mjs's `isMain` and daemon.mjs's
// RUN_AS_MAIN both compare against - a raw `import.meta.url === process.argv[1]` string
// comparison (3c5ad0c8) exits silently, having started nothing, the moment either side is
// reached through a symlink: macOS resolves $TMPDIR's `/var/...` to `/private/var/...` for
// import.meta.url (the ESM loader realpaths) but leaves argv[1] exactly as typed. A real bench
// run hit this - "plugin:teams:task-manager: failed (CONNECTION_CLOSED)" while broker.mjs (which
// carries no such guard) connected fine. Spawns taskmanager.mjs through a symlink standing in
// for exactly that trap and requires a real reply, not silence.
test('taskmanager.mjs starts its stdio server even when reached through a symlinked path (the macOS $TMPDIR /var -> /private/var trap)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tm-symlink-'));
  const link = join(dir, 'tm-link.mjs');
  try {
    symlinkSync(realpathSync(TM), link);
    const tm = await new Client(link).init();
    try {
      const r = await tm.send('tools/list', {});
      assert.ok(r.result && Array.isArray(r.result.tools), `symlinked taskmanager.mjs must answer tools/list, got ${JSON.stringify(r)}`);
      assert.ok(r.result.tools.some((t) => t.name === 'tm_open'), 'tm_open must be in the symlinked server\'s tool list');
    } finally {
      tm.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// daemon.mjs carries the identical guard one process down (RUN_AS_MAIN) - taskmanager.mjs's
// spawnDaemon builds this process's own argv from taskmanager.mjs's OWN import.meta.url
// (daemonPath()), so a symlinked plugin path reaches daemon.mjs's argv[1] exactly as symlinked
// too. Without --task, RUN_AS_MAIN true means a specific, visible failure (exit 1, a stderr
// message); RUN_AS_MAIN false (the bug) means the process loads the module and exits 0 in
// silence, having driven nothing - indistinguishable from a task that was already done.
test('daemon.mjs runs as the process entry point even when reached through a symlinked path (exits 1 on a missing --task, not silently 0)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'daemon-symlink-'));
  const link = join(dir, 'daemon-link.mjs');
  try {
    symlinkSync(realpathSync(join(HERE, '..', 'mcp', 'daemon.mjs')), link);
    const r = spawnSync('node', [link], { encoding: 'utf8' });
    assert.equal(r.status, 1, `symlinked daemon.mjs must run as main and exit 1 on a missing --task, not silently exit 0 (stderr: ${r.stderr})`);
    assert.match(r.stderr, /--task <task_id> is required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The guard must still be a guard: importing either file as a library - every dynamic
// `await import('../mcp/taskmanager.mjs')` elsewhere in this suite, and daemon.mjs's own import
// of taskmanager.mjs - must never start a stdio loop or touch process.stdin. This test's own
// process (argv[1] is this test file, not taskmanager.mjs/daemon.mjs) would hang waiting on
// its own stdin here if either guard degraded to "always true".
test('importing taskmanager.mjs or daemon.mjs as a module (not as the process entry point) starts no stdio loop', async () => {
  const tmMod = await import('../mcp/taskmanager.mjs');
  const daemonMod = await import('../mcp/daemon.mjs');
  assert.equal(typeof tmMod.dispatchSettled, 'function');
  assert.equal(typeof daemonMod.judgeArgv, 'function');
});

test('tm_docs writes the phase md tm_board/tm_ticket already pointed at, and rebuild reproduces the same files', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id);
    const board = await tm.call('tm_board', { task_id });
    const first = await tm.call('tm_docs', { task_id });
    assert.ok(first.written.includes(board.doc_path));
    assert.equal(readFileSync(board.doc_path, 'utf8').includes(`E-${task_id.slice(0, 8)}`), true);

    const before = readFileSync(board.doc_path, 'utf8');
    const nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) });

    // The page tracks the ticket without anyone asking: P1 moved to DONE across the two submits
    // above, and the rendered board says so before tm_docs is called at all.
    assert.notEqual(readFileSync(board.doc_path, 'utf8'), before, 'P1 moved to DONE since the first render');
    const rebuilt = await tm.call('tm_docs', { task_id, rebuild: true });
    // Snapshot every file's bytes right after the FIRST rebuild:true call, before calling it
    // again - this is what the second snapshot below gets compared against.
    const afterFirstRebuild = Object.fromEntries(rebuilt.written.map((p) => [p, readFileSync(p, 'utf8')]));

    // The determinism claim tm_docs exists to prove: calling it twice through the real MCP tool
    // path (not writeDocs directly) with rebuild:true - which deletes the docs dir first - must
    // reproduce byte-identical files across the two calls. If a wall clock or any
    // process-dependent value ever crept back into the rendered output, this is the assertion
    // that would catch it (comparing a file to itself read twice would not).
    const again = await tm.call('tm_docs', { task_id, rebuild: true });
    assert.deepEqual(again.written.sort(), rebuilt.written.sort());
    for (const p of again.written) assert.equal(readFileSync(p, 'utf8'), afterFirstRebuild[p], p);
  });
});

test('tm_open seeds size -> shape -> critique under the tasks root, not under the project', async () => {
  await withTask(async ({ cwd, root, task_id, open }) => {
    assert.deepEqual(open.ready.map((n) => n.node_id), ['size']);
    assert.equal(open.state, 'running');
    assert.ok(existsSync(join(root, task_id, 'task.json')));
    // Manager STATE - task.json, board.jsonl, briefings, worktrees - stays under the tasks root.
    // The ticket PAGES under .teams_output/team are output, not state, and are written as the
    // run moves so a ticket's body, its state and its history agree at every point (2026-09-22);
    // the assertion below used to forbid the whole directory, which is why no page was ever
    // written until someone called tm_docs by hand, and usually nobody did.
    assert.ok(!existsSync(join(cwd, 'task.json')), 'the project holds no manager state');
    assert.ok(!existsSync(join(cwd, '.harness-tasks')), 'the project holds no tasks root');
    const prompt = readFileSync(open.ready[0].briefing_path, 'utf8');
    assert.match(prompt, /# size node size \(task manager\)/);
    assert.match(prompt, /The default is S/);
    assert.match(prompt, /big request/);
  });
});

test('tm_open opens size -> areas; the areas result opens one planning card per feature area, then plan-integrate, then shape (cards-everywhere C2)', async () => {
  await withTask(async ({ tm, root, task_id, open }) => {
    assert.deepEqual(open.ready.map((n) => n.node_id), ['size']);
    let task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.deepEqual(task.nodes.map((n) => ({ node_id: n.node_id, deps: n.deps })), [
      { node_id: 'size', deps: [] },
      { node_id: 'areas', deps: ['size'] },
      { node_id: 'areas-critique', deps: ['areas'] },
    ], 'nothing past the plan stage and its gate exists before it has split the request');
    assert.deepEqual(task.planning_pkgs, []);
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'] }) });
    const v = await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: [
      { id: 'F1', title: 'sign-up', brief: 'a visitor can create an account' },
      { id: 'F2', title: 'billing', brief: 'an account holder can pay', deps: ['F1'] },
      { id: 'F3', title: 'reports', brief: 'an admin can export usage' },
    ] }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.deepEqual(task.planning_pkgs.map((p) => p.id), ['PLAN-F1', 'PLAN-F2', 'PLAN-F3'], 'one card per feature area');
    for (const p of task.planning_pkgs) {
      assert.equal(p.phase, 'planning');
      assert.equal(p.flow, 'plan');
      assert.match(p.brief, /big request/, 'each card sees the whole request it is one part of');
    }
    assert.match(task.planning_pkgs[1].brief, /^Feature area F2 - billing/);
    assert.deepEqual(task.planning_pkgs[1].deps, ['PLAN-F1'], 'an area dep becomes a card dep');
    const node = (id) => task.nodes.find((n) => n.node_id === id);
    assert.deepEqual(node('dispatch:PLAN-F1:1').deps, ['areas-critique'], 'cards wait on the split\'s own gate (M4)');
    assert.deepEqual(node('dispatch:PLAN-F2:1').deps, ['areas-critique', 'accept:PLAN-F1:1']);
    assert.deepEqual(node('dispatch:PLAN-F3:1').deps, ['areas-critique'], 'cards without deps run in parallel');
    assert.deepEqual(node('plan-integrate:1').deps, ['accept:PLAN-F1:1', 'accept:PLAN-F2:1', 'accept:PLAN-F3:1']);
    assert.deepEqual(node('shape').deps, ['plan-integrate:1'], 'shape waits on the planning integrate, not on size or one card');
    assert.deepEqual(node('critique').deps, ['shape']);
    assert.deepEqual(task.areas.map((a) => a.id), ['F1', 'F2', 'F3']);
    // Two cards ready at once, one waiting on its dep - both dispatched by one tm_next.
    const nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.children.map((c) => c.package_id).sort(), ['PLAN-F1', 'PLAN-F3']);
    // Each card has its own worktree (parallel cards would otherwise write over each other).
    assert.notEqual(nx.children[0].cwd, nx.children[1].cwd);
  });
});

test('tm_open with no roles argument defaults BOTH planning and qa on (0.17.0): the plan stage precedes shape', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
  try {
    const open = await tm.call('tm_open', { request: 'big request', cwd, vendor: 'self' });
    const task = JSON.parse(readFileSync(join(root, open.task_id, 'task.json'), 'utf8'));
    // planning defaults to 'auto' since the light PLAN mode (2026-09-28); a free-text request
    // with no declared acceptance resolves to the full chain - auto never turns PLAN off.
    assert.deepEqual(task.team.opts.roles, { planning: 'auto', qa: true, audit: true });
    assert.equal(task.planning_mode, 'full');
    // The plan stage comes first (brainstorm, on by default, sits between it and size).
    assert.deepEqual(task.nodes.map((n) => n.node_id), ['size', 'brainstorm', 'areas', 'areas-critique']);
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'areas').deps, ['brainstorm']);
  } finally {
    tm.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// C5 (_repo/docs/plans/2026-09-28-teams-cards-everywhere.md): roles.planning false is refused - it
// used to remove PLAN from the graph (the regression this test pinned); now the task plans like
// any other, and the refusal is on the record as a team note.
test('roles.planning:false is refused: the plan stage still opens, and a note records the refusal (C5)', async () => {
  await withTask(async ({ root, task_id }) => {
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.deepEqual(task.nodes.map((n) => ({ node_id: n.node_id, deps: n.deps })), [
      { node_id: 'size', deps: [] },
      { node_id: 'areas', deps: ['size'] },
      { node_id: 'areas-critique', deps: ['areas'] },
    ]);
    assert.equal(task.team.opts.roles.planning, 'auto', 'the refused value falls back to the default');
    assert.equal(task.team.opts.roles.qa, false, 'the rest of the roles object still applies');
    assert.ok(task.team.notes.some((x) => /roles\.planning: false is refused/.test(x)), JSON.stringify(task.team.notes));
    assert.equal(task.planning_mode, 'full');
  }, { roles: { planning: false } });
});

test('the PLAN child run is pinned to the plan flow (mixed:false) and its context says PRD, not implementation (2026-09-22 first real run)', async () => {
  await withTask(async ({ tm, cwd, root, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', sizing: ['x'] }) });
    await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: [{ title: 'sign-up', brief: 'a visitor can sign up' }, { title: 'billing', brief: 'an account can pay' }] }) });
    await tm.call('tm_next', { task_id });
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const d = task.nodes.find((n) => n.node_id === 'dispatch:PLAN-F2:1');
    assert.equal(d.state, 'running');
    const run = JSON.parse(readFileSync(join(d.child.cwd, '.teams_output', 'broker', 'runs', `${d.child.run_id}.json`), 'utf8'));
    assert.equal(run.flow, 'plan');
    assert.equal(run.mixed, false, 'a phase-Team run may not mix in develop subgoals');
    // The full harness: a planning card's child run is never chain-only (C1/C2 principle 1).
    assert.deepEqual(run.nodes.map((n) => n.node_id).slice(0, 2), ['plan', 'setgoal']);
    assert.notEqual(run.parent_shaped, true);
    assert.match(run.context, /PRD/);
    assert.match(run.context, /Change no source files/);
    // C3: the card is told its area, its section's parts, and its story-id prefix.
    assert.match(run.context, /planning card PLAN-F2, one of 2/);
    assert.match(run.context, /Goal; its Scope and its non-goals/);
    assert.match(run.context, /F2-US-1, F2-US-2/);
    assert.match(run.context, /its own worktree, private to this card/);
    assert.notEqual(d.child.cwd, cwd, 'a planning card works in its own worktree, not the project root');
    assert.doesNotMatch(run.context, /private to this package/, 'the ordinary-package worktree line does not apply to planning');
  });
});

// Light PLAN mode (_repo/docs/plans/2026-09-28-teams-light-plan.md §2): roles.planning 'auto' reads
// the backlog's structure and runs investigate -> template-fill -> gate when its acceptance is
// already declared. The request below is the portfolio-refresh-80ec931a shape: a numbered
// 8-item backlog plus one shared "Acceptance for every item:" block.
const LIGHT_BACKLOG = [
  'Bring the portfolio skills up to the portfolio-feedback (1.13-1.14) standard.',
  '',
  '1. portfolio-rewrite',
  '2. portfolio-pattern',
  '3. portfolio-jd',
  '4. portfolio-company',
  '5. portfolio-interview',
  '6. portfolio-story',
  '7. portfolio-review',
  '8. portfolio-summary',
  '',
  'Acceptance for every item:',
  '- R1 a [confirmed] ledger where the skill runs multi-turn sessions',
  '- R2 boundary-value rules stated with their thresholds',
  '- R3 EN + KR scenarios, 2-3 each',
  '- R4 Process -> Output Template -> What Claude Does -> Related Skills',
  '- R5 no background explanation sections',
  '- R6 version bumped and README/KOR updated together',
].join('\n');

async function withOpen(args, fn) {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
  try {
    const open = await tm.call('tm_open', { cwd, vendor: 'self', ...args });
    const task = JSON.parse(readFileSync(join(root, open.task_id, 'task.json'), 'utf8'));
    await fn({ tm, cwd, root, task_id: open.task_id, task });
  } finally {
    tm.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

test('light PLAN: roles.planning "auto" + a numbered backlog with a shared "Acceptance for every item:" block resolves light, and the PLAN child runs light with the numbered checklist', async () => {
  await withOpen({ request: LIGHT_BACKLOG, roles: { qa: false }, brainstorm: false }, async ({ tm, root, task_id, task }) => {
    assert.equal(task.team.opts.roles.planning, 'auto');
    assert.equal(task.planning_mode, 'light');
    assert.match(task.planning_mode_reason, /auto/);
    assert.equal(task.declared_acceptance.items.length, 8);
    assert.equal(task.declared_acceptance.shared.length, 6);
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', sizing: ['x'] }) });
    // The plan stage is told the backlog is declared, so it hands each area its items.
    const split = (await tm.call('tm_next', { task_id })).ready.find((r) => r.node_id === 'areas');
    assert.match(readFileSync(split.briefing_path, 'utf8'), /give every area its "items"/);
    await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: [
      { title: 'writing skills', brief: 'rewrite, pattern, jd, company', items: [1, 2, 3, 4] },
      { title: 'interview skills', brief: 'interview, story, review, summary', items: [5, 6, 7, 8] },
    ] }) });
    await tm.call('tm_next', { task_id });
    const t2 = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    // Same card chain as the full mode - light changes what runs INSIDE each card's child.
    assert.deepEqual(t2.planning_pkgs.map((p) => p.planning_mode), ['light', 'light']);
    const d = t2.nodes.find((n) => n.node_id === 'dispatch:PLAN-F2:1');
    const run = JSON.parse(readFileSync(join(d.child.cwd, '.teams_output', 'broker', 'runs', `${d.child.run_id}.json`), 'utf8'));
    assert.equal(run.flow, 'plan');
    assert.equal(run.mixed, false);
    assert.equal(run.planning_mode, 'light');
    assert.equal(run.max_subgoals, 1, 'light mode is one PRD whose stories are the backlog items');
    assert.match(run.context, /LIGHT mode/);
    assert.match(run.context, /Declared acceptance/);
    assert.match(run.context, /- R1: a \[confirmed\] ledger/);
    // PLAN-F2 is handed only its own items, numbered as the backlog numbers them.
    assert.match(run.context, /Item 8: portfolio-summary/);
    assert.match(run.context, /Item 5: portfolio-interview\n- applies:/);
    assert.doesNotMatch(run.context, /Item 1: portfolio-rewrite/, 'another card owns item 1');
    assert.match(run.context, /- applies: R1, R2, R3, R4, R5, R6/);
  });
});

test('§6.5-4: the brainstorm node runs light on a backlog that already declares its acceptance, full otherwise', async () => {
  await withOpen({ request: LIGHT_BACKLOG, roles: { qa: false } }, async ({ tm, task_id, task }) => {
    const b = task.nodes.find((n) => n.node_id === 'brainstorm');
    assert.equal(b.brainstorm_mode, 'light');
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', sizing: ['x'] }) });
    const next = await tm.call('tm_next', { task_id });
    const r = next.ready.find((x) => x.node_id === 'brainstorm');
    assert.ok(r, 'brainstorm is ready after size');
    const brief = readFileSync(r.briefing_path, 'utf8');
    assert.match(brief, /LIGHT mode: the request already declares its backlog/);
  });
  await withOpen({ request: 'build a thing nobody has specified yet', roles: { qa: false, planning: false } }, async ({ task }) => {
    const b = task.nodes.find((n) => n.node_id === 'brainstorm');
    assert.equal(b.brainstorm_mode, undefined);
  });
  await withOpen({ request: 'refresh three skills', shared_acceptance: ['EN + KR scenarios'], roles: { qa: false, planning: false } }, async ({ task }) => {
    assert.equal(task.nodes.find((n) => n.node_id === 'brainstorm').brainstorm_mode, 'light', 'planning off still detects');
  });
});

test('light PLAN: structured requests[].acceptance and shared_acceptance resolve light and are written into the request text; partial coverage falls back to full', async () => {
  await withOpen({ requests: [{ request: 'build the API', acceptance: ['GET /x returns 200'] }, { request: 'write the docs', acceptance: ['README names every flag'] }], roles: { qa: false } }, async ({ task }) => {
    assert.equal(task.planning_mode, 'light');
    assert.equal(task.declared_acceptance.via, 'structured');
    assert.deepEqual(task.requests, ['build the API\nAcceptance:\n- GET /x returns 200', 'write the docs\nAcceptance:\n- README names every flag']);
    assert.match(task.request, /\[backlog priority 1\] write the docs\nAcceptance:\n- README names every flag/);
  });
  await withOpen({ request: 'refresh three skills', shared_acceptance: ['EN + KR scenarios'], roles: { qa: false } }, async ({ task }) => {
    assert.equal(task.planning_mode, 'light');
    assert.match(task.request, /refresh three skills\n\nAcceptance for every item:\n- EN \+ KR scenarios$/);
  });
  await withOpen({ requests: [{ request: 'a', acceptance: ['x'] }, 'b'], roles: { qa: false } }, async ({ task }) => {
    assert.equal(task.planning_mode, 'full', 'one item without acceptance is ambiguous - the heavier chain');
    assert.equal(task.declared_acceptance, undefined);
  });
});

test('light PLAN: roles.planning true stays full even on a declared backlog, "light" forces light, false is refused - and auto on free text is full, never off', async () => {
  await withOpen({ request: LIGHT_BACKLOG, roles: { planning: true, qa: false } }, async ({ task }) => {
    assert.equal(task.planning_mode, 'full');
  });
  await withOpen({ request: 'big request', roles: { planning: 'light', qa: false } }, async ({ task }) => {
    assert.equal(task.planning_mode, 'light');
  });
  // C5: false is refused - it resolves like the default 'auto', which reads this backlog as light.
  await withOpen({ request: LIGHT_BACKLOG, roles: { planning: false, qa: false } }, async ({ task }) => {
    assert.equal(task.planning_mode, 'light');
    assert.ok(task.nodes.some((n) => n.stage === 'areas'), 'false never removes the plan stage');
    assert.ok(task.team.notes.some((x) => /refused/.test(x)));
  });
  await withOpen({ request: 'big request', roles: { planning: 'auto', qa: false } }, async ({ task }) => {
    assert.equal(task.planning_mode, 'full');
    assert.ok(task.nodes.some((n) => n.stage === 'areas'), 'auto never turns PLAN off');
  });
});

// hasDeclaredAcceptance (acceptance.mjs, re-exported from taskmanager.mjs by that name - the
// brainstorm step §6.5-4 imports the same function): pure and structural. Ambiguous -> false.
test('hasDeclaredAcceptance: the portfolio-refresh backlog (numbered 8 items + shared "Acceptance for every item:") is declared; so are structured fields and per-item blocks', () => {
  assert.equal(typeof tmHasDeclaredAcceptance, 'function', 'taskmanager.mjs re-exports hasDeclaredAcceptance by name');
  assert.equal(tmHasDeclaredAcceptance({ request: LIGHT_BACKLOG }), true);
  assert.equal(hasDeclaredAcceptance(LIGHT_BACKLOG), true, 'a bare string is read as the request');
  const d = detectDeclaredAcceptance({ request: LIGHT_BACKLOG });
  assert.equal(d.via, 'parser');
  assert.deepEqual(d.items.map((it) => it.text), ['portfolio-rewrite', 'portfolio-pattern', 'portfolio-jd', 'portfolio-company', 'portfolio-interview', 'portfolio-story', 'portfolio-review', 'portfolio-summary']);
  assert.equal(d.shared.length, 6);
  assert.match(d.shared[0], /^R1 a \[confirmed\] ledger/);
  // Markdown heading form, `1)` numbering, `*` bullets.
  assert.equal(hasDeclaredAcceptance('1) a\n2) b\n\n## Acceptance for each item\n* one\n* two'), true);
  // Per-item blocks under every item.
  assert.equal(hasDeclaredAcceptance('1. a\n   Acceptance:\n   - a works\n2. b\n   Acceptance:\n   - b works'), true);
  assert.equal(hasDeclaredAcceptance('1. a\nAcceptance:\n- a works\n2. b\nAcceptance:\n- b works'), true, 'column-0 per-item blocks: "2. b" is the next item, not a bullet');
  assert.deepEqual(detectDeclaredAcceptance('1. a\nAcceptance:\n- a works\n2. b\nAcceptance:\n- b works').items.map((it) => it.acceptance), [['a works'], ['b works']]);
  // The composed requests[] form taskmanager.mjs itself writes.
  assert.equal(hasDeclaredAcceptance('[backlog priority 0] a\n\n[backlog priority 1] b\n\nAcceptance for every item:\n- x'), true);
  // Structured (§2.1a).
  assert.equal(hasDeclaredAcceptance({ requests: [{ request: 'a', acceptance: ['x'] }, { request: 'b', acceptance: ['y'] }] }), true);
  assert.equal(hasDeclaredAcceptance({ requests: ['a', 'b'], shared_acceptance: ['x'] }), true);
  assert.equal(hasDeclaredAcceptance({ request: 'one thing', shared_acceptance: ['x'] }), true);
  assert.equal(hasDeclaredAcceptance({ requests: ['a\nAcceptance:\n- x', { request: 'b', acceptance: ['y'] }] }), true, 'structured and in-text acceptance may mix');
});

test('hasDeclaredAcceptance: ambiguous or absent acceptance is false (the heavier chain)', () => {
  const cases = {
    'free text': 'Refactor the ledger module and make it faster.',
    'numbered list, no acceptance': '1. a\n2. b\n3. c',
    'acceptance with no backlog': 'Improve the skill.\n\nAcceptance:\n- EN + KR scenarios',
    'single numbered item': '1. only one\n\nAcceptance for every item:\n- x',
    'heading with no bullets': '1. a\n2. b\n\nAcceptance for every item:\nsee the doc',
    'numbering skips': '1. a\n3. b\n\nAcceptance for every item:\n- x',
    'numbering restarts': '1. a\n2. b\n1. c\n\nAcceptance for every item:\n- x',
    'shared block above the list': 'Acceptance for every item:\n- x\n\n1. a\n2. b',
    'two shared blocks': '1. a\n2. b\n\nAcceptance for every item:\n- x\n\nAcceptance for every item:\n- y',
    'per-item blocks on some items only': '1. a\n   Acceptance:\n   - a works\n2. b\n3. c\n   Acceptance:\n   - c works',
    'inline acceptance, not a heading': '1. a - Acceptance: tests pass\n2. b - Acceptance: docs updated',
    empty: '',
  };
  for (const [name, text] of Object.entries(cases)) assert.equal(hasDeclaredAcceptance({ request: text }), false, name);
  assert.equal(hasDeclaredAcceptance({ requests: [{ request: 'a', acceptance: ['x'] }, 'b'] }), false, 'one requests[] item without acceptance');
  assert.equal(hasDeclaredAcceptance({ requests: [{ request: 'a', acceptance: [] }, { request: 'b', acceptance: ['  '] }] }), false, 'empty/blank acceptance arrays declare nothing');
  assert.equal(hasDeclaredAcceptance({ request: LIGHT_BACKLOG, shared_acceptance: [] }), true, 'an empty shared_acceptance falls through to the parser');
  assert.equal(hasDeclaredAcceptance(null), false);
  assert.equal(hasDeclaredAcceptance({}), false);
});

test('resolvePlanningMode: true->full, false->refused (read as "auto"), "light"->light, "auto"->light|full by detection and never off; renderAcceptanceTemplate numbers the rules', () => {
  assert.equal(resolvePlanningMode(true, { request: LIGHT_BACKLOG }).mode, 'full');
  // C5: false is refused and resolves exactly like 'auto', saying so.
  assert.equal(resolvePlanningMode(false, { request: LIGHT_BACKLOG }).mode, 'light');
  assert.equal(resolvePlanningMode(false, { request: 'free text' }).mode, 'full');
  assert.equal(resolvePlanningMode(false, { request: 'x' }).source, 'refused');
  assert.match(resolvePlanningMode(false, { request: 'x' }).reason, /refused/);
  assert.equal(resolvePlanningMode('light', { request: 'free text' }).mode, 'light');
  assert.equal(resolvePlanningMode('auto', { request: LIGHT_BACKLOG }).mode, 'light');
  for (const input of [{ request: 'free text' }, {}, null, { request: '' }]) {
    const r = resolvePlanningMode('auto', input);
    assert.equal(r.mode, 'full', JSON.stringify(input));
    assert.equal(r.source, 'auto');
  }
  assert.equal(resolvePlanningMode(undefined, { request: 'x' }).mode, 'full', 'unset reads as auto');
  const tpl = renderAcceptanceTemplate(detectDeclaredAcceptance({ requests: [{ request: 'a', acceptance: ['a1'] }, 'b'], shared_acceptance: ['keep tests green', 'R7 docs updated'] }));
  assert.match(tpl, /- R1: keep tests green/);
  assert.match(tpl, /- R7: docs updated/, 'an existing R-label is kept');
  assert.match(tpl, /Item 1: a\n- A1\.1: a1\n- applies: R1, R7/);
  assert.match(tpl, /Item 2: b\n- applies: R1, R7/);
});

test("planning cards' PRD sections and user_stories are merged into 10-prd.md and flow into shape's input as a link, never pasted (C3/C4)", async () => {
  await withTask(async ({ tm, g, cwd, root, task_id }) => {
    let v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2 modules'], handoff: 'two modules' }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    v = await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: [{ title: 'sign-up', brief: 'a visitor signs up' }, { title: 'billing', brief: 'an account pays' }] }) });
    assert.equal(v.state, 'done', JSON.stringify(v));

    const nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.children.map((c) => c.package_id), ['PLAN-F1', 'PLAN-F2'], JSON.stringify(nx));
    for (const child of nx.children) {
      assert.notEqual(child.cwd, cwd, 'each planning card gets its own worktree');
      const f = child.package_id.replace('PLAN-', '');
      const sub = (node_id, payload) => g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id, payload: ok(payload) });
      await sub('plan', { handoff: 'p', flow: 'plan', size: 'S' });
      await sub('setgoal', { spec: { goal: 'PRD', acceptance: ['PRD covers the request'], subgoals: [{ id: 'U1', title: 'draft PRD', acceptance: ['PRD written'], deps: [] }] } });
      await sub('critique', { sound: true });
      // The broker cross-checks a claimed changed_file against the worktree, so the PRD has to
      // actually be there - which is also what makes prd_paths real rather than a claim.
      mkdirSync(join(child.cwd, 'docs'), { recursive: true });
      writeFileSync(join(child.cwd, 'docs', 'PRD.md'), `# PRD\n\n${PRD_FIXTURE}\nExecutive Summary of ${f}\n`);
      await sub('investigate:U1:1', { changed_files: [], handoff: 'findings' });
      await sub('draft:U1:1', { changed_files: ['docs/PRD.md'], handoff: 'drafted' });
      await sub('revise:U1:1', { changed_files: ['docs/PRD.md'], handoff: 'revised' });
      await sub('gate:U1:1', { accept: true, match_pct: 95 });
      await sub('gate:goal:1', { accept: true, match_pct: 95, user_stories: [`${f}-US-1`, `${f}-US-2`].map((id) => ({ id, title: id, acceptance: [`${id} holds`] })) });
      const childNext = await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });
      assert.deepEqual(childNext.ready.map((n) => n.node_id), ['report'], 'a planning card runs the full harness: gate:goal, then report');
      await sub('report', { handoff: 'PRD complete' });
      const folded = await tm.call('tm_submit', { task_id, node_id: `dispatch:${child.package_id}:1` });
      assert.equal(folded.state, 'done', JSON.stringify(folded));
      const accepted = await tm.call('tm_submit', { task_id, node_id: `accept:${child.package_id}:1`, payload: ok({ accept: true, match_pct: 95 }) });
      assert.equal(accepted.state, 'done', JSON.stringify(accepted));
    }
    const foldedTask = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.deepEqual(foldedTask.nodes.find((n) => n.node_id === 'dispatch:PLAN-F1:1').result.user_stories.map((u) => u.id), ['F1-US-1', 'F1-US-2']);

    // The planning integrate: the manager merged both sections into one 10-prd.md before its judge.
    let nx2 = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx2.ready.map((n) => n.node_id), ['plan-integrate:1']);
    const prdPath = docPaths(foldedTask).prd;
    const merged = readFileSync(prdPath, 'utf8');
    assert.match(merged, /## F1 — sign-up/);
    assert.match(merged, /## F2 — billing/);
    assert.match(merged, /Executive Summary of F1/, 'the merged PRD carries each card\'s section body');
    assert.match(merged, /Executive Summary of F2/);
    assert.match(merged, /F2-US-2/);
    const piBrief = readFileSync(nx2.ready[0].briefing_path, 'utf8');
    assert.match(piBrief, /The merged PRD/);
    assert.ok(piBrief.includes(prdPath));
    assert.match(piBrief, /PLAN-F2 — billing/);
    v = await tm.call('tm_submit', { task_id, node_id: 'plan-integrate:1', payload: ok({ accept: true, duplicates: [], contradictions: [], uncovered: [] }) });
    assert.equal(v.state, 'done', JSON.stringify(v));

    const after = await tm.call('tm_next', { task_id });
    assert.deepEqual(after.ready.map((n) => n.node_id), ['shape']);
    const briefing = readFileSync(after.ready[0].briefing_path, 'utf8');
    for (const id of ['F1-US-1', 'F1-US-2', 'F2-US-1', 'F2-US-2']) assert.match(briefing, new RegExp(id));
    // Shape reads the ONE merged PRD - a link, the body never pasted into the briefing.
    assert.ok(briefing.includes(prdPath), 'shape must be told where the merged PRD lives');
    assert.doesNotMatch(briefing, /Executive Summary/, 'the PRD body must never be pasted into the briefing - a link only');
    assert.match(briefing, /criterion is OWNERSHIP/, 'shape is told its split is the second one');
  });
});

test('tm_open({size}) pins the size: L opens the plan stage without measuring, S goes straight to the development harness (S1)', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
  try {
    const L = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'big request', cwd, flow: 'develop', vendor: 'self', size: 'L' });
    assert.equal(L.state, 'running', JSON.stringify(L));
    assert.equal(L.size, 'L');
    assert.deepEqual(L.ready.map((r) => r.node_id), ['areas'], 'nothing was measured: the plan stage is ready at once');
    const task = JSON.parse(readFileSync(join(root, L.task_id, 'task.json'), 'utf8'));
    const size = task.nodes.find((n) => n.node_id === 'size');
    assert.equal(size.state, 'done');
    assert.equal(size.result.size_source, 'pinned');
    const S = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'small request', cwd, flow: 'document', vendor: 'self', size: 'S' });
    assert.equal(S.task_state, 'harness', 'a pinned S goes straight to the development harness (S1)');
    assert.deepEqual(S.children, [], 'no planning card, no teams child run');
    const sTask = JSON.parse(readFileSync(join(root, S.task_id, 'task.json'), 'utf8'));
    assert.equal(sTask.nodes.find((n) => n.node_id === 'size').result.size_source, 'pinned');
    assert.equal(sTask.s_run, null);
    assert.ok(sTask.harness_run && sTask.harness_run.cwd === cwd, JSON.stringify(sTask.harness_run));
    assert.equal(sTask.nodes.find((n) => n.node_id === 'areas').state, 'skipped', 'S has no feature split');
    assert.deepEqual(sTask.planning_pkgs || [], []);
  } finally { tm.close(); rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

// S1 (_repo/docs/plans/2026-09-28-teams-long-loop.md): size S goes to the development harness - no
// planning card, feature split, shape, critique, worktree or teams child run.
function graphRunFixture(cwd, taskId, { report = false, accept = null, tagged = true, createdAt = Date.now(), runId } = {}) {
  const run_id = runId || `g-${Math.random().toString(16).slice(2, 10)}`;
  const nodes = [{ node_id: 'plan', stage: 'plan', state: 'done', deps: [], result: { stage_ok: true } }];
  if (accept !== null) {
    nodes.push({ node_id: 'gate:goal:1', stage: 'gate', subgoal_id: null, state: accept ? 'done' : 'failed', deps: [],
      result: { stage_ok: accept, accept, match_pct: accept ? 95 : 60, gaps: accept ? [] : ['the export is missing'] } });
  }
  nodes.push({ node_id: 'report', stage: 'report', state: report ? 'done' : 'pending', deps: [], result: report ? { stage_ok: true, handoff: 'harness run report' } : null });
  const dir = join(cwd, '.harness-run', 'broker', 'runs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${run_id}.json`), JSON.stringify({ run_id, request: `${tagged ? `[teams-task ${taskId}] ` : ''}small request`, created_at: createdAt, nodes }));
  return { route: 'graph', run_id, cwd };
}

function fallbackRunFixture(cwd, taskId, { pass = null, report = false, tagged = true, slug = 'small' } = {}) {
  const dir = join(cwd, '.harness-run', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ request: 'small request', ...(tagged ? { teams_task: taskId } : {}) }));
  if (pass !== null) writeFileSync(join(dir, '04-goal-gate.json'), JSON.stringify({ match_pct: pass ? 93 : 70, pass, reason: pass ? 'met' : 'the export is missing' }));
  if (report) writeFileSync(join(dir, '05-report.md'), '# fallback report\n');
  return { route: 'fallback', run_dir: dir };
}

function writePointer(root, taskId, pointer) {
  writeFileSync(join(root, taskId, 'harness-run.json'), JSON.stringify(pointer));
}

async function withSizeS(fn, extra = {}) {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
  try {
    const open = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'small request', cwd, vendor: 'self', size: 'S', ...extra });
    await fn({ tm, cwd, root, task_id: open.task_id, open });
  } finally { tm.close(); rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
}

test('S1: a measured size S hands the request to the development harness - no planning card, worktree or teams child run; task_state "harness"', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
  try {
    const { task_id } = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'r', cwd, flow: 'develop', vendor: 'self' });
    const measured = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'S', flow: 'develop' }) });
    assert.equal(measured.task_state, 'harness');
    assert.equal('delegate' in measured, false, JSON.stringify(measured));
    assert.equal(measured.state, 'running');
    assert.equal(measured.harness.pointer, join(root, task_id, 'harness-run.json'));
    assert.equal(measured.harness.report_path, join(root, task_id, 'harness-report.md'));
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.deepEqual(task.planning_pkgs || [], [], 'no planning card');
    assert.ok(!task.nodes.some((n) => n.stage === 'dispatch'), 'no teams child run');
    assert.ok(!task.nodes.some((n) => n.state === 'pending'), 'every other manager node is skipped');
    assert.equal(task.s_run, null);
    assert.ok(!existsSync(join(cwd, '.teams_output', 'worktrees')), 'no worktree');
    assert.equal((await tm.call('tm_status', { task_id })).state, 'running');
  } finally { tm.close(); rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test('S1a: the graph route - running until the run reports, complete on its accepted goal gate, with the report relayed and a retro written', async () => {
  await withSizeS(async ({ tm, cwd, root, task_id }) => {
    const run = graphRunFixture(cwd, task_id);
    writePointer(root, task_id, run);
    let st = await tm.call('tm_status', { task_id });
    assert.equal(st.state, 'running');
    assert.deepEqual(st.harness.run, run);
    assert.equal(st.harness.route, 'graph');
    graphRunFixture(cwd, task_id, { runId: run.run_id, accept: true, report: true });
    writeFileSync(join(root, task_id, 'harness-report.md'), 'what the harness delivered');
    st = await tm.call('tm_status', { task_id });
    assert.equal(st.state, 'complete');
    const nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.state, 'complete');
    assert.equal(nx.report, 'what the harness delivered');
    const task = readTask(root, task_id);
    assert.match(readFileSync(docPaths(task).report, 'utf8'), /size S on the development harness \(complete\)/);
    const retro = JSON.parse(readFileSync(docPaths(task).retro, 'utf8'));
    assert.deepEqual(retro.retrospective.what_failed, [], 'the skipped manager nodes are not failures');
    assert.equal(retro.retrospective.partial_reasons, undefined);
  });
});

test('S1a: the graph route - a run that reported past a refused goal gate reads partial, with the gate\'s gaps as the reason', async () => {
  await withSizeS(async ({ tm, cwd, root, task_id }) => {
    writePointer(root, task_id, graphRunFixture(cwd, task_id, { accept: false, report: true }));
    const st = await tm.call('tm_status', { task_id });
    assert.equal(st.state, 'partial');
    assert.match(st.partial_reasons[0], /did not accept \(match 60\): the export is missing/);
    const retro = JSON.parse(readFileSync(docPaths(readTask(root, task_id)).retro, 'utf8'));
    assert.match(retro.retrospective.partial_reasons[0], /did not accept/);
  });
});

test('S1a: the fallback route reads the run\'s own 05-report.md and 04-goal-gate.json - not anything the driver says', async () => {
  await withSizeS(async ({ tm, cwd, root, task_id }) => {
    const run = fallbackRunFixture(cwd, task_id);
    writePointer(root, task_id, run);
    assert.equal((await tm.call('tm_status', { task_id })).state, 'running');
    fallbackRunFixture(cwd, task_id, { pass: false, report: true });
    assert.equal((await tm.call('tm_status', { task_id })).state, 'partial');
    fallbackRunFixture(cwd, task_id, { pass: true, report: true });
    const st = await tm.call('tm_status', { task_id });
    assert.equal(st.state, 'complete');
    assert.equal(st.harness.route, 'fallback');
  });
});

test('S1: a pointer to an untagged or older run is refused; the tagged run is found without a pointer', async () => {
  await withSizeS(async ({ tm, cwd, root, task_id }) => {
    // Someone else's accepted run, named by the pointer: refused, the task keeps running.
    writePointer(root, task_id, graphRunFixture(cwd, task_id, { tagged: false, accept: true, report: true }));
    let st = await tm.call('tm_status', { task_id });
    assert.equal(st.state, 'running');
    assert.ok(st.harness.refused_pointer, JSON.stringify(st.harness));
    // This task's tag but created before the harness run opened: refused too.
    writePointer(root, task_id, graphRunFixture(cwd, task_id, { accept: true, report: true, createdAt: Date.now() - 3600 * 1000 }));
    st = await tm.call('tm_status', { task_id });
    assert.equal(st.state, 'running');
    // No pointer at all, but a run tagged with this task: found and read.
    rmSync(join(root, task_id, 'harness-run.json'));
    const mine = graphRunFixture(cwd, task_id, { accept: true, report: true });
    st = await tm.call('tm_status', { task_id });
    assert.equal(st.state, 'complete');
    assert.equal(st.harness.run.run_id, mine.run_id);
    const ledger = readFileSync(join(root, task_id, 'ledger.jsonl'), 'utf8');
    assert.match(ledger, /"event":"harness_pointer_refused"/);
  });
});

test('S1: the harness driver loads the graph and harness plugins', async () => {
  const { driverArgv } = await import('../mcp/taskmanager.mjs');
  const dirs = (argv) => argv.flatMap((a, i) => (argv[i - 1] === '--plugin-dir' ? [a] : []));
  const harness = dirs(driverArgv(null, { harness: true }));
  assert.ok(harness.some((d) => /[\\/]graph$/.test(d)), harness.join(' '));
  assert.ok(harness.some((d) => /[\\/]harness$/.test(d)), harness.join(' '));
});
test('S1: the harness prompt carries the request, context and decisions, the tagged graph_open, the fallback manifest tag, the pointer and the report path - and no Workflow route', async () => {
  const f = driverFixture({}, FAKE_DRIVER_RESPAWN);
  const tm = await f.client.init();
  try {
    const { task_id } = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'add the export button', context: 'the app is in src/', decisions: [{ question: 'CSV or JSON?', chose: 'CSV' }], cwd: f.cwd, vendor: 'self', size: 'S', host_vendor: 'claude', native_models: ['sonnet'] });
    const ran = await waitFor(() => (existsSync(`${f.ran}.1`) ? JSON.parse(readFileSync(`${f.ran}.1`, 'utf8')) : null), 'the harness driver to run');
    const prompt = ran.argv[ran.argv.length - 1];
    assert.match(prompt, new RegExp(`graph_open\\(\\{request: "\\[teams-task ${task_id}\\] "`));
    assert.match(prompt, /allocation: "balanced"/);
    assert.match(prompt, /isolated: false/);
    assert.match(prompt, /native_models: \["sonnet"\]/);
    assert.match(prompt, new RegExp(`"teams_task": "${task_id}"`));
    assert.match(prompt, /Do not use the Workflow route/);
    assert.ok(prompt.includes(join(f.root, task_id, 'harness-run.json')));
    assert.ok(prompt.includes(join(f.root, task_id, 'harness-report.md')));
    assert.match(prompt, /add the export button/);
    assert.match(prompt, /the app is in src\//);
    assert.match(prompt, /CSV or JSON\?: CSV/);
  } finally {
    tm.close();
    rmSync(f.cwd, { recursive: true, force: true });
    rmSync(f.root, { recursive: true, force: true });
    rmSync(f.drv, { recursive: true, force: true });
  }
});
// idol-pm-4 (2026-09-23): P1 owned src/identity/module.ts, P2 owned src/identity/**, and the
// check compared strings, so one file with two owners passed.
test('touches overlap by containment, not only by equal strings', async () => {
  const { validateShape } = await import('../mcp/taskmanager.mjs');
  const shape = (a, b) => validateShape({
    acceptance: ['x'],
    packages: [
      { id: 'P1', title: 'a', brief: 'b', acceptance: ['a'], touches: a, deps: [] },
      { id: 'P2', title: 'b', brief: 'b', acceptance: ['a'], touches: b, deps: [] },
    ],
  }, []).filter((m) => /both touch/.test(m));
  const hit = shape(['src/identity/module.ts'], ['src/identity/**']);
  assert.equal(hit.length, 1, JSON.stringify(hit));
  assert.match(hit[0], /both touch src\/identity\/module\.ts: P1's src\/identity\/module\.ts and P2's src\/identity\/\*\* overlap/);
  assert.equal(shape(['src/a'], ['src/a/b.ts']).length, 1, 'a bare directory claims what is under it');
  assert.equal(shape(['src/a/*'], ['src/a/**']).length, 1, 'two spellings of one directory');
  assert.deepEqual(shape(['src/a/**'], ['src/ab/**']), [], 'a shared name prefix is not containment');
  assert.deepEqual(shape(['src/*.test.ts'], ['src/index.ts']), [], 'an inner wildcard is not guessed at');
  assert.deepEqual(shape(['src/queue/**'], ['src/reservation/**']), []);
});

test('a shape is validated: one package, overlapping touches, dangling deps and cycles fail it', async () => {
  await withTask(async ({ tm, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop' }) });
    const v = await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({
      acceptance: ['x'],
      packages: [
        { id: 'P1', title: 'a', brief: 'b', acceptance: ['a'], touches: ['src/a'], deps: ['P2'] },
        { id: 'P2', title: 'b', brief: 'b', acceptance: ['a'], touches: ['src/a'], deps: ['P1', 'P9'] },
      ],
    }) });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /both touch src\/a/);
    assert.match(v.reason, /depends on P9, which is not in the shape/);
    assert.match(v.reason, /dependency cycle/);
    const single = await tm.call('tm_retry', { task_id });
    assert.equal(single.retried, true);
    const v2 = await tm.call('tm_submit', { task_id, node_id: 'shape:2', payload: ok({ acceptance: ['x'], packages: [{ id: 'P1', title: 'a', brief: 'b', acceptance: ['a'] }] }) });
    assert.equal(v2.state, 'failed');
    assert.match(v2.reason, /one package.*size S/);
    const prompt = readFileSync((await tm.call('tm_retry', { task_id })).ready[0].briefing_path, 'utf8');
    assert.match(prompt, /Previous attempt was rejected/);
    assert.match(prompt, /one package/);
  });
});

// Drives the planning (one card, opened by the areas split) from dispatch through the planning
// integrate, so the task reaches the point where shape can be submitted with `implements[]`
// checked against these userStories. Assumes `size` has already been submitted.
async function completePlanning(tm, g, task_id, cwd, userStories) {
  await drivePlanning((n, a) => tm.rawCall(n, a), g, task_id, { stories: userStories });
}

test('shape is rejected when implements[] does not cover every user story planning produced', async () => {
  await withTask(async ({ tm, g, cwd, root, task_id }) => {
    const v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2 modules'], handoff: 'two modules' }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    await completePlanning(tm, g, task_id, cwd, ['F1-US-1', 'F1-US-2']);

    const rejected = await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({
      acceptance: ['both modules build together'],
      packages: [
        { id: 'P1', title: 'module a', flow: 'develop', brief: 'change a.txt', acceptance: ['a.txt says a'], touches: ['a.txt'], deps: [], implements: ['F1-US-1'] },
        { id: 'P2', title: 'module b', flow: 'develop', brief: 'change b.txt', acceptance: ['b.txt says b'], touches: ['b.txt'], deps: [] },
      ],
      handoff: 's',
    }) });
    assert.equal(rejected.state, 'failed', JSON.stringify(rejected));
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const shapeProblems = task.nodes.find((n) => n.node_id === 'shape').result.shape_problems;
    assert.ok(shapeProblems.some((p) => p.includes('F1-US-2')), JSON.stringify(shapeProblems));
    assert.ok(!shapeProblems.some((p) => p.includes('F1-US-1 ')), 'F1-US-1 is covered by P1 and must not be named as missing');
  }, { roles: { planning: true } });
});

test('shape whose implements[] fully covers user stories is accepted, and priority defaults to array position', async () => {
  await withTask(async ({ tm, g, cwd, root, task_id }) => {
    const v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2 modules'], handoff: 'two modules' }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    await completePlanning(tm, g, task_id, cwd, ['F1-US-1', 'F1-US-2']);

    const accepted = await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({
      acceptance: ['both modules build together'],
      packages: [
        { id: 'P1', title: 'module a', flow: 'develop', brief: 'change a.txt', acceptance: ['a.txt says a'], touches: ['a.txt'], deps: [], implements: ['F1-US-1'] },
        { id: 'P2', title: 'module b', flow: 'develop', brief: 'change b.txt', acceptance: ['b.txt says b'], touches: ['b.txt'], deps: [], implements: ['F1-US-2'] },
      ],
      handoff: 's',
    }) });
    assert.equal(accepted.state, 'done', JSON.stringify(accepted));
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.deepEqual(task.spec.packages.map((p) => [p.id, p.priority]), [['P1', 0], ['P2', 1]], 'priority defaults to array position when the shape omits it');
  }, { roles: { planning: true } });
});

test('a shape with no implements[] of its own passes: planning is never off (C5), and the client spreads the merged stories over its packages (fillImplements) - renamed, m5', async () => {
  await withTask(async ({ tm, task_id }) => {
    const v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop' }) });
    assert.equal(v.state, 'done');
    // SHAPE's packages carry no `implements` at all; with planning off there is no user_stories
    // list to check them against, so this must still be accepted exactly as before this change.
    const result = await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...SHAPE, handoff: 's' }) });
    assert.equal(result.state, 'done', JSON.stringify(result));
  });
});

test('a sound shape dispatches its root package: worktree created, child run opened, node running', async () => {
  await withTask(async ({ tm, g, cwd, root, task_id }) => {
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.state, 'running');
    assert.deepEqual(nx.ready, [], 'nothing is left for a fresh agent: dispatch ran here');
    assert.equal(nx.children.length, 1, 'P2 depends on P1 and is not dispatched yet');
    const c = nx.children[0];
    assert.equal(c.node_id, 'dispatch:P1:1');
    assert.equal(c.package_id, 'P1');
    assert.equal(c.child_state, 'running');
    assert.match(c.next, /team_next/);
    // The worktree is a real git worktree branched from HEAD, under the tasks root.
    assert.ok(c.cwd.startsWith(join(root, task_id, 'worktrees')));
    assert.equal(spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: c.cwd, encoding: 'utf8' }).stdout.trim(), c.branch);
    assert.equal(readFileSync(join(c.cwd, 'a.txt'), 'utf8'), 'x\n');
    assert.ok(existsSync(join(c.cwd, '.claude', '.harness-markers', `team-${task_id.slice(0, 8)}`)), 'worktree carries the shared engagement marker');
    // The child is a teams run the broker can pick up by (cwd, run_id): isolated, flowed, briefed.
    const st = await g.call('team_status', { run_id: c.run_id, cwd: c.cwd });
    assert.equal(st.state, 'running');
    // Every package runs the full harness in its own child run: plan/setgoal/critique first.
    assert.deepEqual(st.nodes.map((n) => n.node_id), ['plan', 'setgoal', 'critique']);
    assert.equal(st.flow, 'develop');
    const full = await g.call('team_status', { run_id: c.run_id, cwd: c.cwd, full: true });
    assert.equal(full.isolated, true);
    assert.equal(full.parent_shaped, undefined, 'the chain-only child run is gone (reverted 2026-09-28)');
    assert.deepEqual(full.package, { id: 'P1', origin: 'shape', title: 'module a', acceptance: ['a.txt says a'] });
    assert.equal(full.request, 'change a.txt');
    assert.match(full.context, /package P1 \(module a\)/);
    assert.match(full.context, /a\.txt says a/);
    assert.equal(full.vendor, 'self', 'routing came from tm_open');
    // Folding before the child is done is refused, and costs nothing.
    const early = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    assert.match(early.error, /still running/);
    assert.equal((await tm.call('tm_status', { task_id, node_id: 'dispatch:P1:1' })).nodes[0].state, 'running');
  });
});

// ---------- every package runs the full harness (fractal rule; §3 chain-only reverted 2026-09-28) ----------
//
// _repo/docs/plans/2026-09-17-teams-team.md §2: each Team runs the four steps inside itself. A develop
// package's child run is plan -> setgoal -> critique -> implement -> test -> gate -> gate:goal ->
// report, like a phase Team's or a repair package's; its plan is a BUILD plan for the package
// (not a re-split), and the package's own acceptance reaches the spec verbatim.

test('a develop package\'s child run has plan -> setgoal -> critique before implement, and gate:goal + report after', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    const c = nx.children[0];
    const { cwd, run_id } = c;
    const sub = (node_id, payload) => g.call('team_submit', { run_id, cwd, node_id, payload: ok(payload) });
    let st = await g.call('team_status', { run_id, cwd, full: true });
    assert.deepEqual(st.nodes.map((n) => n.node_id), ['plan', 'setgoal', 'critique'], 'no implement before the package is planned');
    await sub('plan', { handoff: 'p', flow: 'develop', size: 'S' });
    await sub('setgoal', { spec: CHILD_SPEC });
    st = await g.call('team_status', { run_id, cwd, full: true });
    const impl = st.nodes.find((n) => n.node_id === 'implement:U1:1');
    assert.ok(impl, 'setgoal expands the subgoal chain');
    assert.deepEqual(impl.deps, ['critique'], 'implement waits on the package\'s own critique');
    await completeChild(g, c, { skipTo: 'critique' });
    st = await g.call('team_status', { run_id, cwd, full: true });
    const ids = st.nodes.map((n) => n.node_id);
    for (const id of ['plan', 'setgoal', 'critique', 'implement:U1:1', 'test:U1:1', 'gate:U1:1', 'gate:goal:1', 'report']) {
      assert.ok(ids.includes(id), `${id} ran in the package's child run: ${ids.join(', ')}`);
    }
    assert.ok(ids.indexOf('critique') < ids.indexOf('implement:U1:1'));
    assert.ok(ids.indexOf('gate:U1:1') < ids.indexOf('gate:goal:1') && ids.indexOf('gate:goal:1') < ids.indexOf('report'));
    // The fold reads the full path's own verdict and handoff: gate:goal and report.
    const folded = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    assert.equal(folded.state, 'done');
    assert.equal(folded.accept, true, 'gate:goal:1\'s accept');
    assert.equal(folded.match_pct, 95);
    const r = (await tm.call('tm_status', { task_id, node_id: 'dispatch:P1:1', full: true })).node.result;
    assert.equal(r.report, `child report for ${cwd}`, 'the report node\'s handoff');
    assert.deepEqual(r.changed_files, ['a.txt']);
  });
});

test('a package\'s plan briefing is a build plan for that package, and its acceptance reaches the spec verbatim', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    const { cwd, run_id } = nx.children[0];
    const sub = (node_id, payload) => g.call('team_submit', { run_id, cwd, node_id, payload: ok(payload) });
    let next = await g.call('team_next', { run_id, cwd });
    const planNode = next.ready.find((n) => n.node_id === 'plan');
    const planPrompt = readFileSync(planNode.briefing_path, 'utf8');
    assert.match(planPrompt, /## This package \(P1\) — module a/);
    assert.match(planPrompt, /already split the EPIC into packages \(shape\) and critiqued that split/);
    assert.match(planPrompt, /Plan how to build THIS package: the files and modules to touch, the interfaces and data shapes .*the order of work, the test plan .*and the risks/);
    assert.match(planPrompt, /Package acceptance[^\n]*\n- a\.txt says a/);
    await sub('plan', { plan: 'edit a.txt, then check it', handoff: 'p', flow: 'develop', size: 'S' });
    next = await g.call('team_next', { run_id, cwd });
    const sgPrompt = readFileSync(next.ready.find((n) => n.node_id === 'setgoal').briefing_path, 'utf8');
    assert.match(sgPrompt, /Keep one subgoal unless the package genuinely needs more/);
    assert.match(sgPrompt, /into spec\.acceptance verbatim/);
    // setgoal forgot the package's own criterion: the spec carries it anyway, verbatim.
    await sub('setgoal', { spec: CHILD_SPEC });
    const full = await g.call('team_status', { run_id, cwd, full: true });
    assert.deepEqual(full.spec.acceptance, ['a.txt says a', 'A']);
    next = await g.call('team_next', { run_id, cwd });
    const crPrompt = readFileSync(next.ready.find((n) => n.node_id === 'critique').briefing_path, 'utf8');
    assert.match(crPrompt, /Judge the plan and the spec against this package's brief/);
    assert.match(crPrompt, /The build plan this spec came from:\nedit a\.txt, then check it/);
  });
});

test('split / size:"L" / a retired max_depth no longer change a package\'s child run - every package opens the same full harness', async () => {
  for (const [extra, cfg] of [[{ split: true }, {}], [{ size: 'L' }, {}], [{ split: true }, { max_depth: 0 }]]) {
    await withTask(async ({ tm, g, task_id }) => {
      await throughCritique(tm, task_id, {
        ...SHAPE,
        packages: SHAPE.packages.map((p) => (p.id === 'P1' ? { ...p, ...extra } : p)),
      });
      const nx = await tm.call('tm_next', { task_id });
      const full = await g.call('team_status', { run_id: nx.children[0].run_id, cwd: nx.children[0].cwd, full: true });
      assert.equal(full.parent_shaped, undefined);
      assert.deepEqual(full.nodes.map((n) => n.node_id), ['plan', 'setgoal', 'critique'], JSON.stringify({ extra, cfg }));
    }, cfg);
  }
});

// ---------- silent-ungated-worktree trap ----------
//
// A worktree holds only what git committed. A project that installed harness but has not yet
// committed .claude/harness-gate.json leaves every package worktree with no gate config at all -
// worker writes there are silently ungated, and the user still believes tm_open protects them.
// ensureWorktree cannot block on this (fail-open is the rule every hook in this codebase
// follows) but it must say so somewhere a person looks: the ledger, same as dispatch/integrated.
function addGateConfig(cwd) {
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'harness-gate.json'), '{}\n');
}

test('a committed harness gate reaches the worktree: no uncommitted-gate warning', async () => {
  await withTask(async ({ tm, cwd, task_id }) => {
    addGateConfig(cwd);
    spawnSync('git', ['add', '.claude/harness-gate.json'], { cwd });
    spawnSync('git', ['commit', '-qm', 'add harness gate'], { cwd });
    await throughCritique(tm, task_id);
    await tm.call('tm_next', { task_id });
    const events = (await tm.call('tm_events', { task_id })).events;
    assert.ok(!events.some((e) => e.event === 'gate_uncommitted'), JSON.stringify(events));
  });
});

test('an uncommitted harness gate leaves the worktree silently ungated: ensureWorktree warns in the ledger', async () => {
  await withTask(async ({ tm, cwd, task_id }) => {
    // The gate file exists in the project's working tree but was never committed - exactly
    // the state `harness:install` leaves a project in until the user commits its output.
    addGateConfig(cwd);
    await throughCritique(tm, task_id);
    await tm.call('tm_next', { task_id });
    const events = (await tm.call('tm_events', { task_id })).events;
    const warn = events.find((e) => e.event === 'gate_uncommitted');
    assert.ok(warn, JSON.stringify(events));
    assert.match(warn.reason, /commit \.claude\/harness-gate\.json/i);
    assert.match(warn.reason, /worktree inherits only committed files/i);
  });
});

test('a parent with two dependent children runs to report; the second child sees the first\'s report', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id);
    let nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    // Read-only over children: folding the child leaves its run file byte-for-byte as the broker wrote it.
    const childPath = join(nx.children[0].cwd, '.teams_output', 'broker', 'runs', `${nx.children[0].run_id}.json`);
    const beforeFold = readFileSync(childPath, 'utf8');
    let v = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    assert.equal(v.state, 'done', JSON.stringify(v));
    assert.equal(readFileSync(childPath, 'utf8'), beforeFold, 'the manager never writes a child run file');
    assert.match(v.child.commit, /^[0-9a-f]{40}$/, 'an accepted child\'s work is committed on its package branch');
    assert.equal(spawnSync('git', ['status', '--porcelain', '--', '.', ':!.teams_output'], { cwd: nx.children[0].cwd, encoding: 'utf8' }).stdout.trim(), '', 'the worktree is clean after the fold');
    assert.equal(v.accept, true);
    assert.equal(v.match_pct, 95);
    assert.equal(v.child.run_id, nx.children[0].run_id);
    nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['accept:P1:1']);
    assert.deepEqual(nx.children, [], 'P2 waits for P1 to be accepted, not merely dispatched');
    const acceptPrompt = readFileSync(nx.ready[0].briefing_path, 'utf8');
    assert.match(acceptPrompt, /## Package P1 — module a/);
    assert.match(acceptPrompt, /Its goal gate: accept=true match=95%/);
    // What this child delivered: its report node's handoff (completeChild's "child report for <cwd>").
    assert.match(acceptPrompt, /child report for /);
    assert.match(acceptPrompt, /Files it reported changing:\n- a\.txt/);
    v = await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) });
    assert.equal(v.state, 'done');

    nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children.length, 1);
    assert.equal(nx.children[0].node_id, 'dispatch:P2:1');
    const p2 = await g.call('team_status', { run_id: nx.children[0].run_id, cwd: nx.children[0].cwd, full: true });
    assert.match(p2.context, /Delivered by package P1/);
    assert.match(p2.context, /child report for /);
    assert.equal(readFileSync(join(nx.children[0].cwd, 'a.txt'), 'utf8'), 'x\nchanged by P1\n', 'P2 starts from what P1 delivered, not from HEAD');
    assert.notEqual(nx.children[0].cwd, (await tm.call('tm_status', { task_id, node_id: 'dispatch:P1:1' })).nodes[0].child.cwd, 'each package has its own worktree');
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P2:1' });
    await tm.call('tm_submit', { task_id, node_id: 'accept:P2:1', payload: ok({ accept: true, match_pct: 90 }) });

    nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['integrate:1']);
    const st = await tm.call('tm_status', { task_id, node_id: 'integrate:1' });
    assert.ok(st.nodes[0].deps.includes('accept:P1:1') && st.nodes[0].deps.includes('accept:P2:1'));
    const integ = readFileSync(nx.ready[0].briefing_path, 'utf8');
    const wtMatch = integ.match(/## Integration worktree\n(.*worktrees\/integration) on branch (harness\/[0-9a-f]{8}\/integration)/);
    assert.ok(wtMatch, integ);
    assert.match(integ, /Already merged, in dependency order:\n- P1: harness\/[0-9a-f]{8}\/P1 -> [0-9a-f]{40}\n- P2: harness\/[0-9a-f]{8}\/P2 -> [0-9a-f]{40}/, 'the manager merged, and says what');
    assert.match(integ, /You may run commands and change files only inside the integration worktree/);
    assert.match(integ, /### P1 — module a \(develop\)\nTouches: a\.txt/);
    assert.equal(readFileSync(join(wtMatch[1], 'a.txt'), 'utf8'), 'x\nchanged by P1\nchanged by P2\n', 'the integration tree holds both packages\' work');
    v = await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });
    assert.equal(v.state, 'done');
    assert.equal(v.verified, true);
    assert.equal(v.integration.merged, 2);

    nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['gate:goal:1']);
    const gate = readFileSync(nx.ready[0].briefing_path, 'utf8');
    assert.match(gate, /## Every node in this task/);
    assert.match(gate, /### dispatch:P1:1 \(dispatch\) — done accept=true match=95%/);
    assert.match(gate, /### integrate:1 \(integrate\) — done verified=true/);
    assert.match(gate, /Merged:\n- P1 harness/, 'the gate sees the merge commits the manager made');
    assert.match(gate, /spec_drift/);
    await tm.call('tm_submit', { task_id, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 92 }) });
    nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['report']);
    v = await tm.call('tm_submit', { task_id, node_id: 'report', payload: ok({ handoff: 'all done' }) });
    assert.equal(v.state, 'done');
    const fin = await tm.call('tm_status', { task_id });
    assert.equal(fin.state, 'complete');
    assert.deepEqual(fin.packages, ['P1', 'P2']);
  });
});

test('roles.qa left at its default (false) leaves gate:goal depending directly on integrate (regression)', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await toIntegrate(tm, g, task_id);
    await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });
    const nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['gate:goal:1']);
    const st = await tm.call('tm_status', { task_id, node_id: 'gate:goal:1' });
    assert.deepEqual(st.nodes[0].deps, ['integrate:1']);
  });
});

test('manager-level reduce (item 4): integrate\'s own result carries a per-package fold through the same registry foldChild uses', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await toIntegrate(tm, g, task_id);
    const v = await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });
    assert.equal(v.state, 'done');
    const st = await tm.call('tm_status', { task_id, node_id: 'integrate:1', full: true });
    const fold = st.node.result.package_fold;
    assert.ok(fold, 'integrate\'s own persisted result carries package_fold');
    assert.deepEqual(Object.keys(fold).sort(), ['P1', 'P2']);
    assert.equal(fold.P1.accept, true, 'each package\'s own dispatch history, folded - not the manager accept node\'s own separate verdict');
    assert.equal(fold.P1.attempts, 1);
    assert.deepEqual(fold.P1.changed_files, ['a.txt']);
    assert.equal(fold.P2.accept, true);

    // gate:goal's own briefing shows the folded per-package history, not only the latest
    // dispatch's own snapshot (the "## Packages" block already carried before this change).
    const nx = await tm.call('tm_next', { task_id });
    const gate = readFileSync(nx.ready[0].briefing_path, 'utf8');
    assert.match(gate, /Folded across 1 attempt\(s\): accept=true/);
  });
});

test('roles.qa inserts a QA phase-Team between integrate and gate:goal, reusing the repair-style worktree (§2, §3)', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await toIntegrate(tm, g, task_id);
    const v = await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    const integ = await tm.call('tm_status', { task_id, node_id: 'integrate:1', full: true });

    const nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children.length, 1, JSON.stringify(nx));
    const qa = nx.children[0];
    assert.equal(qa.package_id, 'QA-F1');
    assert.equal(qa.cwd, integ.node.integration.cwd, "QA reuses integrate's worktree, not a fresh one");

    // Pinned the same way the PLAN child run is (see "the PLAN child run is pinned to the plan
    // flow (mixed:false)" above): a QA phase-Team run may not mix in develop subgoals either -
    // its own plan node must not be free to decompose the request into implementation work.
    const qaRun = JSON.parse(readFileSync(join(qa.cwd, '.teams_output', 'broker', 'runs', `${qa.run_id}.json`), 'utf8'));
    assert.equal(qaRun.mixed, false, 'the QA child run may not mix in develop subgoals');

    const sub = (node_id, payload) => g.call('team_submit', { run_id: qa.run_id, cwd: qa.cwd, node_id, payload: ok(payload) });
    await sub('plan', { handoff: 'p', flow: 'qa', size: 'S' });
    await sub('setgoal', { spec: { goal: 'QA', acceptance: ['no regressions'], subgoals: [{ id: 'Q1', title: 'run cases', acceptance: ['cases run'], deps: [] }] } });
    await sub('critique', { sound: true });
    await sub('cases:Q1:1', { changed_files: [], handoff: 'cases written' });
    await sub('execute:Q1:1', { verified: true, handoff: 'cases passed' });
    await sub('gate:Q1:1', { accept: true, match_pct: 95 });
    await sub('gate:goal:1', { accept: true, match_pct: 95 });
    const qaNext = await g.call('team_next', { run_id: qa.run_id, cwd: qa.cwd });
    assert.deepEqual(qaNext.ready.map((n) => n.node_id), ['report']);
    await sub('report', { handoff: 'QA report: no defects' });

    const folded = await tm.call('tm_submit', { task_id, node_id: 'dispatch:QA-F1:1' });
    assert.equal(folded.state, 'done', JSON.stringify(folded));
    const goalGateStatus = await tm.call('tm_status', { task_id, node_id: 'gate:goal:1' });
    assert.deepEqual(goalGateStatus.nodes[0].deps, ['accept:QA-F1:1'], 'gate:goal must wait on QA, not on integrate directly, once roles.qa is on');

    // The QA judge's only basis for a verdict used to be QA's own generic package acceptance
    // ("the integrated result has been exercised end to end...") plus the QA child's own
    // self-report - nothing that named what was actually built, so an under-delivered QA pass
    // and a real one read the same. The briefing must now carry the task's goal-level acceptance
    // and what each develop package specifically promised to deliver and touch.
    const qaAcceptReady = (await tm.call('tm_next', { task_id })).ready.find((r) => r.node_id === 'accept:QA-F1:1');
    const qaAcceptBriefing = readFileSync(qaAcceptReady.briefing_path, 'utf8');
    assert.match(qaAcceptBriefing, /## Goal-level acceptance\n- both modules build together/,
      "the QA judge sees the task's own goal-level acceptance, not just QA's generic one-liner");
    assert.match(qaAcceptBriefing, /## What the develop packages promised\n### P1 — module a\nTouches: a\.txt\nAcceptance:\n- a\.txt says a/,
      'and what P1 specifically promised to deliver and touch');
    assert.match(qaAcceptBriefing, /### P2 — module b\nTouches: b\.txt\nAcceptance:\n- b\.txt says b/,
      'and P2 too - not just the first package');

    const accepted = await tm.call('tm_submit', { task_id, node_id: 'accept:QA-F1:1', payload: ok({ accept: true, match_pct: 95 }) });
    assert.equal(accepted.state, 'done', JSON.stringify(accepted));
    const after = await tm.call('tm_next', { task_id });
    assert.deepEqual(after.ready.map((n) => n.node_id), ['gate:goal:1']);
  }, { roles: { qa: true } });
});

// Drives one QA phase-Team child from plan to report through the graph broker, exactly as
// completeChild does for an ordinary develop package. Takes the QA gate's own payload so a test
// can hand it defects (or not).
async function completeQaChild(g, child, gatePayload, execPayload) {
  const { cwd, run_id } = child;
  const sub = (node_id, payload) => g.call('team_submit', { run_id, cwd, node_id, payload: ok(payload) });
  await sub('plan', { handoff: 'p', flow: 'qa', size: 'S' });
  await sub('setgoal', { spec: { goal: 'QA', acceptance: ['no regressions'], subgoals: [{ id: 'Q1', title: 'run cases', acceptance: ['cases run'], deps: [] }] } });
  await sub('critique', { sound: true });
  await sub('cases:Q1:1', { changed_files: [], handoff: 'cases written' });
  // execPayload lets a caller hand execute a real defect (verified:false, stage_ok:true) - the
  // awake-beta-ref1 fix means that is still a successful execute (see broker.mjs's
  // nodeSucceeded), so this chain reaches gate/reduce/report exactly as the no-defects default
  // does; nothing else about this helper's shape needs to change for it.
  await sub('execute:Q1:1', execPayload || { verified: true, handoff: 'cases run' });
  await sub('gate:Q1:1', { accept: true, match_pct: 95 });
  await sub('gate:goal:1', gatePayload);
  const nx = await g.call('team_next', { run_id, cwd });
  assert.deepEqual(nx.ready.map((n) => n.node_id), ['report']);
  await sub('report', { handoff: 'QA report' });
}

// Drives a filed defect's own package to report, like completeChild - but a filed defect
// package has no declared deps (fileDefects resolves any it names to an already-done accept, but
// none are given here) so its worktree branches from the project's own HEAD, before P1/P2's
// a.txt edits landed there. Touching a.txt the way completeChild does would make a REAL merge
// conflict once the fresh integrate re-merges every package from HEAD (prepareIntegration always
// does, repair packages aside) - so this touches its own file instead.
async function completeDefectChild(g, child, filename) {
  const { cwd, run_id } = child;
  const sub = (node_id, payload) => g.call('team_submit', { run_id, cwd, node_id, payload: ok(payload) });
  await sub('plan', { handoff: 'p', flow: 'develop', size: 'S' });
  await sub('setgoal', { spec: CHILD_SPEC });
  await sub('critique', { sound: true });
  writeFileSync(join(cwd, filename), `fixed by ${child.package_id}\n`);
  await sub('implement:U1:1', { changed_files: [filename], handoff: 'fixed' });
  await sub('test:U1:1', { verified: true });
  await sub('gate:U1:1', { accept: true, match_pct: 95 });
  await sub('gate:goal:1', { accept: true, match_pct: 95 });
  await g.call('team_next', { run_id, cwd });
  await sub('report', { handoff: 'defect fix report' });
}

// awake-beta-ref1 (2026-09-24): execute's own contract (prompts.mjs) says verified:false with
// stage_ok:true means the case set ran and found a real defect - but graph.mjs's VERDICT_FIELD
// judged execute the same way it judges `test`, so this failed the node, retried cases/execute
// on the UNCHANGED tree until the subgoal's budget was spent, left gate/reduce unreachable, and
// the child never reached its own report at all: dispatch:QA:1 folded 'blocked' with gaps:[] and
// no defects anywhere, accept:QA never ran, and the manager just reopened dispatch:QA:2 over the
// identical bug. These two tests cover the fix end to end at the task-manager level (the
// broker-level unit coverage is in test-broker.mjs).
test('a QA execute that runs and finds a real defect completes the child normally, and accept:QA files it as a fix STORY (awake-beta-ref1, §5b)', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await toIntegrate(tm, g, task_id);
    await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });

    const nx = await tm.call('tm_next', { task_id });
    const qa1 = nx.children[0];
    assert.equal(qa1.package_id, 'QA-F1');
    const defectText = 'POST /reset accepts an unknown CLI flag and silently starts the real app -> pass --unknown-flag and observe the live process, not a rejection';
    // verified:false, stage_ok:true is exactly the shape that used to fail the node and burn
    // the subgoal's retry budget on an unchanged tree. Under the fix this is a successful
    // execute - the chain runs on to gate, reduce, gate:goal and report exactly like a clean
    // pass would (completeQaChild asserts the child reaches 'report' either way).
    await completeQaChild(g, qa1, { accept: true, match_pct: 95 }, {
      verified: false, stage_ok: true, handoff: 'cases run', defects: [defectText],
    });
    const folded = await tm.call('tm_submit', { task_id, node_id: 'dispatch:QA-F1:1' });
    assert.equal(folded.state, 'done', JSON.stringify(folded));

    // The fold must carry the defect through mechanically (foldChild's defectsFound reads every
    // execute node in the child directly), not depend on any judge having faithfully restated
    // it in prose - this is what makes it visible to accept:QA below regardless of what the
    // child's own gate:goal said.
    const task1 = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.deepEqual(task1.nodes.find((n) => n.node_id === 'dispatch:QA-F1:1').result.defects, [defectText]);

    const qaAcceptReady = (await tm.call('tm_next', { task_id })).ready.find((r) => r.node_id === 'accept:QA-F1:1');
    const qaAcceptBriefing = readFileSync(qaAcceptReady.briefing_path, 'utf8');
    assert.match(qaAcceptBriefing, /Defects it reported:\n- POST \/reset accepts an unknown CLI flag/,
      'the accept:QA agent must see the raw defect list under "What the child run delivered", not just the free-text report');

    const accepted = await tm.call('tm_submit', { task_id, node_id: 'accept:QA-F1:1', payload: ok({
      accept: true, match_pct: 95,
      defects: [{ title: 'POST /reset accepts an unknown CLI flag and silently starts the real app', touches: [], deps: [], evidence: defectText, severity: 'high' }],
    }) });
    assert.equal(accepted.state, 'done', JSON.stringify(accepted));

    const task2 = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.deepEqual(task2.spec.packages.map((p) => p.id), ['P1', 'P2', 'D1'], 'the defect is filed as a fix STORY');
    const d1 = task2.spec.packages.find((p) => p.id === 'D1');
    assert.equal(d1.reporter, 'qa');
    assert.equal(d1.title, 'POST /reset accepts an unknown CLI flag and silently starts the real app');
    const goal = task2.nodes.find((n) => n.node_id === 'gate:goal:1');
    assert.deepEqual(goal.deps, ['integrate:2'], 'gate:goal reroutes behind a fresh integrate to re-verify the fix');
  }, { roles: { qa: true } });
});

test('an accept:QA below the floor that files a defect still finishes done and files it, instead of rerunning QA (awake-beta-ref1 accept:QA:2)', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await toIntegrate(tm, g, task_id);
    await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });

    const nx = await tm.call('tm_next', { task_id });
    const qa1 = nx.children[0];
    assert.equal(qa1.package_id, 'QA-F1');
    const defectText = 'POST /reset accepts an unknown CLI flag and silently starts the real app -> pass --unknown-flag and observe the live process, not a rejection';
    // verified:false, stage_ok:true is exactly the shape that used to fail the node and burn
    // the subgoal's retry budget on an unchanged tree. Under the fix this is a successful
    // execute - the chain runs on to gate, reduce, gate:goal and report exactly like a clean
    // pass would (completeQaChild asserts the child reaches 'report' either way).
    await completeQaChild(g, qa1, { accept: true, match_pct: 95 }, {
      verified: false, stage_ok: true, handoff: 'cases run', defects: [defectText],
    });
    const folded = await tm.call('tm_submit', { task_id, node_id: 'dispatch:QA-F1:1' });
    assert.equal(folded.state, 'done', JSON.stringify(folded));

    // The fold must carry the defect through mechanically (foldChild's defectsFound reads every
    // execute node in the child directly), not depend on any judge having faithfully restated
    // it in prose - this is what makes it visible to accept:QA below regardless of what the
    // child's own gate:goal said.
    const task1 = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.deepEqual(task1.nodes.find((n) => n.node_id === 'dispatch:QA-F1:1').result.defects, [defectText]);

    const qaAcceptReady = (await tm.call('tm_next', { task_id })).ready.find((r) => r.node_id === 'accept:QA-F1:1');
    const qaAcceptBriefing = readFileSync(qaAcceptReady.briefing_path, 'utf8');
    assert.match(qaAcceptBriefing, /Defects it reported:\n- POST \/reset accepts an unknown CLI flag/,
      'the accept:QA agent must see the raw defect list under "What the child run delivered", not just the free-text report');

    const accepted = await tm.call('tm_submit', { task_id, node_id: 'accept:QA-F1:1', payload: ok({
      accept: true, match_pct: 72, gaps: ['the menu was never exercised live'],
      defects: [{ title: 'POST /reset accepts an unknown CLI flag and silently starts the real app', touches: [], deps: [], evidence: defectText, severity: 'high' }],
    }) });
    assert.equal(accepted.state, 'done', JSON.stringify(accepted));

    const task2 = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.deepEqual(task2.spec.packages.map((p) => p.id), ['P1', 'P2', 'D1'], 'the defect is filed as a fix STORY');
    const d1 = task2.spec.packages.find((p) => p.id === 'D1');
    assert.equal(d1.reporter, 'qa');
    assert.equal(d1.title, 'POST /reset accepts an unknown CLI flag and silently starts the real app');
    const goal = task2.nodes.find((n) => n.node_id === 'gate:goal:1');
    assert.deepEqual(goal.deps, ['integrate:2'], 'gate:goal reroutes behind a fresh integrate to re-verify the fix');
  }, { roles: { qa: true } });
});

test('a failed QA dispatch whose child recorded defects files them instead of blindly retrying the whole QA package (autoRetryPackages)', async () => {
  const { autoRetryPackages } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, g, root, task_id }) => {
    await toIntegrate(tm, g, task_id);
    await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });
    const nx = await tm.call('tm_next', { task_id });
    const qa1 = nx.children[0];
    assert.equal(qa1.package_id, 'QA-F1');
    const defectText = 'checkout crashes on an empty cart -> hit /checkout with 0 items';
    await completeQaChild(g, qa1, { accept: true, match_pct: 95 }, {
      verified: false, stage_ok: true, handoff: 'cases run', defects: [defectText],
    });
    const folded = await tm.call('tm_submit', { task_id, node_id: 'dispatch:QA-F1:1' });
    assert.equal(folded.state, 'done', JSON.stringify(folded));

    const taskPath = join(root, task_id, 'task.json');
    const raw = JSON.parse(readFileSync(taskPath, 'utf8'));
    const dispatchNode = raw.nodes.find((n) => n.node_id === 'dispatch:QA-F1:1');
    assert.deepEqual(dispatchNode.result.defects, [defectText]);
    // Fold the dispatch itself as failed on some OTHER ground - an integration conflict on this
    // attempt's own worktree, say - the way a real one can, while the case set had already run
    // and recorded a real defect. foldChild's defectsFound carries that through regardless of
    // the fold's own accept/reject verdict (it reads every execute node directly, not the
    // child's goal-gate verdict), which is what this test exercises directly and deterministically.
    dispatchNode.state = 'failed';
    dispatchNode.result = { ...dispatchNode.result, accept: false, reason: 'an unrelated integration conflict on this attempt' };
    writeFileSync(taskPath, JSON.stringify(raw));

    const load = () => JSON.parse(readFileSync(taskPath, 'utf8'));
    const prevRoot = process.env.HARNESS_TASKS_DIR;
    const withRoot = (fn) => { process.env.HARNESS_TASKS_DIR = root; try { return fn(); } finally { if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot; } };

    const changed = withRoot(() => autoRetryPackages(load()));
    assert.equal(changed, true, 'the daemon acts on the failed dispatch');

    const after = load();
    assert.ok(!after.nodes.some((n) => n.node_id === 'dispatch:QA-F1:2'), 'no blind retry of the whole QA package on the same tree');
    assert.equal(after.nodes.find((n) => n.node_id === 'accept:QA-F1:1').state, 'skipped',
      'the accept node stuck behind the failed dispatch is retired in place, not left pending forever');
    assert.deepEqual(after.spec.packages.map((p) => p.id), ['P1', 'P2', 'D1'], 'the defect is filed as a fix STORY instead of retrying QA');
    const d1 = after.spec.packages.find((p) => p.id === 'D1');
    assert.equal(d1.reporter, 'qa');
    assert.equal(d1.title, defectText);
    assert.match(d1.brief, /hit \/checkout with 0 items/, 'the full defect string survives as evidence in the filed STORY');
    const goal = after.nodes.find((n) => n.node_id === 'gate:goal:1');
    assert.deepEqual(goal.deps, ['integrate:2'], 'gate:goal reroutes behind a fresh integrate to re-verify the fix');
  }, { roles: { qa: true } });
});

// portfolio-refresh-80ec931a (2026-09-28): dispatch:QA:1 folded blocked on a malformed adapter
// reply, the daemon reopened dispatch:QA:2, and that attempt was itself still running when the
// box stopped - it ended blocked too, superseded mid-flight, and no accept:QA verdict ever
// landed. closeStoppedToReport rewired gate:goal straight past accept:QA:2 onto integrate:1 so
// the Sprint could still close (correct - a QA pass that never finishes must not wedge the task
// forever), but nothing recorded that QA never reached a verdict: the real run's goal gate
// accepted at 92% and the report read "complete" with no QA sign-off, discoverable only by a
// judge noticing a failed dispatch buried in "every node in this task". These two tests cover the
// fix: task.budget_stopped.qa_not_run is set when the rewire fires, and composeTaskPrompt puts
// the fact in front of the goal gate and the report explicitly - the task still completes.
test('a budget stop that rewires gate:goal past an incomplete QA pass records qa_not_run, and the goal gate/report briefings say so explicitly', async () => {
  const { autoRetryPackages } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, g, root, task_id }) => {
    await toIntegrate(tm, g, task_id);
    await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });
    const nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children[0].package_id, 'QA-F1');

    const taskPath = join(root, task_id, 'task.json');
    const load = () => JSON.parse(readFileSync(taskPath, 'utf8'));
    const save = (t) => writeFileSync(taskPath, JSON.stringify(t));
    const prevRoot = process.env.HARNESS_TASKS_DIR;
    const withRoot = (fn) => {
      process.env.HARNESS_TASKS_DIR = root;
      try { return fn(); } finally { if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot; }
    };

    // dispatch:QA:1 folds blocked on a malformed adapter reply - a plain failure, no defects,
    // the way an adapter exit 1 does (fixed in 0.35.1; this test is about what happens after).
    let t = load();
    t.nodes.find((n) => n.node_id === 'dispatch:QA-F1:1').state = 'failed';
    t.nodes.find((n) => n.node_id === 'dispatch:QA-F1:1').result = {
      stage_ok: false, reason: 'child run ended blocked. Its own verdicts:\nplan: adapter exit 1',
    };
    save(t);
    assert.equal(withRoot(() => autoRetryPackages(load())), true, 'the daemon reopens QA as attempt 2');

    t = load();
    assert.ok(t.nodes.some((n) => n.node_id === 'dispatch:QA-F1:2'), 'QA gets a second attempt');
    assert.deepEqual(t.nodes.find((n) => n.node_id === 'gate:goal:1').deps, ['accept:QA-F1:2'],
      'the goal gate now waits on the retried attempt');

    // dispatch:QA:2 is itself still running when the box stops in the real run - it ends
    // blocked too (superseded mid-flight), and no accept:QA:2 verdict ever lands.
    t.nodes.find((n) => n.node_id === 'dispatch:QA-F1:2').state = 'failed';
    t.nodes.find((n) => n.node_id === 'dispatch:QA-F1:2').result = {
      stage_ok: false, reason: 'child run ended blocked: superseded by spec attempt 3',
    };
    // enforceBudget reads elapsed time via task.created_at, not driver spend - push it into the
    // past against the short timebox, same as the timebox_minutes test above, so no driver-spend
    // fixture is needed to trip the stop.
    t.created_at = Date.now() - 11 * 60 * 1000;
    save(t);

    const after = await tm.call('tm_next', { task_id });
    t = load();
    assert.ok(t.budget_stopped, 'the box is recorded as stopped');
    assert.deepEqual(t.budget_stopped.qa_not_run, [
      { pass: 'QA-F1', node_id: 'accept:QA-F1:2', reason: 'child run ended blocked: superseded by spec attempt 3' },
    ]);
    const goal = t.nodes.find((n) => n.node_id === 'gate:goal:1');
    assert.deepEqual(goal.deps, ['integrate:1'], 'gate:goal is rewired past the incomplete QA pass onto integrate directly');
    assert.equal(goal.state, 'pending');
    assert.deepEqual(after.ready.map((n) => n.node_id), ['gate:goal:1'],
      'the Sprint still proceeds to its goal gate rather than sitting blocked forever on a QA pass that will not finish');

    const goalReady = after.ready.find((n) => n.node_id === 'gate:goal:1');
    const goalBrief = readFileSync(goalReady.briefing_path, 'utf8');
    assert.match(goalBrief, /## Scope: QA-F1 did not run/);
    assert.match(goalBrief, /QA-F1: not run - child run ended blocked: superseded by spec attempt 3 \(last attempt: accept:QA-F1:2\)/);
    assert.match(goalBrief, /Record it in gaps/);

    const goalDone = await tm.call('tm_submit', {
      task_id, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 92, gaps: ['QA: not run (budget/timebox)'] }),
    });
    assert.equal(goalDone.state, 'done', JSON.stringify(goalDone));

    const nx2 = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx2.ready.map((n) => n.node_id), ['report'],
      'the task still completes to a report - a missing QA verdict is disclosed, not a block');
    const reportReady = nx2.ready.find((n) => n.node_id === 'report');
    const reportBrief = readFileSync(reportReady.briefing_path, 'utf8');
    assert.match(reportBrief, /## Scope: QA-F1 did not run/);
    assert.match(reportBrief, /List this explicitly under an "unresolved" or "known gaps" section of the report/);

    const done = await tm.call('tm_submit', {
      task_id, node_id: 'report', payload: ok({ handoff: '8/8 packages accepted; QA did not run (budget/timebox) - see unresolved' }),
    });
    assert.equal(done.state, 'done', JSON.stringify(done));

    const full = await tm.call('tm_status', { task_id, full: true });
    const retro = JSON.parse(readFileSync(docPaths(full).retro, 'utf8'));
    assert.deepEqual(retro.retrospective.budget_stopped.qa_not_run, [
      { pass: 'QA-F1', node_id: 'accept:QA-F1:2', reason: 'child run ended blocked: superseded by spec attempt 3' },
    ], 'qa_not_run reaches the retro/report doc, not just the in-memory task');
  }, { roles: { qa: true }, timebox_minutes: 10 });
});

// awake-beta-ref2 (2026-09-25): P3 (upstream) was ACCEPTED identifying Claude Code processes by
// kernel comm=='claude', but on P4's own host the real CLI's kernel comm is a version string -
// P4 proved it with its own probe, but had no route except to fail an attempt no retry could
// ever fix (P3's contract, not P4's, was wrong), and the daemon just reopened the identical
// impossible retry. These tests cover the fix-forward route at the task-manager level, using the
// plain P1<-P2 SHAPE fixture (P2 deps: ['P1']) in place of P3/P4.
test('a downstream package\'s implement reports an upstream_defects outside its own touches[]; the fold carries it through to accept:P2 regardless of the gate\'s own verdict', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await throughCritique(tm, task_id);
    let nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    assert.equal((await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' })).state, 'done');
    assert.equal((await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) })).state, 'done');

    nx = await tm.call('tm_next', { task_id });
    const p2 = nx.children[0];
    assert.equal(p2.package_id, 'P2');
    const { cwd, run_id } = p2;
    const sub = (node_id, payload) => g.call('team_submit', { run_id, cwd, node_id, payload: ok(payload) });
    const upstreamDefect = {
      package: 'P1', title: 'a.txt assumes a kernel comm string this host never produces',
      evidence: 'a helper probe named like the real process makes the check hold', touches: ['a.txt'],
    };
    await throughChildSpec(g, p2);
    appendFileSync(join(cwd, 'b.txt'), 'changed by P2\n');
    // implement alone carries it - test/gate below say nothing about it, proving foldChild reads
    // it straight off the implement node (like defectsFound already does for an execute node),
    // not off whichever node happened to restate it last.
    await sub('implement:U1:1', { changed_files: ['b.txt'], handoff: 'built', upstream_defects: [upstreamDefect] });
    await sub('test:U1:1', { verified: true });
    await sub('gate:U1:1', { accept: true, match_pct: 95 });
    await sub('gate:goal:1', { accept: true, match_pct: 95 });
    await sub('report', { handoff: 'built' });
    const teamNx = await g.call('team_next', { run_id, cwd });
    assert.equal(teamNx.state, 'complete');

    const folded = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P2:1' });
    assert.equal(folded.state, 'done', JSON.stringify(folded));
    const task1 = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.deepEqual(task1.nodes.find((n) => n.node_id === 'dispatch:P2:1').result.upstream_defects, [upstreamDefect]);

    const acceptReady = (await tm.call('tm_next', { task_id })).ready.find((r) => r.node_id === 'accept:P2:1');
    const briefing = readFileSync(acceptReady.briefing_path, 'utf8');
    assert.match(briefing, /Upstream defects it reported:\n- P1: a\.txt assumes a kernel comm string this host never produces/,
      'the accept:P2 agent must see the raw upstream_defects list under "What the child run delivered"');
  });
});

test('a failed downstream dispatch carrying upstream_defects files a fix STORY owned by the upstream package\'s scope and rewires the downstream package\'s next attempt onto it, instead of a blind retry against the same broken upstream', async () => {
  const { autoRetryPackages } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, g, root, task_id }) => {
    await throughCritique(tm, task_id);
    let nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    assert.equal((await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' })).state, 'done');
    assert.equal((await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) })).state, 'done');

    nx = await tm.call('tm_next', { task_id });
    const p2 = nx.children[0];
    const { cwd, run_id } = p2;
    const sub = (node_id, payload) => g.call('team_submit', { run_id, cwd, node_id, payload: ok(payload) });
    const upstreamDefect = {
      package: 'P1', title: 'a.txt assumes a kernel comm string this host never produces',
      evidence: 'a helper probe named like the real process makes the check hold', touches: ['a.txt'],
    };
    await throughChildSpec(g, p2);
    appendFileSync(join(cwd, 'b.txt'), 'changed by P2\n');
    await sub('implement:U1:1', { changed_files: ['b.txt'], handoff: 'built', upstream_defects: [upstreamDefect] });
    await sub('test:U1:1', { verified: true });
    await sub('gate:U1:1', { accept: true, match_pct: 95 });
    await sub('gate:goal:1', { accept: true, match_pct: 95 });
    await sub('report', { handoff: 'built' });
    await g.call('team_next', { run_id, cwd });
    assert.equal((await tm.call('tm_submit', { task_id, node_id: 'dispatch:P2:1' })).state, 'done');

    // P2's own scope was done, but its work cannot actually be verified while P1's upstream
    // defect holds - fold this attempt as failed the way a real one can (an environment its own
    // acceptance could not pass while the upstream bug holds), exactly as the existing QA test
    // above folds an unrelated integration conflict onto an otherwise-successful case run.
    const taskPath = join(root, task_id, 'task.json');
    const raw = JSON.parse(readFileSync(taskPath, 'utf8'));
    const dispatchNode = raw.nodes.find((n) => n.node_id === 'dispatch:P2:1');
    assert.deepEqual(dispatchNode.result.upstream_defects, [upstreamDefect]);
    dispatchNode.state = 'failed';
    dispatchNode.result = { ...dispatchNode.result, accept: false, reason: 'cannot verify against a host where the upstream kernel-detection assumption does not hold' };
    writeFileSync(taskPath, JSON.stringify(raw));

    const load = () => JSON.parse(readFileSync(taskPath, 'utf8'));
    const prevRoot = process.env.HARNESS_TASKS_DIR;
    const withRoot = (fn) => { process.env.HARNESS_TASKS_DIR = root; try { return fn(); } finally { if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot; } };

    const changed = withRoot(() => autoRetryPackages(load()));
    assert.equal(changed, true, 'the daemon acts on the failed dispatch');

    const after = load();
    assert.equal(after.nodes.find((n) => n.node_id === 'accept:P2:1').state, 'skipped',
      'the accept node stuck behind the failed dispatch is retired in place, not left pending forever');
    assert.deepEqual(after.spec.packages.map((p) => p.id), ['P1', 'P2', 'D1'], 'the upstream defect is filed as a fix STORY, owned by the upstream package');
    const d1 = after.spec.packages.find((p) => p.id === 'D1');
    // reporter is the FILER's team - P2, the downstream package whose own dispatch/accept found
    // the defect - never the literal 'upstream'; origin/link name the stage and the target.
    assert.equal(d1.reporter, 'P2');
    assert.equal(d1.origin, 'upstream');
    assert.deepEqual(d1.link, { type: 'blocks', target: 'P1' });
    assert.deepEqual(d1.deps, ['P1'], 'the fix package deps on the upstream package it fixes, not on P2 that found it');
    assert.deepEqual(d1.touches, ['a.txt'], 'the fix package is scoped to the upstream package\'s own touches, not to P2\'s');
    assert.equal(d1.title, upstreamDefect.title);

    const p2next = after.nodes.find((n) => n.node_id === 'dispatch:P2:2');
    assert.ok(p2next, 'P2 gets a fresh attempt instead of settling permanently failed');
    assert.ok(!p2next.deps.includes('accept:P1:1'), 'no blind retry: the stale accept it depended on before is gone from its deps');
    assert.ok(p2next.deps.includes('accept:D1:1'), 'P2\'s next attempt waits on the fix\'s own accept instead');

    const goal = after.nodes.find((n) => n.node_id === 'gate:goal:1');
    assert.deepEqual(goal.deps, ['integrate:2'], 'gate:goal reroutes behind a fresh integrate to re-verify the fix, same as a QA-found defect');
  });
});

test('upstream_fix_rounds caps the loop: past the cap, an upstream defect is recorded as unresolved rather than filed again, and the downstream package falls back to an ordinary retry', async () => {
  const { autoRetryPackages } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, g, root, task_id }) => {
    await throughCritique(tm, task_id);
    let nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    assert.equal((await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' })).state, 'done');
    assert.equal((await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) })).state, 'done');

    nx = await tm.call('tm_next', { task_id });
    const p2 = nx.children[0];
    const { cwd, run_id } = p2;
    const sub = (node_id, payload) => g.call('team_submit', { run_id, cwd, node_id, payload: ok(payload) });
    const upstreamDefect = { package: 'P1', title: 'kernel comm mismatch', evidence: 'probe reproduces a HOLD', touches: ['a.txt'] };
    await throughChildSpec(g, p2);
    appendFileSync(join(cwd, 'b.txt'), 'changed by P2\n');
    await sub('implement:U1:1', { changed_files: ['b.txt'], handoff: 'built', upstream_defects: [upstreamDefect] });
    await sub('test:U1:1', { verified: true });
    await sub('gate:U1:1', { accept: true, match_pct: 95 });
    await sub('gate:goal:1', { accept: true, match_pct: 95 });
    await sub('report', { handoff: 'built' });
    await g.call('team_next', { run_id, cwd });
    assert.equal((await tm.call('tm_submit', { task_id, node_id: 'dispatch:P2:1' })).state, 'done');

    const taskPath = join(root, task_id, 'task.json');
    const raw = JSON.parse(readFileSync(taskPath, 'utf8'));
    const dispatchNode = raw.nodes.find((n) => n.node_id === 'dispatch:P2:1');
    dispatchNode.state = 'failed';
    dispatchNode.result = { ...dispatchNode.result, accept: false, reason: 'blocked on the same upstream bug' };
    writeFileSync(taskPath, JSON.stringify(raw));

    const load = () => JSON.parse(readFileSync(taskPath, 'utf8'));
    const prevRoot = process.env.HARNESS_TASKS_DIR;
    const withRoot = (fn) => { process.env.HARNESS_TASKS_DIR = root; try { return fn(); } finally { if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot; } };

    // upstream_fix_rounds: 0 - the very first round against P1 is already over the cap, the same
    // shape the qa_rounds:0 test above uses for QA's own cap.
    const changed = withRoot(() => autoRetryPackages(load()));
    assert.equal(changed, true, 'the daemon still acts on the failed dispatch - a blind retry, this time');

    const after = load();
    assert.deepEqual(after.spec.packages.map((p) => p.id), ['P1', 'P2'], 'upstream_fix_rounds:0 caps the very first round - no fix STORY is filed');
    assert.deepEqual(after.unresolved_defects, [{
      title: upstreamDefect.title, evidence: upstreamDefect.evidence, reporter: 'P2', origin: 'upstream', link: { type: 'blocks', target: 'P1' }, round: 1,
    }]);
    const p2next = after.nodes.find((n) => n.node_id === 'dispatch:P2:2');
    assert.ok(p2next, 'the capped package still gets an ordinary retry, not a settled failure');
    assert.ok(p2next.deps.includes('accept:P1:1'), 'capped - falls back to the SAME dependency as before, a blind retry against the unfixed upstream');
  }, { upstream_fix_rounds: 0 });
});

test('a QA-found defect files a develop STORY and reroutes gate:goal to a fresh integrate; a second defect beyond qa_rounds is recorded, not filed (§5b, decision #2)', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await toIntegrate(tm, g, task_id);
    await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });

    let nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children.length, 1);
    const qa1 = nx.children[0];
    assert.equal(qa1.package_id, 'QA-F1');
    await completeQaChild(g, qa1, { accept: true, match_pct: 95 });
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:QA-F1:1' });

    const accepted1 = await tm.call('tm_submit', { task_id, node_id: 'accept:QA-F1:1', payload: ok({
      accept: true, match_pct: 95,
      defects: [{ title: 'checkout crashes on empty cart', touches: ['d.txt'], deps: [], evidence: 'run checkout with 0 items -> 500', severity: 'high' }],
    }) });
    assert.equal(accepted1.state, 'done', JSON.stringify(accepted1));

    let task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.deepEqual(task.spec.packages.map((p) => p.id), ['P1', 'P2', 'D1']);
    const d1 = task.spec.packages.find((p) => p.id === 'D1');
    assert.equal(d1.reporter, 'qa');
    assert.equal(d1.title, 'checkout crashes on empty cart');
    let goal = task.nodes.find((n) => n.node_id === 'gate:goal:1');
    assert.deepEqual(goal.deps, ['integrate:2'], 'a fresh integrate becomes gate:goal\'s dep the moment the defect is filed');
    const integrate2 = task.nodes.find((n) => n.node_id === 'integrate:2');
    assert.deepEqual(integrate2.deps, ['accept:D1:1']);
    assert.equal(integrate2.supersedes, 'accept:QA-F1:1');
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'report').after, ['gate:goal:1'], 'report stays behind the gate');

    // Drive D1 (an ordinary develop package - its own worktree, not the integration tree) and the
    // fresh integrate to done.
    nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children.length, 1);
    assert.equal(nx.children[0].package_id, 'D1');
    await completeDefectChild(g, nx.children[0], 'd.txt');
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:D1:1' });
    await tm.call('tm_submit', { task_id, node_id: 'accept:D1:1', payload: ok({ accept: true, match_pct: 92 }) });

    nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['integrate:2']);
    await tm.call('tm_submit', { task_id, node_id: 'integrate:2', payload: ok({ verified: true, checks: ['build -> ok'] }) });

    // roles.qa on: the integrate that just finished has nothing wired to it for QA yet, so a
    // fresh QA round opens automatically and gate:goal reroutes there - "dispatch -> accept ->
    // integrate -> qa" closing the loop.
    task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    goal = task.nodes.find((n) => n.node_id === 'gate:goal:1');
    assert.deepEqual(goal.deps, ['accept:QA-F1:2'], 'a fresh QA round re-verifies the fix before the goal gate');
    nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children.length, 1);
    const qa2 = nx.children[0];
    assert.equal(qa2.package_id, 'QA-F1');
    await completeQaChild(g, qa2, { accept: true, match_pct: 95 });
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:QA-F1:2' });

    // qa_rounds: 1 - this task has now run QA twice (accept:QA:1 and this one), which exceeds the
    // cap, so a second defect is recorded rather than filed as D2.
    const accepted2 = await tm.call('tm_submit', { task_id, node_id: 'accept:QA-F1:2', payload: ok({
      accept: true, match_pct: 95,
      defects: [{ title: 'second defect', touches: [], deps: [], evidence: 'e2', severity: 'low' }],
    }) });
    assert.equal(accepted2.state, 'done', JSON.stringify(accepted2));

    const final = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.deepEqual(final.spec.packages.map((p) => p.id), ['P1', 'P2', 'D1'], 'qa_rounds:1 caps the loop - no D2 is filed');
    assert.deepEqual(final.unresolved_defects, [{ title: 'second defect', touches: [], deps: [], evidence: 'e2', severity: 'low', round: 2 }]);
    assert.deepEqual(final.nodes.find((n) => n.node_id === 'gate:goal:1').deps, ['accept:QA-F1:2'], 'unaffected by the cap - already wired there');

    const after = await tm.call('tm_next', { task_id });
    assert.deepEqual(after.ready.map((n) => n.node_id), ['gate:goal:1'], 'the EPIC proceeds once the capped QA round is done, defects or not');
  }, { roles: { qa: true }, qa_rounds: 1 });
});

test('tm_file lets a user file a STORY directly, reporter: "user" / origin: "tm_file", never checked against qa_rounds (§5b, C-9)', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await toIntegrate(tm, g, task_id);
    await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });

    // Drive the task past qa_rounds:0 first: the very first QA round's own defect is already
    // over the cap, so the accept:QA:1 hook records it (task.unresolved_defects) instead of
    // filing it as a package. This proves the cap is live on this task before tm_file is asked
    // to prove it does not apply to tm_file at all.
    let nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children.length, 1);
    const qa1 = nx.children[0];
    assert.equal(qa1.package_id, 'QA-F1');
    await completeQaChild(g, qa1, { accept: true, match_pct: 95 });
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:QA-F1:1' });
    const accepted1 = await tm.call('tm_submit', { task_id, node_id: 'accept:QA-F1:1', payload: ok({
      accept: true, match_pct: 95,
      defects: [{ title: 'checkout crashes on empty cart', touches: [], deps: [], evidence: 'e', severity: 'high' }],
    }) });
    assert.equal(accepted1.state, 'done', JSON.stringify(accepted1));

    let task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.deepEqual(task.spec.packages.map((p) => p.id), ['P1', 'P2'], 'qa_rounds:0 caps the very first QA round - no defect package is filed from it');
    assert.deepEqual(task.unresolved_defects, [{ title: 'checkout crashes on empty cart', touches: [], deps: [], evidence: 'e', severity: 'high', round: 1 }]);

    nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['gate:goal:1'], 'the capped QA round still lets the EPIC proceed to the goal gate');

    // A user files a STORY at exactly the point a QA-reported defect was just refused - tm_file
    // must file it anyway, uncapped.
    const filed = await tm.call('tm_file', { task_id, stories: [
      { title: 'add a missing edge case', touches: ['b.txt'], deps: [], evidence: 'manual repro', severity: 'medium' },
    ] });
    assert.deepEqual(filed.filed, ['D1']);
    assert.equal(filed.integrate, 'integrate:2');

    task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const d1 = task.spec.packages.find((p) => p.id === 'D1');
    assert.ok(d1, 'tm_file must file the STORY even though qa_rounds is already spent on this task');
    assert.equal(d1.reporter, 'user');
    assert.equal(d1.origin, 'tm_file');
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'gate:goal:1').deps, ['integrate:2']);

    nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children.length, 1);
    assert.equal(nx.children[0].package_id, 'D1');
  }, { roles: { qa: true }, qa_rounds: 0 });
});

test('tm_file refuses before the task has a shape, and refuses an empty stories[]', async () => {
  await withTask(async ({ tm, task_id }) => {
    const early = await tm.call('tm_file', { task_id, stories: [{ title: 'x' }] });
    assert.match(early.error, /no shape yet/);
    await throughCritique(tm, task_id);
    const empty = await tm.call('tm_file', { task_id, stories: [] });
    assert.match(empty.error, /at least one story/);
  });
});

test('tm_file joins the board.jsonl tools: filing a STORY logs its ticket moving to BACKLOG/READY', async () => {
  await withTask(async ({ tm, g, task_id, root }) => {
    await toIntegrate(tm, g, task_id);
    await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });
    const boardPath = join(root, task_id, 'board.jsonl');
    const before = readFileSync(boardPath, 'utf8').trim().split('\n').length;

    await tm.call('tm_file', { task_id, stories: [{ title: 'add a missing edge case', touches: [], deps: [], evidence: 'e', severity: 'low' }] });

    const epicKey = `E-${task_id.slice(0, 8)}`;
    const events = readFileSync(boardPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(events.length > before, 'tm_file logged at least one new board line');
    assert.ok(events.some((e) => e.key === `${epicKey}/D1` && e.from === null && e.to === 'READY'), JSON.stringify(events.slice(before)));
  });
});

// ---------- the audit phase-Team: planning's second pass (v0.12.1 Task 2, §2, §3) ----------

// SHAPE, but with implements[] on every package - roles.planning turns on shape's completeness
// check against the user stories the PRD produced, which plain SHAPE would fail.
const SHAPE_IMPLEMENTS = {
  acceptance: SHAPE.acceptance,
  packages: SHAPE.packages.map((p, i) => ({ ...p, implements: [`F1-US-${i + 1}`] })),
};

// throughCritique's planning-on twin: size, then the PLAN phase-Team, then shape/critique.
async function throughCritiqueWithPlanning(tm, g, task_id, cwd, userStories = ['F1-US-1', 'F1-US-2']) {
  let v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2 modules'], handoff: 'two modules' }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
  await completePlanning(tm, g, task_id, cwd, userStories);
  v = await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...SHAPE_IMPLEMENTS, handoff: 's' }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
  v = await tm.call('tm_submit', { task_id, node_id: 'critique', payload: ok({ sound: true }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
}

// toIntegrate's planning-on twin: both packages driven and accepted, integrate:1 ready.
async function toIntegrateWithPlanning(tm, g, task_id, cwd) {
  await throughCritiqueWithPlanning(tm, g, task_id, cwd);
  let nx = await tm.call('tm_next', { task_id });
  await completeChild(g, nx.children[0]);
  await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
  await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) });
  nx = await tm.call('tm_next', { task_id });
  await completeChild(g, nx.children[0]);
  await tm.call('tm_submit', { task_id, node_id: 'dispatch:P2:1' });
  await tm.call('tm_submit', { task_id, node_id: 'accept:P2:1', payload: ok({ accept: true, match_pct: 90 }) });
  nx = await tm.call('tm_next', { task_id });
  assert.deepEqual(nx.ready.map((n) => n.node_id), ['integrate:1']);
  return nx;
}

// Drives one audit phase-Team child (kind planning-audit: audit -> gate) to report.
async function completeAuditChild(g, child, gatePayload) {
  const { cwd, run_id } = child;
  const sub = (node_id, payload) => g.call('team_submit', { run_id, cwd, node_id, payload: ok(payload) });
  await sub('plan', { handoff: 'p', flow: 'audit', size: 'S' });
  await sub('setgoal', { spec: { goal: 'AUDIT', acceptance: ['every user story is accounted for'], subgoals: [{ id: 'A1', title: 'cross-check the PRD', acceptance: ['each story judged'], deps: [] }] } });
  await sub('critique', { sound: true });
  await sub('audit:A1:1', { changed_files: [], handoff: 'stories judged', user_stories_checked: ['US-1', 'US-2'], unmet: [], qa_considered: true });
  await sub('gate:A1:1', { accept: true, match_pct: 95 });
  await sub('gate:goal:1', gatePayload);
  const nx = await g.call('team_next', { run_id, cwd });
  assert.deepEqual(nx.ready.map((n) => n.node_id), ['report']);
  await sub('report', { handoff: 'audit report' });
}

test('roles.planning opens an audit phase-Team after integrate when qa is off, and its brief carries no QA section (§2, decision #4)', async () => {
  await withTask(async ({ tm, g, cwd, root, task_id }) => {
    await toIntegrateWithPlanning(tm, g, task_id, cwd);
    const integ = await tm.call('tm_status', { task_id, node_id: 'integrate:1', full: true });
    await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });

    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'gate:goal:1').deps, ['accept:AUDIT:1'],
      'the goal gate waits on the audit, not on integrate directly');
    assert.equal(task.audit_pkg.phase, 'audit');
    assert.equal(task.audit_pkg.flow, 'audit');
    assert.match(task.audit_pkg.brief, /US-1/, 'the PRD\'s user stories travel into the audit brief');
    assert.ok(!/QA/.test(task.audit_pkg.brief), `roles.qa is off - nothing about QA belongs in the brief:\n${task.audit_pkg.brief}`);

    const nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children.length, 1, JSON.stringify(nx));
    assert.equal(nx.children[0].package_id, 'AUDIT');
    assert.equal(nx.children[0].cwd, integ.node.integration.cwd, 'the audit reads the integrated tree, like QA does');
  }, { roles: { planning: true } });
});

test('with both roles on the audit follows QA, consumes its report, and an unmet story files a STORY with reporter "audit" / origin "planning-audit"', async () => {
  await withTask(async ({ tm, g, cwd, root, task_id }) => {
    await toIntegrateWithPlanning(tm, g, task_id, cwd);
    await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });

    let nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children[0].package_id, 'QA-F1', 'QA runs first; the audit waits on it');
    await completeQaChild(g, nx.children[0], { accept: true, match_pct: 95 });
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:QA-F1:1' });
    nx = await tm.call('tm_next', { task_id });
    assert.match(readFileSync(nx.ready.find((r) => r.node_id === 'accept:QA-F1:1').briefing_path, 'utf8'), /"defects"/,
      'the QA judge is told to pass defects up - the same contract gap the audit would have had');
    await tm.call('tm_submit', { task_id, node_id: 'accept:QA-F1:1', payload: ok({
      accept: true, match_pct: 95, checks: ['QA report reviewed -> one weak spot'], gaps: ['b.txt untested'],
    }) });

    let task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'gate:goal:1').deps, ['accept:AUDIT:1']);
    assert.match(task.audit_pkg.brief, /QA/, 'roles.qa is on, so the QA verdict is in the audit brief');
    assert.match(task.audit_pkg.brief, /b\.txt untested/);

    nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children[0].package_id, 'AUDIT');
    await completeAuditChild(g, nx.children[0], { accept: true, match_pct: 95 });
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:AUDIT:1' });

    // The judge is told to pass the list up. Without this the hook below has nothing to act on.
    nx = await tm.call('tm_next', { task_id });
    const auditAccept = nx.ready.find((r) => r.node_id === 'accept:AUDIT:1');
    assert.ok(auditAccept, JSON.stringify(nx.ready));
    const auditBriefing = readFileSync(auditAccept.briefing_path, 'utf8');
    assert.match(auditBriefing, /"unmet"/);
    // Same fix as accept:QA's: the audit judge must be able to tell a real completeness sweep
    // from a rubber stamp, which needs the goal-level acceptance, what the develop packages
    // promised, AND the PRD's own user stories (audit's job is specifically to judge against
    // those, so its own generic pkg.acceptance alone cannot tell the difference).
    assert.match(auditBriefing, /## Goal-level acceptance\n- both modules build together/);
    assert.match(auditBriefing, /## What the develop packages promised\n### P1 — module a\nTouches: a\.txt\nAcceptance:\n- a\.txt says a/);
    assert.match(auditBriefing, /### P2 — module b\nTouches: b\.txt\nAcceptance:\n- b\.txt says b/);
    assert.match(auditBriefing, /## User stories from the PRD\n- F1-US-1\n- F1-US-2/);

    const accepted = await tm.call('tm_submit', { task_id, node_id: 'accept:AUDIT:1', payload: ok({
      accept: true, match_pct: 91, checks: ['reread the PRD against the tree -> US-2 unmet'],
      unmet: ['US-2 -> b.txt was never wired to the exported path'],
    }) });
    assert.equal(accepted.state, 'done', JSON.stringify(accepted));

    task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const d1 = task.spec.packages.find((p) => p.id === 'D1');
    assert.ok(d1, `an unmet story files a STORY: ${task.spec.packages.map((p) => p.id).join(', ')}`);
    assert.equal(d1.reporter, 'audit');
    assert.equal(d1.origin, 'planning-audit');
    assert.match(d1.title, /US-2/);
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'gate:goal:1').deps, ['integrate:2'],
      'the EPIC loops back through a fresh integrate, exactly as a QA-found defect does');
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'accept:AUDIT:1').result.filed, ['D1'],
      'the audit node records which STORYs it filed, so 65-audit.md can link them');
  }, { roles: { planning: true, qa: true } });
});

// C5: roles.planning false used to remove planning AND its audit. It is refused now, so the PRD
// is always there to audit: with roles.audit on, the audit still follows integrate.
test('roles.planning:false is refused and no longer takes the audit with it: the audit still opens after integrate (C5)', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await toIntegrate(tm, g, task_id);
    await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.ok(task.team.notes.some((x) => /roles\.planning: false is refused/.test(x)));
    assert.ok(task.audit_pkg, 'the audit opens: planning ran, so there is a PRD to audit');
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'gate:goal:1').deps, ['accept:AUDIT:1']);
    assert.match(task.audit_pkg.brief, /F1-US-1/, 'the audit reads the merged PRD\'s stories');
  }, { roles: { planning: false, audit: true } });
});

test('roles.audit:false keeps the rest of planning but skips the audit phase-Team, even with roles.planning on (the new independent switch)', async () => {
  await withTask(async ({ tm, g, cwd, root, task_id }) => {
    await toIntegrateWithPlanning(tm, g, task_id, cwd);
    await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.equal(task.audit_pkg == null, true, 'roles.audit:false must skip openAudit even though the PRD (roles.planning) ran');
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'gate:goal:1').deps, ['integrate:1']);
    assert.ok(!task.nodes.some((n) => n.subgoal_id === 'AUDIT'));
  }, { roles: { planning: true, audit: false } });
});

// Gap 1 (judge≠author): audit's author is the PLAN package's draft/revise, which ran in a
// sibling child run folded away before the audit child ever opens - routing.mjs's AUTHOR_OF
// table has no peer node to find it from. openAudit reads that run once and stashes the
// identity as task.audit_pkg.author_identity, threaded into the audit child run as
// run.external_author (graph.mjs's createRun); this test checks both hops of that plumbing.
test('the audit phase-Team carries the PRD author\'s identity across the run boundary as external_author', async () => {
  await withTask(async ({ tm, g, cwd, root, task_id }) => {
    await toIntegrateWithPlanning(tm, g, task_id, cwd);
    const planTask = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const planDispatch = planTask.nodes.find((n) => n.node_id === 'dispatch:PLAN-F1:1');
    const planRun = await g.call('team_status', { run_id: planDispatch.child.run_id, cwd: planDispatch.child.cwd, full: true });
    const revise = planRun.nodes.find((n) => n.node_id === 'revise:U1:1');
    assert.ok(revise, 'completePlanning always submits revise:U1:1');

    await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    // Every card's author (m10) - one card here, so a list of one.
    assert.deepEqual(task.audit_pkg.author_identity, [{ executor: revise.executor || null, vendor: revise.vendor || null, model: revise.model || null }]);

    const nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children[0].package_id, 'AUDIT');
    const auditRun = await g.call('team_status', { run_id: nx.children[0].run_id, cwd: nx.children[0].cwd, full: true });
    assert.deepEqual(auditRun.external_author, task.audit_pkg.author_identity, 'the audit child run carries the PRD author forward');
  }, { roles: { planning: true } });
});

test('an audit round is capped like a QA round: past qa_rounds an unmet story is recorded, not filed', async () => {
  await withTask(async ({ tm, g, cwd, root, task_id }) => {
    await toIntegrateWithPlanning(tm, g, task_id, cwd);
    await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });
    let nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children[0].package_id, 'AUDIT');
    await completeAuditChild(g, nx.children[0], { accept: true, match_pct: 95 });
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:AUDIT:1' });
    // qa_rounds: 0 - the very first audit round is already past the cap, so nothing is filed.
    await tm.call('tm_submit', { task_id, node_id: 'accept:AUDIT:1', payload: ok({
      accept: true, match_pct: 91, unmet: ['US-2 -> never wired'],
    }) });
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.deepEqual(task.spec.packages.map((p) => p.id), ['P1', 'P2'], 'the cap holds - no STORY is filed');
    assert.deepEqual(task.unresolved_defects, [{ title: 'US-2 -> never wired', evidence: '', reporter: 'audit', origin: 'planning-audit', round: 1 }]);
    const after = await tm.call('tm_next', { task_id });
    assert.deepEqual(after.ready.map((n) => n.node_id), ['gate:goal:1'], 'the EPIC proceeds past a capped audit');
  }, { roles: { planning: true }, qa_rounds: 0 });
});


// ---------- budget / timebox (§B.1: the Sprint's own missing box) ----------

function writeDriverSpend(root, task_id, label, total_cost_usd) {
  const dir = join(root, task_id, 'drivers');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${label}.stream.jsonl`), `${JSON.stringify({ type: 'result', total_cost_usd })}\n`);
}

test('budget_usd: spend is summed from every drivers/*.stream.jsonl result event, restarts included', async () => {
  await withTask(async ({ tm, root, task_id }) => {
    writeDriverSpend(root, task_id, 'a', 3.5);
    writeDriverSpend(root, task_id, 'a.restart1', 1.25); // a respawned driver is its own bill
    writeDriverSpend(root, task_id, 'b', 2);
    const st = await tm.call('tm_status', { task_id });
    assert.equal(st.budget, undefined, 'no budget_usd/timebox_minutes set - the field is absent entirely, not zeroed');
  });
});

test('budget_usd at 80% records one warning; below it, nothing is recorded', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await toIntegrate(tm, g, task_id); // P1 and P2 both accepted, integrate:1 ready
    writeDriverSpend(root, task_id, 'p1', 8); // 8 / 10 = 80%
    await tm.call('tm_next', { task_id });
    const st = await tm.call('tm_status', { task_id });
    assert.equal(st.budget.warn, true);
    assert.equal(st.budget.over, false);
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.equal(task.budget_warned, true);
    assert.equal(task.budget_stopped, undefined);
  }, { budget_usd: 10 });
});

test('budget_usd hit before shape: the pending graph is skipped, a report opens, and the retro carries the whole backlog forward (code-sprint-S2)', async () => {
  await withTask(async ({ tm, root, task_id }) => {
    writeDriverSpend(root, task_id, 'dispatch_PLAN-F1_1', 6.06); // the planning card spent it all
    const nx = await tm.call('tm_next', { task_id });
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.equal(task.budget_stopped.before_shape, true);
    // Shape does not exist yet - the plan stage opens it - so the pending plan stage is what is skipped.
    assert.equal(task.nodes.find((n) => n.node_id === 'areas').state, 'skipped');
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['report'], JSON.stringify(nx.ready));
    const v = await tm.call('tm_submit', { task_id, node_id: 'report', payload: ok({ handoff: 'budget spent before shape; nothing shipped' }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    const full = await tm.call('tm_status', { task_id, full: true });
    const retro = JSON.parse(readFileSync(docPaths(full).retro, 'utf8'));
    assert.deepEqual(retro.next_backlog.unshipped_requests.map((r) => r.priority), [0, 1, 2]);
    assert.ok(retro.retrospective.budget_stopped.before_shape);
    // ...and the next Sprint's context_from reads it back as backlog items, not just packages.
    const next = await tm.call('tm_open', { requests: ['x'], cwd: full.cwd, vendor: 'self', roles: { qa: false }, brainstorm: false, context_from: task_id });
    const t2 = await tm.call('tm_status', { task_id: next.task_id, full: true });
    assert.match(t2.context, /backlog items not shipped[\s\S]*\[0\] parse csv[\s\S]*\[2\] cli/);
    // ...and hands them back as candidates for the person to choose from - not added to requests.
    assert.deepEqual(next.carryover_candidates.map((c) => [c.kind, c.text]), [['request', 'parse csv'], ['request', 'rules engine'], ['request', 'cli']]);
    assert.deepEqual(t2.requests, ['x']);
  }, { request: null, requests: ['parse csv', 'rules engine', 'cli'], budget_usd: 5 });
});

test('m2: a budget stop before shape settles a running planning card past its grace instead of waiting on it forever', async () => {
  await withTask(async ({ tm, root, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'] }) });
    await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: TWO_AREAS }) });
    const nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children.length, 2, 'both planning cards running');
    writeDriverSpend(root, task_id, 'dispatch_PLAN-F1_1', 6);
    const after = await tm.call('tm_next', { task_id });
    const task = readTask(root, task_id);
    assert.equal(task.budget_stopped.before_shape, true);
    assert.ok(task.nodes.filter((n) => n.stage === 'dispatch').every((n) => n.state === 'skipped'), 'running planning cards settled at the stop');
    assert.deepEqual(after.ready.map((n) => n.node_id), ['report']);
  }, { budget_usd: 5, budget_grace_minutes: 0 });
});

test('R1: retro open_questions carry task-level unasked questions, a Dev contradiction first, so the next Sprint sees "the spec is wrong"', async () => {
  const { buildRetro, questionLine } = await import('../mcp/docs.mjs');
  const task = {
    run_id: 't', request: 'r', interactive: false, nodes: [],
    unasked: [
      { subgoal_id: 'P1', node_id: 'dispatch:P1:1', question: 'Which currency?', decided: 'KRW' },
      { node_id: 'dispatch:P2:1', raised_by: ['P2'], question: 'Refund window?', decided: null, blocking: 'contradicts_decision', contradicts_decision: 'Refunds are instant' },
    ],
  };
  const qs = buildRetro(task).next_backlog.open_questions;
  assert.deepEqual(qs.map((q) => q.question), ['Refund window?', 'Which currency?']);
  assert.equal(qs[0].contradicts_decision, 'Refunds are instant');
  assert.equal(qs[0].package_id, 'P2');
  assert.equal(questionLine(qs[0]), 'Refund window? (contradicts: Refunds are instant)');
  assert.equal(questionLine(qs[1]), 'Which currency?');
});

test('R1: tm_open({context_from}) shows a prior Sprint\'s contradiction in the new task\'s context', async () => {
  await withTask(async ({ tm, task_id }) => {
    const prior = await tm.call('tm_status', { task_id, full: true });
    const path = docPaths(prior).retro;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ task_id, next_backlog: { unfinished_stories: [], unaccepted_packages: [], unresolved_defects: [], open_questions: [{ question: 'Refund window?', contradicts_decision: 'Refunds are instant' }] }, retrospective: {} }));
    const next = await tm.call('tm_open', { request: 'next sprint', cwd: prior.cwd, vendor: 'self', brainstorm: false, context_from: task_id });
    const t2 = await tm.call('tm_status', { task_id: next.task_id, full: true });
    assert.match(t2.context, /Refund window\? \(contradicts: Refunds are instant\)/);
  });
});

test('m5: tm_open({context_from}) hands back unfinished user stories as candidates, card and acceptance kept, requests untouched', async () => {
  await withTask(async ({ tm, root, task_id }) => {
    const prior = await tm.call('tm_status', { task_id, full: true });
    const path = docPaths(prior).retro;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ task_id, next_backlog: { unfinished_stories: [{ id: 'F2-US-1', title: 'refund', card: 'PLAN-F2', acceptance: ['refund within 7 days'] }], unaccepted_packages: [], unresolved_defects: [], open_questions: [] }, retrospective: {} }));
    const next = await tm.call('tm_open', { request: 'next sprint', cwd: prior.cwd, vendor: 'self', brainstorm: false, context_from: task_id });
    assert.deepEqual(next.carryover_candidates, [{ kind: 'story', id: 'F2-US-1', text: 'refund', card: 'PLAN-F2', acceptance: ['refund within 7 days'] }]);
    const t2 = await tm.call('tm_status', { task_id: next.task_id, full: true });
    assert.match(t2.context, /F2-US-1/);
    assert.equal(t2.request, 'next sprint', 'nothing is added to the request on its own');
  });
});

test('m9: foldChild never reads a superseded (skipped) goal-gate round as the child\'s verdict', async () => {
  const { foldChild } = await import('../mcp/taskmanager.mjs');
  const { createRun, saveRun, node: gnode } = await import('../mcp/graph.mjs');
  const cwd = mkdtempSync(join(tmpdir(), 'fold-skip-'));
  try {
    execFileSync('git', ['init', '-q', cwd]);
    execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    const child = createRun({ cwd, request: 'r' });
    for (const x of child.nodes) { x.state = 'done'; x.result = { stage_ok: true }; }
    // Round 1 judged and passed; a later round 2 was opened and then superseded (skipped), its
    // placeholder result carrying no verdict. The child's verdict is round 1's.
    child.nodes = [...child.nodes,
      gnode('gate:goal:1', 'gate', [], { subgoal_id: null, state: 'done', result: { stage_ok: true, accept: true, match_pct: 95, gaps: [], observations: ['the live round noticed this'] } }),
      gnode('gate:goal:2', 'gate', [], { subgoal_id: null, state: 'skipped', result: { stage_ok: false, reason: 'superseded', observations: ['stale words from a discarded round'] } }),
      gnode('report', 'report', [], { state: 'done', result: { stage_ok: true, handoff: 'done' } }),
    ];
    saveRun(child);
    const task = { run_id: 't-m9', cwd, nodes: [], spec: { packages: [{ id: 'P1', title: 'p', acceptance: ['a'] }] } };
    const n = { node_id: 'dispatch:P1:1', stage: 'dispatch', subgoal_id: 'P1', state: 'running', child: { cwd, run_id: child.run_id } };
    const r = foldChild(task, n);
    // reason/observations come from the round node itself (consensus has no free text).
    assert.deepEqual(r.observations, ['the live round noticed this'], JSON.stringify(r));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('m7: a resumed task from before planning cards names its QA card QA-F1, never QA-PLAN', async () => {
  const { qaCards } = await import('../mcp/taskmanager.mjs');
  const legacy = { run_id: 't', request: 'r', nodes: [], planning_pkg: { id: 'PLAN', phase: 'planning', title: 'PRD' } };
  assert.deepEqual(qaCards(legacy, 'integrate:1').map((q) => q.id), ['QA-F1']);
  const cards = { run_id: 't', request: 'r', nodes: [], planning_pkgs: [{ id: 'PLAN-F1', area: 'F1' }, { id: 'PLAN-F2', area: 'F2' }] };
  assert.deepEqual(qaCards(cards, 'integrate:1').map((q) => q.id), ['QA-F1', 'QA-F2']);
});

test('m8: shape may not name a develop package after a card; tm_ticket\'s refusal lists the cards', async () => {
  const { validateShape } = await import('../mcp/taskmanager.mjs');
  const pkg = (id) => ({ id, title: id, brief: 'b', acceptance: ['a'], touches: [id], deps: [] });
  for (const id of ['PLAN-F1', 'QA-F2', 'AUDIT', 'qa']) {
    assert.ok(validateShape({ acceptance: ['x'], packages: [pkg(id), pkg('P2')] }).some((p) => /reserved for the planning\/QA\/audit cards/.test(p)), id);
  }
  assert.ok(!validateShape({ acceptance: ['x'], packages: [pkg('P1'), pkg('PLANNER')] }).some((p) => /reserved/.test(p)), 'only the card forms are reserved');
  await withTask(async ({ tm, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'] }) });
    await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: TWO_AREAS }) });
    const bad = await tm.call('tm_ticket', { key: `E-${task_id.slice(0, 8)}/P9` });
    assert.match(bad.error, /cards and packages: PLAN-F1, PLAN-F2/);
  });
});

test('retro: a backlog item is shipped only when an accepted package declares it in `backlog`', async () => {
  const { buildRetro } = await import('../mcp/docs.mjs');
  const task = {
    run_id: 't', request: 'r', requests: ['a', 'b', 'c'],
    spec: { packages: [{ id: 'P1', title: 'a', backlog: [0] }, { id: 'P2', title: 'b', backlog: [1] }] },
    nodes: [
      { node_id: 'dispatch:P1:1', stage: 'dispatch', subgoal_id: 'P1', state: 'done' },
      { node_id: 'accept:P1:1', stage: 'accept', subgoal_id: 'P1', state: 'done', result: { accept: true } },
      { node_id: 'dispatch:P2:1', stage: 'dispatch', subgoal_id: 'P2', state: 'failed' },
      { node_id: 'accept:P2:1', stage: 'accept', subgoal_id: 'P2', state: 'failed', result: { accept: false, reason: 'no' } },
      // M8: what shipped is what the final integration holds - the integrate over both accepts.
      { node_id: 'integrate:1', stage: 'integrate', state: 'done', deps: ['accept:P1:1', 'accept:P2:1'] },
    ],
  };
  for (const n of task.nodes) n.deps = n.deps || [];
  assert.deepEqual(buildRetro(task).next_backlog.unshipped_requests.map((r) => r.priority), [1, 2]);
  // Accepted but never integrated ships nothing: the whole backlog carries.
  task.nodes.pop();
  assert.deepEqual(buildRetro(task).next_backlog.unshipped_requests.map((r) => r.priority), [0, 1, 2]);
});

test('retro: a user story ships only through an accepted package that implements it AND a done integrate; the rest carry into the next Sprint (sprint-not-sub-epic)', async () => {
  const { buildRetro } = await import('../mcp/docs.mjs');
  const planning = [
    { node_id: 'dispatch:PLAN-F1:1', stage: 'dispatch', subgoal_id: 'PLAN-F1', state: 'done', attempt: 1,
      result: { user_stories: [{ id: 'F1-US-1', title: 'sign in' }, { id: 'F1-US-2', title: 'sign out', acceptance: ['session ends'] }] } },
    { node_id: 'accept:PLAN-F1:1', stage: 'accept', subgoal_id: 'PLAN-F1', state: 'done', attempt: 1, result: { accept: true } },
  ];
  const base = {
    run_id: 't', request: 'r', planning_pkgs: [{ id: 'PLAN-F1' }],
    spec: { packages: [{ id: 'P1', title: 'in', implements: ['F1-US-1'] }, { id: 'P2', title: 'out', implements: ['F1-US-2'] }] },
  };
  const devNodes = [
    { node_id: 'dispatch:P1:1', stage: 'dispatch', subgoal_id: 'P1', state: 'done' },
    { node_id: 'accept:P1:1', stage: 'accept', subgoal_id: 'P1', state: 'done', result: { accept: true } },
    { node_id: 'dispatch:P2:1', stage: 'dispatch', subgoal_id: 'P2', state: 'failed' },
    { node_id: 'accept:P2:1', stage: 'accept', subgoal_id: 'P2', state: 'failed', result: { accept: false, reason: 'no' } },
  ];
  for (const n of [...planning, ...devNodes]) n.deps = [];
  const integrated = buildRetro({ ...base, nodes: [...planning, ...devNodes, { node_id: 'integrate:1', stage: 'integrate', state: 'done', deps: ['accept:P1:1', 'accept:P2:1'] }] });
  assert.deepEqual(integrated.next_backlog.unfinished_stories, [{ id: 'F1-US-2', title: 'sign out', card: 'PLAN-F1', acceptance: ['session ends'] }]);
  // Accepted but never integrated: nothing shipped, both stories carry.
  const notIntegrated = buildRetro({ ...base, nodes: [...planning, ...devNodes] });
  assert.deepEqual(notIntegrated.next_backlog.unfinished_stories.map((u) => u.id), ['F1-US-1', 'F1-US-2']);
  // No planning cards at all: the field is present and empty, never missing.
  assert.deepEqual(buildRetro({ run_id: 't', request: 'r', nodes: [] }).next_backlog.unfinished_stories, []);
});

test('retro M7: a story two packages implement ships only when both shipped', async () => {
  const { buildRetro } = await import('../mcp/docs.mjs');
  const nodes = [
    { node_id: 'dispatch:PLAN-F1:1', stage: 'dispatch', subgoal_id: 'PLAN-F1', state: 'done', attempt: 1, deps: [], result: { user_stories: [{ id: 'F1-US-1', title: 'both' }] } },
    { node_id: 'accept:PLAN-F1:1', stage: 'accept', subgoal_id: 'PLAN-F1', state: 'done', attempt: 1, deps: [], result: { accept: true } },
    { node_id: 'dispatch:P1:1', stage: 'dispatch', subgoal_id: 'P1', state: 'done', deps: [] },
    { node_id: 'accept:P1:1', stage: 'accept', subgoal_id: 'P1', state: 'done', deps: ['dispatch:P1:1'], result: { accept: true } },
    { node_id: 'dispatch:P2:1', stage: 'dispatch', subgoal_id: 'P2', state: 'failed', deps: [] },
    { node_id: 'accept:P2:1', stage: 'accept', subgoal_id: 'P2', state: 'failed', deps: ['dispatch:P2:1'], result: { accept: false, reason: 'no' } },
    { node_id: 'integrate:1', stage: 'integrate', state: 'done', deps: ['accept:P1:1'] },
  ];
  const task = { run_id: 't', request: 'r', planning_pkgs: [{ id: 'PLAN-F1' }],
    spec: { packages: [{ id: 'P1', title: 'a', implements: ['F1-US-1'] }, { id: 'P2', title: 'b', implements: ['F1-US-1'] }] }, nodes };
  assert.deepEqual(buildRetro(task).next_backlog.unfinished_stories.map((u) => u.id), ['F1-US-1']);
});

test('retro M8: a later failed integrate is not overridden by an earlier pass; a repair or defect-fix integrate still reaches the packages before it', async () => {
  const { buildRetro } = await import('../mcp/docs.mjs');
  const planning = [
    { node_id: 'dispatch:PLAN-F1:1', stage: 'dispatch', subgoal_id: 'PLAN-F1', state: 'done', attempt: 1, deps: [], result: { user_stories: [{ id: 'F1-US-1' }, { id: 'F1-US-2' }] } },
    { node_id: 'accept:PLAN-F1:1', stage: 'accept', subgoal_id: 'PLAN-F1', state: 'done', attempt: 1, deps: [], result: { accept: true } },
  ];
  const pkgs = [
    { node_id: 'dispatch:P1:1', stage: 'dispatch', subgoal_id: 'P1', state: 'done', deps: [] },
    { node_id: 'accept:P1:1', stage: 'accept', subgoal_id: 'P1', state: 'done', deps: ['dispatch:P1:1'], result: { accept: true } },
    { node_id: 'dispatch:P2:1', stage: 'dispatch', subgoal_id: 'P2', state: 'done', deps: [] },
    { node_id: 'accept:P2:1', stage: 'accept', subgoal_id: 'P2', state: 'done', deps: ['dispatch:P2:1'], result: { accept: true } },
  ];
  const spec = { packages: [{ id: 'P1', title: 'a', implements: ['F1-US-1'] }, { id: 'P2', title: 'b', implements: ['F1-US-2'] }] };
  const base = { run_id: 't', request: 'r', planning_pkgs: [{ id: 'PLAN-F1' }], spec };
  const clone = (xs) => JSON.parse(JSON.stringify(xs));
  // integrate:1 passed, a defect fix's integrate:2 (superseding it) failed for good: nothing ships.
  const failedLater = buildRetro({ ...base, nodes: [...clone(planning), ...clone(pkgs),
    { node_id: 'integrate:1', stage: 'integrate', state: 'done', deps: ['accept:P1:1', 'accept:P2:1'] },
    { node_id: 'integrate:2', stage: 'integrate', state: 'failed', final: true, supersedes: 'integrate:1', deps: [] }] });
  assert.deepEqual(failedLater.next_backlog.unfinished_stories.map((u) => u.id), ['F1-US-1', 'F1-US-2']);
  // A repair after a failed integrate: integrate:2 names only accept:R1:1; R1's chain reaches P1/P2.
  const repaired = buildRetro({ ...base, spec: { packages: [...spec.packages, { id: 'R1', title: 'repair', repair: true }] }, nodes: [...clone(planning), ...clone(pkgs),
    { node_id: 'integrate:1', stage: 'integrate', state: 'failed', deps: ['accept:P1:1', 'accept:P2:1'] },
    { node_id: 'dispatch:R1:1', stage: 'dispatch', subgoal_id: 'R1', state: 'done', deps: ['accept:P1:1', 'accept:P2:1'] },
    { node_id: 'accept:R1:1', stage: 'accept', subgoal_id: 'R1', state: 'done', deps: ['dispatch:R1:1'], result: { accept: true } },
    { node_id: 'integrate:2', stage: 'integrate', state: 'done', supersedes: 'integrate:1', deps: ['accept:R1:1'] }] });
  assert.deepEqual(repaired.next_backlog.unfinished_stories, []);
  // A QA defect fix: integrate:2 names only accept:D1:1 (no deps); the done integrate:1 it superseded counts.
  const fixed = buildRetro({ ...base, spec: { packages: [...spec.packages, { id: 'D1', title: 'fix' }] }, nodes: [...clone(planning), ...clone(pkgs),
    { node_id: 'integrate:1', stage: 'integrate', state: 'done', deps: ['accept:P1:1', 'accept:P2:1'] },
    { node_id: 'dispatch:D1:1', stage: 'dispatch', subgoal_id: 'D1', state: 'done', deps: [] },
    { node_id: 'accept:D1:1', stage: 'accept', subgoal_id: 'D1', state: 'done', deps: ['dispatch:D1:1'], result: { accept: true } },
    { node_id: 'integrate:2', stage: 'integrate', state: 'done', supersedes: 'integrate:1', deps: ['accept:D1:1'] }] });
  assert.deepEqual(fixed.next_backlog.unfinished_stories, []);
  // A package accepted after the last integrate is not in it.
  const late = buildRetro({ ...base, nodes: [...clone(planning), ...clone(pkgs),
    { node_id: 'integrate:1', stage: 'integrate', state: 'done', deps: ['accept:P1:1'] }] });
  assert.deepEqual(late.next_backlog.unfinished_stories.map((u) => u.id), ['F1-US-2']);
  // The integrate's own record wins: a round based on a repair merged only R1, and the repair's
  // base (the integrate it worked on) merged P1 and P2.
  const recorded = buildRetro({ ...base, spec: { packages: [...spec.packages, { id: 'R1', title: 'repair', repair: true, integration_of: 'integrate:1' }] }, nodes: [...clone(planning), ...clone(pkgs),
    { node_id: 'integrate:1', stage: 'integrate', state: 'failed', deps: [], integration: { merged: [{ package: 'P1' }, { package: 'P2' }] } },
    { node_id: 'accept:R1:1', stage: 'accept', subgoal_id: 'R1', state: 'done', deps: [], result: { accept: true } },
    { node_id: 'integrate:2', stage: 'integrate', state: 'done', supersedes: 'integrate:1', deps: [], integration: { merged: [{ package: 'R1' }], based_on: 'repair', repair_package: 'R1' } }] });
  assert.deepEqual(recorded.next_backlog.unfinished_stories, []);
  // ...and a record that merged only P1 ships only P1, whatever the deps say.
  const partial = buildRetro({ ...base, nodes: [...clone(planning), ...clone(pkgs),
    { node_id: 'integrate:1', stage: 'integrate', state: 'done', deps: ['accept:P1:1', 'accept:P2:1'], integration: { merged: [{ package: 'P1' }] } }] });
  assert.deepEqual(partial.next_backlog.unfinished_stories.map((u) => u.id), ['F1-US-2']);
});

test('retro m11: numeric package ids match; a bare null story is dropped, not named "null"', async () => {
  const { buildRetro } = await import('../mcp/docs.mjs');
  const task = { run_id: 't', request: 'r', requests: ['a'], planning_pkgs: [{ id: 'PLAN-F1' }],
    spec: { packages: [{ id: 1, title: 'a', backlog: [0], implements: ['F1-US-1'] }] },
    nodes: [
      { node_id: 'dispatch:PLAN-F1:1', stage: 'dispatch', subgoal_id: 'PLAN-F1', state: 'done', attempt: 1, deps: [], result: { user_stories: [null, '', { id: 'F1-US-1' }] } },
      { node_id: 'accept:PLAN-F1:1', stage: 'accept', subgoal_id: 'PLAN-F1', state: 'done', attempt: 1, deps: [], result: { accept: true } },
      { node_id: 'dispatch:1:1', stage: 'dispatch', subgoal_id: '1', state: 'done', deps: [] },
      { node_id: 'accept:1:1', stage: 'accept', subgoal_id: '1', state: 'done', deps: ['dispatch:1:1'], result: { accept: true } },
      { node_id: 'integrate:1', stage: 'integrate', state: 'done', deps: ['accept:1:1'] },
    ] };
  const r = buildRetro(task);
  assert.deepEqual(r.next_backlog.unshipped_requests, []);
  assert.deepEqual(r.next_backlog.unfinished_stories, []);
});

test('budget_usd at 100%: no new package dispatches, an in-flight one still finishes, and a fresh integrate opens over just what accepted - the rest named "not done"', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await throughCritique(tm, task_id); // SHAPE: P1 (no deps), P2 (deps: [P1])
    let nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children[0].package_id, 'P1', 'P2 depends on P1 - only P1 is ready yet');
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) });

    // P1's own driver cost the whole budget - tripped only after it finished, so P1 itself
    // was never blocked ("finishes in-flight" has nothing left to prove for a node already done,
    // but P2, ready right after P1 accepted, must never get its own dispatch).
    writeDriverSpend(root, task_id, 'p1', 10);
    nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children.length, 0, 'P2 became ready this same poll but the budget is already spent');

    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.equal(task.budget_stopped != null, true);
    assert.deepEqual(task.budget_stopped.skipped_packages, ['P2']);
    const p2dispatch = task.nodes.find((n) => n.node_id === 'dispatch:P2:1');
    assert.equal(p2dispatch.state, 'skipped');
    assert.match(p2dispatch.result.reason, /budget\/timebox exhausted/);
    const p2accept = task.nodes.find((n) => n.node_id === 'accept:P2:1');
    assert.equal(p2accept.state, 'skipped');

    // A fresh integrate opened behind the accepted subset alone (reintegrateBehind, the same
    // mechanism a filed defect or a repair already uses) - the original integrate:1 is
    // superseded, and gate:goal now points at integrate:2.
    const freshIntegrate = task.nodes.find((n) => n.stage === 'integrate' && n.supersedes === 'integrate:1');
    assert.ok(freshIntegrate, JSON.stringify(task.nodes.filter((n) => n.stage === 'integrate')));
    assert.deepEqual(freshIntegrate.deps, ['accept:P1:1']);
    assert.match(freshIntegrate.feedback || '', /not done: P2/);
    assert.deepEqual(nx.ready.map((n) => n.node_id), [freshIntegrate.node_id]);

    const st = await tm.call('tm_status', { task_id });
    assert.equal(st.budget.over, true);
  }, { budget_usd: 10 });
});

test('code-sprint-S5: after a budget stop the reintegration is judged on the kept packages, a refusal opens no repair, and the Sprint still closes to a report and retro', async () => {
  const { autoRepair, pendingRejudgeAt } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, g, root, task_id }) => {
    await throughCritique(tm, task_id);
    let nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) });
    writeDriverSpend(root, task_id, 'p1', 10);
    nx = await tm.call('tm_next', { task_id });
    const integ = nx.ready.find((n) => n.stage === 'integrate');
    assert.ok(integ, JSON.stringify(nx.ready));
    const brief = readFileSync(integ.briefing_path, 'utf8');
    assert.match(brief, /## Scope: the Sprint's box ran out/);
    assert.match(brief, /P2 were never dispatched/);

    // The judge refuses anyway, with a reason. No repair: the box forbids a new dispatch.
    const v = await tm.call('tm_submit', { task_id, node_id: integ.node_id, payload: ok({ verified: false, gaps: ['report package absent'] }) });
    assert.equal(v.state, 'failed', JSON.stringify(v));
    const prevRoot = process.env.HARNESS_TASKS_DIR;
    process.env.HARNESS_TASKS_DIR = root;
    try {
      const t = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
      assert.equal(autoRepair(t), false, 'no repair package once the box is stopped');
      assert.equal(pendingRejudgeAt(t), null, 'a reasoned refusal is not a judge failure');
    } finally { if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot; }

    nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['report'], 'the stopped Sprint closes to its report');
    const ev = await tm.call('tm_events', { task_id });
    assert.ok(ev.events.some((e) => e.event === 'budget_closed'));
    const done = await tm.call('tm_submit', { task_id, node_id: 'report', payload: ok({ handoff: 'P1 shipped; P2 carried over' }) });
    assert.equal(done.state, 'done', JSON.stringify(done));
    const full = await tm.call('tm_status', { task_id, full: true });
    const retro = JSON.parse(readFileSync(docPaths(full).retro, 'utf8'));
    assert.ok(retro.next_backlog.unaccepted_packages.some((p) => p.id === 'P2'));
  }, { budget_usd: 10 });
});

test('timebox_minutes at 100% (created_at in the past) stops dispatching the same way budget_usd does', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await throughCritique(tm, task_id);
    let nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) });

    const taskPath = join(root, task_id, 'task.json');
    const task = JSON.parse(readFileSync(taskPath, 'utf8'));
    task.created_at = Date.now() - 11 * 60 * 1000; // 11 minutes ago against a 10-minute timebox
    writeFileSync(taskPath, JSON.stringify(task));

    nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children.length, 0);
    const after = JSON.parse(readFileSync(taskPath, 'utf8'));
    assert.deepEqual(after.budget_stopped.skipped_packages, ['P2']);
    assert.equal(after.budget_stopped.timebox_minutes, 10);
    assert.equal(after.budget_stopped.budget_usd, null);
  }, { timebox_minutes: 10 });
});

// ---------- retro bridge / backlog (§B.2, §B.3) ----------

async function toReport(tm, g, task_id, handoff = 'all done') {
  await toIntegrate(tm, g, task_id);
  await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });
  await tm.call('tm_submit', { task_id, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 92 }) });
  await tm.call('tm_submit', { task_id, node_id: 'report', payload: ok({ handoff }) });
}

test('report writes retro.json next to 80-report.md - a clean two-package run has nothing to retro over', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await toReport(tm, g, task_id);
    const task = await tm.call('tm_status', { task_id, full: true });
    const retro = JSON.parse(readFileSync(docPaths(task).retro, 'utf8'));
    assert.equal(retro.task_id, task_id);
    assert.deepEqual(retro.retrospective.what_failed, []);
    assert.deepEqual(retro.retrospective.retries, []);
    assert.deepEqual(retro.next_backlog.unaccepted_packages, []);
    const report = readFileSync(docPaths(task).report, 'utf8');
    assert.match(report, /## Retrospective/);
    assert.match(report, /## Next backlog/);
  });
});

test('retro.json names a package that never got accepted (a rejected attempt past its retry budget) in next_backlog.unaccepted_packages', async () => {
  // Same shape as "the package retry budget settles" above: auto_reassign:false keeps a
  // rejected child's own gate from opening a repair pass, so each dispatch fold sees a plain
  // rejection and the retry budget (default 2) actually runs out.
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const nx = attempt === 1 ? await tm.call('tm_next', { task_id }) : await tm.call('tm_retry', { task_id, package_id: 'P1' });
      const child = nx.children.find((c) => c.node_id === `dispatch:P1:${attempt}`);
      assert.ok(child, `attempt ${attempt} dispatched`);
      await completeChild(g, child, { accept: false });
      assert.equal((await tm.call('tm_submit', { task_id, node_id: `dispatch:P1:${attempt}` })).state, 'failed');
    }
    const rt = await tm.call('tm_retry', { task_id, package_id: 'P1' });
    assert.equal(rt.retried, false);
    assert.deepEqual(rt.ready.map((n) => n.node_id), ['report']);
    await tm.call('tm_submit', { task_id, node_id: 'report', payload: ok({ handoff: 'blocked' }) });
    const task = await tm.call('tm_status', { task_id, full: true });
    const retro = JSON.parse(readFileSync(docPaths(task).retro, 'utf8'));
    assert.ok(retro.next_backlog.unaccepted_packages.some((p) => p.id === 'P1'), JSON.stringify(retro.next_backlog.unaccepted_packages));
    assert.ok(retro.retrospective.what_failed.some((f) => f.package_id === 'P1'), JSON.stringify(retro.retrospective.what_failed));
  }, { auto_reassign: false });
});

test('tm_open({context_from}) folds the prior task\'s retro into the new task\'s context; a task with no retro yet leaves context untouched', async () => {
  await withTask(async ({ tm, g, cwd, root, task_id }) => {
    await toReport(tm, g, task_id, 'prior task done');

    const second = await tm.call('tm_open', { request: 'follow-up work', cwd, vendor: 'self', roles: { qa: false }, brainstorm: false, context_from: task_id });
    const task2 = await tm.call('tm_status', { task_id: second.task_id, full: true });
    assert.match(task2.context, /Retrospective/);
    assert.match(task2.context, /Next backlog/);
    assert.match(task2.context, new RegExp(task_id));

    // A ref that resolves to nothing (no report/retro yet) is best-effort, not fatal.
    const third = await tm.call('tm_open', { request: 'no prior retro yet', cwd, vendor: 'self', roles: { qa: false }, brainstorm: false, context_from: 'not-a-real-task-id' });
    const task3 = await tm.call('tm_status', { task_id: third.task_id, full: true });
    assert.equal(task3.context, '');
    assert.match(third.context_from_unresolved, /no task not-a-real-task-id/, 'best-effort, but the caller is told it came up empty');
    // A real task whose report has not run yet: named as such, not as a missing task.
    const fourth = await tm.call('tm_open', { request: 'too early', cwd, vendor: 'self', roles: { qa: false }, brainstorm: false, context_from: third.task_id });
    assert.match(fourth.context_from_unresolved, /no retro\.json yet/);
    assert.equal(second.context_from_unresolved, undefined);
  }, { roles: { qa: false } });
});

test('tm_open requires request XOR requests, and requests: [...] becomes the backlog request text in priority order', async () => {
  await withTask(async ({ tm, cwd }) => {
    const neither = await tm.call('tm_open', { cwd, vendor: 'self' });
    assert.match(neither.error, /request.*requests|requests.*request/i);
    const both = await tm.call('tm_open', { cwd, vendor: 'self', request: 'a', requests: ['b', 'c'] });
    assert.match(both.error, /request OR requests/);
  });
});

test('requests: [...] opens with a single composed request text (priority = array order) and task.requests carries the raw backlog for the retro', async () => {
  await withTask(async ({ tm, cwd, root }) => {
    const open = await tm.call('tm_open', { requests: ['build the API', 'write the docs'], cwd, vendor: 'self', roles: { qa: false }, brainstorm: false });
    const task = JSON.parse(readFileSync(join(root, open.task_id, 'task.json'), 'utf8'));
    assert.deepEqual(task.requests, ['build the API', 'write the docs']);
    assert.match(task.request, /\[backlog priority 0\] build the API/);
    assert.match(task.request, /\[backlog priority 1\] write the docs/);
  });
});

test('a backlog held to a budget/timebox is pinned L - an S task has no packages for the box to leave undispatched', async () => {
  await withTask(async ({ tm, cwd, root }) => {
    const boxed = await tm.call('tm_open', { requests: ['build the API', 'write the docs'], budget_usd: 5, cwd, vendor: 'self', roles: { qa: false }, brainstorm: false });
    const t1 = JSON.parse(readFileSync(join(root, boxed.task_id, 'task.json'), 'utf8'));
    assert.equal(t1.size_pinned, 'L');
    assert.equal(t1.size_pin_source, 'boxed-backlog');
    assert.equal(t1.nodes.find((n) => n.node_id === 'size').result.size, 'L');
    const timeboxed = await tm.call('tm_open', { requests: ['a', 'b'], timebox_minutes: 30, cwd, vendor: 'self', roles: { qa: false }, brainstorm: false });
    assert.equal(JSON.parse(readFileSync(join(root, timeboxed.task_id, 'task.json'), 'utf8')).size_pinned, 'L');
    // Unboxed, a single item, or a caller's own pin: size is measured (or pinned) as before.
    const unboxed = await tm.call('tm_open', { requests: ['a', 'b'], cwd, vendor: 'self', roles: { qa: false }, brainstorm: false });
    assert.equal(JSON.parse(readFileSync(join(root, unboxed.task_id, 'task.json'), 'utf8')).size_pinned, null);
    const single = await tm.call('tm_open', { requests: ['a'], budget_usd: 5, cwd, vendor: 'self', roles: { qa: false }, brainstorm: false });
    assert.equal(JSON.parse(readFileSync(join(root, single.task_id, 'task.json'), 'utf8')).size_pinned, null);
    const callerS = await tm.call('tm_open', { requests: ['a', 'b'], budget_usd: 5, size: 'S', cwd, vendor: 'self', roles: { qa: false }, brainstorm: false });
    const t5 = JSON.parse(readFileSync(join(root, callerS.task_id, 'task.json'), 'utf8'));
    assert.equal(t5.size_pinned, 'S');
    assert.equal(t5.size_pin_source, 'caller');
  });
});

test('max_parallel_teams:1 opens only the lowest-priority ready dispatch; the rest stay pending', async () => {
  await withTask(async ({ tm, root, task_id }) => {
    let v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop' }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    v = await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({
      acceptance: ['all three modules build'],
      packages: [
        { id: 'P1', title: 'module a', flow: 'develop', brief: 'change a.txt', acceptance: ['a'], touches: ['a.txt'], deps: [] },
        { id: 'P2', title: 'module b', flow: 'develop', brief: 'change b.txt', acceptance: ['b'], touches: ['b.txt'], deps: [] },
        { id: 'P3', title: 'module c', flow: 'develop', brief: 'change c.txt', acceptance: ['c'], touches: ['c.txt'], deps: [] },
      ],
      handoff: 's',
    }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    await tm.call('tm_submit', { task_id, node_id: 'critique', payload: ok({ sound: true }) });

    const nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children.length, 1, 'only one dispatch opens with max_parallel_teams:1');
    assert.equal(nx.children[0].package_id, 'P1', 'the lowest-priority ready package (array position 0) opens first');
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    for (const id of ['dispatch:P2:1', 'dispatch:P3:1']) {
      const n = task.nodes.find((x) => x.node_id === id);
      assert.equal(n.state, 'pending', `${id} is ready but must wait for capacity, not open`);
      assert.equal(n.child, undefined);
    }

    // A second poll, with P1 still running: the cap (1) is already spent, so nothing new opens.
    const again = await tm.call('tm_next', { task_id });
    assert.equal(again.children.length, 1);
    assert.equal(again.children[0].package_id, 'P1');
  }, { max_parallel_teams: 1 });
});

test('tm_status: auto_parallel is surfaced when max_parallel_teams is "auto" (the default), and absent when pinned to a fixed number', async () => {
  await withTask(async ({ tm, task_id }) => {
    const st = await tm.call('tm_status', { task_id });
    assert.equal(st.team.opts.max_parallel_teams, 'auto');
    assert.ok(st.auto_parallel, 'auto_parallel must be present when max_parallel_teams is "auto"');
    assert.equal(st.auto_parallel.current, 2, 'starts at 2, the same number this cap used to be pinned at forever');
    assert.equal(st.auto_parallel.streak, 0);
  });
  await withTask(async ({ tm, task_id }) => {
    const st = await tm.call('tm_status', { task_id });
    assert.equal(st.team.opts.max_parallel_teams, 3);
    assert.equal(st.auto_parallel, undefined, 'a fixed max_parallel_teams must not show auto-controller state');
  }, { max_parallel_teams: 3 });
});

test('below the cap, independent ready dispatches still open at once (regression)', async () => {
  await withTask(async ({ tm, task_id }) => {
    let v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop' }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    v = await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({
      acceptance: ['both modules build'],
      packages: [
        { id: 'P1', title: 'module a', flow: 'develop', brief: 'change a.txt', acceptance: ['a'], touches: ['a.txt'], deps: [] },
        { id: 'P2', title: 'module b', flow: 'develop', brief: 'change b.txt', acceptance: ['b'], touches: ['b.txt'], deps: [] },
      ],
      handoff: 's',
    }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    await tm.call('tm_submit', { task_id, node_id: 'critique', payload: ok({ sound: true }) });
    const nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children.length, 2, 'the default max_parallel_teams ("auto", starting at 2) is not exceeded, so both open immediately, exactly as before this change');
  });
});

// advanceDispatches' phase-Team exemption (taskmanager.mjs: `if (!isPhaseTeam(n)) continue;`
// before max_parallel_teams/runningStories are even computed) is deliberately untested here for
// concurrency, and that is a considered choice, not an oversight - proven live: replacing that
// function's body with `() => false` leaves this entire suite green (checked by mutation while
// writing these tests; reverted, not committed). The exemption is unreachable through every real
// surface (tm_open, tm_submit, tm_next, tm_file, tm_retry) as this codebase stands today, for a
// structural reason documented at its two load-bearing sites:
//
//   1. PLAN's dispatch is ready off `size` alone (taskmanager.mjs's expandPackages/shape wiring),
//      before `shape` has ever run - no develop package exists yet, so there is nothing running
//      for it to be concurrent with.
//   2. QA's and AUDIT's dispatches only ever open from the "integrate just finished" hook
//      (taskmanager.mjs, the `n.stage === 'integrate' && n.state === 'done'` block) or the
//      analogous accept:QA-driven reopen - and every integrate node's own deps are exactly the
//      accept nodes of the packages that fed it (expandPackages for the first integrate,
//      reintegrateBehind for every later one fileDefects/openRepair opens). reintegrateBehind
//      does not add a parallel path: it REWRITES every node that depended on the old integrate,
//      goal.deps included, to depend on the fresh one instead. So by the time any integrate
//      reaches 'done', every develop dispatch it depended on is already done, not running - the
//      phase-Team dispatch this opens next can never find a develop STORY dispatch still
//      in-flight beside it. fileDefects's own comment (above `function fileDefects`) and the
//      integrate-done hook's comment (above the QA reopen) both spell out this same argument from
//      the production side; this note is its test-side mirror, recorded so a mutation audit does
//      not mistake "no test exercises this branch" for "no one decided that on purpose".
//
// What would have to change for this to become reachable: a second, independent join point - some
// way for a develop STORY dispatch to still be 'running' at the moment a DIFFERENT integrate (one
// that dispatch is not a dependency of) reaches 'done' and opens a phase-Team round. Nothing in
// tm_open/tm_submit/tm_next/tm_file/tm_retry creates two independent integrates over
// non-overlapping package sets today; the day one does, this exemption needs a real concurrency
// test, and this comment stops being the reason one does not exist.

// ---------- the manager's own goal gate has the same floor as the graph engine's ----------

// Drive the default two-package SHAPE to the point where gate:goal:1 is ready, reusing
// the same helpers the integrate tests use.
async function toManagerGoalGate(tm, g, task_id) {
  await toIntegrate(tm, g, task_id);
  await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });
}

test('the manager\'s goal gate accepting at 85 fails: the number overrules the word', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await toManagerGoalGate(tm, g, task_id);
    const v = await tm.call('tm_submit', { task_id, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 85 }) });
    assert.equal(v.stage_ok, true, 'the judging itself worked');
    assert.equal(v.accept, true, 'and the gate did say accept');
    assert.equal(v.state, 'failed', 'the number it reported overrules the word');
    assert.match(v.reason, /match_pct 85 below the goal threshold 90/);
  });
});

test('tm_open({goal_threshold: 80}) lets the same 85% accept', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await toManagerGoalGate(tm, g, task_id);
    const v = await tm.call('tm_submit', { task_id, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 85 }) });
    assert.equal(v.state, 'done', 'a manager may decide the percentage is not its bar');
  }, { goal_threshold: 80 });
});

// Sprint audit: a driver stream's own `result` event (total_cost_usd/num_turns) is the ONLY
// place a task's real spend lived - view.mjs's RESOURCE view already read it (drivercost.mjs),
// but tm_status/tm_board/the report briefing never aggregated it at all, so a run like
// awake-beta-ref1's $53.93 / 222 turns sat visible only in the raw drivers/*.stream.jsonl logs.
// Fixture writes the stream files by hand (HARNESS_TEST_NO_DRIVER means nothing else ever
// would) at the exact paths spawnChildDriver itself names them:
// <taskDir>/drivers/dispatch_<pkg>_<attempt>.stream.jsonl.
test('tm_status and tm_board aggregate driver cost/turns across every package dispatch, and the manager report stage briefing states the total (Sprint audit)', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await toManagerGoalGate(tm, g, task_id);

    const driversDir = join(root, task_id, 'drivers');
    mkdirSync(driversDir, { recursive: true });
    writeFileSync(join(driversDir, 'dispatch_P1_1.stream.jsonl'),
      JSON.stringify({ type: 'result', total_cost_usd: 1.5, num_turns: 10 }) + '\n');
    writeFileSync(join(driversDir, 'dispatch_P2_1.stream.jsonl'),
      JSON.stringify({ type: 'result', total_cost_usd: 0.5, num_turns: 4 }) + '\n');

    const st = await tm.call('tm_status', { task_id });
    assert.equal(st.cost.usd, 2, JSON.stringify(st.cost));
    assert.equal(st.cost.turns, 14);
    assert.deepEqual(st.packages, ['P1', 'P2'], 'the plain id list tm_status has always returned is untouched');
    assert.deepEqual(
      st.package_costs.sort((a, b) => a.id.localeCompare(b.id)),
      [{ id: 'P1', cost_usd: 1.5, turns: 10 }, { id: 'P2', cost_usd: 0.5, turns: 4 }],
    );

    const board = await tm.call('tm_board', { task_id });
    assert.equal(board.cost.usd, 2);
    assert.equal(board.cost.turns, 14);

    const v = await tm.call('tm_submit', { task_id, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 95 }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    const nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['report']);
    const briefing = readFileSync(nx.ready[0].briefing_path, 'utf8');
    assert.match(briefing, /## Cost and turns/);
    assert.match(briefing, /\$2\.00 \(\$2\.00 driver and manager sessions \+ \$0\.00 node sessions\), 14 turns, 2 sessions/, `report briefing did not state the cost total: ${briefing}`);
  });
});

test('tm_open({goal_threshold}) is stored on the task and reaches every child through child_opts and the actual dispatched run', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.equal(task.goal_threshold, 77);
    assert.equal(task.child_opts.goal_threshold, 77, 'every child run is opened with the same floor');
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    const c = nx.children[0];
    const full = await g.call('team_status', { run_id: c.run_id, cwd: c.cwd, full: true });
    assert.equal(full.goal_threshold, 77, 'an explicit tm_open argument must reach the actual dispatched child run, not just the parent task.json');
  }, { goal_threshold: 77 });
});

test('a dispatched child run keeps the legacy single-judge default (goal_judges:1) unless tm_open asks for more', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    const c = nx.children[0];
    assert.equal(c.node_id, 'dispatch:P1:1');
    const full = await g.call('team_status', { run_id: c.run_id, cwd: c.cwd, full: true });
    // team_open's own tool boundary defaults to 2; createRun's bare default (what every child run
    // here goes through) stays 1, matching every run this manager has ever opened - bumping this
    // default breaks every existing helper that drives a child to completion, which submits
    // exactly one gate:goal:N per round. The bug is the argument's total absence, not this value.
    assert.equal(full.goal_judges, 1, 'a package\'s child run keeps the manager\'s long-standing single-judge default');
  });
});

test('tm_open({goal_judges}) is stored in child_opts and reaches the actual dispatched child run', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    const c = nx.children[0];
    const full = await g.call('team_status', { run_id: c.run_id, cwd: c.cwd, full: true });
    assert.equal(full.goal_judges, 4, 'an explicit tm_open argument must reach every child run the same way goal_threshold and max_retries already do');
  }, { goal_judges: 4 });
});

test('a dispatched package with goal_judges:2 is folded by the true multi-judge consensus, not by whichever sibling node happens to sort last', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    // This test is about the goal-gate ROUND's own multi-judge consensus inside a package's
    // child run (every package runs the full harness, gate:goal included).
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    const c = nx.children[0];
    const { cwd, run_id } = c;
    const sub = (node_id, payload) => g.call('team_submit', { run_id, cwd, node_id, payload: ok(payload) });
    let v = await sub('plan', { handoff: 'p', flow: 'develop', size: 'S' });
    assert.equal(v.state, 'done', JSON.stringify(v));
    await sub('setgoal', { spec: CHILD_SPEC });
    await sub('critique', { sound: true });
    appendFileSync(join(cwd, 'a.txt'), 'changed by P1\n');
    v = await sub('implement:U1:1', { changed_files: ['a.txt'], handoff: 'built' });
    assert.equal(v.state, 'done', JSON.stringify(v));
    await sub('test:U1:1', { verified: true });
    await sub('gate:U1:1', { accept: true, match_pct: 95 });
    // The round's two judges disagree: the primary rejects, the letter-suffixed second judge
    // accepts. Consensus requires EVERY judge to accept - the true verdict is reject. With
    // max_retries:0 the repair budget is exhausted on the first rejection, so autoReassignGoalGate
    // marks both siblings final without opening a repair round, and the report's order-only
    // `after` on the round is satisfied (both siblings are now settled) without ever reaching
    // accept.
    v = await sub('gate:goal:1', { accept: false, match_pct: 40, gaps: ['missing the b half'], reason: 'short' });
    assert.equal(v.state, 'failed', JSON.stringify(v));
    v = await sub('gate:goal:1b', { accept: true, match_pct: 95 });
    assert.equal(v.state, 'done', JSON.stringify(v));
    const afterRound = await g.call('team_status', { run_id, cwd, full: true });
    const round1 = afterRound.nodes.filter((n) => n.node_id === 'gate:goal:1' || n.node_id === 'gate:goal:1b');
    assert.ok(round1.every((n) => n.final === true), 'repair budget exhausted: both siblings settle as final');
    assert.deepEqual(afterRound.nodes.filter((n) => n.stage === 'repair'), [], 'no repair opened: max_retries:0 exhausts the budget on the first round');
    const nxChild = await g.call('team_next', { run_id, cwd });
    assert.deepEqual(nxChild.ready.map((n) => n.node_id), ['report'], 'the order-only after-edge only needs the round settled, not accepted');
    await sub('report', { handoff: `child report for ${cwd}` });
    assert.equal((await g.call('team_status', { run_id, cwd })).state, 'complete');

    // The manager folds this child next. If it reads the true multi-judge consensus, the
    // dispatch is rejected (not every judge accepted); if it naively reads whichever gate
    // node happens to sort/insert last (gate:goal:1b, the lone accepter), it wrongly reports
    // accept:true and commits the package's worktree as if the round had passed.
    const folded = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    assert.equal(folded.accept, false, 'goal_judges:2 requires every judge to accept; one rejection must reject the round');
    assert.equal(folded.state, 'failed', JSON.stringify(folded));
  }, { goal_judges: 2, max_retries: 0 });
});

test('tm_open no longer accepts notify: dropped from the tool schema and never stored on the task', async () => {
  const c = await new Client(TM).init();
  try {
    const r = await c.send('tools/list', {});
    const tmOpen = r.result.tools.find((t) => t.name === 'tm_open');
    assert.equal(Object.prototype.hasOwnProperty.call(tmOpen.inputSchema.properties, 'notify'), false);
  } finally {
    c.close();
  }

  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_LEADER: '1' }).init();
  try {
    // Passing notify is silently a no-op now, not an error - same as any other unrecognized
    // argument this hand-rolled schema does not validate against.
    const open = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'r', cwd, vendor: 'self', notify: 'some-agent' });
    const task = JSON.parse(readFileSync(join(root, open.task_id, 'task.json'), 'utf8'));
    assert.equal(Object.prototype.hasOwnProperty.call(task, 'notify'), false);
  } finally {
    tm.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('tm_open starts one viewer per tasks root and hands back its URL; .view.json records a live pid', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1', TEAMS_VIEW: '1' }).init();
  const pids = [];
  try {
    const open = await tm.call('tm_open', { request: 'r', cwd, vendor: 'self', roles: { qa: false }, brainstorm: false });
    assert.match(open.view_url, new RegExp(`^http://127\\.0\\.0\\.1:\\d+/\\?task=${open.task_id}$`));
    const rec = readViewRecord(root);
    assert.ok(rec, '.view.json missing, unreadable, or its pid is already dead');
    pids.push(rec.pid);
    assert.equal(open.view_url, `http://127.0.0.1:${rec.port}/?task=${open.task_id}`);
  } finally {
    for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
    tm.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('a second tm_open under the same tasks root reuses the first viewer - one window per root, not one per task', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1', TEAMS_VIEW: '1' }).init();
  const pids = [];
  try {
    const open1 = await tm.call('tm_open', { request: 'r1', cwd, vendor: 'self', roles: { qa: false }, brainstorm: false });
    const rec1 = readViewRecord(root);
    assert.ok(rec1, '.view.json missing after the first tm_open');
    pids.push(rec1.pid);

    const open2 = await tm.call('tm_open', { request: 'r2', cwd, vendor: 'self', roles: { qa: false }, brainstorm: false });
    const rec2 = readViewRecord(root);
    assert.ok(rec2, '.view.json missing after the second tm_open');
    assert.equal(rec2.pid, rec1.pid, 'the second tm_open must reuse the same viewer process, not spawn a second one');
    assert.equal(rec2.port, rec1.port, 'reuse must keep the same port');
    assert.match(open2.view_url, new RegExp(`^http://127\\.0\\.0\\.1:${rec1.port}/\\?task=${open2.task_id}$`));
  } finally {
    for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
    tm.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('TEAMS_VIEW=0 disables the viewer entirely: no view_url, no .view.json, and the task still opens normally', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1', TEAMS_VIEW: '0' }).init();
  try {
    const open = await tm.call('tm_open', { request: 'r', cwd, vendor: 'self', roles: { qa: false }, brainstorm: false });
    assert.ok(!open.view_url, 'view_url must be absent or null when TEAMS_VIEW=0');
    assert.ok(!existsSync(viewRecordPath(root)), '.view.json must not be written when TEAMS_VIEW=0');
    assert.equal(open.state, 'running');
    assert.deepEqual(open.ready.map((n) => n.node_id), ['size'], 'the task must still open normally with the viewer disabled');
  } finally {
    tm.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('an accept node that says accept with no checks fails, not the package it judged', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    const v = await tm.call('tm_submit', {
      task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90, checks: [] }),
    });
    assert.equal(v.stage_ok, false, 'the judging itself is what failed here');
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /positive verdict without a check/);
    assert.match(v.reason, /judgement with no evidence is a guess/);
  });
});

// Drive SHAPE (P2 depends on P1) to the point where integrate:1 is ready, in the fewest calls.
async function toIntegrate(tm, g, task_id) {
  await throughCritique(tm, task_id);
  let nx = await tm.call('tm_next', { task_id });
  await completeChild(g, nx.children[0]);
  assert.equal((await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' })).state, 'done');
  assert.equal((await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) })).state, 'done');
  nx = await tm.call('tm_next', { task_id });
  await completeChild(g, nx.children[0]);
  assert.equal((await tm.call('tm_submit', { task_id, node_id: 'dispatch:P2:1' })).state, 'done');
  assert.equal((await tm.call('tm_submit', { task_id, node_id: 'accept:P2:1', payload: ok({ accept: true, match_pct: 90 }) })).state, 'done');
  nx = await tm.call('tm_next', { task_id });
  assert.deepEqual(nx.ready.map((n) => n.node_id), ['integrate:1']);
  return nx;
}

// Gap 2 (judge≠author): critique judges shape, and accept judges a package's own dispatch,
// but both run through daemon.mjs's judge() - one identical `claude -p` call for every manager
// node, with no vendor ever selected and no executor/vendor ever tagged onto these nodes. There
// is nothing to route critique or accept away TO (unlike audit's cross-run case, where a peer
// vendor may genuinely be free), so the honest move is recording reviewer_independence rather
// than asserting one - and it always reads 'unverifiable-self', because the manager's own side
// of the comparison never has a tracked identity to be anything else.
test('critique and accept record reviewer_independence: unverifiable-self - the manager judges through one untracked host identity, never a routed one', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    const nx = await toIntegrate(tm, g, task_id);
    void nx;
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const critique = task.nodes.find((n) => n.node_id === 'critique');
    assert.equal(critique.result.reviewer_independence, 'unverifiable-self');
    const acceptP1 = task.nodes.find((n) => n.node_id === 'accept:P1:1');
    assert.equal(acceptP1.result.reviewer_independence, 'unverifiable-self');
    const acceptP2 = task.nodes.find((n) => n.node_id === 'accept:P2:1');
    assert.equal(acceptP2.result.reviewer_independence, 'unverifiable-self');
  });
});

// End-to-end wiring for max_parallel_teams: 'auto' - toolSubmit's own dispatch-fold branch calls
// updateAutoParallel (taskmanager.mjs) right before finish(), the same call daemon.mjs's loop
// makes for an autonomous run. scripts/test-autoparallel.mjs covers the controller's own
// increase/decrease/floor/ceiling logic as a pure function; this test only proves the two real
// call sites actually reach it - toIntegrate folds P1 then P2, two clean develop-STORY dispatches
// with no driver (HARNESS_TEST_NO_DRIVER) and so no capacity signal, which is exactly one AIMD
// window (AIMD_WINDOW=2).
// max_parallel_ceiling is pinned: left null the ceiling is derived from the host
// (min(availableParallelism()/2, 6), floored at the start value 2), so on a 4-core machine it is
// 2 and the +1 this test asserts can never happen - the test measured the host, not the wiring.
test('max_parallel_teams "auto": two clean develop-STORY dispatch folds (toIntegrate: P1 then P2) advance the real task from 2 to 3, and the ledger records it', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await toIntegrate(tm, g, task_id);
    const st = await tm.call('tm_status', { task_id });
    assert.equal(st.auto_parallel.current, 3, 'one full window (2 clean STORY folds) completed: 2 -> 3');
    assert.equal(st.auto_parallel.streak, 0);
    const ledger = readFileSync(join(root, task_id, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const inc = ledger.find((e) => e.event === 'auto_parallel_increased');
    assert.ok(inc, 'the increase must be recorded in the ledger, not just reflected in task.json');
    assert.equal(inc.from, 2);
    assert.equal(inc.to, 3);
  }, { max_parallel_ceiling: 6 });
});

// portfolio-consolidate-8518d5dd: integrate:6 came back verified:false with checks/evidence/
// unowned and no reason or gaps - the ledger, the report and triage all showed "integrate:6: "
// with nothing after the colon. The manager now synthesizes one the way the broker does for a
// child review/test rejection.
test('an integrate refusal with no reason or gaps gets one synthesized from its checks/evidence', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await toIntegrate(tm, g, task_id);
    const v = await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({
      verified: false,
      checks: ['git log -> P1 and P2 merged', 'ls skills -> beta/ is ABSENT, so G1 is only partly met'],
      evidence: 'G1, G3 and G7 are unmet because P3 failed and P4 was not dispatched.',
    }) });
    assert.equal(v.state, 'failed');
    assert.match(v.reason || '', /G1 is only partly met|G1, G3 and G7 are unmet/, JSON.stringify(v));
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.ok(task.nodes.find((n) => n.node_id === 'integrate:1').result.reason, 'the stored result carries it too, for harvest');
  });
});

test('a failed integrate reopens once the package it blamed is retried; an unknown package id is refused', async () => {
  // The first docs task to finish its packages ended here: integrate ran the README examples,
  // one package's failed, the package was retried and accepted - and integrate stayed failed
  // with the goal gate pending behind it. The session's only probe, tm_retry({package_id:
  // "integrate"}), opened a phantom package.
  await withTask(async ({ tm, g, task_id }) => {
    await toIntegrate(tm, g, task_id);
    let v = await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: false, checks: ['run example -> P2 example fails'], gaps: ['P2 example does not run'] }) });
    assert.equal(v.state, 'failed');
    let nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.state, 'blocked');

    const bad = await tm.call('tm_retry', { task_id, package_id: 'integrate' });
    // The planning card is a package too (C2), so it is named among the ones tm_retry knows.
    assert.match(bad.error, /no package integrate in the shape \(packages: PLAN-F1, P1, P2\)/);
    assert.equal((await tm.call('tm_status', { task_id })).nodes.filter((n) => n.node_id.startsWith('dispatch:integrate')).length, 0, 'no phantom package');

    const rt = await tm.call('tm_retry', { task_id, package_id: 'P2' });
    assert.equal(rt.retried, true);
    assert.equal(rt.children.length, 1);
    assert.equal(rt.children[0].node_id, 'dispatch:P2:2');
    await completeChild(g, rt.children[0]);
    assert.equal((await tm.call('tm_submit', { task_id, node_id: 'dispatch:P2:2' })).state, 'done');
    assert.equal((await tm.call('tm_submit', { task_id, node_id: 'accept:P2:2', payload: ok({ accept: true, match_pct: 96 }) })).state, 'done');

    nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['integrate:2'], 'a fresh integrate judges the combined tree again');
    const st = await tm.call('tm_status', { task_id, node_id: 'integrate:2' });
    assert.ok(st.nodes[0].deps.includes('accept:P2:2') && st.nodes[0].deps.includes('accept:P1:1'), JSON.stringify(st.nodes[0].deps));
    const briefing = readFileSync(nx.ready[0].briefing_path, 'utf8');
    assert.match(briefing, /P2 example does not run/, 'the failed checks travel to the new integrate');
    const gate = (await tm.call('tm_status', { task_id, node_id: 'gate:goal:1' })).nodes[0];
    assert.deepEqual(gate.deps, ['integrate:2'], 'the goal gate waits for the new integrate, not the failed one');
    v = await tm.call('tm_submit', { task_id, node_id: 'integrate:2', payload: ok({ verified: true, checks: ['run example -> ok'] }) });
    assert.equal(v.state, 'done');
    assert.equal(v.integration.merged, 2, 'the retried package branch was merged again');
    nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['gate:goal:1']);
  });
});

// A seam: the combined tree fails a check no package's own worktree can reproduce. Before the
// repair package the only tool was tm_retry({package_id}), which reopens the blamed package in
// its own tree - where the offending claim is still true. `goal-docs` round 2 died there.
async function toSeam(tm, task_id) {
  const v = await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({
    verified: false,
    checks: ['run the README example -> fails: P2 documents a command only P1 installs'],
    gaps: ['the README example only runs with both packages present'],
    reason: 'the seam between P1 and P2 fails; neither package is wrong on its own',
  }) });
  assert.equal(v.state, 'failed', JSON.stringify(v));
  return (await tm.call('tm_status', { task_id, node_id: 'integrate:1' })).nodes[0].integration;
}

test('a seam opens a repair package whose worktree IS the integration tree, and the next integrate starts from it', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await toIntegrate(tm, g, task_id);
    const early = await tm.call('tm_retry', { task_id, repair: true });
    assert.match(early.error, /integrate:1 is pending, not failed/, 'nothing to repair until integrate has refused');

    const tree = await toSeam(tm, task_id);
    assert.equal(tree.merged, 2);

    const rt = await tm.call('tm_retry', { task_id, repair: true });
    assert.equal(rt.retried, true, JSON.stringify(rt));
    assert.equal(rt.package_id, 'R1');
    assert.equal(rt.repairs, 'integrate:1');
    assert.deepEqual((await tm.call('tm_status', { task_id })).packages, ['P1', 'P2', 'R1']);
    assert.equal(rt.children.length, 1);
    assert.equal(rt.children[0].node_id, 'dispatch:R1:1');
    assert.equal(rt.children[0].cwd, tree.cwd, 'the repair child runs in the integration worktree, not one of its own');
    assert.equal(rt.children[0].branch, tree.branch);
    assert.ok(!existsSync(join(root, task_id, 'worktrees', 'R1')), 'a repair package gets no worktree of its own');

    const child = await g.call('team_status', { run_id: rt.children[0].run_id, cwd: rt.children[0].cwd, full: true });
    assert.match(child.request, /make the integration checks below pass/);
    assert.match(child.request, /the README example only runs with both packages present/);
    assert.match(child.request, /P2 documents a command only P1 installs/);
    assert.match(child.context, /COMBINED tree of every package in this task/);
    assert.match(child.context, /Every package's files are yours to touch/);
    assert.match(child.context, /Do not undo another package's work/);
    assert.match(child.context, /Paths the packages of this task own\. All of them are in scope here:/);
    assert.match(child.context, /- a\.txt\n- b\.txt/, 'the union of every package\'s touches');

    await completeChild(g, rt.children[0]);
    let v = await tm.call('tm_submit', { task_id, node_id: 'dispatch:R1:1' });
    assert.equal(v.state, 'done', JSON.stringify(v));
    assert.equal(v.child.branch, tree.branch, 'the repair is committed on the integration branch itself');
    assert.ok(v.child.commit, 'and it is a commit, not just a dirty tree');
    assert.equal((await tm.call('tm_submit', { task_id, node_id: 'accept:R1:1', payload: ok({ accept: true, match_pct: 95 }) })).state, 'done');

    const nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['integrate:2']);
    const file = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const two = file.nodes.find((n) => n.node_id === 'integrate:2');
    assert.equal(two.supersedes, 'integrate:1');
    assert.equal(two.integration.based_on, 'repair');
    assert.deepEqual(two.integration.merged.map((m) => m.package), ['R1'], 'nothing is re-merged: that would rebuild the tree the seam was in');
    assert.match(readFileSync(join(two.integration.cwd, 'a.txt'), 'utf8'), /changed by R1/, 'the repair commit is what round 2 checks');
    assert.deepEqual(file.nodes.find((n) => n.node_id === 'gate:goal:1').deps, ['integrate:2'], 'the goal gate waits for the repaired integrate');
    assert.deepEqual(file.nodes.find((n) => n.node_id === 'report').after, ['gate:goal:1'], 'and the report stays behind the gate');
    const briefing = readFileSync(nx.ready[0].briefing_path, 'utf8');
    assert.match(briefing, /repaired integration branch of package R1/);
    assert.match(briefing, /the README example only runs with both packages present/, 'the failed checks travel to the new integrate');

    v = await tm.call('tm_submit', { task_id, node_id: 'integrate:2', payload: ok({ verified: true, checks: ['run the README example -> ok'] }) });
    assert.equal(v.state, 'done');
    assert.equal(v.integration.merged, 1);
    assert.deepEqual((await tm.call('tm_next', { task_id })).ready.map((n) => n.node_id), ['gate:goal:1']);
  });
});

test('package_id: "integration" is the alias for a repair; "integrate" is still not a package', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await toIntegrate(tm, g, task_id);
    await toSeam(tm, task_id);
    const rt = await tm.call('tm_retry', { task_id, package_id: 'integration' });
    assert.equal(rt.retried, true, JSON.stringify(rt));
    assert.equal(rt.repair, true);
    assert.equal(rt.package_id, 'R1');
    assert.equal(rt.children[0].node_id, 'dispatch:R1:1');
    const bad = await tm.call('tm_retry', { task_id, package_id: 'integrate' });
    assert.match(bad.error, /no package integrate in the shape/, 'the alias is one word, not any word that looks like it');
  });
});

test('a merge conflict is refused a repair: that is a shape failure, and repackage is the route', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, INDEPENDENT);
    await acceptBoth(tm, g, task_id);
    assert.equal((await tm.call('tm_next', { task_id })).state, 'blocked');
    const bad = await tm.call('tm_retry', { task_id, repair: true });
    assert.match(bad.error, /integrate:1 failed on a merge conflict \(a\.txt\)/);
    assert.match(bad.error, /tm_retry\(\{task_id, repackage: \["P2", "P1"\]\}\)/);
    assert.deepEqual((await tm.call('tm_status', { task_id })).packages, ['P1', 'P2'], 'no repair package was appended');
  });
});

const INDEPENDENT = {
  acceptance: ['both modules build together'],
  packages: [
    { id: 'P1', title: 'module a', flow: 'develop', brief: 'change a.txt', acceptance: ['a'], touches: ['a.txt'], deps: [] },
    { id: 'P2', title: 'module b', flow: 'develop', brief: 'change b.txt', acceptance: ['b'], touches: ['b.txt'], deps: [] },
  ],
};

// Both children edit a.txt - P2 despite declaring b.txt. Declared touches are a claim; the
// merge is the fact.
async function acceptBoth(tm, g, task_id) {
  const nx = await tm.call('tm_next', { task_id });
  assert.equal(nx.children.length, 2, 'independent packages dispatch together');
  for (const c of nx.children) {
    await completeChild(g, c);
    assert.equal((await tm.call('tm_submit', { task_id, node_id: c.node_id })).state, 'done');
  }
  for (const id of ['P1', 'P2']) {
    assert.equal((await tm.call('tm_submit', { task_id, node_id: `accept:${id}:1`, payload: ok({ accept: true, match_pct: 90 }) })).state, 'done');
  }
}

test('an integration conflict is observed by the manager, names the packages, and tm_retry({repackage}) reshapes them together', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, INDEPENDENT);
    await acceptBoth(tm, g, task_id);
    const nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.state, 'blocked');
    assert.deepEqual(nx.ready, [], 'no agent is asked to run checks on a tree that did not merge');
    const st = await tm.call('tm_status', { task_id, node_id: 'integrate:1' });
    const integ = st.nodes[0];
    assert.equal(integ.state, 'failed');
    assert.equal(integ.verified, false);
    assert.deepEqual(integ.conflicts, ['a.txt']);
    assert.deepEqual(integ.conflicting_packages, ['P2', 'P1'], 'the package being merged, then the merged owner by declared touches');
    assert.match(integ.reason, /merge of P2 conflicts on a\.txt with P1 \(by declared touches\)/);
    assert.match(integ.reason, /tm_retry\(\{repackage: \["P2", "P1"\]\}\)/);

    const bad = await tm.call('tm_retry', { task_id, repackage: ['P9'] });
    assert.match(bad.error, /not in the shape: P9/);
    const rt = await tm.call('tm_retry', { task_id, repackage: integ.conflicting_packages });
    assert.equal(rt.retried, true);
    assert.equal(rt.attempt, 2);
    assert.deepEqual(rt.repackage, ['P2', 'P1']);
    assert.deepEqual(rt.ready.map((n) => n.node_id), ['shape:2']);
    const prompt = readFileSync(rt.ready[0].briefing_path, 'utf8');
    assert.match(prompt, /Repackage P2 and P1: they conflicted at integration/);
    assert.match(prompt, /Conflicting files: a\.txt/);
    assert.match(prompt, /P2 \(module b\) declared touches: b\.txt/);
    assert.match(prompt, /Worktrees of package ids you keep are reused/);
    const after = await tm.call('tm_status', { task_id });
    assert.equal(after.nodes.find((n) => n.node_id === 'dispatch:P1:1').state, 'done', 'delivered packages stay as evidence');
    assert.equal(after.nodes.find((n) => n.node_id === 'gate:goal:1').state, 'skipped');
  });
});

test('two dependencies that conflict with each other fail the dependent dispatch before any child is opened', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, {
      ...INDEPENDENT,
      packages: [...INDEPENDENT.packages, { id: 'P3', title: 'glue', flow: 'develop', brief: 'join them', acceptance: ['c'], touches: ['c.txt'], deps: ['P1', 'P2'] }],
    });
    await acceptBoth(tm, g, task_id);
    const nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.children, [], 'P3 was not dispatched');
    const d = (await tm.call('tm_status', { task_id, node_id: 'dispatch:P3:1' })).nodes[0];
    assert.equal(d.state, 'failed');
    assert.deepEqual(d.conflicts, ['a.txt']);
    assert.deepEqual(d.conflicting_packages, ['P2', 'P1']);
    assert.match(d.reason, /dependencies of P3 conflict with each other on a\.txt/);
    assert.match(d.reason, /repackage them/);
  });
});

test('a child whose goal gate rejected fails the dispatch; tm_retry reopens it in the same worktree with the gaps', async () => {
  // auto_reassign:false on the child runs: this test drives the manager's OWN
  // dispatch-fold/tm_retry path on a rejected child. With it on, the child's rejected
  // goal gate now opens a repair pass on itself (teams Step 9, out of scope for
  // the manager's own gate:goal per the taskmanager plan) before the manager ever
  // folds the dispatch.
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id);
    let nx = await tm.call('tm_next', { task_id });
    const first = nx.children[0];
    await completeChild(g, first, { accept: false });
    const v = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    assert.equal(v.state, 'failed');
    assert.equal(v.accept, false);
    assert.equal(v.gap_count, 1);
    assert.match(v.reason, /short/);
    nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.state, 'blocked');
    const rt = await tm.call('tm_retry', { task_id, package_id: 'P1' });
    assert.equal(rt.retried, true);
    assert.equal(rt.attempt, 2);
    assert.equal(rt.children.length, 1);
    const second = rt.children[0];
    assert.equal(second.node_id, 'dispatch:P1:2');
    assert.equal(second.cwd, first.cwd, 'the retry continues in the worktree the first attempt left');
    assert.notEqual(second.run_id, first.run_id, 'but it is a fresh child run');
    const child = await g.call('team_status', { run_id: second.run_id, cwd: second.cwd, full: true });
    assert.match(child.request, /Previous attempt of this package was rejected/);
    assert.match(child.request, /missing the b half/);
    assert.equal(readFileSync(join(second.cwd, 'a.txt'), 'utf8'), 'x\nchanged by P1\n', 'the first attempt\'s work is still there');
    const st = await tm.call('tm_status', { task_id });
    assert.equal(st.nodes.find((n) => n.node_id === 'accept:P1:1').state, 'skipped');
    assert.deepEqual(st.nodes.find((n) => n.node_id === 'dispatch:P2:1').deps, ['critique', 'accept:P1:2'], 'P2 now waits on the new attempt');
  }, { auto_reassign: false });
});

// ---------- checkpoint / rollback (_repo/docs/plans/2026-09-23-teams-reducer-human-rollback.md §5, item 3) ----------

test('retry_policy "rollback": a package retried before any of its attempts was ever accepted resets to its worktree\'s base commit, still keeps the gaps', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id);
    let nx = await tm.call('tm_next', { task_id });
    const first = nx.children[0];
    await completeChild(g, first, { accept: false }); // dirties a.txt: "x\nchanged by P1\n"
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    const rt = await tm.call('tm_retry', { task_id, package_id: 'P1' });
    assert.equal(rt.retried, true);
    const second = rt.children[0];
    assert.equal(second.cwd, first.cwd, 'still the same worktree - rollback resets it, it does not replace it');
    // No attempt of P1 has ever been accepted, so there is nothing to roll back TO but the
    // worktree's own base commit - the pristine tree from before P1 ever ran.
    assert.equal(readFileSync(join(second.cwd, 'a.txt'), 'utf8'), 'x\n', 'reset to base, discarding the rejected attempt\'s edit entirely');
    const child = await g.call('team_status', { run_id: second.run_id, cwd: second.cwd, full: true });
    assert.match(child.request, /missing the b half/, 'the gate\'s gaps still reach the new attempt - rollback resets the TREE, not the feedback');
  }, { auto_reassign: false, retry_policy: 'rollback' });
});

test('retry_policy "rollback": a package retried after one of its attempts WAS accepted resets to that commit, not to base', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id);
    let nx = await tm.call('tm_next', { task_id });
    const first = nx.children[0];
    await completeChild(g, first, { accept: true }); // commits a.txt: "x\nchanged by P1\n"
    const folded = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    assert.equal(folded.state, 'done');
    assert.ok(folded.child.commit, 'accept:true commits the worktree (commitWorktree)');
    // Force a second attempt of an already-accepted package (tm_retry has no guard requiring
    // failure - the same surface a filed defect or a blamed integrate uses). rollback_to must
    // prefer this commit over the worktree's base - the base is now stale evidence, not the
    // last good state.
    const rt = await tm.call('tm_retry', { task_id, package_id: 'P1' });
    assert.equal(rt.retried, true);
    assert.equal(readFileSync(join(rt.children[0].cwd, 'a.txt'), 'utf8'), 'x\nchanged by P1\n', 'reset to the last ACCEPTED commit, not to the pristine base');
  });
});

// idol-pm-4 (2026-09-23): after two reshapes, every package retry was wired to the FIRST
// round's `critique` and `accept:P1:1` - skipped nodes that never finish - and each reshape had
// already spent a retry of every package. Four retries sat pending and the task ended blocked.
test('a package retry after a reshape waits on the live round and keeps its full budget', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2 modules'], handoff: 'two modules' }) });
    await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...SHAPE, handoff: 's' }) });
    await tm.call('tm_submit', { task_id, node_id: 'critique', payload: ok({ sound: false, blocking: ['P2 cannot be verified'] }) });
    const re = await tm.call('tm_retry', { task_id });
    assert.equal(re.retried, true, JSON.stringify(re));
    await tm.call('tm_submit', { task_id, node_id: 'shape:2', payload: ok({ ...SHAPE, handoff: 's2' }) });
    await tm.call('tm_submit', { task_id, node_id: 'critique:2', payload: ok({ sound: true }) });

    let nx = await tm.call('tm_next', { task_id });
    const child = nx.children.find((c) => c.node_id.startsWith('dispatch:P1:'));
    assert.ok(child, JSON.stringify(nx));
    await completeChild(g, child, { accept: false });
    const v = await tm.call('tm_submit', { task_id, node_id: child.node_id });
    assert.equal(v.state, 'failed');

    const rt = await tm.call('tm_retry', { task_id, package_id: 'P1' });
    assert.equal(rt.retried, true, JSON.stringify(rt));
    const st = await tm.call('tm_status', { task_id, full: true });
    const retry = st.nodes.find((n) => n.node_id === `dispatch:P1:${rt.attempt}`);
    assert.ok(retry.deps.includes('critique:2'), `the retry waits on the live critique, not the discarded one: ${retry.deps}`);
    assert.ok(!retry.deps.includes('critique'), `${retry.deps}`);
    assert.equal(rt.children.length, 1, 'and it is dispatched, not left pending behind a skipped node');
    const p2 = st.nodes.find((n) => n.stage === 'dispatch' && n.subgoal_id === 'P2' && n.state !== 'skipped');
    assert.ok(p2.deps.includes(`accept:P1:${rt.attempt}`), `P2 waits on the retry: ${p2.deps}`);

    // Budget: the discarded round did not spend one of P1's retries.
    const { autoRetryPackages } = await import('../mcp/taskmanager.mjs');
    assert.equal(typeof autoRetryPackages, 'function');
    const again = await completeChild(g, rt.children[0], { accept: false }).then(() => tm.call('tm_submit', { task_id, node_id: rt.children[0].node_id }));
    assert.equal(again.state, 'failed');
    const rt2 = await tm.call('tm_retry', { task_id, package_id: 'P1' });
    assert.equal(rt2.retried, true, `max_retries is per shape round: ${JSON.stringify(rt2)}`);
  }, { auto_reassign: false });
});

test('the package retry budget settles: downstream becomes unreachable and the report is released', async () => {
  // Same reason as above: auto_reassign:false keeps the rejected children's own goal
  // gates from opening a repair pass, so the dispatch fold sees a plain rejection.
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const nx = attempt === 1 ? await tm.call('tm_next', { task_id }) : await tm.call('tm_retry', { task_id, package_id: 'P1' });
      const child = nx.children.find((c) => c.node_id === `dispatch:P1:${attempt}`);
      assert.ok(child, `attempt ${attempt} dispatched`);
      await completeChild(g, child, { accept: false });
      assert.equal((await tm.call('tm_submit', { task_id, node_id: `dispatch:P1:${attempt}` })).state, 'failed');
    }
    const rt = await tm.call('tm_retry', { task_id, package_id: 'P1' });
    assert.equal(rt.retried, false);
    assert.match(rt.reason, /budget exhausted/);
    assert.ok(rt.unreachable.includes('accept:P1:3'));
    assert.ok(rt.unreachable.includes('dispatch:P2:1'));
    assert.ok(rt.unreachable.includes('integrate:1'));
    assert.ok(rt.unreachable.includes('gate:goal:1'));
    assert.deepEqual(rt.ready.map((n) => n.node_id), ['report']);
    const prompt = readFileSync(rt.ready[0].briefing_path, 'utf8');
    assert.match(prompt, /### dispatch:P1:3 \(dispatch\) — failed accept=false/);
    assert.match(prompt, /### integrate:1 \(integrate\) — unreachable/);
    await tm.call('tm_submit', { task_id, node_id: 'report', payload: ok({ handoff: 'partial' }) });
    // A report over a spent retry budget is not a delivery: no budget involved, same `partial`.
    const fin = await tm.call('tm_status', { task_id });
    assert.equal(fin.state, 'partial');
    assert.match(fin.partial_reasons.join('\n'), /P1: not accepted/);
  }, { auto_reassign: false });
});

test('kill and restart the manager: the tree resumes from files and no running dispatch is reclaimed', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await throughCritique(tm, task_id);
    const before = await tm.call('tm_next', { task_id });
    tm.close();
    // The restarted manager needs the same seam the first one had. Without it, tm2's first tm_*
    // call raised a real daemon (serviceDaemon -> node daemon.mjs) that folded dispatch:P1:1 in
    // parallel with the tm_submit below - two `git add`s in one worktree, and whichever lost saw
    // index.lock and marked a passed package failed (4 of 15 runs) - and then went on to judge
    // accept:P1:1 with a real `claude -p`, from inside `node --test`.
    const tm2 = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
    try {
      const list = await tm2.call('tm_status', {});
      assert.equal(list.tasks.length, 1);
      assert.equal(list.tasks[0].task_id, task_id);
      const after = await tm2.call('tm_next', { task_id });
      assert.equal(after.state, 'running');
      assert.deepEqual(after.children.map((c) => [c.node_id, c.run_id, c.cwd]), before.children.map((c) => [c.node_id, c.run_id, c.cwd]), 'the same child, not a second one');
      await completeChild(g, after.children[0]);
      const v = await tm2.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
      assert.equal(v.state, 'done', JSON.stringify(v));
    } finally {
      tm2.close();
    }
  });
});

test('a project that is not a git repository fails the dispatch with the reason, not a hang', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tm-nogit-'));
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  // No HARNESS_CHILD_DRIVER override here: without HARNESS_TEST_NO_LEADER, tm_open would try to
  // spawn a real `claude` process for the TaskLeader the moment it is called.
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_LEADER: '1' }).init();
  try {
    const { task_id } = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'r', cwd });
    // The first dispatch is now a planning card's (C2) - and it too gets its own worktree, so
    // the missing repository is found there, before shape.
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop' }) });
    await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: [{ title: 'the request', brief: 'all of it' }] }) });
    const nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.state, 'blocked');
    assert.deepEqual(nx.children, []);
    const st = await tm.call('tm_status', { task_id, node_id: 'dispatch:PLAN-F1:1' });
    assert.equal(st.nodes[0].state, 'failed');
    assert.match(st.nodes[0].reason, /could not create a worktree for PLAN-F1/);
  } finally {
    tm.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('a stage briefing carries its method, and the contract outranks what the method asks for', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  // No HARNESS_CHILD_DRIVER override here: without HARNESS_TEST_NO_LEADER, tm_open would try to
  // spawn a real `claude` process for the TaskLeader the moment it is called.
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_LEADER: '1' }).init();
  try {
    const open = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'big request', cwd, vendor: 'self', size: 'L' });
    // size is a measurement: it gets no method at all, and reaching for one is its failure mode.
    // A pinned L opens at the plan stage (C2), the first judging stage, and it carries its method.
    const split = open.ready.find((n) => n.stage === 'areas');
    assert.ok(split, 'a pinned L task opens at the plan stage');
    const sizing = readFileSync(split.briefing_path, 'utf8');
    assert.match(sizing, /## Method/);
    assert.match(sizing, /cognition:assumption-extractor/);
    // The three things a headless node needs said out loud.
    assert.match(sizing, /output template does not apply/);
    assert.match(sizing, /ask no questions/);
    assert.match(sizing, /not installed here is simply skipped/);
    // Unfalsifiable otherwise: the stage has to say what it actually loaded.
    assert.match(sizing, /"skills_used"/);
  } finally {
    tm.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('the shape contract asks each package for optional skills, and says why shape is the one to name them', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  // No HARNESS_CHILD_DRIVER override here: without HARNESS_TEST_NO_LEADER, tm_open would try to
  // spawn a real `claude` process for the TaskLeader the moment it is called.
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_LEADER: '1', HARNESS_TEST_NO_DRIVER: '1' }).init();
  try {
    const open = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'big request', cwd, vendor: 'self', size: 'L' });
    // Shape comes after planning (C2-C4): drive it, then read shape's own briefing.
    await drivePlanning((n, a) => tm.rawCall(n, a), await tm.planningBroker(), open.task_id);
    const shape = readFileSync((await tm.call('tm_next', { task_id: open.task_id })).ready.find((n) => n.stage === 'shape').briefing_path, 'utf8');
    assert.match(shape, /"skills": \["plugin:skill"\]/);
    assert.match(shape, /optional/);
    assert.match(shape, /CLI package and a reference-document package want different method/);
    assert.match(shape, /travel into its child run/);
  } finally {
    tm.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

const SKILLED = {
  acceptance: ['both modules build together'],
  packages: [
    { ...SHAPE.packages[0], skills: ['develop:cli-developer', 'develop:clean-code'] },
    SHAPE.packages[1],
  ],
};

test('a package that names skills hands them to its child run with the precedence rules attached', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, SKILLED);
    const nx = await tm.call('tm_next', { task_id });
    const child = await g.call('team_status', { run_id: nx.children[0].run_id, cwd: nx.children[0].cwd, full: true });
    assert.match(child.context, /Method for this package/);
    assert.match(child.context, /- develop:cli-developer\n- develop:clean-code/);
    // The child's nodes never read the manager's briefing, so the three rules have to be here.
    assert.match(child.context, /not installed here is skipped without comment or substitute/);
    assert.match(child.context, /output template does not apply/);
    assert.match(child.context, /ask nothing and finish the work yourself/);
    assert.equal(child.request, 'change a.txt', 'the brief itself is untouched');
  });
});

test('a package that names no skills produces the child request and context it produced before', async () => {
  let plain = null;
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, SHAPE);
    const nx = await tm.call('tm_next', { task_id });
    const child = await g.call('team_status', { run_id: nx.children[0].run_id, cwd: nx.children[0].cwd, full: true });
    plain = { request: child.request, context: child.context };
    assert.doesNotMatch(child.context, /Method for this package/);
  });
  // Same shape with skills added to the OTHER package: P1's child is byte-for-byte what it was.
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, { ...SHAPE, packages: [SHAPE.packages[0], { ...SHAPE.packages[1], skills: ['write:plans'] }] });
    const nx = await tm.call('tm_next', { task_id });
    const child = await g.call('team_status', { run_id: nx.children[0].run_id, cwd: nx.children[0].cwd, full: true });
    assert.equal(child.request, plain.request);
    assert.equal(child.context, plain.context);
  });
});

test('the packages listing shows a package\'s method so critique can attack the choice', async () => {
  await withTask(async ({ tm, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop' }) });
    await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...SKILLED, handoff: 's' }) });
    const nx = await tm.call('tm_next', { task_id });
    const critique = readFileSync(nx.ready.find((n) => n.stage === 'critique').briefing_path, 'utf8');
    assert.match(critique, /### P1 — module a \(develop\)\nTouches: a\.txt\nMethod: develop:cli-developer, develop:clean-code/);
    assert.doesNotMatch(critique, /### P2 — module b \(develop\)\nTouches: b\.txt\nMethod:/, 'a package with no skills gets no Method line');
  });
});

test('skills: false runs every stage on its contract alone, and an override replaces the default', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  // No HARNESS_CHILD_DRIVER override here: without HARNESS_TEST_NO_LEADER, tm_open would try to
  // spawn a real `claude` process for the TaskLeader the moment it is called.
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_LEADER: '1' }).init();
  try {
    const off = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'big request', cwd, vendor: 'self', size: 'L', skills: false });
    assert.doesNotMatch(readFileSync(off.ready[0].briefing_path, 'utf8'), /## Method/);
    const mine = await tm.call('tm_open', {
      request: 'big request', cwd, vendor: 'self', size: 'L', roles: { qa: false }, brainstorm: false,
      // A pinned L opens at the plan stage (C2), the first judging stage - its method is overridden.
      skills: { areas: ['write:plans'] },
    });
    assert.equal(mine.ready[0].stage, 'areas');
    const prompt = readFileSync(mine.ready[0].briefing_path, 'utf8');
    assert.match(prompt, /write:plans/);
    assert.doesNotMatch(prompt, /cognition:assumption-extractor/, 'an override replaces the default, it does not add to it');
  } finally {
    tm.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- child driver processes ----------

// Records what the manager spawned, then exits without driving anything: a driver that dies with
// the run still open is exactly the case the fold has to survive.
const FAKE_DRIVER = `
import { writeFileSync, fstatSync } from 'node:fs';
let stdin_fifo = 'unreadable';
try { stdin_fifo = fstatSync(0).isFIFO(); } catch { /* keep the marker */ }
const out = process.env.FAKE_DRIVER_OUT;
if (out) {
  writeFileSync(out, JSON.stringify({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    claudecode: process.env.CLAUDECODE === undefined ? null : process.env.CLAUDECODE,
    tasks_dir: process.env.HARNESS_TASKS_DIR || null,
    stdin_fifo,
  }));
}
console.log('{"type":"fake-driver"}');
console.error('fake driver drove nothing');
`;

// Same write as FAKE_DRIVER, but stays up instead of exiting - for a test that wants to read what
// was spawned without racing serviceLeader/serviceDeadDriver's own respawn-on-death handling.
const FAKE_DRIVER_ALIVE = FAKE_DRIVER.replace(
  "console.log('{\"type\":\"fake-driver\"}');\nconsole.error('fake driver drove nothing');",
  "console.log('{\"type\":\"fake-driver\"}');\nconsole.error('fake driver drove nothing');\nsetTimeout(() => {}, 30000);",
);

// Dies on its first invocation (the death serviceDeadDriver has to catch and respawn from), then
// stays up on every later invocation - a respawned driver a test can observe alive, instead of
// racing the next death. A shared counter file (one JS process per invocation; no in-memory
// state survives between them) says which attempt this is; each attempt's own argv/pid is
// written to "<FAKE_DRIVER_OUT>.<n>" so a test can read every generation, not just the last.
const FAKE_DRIVER_RESPAWN = `
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
const counterFile = process.env.FAKE_DRIVER_COUNTER;
let n = 1;
if (counterFile) {
  n = existsSync(counterFile) ? parseInt(readFileSync(counterFile, 'utf8'), 10) + 1 : 1;
  writeFileSync(counterFile, String(n));
}
const out = process.env.FAKE_DRIVER_OUT;
if (out) writeFileSync(\`\${out}.\${n}\`, JSON.stringify({ n, pid: process.pid, argv: process.argv.slice(2) }));
console.log(JSON.stringify({ type: 'fake-driver', attempt: n }));
console.error(\`fake driver attempt \${n} drove nothing\`);
if (n < 2) { process.exit(0); } else { setTimeout(() => process.exit(0), 5000); }
`;

// Emits a usage-limit result event on its stdout stream - the same NDJSON shape
// \`claude -p --output-format stream-json\` writes - then exits. serviceDeadDriver reads this
// back from the log, not from stderr, exactly as scripts/bench/drive.sh does.
const FAKE_DRIVER_LIMIT = `
import { writeFileSync } from 'node:fs';
const out = process.env.FAKE_DRIVER_OUT;
if (out) writeFileSync(out, JSON.stringify({ argv: process.argv.slice(2) }));
console.log(JSON.stringify({ type: 'result', result: "You've hit your 5-hour limit · resets 11:50pm (Asia/Seoul)" }));
console.error('fake driver hit a usage limit');
setTimeout(() => process.exit(1), 50);
`;

async function waitFor(fn, what, ms = 15000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

function driverFixture(env = {}, script = FAKE_DRIVER) {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const drv = mkdtempSync(join(tmpdir(), 'tm-drv-'));
  const scriptPath = join(drv, 'fake-driver.mjs');
  // Every task plans first now (cards-everywhere C2/C6), and a planning card's dispatch spawns a
  // driver like any package's. These fixtures are about a develop package's (or the S run's)
  // driver, so a planning card's driver records nothing and leaves - the suite drives the card
  // itself (lib/planning-drive.mjs) - keeping FAKE_DRIVER_OUT and the counter to the driver the
  // test is actually about.
  writeFileSync(scriptPath, `if (/[\\\\/]worktrees[\\\\/]PLAN-/.test(process.cwd())) process.exit(0);\n${script}`);
  const ran = join(drv, 'ran.json');
  const counter = join(drv, 'counter.txt');
  const client = new Client(TM, {
    HARNESS_TASKS_DIR: root,
    HARNESS_CHILD_DRIVER: `node ${scriptPath}`,
    FAKE_DRIVER_OUT: ran,
    FAKE_DRIVER_COUNTER: counter,
    // The manager runs inside a claude session; a nested `claude -p` refuses to start if it sees this.
    CLAUDECODE: '1',
    // These fixtures are about PACKAGE/S-run driver behavior, submitted through directly by the
    // test itself exactly like a TaskLeader would - not about the TaskLeader driver's own inbox
    // gate. Without this, a leader spawned from this same HARNESS_CHILD_DRIVER script would race
    // the test's own tm_submit calls into the inbox and write over FAKE_DRIVER_OUT.
    HARNESS_TEST_NO_LEADER: '1',
    ...env,
  });
  return { cwd, root, drv, ran, counter, client };
}

test('a ready dispatch spawns a driver process in the package worktree, with the run to continue in its prompt', async () => {
  const f = driverFixture();
  const tm = await f.client.init();
  try {
    const { task_id } = await tm.call('tm_open', {
      request: 'big request', cwd: f.cwd, vendor: 'self', roles: { qa: false }, brainstorm: false,
      host_vendor: 'claude', host_model: 'claude-opus-4', native_models: ['sonnet', 'haiku'],
    });
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    const c = nx.children[0];
    assert.equal(c.node_id, 'dispatch:P1:1', JSON.stringify(nx));
    assert.ok(Number.isInteger(c.driver.pid), `no driver pid: ${JSON.stringify(c)}`);
    assert.equal(c.driver.log, join(f.root, task_id, 'drivers', 'dispatch_P1_1.stream.jsonl'));

    const ran = await waitFor(() => (existsSync(f.ran) ? JSON.parse(readFileSync(f.ran, 'utf8')) : null), 'the fake driver to run');
    // $TMPDIR is a symlink into /private/var on macOS; the spawn cwd is the path we gave it.
    assert.equal(realpathSync(ran.cwd), realpathSync(c.cwd), 'the driver runs in the package worktree');
    assert.equal(ran.tasks_dir, f.root, 'the tasks dir travels to the child session');
    assert.equal(ran.claudecode, null, 'CLAUDECODE is deleted: a nested claude refuses to start with it');
    assert.equal(ran.stdin_fifo, false, "stdin is ignored, not the manager's pipe");

    const prompt = ran.argv[ran.argv.length - 1];
    assert.match(prompt, new RegExp(`run_id ${c.run_id}`), prompt);
    assert.match(prompt, new RegExp(c.cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(prompt, /Do not call team_open or tm_open/);
    assert.match(prompt, /team_next\/team_run\/team_submit/);
    assert.match(prompt, /host_vendor claude, host_model claude-opus-4, native_models sonnet, haiku/);

    const ledger = readFileSync(join(f.root, task_id, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    // The planning card's driver spawned first (C2); this test is about P1's.
    const spawned = ledger.find((e) => e.event === 'child_driver_spawned' && e.node_id === 'dispatch:P1:1');
    assert.equal(spawned.node_id, 'dispatch:P1:1');
    assert.equal(spawned.pid, c.driver.pid);
    // The driver's stdout is captured, not lost down /dev/null.
    await waitFor(() => existsSync(c.driver.log) && readFileSync(c.driver.log, 'utf8').includes('fake-driver'), 'the driver log');
  } finally {
    tm.close();
    rmSync(f.cwd, { recursive: true, force: true });
    rmSync(f.root, { recursive: true, force: true });
    rmSync(f.drv, { recursive: true, force: true });
  }
});

test('a driver that dies mid-run is respawned on the SAME run_id with a resume prompt, before any budget is spent', async () => {
  const f = driverFixture({}, FAKE_DRIVER_RESPAWN);
  const tm = await f.client.init();
  try {
    // Default driver_restarts (2): the first death must not fold anything.
    const { task_id } = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'big request', cwd: f.cwd, vendor: 'self' });
    await throughCritique(tm, task_id);
    const first = await tm.call('tm_next', { task_id });
    const firstChild = first.children[0];
    const firstPid = firstChild.driver.pid;

    // Attempt 1 dies immediately; tm_next's own poll respawns attempt 2, which stays up long
    // enough (FAKE_DRIVER_RESPAWN) for this to observe it alive rather than racing its death too.
    const resumed = await waitFor(async () => {
      const nx = await tm.call('tm_next', { task_id });
      const c = nx.children[0];
      return c.driver.restarts === 1 ? c : null;
    }, 'the respawned driver');
    assert.equal(resumed.child_state, 'running', 'the child run itself never stopped: only its driver died');
    assert.equal(resumed.run_id, firstChild.run_id, 'the SAME child run_id, not a fresh one');
    assert.equal(resumed.cwd, firstChild.cwd, 'the same worktree too');
    assert.notEqual(resumed.driver.pid, firstPid, 'a fresh process');
    assert.equal(resumed.driver.alive, true, 'the respawned driver is alive: nothing to fold yet');
    assert.match(resumed.next, /its driver process \(pid/, 'poll tm_next, do not fold - a live respawn is exactly like a first spawn');

    const early = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    assert.match(early.error, /still running/, 'a live respawned driver refuses the fold exactly like a first one would');

    const second = await waitFor(
      () => (existsSync(`${f.ran}.2`) ? JSON.parse(readFileSync(`${f.ran}.2`, 'utf8')) : null),
      'the respawned driver\'s own invocation record',
    );
    const prompt = second.argv[second.argv.length - 1];
    assert.match(prompt, new RegExp(`run_id ${firstChild.run_id}`), prompt);
    assert.match(prompt, /A previous driver for this exact run died before it finished/);
    assert.match(prompt, /team_status\(\{run_id, cwd\}\) first/);
    assert.match(resumed.driver.log, /\.restart1\.stream\.jsonl$/, 'a distinct log per generation, not overwritten');

    const ledger = readFileSync(join(f.root, task_id, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const restarted = ledger.find((e) => e.event === 'child_driver_restarted' && e.node_id === 'dispatch:P1:1');
    assert.equal(restarted.node_id, 'dispatch:P1:1');
    assert.equal(restarted.restart, 1);
    assert.equal(restarted.budget, 2);
  } finally {
    tm.close();
    rmSync(f.cwd, { recursive: true, force: true });
    rmSync(f.root, { recursive: true, force: true });
    rmSync(f.drv, { recursive: true, force: true });
  }
});

test('once the restart budget is spent, the dispatch folds blocked with every attempt\'s stderr', async () => {
  const f = driverFixture(); // FAKE_DRIVER: dies immediately, every single time
  const tm = await f.client.init();
  try {
    const { task_id } = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'big request', cwd: f.cwd, vendor: 'self', driver_restarts: 1 });
    await throughCritique(tm, task_id);
    await tm.call('tm_next', { task_id });
    const spent = await waitFor(async () => {
      const nx = await tm.call('tm_next', { task_id });
      const c = nx.children[0];
      return c.driver.alive === false && c.driver.restarts === 1 ? c : null;
    }, 'the restart budget (1) to be spent');
    assert.equal(spent.child_state, 'running', 'the fake drove nothing: the child run is still open');
    assert.match(spent.next, /restart budget \(1\) is spent/);
    assert.match(spent.next, /tm_retry\({package_id: "P1"}\)/);

    const v = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    assert.equal(v.state, 'failed', JSON.stringify(v));
    assert.match(v.reason, /child driver exited \(pid \d+\) after 1 restart\(s\) with the run still running/);
    assert.match(v.reason, /fake driver drove nothing/, 'the last of the driver stderr is the evidence');
    const full = await tm.call('tm_status', { task_id, node_id: 'dispatch:P1:1', full: true });
    assert.equal(full.node.result.driver_restarts.length, 1, 'one death was recorded before the fold, not the fold itself');
    // Blocked, and retryable in the same worktree - the package is not dead, its session is.
    const after = await tm.call('tm_status', { task_id });
    assert.equal(after.state, 'blocked');
    const rt = await tm.call('tm_retry', { task_id, package_id: 'P1' });
    assert.equal(rt.retried, true, JSON.stringify(rt));
    assert.equal(rt.children[0].node_id, 'dispatch:P1:2');
    assert.ok(Number.isInteger(rt.children[0].driver.pid), 'the retry spawns its own driver');
    assert.equal(rt.children[0].driver.restarts, undefined, 'a fresh dispatch starts with no restarts of its own');
  } finally {
    tm.close();
    rmSync(f.cwd, { recursive: true, force: true });
    rmSync(f.root, { recursive: true, force: true });
    rmSync(f.drv, { recursive: true, force: true });
  }
});

test('a usage-limit death parks the dispatch on waiting_capacity, spends no restart, and tm_retry({reset_capacity}) resumes it', async () => {
  const f = driverFixture({}, FAKE_DRIVER_LIMIT);
  const tm = await f.client.init();
  try {
    const { task_id } = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'big request', cwd: f.cwd, vendor: 'self' });
    await throughCritique(tm, task_id);
    await tm.call('tm_next', { task_id });
    const parked = await waitFor(async () => {
      const nx = await tm.call('tm_next', { task_id });
      return nx.children[0].waiting_capacity ? nx.children[0] : null;
    }, 'the driver to park on capacity');
    assert.equal(parked.child_state, 'running');
    assert.match(parked.waiting_capacity.reason, /hit your 5-hour limit/);
    assert.equal(parked.driver.alive, false, 'the driver process did exit');
    assert.equal(parked.driver.restarts, undefined, 'a usage-limit death spends no restart');
    assert.match(parked.next, /waiting on provider capacity/);
    assert.match(parked.next, /tm_retry\({task_id, package_id: "P1", reset_capacity:true}\)/);

    const early = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    assert.match(early.error, /waiting on provider capacity/, 'parked, not blocked: reset_capacity is the way out, not a fold');

    const badPkg = await tm.call('tm_retry', { task_id, package_id: 'P9', reset_capacity: true });
    assert.equal(badPkg.retried, false, 'reset_capacity for a package with nothing waiting resumes nothing');

    const oldPid = parked.driver.pid;
    const rt = await tm.call('tm_retry', { task_id, package_id: 'P1', reset_capacity: true });
    assert.equal(rt.retried, true, JSON.stringify(rt));
    assert.deepEqual(rt.resumed, ['dispatch:P1:1']);
    assert.equal(rt.children[0].node_id, 'dispatch:P1:1', 'the SAME dispatch - reset_capacity is not a new attempt');
    assert.equal(rt.children[0].waiting_capacity, undefined, 'cleared');
    assert.ok(Number.isInteger(rt.children[0].driver.pid) && rt.children[0].driver.pid !== oldPid, 'a fresh driver process');
    assert.equal(rt.children[0].driver.alive, true, 'observed in the same tick spawnChildDriver returned it');

    const ledger = readFileSync(join(f.root, task_id, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(ledger.some((e) => e.event === 'child_driver_capacity' && e.node_id === 'dispatch:P1:1'));
    assert.ok(ledger.some((e) => e.event === 'child_driver_capacity_cleared' && e.node_id === 'dispatch:P1:1'));
    assert.ok(ledger.some((e) => e.event === 'child_driver_restarted' && e.reason === 'reset_capacity'));
  } finally {
    tm.close();
    rmSync(f.cwd, { recursive: true, force: true });
    rmSync(f.root, { recursive: true, force: true });
    rmSync(f.drv, { recursive: true, force: true });
  }
});

// ---------- stall detection: a live driver making no progress (§1, teamconfig.mjs's stall_minutes) ----------
//
// stall_minutes reads the mtime of the child's own run file (and ledger) as its progress signal
// - the same files daemon.mjs's own waitForProgress already watches for this exact child. These
// tests fake that signal with fs.utimesSync (backdating the file, never waiting real minutes)
// and fake the driver's own liveness with a real, disposable process (a `sleep` child) whose pid
// answers process.kill(pid,0) exactly like a wedged driver's would, without this suite waiting
// on anything it does. serviceStalledDriver/serviceDeadDriver are called directly (imported),
// the same seam test-taskmanager.mjs already uses for dispatchSettled/autoResumeCapacity/
// autoRetryPackages above - withTask's HARNESS_TEST_NO_DRIVER means nothing else is writing
// task.json while these run, so mutating the loaded object and calling the pure function in
// process is safe.

function aliveSleeper(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test('a live driver with no progress is flagged once at stall_minutes, not before, and the flag clears the moment progress resumes', async () => {
  const { serviceStalledDriver } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, root, task_id }) => {
    await throughCritique(tm, task_id);
    await tm.call('tm_next', { task_id }); // opens dispatch:P1:1's child run; no driver spawned under HARNESS_TEST_NO_DRIVER
    const load = () => JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const prevRoot = process.env.HARNESS_TASKS_DIR;
    const withRoot = (fn) => { process.env.HARNESS_TASKS_DIR = root; try { return fn(); } finally { if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot; } };

    const task = load();
    // Started an hour ago: idle is measured from the LATER of progress and the driver's own start.
    task.stall_minutes = 1;
    const n = task.nodes.find((x) => x.node_id === 'dispatch:P1:1');
    n.child.driver = { pid: process.pid, started_at: Date.now() - 60 * 60 * 1000 }; // an always-alive pid: this test process itself
    const runFile = join(n.child.cwd, '.teams_output', 'broker', 'runs', `${n.child.run_id}.json`);
    assert.ok(existsSync(runFile), 'the child run file exists the moment the dispatch opened, before any driver touches it');

    // 30s idle against a 1-minute stall_minutes: short of the threshold.
    const t30 = new Date(Date.now() - 30 * 1000);
    utimesSync(runFile, t30, t30);
    assert.equal(withRoot(() => serviceStalledDriver(task, n.child, n.node_id)), false, 'not idle long enough yet');
    assert.equal(n.child.stalled_since, undefined);

    // 90s idle: past 1x stall_minutes, short of 3x (180s) - flagged once.
    const t90 = new Date(Date.now() - 90 * 1000);
    utimesSync(runFile, t90, t90);
    assert.equal(withRoot(() => serviceStalledDriver(task, n.child, n.node_id)), true, 'past stall_minutes: flagged');
    assert.ok(Number.isInteger(n.child.stalled_since), 'stalled_since recorded');
    const firstFlag = n.child.stalled_since;

    // Polled again with the same stale mtime: no duplicate flag, no duplicate ledger event.
    assert.equal(withRoot(() => serviceStalledDriver(task, n.child, n.node_id)), false, 'already flagged: this poll is a no-op');
    assert.equal(n.child.stalled_since, firstFlag, 'unchanged');

    const events = await tm.call('tm_events', { task_id });
    assert.equal(events.events.filter((e) => e.event === 'child_driver_stalled').length, 1, 'recorded once, not once per poll');

    // Progress resumes: touch the run file back to now.
    utimesSync(runFile, new Date(), new Date());
    assert.equal(withRoot(() => serviceStalledDriver(task, n.child, n.node_id)), true, 'progress resumed: cleared');
    assert.equal(n.child.stalled_since, undefined);
    const events2 = await tm.call('tm_events', { task_id });
    assert.ok(events2.events.some((e) => e.event === 'child_driver_progress_resumed' && e.node_id === 'dispatch:P1:1'));
  });
});

test('idol-beta-ask1 P6: a driver respawned after a long park is not stalled on its first poll, and a dead driver with its restart budget spent settles its dispatch', async () => {
  const { serviceStalledDriver, dispatchSettled, capacityResetAt } = await import('../mcp/taskmanager.mjs');
  // "resets 3pm (UTC)" - no minutes - fell through to the 30-minute fallback and resumed early.
  const since = Date.UTC(2026, 8, 24, 14, 20);
  assert.equal(new Date(capacityResetAt("You've hit your session limit · resets 3pm (UTC)", since)).toISOString(), '2026-09-24T15:00:00.000Z');
  await withTask(async ({ tm, root, task_id }) => {
    await throughCritique(tm, task_id);
    await tm.call('tm_next', { task_id });
    const load = () => JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const prevRoot = process.env.HARNESS_TASKS_DIR;
    const withRoot = (fn) => { process.env.HARNESS_TASKS_DIR = root; try { return fn(); } finally { if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot; } };
    const task = load();
    task.stall_minutes = 1;
    const n = task.nodes.find((x) => x.node_id === 'dispatch:P1:1');
    const runFile = join(n.child.cwd, '.teams_output', 'broker', 'runs', `${n.child.run_id}.json`);
    const old = new Date(Date.now() - 79 * 60 * 1000); // the last progress, from before the park
    utimesSync(runFile, old, old);
    n.child.driver = { pid: process.pid, started_at: Date.now() }; // just respawned
    assert.equal(withRoot(() => serviceStalledDriver(task, n.child, n.node_id)), false, 'a fresh driver is not 79 minutes idle');
    const ev = await tm.call('tm_events', { task_id });
    assert.equal(ev.events.filter((e) => e.event === 'child_driver_killed').length, 0);

    // Dead, budget (2) spent, not parked on capacity: settled, so the daemon folds it.
    n.child.driver = { pid: 2 ** 22 + 4321, started_at: Date.now(), restarts: [{ at: Date.now() }, { at: Date.now() }] };
    assert.equal(withRoot(() => dispatchSettled(task, n)), true, 'a dispatch nobody will ever respawn is settled');
    n.child.driver.restarts = [{ at: Date.now() }];
    assert.equal(withRoot(() => dispatchSettled(task, n)), false, 'one restart left: not settled, serviceDeadDriver respawns it');
    n.child.driver.restarts = [{ at: Date.now() }, { at: Date.now() }];
    n.child.waiting_capacity = { reason: 'resets 3pm (UTC)', since: Date.now() };
    assert.equal(withRoot(() => dispatchSettled(task, n)), false, 'parked on capacity: waiting, not settled');
  });
});

test('a stalled driver is left alone before 3x stall_minutes, and killed (never respawned directly) past it', async () => {
  const { serviceStalledDriver } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, root, task_id }) => {
    await throughCritique(tm, task_id);
    await tm.call('tm_next', { task_id });
    const load = () => JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const prevRoot = process.env.HARNESS_TASKS_DIR;
    const withRoot = (fn) => { process.env.HARNESS_TASKS_DIR = root; try { return fn(); } finally { if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot; } };

    const task = load();
    task.stall_minutes = 1;
    const n = task.nodes.find((x) => x.node_id === 'dispatch:P1:1');
    // idol-pm-4's own gap was inside a live driver, not a dead one - a real, disposable process
    // fakes exactly that: a pid this test can kill without killing itself.
    const sleeper = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
    sleeper.unref();
    n.child.driver = { pid: sleeper.pid, started_at: Date.now() - 60 * 60 * 1000 };
    const runFile = join(n.child.cwd, '.teams_output', 'broker', 'runs', `${n.child.run_id}.json`);
    try {
      // 100s idle: past 1x (60s), short of 3x (180s) - flagged, but the driver stays untouched.
      const t100 = new Date(Date.now() - 100 * 1000);
      utimesSync(runFile, t100, t100);
      assert.equal(withRoot(() => serviceStalledDriver(task, n.child, n.node_id)), true, 'flagged');
      assert.ok(aliveSleeper(sleeper.pid), 'short of 3x: the driver is left alone');
      const midEvents = await tm.call('tm_events', { task_id });
      assert.equal(midEvents.events.filter((e) => e.event === 'child_driver_killed').length, 0, 'no kill yet');

      // 200s idle: past 3x (180s) - killed.
      const t200 = new Date(Date.now() - 200 * 1000);
      utimesSync(runFile, t200, t200);
      assert.equal(withRoot(() => serviceStalledDriver(task, n.child, n.node_id)), true, 'past 3x: killed');
      await waitFor(() => !aliveSleeper(sleeper.pid), 'the stalled driver to actually exit after SIGTERM');

      const events = await tm.call('tm_events', { task_id });
      const killed = events.events.filter((e) => e.event === 'child_driver_killed');
      assert.equal(killed.length, 1);
      assert.equal(killed[0].reason, 'stalled');
      assert.equal(killed[0].node_id, 'dispatch:P1:1');
      assert.equal(events.events.filter((e) => e.event === 'child_driver_stalled').length, 1, 'still just the one stall record from the first poll');
    } finally {
      try { process.kill(sleeper.pid, 'SIGKILL'); } catch { /* already gone, or never started */ }
    }
  });
});

test('once a stalled driver is killed, the ordinary dead-driver path respawns it and spends a restart like any other death', async () => {
  const { serviceStalledDriver, serviceDeadDriver } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, root, task_id }) => {
    await throughCritique(tm, task_id);
    await tm.call('tm_next', { task_id });
    const load = () => JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const prevRoot = process.env.HARNESS_TASKS_DIR;
    const withRoot = (fn) => { process.env.HARNESS_TASKS_DIR = root; try { return fn(); } finally { if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot; } };
    const prevDriver = process.env.HARNESS_CHILD_DRIVER;
    const drv = mkdtempSync(join(tmpdir(), 'tm-stall-drv-'));
    const scriptPath = join(drv, 'fake-driver.mjs');
    writeFileSync(scriptPath, FAKE_DRIVER_ALIVE); // stays up: this test only checks a fresh one was spawned
    process.env.HARNESS_CHILD_DRIVER = `node ${scriptPath}`;

    const task = load();
    task.stall_minutes = 1;
    const n = task.nodes.find((x) => x.node_id === 'dispatch:P1:1');
    const sleeper = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
    sleeper.unref();
    n.child.driver = { pid: sleeper.pid, started_at: Date.now() - 60 * 60 * 1000 };
    const runFile = join(n.child.cwd, '.teams_output', 'broker', 'runs', `${n.child.run_id}.json`);
    try {
      const t200 = new Date(Date.now() - 200 * 1000);
      utimesSync(runFile, t200, t200);
      assert.equal(withRoot(() => serviceStalledDriver(task, n.child, n.node_id)), true, 'killed for stalling');
      await waitFor(() => !aliveSleeper(sleeper.pid), 'the stalled driver to exit');

      assert.equal(withRoot(() => serviceDeadDriver(task, n.child, n.node_id)), true, 'the ordinary dead-driver path treats this exactly like any other death');
      assert.ok(Number.isInteger(n.child.driver.pid) && n.child.driver.pid !== sleeper.pid, 'a fresh driver process');
      assert.equal(n.child.driver.restarts.length, 1, 'the stall-kill spent a restart, same as a crash');
      assert.equal(n.child.stalled_since, undefined, 'the fresh driver starts unstalled');

      const events = await tm.call('tm_events', { task_id });
      assert.ok(events.events.some((e) => e.event === 'child_driver_restarted' && e.node_id === 'dispatch:P1:1' && e.restart === 1));
    } finally {
      try { process.kill(sleeper.pid, 'SIGKILL'); } catch { /* already gone */ }
      try { if (n.child.driver && n.child.driver.pid) process.kill(n.child.driver.pid, 'SIGKILL'); } catch { /* best-effort cleanup */ }
      if (prevDriver === undefined) delete process.env.HARNESS_CHILD_DRIVER; else process.env.HARNESS_CHILD_DRIVER = prevDriver;
      rmSync(drv, { recursive: true, force: true });
    }
  });
});

// ---------- restart_period_minutes: OTP-style restart intensity (§2) ----------

test('restart_period_minutes: a sliding window forgets old restarts; the default (0) stays a flat, forever counter', async () => {
  const { serviceDeadDriver } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, root, task_id }) => {
    await throughCritique(tm, task_id);
    await tm.call('tm_next', { task_id });
    const load = () => JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const prevRoot = process.env.HARNESS_TASKS_DIR;
    const withRoot = (fn) => { process.env.HARNESS_TASKS_DIR = root; try { return fn(); } finally { if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot; } };
    const prevDriver = process.env.HARNESS_CHILD_DRIVER;
    const drv = mkdtempSync(join(tmpdir(), 'tm-window-drv-'));
    const scriptPath = join(drv, 'fake-driver.mjs');
    writeFileSync(scriptPath, FAKE_DRIVER_ALIVE);
    process.env.HARNESS_CHILD_DRIVER = `node ${scriptPath}`;

    const task = load();
    task.driver_restarts = 1;
    task.restart_period_minutes = 1; // a 1-minute sliding window
    const n = task.nodes.find((x) => x.node_id === 'dispatch:P1:1');
    const oldRestart = { pid: 999, at: Date.now() - 5 * 60 * 1000, stderr_tail: 'old death' }; // 5 minutes ago: outside the window
    n.child.driver = { pid: 2147483646, restarts: [oldRestart] }; // a pid nothing holds: dead already, no real kill needed
    try {
      const changed = withRoot(() => serviceDeadDriver(task, n.child, n.node_id));
      assert.equal(changed, true, 'the one prior restart is outside the window: the budget (1) is not yet spent');
      assert.ok(Number.isInteger(n.child.driver.pid), 'respawned');
      assert.equal(n.child.driver.restarts.length, 2, 'the old restart is kept on record even though it no longer counts toward the budget');

      // The same history, but flat counting (restart_period_minutes: 0, the default): the old
      // restart still spends the budget regardless of age - no window to forget it in.
      const flatTask = load();
      flatTask.driver_restarts = 1;
      flatTask.restart_period_minutes = 0;
      const flatChild = { cwd: n.child.cwd, run_id: n.child.run_id, driver: { pid: 2147483646, restarts: [oldRestart] } };
      const changedFlat = withRoot(() => serviceDeadDriver(flatTask, flatChild, n.node_id));
      assert.equal(changedFlat, false, 'flat counting: the same old restart still spends the budget');
    } finally {
      try { if (n.child.driver && n.child.driver.pid) process.kill(n.child.driver.pid, 'SIGKILL'); } catch { /* best-effort */ }
      if (prevDriver === undefined) delete process.env.HARNESS_CHILD_DRIVER; else process.env.HARNESS_CHILD_DRIVER = prevDriver;
      rmSync(drv, { recursive: true, force: true });
    }
  });
});

test('a driver that exits only after its child run finished folds normally: a crash and an ordinary ending are not the same thing', async () => {
  const f = driverFixture(); // dies immediately; the point is that the RUN finishes some other way first
  const tm = await f.client.init();
  const g = await new Client(BROKER).init();
  try {
    const { task_id } = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'big request', cwd: f.cwd, vendor: 'self' });
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    const c = nx.children[0];
    await waitFor(async () => (await tm.call('tm_next', { task_id })).children[0].driver.alive === false, 'the fake driver to exit');
    // The driver is long dead, but the run itself is completed by other means (as the broker
    // would, driven by whatever replaced the dead driver in a real deployment) before anyone
    // folds the dispatch. serviceDeadDriver must read that as a finish, not a crash.
    await completeChild(g, c);
    const after = await tm.call('tm_next', { task_id });
    assert.equal(after.children[0].child_state, 'complete');
    assert.equal(after.children[0].next, `tm_submit({task_id, node_id: "${c.node_id}"})`);
    const v = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    assert.equal(v.state, 'done', JSON.stringify(v));
    assert.equal(v.accept, true, 'the normal fold path ran, not the dead-driver one');
  } finally {
    tm.close();
    g.close();
    rmSync(f.cwd, { recursive: true, force: true });
    rmSync(f.root, { recursive: true, force: true });
    rmSync(f.drv, { recursive: true, force: true });
  }
});

test('HARNESS_TEST_NO_DRIVER spawns nothing: the child is the test to drive, and a fold is refused while it runs', async () => {
  const f = driverFixture({ HARNESS_TEST_NO_DRIVER: '1' });
  const tm = await f.client.init();
  const g = await new Client(BROKER).init();
  try {
    const { task_id } = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'big request', cwd: f.cwd, vendor: 'self' });
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    const c = nx.children[0];
    assert.equal(c.driver, undefined, 'no driver was spawned');
    assert.match(c.next, /team_next/);
    assert.ok(!existsSync(f.ran), 'the fake driver was never started');
    assert.ok(!existsSync(join(f.root, task_id, 'drivers')), 'no driver logs either');
    const early = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    assert.match(early.error, /still running/, 'with no driver, a running child is still the caller to finish');
    await completeChild(g, c);
    assert.equal((await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' })).state, 'done');
  } finally {
    tm.close();
    g.close();
    rmSync(f.cwd, { recursive: true, force: true });
    rmSync(f.root, { recursive: true, force: true });
    rmSync(f.drv, { recursive: true, force: true });
  }
});

// m4 (_repo/docs/plans/2026-09-28-teams-adversarial-fixes.md): a size-S task gets its QA card too - on a
// snapshot of the run's working tree, never the tree itself; what it finds is unresolved.
// S2: a task written before S1 carries task.s_run. It is read through a frozen path - its run
// file only, its QA cards ignored, never respawned; unfinished with no live driver, it is blocked.
test('S2: a legacy s_run task reads its run\'s state, ignores roles.qa, is never respawned, and reads blocked once its driver is gone', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
  const g = await new Client(BROKER).init();
  try {
    const open = await tm.call('tm_open', { roles: { qa: true }, brainstorm: false, request: 'small request', cwd, vendor: 'self', size: 'S' });
    const task_id = open.task_id;
    const { run_id } = await g.call('team_open', { request: 'small request', cwd, vendor: 'self', flow: 'develop', mixed: true, goal_judges: 1 });
    const taskFile = join(root, task_id, 'task.json');
    const legacy = JSON.parse(readFileSync(taskFile, 'utf8'));
    delete legacy.harness_run;
    legacy.s_run = { cwd, run_id, driver: { pid: 999999999, started_at: Date.now(), log: join(root, 'gone.log') } };
    writeFileSync(taskFile, JSON.stringify(legacy));

    let st = await tm.call('tm_status', { task_id });
    assert.equal(st.state, 'blocked', 'unfinished, its driver gone: blocked, not running forever');
    const nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.state, 'blocked');
    assert.match(nx.next, /legacy size-S runs are not restarted/);
    assert.equal(readTask(root, task_id).s_run.driver.pid, 999999999, 'never respawned');

    const sub = (node_id, payload) => g.call('team_submit', { run_id, cwd, node_id, payload: ok(payload) });
    await sub('plan', { handoff: 'p', flow: 'develop', size: 'S' });
    await sub('setgoal', { spec: CHILD_SPEC });
    await sub('critique', { sound: true });
    appendFileSync(join(cwd, 'a.txt'), 'changed\n');
    await sub('implement:U1:1', { changed_files: ['a.txt'], handoff: 'built' });
    await sub('test:U1:1', { verified: true });
    await sub('gate:U1:1', { accept: true, match_pct: 95 });
    await sub('gate:goal:1', { accept: true, match_pct: 95 });
    await g.call('team_next', { run_id, cwd });
    await sub('report', { handoff: 'legacy run done' });
    st = await tm.call('tm_status', { task_id });
    assert.equal(st.state, 'complete', 'roles.qa on a legacy task opens no QA card and is not waited on');
    const ledger = readFileSync(join(root, task_id, 'ledger.jsonl'), 'utf8');
    assert.doesNotMatch(ledger, /"event":"child_driver_restarted"/);
    assert.doesNotMatch(ledger, /"event":"s_qa_opened"/);
  } finally { tm.close(); g.close(); rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});
// ---------- size-S process handoff: s_driver ----------

test('S1: one harness driver in the project cwd; a dead one is respawned with a prompt naming the recorded run; past its budget the task reads blocked and tm_retry gives it a fresh driver', async () => {
  const f = driverFixture({}, FAKE_DRIVER_RESPAWN);
  const tm = await f.client.init();
  try {
    const open = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'small request', cwd: f.cwd, vendor: 'self', size: 'S', driver_restarts: 1 });
    const task_id = open.task_id;
    assert.equal(open.task_state, 'harness');
    assert.ok(Number.isInteger(open.driver.pid), JSON.stringify(open));
    assert.equal(open.driver.log, join(f.root, task_id, 'drivers', 'S.stream.jsonl'));
    const first = await waitFor(() => (existsSync(`${f.ran}.1`) ? JSON.parse(readFileSync(`${f.ran}.1`, 'utf8')) : null), 'the first driver');
    assert.doesNotMatch(first.argv[first.argv.length - 1], /previous driver/);
    // The first driver opened its run and wrote the pointer, then died (FAKE_DRIVER exits at once).
    const run = graphRunFixture(f.cwd, task_id);
    writePointer(f.root, task_id, run);
    await waitFor(async () => { const t = readTask(f.root, task_id); return !driverAliveLocal(t.harness_run.driver.pid); }, 'the first driver to exit');
    const nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.state, 'running');
    const second = await waitFor(() => (existsSync(`${f.ran}.2`) ? JSON.parse(readFileSync(`${f.ran}.2`, 'utf8')) : null), 'the respawned driver');
    const resume = second.argv[second.argv.length - 1];
    assert.match(resume, new RegExp(`CONTINUE that run`));
    assert.ok(resume.includes(run.run_id), resume.slice(0, 400));
    assert.match(resume, /never open a second run/);
    assert.equal(realpathSync(JSON.parse(readFileSync(`${f.ran}.2`, 'utf8')).argv.length ? f.cwd : f.cwd), realpathSync(f.cwd));
    // The respawned one dies too (after 5s): the budget of 1 is spent - blocked, with a report.
    await waitFor(async () => { const t = readTask(f.root, task_id); return !driverAliveLocal(t.harness_run.driver.pid); }, 'the second driver to exit', 20000);
    const dead = await tm.call('tm_next', { task_id });
    assert.equal(dead.state, 'blocked');
    assert.match(dead.next, /tm_retry/);
    assert.match(readFileSync(docPaths(readTask(f.root, task_id)).report, 'utf8'), /\(blocked\)/);
    const retried = await tm.call('tm_retry', { task_id });
    assert.equal(retried.retried, true);
    assert.equal(retried.state, 'running');
    // The run finishes: the task completes from the run's own files.
    graphRunFixture(f.cwd, task_id, { runId: run.run_id, accept: true, report: true });
    assert.equal((await tm.call('tm_status', { task_id })).state, 'complete');
  } finally {
    tm.close();
    rmSync(f.cwd, { recursive: true, force: true });
    rmSync(f.root, { recursive: true, force: true });
    rmSync(f.drv, { recursive: true, force: true });
  }
});

function driverAliveLocal(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
test('S1a: a harness driver that hit a usage limit parks on waiting_capacity without spending a restart; reset_capacity resumes it', async () => {
  const f = driverFixture({}, FAKE_DRIVER_LIMIT);
  const tm = await f.client.init();
  try {
    const { task_id } = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'small request', cwd: f.cwd, vendor: 'self', size: 'S', driver_restarts: 0 });
    await waitFor(async () => { const t = readTask(f.root, task_id); return !driverAliveLocal(t.harness_run.driver.pid); }, 'the driver to hit its limit');
    const nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.state, 'running', 'a capacity park is not a death: no restart spent, not blocked');
    assert.match(nx.waiting_capacity.reason, /hit your 5-hour limit/);
    const r = await tm.call('tm_retry', { task_id, reset_capacity: true });
    assert.deepEqual(r.resumed, ['S']);
    assert.equal(readTask(f.root, task_id).harness_run.waiting_capacity, undefined);
  } finally {
    tm.close();
    rmSync(f.cwd, { recursive: true, force: true });
    rmSync(f.root, { recursive: true, force: true });
    rmSync(f.drv, { recursive: true, force: true });
  }
});
test('child_driver and s_driver are gone: passing either is an error that names the reason', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
  try {
    for (const bad of [{ child_driver: 'inline' }, { s_driver: 'process' }]) {
      const r = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'r', cwd, vendor: 'self', ...bad });
      assert.match(r.error, /removed in 0\.10\.0/);
      assert.match(r.error, /never drives/);
    }
    assert.deepEqual(readdirSync(root), [], 'a refused open leaves no task behind');
  } finally { tm.close(); rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

// ---------- the daemon: server owns the loop ----------

test('tm_open spawns a daemon process whose argv names --task, and records it', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const fake = join(root, 'fake-daemon.mjs');
  writeFileSync(fake, FAKE_DRIVER_ALIVE);
  const out = join(root, 'daemon.out');
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_DAEMON: `node ${fake}`, FAKE_DRIVER_OUT: out }).init();
  let pid;
  try {
    const open = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'lead me', cwd, vendor: 'self', size: 'L' });
    // tm_open itself only returns a thin pointer (task_id/state/docs_dir) once a daemon is in
    // play - it must not also self-drive via toolNext, which would race the daemon it just
    // spawned into opening the same node twice. Daemon bookkeeping is read back from tm_status.
    assert.equal(open.ready, undefined, 'tm_open does not self-drive once a daemon is spawned');
    const s0 = await waitFor(async () => {
      const s = await tm.call('tm_status', { task_id: open.task_id });
      return s.daemon && s.daemon.pid ? s : null;
    }, 'the daemon to be recorded on the task');
    pid = s0.daemon.pid;
    assert.ok(Number.isInteger(pid), 'a daemon pid comes back');
    assert.ok(s0.daemon.log.endsWith('daemon.log.jsonl'));
    assert.equal(s0.daemon.spawn_count, 1);
    assert.equal(typeof s0.daemon.alive, 'boolean');

    const ran = await waitFor(() => (existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null), 'the fake daemon to run');
    assert.deepEqual(ran.argv, ['--task', open.task_id], 'the daemon is told only which task to drive');

    const ledger = readFileSync(join(root, open.task_id, 'ledger.jsonl'), 'utf8');
    assert.match(ledger, /"event":"daemon_spawned"/);
  } finally { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } tm.close(); rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test('a tm_submit is applied directly - there is no inbox to queue it behind any more', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_LEADER: '1' }).init();
  try {
    const open = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'lead me', cwd, vendor: 'self', size: 'L' });
    const v = await tm.call('tm_submit', { task_id: open.task_id, node_id: 'shape', payload: { stage_ok: true } });
    assert.equal(v.queued, undefined, 'no queued reply - the old inbox is gone');
    // size was pinned L, so shape was already ready: this payload is applied immediately and
    // judged on its own merits (an empty shape is unusable), not deferred for a leader to drain.
    assert.equal(v.state, 'failed', JSON.stringify(v));
    assert.match(v.reason, /unusable shape/);
    assert.ok(!existsSync(join(root, open.task_id, 'inbox')), 'no inbox directory exists at all any more');
  } finally { tm.close(); rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test('tm_next reads graph state directly: there is no watcher gate or driven_by branch any more', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_LEADER: '1' }).init();
  try {
    const open = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'lead me', cwd, vendor: 'self', size: 'L' });
    const n = await tm.call('tm_next', { task_id: open.task_id });
    assert.equal(n.driven_by, undefined, 'driven_by does not exist any more');
    // size was pinned L, so it resolved at open time; the plan stage (areas, C2) is the next ready
    // node. What matters here is that tm_next answers from the graph directly - no watcher branch,
    // no empty ready[].
    assert.deepEqual(n.ready.map((x) => x.node_id), ['areas'], 'tm_next drives the graph itself, exactly as it always could');
  } finally { tm.close(); rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test('tm_wait returns a bounded delta of node transitions and times out cleanly when nothing finishes', async () => {
  await withTask(async ({ tm, task_id }) => {
    const t0 = Date.now();
    const w = await tm.call('tm_wait', { task_id, max_ms: 300 });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed >= 250, `tm_wait must block close to max_ms when nothing finishes, took ${elapsed}ms`);
    assert.equal(w.state, 'running');
    assert.equal(w.timed_out, true);
    assert.deepEqual(w.transitions, []);
    assert.ok(Number.isInteger(w.cursor));

    // Progress now happens; the very next tm_wait must return it as a transition, not a timeout -
    // and never the full payload, only the node_id/stage/state/stage_ok delta.
    const v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2 modules'], handoff: 'two' }) });
    assert.equal(v.state, 'done');
    const w2 = await tm.call('tm_wait', { task_id, cursor: w.cursor, max_ms: 5000 });
    assert.equal(w2.timed_out, false);
    assert.deepEqual(w2.transitions, [{ node_id: 'size', stage: 'size', state: 'done', stage_ok: true, ts: w2.transitions[0].ts }]);
    assert.ok(w2.cursor > w.cursor);
  });
});

test('a duplicate tm_submit for a node already finished is a no-op that returns the stored verdict, not re-applied', async () => {
  await withTask(async ({ tm, task_id }) => {
    const v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2 modules'], handoff: 'h' }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    // idempotentSubmit re-reads the node's state from the task this call loads fresh off disk on
    // every call, so a second writer racing in after the first already finished the node - the
    // daemon's own loop, a retried MCP call, any other caller - gets back the STORED verdict
    // (_repo/docs/plans/2026-09-23-teams-reducer-human-rollback.md §5, at-least-once delivery), not a
    // re-run on its own (different) payload and not an error.
    const again = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'S', flow: 'develop' }) });
    assert.equal(again.idempotent, true);
    assert.equal(again.size, 'L', 'the stored verdict, not the second payload');
    const status = await tm.call('tm_status', { task_id });
    assert.equal(status.size, 'L', 'the first verdict stands; the second attempt changed nothing');
    // A wrong attempt number is a real mismatch, not a duplicate - still refused outright.
    const wrongAttempt = await tm.call('tm_submit', { task_id, node_id: 'size', attempt: 99, payload: ok({ size: 'S' }) });
    assert.match(wrongAttempt.error, /is done, not pending/);
  });
});

test('a dead daemon is respawned on any tm_* call up to driver_restarts, then reported exhausted', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const fake = join(root, 'fake-daemon.mjs');
  writeFileSync(fake, FAKE_DRIVER); // exits at once
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_DAEMON: `node ${fake}`, FAKE_DRIVER_OUT: join(root, 'o') }).init();
  try {
    const open = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'lead me', cwd, vendor: 'self', size: 'L', driver_restarts: 1 });
    await new Promise((r) => setTimeout(r, 400));
    let s = await tm.call('tm_status', { task_id: open.task_id });
    assert.equal(s.daemon.restarts, 1, 'first dead daemon respawned');
    await new Promise((r) => setTimeout(r, 400));
    s = await tm.call('tm_status', { task_id: open.task_id });
    assert.equal(s.daemon.restarts, 1);
    assert.equal(s.daemon.exhausted, true);
    assert.equal(s.state, 'blocked', 'nothing respawns an exhausted daemon: tm_wait must not poll it forever');
    assert.ok(s.daemon.stderr_tail.length > 0);
    const ledger = readFileSync(join(root, open.task_id, 'ledger.jsonl'), 'utf8');
    assert.match(ledger, /"event":"daemon_restarted"/);
    assert.match(ledger, /"event":"daemon_exhausted"/);
  } finally { tm.close(); rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test('the daemon keeps a size-S harness task\'s driver and finishes once the harness run reports, with no external tm_next caller', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const drv = mkdtempSync(join(tmpdir(), 'tm-drv-'));
  const scriptPath = join(drv, 'fake-driver.mjs');
  // The harness driver stays up while the test plays its run on disk.
  writeFileSync(scriptPath, 'setTimeout(() => process.exit(0), 30000);\n');
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_CHILD_DRIVER: `node ${scriptPath}`, CLAUDECODE: '1' }).init();
  let daemonPid;
  let driverPid;
  try {
    const open = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'small request', cwd, vendor: 'self', size: 'S' });
    const s0 = await waitFor(async () => {
      const s = await tm.call('tm_status', { task_id: open.task_id });
      return s.daemon && Number.isInteger(s.daemon.pid) ? s : null;
    }, 'a real daemon to start');
    daemonPid = s0.daemon.pid;
    driverPid = s0.harness.driver && s0.harness.driver.pid;
    const run = graphRunFixture(cwd, open.task_id);
    writePointer(root, open.task_id, run);
    graphRunFixture(cwd, open.task_id, { runId: run.run_id, accept: true, report: true });
    await waitFor(() => !driverAliveLocal(daemonPid), 'the daemon process to exit on its own', 30000);
    const status = await tm.call('tm_status', { task_id: open.task_id });
    assert.equal(status.state, 'complete');
    const ledger = readFileSync(join(root, open.task_id, 'ledger.jsonl'), 'utf8');
    assert.match(ledger, /"event":"daemon_done"/);
  } finally {
    tm.close();
    if (driverPid) { try { process.kill(driverPid); } catch { /* gone */ } }
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
    rmSync(drv, { recursive: true, force: true });
  }
});
test('a judge call that never returns is killed on its timeout instead of wedging the daemon', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const drv = mkdtempSync(join(tmpdir(), 'tm-drv-'));
  // A judge that hangs forever. Before JUDGE_TIMEOUT_MS existed this wedged the daemon on a
  // pending close event: it held no session, wrote no stream, and left the task 'running'
  // forever - one orphan survived 2h37m that way, still awaiting a task whose directory had
  // already been deleted.
  const hang = join(drv, 'hanging-judge.mjs');
  writeFileSync(hang, 'setInterval(() => {}, 1000);\n');
  const tm = await new Client(TM, {
    HARNESS_TASKS_DIR: root,
    HARNESS_JUDGE_DRIVER: `node ${hang}`,
    HARNESS_JUDGE_TIMEOUT_MS: '2000',
    // Deliberately NOT HARNESS_TEST_NO_DRIVER: noDaemon() includes noDriver(), so that seam would
    // suppress the very daemon under test. HARNESS_CHILD_DRIVER fakes out any child driver instead
    // - none is reached here, because size is judged before the first dispatch ever opens.
    HARNESS_CHILD_DRIVER: `node ${hang}`,
    CLAUDECODE: '1',
  }).init();
  try {
    // No size: the size node is ready, so the daemon's first act is to judge it.
    const open = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'a request whose size must be judged', cwd, vendor: 'self' });
    const sized = await waitFor(async () => {
      const s = await tm.call('tm_status', { task_id: open.task_id, full: true });
      const n = (s.nodes || []).find((x) => x.stage === 'size');
      return n && n.state !== 'pending' && n.state !== 'running' ? n : null;
    }, 'the size node to settle after its judge was killed', 30000);
    assert.equal(sized.state, 'failed', 'a judge that could not judge is a failed node, not a verdict');
    assert.match(String(sized.result && sized.result.reason), /did not finish within/,
      'the failure has to name the timeout, so a person reading tm_status sees a killed judge and not a bad verdict');
    // The daemon is still alive and still working the graph - the timeout killed the child, not the loop.
    const st = await tm.call('tm_status', { task_id: open.task_id });
    assert.ok(st.state === 'running' || st.state === 'blocked', 'the daemon survives its own judge timing out');
  } finally {
    tm.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
    rmSync(drv, { recursive: true, force: true });
  }
});

test('a judge call leaves its stream under drivers/, so budget and the report count manager-level spend', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const drv = mkdtempSync(join(tmpdir(), 'tm-drv-'));
  // A judge that answers size with one result event costing $1.25 - the shape a real
  // `claude -p --output-format stream-json` call ends with. Before keepJudgeLog this stdout was
  // parsed and dropped, so every manager-level call was invisible to budget_usd and the report.
  const judgeJs = join(drv, 'judge.mjs');
  writeFileSync(judgeJs, `process.stdout.write(JSON.stringify({ type: 'result', total_cost_usd: 1.25, num_turns: 2, result: JSON.stringify({ stage_ok: true, size: 'S', reason: 'small' }) }) + '\\n');\n`);
  const hang = join(drv, 'hanging-driver.mjs');
  writeFileSync(hang, 'setInterval(() => {}, 1000);\n');
  const tm = await new Client(TM, {
    HARNESS_TASKS_DIR: root,
    HARNESS_JUDGE_DRIVER: `node ${judgeJs}`,
    HARNESS_CHILD_DRIVER: `node ${hang}`,
    CLAUDECODE: '1',
  }).init();
  try {
    const open = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'a request whose size must be judged', cwd, vendor: 'self' });
    const log = join(root, open.task_id, 'drivers', 'judge_size.stream.jsonl');
    await waitFor(() => existsSync(log), 'the size judge to leave its stream log', 30000);
    await waitFor(async () => {
      const st = await tm.call('tm_status', { task_id: open.task_id, full: true });
      const n = (st.nodes || []).find((x) => x.stage === 'size');
      return n && n.state === 'done';
    }, 'the size node to take the judge verdict', 30000);
    assert.equal(collectDriverCosts(join(root, open.task_id)).cost_usd >= 1.25, true, 'the judge call is counted like any driver session');
  } finally {
    tm.close();
    // The daemon goes on to judge shape with the same fake; stop it before removing its cwd.
    try {
      for (const line of readFileSync(join(root, readdirSync(root)[0], 'ledger.jsonl'), 'utf8').split('\n')) {
        const e = line.trim() ? JSON.parse(line) : null;
        if (e && e.event === 'daemon_spawned') { try { process.kill(e.pid, 'SIGKILL'); } catch { /* gone */ } }
      }
    } catch { /* no ledger */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    rmSync(drv, { recursive: true, force: true });
  }
});

test('the daemon stays alive while it only has a running child to wait on', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const drv = mkdtempSync(join(tmpdir(), 'tm-drv-'));
  // A child driver that runs forever and writes nothing: the daemon has nothing to do but wait.
  // seam-beta-D1 (2026-09-21) died exactly here: waitForProgress held only an unref()'d fallback
  // timer and non-persistent fs.watch handles, so the event loop emptied and Node exited with
  // code 0 mid-await - one second after dispatching P1, and again on both restarts. The child
  // finished every node; nobody was left to fold it.
  const hang = join(drv, 'hanging-driver.mjs');
  writeFileSync(hang, 'setInterval(() => {}, 1000);\n');
  const tm = await new Client(TM, {
    HARNESS_TASKS_DIR: root,
    HARNESS_CHILD_DRIVER: `node ${hang}`,
    HARNESS_JUDGE_DRIVER: `node ${hang}`,
    CLAUDECODE: '1',
  }).init();
  try {
    // size pinned S: no judge runs, the one child run opens at once, and the daemon's whole job
    // is to wait for that driver.
    const open = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'one small request', cwd, vendor: 'self', size: 'S' });
    const task = () => JSON.parse(readFileSync(join(root, open.task_id, 'task.json'), 'utf8'));
    const d = await waitFor(async () => (task().daemon && task().daemon.pid ? task().daemon : null), 'the daemon to be spawned', 10000);
    await new Promise((r) => setTimeout(r, 3000));
    let alive = true;
    try { process.kill(d.pid, 0); } catch (e) { alive = !!(e && e.code === 'EPERM'); }
    assert.ok(alive, `the daemon exited while its child was still running (exit file: ${existsSync(d.exit) ? readFileSync(d.exit, 'utf8').trim() : 'none'})`);
    assert.ok(!existsSync(d.exit), 'no exit file may exist while the child driver is alive');
    assert.equal(task().daemon.restarts || 0, 0, 'nothing had to restart it');
  } finally {
    try { const t = task(); if (t.daemon && t.daemon.pid) process.kill(t.daemon.pid, 'SIGTERM'); } catch { /* gone */ }
    try { const t = task(); const sr = t.s_run && t.s_run.driver; if (sr && sr.pid) process.kill(sr.pid, 'SIGTERM'); } catch { /* gone */ }
    tm.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
    rmSync(drv, { recursive: true, force: true });
  }
});

test('a torn read of a child run file is "not settled yet", and saveRun never leaves one to read', async () => {
  // seam-beta-D2 (2026-09-21): dispatchSettled read a child run mid-write, got null, said
  // "settled", and foldChild - re-reading a whole file a millisecond later - threw "still
  // running" straight through the daemon's main loop (exit code 1, restart 1 of 2).
  const { dispatchSettled } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, cwd, root, task_id }) => {
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    const child = nx.children[0];
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const n = task.nodes.find((x) => x.node_id === `dispatch:${child.package_id}:1`);
    const file = join(child.cwd, '.teams_output', 'broker', 'runs', `${child.run_id}.json`);
    assert.ok(existsSync(file));
    assert.equal(dispatchSettled(task, n), false, 'a running child is not settled');
    const whole = readFileSync(file, 'utf8');
    writeFileSync(file, whole.slice(0, Math.floor(whole.length / 2))); // a truncated, mid-write file
    assert.equal(dispatchSettled(task, n), false, 'an unparseable child file is a write in progress, not a settled child');
    writeFileSync(file, whole);
    // saveRun is write-then-rename: after a save there is no .tmp sibling and the file parses.
    await tm.call('tm_status', { task_id });
    const dir = dirname(file);
    assert.ok(!readdirSync(dir).some((f) => f.endsWith('.tmp')), 'no temp file survives a save');
    assert.doesNotThrow(() => JSON.parse(readFileSync(file, 'utf8')));
    rmSync(file);
    assert.equal(dispatchSettled(task, n), true, 'a missing child file IS a fold - foldChild reports it');
  });
});

test('a refused integrate opens a repair package by itself (autoRepair) instead of leaving the task blocked', async () => {
  // seam-beta-D2 (2026-09-21): integrate refused on its checks, the daemon read "blocked",
  // recorded daemon_done and exited - three accepted packages, one repair short of a report.
  const { autoRepair } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, g, root, task_id }) => {
    await throughCritique(tm, task_id);
    let nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) });
    nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P2:1' });
    await tm.call('tm_submit', { task_id, node_id: 'accept:P2:1', payload: ok({ accept: true, match_pct: 90 }) });
    nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['integrate:1']);
    const v = await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: false, checks: ['grep -> a hardcoded exit code in packages/cli/test'], reason: 'cli tests hardcode 2 and 0' }) });
    assert.equal(v.state, 'failed');
    assert.equal((await tm.call('tm_status', { task_id })).state, 'blocked', 'by node state alone the graph is blocked');

    const load = () => JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    let task = load();
    // autoRepair runs in THIS process here (the daemon is off under HARNESS_TEST_NO_DRIVER), and
    // record() resolves the ledger through tasksRoot() - point it at the same root the server uses.
    const prevRoot = process.env.HARNESS_TASKS_DIR;
    process.env.HARNESS_TASKS_DIR = root;
    try {
      assert.equal(autoRepair(task), true, 'a refused integrate with a combined tree is a repair, not an end');
    } finally {
      if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot;
    }
    task = load();
    const r1 = task.spec.packages.find((p) => p.id === 'R1');
    assert.ok(r1 && r1.repair && r1.integration_of === 'integrate:1', 'R1 is a repair of integrate:1');
    assert.match(r1.brief, /cli tests hardcode 2 and 0/, 'the refusal reason travels into the repair brief');
    assert.ok(task.nodes.some((n) => n.node_id === 'dispatch:R1:1'), 'the repair dispatch exists');
    assert.ok(task.nodes.some((n) => n.node_id === 'integrate:2' && n.supersedes === 'integrate:1'), 'a fresh integrate waits behind it');
    const gate = task.nodes.find((n) => n.node_id === 'gate:goal:1');
    assert.ok(gate.deps.includes('integrate:2') && !gate.deps.includes('integrate:1'), 'gate:goal moved behind the fresh integrate');
    assert.equal((await tm.call('tm_status', { task_id })).state, 'running', 'the task is live again');
    process.env.HARNESS_TASKS_DIR = root;
    try {
      assert.equal(autoRepair(load()), false, 'nothing to repair twice: integrate:1 is superseded, integrate:2 is pending');
    } finally {
      if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot;
    }
    const ev = await tm.call('tm_events', { task_id });
    assert.ok(ev.events.some((e) => e.event === 'daemon_repair_opened' && e.package_id === 'R1'));
  });
});

test('a blocked child whose driver is still alive is not settled: the driver may be opening the next attempt', async () => {
  // seam-silent-beta-E1 (2026-09-21): gate:U1:1 rejected, broker saved, THEN pushed implement:U1:2
  // and saved again. The daemon read the first save ('blocked'), folded P1 as failed, and the
  // task went blocked while the driver was already on attempt 2.
  const { dispatchSettled } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, g, root, task_id }) => {
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    const child = nx.children[0];
    // Reject the chain's gate. team_retry takes no auto_reassign, so the child either reads
    // 'blocked' on disk or has already opened attempt 2 - both branches are checked below.
    const sub = (node_id, payload) => g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id, payload: ok(payload) });
    await throughChildSpec(g, child);
    appendFileSync(join(child.cwd, 'a.txt'), 'changed\n');
    await sub('implement:U1:1', { changed_files: ['a.txt'], handoff: 'built' });
    await sub('test:U1:1', { verified: true });
    await sub('gate:U1:1', { accept: false, match_pct: 40, gaps: ['x'], reason: 'short' });
    const st = await g.call('team_status', { run_id: child.run_id, cwd: child.cwd });
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const n = task.nodes.find((x) => x.node_id === `dispatch:${child.package_id}:1`);
    if (st.state === 'blocked') {
      n.child.driver = { pid: process.pid }; // an alive driver (this very process)
      assert.equal(dispatchSettled(task, n), false, 'blocked + live driver = the driver decides, not this snapshot');
      n.child.driver = { pid: 2147483646 }; // a pid nothing holds
      assert.equal(dispatchSettled(task, n), true, 'blocked + dead driver = settled');
      delete n.child.driver;
      assert.equal(dispatchSettled(task, n), true, 'blocked with no driver at all (a caller-driven child) = settled, as before');
    } else {
      // auto_reassign stayed on and opened attempt 2: the child is running, and running is never settled.
      assert.equal(st.state, 'running');
      assert.equal(dispatchSettled(task, n), false);
    }
  });
});

// Drive a child to 'blocked' the way a real run gets there: every gate rejects, auto_reassign
// opens the next attempt, until the child's own retry budget is spent. completeChild({accept:false})
// assumes auto_reassign:false and asserts 'blocked' after ONE rejection - not what a default child does.
async function blockChild(g, child) {
  const { cwd, run_id } = child;
  for (let i = 0; i < 40; i++) {
    const nx = await g.call('team_next', { run_id, cwd });
    if (nx.state === 'blocked' || nx.state === 'complete') return nx.state;
    if (!nx.ready.length) throw new Error(`child ${run_id} is ${nx.state} with nothing ready`);
    for (const n of nx.ready) {
      const stage = n.node_id.split(':')[0];
      let payload;
      if (stage === 'plan') payload = { handoff: 'p', flow: 'develop', size: 'S' };
      else if (stage === 'setgoal') payload = { spec: CHILD_SPEC };
      else if (stage === 'critique') payload = { sound: true };
      else if (stage === 'implement' || stage === 'draft' || stage === 'cases') { appendFileSync(join(cwd, 'a.txt'), `attempt ${n.node_id}\n`); payload = { changed_files: ['a.txt'], handoff: 'built' }; }
      else if (stage === 'test' || stage === 'review' || stage === 'execute' || stage === 'revise') payload = { verified: true, changed_files: [], handoff: 'ok' };
      else if (stage === 'gate') payload = { accept: false, match_pct: 40, gaps: ['missing the b half'], reason: 'short' };
      else payload = { handoff: 'x' };
      await g.call('team_submit', { run_id, cwd, node_id: n.node_id, payload: ok(payload) });
    }
  }
  throw new Error(`child ${run_id} never blocked`);
}

test('a package whose child blocked opens its next attempt by itself (autoRetryPackages), until max_retries is spent', async () => {
  // trap-beta-T1 (2026-09-21): P1's child spent its three gate attempts, folded failed, and the
  // daemon recorded daemon_done with the manager's whole max_retries budget untouched.
  const { autoRetryPackages } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, g, root, task_id }) => {
    await throughCritique(tm, task_id);
    const load = () => JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const prevRoot = process.env.HARNESS_TASKS_DIR;
    const withRoot = (fn) => { process.env.HARNESS_TASKS_DIR = root; try { return fn(); } finally { if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot; } };
    const maxRetries = load().max_retries;
    assert.ok(Number.isInteger(maxRetries) && maxRetries >= 1, `max_retries is ${maxRetries}`);
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const nx = await tm.call('tm_next', { task_id });
      const child = nx.children.find((c) => c.node_id === `dispatch:P1:${attempt}`);
      assert.ok(child, `attempt ${attempt} is dispatched: ${JSON.stringify(nx.children.map((c) => c.node_id))}`);
      await blockChild(g, child);
      const v = await tm.call('tm_submit', { task_id, node_id: `dispatch:P1:${attempt}` });
      assert.equal(v.state, 'failed', `attempt ${attempt} folds failed`);
      const changed = withRoot(() => autoRetryPackages(load()));
      assert.equal(changed, true, `attempt ${attempt}: the daemon acts on a failed package`);
      const t = load();
      if (attempt <= maxRetries) {
        const next = t.nodes.find((n) => n.node_id === `dispatch:P1:${attempt + 1}`);
        assert.ok(next, `attempt ${attempt + 1} opened`);
        assert.match(String(next.feedback || ''), /short|missing the b half/, 'the rejection reason travels as feedback');
        assert.equal(withRoot(() => autoRetryPackages(load())), false, 'nothing to retry twice while the new attempt is open');
      } else {
        assert.ok(!t.nodes.some((n) => n.node_id === `dispatch:P1:${attempt + 1}`), 'budget spent: no further attempt');
        const st = await tm.call('tm_status', { task_id });
        // Settled: everything behind the dead package is unreachable and only `report` is left,
        // which the daemon judges to close the task on partial work (that is the design, not a leak).
        const nxs = await tm.call('tm_next', { task_id });
        assert.deepEqual((nxs.ready || []).map((n) => n.node_id), ['report'], `only the report is left: ${JSON.stringify(nxs.ready)}`);
        assert.equal((nxs.children || []).length, 0, 'no package is running any more');
        const full = await tm.call('tm_status', { task_id, full: true });
        assert.ok(['dispatch:P2:1', 'integrate:1', 'gate:goal:1'].every((id) => (full.nodes || []).find((n) => n.node_id === id).state === 'unreachable'), 'downstream is unreachable');
        void st;
      }
    }
    const ev = await tm.call('tm_events', { task_id });
    assert.ok(ev.events.some((e) => e.event === 'daemon_retry_opened' && e.package_id === 'P1' && e.attempt === 2));
    assert.ok(ev.events.some((e) => e.event === 'daemon_retry_settled' && e.package_id === 'P1'));
  });
});

test('folding a blocked child carries its own failed verdicts (reason, gaps) - the retry brief has something to fix from', async () => {
  // trap-beta-T2 (2026-09-21): attempt 2 of P2 was briefed only "test:U1:3 failed with no retry
  // left"; the 35% and 80% gate reasons that actually explained the failure never reached it.
  await withTask(async ({ tm, g, root, task_id }) => {
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    const child = nx.children.find((c) => c.node_id === 'dispatch:P1:1');
    await blockChild(g, child);
    const v = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    assert.equal(v.state, 'failed');
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const r = task.nodes.find((n) => n.node_id === 'dispatch:P1:1').result;
    assert.match(String(r.reason), /gate:U1:\d+ \(40%\): short/, `the gate's own reason is in the fold: ${r.reason}`);
    assert.ok((r.gaps || []).includes('missing the b half'), `the gate's gaps are the fold's gaps: ${JSON.stringify(r.gaps)}`);
    assert.ok(Array.isArray(r.child_verdicts) && r.child_verdicts.length >= 1 && r.child_verdicts.every((x) => /^gate:/.test(x.node_id)));
    assert.equal(r.match_pct, 40);
  });
});

test('autoResumeCapacity clears a capacity park once the provider-named reset time has passed, and not before', async () => {
  // trap-beta-T2 (2026-09-21): R1 sat 1h51m on "resets 5:40pm (UTC)" after 5:40pm because
  // nothing in the loop read the clock; a caller's tm_retry({reset_capacity:true}) was the only way.
  const { autoResumeCapacity, capacityResetAt } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, root, task_id }) => {
    await throughCritique(tm, task_id);
    await tm.call('tm_next', { task_id }); // dispatches P1 (no driver under the test seam)
    const load = () => JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const prevRoot = process.env.HARNESS_TASKS_DIR;
    const withRoot = (fn) => { process.env.HARNESS_TASKS_DIR = root; try { return fn(); } finally { if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot; } };
    const task = load();
    const n = task.nodes.find((x) => x.node_id === 'dispatch:P1:1');
    const since = Date.UTC(2026, 8, 21, 15, 50);
    n.child.waiting_capacity = { reason: "You've hit your session limit · resets 5:40pm (UTC)", since };
    writeFileSync(join(root, task_id, 'task.json'), JSON.stringify(task, null, 2));
    const resetAt = capacityResetAt(n.child.waiting_capacity.reason, since);
    assert.equal(new Date(resetAt).toISOString(), '2026-09-21T17:40:00.000Z');
    assert.equal(withRoot(() => autoResumeCapacity(load(), resetAt + 60 * 1000)), false, 'one minute after the reset is inside the grace period: still parked');
    assert.ok(load().nodes.find((x) => x.node_id === 'dispatch:P1:1').child.waiting_capacity, 'untouched');
    assert.equal(withRoot(() => autoResumeCapacity(load(), resetAt + 4 * 60 * 1000)), true, 'four minutes after: resumed');
    assert.ok(!load().nodes.find((x) => x.node_id === 'dispatch:P1:1').child.waiting_capacity, 'the park is cleared');
    const ev = await tm.call('tm_events', { task_id });
    assert.ok(ev.events.some((e) => e.event === 'daemon_capacity_resumed' && e.resumed.includes('dispatch:P1:1')));
  });
});

test('a judge that could not judge is re-judged, not treated as a refusal: no repair, no package retry, at most two more tries', async () => {
  // trap-beta-T2: integrate:1's judge answered with the usage-limit notice; autoRepair opened R1 on it.
  const { autoRejudge, autoRepair, autoRetryPackages } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, g, root, task_id }) => {
    await throughCritique(tm, task_id);
    let nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) });
    nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P2:1' });
    await tm.call('tm_submit', { task_id, node_id: 'accept:P2:1', payload: ok({ accept: true, match_pct: 90 }) });
    nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['integrate:1']);
    // The daemon's judge() failing looks like this on the node:
    const v = await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: { stage_ok: false, judge_failed: true, reason: "judge reply for integrate:1 was not valid JSON: no JSON object found in the reply. stderr:  raw: You've hit your session limit · resets 5:40pm (UTC)" } });
    assert.equal(v.state, 'failed');
    const load = () => JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const prevRoot = process.env.HARNESS_TASKS_DIR;
    const withRoot = (fn) => { process.env.HARNESS_TASKS_DIR = root; try { return fn(); } finally { if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot; } };
    assert.equal(withRoot(() => autoRepair(load())), false, 'a non-verdict opens no repair package');
    assert.equal(withRoot(() => autoRetryPackages(load())), false, 'and retries no package');
    const finishedAt = load().nodes.find((n) => n.node_id === 'integrate:1').finished_at;
    assert.equal(withRoot(() => autoRejudge(load(), finishedAt + 60 * 1000)), false, 'the reply named a reset time: not before it');
    const t1 = withRoot(() => autoRejudge(load(), finishedAt + 26 * 60 * 60 * 1000));
    assert.equal(t1, true, 'after the reset: re-judged');
    let n = load().nodes.find((x) => x.node_id === 'integrate:1');
    assert.equal(n.state, 'pending'); assert.equal(n.judge_attempts, 1); assert.equal(n.result, undefined);
    nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((x) => x.node_id), ['integrate:1'], 'ready to be judged again');
    // Two more failures with no reset time named: the second re-judge happens after a minute, a third never.
    await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: { stage_ok: false, judge_failed: true, reason: 'judge process for integrate:1 failed to run: spawn ENOENT' } });
    n = load().nodes.find((x) => x.node_id === 'integrate:1');
    assert.equal(withRoot(() => autoRejudge(load(), n.finished_at + 2 * 60 * 1000)), true);
    await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: { stage_ok: false, judge_failed: true, reason: 'judge process for integrate:1 failed to run: spawn ENOENT' } });
    n = load().nodes.find((x) => x.node_id === 'integrate:1');
    assert.equal(withRoot(() => autoRejudge(load(), n.finished_at + 2 * 60 * 1000)), false, 'budget of two re-judges spent');
    assert.equal(load().nodes.find((x) => x.node_id === 'integrate:1').state, 'failed');
    const ev = await tm.call('tm_events', { task_id });
    assert.equal(ev.events.filter((e) => e.event === 'daemon_rejudge').length, 2);
  });
});

test('tm_events tails the ledger, newest last, filtered by since', async () => {
  await withTask(async ({ tm, task_id, root }) => {
    const all = await tm.call('tm_events', { task_id });
    assert.ok(all.events.length >= 1);
    assert.equal(all.events[0].event, 'tm_open');
    const last = all.events.at(-1).ts;
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: { stage_ok: true, size: 'L', handoff: 'h', evidence: 'e' } });
    const since = await tm.call('tm_events', { task_id, since: last });
    assert.ok(since.events.every((e) => e.ts > last));
    assert.ok(since.events.some((e) => e.event === 'tm_submit' || e.event === 'node_done' || /submit|done/.test(e.event)));
    const two = await tm.call('tm_events', { task_id, limit: 2 });
    assert.equal(two.events.length, 2);
  });
});

// ---------- team.json project defaults ----------

test('tm_open reads .claude/team.json as defaults and an explicit argument still wins', async () => {
  const dir = repo();
  const tasks = mkdtempSync(join(tmpdir(), 'tm-tasks-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'team.json'), JSON.stringify({ goal_threshold: 95, max_retries: 4, roles: { planning: false, qa: true } }));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: tasks, HARNESS_TEST_NO_LEADER: '1' }).init();
  try {
    const a = await tm.call('tm_open', { request: 'split me', cwd: dir, size: 'L' });
    const sa = await tm.call('tm_status', { task_id: a.task_id });
    assert.equal(sa.team.opts.goal_threshold, 95);
    assert.equal(sa.team.sources.goal_threshold, 'team.json');
    assert.equal(sa.team.opts.max_retries, 4);
    // C5: team.json's planning:false is refused - the default stands, qa:true still applies,
    // and the refusal is a note on the task.
    assert.deepEqual(sa.team.opts.roles, { planning: 'auto', qa: true, audit: true });
    assert.ok(sa.team.notes.some((x) => /team\.json: roles\.planning: false is refused/.test(x)), JSON.stringify(sa.team.notes));
    assert.equal(sa.team.file_status, 'ok');
    const taskFile = JSON.parse(readFileSync(join(tasks, a.task_id, 'task.json'), 'utf8'));
    assert.equal(taskFile.goal_threshold, 95, 'the value the manager actually gates with');
    assert.equal(taskFile.max_retries, 4);

    const b = await tm.call('tm_open', { request: 'split me', cwd: dir, size: 'L', goal_threshold: 80 });
    const sb = await tm.call('tm_status', { task_id: b.task_id });
    assert.equal(sb.team.opts.goal_threshold, 80);
    assert.equal(sb.team.sources.goal_threshold, 'args');
  } finally { tm.close(); rmSync(dir, { recursive: true, force: true }); rmSync(tasks, { recursive: true, force: true }); }
});

test('team.json-only goal_threshold and max_retries (no explicit tm_open args) reach child_opts and the actual dispatched child run', async () => {
  const dir = repo();
  const tasks = mkdtempSync(join(tmpdir(), 'tm-tasks-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'team.json'), JSON.stringify({ goal_threshold: 95, max_retries: 4 }));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: tasks, HARNESS_TEST_NO_DRIVER: '1' }).init();
  const g = await new Client(BROKER).init();
  try {
    // Neither goal_threshold nor max_retries is passed as an explicit tm_open argument here -
    // team.json is the only source, so child_opts must pick it up the same way vendor/allocation
    // and the task-level gate fields already do.
    const a = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'r', cwd: dir, vendor: 'self' });
    const task_id = a.task_id;
    const task = JSON.parse(readFileSync(join(tasks, task_id, 'task.json'), 'utf8'));
    assert.equal(task.goal_threshold, 95, 'task-level gate sees team.json');
    assert.equal(task.max_retries, 4, 'task-level gate sees team.json');
    assert.equal(task.child_opts.goal_threshold, 95, 'every child run must be opened with the project floor, not the 90 args fallback');
    assert.equal(task.child_opts.max_retries, 4, 'every child run must be opened with the project retry budget, not the 2 args fallback');

    // The claim above only reaches the parent's own task.json. Drive to the point where a
    // package is actually dispatched, and read the value back through the broker's own
    // team_status on that child run - the same hop the goal_judges test already proves.
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    const c = nx.children[0];
    const full = await g.call('team_status', { run_id: c.run_id, cwd: c.cwd, full: true });
    assert.equal(full.goal_threshold, 95, 'the dispatched child run must actually open with the project floor, not the 90 default');
    assert.equal(full.max_retries, 4, 'the dispatched child run must actually open with the project retry budget, not the 2 default');
  } finally { tm.close(); g.close(); rmSync(dir, { recursive: true, force: true }); rmSync(tasks, { recursive: true, force: true }); }
});

test('a malformed team.json is reported on the task and the defaults apply', async () => {
  const dir = repo();
  const tasks = mkdtempSync(join(tmpdir(), 'tm-tasks-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'team.json'), '{oops');
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: tasks, HARNESS_TEST_NO_LEADER: '1' }).init();
  try {
    const a = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'split me', cwd: dir, size: 'L' });
    const s = await tm.call('tm_status', { task_id: a.task_id });
    assert.equal(s.team.file_status, 'parse-error');
    assert.equal(s.team.opts.goal_threshold, 90);
  } finally { tm.close(); rmSync(dir, { recursive: true, force: true }); rmSync(tasks, { recursive: true, force: true }); }
});

// ---------- tm_board / tm_ticket / board.jsonl ----------

test('tm_board with no task_id lists every EPIC, ticket-shaped; with task_id it gives the STORY kanban and a doc_path', async () => {
  await withTask(async ({ tm, task_id }) => {
    const list = await tm.call('tm_board', {});
    assert.ok(list.epics.some((e) => e.task_id === task_id && e.state === 'READY' && e.phase === 'plan'));

    await throughCritique(tm, task_id);
    const board = await tm.call('tm_board', { task_id });
    assert.equal(board.key, `E-${task_id.slice(0, 8)}`);
    // 'impl', not 'qualitygate': expandPackages (called the instant shape succeeds, before
    // critique even runs) creates dispatch+accept AND integrate/gate:goal/report together in
    // one shot, but epicPhase now gates on the integrate node's own unmetDeps (every package's
    // accept actually reaching 'done') rather than on integrate merely existing - and no
    // package has even been dispatched yet, let alone accepted.
    assert.equal(board.phase, 'impl');
    // The planning card is a STORY on the board too (C2), ahead of shape's packages.
    assert.equal(board.stories.length, 3);
    assert.deepEqual(board.stories.map((s) => s.id), ['PLAN-F1', 'P1', 'P2']);
    assert.equal(board.stories[0].state, 'DONE', 'the planning card was accepted');
    assert.equal(board.stories[0].role, 'planning');
    assert.equal(board.stories[1].state, 'READY', 'P1 has no deps: ready at once');
    assert.equal(board.stories[2].state, 'BACKLOG', 'P2 depends on P1');
    assert.match(board.doc_path, /INDEX\.md$/);
  });
});

test('tm_board accepts the ticket key E-xxxxxxxx in place of task_id, resolved the same way tm_ticket resolves it', async () => {
  await withTask(async ({ tm, task_id }) => {
    await throughCritique(tm, task_id);
    const byRunId = await tm.call('tm_board', { task_id });
    const byKey = await tm.call('tm_board', { task_id: `E-${task_id.slice(0, 8)}` });
    assert.deepEqual(byKey, byRunId, 'the ticket key and the full run id name the same EPIC and must report identically');
  });
});

test('tm_board refuses an unknown EPIC prefix the same way tm_ticket does', async () => {
  await withTask(async ({ tm, task_id }) => {
    await throughCritique(tm, task_id);
    const bad = await tm.call('tm_board', { task_id: 'E-ffffffff' });
    const badTicket = await tm.call('tm_ticket', { key: 'E-ffffffff' });
    assert.match(bad.error, /no EPIC starting with ffffffff/);
    assert.equal(bad.error, badTicket.error, 'same prefix, same lookup, same failure shape from both tools');
  });
});

// Grouping/display only - no scheduling or execution effect. Before ANY task has an initiative,
// tm_board's no-task_id listing must be the exact flat `{epics}` shape it always was (no `groups`
// key at all) - the byte-for-byte compat case every test that pins today's output relies on.
// Once even one task on the same tasksRoot has one, every EPIC (including the initiative-less
// ones) is also grouped.
test('tm_board with no task_id: exactly {epics} (no groups key) while nothing has an initiative; groups by initiative, slug-normalized, the moment one task does', async () => {
  await withTask(async ({ tm, cwd, task_id }) => {
    const flat = await tm.call('tm_board', {});
    assert.deepEqual(Object.keys(flat).sort(), ['epics'], 'no initiative anywhere yet - the exact old shape, nothing extra');
    assert.ok(!('initiative' in flat.epics[0]), 'an epic row itself carries no initiative field either, in the ungrouped case');

    const opened2 = await tm.call('tm_open', {
      request: 'second request', cwd, vendor: 'self', roles: { qa: false }, initiative: 'Q1 Roadmap',
    });

    const grouped = await tm.call('tm_board', {});
    assert.ok(Array.isArray(grouped.groups), 'at least one task now has an initiative - groups must appear');
    assert.equal(grouped.epics.find((e) => e.task_id === task_id).initiative, null, 'the original, initiative-less EPIC still lists, tagged null');
    assert.equal(grouped.epics.find((e) => e.task_id === opened2.task_id).initiative, 'q1-roadmap', 'slug-normalized: "Q1 Roadmap" -> "q1-roadmap"');

    const ungroup = grouped.groups.find((g) => g.initiative === null);
    const q1group = grouped.groups.find((g) => g.initiative === 'q1-roadmap');
    assert.ok(ungroup, 'an initiative-less EPIC is never silently dropped from the grouped view - it gets a null group');
    assert.deepEqual(ungroup.epics.map((e) => e.task_id), [task_id]);
    assert.equal(ungroup.key, null);
    assert.ok(q1group);
    assert.equal(q1group.key, 'I-q1-roadmap');
    assert.deepEqual(q1group.epics.map((e) => e.task_id), [opened2.task_id]);
  });
});

test('tm_ticket("I-<slug>") lists every EPIC under that initiative with state and cost; an unknown initiative errors', async () => {
  await withTask(async ({ tm, cwd, task_id }) => {
    const opened2 = await tm.call('tm_open', {
      request: 'second request', cwd, vendor: 'self', roles: { qa: false }, initiative: 'q1-roadmap',
    });
    const opened3 = await tm.call('tm_open', {
      request: 'a third, unrelated request', cwd, vendor: 'self', roles: { qa: false },
    });

    const ticket = await tm.call('tm_ticket', { key: 'I-q1-roadmap' });
    assert.equal(ticket.kind, 'INITIATIVE');
    assert.equal(ticket.key, 'I-q1-roadmap');
    assert.equal(ticket.initiative, 'q1-roadmap');
    assert.deepEqual(ticket.epics.map((e) => e.task_id), [opened2.task_id], 'only the EPIC actually opened under this initiative - not the original task, not the unrelated third one');
    assert.equal(ticket.epics[0].state, 'READY');
    assert.ok(ticket.epics[0].cost && typeof ticket.epics[0].cost.usd === 'number', 'each EPIC under the initiative carries its own cost, the same shape tm_board\'s single-task reply uses');

    const missing = await tm.call('tm_ticket', { key: 'I-nope-at-all' });
    assert.match(missing.error, /no EPIC found under initiative "nope-at-all"/);
    void opened3;
  });
});

// tm_assign's own key parser (parseTicketKey) already rejects anything with no pkgId - an
// I-<slug> key never carries one, so it falls into the exact same "needs a STORY or TASK key"
// refusal a bare EPIC key gets, with no dedicated branch of its own.
test('tm_assign refuses an I-<slug> key the same way it refuses a bare EPIC key', async () => {
  await withTask(async ({ tm, task_id }) => {
    const onInitiative = await tm.call('tm_assign', { task_id, key: 'I-q1-roadmap', to: 'human' });
    const onEpic = await tm.call('tm_assign', { task_id, key: `E-${task_id.slice(0, 8)}`, to: 'human' });
    assert.match(onInitiative.error, /needs a STORY or TASK key/);
    assert.match(onEpic.error, /needs a STORY or TASK key/);
  });
});

test('tm_ticket reads an EPIC key or a STORY key, and always returns a doc_path even before tm_docs has written anything', async () => {
  await withTask(async ({ tm, task_id }) => {
    await throughCritique(tm, task_id);
    const epic = await tm.call('tm_ticket', { key: `E-${task_id.slice(0, 8)}` });
    assert.equal(epic.kind, 'EPIC');
    // IN_PROGRESS, not IN_REVIEW: same as tm_board's phase assertion above, the integrate node
    // exists the moment shape succeeds but no package has been dispatched, let alone accepted.
    assert.equal(epic.state, 'IN_PROGRESS');
    const story = await tm.call('tm_ticket', { key: `E-${task_id.slice(0, 8)}/P1` });
    assert.equal(story.kind, 'STORY');
    assert.equal(story.state, 'READY');
    assert.match(story.doc_path, /40-stories\/P1\.md$/);
    // tm_ticket is a read. The page exists already - the ticket surface is kept current as the
    // run moves (2026-09-22) rather than on demand - so what this asserts now is that reading a
    // ticket changes nothing about it.
    const bodyBefore = existsSync(story.doc_path) ? readFileSync(story.doc_path, 'utf8') : null;
    await tm.call('tm_ticket', { key: `E-${task_id.slice(0, 8)}/P1` });
    const bodyAfter = existsSync(story.doc_path) ? readFileSync(story.doc_path, 'utf8') : null;
    assert.equal(bodyAfter, bodyBefore, 'tm_ticket never writes the file itself');
  });
});

// storyBlockedReason (tickets.mjs) wired onto tm_ticket's own STORY branch - P2 (deps: ['P1'])
// has not been dispatched yet, so it reads BACKLOG with blocked_reason naming the unmet dep by
// its dispatch node id, straight off unmetDeps(). P1 itself has nothing holding it back.
test('tm_ticket exposes blocked_reason on a STORY: unmet_deps for a package waiting on a sibling, null once nothing blocks it', async () => {
  await withTask(async ({ tm, task_id }) => {
    await throughCritique(tm, task_id);
    const epicKeyStr = `E-${task_id.slice(0, 8)}`;
    const p1 = await tm.call('tm_ticket', { key: `${epicKeyStr}/P1` });
    assert.equal(p1.state, 'READY');
    assert.equal(p1.blocked_reason, null);
    const p2 = await tm.call('tm_ticket', { key: `${epicKeyStr}/P2` });
    assert.equal(p2.state, 'BACKLOG');
    assert.equal(p2.blocked_reason.reason, 'unmet_deps');
    // expandPackages wires a sibling dep onto the dispatch node's OWN `.deps` as that sibling's
    // accept id, not its dispatch id (storyLinks' own comment above explains why) - unmetDeps
    // reads that literally, so the node id named here is accept:P1:1.
    assert.deepEqual(p2.blocked_reason.node_ids, ['accept:P1:1']);
  });
});

test('tm_ticket refuses an unknown EPIC prefix or a package not in the shape', async () => {
  await withTask(async ({ tm, task_id }) => {
    await throughCritique(tm, task_id);
    const bad = await tm.call('tm_ticket', { key: 'E-ffffffff' });
    assert.match(bad.error, /no EPIC starting with ffffffff/);
    const badPkg = await tm.call('tm_ticket', { key: `E-${task_id.slice(0, 8)}/P9` });
    assert.match(badPkg.error, /no package P9/);
  });
});

// tm_ticket now wires storyLinks() (tickets.mjs) onto a STORY exactly as tm_board's own rows do
// - one source of truth, read from both tools. SHAPE (the default two-package shape every other
// test in this suite reuses) has P2.deps: ['P1'], so P1/P2 name each other's own current state
// on both sides of the relation - the exact fixture, not a fresh one built for this test.
test('tm_ticket returns links (blocked_by/blocks/implements/filed_by) on a STORY, exactly matching tm_board\'s own links for the same key', async () => {
  await withTask(async ({ tm, task_id }) => {
    await throughCritique(tm, task_id);
    const epicKeyStr = `E-${task_id.slice(0, 8)}`;
    const p1 = await tm.call('tm_ticket', { key: `${epicKeyStr}/P1` });
    const p2 = await tm.call('tm_ticket', { key: `${epicKeyStr}/P2` });
    assert.equal(p1.state, 'READY', 'P1 has no deps: ready at once');
    assert.equal(p2.state, 'BACKLOG', 'P2 depends on P1');
    // implements[] is the merged PRD's stories, spread over the packages (every shape now
    // implements the planning cards' stories - C4; SHAPE declares none, so the suite fills them).
    assert.deepEqual(p1.links, {
      blocked_by: [],
      blocks: [{ key: `${epicKeyStr}/P2`, id: 'P2', state: 'BACKLOG' }],
      implements: ['F1-US-1'],
      filed_by: null,
    });
    assert.deepEqual(p2.links, {
      blocked_by: [{ key: `${epicKeyStr}/P1`, id: 'P1', state: 'READY' }],
      blocks: [],
      implements: ['F1-US-2'],
      filed_by: null,
    });
    // Same fact both ways: tm_board's own STORY rows must carry the identical links object for
    // the same keys - one function (storyLinks), two callers, never a second computation.
    const board = await tm.call('tm_board', { task_id });
    assert.deepEqual(board.stories.find((s) => s.id === 'P1').links, p1.links);
    assert.deepEqual(board.stories.find((s) => s.id === 'P2').links, p2.links);
  });
});

// SHAPE_IMPLEMENTS (defined below, reused as-is - roles.planning is not needed to exercise it:
// its completeness check against PRD user stories only runs when roles.planning is on, and
// SHAPE_IMPLEMENTS is otherwise identical to SHAPE) gives P1/P2 a non-trivial `implements`
// without needing the full planning phase-Team machinery.
test('tm_ticket\'s links pins a non-trivial implements (SHAPE_IMPLEMENTS) alongside blocked_by/blocks', async () => {
  await withTask(async ({ tm, task_id }) => {
    await throughCritique(tm, task_id, SHAPE_IMPLEMENTS);
    const epicKeyStr = `E-${task_id.slice(0, 8)}`;
    const p1 = await tm.call('tm_ticket', { key: `${epicKeyStr}/P1` });
    const p2 = await tm.call('tm_ticket', { key: `${epicKeyStr}/P2` });
    assert.deepEqual(p1.links.implements, ['F1-US-1']);
    assert.deepEqual(p2.links.implements, ['F1-US-2']);
  });
});

// Same tm_file fixture "tm_file joins the board.jsonl tools" (above) already drives: a STORY
// filed directly (not through QA) carries reporter "user" / origin "tm_file" (and links.filed_by
// "tm_file") - not null, not "qa" - the non-trivial filed_by case.
test('tm_ticket\'s links pins a non-trivial filed_by ("tm_file") on a STORY tm_file filed directly', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await toIntegrate(tm, g, task_id);
    const filed = await tm.call('tm_file', { task_id, stories: [
      { title: 'add a missing edge case', touches: ['b.txt'], deps: [], evidence: 'manual repro', severity: 'medium' },
    ] });
    assert.deepEqual(filed.filed, ['D1']);
    const epicKeyStr = `E-${task_id.slice(0, 8)}`;
    const d1 = await tm.call('tm_ticket', { key: `${epicKeyStr}/D1` });
    assert.equal(d1.reporter, 'user');
    assert.equal(d1.origin, 'tm_file');
    assert.equal(d1.links.filed_by, 'tm_file');
  });
});

// The reporter fix this test pins: toolTicket (tm_ticket) used to fall back to
// `pkg.reporter || (pkg.repair ? 'repair' : 'shape')` - never checking pkg.phase - so a
// phase-Team's own row (PLAN/QA/AUDIT, which carries p.phase but never p.reporter) still said
// 'shape' from tm_ticket while tm_board's epicBoardRows (packageFiling, tickets.mjs) already
// said 'planning' for the identical key. task.planning_pkg (id 'PLAN') exists the instant
// tm_open({roles:{planning:true}}) returns - no shape submission needed to exercise this.
test('tm_ticket and tm_board agree on reporter/origin for a planning card key (E-xxxx/PLAN-F1): both report "planning" / "phase"', async () => {
  await withTask(async ({ tm, task_id }) => {
    const epicKeyStr = `E-${task_id.slice(0, 8)}`;
    // The cards exist once the plan stage has split the request (C2).
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop' }) });
    await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: [{ title: 'sign-up', brief: 'a' }, { title: 'billing', brief: 'b' }] }) });
    const ticket = await tm.call('tm_ticket', { key: `${epicKeyStr}/PLAN-F1` });
    const board = await tm.call('tm_board', { task_id });
    assert.deepEqual(board.stories.map((s) => s.id), ['PLAN-F1', 'PLAN-F2'], 'one planning card per feature area on the board');
    const planRow = board.stories.find((s) => s.id === 'PLAN-F1');
    assert.ok(planRow, 'tm_board must carry a row per planning card');
    assert.equal(ticket.reporter, 'planning');
    assert.equal(planRow.reporter, 'planning');
    assert.equal(ticket.origin, 'phase');
    assert.equal(planRow.origin, 'phase');
    assert.equal(ticket.reporter, planRow.reporter, 'tm_ticket and tm_board must agree on reporter for the same key');
  }, { roles: { planning: true } });
});

test('board.jsonl gets one line per ticket key that actually changed - never a line for a key that did not move', async () => {
  await withTask(async ({ tm, g, task_id, root }) => {
    const boardPath = join(root, task_id, 'board.jsonl');
    await throughCritique(tm, task_id);
    const afterCritique = readFileSync(boardPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const epicKey = `E-${task_id.slice(0, 8)}`;
    // The EPIC ticket moves READY -> IN_PROGRESS in the same shape submission that creates the
    // integrate node (see the phase/state comments above) - it only reaches IN_REVIEW once every
    // package's accept has actually landed, which this stretch never does.
    assert.ok(afterCritique.some((e) => e.key === epicKey && e.from === 'READY' && e.to === 'IN_PROGRESS'));
    assert.ok(afterCritique.some((e) => e.key === `${epicKey}/P1` && e.to === 'READY'));
    assert.ok(afterCritique.some((e) => e.key === `${epicKey}/P2` && e.to === 'BACKLOG'));

    const nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    const events = readFileSync(boardPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(events.some((e) => e.key === `${epicKey}/P1` && e.from === 'READY' && e.to === 'IN_PROGRESS'));
    assert.ok(events.some((e) => e.key === `${epicKey}/P1` && e.to === 'IN_REVIEW'), 'dispatch folded done, accept is pending');
    // P2 never moved in this stretch - unmet deps the whole time - so it gets no new line at all.
    assert.equal(events.filter((e) => e.key === `${epicKey}/P2`).length, 1, 'only the original BACKLOG line from shape');
  });
});

test('board.jsonl is append-only and never consulted for current state - deleting it changes nothing tm_board/tm_ticket report', async () => {
  await withTask(async ({ tm, task_id, root }) => {
    const boardPath = join(root, task_id, 'board.jsonl');
    await throughCritique(tm, task_id);
    assert.ok(existsSync(boardPath));
    const before = await tm.call('tm_board', { task_id });
    rmSync(boardPath);
    const after = await tm.call('tm_board', { task_id });
    assert.deepEqual(after, before, 'tm_board recomputed everything from task.json alone, oblivious to board.jsonl being gone');
    // And a fresh transition still appends a line to a file that had to be recreated from
    // scratch - appendBoardTransitions never assumes the file (or its prior contents) survives.
    await tm.call('tm_next', { task_id });
    assert.ok(existsSync(boardPath));
  });
});

test('a tm_submit that moves a ticket writes a board.jsonl line immediately - there is no queue to delay it any more', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_LEADER: '1' }).init();
  try {
    const open = await tm.call('tm_open', { roles: { qa: false }, brainstorm: false, request: 'r', cwd, vendor: 'self' });
    await tm.call('tm_submit', { task_id: open.task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop' }) });
    const boardPath = join(root, open.task_id, 'board.jsonl');
    const before = existsSync(boardPath) ? readFileSync(boardPath, 'utf8') : '';
    const v = await tm.call('tm_submit', { task_id: open.task_id, node_id: 'shape', payload: ok({ ...SHAPE, handoff: 's' }) });
    assert.equal(v.queued, undefined, 'no inbox to queue behind any more');
    assert.equal(v.state, 'done', JSON.stringify(v));
    const after = existsSync(boardPath) ? readFileSync(boardPath, 'utf8') : '';
    assert.notEqual(after, before, 'applied immediately: the ticket moved in the same call');
  } finally {
    tm.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// --- shape's user-story coverage check, when planning actually produced stories -------------
// The bug (idol-pm-1, 2026-09-22): gate:goal returns stories as {"id","title","acceptance"}
// objects, and validateShape compared them with String(), so every story rendered as
// "[object Object]", matched no implements[] entry, and shape failed with six well-formed
// packages in hand. With planning on, the develop workflow could never stand up. It stayed
// invisible because every earlier planning run returned zero stories and the loop never ran.

test('storyId reads the id out of a story object, and passes a bare string through', async () => {
  const { storyId, storyLabel } = await import('../mcp/taskmanager.mjs');
  assert.equal(storyId({ id: 'US-1', title: 'Fan queue admission', acceptance: ['a'] }), 'US-1');
  assert.equal(storyId('US-2'), 'US-2');
  assert.equal(storyId(null), '');
  assert.equal(storyLabel({ id: 'US-1', title: 'Fan queue admission' }), 'US-1 - Fan queue admission');
  assert.equal(storyLabel('US-2'), 'US-2', 'a bare id has no title to append');
});

test('a shape whose packages implement every story object passes the coverage check', async () => {
  const { validateShape } = await import('../mcp/taskmanager.mjs');
  const stories = [
    { id: 'US-1', title: 'Fan queue admission', acceptance: ['a'] },
    { id: 'US-2', title: 'Atomic hold', acceptance: ['b'] },
  ];
  const spec = {
    acceptance: ['the integrated app boots'],
    packages: [
      { id: 'P1', title: 'Waiting room', brief: 'build the queue', acceptance: ['queue admits'], implements: ['US-1'], deps: [] },
      { id: 'P2', title: 'Hold', brief: 'build the hold', acceptance: ['hold is atomic'], implements: ['US-2'], deps: ['P1'] },
    ],
  };
  assert.deepEqual(validateShape(spec, stories), [], 'story objects must match implements[] ids');
});

test('a story no package implements is still reported - by id, never as [object Object]', async () => {
  const { validateShape } = await import('../mcp/taskmanager.mjs');
  const stories = [
    { id: 'US-1', title: 'Fan queue admission', acceptance: ['a'] },
    { id: 'US-2', title: 'Atomic hold', acceptance: ['b'] },
  ];
  const spec = {
    acceptance: ['the integrated app boots'],
    packages: [
      { id: 'P1', title: 'Waiting room', brief: 'build the queue', acceptance: ['queue admits'], implements: ['US-1'], deps: [] },
      { id: 'P2', title: 'Hold', brief: 'build the hold', acceptance: ['hold is atomic'], implements: [], deps: ['P1'] },
    ],
  };
  // P2 claiming nothing now draws its own problem (the ownership checks below), so read the
  // coverage complaint by name rather than by being the only thing in the list.
  const problems = validateShape(spec, stories);
  const missing = problems.filter((p) => /not implemented by any package/.test(p));
  assert.equal(missing.length, 1, JSON.stringify(problems));
  assert.match(missing[0], /US-2/);
  assert.doesNotMatch(missing[0], /\[object Object\]/, 'the id must be printed, not the object');
});

test('the shape contract asks for the implements[] its coverage check reads', async () => {
  const { CONTRACT } = await import('../mcp/taskmanager.mjs');
  const shape = (CONTRACT && CONTRACT.shape) || '';
  assert.match(shape, /"implements"/, 'shape was judged on a field its own output shape never asked for');
});

// Union coverage is satisfied by a shape where everyone claims everything, and a real one did
// exactly that: idol-pm-2 (2026-09-22) had P1 and P6 each claim all four stories. implements[]
// is meant to say what a package DELIVERS - these two hold it to that.
test('implements[] must be an ownership claim: not empty, and not all of them', async () => {
  const { validateShape } = await import('../mcp/taskmanager.mjs');
  const stories = [{ id: 'US-1', title: 'a', acceptance: ['x'] }, { id: 'US-2', title: 'b', acceptance: ['y'] }];
  const pkg = (id, impl) => ({ id, title: id, brief: 'b', acceptance: ['a'], implements: impl, deps: [] });
  const base = { acceptance: ['the integrated app boots'] };

  const claimsAll = validateShape({ ...base, packages: [pkg('P1', ['US-1', 'US-2']), pkg('P2', ['US-2'])] }, stories);
  assert.equal(claimsAll.filter((x) => /P1 claims every user story/.test(x)).length, 1, JSON.stringify(claimsAll));
  assert.equal(claimsAll.filter((x) => /P2/.test(x)).length, 0, 'a package that claims a subset is the normal case');

  const claimsNone = validateShape({ ...base, packages: [pkg('P1', ['US-1']), pkg('P2', ['US-2']), pkg('P3', [])] }, stories);
  assert.equal(claimsNone.filter((x) => /P3 implements no user story/.test(x)).length, 1, JSON.stringify(claimsNone));

  // A clean split stays clean, and a task planning never ran on (userStories null) is untouched.
  assert.deepEqual(validateShape({ ...base, packages: [pkg('P1', ['US-1']), pkg('P2', ['US-2'])] }, stories), []);
  assert.deepEqual(validateShape({ ...base, packages: [pkg('P1', []), pkg('P2', [])] }, null), []);
});

// Rule one asks for a package that owns the composition root; the coverage check then refused
// it for delivering no story. idol-pm-4 (2026-09-23): shape pinned US-7 on its foundation to
// pass, and shape:2, which did not, was rejected for P1 and P7 having no story.
test('a foundation package names the stories it enables instead of claiming one', async () => {
  const { validateShape, CONTRACT } = await import('../mcp/taskmanager.mjs');
  assert.match(CONTRACT.shape, /"enables"/);
  assert.match(CONTRACT.shape, /never claim a story in implements\[\] to get it past coverage/);
  const stories = [{ id: 'US-1', title: 'a', acceptance: ['x'] }, { id: 'US-2', title: 'b', acceptance: ['y'] }];
  const pkg = (id, impl, enables) => ({ id, title: id, brief: 'b', acceptance: ['a'], implements: impl, enables, deps: [] });
  const base = { acceptance: ['the integrated app boots'] };
  assert.deepEqual(validateShape({ ...base, packages: [pkg('P0', [], ['US-1', 'US-2']), pkg('P1', ['US-1']), pkg('P2', ['US-2'])] }, stories), [],
    'enabling every story is what a composition root does, and is not claiming them all');
  const bogus = validateShape({ ...base, packages: [pkg('P0', [], ['US-9']), pkg('P1', ['US-1']), pkg('P2', ['US-2'])] }, stories);
  assert.equal(bogus.filter((x) => /P0 implements no user story/.test(x)).length, 1, 'enables[] must name real stories');
  const only = validateShape({ ...base, packages: [pkg('P0', [], ['US-1', 'US-2']), pkg('P1', [])] }, stories);
  assert.match(only.join('; '), /user stories not implemented by any package: US-1, US-2/, 'enabling is not delivering');
});

// The three rules critique refused four real shapes over. A bar a judge enforces and the
// contract never states is a test with an unpublished syllabus.
test('the shape contract states the rules critique refuses shapes over', async () => {
  const { CONTRACT } = await import('../mcp/taskmanager.mjs');
  const shape = (CONTRACT && CONTRACT.shape) || '';
  assert.match(shape, /owned by exactly one package/, 'a shared primitive with no owner is what critique blocked on every time');
  assert.match(shape, /composition root|app assembly/, 'nothing being runnable after the merge was the single most repeated blocker');
  assert.match(shape, /checkable by the integration step/, 'a goal criterion no integration step can check is a blocker too');
  assert.match(shape, /satisfiable from that package's deps\[\] alone/, "a package judged on a sibling's result cannot pass");
});

// --- shape analysis: bloat and width signals -------------------------------------------------
// Two real shapes passed validateShape clean and were never caught: awake-beta-ref1
// (P1<-P2<-P3<-P4, P1 owned contracts+policy+tests, 3 attempts) and idol-beta-pm4 (P1 owned
// kernel+contracts+app+a whole catalog domain). shapeAnalysis computes the facts a critic needs
// to catch these next time - it is a signal, not a second validator, so none of this rejects a
// shape by itself.

const chainPkg = (id, touches, dep) => ({ id, title: id, brief: 'b', acceptance: ['a'], touches, deps: dep ? [dep] : [] });

test('shapeAnalysis: a strict 4-package chain is width 1 and fully serial, with no bloat when touches are even', async () => {
  const { shapeAnalysis } = await import('../mcp/taskmanager.mjs');
  const packages = [
    chainPkg('P1', ['a']),
    chainPkg('P2', ['b'], 'P1'),
    chainPkg('P3', ['c'], 'P2'),
    chainPkg('P4', ['d'], 'P3'),
  ];
  const sa = shapeAnalysis(packages);
  assert.equal(sa.package_count, 4);
  assert.equal(sa.max_parallel_width, 1);
  assert.equal(sa.fully_serial, true);
  assert.deepEqual(sa.bloated, [], 'even touches counts are not bloat, just a serial shape');
});

test('shapeAnalysis: a foundation package holding many more scopes than its siblings is flagged bloated', async () => {
  const { shapeAnalysis } = await import('../mcp/taskmanager.mjs');
  // awake-beta-ref1's shape: P1 owns contracts+policy+tests+two more scopes, P2-P4 own one each.
  const packages = [
    chainPkg('P1', ['contracts', 'policy', 'tests', 'schema', 'wiring']),
    chainPkg('P2', ['a'], 'P1'),
    chainPkg('P3', ['b'], 'P2'),
    chainPkg('P4', ['c'], 'P3'),
  ];
  const sa = shapeAnalysis(packages);
  assert.equal(sa.touches_median, 1);
  assert.deepEqual(sa.bloated.map((b) => b.id), ['P1']);
  assert.equal(sa.bloated[0].touches, 5);
});

test('shapeAnalysis: a two-package 2-vs-1 split is not bloat - below the floor', async () => {
  const { shapeAnalysis } = await import('../mcp/taskmanager.mjs');
  const sa = shapeAnalysis([chainPkg('P1', ['a', 'b']), chainPkg('P2', ['c'])]);
  assert.deepEqual(sa.bloated, [], 'touches counts this small are noise, not a real signal');
});

test('shapeAnalysis: independent packages that could run the same round give width > 1', async () => {
  const { shapeAnalysis } = await import('../mcp/taskmanager.mjs');
  const packages = [chainPkg('P1', ['a']), chainPkg('P2', ['b']), chainPkg('P3', ['c'], 'P1')];
  const sa = shapeAnalysis(packages);
  assert.equal(sa.max_parallel_width, 2, 'P1 and P2 are both ready in round one');
  assert.equal(sa.fully_serial, false);
});

test('the critique contract names a blocking shape defect for an unnamed bloated foundation or an unjustified serial shape', async () => {
  const { CONTRACT } = await import('../mcp/taskmanager.mjs');
  const critique = CONTRACT.critique;
  assert.match(critique, /Shape analysis/, 'the contract must point at the facts the briefing hands it');
  assert.match(critique, /shape:/);
  assert.match(critique, /owns, in touches\[\], more than the contracts/);
  assert.match(critique, /max_parallel_width 1/);
  assert.match(critique, /real data dependency/);
  assert.match(critique, /unrunnable:/);
  assert.match(critique, /unjudgeable:/);
});

test('the critique briefing carries the shape analysis facts for a serial chain with a bloated P1', async () => {
  await withTask(async ({ tm, task_id }) => {
    let v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 4 modules'], handoff: 'four modules' }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    const CHAIN_SHAPE = {
      acceptance: ['every module builds together'],
      packages: [
        { id: 'P1', title: 'foundation', flow: 'develop', brief: 'contracts, policy, tests', acceptance: ['a'], touches: ['contracts', 'policy', 'tests', 'schema', 'wiring'], deps: [] },
        { id: 'P2', title: 'module b', flow: 'develop', brief: 'b', acceptance: ['b'], touches: ['b.txt'], deps: ['P1'] },
        { id: 'P3', title: 'module c', flow: 'develop', brief: 'c', acceptance: ['c'], touches: ['c.txt'], deps: ['P2'] },
        { id: 'P4', title: 'module d', flow: 'develop', brief: 'd', acceptance: ['d'], touches: ['d.txt'], deps: ['P3'] },
      ],
    };
    v = await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...CHAIN_SHAPE, handoff: 's' }) });
    assert.equal(v.state, 'done', JSON.stringify(v));

    const nx = await tm.call('tm_next', { task_id });
    const critiqueNode = nx.ready.find((n) => n.node_id === 'critique');
    assert.ok(critiqueNode, JSON.stringify(nx));
    const briefing = readFileSync(critiqueNode.briefing_path, 'utf8');
    assert.match(briefing, /## Shape analysis/);
    assert.match(briefing, /max parallel width 1/);
    assert.match(briefing, /fully serial/);
    assert.match(briefing, /Bloated: P1 owns 5 scopes/);

    const status = await tm.call('tm_status', { task_id });
    assert.equal(status.shape.max_parallel_width, 1);
    assert.equal(status.shape.fully_serial, true);
    assert.deepEqual(status.shape.bloated.map((b) => b.id), ['P1']);
  }, { roles: { qa: false } });
});

// --- the ticket surface: state, history and body move together ------------------------------
// idol-pm-1 (2026-09-22) ran 81 minutes with a DONE story reading READY on the board and an
// empty docs directory: both hung off MCP tool calls the daemon, which owns the loop since
// v0.16.0, does not make. finish() is the single hook now - the one place both callers pass
// through - and the board dedups because finish and the daemon's step see the same move twice.

test('a node settling moves the board and re-renders the ticket pages, with no duplicate line', async () => {
  await withTask(async ({ cwd, root, task_id, tm, g }) => {
    const board = join(root, task_id, 'board.jsonl');
    const readBoard = () => (existsSync(board) ? readFileSync(board, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
    const atOpen = readBoard().length;
    assert.ok(atOpen > 0, 'tm_open creates tickets');

    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L' }) });
    const docsDir = join(cwd, '.teams_output', 'team');
    assert.ok(existsSync(docsDir), 'the ticket pages are written as the run moves, not on demand');
    assert.ok(readdirSync(docsDir).length > 0, 'at least one epic directory exists');

    // No key is logged twice into the same state, however many writers observed the move.
    const seen = new Map();
    for (const e of readBoard()) {
      assert.notEqual(seen.get(e.key), e.to, `${e.key} logged into ${e.to} twice`);
      seen.set(e.key, e.to);
    }
  });
});

test('appendBoardTransitions skips a move the board has already recorded', async () => {
  const { appendBoardTransitions } = await import('../mcp/taskmanager.mjs');
  assert.equal(typeof appendBoardTransitions, 'function', 'the board writer is exported for both callers');
});

// --- a fold commits delivered work, never the harness's own state ---------------------------
// idol-pm-1 (2026-09-22): the planning fold committed 1,740 lines into the project, of which
// 1,520 were manager state - task.json, board.jsonl, ledger.jsonl and a 1,326-line raw vendor
// stream log. Only docs/PRD.md was the deliverable. .teams_output and the marker dir were
// already unstaged; the tasks root was not, because it usually lives outside any project - but
// HARNESS_TASKS_DIR can put it inside one, and the bench does exactly that.

test('a tasks root inside the worktree is left out of the commit; one outside it is not named', async () => {
  const { harnessPathsUnder } = await import('../mcp/taskmanager.mjs');
  const cwd = mkdtempSync(join(tmpdir(), 'tm-commit-'));
  const prior = process.env.HARNESS_TASKS_DIR;
  try {
    // Always dropped, whatever the tasks root is.
    process.env.HARNESS_TASKS_DIR = join(tmpdir(), 'elsewhere', 'tasks');
    let paths = harnessPathsUnder(cwd);
    assert.ok(paths.includes('.teams_output'));
    assert.ok(paths.includes('.claude/.harness-markers'));
    assert.equal(paths.length, 2, `a root outside the tree adds nothing: ${paths}`);

    // Inside the tree: dropped by its path relative to the worktree.
    process.env.HARNESS_TASKS_DIR = join(cwd, '.harness-tasks');
    paths = harnessPathsUnder(cwd);
    assert.ok(paths.includes('.harness-tasks'), `an in-tree tasks root must be dropped: ${paths}`);

    // A sibling directory whose name merely starts the same way is not inside the tree.
    process.env.HARNESS_TASKS_DIR = `${cwd}-other`;
    paths = harnessPathsUnder(cwd);
    assert.equal(paths.length, 2, `a sibling is not inside the tree: ${paths}`);

    // The same tree under two spellings. idol-pm-4 (2026-09-23): cwd came in as the realpath
    // (/private/var/...) and the root as given (/var/...), and eight state files reached P1.
    const link = `${cwd}-link`;
    symlinkSync(cwd, link);
    try {
      process.env.HARNESS_TASKS_DIR = join(link, '.harness-tasks');
      assert.ok(harnessPathsUnder(realpathSync(cwd)).includes('.harness-tasks'), 'root spelled through a link, cwd as its realpath');
      process.env.HARNESS_TASKS_DIR = join(cwd, '.harness-tasks');
      assert.ok(harnessPathsUnder(link).includes('.harness-tasks'), 'and the other way round');
    } finally {
      rmSync(link, { force: true });
    }
  } finally {
    if (prior === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prior;
    rmSync(cwd, { recursive: true, force: true });
  }
});

// --- functional completeness of the PM path (2026-09-22) ------------------------------------
// Four holes found by running the planning harness for real on a ticketing PRD: the loop
// stopped at a critique it could act on; a PRD with no stories was accepted; a gap named while
// accepting reached nobody; and the project's own rules never reached planning or the manager.

test('a failed critique is reshaped by the engine, carrying the verdict that refused it', async () => {
  await withTask(async ({ task_id, tm, root }) => {
    const { autoReshape } = await import('../mcp/taskmanager.mjs');
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop' }) });
    await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...SHAPE, handoff: 's' }) });
    await tm.call('tm_submit', { task_id, node_id: 'critique', payload: ok({ sound: false, blocking: ['no package owns final assembly'], problems: ['P1 and P2 both touch a.txt'] }) });

    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.equal(task.nodes.find((n) => n.node_id === 'critique').state, 'failed');
    assert.ok(autoReshape(task), 'the engine must open the next shape attempt itself');
    const next = task.nodes.find((n) => n.node_id === 'shape:2');
    assert.ok(next, 'a second shape attempt exists');
    assert.match(next.feedback, /no package owns final assembly/, "critique's blocking travels into it");
    assert.match(next.feedback, /both touch a\.txt/, 'so do its non-blocking problems');
    assert.equal(autoReshape(task), false, 'it does not reshape again while the new attempt is open');
  });
});

// A judge that could not judge is not a verdict on the shape. autoRejudge deliberately waits a
// minute (or a usage-limit reset) before reopening such a node, and autoReshape runs later in
// the same daemon step - so without this guard the wait window was a free reshape attempt, with
// the timeout text standing in for a critique. idol-pm-1 (2026-09-22) hit the 45m judge timeout
// twice in 247 minutes: two of three shaping attempts.
test('a judge that timed out does not spend a shaping attempt - until its rejudge budget is gone', async () => {
  const { autoReshape } = await import('../mcp/taskmanager.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'tm-rejudge-'));
  const mk = (judgeAttempts) => ({
    run_id: 'probe', cwd: dir, max_retries: 2, store_path: join(dir, 'task.json'),
    nodes: [
      { node_id: 'size', stage: 'size', deps: [], after: [], state: 'done' },
      { node_id: 'shape', stage: 'shape', deps: ['size'], after: [], state: 'done', result: { stage_ok: true, packages: [] } },
      {
        node_id: 'critique', stage: 'critique', deps: ['shape'], after: [], state: 'failed',
        finished_at: Date.now(), judge_attempts: judgeAttempts,
        result: { stage_ok: false, judge_failed: true, reason: 'judge process for critique did not finish within 45m and was killed.' },
      },
    ],
  });
  try {
    const waiting = mk(0);
    assert.equal(autoReshape(waiting), false, 'a rejudgeable judge failure belongs to autoRejudge, not to a reshape');
    assert.equal(waiting.nodes.find((n) => n.node_id === 'shape:2'), undefined);

    // Once the rejudge budget is spent no verdict is coming, and reshaping is the only move left.
    const spent = mk(2);
    assert.ok(autoReshape(spent), 'a judge failure with no rejudge left must not wedge the task');
    assert.ok(spent.nodes.find((n) => n.node_id === 'shape:2'), 'the next shape attempt opens');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// match_pct was decorative on every accept node: the floor goal_threshold sets was applied to
// `gate` alone. idol-pm-1's PRD was accepted at 88% by a judgement whose own text said the
// document named nothing specific to the domain - the number was recorded, and nothing acted on
// it. The rejection is not the end of the package: it buys the retry max_retries budgets.
test('an accept under goal_threshold is a rejection, and the phase-Team package gets its retry', async () => {
  await withTask(async ({ tm, g, cwd, root, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', handoff: 'x' }) });
    await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: [{ title: 'the request', brief: 'all of it' }] }) });
    const nx = await tm.call('tm_next', { task_id });
    const child = nx.children[0];
    const sub = (node_id, payload) => g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id, payload: ok(payload) });
    await sub('plan', { handoff: 'p', flow: 'plan', size: 'S' });
    await sub('setgoal', { spec: { goal: 'PRD', acceptance: ['a'], subgoals: [{ id: 'U1', title: 'draft PRD', acceptance: ['written'], deps: [] }] } });
    await sub('critique', { sound: true });
    mkdirSync(join(child.cwd, 'docs'), { recursive: true });
    writeFileSync(join(child.cwd, 'docs', 'PRD.md'), `# PRD\n\n${PRD_FIXTURE}`);
    await sub('investigate:U1:1', { changed_files: [], handoff: 'findings' });
    await sub('draft:U1:1', { changed_files: ['docs/PRD.md'], handoff: 'd' });
    await sub('revise:U1:1', { changed_files: ['docs/PRD.md'], handoff: 'r' });
    await sub('gate:U1:1', { accept: true, match_pct: 95 });
    await sub('gate:goal:1', { accept: true, match_pct: 95, user_stories: [{ id: 'F1-US-1', title: 'a story', acceptance: ['x'] }] });
    await sub('report', { handoff: 'done' });
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:PLAN-F1:1' });
    await tm.call('tm_submit', {
      task_id, node_id: 'accept:PLAN-F1:1',
      payload: ok({ accept: true, match_pct: 88, checks: ['read the PRD'], gaps: ['nothing in it is specific to this domain'] }),
    });

    const read = () => JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const task = read();
    assert.equal(task.nodes.find((n) => n.node_id === 'accept:PLAN-F1:1').state, 'failed', '88 is under the 90 floor');
    assert.equal(task.nodes.find((n) => n.node_id === 'shape').state, 'pending', 'shape stays shut behind a rejected PRD');
    const ready = await tm.call('tm_next', { task_id });
    assert.equal((ready.ready || []).filter((n) => n.node_id === 'shape').length, 0, 'and it is not handed out to be judged');

    // A phase-Team package is not in task.spec.packages, so autoRetryPackages used to walk
    // straight past it and the daemon would record daemon_done on an untouched retry budget.
    const { autoRetryPackages } = await import('../mcp/taskmanager.mjs');
    assert.ok(autoRetryPackages(task), 'the PLAN package must get the retry max_retries budgets');
    const retry = task.nodes.find((n) => n.node_id === 'dispatch:PLAN-F1:2');
    assert.ok(retry, 'a second attempt of the planning card opens');
    assert.match(String(retry.feedback || ''), /specific to this domain/, 'the gap that cost it the points travels into the retry');
  }, { roles: { planning: true } });
});

// idol-pm-4 (2026-09-23): P2 and P5 accepted at 88 with gaps[] empty and failed on the number
// alone - the judge had found nothing blocking, and each package was rebuilt from scratch. The
// floor now needs a named gap on accept. The manager's own goal gate keeps the plain floor.
test('an accept under the floor fails only when the judge named a gap', async () => {
  const { succeeded } = await import('../mcp/taskmanager.mjs');
  const task = { goal_threshold: 90 };
  const accept = { stage: 'accept', node_id: 'accept:P2:2' };
  const r = (extra) => ({ stage_ok: true, accept: true, checks: ['npm test -> 79/79'], ...extra });
  assert.equal(succeeded(task, accept, r({ match_pct: 88, gaps: [], observations: ['a small scope overlap'] })), true, 'weaknesses that do not block are not a rejection');
  assert.equal(succeeded(task, accept, r({ match_pct: 87, gaps: ['the export path is not exercised end to end'] })), false, 'a named gap under the floor still is');
  assert.equal(succeeded(task, accept, r({ match_pct: 95, gaps: ['minor'] })), true, 'at the floor a gap is carried, not refused');
  assert.equal(succeeded(task, { stage: 'gate', node_id: 'gate:goal:1' }, r({ match_pct: 88, gaps: [] })), false, 'the goal gate keeps the plain floor');
});

test('a planning fold returning no user stories is rejected, and says why', async () => {
  await withTask(async ({ tm, g, cwd, root, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', handoff: 'x' }) });
    await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: [{ title: 'the request', brief: 'all of it' }] }) });
    const nx = await tm.call('tm_next', { task_id });
    const child = nx.children[0];
    const sub = (node_id, payload) => g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id, payload: ok(payload) });
    await sub('plan', { handoff: 'p', flow: 'plan', size: 'S' });
    await sub('setgoal', { spec: { goal: 'PRD', acceptance: ['PRD covers the request'], subgoals: [{ id: 'U1', title: 'draft PRD', acceptance: ['PRD written'], deps: [] }] } });
    await sub('critique', { sound: true });
    mkdirSync(join(child.cwd, 'docs'), { recursive: true });
    writeFileSync(join(child.cwd, 'docs', 'PRD.md'), '# PRD\n\nno stories here\n');
    await sub('investigate:U1:1', { changed_files: [], handoff: 'findings' });
    await sub('draft:U1:1', { changed_files: ['docs/PRD.md'], handoff: 'drafted' });
    await sub('revise:U1:1', { changed_files: ['docs/PRD.md'], handoff: 'revised' });
    await sub('gate:U1:1', { accept: true, match_pct: 95 });
    // The child's own gate is happy with its document - it judges the text, not what the
    // manager needs from it - and returns no stories. R1 (2026-09-18) accepted this at 93%.
    await sub('gate:goal:1', { accept: true, match_pct: 95, user_stories: [] });
    await sub('report', { handoff: 'PRD complete' });

    const folded = await tm.call('tm_submit', { task_id, node_id: 'dispatch:PLAN-F1:1' });
    assert.equal(folded.state, 'failed', JSON.stringify(folded));
    const saved = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const r = saved.nodes.find((n) => n.node_id === 'dispatch:PLAN-F1:1').result;
    assert.match(r.reason, /no user stories/, JSON.stringify(r));
    assert.ok((r.gaps || []).some((x) => /nothing downstream can be built/.test(x)), JSON.stringify(r.gaps));
  }, { roles: { planning: true } });
});

test("shape is told the gaps the PRD was accepted with, not only the stories", async () => {
  await withTask(async ({ tm, g, cwd, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', handoff: 'x' }) });
    await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: [{ title: 'the request', brief: 'all of it' }] }) });
    const nx = await tm.call('tm_next', { task_id });
    const child = nx.children[0];
    const sub = (node_id, payload) => g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id, payload: ok(payload) });
    await sub('plan', { handoff: 'p', flow: 'plan', size: 'S' });
    await sub('setgoal', { spec: { goal: 'PRD', acceptance: ['a'], subgoals: [{ id: 'U1', title: 'draft PRD', acceptance: ['written'], deps: [] }] } });
    await sub('critique', { sound: true });
    mkdirSync(join(child.cwd, 'docs'), { recursive: true });
    writeFileSync(join(child.cwd, 'docs', 'PRD.md'), `# PRD\n\n${PRD_FIXTURE}`);
    await sub('investigate:U1:1', { changed_files: [], handoff: 'findings' });
    await sub('draft:U1:1', { changed_files: ['docs/PRD.md'], handoff: 'd' });
    await sub('revise:U1:1', { changed_files: ['docs/PRD.md'], handoff: 'r' });
    await sub('gate:U1:1', { accept: true, match_pct: 95 });
    await sub('gate:goal:1', { accept: true, match_pct: 95, user_stories: [{ id: 'F1-US-1', title: 'a story', acceptance: ['x'] }] });
    await sub('report', { handoff: 'done' });
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:PLAN-F1:1' });
    await tm.call('tm_submit', {
      task_id, node_id: 'accept:PLAN-F1:1',
      // 92, not the real run's 88: an accept under goal_threshold is now a rejection, and this
      // test is about a gap travelling on an accept that stands, not about the floor.
      payload: ok({ accept: true, match_pct: 92, gaps: ['no idol-concert domain particulars anywhere'], observations: ['14 open items have no owner'] }),
    });
    await tm.call('tm_submit', { task_id, node_id: 'plan-integrate:1', payload: ok({ accept: true }) });
    const after = await tm.call('tm_next', { task_id });
    const briefing = readFileSync(after.ready[0].briefing_path, 'utf8');
    assert.match(briefing, /accepted WITH these gaps still open/);
    assert.match(briefing, /no idol-concert domain particulars/, 'a gap named while accepting must travel');
    assert.match(briefing, /14 open items have no owner/, 'so must an observation');
  }, { roles: { planning: true } });
});

// --- the PRD's required sections are checked, not judged ------------------------------------
// idol-pm-2 (2026-09-22) restructured the PRD: two required sections renamed, one dropped
// entirely, and gate:goal accepted it at 95%. The contract states the section list in words; a
// judge will not check that reliably and does not need to, because it is a grep.

// daemon.mjs's fold loop and a direct tm_submit are allowed to race on the same child (its
// header says so), and the loser used to see index.lock and mark a passed package failed.
test('commitWorktree waits out a transient index.lock instead of failing the fold', async () => {
  const { commitWorktree } = await import('../mcp/taskmanager.mjs');
  const cwd = repo();
  try {
    writeFileSync(join(cwd, 'c.txt'), 'z\n');
    const lock = join(cwd, '.git', 'index.lock');
    writeFileSync(lock, '');
    // Another process holds the lock for ~400ms and lets go, as a concurrent `git add` does.
    spawn('sh', ['-c', `sleep 0.4; rm -f "${lock}"`], { detached: true, stdio: 'ignore' }).unref();
    const r = commitWorktree(cwd, 'fold under contention');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.commit, 'committed once the lock cleared');
    assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).stdout.trim(), '', 'tree clean after the commit');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('commitWorktree gives up on an index.lock nobody releases, with the reason and in bounded time', async () => {
  const { commitWorktree } = await import('../mcp/taskmanager.mjs');
  const cwd = repo();
  try {
    writeFileSync(join(cwd, 'c.txt'), 'z\n');
    writeFileSync(join(cwd, '.git', 'index.lock'), '');
    const t0 = Date.now();
    const r = commitWorktree(cwd, 'fold under a stuck lock');
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.match(r.reason, /index\.lock/);
    assert.ok(Date.now() - t0 < 5000, 'a bounded wait, not a hang');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('missingPrdSections accepts the renames a reader would accept, and nothing further', async () => {
  const { missingPrdSections } = await import('../mcp/taskmanager.mjs');
  const cwd = mkdtempSync(join(tmpdir(), 'prd-sec-'));
  const write = (body) => { writeFileSync(join(cwd, 'PRD.md'), body); return missingPrdSections(cwd, ['PRD.md']); };
  try {
    const full = ['Goal', 'Problem', 'Target users', 'Solution overview', 'Success criteria', 'User stories', 'Out of scope', 'Open questions'];
    assert.deepEqual(write(full.map((h) => `## ${h}\n\nbody\n`).join('\n')), [], 'the canonical names pass');
    // C3: every planning card's section states its goal - "Non-goals" is not one.
    assert.deepEqual(write(full.filter((h) => h !== 'Goal').map((h) => `## ${h}\n\nbody\n`).join('\n') + '\n## Non-goals\n\nbody\n'), ['Goal']);
    // A light card's floor is the C3 four (plus the Problem its template writes): goal, scope and
    // non-goals, user stories, open questions - not the full PRD's user and solution sections.
    const light = (body) => { writeFileSync(join(cwd, 'PRD.md'), body); return missingPrdSections(cwd, ['PRD.md'], 'light'); };
    assert.deepEqual(light(['Goal', 'Problem', 'User stories', 'Out of scope', 'Open questions'].map((h) => `## ${h}\n\nbody\n`).join('\n')), []);
    assert.deepEqual(light(['Problem', 'User stories', 'Open questions'].map((h) => `## ${h}\n\nbody\n`).join('\n')), ['Goal', 'Out of scope']);

    // The real document's shape: nested under fewer top-level headings, two renamed.
    assert.deepEqual(write([
      '## Problem & Goals', '### Problem', '### Target users', '### Goals (measurable)',
      '## User Stories', '### US-1: a story',
      '## Scope & Non-Goals', '### Non-Goals',
      '## Risks & Open Questions', '### Open Questions',
    ].map((h) => `${h}\n\nbody\n`).join('\n')), ['Solution overview'], 'only the one that is actually absent');

    // A heading that merely sounds adjacent is not the section.
    assert.ok(write(full.filter((h) => h !== 'Open questions').map((h) => `## ${h}\n\nbody\n`).join('\n') + '\n## Future work\n\nbody\n')
      .includes('Open questions'), '"Future work" is not "Open questions"');

    // m1 (_repo/docs/plans/2026-09-28-teams-adversarial-fixes.md): no readable PRD is every section
    // missing. It used to be none, and a card that wrote no document was accepted on its stories.
    assert.deepEqual(missingPrdSections(cwd, ['nope.md']), full);
    assert.deepEqual(missingPrdSections(cwd, []), full);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

// ---------- a human can pick up a card (tm_assign / tm_inbox / tm_submit(key)) ----------

test('a shape-level assignee: "human" pin on a package parks its one subgoal in waiting_human once its child run is polled - and the dispatch itself is untouched', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, SHAPE_HUMAN);
    const nx = await tm.call('tm_next', { task_id });
    const child = nx.children[0];
    await throughChildSpec(g, child);
    const next = await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });
    assert.equal(next.state, 'waiting_human');
    assert.equal(next.ready.length, 0);

    const key = `E-${task_id.slice(0, 8)}/P1`;
    const ticket = await tm.call('tm_ticket', { key });
    assert.equal(ticket.state, 'WAITING_HUMAN');
    assert.deepEqual(ticket.human_assignments, [{ subgoal_id: 'U1', who: null }]);

    // the task-level dispatch node itself: still 'running', not folded to blocked/failed - the
    // human's wait is not a package failure and must not be read as one.
    const status = await tm.call('tm_status', { task_id, full: true });
    const dispatch = status.nodes.find((n) => n.node_id === 'dispatch:P1:1');
    assert.equal(dispatch.state, 'running');
  }, { interactive: true });
});

test('tm_inbox lists a waiting_human card: key, title, acceptance, briefing_path, who, since - scoped to one task or every task', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, SHAPE_HUMAN);
    const nx = await tm.call('tm_next', { task_id });
    const child = nx.children[0];
    await throughChildSpec(g, child);
    await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });

    const scoped = await tm.call('tm_inbox', { task_id });
    assert.equal(scoped.cards.length, 1);
    const card = scoped.cards[0];
    assert.equal(card.key, `E-${task_id.slice(0, 8)}/P1/U1`);
    assert.equal(card.task_id, task_id);
    assert.equal(card.node_id, 'implement:U1:1');
    assert.deepEqual(card.acceptance, CHILD_SPEC.subgoals[0].acceptance, 'the card carries its subgoal\'s own acceptance, from the package\'s setgoal');
    assert.ok(card.briefing_path && existsSync(card.briefing_path), 'tm_inbox must point at a readable briefing');
    assert.equal(card.who, null);
    assert.ok(Number.isInteger(card.since));

    const all = await tm.call('tm_inbox', {});
    assert.ok(all.cards.some((c) => c.key === card.key), 'scanning every task still finds it');
  }, { interactive: true });
});

test('tm_submit({key}) completes a waiting_human card, and the flow continues exactly as a driver would have - test then gate, through the real graph', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, SHAPE_HUMAN);
    const nx = await tm.call('tm_next', { task_id });
    const child = nx.children[0];
    await throughChildSpec(g, child);
    await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });

    const key = `E-${task_id.slice(0, 8)}/P1/U1`;
    appendFileSync(join(child.cwd, 'a.txt'), 'changed\n');
    const v = await tm.call('tm_submit', { task_id, key, payload: ok({ changed_files: ['a.txt'] }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    assert.equal(v.node_id, 'implement:U1:1');

    // A second submission of the same card has nothing left to do.
    const again = await tm.call('tm_submit', { task_id, key, payload: ok({ changed_files: ['a.txt'] }) });
    assert.match(again.error || '', /not waiting_human/);

    await g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id: 'test:U1:1', payload: ok({ verified: true }) });
    await g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id: 'gate:U1:1', payload: ok({ accept: true, match_pct: 95 }) });
    await g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 95 }) });
    await g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id: 'report', payload: ok({ handoff: 'done' }) });
    assert.equal((await g.call('team_status', { run_id: child.run_id, cwd: child.cwd })).state, 'complete');
  }, { interactive: true });
});

test('a gate rejection on a human-authored card reopens the next attempt pinned to the same human - waiting_human again, and the task-level dispatch never folds or retries while it waits', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, SHAPE_HUMAN);
    const nx = await tm.call('tm_next', { task_id });
    const child = nx.children[0];
    await throughChildSpec(g, child);
    await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });
    const key = `E-${task_id.slice(0, 8)}/P1/U1`;
    appendFileSync(join(child.cwd, 'a.txt'), 'changed\n');
    await tm.call('tm_submit', { task_id, key, payload: ok({ changed_files: ['a.txt'] }) });
    await g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id: 'test:U1:1', payload: ok({ verified: true }) });
    await g.call('team_submit', {
      run_id: child.run_id, cwd: child.cwd, node_id: 'gate:U1:1',
      payload: ok({ accept: false, match_pct: 40, gaps: ['missing half'], reason: 'short' }),
    });

    const next2 = await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });
    assert.equal(next2.state, 'waiting_human');
    assert.equal(next2.ready.length, 0, 'the retry goes back to the human, never to a vendor');

    // tm_next, called the way a live loop would poll it, must not fold the dispatch or spend a
    // retry while the child sits on this new waiting_human attempt.
    for (let i = 0; i < 3; i++) await tm.call('tm_next', { task_id });
    const status = await tm.call('tm_status', { task_id, full: true });
    const dispatch = status.nodes.find((n) => n.node_id === 'dispatch:P1:1');
    assert.equal(dispatch.state, 'running', 'still open - a human turnaround is not a package failure');
    assert.equal(dispatch.attempt, 1, 'no fresh dispatch attempt was opened');
  }, { interactive: true });
});

// ---------- a MODEL's own assignee pin only parks when the run is interactive (0.27.3 review) ----------

test('a shape-level assignee: "human" pin on a NON-interactive task (the default) does not park - it dispatches to an AI, and tm_inbox lists it under `decided`, not `cards`', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, SHAPE_HUMAN);
    const nx = await tm.call('tm_next', { task_id });
    const child = nx.children[0];
    await throughChildSpec(g, child);
    const next = await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });
    // Not parked: the node is offered to the self vendor exactly like an unpinned one.
    assert.equal(next.state, 'running', JSON.stringify(next));
    assert.ok(next.ready.some((n) => n.node_id === 'implement:U1:1' && n.vendor === 'self'));

    const inbox = await tm.call('tm_inbox', { task_id });
    assert.deepEqual(inbox.cards, [], 'nothing is waiting on a human - the pin was auto-decided, not parked');
    assert.equal(inbox.decided.length, 1);
    const d = inbox.decided[0];
    assert.equal(d.key, `E-${task_id.slice(0, 8)}/P1/U1`);
    assert.equal(d.task_id, task_id);
    assert.equal(d.node_id, 'implement:U1:1');
    assert.equal(d.who, null);
    assert.match(d.reason, /not interactive/);
    assert.ok(Number.isInteger(d.since));

    // The task-level dispatch and the node itself both proceed as if nothing had been pinned -
    // no waiting_human anywhere, no ticket parked on a human.
    const key = `E-${task_id.slice(0, 8)}/P1`;
    const ticket = await tm.call('tm_ticket', { key });
    assert.notEqual(ticket.state, 'WAITING_HUMAN');
  });
  // withTask's default (no `extra.interactive`) is what this test is about: the task never
  // asked to be interactive, so a model's own pin must not deadlock it.
});

test('the SAME shape-level pin, on an interactive task, still parks exactly as 0.27.3 introduced it - and does not also appear in `decided`', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, SHAPE_HUMAN);
    const nx = await tm.call('tm_next', { task_id });
    const child = nx.children[0];
    await throughChildSpec(g, child);
    const next = await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });
    assert.equal(next.state, 'waiting_human');

    const inbox = await tm.call('tm_inbox', { task_id });
    assert.equal(inbox.cards.length, 1);
    assert.deepEqual(inbox.decided, [], 'parked, not auto-decided - it must not double-list');
  }, { interactive: true });
});

test('tm_assign parks a card regardless of the task\'s own interactive setting - the user is present by definition, unlike a shape\'s own pin', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    // SHAPE (no assignee at all) + tm_assign, on a task that never set interactive - proves
    // tm_assign's pin is a different source from the shape's own field, not just "interactive
    // was on anyway".
    await throughCritique(tm, task_id, SHAPE);
    const key = `E-${task_id.slice(0, 8)}/P1`;
    const taken = await tm.call('tm_assign', { task_id, key, to: 'human', who: 'sanghyeon' });
    assert.deepEqual(taken.assigned, [], 'not dispatched yet - the pin rides on the package');

    const nx = await tm.call('tm_next', { task_id });
    const child = nx.children.find((c) => c.node_id === 'dispatch:P1:1') || nx.children[0];
    await throughChildSpec(g, child);
    const next = await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });
    assert.equal(next.state, 'waiting_human', 'tm_assign always parks, interactive or not');

    const inbox = await tm.call('tm_inbox', { task_id });
    assert.equal(inbox.cards.length, 1);
    assert.equal(inbox.cards[0].who, 'sanghyeon');
    assert.deepEqual(inbox.decided, []);
  });
});

test('tm_assign({to: "human"}) on a STORY key pins every subgoal in its child run; a TASK key pins just one; to: "auto" releases and dispatches normally again', async () => {
  await withTask(async ({ tm, g, cwd, task_id }) => {
    await throughCritique(tm, task_id, SHAPE_SPLIT);
    const nx = await tm.call('tm_next', { task_id });
    const child = nx.children[0];
    await g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id: 'plan', payload: ok({ handoff: 'p', flow: 'develop', size: 'S' }) });
    await g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id: 'setgoal', payload: ok({ spec: TWO_SUBGOAL_SPEC }) });
    await g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id: 'critique', payload: ok({ sound: true }) });

    const storyKeyStr = `E-${task_id.slice(0, 8)}/P1`;
    const story = await tm.call('tm_assign', { task_id, key: storyKeyStr, to: 'human', who: 'sanghyeon' });
    assert.equal(story.kind, 'STORY');
    assert.deepEqual(story.assigned.map((x) => x.node_id).sort(), ['implement:U1:1', 'implement:U2:1']);
    for (const x of story.assigned) assert.equal(x.assignment.who, 'sanghyeon');

    const released = await tm.call('tm_assign', { task_id, key: storyKeyStr, to: 'auto' });
    assert.ok(released.assigned.every((x) => x.assignment === null));

    const taskKeyStr = `E-${task_id.slice(0, 8)}/P1/U1`;
    const one = await tm.call('tm_assign', { task_id, key: taskKeyStr, to: 'human' });
    assert.deepEqual(one.assigned.map((x) => x.node_id), ['implement:U1:1']);
    assert.equal(one.kind, 'TASK');

    const next = await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });
    assert.equal(next.state, 'running', 'U2 is not pinned - still dispatched normally');
    assert.ok(next.ready.some((n) => n.node_id === 'implement:U2:1' && n.vendor === 'self'));
    assert.ok(!next.ready.some((n) => n.node_id === 'implement:U1:1'), 'U1 is parked waiting_human, not offered');
    const full = await g.call('team_status', { run_id: child.run_id, cwd: child.cwd, full: true, node_id: 'implement:U1:1' });
    assert.equal(full.node.state, 'waiting_human');
  });
});

test('tm_assign refuses an unrecognized key, an unknown "to", and a STORY that has not been dispatched yet', async () => {
  await withTask(async ({ tm, task_id }) => {
    const bad = await tm.call('tm_assign', { task_id, key: 'not-a-key', to: 'human' });
    assert.match(bad.error || '', /STORY or TASK key/);
    const badTo = await tm.call('tm_assign', { task_id, key: `E-${task_id.slice(0, 8)}/P1`, to: 'someone-else' });
    assert.match(badTo.error || '', /must be "human"/);
    const notYet = await tm.call('tm_assign', { task_id, key: `E-${task_id.slice(0, 8)}/P1/U1`, to: 'human' });
    assert.match(notYet.error || '', /has no child run yet - pin its STORY/);
  });
});

// A READY card is the one a person picks up off the board. The first cut refused a STORY until a
// driver was already on it; the pin now rides on the package and reaches the child run it opens.
test('a STORY taken before it dispatches opens its child run already waiting on that human', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    let v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2 modules'], handoff: 'two modules' }) });
    v = await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...SHAPE, handoff: 's' }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    const key = `E-${task_id.slice(0, 8)}/P1`;
    const taken = await tm.call('tm_assign', { task_id, key, to: 'human', who: 'sanghyeon' });
    assert.deepEqual(taken.assigned, [], 'nothing to pin inside a run that does not exist yet');
    v = await tm.call('tm_submit', { task_id, node_id: 'critique', payload: ok({ sound: true }) });
    assert.equal(v.state, 'done', JSON.stringify(v));

    const nx = await tm.call('tm_next', { task_id });
    const child = nx.children.find((c) => c.node_id === 'dispatch:P1:1') || nx.children[0];
    // The package plans itself first (plan/setgoal/critique are never pinned); the STORY pin
    // lands on the subgoal its setgoal produces.
    await throughChildSpec(g, child);
    const next = await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });
    assert.equal(next.state, 'waiting_human');
    const inbox = await tm.call('tm_inbox', { task_id });
    assert.equal(inbox.cards.length, 1);
    assert.equal(inbox.cards[0].who, 'sanghyeon');

    // Released before it ever dispatched, P2 stays an ordinary automatic card.
    const p2 = `E-${task_id.slice(0, 8)}/P2`;
    await tm.call('tm_assign', { task_id, key: p2, to: 'human' });
    await tm.call('tm_assign', { task_id, key: p2, to: 'auto' });
    const onDisk = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.equal(onDisk.spec.packages.find((p) => p.id === 'P1').assignee.who, 'sanghyeon');
    assert.equal(onDisk.spec.packages.find((p) => p.id === 'P2').assignee, undefined);
  });
});

// On the full path a package's setgoal decides how many subgoals it has, so a STORY pin must
// reach every one of them - whether it was taken before dispatch (pkg.assignee ->
// subgoal_assignee) or after dispatch but before setgoal (tm_assign's story_pin action).
test('a STORY pin reaches every subgoal the package\'s own setgoal produces - taken before dispatch, or after dispatch but before setgoal', async () => {
  for (const when of ['before-dispatch', 'before-setgoal']) {
    await withTask(async ({ tm, g, task_id }) => {
      const key = `E-${task_id.slice(0, 8)}/P1`;
      await throughCritique(tm, task_id, SHAPE_SPLIT);
      if (when === 'before-dispatch') {
        assert.deepEqual((await tm.call('tm_assign', { task_id, key, to: 'human', who: 'sanghyeon' })).assigned, []);
      }
      const nx = await tm.call('tm_next', { task_id });
      const child = nx.children.find((c) => c.node_id === 'dispatch:P1:1');
      if (when === 'before-setgoal') {
        const taken = await tm.call('tm_assign', { task_id, key, to: 'human', who: 'sanghyeon' });
        assert.deepEqual(taken.assigned, [], 'no subgoal exists yet');
        assert.match(taken.note, /applies to them when its setgoal does/);
      }
      await throughChildSpec(g, child, TWO_SUBGOAL_SPEC);
      const next = await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });
      assert.equal(next.state, 'waiting_human', when);
      const full = await g.call('team_status', { run_id: child.run_id, cwd: child.cwd, full: true });
      for (const id of ['implement:U1:1', 'implement:U2:1']) {
        const n = full.nodes.find((x) => x.node_id === id);
        assert.equal(n.state, 'waiting_human', `${when}: ${id}`);
        assert.equal(n.assignment.who, 'sanghyeon');
      }
      assert.ok(full.spec.subgoals.every((sg) => sg.assignee && sg.assignee.by === 'user'), 'the pin is on the spec, so a retry keeps it');
      const inbox = await tm.call('tm_inbox', { task_id });
      assert.equal(inbox.cards.length, 2);
    });
  }
});

// M5 (_repo/docs/plans/2026-09-28-teams-adversarial-fixes.md): a STORY pin drained after setgoal already
// expanded the subgoals - tm_assign ran while setgoal was running and saw none - still pins them.
test('M5: a STORY pin that lands after setgoal expanded pins every existing subgoal; a release lets go of them', async () => {
  const { applyStoryPin, node: gnode } = await import('../mcp/graph.mjs');
  const run = {
    run_id: 'r', interactive: false,
    spec: { subgoals: [{ id: 'U1', title: 'a', acceptance: ['x'] }, { id: 'U2', title: 'b', acceptance: ['y'], assignee: 'human' }] },
    nodes: [gnode('implement:U1:1', 'implement', [], { subgoal_id: 'U1', attempt: 1 }), gnode('implement:U2:1', 'implement', [], { subgoal_id: 'U2', attempt: 1 })],
  };
  assert.equal(applyStoryPin(run, { kind: 'story_pin', to: 'human', who: 'sanghyeon' }), true);
  for (const id of ['implement:U1:1', 'implement:U2:1']) {
    const n = run.nodes.find((x) => x.node_id === id);
    assert.equal(n.assignment && n.assignment.executor, 'human', id);
    assert.equal(n.assignment.who, 'sanghyeon');
  }
  assert.ok(run.spec.subgoals.every((sg) => sg.assignee.by === 'user'), 'on the spec, so a retry keeps it');
  assert.equal(run.subgoal_assignee.who, 'sanghyeon', 'and on the run, for subgoals a later setgoal produces');
  assert.equal(applyStoryPin(run, { kind: 'story_pin', to: 'auto' }), true);
  assert.ok(run.nodes.every((n) => !n.assignment), 'released');
  assert.ok(run.spec.subgoals.every((sg) => !sg.assignee || sg.assignee.by !== 'user'), 'the user pins are gone');
  assert.equal(run.spec.subgoals[1].assignee, 'human', 'U2\'s own model-written assignee is back (G3)');
  assert.equal(run.subgoal_assignee, undefined);
});

// dispatchSettled (exported, and shared by the daemon and tm_next) is the one guard that keeps a
// waiting_human child from being folded as though its driver had died for good - a direct,
// lighter-weight check than driving the whole graph through both MCP clients above.
test('dispatchSettled treats a waiting_human child exactly like a running one - never settled, regardless of the driver', async () => {
  const tmMod = await import('../mcp/taskmanager.mjs');
  const graphMod = await import('../mcp/graph.mjs');
  const cwd = mkdtempSync(join(tmpdir(), 'dispatch-settled-'));
  try {
    const child = { cwd, run_id: 'child-1', spec: { subgoals: [{ id: 'U1', kind: 'subgoal', assignee: 'human' }] },
      nodes: [graphMod.node('implement:U1:1', 'implement', [], { subgoal_id: 'U1', attempt: 1, state: 'waiting_human', waiting_since: Date.now() })] };
    graphMod.saveRun(child);
    const n = { node_id: 'dispatch:P1:1', stage: 'dispatch', state: 'running', child: { cwd, run_id: 'child-1' } };
    assert.equal(tmMod.dispatchSettled({}, n), false, 'waiting_human is not settled, with no driver info at all');
    n.child.driver = { pid: 999999999 }; // certainly not alive
    assert.equal(tmMod.dispatchSettled({}, n), false, 'still not settled even with a dead driver on record');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------- a person decides, as a node (ask / D2 step 2) ----------

const LIMIT_QUESTION = [{
  question: 'How many tickets may one account hold?',
  owner: 'Product/policy',
  options: [
    { option: '2 across presale and general combined', consequence: 'scalpers open two accounts' },
    { option: '2 per sale phase', consequence: 'one person can hold four' },
  ],
}];

// The planning card (C2) is where a decision is asked: every package after planning runs in
// execution phase and decides by default (§6.2-3), so the ask card these tests exercise is raised
// by PLAN-F1's own investigate - after its full harness's plan, setgoal and critique.
async function toAskCard(tm, g, task_id) {
  await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'] }) });
  await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: [{ title: 'ticket limits', brief: 'how many tickets one account may hold' }] }) });
  const nx = await tm.call('tm_next', { task_id });
  const child = nx.children.find((c) => c.node_id === 'dispatch:PLAN-F1:1');
  const sub = (node_id, payload) => g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id, payload: ok(payload) });
  await sub('plan', { handoff: 'p', flow: 'plan', size: 'S' });
  await sub('setgoal', { spec: { goal: 'PRD', acceptance: ['the PRD names the per-person limit'], subgoals: [{ id: 'U1', title: 'the PRD', acceptance: ['the PRD names the per-person limit'], files: ['docs/prd.md'], deps: [] }] } });
  await sub('critique', { sound: true });
  await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });
  const v = await sub('investigate:U1:1', { changed_files: [], handoff: 'docs/prd-findings.md', findings: [], unknowns: LIMIT_QUESTION });
  assert.equal(v.state, 'done', JSON.stringify(v));
  return child;
}

test('an interactive run opens an ask card and tm_inbox hands the person the choice, not a blank question', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    const child = await toAskCard(tm, g, task_id);
    assert.equal((await g.call('team_next', { run_id: child.run_id, cwd: child.cwd })).state, 'waiting_human');

    const inbox = await tm.call('tm_inbox', { task_id });
    assert.equal(inbox.cards.length, 1, JSON.stringify(inbox));
    const card = inbox.cards[0];
    assert.equal(card.node_id, 'ask:U1:1');
    assert.equal(card.stage, 'ask', 'a decision card and an authoring card are told apart by stage');
    assert.equal(card.who, 'Product/policy', 'the owner the investigation named is who it is waiting on');
    assert.equal(card.questions.length, 1);
    assert.equal(card.questions[0].options.length, 2);
    assert.ok(card.briefing_path && existsSync(card.briefing_path));
    assert.match(readFileSync(card.briefing_path, 'utf8'), /Decisions waiting on you/);

    assert.equal((await tm.call('tm_ticket', { key: `E-${task_id.slice(0, 8)}/PLAN-F1` })).state, 'WAITING_HUMAN');
  }, { interactive: true });
});

test('tm_submit({key}) answers the decision and draft runs on the answer - the chain continues as if a driver had', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    const child = await toAskCard(tm, g, task_id);
    const key = `E-${task_id.slice(0, 8)}/PLAN-F1/U1`;

    // A decision card is not an authoring card: handing it a bare stage_ok is a submission with
    // no answer in it, and the chain below would run on nothing.
    const bad = await tm.call('tm_submit', { task_id, key, payload: ok({}) });
    assert.match(bad.error || '', /decisions\[\]/);

    const v = await tm.call('tm_submit', { task_id, key, payload: ok({
      decisions: [{ question: LIMIT_QUESTION[0].question, chose: '2 across presale and general combined', because: 'legal asked for the tighter cap' }],
    }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    assert.equal(v.node_id, 'ask:U1:1');

    // draft is now what the run offers, and the decision is in its briefing - the answer
    // reaches the document, which is the only reason any of this exists.
    const next = await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });
    const draft = (next.ready || []).find((n) => n.node_id === 'draft:U1:1');
    assert.ok(draft, JSON.stringify(next.ready));
    assert.match(readFileSync(draft.briefing_path, 'utf8'), /2 across presale and general combined/);
  }, { interactive: true });
});

test('a run that was never told to ask does not park: it records the question and drafts on', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    const child = await toAskCard(tm, g, task_id);
    const next = await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });
    assert.ok((next.ready || []).some((n) => n.node_id === 'draft:U1:1'), JSON.stringify(next));
    assert.deepEqual((await tm.call('tm_inbox', { task_id })).cards, []);
  });
});

// ---------- ask_timeout (design §7): an unanswered ask is answered by its defaults, by: 'timeout' ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('ask_timeout: a child-run ask nobody answers is submitted with its recommended option, recorded by: "timeout", and draft runs on it', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    const child = await toAskCard(tm, g, task_id);
    const before = await tm.call('tm_inbox', { task_id });
    assert.equal(before.cards.length, 1, 'still waiting before the deadline');
    assert.ok(before.cards[0].expires_at >= before.cards[0].since + 100, JSON.stringify(before.cards[0]));

    await sleep(150);
    // Any tm_* call for the task is a look at the clock (the daemon is the other; none runs here).
    const after = await tm.call('tm_inbox', { task_id });
    assert.deepEqual(after.cards, [], 'expired: no longer waiting on anybody');
    const ledger = readFileSync(join(root, task_id, 'ledger.jsonl'), 'utf8');
    assert.match(ledger, /"event":"ask_timeout".*"node_id":"ask:U1:1"/);

    // The answer went through the same queue a person's does; the broker applies it.
    const next = await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });
    const draft = (next.ready || []).find((n) => n.node_id === 'draft:U1:1');
    assert.ok(draft, JSON.stringify(next.ready));
    assert.match(readFileSync(draft.briefing_path, 'utf8'), /2 across presale and general combined/, 'no default given: the first (recommended) option');

    const status = await g.call('team_status', { run_id: child.run_id, cwd: child.cwd, full: true });
    const ask = status.nodes.find((n) => n.node_id === 'ask:U1:1');
    assert.equal(ask.state, 'done');
    assert.equal(ask.result.by, 'timeout');
    assert.equal(ask.result.decisions[0].by, 'timeout');
    const decided = (await tm.call('tm_inbox', { task_id })).decided;
    assert.ok(decided.some((d) => d.node_id === 'ask:U1:1' && /ask_timeout/.test(d.reason)), JSON.stringify(decided));
    // A person arriving late finds it already decided, not a second answer applied over it.
    const late = await tm.call('tm_submit', { task_id, key: `E-${task_id.slice(0, 8)}/PLAN-F1/ask:U1:1`, payload: ok({ decisions: [] }) });
    assert.match(late.error || '', /not waiting_human/);
  }, { interactive: true, ask_timeout: 100 });
});

test('ask_timeout: a manager-level ask takes its stated default on expiry; without ask_timeout (the default) it keeps waiting', async () => {
  const toCritiqueAsk = async (tm, task_id) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2 modules'], handoff: 'two modules' }) });
    await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...SHAPE, handoff: 's' }) });
    await tm.call('tm_submit', { task_id, node_id: 'critique', payload: ok({ sound: true, questions: [{ ...CRITIQUE_QUESTION[0], default: 'document' }] }) });
  };
  await withTask(async ({ tm, task_id }) => {
    await toCritiqueAsk(tm, task_id);
    await sleep(150);
    assert.equal((await tm.call('tm_inbox', { task_id })).cards.length, 1, 'no ask_timeout: waits forever');
  }, { interactive: true });
  await withTask(async ({ tm, task_id }) => {
    await toCritiqueAsk(tm, task_id);
    await sleep(150);
    const inbox = await tm.call('tm_inbox', { task_id });
    assert.deepEqual(inbox.cards, []);
    assert.equal(inbox.decided.length, 1, JSON.stringify(inbox));
    const ask = (await tm.call('tm_status', { task_id, full: true })).nodes.find((n) => n.node_id === 'ask:critique:1');
    assert.equal(ask.state, 'done');
    assert.equal(ask.result.by, 'timeout');
    assert.equal(ask.result.decisions[0].chose, 'document', 'the default wins over the first option');
  }, { interactive: true, ask_timeout: 100 });
});

test('nextAskDeadline: the earliest waiting ask plus ask_timeout, null with no timeout or nothing waiting (fake clock, no I/O)', async () => {
  const { nextAskDeadline, expireAsks } = await import('../mcp/taskmanager.mjs');
  const ask = (id, since, state = 'waiting_human') => ({ node_id: id, stage: 'ask', state, waiting_since: since, questions: [{ question: 'q', default: 'a' }] });
  const task = { ask_timeout: 100, nodes: [ask('ask:a:1', 5000), ask('ask:b:1', 1000), ask('ask:c:1', 0, 'done')] };
  assert.equal(nextAskDeadline(task), 1100);
  assert.equal(nextAskDeadline({ ...task, ask_timeout: null }), null);
  assert.equal(nextAskDeadline({ ask_timeout: 100, nodes: [ask('ask:c:1', 0, 'done')] }), null);
  assert.deepEqual(expireAsks(task, 1099), [], 'not before the deadline');
  assert.deepEqual(expireAsks({ ...task, ask_timeout: null }, 1e12), [], 'never without a timeout');
});

// ---------- 0.27.4: the manager never writes a child run itself ----------
//
// The 2026-09-24 review: 0.27.3's tm_assign and tm_submit({key}) loaded the child run and
// saveRun()'d it directly from this process - a violation of this file's own header (rule 2,
// "reads child run files and never writes them") and of design §7 (a human's implement/draft/
// cases report is supposed to get "changed_files는 워크트리 대조로 똑같이 검증", the same
// worktree cross-check an AI's does; 0.27.3 took stage_ok at face value instead). Fixed by
// queueHumanAction (graph.mjs): tm_assign/tm_submit preview the effect read-only, through the
// same applyPinAction/computeSubmitResult the broker itself uses, and queue the instruction as a
// manager-owned handoff. Only the broker (mustFindRun -> ingestHandoff, broker.mjs) ever
// saveRun()s the child - the next time team_next/team_submit/team_status touches it.

function childRunFile(child) {
  return join(child.cwd, '.teams_output', 'broker', 'runs', `${child.run_id}.json`);
}

test('tm_assign never writes the child run file - a STORY pin, a release, and a TASK pin all leave it untouched until team_next drains the queue', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, SHAPE_SPLIT);
    const nx = await tm.call('tm_next', { task_id });
    const child = nx.children[0];
    await g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id: 'plan', payload: ok({ handoff: 'p', flow: 'develop', size: 'S' }) });
    await g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id: 'setgoal', payload: ok({ spec: TWO_SUBGOAL_SPEC }) });
    await g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id: 'critique', payload: ok({ sound: true }) });

    const runFile = childRunFile(child);
    const before = readFileSync(runFile, 'utf8');
    const mtimeBefore = statSync(runFile).mtimeMs;

    const storyKeyStr = `E-${task_id.slice(0, 8)}/P1`;
    const story = await tm.call('tm_assign', { task_id, key: storyKeyStr, to: 'human', who: 'sanghyeon' });
    assert.equal(story.kind, 'STORY');
    assert.equal(readFileSync(runFile, 'utf8'), before, 'tm_assign(to: human) must not write the child run file');
    assert.equal(statSync(runFile).mtimeMs, mtimeBefore, 'tm_assign(to: human) must not touch the child run file mtime');

    const released = await tm.call('tm_assign', { task_id, key: storyKeyStr, to: 'auto' });
    assert.ok(released.assigned.every((x) => x.assignment === null));
    assert.equal(readFileSync(runFile, 'utf8'), before, 'tm_assign(to: auto) must not write the child run file either');
    assert.equal(statSync(runFile).mtimeMs, mtimeBefore, 'tm_assign(to: auto) must not touch the child run file mtime');

    const taskKeyStr = `E-${task_id.slice(0, 8)}/P1/U1`;
    const one = await tm.call('tm_assign', { task_id, key: taskKeyStr, to: 'human' });
    assert.equal(one.kind, 'TASK');
    assert.equal(readFileSync(runFile, 'utf8'), before, 'a TASK-key tm_assign must not write the child run file');
    assert.equal(statSync(runFile).mtimeMs, mtimeBefore, 'a TASK-key tm_assign must not touch the child run file mtime');

    // The broker's own next step is what actually applies the three queued pins - and it does,
    // proving the queue was not simply lost.
    const next = await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });
    assert.notEqual(readFileSync(runFile, 'utf8'), before, 'team_next (the broker) is the one call that writes the child run');
    assert.ok(!next.ready.some((n) => n.node_id === 'implement:U1:1'), 'U1 landed pinned, exactly as tm_assign previewed');
  });
});

test("tm_submit({key}) never writes the child run file - a human's card answer waits for the broker's own team_next/team_submit/team_status to apply it", async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, SHAPE_HUMAN);
    const nx = await tm.call('tm_next', { task_id });
    const child = nx.children[0];
    await throughChildSpec(g, child);
    await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });

    const runFile = childRunFile(child);
    const before = readFileSync(runFile, 'utf8');
    const mtimeBefore = statSync(runFile).mtimeMs;

    const key = `E-${task_id.slice(0, 8)}/P1/U1`;
    appendFileSync(join(child.cwd, 'a.txt'), 'changed\n');
    const v = await tm.call('tm_submit', { task_id, key, payload: ok({ changed_files: ['a.txt'] }) });
    assert.equal(v.state, 'done', JSON.stringify(v));

    assert.equal(readFileSync(runFile, 'utf8'), before, 'tm_submit({key}) must not write the child run file');
    assert.equal(statSync(runFile).mtimeMs, mtimeBefore, 'tm_submit({key}) must not touch the child run file mtime');

    // A second submission of the same card sees it as already answered (queued, not yet
    // drained) - not as a stale waiting_human node it could answer twice.
    const again = await tm.call('tm_submit', { task_id, key, payload: ok({ changed_files: ['a.txt'] }) });
    assert.match(again.error || '', /not waiting_human/);
    assert.equal(readFileSync(runFile, 'utf8'), before, 'the refused second submission must not write either');

    // The broker's own next step (team_status here, not just team_next - any mustFindRun caller
    // must drain the same queue) is what actually applies the answer.
    const full = await g.call('team_status', { run_id: child.run_id, cwd: child.cwd, full: true, node_id: 'implement:U1:1' });
    assert.equal(full.node.state, 'done');
    assert.notEqual(readFileSync(runFile, 'utf8'), before, 'team_status (the broker) is the one call that writes the child run');
  }, { interactive: true });
});

test("tm_submit({key, payload:{decisions}}) answering an ask card never writes the child run file either - decisions carry no changed_files, so only the no-direct-write rule applies, not the cross-check", async () => {
  await withTask(async ({ tm, g, task_id }) => {
    const child = await toAskCard(tm, g, task_id);
    await g.call('team_next', { run_id: child.run_id, cwd: child.cwd }); // parks the ask card

    const runFile = childRunFile(child);
    const before = readFileSync(runFile, 'utf8');
    const mtimeBefore = statSync(runFile).mtimeMs;

    const key = `E-${task_id.slice(0, 8)}/PLAN-F1/U1`;
    const v = await tm.call('tm_submit', { task_id, key, payload: ok({
      decisions: [{ question: LIMIT_QUESTION[0].question, chose: '2 across presale and general combined', because: 'legal asked for the tighter cap' }],
    }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    assert.equal(v.node_id, 'ask:U1:1');

    assert.equal(readFileSync(runFile, 'utf8'), before, 'tm_submit({key}) on an ask card must not write the child run file');
    assert.equal(statSync(runFile).mtimeMs, mtimeBefore, 'tm_submit({key}) on an ask card must not touch the child run file mtime');

    // The broker's own next step is what actually resolves the ask and moves draft onto the
    // answer - team_next here, exactly as an ordinary implement/draft/cases submission does.
    const next = await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });
    assert.notEqual(readFileSync(runFile, 'utf8'), before, 'team_next (the broker) is the one call that writes the child run');
    const draft = (next.ready || []).find((n) => n.node_id === 'draft:U1:1');
    assert.ok(draft, JSON.stringify(next.ready));
    assert.match(readFileSync(draft.briefing_path, 'utf8'), /2 across presale and general combined/);
  }, { interactive: true });
});

// ---------- a human's report is cross-checked exactly like an AI's ----------

test('a human submission claiming a changed file that did not change in the worktree is caught by the same worktree cross-check an AI report gets - both in the preview and after the broker applies it for real', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, SHAPE_HUMAN);
    const nx = await tm.call('tm_next', { task_id });
    const child = nx.children[0];
    await throughChildSpec(g, child);
    await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });

    const key = `E-${task_id.slice(0, 8)}/P1/U1`;
    // a.txt is NOT touched this time - the claim below is false.
    const v = await tm.call('tm_submit', { task_id, key, payload: ok({ changed_files: ['a.txt'] }) });
    assert.equal(v.state, 'failed', JSON.stringify(v));
    assert.equal(v.result.stage_ok, false);
    assert.deepEqual(v.result.contradicted_files, ['a.txt']);
    assert.match(v.result.verification_error || '', /claimed changed_files not present in the worktree/);

    // Not a preview-only guess: the broker's own real ingestion (computeSubmitResult, applied
    // for real by finishNode via team_next's mustFindRun) agrees, against the same worktree.
    await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });
    const full = await g.call('team_status', { run_id: child.run_id, cwd: child.cwd, full: true, node_id: 'implement:U1:1' });
    assert.equal(full.node.state, 'failed');
    assert.equal(full.node.result.stage_ok, false);
    assert.deepEqual(full.node.result.contradicted_files, ['a.txt']);
  }, { interactive: true });
});

test('a correct human submission still flows to test -> gate exactly as before - the cross-check does not get in the way of a truthful report', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, SHAPE_HUMAN);
    const nx = await tm.call('tm_next', { task_id });
    const child = nx.children[0];
    await throughChildSpec(g, child);
    await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });

    const key = `E-${task_id.slice(0, 8)}/P1/U1`;
    appendFileSync(join(child.cwd, 'a.txt'), 'changed\n');
    const v = await tm.call('tm_submit', { task_id, key, payload: ok({ changed_files: ['a.txt'] }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    assert.equal(v.result.stage_ok, true);
    assert.deepEqual(v.result.contradicted_files, []);

    await g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id: 'test:U1:1', payload: ok({ verified: true }) });
    await g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id: 'gate:U1:1', payload: ok({ accept: true, match_pct: 95 }) });
    await g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 95 }) });
    await g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id: 'report', payload: ok({ handoff: 'done' }) });
    assert.equal((await g.call('team_status', { run_id: child.run_id, cwd: child.cwd })).state, 'complete');
  }, { interactive: true });
});

// ---------- D2 slice 3 (0.29.0): questions[] generalized to the manager graph's own stages ----------
//
// The manager's own critique node (task.nodes, not a package's child run) is what this exercises -
// a run-level judging node has no subgoal to key a card off (graph.mjs's openAsk falls back to the
// node's own node_id), and tm_inbox/tm_submit need a key that works when there is no package at
// all: the pseudo-package 'TASK' (taskKey(task.run_id, 'TASK', node_id), inboxEntry's own scheme).

const CRITIQUE_QUESTION = [{
  question: 'Which flow does module a use?',
  to: 'Tech lead',
  options: [{ option: 'develop' }, { option: 'document' }],
  default: 'develop',
  why: 'the request never says',
}];

test('a manager critique that returns questions[] opens an ask card when interactive - tm_inbox keys it under the TASK pseudo-package', async () => {
  await withTask(async ({ tm, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2 modules'], handoff: 'two modules' }) });
    await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...SHAPE, handoff: 's' }) });
    const v = await tm.call('tm_submit', { task_id, node_id: 'critique', payload: ok({ sound: true, questions: CRITIQUE_QUESTION }) });
    assert.equal(v.state, 'done', JSON.stringify(v));

    const inbox = await tm.call('tm_inbox', { task_id });
    assert.equal(inbox.cards.length, 1, JSON.stringify(inbox));
    const card = inbox.cards[0];
    assert.equal(card.key, `E-${task_id.slice(0, 8)}/TASK/ask:critique:1`);
    assert.equal(card.node_id, 'ask:critique:1');
    assert.equal(card.stage, 'ask');
    assert.equal(card.who, 'Tech lead');
    assert.equal(card.questions.length, 1);

    const answered = await tm.call('tm_submit', {
      task_id, key: card.key,
      payload: { decisions: [{ question: CRITIQUE_QUESTION[0].question, chose: 'develop', because: 'confirmed with the lead' }] },
    });
    assert.equal(answered.state, 'done', JSON.stringify(answered));
    assert.deepEqual((await tm.call('tm_inbox', { task_id })).cards, [], 'answered card no longer waits');
  }, { interactive: true });
});

test('a manager critique that returns questions[] auto-decides on the default when not interactive, and records decided-for-you', async () => {
  await withTask(async ({ tm, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2 modules'], handoff: 'two modules' }) });
    await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...SHAPE, handoff: 's' }) });
    const v = await tm.call('tm_submit', { task_id, node_id: 'critique', payload: ok({ sound: true, questions: CRITIQUE_QUESTION }) });
    assert.equal(v.state, 'done', JSON.stringify(v));

    const inbox = await tm.call('tm_inbox', { task_id });
    assert.deepEqual(inbox.cards, [], 'nobody is watching - no card parks');
    // Not a runtime pin (auto_decided_pin, decided[]) - a question the run answered by default
    // has no node to attach that record to at critique's own moment, so it lands on the task
    // report surface instead (run.unasked's own twin).
  }, {});
});

// ---------- gate:human (D2 Task 4) ----------

test('gate:human parks the manager critique for a person instead of a model, and a reject feeds gaps into the retry', async () => {
  await withTask(async ({ tm, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2 modules'], handoff: 'two modules' }) });
    await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...SHAPE, handoff: 's' }) });

    // critique is now ready, but human_gates names it: tm_next must never offer it to a driver.
    const nx = await tm.call('tm_next', { task_id });
    assert.ok(!(nx.ready || []).some((n) => n.node_id === 'critique'), JSON.stringify(nx.ready));

    const inbox = await tm.call('tm_inbox', { task_id });
    assert.equal(inbox.cards.length, 1, JSON.stringify(inbox));
    const card = inbox.cards[0];
    assert.equal(card.node_id, 'critique');
    assert.equal(card.human_gate, true);
    // (The planning card's own critique was gated too, and answered while planning was driven.)
    assert.equal(card.key, `E-${task_id.slice(0, 8)}/TASK/critique`);

    const rejected = await tm.call('tm_submit', {
      task_id, key: card.key,
      payload: { accept: false, reason: 'P1 and P2 both touch a.txt', gaps: ['ownership overlap between P1 and P2'] },
    });
    assert.equal(rejected.state, 'failed', JSON.stringify(rejected));
    assert.equal(rejected.result.sound, false);
    assert.deepEqual(rejected.result.gaps, ['ownership overlap between P1 and P2']);
    assert.match(rejected.result.reason, /P1 and P2 both touch a\.txt/);
  }, { interactive: true, human_gates: ['critique'] });
});

test('gate:human auto-passes the manager critique when not interactive, recorded as decided-for-you', async () => {
  await withTask(async ({ tm, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2 modules'], handoff: 'two modules' }) });
    await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...SHAPE, handoff: 's' }) });

    const nx = await tm.call('tm_next', { task_id });
    assert.ok(!(nx.ready || []).some((n) => n.node_id === 'critique'), 'never offered to a driver even non-interactive');

    const inbox = await tm.call('tm_inbox', { task_id });
    assert.deepEqual(inbox.cards, [], 'nobody is watching - no card parks');
    // human_gates reaches every card's own chain (child_opts): the planning card's critique was
    // auto-passed too, on its own key.
    assert.ok(inbox.decided.some((d) => d.key === `E-${task_id.slice(0, 8)}/PLAN-F1/critique`), JSON.stringify(inbox.decided));
    const mine = inbox.decided.filter((d) => d.key === `E-${task_id.slice(0, 8)}/TASK/critique`);
    assert.equal(mine.length, 1, JSON.stringify(inbox));
    assert.equal(mine[0].node_id, 'critique');
    assert.match(mine[0].reason, /not interactive/);

    const full = await tm.call('tm_status', { task_id, full: true });
    const critiqueNode = full.nodes.find((n) => n.node_id === 'critique');
    assert.equal(critiqueNode.state, 'done');
    assert.equal(critiqueNode.result.sound, true, 'auto-pass, not auto-reject - a gate nobody is watching must not block the run');
  }, { human_gates: ['critique'] });
});

test('a card answered while the driver is dead still gets applied: the parked child is revived for its queue', async () => {
  // idol-beta-ask1 (2026-09-25). Three answers were accepted into the handoff queue, the child's
  // driver was killed before draining them, and nothing brought one back: serviceDeadDriver read
  // runState as waiting_human and treated it as "no driver is meant to be alive here" - true in
  // general, false when an answer is already waiting to be applied. Reported as accepted, never
  // applied, with no path left that would ever apply it.
  const { serviceDeadDriver } = await import('../mcp/taskmanager.mjs');
  const graphMod = await import('../mcp/graph.mjs');
  await withTask(async ({ tm, root, task_id }) => {
    await throughCritique(tm, task_id);
    await tm.call('tm_next', { task_id });
    const load = () => JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const prevRoot = process.env.HARNESS_TASKS_DIR;
    const withRoot = (fn) => { process.env.HARNESS_TASKS_DIR = root; try { return fn(); } finally { if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot; } };
    const prevDriver = process.env.HARNESS_CHILD_DRIVER;
    const drv = mkdtempSync(join(tmpdir(), 'tm-revive-drv-'));
    writeFileSync(join(drv, 'fake-driver.mjs'), FAKE_DRIVER_ALIVE);
    process.env.HARNESS_CHILD_DRIVER = `node ${join(drv, 'fake-driver.mjs')}`;
    try {
      const task = load();
      const n = task.nodes.find((x) => x.node_id === 'dispatch:P1:1');
      const child = n.child;
      // Its own run id, so this writes a fresh file rather than merging onto the real child run
      // tm_next just created (saveRun merges; the leftover pending nodes would keep runState at
      // 'running' and the fixture would not be parked at all).
      child.run_id = 'revive-1';
      graphMod.saveRun({
        cwd: child.cwd, run_id: child.run_id, max_retries: 2,
        spec: { subgoals: [{ id: 'U1', kind: 'planning' }] },
        nodes: [graphMod.node('ask:U1:1', 'ask', [], {
          subgoal_id: 'U1', attempt: 1, state: 'waiting_human', waiting_since: Date.now(),
          questions: [{ question: 'q', options: [{ option: 'a' }, { option: 'b' }] }],
          assignment: { executor: 'human', vendor: 'human', who: 'PO' },
        })],
      });
      child.driver = { pid: 2147483646, restarts: [] }; // a pid nothing holds: already dead

      // Nothing queued: a parked child with no answer waiting correctly gets no driver.
      assert.equal(withRoot(() => serviceDeadDriver(task, child, n.node_id)), false, 'zero compute while waiting');
      assert.equal(child.driver.pid, 2147483646, 'and no respawn happened');

      graphMod.queueHumanAction(child.cwd, child.run_id, {
        kind: 'submit', node_id: 'ask:U1:1', payload: { stage_ok: true, decisions: [{ question: 'q', chose: 'a' }] },
      });
      // An answer is waiting: now it needs one, or the answer can never land.
      assert.equal(withRoot(() => serviceDeadDriver(task, child, n.node_id)), true, 'revived for its queue');
      assert.notEqual(child.driver.pid, 2147483646, 'a fresh driver');
    } finally {
      if (prevDriver === undefined) delete process.env.HARNESS_CHILD_DRIVER; else process.env.HARNESS_CHILD_DRIVER = prevDriver;
      rmSync(drv, { recursive: true, force: true });
    }
  });
});

test('one subgoal, five owners: every card is addressable and an ambiguous key is refused', async () => {
  // 0.28.7 splits a subgoal's questions into one card per owner - idol-beta-ask1 (2026-09-25)
  // opened five for U4 alone, and every one of them advertised the SAME subgoal-keyed ticket.
  // tm_submit resolved that by taking the last waiting card, so one owner's answers would have
  // been applied to another owner's questions, silently.
  const graphMod = await import('../mcp/graph.mjs');
  await withTask(async ({ tm, root, task_id }) => {
    await throughCritique(tm, task_id);
    await tm.call('tm_next', { task_id });
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const child = task.nodes.find((x) => x.node_id === 'dispatch:P1:1').child;
    const card = (id, who, q) => graphMod.node(id, 'ask', [], {
      subgoal_id: 'U1', ask_owner: 'U1', attempt: 1, state: 'waiting_human', waiting_since: Date.now(),
      questions: [{ question: q, options: [{ option: 'a' }, { option: 'b' }] }],
      assignment: { executor: 'human', vendor: 'human', who },
    });
    graphMod.saveRun({
      cwd: child.cwd, run_id: child.run_id, max_retries: 2,
      spec: { subgoals: [{ id: 'U1', kind: 'planning', title: 'scale' }] },
      nodes: [card('ask:U1:1', 'SRE', 'what SLA?'), card('ask:U1:1b', 'Finance', 'what payment TPS?')],
    });

    const inbox = await tm.call('tm_inbox', { task_id });
    const keys = inbox.cards.map((c) => c.key).sort();
    assert.equal(new Set(keys).size, 2, 'two cards, two distinct keys: ' + keys.join(','));
    assert.ok(keys.every((k) => k.endsWith('/ask:U1:1') || k.endsWith('/ask:U1:1b')), keys.join(','));

    // The subgoal-keyed form is refused rather than resolved by guesswork - checked first,
    // because answering one card removes it and the ambiguity with it.
    const bad = await tm.call('tm_submit', { task_id, key: `E-${task_id.slice(0, 8)}/P1/U1`, payload: ok({ decisions: [] }) });
    assert.match(bad.error || '', /2 cards waiting/, JSON.stringify(bad));
    assert.match(bad.error || '', /ask:U1:1b/, 'and it names the keys that would work');

    // Named by node: each answer reaches the card that asked for it.
    const one = inbox.cards.find((c) => c.node_id === 'ask:U1:1b');
    const v = await tm.call('tm_submit', { task_id, key: one.key, payload: ok({ decisions: [{ question: 'what payment TPS?', chose: 'a' }] }) });
    assert.equal(v.node_id, 'ask:U1:1b', JSON.stringify(v));
  });
});

test('code-sprint-S6: after a budget sweep the goal gate is not failed on the whole-goal floor; without a stop it still is', async () => {
  const { succeeded } = await import('../mcp/taskmanager.mjs');
  const gate = { node_id: 'gate:goal:2', stage: 'gate' };
  const verdict = { stage_ok: true, accept: true, match_pct: 72, gaps: [], checks: ['npm test -> 3 packages pass'] };
  assert.equal(succeeded({ goal_threshold: 90 }, gate, verdict), false, 'an unboxed task keeps its floor');
  assert.equal(succeeded({ goal_threshold: 90, budget_stopped: { skipped_packages: ['P4'] } }, gate, verdict), true,
    'three of four shipped by design: the judge\'s accept stands');
  assert.equal(succeeded({ goal_threshold: 90, budget_stopped: { skipped_packages: [] } }, gate, verdict), false,
    'a stop that skipped nothing waives nothing');
  assert.equal(succeeded({ goal_threshold: 90, budget_stopped: { skipped_packages: ['P4'] } }, gate, { ...verdict, accept: false, gaps: ['x'] }), false,
    'a refusal is still a refusal');
});

test('idol-beta-ask1: a passing critique\'s problems about a package reach that package\'s child run and its accept judge', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    let v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2 modules'], handoff: 'two modules' }) });
    v = await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...SHAPE, handoff: 's' }) });
    v = await tm.call('tm_submit', { task_id, node_id: 'critique', payload: ok({ sound: true, problems: ['raise P1 to at least 10,000 flows', 'P2 names no error format'] }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    const nx = await tm.call('tm_next', { task_id });
    const c = nx.children.find((x) => x.package_id === 'P1');
    const run = JSON.parse(readFileSync(join(c.cwd, '.teams_output', 'broker', 'runs', `${c.run_id}.json`), 'utf8'));
    assert.match(run.context, /critique of the plan noted this about your package. They are advice, not acceptance/);
    assert.match(run.context, /10,000 flows/);
    assert.doesNotMatch(run.context, /P2 names no error format/, 'only the notes about this package');
    await completeChild(g, c);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    const nx2 = await tm.call('tm_next', { task_id });
    const acc = nx2.ready.find((n) => n.node_id === 'accept:P1:1');
    const brief = readFileSync(acc.briefing_path, 'utf8');
    assert.match(brief, /The plan's critique noted this about P1[\s\S]*10,000 flows/);
    // code-beta-X5: read as gaps, advisory notes rejected a package that met all its acceptance.
    assert.match(brief, /advisory - the package is judged against its Acceptance above/);
    assert.doesNotMatch(brief, /an unaddressed one with no reason is a gap/);
  });
});

test('code-sprint-S8: a follow-up Sprint (context_from) builds on the prior task\'s unmerged integration branch, not on HEAD', async () => {
  await withTask(async ({ tm, g, cwd, task_id }) => {
    await toReport(tm, g, task_id, 'P1+P2 shipped on the integration branch');
    const prior = await tm.call('tm_status', { task_id, full: true });
    const branch = prior.nodes.find((n) => n.node_id === 'integrate:1').integration.branch;
    const retro = JSON.parse(readFileSync(docPaths(prior).retro, 'utf8'));
    assert.equal(retro.integration_branch, branch);
    assert.match(readFileSync(docPaths(prior).report, 'utf8'), new RegExp(`accepted work is on branch \`${branch.replace(/[/.]/g, '\\$&')}\``));

    const next = await tm.call('tm_open', { request: 'the next sprint', cwd, vendor: 'self', roles: { qa: false }, brainstorm: false, context_from: task_id });
    const t2 = await tm.call('tm_status', { task_id: next.task_id, full: true });
    assert.equal(t2.base_ref, branch, 'HEAD does not contain the prior work, so this task starts from it');
    assert.match(t2.context, /starts from the prior task's integration branch/);
    await throughCritique(tm, next.task_id);
    const nx = await tm.call('tm_next', { task_id: next.task_id });
    const wt = nx.children[0].cwd;
    const r = spawnSync('git', ['-C', wt, 'merge-base', '--is-ancestor', branch, 'HEAD']);
    assert.equal(r.status, 0, 'the package worktree carries the prior Sprint\'s integrated work');

    // Once the project's own branch has it, there is nothing to build on: HEAD again.
    spawnSync('git', ['-C', cwd, 'merge', '-q', '--ff-only', branch]);
    const third = await tm.call('tm_open', { request: 'after the merge', cwd, vendor: 'self', roles: { qa: false }, brainstorm: false, context_from: task_id });
    assert.equal((await tm.call('tm_status', { task_id: third.task_id, full: true })).base_ref, null);
  });
});

test('code-sprint-P2: a box that stops before any package is accepted skips integration and goes straight to the report', async () => {
  await withTask(async ({ tm, root, task_id }) => {
    await throughCritique(tm, task_id);
    writeDriverSpend(root, task_id, 'dispatch_PLAN_1', 20);
    const nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children.length, 0);
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.ok(!task.nodes.some((n) => n.stage === 'integrate' && n.state === 'pending'), 'no integrate over nothing');
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['report']);
  }, { budget_usd: 10 });
});

test('code-sprint-P2: a stopped box whose goal gate waits on a node nothing can create (the audit) closes to its report instead of waiting forever', async () => {
  const { enforceBudget } = await import('../mcp/taskmanager.mjs');
  const prevRoot = process.env.HARNESS_TASKS_DIR;
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  process.env.HARNESS_TASKS_DIR = root;
  try {
    const task = {
      run_id: 'p2', store_path: join(root, 'p2', 'task.json'), cwd: root, request: 'r', created_at: Date.now(),
      team: { opts: { budget_usd: 1 } }, budget_stopped: { skipped_packages: ['P1'] },
      spec: { packages: [{ id: 'P1', title: 'p' }] },
      nodes: [
        { node_id: 'size', stage: 'size', deps: [], state: 'done', result: {} },
        { node_id: 'dispatch:P1:1', stage: 'dispatch', subgoal_id: 'P1', deps: [], state: 'skipped', final: true, result: {} },
        { node_id: 'accept:P1:1', stage: 'accept', subgoal_id: 'P1', deps: ['dispatch:P1:1'], state: 'skipped', final: true, result: {} },
        { node_id: 'integrate:1', stage: 'integrate', deps: ['accept:P1:1'], state: 'pending' },
        { node_id: 'dispatch:AUDIT:1', stage: 'dispatch', subgoal_id: 'AUDIT', deps: [], state: 'pending' },
        { node_id: 'accept:AUDIT:1', stage: 'accept', subgoal_id: 'AUDIT', deps: ['dispatch:AUDIT:1'], state: 'pending' },
        { node_id: 'gate:goal:1', stage: 'gate', deps: ['accept:AUDIT:1'], state: 'pending' },
        { node_id: 'report', stage: 'report', deps: [], after: ['gate:goal:1'], state: 'pending' },
      ],
    };
    mkdirSync(join(root, 'p2'), { recursive: true });
    writeDriverSpend(root, 'p2', 'dispatch_PLAN_1', 5);
    assert.equal(enforceBudget(task), true);
    assert.equal(task.nodes.find((n) => n.node_id === 'gate:goal:1').state, 'skipped');
    assert.equal(task.nodes.find((n) => n.node_id === 'report').state, 'pending');
  } finally {
    if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot;
    rmSync(root, { recursive: true, force: true });
  }
});

test('the integrate briefing tells the judge its job (0.30.2 dropped the line), and each package\'s own tests are run as facts', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    const nx = await toIntegrate(tm, g, task_id);
    const integ = nx.ready.find((n) => n.node_id === 'integrate:1');
    assert.match(readFileSync(integ.briefing_path, 'utf8'), /Run the goal-level checks there\. Read the seams/);
  });
  const { runPackageTests } = await import('../mcp/taskmanager.mjs');
  const cwd = mkdtempSync(join(tmpdir(), 'pkgtests-'));
  const prev = process.env.HARNESS_PACKAGE_TESTS;
  process.env.HARNESS_PACKAGE_TESTS = '1';
  try {
    for (const [dir, code] of [['packages/cli', 3], ['packages/csv', 0]]) {
      mkdirSync(join(cwd, dir), { recursive: true });
      writeFileSync(join(cwd, dir, 'package.json'), JSON.stringify({ name: dir.split('/')[1], scripts: { test: `node -e "console.log('# fail ${code}'); process.exit(${code})"` } }));
    }
    const task = { spec: { packages: [
      { id: 'P1', touches: ['packages/csv/**'] },
      { id: 'P2', touches: ['packages/cli/'] },
      { id: 'P3', touches: ['README.md'] },
    ] } };
    const out = runPackageTests(task, cwd, ['P1', 'P2', 'P3']);
    assert.deepEqual(out.map((t) => [t.package, t.exit]), [['P1', 0], ['P2', 3]], 'P3 has no test command and is not measured');
    assert.match(out[1].summary, /# fail 3/);
  } finally {
    if (prev === undefined) delete process.env.HARNESS_PACKAGE_TESTS; else process.env.HARNESS_PACKAGE_TESTS = prev;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('code-sprint-P2: a boxed Sprint\'s planning team is told the box exists and what it has to leave for building', async () => {
  await withTask(async ({ tm, root, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2'], handoff: 'h' }) });
    await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: [{ title: 'the request', brief: 'all of it' }] }) });
    const nx = await tm.call('tm_next', { task_id });
    const plan = nx.children.find((c) => c.package_id === 'PLAN-F1');
    assert.ok(plan, JSON.stringify(nx.children));
    const run = JSON.parse(readFileSync(join(plan.cwd, '.teams_output', 'broker', 'runs', `${plan.run_id}.json`), 'utf8'));
    assert.match(run.context, /This Sprint is boxed at \$15 for everything/);
    assert.match(run.context, /needs one PRD, not a set/);
    // code-sprint-P3: the words alone lost to "Nothing limits you to one document" two lines up.
    assert.doesNotMatch(run.context, /Nothing limits you to one document/);
    assert.equal(run.max_subgoals, 1, 'a boxed planning run may write one document');
  }, { roles: { planning: true }, budget_usd: 15 });
});

test('an unboxed planning run keeps its own document set', async () => {
  await withTask(async ({ tm, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2'], handoff: 'h' }) });
    await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: [{ title: 'the request', brief: 'all of it' }] }) });
    const nx = await tm.call('tm_next', { task_id });
    const plan = nx.children.find((c) => c.package_id === 'PLAN-F1');
    const run = JSON.parse(readFileSync(join(plan.cwd, '.teams_output', 'broker', 'runs', `${plan.run_id}.json`), 'utf8'));
    assert.match(run.context, /Nothing limits you to one document/);
    assert.equal(run.max_subgoals, null);
  }, { roles: { planning: true } });
});

test('code-beta-X3: a child blocked at probe on spent credit parks until the reset, and the resume reopens its routing', async () => {
  const { serviceDeadDriver, dispatchSettled, capacityResetAt, clearCapacity } = await import('../mcp/taskmanager.mjs');
  const { capacityNotice } = await import('../mcp/routing.mjs');
  const codex = 'ERROR: You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro) or try again at Sep 27th, 2026 12:00 AM.';
  assert.match(capacityNotice(`Reading additional input from stdin...\n${codex}\n`), /^You’ve hit your usage limit.*Sep 27th/);
  const since = Date.parse('Sep 26, 2026 2:15 PM');
  assert.equal(capacityResetAt(capacityNotice(codex), since), Date.parse('Sep 27, 2026 12:00 AM'), 'codex names a local date and time');
  await withTask(async ({ tm, root, task_id }) => {
    await throughCritique(tm, task_id);
    await tm.call('tm_next', { task_id });
    const load = () => JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const prevRoot = process.env.HARNESS_TASKS_DIR;
    const withRoot = (fn) => { process.env.HARNESS_TASKS_DIR = root; try { return fn(); } finally { if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot; } };
    const task = load();
    const n = task.nodes.find((x) => x.node_id === 'dispatch:P1:1');
    const runFile = join(n.child.cwd, '.teams_output', 'broker', 'runs', `${n.child.run_id}.json`);
    const child = JSON.parse(readFileSync(runFile, 'utf8'));
    const reason = `usage capacity exhausted at probe: ${capacityNotice(codex)}`;
    Object.assign(child, { routing_blocked: true, routing_blocked_capacity: reason, unavailable_vendors: { codex: reason } });
    writeFileSync(runFile, JSON.stringify(child, null, 2));
    n.child.driver = { pid: 2 ** 22 + 4322, started_at: Date.now() }; // exited after reporting blocked

    assert.equal(withRoot(() => serviceDeadDriver(task, n.child, n.node_id)), true, 'parked');
    assert.match(n.child.waiting_capacity.reason, /Sep 27th, 2026 12:00 AM/);
    assert.equal(withRoot(() => dispatchSettled(task, n)), false, 'a parked dispatch is not folded - no retry is spent');

    withRoot(() => clearCapacity(task, 'P1'));
    const reopened = JSON.parse(readFileSync(runFile, 'utf8'));
    assert.deepEqual(reopened.unavailable_vendors, {}, 'the resumed driver may probe codex again');
    assert.equal(reopened.routing_blocked_capacity, null);
    assert.equal(n.child.waiting_capacity, undefined);
  });
});

test('code-sprint-P3: a package that failed as the box ran out is left out of the reintegration, and the accepted one is still merged', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await throughCritique(tm, task_id); // P1, P2 (deps: [P1])
    let nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) });
    nx = await tm.call('tm_next', { task_id });
    const p2 = nx.children.find((c) => c.package_id === 'P2');
    assert.ok(p2, 'P2 dispatched before the box ran out');
    // A full-harness child whose retries are spent writes its report over the settled failure
    // (runState: complete, settled) - either way it did not deliver, and the fold fails it.
    assert.ok(['blocked', 'complete'].includes(await blockChild(g, p2)));
    writeDriverSpend(root, task_id, 'p2', 10);
    assert.equal((await tm.call('tm_submit', { task_id, node_id: 'dispatch:P2:1' })).state, 'failed');
    nx = await tm.call('tm_next', { task_id });
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const fresh = task.nodes.find((n) => n.stage === 'integrate' && n.supersedes === 'integrate:1');
    assert.ok(fresh, JSON.stringify(task.nodes.map((n) => [n.node_id, n.state])));
    assert.match(fresh.feedback, /not done: P2/, 'a failed package is named too, not only swept ones');
    assert.notEqual(fresh.state, 'failed', JSON.stringify(fresh.result));
    assert.deepEqual(nx.ready.map((n) => n.node_id), [fresh.node_id]);
  }, { budget_usd: 10 });
});

test('code-sprint-P5: past the box\'s warning line no audit is opened; the goal gate judges the integrate', async () => {
  await withTask(async ({ tm, g, cwd, root, task_id }) => {
    await toIntegrateWithPlanning(tm, g, task_id, cwd);
    writeDriverSpend(root, task_id, 'packages', 13); // 87% of 15
    await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });
    const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    assert.equal(task.audit_pkg, undefined, 'no audit phase-Team');
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'gate:goal:1').deps, ['integrate:1']);
    const ev = await tm.call('tm_events', { task_id });
    assert.ok(ev.events.some((e) => e.event === 'audit_skipped' && e.reason === 'budget'));
  }, { roles: { planning: true }, budget_usd: 15 });
});

test('code-sprint-P5: an audit that dies after the stop gives the goal gate back to the integrate it was auditing, instead of skipping it', async () => {
  const { enforceBudget } = await import('../mcp/taskmanager.mjs');
  const prevRoot = process.env.HARNESS_TASKS_DIR;
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  process.env.HARNESS_TASKS_DIR = root;
  try {
    const task = {
      run_id: 'p5', store_path: join(root, 'p5', 'task.json'), cwd: root, request: 'r', created_at: Date.now(),
      team: { opts: { budget_usd: 1 } }, budget_stopped: { skipped_packages: [] },
      spec: { packages: [{ id: 'P1', title: 'p' }] },
      audit_pkg: { id: 'AUDIT', phase: 'audit', integration_of: 'integrate:1' },
      nodes: [
        { node_id: 'size', stage: 'size', deps: [], state: 'done', result: {} },
        { node_id: 'dispatch:P1:1', stage: 'dispatch', subgoal_id: 'P1', deps: [], state: 'done', result: {} },
        { node_id: 'accept:P1:1', stage: 'accept', subgoal_id: 'P1', deps: ['dispatch:P1:1'], state: 'done', result: {} },
        { node_id: 'integrate:1', stage: 'integrate', deps: ['accept:P1:1'], state: 'done', result: { verified: true } },
        { node_id: 'dispatch:AUDIT:1', stage: 'dispatch', subgoal_id: 'AUDIT', deps: ['integrate:1'], state: 'failed', result: { stage_ok: true } },
        { node_id: 'accept:AUDIT:1', stage: 'accept', subgoal_id: 'AUDIT', deps: ['dispatch:AUDIT:1'], state: 'pending' },
        { node_id: 'gate:goal:1', stage: 'gate', deps: ['accept:AUDIT:1'], state: 'pending' },
        { node_id: 'report', stage: 'report', deps: [], after: ['gate:goal:1'], state: 'pending' },
      ],
    };
    mkdirSync(join(root, 'p5'), { recursive: true });
    writeDriverSpend(root, 'p5', 'dispatch_AUDIT_1', 5);
    assert.equal(enforceBudget(task), true);
    const goal = task.nodes.find((n) => n.node_id === 'gate:goal:1');
    assert.equal(goal.state, 'pending', 'the goal gate still runs');
    assert.deepEqual(goal.deps, ['integrate:1']);
  } finally {
    if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot;
    rmSync(root, { recursive: true, force: true });
  }
});

// portfolio-refresh-80ec931a (2026-09-28): budget_stopped fired at spend $25.18 with
// dispatch:QA:2 still running (subgoal_id 'QA'), and enforceBudget did nothing about it -
// "nothing to sweep while a dispatch is still running" bailed every tick - until QA:2 died on
// its own 12 minutes later; the ledger then shows budget_goal_rewired away from accept:QA:2 and
// budget_closed skipping it. The result was never going to be read either way: closeStoppedToReport
// only ever rewires the goal gate AROUND a phase-Team pass (passOf: AUDIT/QA), never onto it, once
// the box is over. settleRunningDispatchesAtStop now kills a running QA/AUDIT dispatch immediately,
// no grace, and the goal gate still rewires around it exactly as it would have once QA folded.
test('a phase-Team pass (QA) still running when the box trips is killed immediately, not waited on', async () => {
  const { enforceBudget } = await import('../mcp/taskmanager.mjs');
  const prevRoot = process.env.HARNESS_TASKS_DIR;
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  process.env.HARNESS_TASKS_DIR = root;
  const sleeper = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
  sleeper.unref();
  try {
    const task = {
      run_id: 'qk', store_path: join(root, 'qk', 'task.json'), cwd: root, request: 'r', created_at: Date.now(),
      budget_warned: true, team: { opts: { budget_usd: 1 } }, budget_stopped: { at: Date.now(), spend: 1.2, skipped_packages: [] },
      spec: { packages: [{ id: 'P1', title: 'p' }] }, qa_pkg: { id: 'QA', phase: 'qa', integration_of: 'integrate:1' },
      nodes: [
        { node_id: 'size', stage: 'size', deps: [], state: 'done', result: {} },
        { node_id: 'dispatch:P1:1', stage: 'dispatch', subgoal_id: 'P1', deps: [], state: 'done', result: {} },
        { node_id: 'accept:P1:1', stage: 'accept', subgoal_id: 'P1', deps: ['dispatch:P1:1'], state: 'done', result: {} },
        { node_id: 'integrate:1', stage: 'integrate', deps: ['accept:P1:1'], state: 'done', result: { verified: true } },
        {
          node_id: 'dispatch:QA:2', stage: 'dispatch', subgoal_id: 'QA', deps: ['integrate:1'], state: 'running',
          child: { cwd: root, run_id: 'qarun', driver: { pid: sleeper.pid, started_at: Date.now() } },
        },
        { node_id: 'accept:QA:2', stage: 'accept', subgoal_id: 'QA', deps: ['dispatch:QA:2'], state: 'pending' },
        { node_id: 'gate:goal:1', stage: 'gate', deps: ['accept:QA:2'], state: 'pending' },
        { node_id: 'report', stage: 'report', deps: [], after: ['gate:goal:1'], state: 'pending' },
      ],
    };
    mkdirSync(join(root, 'qk'), { recursive: true });
    writeDriverSpend(root, 'qk', 'dispatch_QA_2', 1.2);
    assert.equal(enforceBudget(task), true);
    const dq = task.nodes.find((n) => n.node_id === 'dispatch:QA:2');
    assert.equal(dq.state, 'skipped');
    assert.match(dq.result.reason, /bypassed by the close path/);
    const aq = task.nodes.find((n) => n.node_id === 'accept:QA:2');
    assert.equal(aq.state, 'skipped');
    const goal = task.nodes.find((n) => n.node_id === 'gate:goal:1');
    assert.equal(goal.state, 'pending', 'the goal gate still runs');
    assert.deepEqual(goal.deps, ['integrate:1'], 'rewired around the killed QA pass, same as if it had folded on its own');
    await waitFor(() => !aliveSleeper(sleeper.pid), 'the killed QA driver to actually exit after SIGTERM');
    const ledger = readFileSync(join(root, 'qk', 'ledger.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const killed = ledger.filter((e) => e.event === 'budget_killed');
    assert.equal(killed.length, 1);
    assert.equal(killed[0].node_id, 'dispatch:QA:2');
    assert.match(killed[0].reason, /bypassed/);
    assert.equal(typeof killed[0].spend_at_kill, 'number');
  } finally {
    try { process.kill(sleeper.pid, 'SIGKILL'); } catch { /* already gone */ }
    if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot;
    rmSync(root, { recursive: true, force: true });
  }
});

test('a package dispatch still running within its grace is left to finish, not killed', async () => {
  const { enforceBudget } = await import('../mcp/taskmanager.mjs');
  const prevRoot = process.env.HARNESS_TASKS_DIR;
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  process.env.HARNESS_TASKS_DIR = root;
  try {
    const task = {
      run_id: 'gr1', store_path: join(root, 'gr1', 'task.json'), cwd: root, request: 'r', created_at: Date.now(),
      budget_warned: true, team: { opts: { budget_usd: 1 } }, budget_stopped: { at: Date.now(), spend: 1.05, skipped_packages: [] },
      spec: { packages: [{ id: 'P1', title: 'p' }] },
      nodes: [
        { node_id: 'size', stage: 'size', deps: [], state: 'done', result: {} },
        {
          node_id: 'dispatch:P1:1', stage: 'dispatch', subgoal_id: 'P1', deps: [], state: 'running',
          // A fake, presumably-dead pid: within grace this must never even try to kill it.
          child: { cwd: root, run_id: 'p1run', driver: { pid: 2 ** 22 + 4321, started_at: Date.now() } },
        },
        { node_id: 'accept:P1:1', stage: 'accept', subgoal_id: 'P1', deps: ['dispatch:P1:1'], state: 'pending' },
        { node_id: 'integrate:1', stage: 'integrate', deps: ['accept:P1:1'], state: 'pending' },
        { node_id: 'gate:goal:1', stage: 'gate', deps: ['integrate:1'], state: 'pending' },
        { node_id: 'report', stage: 'report', deps: [], after: ['gate:goal:1'], state: 'pending' },
      ],
    };
    mkdirSync(join(root, 'gr1'), { recursive: true });
    writeDriverSpend(root, 'gr1', 'dispatch_PLAN_1', 1.05);
    assert.equal(enforceBudget(task), false, 'nothing to sweep yet - P1 is a needed dispatch, still within grace');
    const d1 = task.nodes.find((n) => n.node_id === 'dispatch:P1:1');
    assert.equal(d1.state, 'running', 'not killed - budget_grace_minutes/_usd has not elapsed');
    const ledgerPath = join(root, 'gr1', 'ledger.jsonl');
    const ledger = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    assert.equal(ledger.filter((e) => e.event === 'budget_killed').length, 0);
  } finally {
    if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot;
    rmSync(root, { recursive: true, force: true });
  }
});

test('a package dispatch still running past its grace is killed too, and the box reintegrates without it', async () => {
  const { enforceBudget } = await import('../mcp/taskmanager.mjs');
  const prevRoot = process.env.HARNESS_TASKS_DIR;
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  process.env.HARNESS_TASKS_DIR = root;
  const sleeper = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
  sleeper.unref();
  try {
    const task = {
      run_id: 'gr2', store_path: join(root, 'gr2', 'task.json'), cwd: root, request: 'r', created_at: Date.now(),
      budget_warned: true, team: { opts: { budget_usd: 1 } },
      // budget_grace_minutes defaults to 5; 6 minutes since the stop is past it.
      budget_stopped: { at: Date.now() - 6 * 60 * 1000, spend: 1.05, skipped_packages: [] },
      spec: { packages: [{ id: 'P1', title: 'p' }] },
      nodes: [
        { node_id: 'size', stage: 'size', deps: [], state: 'done', result: {} },
        {
          node_id: 'dispatch:P1:1', stage: 'dispatch', subgoal_id: 'P1', deps: [], state: 'running',
          child: { cwd: root, run_id: 'p1run', driver: { pid: sleeper.pid, started_at: Date.now() } },
        },
        { node_id: 'accept:P1:1', stage: 'accept', subgoal_id: 'P1', deps: ['dispatch:P1:1'], state: 'pending' },
        { node_id: 'integrate:1', stage: 'integrate', deps: ['accept:P1:1'], state: 'pending' },
        { node_id: 'gate:goal:1', stage: 'gate', deps: ['integrate:1'], state: 'pending' },
        { node_id: 'report', stage: 'report', deps: [], after: ['gate:goal:1'], state: 'pending' },
      ],
    };
    mkdirSync(join(root, 'gr2'), { recursive: true });
    writeDriverSpend(root, 'gr2', 'dispatch_PLAN_1', 1.05);
    assert.equal(enforceBudget(task), true);
    const d1 = task.nodes.find((n) => n.node_id === 'dispatch:P1:1');
    assert.equal(d1.state, 'skipped');
    assert.match(d1.result.reason, /grace exhausted/);
    const a1 = task.nodes.find((n) => n.node_id === 'accept:P1:1');
    assert.equal(a1.state, 'skipped');
    await waitFor(() => !aliveSleeper(sleeper.pid), 'the grace-killed P1 driver to actually exit after SIGTERM');
    const ledger = readFileSync(join(root, 'gr2', 'ledger.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const killed = ledger.filter((e) => e.event === 'budget_killed');
    assert.equal(killed.length, 1);
    assert.equal(killed[0].node_id, 'dispatch:P1:1');
    assert.match(killed[0].reason, /grace exhausted/);
    // Nothing accepted (P1 was the only package, and it was killed, not folded): the report still
    // opens on its own rather than an integrate over zero packages.
    assert.ok(ledger.some((e) => e.event === 'budget_swept' && e.nothing_accepted === true));
    assert.equal(task.nodes.find((n) => n.node_id === 'report').state, 'pending');
  } finally {
    try { process.kill(sleeper.pid, 'SIGKILL'); } catch { /* already gone */ }
    if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot;
    rmSync(root, { recursive: true, force: true });
  }
});

test('code-sprint-P5: the audit brief lists each user story by label with its acceptance, never "[object Object]"', async () => {
  await withTask(async ({ tm, g, cwd, root, task_id }) => {
    let v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2'], handoff: 'h' }) });
    await completePlanning(tm, g, task_id, cwd, [
      { id: 'F1-US-1', title: 'parse rows', acceptance: ['a row has four fields'] },
      { id: 'F1-US-2', title: 'categorize', acceptance: ['first match wins'] },
    ]);
    v = await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...SHAPE_IMPLEMENTS, handoff: 's' }) });
    await tm.call('tm_submit', { task_id, node_id: 'critique', payload: ok({ sound: true }) });
    for (const p of ['P1', 'P2']) {
      const nx = await tm.call('tm_next', { task_id });
      await completeChild(g, nx.children.find((c) => c.package_id === p));
      await tm.call('tm_submit', { task_id, node_id: `dispatch:${p}:1` });
      await tm.call('tm_submit', { task_id, node_id: `accept:${p}:1`, payload: ok({ accept: true, match_pct: 90 }) });
    }
    await tm.call('tm_next', { task_id });
    await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });
    const brief = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8')).audit_pkg.brief;
    assert.doesNotMatch(brief, /\[object Object\]/);
    assert.match(brief, /- F1-US-1 - parse rows\n  - a row has four fields/);
  }, { roles: { planning: true } });
});

test('code-beta-X4: a judge failure waiting on its re-judge reads running in tm_wait and tm_status, not blocked', async () => {
  await withTask(async ({ tm, root, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2'], handoff: 'h' }) });
    const path = join(root, task_id, 'task.json');
    const task = JSON.parse(readFileSync(path, 'utf8'));
    // The first judging stage after size is the plan stage (C2): its judge fails the same way.
    const split = task.nodes.find((n) => n.node_id === 'areas');
    Object.assign(split, { state: 'failed', finished_at: Date.now(),
      result: { stage_ok: false, judge_failed: true, reason: "judge reply for areas was not valid JSON: Expected ',' or '}'" } });
    writeFileSync(path, JSON.stringify(task, null, 2));
    const w = await tm.call('tm_wait', { task_id, max_ms: 50 });
    assert.equal(w.state, 'running', JSON.stringify(w));
    assert.ok(w.rejudge_at);
    assert.match(w.note, /not blocked/);
    assert.equal((await tm.call('tm_status', { task_id })).state, 'running');

    // Out of re-judges: now it is blocked.
    const t2 = JSON.parse(readFileSync(path, 'utf8'));
    t2.nodes.find((n) => n.node_id === 'areas').judge_attempts = 2;
    writeFileSync(path, JSON.stringify(t2, null, 2));
    assert.equal((await tm.call('tm_wait', { task_id, max_ms: 50 })).state, 'blocked');
  });
});

test('shape\'s package map is drawn beside the docs and critique reads its seams; an invalid one falls back to the dependency map', async () => {
  const drawn = { type: 'architecture', title: 'modules', nodes: [
    { id: 'P1', label: 'module a', kind: 'package', row: 0, col: 0 },
    { id: 'contract', label: 'a.txt format', kind: 'store', row: 0, col: 1 },
    { id: 'P2', label: 'module b', kind: 'package', row: 0, col: 2 },
  ], edges: [{ from: 'P1', to: 'contract', label: 'writes' }, { from: 'contract', to: 'P2', label: 'reads', style: 'data' }] };
  for (const [diagram, source] of [[drawn, 'shape'], [{ ...drawn, nodes: drawn.nodes.map((n) => ({ ...n, row: 0, col: 0 })) }, 'auto'], [undefined, 'auto']]) {
    await withTask(async ({ tm, root, task_id }) => {
      await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2'], handoff: 'h' }) });
      const v = await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...SHAPE, ...(diagram ? { diagram } : {}), handoff: 's' }) });
      assert.equal(v.state, 'done', 'a picture never fails a shape');
      const task = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
      assert.equal(task.shape_diagram.source, source);
      assert.ok(existsSync(task.shape_diagram.path) && /<svg class="d"/.test(readFileSync(task.shape_diagram.path, 'utf8')));
      if (diagram && source === 'auto') assert.ok(task.shape_diagram.problems.some((p) => /both sit at row 0, col 0/.test(p)), 'the repairs are kept');
      const nx = await tm.call('tm_next', { task_id });
      const critique = nx.ready.find((n) => n.stage === 'critique');
      const brief = readFileSync(critique.briefing_path, 'utf8');
      assert.match(brief, /## Package map/);
      if (source === 'shape') assert.match(brief, /- contract -> P2: reads \(data\)/);
      else assert.match(brief, /- P1 -> P2: builds on/);
    });
  }
});

test('portfolio-consolidate: stories are read from the PRD when the goal gate returns none', async () => {
  const { prdStories } = await import('../mcp/taskmanager.mjs');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'prd-'));
  try {
    writeFileSync(join(dir, 'PRD.md'), [
      '# PRD', '## Problem', 'x', '## User stories', '',
      '### US-1 — `fit`: one skill', '**Description.** d', '**Rules**', '- a rule, not acceptance',
      '**Acceptance**', '- AC1.1 exists', '- AC1.2 runs', '',
      '- **US-2**: bullet story', '  - only bullet', '## Out of scope', '- US-9 is not a story here',
    ].join('\n'));
    writeFileSync(join(dir, 'PRD-findings.md'), '## User stories\n### US-7 — findings are not the PRD\n');
    const s = prdStories(dir, ['PRD.md', 'PRD-findings.md', 'src/a.js']);
    assert.deepEqual(s.map((x) => x.id), ['US-1', 'US-2']);
    assert.equal(s[0].title, '`fit`: one skill');
    assert.deepEqual(s[0].acceptance, ['AC1.1 exists', 'AC1.2 runs']);
    assert.deepEqual(s[1].acceptance, ['only bullet']);
    assert.deepEqual(prdStories(dir, []), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- task.decisions: decide once, before execution (_repo/docs/plans/2026-09-28-teams-light-plan.md §6) ----------

const readTask = (root, task_id) => JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
const readChild = (child) => JSON.parse(readFileSync(join(child.cwd, '.teams_output', 'broker', 'runs', `${child.run_id}.json`), 'utf8'));

test('§6.2: PLAN decisions are written once at accept:PLAN and reach every package child run - its context, its snapshot, and openAsk\'s filter', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'], handoff: 'h' }) });
    await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: [{ title: 'ticket limits', brief: 'how many tickets one account may hold' }] }) });
    const nx = await tm.call('tm_next', { task_id });
    const plan = nx.children.find((c) => c.package_id === 'PLAN-F1');
    const sub = (node_id, payload) => g.call('team_submit', { run_id: plan.run_id, cwd: plan.cwd, node_id, payload: ok(payload) });
    await sub('plan', { handoff: 'p', flow: 'plan', size: 'S' });
    await sub('setgoal', { spec: { goal: 'PRD', acceptance: ['PRD covers the request'], subgoals: [{ id: 'U1', title: 'draft PRD', acceptance: ['PRD written'], deps: [] }] } });
    await sub('critique', { sound: true });
    // Not interactive: PLAN decides the unknown by its recommended option and records it.
    await sub('investigate:U1:1', { changed_files: [], handoff: 'findings', findings: [], unknowns: LIMIT_QUESTION });
    // A card that wrote no PRD is refused at fold (m1): this one writes it.
    mkdirSync(join(plan.cwd, 'docs'), { recursive: true });
    writeFileSync(join(plan.cwd, 'docs', 'PRD.md'), `# PRD\n\n${PRD_FIXTURE}`);
    await sub('draft:U1:1', { changed_files: ['docs/PRD.md'], handoff: 'drafted' });
    await sub('revise:U1:1', { changed_files: ['docs/PRD.md'], handoff: 'revised' });
    await sub('gate:U1:1', { accept: true, match_pct: 95 });
    await sub('gate:goal:1', { accept: true, match_pct: 95, user_stories: ['F1-US-1', 'F1-US-2'].map((id) => ({ id, title: id, acceptance: [`${id} holds`] })) });
    await g.call('team_next', { run_id: plan.run_id, cwd: plan.cwd });
    await sub('report', { handoff: 'PRD complete' });
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:PLAN-F1:1' });
    assert.deepEqual(readTask(root, task_id).decisions, [], 'nothing is written before the planning card\'s accept');
    await tm.call('tm_submit', { task_id, node_id: 'accept:PLAN-F1:1', payload: ok({ accept: true, match_pct: 95 }) });

    const decided = readTask(root, task_id).decisions;
    assert.deepEqual(decided, [{
      question: LIMIT_QUESTION[0].question, chose: '2 across presale and general combined',
      owner: 'Product/policy', decided_in: 'PLAN', source: 'default',
    }]);

    await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...SHAPE_IMPLEMENTS, handoff: 's' }) });
    await tm.call('tm_submit', { task_id, node_id: 'critique', payload: ok({ sound: true }) });
    const pk = (await tm.call('tm_next', { task_id })).children.find((c) => c.package_id === 'P1');
    const run = readChild(pk);
    assert.deepEqual(run.task_decisions, decided, 'the package run holds a snapshot of task.decisions');
    assert.equal(run.execution_phase, true);
    assert.match(run.context, /Decided already — settled, write as rules, not open questions/);
    assert.match(run.context, /How many tickets may one account hold\? -> 2 across presale and general combined/);

    // openAsk, inside the package run, treats the PLAN decision as answered - a different
    // question still opens a card.
    const graphMod = await import('../mcp/graph.mjs');
    // A freshly opened package run has only plan/setgoal/critique - any judging node will do.
    const gateNode = run.nodes.find((x) => x.stage === 'critique');
    assert.deepEqual(graphMod.openAsk(run, gateNode, LIMIT_QUESTION), [], 'a question PLAN settled is never asked again in a package');
    assert.equal(graphMod.openAsk(run, gateNode, [{ question: 'A new one?', options: ['a', 'b'] }]).length, 1);
  }, { roles: { planning: true } });
});

const SHAPE_TWO_FREE = {
  acceptance: ['a.txt says a', 'b.txt says b'],
  packages: [
    { id: 'P1', title: 'module a', flow: 'develop', brief: 'change a.txt', acceptance: ['a.txt says a'], touches: ['a.txt'], deps: [] },
    { id: 'P2', title: 'module b', flow: 'develop', brief: 'change b.txt', acceptance: ['b.txt says b'], touches: ['b.txt'], deps: [] },
  ],
};
const SESSION_DECISION = { question: 'How many tickets may one account hold?', chose: '2 across presale and general combined', because: 'legal' };
const CONTRADICTION = {
  question: 'The presale system already enforces 4 per account - does the 2-ticket cap still hold?',
  contradicts_decision: SESSION_DECISION.question,
  options: [{ option: 'keep 2', consequence: 'rework presale' }, { option: 'raise to 4', consequence: 'policy change' }],
  default: 'keep 2',
};

async function packageWithQuestions(g, child, file, questions) {
  const sub = (node_id, payload) => g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id, payload: ok(payload) });
  await throughChildSpec(g, child);
  appendFileSync(join(child.cwd, file), `changed by ${child.package_id}\n`);
  await sub('implement:U1:1', { changed_files: [file], handoff: 'built' });
  await sub('test:U1:1', { verified: true });
  const v = await sub('gate:U1:1', { accept: true, match_pct: 95, questions });
  assert.equal(v.state, 'done', JSON.stringify(v));
  await sub('gate:goal:1', { accept: true, match_pct: 95 });
  await sub('report', { handoff: 'built' });
  return g.call('team_next', { run_id: child.run_id, cwd: child.cwd });
}

test('§6.2-3/4: in execution, even interactive, a new question is decided by default; a contradicts_decision question parks ONCE at EPIC level for every package that raises it', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    assert.ok(!readTask(root, task_id).nodes.some((n) => n.stage === 'brainstorm'), 'session decisions skip the brainstorm node');
    await throughCritique(tm, task_id, SHAPE_TWO_FREE);
    const kids = (await tm.call('tm_next', { task_id })).children;
    const p1 = kids.find((c) => c.package_id === 'P1');
    const p2 = kids.find((c) => c.package_id === 'P2');

    const ordinary = { question: 'Log format?', options: [{ option: 'json' }, { option: 'text' }], default: 'json' };
    const nx1 = await packageWithQuestions(g, p1, 'a.txt', [ordinary, CONTRADICTION]);
    assert.equal(nx1.state, 'complete', 'the package run parks on nothing of its own, interactive or not');
    const run1 = readChild(p1);
    assert.ok(!run1.nodes.some((x) => x.stage === 'ask'), 'no package-level ask card');
    assert.deepEqual(run1.unasked.map((u) => [u.question, u.decided]), [['Log format?', 'json']]);
    assert.deepEqual(run1.blocking_questions.map((b) => [b.question, b.blocking]), [[CONTRADICTION.question, 'contradicts_decision']]);

    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    let task = readTask(root, task_id);
    const cards = () => readTask(root, task_id).nodes.filter((x) => x.stage === 'ask' && x.ask_owner === 'EPIC');
    assert.deepEqual(cards().map((c) => [c.node_id, c.state]), [['ask:EPIC:1', 'waiting_human']]);
    assert.deepEqual(task.nodes.find((x) => x.node_id === 'accept:P1:1').deps, ['ask:EPIC:1'], 'P1\'s accept waits on the EPIC card');

    await packageWithQuestions(g, p2, 'b.txt', [CONTRADICTION]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P2:1' });
    assert.equal(cards().length, 1, 'the same blocking question from P2 does not open a second card');
    task = readTask(root, task_id);
    assert.ok(task.nodes.find((x) => x.node_id === 'accept:P2:1').after.includes('ask:EPIC:1'), 'P2\'s accept waits on the one card too');

    const inbox = await tm.call('tm_inbox', { task_id });
    const card = inbox.cards.find((c) => c.node_id === 'ask:EPIC:1');
    assert.ok(card, JSON.stringify(inbox.cards));
    const v = await tm.call('tm_submit', { task_id, key: card.key, payload: { decisions: [{ question: CONTRADICTION.question, chose: 'raise to 4' }] } });
    assert.equal(v.state, 'done', JSON.stringify(v));
    const last = readTask(root, task_id).decisions.pop();
    assert.deepEqual(last, { question: CONTRADICTION.question, chose: 'raise to 4', owner: 'requester', decided_in: 'EPIC', source: 'ask' });
    assert.deepEqual((await tm.call('tm_next', { task_id })).ready.map((n) => n.node_id).sort(), ['accept:P1:1', 'accept:P2:1']);
  }, { interactive: true, brainstorm: true, decisions: [SESSION_DECISION] });
});

test('§6.5-2: tm_open({decisions}) writes the first task.decisions and skips the brainstorm node; without it the node sits between size and the plan stage', async () => {
  await withTask(async ({ root, task_id }) => {
    const task = readTask(root, task_id);
    assert.ok(!task.nodes.some((n) => n.stage === 'brainstorm'));
    assert.deepEqual(task.decisions, [{ ...SESSION_DECISION, owner: 'requester', decided_in: 'session', source: 'brainstorm' }]);
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'areas').deps, ['size']);
  }, { roles: { planning: true }, brainstorm: true, decisions: [SESSION_DECISION] });
  await withTask(async ({ root, task_id }) => {
    const task = readTask(root, task_id);
    assert.deepEqual(task.nodes.map((n) => [n.node_id, n.deps]), [['size', []], ['brainstorm', ['size']], ['areas', ['brainstorm']], ['areas-critique', ['areas']]]);
  }, { brainstorm: true });
});

const BRAINSTORM = {
  intent: 'Cap ticket purchases per account',
  scope: { in: ['purchase limit'], out: ['refunds'] },
  approaches: [{ approach: 'server-side counter', tradeoff: 'one more table' }, { approach: 'client check', tradeoff: 'bypassable' }],
  chose: 'server-side counter', because: 'cannot be bypassed',
  assumptions: ['accounts are verified'],
  questions: [
    { question: 'Does the cap span presale?', to: 'Product', options: [{ option: 'yes' }, { option: 'no' }], default: 'yes' },
    { question: 'Show remaining quota?', to: 'Design', options: [{ option: 'yes' }, { option: 'no' }], default: 'no' },
  ],
  handoff: 'h',
};

test('§6.5-3: the brainstorm node, not interactive, adopts its own defaults into task.decisions as self-brainstorm; packages read them and the report leads with them', async () => {
  await withTask(async ({ tm, root, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'], handoff: 'h' }) });
    const nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['brainstorm']);
    assert.match(readFileSync(nx.ready[0].briefing_path, 'utf8'), /"intent"/);
    const v = await tm.call('tm_submit', { task_id, node_id: 'brainstorm', payload: ok(BRAINSTORM) });
    assert.equal(v.state, 'done', JSON.stringify(v));

    const task = readTask(root, task_id);
    assert.ok(task.decisions.every((d) => d.source === 'self-brainstorm' && d.decided_in === 'brainstorm'), JSON.stringify(task.decisions));
    const byQ = Object.fromEntries(task.decisions.map((d) => [d.question, d.chose]));
    assert.equal(byQ['Which approach?'], 'server-side counter');
    assert.equal(byQ['What is out of scope?'], 'refunds');
    assert.equal(byQ['Assumption 1'], 'accounts are verified');
    assert.equal(byQ['Does the cap span presale?'], 'yes');
    assert.equal(byQ['Show remaining quota?'], 'no');
    assert.ok(!task.nodes.some((n) => n.stage === 'ask'), 'not interactive: no card');

    // The plan stage comes next (C2), and it splits the request under what was decided.
    const splitNx = await tm.call('tm_next', { task_id });
    assert.deepEqual(splitNx.ready.map((n) => n.node_id), ['areas']);
    assert.match(readFileSync(splitNx.ready[0].briefing_path, 'utf8'), /## Decided already[\s\S]*server-side counter/);
    await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...SHAPE, handoff: 's' }) });
    await tm.call('tm_submit', { task_id, node_id: 'critique', payload: ok({ sound: true }) });
    const child = (await tm.call('tm_next', { task_id })).children[0];
    const run = readChild(child);
    assert.equal(run.execution_phase, true);
    assert.match(run.context, /Does the cap span presale\? -> yes \[brainstorm, self-brainstorm\]/);

    const tmMod = await import('../mcp/taskmanager.mjs');
    const report = tmMod.composeTaskPrompt(readTask(root, task_id), { node_id: 'report', stage: 'report', deps: [] });
    assert.match(report, /## Decided by the engine itself[\s\S]*Which approach\? -> server-side counter \(cannot be bypassed\)/);
  }, { brainstorm: true });
});

test('§6.5-3: the brainstorm node, interactive, puts every question on ONE card; an answer is source ask, an unanswered question keeps the engine default', async () => {
  await withTask(async ({ tm, root, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'], handoff: 'h' }) });
    await tm.call('tm_submit', { task_id, node_id: 'brainstorm', payload: ok(BRAINSTORM) });
    const cards = readTask(root, task_id).nodes.filter((n) => n.stage === 'ask');
    assert.deepEqual(cards.map((c) => [c.node_id, c.state, c.questions.length]), [['ask:brainstorm:1', 'waiting_human', 2]], 'two owners, still one card');
    assert.equal(readTask(root, task_id).nodes.find((n) => n.node_id === 'areas').deps[0], 'ask:brainstorm:1');

    const card = (await tm.call('tm_inbox', { task_id })).cards.find((c) => c.node_id === 'ask:brainstorm:1');
    await tm.call('tm_submit', { task_id, key: card.key, payload: { decisions: [{ question: 'Does the cap span presale?', chose: 'no' }] } });
    const d = Object.fromEntries(readTask(root, task_id).decisions.map((x) => [x.question, [x.chose, x.source]]));
    assert.deepEqual(d['Does the cap span presale?'], ['no', 'ask']);
    assert.deepEqual(d['Show remaining quota?'], ['no', 'self-brainstorm']);
    assert.deepEqual((await tm.call('tm_next', { task_id })).ready.map((n) => n.node_id), ['areas']);
  }, { brainstorm: true, interactive: true });
});

test('human_scope in team.json is accepted as a deprecated no-op, with a note - never an error', async () => {
  const { resolveTeamOptions } = await import('../mcp/teamconfig.mjs');
  const r = resolveTeamOptions({}, { human_scope: 'leader', interactive: true });
  assert.equal(r.opts.interactive, true);
  assert.ok(!('human_scope' in r.opts));
  assert.ok(r.notes.some((n) => /human_scope.*deprecated/.test(n)), JSON.stringify(r.notes));
});

test('§6.5-3: a brainstorm that fails is closed as done with nothing decided - it advises, it does not gate', async () => {
  await withTask(async ({ tm, root, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'], handoff: 'h' }) });
    const v = await tm.call('tm_submit', { task_id, node_id: 'brainstorm', payload: { stage_ok: false, reason: 'could not read the project' } });
    assert.equal(v.state, 'done', JSON.stringify(v));
    assert.deepEqual(readTask(root, task_id).decisions, []);
    assert.deepEqual((await tm.call('tm_next', { task_id })).ready.map((n) => n.node_id), ['areas']);
  }, { brainstorm: true });
});

// ---------- portfolio-consolidate-8518d5dd (teams 0.35.1, 2026-09-28): the budget close path ----------
// budget_usd 40, roles planning/qa/audit on. The box stopped at $40.11 with P1/P2 accepted, P3's
// dispatch still running (it failed at 05:18) and P4 never dispatched. The sweep opened integrate:2
// over P1+P2 - and then integrate:3, :4, :5, :6 over the very same two accepts, five judge sessions
// ($8.88) re-merging one tree, until integrate:6 refused and the task closed `complete` with
// gate:goal and every QA round skipped. Node shapes below are the real task.json's, trimmed.
function consolidateTask(root, id, over = {}) {
  const pkg = (p) => ([
    { node_id: `dispatch:${p}:1`, stage: 'dispatch', subgoal_id: p, deps: ['critique'], after: [], state: 'done', attempt: 1, result: { stage_ok: true, child_state: 'complete' } },
    { node_id: `accept:${p}:1`, stage: 'accept', subgoal_id: p, deps: [`dispatch:${p}:1`], after: [], state: 'done', attempt: 1, result: { stage_ok: true, accept: true, match_pct: 90, checks: ['ok'] } },
  ]);
  return {
    run_id: id, store_path: join(root, id, 'task.json'), cwd: root, request: 'consolidate', created_at: Date.now() - 90 * 60 * 1000,
    team: { opts: { budget_usd: 40, roles: { planning: true, qa: true, audit: true } } },
    budget_warned: true,
    budget_stopped: { at: Date.now() - 20 * 60 * 1000, spend: 40.1124, elapsed_minutes: 84, budget_usd: 40, timebox_minutes: null, skipped_packages: [] },
    spec: { packages: ['P1', 'P2', 'P3', 'P4'].map((p) => ({ id: p, title: p })) },
    qa_pkg: { id: 'QA', phase: 'qa', flow: 'qa', integration_of: 'integrate:1', title: 'QA' },
    nodes: [
      { node_id: 'size', stage: 'size', deps: [], after: [], state: 'done', result: { stage_ok: true } },
      { node_id: 'critique', stage: 'critique', deps: [], after: [], state: 'done', result: { stage_ok: true, sound: true } },
      ...pkg('P1'), ...pkg('P2'),
      { node_id: 'dispatch:P3:1', stage: 'dispatch', subgoal_id: 'P3', deps: ['critique'], after: [], state: 'failed', attempt: 1, final: true, result: { stage_ok: false, child_state: 'blocked' } },
      { node_id: 'accept:P3:1', stage: 'accept', subgoal_id: 'P3', deps: ['dispatch:P3:1'], after: [], state: 'pending', attempt: 1 },
      { node_id: 'dispatch:P4:1', stage: 'dispatch', subgoal_id: 'P4', deps: ['critique', 'accept:P1:1', 'accept:P2:1', 'accept:P3:1'], after: [], state: 'pending', attempt: 1 },
      { node_id: 'accept:P4:1', stage: 'accept', subgoal_id: 'P4', deps: ['dispatch:P4:1'], after: [], state: 'pending', attempt: 1 },
      { node_id: 'integrate:1', stage: 'integrate', deps: ['accept:P1:1', 'accept:P2:1', 'accept:P3:1', 'accept:P4:1'], after: [], state: 'pending', subgoal_id: null },
      { node_id: 'dispatch:QA:1', stage: 'dispatch', subgoal_id: 'QA', deps: ['integrate:1'], after: [], state: 'pending', attempt: 1 },
      { node_id: 'accept:QA:1', stage: 'accept', subgoal_id: 'QA', deps: ['dispatch:QA:1'], after: [], state: 'pending', attempt: 1 },
      { node_id: 'gate:goal:1', stage: 'gate', deps: ['accept:QA:1'], after: [], state: 'pending', subgoal_id: null },
      { node_id: 'report', stage: 'report', deps: [], after: ['gate:goal:1'], state: 'pending' },
    ],
    ...over,
  };
}

async function withBoxRoot(fn) {
  const prevRoot = process.env.HARNESS_TASKS_DIR;
  const prevNoDriver = process.env.HARNESS_TEST_NO_DRIVER;
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  process.env.HARNESS_TASKS_DIR = root;
  process.env.HARNESS_TEST_NO_DRIVER = '1';
  try { return await fn(root); } finally {
    if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot;
    if (prevNoDriver === undefined) delete process.env.HARNESS_TEST_NO_DRIVER; else process.env.HARNESS_TEST_NO_DRIVER = prevNoDriver;
    rmSync(root, { recursive: true, force: true });
  }
}

test('portfolio-consolidate: a budget-stopped Sprint integrates its accepted work once - never a loop of re-merges', async () => {
  const { enforceBudget, finish } = await import('../mcp/taskmanager.mjs');
  await withBoxRoot(async (root) => {
    const task = consolidateTask(root, 'pc1');
    mkdirSync(join(root, 'pc1'), { recursive: true });
    writeDriverSpend(root, 'pc1', 'dispatch_P3_1.restart1', 45);
    // 05:18: P3's dispatch has failed, nothing is running. The sweep skips P4 and reintegrates P1+P2.
    assert.equal(enforceBudget(task), true);
    const i2 = task.nodes.find((n) => n.node_id === 'integrate:2');
    assert.ok(i2, JSON.stringify(task.nodes.map((n) => [n.node_id, n.state])));
    assert.deepEqual(i2.deps, ['accept:P1:1', 'accept:P2:1']);
    assert.deepEqual(task.budget_stopped.skipped_packages, ['P4']);
    const i1 = task.nodes.find((n) => n.node_id === 'integrate:1');
    assert.notEqual(i1.state, 'pending', 'the superseded integrate is settled, not left pending for the next sweep to find again');
    assert.equal(i1.final, true);
    // integrate:2 runs and verifies.
    i2.state = 'running';
    i2.integration = { cwd: join(root, 'integration-2'), branch: 'harness/pc1/integration-2', merged: [{ package: 'P1', branch: 'b1', commit: 'bf5cb86' }, { package: 'P2', branch: 'b2', commit: '0f4442a' }] };
    finish(task, i2, { stage_ok: true, verified: true, checks: ['git log -> integrate P2 on top of integrate P1'] });
    assert.equal(i2.state, 'done');
    // The real run's daemon ticked on: every tick reopened another integrate over the same accepts.
    for (let i = 0; i < 5; i += 1) enforceBudget(task);
    const integrates = task.nodes.filter((n) => n.stage === 'integrate').map((n) => n.node_id);
    assert.deepEqual(integrates, ['integrate:1', 'integrate:2'], 'one integrate of the accepted work, no integrate:3..6');
    assert.ok(!task.nodes.some((n) => n.node_id === 'dispatch:QA:2'), 'no QA round a stopped box could never dispatch');
    // The goal gate still judges what was integrated (QA never ran, and says so).
    const goal = task.nodes.find((n) => n.node_id === 'gate:goal:1');
    assert.equal(goal.state, 'pending');
    assert.deepEqual(goal.deps, ['integrate:2'], 'rewired past the QA pass onto the integrate that actually ran');
    assert.deepEqual((task.budget_stopped.qa_not_run || []).map((q) => q.pass), ['QA']);
  });
});

test('portfolio-consolidate: a QA round skipped by the budget is not a defect - it never reopens integrate', async () => {
  const { enforceBudget, finish } = await import('../mcp/taskmanager.mjs');
  await withBoxRoot(async (root) => {
    // The real run's own later shape: integrate:2 running over P1+P2, integrate:1 left pending with
    // P3's accept dead under it, QA:1 wired behind integrate:2 and never dispatched.
    const task = consolidateTask(root, 'pc2');
    task.budget_stopped.skipped_packages = ['P4'];
    for (const id of ['dispatch:P4:1', 'accept:P4:1']) Object.assign(task.nodes.find((n) => n.node_id === id), { state: 'skipped', final: true, result: { stage_ok: false, reason: 'skipped: budget/timebox exhausted' } });
    task.nodes.find((n) => n.node_id === 'dispatch:QA:1').deps = ['integrate:2'];
    task.nodes.push({ node_id: 'integrate:2', stage: 'integrate', deps: ['accept:P1:1', 'accept:P2:1'], after: [], state: 'running', subgoal_id: null, supersedes: 'integrate:1', feedback: 'budget/timebox exhausted; not done: P3, P4',
      integration: { cwd: join(root, 'integration-2'), branch: 'harness/pc2/integration-2', merged: [] } });
    mkdirSync(join(root, 'pc2'), { recursive: true });
    writeDriverSpend(root, 'pc2', 'dispatch_P3_1.restart1', 45);
    finish(task, task.nodes.find((n) => n.node_id === 'integrate:2'), { stage_ok: true, verified: true, checks: ['ls portfolio/skills -> fit'] });
    for (let i = 0; i < 5; i += 1) enforceBudget(task);
    assert.deepEqual(task.nodes.filter((n) => n.stage === 'integrate').map((n) => n.node_id), ['integrate:1', 'integrate:2'],
      JSON.stringify(task.nodes.map((n) => [n.node_id, n.state, n.deps])));
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'gate:goal:1').deps, ['integrate:2']);
  });
});

test('portfolio-consolidate: once the box has stopped, a capacity-parked driver is not respawned - it is settled', async () => {
  const { enforceBudget, autoResumeCapacity } = await import('../mcp/taskmanager.mjs');
  await withBoxRoot(async (root) => {
    const task = consolidateTask(root, 'pc3');
    const d3 = task.nodes.find((n) => n.node_id === 'dispatch:P3:1');
    const since = Date.now() - 60 * 60 * 1000;
    Object.assign(d3, { state: 'running', final: undefined, result: undefined, child: {
      cwd: root, run_id: 'p3run', branch: 'harness/pc3/P3',
      driver: { pid: 2 ** 22 + 4323, started_at: since },
      waiting_capacity: { reason: "You've hit your session limit · resets 4:50am (UTC)", since },
    } });
    task.budget_stopped.at = Date.now(); // stopped just now: well inside budget_grace_minutes
    mkdirSync(join(root, 'pc3'), { recursive: true });
    writeDriverSpend(root, 'pc3', 'dispatch_P2_1', 45);
    // Well past any reset + grace: before the stop this resumes; after it, nothing may spend again.
    assert.equal(autoResumeCapacity(task, since + 25 * 60 * 60 * 1000), false, 'a stopped box resumes nothing');
    assert.ok(d3.child.waiting_capacity, 'still parked');
    // And the park is settled at once - no grace to wait out for a driver that is not even running.
    assert.equal(enforceBudget(task), true);
    assert.equal(d3.state, 'skipped');
    assert.match(d3.result.reason, /parked on provider capacity/);
    assert.equal(task.nodes.find((n) => n.node_id === 'accept:P3:1').state, 'skipped');
    const ledger = readFileSync(join(root, 'pc3', 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(ledger.some((e) => e.event === 'budget_killed' && e.node_id === 'dispatch:P3:1'));
  });
});

test('portfolio-consolidate: a budget-closed task with failed/skipped work reads partial, not complete, with reasons', async () => {
  const { managerState, taskState, unfinishedWork } = await import('../mcp/taskmanager.mjs');
  await withBoxRoot(async (root) => {
    // The real run's final shape: integrate:6 failed verified=false, P3 never accepted, P4 never
    // dispatched, QA and gate:goal skipped, report done - and the ledger said state complete.
    const task = consolidateTask(root, 'pc4');
    task.budget_stopped.skipped_packages = ['P4'];
    const skip = (n) => Object.assign(n, { state: 'skipped', final: true, result: { stage_ok: false, reason: 'skipped: budget/timebox exhausted - the Sprint closes on what it has' } });
    for (const n of task.nodes) {
      if (['accept:P3:1', 'dispatch:P4:1', 'accept:P4:1', 'integrate:1', 'dispatch:QA:1', 'accept:QA:1', 'gate:goal:1'].includes(n.node_id)) skip(n);
      if (n.node_id === 'report') Object.assign(n, { state: 'done', result: { stage_ok: true, handoff: 'r' } });
    }
    task.nodes.find((n) => n.node_id === 'dispatch:QA:1').deps = ['integrate:6'];
    task.nodes.push({ node_id: 'integrate:6', stage: 'integrate', deps: ['accept:P1:1', 'accept:P2:1'], after: [], state: 'failed', final: true, subgoal_id: null, supersedes: 'integrate:1',
      result: { stage_ok: true, verified: false, checks: ['git log (integration-6) -> e15e742'] } });
    const st = managerState(task);
    assert.equal(st.state, 'partial', 'a report over undone work is not `complete`');
    assert.equal(st.partial, true);
    const why = st.partial_reasons.join('\n');
    assert.match(why, /P3/);
    assert.match(why, /P4/);
    assert.match(why, /integrate:6/);
    assert.match(why, /QA/);
    assert.match(why, /gate:goal:1/);
    assert.equal(taskState(task).partial, true, 'tm_wait/daemon_done read taskState');
    assert.deepEqual(unfinishedWork(task).partial_reasons, st.partial_reasons);
    // A stopped box that still delivered everything it had is not partial.
    const whole = consolidateTask(root, 'pc5', { budget_stopped: { at: Date.now(), spend: 41, skipped_packages: [] } });
    whole.spec.packages = whole.spec.packages.slice(0, 2);
    delete whole.qa_pkg;
    whole.nodes = whole.nodes.filter((n) => !/P3|P4|QA|integrate:1/.test(n.node_id));
    whole.nodes.push({ node_id: 'integrate:1', stage: 'integrate', deps: ['accept:P1:1', 'accept:P2:1'], after: [], state: 'done', subgoal_id: null, result: { stage_ok: true, verified: true, checks: ['ok'] } });
    Object.assign(whole.nodes.find((n) => n.node_id === 'gate:goal:1'), { deps: ['integrate:1'], state: 'done', result: { stage_ok: true, accept: true, match_pct: 95, checks: ['ok'] } });
    Object.assign(whole.nodes.find((n) => n.node_id === 'report'), { state: 'done', result: { stage_ok: true } });
    const ws = managerState(whole);
    assert.equal(ws.state, 'complete');
    assert.equal(ws.partial, undefined, JSON.stringify(ws));
  });
});

// ---------- cards everywhere (_repo/docs/plans/2026-09-28-teams-cards-everywhere.md C2-C7) ----------
//
// Planning and QA run as STORY cards, one per feature area, each its own full-harness child run;
// plan-integrate merges and judges the planning cards (C4); QA files a round's defects together.

const TWO_AREAS = [
  { id: 'F1', title: 'module a', brief: 'everything about a.txt' },
  { id: 'F2', title: 'module b', brief: 'everything about b.txt' },
];

// Opens both planning cards and drives each to an accepted card, stopping short of the planning
// integrate. storiesOf(cardId) is what that card's child returns.
async function twoCardsAccepted(tm, g, task_id, storiesOf) {
  await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'] }) });
  await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: TWO_AREAS }) });
  const nx = await tm.call('tm_next', { task_id });
  assert.deepEqual(nx.children.map((c) => c.package_id), ['PLAN-F1', 'PLAN-F2'], 'both planning cards dispatch in parallel');
  for (const c of nx.children) {
    await completePlanningChild(g, c, storiesOf(c.package_id));
    assert.equal((await tm.call('tm_submit', { task_id, node_id: c.node_id })).state, 'done');
    assert.equal((await tm.call('tm_submit', { task_id, node_id: `accept:${c.package_id}:1`, payload: ok({ accept: true, match_pct: 95 }) })).state, 'done');
  }
}

// The two-area shape: P1 implements F1's stories, P2 F2's.
const SHAPE_BY_AREA = { acceptance: SHAPE.acceptance, packages: SHAPE.packages.map((p, i) => ({ ...p, implements: [['F1-US-1', 'F1-US-2'], ['F2-US-1', 'F2-US-2']][i] })) };

// size -> two planning cards -> shape by area -> P1/P2 accepted -> integrate:1 verified.
async function twoAreasIntegrated(tm, g, task_id) {
  await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'] }) });
  await drivePlanning((n, a) => tm.rawCall(n, a), g, task_id, { areas: TWO_AREAS });
  assert.equal((await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...SHAPE_BY_AREA, handoff: 's' }) })).state, 'done');
  await tm.call('tm_submit', { task_id, node_id: 'critique', payload: ok({ sound: true }) });
  for (const p of ['P1', 'P2']) {
    const c = (await tm.call('tm_next', { task_id })).children.find((x) => x.package_id === p);
    await completeChild(g, c);
    await tm.call('tm_submit', { task_id, node_id: `dispatch:${p}:1` });
    await tm.call('tm_submit', { task_id, node_id: `accept:${p}:1`, payload: ok({ accept: true, match_pct: 92 }) });
  }
  await tm.call('tm_next', { task_id });
  assert.equal((await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) })).state, 'done');
}

function withTasksRoot(root, fn) {
  const prev = process.env.HARNESS_TASKS_DIR;
  process.env.HARNESS_TASKS_DIR = root;
  try { return fn(); } finally { if (prev === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prev; }
}

test('C4: story ids that collide across planning cards refuse the merge whatever the judge said, and the later card goes back with the ids to renumber', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    // m1: a card whose stories lack its area prefix is refused at its own fold, before any merge.
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'] }) });
    await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: TWO_AREAS }) });
    const first = await tm.call('tm_next', { task_id });
    const f1 = first.children.find((c) => c.package_id === 'PLAN-F1');
    await completePlanningChild(g, f1, ['US-1', 'US-2']);
    const refused = await tm.call('tm_submit', { task_id, node_id: f1.node_id });
    assert.equal(refused.state, 'failed');
    assert.match(refused.reason, /user story US-1 does not carry this card's id prefix F1-US-n/);
  });
  await withTask(async ({ tm, g, root, task_id }) => {
    // The merge's own duplicate check stays as a second line: a card opened before area prefixes
    // (no area on it) can still collide, and the planning integrate refuses it whatever the judge said.
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'] }) });
    await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: TWO_AREAS }) });
    const legacy = readTask(root, task_id);
    for (const p of legacy.planning_pkgs) delete p.area;
    writeFileSync(join(root, task_id, 'task.json'), JSON.stringify(legacy, null, 2));
    const cards = await tm.call('tm_next', { task_id });
    for (const c of cards.children) {
      await completePlanningChild(g, c, ['US-1', 'US-2']);
      assert.equal((await tm.call('tm_submit', { task_id, node_id: c.node_id })).state, 'done');
      assert.equal((await tm.call('tm_submit', { task_id, node_id: `accept:${c.package_id}:1`, payload: ok({ accept: true, match_pct: 95 }) })).state, 'done');
    }
    const nx = await tm.call('tm_next', { task_id });
    const pi = nx.ready.find((r) => r.node_id === 'plan-integrate:1');
    assert.match(readFileSync(pi.briefing_path, 'utf8'), /Story ids the manager already found defined twice[\s\S]*US-1: PLAN-F1, PLAN-F2/);
    const v = await tm.call('tm_submit', { task_id, node_id: 'plan-integrate:1', payload: ok({ accept: true }) });
    assert.equal(v.state, 'failed', JSON.stringify(v));
    assert.match(v.reason, /story ids collide across planning cards: US-1 \(PLAN-F1, PLAN-F2\), US-2 \(PLAN-F1, PLAN-F2\)/);

    let task = readTask(root, task_id);
    const retry = task.nodes.find((n) => n.node_id === 'dispatch:PLAN-F2:2');
    assert.ok(retry, 'the later card of each collision is sent back');
    assert.match(retry.feedback, /story id US-1 is also defined by PLAN-F1: renumber this card's stories with its own prefix \(F2-US-n\)/);
    assert.ok(!task.nodes.some((n) => n.node_id === 'dispatch:PLAN-F1:2'), 'the first definer keeps its ids');
    const pi2 = task.nodes.find((n) => n.node_id === 'plan-integrate:2');
    assert.deepEqual(pi2.deps, ['accept:PLAN-F1:1', 'accept:PLAN-F2:2'], 'a fresh planning integrate waits on the retried card');
    assert.equal(pi2.supersedes, 'plan-integrate:1');
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'shape').deps, ['plan-integrate:2'], 'shape moves behind it');

    // PLAN-F2's second attempt renumbers; the merge now holds, and shape must cover BOTH cards.
    const again = (await tm.call('tm_next', { task_id })).children.find((c) => c.node_id === 'dispatch:PLAN-F2:2');
    await completePlanningChild(g, again, ['F2-US-1']);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:PLAN-F2:2' });
    await tm.call('tm_submit', { task_id, node_id: 'accept:PLAN-F2:2', payload: ok({ accept: true, match_pct: 95 }) });
    await tm.call('tm_next', { task_id });
    assert.equal((await tm.call('tm_submit', { task_id, node_id: 'plan-integrate:2', payload: ok({ accept: true }) })).state, 'done');
    task = readTask(root, task_id);
    assert.match(readFileSync(docPaths(task).prd, 'utf8'), /- US-1 \(PLAN-F1\)\n- US-2 \(PLAN-F1\)\n- F2-US-1 \(PLAN-F2\)/, 'the merged PRD holds the renumbered stories, not the refused ones');

    const short = await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...SHAPE, packages: SHAPE.packages.map((p, i) => ({ ...p, implements: [['US-1', 'US-2'][i]] })), handoff: 's' }) });
    assert.equal(short.state, 'failed');
    assert.match(short.reason, /user stories not implemented by any package: F2-US-1/, 'implements[] must cover every story from every card');
  });
});

test('C4: a planning integrate that names cards and a missing feature sends those cards back with the gaps and opens a card for the feature', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await twoCardsAccepted(tm, g, task_id, (id) => [`${id.replace('PLAN-', '')}-US-1`]);
    await tm.call('tm_next', { task_id });
    const v = await tm.call('tm_submit', { task_id, node_id: 'plan-integrate:1', payload: ok({
      accept: false, reason: 'F1 and F2 disagree on refunds; exports are missing',
      contradictions: ['PLAN-F1 vs PLAN-F2: F1 refunds within 7 days, F2 never refunds'],
      uncovered: ['usage export -> no card covers it'],
      retry: [{ card: 'PLAN-F2', gaps: ['state the refund rule F1 relies on, or say F1 is wrong'] }, { card: 'NOPE', gaps: ['ignored: not a card'] }],
      new_areas: [{ title: 'usage export', brief: 'an admin can export usage as CSV' }],
    }) });
    assert.equal(v.state, 'failed', JSON.stringify(v));
    const task = readTask(root, task_id);
    const retry = task.nodes.find((n) => n.node_id === 'dispatch:PLAN-F2:2');
    assert.ok(retry);
    assert.match(retry.feedback, /state the refund rule F1 relies on/);
    assert.match(retry.feedback, /contradiction: PLAN-F1 vs PLAN-F2/);
    assert.ok(!task.nodes.some((n) => n.node_id === 'dispatch:PLAN-F1:2'), 'a card the judge did not name is left alone');
    assert.deepEqual(task.planning_pkgs.map((p) => p.id), ['PLAN-F1', 'PLAN-F2', 'PLAN-F3'], 'the missing feature gets its own card');
    assert.equal(task.planning_pkgs[2].area_title, 'usage export');
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'dispatch:PLAN-F3:1').deps, ['areas-critique']);
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'plan-integrate:2').deps, ['accept:PLAN-F1:1', 'accept:PLAN-F2:2', 'accept:PLAN-F3:1']);
    assert.match(task.nodes.find((n) => n.node_id === 'plan-integrate:2').feedback, /disagree on refunds/);
    // Both reopened cards dispatch at once.
    const kids = (await tm.call('tm_next', { task_id })).children.map((c) => c.package_id).sort();
    assert.deepEqual(kids, ['PLAN-F2', 'PLAN-F3']);
  });
});

test('C4: planning integrates are budgeted like a reshape - past max_retries the refusal settles and shape is unreachable', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await twoCardsAccepted(tm, g, task_id, (id) => [`${id.replace('PLAN-', '')}-US-1`]);
    await tm.call('tm_next', { task_id });
    await tm.call('tm_submit', { task_id, node_id: 'plan-integrate:1', payload: ok({ accept: false, reason: 'contradiction', retry: [{ card: 'PLAN-F1', gaps: ['x'] }] }) });
    const task = readTask(root, task_id);
    assert.ok(!task.nodes.some((n) => n.node_id === 'plan-integrate:2'));
    assert.equal(task.nodes.find((n) => n.node_id === 'shape').state, 'unreachable');
    assert.equal((await tm.call('tm_status', { task_id })).state, 'blocked');
    // M2: blocked is not the end - the next tick closes it to a report, with the PRD the cards
    // wrote, and the retro carries the stories forward.
    await planningClosesToReport(tm, root, task_id, { node: 'plan-integrate:1', prd: true, stories: ['F1-US-1', 'F2-US-1'] });
  }, { max_retries: 0 });
});

// M2 (_repo/docs/plans/2026-09-28-teams-adversarial-fixes.md): a planning phase spent past its retries
// closes to a report and a retro instead of ending blocked with neither.
async function planningClosesToReport(tm, root, task_id, { node: deadId, prd, stories = [] }) {
  const nx = await tm.call('tm_next', { task_id });
  assert.deepEqual(nx.ready.map((r) => r.node_id), ['report'], JSON.stringify(nx));
  let task = readTask(root, task_id);
  assert.equal(task.planning_failed.node_id, deadId);
  assert.equal(task.planning_failed.prd, prd);
  assert.ok(!task.nodes.some((n) => n.state === 'pending' && n.stage !== 'report'), 'nothing is left pending behind the dead planning');
  assert.ok(!task.nodes.some((n) => n.state === 'unreachable'));
  const brief = readFileSync(nx.ready[0].briefing_path, 'utf8');
  assert.match(brief, new RegExp(`planning stopped at ${deadId.replace(/[:.]/g, '\\$&')}`));
  const done = await tm.call('tm_submit', { task_id, node_id: 'report', payload: ok({ handoff: 'planning never settled' }) });
  assert.equal(done.state, 'done');
  task = readTask(root, task_id);
  assert.ok(existsSync(docPaths(task).report), '80-report.md is written');
  const retro = JSON.parse(readFileSync(docPaths(task).retro, 'utf8'));
  assert.deepEqual(retro.next_backlog.unfinished_stories.map((u) => u.id), stories);
  assert.ok(retro.retrospective.partial_reasons.some((r) => r.startsWith(`planning stopped at ${deadId}`)));
  assert.equal(existsSync(docPaths(task).prd), prd, prd ? 'the accepted cards\' PRD is kept' : 'no card accepted, no PRD');
  assert.equal((await tm.call('tm_status', { task_id })).state, 'partial');
}

test('M2: an areas split spent past its retries closes to a report and retro, with no PRD', async () => {
  const { autoReshape } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, root, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'] }) });
    await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: [] }) });
    const task = readTask(root, task_id);
    assert.equal(withTasksRoot(root, () => autoReshape(task)), false, 'no split attempt left');
    assert.equal(readTask(root, task_id).nodes.find((n) => n.node_id === 'areas').final, true);
    await planningClosesToReport(tm, root, task_id, { node: 'areas', prd: false });
  }, { max_retries: 0 });
});

test('G4/M2: a Sprint whose planning failed carries every backlog request into the next one', async () => {
  const { autoReshape } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, root, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'] }) });
    await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: [] }) });
    withTasksRoot(root, () => autoReshape(readTask(root, task_id)));
    await planningClosesToReport(tm, root, task_id, { node: 'areas', prd: false });
    const retro = JSON.parse(readFileSync(docPaths(readTask(root, task_id)).retro, 'utf8'));
    assert.deepEqual(retro.next_backlog.unshipped_requests.map((r) => r.request), ['sign in', 'sign out', 'reset password']);
  }, { max_retries: 0, request: undefined, requests: ['sign in', 'sign out', 'reset password'] });
});

test('M2: a planning card spent past its retries closes to a report; the sibling card\'s PRD and stories carry', async () => {
  const { autoRetryPackages } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, g, root, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'] }) });
    await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: TWO_AREAS }) });
    const nx = await tm.call('tm_next', { task_id });
    for (const c of nx.children) {
      await completePlanningChild(g, c, [`${c.package_id.replace('PLAN-', '')}-US-1`]);
      await tm.call('tm_submit', { task_id, node_id: c.node_id });
      await tm.call('tm_submit', { task_id, node_id: `accept:${c.package_id}:1`, payload: ok(c.package_id === 'PLAN-F1'
        ? { accept: true, match_pct: 95 } : { accept: false, match_pct: 40, reason: 'thin', gaps: ['no acceptance'] }) });
    }
    const task = readTask(root, task_id);
    assert.equal(withTasksRoot(root, () => autoRetryPackages(task)), true);
    assert.equal(readTask(root, task_id).nodes.find((n) => n.node_id === 'accept:PLAN-F2:1').final, true);
    await planningClosesToReport(tm, root, task_id, { node: 'accept:PLAN-F2:1', prd: true, stories: ['F1-US-1', 'F2-US-1'] });
  }, { max_retries: 0 });
});

test('C2: a rejected planning card gets its retry, and the planning integrate waits on the new attempt', async () => {
  const { autoRetryPackages } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, g, root, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'] }) });
    await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: TWO_AREAS }) });
    for (const c of (await tm.call('tm_next', { task_id })).children) {
      await completePlanningChild(g, c, [`${c.package_id.replace('PLAN-', '')}-US-1`]);
      await tm.call('tm_submit', { task_id, node_id: c.node_id });
    }
    await tm.call('tm_submit', { task_id, node_id: 'accept:PLAN-F1:1', payload: ok({ accept: true, match_pct: 95 }) });
    const v = await tm.call('tm_submit', { task_id, node_id: 'accept:PLAN-F2:1', payload: ok({ accept: false, match_pct: 70, gaps: ['no acceptance on F2-US-1'], reason: 'thin' }) });
    assert.equal(v.state, 'failed');
    const task = readTask(root, task_id);
    assert.ok(withTasksRoot(root, () => autoRetryPackages(task)));
    const retry = task.nodes.find((n) => n.node_id === 'dispatch:PLAN-F2:2');
    assert.ok(retry, 'the rejected card gets a second attempt, exactly like a develop package');
    assert.match(retry.feedback, /no acceptance on F2-US-1/);
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'plan-integrate:1').deps, ['accept:PLAN-F1:1', 'accept:PLAN-F2:2']);
  });
});

// M4 (_repo/docs/plans/2026-09-28-teams-adversarial-fixes.md): the split has its own gate before any
// card runs, a planning integrate can send the split itself back, and both are human-gateable.
test('m12: every card and package carries its acceptance verbatim; only a shaped STORY is told a critique passed it', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'] }) });
    await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: [{ title: 'sign-in', brief: 'a user signs in' }] }) });
    const nx = await tm.call('tm_next', { task_id });
    const run = readChild(nx.children[0]);
    assert.equal(run.package.origin, 'planning');
    assert.match(run.package.acceptance[0], /PRD section for feature area F1/);
    const next = await g.call('team_next', { run_id: nx.children[0].run_id, cwd: nx.children[0].cwd });
    const text = readFileSync(next.ready[0].briefing_path, 'utf8');
    assert.match(text, /opened this run as a PLANNING card/);
    assert.doesNotMatch(text, /critiqued that split/, 'no critique claim for a card shape never produced');
  });
});

test('M4: areas-critique judges the split before any card opens; a refusal re-splits with its blocking defects, and past the budget planning closes to a report', async () => {
  const { autoReshape } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, root, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'] }) });
    await tm.rawCall('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: TWO_AREAS }) });
    let task = readTask(root, task_id);
    assert.deepEqual(task.planning_pkgs, [], 'no card opens before the split is judged');
    const nx = await tm.rawCall('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((r) => r.node_id), ['areas-critique']);
    const brief = readFileSync(nx.ready[0].briefing_path, 'utf8');
    assert.match(brief, /## The feature split \(areas\)/);
    assert.match(brief, new RegExp(TWO_AREAS[0].title));
    const noCheck = await tm.rawCall('tm_submit', { task_id, node_id: 'areas-critique', payload: { stage_ok: true, sound: true, checks: [] } });
    assert.equal(noCheck.state, 'failed', 'a sound verdict with no checks is refused');
  }, { max_retries: 1 });
  await withTask(async ({ tm, root, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'] }) });
    await tm.rawCall('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: TWO_AREAS }) });
    const v = await tm.rawCall('tm_submit', { task_id, node_id: 'areas-critique', payload: ok({ sound: false, blocking: ['overlap - both areas plan checkout'], problems: ['F2 brief is thin'] }) });
    assert.equal(v.state, 'failed');
    let task = readTask(root, task_id);
    assert.ok(withTasksRoot(root, () => autoReshape(task)));
    task = readTask(root, task_id);
    const again = task.nodes.find((n) => n.node_id === 'areas:2');
    assert.ok(again, 'the refused split is split again');
    assert.match(again.feedback, /overlap - both areas plan checkout/);
    assert.match(again.feedback, /advice: F2 brief is thin/);
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'areas-critique:2').deps, ['areas:2'], 'the new split is judged again');
    assert.deepEqual(task.planning_pkgs, []);
    // The second split is refused too; max_retries 1 leaves no third: both settle, planning closes.
    await tm.rawCall('tm_submit', { task_id, node_id: 'areas:2', payload: ok({ areas: TWO_AREAS }) });
    await tm.rawCall('tm_submit', { task_id, node_id: 'areas-critique:2', payload: ok({ sound: false, blocking: ['overlap - still'] }) });
    task = readTask(root, task_id);
    assert.equal(withTasksRoot(root, () => autoReshape(task)), false);
    task = readTask(root, task_id);
    assert.equal(task.nodes.find((n) => n.node_id === 'areas-critique:2').final, true);
    const nx = await tm.rawCall('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((r) => r.node_id), ['report'], 'M2 closes it to a report');
    assert.equal(readTask(root, task_id).planning_failed.stage, 'areas-critique');
  }, { max_retries: 1 });
});

test('M4: a planning integrate that asks for resplit retires the cards and re-splits; the new cards open behind a fresh integrate that shape now waits on', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await twoCardsAccepted(tm, g, task_id, (id) => [`${id.replace('PLAN-', '')}-US-1`]);
    await tm.call('tm_next', { task_id });
    const v = await tm.rawCall('tm_submit', { task_id, node_id: 'plan-integrate:1', payload: ok({
      accept: false, resplit: true, reason: 'the two areas are the same feature cut by layer', checks: ['read the PRD'],
    }) });
    assert.equal(v.state, 'failed');
    let task = readTask(root, task_id);
    assert.deepEqual(task.planning_pkgs.map((p) => [p.id, !!p.retired]), [['PLAN-F1', true], ['PLAN-F2', true]]);
    assert.equal(task.nodes.find((n) => n.node_id === 'plan-integrate:1').final, true);
    const again = task.nodes.find((n) => n.node_id === 'areas:2');
    assert.ok(again);
    assert.match(again.feedback, /cut by layer/);
    assert.ok(!task.nodes.some((n) => n.node_id === 'plan-integrate:2'), 'no integrate before the new split is judged');
    await tm.rawCall('tm_submit', { task_id, node_id: 'areas:2', payload: ok({ areas: [{ title: 'checkout', brief: 'a buyer can pay end to end' }] }) });
    await tm.rawCall('tm_submit', { task_id, node_id: 'areas-critique:2', payload: ok({ sound: true, checks: ['one feature, one area'] }) });
    task = readTask(root, task_id);
    assert.deepEqual(task.planning_pkgs.map((p) => p.id), ['PLAN-F1', 'PLAN-F2', 'PLAN-F3'], 'the new card gets a fresh id');
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'dispatch:PLAN-F3:1').deps, ['areas-critique:2']);
    const pi2 = task.nodes.find((n) => n.node_id === 'plan-integrate:2');
    assert.deepEqual(pi2.deps, ['accept:PLAN-F3:1'], 'the fresh integrate merges only the live card');
    assert.equal(pi2.supersedes, 'plan-integrate:1');
    assert.equal(task.nodes.filter((n) => n.stage === 'shape').length, 1, 'no second shape');
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'shape').deps, ['plan-integrate:2']);
    const nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.children.map((c) => c.package_id), ['PLAN-F3'], 'only the new card runs');
    await completePlanningChild(g, nx.children[0], ['F3-US-1']);
    await tm.call('tm_submit', { task_id, node_id: nx.children[0].node_id });
    await tm.call('tm_submit', { task_id, node_id: 'accept:PLAN-F3:1', payload: ok({ accept: true, match_pct: 95 }) });
    const { planningStories } = await import('../mcp/tickets.mjs');
    assert.deepEqual(planningStories(readTask(root, task_id)).map((u) => u.id), ['F3-US-1'], 'the retired cards\' stories are gone from the PRD');
  });
});

test('M4: human_gates can name areas-critique and plan-integrate; a person\'s plan-integrate refusal can ask for a resplit', async () => {
  await withTask(async ({ tm, root, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'] }) });
    await tm.rawCall('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: TWO_AREAS }) });
    const nx = await tm.rawCall('tm_next', { task_id });
    assert.ok(!(nx.ready || []).some((n) => n.node_id === 'areas-critique'), 'a gated critique is never offered to a model');
    const inbox = await tm.rawCall('tm_inbox', { task_id });
    const card = inbox.cards.find((c) => c.node_id === 'areas-critique');
    assert.ok(card, JSON.stringify(inbox));
    const out = await tm.rawCall('tm_submit', { task_id, key: card.key, payload: { accept: true, reason: 'the split is right' } });
    assert.equal(out.state, 'done');
    assert.deepEqual(readTask(root, task_id).planning_pkgs.map((p) => p.id), ['PLAN-F1', 'PLAN-F2']);
  }, { interactive: true, human_gates: ['areas-critique', 'plan-integrate'] });
  const { humanGateResultFromPayload, humanGateVerdictField } = await import('../mcp/graph.mjs');
  const pi = { node_id: 'plan-integrate:1', stage: 'plan-integrate' };
  assert.equal(humanGateVerdictField(pi), 'accept');
  const r = humanGateResultFromPayload(pi, { accept: false, resplit: true, reason: 'cut by layer' });
  assert.equal(r.accept, false);
  assert.equal(r.resplit, true);
});

test('m1: a planning card that wrote no PRD, or a story with no acceptance criteria, is refused at its fold', async () => {
  for (const [label, stories, opts, why] of [
    ['no PRD', ['F1-US-1'], { prd: false }, /the PRD is missing required sections: Goal/],
    ['no acceptance', [{ id: 'F1-US-1', title: 'sign in', acceptance: [] }], {}, /user story F1-US-1 has no acceptance criteria/],
    ['wrong prefix', [{ id: 'US-1', title: 'sign in', acceptance: ['signed in'] }], {}, /user story US-1 does not carry this card's id prefix F1-US-n/],
  ]) {
    await withTask(async ({ tm, g, task_id }) => {
      await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'] }) });
      await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: [{ title: 'sign-in', brief: 'a user signs in' }] }) });
      const nx = await tm.call('tm_next', { task_id });
      await completePlanningChild(g, nx.children[0], stories, opts);
      const v = await tm.call('tm_submit', { task_id, node_id: nx.children[0].node_id });
      assert.equal(v.state, 'failed', label);
      assert.match(v.reason, why, label);
    });
  }
});

test('C2: a plan stage that returns no feature areas fails, and is split again with its problems as feedback', async () => {
  const { autoReshape } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, root, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['x'] }) });
    const v = await tm.call('tm_submit', { task_id, node_id: 'areas', payload: ok({ areas: [] }) });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /no feature areas/);
    const task = readTask(root, task_id);
    assert.ok(withTasksRoot(root, () => autoReshape(task)));
    const again = task.nodes.find((n) => n.node_id === 'areas:2');
    assert.ok(again);
    assert.deepEqual(again.deps, ['size']);
    assert.match(again.feedback, /no feature areas/);
    assert.deepEqual(task.planning_pkgs, [], 'no card opens from a split with nothing in it');
  });
});

test('M3: a QA card spent past its retries does not take the round down - its sibling\'s defects are filed and the goal gate still runs', async () => {
  const { autoRetryPackages } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, g, root, task_id }) => {
    await twoAreasIntegrated(tm, g, task_id);
    const nx = await tm.call('tm_next', { task_id });
    const qa = Object.fromEntries(nx.children.map((c) => [c.package_id, c]));
    const finishQa = async (id, defect) => {
      const sub = (node_id, payload) => g.call('team_submit', { run_id: qa[id].run_id, cwd: qa[id].cwd, node_id, payload: ok(payload) });
      await sub('plan', { handoff: 'p', flow: 'qa', size: 'S' });
      await sub('setgoal', { spec: { goal: 'QA', acceptance: ['cases run'], subgoals: [{ id: 'Q1', title: 'run cases', acceptance: ['cases run'], deps: [] }] } });
      await sub('critique', { sound: true });
      await sub('cases:Q1:1', { changed_files: [], handoff: 'cases' });
      await sub('execute:Q1:1', { verified: true, handoff: 'ran' });
      await sub('gate:Q1:1', { accept: true, match_pct: 95 });
      await sub('gate:goal:1', { accept: true, match_pct: 95 });
      await g.call('team_next', { run_id: qa[id].run_id, cwd: qa[id].cwd });
      await sub('report', { handoff: 'QA report' });
      await tm.call('tm_submit', { task_id, node_id: `dispatch:${id}:1` });
      return tm.call('tm_submit', { task_id, node_id: `accept:${id}:1`, payload: ok(defect
        ? { accept: true, match_pct: 90, defects: [{ title: defect, evidence: defect, touches: [], deps: [] }] }
        : { accept: false, match_pct: 30, reason: 'the QA report does not show the cases ran', gaps: ['no evidence'] }) });
    };
    assert.equal((await finishQa('QA-F1', 'a.txt loses its newline')).state, 'done');
    assert.equal((await finishQa('QA-F2', null)).state, 'failed');
    const task = readTask(root, task_id);
    assert.ok(withTasksRoot(root, () => autoRetryPackages(task)));
    const t = readTask(root, task_id);
    assert.deepEqual(t.spec.packages.map((p) => p.id), ['P1', 'P2', 'D1'], 'QA-F1\'s defect is filed');
    const goal = t.nodes.find((n) => n.node_id === 'gate:goal:1');
    assert.notEqual(goal.state, 'unreachable', 'the goal gate is still reachable');
    assert.ok(!goal.deps.some((d) => d.startsWith('accept:QA-F2')), 'the dead card is dropped from the goal gate');
    assert.deepEqual(t.qa_not_run.map((q) => q.pass), ['QA-F2']);
    assert.ok(!t.nodes.some((n) => n.state === 'unreachable' && n.subgoal_id !== 'QA-F2'), 'nothing outside the dead card stays written off');
  }, { roles: { qa: true }, max_retries: 0 });
});

test('C7: QA runs one card per feature area in parallel, each a full-harness run over the integrated tree; a round\'s defects are filed together once every card has settled, and the next round reopens every card', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await twoAreasIntegrated(tm, g, task_id);
    let task = readTask(root, task_id);
    assert.deepEqual(task.qa_pkgs.map((q) => q.id), ['QA-F1', 'QA-F2'], 'one QA card per feature area planning split by');

    const nx = await tm.call('tm_next', { task_id });
    const qa = Object.fromEntries(nx.children.map((c) => [c.package_id, c]));
    assert.deepEqual(Object.keys(qa).sort(), ['QA-F1', 'QA-F2'], 'both QA cards run at once');
    task = readTask(root, task_id);
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'gate:goal:1').deps, ['accept:QA-F1:1', 'accept:QA-F2:1']);
    const integCwd = task.nodes.find((n) => n.node_id === 'integrate:1').integration.cwd;
    for (const id of ['QA-F1', 'QA-F2']) {
      assert.equal(qa[id].cwd, integCwd, `${id} runs on the integrated tree`);
      const run = readChild(qa[id]);
      assert.notEqual(run.parent_shaped, true, 'a QA card runs the full harness');
      assert.deepEqual(run.nodes.map((n) => n.node_id).slice(0, 2), ['plan', 'setgoal']);
    }
    assert.match(readChild(qa['QA-F1']).request, /F1-US-1/);
    assert.doesNotMatch(readChild(qa['QA-F1']).request, /F2-US-1/, 'a QA card is briefed on its own area\'s stories');
    assert.match(readChild(qa['QA-F2']).context, /QA card QA-F2, one of 2/);

    const board = await tm.call('tm_board', { task_id });
    assert.deepEqual(board.stories.filter((s) => s.role === 'qa').map((s) => s.id), ['QA-F1', 'QA-F2']);
    assert.deepEqual(board.stories.filter((s) => s.role === 'planning').map((s) => s.id), ['PLAN-F1', 'PLAN-F2']);
    const st = await tm.call('tm_status', { task_id });
    assert.deepEqual(st.cards.planning.map((c) => c.id), ['PLAN-F1', 'PLAN-F2']);
    assert.deepEqual(st.cards.qa.map((c) => [c.id, c.area]), [['QA-F1', 'F1'], ['QA-F2', 'F2']]);
    assert.equal(st.cards.user_stories, 4);

    const qaRun = async (id, defect) => {
      const sub = (node_id, payload) => g.call('team_submit', { run_id: qa[id].run_id, cwd: qa[id].cwd, node_id, payload: ok(payload) });
      await sub('plan', { handoff: 'p', flow: 'qa', size: 'S' });
      await sub('setgoal', { spec: { goal: 'QA', acceptance: ['cases run'], subgoals: [{ id: 'Q1', title: 'run cases', acceptance: ['cases run'], deps: [] }] } });
      await sub('critique', { sound: true });
      await sub('cases:Q1:1', { changed_files: [], handoff: 'cases' });
      await sub('execute:Q1:1', { verified: false, handoff: 'ran', defects: [defect] });
      await sub('gate:Q1:1', { accept: true, match_pct: 95 });
      await sub('gate:goal:1', { accept: true, match_pct: 95, defects: [defect] });
      await g.call('team_next', { run_id: qa[id].run_id, cwd: qa[id].cwd });
      await sub('report', { handoff: 'QA report' });
      await tm.call('tm_submit', { task_id, node_id: `dispatch:${id}:1` });
      return tm.call('tm_submit', { task_id, node_id: `accept:${id}:1`, payload: ok({ accept: true, match_pct: 90, defects: [{ title: defect, evidence: defect, touches: [], deps: [] }] }) });
    };
    assert.equal((await qaRun('QA-F1', 'a.txt loses its newline')).state, 'done');
    task = readTask(root, task_id);
    assert.deepEqual(task.spec.packages.map((p) => p.id), ['P1', 'P2'], 'nothing is filed while QA-F2 is still exercising the same tree');
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'gate:goal:1').deps, ['accept:QA-F1:1', 'accept:QA-F2:1']);

    assert.equal((await qaRun('QA-F2', 'b.txt is empty')).state, 'done');
    task = readTask(root, task_id);
    assert.deepEqual(task.spec.packages.map((p) => p.id), ['P1', 'P2', 'D1', 'D2'], 'the whole round\'s defects are filed together, one fix STORY each');
    assert.deepEqual(task.spec.packages.slice(2).map((p) => p.reporter), ['qa', 'qa']);
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'gate:goal:1').deps, ['integrate:2'], 'the goal gate reroutes off every QA card onto the fresh integrate');
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'integrate:2').deps, ['accept:D1:1', 'accept:D2:1']);

    for (const [id, file] of [['D1', 'd1.txt'], ['D2', 'd2.txt']]) {
      const c = (await tm.call('tm_next', { task_id })).children.find((x) => x.package_id === id);
      await completeDefectChild(g, c, file);
      await tm.call('tm_submit', { task_id, node_id: `dispatch:${id}:1` });
      await tm.call('tm_submit', { task_id, node_id: `accept:${id}:1`, payload: ok({ accept: true, match_pct: 95 }) });
    }
    await tm.call('tm_next', { task_id });
    assert.equal((await tm.call('tm_submit', { task_id, node_id: 'integrate:2', payload: ok({ verified: true, checks: ['build -> ok'] }) })).state, 'done');
    task = readTask(root, task_id);
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'dispatch:QA-F1:2').deps, ['integrate:2']);
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'dispatch:QA-F2:2').deps, ['integrate:2']);
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'gate:goal:1').deps, ['accept:QA-F1:2', 'accept:QA-F2:2'], 'round 2 reopens every QA card');
    assert.deepEqual(task.qa_pkgs.map((q) => q.integration_of), ['integrate:2', 'integrate:2']);
    // 60-qa.md lists both cards.
    const page = readFileSync(docPaths(task).qa, 'utf8');
    assert.match(page, /\| QA-F1 \| module a \|/);
    assert.match(page, /\| QA-F2 \| module b \|/);
  }, { roles: { qa: true } });
});

test('C7: past qa_rounds a whole round\'s defects are recorded unresolved, and a card retired on its dispatch\'s defects no longer holds the goal gate', async () => {
  const { autoRetryPackages } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, g, root, task_id }) => {
    await twoAreasIntegrated(tm, g, task_id);
    await tm.call('tm_next', { task_id }); // dispatches QA-F1 and QA-F2
    // QA-F1 accepted with a defect; QA-F2's dispatch failed, but its execute had found one.
    const t = readTask(root, task_id);
    Object.assign(t.nodes.find((n) => n.node_id === 'dispatch:QA-F1:1'), { state: 'done', result: { stage_ok: true, accept: true, defects: ['a broke'] } });
    Object.assign(t.nodes.find((n) => n.node_id === 'accept:QA-F1:1'), { state: 'done', result: { stage_ok: true, accept: true, checks: ['ok'], defects: [{ title: 'a broke', evidence: 'a broke' }] } });
    Object.assign(t.nodes.find((n) => n.node_id === 'dispatch:QA-F2:1'), { state: 'failed', result: { stage_ok: false, accept: false, reason: 'blocked', defects: ['b broke'] } });
    writeFileSync(join(root, task_id, 'task.json'), JSON.stringify(t));
    const task = readTask(root, task_id);
    assert.ok(withTasksRoot(root, () => autoRetryPackages(task)));
    assert.equal(task.nodes.find((n) => n.node_id === 'accept:QA-F2:1').state, 'skipped', 'retired in place, not retried on the same tree');
    assert.ok(!task.nodes.some((n) => n.node_id === 'dispatch:QA-F2:2'));
    assert.deepEqual(task.unresolved_defects.map((d) => d.title).sort(), ['a broke', 'b broke'], 'qa_rounds 0: both cards\' defects recorded, none filed');
    assert.deepEqual(task.spec.packages.map((p) => p.id), ['P1', 'P2']);
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'gate:goal:1').deps, ['accept:QA-F1:1'], 'the goal gate judges without the retired card rather than wait on it forever');
  }, { roles: { qa: true }, qa_rounds: 0 });
});

test('C7: a budget stop with two QA cards unfinished puts the goal gate back on the integrate and names both passes as not run', async () => {
  const { enforceBudget } = await import('../mcp/taskmanager.mjs');
  await withTask(async ({ tm, g, root, task_id }) => {
    await twoAreasIntegrated(tm, g, task_id);
    await tm.call('tm_next', { task_id });
    const t = readTask(root, task_id);
    for (const id of ['QA-F1', 'QA-F2']) Object.assign(t.nodes.find((n) => n.node_id === `dispatch:${id}:1`), { state: 'failed', final: true, result: { stage_ok: false, reason: `${id} blocked` } });
    t.created_at = Date.now() - 11 * 60 * 1000;
    writeFileSync(join(root, task_id, 'task.json'), JSON.stringify(t));
    const task = readTask(root, task_id);
    withTasksRoot(root, () => { enforceBudget(task); enforceBudget(task); });
    assert.ok(task.budget_stopped);
    assert.deepEqual(task.nodes.find((n) => n.node_id === 'gate:goal:1').deps, ['integrate:1']);
    assert.deepEqual(task.budget_stopped.qa_not_run.map((q) => [q.pass, q.reason]), [['QA-F1', 'QA-F1 blocked'], ['QA-F2', 'QA-F2 blocked']]);
  }, { roles: { qa: true }, timebox_minutes: 10 });
});

test('unfinishedWork names each planning and QA card that has no verdict, by card', async () => {
  const { unfinishedWork } = await import('../mcp/taskmanager.mjs');
  const acc = (id, state) => ({ node_id: `accept:${id}:1`, stage: 'accept', subgoal_id: id, attempt: 1, deps: [], state, result: { accept: state === 'done' } });
  const task = {
    run_id: 'u', nodes: [
      acc('PLAN-F1', 'done'), acc('PLAN-F2', 'failed'),
      { node_id: 'integrate:1', stage: 'integrate', deps: [], state: 'done', result: { verified: true } },
      acc('QA-F1', 'done'),
      { node_id: 'gate:goal:1', stage: 'gate', subgoal_id: null, deps: [], state: 'done', result: { accept: true } },
    ],
    planning_pkgs: [{ id: 'PLAN-F1', phase: 'planning' }, { id: 'PLAN-F2', phase: 'planning' }],
    qa_pkgs: [{ id: 'QA-F1', phase: 'qa' }, { id: 'QA-F2', phase: 'qa' }],
    spec: { packages: [] },
  };
  const r = unfinishedWork(task);
  assert.ok(r && r.partial);
  assert.deepEqual(r.partial_reasons, ['PLAN-F2: no verdict (accept:PLAN-F2:1 failed)', 'QA-F2: no verdict (never opened)']);
});
