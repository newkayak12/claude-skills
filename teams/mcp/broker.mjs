#!/usr/bin/env node
// teams-engineering - local stdio MCP server that owns the harness flow as a node graph and
// mediates every node's execution across vendors.
//
// Two rules shape the whole tool surface:
//
//   1. The orchestrator never holds a payload. It throws the request in, asks what to
//      run next, tells the broker to run it, and gets back a one-line verdict. The
//      goal-spec, upstream handoffs, prior rejection feedback, changed-file lists and
//      evidence all stay on disk. If they accumulated in the orchestrator's context,
//      a long graph with retries would run out of room - the loop would die before the
//      work did.
//
//   2. Whoever executes a node - a vendor CLI or the orchestrator itself - the claimed
//      result meets the same worktree cross-check here. The broker may LOWER stage_ok.
//      It never raises it.
//
// A corollary of (1): the broker composes node prompts itself, from graph state. The
// caller is not allowed to pass one in.
//
// Zero dependencies: MCP's stdio transport is newline-delimited JSON-RPC 2.0.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { capacityFailure, selectModel, rankCandidates } from './routing.mjs';
import {
  STAGES,
  REASONING_STAGES,
  createRun,
  loadRun,
  saveRun,
  findRun,
  listRuns,
  getNode,
  expandSubgoals,
  openAsk,
  validateSpec,
  retrySubgoal,
  retrySpec,
  readyNodes,
  runState,
  unmetDeps,
  nodeBriefing,
  stagePolicy,
  VERDICT_FIELD,
  authorStage,
  isAuthorNode,
  nodeKind,
  FLOWS,
  DEFAULT_FLOW,
  flowOf,
  goalRoundOf,
  goalGateSiblings,
  goalConsensus,
  openRepair,
  defaultKind,
  normalizeSpec,
  promoteWaitingHuman,
  promoteHumanGates,
  autoPassHumanGateResult,
  applyPinAction,
  drainHumanActions,
  computeWriteScope,
} from './graph.mjs';
import { composePrompt } from './prompts.mjs';
import { readTeamConfig, resolveTeamOptions } from './teamconfig.mjs';
import { isEntryPoint } from './pluginroots.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = { name: 'teams-engineering', version: '1.0.0' };
const DEFAULT_PROTOCOL = '2025-06-18';

// ---------- vendor registry ----------
//
// A vendor is anything that meets the adapter CLI contract:
//   <cmd> [args] --detect  --cwd DIR --sandbox MODE --output FILE
//   <cmd> [args] --stage S --cwd DIR --prompt-file F --events-output F --output F
//                --sandbox MODE [--isolated] [--add-dir DIR] [--model M]
// exit 0 AND report.stage_ok === true is the only success.
//
// `self` is the orchestrator: no adapter, it does the work and submits the result for
// the same adjudication. Projects register more in <cwd>/.claude/broker-vendors.json.

const BUILTIN_VENDORS = {
  claude: {
    command: 'node',
    args: [join(HERE, '..', 'adapters', 'claude-exec-adapter.mjs')],
    // danger-full-access is offered so a run can opt into it; the default stays the
    // profile that still answers to the project's permission settings.
    sandboxes: ['read-only', 'workspace-write', 'danger-full-access'],
    default_sandbox: 'workspace-write',
    requires_binary: 'claude',
  },
  codex: {
    command: 'node',
    args: [join(HERE, '..', 'adapters', 'codex-exec-adapter.mjs')],
    sandboxes: ['read-only', 'workspace-write', 'danger-full-access'],
    default_sandbox: 'workspace-write',
    requires_binary: 'codex',
  },
};

// `vendor: "auto"` tries these in order, then degrades to `self`. An empty list meant
// "auto" under ordered allocation was indistinguishable from `vendor: "self"` - a ready,
// registered `codex` sat unused unless a caller named it, which is exactly the silent
// self-preference the balanced allocator was built to avoid. Auto now tries both builtin
// vendors before giving up on the orchestrator, with the run's own host_vendor last: a
// peer that is ready is preferred over asking the driving session to do the work itself,
// and the host is not ranked against itself as if it were a candidate for its own work.
// Registering a THIRD-PARTY vendor still does not enrol it here — name it explicitly
// (`vendor: "codex"`) or list it in `candidates`; this list only ever names the two
// builtins.
function AUTO_CANDIDATES(hostVendor) {
  const base = ['claude', 'codex'];
  return hostVendor && base.includes(hostVendor)
    ? [...base.filter((v) => v !== hostVendor), hostVendor]
    : base;
}

function loadVendors(cwd) {
  const vendors = JSON.parse(JSON.stringify(BUILTIN_VENDORS));
  for (const p of [process.env.BROKER_VENDORS, cwd && join(cwd, '.claude', 'broker-vendors.json')].filter(Boolean)) {
    try {
      const extra = JSON.parse(readFileSync(p, 'utf8'));
      for (const name of Object.keys(extra)) vendors[name] = extra[name];
    } catch {
      /* absent or malformed project config is not an error - built-ins stand */
    }
  }
  return vendors;
}

function adapterExists(v) {
  if (!v || !Array.isArray(v.args) || !v.args.length) return !!(v && v.command);
  try {
    return existsSync(v.args[0]);
  } catch {
    return false;
  }
}

function binaryPresent(name) {
  if (!name) return true;
  return spawnSync(name, ['--version'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).status === 0;
}

// ---------- ledger ----------

function brokerDir(cwd) {
  return join(cwd, '.teams_output', 'broker');
}

function record(cwd, entry) {
  try {
    mkdirSync(brokerDir(cwd), { recursive: true });
    appendFileSync(join(brokerDir(cwd), 'ledger.jsonl'), JSON.stringify({ ts: Date.now(), ...entry }) + '\n');
  } catch {
    /* the ledger is evidence, not a dependency - never fail a node over it */
  }
}

function writeOpen(cwd, map) {
  try {
    mkdirSync(brokerDir(cwd), { recursive: true });
    writeFileSync(join(brokerDir(cwd), 'open-nodes.json'), JSON.stringify(map, null, 2) + '\n');
  } catch {
    /* best-effort */
  }
}

// The hook-readable snapshot is derived from the graph, so it cannot drift from it.
function syncOpenNodes(run) {
  const map = {};
  for (const n of run.nodes) {
    if (n.state === 'running') {
      map[n.ticket || n.node_id] = {
        run_id: run.run_id,
        node_id: n.node_id,
        stage: n.stage,
        cwd: run.cwd,
        opened_at: n.started_at || Date.now(),
      };
    }
  }
  writeOpen(run.cwd, map);
}

// ---------- adapter invocation ----------

// Async on purpose. spawnSync froze the whole server for the length of a node - a
// measured 12 minutes on a real implement node - so ping went unanswered, status could
// not be read, and nothing could be cancelled. A client watching for liveness would
// reasonably conclude the server had died.
const NODE_TIMEOUT_MS = Number(process.env.BROKER_NODE_TIMEOUT_MS) > 0
  ? Number(process.env.BROKER_NODE_TIMEOUT_MS)
  : 45 * 60 * 1000;
const MAX_OUTPUT = 64 * 1024 * 1024;

function runAdapter(vendor, extraArgs, cwd, opts = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(vendor.command, [...(vendor.args || []), ...extraArgs], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ status: null, stdout: '', stderr: String((error && error.message) || error), error });
      return;
    }

    let out = '';
    let err = '';
    let settled = false;
    let killedFor = '';
    const take = (buf, chunk) => (buf.length > MAX_OUTPUT ? buf : buf + chunk);
    child.stdout.on('data', (c) => { out = take(out, c.toString('utf8')); });
    child.stderr.on('data', (c) => { err = take(err, c.toString('utf8')); });

    const stop = (why) => {
      if (settled) return;
      killedFor = why;
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      // A vendor that ignores SIGTERM must not hold the node open forever.
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 5000).unref();
    };

    const timer = setTimeout(() => stop('timeout'), opts.timeoutMs || NODE_TIMEOUT_MS);
    if (opts.register) opts.register(() => stop('cancelled'));

    const finish = (status, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout: out, stderr: err, error, killed_for: killedFor });
    };
    child.on('error', (error) => finish(null, error));
    child.on('close', (code) => finish(code));
  });
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// ---------- readiness probe ----------

const probeCache = new Map();

// Every string in a report, whatever shape the adapter chose.
function flatten(value, depth = 0) {
  if (typeof value === 'string') return value;
  if (depth > 6 || !value || typeof value !== 'object') return '';
  return Object.values(value).map((v) => flatten(v, depth + 1)).filter(Boolean).join('\n');
}

async function probe(name, vendor, cwd, sandbox, model) {
  // Readiness must be checked with the same model the node will run. Otherwise a
  // broken global Codex default can reject the probe even though the run selected a
  // working model explicitly. Keep model in the cache key so one failed model does
  // not poison another model's route.
  const key = [name, cwd, sandbox, model || 'default'].join(' ');
  if (probeCache.has(key)) return probeCache.get(key);
  // Cache the promise, not the result: two nodes asking at once would otherwise each
  // pay for a full write probe.
  let settle;
  probeCache.set(key, new Promise((r) => { settle = r; }));

  let out;
  if (!adapterExists(vendor)) {
    out = { ready: false, reachable: false, reason: `vendor "${name}" has no adapter at ${(vendor.args || [])[0]}` };
  } else if (!binaryPresent(vendor.requires_binary)) {
    out = { ready: false, reachable: false, reason: `vendor "${name}" requires ${vendor.requires_binary} on PATH` };
  } else {
    try {
      mkdirSync(brokerDir(cwd), { recursive: true });
    } catch {
      /* the adapter mkdirs its own output parent too */
    }
    const modelKey = model
      ? `-${createHash('sha256').update(String(model)).digest('hex').slice(0, 12)}`
      : '';
    const outPath = join(brokerDir(cwd), `probe-${name}-${sandbox}${modelKey}.json`);
    const detectArgs = ['--detect', '--cwd', cwd, '--sandbox', sandbox, '--output', outPath];
    if (model) detectArgs.push('--model', String(model));
    const r = await runAdapter(vendor, detectArgs, cwd, {
      timeoutMs: Number(process.env.BROKER_PROBE_TIMEOUT_MS) > 0 ? Number(process.env.BROKER_PROBE_TIMEOUT_MS) : 5 * 60 * 1000,
    });
    const report = readJson(outPath) || {};
    const detail = report.codex || report.vendor || report;
    // A vendor that is merely out of credit is not a broken vendor. Adapters bury that
    // message at different depths (the Codex one puts it under codex.smoke.stderr and
    // writes nothing to its own stderr), so search the whole report rather than agreeing
    // on a field name that the next adapter will place somewhere else.
    const quota = capacityFailure(report, [r.stderr, flatten(report)].join('\n'));
    // Two different questions. `ready` means the vendor can WRITE under this sandbox -
    // what an Implement node needs. `reachable` means the vendor answers at all - which
    // is all a reasoning node needs, since it is told not to write and is run read-only.
    // Conflating them routes every reasoning node to vendor-failure.
    out = {
      ready: r.status === 0 && (detail.ready === true || report.ok === true),
      reachable: detail.reachable === true || (r.status === 0 && detail.ready === true),
      reason: detail.reason || (r.status === 0 ? '' : `adapter exit ${r.status}: ${r.stderr.slice(-200)}`),
      quota,
    };
    if (quota) out.reason = `usage capacity exhausted at probe${out.reason ? `; ${out.reason}` : ''}`;
  }
  settle(out);
  probeCache.set(key, Promise.resolve(out));
  return out;
}

// ---------- worktree cross-check ----------

function gitChanged(cwd) {
  const r = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) return null;
  return r.stdout
    .split('\n')
    .map((l) => l.slice(3).trim())
    .filter(Boolean)
    .map((p) => (p.includes(' -> ') ? p.split(' -> ').pop() : p));
}

// ---------- checkpoint / rollback (docs/plans/2026-09-23-teams-reducer-human-rollback.md §5) ----------

