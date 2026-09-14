#!/usr/bin/env node
// Score one bench workspace: what the arm left behind, plus what the session cost.
//
//   node score.mjs <case> <workspace> [stream.jsonl]
//     case  code | docs | code-flat | docs-flat   (see bench.sh)
//
// The tree that is judged is the integrated one when the arm produced a task
// (<ws>/.harness-tasks/*/worktrees/integration*), else the workspace itself. Static criteria
// look at files; executed criteria run `node --test` and, for code, the CLI on a sample.
// The docs cases have one LLM-judged criterion (`accuracy`: haiku reads the source and the
// reference docs); GRAPH_BENCH_JUDGE=0 skips it. Writes <ws>.score.json and prints one row.
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const [CASE, WS_ARG, STREAM] = process.argv.slice(2);
if (!CASE || !WS_ARG) { console.error('usage: score.mjs <code|docs|code-flat|docs-flat> <workspace> [stream.jsonl]'); process.exit(2); }
const WS = resolve(WS_ARG);
const GOAL = CASE.startsWith('goal-');
const KIND = /code/.test(CASE) ? 'code' : 'docs';
const MONO = !CASE.endsWith('-flat');

const env = { ...process.env }; delete env.CLAUDECODE;
const sh = (cmd, args, cwd, input) => {
  const r = spawnSync(cmd, args, { cwd, input, encoding: 'utf8', timeout: 300_000, env });
  return { code: r.status ?? -1, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
};
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const ls = (p) => { try { return readdirSync(p); } catch { return []; } };

// ---------- which tree ----------
function integrationTree() {
  const root = join(WS, '.harness-tasks');
  const found = [];
  for (const id of ls(root)) for (const n of ls(join(root, id, 'worktrees'))) if (n.startsWith('integration')) found.push(join(root, id, 'worktrees', n));
  found.sort();
  return found.at(-1) || null;
}
const TREE = integrationTree() || WS;
const has = (p) => existsSync(join(TREE, p));

// ---------- harness state ----------
function runFiles(dir) {
  const out = [];
  for (const b of ['broker-beta', 'broker']) {
    const d = join(dir, '.harness-run', b, 'runs');
    for (const f of ls(d)) if (f.endsWith('.json')) { try { out.push(JSON.parse(read(join(d, f)))); } catch {} }
  }
  return out;
}
function nodeStats(nodes) {
  const states = {}, vendors = {};
  for (const n of nodes) {
    states[n.state] = (states[n.state] || 0) + 1;
    const v = n.executor || n.vendor || 'unassigned';
    vendors[v] = (vendors[v] || 0) + 1;
  }
  return { total: nodes.length, states, vendors };
}
const short = (n) => `${n.node_id}: ${(n.result && (n.result.reason || (n.result.gaps || []).join('; '))) || ''}`.slice(0, 160);
function summarizeRun(r) {
  const nodes = r.nodes || [];
  return {
    run_id: r.run_id, state: r.state, flow: r.flow ?? null, flow_chosen: r.flow_chosen ?? null, flow_source: r.flow_source ?? null,
    size: r.size ?? null, nodes: nodeStats(nodes), stages: [...new Set(nodes.map((n) => n.stage))].sort(),
    failed: nodes.filter((n) => n.state === 'failed').map(short),
  };
}
const harness = { tasks: [], runs: [] };
{
  const root = join(WS, '.harness-tasks');
  for (const id of ls(root)) {
    let task; try { task = JSON.parse(read(join(root, id, 'task.json'))); } catch { continue; }
    const nodes = task.nodes || [];
    const size = nodes.find((n) => n.node_id === 'size');
    const shape = nodes.filter((n) => n.stage === 'shape' && n.state === 'done').at(-1);
    const packages = task.spec?.packages || shape?.result?.packages || [];
    harness.tasks.push({
      id, state: task.state, size: size?.result?.size ?? null, size_source: size?.result?.size_source ?? 'measured',
      packages: packages.map((p) => ({ id: p.id, flow: p.flow, deps: p.deps, touches: p.touches })),
      nodes: nodeStats(nodes), failed: nodes.filter((n) => n.state === 'failed').map(short),
      conflicts: nodes.map((n) => n.result?.conflicting_packages).filter(Boolean),
    });
    for (const n of ls(join(root, id, 'worktrees'))) for (const r of runFiles(join(root, id, 'worktrees', n))) harness.runs.push({ where: n, ...summarizeRun(r) });
  }
  for (const r of runFiles(WS)) harness.runs.push({ where: '.', ...summarizeRun(r) });
}

// ---------- session meta from stream-json (top-level session only) ----------
// Only the driving session's own calls count as "top level": with --verbose the stream also
// carries every fresh agent's tool calls, tagged with parent_tool_use_id. Those are node work
// and belong in sub_tools; a Write there is the harness working, not the manager overreaching.
const meta = { duration_ms: null, cost_usd: null, turns: null, is_error: null, tools: {}, sub_tools: {}, top_level_edits: 0, subagents: 0, report_section: false, node_table: false };
// Several streams (the first session plus every resume, comma-separated) add up: one run's
// cost is what every session that drove it cost. The final text is the newest session's.
const streams = (STREAM || '').split(',').filter((p) => p && existsSync(p));
for (const streamPath of streams) {
  let last = null;
  for (const line of read(streamPath).split('\n')) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'result') last = ev;
    const content = ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content) ? ev.message.content : [];
    for (const c of content) if (c.type === 'tool_use') {
      const name = String(c.name).includes('__') ? 'mcp:' + String(c.name).split('__').at(-1) : String(c.name);
      if (ev.parent_tool_use_id) { meta.sub_tools[name] = (meta.sub_tools[name] || 0) + 1; continue; }
      meta.tools[name] = (meta.tools[name] || 0) + 1;
      if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(c.name)) meta.top_level_edits++;
      if (c.name === 'Task' || c.name === 'Agent') meta.subagents++;
      if (name === 'mcp:graph_status' && c.input && c.input.full === true && !c.input.node_id) meta.tools['graph_status(full, no node_id)'] = (meta.tools['graph_status(full, no node_id)'] || 0) + 1;
    }
  }
  if (last) {
    meta.sessions = (meta.sessions || 0) + 1;
    meta.duration_ms = (meta.duration_ms || 0) + (last.duration_ms || 0); meta.cost_usd = (meta.cost_usd || 0) + (last.total_cost_usd || 0);
    meta.turns = (meta.turns || 0) + (last.num_turns || 0); meta.is_error = !!last.is_error;
    meta.limit_hit = (meta.limit_hit || 0) + (/hit your (session|usage) limit/.test(String(last.result)) ? 1 : 0);
    const text = typeof last.result === 'string' ? last.result : '';
    meta.report_section = /###\s*Report/.test(text);
    meta.node_table = /\|\s*node\s*\|/i.test(text);
    meta.result_tail = text.slice(-800);
  }
}

