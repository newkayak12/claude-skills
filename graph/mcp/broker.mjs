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
  findRun,
  listRuns,
  getNode,
  expandSubgoals,
  validateSpec,
  retrySubgoal,
  retrySpec,
  readyNodes,
  runState,
  unmetDeps,
  nodeBriefing,
  stagePolicy,
} from './graph.mjs';
import { composePrompt } from './prompts.mjs';
import { mutateRun, writeAtomic, pidAlive } from './store.mjs';

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
    // A hook reads this while the broker rewrites it: never let it see half a file.
    writeAtomic(join(brokerDir(cwd), 'open-nodes.json'), map);
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
  // -z: paths verbatim - the default output quotes any path with a space or non-ASCII byte,
  // and a quoted path never equals the claim, so a truthful node was failed as contradicted.
  // A rename is "R  new\0old": the entry after a rename/copy is its source and is skipped.
  // (Ported from teams 1a00aba.)
  const r = spawnSync('git', ['-c', 'core.quotePath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) return null;
  const parts = r.stdout.split('\0');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    out.push(e.slice(3));
    if (e[0] === 'R' || e[0] === 'C') i++;
  }
  return out;
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
  // A claim is a path, sometimes with a note after it: "x.mjs (deleted)", "fx/*.json (23
  // fixtures)". The note is dropped; a glob matches what git lists. (Ported from teams 1a00aba.)
  const toRel = (f) => {
    const p = String(f).replace(/\s+\([^)]*\)?.*$/, '').trim().replace(/\\/g, '/');
    return (p.startsWith(base) ? p.slice(base.length) : p).replace(/^\.\//, '');
  };
  const globRe = (g) => new RegExp('(^|/)' + g.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
  const seen = (r) => (r.includes('*') ? observed.some((o) => globRe(r).test(o)) : observed.some((o) => o === r || o.endsWith('/' + r)));
  const list = Array.isArray(claimed) ? claimed.map(String) : [];
  const unseen = list.filter((f) => {
    const r = toRel(f);
    return !r || !seen(r);
  });
  // git status never lists an ignored path, so a file written there is invisible to it. A
  // claimed file that exists and is ignored is not contradicted; it is not verified either.
  // (Ported from teams e33f3aa.)
  const ignored = unseen.filter((f) => {
    const r = toRel(f);
    return r && !r.includes('*') && existsSync(join(cwd, r)) && spawnSync('git', ['check-ignore', '-q', '--', r], { cwd }).status === 0;
  });
  const missing = unseen.filter((f) => !ignored.includes(f));
  const extra = ignored.length ? { ignored_files: ignored } : {};
  if (!isolated) {
    return {
      changed_files_verified: missing.length ? false : null,
      change_attribution: 'shared-worktree',
      contradicted_files: missing,
      ...extra,
    };
  }
  return { changed_files_verified: missing.length ? false : ignored.length ? null : true, change_attribution: 'isolated', contradicted_files: missing, ...extra };
}

// ---------- run lookup ----------

const knownCwds = new Set();

// graph_run is synchronous: while a node runs, the call is held open by the process that
// started it. So a node marked `running` that this process did not start, and that has
// been sitting long enough, belongs to a broker that died - it is not in flight, it is
// abandoned. Without reclaiming it the run wedges forever: graph_next offers nothing and
// graph_run refuses the node as already running.
// run_id:node_id -> the ticket this process is running it under.
const activeNodes = new Map();
// One run mutation = one store transaction on the fresh run (never on `run`, which may be
// minutes old). Afterwards the caller's snapshot is replaced by what was committed, so
// code that reads `run` next sees the truth - but any node reference taken from the old
// snapshot is stale: look nodes up again by id.
function transact(run, fn) {
  let committed = null;
  const out = mutateRun(run.cwd, run.run_id, (fresh) => {
    committed = fresh;
    return fn(fresh);
  });
  for (const k of Object.keys(run)) if (!(k in committed)) delete run[k];
  Object.assign(run, committed);
  return out;
}

const STALE_AFTER_MS = Number(process.env.BROKER_STALE_AFTER_MS) > 0
  ? Number(process.env.BROKER_STALE_AFTER_MS)
  : 10 * 60 * 1000;

// This boot of the host; a claim stamped under another boot has no live owner, whatever
// its pid now names. null where the kernel does not expose one.
const BOOT_ID = (() => {
  try { return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() || null; } catch { return null; }
})();

// A running node is abandoned when the process that claimed it is gone - not when it is
// slow: adapter runs routinely outlast STALE_AFTER_MS (NODE_TIMEOUT_MS is 45 min), and a
// time-only judgement failed a live broker's node and then dropped its real result as
// superseded. Elapsed time is only the fallback for a claim with no owner recorded (run
// files written before claims carried one).
function ownerGone(n) {
  if (!Number.isInteger(n.owner_pid)) return null;
  if (n.owner_boot && BOOT_ID && n.owner_boot !== BOOT_ID) return true;
  // Our own pid is always alive: the claim is live only if this process still holds it
  // (a release that failed to write, or a pid reused within one boot, leaves it unheld).
  if (n.owner_pid === process.pid) return ![...activeNodes.values()].includes(n.ticket);
  return !pidAlive(n.owner_pid);
}

function reclaimAbandoned(run) {
  const stranded = (n) => {
    if (n.state !== 'running' || activeNodes.has(`${run.run_id}:${n.node_id}`)) return false;
    const gone = ownerGone(n);
    return gone === null ? Date.now() - (n.started_at || 0) >= STALE_AFTER_MS : gone;
  };
  if (!run.nodes.some(stranded)) return 0;
  // Judged again on the fresh run: a node another broker finished meanwhile is not stranded.
  const reclaimed = transact(run, (fresh) => {
    let count = 0;
    for (const n of fresh.nodes) {
      if (!stranded(n)) continue;
      n.state = 'failed';
      n.result = {
        stage_ok: false,
        reason: 'abandoned: the broker executing this node exited before it finished',
      };
      count++;
    }
    return count;
  });
  if (reclaimed) {
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
      // native_models declares actual model selection capability, independently from the
      // driving conversation's model. The defaults name a tier ("sonnet"); the host names
      // ids ("claude-sonnet-5") or aliases - resolve one against the other before refusing.
      // The host's own model is selectable by definition: a fresh native agent with no
      // model override inherits it. A tier the host did not declare at all falls back to
      // that model, and the reason says so - visible substitution, never a silent one, and
      // never a dead run over a naming mismatch. (Ported from teams 0.6.1/0.6.2, where a
      // bench session reporting itself as "claude-opus-5[1m]" blocked at plan, and every
      // implement node blocked on "sonnet" vs "claude-sonnet-5" with zero failed nodes.)
      const resolved = resolveNativeModel(run, model);
      if (!resolved) {
        attempts.push({ vendor: name, ready: false, reason: `native host cannot select model ${model}` });
        continue;
      }
      const reason = resolved.fallback ? `${candidate.reason}; model ${model} not in native_models, host model used` : candidate.reason;
      return { vendor: 'self', executor: name, sandbox: null, model: resolved.model, reason, attempts };
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
    const epochAtProbe = run.capacity_epoch || 0;
    const p = await probe(name, v, run.cwd, sandbox, model);
    const usable = REASONING_STAGES.has(stage) ? p.reachable : p.ready;
    // Spent capacity is recorded on the run so the operator sees why the vendor dropped
    // out, the run stops re-probing it, and graph_retry({reset_capacity:true}) is the way back.
    // An explicit reset that landed while this probe ran wins over its verdict.
    if (!usable && p.quota) {
      transact(run, (fresh) => {
        if ((fresh.capacity_epoch || 0) !== epochAtProbe) return;
        fresh.unavailable_vendors = { ...(fresh.unavailable_vendors || {}), [name]: 'usage capacity exhausted at probe' };
      });
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
  // The opposite overrule: an author said stage_ok:false with nothing behind it and the work went on to be judged.
  if (res.self_reported_stage_ok === false) out.self_reported_stage_ok = false;
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

// Who may record an outcome on a node - judged on the fresh run, inside the transaction
// that records it. graph_run holds a ticket stamped before its adapter ran: its outcome
// lands only if the node still runs under that ticket. Anything else (another broker
// took the node over, a retry retired it, a reclaim failed it) means the outcome is late
// and is dropped - never written over whatever the node now says. graph_submit holds no
// ticket: its node must still be runnable, as it was when the call began.
function claimOutcome(fresh, nodeId, expect) {
  if (expect.ticket) {
    const n = getNode(fresh, nodeId);
    if (!n) return { why: `node ${nodeId} no longer exists` };
    if (n.ticket !== expect.ticket) return { n, why: `node ${nodeId} is no longer running under this call's ticket` };
    if (n.state !== 'running') return { n, why: `node ${nodeId} is ${n.state}, no longer running under this call's ticket` };
    return { n };
  }
  const n = requireRunnable(fresh, nodeId);
  if (expect.prepare) expect.prepare(n);
  return { n };
}

function noteSuperseded(n, expect, result, vendorName, why) {
  if (!n) return;
  n.superseded_results = [...(n.superseded_results || []), {
    ticket: expect.ticket || null, vendor: vendorName, at: Date.now(),
    stage_ok: result.stage_ok === true, reason: why,
  }];
}

function supersededVerdict(run, nodeId, expect, vendorName, why) {
  syncOpenNodes(run);
  record(run.cwd, { event: 'result_superseded', run_id: run.run_id, node_id: nodeId, ticket: expect.ticket || null, vendor: vendorName, reason: why });
  const n = getNode(run, nodeId);
  const base = n ? verdict(run, n) : { run_id: run.run_id, node_id: nodeId, stage: 'unknown', state: 'skipped', stage_ok: false };
  return { ...base, superseded: true, reason: `result dropped: ${why}` };
}

const VERDICT_FIELD = { gate: 'accept', critique: 'sound', test: 'verified' };

// An authoring node's own stage_ok is not a verdict on its work - the test and gate nodes
// are. An author that reports stage_ok:false with no reason, no error and only passing
// checks has mis-set a flag, not failed; failing it spent a retry on work nobody judged.
// The flag stays on the result for the gate to see. A stated reason, an error, a
// contradicted claim or a failing check is honoured. (Ported from teams 803dc5b.)
function withJudgedOutcome(n, result) {
  if (REASONING_STAGES.has(n.stage)) return result;
  if (result.stage_ok !== false || result.reason || result.error || result.verification_error
    || (result.contradicted_files || []).length || result.submitted_stage_ok === true || result.killed_for) return result;
  const checks = Array.isArray(result.checks) ? result.checks : [];
  const failing = checks.some((c) => /\b(fail(ed|ing|s)?|error|ENOENT|exit(ed)? [1-9]|not ok)\b/i.test(String(c)) && !/\b0 fail/i.test(String(c)));
  if (failing) return result;
  return {
    ...result, stage_ok: true, self_reported_stage_ok: false,
    stage_ok_note: 'author reported stage_ok:false with no reason and no failing check; the test and gate nodes judge the work, not the author',
  };
}

// A rejection the judging itself produced (stage_ok:true, verdict field false) can still
// leave `reason` empty - test's contract has no reason field, only checks/evidence - and the
// verdict and the retry's feedback read only `reason`, so a real rejection showed no cause.
// (Ported from teams b914d04.)
function withRejectionReason(n, result) {
  if (n.state !== 'failed' || result.stage_ok !== true) return result;
  const field = VERDICT_FIELD[n.stage];
  const hasOwnReason = result.reason || result.verification_error
    || (field === 'accept' && (result.gaps || []).length)
    || (field === 'sound' && (result.blocking || []).length);
  if (!field || result[field] !== false || hasOwnReason) return result;
  const checks = Array.isArray(result.checks) ? result.checks : [];
  const flagged = checks.find((c) => /\b(missing|fail(ed|ing|s)?|not met|does not|refused)\b/i.test(String(c)));
  const synthesized = flagged || (result.evidence ? String(result.evidence) : '') || checks.join('; ');
  return synthesized ? { ...result, reason: synthesized.slice(0, 300) } : result;
}

function finishNode(run, nodeId, result, vendorName, expect) {
  const why = transact(run, (fresh) => {
    const { n, why: late } = claimOutcome(fresh, nodeId, expect);
    if (late) {
      noteSuperseded(n, expect, result, vendorName, late);
      return late;
    }
    delete n.recovery; // historical interruptions remain in n.interruptions
    const res = withJudgedOutcome(n, result);
    n.state = nodeSucceeded(n, res) ? 'done' : 'failed';
    n.result = withRejectionReason(n, res);
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
        fresh.spec = result.spec;
        expandSubgoals(fresh, result.spec.subgoals);
      }
    }
    return null;
  });
  if (why) return supersededVerdict(run, nodeId, expect, vendorName, why);
  const n = getNode(run, nodeId);
  syncOpenNodes(run);
  record(run.cwd, { event: 'node_finish', run_id: run.run_id, node_id: n.node_id, stage: n.stage, vendor: vendorName, stage_ok: n.result.stage_ok === true });
  return verdict(run, n);
}

function checkpointInterruption(run, nodeId, executor, details, kind, expect) {
  const before = getNode(run, nodeId);
  const dir = join(brokerDir(run.cwd), run.run_id, nodeId.replace(/[^A-Za-z0-9._-]/g, '_'), `recovery-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'checkpoint.json');
  const detailPath = join(dir, 'interrupted-result.json');
  // Written before the transaction so the node never points at a checkpoint that is not
  // on disk yet. If the outcome turns out to be late, these files are only orphaned.
  writeFileSync(detailPath, JSON.stringify(details, null, 2));
  writeFileSync(path, JSON.stringify({ node_id: nodeId, executor, kind, cwd: run.cwd,
    detail_path: detailPath, previous_detail_path: (before && before.detail_path) || null,
    previous_checkpoint: (before && before.recovery?.checkpoint_path) || null,
    run_path: join(brokerDir(run.cwd), 'runs', `${run.run_id}.json`),
    changed_files: (gitChanged(run.cwd) || []).filter(p => !p.startsWith('.harness-run/')),
    instruction: 'Inspect the current files before continuing. Partial writes are not verified completion. Keep original acceptance criteria; rerun verification.' }, null, 2));
  const outcome = { stage_ok: false, reason: `${executor} ${kind}; work retained at ${path}` };
  const why = transact(run, (fresh) => {
    const { n, why: late } = claimOutcome(fresh, nodeId, expect);
    if (late) {
      noteSuperseded(n, expect, outcome, executor, late);
      return late;
    }
    n.recovery = { checkpoint_path: path, executor, kind, from_ticket: n.ticket || null };
    n.interruptions = [...(n.interruptions || []), n.recovery];
    n.result = outcome;
    n.vendor = executor;
    n.state = 'pending';
    n.ticket = null;
    delete n.assignment;
    if (kind === 'quota') fresh.unavailable_vendors = { ...(fresh.unavailable_vendors || {}), [executor]: 'usage capacity exhausted in this run' };
    return null;
  });
  if (why) return supersededVerdict(run, nodeId, expect, executor, why);
  syncOpenNodes(run);
  record(run.cwd, { event: 'node_interrupted', run_id: run.run_id, node_id: nodeId, executor, kind, checkpoint_path: path });
  return { ...verdict(run, getNode(run, nodeId)), recoverable: true, checkpoint_path: path, next: 'call graph_next for fallback; graph_retry with node_id and reset_capacity after quota renewal' };
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
    change_attribution: { type: ['string', 'null'], enum: ['isolated', 'shared-worktree', 'no-git', null] },
    contradicted_files: { type: 'array', items: { type: 'string' } },
    submitted_stage_ok: { type: 'boolean', description: 'present when the broker overruled the executor' },
    self_reported_stage_ok: { type: 'boolean', description: 'present (false) when an authoring node reported stage_ok:false with no reason and no failing check, and the broker let the test and gate judge the work instead' },
    missing_verdict: { type: 'string', description: 'the verdict field the node failed to return' },
    killed_for: { type: 'string', enum: ['timeout', 'cancelled'] },
    reason: { type: 'string' },
    detail_path: { type: ['string', 'null'], description: 'read this for one node only; never pull a whole run into context' },
    superseded: { type: 'boolean', description: 'this call\'s outcome arrived after the node moved on and was dropped; the verdict shows the node as it now is' },
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
    unreachable: { type: 'array', items: { type: 'string' }, description: 'retried=false with the budget gone: nodes that can never run now, so the report is released' },
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
      'Open a fresh attempt, carrying the rejection feedback forward. With subgoal_id, retries that subgoal. Without it, retries the spec itself (setgoal + critique) and discards the subgoal graph the rejected spec produced. The failed attempt stays in the graph as evidence. When the retry budget is gone the failure is settled instead: every node that needed its output becomes `unreachable`, and the report - which only waits for the goal gate to finish, not to pass - becomes ready to write the partial account.',
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
  const missing = unmetDeps(run, n);
  if (missing.length) throw new Error(`node ${n.node_id} is blocked on ${missing.join(', ')}`);
  return n;
}

async function toolGraphOpen(a) {
  const cwd = resolve(String(a.cwd));
  knownCwds.add(cwd);
  const run = createRun({
    cwd,
    request: String(a.request),
    // createRun already applies its own default for every field below - passing the
    // caller's value through untouched keeps createRun the one place any of them is
    // decided, instead of two sites that only agree by coincidence (the be83bbc shape).
    // context/vendor/allocation/host_vendor/host_model/native_models/model/candidates/
    // sandbox are `opts.x || DEFAULT` on createRun's side, and `||` is idempotent - a raw
    // value re-run through the same fallback twice or once lands on the same result for
    // every input. policy's createRun-side check is stricter (`typeof === 'object'`, not
    // just truthy), but still reduces any input - falsy, a truthy non-object, or a real
    // object - to the same output whether or not this call pre-applied `|| {}` first.
    context: a.context,
    vendor: a.vendor,
    allocation: a.allocation,
    host_vendor: a.host_vendor,
    host_model: a.host_model,
    native_models: a.native_models,
    model: a.model,
    policy: a.policy,
    candidates: a.candidates,
    sandbox: a.sandbox,
    // Not a default fallback like the above - both sides hardcode the same `=== true`
    // coercion, so there is no second value for the two sites to disagree on. Left as-is.
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
        transact(run, (fresh) => {
          const f = getNode(fresh, n.node_id);
          // Only a node still waiting gets an assignment; one another broker started keeps its own.
          if (!f || f.state !== 'pending') return;
          f.assignment = r;
          f.executor = r.executor || r.vendor;
        });
      }
      const briefingPath = join(brokerDir(run.cwd), run.run_id, 'briefings', `${n.node_id.replace(/[^A-Za-z0-9._-]/g, '_')}.md`);
      if (r.vendor === 'self') {
        try {
          mkdirSync(dirname(briefingPath), { recursive: true });
          const cur = getNode(run, n.node_id) || n;
          writeFileSync(briefingPath, composePrompt(run, cur, nodeBriefing(run, cur)));
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
  const blocked = Boolean(response.ready.length && response.ready.every(n => n.vendor === 'vendor-failure'));
  transact(run, (fresh) => { fresh.routing_blocked = blocked; });
  response.state = runState(run).state;
  return response;
}

// The fields graph_run's claim stamps on a node; a released claim restores them.
const CLAIM_FIELDS = ['ticket', 'executor', 'model', 'started_at', 'detail_path', 'owner_pid', 'owner_boot'];

async function toolGraphRun(a) {
  const run = mustFindRun(a);
  const nodeId = String(a.node_id);
  requireRunnable(run, nodeId); // cheap early refusal; the claim below is the real check

  const r = await route(run, getNode(run, nodeId));
  if (r.vendor === 'self') throw new Error(`node ${nodeId} is routed to self - use graph_submit`);
  if (r.vendor === 'vendor-failure') {
    // route() awaited probes; another broker may have started the node meanwhile. Only a
    // node that is still runnable on the fresh run may be failed for want of a vendor.
    transact(run, (fresh) => {
      const n = requireRunnable(fresh, nodeId);
      n.state = 'failed';
      n.result = { stage_ok: false, reason: r.attempts.map((x) => `${x.vendor}: ${x.reason}`).join(' | ') };
      n.vendor = 'vendor-failure';
    });
    return verdict(run, getNode(run, nodeId));
  }

  const vendor = loadVendors(run.cwd)[r.vendor];
  const ticket = randomUUID();
  const dir = join(brokerDir(run.cwd), run.run_id, nodeId.replace(/[^A-Za-z0-9._-]/g, '_'), ticket);
  const promptPath = join(dir, 'prompt.md');
  const outPath = join(dir, 'result.json');
  const eventsPath = join(dir, 'events.jsonl');
  // Claim before the side effect. The node is re-checked on the fresh run and stamped with
  // this call's ticket in one transaction, so of two graph_run calls on one node exactly
  // one gets to start the adapter; the other is refused here.
  let preClaim = null;
  transact(run, (fresh) => {
    const cur = getNode(fresh, nodeId);
    if (cur && cur.state === 'running') throw new Error(`node ${nodeId} is already running under ticket ${cur.ticket || '(none)'} - refusing to start it twice`);
    const n = requireRunnable(fresh, nodeId);
    preClaim = Object.fromEntries(CLAIM_FIELDS.filter((k) => k in n).map((k) => [k, n[k]]));
    n.ticket = ticket;
    n.owner_pid = process.pid; // abandoned = this process is gone (reclaimAbandoned)
    n.owner_boot = BOOT_ID;
    n.executor = r.executor || r.vendor;
    n.model = r.model || null;
    n.state = 'running';
    n.started_at = Date.now();
    n.detail_path = outPath;
  });
  syncOpenNodes(run);
  const activeKey = `${run.run_id}:${nodeId}`;
  activeNodes.set(activeKey, ticket);
  // From here until the outcome is applied (finishNode / checkpointInterruption), a throw
  // releases the claim: still under this ticket and running, the node goes back to pending
  // with its pre-claim fields. Otherwise nothing would ever finish the ticket - the node
  // would wait STALE_AFTER_MS and then be failed as abandoned, spending an attempt.
  try {
    return await runClaimed(a, run, nodeId, r, vendor, ticket, { dir, promptPath, outPath, eventsPath });
  } catch (e) {
    releaseClaim(run, nodeId, ticket, preClaim, e);
    throw e;
  } finally {
    activeNodes.delete(activeKey);
  }
}

function releaseClaim(run, nodeId, ticket, preClaim, err) {
  try {
    const released = transact(run, (fresh) => {
      const n = getNode(fresh, nodeId);
      if (!n || n.state !== 'running' || n.ticket !== ticket) return false; // outcome applied or superseded
      for (const k of CLAIM_FIELDS) delete n[k];
      Object.assign(n, preClaim || {});
      n.state = 'pending';
      return true;
    });
    if (!released) return;
    syncOpenNodes(run);
    record(run.cwd, { event: 'claim_failed', run_id: run.run_id, node_id: nodeId, ticket, error: String((err && err.message) || err).slice(0, 300) });
  } catch {
    /* best-effort: if even this cannot be written, reclaimAbandoned is the backstop */
  }
}

async function runClaimed(a, run, nodeId, r, vendor, ticket, { dir, promptPath, outPath, eventsPath }) {
  let n = getNode(run, nodeId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(promptPath, composePrompt(run, n, nodeBriefing(run, n)));

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

  const proc = await runAdapter(vendor, args, run.cwd, {
    register: (cancel) => { if (a.__onCancel) a.__onCancel(cancel); },
    timeoutMs: a.timeout_ms,
  });
  const report = readJson(outPath) || {};
  const payload = parseVendorResult(report) || {};

  // The vendor call above may have taken minutes and `run` is that old. The outcome is
  // recorded in a transaction on the fresh run, and only under this call's ticket.
  const expect = { ticket };
  const transportOk = proc.status === 0;
  if (run.allocation === 'balanced' && (!transportOk || report.stage_ok === false)
      && capacityFailure(report, proc.stderr)) {
    return checkpointInterruption(run, nodeId, r.executor || r.vendor, { ...report,
      transport: { status: proc.status, stderr: proc.stderr, stdout: proc.stdout } }, 'quota', expect);
  }
  // A vendor that answered in full but whose JSON does not parse has not failed the work - it
  // mistyped the envelope (one stray `]` after a complete plan). Nothing retries a plan or
  // report node, so that one character dead-ended the run. One fresh attempt on the same
  // vendor; a second malformed answer is a failure. (Ported from teams 3cf65d7.)
  const malformed = !proc.killed_for && /[{[]/.test(String(report.last_message || ''))
    && !report.result && (Object.keys(payload).length === 0 || payload._unparsed === true);
  if (malformed && !(n.interruptions || []).some((i) => i.kind === 'malformed')) {
    return checkpointInterruption(run, nodeId, r.executor || r.vendor, { ...report,
      transport: { status: proc.status, stderr: proc.stderr } }, 'malformed', expect);
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
  return finishNode(run, nodeId, result, r.vendor, expect);
}

function toolGraphSubmit(a) {
  const run = mustFindRun(a);
  const nodeId = String(a.node_id);
  const n = requireRunnable(run, nodeId);
  const payload = a.payload || {};
  // Checked here for a fast error, and again on the fresh node when the result is applied.
  const nativeOnly = (x) => {
    if (!x.assignment || x.assignment.vendor !== 'self') throw new Error('balanced node must be assigned to a native executor by graph_next before submit');
    x.executor = x.assignment.executor || 'self';
    x.model = x.assignment.model || null;
  };
  const expect = { prepare: run.allocation === 'balanced' ? nativeOnly : null };
  if (run.allocation === 'balanced') {
    nativeOnly(n);
    if (payload.stage_ok === false && capacityFailure(payload)) return checkpointInterruption(run, nodeId, n.executor, payload, 'quota', expect);
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
  return finishNode(run, nodeId, result, 'self', expect);
}

async function toolGraphRetry(a) {
  const run = mustFindRun(a);
  // Validate before touching anything: a call that is going to be rejected must not have
  // already spent the capacity reset.
  const retryable = (n) => n && n.state === 'pending' && n.recovery;
  const mustBeRetryable = (r) => {
    if (a.node_id && !retryable(getNode(r, String(a.node_id)))) {
      throw new Error('node_id must identify a currently interrupted pending node');
    }
  };
  mustBeRetryable(run);

  // The capacity reset and the node reopen are one transaction, validated on the fresh
  // run first: a call that is going to be rejected must not have spent the reset.
  if (a.reset_capacity === true || a.node_id) {
    transact(run, (fresh) => {
      mustBeRetryable(fresh);
      // A vendor can be excluded before it ever runs a node, so a capacity reset cannot
      // require an interrupted node to name.
      if (a.reset_capacity === true) {
        fresh.unavailable_vendors = {};
        fresh.capacity_epoch = (fresh.capacity_epoch || 0) + 1;
        // An assignment made while the vendor was excluded is stale: re-rank it. Work already
        // dispatched keeps its executor - only what has not left the gate is reconsidered.
        for (const n of fresh.nodes) if (n.state === 'pending' && !n.ticket) delete n.assignment;
      }
      if (a.node_id) {
        const n = getNode(fresh, String(a.node_id));
        n.state = 'pending';
        n.ticket = null;
        delete n.assignment;
      }
    });
    if (a.reset_capacity === true) probeCache.clear();
    if (a.node_id) {
      return { run_id: run.run_id, target: String(a.node_id), retried: true, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
    }
    if (!a.subgoal_id) {
      record(run.cwd, { event: 'graph_retry', run_id: run.run_id, target: 'capacity' });
      return { run_id: run.run_id, target: 'capacity', retried: true, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
    }
  }

  // No subgoal named means the spec itself was rejected: redo setgoal and critique.
  if (!a.subgoal_id) {
    const out = transact(run, (fresh) => {
      const source = fresh.nodes
        .filter((n) => (n.stage === 'critique' || n.stage === 'setgoal') && n.state === 'failed' && n.result)
        .pop() || fresh.nodes.filter((n) => n.stage === 'critique' && n.result).pop();
      const fb = source && source.result
        ? [source.result.reason || '', ...(source.result.blocking || []),
           ...(source.result.spec_problems || []), ...(source.result.problems || [])]
            .filter(Boolean).join('\n- ')
        : '';
      const { attempt, reason, unreachable } = retrySpec(fresh, fb);
      return { attempt, reason, unreachable };
    });
    if (!out.attempt) {
      record(run.cwd, { event: 'graph_settle', run_id: run.run_id, target: 'spec', unreachable: out.unreachable.length });
      return { run_id: run.run_id, target: 'spec', retried: false, reason: out.reason, unreachable: out.unreachable, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
    }
    record(run.cwd, { event: 'graph_retry', run_id: run.run_id, target: 'spec', attempt: out.attempt });
    return { run_id: run.run_id, target: 'spec', retried: true, attempt: out.attempt, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
  }

  const sid = String(a.subgoal_id);
  const out = transact(run, (fresh) => {
    // The last node that judged this subgoal: its gate, or the test that failed before any
    // gate ran. A retry after a failed test used to carry no feedback at all.
    const judged = fresh.nodes.filter((n) => n.subgoal_id === sid && n.result && (n.stage === 'gate' || n.state === 'failed'));
    const last = judged[judged.length - 1];
    // A goal gate that rejected the assembled result names what the run as a whole lacks; the
    // subgoal being retried for it must hear that too, since its own gate passed.
    const goal = fresh.nodes.filter((n) => n.stage === 'gate' && n.subgoal_id === null && n.state === 'failed' && !n.final && n.result).pop();
    const feedback = [
      ...(last && last.result
        ? [last.result.reason || '', ...(last.result.gaps || []), ...(last.result.verified === false ? (last.result.checks || []) : [])]
        : []),
      ...(goal ? [`goal gate ${goal.node_id}: ${goal.result.reason || 'rejected'}`, ...(goal.result.gaps || [])] : []),
    ].filter(Boolean).join('\n- ');
    const { attempt, reason, unreachable } = retrySubgoal(fresh, sid, feedback);
    return { attempt, reason, unreachable };
  });
  if (!out.attempt) {
    record(run.cwd, { event: 'graph_settle', run_id: run.run_id, subgoal_id: sid, unreachable: out.unreachable.length });
    return { run_id: run.run_id, target: sid, subgoal_id: sid, retried: false, reason: out.reason, unreachable: out.unreachable, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
  }
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
    // A run file written before capacity state was initialized at creation has none.
    return { ...run, capacity_epoch: run.capacity_epoch || 0, unavailable_vendors: run.unavailable_vendors || {} };
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
          after: n.after || [],
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