function gitHead(cwd) {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// `git stash create` writes a commit object holding the dirty state WITHOUT touching the
// working tree or the stash ref (unlike `git stash push`/`save`) - a read, not a mutation, so it
// is safe to call on every dispatch even though most of them are never rolled back to. Empty
// output (clean tree) is not an error; there is simply nothing to snapshot beyond HEAD.
function gitStashCreate(cwd) {
  const r = spawnSync('git', ['stash', 'create'], { cwd, encoding: 'utf8' });
  const out = (r.stdout || '').trim();
  return r.status === 0 && out ? out : null;
}

// Called once per node, right before its attempt starts doing work (team_run's vendor path,
// team_next's self-vendor offer). A no-git cwd (isolated:false test fixtures, mostly) leaves
// n.checkpoint unset - rollback then has nothing to target and retrySubgoal's own guard reports
// why, exactly like the no-git branch of crossCheck reports 'no-git' rather than failing.
function recordCheckpoint(run, n) {
  if (n.checkpoint) return false;
  const head = gitHead(run.cwd);
  if (!head) return false;
  n.checkpoint = { head, stash: gitStashCreate(run.cwd), at: Date.now() };
  return true;
}

// The other half of retrySubgoal's `rollback` decision: it names the checkpoint, this performs
// it. Reset discards the failed attempt's edits (tracked and untracked alike - clean -fd, the
// same reach `git status --porcelain --untracked-files=all` already gives crossCheck) and returns
// to the head recorded before that attempt began. The stash object is not popped: reset --hard
// already puts the tree at that exact commit, and popping on top of it would reapply the very
// edits rollback exists to discard - the stash ref is kept only as an inspectable record of what
// was thrown away (`git stash show/apply <sha>` if a person wants to look).
function applyRollback(run, rollback, subgoalId) {
  if (!rollback || rollback.skipped || !rollback.checkpoint) return rollback || null;
  const { head } = rollback.checkpoint;
  const reset = spawnSync('git', ['reset', '--hard', head], { cwd: run.cwd, encoding: 'utf8' });
  if (reset.status !== 0) {
    record(run.cwd, { event: 'rollback_failed', run_id: run.run_id, subgoal_id: subgoalId, node_id: rollback.node_id, reason: (reset.stderr || '').trim() });
    return { skipped: true, reason: `git reset --hard ${head} failed: ${(reset.stderr || '').trim()}` };
  }
  spawnSync('git', ['clean', '-fd'], { cwd: run.cwd, encoding: 'utf8' });
  record(run.cwd, { event: 'rollback_applied', run_id: run.run_id, subgoal_id: subgoalId, node_id: rollback.node_id, checkpoint: head });
  return { ...rollback, applied: true };
}

// Positive attribution is only sound when this node had the worktree to itself.
// Otherwise null - "could not attribute" is neither a pass nor a failure.
function crossCheck(cwd, claimed, isolated, kind) {
  const observed = gitChanged(cwd);
  if (observed === null) return { changed_files_verified: null, change_attribution: 'no-git', contradicted_files: [] };
  // A document draft that reports no files is not caught lying - it wrote nothing git
  // can see, perhaps because the deliverable is the handoff text itself. Under isolation
  // an empty claim used to verify as `true`, which asserts attribution of nothing. Say
  // "could not attribute" and leave the judgement to review, whose job it is.
  if (kind === 'document' && !(Array.isArray(claimed) && claimed.length)) {
    return { changed_files_verified: null, change_attribution: 'document-unchanged', contradicted_files: [] };
  }
  // A briefing names files by absolute path, so a truthful executor claims them that way,
  // while git reports them relative to cwd. Compare in one space. A path outside cwd is
  // left as-is rather than trimmed, so it stays unmatched instead of matching by suffix.
  const base = String(cwd).replace(/\\/g, '/').replace(/\/+$/, '') + '/';
  const toRel = (f) => {
    const p = String(f).replace(/\\/g, '/');
    return (p.startsWith(base) ? p.slice(base.length) : p).replace(/^\.\//, '');
  };
  const list = Array.isArray(claimed) ? claimed.map(String) : [];
  const missing = list.filter((f) => {
    const r = toRel(f);
    return !r || !observed.some((o) => o === r || o.endsWith('/' + r));
  });
  if (!isolated) {
    return {
      changed_files_verified: missing.length ? false : null,
      change_attribution: 'shared-worktree',
      contradicted_files: missing,
    };
  }
  return { changed_files_verified: missing.length === 0, change_attribution: 'isolated', contradicted_files: missing };
}

// ---------- run lookup ----------

const knownCwds = new Set();

// team_run is synchronous: while a node runs, the call is held open by the process that
// started it. So a node marked `running` that this process did not start, and that has
// been sitting long enough, belongs to a broker that died - it is not in flight, it is
// abandoned. Without reclaiming it the run wedges forever: team_next offers nothing and
// team_run refuses the node as already running.
const activeNodes = new Set();
const STALE_AFTER_MS = Number(process.env.BROKER_STALE_AFTER_MS) > 0
  ? Number(process.env.BROKER_STALE_AFTER_MS)
  : 10 * 60 * 1000;

function reclaimAbandoned(run) {
  let reclaimed = 0;
  for (const n of run.nodes) {
    if (n.state !== 'running') continue;
    const key = `${run.run_id}:${n.node_id}`;
    if (activeNodes.has(key)) continue;
    if (Date.now() - (n.started_at || 0) < STALE_AFTER_MS) continue;
    n.state = 'failed';
    n.result = {
      stage_ok: false,
      reason: 'abandoned: the broker executing this node exited before it finished',
    };
    reclaimed++;
  }
  if (reclaimed) {
    saveRun(run);
    syncOpenNodes(run);
    record(run.cwd, { event: 'node_reclaimed', run_id: run.run_id, count: reclaimed });
  }
  return reclaimed;
}


// Which model a fresh native agent is asked for. `model` is a tier or an id; the host's
// native_models are ids or aliases. Same string, then the host's own model, then a
// declared model that names the same tier ("sonnet" ~ "claude-sonnet-5"); otherwise the
// host model as a marked fallback. null only when the host declared nothing usable.
export function resolveNativeModel(run, model) {
  const list = Array.isArray(run.native_models) ? run.native_models.map(String) : null;
  if (!list || !model) return { model, fallback: false };
  if (model === run.host_model || list.includes(model)) return { model, fallback: false };
  const want = String(model).toLowerCase();
  const tier = (want.match(/(sonnet|opus|haiku|fable|astra|mini|sol|nano)/) || [])[1] || want;
  const hit = list.find((m) => m.toLowerCase().includes(want)) || list.find((m) => m.toLowerCase().includes(tier));
  if (hit) return { model: hit, fallback: false };
  if (run.host_model) return { model: run.host_model, fallback: true };
  return null;
}

function mustFindRun(a) {
  if (a.cwd) knownCwds.add(resolve(String(a.cwd)));
  const cwd = a.cwd ? resolve(String(a.cwd)) : null;
  const run = (cwd && loadRun(cwd, String(a.run_id))) || findRun(String(a.run_id), knownCwds);
  if (!run) throw new Error(`unknown run ${a.run_id} - pass cwd, or call team_open first`);
  knownCwds.add(run.cwd);
  // Every entry point below funnels through here, so this is "the next step" a queued human
  // pin/submission (tm_assign, tm_submit({key}) - taskmanager.mjs) takes to become real: drained
  // and applied before anything else about this run is read. team_next is the common case - its
  // own promoteWaitingHuman (below, in toolGraphNext) is what parks a freshly-pinned card, right
  // after a pin ingested here sets its assignment.
  ingestHandoff(run);
  return run;
}

// See graph.mjs's queueHumanAction/drainHumanActions for why this queue exists at all instead
// of the manager writing the child run directly (the 0.27.3 bug this replaces). Applies each
// action through the exact functions tm_assign/tm_submit's own read-only preview already ran -
// applyPinAction for a pin, computeSubmitResult+finishNode for a submission - so a human's
// report gets the identical worktree cross-check and autoReassign retry/escalate path any other
// executor's does, not a second implementation of either.
function ingestHandoff(run) {
  const queue = drainHumanActions(run.cwd, run.run_id);
  if (!queue.length) return;
  let touched = false;
  for (const action of queue) {
    if (action.kind === 'pin') {
      if (applyPinAction(run, action)) touched = true;
    } else if (action.kind === 'submit') {
      const n = getNode(run, action.node_id);
      if (!n || n.state !== 'waiting_human') continue; // already resolved (or stale), nothing to apply
      if (action.answered_at) n.answered_at = action.answered_at;
      submitResult(run, n, action.payload, 'human');
      touched = true;
    }
  }
  // finishNode (called by submitResult) already saves; a pin-only queue does not touch saveRun
  // anywhere else, so it needs its own here.
  if (touched) saveRun(run);
}

// ---------- routing ----------

async function route(run, node) {
  if (node.assignment && !(run.unavailable_vendors || {})[node.assignment.executor]) return node.assignment;
  const stage = node.stage;
  const pol = stagePolicy(run, node);
  const vendors = loadVendors(run.cwd);
  const want = String(pol.vendor || 'auto').toLowerCase();
  const balanced = run.allocation === 'balanced';
  const isSelf = ['self', 'off', 'none'].includes(want) || (!balanced && want === 'claude');
  // 'human' never enters the automatic candidate pool, even if a caller's own policy names it
  // (team_open({candidates: ['human', 'claude']}) among them) - §0.3 of docs/plans/2026-09-17-
  // teams-team-v0.13.0.md fixes this: the only way a node goes to a human is the pin
  // (node.assignment, honored by this function's early return above), never a ranked choice.
  // vendors[name] already has no 'human' entry, so ranking never PICKED it either - this is
  // belt and suspenders, not a bug fix, and keeps it that way on purpose.
  const order = (isSelf
    ? []
    : want === 'auto'
      ? (pol.candidates || (balanced ? ['claude', 'codex'] : AUTO_CANDIDATES(run.host_vendor)))
      : [want]).filter((v) => v !== 'human');

  const attempts = [];
  const ranked = balanced && want === 'auto' ? rankCandidates(run, node, order)
    : order.map(vendor => ({ vendor, reason: 'explicit vendor/candidate order' }));
  for (const candidate of ranked) {
    const name = candidate.vendor;
    if ((run.unavailable_vendors || {})[name]) {
      attempts.push({ vendor: name, ready: false, reason: run.unavailable_vendors[name] });
      continue;
    }
    const model = balanced ? selectModel(run, node, name, pol.model) : pol.model;
    if (balanced && name === run.host_vendor) {
      // native_models declares actual model selection capability, independently from the
      // driving conversation's model. The defaults name a tier ("sonnet"); the host names
      // ids ("claude-sonnet-5") or aliases - resolve one against the other before refusing.
      // The host's own model is selectable by definition: a fresh native agent with no
      // model override inherits it. A tier the host did not declare at all falls back to
      // that model, and the reason says so - visible substitution, never a silent one, and
      // never a dead run over a naming mismatch.
      const resolved = resolveNativeModel(run, model);
      if (!resolved) {
        attempts.push({ vendor: name, ready: false, reason: `native host cannot select model ${model}` });
        continue;
      }
      const base = resolved.fallback ? `${candidate.reason}; model ${model} not in native_models, host model used` : candidate.reason;
      const rev = reviewerModel(run, node, resolved.model);
      return { vendor: 'self', executor: name, sandbox: null, model: rev.model, reason: `${base}${rev.note}`, attempts };
    }
    if (name === 'codex' && (run.host_vendor === 'codex' || process.env.CODEX_THREAD_ID)) {
      attempts.push({ vendor: name, ready: false, reason: 'Codex hosts must use native agents; nested Codex CLI is disabled' });
      continue;
    }
    const v = vendors[name];
    if (!v) {
      attempts.push({ vendor: name, ready: false, reason: `unknown vendor "${name}"` });
      continue;
    }
    // A reasoning node writes nothing, so it does not need a writable sandbox.
    const sandbox = REASONING_STAGES.has(stage)
      ? (Array.isArray(v.sandboxes) && v.sandboxes.includes('read-only') ? 'read-only' : pol.sandbox || v.default_sandbox)
      : pol.sandbox || v.default_sandbox || 'workspace-write';
    if (Array.isArray(v.sandboxes) && !v.sandboxes.includes(sandbox)) {
      attempts.push({ vendor: name, ready: false, reason: `vendor "${name}" does not support sandbox ${sandbox}` });
      continue;
    }
    const p = await probe(name, v, run.cwd, sandbox, model);
    const usable = REASONING_STAGES.has(stage) ? p.reachable : p.ready;
    // Spent capacity is recorded on the run so the operator sees why the vendor dropped
    // out, the run stops re-probing it, and team_retry({reset_capacity:true}) is the way back.
    if (!usable && p.quota) {
      run.unavailable_vendors = { ...(run.unavailable_vendors || {}), [name]: 'usage capacity exhausted at probe' };
      saveRun(run);
    }
    attempts.push({ vendor: name, ready: usable, reason: usable ? '' : p.reason });
    if (usable) return { vendor: name, executor: name, sandbox, model, reason: candidate.reason, attempts };
  }
  // "auto" degrades to self; a named vendor does not - silent degradation is what lets
  // a graph lie about who did the work.
  return { vendor: isSelf || (!balanced && want === 'auto') ? 'self' : 'vendor-failure', sandbox: null, model: pol.model, attempts };
}

// ---------- result normalization ----------

// A staged run returns a validated `result`; an unstaged one returns the model's reply
// verbatim in `last_message`, often wrapped in prose or a fenced block.
function entry(n) {
  return `${n.stage} node ${n.node_id}`;
}

function parseVendorResult(report) {
  if (!report) return null;
  const r = report.result;
  if (r && typeof r === 'object') return r;
  const raw = typeof r === 'string' && r ? r : String(report.last_message || '');
  if (!raw.trim()) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  for (const candidate of [fenced && fenced[1], raw, raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)]) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* try the next shape */
    }
  }
  // Flagged, not silently shaped: the reasoning branch decides stage_ok from the payload,
  // and an unflagged fallback has no stage_ok at all - which read as success. A vendor
  // replying "I could not do it." was being recorded as a completed node.
  return { _unparsed: true, handoff: raw.slice(0, 4000), evidence: 'vendor did not return parseable JSON' };
}