// ---------- criteria ----------
const crit = {};
const pkgJson = (() => { try { return JSON.parse(read(join(TREE, 'package.json'))); } catch { return {}; } })();
crit.npm_test = sh('node', ['--test'], TREE).code === 0;
crit.no_deps = !pkgJson.dependencies || Object.keys(pkgJson.dependencies).length === 0;
const seed = sh('git', ['rev-list', '--max-parents=0', 'HEAD'], TREE).stdout.trim().split('\n')[0] || null;

const exportNames = (src) => {
  const names = new Set();
  for (const m of (src || '').matchAll(/export\s*\{([^}]*)\}/g)) for (const s of m[1].split(',')) { const n = s.trim().split(/\s+as\s+/).at(-1); if (n) names.add(n); }
  for (const m of (src || '').matchAll(/export\s+(?:async\s+)?(?:class|function\*?|const|let)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  return [...names];
};

const judge = (prompt) => {
  const j = sh('claude', ['-p', '--setting-sources', 'project', '--model', 'haiku', '--output-format', 'json', prompt], TREE, '');
  try {
    const outer = JSON.parse(j.stdout);
    const inner = JSON.parse(String(outer.result).replace(/^[^{]*/, '').replace(/[^}]*$/, ''));
    return { ...inner, judge_cost_usd: outer.total_cost_usd };
  } catch { return null; }
};
const treeFiles = (dir, depth, acc = [], rel = '') => {
  if (depth < 0) return acc;
  for (const e of ls(join(dir, rel))) {
    if (['.git', '.harness-run', 'node_modules'].includes(e)) continue;
    const r = rel ? `${rel}/${e}` : e;
    let st; try { st = statSync(join(dir, r)); } catch { continue; }
    if (st.isDirectory()) treeFiles(dir, depth - 1, acc, r); else acc.push(r);
  }
  return acc;
};

if (GOAL) {
  // A one-line goal: the harness decided the split, the contracts and the document set, so
  // nothing here names a path. What is checked: the tree works, the goal is met (judged), and
  // - for a manager run - the decomposition it chose holds up on its own terms.
  const files = treeFiles(TREE, 4);
  const mds = files.filter((f) => f.endsWith('.md'));
  crit.readme = has('README.md') && /```/.test(read(join(TREE, 'README.md')) || '');
  if (KIND === 'code') {
    const pkgs = ls(join(TREE, 'packages')).filter((p) => existsSync(join(TREE, 'packages', p, 'package.json')));
    crit.cli = pkgs.some((p) => { try { const j = JSON.parse(read(join(TREE, 'packages', p, 'package.json'))); return !!j.bin; } catch { return false; } })
      || files.some((f) => /(^|\/)bin\/[^/]+\.m?js$/.test(f));
    const calls = files.filter((f) => /\.test\.m?js$/.test(f)).reduce((n, f) => n + ((read(join(TREE, f)) || '').match(/\btest\(/g) || []).length, 0);
    crit.tests_grown = calls > 4;
    crit.tests_total = calls;
    const readme = read(join(TREE, 'README.md')) || '';
    const bins = files.filter((f) => /(^|\/)bin\/[^/]+\.m?js$/.test(f)).slice(0, 2).map((f) => `// ${f}\n${(read(join(TREE, f)) || '').slice(0, 6000)}`).join('\n\n');
    const j = judge(`You are judging whether a delivered code tree meets a one-line goal. Goal: "import bank CSV exports, categorize each expense by user-defined rules, report monthly spending from the command line; a new user can follow the root README from a CSV file to a monthly report". Below: the file list, the README, and the CLI entry point(s). Reply with JSON only: {"import_csv": true|false, "rules": true|false, "monthly_report": true|false, "readme_walkthrough": true|false, "missing": ["..."]}.\n\n=== FILES ===\n${files.join('\n')}\n\n=== README.md ===\n${readme.slice(0, 12000)}\n\n=== CLI ===\n${bins}`);
    crit.goal_met = j ? !!(j.import_csv && j.rules && j.monthly_report && j.readme_walkthrough) : 'judge-failed';
    crit.goal_detail = j;
  } else {
    crit.docs_count = mds.length;
    crit.docs_written = mds.length >= 3;
    const codePaths = ['packages/queue/src', 'packages/retry/src', 'packages/worker/src', 'packages/queue/test', 'packages/retry/test', 'packages/worker/test'];
    crit.src_untouched = !!seed && sh('git', ['diff', '--quiet', seed, '--', ...codePaths], TREE).code === 0;
    const srcs = ['queue', 'retry', 'worker'].map((p) => `// packages/${p}/src/index.mjs\n${read(join(TREE, `packages/${p}/src/index.mjs`)) || ''}`).join('\n\n');
    let budget = 40000;
    const docs = mds.map((f) => { const t = (read(join(TREE, f)) || '').slice(0, Math.max(0, Math.min(8000, budget))); budget -= t.length; return `=== ${f} ===\n${t}`; }).join('\n\n');
    const j = judge(`You are judging a documentation set written for a small library against its source. Goal: "a new maintainer can use it, extend it, and understand why it is built the way it is; every claim derived from the code". Reply with JSON only: {"usable": true|false, "extendable": true|false, "rationale_explained": true|false, "claims_checked": <int>, "false_claims": ["<doc>: <claim> — <why wrong>"]}.\n\n=== SOURCE ===\n${srcs}\n\n${docs}`);
    crit.goal_met = j ? !!(j.usable && j.extendable && j.rationale_explained) : 'judge-failed';
    crit.accuracy = j ? j.false_claims.length === 0 : 'judge-failed';
    crit.goal_detail = j;
  }
  // The manager's decomposition, on its own terms: several packages, disjoint ownership, no cycles.
  const t = harness.tasks[0];
  if (t && t.packages.length) {
    const touches = t.packages.map((p) => (p.touches || []).map(String));
    const disjoint = touches.every((a, i) => touches.every((b, k) => i === k || !a.some((x) => b.some((y) => x === y || x.startsWith(y + '/') || y.startsWith(x + '/')))));
    const ids = new Set(t.packages.map((p) => p.id));
    const seen = new Set(); let acyclic = true;
    const visit = (id, stack) => { if (stack.has(id)) { acyclic = false; return; } if (seen.has(id)) return; stack.add(id); for (const d of (t.packages.find((p) => p.id === id)?.deps || [])) if (ids.has(d)) visit(d, stack); stack.delete(id); seen.add(id); };
    for (const id of ids) visit(id, new Set());
    crit.decomposition = t.packages.length >= 2 && disjoint && acyclic;
    crit.decomposition_detail = { packages: t.packages.length, disjoint, acyclic };
  } else crit.decomposition = 'n/a';
} else if (KIND === 'code') {
  const P = MONO
    ? { csv: 'packages/csv/src/index.mjs', rules: 'packages/rules/src/index.mjs', report: 'packages/report/src/index.mjs', cli: 'packages/cli/bin/ledger.mjs' }
    : { csv: 'src/csv.mjs', rules: 'src/rules.mjs', report: 'src/report.mjs', cli: 'bin/ledger.mjs' };
  crit.modules = Object.values(P).every(has);
  crit.exports = ['csv', 'rules', 'report'].every((k) => exportNames(read(join(TREE, P[k]))).length > 0);
  if (MONO) {
    // each package has real tests: more than the seed's single smoke test
    crit.tests = ['csv', 'rules', 'report', 'cli'].every((k) => {
      const dir = join(TREE, 'packages', k, 'test');
      const calls = ls(dir).filter((f) => f.endsWith('.mjs')).reduce((n, f) => n + ((read(join(dir, f)) || '').match(/\btest\(/g) || []).length, 0);
      return calls >= 2;
    });
  } else {
    const tests = ls(join(TREE, 'test'));
    crit.tests = [/csv/i, /rule/i, /report/i, /ledger|cli/i].every((re) => tests.some((f) => re.test(f)));
  }
  const readme = read(join(TREE, 'README.md')) || '';
  crit.readme = /ledger report/.test(readme) && /rules/i.test(readme) && /```/.test(readme);
  // executed: the CLI on a sample, header row or not
  const tmp = mkdtempSync(join(tmpdir(), 'ledger-score-'));
  const rows = ['2026-01-03,4.50,Blue Bottle Coffee,latte', '2026-01-15,120.00,Whole Foods,groceries', '2026-02-02,9.99,Blue Bottle Coffee,beans'];
  writeFileSync(join(tmp, 'rules.json'), JSON.stringify([{ match: 'Coffee', category: 'food' }, { match: 'Whole Foods', category: 'groceries' }]));
  writeFileSync(join(tmp, 'h.csv'), ['date,amount,merchant,memo', ...rows].join('\n') + '\n');
  writeFileSync(join(tmp, 'n.csv'), rows.join('\n') + '\n');
  writeFileSync(join(tmp, 'bad.csv'), ['date,amount,merchant,memo', '2026-01-03,notanumber,Blue Bottle Coffee,latte'].join('\n') + '\n');
  const cli = join(TREE, P.cli);
  const run = (csv, ...extra) => has(P.cli) ? sh('node', [cli, 'report', join(tmp, csv), '--rules', join(tmp, 'rules.json'), ...extra], TREE) : { code: -1, stdout: '' };
  const good = ['h.csv', 'n.csv'].map((c) => run(c)).find((r) => r.code === 0 && /food/.test(r.stdout));
  crit.cli_ok = !!good;
  crit.cli_invalid = run('bad.csv').code === 1;
  const month = ['h.csv', 'n.csv'].map((c) => run(c, '--month', '2026-02')).find((r) => r.code === 0);
  crit.cli_month = !!month && /9\.99/.test(month.stdout) && !/120/.test(month.stdout);
} else {
  const pkgs = MONO ? ['queue', 'retry', 'worker'] : [];
  const refs = MONO ? pkgs.map((p) => `packages/${p}/README.md`) : ['docs/api.md'];
  const files = [...refs, 'docs/architecture.md', 'docs/adr/0001-bounded-queue.md', 'docs/adr/0002-retry-policy.md', 'docs/adr/0003-worker-concurrency.md', 'CONTRIBUTING.md', 'README.md'];
  crit.files = files.every(has);
  crit.files_present = `${files.filter(has).length}/${files.length}`;
  // every export named in its reference; at least one fenced example per reference
  const pairs = MONO
    ? pkgs.map((p) => [read(join(TREE, `packages/${p}/src/index.mjs`)), read(join(TREE, `packages/${p}/README.md`)) || ''])
    : [[read(join(TREE, 'src/index.mjs')), read(join(TREE, 'docs/api.md')) || '']];
  crit.api_exports = pairs.every(([src, doc]) => { const ex = exportNames(src); return ex.length > 0 && ex.every((n) => doc.includes(n)); });
  crit.api_examples = pairs.every(([, doc]) => ((doc.match(/```/g) || []).length / 2) >= 1);
  crit.adr_shape = ['0001-bounded-queue', '0002-retry-policy', '0003-worker-concurrency'].every((n) => {
    const t = read(join(TREE, `docs/adr/${n}.md`)) || '';
    return /context/i.test(t) && /decision/i.test(t) && /consequence/i.test(t) && /alternative/i.test(t);
  });
  const readme = read(join(TREE, 'README.md')) || '';
  crit.readme_links = ['docs/architecture.md', 'CONTRIBUTING.md', 'docs/adr', ...(MONO ? pkgs.map((p) => `packages/${p}`) : ['docs/api.md'])].every((l) => readme.includes(l));
  const codePaths = MONO ? ['packages/queue/src', 'packages/retry/src', 'packages/worker/src', 'packages/queue/test', 'packages/retry/test', 'packages/worker/test'] : ['src', 'test'];
  crit.src_untouched = !!seed && sh('git', ['diff', '--quiet', seed, '--', ...codePaths], TREE).code === 0;
  if (process.env.GRAPH_BENCH_JUDGE === '0') crit.accuracy = 'skipped';
  else {
    const srcs = MONO ? pkgs.map((p) => `// packages/${p}/src/index.mjs\n${read(join(TREE, `packages/${p}/src/index.mjs`)) || ''}`)
      : ['queue', 'retry', 'worker', 'index'].map((m) => `// src/${m}.mjs\n${read(join(TREE, `src/${m}.mjs`)) || ''}`);
    const docs = MONO ? ['packages/retry/README.md', 'packages/worker/README.md', 'docs/adr/0002-retry-policy.md'] : ['docs/api.md', 'docs/adr/0002-retry-policy.md'];
    const prompt = `You are grading documentation for factual accuracy against source code. Below is the complete source of a small library, then some of its documents. List every claim in the documents about behaviour, signatures, defaults, return values or thrown errors that the code does NOT support (wrong or invented). Ignore style, omissions, and claims you cannot decide. Reply with JSON only: {"claims_checked": <int>, "false_claims": ["<doc>: <claim> — <why wrong>", ...]}.\n\n=== SOURCE ===\n${srcs.join('\n\n')}\n\n${docs.map((d) => `=== ${d} ===\n${read(join(TREE, d)) || '(missing)'}`).join('\n\n')}`;
    const j = sh('claude', ['-p', '--setting-sources', 'project', '--model', 'haiku', '--output-format', 'json', prompt], TREE, '');
    try {
      const outer = JSON.parse(j.stdout);
      const inner = JSON.parse(String(outer.result).replace(/^[^{]*/, '').replace(/[^}]*$/, ''));
      crit.accuracy = inner.false_claims.length === 0;
      crit.accuracy_detail = { claims_checked: inner.claims_checked, false_claims: inner.false_claims.slice(0, 8), judge_cost_usd: outer.total_cost_usd };
    } catch { crit.accuracy = 'judge-failed'; }
  }
}

