#!/usr/bin/env node
// render-docs.mjs - re-render one task's docs with this code, backfilling the cost first.
//
//   node teams/scripts/render-docs.mjs <E-xxxxxxxx | task id | task dir>
//
// A task opened under an older daemon (0.64.0) has a cost_recorded without by_stage, so its
// 80-report.md has no per-stage Cost section and the installed daemon cannot add one. This reads
// the driver streams still on disk, appends one cost_recorded {spend, estimated, by_stage} when
// the latest one lacks by_stage, then re-renders. Run it after the report and before tm_clean
// (the streams go with the worktrees). Exit 0 and the report path on success; non-zero with the
// key on stderr when the task is unknown, its daemon is still running, or it has no report to render.

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRunAt } from '../mcp/graph-runfile.mjs';
import { driverAlive, record, taskDir, taskPath, tasksRoot } from '../mcp/taskstate.mjs';
import { collectTaskCosts, costByStage, latestCostEvent, spendFigure } from '../mcp/drivercost.mjs';
import { writeDocs } from '../mcp/docs.mjs';
import { docPaths } from '../mcp/tickets.mjs';

function resolveId(key) {
  const p = resolve(key);
  if (existsSync(join(p, 'task.json'))) {
    process.env.HARNESS_TASKS_DIR = dirname(p);
    return basename(p);
  }
  const m = /^E-([0-9a-f]{8})$/.exec(key);
  if (m) {
    let ids = [];
    try { ids = readdirSync(tasksRoot()); } catch { /* no root */ }
    return ids.find((id) => id.startsWith(m[1])) || null;
  }
  return key;
}

export function renderDocs(key) {
  const id = resolveId(key);
  const task = id ? loadRunAt(taskPath(id)) : null;
  if (!task) throw new Error(`unknown task ${key}`);
  // A live daemon still writes cost_recorded; an early one here would disagree with its stream-derived stage lines.
  if (driverAlive(task.daemon)) throw new Error(`the daemon is still running (pid ${task.daemon.pid}); render after daemon_done`);
  let events = [];
  try {
    events = readFileSync(join(taskDir(task.run_id), 'ledger.jsonl'), 'utf8').split('\n').filter((l) => l.includes('cost_recorded')).map((l) => { try { return JSON.parse(l); } catch { return null; } });
  } catch { /* no ledger yet */ }
  const lastAny = events.filter((e) => e && e.event === 'cost_recorded').pop();
  if (!lastAny || !lastAny.by_stage || typeof lastAny.by_stage !== 'object') {
    const live = collectTaskCosts(taskDir(task.run_id), task);
    if (live.streams.length || live.node_streams.length) {
      const fig = spendFigure(live, latestCostEvent(events));
      record(task, { event: 'cost_recorded', task_id: task.run_id, spend: fig.spend, estimated: fig.estimated, by_stage: costByStage(live) });
    }
  }
  const report = docPaths(task).report;
  writeDocs(task);
  if (!existsSync(report) || !statSync(report).isFile()) throw new Error(`${key}: no report to render (its report node is not done)`);
  return report;
}

function isMain() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isMain()) {
  const key = process.argv[2];
  try {
    if (!key) throw new Error('usage: render-docs.mjs <E-xxxxxxxx | task id | task dir>');
    console.log(renderDocs(key));
  } catch (e) {
    console.error(`render-docs: ${key || ''}: ${e.message}`);
    process.exit(1);
  }
}