// The orchestrator gets this and nothing more.
function verdict(run, n) {
  const res = n.result || {};
  const out = {
    run_id: run.run_id,
    node_id: n.node_id,
    stage: n.stage,
    vendor: n.vendor,
    executor: n.executor,
    model: n.model,
    state: n.state,
    stage_ok: res.stage_ok === true,
  };
  if (VERDICT_FIELD[n.stage] === 'verified') out.verified = res.verified === true;
  if (n.stage === 'gate') {
    out.accept = res.accept === true;
    out.match_pct = res.match_pct;
    out.gap_count = (res.gaps || []).length;
    // Advisory, never blocking - but surfaced, or a run that passed with known
    // weaknesses reads exactly like one that had none.
    if ((res.observations || []).length) out.observation_count = res.observations.length;
    if ((res.spec_drift || []).length) out.spec_drift_count = res.spec_drift.length;
    if (!n.subgoal_id) out.attack_count = (res.attacks || []).length;
  }
  if (n.stage === 'critique') out.sound = res.sound === true;
  if (!REASONING_STAGES.has(n.stage)) {
    out.changed_files_verified = res.changed_files_verified === undefined ? null : res.changed_files_verified;
    out.change_attribution = res.change_attribution || null;
    if ((res.contradicted_files || []).length) out.contradicted_files = res.contradicted_files;
  }
  // Surface the fact that the broker overruled the executor. Without this the caller
  // sees a plain stage_ok=false and cannot tell a node that admitted failure from one
  // that claimed success and was caught.
  if (res.submitted_stage_ok === true && out.stage_ok !== true) out.submitted_stage_ok = true;
  // The opposite overrule: an author said stage_ok:false with nothing behind it and the work went on to be judged.
  if (res.self_reported_stage_ok === false) out.self_reported_stage_ok = false;
  if (n.state === 'failed' && res.stage_ok === true) {
    const field = VERDICT_FIELD[n.stage] || null;
    if (field && res[field] === undefined) out.missing_verdict = field;
  }
  if (res.reviewer_independence) out.reviewer_independence = res.reviewer_independence;
  if (res.killed_for) out.killed_for = res.killed_for;
  const reason = String(res.reason || res.verification_error || '');
  if (reason) out.reason = reason.slice(0, 300);
  out.detail_path = n.detail_path || null;
  return out;
}

// A gate that ran fine but REJECTED is not a completed dependency. On a gate, stage_ok
// means "the judging itself worked" and accept is the verdict; reading only stage_ok let
// a rejected subgoal flow downstream as if it had passed, which makes the gate
// decorative. Same shape for critique (sound) and test (verified).
function nodeSucceeded(run, n, result) {
  if (result.stage_ok !== true) return false;
  // The verdict must be present and affirmative. Accepting `!== false` let a missing
  // field pass: a vendor that returned an implement-shaped result for a test node, or a
  // gate that returned no verdict at all, sailed through. Absent evidence is not a pass -
  // which is exactly what these nodes are told.
  const field = VERDICT_FIELD[n.stage];
  // execute (the qa kind's chain only - graph.mjs's KINDS.qa) is the exception: its contract
  // (prompts.mjs) says plainly "verified=false with stage_ok=true means one or more cases
  // failed - list each in defects" - that is a successful execution of the case set, carrying
  // real defects forward to gate/reduce/report, not a failed check to retry. There is no
  // implement stage in this chain for a retry to fix, so treating verified:false as failure
  // retried `execute` against the SAME unchanged tree three times over (execute:U2:1..3,
  // execute:U5:1..3 in awake-beta-ref1, 2026-09-24) for the same real bug, exhausted the
  // subgoal's retry budget, left `gate` and `reduce` unreachable, and ended the whole QA child
  // run `blocked` with the defects it found nowhere to go. Only stage_ok:false - the case set
  // could not be run at all - is a genuine execute failure. Every other VERDICT_FIELD stage
  // (test, review, gate, critique) keeps the ordinary rule below: the verdict must be present
  // and affirmative, because for those a false verdict really does mean the work must be redone.
  if (field && n.stage !== 'execute' && result[field] !== true) return false;
  // A gate that accepts at 70% is reporting a partial result as a pass. The percentage was
  // already being collected and shown; the threshold is what makes it mean something. Only
  // the goal gate is held to it - a subgoal gate answers for its own slice, the goal gate
  // answers for the whole thing - and a run may set its own number, or 0 to go by verdict alone.
  if (n.stage === 'gate' && !n.subgoal_id && Number.isFinite(result.match_pct)) {
    const floor = Number.isInteger(run.goal_threshold) ? run.goal_threshold : 90;
    // Below the floor fails only when the judge named what is missing - the rule the manager's
    // own accept floor already follows (taskmanager.mjs succeeded()). awake-beta-ref2's planning
    // gate:goal:1 accepted at 88 with gaps:[] ("the remaining weaknesses are disclosed and do not
    // block"); the floor failed it anyway, the forced repair:1 added a detection signal to close a
    // weakness nobody had called blocking, and that signal became the blocker gate:goal:2 and :3
    // rejected - two repairs and a whole planning round spent on a defect the floor manufactured.
    // The pass without named gaps is a band, not a waiver: an accept at 70 with gaps:[] is a judge
    // contradicting itself, and still fails.
    const named = Array.isArray(result.gaps) && result.gaps.length > 0;
    const nearFloor = result.accept === true && !named && result.match_pct >= floor - 5;
    if (result.match_pct < floor && !nearFloor) return false;
  }
  // A rejection needs no evidence - "it does not meet the bar" stands on its own. An
  // acceptance does: today every gate in a run returned match_pct within a few points of
  // the others, a thermometer stuck at room temperature. accept:true with nothing in
  // checks[] is a guess wearing a verdict, and the engine refuses it the same way a
  // missing verdict field is refused above.
  if (n.stage === 'gate' && result.accept === true && !(Array.isArray(result.checks) && result.checks.length > 0)) {
    return false;
  }
  // The goal gate is the only node that can invoke the assembled result the way the
  // requester actually will - a fresh shell, an absolute-path call, `npm test` from the
  // project root, the README read as a stranger. `checks[]` alone let three gates pass
  // a CLI whose own "am I main" guard broke under macOS's /var -> /private/var symlink,
  // because every one of them read diffs and reran the subgoals' own test[] instead of
  // calling the artifact from outside the tree. Same refusal as an empty checks[].
  if (n.stage === 'gate' && !n.subgoal_id && result.accept === true
    && !(Array.isArray(result.attacks) && result.attacks.length > 0)) {
    return false;
  }
  return true;
}

// ---------- author != reviewer ----------
//
// A document is checked by reading it, and a reading by the hand that wrote it checks
// nothing: the author already believes every acceptance item is met. The gate has always
// had this rule as prose ("you are the judge, not the actor"); review gets it as
// enforcement, because here the broker can actually see both identities. Identity is
// executor + model. Two vendor runs on the same identity are refused - the node stays
// pending so the caller can route it elsewhere - rather than failed, which would burn a
// retry on a routing mistake. `self` is the driving session dispatching a fresh native
// agent, whose identity the broker cannot see: allowed, and marked as unverifiable.
function identityOf(executor, model) {
  return `${executor || 'self'}@${model || 'default'}`;
}

// The model axis, tried before the degradation above. When draft and review both land on the
// host (no peer vendor installed), they arrive on the same model by default and the reviewer is
// the author. If the host declared more than one native model, use a different one for the
// review - independence by model rather than by vendor. Returns the model to use and a phrase
// for the routing reason, because a substituted model must be visible in the run, never silent.
function reviewerModel(run, node, chosen) {
  if (node.stage !== 'review' && node.stage !== 'revise') return { model: chosen, note: '' };
  const kind = nodeKind(run, node);
  const author = run.nodes.find((x) => x.subgoal_id === node.subgoal_id
    && (x.attempt || 1) === (node.attempt || 1) && x.stage === authorStage(kind || 'subgoal'));
  const wrote = author && (author.model || (author.assignment && author.assignment.model));
  if (!wrote || wrote !== chosen) return { model: chosen, note: '' };
  const other = (Array.isArray(run.native_models) ? run.native_models.map(String) : []).find((m) => m !== wrote);
  if (!other) return { model: chosen, note: `; ${chosen} wrote the draft and the host declared no second native model, so this review is not independent` };
  return { model: other, note: `; ${chosen} wrote the draft, reviewing with ${other} instead` };
}

function reviewIndependence(run, n, executor, model) {
  // audit (planning-audit's own kind) makes the same demand review/revise do, but its author -
  // the PLAN package's draft/revise - never ran in THIS run: it ran in a sibling child run the
  // TaskManager folded away before this one ever opened (taskmanager.mjs's openAudit). There is
  // no in-run peer to look up, so openAudit reads that other run once, up front, and stashes its
  // author's identity here as `run.external_author` - this branch is the audit-side half of
  // that same cross-run independence check, recording rather than refusing: unlike review/revise
  // this never throws, because a caller who already committed to opening this run as its own
  // child (openChild) has no in-loop reroute the way team_run's retry-within-a-run does; a
  // routed-away vendor (routing.mjs's externalAuthorOf) is the "where possible" half, and this
  // is the "record it either way" half.
  if (n.stage === 'audit') {
    const ext = run.external_author;
    if (!ext) return null;
    const mine = identityOf(executor, model);
    const theirs = identityOf(ext.executor || ext.vendor, ext.model);
    if ((executor || 'self') === 'self' || (ext.executor || ext.vendor || 'self') === 'self') {
      return { independence: 'unverifiable-self', author: theirs, reviewer: mine };
    }
    if (mine === theirs) return { independence: 'unverifiable-same-host', author: theirs, reviewer: mine };
    return { independence: 'distinct-identity', author: theirs, reviewer: mine };
  }
  // revise (planning kind) makes the same "not the same identity as the author" demand
  // review does - the design doc's decision that a different identity revises. The
  // reviewer_independence field is still merged into the result only on the reasoning
  // branch below (team_run/team_submit); revise is not a reasoning stage, so only the
  // refusal (the throw below) applies to it, not the field.
  if (n.stage !== 'review' && n.stage !== 'revise') return null;
  const kind = nodeKind(run, n);
  const author = run.nodes.find((x) => x.subgoal_id === n.subgoal_id
    && (x.attempt || 1) === (n.attempt || 1) && x.stage === authorStage(kind || 'subgoal'));
  if (!author || !author.result) return null;
  const mine = identityOf(executor, model);
  const theirs = identityOf(author.executor || author.vendor, author.model);
  if ((executor || 'self') === 'self' || (author.executor || author.vendor || 'self') === 'self') {
    return { independence: 'unverifiable-self', author: theirs, reviewer: mine };
  }
  if (mine === theirs) {
    // Both escapes the message used to name are unreachable for a host-dispatched node: a
    // second vendor may not be installed at all (the bench's own arms are claude-only), and
    // team_run refuses a node routed to self - so a run that got here had no move left and
    // sat offering the same node forever. Measured 2026-09-17: three driver sessions in a row
    // hit exactly this on review:U5:1, each correctly gave up, and the run stalled at 16/20
    // with every artifact already written.
    //
    // The design's independence comes from draft going to a peer vendor while review stays on
    // the host (routing.mjs's EXECUTION_STAGES comment: "without anyone arranging it"). When
    // there is no peer, draft degrades to the host and that arrangement silently collapses.
    // Model is then the only axis left, and route() now tries it first (see reviewerModel).
    // If even that is gone - one declared model, or none - the honest answer is the one this
    // file already gives everywhere else: degrade visibly rather than deadlock. The review
    // runs, and `reviewer_independence` says it was not independent, so the report and anyone
    // reading the run can see exactly what the verdict is worth.
    if ((n.assignment && n.assignment.vendor === 'self') || (executor || 'self') === 'self') {
      return { independence: 'unverifiable-same-host', author: theirs, reviewer: mine };
    }
    throw new Error(`${n.stage} ${n.node_id} is routed to ${mine}, which wrote ${author.node_id}. `
      + `A document must be read or revised by someone other than its author: route the ${n.stage} stage to another vendor `
      + `(policy.${n.stage}).`);
  }
  return { independence: 'distinct-identity', author: theirs, reviewer: mine };
}

// The feedback is whatever judged the attempt last: a gate's gaps, or - when the attempt
// never reached its gate - the check that failed it. A review that listed what the text
// lacks, or a test that printed the failing command, is the feedback the next draft or
// implement needs; carrying only gate verdicts sent it in blind.
function subgoalFeedback(run, sid) {
  const judged = run.nodes.filter((n) => n.subgoal_id === sid && n.result && (n.stage === 'gate' || n.state === 'failed'));
  const last = judged[judged.length - 1];
  // A goal gate that rejected the assembled result names what the run as a whole lacks; the
  // subgoal being retried for it must hear that too, since its own gate passed.
  const goal = run.nodes.filter((n) => n.stage === 'gate' && n.subgoal_id === null && n.state === 'failed' && !n.final && n.result).pop();
  return [
    ...(last && last.result
      ? [last.result.reason || '', ...(last.result.gaps || []), ...(last.result.verified === false ? (last.result.checks || []) : [])]
      : []),
    ...(goal ? [`goal gate ${goal.node_id}: ${goal.result.reason || 'rejected'}`, ...(goal.result.gaps || [])] : []),
  ].filter(Boolean).join('\n- ');
}

// A rejected quality gate reassigns the subgoal itself. Leaving the next attempt to the
// caller made the rejection advisory: a session that did not call team_retry simply
// stopped, and the gate's gaps went nowhere. The engine opens the next attempt instead,
// carrying the same feedback team_retry would have carried, and settles when the budget
// is gone exactly as before. The goal gate is not included - its rejection blames the
// assembled result, not one subgoal, and choosing which subgoal to reopen is a judgement
// the manager makes.
// A rejection, reduced to what it actually objected to. Two attempts that fail on the same
// signature are not converging: the work is being asked for something it cannot produce
// where it stands, and a third attempt spends budget to learn that again.
function rejectionSig(result) {
  if (!result) return '';
  const gaps = [...(result.gaps || []), ...(result.blocking || [])].map((g) => String(g).trim().toLowerCase());
  return [String(result.reason || '').trim().toLowerCase(), ...gaps.sort()].filter(Boolean).join('|');
}

