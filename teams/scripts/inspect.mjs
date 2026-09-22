#!/usr/bin/env node
// inspect.mjs - what a task actually did, for a person to read.
//
//   node scripts/inspect.mjs <workspace|tasks-dir|task-dir> [options]
//
//     (no option)     the report: manager chain, every child run, artifacts, skills audit
//     --skills        the skills audit alone - asked vs actually loaded, per skill
//     --tickets       the ticket board alone - each ticket's state now, then every transition
//     --node <id>     one node in full: its prompt path, its result JSON, what it wrote
//     --docs          the phase-document tree and which pages exist yet
//     --json          the whole model as JSON, for a script rather than a person
//
// Reads only. Safe on a task that is still running: it takes whatever is on disk now.
//
// This exists because the engine wrote everything - prompts, results, verdicts, method - to
// disk and surfaced none of it. The bug that motivated it (0.18.0: not one node in any run
// had ever loaded a skill it was told to load) was invisible for weeks of runs.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTasks, collect } from './lib/inspect-collect.mjs';

const MARK = { done: 'OK', running: '..', pending: '  ', failed: 'XX', blocked: '!!', skipped: '--', unreachable: '??' };

function parseArgs(argv) {
  const a = { path: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--skills') a.skills = true;
    else if (v === '--tickets') a.tickets = true;
    else if (v === '--docs') a.docs = true;
    else if (v === '--json') a.json = true;
    else if (v === '--node') a.node = argv[++i];
    else if (v === '--task') a.task = argv[++i];
    else if (!a.path) a.path = v;
  }
  return a;
}

function pad(s, n) { return String(s).padEnd(n); }
function trunc(s, n) { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; }

function nodeLine(n, indent) {
  const bits = [`${' '.repeat(indent)}${MARK[n.state] || '? '} ${pad(n.node_id, 18)}`];
  if (n.verdict !== null) bits.push(n.verdict ? 'accept' : 'REJECT');
  if (n.match_pct !== null) bits.push(`${n.match_pct}%`);
  if (n.skills_asked.length) {
    const used = n.skills_used;
    const tag = used === null ? 'did not report' : (used.length ? used.join(', ') : 'loaded none');
    bits.push(`method[${n.skills_asked.join(', ')} -> ${tag}]`);
  }
  if (n.changed_files.length) bits.push(`wrote ${n.changed_files.length}`);
  if (n.defects !== null) bits.push(`defects ${n.defects}`);
  if (n.unmet !== null) bits.push(`unmet ${n.unmet.length}`);
  if (n.user_stories !== null) bits.push(`stories ${n.user_stories}`);
  if (n.gaps.length) bits.push(`gaps ${n.gaps.length}`);
  if (n.reason) bits.push(`- ${trunc(n.reason, 90)}`);
  return bits.join('  ');
}

function renderSkills(model) {
  const s = model.skills;
  const out = [`SKILLS   ${s.skills.length} named, ${s.never_loaded.length} never loaded, ${s.nodes_silent} finished nodes reported nothing`];
  for (const r of s.skills) {
    out.push(`  ${pad(r.skill, 44)} asked ${pad(r.asked, 4)} loaded ${pad(r.used, 4)}${r.used === 0 ? '  <- never' : ''}`);
  }
  if (s.nodes_silent) out.push(`  ${s.nodes_silent} node(s) finished without a skills_used field - older runs, or a stage whose contract does not ask for it.`);
  return out.join('\n');
}

function renderDocs(model) {
  const out = [`DOCS     ${model.docs.dir}`];
  for (const f of model.docs.files) out.push(`  ${f.exists ? 'OK' : '--'} ${f.name}`);
  return out.join('\n');
}

function renderNodeDetail(model, nodeId) {
  const all = [...model.manager.nodes.map((n) => ({ n, run: 'manager' })),
    ...model.children.flatMap((c) => c.nodes.map((n) => ({ n, run: c.run_id.slice(0, 8), cwd: c.cwd })))];
  const hits = all.filter((x) => x.n.node_id === nodeId);
  if (!hits.length) return `no node "${nodeId}" in this task. Nodes: ${all.map((x) => x.n.node_id).join(', ')}`;
  const out = [];
  for (const { n, run, cwd } of hits) {
    out.push(`NODE ${n.node_id}   run ${run}   stage ${n.stage}   state ${n.state}`);
    if (cwd) out.push(`  cwd    ${cwd}`);
    out.push(`  method asked: ${n.skills_asked.join(', ') || '(none)'}`);
    out.push(`  method used:  ${n.skills_used === null ? '(node did not report)' : (n.skills_used.join(', ') || 'none')}`);
    if (n.changed_files.length) out.push(`  wrote:\n${n.changed_files.map((f) => `    ${f}`).join('\n')}`);
    if (n.gaps.length) out.push(`  gaps:\n${n.gaps.map((g) => `    - ${trunc(g, 160)}`).join('\n')}`);
    out.push(`  prompt: ${n.files.prompt || '(not written to disk)'}`);
    out.push(`  result: ${n.files.result || '(inline in the run file)'}`);
    if (n.files.prompt && existsSync(n.files.prompt)) {
      const text = readFileSync(n.files.prompt, 'utf8');
      out.push(`  --- prompt (${text.split('\n').length} lines) ---`);
      out.push(text.split('\n').map((l) => `  ${l}`).join('\n'));
    }
  }
  return out.join('\n');
}


