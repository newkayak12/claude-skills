#!/usr/bin/env node
// Size-S path bench on the fake-driver fixture (card 178 Task 4): the same inputs before and
// after an engine change. Runs are sequential so wall times do not contend with each other.
//
//   node teams/scripts/bench/s-path-bench.mjs --label before [--n 5] [--max-wait-s 600]
//
// Writes tmp/card178-t4/<label>.json under the repo root. Waits while the 1-minute load is above
// the core count, for at most --max-wait-s seconds, then runs anyway and records that.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg, availableParallelism } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFixture } from '../lib/s-path-fixture.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const label = arg('label', null);
const n = Number(arg('n', 5));
const maxWaitS = Number(arg('max-wait-s', 600));
if (!label || !/^[\w.-]+$/.test(label) || !Number.isInteger(n) || n < 1 || !Number.isFinite(maxWaitS) || maxWaitS < 0) {
  console.error('usage: s-path-bench.mjs --label <name> [--n <k>] [--max-wait-s <s>]');
  process.exit(2);
}

const ROUTES = {
  graph: { shape: 'graph', pattern: 'bg-exit', driver_restarts: 1, repeat: n },
  'fallback-copy': { shape: 'fallback-copy', pattern: 'bg-exit', driver_restarts: 1, repeat: n },
  'fallback-files': { shape: 'fallback-files', pattern: 'bg-exit', driver_restarts: 1, repeat: n },
  'graph-r0': { shape: 'graph', pattern: 'bg-exit', driver_restarts: 0, repeat: n },
  crash: { shape: 'graph', pattern: 'crash', driver_restarts: 1, repeat: 1 },
  idle0: { shape: 'graph', pattern: 'idle0', driver_restarts: 1, repeat: 1 },
  churn0: { shape: 'graph', pattern: 'churn0', driver_restarts: 1, repeat: 1 },
  creep0: { shape: 'graph', pattern: 'creep0', driver_restarts: 1, repeat: 1 },
  'session-death': { shape: 'graph', pattern: 'hang', driver_restarts: 1, repeat: 1, sessionDeath: true },
};

const readUptime = () => execFileSync('uptime', { encoding: 'utf8' }).trim();
const ncpu = availableParallelism();
const load1_at_start = loadavg()[0];
console.log(`uptime: ${readUptime()}\ncores: ${ncpu}`);
const waitStart = Date.now();
while (loadavg()[0] > ncpu && (Date.now() - waitStart) / 1000 < maxWaitS) {
  console.log(`waiting: 1-minute load ${loadavg()[0].toFixed(2)} is above ${ncpu} cores`);
  await new Promise((r) => setTimeout(r, 15000));
}
const waited_s = Math.round((Date.now() - waitStart) / 1000);
// The reading the numbers are quoted with: the one the runs start under.
const uptime = readUptime();
const over_cores = loadavg()[0] > ncpu;
console.log(`runs start: ${uptime}${over_cores ? ' (still above cores; max wait reached)' : ''}`);

const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
const out = { label, head, load: { uptime, load1_at_start, ncpu, waited_s, max_wait_s: maxWaitS, over_cores }, n, routes: {} };
let missing = 0;
for (const [name, r] of Object.entries(ROUTES)) {
  const entry = { pattern: r.pattern, driver_restarts: r.driver_restarts, runs: [] };
  out.routes[name] = entry;
  for (let i = 0; i < r.repeat; i++) {
    try {
      entry.runs.push(await runFixture({ route: r.shape, pattern: r.pattern, driverRestarts: r.driver_restarts, sessionDeath: !!r.sessionDeath }));
    } catch (e) {
      missing++;
      console.error(`${name} run ${i + 1}: ${(e && e.stack) || e}`);
    }
  }
}
out.load.uptime_after = execFileSync('uptime', { encoding: 'utf8' }).trim();

const dir = join(REPO, 'tmp', 'card178-t4');
mkdirSync(dir, { recursive: true });
const file = join(dir, `${label}.json`);
writeFileSync(file, JSON.stringify(out, null, 1) + '\n');

const tally = (runs, key) => {
  const counts = {};
  for (const x of runs) counts[x[key]] = (counts[x[key]] || 0) + 1;
  return Object.entries(counts).map(([k, v]) => `${k}x${v}`).join(',');
};
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
console.table(Object.fromEntries(Object.entries(out.routes).map(([name, { runs }]) => {
  const walls = runs.map((x) => x.wall_ms).filter(Number.isFinite);
  return [name, {
    runs: runs.length, outcome: tally(runs, 'outcome'), route: tally(runs, 'route'),
    restarts_counted: tally(runs, 'restarts_counted'), respawns: tally(runs, 'respawns'), free_exits: tally(runs, 'free_exits'),
    gate_unpolled: `${runs.filter((x) => x.gate_events_unpolled > 0).length}/${runs.filter((x) => x.outcome !== 'timeout').length}`,
    gate_polled: `${runs.filter((x) => x.gate_events_polled > 0).length}/${runs.filter((x) => x.outcome !== 'timeout').length}`,
    main_identical: tally(runs, 'main_samples_identical'),
    wall_median: median(walls), wall_min: walls.length ? Math.min(...walls) : null, wall_max: walls.length ? Math.max(...walls) : null,
    merge: tally(runs, 'merge'), worktree: tally(runs, 'worktree'), leftover_pids: runs.reduce((a, x) => a + x.leftover_pids, 0),
    respawned: tally(runs.filter((x) => x.session_death).map((x) => ({ v: x.session_death.respawned })), 'v'),
  }];
})));
console.log(`wrote ${file}`);
if (missing || Object.values(out.routes).some((r) => r.runs.some((x) => !x.outcome))) process.exit(1);