// The rejection this subgoal's previous attempt died on, if it had one.
function priorSig(run, sid, attempt) {
  const prior = run.nodes
    .filter((x) => x.subgoal_id === sid && x.state === 'failed' && (x.attempt || 1) === attempt - 1 && x.result)
    .pop();
  return prior ? rejectionSig(prior.result) : '';
}

// A goal-gate round's rejection, reduced to what it actually objected to - the same
// shape rejectionSig gives a subgoal, but over the union the whole round agreed on
// (gaps and spec_drift both name a shortfall) rather than one judge's reason line,
// which the round's judges will not have worded identically even when they mean the
// same thing.
function goalRejectionSig(consensus) {
  const gaps = [...(consensus.gaps || []), ...(consensus.spec_drift || [])].map((g) => String(g).trim().toLowerCase());
  return gaps.sort().join('|');
}

// repair's briefing: the goal is already in nodeBriefing's `goal`/`goal_acceptance`,
// and the whole run's nodes arrive via the `whole_run` branch it now shares with the
// goal gate - so what repair needs here is the round's own verdict (the reason the
// generic upstream/whole_run views cannot carry, since consensus is computed across
// several nodes, not read off one) and a size-bounded pointer into every subgoal's
// handoff. Unsliced, a run of a dozen subgoals would hand repair a briefing as large
// as the run itself - the same shape of problem handoffOf's 1500-character cap solved
// one level down, and just as uncredited if it silently works.
const REPAIR_HANDOFF_CAP = 1500;
function repairBriefing(run, consensus) {
  const lines = [];
  lines.push(`goal gate round ${consensus.round} rejected the assembled result: every judge must accept at or above the run's threshold, and did not.`);
  if (consensus.gaps.length) lines.push(`Gaps (union across judges):\n- ${consensus.gaps.join('\n- ')}`);
  if (consensus.spec_drift.length) lines.push(`Spec drift (the request asked for this, the spec never turned it into a criterion):\n- ${consensus.spec_drift.join('\n- ')}`);
  const subgoals = (run.spec && run.spec.subgoals) || [];
  for (const sg of subgoals) {
    // Every kind's chain ends in `gate` (subgoal: implement/test/gate; document:
    // draft/review/gate), so the subgoal's own gate is always this stage name -
    // no need to look up the kind to find it.
    const gates = run.nodes.filter((n) => n.subgoal_id === String(sg.id) && n.stage === 'gate' && n.result);
    const last = gates.at(-1);
    const handoff = last && last.result ? String(last.result.handoff || '') : '';
    const sliced = handoff.length > REPAIR_HANDOFF_CAP
      ? `${handoff.slice(0, REPAIR_HANDOFF_CAP)} …[truncated at ${REPAIR_HANDOFF_CAP} chars]`
      : handoff;
    lines.push(`Subgoal ${sg.id} (${sg.title}) handoff: ${sliced || '(none recorded)'}`);
  }
  lines.push('Fix across the tree at the seams these gaps point to - several subgoals may own the files involved, which is the point: a gap here is usually in what is between them, not inside any one of them. Do not restate the goal-level acceptance criteria to fit what already exists; the gate that follows judges them unchanged.');
  return lines.join('\n');
}

// The goal-gate branch of autoReassign. A rejected subgoal gate reassigns the subgoal;
// a rejected goal-gate ROUND has no single subgoal to blame - the failure is usually in
// the seam between subgoals that each met their own acceptance - so it opens a repair
// pass over the assembled result instead (Step 9). Consensus, not one judge: the round
// is not decided until every sibling has a terminal state, and a peer that could not
// judge at all is a routing failure for the caller, not a verdict to repair.
function autoReassignGoalGate(run, n) {
  if (run.auto_reassign === false) return null;
  if (n.final) return null;
  const round = goalRoundOf(n.node_id);
  if (round == null) return null;
  const siblings = goalGateSiblings(run, round);
  if (siblings.some((s) => s.state === 'pending' || s.state === 'running')) return null; // wait for the rest of the round
  // A later round already exists means this one was already handled - by a prior call
  // of this same function for a sibling that finished after this one, or before it.
  if (run.nodes.some((x) => x.stage === 'gate' && x.subgoal_id === null && goalRoundOf(x.node_id) === round + 1)) return null;

  const consensus = goalConsensus(run, round);
  if (!consensus || consensus.routing_failure || !consensus.settled) return null; // a peer's transport/vendor failure - the caller's problem
  if (consensus.accept) return null; // every judge accepted at or above the threshold

  for (const s of siblings) s.final = true;

  const sig = goalRejectionSig(consensus);
  if (sig && sig === run.last_goal_sig) {
    saveRun(run);
    record(run.cwd, { event: 'team_settle', run_id: run.run_id, target: 'goal_gate', round, signature: sig, stalled: true });
    return { round, stalled: true };
  }
  run.last_goal_sig = sig;

  const feedback = repairBriefing(run, consensus);
  const out = openRepair(run, round, feedback, run.goal_judges || siblings.length);
  record(run.cwd, {
    event: out.attempt ? 'team_repair' : 'team_settle',
    run_id: run.run_id, target: 'goal_gate', round,
    ...(out.attempt ? { attempt: out.attempt, repair_id: out.repair_id } : { reason: out.reason }),
  });
  return out.attempt
    ? { round, repaired: { attempt: out.attempt, repair_id: out.repair_id } }
    : { round, stalled: false, settled: true, reason: out.reason };
}

function autoReassign(run, n) {
  if (n.stage === 'gate' && n.subgoal_id === null) return autoReassignGoalGate(run, n);
  if (run.auto_reassign === false) return null;
  // A critique's rejection (`sound: false`) has no subgoal to reassign - the spec itself
  // is the defect. Escalate straight to retrySpec, the same move a subgoal takes below
  // after two identical rejections: it opens a fresh setgoal+critique pair, so the
  // re-authored spec is critiqued again rather than waved through the way a one-shot
  // critic would. Budgeted the same way too - retrySpec caps at max_retries + 1 attempts
  // and settles, leaving the rejection for the caller, when that budget is gone.
  if (n.stage === 'critique' && !n.final) {
    if (n.state !== 'failed') return null;
    if (n.result && n.result.stage_ok !== true) return null;
    if (!n.result || n.result.sound !== false) return null;
    const feedback = [n.result.reason || '', ...(n.result.blocking || [])].filter(Boolean).join('\n- ')
      || 'critique found the spec unsound (sound: false)';
    const out = retrySpec(run, feedback);
    // retrySpec's own cleanup sweeps every setgoal/critique node still `pending` or
    // `failed` to `skipped` as "superseded by spec attempt N" - including THIS node,
    // since it is a critique node too. That is right for a stale prior attempt; it is not
    // right for the node that just ran and whose own verdict this call is about to return.
    // Put it back the way finishNode left it before handing back to verdict().
    n.state = 'failed';
    saveRun(run);
    record(run.cwd, {
      event: out.attempt ? 'team_escalate' : 'team_settle',
      run_id: run.run_id, rejected_by: n.node_id,
      ...(out.attempt ? { attempt: out.attempt } : { unreachable: out.unreachable.length }),
    });
    return { ...out, escalated: true };
  }
  if (!n.subgoal_id || n.final) return null;
  if (!VERDICT_FIELD[n.stage]) return null;
  if (n.state !== 'failed') return null;
  // Only the verdict reassigns. A node that could not run at all (transport, vendor,
  // malformed output) is a different failure and keeps its existing path.
  if (n.result && n.result.stage_ok !== true) return null;
  const sid = String(n.subgoal_id);

  // Same objection twice: retrying the subgoal again would ask the same author, in the same
  // worktree, for the same thing. Escalate to the line that can actually change the answer -
  // setgoal and critique - carrying what the subgoal kept failing on. goal-docs is the case
  // this exists for: a package README truthfully said "the repo has no other docs", which was
  // false only in the combined tree, so no attempt inside that package could ever fix it.
  const sig = rejectionSig(n.result);
  if (sig && sig === priorSig(run, sid, n.attempt || 1)) {
    const out = retrySpec(run, `subgoal ${sid} was rejected twice for the same reason, so the shape is what has to change, not the work:\n- ${subgoalFeedback(run, sid)}`);
    record(run.cwd, {
      event: out.attempt ? 'team_escalate' : 'team_settle',
      run_id: run.run_id, subgoal_id: sid, rejected_by: n.node_id, signature: sig,
      ...(out.attempt ? { attempt: out.attempt } : { unreachable: out.unreachable.length }),
    });
    return { ...out, escalated: true };
  }

  const out = retrySubgoal(run, sid, subgoalFeedback(run, sid));
  if (out.attempt) out.rollback = applyRollback(out.run, out.rollback, sid);
  record(run.cwd, {
    event: out.attempt ? 'team_reassign' : 'team_settle',
    run_id: run.run_id, subgoal_id: n.subgoal_id, rejected_by: n.node_id,
    ...(out.attempt ? { attempt: out.attempt } : { unreachable: out.unreachable.length }),
  });
  return out;
}