function renderTickets(model) {
  const t = model.tickets || { current: [], history: [] };
  const out = [`TICKETS  ${t.current.length} ticket(s), ${t.history.length} transition(s) logged`];
  for (const row of t.current) out.push(`  ${pad(row.key, 22)} ${pad(row.kind, 6)} ${pad(row.state, 12)} ${trunc(row.title, 50)}`);
  if (!t.history.length) {
    out.push('  (no transitions logged - the board records a ticket move only when something writes one)');
    return out.join('\n');
  }
  out.push('  HISTORY');
  for (const h of t.history) {
    const at = new Date(h.ts || 0).toISOString().slice(11, 19);
    out.push(`    ${at}  ${pad(String(h.key || '?'), 22)} ${pad(String(h.from || '-'), 12)} -> ${pad(String(h.to || '?'), 12)} by ${h.by || '?'}`);
  }
  return out.join('\n');
}

export function renderReport(model) {
  const out = [];
  const roles = Object.entries(model.roles).map(([k, v]) => `${k}=${v ? 'on' : 'off'}`).join(' ') || '(none)';
  out.push(`TASK     ${model.task_id.slice(0, 8)}  ${model.name}  size ${model.size || '?'}  flow ${model.flow}  roles ${roles}`);
  out.push(`  cwd    ${model.cwd}`);
  out.push(`  ask    ${trunc(model.request, 150)}`);
  out.push('');
  out.push('MANAGER');
  for (const n of model.manager.nodes) out.push(nodeLine(n, 2));
  for (const c of model.children) {
    out.push('');
    const head = c.missing
      ? `CHILD ${c.node_id}  run ${c.run_id.slice(0, 8)}  (run file not found under ${c.cwd})`
      : `CHILD ${c.node_id}  run ${c.run_id.slice(0, 8)}  flow ${c.flow}  mixed ${c.mixed}  ${c.state}`;
    out.push(head);
    if (c.goal) out.push(`  goal   ${trunc(c.goal, 150)}`);
    for (const n of c.nodes) out.push(nodeLine(n, 2));
  }
  if (model.artifacts.length) {
    out.push('');
    out.push('WROTE');
    for (const a of model.artifacts) out.push(`  ${a.exists ? 'OK' : '??'} ${pad(a.path, 52)} ${a.by.join(' ')}`);
  }
  out.push('');
  out.push(renderTickets(model));
  out.push('');
  out.push(renderDocs(model));
  out.push('');
  out.push(renderSkills(model));
  return out.join('\n');
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.path) {
    process.stderr.write('usage: node scripts/inspect.mjs <workspace|tasks-dir|task-dir> [--skills] [--tickets] [--docs] [--node <id>] [--task <id>] [--json]\n');
    process.exit(2);
  }
  const found = findTasks(a.path);
  if (!found.length) {
    process.stderr.write(`no task.json under ${a.path} (looked at it directly, and under .harness-tasks/ and each subdirectory)\n`);
    process.exit(1);
  }
  const picked = a.task ? found.filter((f) => f.task.run_id.startsWith(a.task)) : found;
  if (!picked.length) { process.stderr.write(`no task id starting with ${a.task}\n`); process.exit(1); }
  const chunks = [];
  for (const f of picked) {
    const model = collect(f.dir, f.task);
    if (a.json) chunks.push(JSON.stringify(model, null, 2));
    else if (a.node) chunks.push(renderNodeDetail(model, a.node));
    else if (a.skills) chunks.push(renderSkills(model));
    else if (a.tickets) chunks.push(renderTickets(model));
    else if (a.docs) chunks.push(renderDocs(model));
    else chunks.push(renderReport(model));
  }
  process.stdout.write(`${chunks.join('\n\n')}\n`);
}

// Both a CLI and a library (renderReport is tested directly), so running the CLI is gated on
// being the process entry point - importing this file must print nothing and exit nothing.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
