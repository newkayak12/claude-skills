#!/usr/bin/env node
// Regression suite for the teams-engineering MCP server.
//
// Every case here is a bug that actually shipped and was caught by running a real
// graph, not by reading the code. They run against the live MCP surface over stdio
// with vendor:"self", so no vendor CLI is needed and the whole file finishes in
// seconds.
//
//   node --test graph/scripts/test-broker.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync, utimesSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BROKER = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'broker.mjs');
const CODEX_ADAPTER = join(dirname(fileURLToPath(import.meta.url)), '..', 'adapters', 'codex-exec-adapter.mjs');
const CLAUDE_ADAPTER = join(dirname(fileURLToPath(import.meta.url)), '..', 'adapters', 'claude-exec-adapter.mjs');

// ---------- a minimal MCP client ----------

class Client {
  constructor(env = {}) {
    this.proc = spawn('node', [BROKER], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...env } });
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
    await this.send('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    return this;
  }
  async call(name, args) {
    const r = await this.send('tools/call', { name, arguments: args });
    const res = r.result || {};
    if (res.isError) return { error: res.content[0].text };
    return res.structuredContent;
  }
  close() {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

// ---------- fixtures ----------

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'broker-test-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return dir;
}

// A truthful claim needs a change git can actually see.
function dirty(dir, file = 'a.txt') {
  appendFileSync(join(dir, file), 'changed\n');
  return file;
}

const SPEC = {
  goal: 'G',
  acceptance: ['A'],
  subgoals: [
    { id: 'U1', title: 'first', acceptance: ['a'], test: ['t'], deps: [] },
    { id: 'U2', title: 'second', acceptance: ['b'], test: ['t'], deps: ['U1'] },
  ],
};

async function openRun(c, cwd, extra = {}) {
  // goal_judges:1 keeps every existing fixture on the single-gate:goal:1 shape it was
  // written against; the multi-judge consensus path has its own suite (test-goalgate.mjs).
  const r = await c.call('team_open', { request: 'r', cwd, vendor: 'self', goal_judges: 1, ...extra });
  return r.run_id;
}

// A default so every existing fixture keeps behaving as if it had checked something -
// the engine now refuses an accept:true gate with an empty checks[]. Tests of that rule
// itself pass their own checks: [] to override the default. attacks is the goal gate's
// analogous default (Step 9): accept:true with an empty attacks[] is refused the same way,
// but only on the goal gate - a harmless extra field on every other stage's payload.
const ok = (payload) => ({ stage_ok: true, evidence: 'e', checks: ['ok -> looked fine'], attacks: ['ok -> looked fine from outside'], ...payload });

async function throughCritique(c, cwd, runId) {
  await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
  await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC, handoff: 's' }) });
  await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: true }) });
}

async function withRun(fn, extra) {
  const cwd = repo();
  const c = await new Client().init();
  try {
    const runId = await openRun(c, cwd, extra);
    await fn({ c, cwd, runId });
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
}

// ---------- protocol ----------

test('serves the MCP handshake and the graph tool surface', async () => {
  const c = await new Client().init();
  try {
    const r = await c.send('tools/list', {});
    const names = r.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'team_next', 'team_open', 'team_retry', 'team_run', 'team_status', 'team_submit',
    ]);
  } finally {
    c.close();
  }
});

test('team_open seeds plan -> setgoal -> critique and offers plan first', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const st = await c.call('team_status', { run_id: runId, cwd });
    assert.deepEqual(st.nodes.map((n) => n.node_id), ['plan', 'setgoal', 'critique']);
    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['plan']);
  });
});

// ---------- team_open honors .claude/team.json (same precedence tm_open has) ----------

test('team_open reads .claude/team.json as defaults for vendor/allocation/goal_threshold/max_retries', async () => {
  const cwd = repo();
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'team.json'), JSON.stringify({
    vendor: 'codex', allocation: 'balanced', goal_threshold: 95, max_retries: 4,
  }));
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('team_open', { request: 'r', cwd, goal_judges: 1 });
    const full = await c.call('team_status', { run_id, cwd, full: true });
    assert.equal(full.vendor, 'codex');
    assert.equal(full.allocation, 'balanced');
    assert.equal(full.goal_threshold, 95);
    assert.equal(full.max_retries, 4);
  } finally { c.close(); rmSync(cwd, { recursive: true, force: true }); }
});

test('an explicit team_open argument still wins over a team.json pin', async () => {
  const cwd = repo();
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'team.json'), JSON.stringify({ goal_threshold: 95, max_retries: 4 }));
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('team_open', {
      request: 'r', cwd, vendor: 'self', goal_judges: 1, goal_threshold: 80,
    });
    const full = await c.call('team_status', { run_id, cwd, full: true });
    assert.equal(full.goal_threshold, 80, 'explicit arg beats team.json');
    assert.equal(full.max_retries, 4, 'team.json still applies where no explicit arg was given');
  } finally { c.close(); rmSync(cwd, { recursive: true, force: true }); }
});

test('no team.json: team_open defaults stay byte-identical to today', async () => {
  const cwd = repo();
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('team_open', { request: 'r', cwd, vendor: 'self', goal_judges: 1 });
    const full = await c.call('team_status', { run_id, cwd, full: true });
    assert.equal(full.vendor, 'self');
    assert.equal(full.allocation, 'ordered');
    assert.equal(full.goal_threshold, 90);
    assert.equal(full.max_retries, 2);
  } finally { c.close(); rmSync(cwd, { recursive: true, force: true }); }
});

test('goal_judges keeps its own default of 2 on team_open regardless of team.json - it is not a team.json key', async () => {
  const cwd = repo();
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'team.json'), JSON.stringify({ goal_judges: 1, goal_threshold: 95 }));
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('team_open', { request: 'r', cwd, vendor: 'self' });
    const full = await c.call('team_status', { run_id, cwd, full: true });
    assert.equal(full.goal_judges, 2, 'goal_judges is not in TEAM_DEFAULTS; team_open keeps its own default of 2');
    assert.equal(full.goal_threshold, 95, 'goal_threshold from team.json still applies alongside it');
  } finally { c.close(); rmSync(cwd, { recursive: true, force: true }); }
});

test('team_open surfaces team.json config notes through team_status - a typo is not silently swallowed', async () => {
  const cwd = repo();
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'team.json'), JSON.stringify({ vendor: 'self', goal_threshhold: 95 }));
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('team_open', { request: 'r', cwd, goal_judges: 1 });
    const st = await c.call('team_status', { run_id, cwd });
    assert.ok(Array.isArray(st.config_notes) && st.config_notes.length,
      `a typo'd team.json key must be visible somewhere on the team_open path: ${JSON.stringify(st)}`);
    assert.ok(st.config_notes.some((n) => n.includes('goal_threshhold')), `notes: ${JSON.stringify(st.config_notes)}`);
  } finally { c.close(); rmSync(cwd, { recursive: true, force: true }); }
});

// ---------- the orchestrator must not receive payloads ----------

test('a verdict carries no spec, handoff, or evidence', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    const v = await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'setgoal',
      payload: ok({ spec: SPEC, handoff: 'long handoff text', evidence: 'long evidence text' }),
    });
    for (const leaked of ['spec', 'handoff', 'evidence', 'result', 'changed_files', 'gaps']) {
      assert.equal(leaked in v, false, `verdict leaked ${leaked}`);
    }
  });
});

test('setgoal expands the graph server-side from a spec the caller never gets back', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    const st = await c.call('team_status', { run_id: runId, cwd });
    const ids = st.nodes.map((n) => n.node_id);
    for (const id of ['implement:U1:1', 'test:U1:1', 'gate:U1:1', 'gate:goal:1', 'report']) {
      assert.ok(ids.includes(id), `missing ${id}`);
    }
    // U2 declared deps:["U1"], which must become a dependency on U1's gate.
    const u2 = st.nodes.find((n) => n.node_id === 'implement:U2:1');
    assert.ok(u2.deps.includes('gate:U1:1'));
  });
});

// ---------- ordering is enforced, not advisory ----------

test('team_submit refuses a node whose deps are unmet', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const r = await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({}) });
    assert.match(r.error, /blocked on plan/);
  });
});

test('team_submit refuses an unknown node; a duplicate submit of a finished one is a no-op that returns the stored verdict', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const unknown = await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({}) });
    assert.match(unknown.error, /unknown node/);
    const first = await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    assert.equal(first.state, 'done');
    // At-least-once delivery (docs/plans/2026-09-23-teams-reducer-human-rollback.md §5): a
    // second submit of the same {run_id, node_id} - the request retried, two callers racing -
    // must not re-adjudicate. It gets back exactly the first verdict, flagged idempotent, never
    // an error.
    const again = await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'DIFFERENT - must be ignored' }) });
    assert.equal(again.idempotent, true);
    assert.equal(again.state, 'done');
    assert.equal(again.stage_ok, first.stage_ok);
    // A wrong attempt number is a real mismatch, not a duplicate - still refused.
    const wrongAttempt = await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', attempt: 99, payload: ok({}) });
    assert.match(wrongAttempt.error, /is done, not pending/);
  });
});

// ---------- adjudication ----------

test('a claimed file the worktree does not show fails the node', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const v = await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'implement:U1:1',
      payload: ok({ changed_files: ['ghost.js'], handoff: 'h' }),
    });
    assert.equal(v.submitted_stage_ok, true, 'the node claimed success');
    assert.equal(v.stage_ok, false, 'the broker must lower it');
    assert.deepEqual(v.contradicted_files, ['ghost.js']);
    assert.equal(v.state, 'failed');
  });
});

test('a truthful claim under isolated verifies positively', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    const v = await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'implement:U1:1',
      payload: ok({ changed_files: [f], handoff: 'h' }),
    });
    assert.equal(v.stage_ok, true);
    assert.equal(v.changed_files_verified, true);
    assert.equal(v.change_attribution, 'isolated');
  }, { isolated: true });
});

test('a shared worktree reports null attribution rather than a pass', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    const v = await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'implement:U1:1',
      payload: ok({ changed_files: [f], handoff: 'h' }),
    });
    assert.equal(v.stage_ok, true);
    assert.equal(v.changed_files_verified, null, 'could not attribute is not verified');
    assert.equal(v.change_attribution, 'shared-worktree');
  });
});

// ---------- verdicts must gate progression ----------
// stage_ok on a judging node means "the judging worked". Reading only stage_ok once let
// a rejected subgoal flow downstream as if it had passed.

test("an author's stage_ok:false with no reason and passing checks does not fail the node - the chain judges the work", async () => {
  // trap-beta-T2 P3 (2026-09-21): implement reported 66/66 tests passing, a clean committed tree,
  // and stage_ok:false. Twice. Each time the gate became unreachable and the package restarted.
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    const v = await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'implement:U1:1',
      payload: { stage_ok: false, changed_files: [f], handoff: 'built it', evidence: 'e', checks: ['node --test -> 66 tests, 66 pass, 0 fail', 'git status --porcelain -> empty'] },
    });
    assert.equal(v.state, 'done', `a mis-set flag is not a failure: ${JSON.stringify(v)}`);
    assert.equal(v.self_reported_stage_ok, false, 'the self-report is kept for the gate to see');
    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['test:U1:1'], 'the chain goes on to test and gate');
  });
});

test("an author's stage_ok:false WITH a reason, or with a failing check, still fails the node", async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    const v = await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'implement:U1:1',
      payload: { stage_ok: false, changed_files: [f], evidence: 'e', reason: 'could not write the file', checks: ['ok -> looked fine'] },
    });
    assert.equal(v.state, 'failed');
  });
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    const v = await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'implement:U1:1',
      payload: { stage_ok: false, changed_files: [f], evidence: 'e', checks: ['node --test -> 3 failing'] },
    });
    assert.equal(v.state, 'failed');
  });
});

test('test verified=false fails the node and the engine reassigns the subgoal itself', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [f] }) });
    const v = await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ verified: false, checks: ['npm test -> 1 failing'] }),
    });
    assert.equal(v.stage_ok, true, 'the checks did run');
    assert.equal(v.state, 'failed', 'but the subgoal did not pass');
    assert.deepEqual(v.reassigned, { target: 'subgoal', subgoal_id: 'U1', attempt: 2 }, 'the rejection opens the next attempt by itself');
    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(nx.state, 'running', 'a rejected gate is not a dead end the caller must notice');
    const fresh = nx.ready.find((n) => n.node_id === 'implement:U1:2');
    assert.ok(fresh, 'the second attempt is ready without anyone calling team_retry');
    assert.match(readFileSync(fresh.briefing_path, 'utf8'), /npm test -> 1 failing/, 'the failing check is the feedback');
  }, { isolated: true });
});

test('auto_reassign false keeps the rejection advisory: the run blocks and waits for team_retry', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [f] }) });
    const v = await c.call('team_submit', { run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ verified: false }) });
    assert.equal(v.state, 'failed');
    assert.equal(v.reassigned, undefined);
    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(nx.state, 'blocked');
    assert.deepEqual(nx.ready, []);
  }, { isolated: true, auto_reassign: false });
});

// ---------- the same objection twice is not converging ----------
// A subgoal rejected on identical grounds twice is being asked, in the same worktree, of the
// same author, for something it cannot produce there. goal-docs is the case: a package README
// truthfully said "the repo has no other docs", false only in the combined tree, so no attempt
// inside that package could ever fix it. A third try buys the same rejection, so the engine
// escalates to setgoal+critique - the line that can change the shape rather than the work.

async function rejectU1(c, cwd, runId, attempt, reason) {
  const f = dirty(cwd);
  await c.call('team_submit', { run_id: runId, cwd, node_id: `implement:U1:${attempt}`, payload: ok({ changed_files: [f] }) });
  return c.call('team_submit', {
    run_id: runId, cwd, node_id: `test:U1:${attempt}`,
    payload: ok({ verified: false, reason, checks: [`npm test -> ${reason}`] }),
  });
}

test('two different rejections in a row keep retrying the subgoal', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const first = await rejectU1(c, cwd, runId, 1, 'the retry path is untested');
    assert.deepEqual(first.reassigned, { target: 'subgoal', subgoal_id: 'U1', attempt: 2 });
    const second = await rejectU1(c, cwd, runId, 2, 'the timeout is off by a factor of ten');
    assert.deepEqual(second.reassigned, { target: 'subgoal', subgoal_id: 'U1', attempt: 3 },
      'a new objection is movement: the subgoal is worth another attempt');
    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.ok(nx.ready.some((n) => n.node_id === 'implement:U1:3'), 'the third attempt opens where the work is');
  }, { isolated: true });
});

test('the same rejection twice reassigns the spec instead of the subgoal', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    await rejectU1(c, cwd, runId, 1, 'the package cannot see the combined tree');
    const again = await rejectU1(c, cwd, runId, 2, 'the package cannot see the combined tree');
    assert.equal(again.reassigned.target, 'spec', 'a third attempt at the same work would buy the same rejection');
    assert.equal(again.reassigned.attempt, 2, 'the second spec attempt - the subgoal attempts stop here');
    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.ok(nx.ready.some((n) => n.node_id === 'setgoal:2'), 'the graph reopens at setgoal');
    assert.equal(nx.ready.some((n) => n.node_id.startsWith('implement:U1')), false,
      'nothing reopens at the work that kept failing');
  }, { isolated: true });
});

test('what the subgoal kept failing on reaches the setgoal that replaces it', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    await rejectU1(c, cwd, runId, 1, 'the package cannot see the combined tree');
    await rejectU1(c, cwd, runId, 2, 'the package cannot see the combined tree');
    const nx = await c.call('team_next', { run_id: runId, cwd });
    const brief = readFileSync(nx.ready.find((n) => n.node_id === 'setgoal:2').briefing_path, 'utf8');
    assert.match(brief, /rejected twice for the same reason/, 'the next spec must be told the shape is what failed');
    assert.match(brief, /the package cannot see the combined tree/, 'and what it failed on');
  }, { isolated: true });
});

test('gate accept=false fails the node and holds back dependents', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [f] }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ verified: true }) });
    const v = await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'gate:U1:1', payload: ok({ accept: false, match_pct: 85, gaps: ['no runtime check'] }),
    });
    assert.equal(v.state, 'failed');
    const nx = await c.call('team_next', { run_id: runId, cwd });
    const ready = nx.ready.map((n) => n.node_id);
    assert.equal(ready.includes('implement:U2:1'), false, 'U2 must not start on a rejected U1');
  }, { isolated: true });
});

// ---------- a gate cannot accept without having checked something ----------
// Every gate in a measured run came back match_pct 92-95 - a thermometer stuck at room
// temperature. accept:true with nothing in checks[] is a guess wearing a verdict.

test('a gate that accepts with an empty checks[] fails, not the subgoal it judged', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [f] }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ verified: true }) });
    const v = await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'gate:U1:1', payload: ok({ accept: true, match_pct: 95, checks: [] }),
    });
    assert.equal(v.stage_ok, false, 'the judging itself is what failed here');
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /gate accepted without a check/);
    assert.match(v.reason, /judgement with no evidence is a guess/);
    // The gate was defective, not the work: autoReassign must not open a fresh implement
    // attempt over a subgoal nothing was actually wrong with.
    assert.equal(v.reassigned, undefined, 'the subgoal is not reassigned over a defective gate');
    const st = await c.call('team_status', { run_id: runId, cwd });
    assert.equal(st.nodes.filter((n) => n.node_id.startsWith('implement:U1')).length, 1,
      'no second implement attempt was opened');
    // The ordinary path back is team_retry - there is no way to rerun just the gate; it
    // rebuilds the whole subgoal chain, the gate included.
    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(nx.state, 'blocked', 'nothing reopens on its own');
    const rt = await c.call('team_retry', { run_id: runId, cwd, subgoal_id: 'U1' });
    assert.equal(rt.retried, true);
    assert.deepEqual(rt.ready.map((n) => n.node_id), ['implement:U1:2'], 'the whole chain is rebuilt, not the gate alone');
  }, { isolated: true });
});

test('a gate that accepts with at least one check passes', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [f] }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ verified: true }) });
    const v = await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'gate:U1:1', payload: ok({ accept: true, match_pct: 95, checks: ['read a.txt -> matches acceptance'] }),
    });
    assert.equal(v.state, 'done');
  }, { isolated: true });
});

test('a gate that rejects with no checks fails normally: a rejection needs no evidence of its own', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [f] }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ verified: true }) });
    const v = await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'gate:U1:1', payload: ok({ accept: false, match_pct: 60, gaps: ['no runtime check'], checks: [] }),
    });
    assert.equal(v.stage_ok, true, 'the judging itself worked - it is the verdict that is negative');
    assert.equal(v.state, 'failed');
    assert.doesNotMatch(v.reason || '', /judgement with no evidence/, 'a rejection is not held to the evidence rule');
    assert.deepEqual(v.reassigned, { target: 'subgoal', subgoal_id: 'U1', attempt: 2 }, 'a real rejection still reassigns');
  }, { isolated: true });
});

test('critique sound=false fails the node', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    const v = await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: false, problems: ['vague acceptance'] }),
    });
    assert.equal(v.state, 'failed');
  });
});

