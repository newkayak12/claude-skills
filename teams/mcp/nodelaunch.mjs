// nodelaunch.mjs - the one launch contract every node spawn site shares (card 130): which model a
// stage runs on (F1), which flags keep its session lean (F2), what the ledger records about it,
// and when a prompt points at a region of a file instead of the whole file.
//
// Pure: no file writes, no network. The only process I/O is ONE read-only, memoized
// `claude --help` probe (probeHelp), which fails open and which every caller can bypass by
// passing opts.helpText.
//
// Which skill map leanLaunchArgs expands depends on task.scope, so the plugin-dir limit of a
// path is never an accident:
//   'manager' -> STAGE_SKILLS (stagecontract.mjs): daemon judge, manager stages, goal_gate.
//   'graph'   -> GRAPH_STAGE_SKILLS (mounts.mjs): broker-adapter graph nodes and child drivers.
// A stage that sits in both maps (critique, gate) defaults to 'graph'; a manager spawn of it
// passes scope: 'manager'. The 'driver' stage runs a whole graph run, so it gets the union of
// every GRAPH_STAGE_SKILLS list.
//
// --mcp-config is an inline JSON string: teams has no config file (the precedent is
// adapters/claude-exec-adapter.mjs). It declares the single 'teams' server (plugin.json), which
// serves both the tm_* tools (tm_ask) and the team_* tools.
//
// Keeping the user's global CLAUDE.md out: `claude --help` (2.1.322) lists no flag that does only
// that. --bare skips CLAUDE.md discovery but also OAuth/keychain (a headless run answers "Not
// logged in"); --safe-mode drops it but also every MCP server, so tm_ask and team_* vanish.
// Neither is emitted. The existing `--setting-sources project` is kept; a live init stream
// showed it does NOT hide the global CLAUDE.md, so that stays in a lean session's start context.

import { execFileSync } from 'node:child_process';
import { STAGE_SKILLS } from './stagecontract.mjs';
import { GRAPH_STAGE_SKILLS } from './mounts.mjs';
import { resolve } from 'node:path';
import { pluginDirArgs, pluginOf, resolvePluginDir, teamsPluginRoot } from './pluginroots.mjs';

// implement/test/driver run on Sonnet; everything that plans, judges or gates runs on Opus.
// 'judge' covers the manager judges (shape, accept, integrate, plan-integrate); the areas and
// size stages count as judge too.
export const STAGE_KEYS = Object.freeze(['implement', 'test', 'driver', 'plan', 'setgoal', 'critique', 'review', 'gate', 'report', 'judge', 'goal_gate']);
export const DEFAULT_MODELS = Object.freeze({
  implement: 'sonnet', test: 'sonnet', driver: 'sonnet',
  plan: 'opus', setgoal: 'opus', critique: 'opus', review: 'opus', gate: 'opus', report: 'opus', judge: 'opus', goal_gate: 'opus',
});

const STAGE_ALIASES = { gate_goal: 'goal_gate', goal: 'goal_gate', shape: 'judge', accept: 'judge', integrate: 'judge', plan_integrate: 'judge', areas: 'judge', size: 'judge', areas_critique: 'critique' };
const JUDGE_LIKE = /critique|review|gate|judge|plan|report|accept|integrate|shape|goal|audit/;

// Canonical STAGE_KEYS entry for a stage name or alias ('gate:goal', 'plan-integrate',
// 'implement:U1:2'), or null when it is not one of them.
export function normalizeStage(stage) {
  const raw = String(stage ?? '').trim().toLowerCase();
  const key = (s) => s.replace(/[-:\s]/g, '_');
  const hit = (s) => (STAGE_KEYS.includes(key(s)) ? key(s) : STAGE_ALIASES[key(s)] || null);
  return hit(raw) || hit(raw.split(':')[0]);
}

