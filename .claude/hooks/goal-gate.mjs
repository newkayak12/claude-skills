#!/usr/bin/env node
// PreToolUse gate: deny edits to gated paths unless the harness is engaged.
// Opt-in per project via .claude/harness-gate.json — no config, no gate.
// Fail-open on every error/ambiguity (v0 lesson: never brick a session).
//
// Engaged means a RECORD says harness work is under way - never text. The transcript is read
// only for tool calls that actually ran (a tool_use whose tool_result is not an error), so
// quoting the engine path, or this hook's own deny message, engages nothing. Records:
//   1. a Workflow tool_use of harness/engine/pipeline.js, or an MCP graph_open / tm_open /
//      tm_run tool_use, that succeeded within window_hours;
//   2. an open node in the broker ledger (.harness-run/broker/open-nodes.json);
//   3. an open fallback run (.harness-run/<slug>/): manifest.json, a non-empty 01-plan.md, a
//      02-goal-spec.json with at least one subgoal, and a 02-critique.json saying sound:true that
//      is no older than the spec - and no 05-report.md yet. Plan, setgoal and critique come
//      before any gated edit, the same order the Design Changes rule asks for;
//   4. a marker under .claude/.harness-markers/ (parallel subagents; teams' engage.mjs writes
//      them into package worktrees).
// Timestamps from the future are ignored, so a forged marker cannot live forever.
//
// Gated: the config's patterns (case-insensitive, matched against "/" + the root-relative
// path), plus the gate's own files - its config, its hook, the settings that register it, and
// the markers - whatever the patterns say. Only files inside the root are gated; the root is the
// nearest ancestor of the target that holds .claude/harness-gate.json, else the git common dir's
// project (a sibling worktree), else CLAUDE_PROJECT_DIR.
//
// Edit tools are judged by their file_path. Bash is judged by the paths its command names next
// to a write: a redirect, tee, sed -i/perl -i, cp/mv/rm/install/truncate/dd/patch/ln, git
// checkout/restore/apply/stash/reset, or an inline script (node -e, python -c, heredoc). This is
// a heuristic - see harness/hooks/README.md for what it cannot see.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  existsSync,
} from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const CLEAN_MS = 24 * 60 * 60 * 1000;
const SKEW_MS = 60 * 1000;
const CONFIG = join('.claude', 'harness-gate.json');
// The gate's own files: turning the gate off is itself a gated edit.
const SELF = [
  /^\/\.claude\/harness-gate\.json$/i,
  /^\/\.claude\/settings(\.local)?\.json$/i,
  /^\/\.claude\/hooks\//i,
  /^\/\.claude\/\.harness-markers\//i,
];
const ENGINE_RE = /(^|\/)harness\/engine\/pipeline\.js$/;
const MCP_ENGAGE_RE = /(^|__)(graph_open|tm_open|tm_run)$/;

const sanitize = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');

// A timestamp is live when it is inside the window and not from the future.
const live = (ts, now, windowMs) => ts > 0 && ts <= now + SKEW_MS && now - ts <= windowMs;