// A `sound: false` critique used to dead-end exactly like the goal gate still does today:
// autoReassign returned early because the node has no subgoal_id, and the run waited for a
// caller that might never call team_retry. It is now reassigned the same way a subgoal
// escalation is - a fresh setgoal+critique pair, budgeted, settled when that budget is gone.
test('critique sound=false opens a new setgoal attempt by itself, with no caller retry', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    const v = await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: false, blocking: ['acceptance is unfalsifiable'] }),
    });
    assert.equal(v.state, 'failed', 'the critique itself still failed - this is not a pass in disguise');
    assert.deepEqual(v.reassigned, { target: 'spec', attempt: 2, reason: 'the same rejection twice: reshaped rather than retried' },
      'no subgoal_id to reassign, so the spec itself reopens - nobody called team_retry');

    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(nx.state, 'running', 'a rejected critique is not a dead end the caller must notice');
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['setgoal:2']);
    assert.match(readFileSync(nx.ready[0].briefing_path, 'utf8'), /acceptance is unfalsifiable/,
      'the blocking defect is carried forward as feedback');

    // The re-authored spec is critiqued again, not waved through - retrySpec already wires
    // this for every caller of it; confirm it holds for the automatic path too.
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal:2', payload: ok({ spec: SPEC }) });
    const again = await c.call('team_next', { run_id: runId, cwd });
    assert.deepEqual(again.ready.map((n) => n.node_id), ['critique:2'], 'the new spec attempt is critiqued again');
  });
});

test('an exhausted critique retry budget settles the run and releases the report, exactly as a caller retry would', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: false, blocking: ['x'] }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal:2', payload: ok({ spec: SPEC }) });
    const v = await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique:2', payload: ok({ sound: false, blocking: ['still x'] }) });
    assert.equal(v.state, 'failed');
    assert.equal(v.reassigned.attempt, null, 'the budget is gone - no third attempt opens');
    assert.deepEqual(v.reassigned.unreachable.slice().sort(), [
      'gate:U1:2', 'gate:U2:2', 'gate:goal:2', 'implement:U1:2', 'implement:U2:2', 'reduce:2', 'test:U1:2', 'test:U2:2',
    ], 'the dead generation is settled, not left pending forever');

    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['report:2'], 'settling releases the report over the unreachable set');
  }, { max_retries: 1 });
});

// ---------- retry ----------

test('a retry retires the dead attempt, rewires dependents, and yields a ready node', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: ['ghost.js'] }),
    });
    let nx = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(nx.state, 'blocked', 'a failed implement blocks the graph');

    const r = await c.call('team_retry', { run_id: runId, cwd, subgoal_id: 'U1' });
    assert.equal(r.retried, true);
    assert.equal(r.attempt, 2);
    assert.deepEqual(r.ready.map((n) => n.node_id), ['implement:U1:2'],
      'the new attempt must be runnable, not waiting on a gate that will never come');

    const st = await c.call('team_status', { run_id: runId, cwd });
    const stale = st.nodes.filter((n) => ['test:U1:1', 'gate:U1:1'].includes(n.node_id));
    assert.ok(stale.every((n) => n.state === 'skipped'), 'the dead attempt must be retired');
    // With `reduce` between the subgoal gates and the goal gate, the live attempt is followed
    // through it: reduce carries the data edge, the goal gate keeps the gates as order-only
    // `after` so its briefing still sees the work.
    const red = st.nodes.find((n) => n.node_id === 'reduce');
    assert.ok(red.deps.includes('gate:U1:2'), 'reduce must follow the live attempt');
    assert.equal(red.deps.includes('gate:U1:1'), false);
    const goal = st.nodes.find((n) => n.node_id === 'gate:goal:1');
    assert.deepEqual(goal.deps, ['reduce'], 'the goal gate depends on the fold, not on each gate');
    assert.ok((goal.after || []).includes('gate:U1:2'), 'and still sees the live attempt');
  }, { isolated: true });
});

test('the retry budget is finite', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    for (let attempt = 1; attempt <= 2; attempt++) {
      await c.call('team_submit', {
        run_id: runId, cwd, node_id: `implement:U1:${attempt}`, payload: ok({ changed_files: ['ghost.js'] }),
      });
      const r = await c.call('team_retry', { run_id: runId, cwd, subgoal_id: 'U1' });
      assert.equal(r.retried, attempt === 1, `attempt ${attempt}`);
      if (!r.retried) assert.match(r.reason, /budget/);
    }
  }, { max_retries: 1 });
});

// ---------- settled failure: order-only edges and the unreachable set ----------
// A subgoal that ran out of retries left the run `blocked` forever: gate:goal could never
// be satisfied, the report hung behind it, and the subgoals that HAD passed were never
// reported. Failure is settled at the moment the budget is gone, everything that needed the
// dead node becomes `unreachable`, and the report - order-only on the goal gate - runs.

const INDEPENDENT = {
  goal: 'G',
  acceptance: ['A'],
  subgoals: [
    { id: 'U1', title: 'first', acceptance: ['a'], test: ['t'], deps: [] },
    { id: 'U2', title: 'second', acceptance: ['b'], test: ['t'], deps: [] },
  ],
};

async function throughCritiqueWith(c, cwd, runId, spec) {
  await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
  await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec, handoff: 's' }) });
  await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: true }) });
}

async function passSubgoal(c, cwd, runId, sg, attempt = 1) {
  const f = dirty(cwd);
  await c.call('team_submit', { run_id: runId, cwd, node_id: `implement:${sg}:${attempt}`, payload: ok({ changed_files: [f], handoff: `built ${sg}` }) });
  await c.call('team_submit', { run_id: runId, cwd, node_id: `test:${sg}:${attempt}`, payload: ok({ verified: true }) });
  await c.call('team_submit', { run_id: runId, cwd, node_id: `gate:${sg}:${attempt}`, payload: ok({ accept: true, match_pct: 95 }) });
}

// ---------- declared reducer registry / sibling write-scope check (item 1/2 of the reducer plan) ----------

const OVERLAPPING = {
  goal: 'G',
  acceptance: ['A'],
  subgoals: [
    { id: 'U1', kind: 'subgoal', title: 'owns a.txt', acceptance: ['touches only a.txt'], files: ['a.txt'], deps: [] },
    { id: 'U2', kind: 'subgoal', title: 'owns b.txt', acceptance: ['touches only b.txt'], files: ['b.txt'], deps: [] },
  ],
};

test('the deterministic write-scope check is recorded onto reduce\'s own persisted result, and reaches the goal gate\'s briefing behind it', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, OVERLAPPING);
    // U1 does what it declared (a.txt) and ALSO writes b.txt, which U2 - not U1 - declared as
    // its own. That is the undeclared-writer case computeWriteScope exists to catch: a single
    // declared owner (U2), but a sibling wrote it anyway.
    dirty(cwd, 'a.txt');
    dirty(cwd, 'b.txt');
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: ['a.txt', 'b.txt'], handoff: 'built U1' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ verified: true }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'gate:U1:1', payload: ok({ accept: true, match_pct: 95 }) });
    // U2 does exactly what it declared - the clean side of the same check.
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U2:1', payload: ok({ changed_files: ['b.txt'], handoff: 'built U2' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'test:U2:1', payload: ok({ verified: true }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'gate:U2:1', payload: ok({ accept: true, match_pct: 95 }) });

    let nx = await c.call('team_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['reduce']);
    // The `reduce` LLM pass reports the ordinary way - the deterministic check is layered on
    // top of it, not a replacement for it.
    const red = await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'reduce',
      payload: ok({ handoff: 'set folded', declared: [], undeclared: [], collisions: [], orphans: [], repairs_needed: [] }),
    });
    assert.equal(red.state, 'done');

    const st = await c.call('team_status', { run_id: runId, cwd, full: true });
    const reduceNode = st.nodes.find((n) => n.node_id === 'reduce');
    assert.ok(reduceNode.result.write_scope, 'computed and recorded onto the fold\'s own result, not only shown in a briefing');
    assert.equal(reduceNode.result.write_scope.undeclared_writers.length, 1);
    assert.equal(reduceNode.result.write_scope.undeclared_writers[0].subgoal_id, 'U1');
    assert.equal(reduceNode.result.write_scope.undeclared_writers[0].file, 'b.txt');
    assert.deepEqual(reduceNode.result.write_scope.collisions, []);

    nx = await c.call('team_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['gate:goal:1']);
    const goalBriefing = readFileSync(nx.ready[0].briefing_path, 'utf8');
    assert.match(goalBriefing, /## Sibling write-scope check \(computed, not self-reported\)/);
    assert.match(goalBriefing, /U1 wrote b\.txt, declared by U2/);
  });
});

test('exhausting a subgoal settles it: its downstream is unreachable and the report is released', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, INDEPENDENT);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: ['ghost.js'], handoff: 'claimed' }) });
    await passSubgoal(c, cwd, runId, 'U2');
    let nx = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(nx.state, 'blocked', 'with U1 failed and U2 done, nothing is runnable yet');

    const r = await c.call('team_retry', { run_id: runId, cwd, subgoal_id: 'U1' });
    assert.equal(r.retried, false);
    assert.match(r.reason, /budget/);
    assert.deepEqual(r.unreachable.sort(), ['gate:U1:1', 'gate:goal:1', 'reduce', 'test:U1:1'],
      'everything that needed the dead implement through a data edge is written off - transitively '
      + '(reduce included: it is the fold that the dead subgoal gate feeds)');
    assert.equal(r.state, 'running', 'the run is not blocked: the report can run');
    assert.deepEqual(r.ready.map((n) => n.node_id), ['report']);

    const st = await c.call('team_status', { run_id: runId, cwd });
    assert.equal(st.counts.unreachable, 4, 'test:U1:1, gate:U1:1, reduce, gate:goal:1');
    const goal = st.nodes.find((n) => n.node_id === 'gate:goal:1');
    assert.equal(goal.state, 'unreachable');
    // The goal gate now reaches the dead subgoal through reduce, so that is what its reason names.
    assert.match(goal.reason, /reduce is unreachable/);

    nx = await c.call('team_next', { run_id: runId, cwd });
    const brief = readFileSync(nx.ready.find((n) => n.stage === 'report').briefing_path, 'utf8');
    assert.match(brief, /built U2/, 'the partial success must reach the report');
    assert.match(brief, /ghost\.js/, 'and so must the failure that stopped U1');
    assert.match(brief, /gate:goal:1 \(gate\) — unreachable/);

    const v = await c.call('team_submit', { run_id: runId, cwd, node_id: 'report', payload: ok({ handoff: 'U2 shipped; U1 did not' }) });
    assert.equal(v.state, 'done');
    assert.equal((await c.call('team_status', { run_id: runId, cwd })).state, 'complete');
  }, { max_retries: 0 });
});

test('a failure with retries left does not release the report', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, INDEPENDENT);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: ['ghost.js'] }) });
    await passSubgoal(c, cwd, runId, 'U2');
    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(nx.ready.some((n) => n.stage === 'report'), false, 'a plain failed gate is a retry waiting to happen, not a settled outcome');
    const r = await c.call('team_submit', { run_id: runId, cwd, node_id: 'report', payload: ok({ handoff: 'too early' }) });
    assert.match(r.error, /blocked on gate:goal:1/);
  });
});

test('a spec-level `after` edge orders a subgoal without requiring the other to pass', async () => {
  const spec = {
    ...INDEPENDENT,
    subgoals: [
      { id: 'U1', title: 'first', acceptance: ['a'], test: ['t'], deps: [] },
      { id: 'U2', title: 'second', acceptance: ['b'], test: ['t'], deps: [], after: ['U1'] },
    ],
  };
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, spec);
    let nx = await c.call('team_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['implement:U1:1'], 'U2 waits for U1 to finish');
    const st = await c.call('team_status', { run_id: runId, cwd });
    const u2 = st.nodes.find((n) => n.node_id === 'implement:U2:1');
    assert.deepEqual(u2.after, ['gate:U1:1']);
    assert.equal(u2.deps.includes('gate:U1:1'), false, 'order-only, not a data dependency');

    await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: ['ghost.js'] }) });
    nx = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(nx.state, 'blocked', 'U1 merely failed: its gate is not settled, so U2 still waits');

    const r = await c.call('team_retry', { run_id: runId, cwd, subgoal_id: 'U1' });
    assert.equal(r.retried, false);
    assert.ok(r.ready.map((n) => n.node_id).includes('implement:U2:1'), 'once U1 is settled as failed, U2 may run');
  }, { max_retries: 0 });
});

test('an `after` naming a missing subgoal, or closing a cycle, is caught like a dep', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const v = await setgoalWith(c, cwd, runId, {
      spec: { goal: 'G', acceptance: ['A'], subgoals: [{ id: 'U1', title: 't', acceptance: ['a'], after: ['nope'] }] },
    });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /ordered after nope/);
  });
  await withRun(async ({ c, cwd, runId }) => {
    const v = await setgoalWith(c, cwd, runId, {
      spec: { goal: 'G', acceptance: ['A'], subgoals: [
        { id: 'U1', title: 't', acceptance: ['a'], after: ['U2'] },
        { id: 'U2', title: 't', acceptance: ['a'], deps: ['U1'] },
      ] },
    });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /cycle/);
  });
});

test('exhausting the spec retry settles the rebuilt graph and releases its report', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: false, problems: ['vague'] }) });
    assert.equal((await c.call('team_retry', { run_id: runId, cwd })).retried, true);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal:2', payload: ok({ spec: SPEC }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique:2', payload: ok({ sound: false, blocking: ['still vague'], problems: ['nit'] }) });

    const r = await c.call('team_retry', { run_id: runId, cwd });
    assert.equal(r.retried, false);
    assert.ok(r.unreachable.includes('implement:U1:2') && r.unreachable.includes('gate:goal:2'),
      'the graph the rejected spec produced can never run');
    assert.deepEqual(r.ready.map((n) => n.node_id), ['report:2']);
    const brief = readFileSync(r.ready[0].briefing_path, 'utf8');
    assert.match(brief, /critique:2 \(critique\) — failed .*sound=false/);
    assert.match(brief, /still vague/, 'the report must see why the spec died');
    // This test drives team_retry itself; the engine's own auto-reassign for a sound:false
    // critique (see below) would consume the same budget before the manual retry gets to.
  }, { max_retries: 1, auto_reassign: false });
});

// ---------- routing ----------

test('a named vendor fails instead of silently degrading to self', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(nx.ready[0].vendor, 'vendor-failure');
    assert.match(JSON.stringify(nx.ready[0].attempts), /unknown vendor/);
  }, { vendor: 'nosuchvendor' });
});

test('auto degrades to self when no vendor is ready', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(nx.ready[0].vendor, 'self');
    assert.ok(nx.ready[0].briefing_path, 'a self node needs a briefing on disk, not in the reply');
  }, { vendor: 'auto', candidates: ['nosuchvendor'] });
});

// AUTO_CANDIDATES used to be empty, so "auto" under ordered allocation never tried a
// builtin vendor at all - see the fixed comment in broker.mjs. It now tries claude and
// codex before giving up on the orchestrator, with the run's own host_vendor ranked last:
// a ready peer is preferred over asking the driving session to do the work itself. Both
// fakes in repoWithFakeVendor() report unavailable, so this stays deterministic and never
// touches a real CLI - only the `attempts` order is under test, not the final route.
test('auto tries the peer before the host vendor, and the host vendor before self', async () => {
  // balancedRepo() makes both builtin vendors ready by default (no unavailable-* marker) -
  // exactly what AUTO_CANDIDATES now tries under plain ordered allocation. route() returns
  // on the first usable candidate, so whichever name comes first in the order is the one
  // actually picked - an observable proxy for the order itself, without depending on
  // `attempts`, which the broker only surfaces on a vendor-failure (see route()).
  for (const [host_vendor, want] of [
    ['claude', 'codex'],   // peer tried first, ranked ahead of the host's own name
    ['codex', 'claude'],
    [undefined, 'claude'], // no host to rank last: base order stands
  ]) {
    const cwd = balancedRepo();
    const c = await new Client({ CODEX_THREAD_ID: '' }).init();
    try {
      const open = await c.call('team_open', { request: 'r', cwd, vendor: 'auto', ...(host_vendor ? { host_vendor } : {}) });
      assert.equal(open.ready[0].vendor, want, `host_vendor=${host_vendor}`);
    } finally {
      c.close();
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test('team_run refuses a self-routed node', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const r = await c.call('team_run', { run_id: runId, cwd, node_id: 'plan' });
    assert.match(r.error, /routed to self/);
  });
});

// ---------- a full pass ----------

test('a clean run reaches report', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    for (const sg of ['U1', 'U2']) {
      const f = dirty(cwd);
      await c.call('team_submit', { run_id: runId, cwd, node_id: `implement:${sg}:1`, payload: ok({ changed_files: [f], handoff: 'h' }) });
      await c.call('team_submit', { run_id: runId, cwd, node_id: `test:${sg}:1`, payload: ok({ verified: true }) });
      await c.call('team_submit', { run_id: runId, cwd, node_id: `gate:${sg}:1`, payload: ok({ accept: true, match_pct: 95 }) });
    }
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'reduce', payload: ok({ handoff: 'set folded' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'reduce', payload: ok({ changed_files: [], handoff: 'set folded' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 95 }) });
    const v = await c.call('team_submit', { run_id: runId, cwd, node_id: 'report', payload: ok({ handoff: 'done' }) });
    assert.equal(v.state, 'done');
    const st = await c.call('team_status', { run_id: runId, cwd });
    assert.equal(st.state, 'complete');
    assert.equal(st.counts.failed, 0);
  }, { isolated: true });
});

// ---------- a rejected spec ----------
// critique rejecting the spec used to dead-end the run: team_retry only knew subgoals,
// so a graph everyone agreed was wrong had nowhere to go.

test('a spec-level node is briefed with the subgoals, not just the goal', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    const nx = await c.call('team_next', { run_id: runId, cwd });
    const briefing = readFileSync(nx.ready.find((n) => n.node_id === 'critique').briefing_path, 'utf8');
    assert.match(briefing, /Subgoals in the spec/);
    assert.match(briefing, /U1 — first/);
    assert.match(briefing, /U2 — second/);
    assert.match(briefing, /Depends on: U1/);
  });
});

test('a rejected spec can be retried, discarding the graph it produced', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: false, problems: ['acceptance is unfalsifiable'] }),
    });
    let nx = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(nx.state, 'blocked');

    const r = await c.call('team_retry', { run_id: runId, cwd });
    assert.equal(r.retried, true);
    assert.equal(r.target, 'spec');
    assert.deepEqual(r.ready.map((n) => n.node_id), ['setgoal:2']);

    const st = await c.call('team_status', { run_id: runId, cwd });
    assert.equal(st.has_spec, false, 'the rejected spec must be dropped');
    const stale = st.nodes.filter((n) => n.node_id.startsWith('implement:') || n.node_id === 'gate:goal:1');
    assert.ok(stale.every((n) => n.state === 'skipped'), 'the old subgoal graph must be retired');
    // This test drives team_retry itself; auto_reassign:false keeps the sound:false
    // critique advisory so the manual retry below is the only one that fires.
  }, { auto_reassign: false });
});

test('the retried spec rebuilds the graph off the live critique', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: false, problems: ['x'] }) });
    await c.call('team_retry', { run_id: runId, cwd });

    const NEW = { goal: 'G2', acceptance: ['A2'], subgoals: [{ id: 'V1', title: 'only', acceptance: ['a'], test: ['t'], deps: [] }] };
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal:2', payload: ok({ spec: NEW }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique:2', payload: ok({ sound: true }) });

    const st = await c.call('team_status', { run_id: runId, cwd });
    assert.deepEqual(st.subgoals, ['V1']);
    const impl = st.nodes.find((n) => n.node_id === 'implement:V1:1');
    assert.ok(impl.deps.includes('critique:2'), 'must hang off the live critique, not the retired one');
    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['implement:V1:1']);
  }, { auto_reassign: false });
});