export function finishNode(run, n, result, vendorName) {
  delete n.recovery; // historical interruptions remain in n.interruptions
  // A gate that says accept with nothing in checks[] did not fail the work - it failed to
  // do its own job. That is a defect in the judging, not a verdict on the subgoal, so it
  // must read as one and it must not autoReassign the subgoal the way a real rejection
  // does (autoReassign skips a node whose stage_ok did not come back true - see below).
  // The gate itself is retried the ordinary way: team_retry({subgoal_id}) - the engine has
  // no path that reruns a gate alone, so that rebuilds the whole chain, gate included.
  const noChecks = n.stage === 'gate' && result.accept === true
    && !(Array.isArray(result.checks) && result.checks.length > 0);
  // Same rule, one level up: the goal gate accepting with no `attacks[]` judged nothing
  // outside the tree - see nodeSucceeded.
  const noAttacks = n.stage === 'gate' && !n.subgoal_id && result.accept === true
    && !(Array.isArray(result.attacks) && result.attacks.length > 0);
  const gateNoEvidence = noChecks || noAttacks;
  // An authoring node's own stage_ok is not a verdict on its work - the chain's test and gate
  // are. An author that reports stage_ok:false with no reason, no error and only passing checks
  // has mis-set a flag, not failed: trap-beta-T2's P3 did exactly that twice ("66 tests, 66
  // pass, 0 fail", "clean working tree after commit", stage_ok:false) and each time the chain
  // treated the self-report as final, made the gate unreachable, blocked the child and sent
  // the whole package back to attempt 1. The flag is kept on the result for the gate to see,
  // and the work goes on to be judged. A stated reason, an error, or a failing check is honoured.
  if (!REASONING_STAGES.has(n.stage) && result.stage_ok === false && !result.reason && !result.error
    && !result.verification_error && !(result.contradicted_files || []).length && result.submitted_stage_ok !== true) {
    const checks = Array.isArray(result.checks) ? result.checks : [];
    const failing = checks.some((c) => /\b(fail(ed|ing|s)?|error|ENOENT|exit(ed)? [1-9]|not ok)\b/i.test(String(c)) && !/\b0 fail/i.test(String(c)));
    if (!failing) {
      result = {
        ...result, stage_ok: true, self_reported_stage_ok: false,
        stage_ok_note: 'author reported stage_ok:false with no reason and no failing check; the test and gate nodes judge the work, not the author',
      };
    }
  }
  n.state = nodeSucceeded(run, n, result) ? 'done' : 'failed';
  if (gateNoEvidence && n.state === 'failed') {
    result = { ...result, stage_ok: false, reason: noChecks
      ? 'gate accepted without a check; a judgement with no evidence is a guess'
      : 'goal gate accepted without an attack; a judgement never invoked from outside the tree is a guess' };
  }
  n.result = result;
  n.vendor = vendorName;
  n.finished_at = Date.now();

  // setgoal is the only node that changes the shape of the graph. Expanding here keeps
  // the spec out of the orchestrator entirely - but only for a spec that can actually
  // be expanded. A bad one is failed here with its defects as the reason, so the normal
  // spec-retry loop carries them into the next attempt instead of deadlocking later.
  // plan is where an `auto` run learns its flow and size. A plan that names neither is
  // not failed - the earlier contract never asked - it falls to the develop flow, and the
  // record says the choice was defaulted rather than made.
  if (n.stage === 'plan' && n.state === 'done') {
    if (run.flow === 'auto') {
      const chosen = FLOWS[result.flow] ? result.flow : DEFAULT_FLOW;
      run.flow_chosen = chosen;
      run.flow_source = FLOWS[result.flow] ? 'plan' : 'default';
    }
    run.size = ['S', 'L'].includes(result.size) ? result.size : null;
  }
  if (n.stage === 'setgoal' && n.state === 'done') {
    const spec = normalizeSpec(run, result.spec);
    const problems = validateSpec(spec, { kind: defaultKind(run), mixed: run.mixed, flow: flowOf(run) });
    if (problems.length) {
      n.state = 'failed';
      n.result = { ...result, stage_ok: false, spec_problems: problems, reason: `unusable spec: ${problems.join('; ')}` };
    } else {
      run.spec = spec;
      n.result = { ...result, spec };
      expandSubgoals(run, spec.subgoals);
    }
  }
  // investigate is the second node that can change the shape of the graph, and for the same
  // reason setgoal is the first: it produces something the rest of the chain has to be built
  // around. An unknown that names candidate answers is a decision, not a research gap - so an
  // interactive run opens an `ask` card for it (parked on a human, never polled for a model)
  // and draft consumes the answer instead of the question. A non-interactive run records the
  // same questions on run.unasked, which is what makes "we decided this by default, and here
  // is what we would have asked" legible in the report instead of invisible in the document.
  if (n.stage === 'investigate' && n.state === 'done') {
    const decidable = (Array.isArray(result.unknowns) ? result.unknowns : [])
      .filter((u) => u && (u.question || u.unknown) && Array.isArray(u.options) && u.options.length > 1);
    if (decidable.length) {
      if (run.interactive) {
        for (const askId of openAsk(run, n, decidable)) writeHumanBriefing(run, getNode(run, askId));
      }
      else run.unasked = [...(run.unasked || []), ...decidable.map((u) => ({
        subgoal_id: n.subgoal_id, question: u.question || u.unknown, owner: u.owner || null, options: u.options,
      }))];
    }
  }
  // Deterministic sibling write-scope check (item 2 of the reducer plan): recorded onto the
  // fold's own persisted result, not only shown in the briefing gate:goal reads afterward - so
  // a collision or undeclared writer this run's own `reduce` LLM pass missed is still on disk,
  // and foldChild (taskmanager.mjs) can carry it up into set_findings regardless of whether the
  // model noticed the same thing in prose.
  if (n.stage === 'reduce' && n.state === 'done') {
    n.result = { ...n.result, write_scope: computeWriteScope(run, n) };
  }
  // D2 slice 3 (0.29.0): the same treatment, generalized past investigate's own unknowns[] -
  // any stage's contract may return `questions[]` ({question, to, options?, default, why}, see
  // openAsk's own comment) and the engine opens the same kind of card for it. Kept as a second
  // block, not folded into the one above, so investigate's own unknowns[] (and its report shape
  // on run.unasked) stay exactly as they were for every existing caller and test.
  if (n.state === 'done' && Array.isArray(result.questions) && result.questions.length) {
    const decidable = result.questions.filter((q) => q && q.question
      && ((Array.isArray(q.options) && q.options.length > 1) || q.default !== undefined));
    if (decidable.length) {
      if (run.interactive) {
        for (const askId of openAsk(run, n, decidable)) writeHumanBriefing(run, getNode(run, askId));
      } else {
        run.unasked = [...(run.unasked || []), ...decidable.map((q) => ({
          subgoal_id: n.subgoal_id, node_id: n.node_id, stage: n.stage,
          question: q.question, owner: q.to || null, options: q.options || null,
          decided: q.default !== undefined ? q.default : null, why: q.why || null,
        }))];
      }
    }
  }
  // One save, after autoReassign: a rejected gate and the retry chain it opens must land on
  // disk together. Saved separately, the run is 'blocked' on disk for the gap between the two
  // writes, and a reader woken by fs.watch on the first rename (the task-manager daemon's
  // dispatchSettled) folds the dispatch as failed while this driver is already on attempt 2 -
  // seam-silent-beta-E1 (2026-09-21) lost P1 exactly there.
  const reassigned = autoReassign(run, n);
  saveRun(run);
  syncOpenNodes(run);
  record(run.cwd, { event: 'node_finish', run_id: run.run_id, node_id: n.node_id, stage: n.stage, vendor: vendorName, stage_ok: n.result.stage_ok === true });
  const out = verdict(run, n);
  if (reassigned) {
    if (reassigned.repaired || reassigned.stalled !== undefined) {
      // Goal-gate consensus rejected the round: a repair pass opens over the assembled
      // result rather than reassigning a subgoal, or the run is stalled on a repair
      // that closed the same gaps twice. As visible as `reassigned` is for a subgoal.
      if (reassigned.repaired) out.repaired = reassigned.repaired;
      if (reassigned.stalled) {
        out.stalled = { reason: 'repair rejected the same gaps twice; the run proceeds to report on partial work' };
      } else if (reassigned.stalled === false && reassigned.settled) {
        out.repaired = { attempt: null, reason: reassigned.reason };
      }
    } else {
      const where = reassigned.escalated ? 'spec' : 'subgoal';
      out.reassigned = reassigned.attempt
        ? { target: where, subgoal_id: n.subgoal_id, attempt: reassigned.attempt,
            ...(reassigned.escalated ? { reason: 'the same rejection twice: reshaped rather than retried' } : {}) }
        : { target: where, subgoal_id: n.subgoal_id, attempt: null, reason: reassigned.reason, unreachable: reassigned.unreachable };
    }
    if (reassigned.rollback) out.rollback = reassigned.rollback;
  }
  return out;
}

