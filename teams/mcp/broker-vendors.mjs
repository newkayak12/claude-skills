// broker-vendors.mjs - the vendor registry, the ledger, adapter invocation and the readiness
// probe, cut out of broker.mjs (card 128). Leaf module: imports nothing from the other
// broker-*.mjs files, so every one of them may import it.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { capacityFailure, capacityNotice } from './routing.mjs';
import { leanLaunchArgs, resolveStageModel } from './nodelaunch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------- vendor registry ----------
//
// A vendor is anything that meets the adapter CLI contract:
//   <cmd> [args] --detect  --cwd DIR --sandbox MODE --output FILE
//   <cmd> [args] --stage S --cwd DIR --prompt-file F --events-output F --output F
//                --sandbox MODE [--isolated] [--add-dir DIR] [--model M]
//                [--setting-sources S] [--plugin-dir DIR]... [--mcp-config JSON]   (claude adapter only)
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
export function AUTO_CANDIDATES(hostVendor) {
  const base = ['claude', 'codex'];
  return hostVendor && base.includes(hostVendor)
    ? [...base.filter((v) => v !== hostVendor), hostVendor]
    : base;
}

export function loadVendors(cwd) {
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

const isClaudeAdapter = (v) => Boolean(v && Array.isArray(v.args) && v.args[0] === BUILTIN_VENDORS.claude.args[0]);

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

// Everything the harness itself writes while a node runs - the ledger, probe caches, and
// every node's own prompt/result files - lives here. Never attributable to the node under
// judgment (verifySnapshot/verifyRestore in broker-checkpoint.mjs read this same constant).
export const HARNESS_ROOT = '.teams_output';

export function brokerDir(cwd) {
  return join(cwd, HARNESS_ROOT, 'broker');
}

export function record(cwd, entry) {
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
export function syncOpenNodes(run) {
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

// opts.stage marks a node launch: the spawned args then carry exactly one explicit --model (the
// one already in extraArgs, else the stage's resolved model; opts.models is the merged `models`
// option). The detect probe passes no stage and runs with its args untouched. opts.spawn is a
// test seam for node:child_process spawn.
// opts.lean (the task argument of nodelaunch.mjs leanLaunchArgs: stage_skills, plugin_dirs, root)
// makes the launch lean too: --strict-mcp-config with the teams server only, project settings, the
// stage's plugin dirs. Only the builtin claude adapter takes those flags, so any other vendor gets
// the model alone; args already carrying --mcp-config are left as given.
export function runAdapter(vendor, extraArgs, cwd, opts = {}) {
  let args = extraArgs;
  if (opts.stage) {
    if (!args.includes('--model')) args = [...args, '--model', resolveStageModel(opts.stage, { models: opts.models })];
    // The adapter is strict by itself, so --strict-mcp-config is not passed to it: its own claude argv carries it.
    if (opts.lean && isClaudeAdapter(vendor) && !args.includes('--mcp-config')) args = [...args, ...leanLaunchArgs(opts.stage, opts.lean).filter((a) => a !== '--strict-mcp-config')];
  }
  return new Promise((resolve) => {
    let child;
    try {
      child = (opts.spawn || spawn)(vendor.command, [...(vendor.args || []), ...args], {
        cwd,
        // a node does a stage's work; it must not open a run (the gates read HARNESS_NODE)
        env: { ...process.env, HARNESS_NODE: '1' },
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

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// ---------- readiness probe ----------

export const probeCache = new Map();

// Every string in a report, whatever shape the adapter chose.
function flatten(value, depth = 0) {
  if (typeof value === 'string') return value;
  if (depth > 6 || !value || typeof value !== 'object') return '';
  return Object.values(value).map((v) => flatten(v, depth + 1)).filter(Boolean).join('\n');
}

export async function probe(name, vendor, cwd, sandbox, model) {
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
    if (quota) {
      const notice = capacityNotice([r.stderr, flatten(report)].join('\n'));
      out.reason = `usage capacity exhausted at probe${notice ? `: ${notice}` : out.reason ? `; ${out.reason}` : ''}`;
    }
  }
  settle(out);
  probeCache.set(key, Promise.resolve(out));
  return out;
}