test('the spec retry budget is finite', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: false }) });
    const first = await c.call('team_retry', { run_id: runId, cwd });
    assert.equal(first.retried, true);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal:2', payload: ok({ spec: SPEC }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique:2', payload: ok({ sound: false }) });
    const second = await c.call('team_retry', { run_id: runId, cwd });
    assert.equal(second.retried, false);
    assert.match(second.reason, /budget/);
  }, { max_retries: 1, auto_reassign: false });
});

// ---------- a spec retry that reuses subgoal ids ----------
// This shipped: retrySpec retired the subgoal nodes, then expandSubgoals saw the ids
// already existed and created nothing. Nothing was pending, so the run declared itself
// COMPLETE having never run an implement node. The earlier retry test missed it only
// because its replacement spec happened to use different ids.

test('a retried spec with the SAME subgoal ids rebuilds real nodes', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: false, blocking: ['x'] }) });
    await c.call('team_retry', { run_id: runId, cwd });

    // the same ids, deliberately
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal:2', payload: ok({ spec: SPEC }) });
    const v = await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique:2', payload: ok({ sound: true }) });
    assert.equal(v.state, 'done');

    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(nx.state, 'running', 'a rebuilt graph is not a finished one');
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['implement:U1:2'],
      'the second expansion must create fresh nodes, not collide with the retired ones');

    const st = await c.call('team_status', { run_id: runId, cwd });
    const live = st.nodes.filter((n) => n.node_id.startsWith('implement:U1:'));
    assert.equal(live.length, 2, 'the retired node stays as evidence alongside the new one');
  }, { auto_reassign: false });
});

test('a run is complete only when a report node is done', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: false }) });
    await c.call('team_retry', { run_id: runId, cwd });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal:2', payload: ok({ spec: SPEC }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique:2', payload: ok({ sound: true }) });
    const st = await c.call('team_status', { run_id: runId, cwd });
    assert.notEqual(st.state, 'complete', 'no implement node has run; this is not complete');
  }, { auto_reassign: false });
});

// ---------- the report must be able to see the run ----------

test('report and the goal gate are briefed with every finished node', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    for (const sg of ['U1', 'U2']) {
      const f = dirty(cwd);
      await c.call('team_submit', {
        run_id: runId, cwd, node_id: `implement:${sg}:1`,
        payload: ok({ changed_files: [f], handoff: `built ${sg}`, checks: [`ran ${sg}`] }),
      });
      await c.call('team_submit', { run_id: runId, cwd, node_id: `test:${sg}:1`, payload: ok({ verified: true, checks: [`checked ${sg}`] }) });
      await c.call('team_submit', { run_id: runId, cwd, node_id: `gate:${sg}:1`, payload: ok({ accept: true, match_pct: 95 }) });
    }
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'reduce', payload: ok({ handoff: 'set folded' }) });
    let nx = await c.call('team_next', { run_id: runId, cwd });
    const goalGate = nx.ready.find((n) => n.node_id.startsWith('gate:goal'));
    const gateBrief = readFileSync(goalGate.briefing_path, 'utf8');
    assert.match(gateBrief, /Every node in this run/);
    assert.match(gateBrief, /built U1/, 'the goal gate must see the actual work, not just subgoal gates');

    await c.call('team_submit', { run_id: runId, cwd, node_id: goalGate.node_id, payload: ok({ accept: true, match_pct: 93 }) });
    nx = await c.call('team_next', { run_id: runId, cwd });
    const brief = readFileSync(nx.ready.find((n) => n.stage === 'report').briefing_path, 'utf8');
    for (const fact of ['built U1', 'built U2', 'checked U1', 'implement:U1:1']) {
      assert.ok(brief.includes(fact), `report briefing is missing ${fact}`);
    }
  }, { isolated: true });
});

test('the report briefing carries failures, not just successes', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: ['ghost.js'], handoff: 'claimed' }),
    });
    await c.call('team_retry', { run_id: runId, cwd, subgoal_id: 'U1' });
    for (const sg of [['U1', 2], ['U2', 1]]) {
      const f = dirty(cwd);
      await c.call('team_submit', { run_id: runId, cwd, node_id: `implement:${sg[0]}:${sg[1]}`, payload: ok({ changed_files: [f], handoff: `built ${sg[0]}` }) });
      await c.call('team_submit', { run_id: runId, cwd, node_id: `test:${sg[0]}:${sg[1]}`, payload: ok({ verified: true }) });
      await c.call('team_submit', { run_id: runId, cwd, node_id: `gate:${sg[0]}:${sg[1]}`, payload: ok({ accept: true, match_pct: 90 }) });
    }
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'reduce', payload: ok({ handoff: 'set folded' }) });
    const nx = await c.call('team_next', { run_id: runId, cwd });
    const goalGate = nx.ready.find((n) => n.node_id.startsWith('gate:goal'));
    const brief = readFileSync(goalGate.briefing_path, 'utf8');
    assert.match(brief, /implement:U1:1 \(implement\) — failed/);
    assert.match(brief, /ghost\.js/, '"what was not done and why" needs the failed claim');
  }, { isolated: true });
});

// ---------- an unusable spec ----------
// A malformed spec never failed at setgoal; it failed much later as a deadlock, or - worse
// - as a run that finished having built nothing. Each case below was reachable.

async function setgoalWith(c, cwd, runId, payload) {
  await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
  return c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok(payload) });
}

test('setgoal that returns no spec fails instead of quietly leaving a three-node graph', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const v = await setgoalWith(c, cwd, runId, { handoff: 'forgot the spec' });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /unusable spec/);
    const st = await c.call('team_status', { run_id: runId, cwd });
    assert.equal(st.has_spec, false);
    assert.notEqual(st.state, 'complete');
  });
});

test('a spec with no subgoals fails rather than making the goal gate immediately ready', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const v = await setgoalWith(c, cwd, runId, { spec: { goal: 'G', acceptance: ['A'], subgoals: [] } });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /no subgoals/);
    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(nx.ready.some((n) => n.node_id.startsWith('gate:goal')), false);
  });
});

test('a dep on a subgoal that does not exist is caught, not left to deadlock', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const v = await setgoalWith(c, cwd, runId, {
      spec: { goal: 'G', acceptance: ['A'], subgoals: [{ id: 'U1', title: 't', acceptance: ['a'], deps: ['GHOST'] }] },
    });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /GHOST, which is not in the spec/);
  });
});

test('a dependency cycle is caught', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const v = await setgoalWith(c, cwd, runId, {
      spec: {
        goal: 'G', acceptance: ['A'],
        subgoals: [
          { id: 'U1', title: 't', acceptance: ['a'], deps: ['U2'] },
          { id: 'U2', title: 't', acceptance: ['a'], deps: ['U1'] },
        ],
      },
    });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /cycle/);
  });
});

test('a subgoal with an unknown kind is caught at setgoal, not left to expand into nothing', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const v = await setgoalWith(c, cwd, runId, {
      spec: { goal: 'G', acceptance: ['A'], subgoals: [{ id: 'U1', title: 't', acceptance: ['a'], kind: 'sculpture' }] },
    });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /unknown kind sculpture/);
  });
});

test('a rejected goal gate is re-judged after the subgoal retry, instead of wedging the run', async () => {
  // auto_reassign:false: this test drives the manual team_retry({subgoal_id}) path on
  // purpose. With it on, a rejected goal-gate round now opens a repair pass itself
  // (Step 9) - covered by test-goalgate.mjs - before the caller ever gets a turn.
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, INDEPENDENT);
    await passSubgoal(c, cwd, runId, 'U1');
    await passSubgoal(c, cwd, runId, 'U2');
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'reduce', payload: ok({ changed_files: [], handoff: 'set folded' }) });
    const g = await c.call('team_submit', { run_id: runId, cwd, node_id: 'gate:goal:1', payload: ok({ accept: false, match_pct: 50, gaps: ['U2 never wired to U1'], reason: 'halves do not meet' }) });
    assert.equal(g.state, 'failed');
    let nx = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(nx.state, 'blocked', 'a rejection with retries left holds the report');
    const rt = await c.call('team_retry', { run_id: runId, cwd, subgoal_id: 'U2' });
    assert.equal(rt.retried, true);
    const prompt = readFileSync(rt.ready.find((n) => n.node_id === 'implement:U2:2').briefing_path, 'utf8');
    assert.match(prompt, /goal gate gate:goal:1: halves do not meet/, 'the retried subgoal hears why the whole was rejected');
    assert.match(prompt, /U2 never wired to U1/);
    await passSubgoal(c, cwd, runId, 'U2', 2);
    nx = await c.call('team_next', { run_id: runId, cwd });
    // reduce folds the rebuilt set first; the fresh goal gate is behind it.
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['reduce'], 'the fold runs first over the rebuilt whole');
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'reduce', payload: ok({ handoff: 'set folded' }) });
    nx = await c.call('team_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['gate:goal:2'], 'a fresh goal gate judges the rebuilt whole');
    const st = await c.call('team_status', { run_id: runId, cwd });
    assert.equal(st.nodes.find((n) => n.node_id === 'gate:goal:1').state, 'failed', 'the rejection stays as evidence');
    const g2 = st.nodes.find((n) => n.node_id === 'gate:goal:2');
    assert.deepEqual(g2.deps, ['reduce'], 'the fresh round judges behind the same fold');
    assert.deepEqual((g2.after || []).slice().sort(), ['gate:U1:1', 'gate:U2:2'], 'and still sees both live attempts');
    assert.deepEqual(st.nodes.find((n) => n.node_id === 'report').after, ['gate:goal:2']);
    const gatePrompt = readFileSync(nx.ready[0].briefing_path, 'utf8');
    assert.match(gatePrompt, /Previous attempt was rejected[\s\S]*U2 never wired to U1/);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'gate:goal:2', payload: ok({ accept: true, match_pct: 90 }) });
    nx = await c.call('team_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['report']);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'report', payload: ok({ handoff: 'done' }) });
    assert.equal((await c.call('team_status', { run_id: runId, cwd })).state, 'complete');
  }, { auto_reassign: false });
});

// ---------- document kind ----------

const MIXED = {
  goal: 'G',
  acceptance: ['A'],
  subgoals: [
    { id: 'U1', title: 'code', acceptance: ['a'], test: ['t'], deps: [] },
    { id: 'U2', title: 'more code', acceptance: ['b'], test: ['t'], deps: ['U1'] },
    { id: 'D1', kind: 'document', title: 'design note', acceptance: ['names the two modules', 'states the invariant'], files: ['doc.md'], deps: ['U1'] },
  ],
};

test('a mixed spec expands each subgoal by its kind and reaches the report', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, MIXED);
    const st = await c.call('team_status', { run_id: runId, cwd });
    const ids = st.nodes.map((n) => n.node_id);
    assert.ok(ids.includes('implement:U1:1') && ids.includes('test:U1:1') && ids.includes('gate:U1:1'));
    assert.ok(ids.includes('draft:D1:1') && ids.includes('review:D1:1') && ids.includes('gate:D1:1'));
    assert.ok(!ids.includes('implement:D1:1') && !ids.includes('test:D1:1'), 'a document has no implement/test');
    const draft = st.nodes.find((n) => n.node_id === 'draft:D1:1');
    assert.deepEqual(draft.deps, ['critique', 'gate:U1:1'], 'the chain head carries the subgoal deps');
    assert.deepEqual(st.nodes.find((n) => n.node_id === 'review:D1:1').deps, ['draft:D1:1']);
    // Collected through reduce now: the fold carries the data edge, the goal gate keeps every
    // subgoal gate as an order-only edge so its briefing still sees each one's work.
    const gg = st.nodes.find((n) => n.node_id === 'gate:goal:1');
    assert.deepEqual(gg.deps, ['reduce'], 'the goal gate depends on the fold');
    assert.ok((gg.after || []).includes('gate:D1:1'), 'and still collects the document gate');
    assert.ok(st.nodes.find((n) => n.node_id === 'reduce').deps.includes('gate:D1:1'), 'the fold collects it by data edge');

    await passSubgoal(c, cwd, runId, 'U1');
    await passSubgoal(c, cwd, runId, 'U2');
    writeFileSync(join(cwd, 'doc.md'), '# note\nmodules: a, b\ninvariant: x\n');
    const d = await c.call('team_submit', { run_id: runId, cwd, node_id: 'draft:D1:1', payload: ok({ changed_files: ['doc.md'], handoff: 'doc.md — a note' }) });
    assert.equal(d.state, 'done', JSON.stringify(d));
    const r = await c.call('team_submit', { run_id: runId, cwd, node_id: 'review:D1:1', payload: ok({ verified: true, checks: ['names the two modules -> "modules: a, b"'] }) });
    assert.equal(r.state, 'done');
    assert.equal(r.verified, true);
    assert.equal(r.reviewer_independence, 'unverifiable-self', 'self cannot be checked, and the verdict says so');
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'gate:D1:1', payload: ok({ accept: true, match_pct: 90 }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'reduce', payload: ok({ changed_files: [], handoff: 'set folded' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 90 }) });
    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['report']);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'report', payload: ok({ handoff: 'done' }) });
    assert.equal((await c.call('team_status', { run_id: runId, cwd })).state, 'complete');
  });
});

// ---------- planning and qa kinds ----------

const PLANNING_QA_MIX = {
  goal: 'G',
  acceptance: ['A'],
  subgoals: [
    { id: 'P1', kind: 'planning', title: 'PRD for priority mode', acceptance: ['names the problem', 'states the target user'], files: ['.teams_output/team/E-deadbeef/10-prd.md'], deps: [] },
    { id: 'Q1', kind: 'qa', title: 'QA the priority mode', acceptance: ['covers ordering under load'], files: ['test/qa/priority.md'], deps: ['P1'] },
  ],
};

// --- ask: the decision a person makes, as a node (D2 step 2) ---

const PLANNING_ONLY = {
  goal: 'a PRD for the reservation system',
  acceptance: ['names the per-person limit'],
  subgoals: [{ id: 'P1', kind: 'planning', title: 'PRD', acceptance: ['names the per-person limit'], files: ['.teams_output/team/E-deadbeef/10-prd.md'], deps: [] }],
};

const OPTIONED = [{
  question: 'How many tickets may one account hold?',
  owner: 'Product/policy',
  options: [{ option: '2 across presale and general combined', consequence: 'scalpers buy two accounts' }, { option: '2 per phase' }],
}];

test('an interactive run stops at the decision its investigation could not settle', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, PLANNING_ONLY);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'investigate:P1:1',
      payload: ok({ changed_files: [], handoff: 'findings.md', findings: [], unknowns: OPTIONED }) });
    const st = await c.call('team_status', { run_id: runId, cwd });
    const ask = st.nodes.find((n) => n.node_id === 'ask:P1:1');
    assert.ok(ask, 'the card exists: ' + st.nodes.map((n) => n.node_id).join(','));
    assert.deepEqual(st.nodes.find((n) => n.node_id === 'draft:P1:1').deps, ['ask:P1:1']);
    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(nx.state, 'waiting_human', JSON.stringify(nx));
    assert.equal((nx.ready || []).length, 0, 'nothing is handed to a model while a person owes an answer');
  }, { interactive: true });
});

test('a run nobody is watching decides by default, and records what it would have asked', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, PLANNING_ONLY);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'investigate:P1:1',
      payload: ok({ changed_files: [], handoff: 'findings.md', findings: [], unknowns: OPTIONED }) });
    const st = await c.call('team_status', { run_id: runId, cwd });
    assert.equal(st.nodes.some((n) => n.stage === 'ask'), false, 'default is off');
    assert.deepEqual(st.nodes.find((n) => n.node_id === 'draft:P1:1').deps, ['investigate:P1:1']);
    // The question is not lost, which is the whole difference from before this existed.
    const run = JSON.parse(readFileSync(join(cwd, '.teams_output', 'broker', 'runs', `${runId}.json`), 'utf8'));
    assert.equal(run.unasked.length, 1);
    assert.equal(run.unasked[0].owner, 'Product/policy');
    assert.equal(run.unasked[0].subgoal_id, 'P1');
  });
});

test('a mixed spec expands a planning subgoal into investigate->draft->revise->gate and a qa subgoal into cases->execute->gate', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, PLANNING_QA_MIX);
    const st = await c.call('team_status', { run_id: runId, cwd });
    const ids = st.nodes.map((n) => n.node_id);
    assert.ok(ids.includes('investigate:P1:1') && ids.includes('draft:P1:1') && ids.includes('revise:P1:1') && ids.includes('gate:P1:1'));
    assert.ok(ids.includes('cases:Q1:1') && ids.includes('execute:Q1:1') && ids.includes('gate:Q1:1'));
    assert.ok(!ids.includes('implement:P1:1') && !ids.includes('test:P1:1'), 'planning has no implement/test');
    assert.ok(!ids.includes('implement:Q1:1') && !ids.includes('test:Q1:1'), 'qa has no implement/test either - execute is the test');
    assert.deepEqual(st.nodes.find((n) => n.node_id === 'cases:Q1:1').deps, ['critique', 'gate:P1:1'], "qa's own deps[] on the planning subgoal carries through");

    const f = dirty(cwd);
    const inv = await c.call('team_submit', { run_id: runId, cwd, node_id: 'investigate:P1:1', payload: ok({ changed_files: [], handoff: 'findings.md', findings: [], unknowns: ['the per-person limit -> product owner'] }) });
    assert.equal(inv.state, 'done', JSON.stringify(inv));
    const d = await c.call('team_submit', { run_id: runId, cwd, node_id: 'draft:P1:1', payload: ok({ changed_files: [f], handoff: 'PRD drafted' }) });
    assert.equal(d.state, 'done', JSON.stringify(d));
    const rv = await c.call('team_submit', { run_id: runId, cwd, node_id: 'revise:P1:1', payload: ok({ changed_files: [], handoff: 'revised for the reader' }) });
    assert.equal(rv.state, 'done', JSON.stringify(rv));
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'gate:P1:1', payload: ok({ accept: true, match_pct: 95 }) });

    const g = dirty(cwd, 'b.txt');
    const cs = await c.call('team_submit', { run_id: runId, cwd, node_id: 'cases:Q1:1', payload: ok({ changed_files: [g], handoff: 'case set written' }) });
    assert.equal(cs.state, 'done', JSON.stringify(cs));
    const ex = await c.call('team_submit', { run_id: runId, cwd, node_id: 'execute:Q1:1', payload: ok({ verified: true }) });
    assert.equal(ex.state, 'done', JSON.stringify(ex));
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'gate:Q1:1', payload: ok({ accept: true, match_pct: 95 }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'reduce', payload: ok({ changed_files: [], handoff: 'set folded' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 95 }) });
    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['report']);
  });
});

