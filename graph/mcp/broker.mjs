#!/usr/bin/env node
// graph-engineering - local stdio MCP server that owns the harness flow as a node graph and
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
  validateSpec,
  retrySubgoal,
  retrySpec,
  readyNodes,
  runState,
  nodeBriefing,
  stagePolicy,
} from './graph.mjs';
import { composePrompt } from './prompts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = { name: 'graph-engineering', version: '1.0.0' };
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

// `vendor: "auto"` tries these in order, then degrades to `self`. Empty by default: a run
// that does not name a vendor stays on the orchestrator. Registering a vendor does not
// enrol it here — name it explicitly (`vendor: "codex"`) or list it in `candidates`.
const AUTO_CANDIDATES = [];

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
  return join(cwd, '.harness-run', 'broker');
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

// Positive attribution is only sound when this node had the worktree to itself.
// Otherwise null - "could not attribute" is neither a pass nor a failure.
function crossCheck(cwd, claimed, isolated) {
  const observed = gitChanged(cwd);
  if (observed === null) return { changed_files_verified: null, change_attribution: 'no-git', contradicted_files: [] };
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

// graph_run is synchronous: while a node runs, the call is held open by the process that
// started it. So a node marked `running` that this process did not start, and that has
// been sitting long enough, belongs to a broker that died - it is not in flight, it is
// abandoned. Without reclaiming it the run wedges forever: graph_next offers nothing and
// graph_run refuses the node as already running.
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

function mustFindRun(a) {
  if (a.cwd) knownCwds.add(resolve(String(a.cwd)));
  const cwd = a.cwd ? resolve(String(a.cwd)) : null;
  const run = (cwd && loadRun(cwd, String(a.run_id))) || findRun(String(a.run_id), knownCwds);
  if (!run) throw new Error(`unknown run ${a.run_id} - pass cwd, or call graph_open first`);
  knownCwds.add(run.cwd);
  return run;
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
  const order = isSelf
    ? []
    : want === 'auto'
      ? (pol.candidates || (balanced ? ['claude', 'codex'] : AUTO_CANDIDATES))
      : [want];

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
      // native_models declares actual model selection capability, independently
      // from the driving conversation's model. Never silently substitute a tier.
      if (run.native_models && !run.native_models.includes(model)) {
        attempts.push({ vendor: name, ready: false, reason: `native host cannot select model ${model}` });
      } else {
        return { vendor: 'self', executor: name, sandbox: null, model, reason: candidate.reason, attempts };
      }
      continue;
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
    // out, the run stops re-probing it, and graph_retry({reset_capacity:true}) is the way back.
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
  if (n.stage === 'test') out.verified = res.verified === true;
  if (n.stage === 'gate') {
    out.accept = res.accept === true;
    out.match_pct = res.match_pct;
    out.gap_count = (res.gaps || []).length;
    // Advisory, never blocking - but surfaced, or a run that passed with known
    // weaknesses reads exactly like one that had none.
    if ((res.observations || []).length) out.observation_count = res.observations.length;
    if ((res.spec_drift || []).length) out.spec_drift_count = res.spec_drift.length;
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
  if (n.state === 'failed' && res.stage_ok === true) {
    const field = n.stage === 'gate' ? 'accept' : n.stage === 'critique' ? 'sound' : n.stage === 'test' ? 'verified' : null;
    if (field && res[field] === undefined) out.missing_verdict = field;
  }
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
function nodeSucceeded(n, result) {
  if (result.stage_ok !== true) return false;
  // The verdict must be present and affirmative. Accepting `!== false` let a missing
  // field pass: a vendor that returned an implement-shaped result for a test node, or a
  // gate that returned no verdict at all, sailed through. Absent evidence is not a pass -
  // which is exactly what these nodes are told.
  if (n.stage === 'gate') return result.accept === true;
  if (n.stage === 'critique') return result.sound === true;
  if (n.stage === 'test') return result.verified === true;
  return true;
}

function finishNode(run, n, result, vendorName) {
  delete n.recovery; // historical interruptions remain in n.interruptions
  n.state = nodeSucceeded(n, result) ? 'done' : 'failed';
  n.result = result;
  n.vendor = vendorName;
  n.finished_at = Date.now();

  // setgoal is the only node that changes the shape of the graph. Expanding here keeps
  // the spec out of the orchestrator entirely - but only for a spec that can actually
  // be expanded. A bad one is failed here with its defects as the reason, so the normal
  // spec-retry loop carries them into the next attempt instead of deadlocking later.
  if (n.stage === 'setgoal' && n.state === 'done') {
    const problems = validateSpec(result.spec);
    if (problems.length) {
      n.state = 'failed';
      n.result = { ...result, stage_ok: false, spec_problems: problems, reason: `unusable spec: ${problems.join('; ')}` };
    } else {
      run.spec = result.spec;
      expandSubgoals(run, result.spec.subgoals);
    }
  }
  saveRun(run);
  syncOpenNodes(run);
  record(run.cwd, { event: 'node_finish', run_id: run.run_id, node_id: n.node_id, stage: n.stage, vendor: vendorName, stage_ok: n.result.stage_ok === true });
  return verdict(run, n);
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
    changed_files: (gitChanged(run.cwd) || []).filter(p => !p.startsWith('.harness-run/')),
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
  return { ...verdict(run, n), recoverable: true, checkpoint_path: path, next: 'call graph_next for fallback; graph_retry with node_id and reset_capacity after quota renewal' };
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
    state: { type: 'string', enum: ['pending', 'running', 'done', 'failed', 'skipped'] },
    stage_ok: { type: 'boolean' },
    verified: { type: 'boolean', description: 'test nodes' },
    accept: { type: 'boolean', description: 'gate nodes' },
    match_pct: { type: 'number', description: 'gate nodes' },
    gap_count: { type: 'number', description: 'gate nodes' },
    observation_count: { type: 'number', description: 'gate nodes: non-blocking weaknesses' },
    spec_drift_count: { type: 'number', description: 'goal gate: where the spec asked less than the request' },
    sound: { type: 'boolean', description: 'critique nodes' },
    changed_files_verified: { type: ['boolean', 'null'], description: 'null means could not attribute - not a pass' },
    change_attribution: { type: ['string', 'null'], enum: ['isolated', 'shared-worktree', 'no-git', null] },
    contradicted_files: { type: 'array', items: { type: 'string' } },
    submitted_stage_ok: { type: 'boolean', description: 'present when the broker overruled the executor' },
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
    has_spec: { type: 'boolean' },
    subgoals: { type: 'array', items: { type: 'string' } },
    nodes: { type: 'array', items: { type: 'object' } },
    cwds: { type: 'array', items: { type: 'string' }, description: 'overview form only' },
    runs: { type: 'array', items: { type: 'object' }, description: 'overview form only: one row per run, newest first' },
  },
};

const RETRY_SCHEMA = {
  type: 'object',
  properties: {
    run_id: { type: 'string' },
    target: { type: 'string', description: 'a subgoal id, or "spec"' },
    retried: { type: 'boolean' },
    attempt: { type: 'number' },
    reason: { type: 'string' },
    state: { type: 'string' },
    ready: { type: 'array', items: { type: 'object' } },
  },
  required: ['run_id', 'retried'],
};

const TOOLS = [
  {
    name: 'graph_open',
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
            'Per-stage routing: {"plan":{"vendor":"self","model":"opus"},"implement":{"vendor":"codex"},"report":{"model":"sonnet"}}. Keys are stage names (plan, setgoal, critique, implement, test, gate, report) plus the optional "gate:goal". Each entry may set vendor, candidates, sandbox, model. A stage entry wins over the run-level setting.',
        },
        candidates: { type: 'array', items: { type: 'string' }, description: 'vendor preference order for "auto"' },
        sandbox: { type: 'string' },
        isolated: { type: 'boolean', description: 'cwd is a private worktree with only this run in it' },
        max_retries: { type: 'number' },
      },
      required: ['request', 'cwd'],
    },
    outputSchema: READY_SCHEMA,
  },
  {
    name: 'graph_next',
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
    name: 'graph_run',
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
    name: 'graph_submit',
    description:
      'Record a node you executed yourself. Same adjudication a vendor result gets: claimed changed_files are cross-checked against the worktree, and stage_ok comes back adjudicated, never raised.',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        node_id: { type: 'string' },
        cwd: { type: 'string' },
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
    name: 'graph_retry',
    description:
      'Open a fresh attempt, carrying the rejection feedback forward. With subgoal_id, retries that subgoal. Without it, retries the spec itself (setgoal + critique) and discards the subgoal graph the rejected spec produced. The failed attempt stays in the graph as evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        subgoal_id: { type: 'string', description: 'omit to retry the spec after a critique rejected it' },
        node_id: { type: 'string', description: 'Resume an interrupted/quota-exhausted node, retaining files and checkpoint. Does not reopen a completed or gate-rejected node.' },
        reset_capacity: { type: 'boolean', description: 'Retry vendors after the caller confirms their quota is available again. With node_id it also reopens that interrupted node; alone it clears exclusions - including ones recorded at probe time, where no node was ever interrupted - re-ranks undispatched work and returns the next ready nodes.' },
        cwd: { type: 'string' },
      },
      required: ['run_id'],
    },
    outputSchema: RETRY_SCHEMA,
  },
  {
    name: 'graph_status',
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
// this on graph_submit, a caller could record a node whose dependencies never ran and
// the ordering would be advisory rather than real.
function requireRunnable(run, nodeId) {
  const n = getNode(run, nodeId);
  if (!n) throw new Error(`unknown node ${nodeId}`);
  if (n.state !== 'pending') throw new Error(`node ${n.node_id} is ${n.state}, not pending`);
  const missing = n.deps.filter((d) => (getNode(run, d) || {}).state !== 'done');
  if (missing.length) throw new Error(`node ${n.node_id} is blocked on ${missing.join(', ')}`);
  return n;
}

async function toolGraphOpen(a) {
  const cwd = resolve(String(a.cwd));
  knownCwds.add(cwd);
  const run = createRun({
    cwd,
    request: String(a.request),
    context: a.context || '',
    vendor: a.vendor || 'auto',
    allocation: a.allocation || 'ordered',
    host_vendor: a.host_vendor || null,
    host_model: a.host_model || null,
    native_models: a.native_models || null,
    model: a.model || null,
    policy: a.policy || {},
    candidates: a.candidates || null,
    sandbox: a.sandbox || null,
    isolated: a.isolated === true,
    max_retries: a.max_retries,
  });
  record(cwd, { event: 'graph_open', run_id: run.run_id, vendor: run.vendor });
  return { run_id: run.run_id, cwd, ...(await toolGraphNext({ run_id: run.run_id, cwd })) };
}

async function toolGraphNext(a) {
  const run = mustFindRun(a);
  reclaimAbandoned(run);
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
        try {
          mkdirSync(dirname(briefingPath), { recursive: true });
          writeFileSync(briefingPath, composePrompt(run, n, nodeBriefing(run, n)));
        } catch {
          /* the orchestrator can still fall back to graph_status full:true */
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
        next: r.vendor === 'self' ? 'dispatch briefing_path to a fresh native agent at model, then graph_submit' : r.vendor === 'vendor-failure' ? 'no vendor is ready; see attempts' : 'call graph_run',
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

  const r = await route(run, n);
  if (r.vendor === 'self') throw new Error(`node ${n.node_id} is routed to self - use graph_submit`);
  if (r.vendor === 'vendor-failure') {
    n.state = 'failed';
    n.result = { stage_ok: false, reason: r.attempts.map((x) => `${x.vendor}: ${x.reason}`).join(' | ') };
    n.vendor = 'vendor-failure';
    saveRun(run);
    return verdict(run, n);
  }

  const vendor = loadVendors(run.cwd)[r.vendor];
  const ticket = randomUUID();
  n.ticket = ticket;
  n.executor = r.executor || r.vendor;
  n.model = r.model || null;
  n.state = 'running';
  n.started_at = Date.now();
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
  // Policy is the default; an explicit graph_run({model}) still wins for one call.
  const chosenModel = a.model || r.model;
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
  if (run.allocation === 'balanced' && (!transportOk || report.stage_ok === false)
      && capacityFailure(report, proc.stderr)) {
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
      : { ...payload, stage_ok: payload.stage_ok !== false };
  } else {
    const check = crossCheck(run.cwd, payload.changed_files, run.isolated);
    const contradicted = check.contradicted_files.length > 0;
    result = {
      ...payload,
      stage_ok: report.stage_ok === true && !contradicted,
      ...check,
      verification_error: contradicted
        ? `claimed changed_files not present in the worktree: ${check.contradicted_files.join(', ')}`
        : report.verification_error || '',
    };
  }
  return finishNode(run, n, result, r.vendor);
}

function toolGraphSubmit(a) {
  const run = mustFindRun(a);
  const n = requireRunnable(run, String(a.node_id));
  const payload = a.payload || {};
  if (run.allocation === 'balanced') {
    if (!n.assignment || n.assignment.vendor !== 'self') throw new Error('balanced node must be assigned to a native executor by graph_next before submit');
    n.executor = n.assignment.executor || 'self';
    n.model = n.assignment.model || null;
    if (payload.stage_ok === false && capacityFailure(payload)) return checkpointInterruption(run, n, n.executor, payload, 'quota');
  }

  let result;
  if (REASONING_STAGES.has(n.stage)) {
    result = { ...payload, stage_ok: payload.stage_ok !== false };
  } else {
    const check = crossCheck(run.cwd, payload.changed_files, run.isolated);
    const contradicted = check.contradicted_files.length > 0;
    result = {
      ...payload,
      submitted_stage_ok: payload.stage_ok === true,
      stage_ok: payload.stage_ok === true && !contradicted,
      ...check,
      verification_error: contradicted
        ? `claimed changed_files not present in the worktree: ${check.contradicted_files.join(', ')}`
        : '',
    };
  }
  return finishNode(run, n, result, 'self');
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
      record(run.cwd, { event: 'graph_retry', run_id: run.run_id, target: 'capacity' });
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
    if (!out.attempt) return { run_id: run.run_id, target: 'spec', retried: false, reason: out.reason };
    record(run.cwd, { event: 'graph_retry', run_id: run.run_id, target: 'spec', attempt: out.attempt });
    return { run_id: run.run_id, target: 'spec', retried: true, attempt: out.attempt, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
  }

  const sid = String(a.subgoal_id);
  const gates = run.nodes.filter((n) => n.subgoal_id === sid && n.stage === 'gate' && n.result);
  const last = gates[gates.length - 1];
  const feedback = last && last.result
    ? [last.result.reason || '', ...(last.result.gaps || [])].filter(Boolean).join('\n- ')
    : '';
  const out = retrySubgoal(run, sid, feedback);
  if (!out.attempt) return { run_id: run.run_id, target: sid, subgoal_id: sid, retried: false, reason: out.reason };
  record(run.cwd, { event: 'graph_retry', run_id: run.run_id, subgoal_id: sid, attempt: out.attempt });
  return { run_id: run.run_id, target: sid, subgoal_id: sid, retried: true, attempt: out.attempt, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
}

// What is happening right now, without a run_id in hand. A lead that lost the id - a
// fresh session, a compaction, a second operator looking in - had no way back into a run
// from the MCP alone, and no way to see what a blocking graph_run is doing meanwhile.
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
    has_spec: !!run.spec,
    subgoals: run.spec ? (run.spec.subgoals || []).map((s) => s.id) : [],
    nodes: run.nodes
      .filter((n) => (a.node_id ? n.node_id === a.node_id : true))
      .map((n) => (n.state === 'pending' || n.state === 'running'
        ? {
          node_id: n.node_id,
          stage: n.stage,
          state: n.state,
          deps: n.deps,
          // A blocking graph_run is otherwise invisible: the node reads as bare "running"
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
    case 'graph_open': return await toolGraphOpen(a);
    case 'graph_next': return await toolGraphNext(a);
    case 'graph_run':
      return await toolGraphRun({ ...a, __onCancel: (cancel) => registerCanceller(requestId, cancel) });
    case 'graph_submit': return toolGraphSubmit(a);
    case 'graph_retry': return await toolGraphRetry(a);
    case 'graph_status': return toolGraphStatus(a);
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
