#!/usr/bin/env node
// Reads every harvested run (harvest.mjs) and says where the failures and the money went, across
// runs - the reading done by hand after each real run, done once over all of them.
//
//   node triage.mjs [--root DIR] [--since 0.32.0] [--kind rejection] [--top 15] [--json]
//
// Groups failure records by kind and signature (paths, numbers, ids, quoted values collapsed), so
// the same defect in five runs is one row with a count of five and the versions it was seen on.
// A group seen only on versions older than the newest run's is marked "not since <v>" - probably
// fixed; one still present on the newest version is the next thing to look at.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const a = process.argv.slice(2);
const opt = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
const root = opt('--root', process.env.TEAMS_RUNS_DIR || join(homedir(), '.local', 'share', 'teams-runs'));
const since = opt('--since', null);
const kindFilter = opt('--kind', null);
const top = Number(opt('--top', 15));

const vnum = (v) => String(v || '0').split('.').map(Number).reduce((acc, x) => acc * 1000 + (x || 0), 0);

const runs = (existsSync(root) ? readdirSync(root) : [])
  .filter((d) => { try { return statSync(join(root, d)).isDirectory() && existsSync(join(root, d, 'summary.json')); } catch { return false; } })
  .map((d) => JSON.parse(readFileSync(join(root, d, 'summary.json'), 'utf8')))
  .filter((s) => !since || vnum(s.teams_version) >= vnum(since))
  .sort((x, y) => vnum(x.teams_version) - vnum(y.teams_version) || String(x.label).localeCompare(y.label));

if (!runs.length) { process.stdout.write(`no harvested runs under ${root}${since ? ` since ${since}` : ''}\n`); process.exit(0); }
const newest = runs.reduce((m, s) => (vnum(s.teams_version) > vnum(m) ? s.teams_version : m), '0');

const groups = new Map();
for (const s of runs) {
  for (const f of s.failures || []) {
    if (kindFilter && f.kind !== kindFilter) continue;
    // Rejections vary word by word; group them by where they happened, and keep the texts.
    const key = f.kind === 'rejection' ? `rejection|${f.level}:${f.stage}|${f.executor || '?'}` : `${f.kind}|${f.signature}`;
    const g = groups.get(key) || { kind: f.kind, key, count: 0, runs: new Set(), versions: new Set(), examples: [] };
    g.count++; g.runs.add(s.label); g.versions.add(s.teams_version);
    if (g.examples.length < 3) g.examples.push(`${s.label} ${f.package ? `${f.package} ` : ''}${f.node_id}: ${String(f.message).slice(0, 160)}`);
    groups.set(key, g);
  }
}
const rows = [...groups.values()].map((g) => {
  const vs = [...g.versions].sort((x, y) => vnum(x) - vnum(y));
  return { ...g, runs: [...g.runs], versions: vs, current: vs.includes(newest) };
}).sort((x, y) => Number(y.current) - Number(x.current) || y.count - x.count);

// Where the money went, summed by stream kind.
const cost = {};
for (const s of runs) for (const [k, v] of Object.entries(s.cost_by_kind || {})) cost[k] = +((cost[k] || 0) + v).toFixed(2);
const total = Object.values(cost).reduce((x, y) => x + y, 0);

if (a.includes('--json')) {
  process.stdout.write(JSON.stringify({ root, runs: runs.map((s) => ({ label: s.label, version: s.teams_version, score: s.score, cost_usd: s.cost_usd })), groups: rows, cost_by_kind: cost }, null, 2) + '\n');
  process.exit(0);
}

const L = [];
L.push(`${runs.length} runs under ${root} (versions ${runs[0].teams_version} .. ${newest})`);
for (const s of runs) {
  const sc = s.score ? (s.score.match(/\| (\d+\/\d+) \|/) || [])[1] : null;
  L.push(`  ${String(s.label).padEnd(22)} v${String(s.teams_version).padEnd(8)} ${String(sc || s.state).padEnd(8)} $${(s.cost_usd || 0).toFixed(2).padStart(6)}  failures ${String((s.failures || []).length).padStart(3)}  retries ${s.retries}  rejudges ${s.rejudges}`);
}
L.push('');
L.push(`failure groups (${rows.length}; newest version first, then by count):`);
for (const g of rows.slice(0, top)) {
  L.push(`  [${g.current ? `seen on ${newest}` : `not since ${g.versions[g.versions.length - 1]}`}] ${g.kind} x${g.count} in ${g.runs.length} run(s)  ${g.key.split('|').slice(1).join(' | ')}`);
  for (const e of g.examples) L.push(`      ${e}`);
}
if (rows.length > top) L.push(`  ... ${rows.length - top} more (--top N)`);
L.push('');
L.push(`cost by stream kind (all runs, $${total.toFixed(2)}):`);
for (const [k, v] of Object.entries(cost).sort((x, y) => y[1] - x[1])) L.push(`  ${k.padEnd(20)} $${v.toFixed(2).padStart(7)}  ${Math.round((v / (total || 1)) * 100)}%`);
process.stdout.write(L.join('\n') + '\n');