// awake-beta-ref1 (2026-09-24): verified:false with stage_ok:true meant "the case set ran and
// found a real defect" (prompts.mjs's execute contract says so plainly), but nodeSucceeded
// treated it exactly like a failed `test` node and reassigned the subgoal - retrying `cases`
// and `execute` against the SAME unchanged tree for a bug neither of them could fix (there is
// no implement stage in this chain). Three identical retries later the subgoal's budget was
// spent, `gate`/`reduce` were unreachable, and the child run ended blocked with its defects
// nowhere to go. This replaces that test: execute finding a defect is now a successful
// execution, not a failure to retry.
test('a qa execute that ran and found a real defect (verified:false, stage_ok:true) succeeds - it is not reassigned, and its defects carry into the subgoal gate briefing', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, {
      goal: 'G', acceptance: ['A'],
      subgoals: [{ id: 'Q1', kind: 'qa', title: 'qa pass', acceptance: ['a'], deps: [] }],
    });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'cases:Q1:1', payload: ok({ changed_files: [], handoff: 'cases v1' }) });
    const rv = await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'execute:Q1:1',
      payload: ok({ verified: false, defects: ['double-processed a retried job -> reproduce with 2 workers and a forced retry'] }),
    });
    assert.equal(rv.state, 'done', JSON.stringify(rv));
    assert.equal(rv.reassigned, undefined, 'stage_ok:true means the run succeeded even though verified is false');
    const ids = (await c.call('team_status', { run_id: runId, cwd })).nodes.map((n) => n.node_id);
    assert.ok(!ids.includes('cases:Q1:2') && !ids.includes('execute:Q1:2'), 'no retry was opened - there is nothing a second cases/execute pair would change');

    const nx = await c.call('team_next', { run_id: runId, cwd });
    const gateReady = nx.ready.find((n) => n.node_id === 'gate:Q1:1');
    assert.ok(gateReady, `gate:Q1:1 must be reachable, not blocked behind a phantom retry: ${JSON.stringify(nx)}`);
    const gateBrief = readFileSync(gateReady.briefing_path, 'utf8');
    assert.match(gateBrief, /Defects it reported:\n- double-processed a retried job -> reproduce with 2 workers and a forced retry/,
      "the subgoal gate must see execute's defects directly, not just its checks[] pass/fail summary");
  });
});

test('a qa execute that could NOT run at all (stage_ok:false) still fails, and is still retryable - only a genuine execution failure needs one', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, {
      goal: 'G', acceptance: ['A'],
      subgoals: [{ id: 'Q1', kind: 'qa', title: 'qa pass', acceptance: ['a'], deps: [] }],
    });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'cases:Q1:1', payload: ok({ changed_files: [], handoff: 'cases v1' }) });
    const rv = await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'execute:Q1:1',
      payload: ok({ stage_ok: false, verified: false, reason: 'sandbox denied network access; the case set could not be run at all' }),
    });
    assert.equal(rv.state, 'failed', JSON.stringify(rv));
    // stage_ok:false is not a rejected verdict - it is "the work did not run" - and
    // autoReassign's own rule (broker.mjs: "Only the verdict reassigns... a different failure
    // and keeps its existing path") deliberately does not auto-open a fresh attempt for it,
    // exactly as it does not for a stage_ok:false implement or test. What this test protects
    // is narrower and just as real: unlike a verified:false execute (now a success, see the
    // test above), this failure is still retryable at all - team_retry still rebuilds the
    // chain for it, the same way it would for any other genuine execution failure.
    assert.equal(rv.reassigned, undefined, 'a could-not-run failure is not auto-reassigned - same rule as implement/test');
    const retried = await c.call('team_retry', { run_id: runId, cwd, subgoal_id: 'Q1' });
    assert.equal(retried.retried, true, JSON.stringify(retried));
    const ids = (await c.call('team_status', { run_id: runId, cwd })).nodes.map((n) => n.node_id);
    assert.ok(ids.includes('cases:Q1:2') && ids.includes('execute:Q1:2'), 'a genuine "could not run" failure can still be retried');
  });
});

test('a document draft that changed no file is unattributed, not contradicted; a code implement still is', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, {
      goal: 'G', acceptance: ['A'],
      subgoals: [
        { id: 'D1', kind: 'document', title: 'inline answer', acceptance: ['a'], deps: [] },
        { id: 'U1', title: 'code', acceptance: ['a'], test: ['t'], deps: [] },
      ],
    });
    const d = await c.call('team_submit', { run_id: runId, cwd, node_id: 'draft:D1:1', payload: ok({ changed_files: [], handoff: 'the whole note is here in the handoff' }) });
    assert.equal(d.state, 'done', JSON.stringify(d));
    assert.equal(d.stage_ok, true);
    assert.equal(d.changed_files_verified, null);
    assert.equal(d.change_attribution, 'document-unchanged');
    // The same empty claim from a code node is untouched behaviour: under isolation it
    // still verifies, because for code "nothing changed" is a claim git can confirm.
    const i = await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [], handoff: 'h' }) });
    assert.equal(i.change_attribution, 'isolated');
    assert.equal(i.changed_files_verified, true);
  }, { isolated: true });
});

test('a review without a verdict fails, and a review is briefed as a reasoning node', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, {
      goal: 'G', acceptance: ['A'],
      subgoals: [{ id: 'D1', kind: 'document', title: 'note', acceptance: ['a'], files: ['doc.md'], deps: [] }],
    });
    let nx = await c.call('team_next', { run_id: runId, cwd });
    const draftPrompt = readFileSync(nx.ready.find((n) => n.node_id === 'draft:D1:1').briefing_path, 'utf8');
    assert.match(draftPrompt, /Kind: document/);
    assert.match(draftPrompt, /one-paragraph abstract/);
    assert.doesNotMatch(draftPrompt, /This is a reasoning node/, 'a draft writes the artifact');
    writeFileSync(join(cwd, 'doc.md'), 'x\n');
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'draft:D1:1', payload: ok({ changed_files: ['doc.md'], handoff: 'doc.md' }) });
    nx = await c.call('team_next', { run_id: runId, cwd });
    const reviewPrompt = readFileSync(nx.ready.find((n) => n.node_id === 'review:D1:1').briefing_path, 'utf8');
    assert.match(reviewPrompt, /This is a reasoning node/);
    assert.match(reviewPrompt, /You are the reader, not the author/);
    assert.match(reviewPrompt, /doc\.md/, 'the review sees the paths the draft reported');
    const r = await c.call('team_submit', { run_id: runId, cwd, node_id: 'review:D1:1', payload: ok({ checks: ['read it'] }) });
    assert.equal(r.state, 'failed');
    assert.equal(r.missing_verdict, 'verified');
  });
});

test('a rejected document gets a fresh draft, and the goal gate waits for the new review chain', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, {
      goal: 'G', acceptance: ['A'],
      subgoals: [{ id: 'D1', kind: 'document', title: 'note', acceptance: ['a'], deps: [] }],
    });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'draft:D1:1', payload: ok({ changed_files: [], handoff: 'v1' }) });
    const rv = await c.call('team_submit', { run_id: runId, cwd, node_id: 'review:D1:1', payload: ok({ verified: false, checks: ['a -> MISSING: the invariant'] }) });
    // The engine reassigns on the rejection; team_retry is no longer the way here, and
    // calling it anyway would spend a second attempt on the same rejection.
    assert.deepEqual(rv.reassigned, { target: 'subgoal', subgoal_id: 'D1', attempt: 2 });
    const st = await c.call('team_status', { run_id: runId, cwd });
    const ids = st.nodes.map((n) => n.node_id);
    assert.ok(ids.includes('draft:D1:2') && ids.includes('review:D1:2') && ids.includes('gate:D1:2'));
    assert.equal(st.nodes.find((n) => n.node_id === 'gate:D1:1').state, 'skipped');
    assert.deepEqual(st.nodes.find((n) => n.node_id === 'gate:goal:1').deps, ['gate:D1:2']);
    const nx = await c.call('team_next', { run_id: runId, cwd });
    const prompt = readFileSync(nx.ready.find((n) => n.node_id === 'draft:D1:2').briefing_path, 'utf8');
    assert.match(prompt, /Previous attempt was rejected/, 'the review\'s gaps reach the second draft');
  });
});

// ---------- flow ----------

test('flow document with mixed=false rejects a spec that carries a code subgoal', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    // U1 says it is code; U2 says nothing and so follows the flow; D1 is a document.
    const v = await setgoalWith(c, cwd, runId, { spec: { ...MIXED, subgoals: [
      { ...MIXED.subgoals[0], kind: 'subgoal' }, MIXED.subgoals[1], MIXED.subgoals[2],
    ] } });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /subgoal U1 has kind subgoal, but this run is flow document with mixed=false/);
    assert.doesNotMatch(v.reason, /subgoal U2/, 'an unnamed kind takes the flow and is not a violation');
    assert.doesNotMatch(v.reason, /subgoal D1/);
  }, { flow: 'document', mixed: false });
});

test('a fixed flow supplies the kind a subgoal did not name, and the entry choice is visible', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const open = await c.call('team_status', { run_id: runId, cwd });
    assert.equal(open.flow, 'document');
    assert.equal(open.mixed, true);
    let nx = await c.call('team_next', { run_id: runId, cwd });
    assert.match(readFileSync(nx.ready[0].briefing_path, 'utf8'), /## Flow\ndocument \(fixed by the entry\) — default kind for a subgoal that names none: document/);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    nx = await c.call('team_next', { run_id: runId, cwd });
    assert.match(readFileSync(nx.ready[0].briefing_path, 'utf8'), /Personas to draw from:\n- technical writer/);
    // SPEC names no kinds: under the document flow it is two documents, plus one code subgoal by name.
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: {
      ...SPEC, subgoals: [...SPEC.subgoals, { id: 'U3', kind: 'subgoal', title: 'code', acceptance: ['c'], test: ['t'], deps: [] }],
    } }) });
    const ids = (await c.call('team_status', { run_id: runId, cwd })).nodes.map((n) => n.node_id);
    assert.ok(ids.includes('draft:U1:1') && ids.includes('review:U2:1'), 'unnamed kinds follow the flow');
    assert.ok(ids.includes('implement:U3:1'), 'a named kind still wins under mixed=true');
    assert.ok(!ids.includes('implement:U1:1'));
  }, { flow: 'document' });
});

test('under auto, plan chooses the flow and measures the size; a plan that says nothing defaults to develop', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    let nx = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(nx.flow, 'auto');
    assert.equal(nx.size, undefined);
    assert.match(readFileSync(nx.ready[0].briefing_path, 'utf8'), /## Flow\nauto — plan decides/);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p', flow: 'document', size: 'S', sizing: ['ls docs -> 3 files'] }) });
    nx = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(nx.flow, 'document');
    assert.equal(nx.size, 'S');
    assert.match(readFileSync(nx.ready[0].briefing_path, 'utf8'), /document \(chosen by plan\)/);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    const st = await c.call('team_status', { run_id: runId, cwd });
    assert.equal(st.flow, 'document');
    assert.ok(st.nodes.some((n) => n.node_id === 'draft:U1:1'), 'the chosen flow supplies the default kind');
    const full = await c.call('team_status', { run_id: runId, cwd, full: true });
    assert.equal(full.flow_source, 'plan');
  });
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(nx.flow, 'develop');
    const full = await c.call('team_status', { run_id: runId, cwd, full: true });
    assert.equal(full.flow_source, 'default', 'a defaulted choice is recorded as such, not passed off as a decision');
  });
});

// A vendor that writes a document when asked to draft and answers as a reader when asked to
// review. Both run under one vendor name so the broker sees identical identities.
function documentRepo() {
  const dir = repo();
  const adapter = join(dir, 'ink-adapter.mjs');
  writeFileSync(adapter, `
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
const a = process.argv.slice(2), get = k => a[a.indexOf(k) + 1];
const out = get('--output'); mkdirSync(dirname(out), { recursive: true });
if (a.includes('--detect')) { writeFileSync(out, JSON.stringify({ vendor: { ready: true, reachable: true } })); process.exit(0); }
const stage = readFileSync(get('--prompt-file'), 'utf8').match(/^# (\\w+) node/)[1];
const result = { stage_ok: true, handoff: 'read', evidence: 'e', checks: ['c'], verified: true };
if (stage === 'draft') { writeFileSync(join(get('--cwd'), 'doc.md'), 'the note\\n'); result.changed_files = ['doc.md']; result.handoff = 'doc.md — the note'; }
writeFileSync(out, JSON.stringify({ stage_ok: true, result }));
`);
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'broker-vendors.json'), JSON.stringify({
    ink: { command: 'node', args: [adapter], requires_binary: null, sandboxes: ['read-only', 'workspace-write'], default_sandbox: 'workspace-write' },
  }));
  return dir;
}

test('a review routed to the identity that wrote the draft is refused, and the node stays open for rerouting', async () => {
  const cwd = documentRepo();
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('team_open', {
      request: 'r', cwd, vendor: 'self',
      policy: { draft: { vendor: 'ink', model: 'm1' }, review: { vendor: 'ink', model: 'm1' } },
    });
    await throughCritiqueWith(c, cwd, run_id, {
      goal: 'G', acceptance: ['A'],
      subgoals: [{ id: 'D1', kind: 'document', title: 'note', acceptance: ['a'], files: ['doc.md'], deps: [] }],
    });
    const d = await c.call('team_run', { run_id, cwd, node_id: 'draft:D1:1' });
    assert.equal(d.state, 'done', JSON.stringify(d));
    assert.equal(d.executor, 'ink');
    assert.equal(d.model, 'm1');

    const refused = await c.call('team_run', { run_id, cwd, node_id: 'review:D1:1' });
    assert.match(refused.error, /someone other than its author/);
    assert.match(refused.error, /ink@m1/);
    const st = await c.call('team_status', { run_id, cwd, node_id: 'review:D1:1' });
    assert.equal(st.nodes[0].state, 'pending', 'a routing mistake costs no retry');

    // Same vendor, different model is a different identity.
    const r = await c.call('team_run', { run_id, cwd, node_id: 'review:D1:1', model: 'm2' });
    assert.equal(r.state, 'done', JSON.stringify(r));
    assert.equal(r.verified, true);
    assert.equal(r.reviewer_independence, 'distinct-identity');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

async function balancedThroughCritique(c, cwd, runId, spec) {
  await c.call('team_next', { run_id: runId, cwd });
  let v = await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
  await c.call('team_next', { run_id: runId, cwd });
  v = await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec, handoff: 's' }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
  await c.call('team_next', { run_id: runId, cwd });
  v = await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: true }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
}

// The deadlock the second real-vendor bench run died in (2026-09-17). With no peer vendor
// installed, draft degrades to the host and review lands on the same host model, so the
// identity guard refused the submit - while team_run refused the same node for being routed to
// self, and team_next kept offering it. Three driver sessions in a row correctly gave up; the
// run sat at 16/20 with every artifact already written. Independence is now taken on the model
// axis when one is available, and recorded as absent when it is not - never a dead run.
test('with a second native model, the review of a host-written draft is routed to the other model', async () => {
  const cwd = documentRepo();
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('team_open', {
      request: 'r', cwd, vendor: 'auto', allocation: 'balanced',
      host_vendor: 'claude', host_model: 'claude-sonnet-5',
      native_models: ['claude-sonnet-5', 'claude-opus-5'],
    });
    // A balanced run refuses a submit on a node team_next has not assigned yet, so each of
    // plan/setgoal/critique is assigned before it is answered.
    await balancedThroughCritique(c, cwd, run_id, {
      goal: 'G', acceptance: ['A'],
      subgoals: [{ id: 'D1', kind: 'document', title: 'note', acceptance: ['a'], files: ['doc.md'], deps: [] }],
    });
    await c.call('team_next', { run_id, cwd });
    writeFileSync(join(cwd, 'doc.md'), 'the note\n');
    await c.call('team_submit', { run_id, cwd, node_id: 'draft:D1:1', payload: ok({ changed_files: ['doc.md'], handoff: 'wrote it' }) });

    const nx = await c.call('team_next', { run_id, cwd });
    const review = nx.ready.find((r) => r.node_id === 'review:D1:1');
    assert.ok(review, JSON.stringify(nx.ready));
    assert.equal(review.model, 'claude-opus-5', `the reviewer must not be the model that drafted: ${JSON.stringify(review)}`);
    assert.match(review.routing_reason, /wrote the draft, reviewing with claude-opus-5 instead/);

    const r = await c.call('team_submit', { run_id, cwd, node_id: 'review:D1:1', payload: ok({ verified: true }) });
    assert.equal(r.state, 'done', JSON.stringify(r));
    assert.equal(r.reviewer_independence, 'distinct-identity');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('with only one native model the review still runs, and says plainly that it was not independent', async () => {
  const cwd = documentRepo();
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('team_open', {
      request: 'r', cwd, vendor: 'auto', allocation: 'balanced',
      host_vendor: 'claude', host_model: 'claude-sonnet-5', native_models: ['claude-sonnet-5'],
    });
    // A balanced run refuses a submit on a node team_next has not assigned yet, so each of
    // plan/setgoal/critique is assigned before it is answered.
    await balancedThroughCritique(c, cwd, run_id, {
      goal: 'G', acceptance: ['A'],
      subgoals: [{ id: 'D1', kind: 'document', title: 'note', acceptance: ['a'], files: ['doc.md'], deps: [] }],
    });
    await c.call('team_next', { run_id, cwd });
    writeFileSync(join(cwd, 'doc.md'), 'the note\n');
    await c.call('team_submit', { run_id, cwd, node_id: 'draft:D1:1', payload: ok({ changed_files: ['doc.md'], handoff: 'wrote it' }) });

    const nx = await c.call('team_next', { run_id, cwd });
    const review = nx.ready.find((r) => r.node_id === 'review:D1:1');
    assert.match(review.routing_reason, /declared no second native model, so this review is not independent/);

    const r = await c.call('team_submit', { run_id, cwd, node_id: 'review:D1:1', payload: ok({ verified: true }) });
    assert.equal(r.state, 'done', `this is the node the bench run deadlocked on: ${JSON.stringify(r)}`);
    assert.equal(r.reviewer_independence, 'unverifiable-same-host');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a revise routed to the identity that drafted is refused, the same way review is', async () => {
  const cwd = documentRepo();
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('team_open', {
      request: 'r', cwd, vendor: 'self',
      policy: { draft: { vendor: 'ink', model: 'm1' }, revise: { vendor: 'ink', model: 'm1' } },
    });
    await throughCritiqueWith(c, cwd, run_id, {
      goal: 'G', acceptance: ['A'],
      subgoals: [{ id: 'P1', kind: 'planning', title: 'prd', acceptance: ['a'], files: ['prd.md'], deps: [] }],
    });
    // investigate is not pinned by this test's policy, so it stays on self - the independence
    // rule under test is between revise and draft, not between revise and the investigator.
    const inv = await c.call('team_submit', { run_id, cwd, node_id: 'investigate:P1:1', payload: ok({ changed_files: [], handoff: 'findings.md' }) });
    assert.equal(inv.state, 'done', JSON.stringify(inv));
    const d = await c.call('team_run', { run_id, cwd, node_id: 'draft:P1:1' });
    assert.equal(d.state, 'done', JSON.stringify(d));
    assert.equal(d.executor, 'ink');

    const refused = await c.call('team_run', { run_id, cwd, node_id: 'revise:P1:1' });
    assert.match(refused.error, /someone other than its author/);
    const st = await c.call('team_status', { run_id, cwd, node_id: 'revise:P1:1' });
    assert.equal(st.nodes[0].state, 'pending', 'a routing mistake costs no retry');

    const r = await c.call('team_run', { run_id, cwd, node_id: 'revise:P1:1', model: 'm2' });
    assert.equal(r.state, 'done', JSON.stringify(r));
    // reviewer_independence itself is only merged into the result on the reasoning branch
    // of team_run/team_submit; revise is not a reasoning stage (Task 1), so the refusal
    // applies here but the provenance field does not surface - left out of scope (see the
    // plan's 발견 6).
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('duplicate subgoal ids and missing acceptance are caught', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const v = await setgoalWith(c, cwd, runId, {
      spec: {
        goal: 'G', acceptance: ['A'],
        subgoals: [
          { id: 'U1', title: 't', acceptance: ['a'] },
          { id: 'U1', title: 't2' },
        ],
      },
    });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /duplicate subgoal id U1/);
    assert.match(v.reason, /no acceptance criteria/);
  });
});