function modelOf(map, ...keys) {
  if (!map || typeof map !== 'object') return undefined;
  for (const k of keys) {
    const v = k && map[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

// Model for a stage. opts.models is the tm_open argument; opts.teamModels is team.json's `models`
// (resolveTeamOptions already merges the two key by key, so passing only the merged result as
// opts.models is also correct). Order: tm_open > team.json > built-in. An alias ('opus') passes
// through as given. An unknown stage takes its role's default and never throws.
export function resolveStageModel(stage, opts = {}) {
  const o = opts || {};
  const canonical = normalizeStage(stage);
  const raw = String(stage ?? '').trim();
  const keys = [raw, canonical];
  return modelOf(o.models, ...keys)
    || modelOf(o.teamModels, ...keys)
    || (canonical ? DEFAULT_MODELS[canonical] : (JUDGE_LIKE.test(raw.toLowerCase()) ? 'opus' : 'sonnet'));
}

function skillKey(stage) {
  const s = String(stage ?? '').trim().toLowerCase();
  return ['goal_gate', 'goal-gate', 'goal'].includes(s) ? 'gate:goal' : s.replace(/_/g, '-');
}

function defaultScope(stage) {
  const key = skillKey(stage);
  const canonical = normalizeStage(stage);
  if (canonical === 'judge' || canonical === 'goal_gate') return 'manager';
  return key in STAGE_SKILLS && !(key in GRAPH_STAGE_SKILLS) ? 'manager' : 'graph';
}

// Skills a stage may load, from the map its scope names. task.stage_skills (tm_open's skills)
// overrides per stage, and false turns every list off, as stageSkills()/graphStageSkills() do.
export function stageSkillList(stage, task = {}) {
  const t = task || {};
  if (t.stage_skills === false) return [];
  const key = skillKey(stage);
  const override = t.stage_skills && typeof t.stage_skills === 'object' ? t.stage_skills[key] : undefined;
  let list;
  if (Array.isArray(override)) list = override;
  else if (normalizeStage(stage) === 'driver') list = Object.values(GRAPH_STAGE_SKILLS).flat();
  else list = ((t.scope || defaultScope(stage)) === 'manager' ? STAGE_SKILLS : GRAPH_STAGE_SKILLS)[key];
  return [...new Set((list || []).map(String).filter(Boolean))];
}

let helpMemo;
// The single process I/O of this module: `claude --help`, once. null when it cannot be read.
function probeHelp() {
  if (helpMemo === undefined) {
    try { helpMemo = execFileSync('claude', ['--help'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }) || null; } catch { helpMemo = null; }
  }
  return helpMemo;
}

// A flag is emitted only when the help text lists it; an unreadable help (null) fails open.
const listed = (help, flag) => help == null || new RegExp(`(?<![\\w-])${flag}(?![\\w-])`).test(help);

// Argv fragment for a lean session of `stage`: the teams MCP server alone, the teams root plus
// only that stage's skill plugins (and task.plugin_dirs), project settings only.
// task: { scope, stage_skills, plugin_dirs, root }; opts.helpText bypasses the probe.
export function leanLaunchArgs(stage, task = {}, opts = {}) {
  const t = task || {};
  const help = opts && opts.helpText !== undefined ? opts.helpText : probeHelp();
  const root = teamsPluginRoot();
  const server = { command: process.execPath, args: [`${root}/mcp/server.mjs`, ...(t.root ? ['--root', String(t.root)] : [])] };
  const args = [];
  if (listed(help, '--strict-mcp-config')) args.push('--strict-mcp-config');
  if (listed(help, '--mcp-config')) args.push('--mcp-config', JSON.stringify({ mcpServers: { teams: server } }));
  if (listed(help, '--setting-sources')) args.push('--setting-sources', 'project');
  for (const dir of [root, ...stagePluginDirs(stage, t, root)]) args.push('--plugin-dir', dir);
  return args;
}

// pluginDirArgs always adds every plugin the built-in method tables name, whatever skills it is
// handed, so its result is narrowed here to the plugins this stage's skills live in plus the
// task's own plugin_dirs (which pluginroots checks are plugins).
function stagePluginDirs(stage, task, root) {
  const allowed = new Set((task.plugin_dirs || []).map((d) => resolve(String(d))));
  for (const skill of stageSkillList(stage, task)) {
    const dir = resolvePluginDir(pluginOf(skill), root);
    if (dir) allowed.add(resolve(dir));
  }
  const args = pluginDirArgs({ pluginRoot: root, skills: [stageSkillList(stage, task)], extraDirs: task.plugin_dirs || [] });
  return args.filter((a, i) => i % 2 === 1 && allowed.has(a));
}

// Ledger entries (broker-vendors.mjs record() writes them). Null-safe, exactly these fields.
export function nodeStartEntry({ run_id = null, node_id = null, stage = null, model = null, pid = null } = {}) {
  return { event: 'node_start', run_id, node_id, stage, model, pid };
}
export function nodeEndEntry({ run_id = null, node_id = null, stage = null, model = null, api_calls = null, peak_context_tokens = null } = {}) {
  return { event: 'node_end', run_id, node_id, stage, model, api_calls, peak_context_tokens };
}

const contextTokens = (u) => {
  if (!u || typeof u !== 'object') return null;
  const n = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].reduce((s, k) => s + (Number(u[k]) || 0), 0);
  return n > 0 ? n : null;
};

function parseEvents(text) {
  const s = String(text ?? '').trim();
  if (!s) return [];
  try {
    const whole = JSON.parse(s); // one envelope (claude adapter events.jsonl) or a JSON array
    return Array.isArray(whole) ? whole : [whole];
  } catch { /* NDJSON: one event per line */ }
  const out = [];
  for (const line of s.split(/\r?\n/)) { try { out.push(JSON.parse(line)); } catch { /* not an event */ } }
  return out;
}

// {api_calls, peak_context_tokens} from claude stream-json text or an adapter's events.jsonl
// (a claude `--output-format json` envelope, or codex `turn.completed` events). api_calls counts
// distinct assistant messages; peak_context_tokens is the largest input + cache_read +
// cache_creation of one API call. A result event's usage is cumulative over every call, so it is
// used (as an upper bound) only when no per-call usage exists. Nulls, never a throw, otherwise.
export function usageFromStream(text) {
  let events;
  try { events = parseEvents(text); } catch { events = []; }
  const seen = new Set();
  let calls = 0; let peak = null; let resultPeak = null; let resultTurns = null;
  const take = (u) => { const n = contextTokens(u); if (n != null) peak = peak == null ? n : Math.max(peak, n); };
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    if (e.type === 'assistant') {
      const id = e.message && e.message.id;
      if (!id || !seen.has(id)) { calls += 1; if (id) seen.add(id); }
      take(e.message && e.message.usage);
    } else if (e.type === 'turn.completed') {
      calls += 1; take(e.usage);
    } else if (e.type === 'result') {
      resultPeak = contextTokens(e.usage);
      resultTurns = Number.isInteger(e.num_turns) && e.num_turns > 0 ? e.num_turns : null;
    }
  }
  return { api_calls: calls || resultTurns, peak_context_tokens: peak ?? resultPeak };
}

export const REGION_THRESHOLD_LINES = 400;

// A pointer for a file over REGION_THRESHOLD_LINES lines, null at or under it. opts.symbols gives
// `path#a,b`; opts.range [start, end] narrows `path:Lstart-Lend` (default: the whole file).
export function regionPointer(path, text, opts = {}) {
  const s = String(text ?? '');
  const total = s ? s.replace(/\r?\n$/, '').split(/\r?\n/).length : 0;
  if (total <= REGION_THRESHOLD_LINES) return null;
  const { symbols, range } = opts || {};
  const names = Array.isArray(symbols) ? symbols.map(String).filter(Boolean) : [];
  if (names.length) return `${path}#${names.join(',')}`;
  const [a, b] = Array.isArray(range) ? range : [1, total];
  const start = Math.max(1, Math.min(Number(a) || 1, total));
  const end = Math.max(start, Math.min(Number(b) || total, total));
  return `${path}:L${start}-L${end}`;
}