export function findRoot(target, env = process.env) {
  let dir = dirname(target);
  for (;;) {
    if (existsSync(join(dir, CONFIG))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  // A sibling worktree (git worktree add ../wt) has no config ancestor: its common git dir's
  // project does.
  try {
    let d = dirname(target);
    while (!existsSync(d)) d = dirname(d);
    const common = execFileSync('git', ['-C', d, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
    }).trim();
    const proj = dirname(common);
    if (common && existsSync(join(proj, CONFIG))) return { root: proj, worktree: d };
  } catch {
    /* not a git tree */
  }
  const pd = env.CLAUDE_PROJECT_DIR;
  if (pd && existsSync(join(pd, CONFIG))) return pd;
  return null;
}

function inside(root, p) {
  const rel = relative(root, p);
  return rel === '' ? null : rel.startsWith('..') || isAbsolute(rel) ? null : rel;
}

// "/"-prefixed root-relative path when p is under root, else null.
export function gatedRel(root, p) {
  const rel = inside(root, p);
  return rel == null ? null : '/' + rel.split(sep).join('/');
}

function loadConfig(root) {
  const cfg = JSON.parse(readFileSync(join(root, CONFIG), 'utf8'));
  const patterns = (cfg.patterns || []).map((p) => new RegExp(p, 'i'));
  const windowMs = (Number(cfg.window_hours) > 0 ? Number(cfg.window_hours) : 2) * 60 * 60 * 1000;
  return { patterns, windowMs };
}

export function isGated(rel, patterns) {
  if (rel == null) return false;
  return SELF.some((re) => re.test(rel)) || patterns.some((re) => re.test(rel));
}

// ---- engagement records ----

// Tool calls that ran and did not fail, inside the window. Only tool_use blocks are read -
// a string anywhere else in the transcript (prose, a tool's output, this hook's deny text)
// is never a record.
export function transcriptEngaged(text, now, windowMs) {
  const uses = new Map();
  const failed = new Set();
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const content = e && e.message && Array.isArray(e.message.content) ? e.message.content : [];
    const ts = Date.parse(e && e.timestamp) || 0;
    for (const c of content) {
      if (!c || typeof c !== 'object') continue;
      if (c.type === 'tool_use') {
        const input = c.input || {};
        const name = String(c.name || '');
        const hit = (name === 'Workflow' && ENGINE_RE.test(String(input.scriptPath || '').replace(/\\/g, '/')))
          || MCP_ENGAGE_RE.test(name);
        if (hit) uses.set(c.id, ts);
      } else if (c.type === 'tool_result' && c.is_error === true) {
        failed.add(c.tool_use_id);
      }
    }
  }
  for (const [id, ts] of uses) if (!failed.has(id) && live(ts, now, windowMs)) return true;
  return false;
}

function anyOpenBrokerNode(root, now, windowMs) {
  try {
    const open = JSON.parse(readFileSync(join(root, '.harness-run', 'broker', 'open-nodes.json'), 'utf8'));
    for (const k of Object.keys(open)) if (live(Number(open[k] && open[k].opened_at) || 0, now, windowMs)) return true;
  } catch {
    /* no broker ledger */
  }
  return false;
}

// An open fallback run: plan, goal-spec and a sound critique on disk, no report yet.
export function openFallbackRun(root, now, windowMs) {
  let slugs = [];
  try {
    slugs = readdirSync(join(root, '.harness-run'));
  } catch {
    return false;
  }
  for (const slug of slugs) {
    if (slug === 'broker') continue;
    const run = join(root, '.harness-run', slug);
    try {
      if (existsSync(join(run, '05-report.md'))) continue;
      JSON.parse(readFileSync(join(run, 'manifest.json'), 'utf8'));
      if (readFileSync(join(run, '01-plan.md'), 'utf8').trim().length < 10) continue;
      const spec = JSON.parse(readFileSync(join(run, '02-goal-spec.json'), 'utf8'));
      if (!spec || !Array.isArray(spec.subgoals) || !spec.subgoals.length) continue;
      const crit = JSON.parse(readFileSync(join(run, '02-critique.json'), 'utf8'));
      if (!crit || crit.sound !== true) continue;
      const specT = statSync(join(run, '02-goal-spec.json')).mtimeMs;
      if (statSync(join(run, '02-critique.json')).mtimeMs < specT) continue;
      let latest = 0;
      for (const f of readdirSync(run, { recursive: true })) {
        try {
          latest = Math.max(latest, statSync(join(run, String(f))).mtimeMs);
        } catch {
          /* raced */
        }
      }
      if (live(latest, now, windowMs)) return true;
    } catch {
      /* incomplete run */
    }
  }
  return false;
}

function readMarker(p) {
  try {
    return parseInt(readFileSync(p, 'utf8'), 10) || 0;
  } catch {
    return 0;
  }
}

function anyRecentMarker(dir, now, windowMs) {
  let recent = false;
  try {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      const ts = readMarker(p);
      if (live(ts, now, windowMs)) recent = true;
      else if (now - ts > CLEAN_MS || ts > now + SKEW_MS) {
        try {
          rmSync(p);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* no dir yet */
  }
  return recent;
}

function refreshMarker(dir, sid) {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, sanitize(sid)), String(Date.now()));
  } catch {
    /* best-effort */
  }
}

// ---- Bash: which paths does this command write? ----