test('an unusable spec is retryable and its defects reach the next attempt', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await setgoalWith(c, cwd, runId, { spec: { goal: 'G', acceptance: ['A'], subgoals: [] } });
    const r = await c.call('team_retry', { run_id: runId, cwd });
    assert.equal(r.retried, true);
    assert.equal(r.target, 'spec');
    const nx = await c.call('team_next', { run_id: runId, cwd });
    const brief = readFileSync(nx.ready.find((n) => n.node_id === 'setgoal:2').briefing_path, 'utf8');
    assert.match(brief, /Previous attempt was rejected/);
    assert.match(brief, /no subgoals/, 'the next attempt must be told what was wrong');
  });
});

// ---------- vendor output the broker has to survive ----------
// A stand-in vendor, so the team_run path can be exercised without a real CLI.

const FAKE_ADAPTER = `#!/usr/bin/env node
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
const args = process.argv.slice(2);
const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const out = get('--output');
mkdirSync(dirname(out), { recursive: true });
if (process.env.FAKE_ARGS_LOG) appendFileSync(process.env.FAKE_ARGS_LOG, JSON.stringify(args) + '\\n');
if (args.includes('--detect')) {
  writeFileSync(out, JSON.stringify({ ok: true, codex: { ready: true, reachable: true, write_probe: { ok: true } } }));
  process.exit(0);
}
writeFileSync(out, JSON.stringify({ ok: true, last_message: process.env.FAKE_REPLY ?? '' }));
process.exit(0);
`;

// "auto" under ordered allocation now tries the builtin claude/codex vendors before
// falling back to self (see AUTO_CANDIDATES in broker.mjs). Overriding both here keeps
// every test in this file deterministic and free of real CLI calls, regardless of what
// happens to be installed on the machine running the suite - the same trick balancedRepo()
// already uses for balanced allocation, below.
const FAKE_UNAVAILABLE_ADAPTER = `#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const args = process.argv.slice(2);
const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const out = get('--output');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ ok: false, codex: { ready: false, reachable: false, reason: 'fake: unavailable in this test' } }));
process.exit(1);
`;

function repoWithFakeVendor() {
  const dir = repo();
  const adapter = join(dir, 'fake-adapter.mjs');
  writeFileSync(adapter, FAKE_ADAPTER);
  const unavailable = join(dir, 'unavailable-adapter.mjs');
  writeFileSync(unavailable, FAKE_UNAVAILABLE_ADAPTER);
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'broker-vendors.json'), JSON.stringify({
    fake: { command: 'node', args: [adapter], sandboxes: ['read-only', 'workspace-write'], default_sandbox: 'workspace-write' },
    claude: { command: 'node', args: [unavailable], requires_binary: null, sandboxes: ['read-only', 'workspace-write'], default_sandbox: 'workspace-write' },
    codex: { command: 'node', args: [unavailable], requires_binary: null, sandboxes: ['read-only', 'workspace-write'], default_sandbox: 'workspace-write' },
  }));
  return dir;
}

async function runPlanWith(reply) {
  const cwd = repoWithFakeVendor();
  process.env.FAKE_REPLY = reply;
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('team_open', { request: 'r', cwd, vendor: 'fake' });
    return { v: await c.call('team_run', { run_id, cwd, node_id: 'plan' }), cwd, c };
  } finally {
    c.close();
    delete process.env.FAKE_REPLY;
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('a vendor that returns nothing fails the node', async () => {
  const { v } = await runPlanWith('');
  assert.equal(v.state, 'failed');
  assert.match(v.reason, /no usable JSON/);
});

test('a vendor that returns prose instead of JSON fails the node', async () => {
  const { v } = await runPlanWith('I could not do it.');
  assert.equal(v.state, 'failed');
  assert.match(v.reason, /no usable JSON/);
  assert.match(v.reason, /could not do it/, 'the reason must quote what the vendor actually said');
});

test('a vendor that wraps its JSON in prose and fences still parses', async () => {
  const { v } = await runPlanWith('Sure thing:\n```json\n{"stage_ok":true,"plan":"x","handoff":"h","evidence":"e"}\n```\nAll done.');
  assert.equal(v.state, 'done');
  assert.equal(v.stage_ok, true);
});

test('a vendor that returns stage_ok:false fails the node', async () => {
  const { v } = await runPlanWith('{"stage_ok":false,"handoff":"blocked by sandbox","evidence":"e"}');
  assert.equal(v.state, 'failed');
});

// ---------- an abandoned node ----------
// team_run is synchronous, so a node still marked `running` after the broker that
// started it exited is not in flight - it is stranded. Before this, such a run wedged
// permanently: team_next offered nothing and team_run refused the node as running.

function forceRunning(cwd, runId, nodeId, ageMs) {
  const p = join(cwd, '.teams_output', 'broker', 'runs', `${runId}.json`);
  const run = JSON.parse(readFileSync(p, 'utf8'));
  const n = run.nodes.find((x) => x.node_id === nodeId);
  n.state = 'running';
  n.started_at = Date.now() - ageMs;
  writeFileSync(p, JSON.stringify(run, null, 2));
}

test('a node stranded in running is reclaimed once it is stale', async () => {
  const cwd = repo();
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('team_open', { request: 'r', cwd, vendor: 'self' });
    forceRunning(cwd, run_id, 'plan', 60 * 60 * 1000);

    const nx = await c.call('team_next', { run_id, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), [], 'a failed plan blocks the graph');
    const st = await c.call('team_status', { run_id, cwd });
    const plan = st.nodes.find((n) => n.node_id === 'plan');
    assert.equal(plan.state, 'failed');
    assert.match(plan.reason, /abandoned/);
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a node that only just started is left alone', async () => {
  const cwd = repo();
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('team_open', { request: 'r', cwd, vendor: 'self' });
    forceRunning(cwd, run_id, 'plan', 1000);
    const st = await c.call('team_status', { run_id, cwd });
    assert.equal(st.nodes.find((n) => n.node_id === 'plan').state, 'running',
      'a live node must not be reclaimed out from under the broker running it');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------- a verdict that never arrived ----------
// `!== false` treated a missing field as a pass, so a vendor returning an
// implement-shaped result for a test node, or a gate returning no verdict, went through.

test('a test node with no verified field fails rather than passing by default', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [f] }) });
    const v = await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ checks: ['ran something'] }),
    });
    assert.equal(v.state, 'failed');
    assert.equal(v.missing_verdict, 'verified');
  }, { isolated: true });
});

test('a gate with no accept field fails rather than passing by default', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [f] }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ verified: true }) });
    const v = await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'gate:U1:1', payload: ok({ match_pct: 90, reason: 'looks fine' }),
    });
    assert.equal(v.state, 'failed');
    assert.equal(v.missing_verdict, 'accept');
  }, { isolated: true });
});

test('a critique with no sound field fails rather than passing by default', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    const v = await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ problems: [] }) });
    assert.equal(v.state, 'failed');
    assert.equal(v.missing_verdict, 'sound');
  });
});

// ---------- isolation must stay true ----------
// `isolated` is the broker's own claim that one node had the worktree to itself; it is
// what makes changed_files_verified:true mean anything. Offering two independent
// implement nodes at once invited the orchestrator to falsify it.

const THREE = {
  goal: 'G', acceptance: ['A'],
  subgoals: [
    { id: 'U1', title: 'a', acceptance: ['a'], deps: [] },
    { id: 'U2', title: 'b', acceptance: ['b'], deps: [] },
    { id: 'U3', title: 'c', acceptance: ['c'], deps: ['U1'] },
  ],
};

async function upToSubgoals(c, cwd, runId, spec) {
  await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
  await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec }) });
  await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: true }) });
}

test('an isolated run offers one mutating node at a time', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await upToSubgoals(c, cwd, runId, THREE);
    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(nx.ready.length, 1, 'two implement nodes at once would falsify the isolation claim');
    assert.equal(nx.ready[0].node_id, 'implement:U1:1');
  }, { isolated: true });
});

test('a shared run may offer independent nodes together', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await upToSubgoals(c, cwd, runId, THREE);
    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['implement:U1:1', 'implement:U2:1'],
      'without an isolation claim there is nothing to protect');
  });
});

// ---------- the server must stay alive while a node runs ----------
// spawnSync froze the whole server for the length of a node - measured at 12 minutes on
// a real implement node. ping went unanswered, status could not be read, and nothing
// could be cancelled: a client watching for liveness would have concluded it had died.

const SLOW_ADAPTER = `#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const args = process.argv.slice(2);
const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const out = get('--output');
mkdirSync(dirname(out), { recursive: true });
if (args.includes('--detect')) {
  writeFileSync(out, JSON.stringify({ ok: true, codex: { ready: true, reachable: true } }));
  process.exit(0);
}
setTimeout(() => {
  writeFileSync(out, JSON.stringify({ ok: true, last_message: '{"stage_ok":true,"handoff":"h","evidence":"e"}' }));
  process.exit(0);
}, Number(process.env.SLOW_MS || 4000));
`;

function repoWithSlowVendor() {
  const dir = repo();
  const adapter = join(dir, 'slow-adapter.mjs');
  writeFileSync(adapter, SLOW_ADAPTER);
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'broker-vendors.json'), JSON.stringify({
    slow: { command: 'node', args: [adapter], sandboxes: ['read-only', 'workspace-write'], default_sandbox: 'workspace-write' },
  }));
  return dir;
}

// The Client above resolves replies in order, which cannot express "answer B while A is
// still open". This one keys by id and collects notifications.
class AsyncClient {
  constructor(env) {
    this.proc = spawn('node', [BROKER], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...env } });
    this.buf = '';
    this.id = 0;
    this.pending = new Map();
    this.notifications = [];
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      this.buf += chunk;
      let nl;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        if (!line.trim()) continue;
        const d = JSON.parse(line);
        if (d.method === 'notifications/progress') this.notifications.push(d.params);
        else if (this.pending.has(d.id)) { this.pending.get(d.id)(d); this.pending.delete(d.id); }
      }
    });
  }
  request(method, params) {
    const id = ++this.id;
    const p = new Promise((resolve) => this.pending.set(id, resolve));
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return { id, done: p };
  }
  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  async init() { await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }).done; return this; }
  async call(name, args, meta) { const r = await this.request('tools/call', { name, arguments: args, ...(meta ? { _meta: meta } : {}) }).done; return (r.result || {}).structuredContent; }
  close() { this.proc.stdin.end(); this.proc.kill(); }
}

async function slowRun(fn, env) {
  const cwd = repoWithSlowVendor();
  const c = await new AsyncClient(env).init();
  try {
    const { run_id } = await c.call('team_open', { request: 'r', cwd, vendor: 'slow' });
    await fn({ c, cwd, runId: run_id });
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('ping is answered while a node is still running', async () => {
  await slowRun(async ({ c, cwd, runId }) => {
    const run = c.request('tools/call', { name: 'team_run', arguments: { run_id: runId, cwd, node_id: 'plan' } });
    const t0 = Date.now();
    await c.request('ping', {}).done;
    const pingMs = Date.now() - t0;
    assert.ok(pingMs < 2000, `ping took ${pingMs}ms - the server was blocked by the node`);
    const st = await c.call('team_status', { run_id: runId, cwd });
    assert.equal(st.nodes.find((n) => n.node_id === 'plan').state, 'running');
    await run.done;
  }, { SLOW_MS: '5000' });
});

// "which node is running, on what, for how long" was unanswerable: a blocking team_run
// showed up as a bare state:"running" row, and an operator without the run_id in hand
// could not reach the run at all.
test('an in-flight node names its vendor and elapsed time, with or without a run_id', async () => {
  await slowRun(async ({ c, cwd, runId }) => {
    const run = c.request('tools/call', { name: 'team_run', arguments: { run_id: runId, cwd, node_id: 'plan' } });
    await c.request('ping', {}).done;
    // A wait long enough that a real elapsed_s must read at least 1: a hardcoded 0
    // (or any other constant) fails this, where the earlier bare Number.isInteger
    // check did not care what the value was.
    await new Promise((r) => setTimeout(r, 1200));
    const node = (await c.call('team_status', { run_id: runId, cwd })).nodes.find((n) => n.node_id === 'plan');
    assert.equal(node.state, 'running');
    assert.equal(node.executor, 'slow');
    assert.ok(Number.isInteger(node.elapsed_s), `no elapsed_s on the running node: ${JSON.stringify(node)}`);
    // Lower bound only: it is what a hardcoded elapsed_s (0, or any other constant) fails.
    // An upper bound here would fail on a merely slow/busy machine for reasons that have
    // nothing to do with the code under test.
    assert.ok(node.elapsed_s >= 1, `elapsed_s ${node.elapsed_s} does not track the ~1.2s actually elapsed`);
    const overview = await c.call('team_status', { cwd });
    const row = overview.runs.find((r) => r.run_id === runId);
    assert.equal(row.state, 'running');
    assert.deepEqual(row.running.map((n) => [n.node_id, n.executor]), [['plan', 'slow']]);
    await run.done;
  }, { SLOW_MS: '5000' });
});

test('a running node can be cancelled', async () => {
  await slowRun(async ({ c, cwd, runId }) => {
    const run = c.request('tools/call', {
      name: 'team_run', arguments: { run_id: runId, cwd, node_id: 'plan' },
    });
    setTimeout(() => c.notify('notifications/cancelled', { requestId: run.id, reason: 'test' }), 800);
    const r = await run.done;
    const v = r.result.structuredContent;
    assert.equal(v.state, 'failed');
    assert.equal(v.killed_for, 'cancelled');
    assert.match(v.reason, /cancelled by the client/);
  }, { SLOW_MS: '30000' });
});

test('a node that overruns its timeout is killed', async () => {
  await slowRun(async ({ c, cwd, runId }) => {
    const v = await c.call('team_run', { run_id: runId, cwd, node_id: 'plan' });
    assert.equal(v.state, 'failed');
    assert.equal(v.killed_for, 'timeout');
    assert.match(v.reason, /timeout/);
  }, { SLOW_MS: '30000', BROKER_NODE_TIMEOUT_MS: '1500' });
});

test('a progressToken produces progress notifications, starting immediately', async () => {
  await slowRun(async ({ c, cwd, runId }) => {
    await c.call('team_run', { run_id: runId, cwd, node_id: 'plan' }, { progressToken: 'tok' });
    assert.ok(c.notifications.length >= 1, 'no progress was reported at all');
    assert.equal(c.notifications[0].progressToken, 'tok');
    assert.match(c.notifications[0].message, /team_run plan/);
  }, { SLOW_MS: '2000' });
});

// ---------- two brokers on one run ----------
// A run file is read-modify-written by every mutation, and a node can be held open for
// minutes. The slow broker's stale snapshot used to overwrite a node the fast one had
// already finished and reported `done` to its client: the work happened, the record
// vanished.

test('a slow node finishing does not erase a node another broker completed', async () => {
  const cwd = repoWithSlowVendor();
  const slow = await new AsyncClient({ SLOW_MS: '4000' }).init();
  const fast = await new AsyncClient({ SLOW_MS: '100' }).init();
  try {
    const { run_id } = await slow.call('team_open', { request: 'r', cwd, vendor: 'slow' });
    const sub = (c, node_id, payload) => c.call('team_submit', { run_id, cwd, node_id, payload: ok(payload) });
    await sub(slow, 'plan', { handoff: 'p' });
    await sub(slow, 'setgoal', {
      spec: {
        goal: 'G', acceptance: ['A'],
        subgoals: [
          { id: 'U1', title: 'a', acceptance: ['a'], deps: [] },
          { id: 'U2', title: 'b', acceptance: ['b'], deps: [] },
        ],
      },
    });
    await sub(slow, 'critique', { sound: true });

    const f = dirty(cwd);
    // the slow broker holds U1 open for seconds; the fast one finishes U2 meanwhile
    const held = slow.call('team_run', { run_id, cwd, node_id: 'implement:U1:1' });
    await new Promise((r) => setTimeout(r, 1200));
    const other = await sub(fast, 'implement:U2:1', { changed_files: [f], handoff: 'from the fast broker' });
    assert.equal(other.state, 'done', 'the fast broker was told its node completed');
    await held;

    const st = await fast.call('team_status', { run_id, cwd });
    const u2 = st.nodes.find((n) => n.node_id === 'implement:U2:1');
    assert.equal(u2.state, 'done', 'a node reported done must not revert to pending');
  } finally {
    slow.close();
    fast.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a stale lock left by a killed broker does not wedge the run', async () => {
  const cwd = repo();
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('team_open', { request: 'r', cwd, vendor: 'self' });
    // a lock older than the stale window, as a crashed process would leave
    const lock = join(cwd, '.teams_output', 'broker', 'runs', `${run_id}.json.lock`);
    mkdirSync(lock, { recursive: true });
    const past = new Date(Date.now() - 5 * 60 * 1000);
    utimesSync(lock, past, past);

    const v = await c.call('team_submit', { run_id, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    assert.equal(v.state, 'done', 'a stale lock must be broken, not waited on forever');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------- the goal gate is the only node that sees the request again ----------
// plan -> setgoal narrows the request into a spec; critique checks the spec's internal
// soundness; subgoal gates check work against the spec. Nothing re-read the request, so
// a run could score 100% against a spec that had quietly asked for less.

test('the goal gate is briefed to judge against the request, not only the spec', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    for (const sg of ['U1', 'U2']) {
      const f = dirty(cwd);
      await c.call('team_submit', { run_id: runId, cwd, node_id: `implement:${sg}:1`, payload: ok({ changed_files: [f], handoff: `built ${sg}` }) });
      await c.call('team_submit', { run_id: runId, cwd, node_id: `test:${sg}:1`, payload: ok({ verified: true }) });
      await c.call('team_submit', { run_id: runId, cwd, node_id: `gate:${sg}:1`, payload: ok({ accept: true, match_pct: 95 }) });
    }
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'reduce', payload: ok({ handoff: 'set folded' }) });
    const nx = await c.call('team_next', { run_id: runId, cwd });
    const goalGate = nx.ready.find((n) => n.node_id.startsWith('gate:goal'));
    const brief = readFileSync(goalGate.briefing_path, 'utf8');
    assert.match(brief, /spec_drift/, 'the goal gate must be asked where the spec narrowed the request');
    assert.match(brief, /the REQUEST as written/);
    assert.match(brief, /observations/, 'non-blocking weaknesses need somewhere to go');
  }, { isolated: true });
});

test('a subgoal gate is not given the goal-gate contract', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [f] }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ verified: true }) });
    const nx = await c.call('team_next', { run_id: runId, cwd });
    const brief = readFileSync(nx.ready.find((n) => n.node_id === 'gate:U1:1').briefing_path, 'utf8');
    assert.equal(/spec_drift/.test(brief), false, 'only the goal gate re-reads the request');
    assert.match(brief, /observations/);
  }, { isolated: true });
});

