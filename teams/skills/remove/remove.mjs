#!/usr/bin/env node
// Deterministically remove what teams install.mjs wrote. Conventions, run history and task
// history are kept unless asked for by name; a task whose driver is still alive is never removed.
// Usage: node remove.mjs '{"projectDir":"/abs","purgeConventions":false,"purgeRuns":false,"purgeTasks":false}'
import { existsSync, readFileSync, writeFileSync, rmSync, rmdirSync, readdirSync, statSync } from 'node:fs';
import { join, parse, resolve } from 'node:path';
import { homedir } from 'node:os';

const GITIGNORE_LINES = new Set(['.teams_output/', '.claude/.harness-markers/']);

function fail(m) { process.stderr.write(`remove.mjs: ${m}\n`); process.exit(2); }
function parseArgs() {
  const raw = process.argv[2];
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { fail(`argv[1] is not valid JSON: ${e.message}`); }
}
function removeKnownPath(p) {
  if (!existsSync(p)) return 'absent';
  rmSync(p, { recursive: true, force: true });
  return 'removed';
}
function removeClaudeBlock(path, notes) {
  if (!existsSync(path)) return 'absent';
  const cur = readFileSync(path, 'utf8');
  const begins = (cur.match(/<!-- teams:begin\b/g) || []).length;
  const ends = (cur.match(/<!-- teams:end -->/g) || []).length;
  if (!begins && !ends) return 'absent';
  if (begins !== ends) { notes.push('CLAUDE.md has unmatched teams markers - left untouched'); return 'marker-error'; }
  const lines = cur.split(/\r?\n/);
  const kept = [];
  let inside = false;
  let justClosed = false;
  for (const line of lines) {
    if (/^\s*<!-- teams:begin\b[^>]*-->\s*$/.test(line)) { inside = true; continue; }
    if (inside) { if (/^\s*<!-- teams:end -->\s*$/.test(line)) { inside = false; justClosed = true; } continue; }
    if (justClosed && !line.trim() && kept.at(-1)?.trim() === '') { justClosed = false; continue; }
    justClosed = false;
    kept.push(line);
  }
  const next = kept.join('\n').replace(/\n+$/, '');
  if (!next.trim()) { rmSync(path); return 'removed-file'; }
  writeFileSync(path, next + '\n');
  return 'removed-block';
}
function removeGitignoreLines(path) {
  if (!existsSync(path)) return 'absent';
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const kept = lines.filter((l) => !GITIGNORE_LINES.has(l.trim()));
  if (kept.length === lines.length) return 'absent';
  while (kept.length && kept.at(-1) === '') kept.pop();
  if (!kept.some((l) => l.trim())) { rmSync(path); return 'removed-file'; }
  writeFileSync(path, kept.join('\n') + '\n');
  return 'removed-lines';
}
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function driverPids(task) {
  const pids = [];
  for (const n of task.nodes || []) if (n.child && n.child.driver && n.child.driver.pid) pids.push(n.child.driver.pid);
  if (task.s_run && task.s_run.driver && task.s_run.driver.pid) pids.push(task.s_run.driver.pid);
  if (task.leader && task.leader.pid) pids.push(task.leader.pid);
  return pids;
}
function purgeTasks(projectDir, notes) {
  const root = process.env.HARNESS_TASKS_DIR ? resolve(process.env.HARNESS_TASKS_DIR) : join(homedir(), '.harness', 'tasks');
  const out = {};
  if (!existsSync(root)) return out;
  for (const id of readdirSync(root)) {
    const file = join(root, id, 'task.json');
    let task;
    try { task = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    if (resolve(String(task.cwd || '')) !== projectDir) continue;
    if (driverPids(task).some(alive)) { out[id] = 'refused-alive'; notes.push(`task ${id}: a driver is still running - stop it first`); continue; }
    rmSync(join(root, id), { recursive: true, force: true });
    out[id] = 'removed';
  }
  return out;
}
function removeEmptyDir(p, cleaned) {
  if (!existsSync(p)) return;
  try { rmdirSync(p); cleaned.push(p); } catch (e) { if (e.code !== 'ENOTEMPTY') throw e; }
}

function main() {
  const args = parseArgs();
  const projectDir = resolve(args.projectDir || process.cwd());
  if (projectDir === parse(projectDir).root) fail('refusing to target a filesystem root');
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) fail(`projectDir is not a directory: ${projectDir}`);
  const claudeDir = join(projectDir, '.claude');
  const notes = [];
  const actions = {};
  actions.team = removeKnownPath(join(claudeDir, 'team.json'));
  actions.dispatch = removeKnownPath(join(claudeDir, 'teams-dispatch.json'));
  actions.claudeMd = removeClaudeBlock(join(projectDir, 'CLAUDE.md'), notes);
  actions.gitignore = removeGitignoreLines(join(projectDir, '.gitignore'));
  // harness's session markers live in the same directory; on a project where harness is also
  // installed, leave them alone.
  actions.markers = existsSync(join(claudeDir, 'harness-gate.json')) ? 'kept-harness' : removeKnownPath(join(claudeDir, '.harness-markers'));
  if (args.purgeConventions === true) actions.conventions = removeKnownPath(join(claudeDir, 'conventions'));
  else { actions.conventions = existsSync(join(claudeDir, 'conventions')) ? 'kept' : 'absent'; if (actions.conventions === 'kept') notes.push('conventions preserved (shared with harness; projects own them) - purgeConventions=true removes them'); }
  if (args.purgeRuns === true) actions.runs = removeKnownPath(join(projectDir, '.teams_output'));
  else actions.runs = existsSync(join(projectDir, '.teams_output')) ? 'kept' : 'absent';
  if (args.purgeTasks === true) actions.tasks = purgeTasks(projectDir, notes);
  else actions.tasks = 'kept';
  const cleanedDirs = [];
  removeEmptyDir(claudeDir, cleanedDirs);
  actions.cleanedDirs = cleanedDirs;
  process.stdout.write(JSON.stringify({ projectDir, actions, notes }, null, 2) + '\n');
}

main();