const WRITE_CMD = /(^|[\s;&|(`])(tee|sed\s+(-[^\s]*\s+)*-i|perl\s+(-[^\s]*\s+)*-[a-z]*i|cp|mv|rm|install|truncate|dd|patch|ln|touch|git\s+(checkout|restore|apply|stash|reset|mv|rm))\b/;
const INLINE_SCRIPT = /(^|[\s;&|(`])(node|deno|bun)\s+(-[^\s]*\s+)*(-e|--eval|-p|--print)\b|(^|[\s;&|(`])python3?\s+(-[^\s]*\s+)*-c\b|<<-?\s*['"]?\w+/;
const PATHLIKE = /[A-Za-z0-9_.\/~@+-]+/g;

// The directories a command's paths are relative to: its cwd, and every `cd X` it runs.
function bases(cmd, cwd) {
  const out = [cwd];
  let cur = cwd;
  for (const m of String(cmd).matchAll(/(?:^|[\s;&|(])cd\s+("([^"]*)"|'([^']*)'|[^\s;&|<>()]+)/g)) {
    cur = resolve(cur, (m[2] ?? m[3] ?? m[1]).replace(/^~(?=\/|$)/, process.env.HOME || '~'));
    out.push(cur);
  }
  return out;
}

// Paths the command writes: every redirect target, and - when the command holds a write verb or
// an inline script - every path-like word in it, quoted or not (a script body names its target
// inside a string: writeFileSync('x.mjs')). Each is resolved against every base it could be
// relative to.
export function bashWriteTargets(command, cwd) {
  const cmd = String(command || '');
  const words = new Set();
  for (const m of cmd.matchAll(/(?:^|[^<>&0-9])(?:[0-9]|&)?>>?\|?\s*("([^"]*)"|'([^']*)'|[^\s;&|<>()]+)/g)) {
    const t = m[2] ?? m[3] ?? m[1];
    if (t && !/^&\d$/.test(t) && t !== '/dev/null') words.add(t);
  }
  if (WRITE_CMD.test(cmd) || INLINE_SCRIPT.test(cmd)) {
    for (const t of cmd.match(PATHLIKE) || []) {
      if (t.startsWith('-') || !/[./]/.test(t) || /^\.+$/.test(t)) continue;
      words.add(t);
    }
  }
  const out = new Set();
  for (const b of bases(cmd, cwd)) for (const w of words) out.add(resolve(b, w.replace(/^~(?=\/)/, process.env.HOME || '~')));
  return [...out];
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
  process.exit(0);
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.exit(0);
  }
  if (!input || typeof input !== 'object') process.exit(0);
  const cwd = input.cwd || process.cwd();
  const tool = input.tool_name;
  const sid = input.session_id || 'unknown';
  const now = Date.now();

  // What this call would write.
  let targets = [];
  if (EDIT_TOOLS.has(tool)) {
    const fp = (input.tool_input && (input.tool_input.file_path || input.tool_input.notebook_path)) || '';
    if (fp) targets = [resolve(cwd, String(fp))];
  } else if (tool === 'Bash') {
    targets = bashWriteTargets(input.tool_input && input.tool_input.command, cwd);
  }

  // Each target's root and root-relative path. Only a target inside a configured root is gated.
  const judged = [];
  for (const t of targets) {
    const f = findRoot(t);
    if (!f) continue;
    const root = typeof f === 'string' ? f : f.root;
    const base = typeof f === 'string' ? f : (gitTop(f.worktree) || f.root);
    judged.push({ root, rel: gatedRel(base, t) });
  }
  // Task/Agent (and a Bash that writes nothing gated) still refresh markers when engaged.
  const rootF = judged.length ? judged[0].root : findRoot(join(cwd, '_'));
  if (!rootF) process.exit(0); // no config anywhere → gate inactive
  const root = typeof rootF === 'string' ? rootF : rootF.root;
  let cfg;
  try {
    cfg = loadConfig(root);
  } catch {
    process.exit(0); // unreadable config or bad regex → fail-open
  }
  const markerDir = join(root, '.claude', '.harness-markers');

  let engaged = false;
  if (input.transcript_path) {
    try {
      engaged = transcriptEngaged(readFileSync(input.transcript_path, 'utf8'), now, cfg.windowMs);
    } catch {
      /* unreadable → decided below */
    }
  }
  if (!engaged) engaged = anyOpenBrokerNode(root, now, cfg.windowMs) || openFallbackRun(root, now, cfg.windowMs);
  if (engaged) refreshMarker(markerDir, sid);

  const gated = [...new Set(judged.filter((j) => isGated(j.rel, cfg.patterns)).map((j) => j.rel))];
  if (!gated.length || engaged) process.exit(0);
  if (anyRecentMarker(markerDir, now, cfg.windowMs)) process.exit(0);

  deny(
    `${gated.slice(0, 3).join(', ')} is gated by the harness (.claude/harness-gate.json). ` +
      'Engage the harness before editing it: invoke the harness skill and follow its Process - ' +
      'the graph MCP, the Workflow engine, or an Agent Team fallback run whose plan, goal-spec and ' +
      'sound critique are on disk. A mention in text does not engage it.',
  );
}

function gitTop(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
    }).trim();
  } catch {
    return null;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('goal-gate.mjs')) {
  try {
    main();
  } catch {
    process.exit(0); // fail-open: never let an uncaught throw block the tool call
  }
}