test('observations and spec drift are surfaced but never block acceptance', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    for (const sg of ['U1', 'U2']) {
      const f = dirty(cwd);
      await c.call('team_submit', { run_id: runId, cwd, node_id: `implement:${sg}:1`, payload: ok({ changed_files: [f] }) });
      await c.call('team_submit', { run_id: runId, cwd, node_id: `test:${sg}:1`, payload: ok({ verified: true }) });
      await c.call('team_submit', { run_id: runId, cwd, node_id: `gate:${sg}:1`, payload: ok({ accept: true, match_pct: 90 }) });
    }
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'reduce', payload: ok({ handoff: 'set folded' }) });
    const nx = await c.call('team_next', { run_id: runId, cwd });
    const goalGate = nx.ready.find((n) => n.node_id.startsWith('gate:goal'));
    const v = await c.call('team_submit', {
      run_id: runId, cwd, node_id: goalGate.node_id,
      payload: ok({ accept: true, match_pct: 92, gaps: [], observations: ['no null guard'], spec_drift: ['request said url-safe generally'] }),
    });
    assert.equal(v.state, 'done', 'observations must not block a run that met its bar');
    assert.equal(v.observation_count, 1);
    assert.equal(v.spec_drift_count, 1);
  }, { isolated: true });
});

// ---------- the goal gate's match floor ----------
// A gate that said accept at 70% was reporting a partial result as a pass, and the run went
// out as complete. The percentage was already collected and shown; the floor is what makes it
// mean something. Only the goal gate answers for the whole, so only it is held to the number.

async function toGoalGate(c, cwd, runId, subgoalPct = 95) {
  await throughCritique(c, cwd, runId);
  for (const sg of ['U1', 'U2']) {
    const f = dirty(cwd);
    await c.call('team_submit', { run_id: runId, cwd, node_id: `implement:${sg}:1`, payload: ok({ changed_files: [f] }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: `test:${sg}:1`, payload: ok({ verified: true }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: `gate:${sg}:1`, payload: ok({ accept: true, match_pct: subgoalPct }) });
  }
  await c.call('team_submit', { run_id: runId, cwd, node_id: 'reduce', payload: ok({ handoff: 'set folded' }) });
  // This spec has two subgoals, so `reduce` sits between their gates and the goal gate.
  await c.call('team_submit', { run_id: runId, cwd, node_id: 'reduce', payload: ok({ handoff: 'set folded' }) });
  const nx = await c.call('team_next', { run_id: runId, cwd });
  return nx.ready.find((n) => n.node_id.startsWith('gate:goal')).node_id;
}

test('a goal gate accepting at 95 clears the default floor', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const gate = await toGoalGate(c, cwd, runId);
    const v = await c.call('team_submit', { run_id: runId, cwd, node_id: gate, payload: ok({ accept: true, match_pct: 95, gaps: [] }) });
    assert.equal(v.state, 'done');
  }, { isolated: true });
});

test('a goal gate accepting at 70 fails: most of the goal is not the goal', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const gate = await toGoalGate(c, cwd, runId);
    const v = await c.call('team_submit', { run_id: runId, cwd, node_id: gate, payload: ok({ accept: true, match_pct: 70, gaps: [] }) });
    assert.equal(v.stage_ok, true, 'the judging itself worked');
    assert.equal(v.accept, true, 'and the gate did say accept');
    assert.equal(v.state, 'failed', 'the number it reported overrules the word');
    assert.equal(v.match_pct, 70);
  }, { isolated: true });
});

test('a goal gate accepting just under the floor with no gaps named passes; naming a gap there fails (awake-beta-ref2)', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const gate = await toGoalGate(c, cwd, runId);
    const v = await c.call('team_submit', { run_id: runId, cwd, node_id: gate, payload: ok({ accept: true, match_pct: 88, gaps: [] }) });
    assert.equal(v.state, 'done', 'disclosed weaknesses that do not block are not a rejection the judge never made');
  }, { isolated: true });
  await withRun(async ({ c, cwd, runId }) => {
    const gate = await toGoalGate(c, cwd, runId);
    const v = await c.call('team_submit', { run_id: runId, cwd, node_id: gate, payload: ok({ accept: true, match_pct: 88, gaps: ['the README never says how to pause'] }) });
    assert.equal(v.state, 'failed', 'a named gap under the floor still buys a repair');
  }, { isolated: true });
});

test('goal_threshold 0 puts the goal gate back on its verdict alone', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const gate = await toGoalGate(c, cwd, runId);
    const v = await c.call('team_submit', { run_id: runId, cwd, node_id: gate, payload: ok({ accept: true, match_pct: 70, gaps: [] }) });
    assert.equal(v.state, 'done', 'a run may decide the percentage is not its bar');
  }, { isolated: true, goal_threshold: 0 });
});

test('the floor is the goal gate\'s alone: a subgoal gate accepting at 70 still passes', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [f] }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ verified: true }) });
    const v = await c.call('team_submit', { run_id: runId, cwd, node_id: 'gate:U1:1', payload: ok({ accept: true, match_pct: 70 }) });
    assert.equal(v.state, 'done', 'a subgoal answers for its own slice, not for the whole');
    assert.equal(v.reassigned, undefined, 'and a gate that passed reassigns nothing');
  }, { isolated: true });
});

test('a goal gate that reports no match_pct is judged on its verdict', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const gate = await toGoalGate(c, cwd, runId);
    const v = await c.call('team_submit', { run_id: runId, cwd, node_id: gate, payload: ok({ accept: true, gaps: [] }) });
    assert.equal(v.state, 'done', 'the floor screens a number the gate offered; it does not demand one');
  }, { isolated: true });
  await withRun(async ({ c, cwd, runId }) => {
    const gate = await toGoalGate(c, cwd, runId);
    const v = await c.call('team_submit', { run_id: runId, cwd, node_id: gate, payload: ok({ accept: false, gaps: ['the CLI was never wired up'] }) });
    assert.equal(v.state, 'failed', 'and a rejection with no number is still a rejection');
  }, { isolated: true });
});

// ---------- a judging node must be given the evidence it is asked to weigh ----------
// A gate briefed with prose alone correctly refused: "no raw output or exit status was
// provided". It was being asked to prove something from material it never received.

test('a gate is briefed with the checks and commands its upstream reported', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'implement:U1:1',
      payload: ok({ changed_files: [f], handoff: 'built it', checks: ['node -e probe -> printed OK'] }),
    });
    await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'test:U1:1',
      payload: ok({ verified: true, checks: ['npm test -> 6 passed, 0 failed'] }),
    });
    const nx = await c.call('team_next', { run_id: runId, cwd });
    const brief = readFileSync(nx.ready.find((n) => n.node_id === 'gate:U1:1').briefing_path, 'utf8');
    assert.match(brief, /npm test -> 6 passed, 0 failed/, 'the gate needs the check output, not a summary of it');
    assert.match(brief, /verified=true/);
    assert.match(brief, /Changed: /);
  }, { isolated: true });
});

// ---------- declared capabilities must be real ----------

test('the server declares only capabilities it implements', async () => {
  const c = await new Client().init();
  try {
    const init = await c.send('initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' },
    });
    assert.equal(init.result.serverInfo.name, 'teams-engineering');
    assert.equal(init.result.serverInfo.version, '1.0.0');
    const caps = init.result.capabilities;
    assert.ok(caps.tools, 'tools are implemented and must be declared');
    for (const unimplemented of ['logging', 'resources', 'prompts', 'completions']) {
      assert.equal(unimplemented in caps, false, `${unimplemented} is declared but not implemented`);
    }
  } finally {
    c.close();
  }
});

// ---------- declared output shapes ----------

test('every tool declares an outputSchema, and a real verdict validates against it', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const list = await c.send('tools/list', {});
    for (const t of list.result.tools) {
      assert.ok(t.outputSchema, `${t.name} returns structuredContent with no declared shape`);
      assert.equal(t.outputSchema.type, 'object');
    }
    const byName = Object.fromEntries(list.result.tools.map((t) => [t.name, t.outputSchema]));

    // Pin the fields each schema must require as canaries: an emptied or narrowed
    // `required` list in broker.mjs would otherwise turn the loops below into no-ops
    // that still pass with nothing left to check.
    assert.deepEqual(byName.team_submit.required.slice().sort(), ['node_id', 'stage', 'stage_ok', 'state']);
    assert.deepEqual(byName.team_next.required.slice().sort(), ['ready', 'run_id', 'state']);

    const v = await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    for (const req of byName.team_submit.required) {
      assert.ok(req in v, `a real team_submit verdict is missing declared field ${req}`);
    }
    // the schema must describe the verdict surface, not the payload
    for (const leaked of ['spec', 'handoff', 'evidence', 'checks']) {
      assert.equal(leaked in byName.team_submit.properties, false,
        `outputSchema advertises ${leaked} - the payload must not cross this boundary`);
    }

    const nx = await c.call('team_next', { run_id: runId, cwd });
    for (const req of byName.team_next.required) {
      assert.ok(req in nx, `a real team_next result is missing declared field ${req}`);
    }
  });
});

// ---------- a node must not re-enter the harness ----------
// Observed in a real run: codex, executing an implement node, ran codex-exec-adapter
// --detect and then --stage implement and --stage test inside that node. Four wasted
// invocations and muddled evidence, with nothing to stop it nesting further.

test('every node prompt forbids re-entering the harness', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const seen = [];
    const brief = async () => {
      const nx = await c.call('team_next', { run_id: runId, cwd });
      for (const n of nx.ready) {
        if (!n.briefing_path) continue;
        const text = readFileSync(n.briefing_path, 'utf8');
        seen.push(n.stage);
        assert.match(text, /You ARE this node of the harness graph/, `${n.node_id} may re-enter the harness`);
        assert.match(text, /no codex-exec-adapter\.mjs/, `${n.node_id} does not name the adapter`);
      }
    };
    await brief();
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    await brief();
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: true }) });
    await brief();
    assert.ok(seen.includes('implement'), 'the implement stage is where this was actually observed');
  });
});

// Balanced mode uses deterministic stand-ins; no real AI CLI or account is used.
function balancedRepo() {
  const cwd = repo();
  const adapter = join(cwd, 'balanced-adapter.mjs');
  writeFileSync(adapter, `
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
const a = process.argv.slice(2), get = k => a[a.indexOf(k) + 1];
const cwd = get('--cwd'), vendor = get('--vendor-id'), output = get('--output');
appendFileSync(join(cwd, 'invocations.jsonl'), JSON.stringify({vendor, args:a}) + '\\n');
if (a.includes('--detect')) {
  const ready = !existsSync(join(cwd, 'unavailable-' + vendor));
  writeFileSync(output, JSON.stringify({vendor:{ready, reachable:ready, reason:ready ? '' : 'unavailable'}}));
  process.exit(ready ? 0 : 1);
}
const prompt = readFileSync(get('--prompt-file'), 'utf8');
if (existsSync(join(cwd, 'quota-events-' + vendor))) {
  // codex's own shape: the limit is only in the event stream, the report says nothing about it.
  const ev = get('--events-output');
  writeFileSync(ev, JSON.stringify({type:'turn.failed', error:{message:"You\u2019ve hit your usage limit. Upgrade to Pro or try again at 10:17 AM."}}) + '\\n');
  writeFileSync(output, JSON.stringify({ok:false, stage_ok:false, exit_code:1, events_output:ev, stderr:'Reading additional input from stdin...\\n'}));
  process.exit(1);
}
if (existsSync(join(cwd, 'quota-' + vendor))) {
  writeFileSync(join(cwd, 'partial.txt'), 'retained partial work');
  writeFileSync(output, JSON.stringify({stage_ok:false, failure_kind:'quota', stderr:'usage_limit_reached'}));
  process.exit(1);
}
const stage = prompt.match(/^# (\\w+) node/)[1];
const result = {stage_ok:true, handoff:'saved', evidence:'checked', changed_files:[], checks:['check -> pass'], verified:true, sound:true, accept:true, match_pct:100, gaps:[]};
if(stage === 'implement') { writeFileSync(join(cwd, 'a.txt'), 'implemented'); result.changed_files=['a.txt']; }
if(stage === 'setgoal') result.spec = ${JSON.stringify(SPEC)};
writeFileSync(output, JSON.stringify({stage_ok:true,result}));
`);
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'broker-vendors.json'), JSON.stringify(Object.fromEntries(['claude', 'codex'].map(vendor => [vendor, {
    command: 'node', args: [adapter, '--vendor-id', vendor], requires_binary: null,
    sandboxes: ['read-only', 'workspace-write'], default_sandbox: 'workspace-write',
  }]))));
  return cwd;
}

for (const host_vendor of ['claude', 'codex']) {
  test(`balanced MCP flow: ${host_vendor} drives, peer implements, host tests and gates`, async () => {
    const cwd = balancedRepo();
    const c = await new Client({ CODEX_THREAD_ID: '' }).init();
    const other = host_vendor === 'claude' ? 'codex' : 'claude';
    const hostDefault = host_vendor === 'claude' ? 'sonnet' : 'gpt-5.6-sol';
    try {
      const open = await c.call('team_open', { request: 'r', cwd, allocation: 'balanced', host_vendor, host_model: 'driving-model' });
      const run_id = open.run_id;
      // Only critique is decisive judging on the host model; plan and setgoal - reasoning
      // stages that never veto anything - take the default tier.
      for (const [node_id, payload, expectModel] of [
        ['plan', ok({ handoff: 'p' }), hostDefault],
        ['setgoal', ok({ spec: SPEC }), hostDefault],
        ['critique', ok({ sound: true }), 'driving-model'],
      ]) {
        const next = await c.call('team_next', { run_id, cwd });
        assert.equal(next.ready[0].executor, host_vendor);
        assert.equal(next.ready[0].model, expectModel);
        assert.ok(next.ready[0].briefing_path.includes(run_id));
        const result = await c.call('team_submit', { run_id, cwd, node_id, payload });
        assert.equal(result.state, 'done', JSON.stringify(result));
      }
      // implement goes to the peer. test comes back to the host: the node that verifies an
      // implementation must not share its author's blind spot (code-flat, 2026-09-16 - the
      // peer wrote a main-module guard that failed on a symlinked path, the peer's test invoked
      // it through the one path that hid that, and the integrated CLI printed nothing).
      {
        const next = await c.call('team_next', { run_id, cwd });
        assert.equal(next.ready[0].stage, 'implement');
        assert.equal(next.ready[0].vendor, other);
        assert.equal(next.ready[0].model, other === 'claude' ? 'sonnet' : 'gpt-5.6-sol');
        assert.equal((await c.call('team_run', { run_id, cwd, node_id: next.ready[0].node_id })).state, 'done');
      }
      {
        const next = await c.call('team_next', { run_id, cwd });
        assert.equal(next.ready[0].stage, 'test');
        assert.equal(next.ready[0].executor, host_vendor);
        assert.match(next.ready[0].routing_reason, new RegExp(`preference=${host_vendor}`));
        assert.equal((await c.call('team_submit', { run_id, cwd, node_id: next.ready[0].node_id, payload: ok({ verified: true, handoff: 't' }) })).state, 'done');
      }
      const gate = await c.call('team_next', { run_id, cwd });
      assert.equal(gate.ready[0].executor, host_vendor);
      assert.equal(gate.ready[0].stage, 'gate');
      await c.call('team_submit', { run_id, cwd, node_id: gate.ready[0].node_id,
        payload: { stage_ok: false, failure_kind: 'quota' } });
      await c.call('team_retry', { run_id, cwd, node_id: gate.ready[0].node_id, reset_capacity: true });
      // Gate rejection remains a failed verdict; it must not trigger quota recovery.
      const rejected = await c.call('team_submit', { run_id, cwd, node_id: gate.ready[0].node_id, payload: ok({ accept: false, gaps: ['missing requirement'] }) });
      assert.equal(rejected.state, 'failed');
      assert.equal(rejected.recoverable, undefined);
      assert.ok((await c.call('team_retry', { run_id, cwd, node_id: gate.ready[0].node_id })).error,
        'historical interruption cannot reopen a rejected gate');
    } finally { c.close(); rmSync(cwd, { recursive: true, force: true }); }
  });
}

test('quota fallback preserves partial files and checkpoint across broker restart', async () => {
  const cwd = balancedRepo();
  let c = await new Client({ CODEX_THREAD_ID: '' }).init();
  try {
    writeFileSync(join(cwd, 'quota-claude'), '1');
    const open = await c.call('team_open', { request: 'original acceptance', cwd, allocation: 'balanced' });
    const run_id = open.run_id;
    assert.equal(open.ready[0].vendor, 'claude');
    const interrupted = await c.call('team_run', { run_id, cwd, node_id: 'plan' });
    assert.equal(interrupted.state, 'pending');
    assert.equal(interrupted.recoverable, true);
    assert.equal(readFileSync(join(cwd, 'partial.txt'), 'utf8'), 'retained partial work');
    assert.ok(readFileSync(interrupted.checkpoint_path, 'utf8').includes('partial.txt'));
    c.close();
    c = await new Client({ CODEX_THREAD_ID: '' }).init();
    const next = await c.call('team_next', { run_id, cwd });
    assert.equal(next.ready[0].vendor, 'codex');
    const done = await c.call('team_run', { run_id, cwd, node_id: 'plan' });
    assert.equal(done.state, 'done');
    const prompt = readFileSync(join(dirname(done.detail_path), 'prompt.md'), 'utf8');
    assert.ok(prompt.includes(interrupted.checkpoint_path));
    assert.ok(prompt.includes('original acceptance'));
    assert.equal(readFileSync(join(cwd, 'partial.txt'), 'utf8'), 'retained partial work');
    assert.ok((await c.call('team_retry', { run_id, cwd, node_id: 'plan' })).error, 'completed nodes cannot be reopened through recovery');
  } finally { c.close(); rmSync(cwd, { recursive: true, force: true }); }
});

test('code-sprint-S2: a usage limit found only in the adapter\'s event stream is a fallback, not a failed attempt - under ordered allocation too', async () => {
  const cwd = balancedRepo();
  const c = await new Client({ CODEX_THREAD_ID: '' }).init();
  try {
    writeFileSync(join(cwd, 'quota-events-claude'), '1');
    const open = await c.call('team_open', { request: 'r', cwd, vendor: 'auto' });
    const run_id = open.run_id;
    assert.equal(open.ready[0].vendor, 'claude', JSON.stringify(open.ready[0]));
    const r = await c.call('team_run', { run_id, cwd, node_id: 'plan' });
    assert.equal(r.state, 'pending', JSON.stringify(r));
    assert.equal(r.recoverable, true, 'the node is not spent - it goes back for another vendor');
    const next = await c.call('team_next', { run_id, cwd });
    assert.equal(next.ready[0].vendor, 'codex');
  } finally { c.close(); rmSync(cwd, { recursive: true, force: true }); }
});

test('native quota submission falls back; all exhausted blocks until explicit capacity reset', async () => {
  const cwd = balancedRepo();
  const c = await new Client({ CODEX_THREAD_ID: '' }).init();
  try {
    const open = await c.call('team_open', { request: 'r', cwd, allocation: 'balanced', host_vendor: 'claude' });
    const run_id = open.run_id;
    const native = await c.call('team_submit', { run_id, cwd, node_id: 'plan', payload: { stage_ok: false, failure_kind: 'quota' } });
    assert.equal(native.recoverable, true);
    const fallback = await c.call('team_next', { run_id, cwd });
    assert.equal(fallback.ready[0].vendor, 'codex');
    const bypass = await c.call('team_submit', { run_id, cwd, node_id: 'plan', payload: ok({}) });
    assert.ok(bypass.error);
    writeFileSync(join(cwd, 'quota-codex'), '1');
    await c.call('team_run', { run_id, cwd, node_id: 'plan' });
    assert.equal((await c.call('team_next', { run_id, cwd })).state, 'blocked');
    assert.equal((await c.call('team_status', { run_id, cwd })).state, 'blocked');
    const resumed = await c.call('team_retry', { run_id, cwd, node_id: 'plan', reset_capacity: true });
    assert.equal(resumed.ready[0].executor, 'claude');
    assert.equal(resumed.ready[0].vendor, 'self');
    assert.ok(readFileSync(resumed.ready[0].briefing_path, 'utf8').includes('Resume after interrupted'));
  } finally { c.close(); rmSync(cwd, { recursive: true, force: true }); }
});