function checkpointInterruption(run, n, executor, details, kind = 'quota') {
  const dir = join(brokerDir(run.cwd), run.run_id, n.node_id.replace(/[^A-Za-z0-9._-]/g, '_'), `recovery-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'checkpoint.json');
  const detailPath = join(dir, 'interrupted-result.json');
  writeFileSync(detailPath, JSON.stringify(details, null, 2));
  writeFileSync(path, JSON.stringify({ node_id: n.node_id, executor, kind, cwd: run.cwd,
    detail_path: detailPath, previous_detail_path: n.detail_path || null,
    previous_checkpoint: n.recovery?.checkpoint_path || null,
    run_path: join(brokerDir(run.cwd), 'runs', `${run.run_id}.json`),
    changed_files: (gitChanged(run.cwd) || []).filter(p => !p.startsWith('.teams_output/')),
    instruction: 'Inspect the current files before continuing. Partial writes are not verified completion. Keep original acceptance criteria; rerun verification.' }, null, 2));
  n.recovery = { checkpoint_path: path, executor, kind, from_ticket: n.ticket || null };
  n.interruptions = [...(n.interruptions || []), n.recovery];
  n.result = { stage_ok: false, reason: `${executor} ${kind}; work retained at ${path}` };
  n.vendor = executor;
  n.state = 'pending';
  n.ticket = null;
  delete n.assignment;
  if (kind === 'quota') run.unavailable_vendors = { ...(run.unavailable_vendors || {}), [executor]: 'usage capacity exhausted in this run' };
  saveRun(run);
  syncOpenNodes(run);
  record(run.cwd, { event: 'node_interrupted', run_id: run.run_id, node_id: n.node_id, executor, kind, checkpoint_path: path });
  return { ...verdict(run, n), recoverable: true, checkpoint_path: path, next: 'call team_next for fallback; team_retry with node_id and reset_capacity after quota renewal' };
}

// ---------- tools ----------

// Declared so a client can validate what comes back rather than trusting shape by
// convention. These describe the VERDICT surface deliberately: the payload - spec,
// handoffs, evidence, changed-file lists - never crosses this boundary.
const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    run_id: { type: 'string' },
    node_id: { type: 'string' },
    stage: { type: 'string' },
    vendor: { type: 'string' },
    executor: { type: 'string', description: 'assigned AI vendor, including native host execution' },
    model: { type: ['string', 'null'], description: 'assigned model' },
    recoverable: { type: 'boolean' },
    checkpoint_path: { type: 'string' },
    next: { type: 'string' },
    state: { type: 'string', enum: ['pending', 'running', 'done', 'failed', 'skipped', 'unreachable'] },
    stage_ok: { type: 'boolean' },
    verified: { type: 'boolean', description: 'test nodes' },
    accept: { type: 'boolean', description: 'gate nodes' },
    match_pct: { type: 'number', description: 'gate nodes' },
    gap_count: { type: 'number', description: 'gate nodes' },
    observation_count: { type: 'number', description: 'gate nodes: non-blocking weaknesses' },
    spec_drift_count: { type: 'number', description: 'goal gate: where the spec asked less than the request' },
    sound: { type: 'boolean', description: 'critique nodes' },
    changed_files_verified: { type: ['boolean', 'null'], description: 'null means could not attribute - not a pass' },
    change_attribution: { type: ['string', 'null'], enum: ['isolated', 'shared-worktree', 'no-git', 'document-unchanged', null] },
    reviewer_independence: { type: 'string', enum: ['distinct-identity', 'unverifiable-self'], description: 'review and revise nodes: whether the broker could see that the reviewer is not the draft author' },
    contradicted_files: { type: 'array', items: { type: 'string' } },
    submitted_stage_ok: { type: 'boolean', description: 'present when the broker overruled the executor' },
    self_reported_stage_ok: { type: 'boolean', description: 'present (false) when an authoring node reported stage_ok:false with no reason and no failing check, and the broker let the chain judge the work instead' },
    missing_verdict: { type: 'string', description: 'the verdict field the node failed to return' },
    killed_for: { type: 'string', enum: ['timeout', 'cancelled'] },
    reason: { type: 'string' },
    detail_path: { type: ['string', 'null'], description: 'read this for one node only; never pull a whole run into context' },
  },
  required: ['node_id', 'stage', 'state', 'stage_ok'],
};

const READY_SCHEMA = {
  type: 'object',
  properties: {
    run_id: { type: 'string' },
    cwd: { type: 'string' },
    state: { type: 'string', enum: ['running', 'blocked', 'complete'] },
    counts: { type: 'object' },
    flow: { type: 'string', description: 'the flow the run is in: fixed by the entry, chosen by plan, or still "auto" before plan ran' },
    size: { type: 'string', enum: ['S', 'L'], description: 'what plan measured; absent before plan ran or when it did not say' },
    ready: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          node_id: { type: 'string' },
          stage: { type: 'string' },
          vendor: { type: 'string' },
          executor: { type: 'string' },
          model: { type: 'string' },
          routing_reason: { type: 'string' },
          attempts: { type: 'array', items: { type: 'object' } },
          briefing_path: { type: 'string', description: 'self-routed nodes only' },
          next: { type: 'string' },
        },
        required: ['node_id', 'stage', 'vendor'],
      },
    },
  },
  required: ['run_id', 'state', 'ready'],
};

const STATUS_SCHEMA = {
  type: 'object',
  properties: {
    run_id: { type: 'string' },
    cwd: { type: 'string' },
    state: { type: 'string', enum: ['running', 'blocked', 'complete'] },
    counts: { type: 'object' },
    goal_verdict: { type: 'object', description: 'the most recent goal-gate round\'s consensus, once every judge has settled: {accept, match_pct (min across judges), judges: [{node_id, state, accept, match_pct, identity}], gaps, spec_drift}' },
    has_spec: { type: 'boolean' },
    subgoals: { type: 'array', items: { type: 'string' } },
    nodes: { type: 'array', items: { type: 'object' } },
    cwds: { type: 'array', items: { type: 'string' }, description: 'overview form only' },
    runs: { type: 'array', items: { type: 'object' }, description: 'overview form only: one row per run, newest first' },
    config_notes: { type: 'array', items: { type: 'string' }, description: 'present only when .claude/team.json had an unrecognized key or a value that failed its validator - each note names the key and what was wrong with it' },
  },
};

const RETRY_SCHEMA = {
  type: 'object',
  properties: {
    run_id: { type: 'string' },
    target: { type: 'string', description: 'a subgoal id, "spec", or "goal_gate"' },
    retried: { type: 'boolean' },
    attempt: { type: 'number' },
    repair_id: { type: 'string', description: 'present when target is "goal_gate": the repair node opened' },
    reason: { type: 'string' },
    unreachable: { type: 'array', items: { type: 'string' }, description: 'retried=false with the budget gone: nodes that can never run now, so the report is released' },
    state: { type: 'string' },
    ready: { type: 'array', items: { type: 'object' } },
  },
  required: ['run_id', 'retried'],
};

const TOOLS = [
  {
    name: 'team_open',
    description:
      'Throw a raw request at the broker. It builds the harness flow as a node graph on disk and returns a run_id plus the first ready node. Nothing else about the run enters your context.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string', description: 'the raw request, verbatim' },
        cwd: { type: 'string', description: 'absolute working directory for the whole run' },
        context: { type: 'string' },
        vendor: { type: 'string', description: '"auto" (default, stays on self unless candidates are given), a vendor name to require it, or "self"' },
        allocation: { type: 'string', enum: ['ordered', 'balanced'], description: 'balanced discovers Claude/Codex, scores stage fit, review independence, load and execution errors; ordered preserves legacy candidate order' },
        host_vendor: { type: 'string', enum: ['claude', 'codex'], description: 'Host with fresh native agents; selected host work returns self with executor identity. Omit if native role isolation is unavailable.' },
        host_model: { type: 'string', description: 'Current driving model, used for reasoning on the host. Fable/Astra require explicit model policy; they are not inherited automatically.' },
        native_models: { type: 'array', items: { type: 'string' }, description: 'Models selectable by fresh native agents. Omit only if the host can select all requested models; unsupported assignments fail visibly.' },
        model: { type: 'string', description: 'default model for every stage; a policy entry overrides it' },
        policy: {
          type: 'object',
          description:
            'Per-stage routing: {"plan":{"vendor":"self","model":"opus"},"implement":{"vendor":"codex"},"report":{"model":"sonnet"}}. Keys are stage names (plan, setgoal, critique, implement, test, draft, review, gate, report) plus the optional "gate:goal". A document subgoal review must not run on the identity that drafted it; give review its own vendor or model here. Each entry may set vendor, candidates, sandbox, model. A stage entry wins over the run-level setting.',
        },
        candidates: { type: 'array', items: { type: 'string' }, description: 'vendor preference order for "auto"' },
        sandbox: { type: 'string' },
        isolated: { type: 'boolean', description: 'cwd is a private worktree with only this run in it' },
        interactive: { type: 'boolean', description: 'default false, also settable in .claude/team.json. When a planning subgoal\'s investigate stage returns an unknown that names candidate answers, true opens an `ask` card (ask:<subgoal>:<attempt>) between investigate and draft and parks the run in waiting_human until a person picks - tm_inbox lists it, tm_submit({key, payload:{decisions}}) answers it, exactly like any other human card. false decides by default and records what it would have asked on run.unasked instead, so the report can show the questions nobody was asked.' },
        goal_threshold: { type: 'integer', description: 'default 90: the goal gate must report match_pct at or above this to accept. A gate that says accept with 70% match is reporting a partial result as a pass; the number it already returns is made to mean something. 0 accepts on the verdict alone.' },
        goal_judges: { type: 'integer', description: 'default 2: independent judges on the goal gate. Each round opens that many sibling gate nodes (gate:goal:<round>, gate:goal:<round>b, ...) over the same subgoal gates, routed to different identities where possible. The run accepts only if EVERY judge accepts at or above goal_threshold; gaps and spec_drift are the union. 1 reproduces the single-judge behaviour every earlier run had. A rejected round opens a repair pass over the assembled result (team_retry({repair:true}) forces one) rather than reassigning a subgoal.' },
        auto_reassign: { type: 'boolean', description: 'default true: a rejected subgoal gate, review or test opens the next attempt itself, carrying the rejection feedback, and settles when the budget is gone. false leaves the next attempt to team_retry, which makes a rejection advisory - a caller that never retries simply stops.' },
        max_retries: { type: 'number' },
        flow: { type: 'string', enum: ['auto', 'develop', 'document'], description: 'auto (default): plan decides from the request. develop: subgoals default to code work. document: subgoals default to written artifacts. Set by the entry skill, not by the user.' },
        mixed: { type: 'boolean', description: 'default true. false: every subgoal must be the flow\'s kind; a spec that mixes kinds fails at setgoal.' },
        skills: { description: 'Method per engine stage, overriding the defaults: {"plan": ["agents:agent-task-decomposer"], "critique": []}. Keys are plan, critique, test, review, gate, plus the optional gate:goal. false runs every one of those stages on its contract alone. A skill named here must be analytic and non-dialogic - a node runs headless and cannot answer a skill that asks it something.' },
        mounts: { description: 'Advisory MCP tools per engine stage, overriding the defaults: {"plan": ["mcp__sequential-thinking__sequentialthinking"]}. Keys are plan, setgoal, plus the optional gate:goal. false offers none of them. A tool named here that is not connected is skipped in silence, never searched for.' },
        retry_policy: { type: 'string', enum: ['continue', 'rollback'], description: 'default "continue", also settable in .claude/team.json. What team_retry (or autoReassign\'s own automatic retry) does with the worktree a rejected implement/draft/cases/audit attempt left. "continue" (default, today\'s only behavior) builds the next attempt on top of it. "rollback" resets the worktree to the checkpoint broker.mjs recorded before that subgoal\'s OWN FIRST attempt touched it, then re-runs with the failed gate\'s gaps as feedback - only when this run has exactly one subgoal (a shared worktree with a sibling subgoal still working in it cannot be reset for one of them without discarding the other\'s progress too; team_retry\'s reply names why it fell back to continue when that guard trips). docs/plans/2026-09-23-teams-reducer-human-rollback.md §5 measured two real runs before defaulting to continue: both showed a retried implement CONVERGING on gate feedback across attempts (52%->60%->78%) rather than repeating the same mistake.' },
      },
      required: ['request', 'cwd'],
    },
    outputSchema: READY_SCHEMA,
  },
  {
    name: 'team_next',
    description:
      'Ask which node to run next. Returns node ids, stages, and their routing - never the goal-spec, handoffs, or evidence. For a node routed to "self" it returns a briefing_path to read; for a vendor node you do not need to read anything.',
    inputSchema: {
      type: 'object',
      properties: { run_id: { type: 'string' }, cwd: { type: 'string' } },
      required: ['run_id'],
    },
    outputSchema: READY_SCHEMA,
  },
  {
    name: 'team_run',
    description:
      'Execute one node with its routed vendor and return a one-line verdict. The broker composes the prompt from graph state - you do not pass one. Blocks until the vendor exits: do not background it, do not poll.',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        node_id: { type: 'string' },
        cwd: { type: 'string' },
        model: { type: 'string' },
        add_dirs: { type: 'array', items: { type: 'string' } },
      },
      required: ['run_id', 'node_id'],
    },
    outputSchema: VERDICT_SCHEMA,
  },
  {
    name: 'team_submit',
    description:
      'Record a node you executed yourself. Same adjudication a vendor result gets: claimed changed_files are cross-checked against the worktree, and stage_ok comes back adjudicated, never raised. Idempotent per {run_id, node_id, attempt}: a node_id already carries its attempt number in most stages (implement:U1:2), so a duplicate call for a node that has already finished - the same request arriving twice, a retried MCP call - is a no-op that returns the stored verdict (`idempotent: true`) instead of erroring or re-adjudicating. Pass `attempt` when you have it for a stricter check (rejected if it does not match the node\'s own attempt).',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        node_id: { type: 'string' },
        cwd: { type: 'string' },
        attempt: { type: 'integer', description: 'this node\'s attempt number, for the idempotency check above. Optional - node_id already disambiguates attempts for every retryable stage.' },
        payload: {
          type: 'object',
          description:
            'the stage JSON contract for this node (implement/test/gate/etc). Passed through to the graph and never echoed back to you.',
        },
      },
      required: ['run_id', 'node_id', 'payload'],
    },
    outputSchema: VERDICT_SCHEMA,
  },
  {
    name: 'team_retry',
    description:
      'Open a fresh attempt, carrying the rejection feedback forward. With subgoal_id, retries that subgoal. Without it, retries the spec itself (setgoal + critique) and discards the subgoal graph the rejected spec produced. The failed attempt stays in the graph as evidence. When the retry budget is gone the failure is settled instead: every node that needed its output becomes `unreachable`, and the report - which only waits for the goal gate to finish, not to pass - becomes ready to write the partial account.',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        subgoal_id: { type: 'string', description: 'omit to retry the spec after a critique rejected it' },
        node_id: { type: 'string', description: 'Resume an interrupted/quota-exhausted node, retaining files and checkpoint. Does not reopen a completed or gate-rejected node.' },
        reset_capacity: { type: 'boolean', description: 'Retry vendors after the caller confirms their quota is available again. With node_id it also reopens that interrupted node; alone it clears exclusions - including ones recorded at probe time, where no node was ever interrupted - re-ranks undispatched work and returns the next ready nodes.' },
        repair: { type: 'boolean', description: 'Force a repair round over the most recent settled goal-gate round, the same move auto_reassign makes on its own when consensus rejects. Use it when auto_reassign is off, or when a stalled round (two repairs closing the same gaps) needs a deliberate third try.' },
        cwd: { type: 'string' },
      },
      required: ['run_id'],
    },
    outputSchema: RETRY_SCHEMA,
  },
  {
    name: 'team_status',
    description:
      'Compact run state: node counts, per-node state and verdict. Omit run_id to see every run in cwd instead - state, counts, and which node is running right now with its vendor and elapsed seconds. Pass full:true only when you actually need a payload - it is large by design and normally stays out of your context.',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        cwd: { type: 'string' },
        node_id: { type: 'string' },
        full: { type: 'boolean' },
      },
    },
    outputSchema: STATUS_SCHEMA,
  },
];

// ---------- tool implementations ----------

// The broker owns the flow, so both execution paths enforce it identically. Without
// this on team_submit, a caller could record a node whose dependencies never ran and
// the ordering would be advisory rather than real.
function requireRunnable(run, nodeId) {
  const n = getNode(run, nodeId);
  if (!n) throw new Error(`unknown node ${nodeId}`);
  if (n.state !== 'pending') throw new Error(`node ${n.node_id} is ${n.state}, not pending`);
  const missing = unmetDeps(run, n);
  if (missing.length) throw new Error(`node ${n.node_id} is blocked on ${missing.join(', ')}`);
  return n;
}

async function toolGraphOpen(a) {
  const cwd = resolve(String(a.cwd));
  knownCwds.add(cwd);
  // .claude/team.json layers under an explicit team_open argument of the same name -
  // the same precedence tm_open's own resolveTeamOptions call gives it (teamconfig.mjs).
  // Only vendor/allocation/goal_threshold/max_retries/interactive/retry_policy/human_gates
  // are both a TEAM_DEFAULTS key and a team_open argument that createRun actually consumes
  // on a single run; the other seven TEAM_DEFAULTS keys (human_scope, max_parallel_teams,
  // max_depth, qa_rounds, roles, driver_restarts, docs_dir) belong to tm_open's
  // multi-team/TaskManager layer and are not team_open arguments at all.
  const team = resolveTeamOptions(a, readTeamConfig(cwd).config);
  const T = team.opts;
  const run = createRun({
    cwd,
    request: String(a.request),
    context: a.context || '',
    vendor: T.vendor,
    allocation: T.allocation,
    host_vendor: a.host_vendor || null,
    host_model: a.host_model || null,
    native_models: a.native_models || null,
    model: a.model || null,
    policy: a.policy || {},
    candidates: a.candidates || null,
    sandbox: a.sandbox || null,
    isolated: a.isolated === true,
    interactive: T.interactive === true,
    human_gates: Array.isArray(T.human_gates) ? T.human_gates.slice() : [],
    auto_reassign: a.auto_reassign !== false,
    goal_threshold: T.goal_threshold,
    // goal_judges is not a TEAM_DEFAULTS key, so resolveTeamOptions never touches it - it
    // is not pinnable in team.json. The MCP tool boundary defaults it to two judges;
    // createRun itself defaults to one, so a caller that builds runs directly - the
    // TaskManager's own per-package child runs among them - keeps today's single-gate
    // behaviour unless it asks otherwise.
    goal_judges: Number.isInteger(a.goal_judges) && a.goal_judges > 0 ? a.goal_judges : 2,
    max_retries: T.max_retries,
    retry_policy: T.retry_policy,
    flow: a.flow,
    mixed: a.mixed,
    skills: a.skills,
    mounts: a.mounts,
  });
  // resolveTeamOptions' notes (an unrecognized team.json key, or one whose value failed
  // its validator) reach tm_status's team.notes on the tm_open path but had nowhere to
  // land here - team_open handed back only READY_SCHEMA, so a typo'd key was silently
  // ignored with no diagnostic anywhere. Persist it on the run itself so team_status can
  // surface it, the same way task.team.notes does for tm_open.
  if (team.notes.length) run.config_notes = team.notes;
  saveRun(run);
  record(cwd, { event: 'team_open', run_id: run.run_id, vendor: run.vendor, flow: run.flow, mixed: run.mixed });
  return { run_id: run.run_id, cwd, ...(await toolGraphNext({ run_id: run.run_id, cwd })) };
}

// The card a person reads. Shared by the two ways a node reaches waiting_human: promoted here
// when a pin becomes ready, or born there by openAsk at the moment its investigate dep is
// submitted. tm_inbox has to point the main session at SOMETHING readable, and it is the same
// briefing a fresh agent would have read - not a second document invented for a human.
function writeHumanBriefing(run, n) {
  const briefingPath = join(brokerDir(run.cwd), run.run_id, 'briefings', `${n.node_id.replace(/[^A-Za-z0-9._-]/g, '_')}.md`);
  try {
    mkdirSync(dirname(briefingPath), { recursive: true });
    writeFileSync(briefingPath, composePrompt(run, n, nodeBriefing(run, n)));
    n.briefing_path = briefingPath;
  } catch {
    /* tm_inbox falls back to team_status full:true */
  }
}

async function toolGraphNext(a) {
  const run = mustFindRun(a);
  reclaimAbandoned(run);
  // A human-pinned node that just became ready parks in waiting_human here, before readyNodes()
  // is even read - the same reason reclaimAbandoned runs first: this is where "ready" is decided
  // for real. Write its briefing exactly like a self node's (below), because tm_inbox has to
  // point the main session at SOMETHING readable - "what is asked" is the same briefing a fresh
  // agent would have read, not a second document invented for a human.
  const promoted = promoteWaitingHuman(run);
  // gate:human (D2 Task 4): a node whose stage is in run.human_gates never reaches a driver -
  // interactive parks it exactly like the pin above (same briefing, same tm_inbox/tm_submit
  // path); non-interactive auto-passes it here and now through the same finishNode every other
  // submission goes through, so autoReassign and every stage-specific completion hook still run.
  const { parked: gateParked, autoPass } = promoteHumanGates(run);
  for (const n of autoPass) finishNode(run, n, autoPassHumanGateResult(n), 'auto');
  const allParked = [...promoted, ...gateParked];
  if (allParked.length) {
    for (const n of allParked) writeHumanBriefing(run, n);
    saveRun(run);
    record(run.cwd, { event: 'node_waiting_human', run_id: run.run_id, nodes: allParked.map((n) => n.node_id) });
  }
  let ready = readyNodes(run);

  // `isolated` is the broker's own claim that one node had the worktree to itself, and
  // it is what makes positive attribution sound. Offering two independent implement
  // nodes at once invites the orchestrator to run both and quietly falsifies it. Under
  // isolation, hand out one mutating node at a time; reasoning nodes write nothing and
  // stay parallel.
  if (run.isolated) {
    let mutatingOffered = run.nodes.some((n) => n.state === 'running' && !REASONING_STAGES.has(n.stage));
    ready = ready.filter((n) => {
      if (REASONING_STAGES.has(n.stage)) return true;
      if (mutatingOffered) return false;
      mutatingOffered = true;
      return true;
    });
  }

  const state = runState(run);
  const response = {
    run_id: run.run_id,
    state: state.state,
    counts: state.counts,
    flow: flowOf(run) || run.flow || 'auto',
    ...(run.size ? { size: run.size } : {}),
    ready: await (async () => {
      const offered = [];
      for (const n of ready) {
      const r = await route(run, n);
      if (run.allocation === 'balanced' && r.vendor !== 'vendor-failure') {
        n.assignment = r;
        n.executor = r.executor || r.vendor;
        saveRun(run);
      }
      const briefingPath = join(brokerDir(run.cwd), run.run_id, 'briefings', `${n.node_id.replace(/[^A-Za-z0-9._-]/g, '_')}.md`);
      if (r.vendor === 'self') {
        // A self-executed node never passes through team_run's own n.state='running' checkpoint
        // hook (there is no team_run call - the native agent does the work itself, then
        // team_submit's), so this is the only place its attempt begins from the broker's point
        // of view. Idempotent (recordCheckpoint no-ops once n.checkpoint is set), so re-offering
        // the same ready node on a later poll costs nothing.
        if (isAuthorNode(run, n) && recordCheckpoint(run, n)) saveRun(run);
        try {
          mkdirSync(dirname(briefingPath), { recursive: true });
          writeFileSync(briefingPath, composePrompt(run, n, nodeBriefing(run, n)));
        } catch {
          /* the orchestrator can still fall back to team_status full:true */
        }
      }
      offered.push({
        node_id: n.node_id,
        stage: n.stage,
        vendor: r.vendor,
        executor: r.executor,
        routing_reason: r.reason,
        attempts: r.vendor === 'vendor-failure' ? r.attempts : undefined,
        briefing_path: r.vendor === 'self' ? briefingPath : undefined,
        model: r.model || undefined,
        next: r.vendor === 'self' ? 'dispatch briefing_path to a fresh native agent at model, then team_submit' : r.vendor === 'vendor-failure' ? 'no vendor is ready; see attempts' : 'call team_run',
      });
      }
      return offered;
    })(),
  };
  run.routing_blocked = Boolean(response.ready.length && response.ready.every(n => n.vendor === 'vendor-failure'));
  saveRun(run);
  response.state = runState(run).state;
  return response;
}

async function toolGraphRun(a) {
  const run = mustFindRun(a);
  let n = requireRunnable(run, String(a.node_id));
  // team_next never offers this node (promoteWaitingHuman parks it in waiting_human first), but
  // a caller who already has the node_id can still reach team_run directly before that happens -
  // §0.3 of docs/plans/2026-09-17-teams-team-v0.13.0.md fixes human OUT of the routing pool
  // entirely, and without this guard route()'s own early return (line ~427, honoring
  // node.assignment as-is) would hand this node's vendor straight through as 'human', which
  // loadVendors(run.cwd) has no entry for.
  if (n.assignment && n.assignment.executor === 'human') {
    throw new Error(`node ${n.node_id} is pinned to a human executor; call team_next to move it to waiting_human, then tm_inbox/tm_submit from the main session`);
  }

  const r = await route(run, n);
  if (r.vendor === 'self') throw new Error(`node ${n.node_id} is routed to self - use team_submit`);
  if (r.vendor === 'vendor-failure') {
    n.state = 'failed';
    n.result = { stage_ok: false, reason: r.attempts.map((x) => `${x.vendor}: ${x.reason}`).join(' | ') };
    n.vendor = 'vendor-failure';
    saveRun(run);
    return verdict(run, n);
  }

  // Policy is the default; an explicit team_run({model}) still wins for one call.
  const chosenModel = a.model || r.model;
  const independence = reviewIndependence(run, n, r.executor || r.vendor, chosenModel);

  const vendor = loadVendors(run.cwd)[r.vendor];
  const ticket = randomUUID();
  n.ticket = ticket;
  n.executor = r.executor || r.vendor;
  n.model = r.model || null;
  n.state = 'running';
  n.started_at = Date.now();
  if (isAuthorNode(run, n)) recordCheckpoint(run, n);
  saveRun(run);
  syncOpenNodes(run);
  const activeKey = `${run.run_id}:${n.node_id}`;
  activeNodes.add(activeKey);

  const dir = join(brokerDir(run.cwd), run.run_id, n.node_id.replace(/[^A-Za-z0-9._-]/g, '_'), ticket);
  mkdirSync(dir, { recursive: true });
  const promptPath = join(dir, 'prompt.md');
  const outPath = join(dir, 'result.json');
  const eventsPath = join(dir, 'events.jsonl');
  writeFileSync(promptPath, composePrompt(run, n, nodeBriefing(run, n)));
  n.detail_path = outPath;
  saveRun(run);

  // Implement/test go through the adapter's stage contract, which enforces their JSON
  // schema. Reasoning nodes must NOT: their shapes differ per stage (setgoal returns a
  // spec, gate returns a verdict) and the implement schema is additionalProperties:false,
  // so a valid setgoal answer would be rejected as malformed. The adapter's --stage is
  // optional, so we omit it and parse the model's reply here instead.
  // The adapter knows two staged schemas: implement (files + checks) and test (verified).
  // A draft is implement-shaped - it writes files and reports them - so it borrows that
  // schema; review is reasoning and runs unstaged like the other judging nodes.
  const reasoning = REASONING_STAGES.has(n.stage);
  const args = [
    ...(reasoning ? [] : ['--stage', n.stage === 'test' ? 'test' : 'implement']),
    '--cwd', run.cwd,
    '--prompt-file', promptPath,
    '--events-output', eventsPath,
    '--output', outPath,
    '--sandbox', r.sandbox,
  ];
  if (run.isolated && !REASONING_STAGES.has(n.stage)) args.push('--isolated');
  for (const d of Array.isArray(a.add_dirs) ? a.add_dirs : []) args.push('--add-dir', String(d));
  if (chosenModel) args.push('--model', String(chosenModel));

  let proc;
  try {
    proc = await runAdapter(vendor, args, run.cwd, {
      register: (cancel) => { if (a.__onCancel) a.__onCancel(cancel); },
      timeoutMs: a.timeout_ms,
    });
  } finally {
    activeNodes.delete(activeKey);
  }
  const report = readJson(outPath) || {};
  const payload = parseVendorResult(report) || {};

  // The vendor call above may have taken minutes. Anything this process remembers about
  // the run is potentially stale, so re-read before recording - otherwise finishing this
  // node writes back a snapshot that erases whatever else completed meanwhile.
  const fresh = loadRun(run.cwd, run.run_id);
  if (fresh) {
    run.nodes = fresh.nodes;
    run.spec = fresh.spec;
    const again = getNode(run, n.node_id);
    if (again) {
      again.ticket = n.ticket;
      again.started_at = n.started_at;
      again.detail_path = n.detail_path;
      n = again;
    }
  }

  const transportOk = proc.status === 0;
  // A provider's usage limit is never a verdict on the work, under either allocation: code-sprint-S2's
  // second PLAN run (allocation ordered) had every codex node exit 1 on "You've hit your usage
  // limit", each counted as a failed attempt, until the package's retries were spent. The
  // message lives only in the adapter's own event stream, so that is read too.
  let eventsTail = '';
  try {
    const ev = report.events_output || '';
    if (ev && existsSync(ev)) { const t = readFileSync(ev, 'utf8'); eventsTail = t.slice(-8192); }
  } catch { /* no events file - stderr and the report are all there is */ }
  if ((!transportOk || report.stage_ok === false)
      && capacityFailure({ ...report, stdout: [report.stdout || '', eventsTail].join('\n') }, proc.stderr)) {
    return checkpointInterruption(run, n, r.executor || r.vendor, { ...report,
      transport: { status: proc.status, stderr: proc.stderr, stdout: proc.stdout } }, 'quota');
  }
  let result;
  if (!transportOk) {
    const why = proc.killed_for === 'timeout'
      ? `vendor exceeded the node timeout and was killed`
      : proc.killed_for === 'cancelled'
        ? 'cancelled by the client'
        : '';
    result = { stage_ok: false, killed_for: proc.killed_for || '', reason: why || proc.stderr.slice(-300) || `adapter exit ${proc.status}` };
  } else if (reasoning) {
    // Nothing to cross-check: these nodes are judged by their content, not by files.
    // The adapter ran unstaged, so there is no report.stage_ok - the payload is it.
    // An unparseable or empty reply is a failed node, never a silent pass.
    const unusable = !payload || payload._unparsed === true || Object.keys(payload).length === 0;
    result = unusable
      ? {
          stage_ok: false,
          reason: `${entry(n)} returned no usable JSON: ${String((payload && payload.handoff) || report.last_message || '').slice(0, 200)}`,
        }
      : { ...payload, stage_ok: payload.stage_ok !== false, ...(independence ? { reviewer_independence: independence.independence } : {}) };
  } else {
    const check = crossCheck(run.cwd, payload.changed_files, run.isolated, nodeKind(run, n));
    const contradicted = check.contradicted_files.length > 0;
    result = {
      ...payload,
      stage_ok: report.stage_ok === true && !contradicted,
      ...check,
      verification_error: contradicted
        ? `claimed changed_files not present in the worktree: ${check.contradicted_files.join(', ')}`
        : report.verification_error || '',
      // audit is not a REASONING_STAGES member (graph.mjs's planning-audit table keeps every
      // non-final chain stage "mutating" on purpose - see that table's own comment), so it
      // never reaches the reasoning branch above. Its cross-run independence check still
      // belongs on the result; merged here instead of gating a whole extra branch on one stage.
      ...(independence ? { reviewer_independence: independence.independence } : {}),
    };
  }
  return finishNode(run, n, result, r.vendor);
}

// Pure: the result and pass/fail verdict a node's payload earns, worktree cross-check included
// - no write, not even to `run` on disk (mutating the node's in-memory object is fine; nothing
// here calls saveRun). team_submit's own body below is this plus finishNode's apply-and-persist
// step; the TaskManager's tm_submit({key}) (taskmanager.mjs) imports this SAME function to
// preview a human's submission - a claimed changed_files gets the identical cross-check an AI's
// would - without ever writing the child run itself (design §7: "changed_files는 워크트리 대조로
// 똑같이 검증"; the 0.27.3 review, 2026-09-24, is what this replaced - see graph.mjs's
// queueHumanAction for the mechanism).
export function computeSubmitResult(run, n, payload, vendorName) {
  const independence = reviewIndependence(run, n, n.executor || vendorName, n.model);
  let result;
  if (REASONING_STAGES.has(n.stage)) {
    result = { ...payload, stage_ok: payload.stage_ok !== false, ...(independence ? { reviewer_independence: independence.independence } : {}) };
  } else {
    const check = crossCheck(run.cwd, payload.changed_files, run.isolated, nodeKind(run, n));
    const contradicted = check.contradicted_files.length > 0;
    result = {
      ...payload,
      submitted_stage_ok: payload.stage_ok === true,
      stage_ok: payload.stage_ok === true && !contradicted,
      ...check,
      verification_error: contradicted
        ? `claimed changed_files not present in the worktree: ${check.contradicted_files.join(', ')}`
        : '',
      ...(independence ? { reviewer_independence: independence.independence } : {}),
    };
  }
  return { result, done: nodeSucceeded(run, n, result) };
}

// The apply-and-persist half: computeSubmitResult plus finishNode's state transition, autoReassign
// and saveRun. team_submit calls this for a self-executed node; ingestHandoff (mustFindRun, above)
// calls it for a human's queued submission - same function either way.
function submitResult(run, n, payload, vendorName) {
  const { result } = computeSubmitResult(run, n, payload, vendorName);
  return finishNode(run, n, result, vendorName);
}

// At-least-once delivery (docs/plans/2026-09-23-teams-reducer-human-rollback.md §5): a caller
// that submits the same node twice - a retried MCP call, two drivers racing on one node - must
// not have its second call re-adjudicate (or, for a dispatch-shaped node, redo a git commit) what
// the first already settled. node_id already disambiguates ATTEMPT for every stage this engine
// retries (implement:U1:2, gate:goal:3, shape:2 all carry the round in the id), so {run_id,
// node_id} is already the idempotency key in the common case; `attempt`, when the caller has it,
// is one more check rather than the whole of it.
function idempotentSubmit(run, n, a) {
  if (!n || n.state === 'pending' || n.state === 'running' || !n.result) return null;
  if (a.attempt != null && Number(a.attempt) !== (n.attempt || 1)) return null;
  return { ...verdict(run, n), idempotent: true, note: `node ${n.node_id} already ${n.state}; returning the stored result, no work repeated` };
}

function toolGraphSubmit(a) {
  const run = mustFindRun(a);
  const already = idempotentSubmit(run, getNode(run, String(a.node_id)), a);
  if (already) return already;
  const n = requireRunnable(run, String(a.node_id));
  const payload = a.payload || {};
  if (run.allocation === 'balanced') {
    if (!n.assignment || n.assignment.vendor !== 'self') throw new Error('balanced node must be assigned to a native executor by team_next before submit');
    n.executor = n.assignment.executor || 'self';
    n.model = n.assignment.model || null;
    if (payload.stage_ok === false && capacityFailure(payload)) return checkpointInterruption(run, n, n.executor, payload, 'quota');
  }
  return submitResult(run, n, payload, 'self');
}

async function toolGraphRetry(a) {
  const run = mustFindRun(a);
  // Validate before touching anything: a call that is going to be rejected must not have
  // already spent the capacity reset. The node itself is looked up again below, after the
  // reset has saved - saveRun rebuilds run.nodes, so a reference taken here can go stale.
  const retryable = (n) => n && n.state === 'pending' && n.recovery;
  if (a.node_id && !retryable(getNode(run, String(a.node_id)))) {
    throw new Error('node_id must identify a currently interrupted pending node');
  }

  // A vendor can be excluded before it ever runs a node, so a capacity reset cannot
  // require an interrupted node to name.
  if (a.reset_capacity === true) {
    run.unavailable_vendors = {};
    run.capacity_epoch = (run.capacity_epoch || 0) + 1;
    probeCache.clear();
    // An assignment made while the vendor was excluded is stale: re-rank it. Work already
    // dispatched keeps its executor - only what has not left the gate is reconsidered.
    for (const n of run.nodes) if (n.state === 'pending' && !n.ticket) delete n.assignment;
    saveRun(run);
    if (!a.node_id && !a.subgoal_id) {
      record(run.cwd, { event: 'team_retry', run_id: run.run_id, target: 'capacity' });
      return { run_id: run.run_id, target: 'capacity', retried: true, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
    }
  }

  if (a.node_id) {
    const n = getNode(run, String(a.node_id));
    n.state = 'pending';
    n.ticket = null;
    delete n.assignment;
    saveRun(run);
    return { run_id: run.run_id, target: n.node_id, retried: true, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
  }

  // Force a repair round: the same move autoReassignGoalGate makes on its own when
  // consensus rejects, callable directly for auto_reassign:false runs or to push past
  // a stall the caller wants to override.
  if (a.repair === true) {
    const rounds = [...new Set(run.nodes.filter((n) => n.stage === 'gate' && n.subgoal_id === null)
      .map((n) => goalRoundOf(n.node_id)).filter((r) => r != null))];
    if (!rounds.length) throw new Error('no goal-gate round exists yet to repair');
    const round = Math.max(...rounds);
    const consensus = goalConsensus(run, round);
    if (!consensus || !consensus.settled) throw new Error(`goal-gate round ${round} has not finished judging yet`);
    if (consensus.accept) throw new Error(`goal-gate round ${round} already accepted - nothing to repair`);
    // repair's `after` edge only counts a failed judge as settled once it is final -
    // the same mark autoReassignGoalGate leaves before opening repair on its own.
    for (const s of goalGateSiblings(run, round)) if (s.state === 'failed') s.final = true;
    const feedback = repairBriefing(run, consensus);
    const out = openRepair(run, round, feedback, run.goal_judges || goalGateSiblings(run, round).length);
    if (!out.attempt) {
      record(run.cwd, { event: 'team_settle', run_id: run.run_id, target: 'goal_gate', round, reason: out.reason });
      return { run_id: run.run_id, target: 'goal_gate', retried: false, reason: out.reason, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
    }
    record(run.cwd, { event: 'team_repair', run_id: run.run_id, target: 'goal_gate', round, attempt: out.attempt, repair_id: out.repair_id, forced: true });
    return { run_id: run.run_id, target: 'goal_gate', retried: true, attempt: out.attempt, repair_id: out.repair_id, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
  }

  // No subgoal named means the spec itself was rejected: redo setgoal and critique.
  if (!a.subgoal_id) {
    const source = run.nodes
      .filter((n) => (n.stage === 'critique' || n.stage === 'setgoal') && n.state === 'failed' && n.result)
      .pop() || run.nodes.filter((n) => n.stage === 'critique' && n.result).pop();
    const fb = source && source.result
      ? [source.result.reason || '', ...(source.result.blocking || []),
         ...(source.result.spec_problems || []), ...(source.result.problems || [])]
          .filter(Boolean).join('\n- ')
      : '';
    const out = retrySpec(run, fb);
    if (!out.attempt) {
      record(run.cwd, { event: 'team_settle', run_id: run.run_id, target: 'spec', unreachable: out.unreachable.length });
      return { run_id: run.run_id, target: 'spec', retried: false, reason: out.reason, unreachable: out.unreachable, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
    }
    record(run.cwd, { event: 'team_retry', run_id: run.run_id, target: 'spec', attempt: out.attempt });
    return { run_id: run.run_id, target: 'spec', retried: true, attempt: out.attempt, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
  }

  // The feedback is whatever judged the attempt last: a gate's gaps, or - when the
  // attempt never reached its gate - the check that failed it. A review that listed
  // what the text lacks, or a test that printed the failing command, is the feedback
  // the next draft or implement needs; carrying only gate verdicts sent it in blind.
  const sid = String(a.subgoal_id);
  const out = retrySubgoal(run, sid, subgoalFeedback(run, sid));
  if (!out.attempt) {
    record(run.cwd, { event: 'team_settle', run_id: run.run_id, subgoal_id: sid, unreachable: out.unreachable.length });
    return { run_id: run.run_id, target: sid, subgoal_id: sid, retried: false, reason: out.reason, unreachable: out.unreachable, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
  }
  const rollback = applyRollback(out.run, out.rollback, sid);
  record(run.cwd, { event: 'team_retry', run_id: run.run_id, subgoal_id: sid, attempt: out.attempt });
  return { run_id: run.run_id, target: sid, subgoal_id: sid, retried: true, attempt: out.attempt, ...(rollback ? { rollback } : {}), ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
}

// What is happening right now, without a run_id in hand. A lead that lost the id - a
// fresh session, a compaction, a second operator looking in - had no way back into a run
// from the MCP alone, and no way to see what a blocking team_run is doing meanwhile.
// One row per run, newest first; payloads stay out of it exactly as elsewhere.
function progressOverview(a) {
  const cwds = a.cwd ? [resolve(String(a.cwd))] : [...knownCwds];
  if (!cwds.length) throw new Error('pass cwd or run_id - the broker knows no working directory yet');
  const now = Date.now();
  const runs = [...new Set(cwds)].flatMap((cwd) => listRuns(cwd))
    .sort((x, y) => (y.created_at || 0) - (x.created_at || 0))
    .map((run) => {
      reclaimAbandoned(run);
      const state = runState(run);
      const finished = run.nodes.filter((n) => n.state === 'done' || n.state === 'failed').at(-1);
      const stalled = Object.keys(run.unavailable_vendors || {});
      return {
        run_id: run.run_id,
        cwd: run.cwd,
        state: state.state,
        counts: state.counts,
        request: String(run.request || '').slice(0, 160),
        created_at: new Date(run.created_at || now).toISOString(),
        running: run.nodes.filter((n) => n.state === 'running').map((n) => ({
          node_id: n.node_id,
          stage: n.stage,
          executor: n.executor || n.vendor || null,
          model: n.model || null,
          elapsed_s: Math.round((now - (n.started_at || now)) / 1000),
        })),
        last_finished: finished ? { node_id: finished.node_id, stage: finished.stage, state: finished.state } : null,
        ...(stalled.length ? { unavailable_vendors: run.unavailable_vendors } : {}),
      };
    });
  return { cwds: [...new Set(cwds)], runs };
}

function toolGraphStatus(a) {
  if (a.run_id === undefined || a.run_id === null || a.run_id === '') return progressOverview(a);
  const run = mustFindRun(a);
  reclaimAbandoned(run);
  if (a.full) {
    if (a.node_id) {
      const n = getNode(run, String(a.node_id));
      if (!n) throw new Error(`unknown node ${a.node_id}`);
      return { run_id: run.run_id, node: n };
    }
    return run;
  }
  const state = runState(run);
  return {
    run_id: run.run_id,
    cwd: run.cwd,
    state: state.state,
    counts: state.counts,
    ...(state.goal_verdict ? { goal_verdict: state.goal_verdict } : {}),
    has_spec: !!run.spec,
    flow: flowOf(run) || run.flow || 'auto',
    mixed: run.mixed !== false,
    ...(run.size ? { size: run.size } : {}),
    ...(run.config_notes && run.config_notes.length ? { config_notes: run.config_notes } : {}),
    subgoals: run.spec ? (run.spec.subgoals || []).map((s) => s.id) : [],
    nodes: run.nodes
      .filter((n) => (a.node_id ? n.node_id === a.node_id : true))
      .map((n) => (n.state === 'pending' || n.state === 'running'
        ? {
          node_id: n.node_id,
          stage: n.stage,
          state: n.state,
          deps: n.deps,
          after: n.after || [],
          // A blocking team_run is otherwise invisible: the node reads as bare "running"
          // with no way to tell which vendor is on it or whether it is stuck.
          ...(n.state === 'running'
            ? {
              executor: n.executor || n.vendor || null,
              model: n.model || null,
              elapsed_s: Math.round((Date.now() - (n.started_at || Date.now())) / 1000),
            }
            : {}),
        }
        : verdict(run, n))),
  };
}

// ---------- JSON-RPC / MCP plumbing ----------

async function callTool(name, args, requestId, params) {
  const a = args || {};
  if (a.cwd) knownCwds.add(resolve(String(a.cwd)));
  switch (name) {
    case 'team_open': return await toolGraphOpen(a);
    case 'team_next': return await toolGraphNext(a);
    case 'team_run':
      return await toolGraphRun({ ...a, __onCancel: (cancel) => registerCanceller(requestId, cancel) });
    case 'team_submit': return toolGraphSubmit(a);
    case 'team_retry': return await toolGraphRetry(a);
    case 'team_status': return toolGraphStatus(a);
    default: throw new Error('unknown tool: ' + name);
  }
}

// One line out per message, never interleaved.
function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// MCP cancellation: the client sends notifications/cancelled with the requestId it wants
// stopped. Nothing could be cancelled while the server ran the vendor synchronously;
// now the in-flight child can be killed.
const cancellers = new Map();

function registerCanceller(requestId, cancel) {
  if (requestId === undefined || requestId === null) return;
  const list = cancellers.get(requestId) || [];
  list.push(cancel);
  cancellers.set(requestId, list);
}

function cancelRequest(requestId) {
  const list = cancellers.get(requestId);
  if (!list) return false;
  for (const cancel of list) {
    try { cancel(); } catch { /* the child may already be gone */ }
  }
  cancellers.delete(requestId);
  return true;
}

// notifications/progress, so a client can show a long node advancing instead of staring
// at a call that returns nothing for ten minutes.
function startProgress(token, label) {
  if (token === undefined || token === null) return () => {};
  const started = Date.now();
  let n = 0;
  const send = () => {
    emit({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: {
        progressToken: token,
        progress: ++n,
        message: `${label} — ${Math.round((Date.now() - started) / 1000)}s`,
      },
    });
  };
  // Immediately, then on a tick. Waiting for the first interval meant a client saw
  // nothing at all for the first ten seconds, and nothing ever for a short node.
  send();
  const tick = setInterval(send, 10000);
  tick.unref();
  return () => clearInterval(tick);
}

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: params && typeof params.protocolVersion === 'string' ? params.protocolVersion : DEFAULT_PROTOCOL,
        // Declare only what is implemented. `logging` was advertised while
        // notifications/message was never sent, and a client that trusted it got
        // silence; resources/* would answer -32601 for the same reason.
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
      });
    case 'ping':
      return reply({});
    case 'notifications/cancelled': {
      const target = params && params.requestId;
      cancelRequest(target);
      return null; // a notification takes no response
    }
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      const name = params && params.name;
      const token = params && params._meta ? params._meta.progressToken : undefined;
      const stopProgress = startProgress(token, `${name}${params && params.arguments && params.arguments.node_id ? ' ' + params.arguments.node_id : ''}`);
      try {
        const out = await callTool(name, params && params.arguments, msg.id, params);
        stopProgress();
        return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: false });
      } catch (e) {
        stopProgress();
        // Tool-level failures are results, not protocol errors - the caller needs the
        // reason so it can record stage_ok=false and move on.
        return reply({ content: [{ type: 'text', text: String((e && e.message) || e) }], isError: true });
      } finally {
        cancellers.delete(msg.id);
      }
    }
    default:
      if (typeof id === 'undefined') return null;
      return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + method } };
  }
}

// Only run the stdio server when this file is the process entry point - the same guard
// taskmanager.mjs (`isMain`) and daemon.mjs (`RUN_AS_MAIN`) already use, from the one module all
// three now import it from (pluginroots.mjs's isEntryPoint) rather than each carrying its own
// copy. Needed here for a new reason as of 0.27.4: taskmanager.mjs imports this module directly,
// for computeSubmitResult - a human's tm_submit({key}) gets the exact worktree cross-check
// team_submit gives anyone else, read-only, without re-implementing it (see that function's own
// comment, and graph.mjs's queueHumanAction for what replaced the direct child-run writes the
// 2026-09-24 review caught). An import must never also bind stdin, or the TaskManager process
// would start a second, silently-conflicting JSON-RPC loop reading ITS OWN stdin as this file's.
const isMain = isEntryPoint(import.meta.url);

if (isMain) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      // Dispatch without awaiting: a node run must not stop the server from answering
      // ping, status, or a cancellation for that very node.
      Promise.resolve()
        .then(() => handle(msg))
        .catch((e) =>
          typeof msg.id === 'undefined'
            ? null
            : { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String((e && e.message) || e) } },
        )
        .then((out) => { if (out) emit(out); });
    }
  });
  process.stdin.on('end', () => process.exit(0));
}
