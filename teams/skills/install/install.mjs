#!/usr/bin/env node
// Deterministic file ops for the teams `install` skill. The SKILL keeps the judgment
// (dispatch patterns, which roles to switch on); this runs the confirmed values the same
// way every time. Idempotent and non-destructive: an existing file is 'kept'. With
// "refresh": true, team.json gains keys a newer plugin introduced - existing values are
// never changed. Hooks are NOT installed here: the plugin's hooks.json registers them.
//
// Usage: node install.mjs '{
//   "projectDir": "/abs/path",                       // default: cwd
//   "refresh": false,
//   "dispatch": { "paths": ["src/**"], "min_chars": 400, "allow": [] },   // omit → no dispatch gate
//   "team": { "goal_threshold": 95, "roles": { "qa": true } }             // overrides on first write
// }'
// Exit 0 ok · 2 bad input.
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEAM_DEFAULTS, TEAM_FILE } from '../../mcp/teamconfig.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONVENTIONS = ['coding.md', 'verification.md', 'boundaries.md'];
const GITIGNORE_LINES = ['.teams_output/', '.claude/.harness-markers/'];

function parseArgs() {
  const raw = process.argv[2];
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) {
    process.stderr.write(`install.mjs: argv[1] is not valid JSON: ${e.message}\n`);
    process.exit(2);
  }
}
function readJsonOr(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}
function ensureDir(d) { mkdirSync(d, { recursive: true }); }

function deepMergeDefaults(target, defaults) {
  let changed = false;
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in target)) { target[k] = Array.isArray(v) ? v.slice() : (v && typeof v === 'object' ? { ...v } : v); changed = true; }
    else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') {
      if (deepMergeDefaults(target[k], v)) changed = true;
    }
  }
  return changed;
}

function writeTeam(claudeDir, projectDir, overrides, refresh) {
  const path = join(projectDir, TEAM_FILE);
  if (existsSync(path)) {
    if (!refresh) return 'kept';
    const cur = readJsonOr(path, null);
    if (!cur || typeof cur !== 'object') return 'parse-error';
    const changed = deepMergeDefaults(cur, TEAM_DEFAULTS);
    if (!changed) return 'unchanged';
    writeFileSync(path, JSON.stringify(cur, null, 2) + '\n');
    return 'refreshed';
  }
  const team = { ...TEAM_DEFAULTS, roles: { ...TEAM_DEFAULTS.roles }, human_gates: [] };
  for (const [k, v] of Object.entries(overrides || {})) {
    if (!(k in TEAM_DEFAULTS)) continue;
    team[k] = k === 'roles' && v && typeof v === 'object' ? { ...team.roles, ...v } : v;
  }
  ensureDir(claudeDir);
  writeFileSync(path, JSON.stringify(team, null, 2) + '\n');
  return 'created';
}

function writeDispatch(claudeDir, dispatch) {
  if (!dispatch || !Array.isArray(dispatch.paths) || !dispatch.paths.length) return 'skipped';
  const path = join(claudeDir, 'teams-dispatch.json');
  if (existsSync(path)) return 'kept';
  const cfg = { paths: dispatch.paths };
  if (Number.isFinite(dispatch.min_chars)) cfg.min_chars = dispatch.min_chars;
  if (Array.isArray(dispatch.allow) && dispatch.allow.length) cfg.allow = dispatch.allow;
  ensureDir(claudeDir);
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
  return 'created';
}

function copyConventions(claudeDir) {
  const out = {};
  for (const f of CONVENTIONS) {
    const src = join(HERE, 'templates', 'conventions', f);
    const dest = join(claudeDir, 'conventions', f);
    if (!existsSync(src)) { out[f] = 'missing-src'; continue; }
    if (existsSync(dest)) { out[f] = 'kept'; continue; }
    ensureDir(dirname(dest));
    cpSync(src, dest);
    out[f] = 'created';
  }
  return out;
}

function writeClaudeMd(projectDir) {
  const path = join(projectDir, 'CLAUDE.md');
  const block = readFileSync(join(HERE, 'templates', 'claude-md-section.md'), 'utf8');
  if (!existsSync(path)) { writeFileSync(path, block); return 'created'; }
  const cur = readFileSync(path, 'utf8');
  if (cur.includes('<!-- teams:begin')) return 'present';
  writeFileSync(path, cur + (cur.endsWith('\n') ? '' : '\n') + '\n' + block);
  return 'appended';
}

function writeGitignore(projectDir) {
  const path = join(projectDir, '.gitignore');
  if (!existsSync(path)) { writeFileSync(path, GITIGNORE_LINES.join('\n') + '\n'); return 'created'; }
  const cur = readFileSync(path, 'utf8');
  const have = new Set(cur.split(/\r?\n/).map((l) => l.trim()));
  const missing = GITIGNORE_LINES.filter((l) => !have.has(l));
  if (!missing.length) return 'present';
  writeFileSync(path, cur + (cur.endsWith('\n') ? '' : '\n') + missing.join('\n') + '\n');
  return 'appended';
}

function main() {
  const args = parseArgs();
  const projectDir = args.projectDir ? resolve(args.projectDir) : process.cwd();
  const claudeDir = join(projectDir, '.claude');
  const refresh = args.refresh === true;
  const report = { projectDir, refresh, actions: {}, notes: [] };

  report.actions.team = writeTeam(claudeDir, projectDir, args.team, refresh);
  report.actions.dispatch = writeDispatch(claudeDir, args.dispatch);
  if (report.actions.dispatch === 'skipped') report.notes.push('dispatch: no paths provided - .claude/teams-dispatch.json not written (gate stays inactive)');
  report.actions.conventions = copyConventions(claudeDir);
  report.actions.claudeMd = writeClaudeMd(projectDir);
  report.actions.gitignore = writeGitignore(projectDir);
  report.notes.push('hooks: registered by the plugin manifest; nothing copied into the project. Embedded (plugin-less) mode is not offered by this plugin.');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main();