test('single vendor uses native lower model; unsupported native model fails visibly', async () => {
  const cwd = balancedRepo();
  const c = await new Client({ CODEX_THREAD_ID: '' }).init();
  try {
    const open = await c.call('team_open', { request: 'r', cwd, allocation: 'balanced', host_vendor: 'codex',
      host_model: 'driving-model', candidates: ['codex'], policy: { plan: { model: 'gpt-5.6-sol' } }, native_models: ['gpt-5.6-sol'] });
    assert.equal(open.ready[0].vendor, 'self');
    assert.equal(open.ready[0].model, 'gpt-5.6-sol');
    const unavailable = await c.call('team_open', { request: 'r', cwd, allocation: 'balanced', host_vendor: 'codex',
      candidates: ['codex'], native_models: ['gpt-6-astra'] });
    assert.equal(unavailable.state, 'blocked');
    assert.match(JSON.stringify(unavailable.ready[0].attempts), /cannot select model/);
    const explicit = await c.call('team_open', { request: 'r', cwd, allocation: 'balanced', host_vendor: 'codex',
      candidates: ['codex'], native_models: ['gpt-6-astra'], model: 'gpt-6-astra' });
    assert.equal(explicit.ready[0].model, 'gpt-6-astra');
    const a = await c.call('team_open', { request: 'different run', cwd, allocation: 'balanced', host_vendor: 'codex', candidates: ['codex'] });
    assert.notEqual(open.ready[0].briefing_path, a.ready[0].briefing_path);
  } finally { c.close(); rmSync(cwd, { recursive: true, force: true }); }
});

test('the host model is selectable even when native_models omits it', async () => {
  // A driving session reports itself as e.g. "claude-opus-5[1m]" — a context variant the
  // fresh-agent picker does not list. A fresh native agent with no override inherits the
  // host model, so a decisive judging stage must route to self on it, not block with a
  // vendor failure. plan is not decisive - it takes the default tier, which happens to
  // already be declared - so critique is what actually exercises the fallback.
  const cwd = balancedRepo();
  const c = await new Client({ CODEX_THREAD_ID: '' }).init();
  try {
    const open = await c.call('team_open', { request: 'r', cwd, allocation: 'balanced', host_vendor: 'codex',
      host_model: 'gpt-5.6-sol[1m]', candidates: ['codex'], native_models: ['gpt-5.6-sol', 'gpt-5.6-mini'] });
    assert.equal(open.state, 'running');
    assert.equal(open.ready[0].vendor, 'self');
    assert.equal(open.ready[0].model, 'gpt-5.6-sol', 'plan takes the default tier, already declared');
    await c.call('team_submit', { run_id: open.run_id, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_next', { run_id: open.run_id, cwd }); // assigns setgoal before it can be submitted
    await c.call('team_submit', { run_id: open.run_id, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    const nx = await c.call('team_next', { run_id: open.run_id, cwd });
    assert.equal(nx.ready[0].stage, 'critique');
    assert.equal(nx.ready[0].vendor, 'self');
    assert.equal(nx.ready[0].model, 'gpt-5.6-sol[1m]', 'critique is decisive and falls back to the host model');
  } finally { c.close(); rmSync(cwd, { recursive: true, force: true }); }
});

test('a default tier resolves against declared native ids; an undeclared tier falls back to the host model, visibly', async () => {
  // The defaults name a tier ("sonnet"); a host lists ids ("claude-sonnet-5"). The second
  // e2e round blocked every implement node on that mismatch with zero failed nodes, and the
  // session's only way out was a second team_open - an orphan run and a redone spec.
  const cwd = balancedRepo();
  const c = await new Client({ CODEX_THREAD_ID: '' }).init();
  try {
    const ids = await c.call('team_open', { request: 'r', cwd, allocation: 'balanced', host_vendor: 'codex',
      host_model: 'gpt-5.6-sol[1m]', candidates: ['codex'], policy: { plan: { model: 'mini' } }, native_models: ['gpt-5.6-sol', 'gpt-5.6-mini'] });
    assert.equal(ids.state, 'running');
    assert.equal(ids.ready[0].vendor, 'self');
    assert.equal(ids.ready[0].model, 'gpt-5.6-mini', 'the tier word finds the declared id');
    const fb = await c.call('team_open', { request: 'r', cwd, allocation: 'balanced', host_vendor: 'codex',
      host_model: 'gpt-5.6-sol', candidates: ['codex'], policy: { plan: { model: 'nano' } }, native_models: ['gpt-5.6-sol'] });
    assert.equal(fb.state, 'running');
    assert.equal(fb.ready[0].model, 'gpt-5.6-sol', 'an undeclared tier runs on the host model instead of killing the run');
    assert.match(JSON.stringify(fb.ready[0]), /not in native_models, host model used/, 'the substitution is visible in the routing reason');
  } finally { c.close(); rmSync(cwd, { recursive: true, force: true }); }
});

// ---------- registering a vendor does not enrol it in "auto" ----------
// The default candidate list is empty on purpose: a run that does not name a vendor
// stays on the orchestrator, even when a perfectly ready vendor is registered. Without
// a test, restoring the old `Object.keys(vendors)` would silently start delegating
// every unnamed run to whatever happened to be installed.

test('auto does not pick up a registered, ready vendor that was never named', async () => {
  const cwd = repoWithFakeVendor();
  process.env.FAKE_REPLY = '{"stage_ok":true,"handoff":"h","evidence":"e"}';
  const c = await new Client().init();
  try {
    const auto = await c.call('team_open', { request: 'r', cwd, vendor: 'auto' });
    assert.equal(auto.ready[0].vendor, 'self',
      'an unnamed run must stay on the orchestrator even with a ready vendor installed');

    const named = await c.call('team_open', { request: 'r', cwd, vendor: 'fake' });
    assert.equal(named.ready[0].vendor, 'fake', 'naming the vendor still routes to it');

    const listed = await c.call('team_open', { request: 'r', cwd, vendor: 'auto', candidates: ['fake'] });
    assert.equal(listed.ready[0].vendor, 'fake', 'listing it in candidates still routes to it');
  } finally {
    c.close();
    delete process.env.FAKE_REPLY;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a run with no vendor argument at all stays on the orchestrator', async () => {
  const cwd = repoWithFakeVendor();
  const c = await new Client().init();
  try {
    const r = await c.call('team_open', { request: 'r', cwd });
    assert.equal(r.ready[0].vendor, 'self');
    assert.ok(r.ready[0].briefing_path, 'a self node needs its briefing written to disk');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------- who decides which vendor and model runs each phase ----------
// Nobody did. One vendor was chosen at team_open and used for plan, implement and
// report alike, while `model` existed only as an argument the caller had to remember on
// every team_run - so the harness contract (reasoning on a strong model, execution on
// whatever can write here) had no way to be expressed at all.

const FULL_POLICY = {
  plan: { vendor: 'self', model: 'opus' },
  setgoal: { vendor: 'self', model: 'opus' },
  implement: { vendor: 'fake', model: 'exec-model' },
  gate: { vendor: 'self', model: 'opus' },
  report: { vendor: 'self', model: 'sonnet' },
};

test('a stage policy routes each phase to its own vendor and model', async () => {
  const cwd = repoWithFakeVendor();
  const c = await new Client().init();
  try {
    const open = await c.call('team_open', {
      request: 'r', cwd, vendor: 'fake', model: 'run-default', policy: FULL_POLICY,
    });
    const plan = open.ready.find((n) => n.node_id === 'plan');
    assert.equal(plan.vendor, 'self', 'plan is pinned to self by policy');
    assert.equal(plan.model, 'opus');

    await c.call('team_submit', { run_id: open.run_id, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id: open.run_id, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });

    // critique has no policy entry: it must inherit the run-level vendor and model
    const nx = await c.call('team_next', { run_id: open.run_id, cwd });
    const critique = nx.ready.find((n) => n.node_id === 'critique');
    assert.equal(critique.vendor, 'fake', 'an unpolicied stage falls back to the run vendor');
    assert.equal(critique.model, 'run-default', 'and to the run model');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('the broker forwards a stage policy model to the readiness probe', async () => {
  const cwd = repoWithFakeVendor();
  const log = join(cwd, 'adapter-args.jsonl');
  process.env.FAKE_ARGS_LOG = log;
  const c = await new Client().init();
  try {
    const open = await c.call('team_open', {
      request: 'r', cwd, vendor: 'self',
      policy: { plan: { vendor: 'fake', model: 'probe-model' } },
    });
    assert.equal(open.ready[0].vendor, 'fake');
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    const detect = calls.find((call) => call.includes('--detect'));
    assert.ok(detect, 'the vendor adapter must receive a readiness call');
    assert.equal(detect[detect.indexOf('--model') + 1], 'probe-model');
  } finally {
    c.close();
    delete process.env.FAKE_ARGS_LOG;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('the Codex adapter probes reachability and writes with the selected model', () => {
  const cwd = repo();
  const bin = join(cwd, 'bin');
  const log = join(cwd, 'codex-args.jsonl');
  const output = join(cwd, 'probe-result.json');
  mkdirSync(bin);
  const stub = join(bin, 'codex');
  writeFileSync(stub, `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
appendFileSync(process.env.CODEX_ARGS_LOG, JSON.stringify(args) + '\\n');
if (args.includes('--version')) process.exit(0);
const prompt = args.at(-1) || '';
// The smoke asks for a file's contents via cat: answering needs the command to have run.
const cat = prompt.match(/Run the shell command \`cat ([^\`]+)\`/);
if (cat && !process.env.CODEX_NO_EXEC) {
  const { readFileSync } = await import('node:fs');
  process.stdout.write(readFileSync(join(args[args.indexOf('-C') + 1], cat[1]), 'utf8') + '\\n');
} else if (cat) process.stdout.write('CODEX_READY\\n');
const match = prompt.match(/Create a file named ([^ ]+)/);
if (match) {
  const cwdArg = args[args.indexOf('-C') + 1];
  writeFileSync(join(cwdArg, match[1]), 'PROBE_OK\\n');
}
process.exit(0);
`);
  chmodSync(stub, 0o755);
  try {
    const result = spawnSync('node', [
      CODEX_ADAPTER,
      '--detect', '--cwd', cwd, '--sandbox', 'workspace-write',
      '--model', 'probe-model', '--output', output,
    ], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CODEX_ARGS_LOG: log },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(output, 'utf8')).codex.ready, true);
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse)
      .filter((call) => call[0] === 'exec');
    assert.equal(calls.length, 2, 'detect must run one smoke and one write probe');
    assert.deepEqual(calls.map((c) => c[c.indexOf('-s') + 1]), ['workspace-write', 'workspace-write'],
      'the smoke runs a command, so it runs under the sandbox the stage will use - a read-only smoke fails where bubblewrap cannot start even for a danger-full-access run');
    for (const call of calls) {
      assert.equal(call[call.indexOf('-m') + 1], 'probe-model');
    }
    // code-sprint-P1: a codex that answers but cannot run a command (bubblewrap) is not reachable
    // for a judge - the old smoke only asked it to say CODEX_READY.
    const blocked = spawnSync('node', [CODEX_ADAPTER, '--detect', '--cwd', cwd, '--sandbox', 'workspace-write', '--output', output],
      { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CODEX_ARGS_LOG: log, CODEX_NO_EXEC: '1' } });
    const rep = JSON.parse(readFileSync(output, 'utf8')).codex;
    assert.equal(rep.reachable, false, blocked.stderr);
    assert.equal(rep.test, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a policy can route reasoning and execution to different vendors in one run', async () => {
  const cwd = repoWithFakeVendor();
  process.env.FAKE_REPLY = '{"stage_ok":true,"sound":true,"handoff":"h","evidence":"e"}';
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('team_open', {
      request: 'r', cwd, vendor: 'self',
      policy: { critique: { vendor: 'fake' }, implement: { vendor: 'fake', model: 'exec-model' } },
    });
    await c.call('team_submit', { run_id, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });

    const nx = await c.call('team_next', { run_id, cwd });
    assert.equal(nx.ready.find((n) => n.node_id === 'critique').vendor, 'fake',
      'one run must be able to send reasoning to a vendor and keep the rest on self');

    const v = await c.call('team_run', { run_id, cwd, node_id: 'critique' });
    assert.equal(v.state, 'done');
    assert.equal(v.vendor, 'fake');

    const after = await c.call('team_next', { run_id, cwd });
    const impl = after.ready.find((n) => n.node_id === 'implement:U1:1');
    assert.equal(impl.vendor, 'fake');
    assert.equal(impl.model, 'exec-model', 'the executor gets its own model, not the reasoning one');
  } finally {
    c.close();
    delete process.env.FAKE_REPLY;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('gate:goal can be policied separately from the per-subgoal gates', async () => {
  const cwd = repoWithFakeVendor();
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('team_open', {
      request: 'r', cwd, vendor: 'self',
      policy: { gate: { model: 'gate-model' }, 'gate:goal': { model: 'goal-gate-model' } },
    });
    await c.call('team_submit', { run_id, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    await c.call('team_submit', { run_id, cwd, node_id: 'critique', payload: ok({ sound: true }) });
    for (const sg of ['U1', 'U2']) {
      const f = dirty(cwd);
      await c.call('team_submit', { run_id, cwd, node_id: `implement:${sg}:1`, payload: ok({ changed_files: [f] }) });
      await c.call('team_submit', { run_id, cwd, node_id: `test:${sg}:1`, payload: ok({ verified: true }) });
      const nx = await c.call('team_next', { run_id, cwd });
      const gate = nx.ready.find((n) => n.node_id === `gate:${sg}:1`);
      assert.equal(gate.model, 'gate-model', 'a subgoal gate uses the gate policy');
      await c.call('team_submit', { run_id, cwd, node_id: gate.node_id, payload: ok({ accept: true, match_pct: 95 }) });
    }
    await c.call('team_submit', { run_id, cwd, node_id: 'reduce', payload: ok({ handoff: 'set folded' }) });
    const nx = await c.call('team_next', { run_id, cwd });
    const goalGate = nx.ready.find((n) => n.node_id.startsWith('gate:goal'));
    assert.equal(goalGate.model, 'goal-gate-model', 'the goal gate may be judged by a different model');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------- quota discovered at probe time ----------
// The real Codex adapter buries the usage-limit message at codex.smoke.stderr and writes
// nothing to its own stderr, so a probe-time exhaustion is indistinguishable from a broken
// vendor unless the report is searched. Reproduces that exact shape.
function quotaProbeRepo() {
  const cwd = repo();
  const adapter = join(cwd, 'quota-probe-adapter.mjs');
  writeFileSync(adapter, `
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const a = process.argv.slice(2), get = k => a[a.indexOf(k) + 1];
const cwd = get('--cwd'), vendor = get('--vendor-id'), output = get('--output');
if (a.includes('--detect')) {
  if (existsSync(join(cwd, 'broken-' + vendor))) {
    writeFileSync(output, JSON.stringify({ ok: false, codex: { available: true, ready: false, reachable: false,
      reason: 'sandbox denied write access',
      smoke: { exit_code: 1, stdout: '', stderr: 'operation not permitted; the model produced no output limit' } } }));
    process.exit(1);
  }
  if (existsSync(join(cwd, 'quota-' + vendor))) {
    writeFileSync(output, JSON.stringify({ ok: false, codex: { available: true, ready: false, reachable: false,
      reason: 'codex unreachable',
      smoke: { exit_code: 1, stdout: '', stderr: "You've hit your usage limit. Upgrade to Pro, visit settings to purchase more credits or try again at 4:21 AM." } } }));
    process.exit(1);
  }
  writeFileSync(output, JSON.stringify({ vendor: { ready: true, reachable: true, reason: '' } }));
  process.exit(0);
}
const stage = readFileSync(get('--prompt-file'), 'utf8').match(/^# (\\w+) node/)[1];
const result = { stage_ok: true, handoff: 'h', evidence: 'e', changed_files: [], checks: ['c -> pass'], verified: true, sound: true, accept: true, match_pct: 100, gaps: [] };
if (stage === 'implement') { writeFileSync(join(cwd, 'a.txt'), 'implemented'); result.changed_files = ['a.txt']; }
writeFileSync(output, JSON.stringify({ stage_ok: true, result }));
`);
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'broker-vendors.json'), JSON.stringify(Object.fromEntries(['claude', 'codex'].map(vendor => [vendor, {
    command: 'node', args: [adapter, '--vendor-id', vendor], requires_binary: null,
    sandboxes: ['read-only', 'workspace-write'], default_sandbox: 'workspace-write',
  }]))));
  writeFileSync(join(cwd, 'quota-codex'), '');
  return cwd;
}

// Same fixture, but the probe fails for a reason that has nothing to do with capacity.
function brokenProbeRepo() {
  const cwd = quotaProbeRepo();
  rmSync(join(cwd, 'quota-codex'));
  writeFileSync(join(cwd, 'broken-codex'), '');
  return cwd;
}

test('a probe rejected for usage limits is recorded as spent capacity, not a broken vendor', async () => {
  const cwd = quotaProbeRepo();
  const c = await new Client({ CODEX_THREAD_ID: '' }).init();
  try {
    const { run_id } = await c.call('team_open', { request: 'r', cwd, allocation: 'balanced',
      host_vendor: 'claude', host_model: 'driving-model' });
    for (const [node_id, payload] of [['plan', ok({ handoff: 'p' })], ['setgoal', ok({ spec: SPEC })], ['critique', ok({ sound: true })]]) {
      await c.call('team_next', { run_id, cwd });
      assert.equal((await c.call('team_submit', { run_id, cwd, node_id, payload })).state, 'done');
    }
    // Implement prefers the peer vendor; its probe is out of quota, so the run falls back.
    const next = await c.call('team_next', { run_id, cwd });
    assert.equal(next.ready[0].executor, 'claude', 'the exhausted peer must not be assigned');

    const full = await c.call('team_status', { run_id, cwd, full: true });
    assert.match(String((full.unavailable_vendors || {}).codex || ''), /capacity/i,
      'a quota-exhausted probe must mark the vendor as spent capacity so reset_capacity is the way back');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('capacity reset alone restores a vendor excluded at probe time, with no interrupted node to name', async () => {
  const cwd = quotaProbeRepo();
  const c = await new Client({ CODEX_THREAD_ID: '' }).init();
  try {
    const { run_id } = await c.call('team_open', { request: 'r', cwd, allocation: 'balanced',
      host_vendor: 'claude', host_model: 'driving-model' });
    for (const [node_id, payload] of [['plan', ok({ handoff: 'p' })], ['setgoal', ok({ spec: SPEC })], ['critique', ok({ sound: true })]]) {
      await c.call('team_next', { run_id, cwd });
      await c.call('team_submit', { run_id, cwd, node_id, payload });
    }
    await c.call('team_next', { run_id, cwd });
    assert.ok((await c.call('team_status', { run_id, cwd, full: true })).unavailable_vendors.codex, 'precondition: codex is excluded');

    rmSync(join(cwd, 'quota-codex'));  // capacity came back
    const reset = await c.call('team_retry', { run_id, cwd, reset_capacity: true });

    const full = await c.call('team_status', { run_id, cwd, full: true });
    assert.deepEqual(full.unavailable_vendors, {}, 'a capacity reset must clear probe-time exclusions');
    assert.equal(reset.ready?.[0]?.vendor, 'codex', 'the recovered vendor is offered again for execution work');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a rejected team_retry leaves capacity untouched; a failed call must not half-apply', async () => {
  const cwd = quotaProbeRepo();
  const c = await new Client({ CODEX_THREAD_ID: '' }).init();
  try {
    const { run_id } = await c.call('team_open', { request: 'r', cwd, allocation: 'balanced',
      host_vendor: 'claude', host_model: 'driving-model' });
    for (const [node_id, payload] of [['plan', ok({ handoff: 'p' })], ['setgoal', ok({ spec: SPEC })], ['critique', ok({ sound: true })]]) {
      await c.call('team_next', { run_id, cwd });
      await c.call('team_submit', { run_id, cwd, node_id, payload });
    }
    await c.call('team_next', { run_id, cwd });
    const before = await c.call('team_status', { run_id, cwd, full: true });
    assert.ok(before.unavailable_vendors.codex, 'precondition: codex is excluded');

    // 'implement:U1:1' is pending but was never interrupted, so this retry is rejected.
    const r = await c.call('team_retry', { run_id, cwd, node_id: 'implement:U1:1', reset_capacity: true });
    assert.match(String(r.error || ''), /interrupted pending node/);

    const after = await c.call('team_status', { run_id, cwd, full: true });
    assert.deepEqual(after.unavailable_vendors, before.unavailable_vendors,
      'a retry that throws must not have already cleared capacity exclusions');
    assert.equal(after.capacity_epoch, before.capacity_epoch, 'nor bumped the capacity epoch');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('an ordinary probe failure is not laundered into a capacity exclusion', async () => {
  const cwd = brokenProbeRepo();
  const c = await new Client({ CODEX_THREAD_ID: '' }).init();
  try {
    const { run_id } = await c.call('team_open', { request: 'r', cwd, allocation: 'balanced',
      host_vendor: 'claude', host_model: 'driving-model' });
    for (const [node_id, payload] of [['plan', ok({ handoff: 'p' })], ['setgoal', ok({ spec: SPEC })], ['critique', ok({ sound: true })]]) {
      await c.call('team_next', { run_id, cwd });
      await c.call('team_submit', { run_id, cwd, node_id, payload });
    }
    const next = await c.call('team_next', { run_id, cwd });
    assert.equal(next.ready[0].executor, 'claude', 'a broken peer is still routed around');

    const full = await c.call('team_status', { run_id, cwd, full: true });
    assert.deepEqual(full.unavailable_vendors, {},
      'a broken vendor must stay probeable; only spent capacity is held against the run');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

// A briefing names files by absolute path, so a truthful executor reports them that way.
// The cross-check compared the claim to git's relative output and called every honest
// absolute claim a lie.
test('an absolute changed_files path inside cwd verifies instead of contradicting', async () => {
  const cwd = repoWithFakeVendor();
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('team_open', { request: 'r', cwd, vendor: 'self', isolated: true });
    for (const [node_id, payload] of [['plan', ok({ handoff: 'p' })], ['setgoal', ok({ spec: SPEC })], ['critique', ok({ sound: true })]]) {
      await c.call('team_submit', { run_id, cwd, node_id, payload });
    }
    const rel = dirty(cwd);
    const r = await c.call('team_submit', { run_id, cwd, node_id: 'implement:U1:1',
      payload: ok({ changed_files: [join(cwd, rel)] }) });

    assert.equal(r.state, 'done', JSON.stringify(r));
    assert.equal(r.changed_files_verified, true, 'the file really is in the worktree');
    assert.equal(r.contradicted_files, undefined, 'an existing file must not be called contradicted');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('an absolute path outside cwd is still contradicted', async () => {
  const cwd = repoWithFakeVendor();
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('team_open', { request: 'r', cwd, vendor: 'self', isolated: true });
    for (const [node_id, payload] of [['plan', ok({ handoff: 'p' })], ['setgoal', ok({ spec: SPEC })], ['critique', ok({ sound: true })]]) {
      await c.call('team_submit', { run_id, cwd, node_id, payload });
    }
    dirty(cwd);
    const r = await c.call('team_submit', { run_id, cwd, node_id: 'implement:U1:1',
      payload: ok({ changed_files: ['/etc/hosts'] }) });

    assert.equal(r.state, 'failed');
    assert.deepEqual(r.contradicted_files, ['/etc/hosts']);
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

// A lead that lost its run_id - a fresh session, a compaction, a second operator - had no
// way back into a run through the MCP, only through the transcript.
test('every run in a directory is listable without knowing a run_id', async () => {
  const cwd = repo();
  const c = await new Client().init();
  try {
    const first = await openRun(c, cwd);
    const second = await openRun(c, cwd, { request: 'the second request' });
    const overview = await c.call('team_status', { cwd });
    assert.deepEqual([...overview.runs.map((r) => r.run_id)].sort(), [first, second].sort());
    const stamps = overview.runs.map((r) => Date.parse(r.created_at));
    assert.deepEqual(stamps, [...stamps].sort((x, y) => y - x), 'newest run is not listed first');
    const fresh = overview.runs.find((r) => r.run_id === second);
    assert.equal(fresh.request, 'the second request');
    assert.equal(fresh.state, 'running');
    assert.equal(fresh.counts.pending, 3);
    assert.deepEqual(fresh.running, []);
    assert.equal(fresh.last_finished, null);
    // The overview is a progress view, never a way around the one-node-at-a-time rule.
    assert.ok(!JSON.stringify(overview).includes('acceptance'), 'the overview leaked payload');

    await c.call('team_submit', { run_id: first, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    const row = (await c.call('team_status', { cwd })).runs.find((r) => r.run_id === first);
    assert.deepEqual(row.last_finished, { node_id: 'plan', stage: 'plan', state: 'done' });
    assert.equal(row.counts.done, 1);
  } finally { c.close(); rmSync(cwd, { recursive: true, force: true }); }
});

// The driver grading its own account of the run is exactly the self-attestation the gate
// stages exist to prevent; report now goes to the peer for the same reason.
test('the peer vendor, not the driver, writes the run report', async () => {
  const cwd = balancedRepo();
  const c = await new Client({ CODEX_THREAD_ID: '' }).init();
  try {
    const { run_id } = await c.call('team_open', {
      request: 'r', cwd, allocation: 'balanced', host_vendor: 'claude', host_model: 'driving-model' });
    let report = null;
    for (let i = 0; i < 24 && !report; i++) {
      const next = await c.call('team_next', { run_id, cwd });
      assert.ok(next.ready.length, `run stalled with nothing ready: ${JSON.stringify(next.counts)}`);
      const node = next.ready[0];
      if (node.stage === 'report') { report = node; break; }
      // Host-vendor work comes back as self; only the peer's nodes are actually run.
      const r = node.vendor === 'self'
        ? await c.call('team_submit', { run_id, cwd, node_id: node.node_id,
          payload: ok(node.stage === 'setgoal' ? { spec: SPEC } : { handoff: 'h', sound: true, accept: true, verified: true, match_pct: 100, gaps: [] }) })
        : await c.call('team_run', { run_id, cwd, node_id: node.node_id });
      assert.equal(r.state, 'done', JSON.stringify(r));
    }
    assert.ok(report, 'the run never reached its report node');
    assert.equal(report.executor, 'codex');
    assert.equal(report.model, 'gpt-5.6-sol');
    assert.match(report.routing_reason, /preference=codex/);
    assert.equal((await c.call('team_run', { run_id, cwd, node_id: 'report' })).state, 'done');
    assert.equal((await c.call('team_status', { run_id, cwd })).state, 'complete');
  } finally { c.close(); rmSync(cwd, { recursive: true, force: true }); }
});

test('persona and method go to the hand that works, never to the one that judges', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'setgoal',
      payload: ok({ handoff: 's', spec: { goal: 'G', acceptance: ['A'], subgoals: [{
        id: 'U1', kind: 'subgoal', title: 't', persona: 'implementer who owns this module',
        skills: ['develop:clean-code'], acceptance: ['a'], test: ['x'], deps: [],
      }] } }),
    });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: true }) });
    const brief = async (node_id) => {
      const nx = await c.call('team_next', { run_id: runId, cwd });
      const n = nx.ready.find((x) => x.node_id === node_id);
      return n ? readFileSync(n.briefing_path, 'utf8') : null;
    };
    const impl = await brief('implement:U1:1');
    assert.match(impl, /Act as: implementer who owns this module/);
    assert.match(impl, /develop:clean-code/);
    const f = dirty(cwd);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [f] }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ verified: true }) });
    const gate = await brief('gate:U1:1');
    assert.ok(gate, 'the gate opened');
    assert.doesNotMatch(gate, /Act as:/, 'the judge is not handed the author\'s identity');
    assert.doesNotMatch(gate, /develop:clean-code/, 'nor the method the spec picked for the author');
    assert.match(gate, /think:devils-advocate/, 'it has its own method, from the kind');
    assert.match(gate, /judge, not the actor/, 'it is told the opposite, and now nothing contradicts it');
  }, { isolated: true });
});

test('a subgoal that names no skills still gets its method from the kind', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', {
      run_id: runId, cwd, node_id: 'setgoal',
      payload: ok({ handoff: 's', spec: { goal: 'G', acceptance: ['A'], subgoals: [
        { id: 'U1', kind: 'subgoal', title: 'code', acceptance: ['a'], test: ['x'], deps: [] },
        { id: 'D1', kind: 'document', title: 'doc', acceptance: ['b'], deps: [] },
      ] } }),
    });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: true }) });
    const nx = await c.call('team_next', { run_id: runId, cwd });
    const brief = (id) => readFileSync(nx.ready.find((x) => x.node_id === id).briefing_path, 'utf8');
    // Live runs returned skills: [] every time when the spec was asked for them, so the
    // kind has to carry the method or nothing does.
    assert.match(brief('implement:U1:1'), /develop:clean-code/, 'code work gets the code family');
    assert.match(brief('draft:D1:1'), /write:doc-coauthoring/, 'writing gets the writing family');
    assert.doesNotMatch(brief('draft:D1:1'), /develop:clean-code/, 'and not the other kind\'s');
    // Not isolated: isolation offers one mutating node at a time, and this needs both at once.
  });
});

test('a subgoal reassigned after a spec retry waits on the live generation, not the dead one', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const spec = { goal: 'G', acceptance: ['A'], subgoals: [
      { id: 'U1', kind: 'subgoal', title: 'a', acceptance: ['a'], test: ['x'], deps: [] },
      { id: 'U2', kind: 'subgoal', title: 'b', acceptance: ['b'], test: ['y'], deps: ['U1'] },
    ] };
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec, handoff: 's' }) });
    // critique rejects, so the whole first generation is superseded and setgoal runs again -
    // the engine opens setgoal:2 itself now; a caller-driven team_retry on top of that would
    // only open a redundant setgoal:3 and strand this generation as superseded.
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: false, blocking: ['no'] }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal:2', payload: ok({ spec, handoff: 's' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique:2', payload: ok({ sound: true }) });
    // Now fail U1 of the live generation and let the engine reassign it.
    const f = dirty(cwd);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:2', payload: ok({ changed_files: [f] }) });
    const v = await c.call('team_submit', { run_id: runId, cwd, node_id: 'test:U1:2', payload: ok({ verified: false, checks: ['c -> failed'] }) });
    assert.equal(v.reassigned.attempt, 3);
    const st = await c.call('team_status', { run_id: runId, cwd });
    const fresh = st.nodes.find((n) => n.node_id === 'implement:U1:3');
    // Reading the earliest head node instead gave deps on the dead generation's critique,
    // and the node could never become ready.
    assert.ok(!fresh.deps.some((d) => /:1$/.test(d)), `inherited a dead generation's deps: ${fresh.deps.join(', ')}`);
    assert.deepEqual(fresh.deps, ['critique:2']);
    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.ok(nx.ready.some((n) => n.node_id === 'implement:U1:3'), 'and so it is actually offered');
  }, { isolated: true });
});

