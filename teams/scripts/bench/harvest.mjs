#!/usr/bin/env node
// A bench workspace's record, kept past /tmp - the same harvest the daemon does at daemon_done
// (mcp/runlog.mjs), plus the bench's score. Same default label as the daemon's
// (<workspace>-<task id>), so this overwrites that record with the scored one instead of adding a
// second copy for triage.mjs to count twice.
//
//   node harvest.mjs <workspace> [--label L] [--root DIR] [--score-prefix PATH]

import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { harvestTask, signature, classify } from '../../mcp/runlog.mjs';

export { signature, classify };

export function harvest(ws, { label, root, scorePrefix } = {}) {
  ws = resolve(ws);
  const tasksDir = join(ws, '.harness-tasks');
  let ids = [];
  try { ids = readdirSync(tasksDir).filter((x) => statSync(join(tasksDir, x)).isDirectory()); } catch { ids = []; }
  return harvestTask({ taskDir: ids[0] ? join(tasksDir, ids[0]) : null, cwd: ws, label, root, scorePrefix: scorePrefix || ws });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  const flags = new Set(['--label', '--root', '--score-prefix']);
  const ws = a.find((x, i) => !x.startsWith('--') && !flags.has(a[i - 1]));
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
  if (!ws) { process.stderr.write('usage: harvest.mjs <workspace> [--label L] [--root DIR] [--score-prefix PATH]\n'); process.exit(2); }
  const r = harvest(ws, { label: opt('--label'), root: opt('--root'), scorePrefix: opt('--score-prefix') });
  if (!r) { process.stdout.write('TEAMS_RUNS_DIR=off - nothing kept\n'); process.exit(0); }
  process.stdout.write(`harvested ${r.summary.label} -> ${r.out} (${r.summary.failures.length} failure records, ${r.summary.child_runs} child runs, state ${r.summary.state})\n`);
}