// Wall time comes from the runner's start/exit stamps: a session's own duration_ms turned out
// not to cover the time its sub-agents ran (a 2h23m resume reported 1.9 minutes).
{
  const stamps = (read(`${WS}.start.txt`) || '').split('\n');
  let start = null, wall = 0;
  for (const line of stamps) {
    const m = line.match(/^(\S+) (resume \d+ exit|resume \d+|start|exit) ?/);
    if (!m) continue;
    const t = Date.parse(m[1]);
    if (/^(start|resume \d+)$/.test(m[2].trim())) start = t;
    else if (start) { wall += t - start; start = null; }
  }
  if (wall) meta.wall_ms = wall;
}

const bools = Object.entries(crit).filter(([, v]) => typeof v === 'boolean');
const score = { case: CASE, workspace: WS, tree: TREE === WS ? '.' : TREE.slice(WS.length + 1), passed: bools.filter(([, v]) => v).length, of: bools.length, criteria: crit, session: meta, harness };
writeFileSync(`${WS}.score.json`, JSON.stringify(score, null, 2));
const fails = bools.filter(([, v]) => !v).map(([k]) => k).join(',') || '-';
const t = harness.tasks[0];
console.log(`${basename(WS)} | ${score.passed}/${score.of} | fail: ${fails} | ${meta.wall_ms ? Math.round(meta.wall_ms / 60000) + 'min' : meta.duration_ms ? Math.round(meta.duration_ms / 60000) + 'min(api)' : '?'} | $${typeof meta.cost_usd === 'number' ? meta.cost_usd.toFixed(2) : '?'} | turns ${meta.turns ?? '?'} | task ${t?.state ?? '-'} size ${t?.size ?? '-'} pkgs ${t?.packages?.length ?? '-'} | runs ${harness.runs.length} | top-level edits ${meta.top_level_edits} | tree ${score.tree}`);