// ---------- a human can pick up a card (waiting_human) ----------

test('a subgoal spec\'s assignee: "human" pin parks its author stage in waiting_human at team_next - never offered, never routed, never counted as a failure', async () => {
  // setgoal's own spec.assignee is a MODEL pin, so this needs interactive:true to park at all
  // (see the source-distinction tests below for the non-interactive, auto-decided case).
  await withRun(async ({ c, cwd, runId }) => {
    const spec = {
      goal: 'G', acceptance: ['A'],
      subgoals: [{ id: 'U1', kind: 'subgoal', title: 'a', acceptance: ['a'], test: ['x'], deps: [], assignee: { who: 'sanghyeon' } }],
    };
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec, handoff: 's' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: true }) });

    const nx = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(nx.state, 'waiting_human');
    assert.equal(nx.ready.length, 0, 'the only ready-by-deps node is the human-pinned one, and it is never offered');

    const node = (await c.call('team_status', { run_id: runId, cwd, full: true, node_id: 'implement:U1:1' })).node;
    assert.equal(node.state, 'waiting_human');
    assert.deepEqual(node.assignment, { executor: 'human', vendor: 'human', who: 'sanghyeon', reason: 'pinned by the subgoal spec (assignee)' });
    assert.ok(Number.isInteger(node.waiting_since));
    assert.ok(node.briefing_path, 'tm_inbox needs a briefing to point the main session at');
    assert.match(readFileSync(node.briefing_path, 'utf8'), /U1/, 'the same briefing a fresh agent would have read');

    // A second team_next (the way a live driver loop would poll again) must not spawn a
    // vendor probe, retry anything, or change the outcome - zero compute while waiting.
    const again = await c.call('team_next', { run_id: runId, cwd });
    assert.equal(again.state, 'waiting_human');
    assert.equal(again.ready.length, 0);
  }, { interactive: true });
});

test('team_run refuses a human-pinned node directly, rather than handing "human" to loadVendors as if it were a real vendor', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const spec = {
      goal: 'G', acceptance: ['A'],
      subgoals: [{ id: 'U1', kind: 'subgoal', title: 'a', acceptance: ['a'], test: ['x'], deps: [], assignee: 'human' }],
    };
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec, handoff: 's' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: true }) });
    // Called directly, before any team_next has had a chance to promote it to waiting_human.
    const r = await c.call('team_run', { run_id: runId, cwd, node_id: 'implement:U1:1' });
    assert.match(r.error || '', /pinned to a human executor/);
  }, { interactive: true });
});

test('team_submit also refuses a waiting_human node directly - a human\'s own submission goes through tm_submit (taskmanager.mjs), not team_submit', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const spec = {
      goal: 'G', acceptance: ['A'],
      subgoals: [{ id: 'U1', kind: 'subgoal', title: 'a', acceptance: ['a'], test: ['x'], deps: [], assignee: 'human' }],
    };
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec, handoff: 's' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: true }) });
    await c.call('team_next', { run_id: runId, cwd }); // promotes implement:U1:1 to waiting_human

    const f = dirty(cwd);
    const r = await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [f] }) });
    assert.match(r.error || '', /waiting_human, not pending/);
  }, { interactive: true });
});

test('judging stages are never pinned - only the kind\'s author stage carries the human assignment', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const spec = {
      goal: 'G', acceptance: ['A'],
      subgoals: [{ id: 'D1', kind: 'document', title: 'd', acceptance: ['a'], deps: [], assignee: 'human' }],
    };
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec, handoff: 's' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: true }) });
    const draft = (await c.call('team_status', { run_id: runId, cwd, full: true, node_id: 'draft:D1:1' })).node;
    const review = (await c.call('team_status', { run_id: runId, cwd, full: true, node_id: 'review:D1:1' })).node;
    const gate = (await c.call('team_status', { run_id: runId, cwd, full: true, node_id: 'gate:D1:1' })).node;
    assert.equal(draft.assignment.executor, 'human');
    assert.equal(review.assignment, undefined, 'review judges the human\'s draft - never the same identity');
    assert.equal(gate.assignment, undefined);
  }, { interactive: true });
});

// ---------- checkpoint / rollback (docs/plans/2026-09-23-teams-reducer-human-rollback.md §5) ----------

const SOLE = {
  goal: 'G', acceptance: ['A'],
  subgoals: [{ id: 'U1', title: 'only one', acceptance: ['a'], test: ['t'], deps: [] }],
};

test('retry_policy default "continue" leaves a rejected attempt\'s edits in place - today\'s only behavior, unchanged', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, SOLE);
    await c.call('team_next', { run_id: runId, cwd }); // records implement:U1:1's checkpoint
    const bad = dirty(cwd, 'bad.txt');
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [bad], handoff: 'h' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ verified: true }) });
    const rejected = await c.call('team_submit', { run_id: runId, cwd, node_id: 'gate:U1:1', payload: ok({ accept: false, match_pct: 40, gaps: ['fix the widget'] }) });
    assert.equal(rejected.rollback, undefined, 'continue does not even compute a rollback target');
    assert.ok(readFileSync(join(cwd, 'bad.txt'), 'utf8').includes('changed'), 'the failed attempt\'s edit is still there - the next attempt builds on top of it');
    const st = await c.call('team_status', { run_id: runId, cwd, full: true, node_id: 'implement:U1:2' });
    assert.equal(st.node.state, 'pending', 'a fresh attempt opened, on the same dirty tree');
  });
});

test('retry_policy "rollback" resets the worktree to the checkpoint before the failed attempt, keeps the gate\'s gaps as feedback', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, SOLE);
    const before = await c.call('team_next', { run_id: runId, cwd }); // records implement:U1:1's checkpoint
    assert.equal(before.ready[0].node_id, 'implement:U1:1');
    // a.txt is TRACKED (repo()'s own init commit): appending to it, then resetting, proves the
    // rollback reverts CONTENT, not merely deletes an untracked file - a stronger claim than
    // "the new file is gone".
    const bad = dirty(cwd);
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [bad], handoff: 'h' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ verified: true }) });
    const rejected = await c.call('team_submit', { run_id: runId, cwd, node_id: 'gate:U1:1', payload: ok({ accept: false, match_pct: 40, gaps: ['fix the widget'] }) });
    assert.equal(rejected.rollback.applied, true);
    // The reset discarded the failed attempt's edit - the checkpoint predates it.
    assert.equal(readFileSync(join(cwd, 'a.txt'), 'utf8'), 'x\n', 'reset to the pre-attempt checkpoint, not just left dirty');
    // The rejection's gaps still reach the next attempt - rollback resets the TREE, not the feedback.
    const st = await c.call('team_status', { run_id: runId, cwd, full: true, node_id: 'implement:U1:2' });
    assert.equal(st.node.state, 'pending');
    assert.match(st.node.feedback, /fix the widget/);
  }, { retry_policy: 'rollback' });
});

test('retry_policy "rollback" falls back to continue when a run has more than one subgoal sharing the worktree', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId); // the default 2-subgoal SPEC (U1 -> U2)
    await c.call('team_next', { run_id: runId, cwd });
    const bad = dirty(cwd, 'bad.txt');
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [bad], handoff: 'h' }) });
    await c.call('team_submit', { run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ verified: true }) });
    const rejected = await c.call('team_submit', { run_id: runId, cwd, node_id: 'gate:U1:1', payload: ok({ accept: false, match_pct: 40, gaps: ['fix it'] }) });
    assert.equal(rejected.rollback.skipped, true);
    assert.match(rejected.rollback.reason, /subgoals sharing one worktree/);
    assert.ok(readFileSync(join(cwd, 'bad.txt'), 'utf8').includes('changed'), 'nothing was reset - U2 may still be working in the same tree');
  }, { retry_policy: 'rollback' });
});
