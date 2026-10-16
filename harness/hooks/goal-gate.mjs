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
  realpathSync,
} from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute, sep, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const patchTargets = (command, cwd) => [...String(command || '').matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)]
  .map((m) => resolve(cwd, m[1].trim()));
const CLEAN_MS = 24 * 60 * 60 * 1000;
const SKEW_MS = 60 * 1000;
const CONFIG = join('.claude', 'harness-gate.json');
// The gate's own files: turning the gate off is itself a gated edit.
const SELF = [
  /^\/\.claude\/harness-gate\.json$/i,
  /^\/\.claude\/settings(\.local)?\.json$/i,
  /^\/\.claude\/hooks\//i,
  /^\/\.claude\/\.harness-markers\//i,
  // A hand-written broker ledger would engage the gate by itself (anyOpenBrokerNode).
  /^\/\.harness-run\/broker\//i,
];
const ENGINE_RE = /(^|\/)harness\/engine\/pipeline\.js$/;
const MCP_ENGAGE_RE = /(^|__)(graph_open|tm_open|tm_run)$/;

const sanitize = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');

// A timestamp is live when it is inside the window and not from the future.
const live = (ts, now, windowMs) => ts > 0 && ts <= now + SKEW_MS && now - ts <= windowMs;

export function findRoot(target, env = process.env) {
  let dir = dirname(target);
  for (;;) {
    if (existsSync(join(dir, CONFIG))) {
      // A linked worktree carries the tracked config but not the gitignored runs and markers:
      // the main project root holds those.
      const proj = mainRoot(dir);
      return proj && proj !== dir && existsSync(join(proj, CONFIG)) ? { root: proj, worktree: dir } : dir;
    }
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

// The main project of a linked worktree (git-common-dir differs from git-dir), else null.
function mainRoot(dir) {
  try {
    const [gitDir, common] = execFileSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
    }).trim().split('\n');
    return common && gitDir !== common ? dirname(common) : null;
  } catch {
    return null;
  }
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

// p with its nearest existing ancestor realpathed (macOS /tmp -> /private/tmp); p itself if none resolves.
function real(p) {
  let head = p;
  const tail = [];
  while (!existsSync(head) && dirname(head) !== head) {
    tail.unshift(basename(head));
    head = dirname(head);
  }
  try {
    return join(realpathSync(head), ...tail);
  } catch {
    return p;
  }
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

// A write verb, preceded by a command boundary or a quote (eval "cp ...", bash -c 'rm ...').
const WRITE_CMD = /(^|[\s;&|(`"'])(tee|sed\s+(-[^\s]*\s+)*-i|perl\s+(-[^\s]*\s+)*-[a-z]*i|cp|mv|rm|install|truncate|dd|patch|ln|touch|git\s+(checkout|restore|apply|stash|reset|mv|rm))\b/;
const INLINE_FLAG = /(^|\s)(-e|--eval|-p|--print|-c)\b/;
// A git command with --output writes that file.
const GIT_OUTPUT = /(?:^|\s)--output(?:=|\s+)("([^"]*)"|'([^']*)'|[^\s;&|<>()]+)/g;
const REDIRECT = /(?:^|[^<>&0-9])(?:[0-9]|&)?>>?\|?\s*("([^"]*)"|'([^']*)'|[^\s;&|<>()]+)/g;
const PATHLIKE = /[A-Za-z0-9_.\/~@+-]+/g;
// Read-only commands whose plain arguments may name a write verb (grep -n cp x.mjs). Anything
// else - sudo, env, nohup, xargs, find -exec, eval, command, exec, flock, a wrapper nobody listed
// - is judged by its words (deny by default).
const READ_ONLY = new Set(['grep', 'egrep', 'fgrep', 'rg', 'cat', 'head', 'tail', 'less', 'wc', 'ls', 'echo']);
const GIT_READ = new Set(['log', 'show', 'diff', 'status']);
const INTERP = /^(node|deno|bun|python[0-9.]*|perl|ruby|php)$/;
const SHELLS = /^(bash|sh|zsh|dash|ksh|fish|eval|source|xargs)$/;
// Anything in a script body that could write, run or load code - dynamic lookups included, so
// getattr(__builtins__, 'op'+'en') still counts. Deny by default: a read call named here (open()
// for reading) still counts - only a script with none of these is text.
const SCRIPT_WRITE = /\b(write\w*|append\w*|open\w*|copy\w*|rename\w*|replace|unlink\w*|remove\w*|rm\w*|mkdir\w*|makedirs|truncate|chmod|chown|symlink\w*|link\w*|exec\w*|spawn\w*|fork|subprocess|system|popen|shutil|eval|require|import|__import__|fs|pathlib|Path|os|child_process|Deno|Bun|File\w*|stream\w*|save\w*|dump\w*|to_csv|to_json|getattr|__builtins__|__dict__|globals|compile|Function|constructor)\b/;
// A file a data heredoc writes that is itself code.
const SCRIPT_EXT = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|php)$/i;

// Simple commands of a command line: split on ; & | && || and newlines outside quotes and
// escapes (find -exec rm {} \; stays one). 2>&1 and &> are not separators.
export function simpleCommands(text) {
  const out = [];
  let cur = '';
  let q = null;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === '\\' && q === '"' && i + 1 < s.length) cur += s[++i];
      else if (c === q) q = null;
      continue;
    }
    if (c === '\\' && i + 1 < s.length) { cur += c + s[++i]; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '&' && (s[i - 1] === '>' || s[i + 1] === '>')) { cur += c; continue; }
    if (c === ';' || c === '&' || c === '|' || c === '\n') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const bare = (w) => w.replace(/^['"]+|['"]+$/g, '').replace(/^.*\//, '');
const firstWord = (seg) => bare((seg.match(/^\S+/) || [''])[0]);
// Every word of a simple command: an interpreter behind a wrapper (timeout 5 python3 -c, nice
// node -e, env python3 -) is still an interpreter.
const words = (seg) => seg.split(/\s+/).map(bare).filter(Boolean);

function redirectTargets(text) {
  const out = [];
  for (const m of String(text).matchAll(REDIRECT)) {
    const t = m[2] ?? m[3] ?? m[1];
    if (t && !/^&\d$/.test(t) && t !== '/dev/null') out.push(t);
  }
  return out;
}

// A read-only command's own way to run or write something: rg --pre runs a command on each
// file, less -o/--log-file writes its input to a file.
function runsOrWrites(seg) {
  const w = firstWord(seg);
  return (w === 'rg' && /(^|\s)--pre(-glob)?\b/.test(seg))
    || (w === 'less' && /(^|\s)(-[a-zA-Z]*[oO]|--log-file|--LOG-FILE)\b/.test(seg));
}

// A read-only command that owns the whole simple command: its plain arguments write nothing.
// Command substitution runs something else, so it never counts as read-only; neither does a
// read-only command's own way to run or write something (rg --pre, less -o).
function readOnly(seg) {
  if (/\$\(|`/.test(seg)) return false;
  const w = firstWord(seg);
  if (w === 'echo') return !/>/.test(seg.replace(/[12]?>&[12]/g, ''));
  if (runsOrWrites(seg)) return false;
  if (READ_ONLY.has(w)) return true;
  if (w === 'git') return GIT_READ.has(seg.split(/\s+/)[1]) && !/(^|\s)--output\b/.test(seg);
  return false;
}

// The command line with every heredoc body cut out, and each heredoc with the line that feeds
// it. Heredoc markers are found outside quotes only (grep -n "<<EOF" is not one). A heredoc that
// never closes returns the whole command as its head, judged as it stands.
export function splitHeredocs(cmd) {
  const s = String(cmd);
  const docs = [];
  let out = '';
  let q = null;
  let pending = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (q) {
      out += c;
      if (c === '\\' && q === '"' && i + 1 < s.length) out += s[++i];
      else if (c === q) q = null;
      i++;
      continue;
    }
    if (c === '\\' && i + 1 < s.length) { out += c + s[i + 1]; i += 2; continue; }
    if (c === '"' || c === "'") { q = c; out += c; i++; continue; }
    if (c === '<' && s[i + 1] === '<' && s[i - 1] !== '<' && s[i + 2] !== '<') {
      const m = /^<<-?\s*(['"]?)([A-Za-z_]\w*)\1/.exec(s.slice(i));
      if (m) { pending.push(m[2]); out += m[0]; i += m[0].length; continue; }
    }
    if (c === '\n' && pending.length) {
      const line = out.slice(out.lastIndexOf('\n') + 1);
      out += c;
      i++;
      for (const d of pending) {
        const body = [];
        let closed = false;
        while (i < s.length) {
          const nl = s.indexOf('\n', i);
          const end = nl < 0 ? s.length : nl;
          const l = s.slice(i, end);
          i = nl < 0 ? s.length : nl + 1;
          if (l.trim() === d) { closed = true; break; }
          body.push(l);
        }
        if (!closed) return { head: s, docs: [] };
        docs.push({ line, body: body.join('\n') });
      }
      pending = [];
      continue;
    }
    out += c;
    i++;
  }
  if (pending.length) return { head: s, docs: [] };
  return { head: out, docs };
}

// Whether a heredoc's paths count as written, by what consumes it: a shell always; an
// interpreter when its body can write; anything else (data) only when the file it writes is
// code, and its body can write. Plain prose (a commit message saying "remove") is data. A data
// heredoc run later on the same line is handled by the caller (executes()).
function heredocWrites(d) {
  const ws = simpleCommands(d.line).flatMap(words);
  if (ws.some((w) => SHELLS.test(w))) return true;
  if (ws.some((w) => INTERP.test(w))) return SCRIPT_WRITE.test(d.body) || WRITE_CMD.test(d.body);
  const targets = redirectTargets(d.line);
  return targets.some((t) => SCRIPT_EXT.test(t)) && (SCRIPT_WRITE.test(d.body) || WRITE_CMD.test(d.body));
}

// Whether a simple command runs a shell, an interpreter or a script (bash p.txt, node x, ./x, . x,
// eval, sh -c): what a data heredoc wrote could be its input, under any spelling of the name.
function executes(seg) {
  const raw = seg.split(/\s+/).find((w) => !/^\w+=/.test(w)) || '';
  return words(seg).some((w) => SHELLS.test(w) || INTERP.test(w) || w === '.') || /^['"]?\.{0,2}\//.test(raw);
}

// Whether one simple command writes the paths it names: a write verb outside a read-only
// command, a shell given an inline script, an interpreter's inline script with anything
// write-capable in it.
function segmentWrites(seg) {
  if (readOnly(seg)) return false;
  if (WRITE_CMD.test(seg) || runsOrWrites(seg)) return true;
  if (!INLINE_FLAG.test(seg)) return false;
  const ws = words(seg);
  if (ws.some((w) => SHELLS.test(w))) return true;
  return ws.some((w) => INTERP.test(w)) && SCRIPT_WRITE.test(seg);
}

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

// Paths the command writes: every redirect target and git --output file outside a heredoc body,
// and every path-like word of a writing segment, quoted or not (a script names its target inside
// a string: writeFileSync('x.mjs')). A writing heredoc takes its target from anywhere in the
// command (variable, argv, env or for-loop list set on an earlier line), so the whole command is
// collected. Words of a segment that writes nothing (pgrep -f 'a/b.mjs') are not collected. Each
// is resolved against every base it could be relative to.
export function bashWriteTargets(command, cwd) {
  const a = analyzeBash(command, cwd);
  return [...new Set([...a.direct, ...a.script])];
}

// The directory each simple command runs in, following `cd X` in order; null when it cannot be
// followed (a subshell, `||`, `cd $VAR`, `cd -`, a cd flag): the caller then tries every base.
function segDirs(segs, head, cwd) {
  if (/\|\||[(`]/.test(head)) return null;
  const out = [];
  let cur = cwd;
  for (const g of segs) {
    out.push(cur);
    const m = /^cd(?:\s+("([^"]*)"|'([^']*)'|[^\s;&|<>()]+))?\s*$/.exec(g);
    if (!m) continue;
    const t = m[2] ?? m[3] ?? m[1] ?? '~';
    if (/[$`*?]/.test(t) || t.startsWith('-')) return null;
    cur = resolve(cur, t.replace(/^~(?=\/|$)/, process.env.HOME || '~'));
  }
  return out;
}

const READ_CAP = 512 * 1024;

// A script inside a gated root that is reviewed code: itself a gated file, or tracked in git and
// unmodified. Running it is not a way around the gate.
function reviewedScript(p) {
  try {
    const f = findRoot(p);
    if (!f) return false;
    const root = typeof f === 'string' ? f : f.root;
    const base = typeof f === 'string' ? f : (gitTop(f.worktree) || f.root);
    const rel = gatedRel(base, p) ?? gatedRel(base, real(p));
    if (rel == null) return false;
    if (isGated(rel, loadConfig(root).patterns)) return true;
    const opts = { stdio: 'ignore', timeout: 2000, cwd: dirname(p) };
    execFileSync('git', ['ls-files', '--error-unmatch', '--', p], opts);
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--', p], opts);
    return true;
  } catch {
    return false;
  }
}

const pathWords = (text) => (String(text).match(PATHLIKE) || []).filter((t) => !t.startsWith('-') && /[./]/.test(t) && !/^\.+$/.test(t));

// A static import of a relative module (import { f } from './lib.mjs', import '../setup.mjs'): the
// specifier is code the script loads, not a file it writes, and the word `import` alone does not
// make a script write-capable. A dynamic import() and a package or node: import are left as they were.
const REL_IMPORT = /\bimport\s*(?:[^'";()]*?\bfrom\s*)?(['"])\.{1,2}\/[^'"\n]*\1/g;

// The harness plugin's root, read from this file's own path (as deferToPlugin does): the file must
// sit in a harness plugin's hooks/ and not be the project copy under .claude/hooks/, and the root
// must hold a plugin.json named harness. Null anywhere else, so no env var or project file flips it.
function harnessPluginRoot() {
  try {
    const self = decodeURIComponent(new URL(import.meta.url).pathname);
    if (/\/\.claude\/hooks\//.test(self) || !/\/hooks\/goal-gate\.mjs$/.test(self)) return null;
    const root = dirname(dirname(self));
    const manifest = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
    return manifest && manifest.name === 'harness' ? root : null;
  } catch {
    return null;
  }
}

// Exactly `node <installed harness plugin>/skills/remove/remove.mjs ['<json>']`: harness:remove
// must be able to delete the gate's own files, which its own words name. Anything else on the
// segment (a node flag, a redirect, another argument) is not this invocation. Chained commands are
// separate segments and judged on their own.
const REMOVE_CALL = /^node\s+(?:"([^"$`\\]+)"|([^\s'"$`;&|<>()\\]+))(?:\s+'[^']*')?$/;
function isHarnessRemove(seg, dirs) {
  const m = REMOVE_CALL.exec(seg);
  if (!m) return false;
  const root = harnessPluginRoot();
  if (!root) return false;
  try {
    const script = real(join(root, 'skills', 'remove', 'remove.mjs'));
    if (!existsSync(script)) return false;
    const given = (m[1] ?? m[2]).replace(/^~(?=\/)/, process.env.HOME || '~');
    return dirs.every((d) => real(resolve(d, given)) === script);
  } catch {
    return false;
  }
}

// What a command that runs a file writes: the file's contents are judged like an inline script.
// Returns the words (path-like) the script names, or the command's own words when it cannot be read.
function scriptWords(seg, dirs) {
  const out = [];
  const seen = new Set();
  for (const w of seg.match(PATHLIKE) || []) {
    if (w.startsWith('-')) continue;
    for (const d of dirs) {
      const p = resolve(d, w.replace(/^~(?=\/)/, process.env.HOME || '~'));
      if (seen.has(p)) continue;
      seen.add(p);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (!st.isFile() || reviewedScript(p)) continue;
      let text = null;
      try {
        const buf = readFileSync(p);
        if (buf.subarray(0, 4096).includes(0)) continue; // a binary, not a script
        if (st.size <= READ_CAP) text = buf.toString('utf8');
      } catch {
        /* unreadable */
      }
      if (text === null) {
        out.push(...pathWords(seg));
        continue;
      }
      const body = text.replace(REL_IMPORT, '');
      if (SCRIPT_WRITE.test(body) || WRITE_CMD.test(body)) out.push(...pathWords(body));
    }
  }
  return out;
}

function analyzeBash(command, cwd) {
  const cmd = String(command || '');
  const { head, docs } = splitHeredocs(cmd);
  const segs = simpleCommands(head);
  const dirs = segDirs(segs, head, cwd);
  const allBases = bases(head, cwd);
  const dirsOf = (i) => (dirs ? [dirs[i]] : allBases);
  const found = []; // { w, ds }
  segs.forEach((g, i) => {
    for (const t of redirectTargets(g)) found.push({ w: t, ds: dirsOf(i) });
    for (const m of g.matchAll(GIT_OUTPUT)) found.push({ w: m[2] ?? m[3] ?? m[1], ds: dirsOf(i) });
  });
  const items = [];
  segs.forEach((g, i) => { if (segmentWrites(g)) items.push({ text: g, ds: dirsOf(i) }); });
  const texts = items.map((it) => it.text);
  const more = []; // whole-command texts: any base
  // A path can reach a writing segment from outside its argv: an expansion, an input redirect or
  // heredoc, a list-file flag or --stdin, xargs/parallel (F=P; rm "$F", xargs rm < list): then every word of
  // the command, heredoc bodies included, may be the target.
  // An expansion alone draws only from the segments and heredoc bodies that can set it: a
  // read-only segment's paths (grep x a/SKILL.md; rm "$T") are not the target.
  if (texts.some((t) => /[<]|--pathspec-from-file|--stdin\b|\b(xargs|parallel)\b/.test(t))) more.push(cmd);
  else if (texts.some((t) => /[$`]/.test(t))) {
    more.push(...segs.filter((g) => /^(\w+=|(for|export|declare|local|readonly|read)\b)|</.test(g)), ...docs.map((d) => d.body));
  }
  if (docs.some(heredocWrites)) more.push(cmd);
  // A data heredoc plus a later shell/interpreter run: the file's name cannot be matched (cd, glob,
  // relative spelling), so the whole command, heredoc bodies included, may name the target. The
  // heredoc's own consumer (python3 - <<EOF) is judged by heredocWrites, not here.
  if (docs.some((d) => !simpleCommands(d.line).some(executes)) && segs.some(executes)) more.push(cmd);
  for (const it of items) for (const w of pathWords(it.text)) found.push({ w, ds: it.ds });
  for (const text of more) for (const w of pathWords(text)) found.push({ w, ds: allBases });
  const home = (w) => w.replace(/^~(?=\/)/, process.env.HOME || '~');
  const direct = new Set();
  for (const { w, ds } of found) for (const d of ds) direct.add(resolve(d, home(w)));
  // A command that runs a file is judged by what the file does.
  const script = new Set();
  segs.forEach((g, i) => {
    if (!executes(g) || readOnly(g) || isHarnessRemove(g, dirsOf(i))) return;
    for (const w of scriptWords(g, dirsOf(i))) for (const d of dirsOf(i)) script.add(resolve(d, home(w)));
  });
  return { direct, script };
}

// ROUTE-BEGIN (byte-identical in harness/hooks/goal-gate.mjs and teams/hooks/dispatch-gate.mjs; _repo/scripts/check-copies.mjs)
// The routing paragraph when teams and harness or graph are both installed in dir, else ''.
// Any error gives '': the caller keeps its own message.
function routeText(dir) {
  try {
    const json = (f) => {
      try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
    };
    const has = (f) => json(join(dir, f)) !== null;
    const harness = has('.claude/harness-gate.json');
    const teams = has('.claude/teams-dispatch.json');
    const on = (f) => json(f)?.enabledPlugins?.['graph@newkayak12-claude-skills'] === true;
    const graph = Boolean(json(join(dir, '.mcp.json'))?.mcpServers?.['graph-engineering']) ||
      on(join(dir, '.claude', 'settings.json')) || on(join(process.env.HOME || '~', '.claude', 'settings.json'));
    if (!teams || !(harness || graph)) return '';
    const simple = graph ? 'graph:orchestrate' : 'harness:harness';
    return `This project also dispatches through ${['teams', harness && 'harness', graph && 'graph'].filter(Boolean).join(' + ')}; route by the kind of work.\n` +
      `  - Simple development (a code change with its tests, one area) -> Skill({skill: "${simple}"})\n` +
      `  - A spec document, planning, QA, several areas, or unsure -> Skill({skill: "teams:orchestrate", args: "<the user's request>"})\n`;
  } catch {
    return '';
  }
}
// ROUTE-END

// NODE-BEGIN (byte-identical in harness/hooks/goal-gate.mjs, teams/hooks/dispatch-gate.mjs and graph/hooks/node-gate.mjs; _repo/scripts/check-copies.mjs)
// A run node (a subagent: hook input has agent_id; a graph/teams worker process: HARNESS_NODE=1)
// must never open a run again. These are the skills that open one.
const ENTRY_SKILL_RE = /^(?:(?:harness:)?harness|graph:orchestrate|teams:(?:orchestrate|develop|sprint|document|plan|qa))$/;
const ENTRY_MCP_RE = /(?:^|__)(graph_open|tm_open|tm_run)$/;
const entryCall = (input) => {
  const tool = String(input?.tool_name || '');
  const skill = tool === 'Skill' ? input?.tool_input?.skill : null;
  if (typeof skill === 'string' && ENTRY_SKILL_RE.test(skill)) return `Skill ${skill}`;
  return ENTRY_MCP_RE.test(tool) ? tool : '';
};
const SUBAGENT_NOTE = 'A subagent that sees this must not invoke the harness again — stop and report to its caller.';
const SUBAGENT_STOP = 'You are inside a run. Do not invoke the harness skill, graph, teams, Workflow or open a run. ' +
  'Stop and report this block (file + reason) to your caller.';
// 'node' (HARNESS_NODE=1), 'agent' (agent_id), or '' (a main session)
const nodeKind = (input) => (process.env.HARNESS_NODE === '1' ? 'node' : input && typeof input.agent_id === 'string' && input.agent_id !== '' ? 'agent' : '');
// NODE-END

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
  process.exit(0);
}

// harness:install copies this file to <project>/.claude/hooks/. That copy goes stale; when the
// harness plugin is enabled its own hook (same file, from the plugin dir) judges, so the copy
// steps aside. The role is read from the file's own path, not the env: the plugin cache never
// sits under .claude/hooks, and no env var can flip it. Only the one enabledPlugins key is read.
function deferToPlugin() {
  try {
    const self = decodeURIComponent(new URL(import.meta.url).pathname);
    if (!/\/\.claude\/hooks\/goal-gate\.mjs$/.test(self)) return false;
    const projectDir = dirname(dirname(dirname(self)));
    const on = (f) => {
      try {
        return JSON.parse(readFileSync(f, 'utf8'))?.enabledPlugins?.['harness@newkayak12-claude-skills'] === true;
      } catch {
        return false;
      }
    };
    return on(join(projectDir, '.claude', 'settings.json')) || on(join(projectDir, '.claude', 'settings.local.json')) ||
      on(join(process.env.HOME || '~', '.claude', 'settings.json'));
  } catch {
    return false;
  }
}

function main() {
  if (deferToPlugin()) process.exit(0);
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
  const kind = nodeKind(input);
  const sub = kind !== '';

  // A node or subagent opening a run is the recursion: stop and report, never nest a run.
  // A node process is unambiguous; a subagent only counts where a gate is configured.
  const entry = entryCall(input);
  if (entry) {
    if (!sub) process.exit(0);
    if (kind === 'agent' && !findRoot(join(cwd, '_'))) process.exit(0); // no gate configured here
    deny(`${entry}: ${SUBAGENT_STOP}`);
  }
  if (tool === 'Skill') process.exit(0); // any other skill writes nothing and refreshes nothing

  // What this call would write.
  let targets = [];
  let viaScript = new Set();
  if (EDIT_TOOLS.has(tool)) {
    const fp = (input.tool_input && (input.tool_input.file_path || input.tool_input.notebook_path)) || '';
    if (fp) targets = [resolve(cwd, String(fp))];
  } else if (tool === 'apply_patch') {
    targets = patchTargets(input.tool_input && input.tool_input.command, cwd);
  } else if (tool === 'Bash') {
    const a = analyzeBash(input.tool_input && input.tool_input.command, cwd);
    viaScript = new Set([...a.script].filter((t) => !a.direct.has(t)));
    targets = [...new Set([...a.direct, ...a.script])];
  }

  // Each target's root and root-relative path. Only a target inside a configured root is gated.
  const judged = [];
  for (const t of targets) {
    const f = findRoot(t);
    if (!f) continue;
    const root = typeof f === 'string' ? f : f.root;
    const base = typeof f === 'string' ? f : (gitTop(f.worktree) || f.root);
    judged.push({ root, rel: gatedRel(base, t) ?? gatedRel(base, real(t)), script: viaScript.has(t) });
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
  const record = (decision, reason) => recordDecision(root, { ts: now, session_id: sid, tool, target: gated[0], decision, reason });
  if (!gated.length) process.exit(0);
  if (engaged) {
    record('allow', 'harness engaged');
    process.exit(0);
  }
  if (anyRecentMarker(markerDir, now, cfg.windowMs)) {
    record('allow', 'engagement marker');
    process.exit(0);
  }

  if (sub) {
    const why = `${gated.slice(0, 3).join(', ')}: goal gate blocked this edit. ${SUBAGENT_STOP}`;
    record('deny', why);
    deny(why);
  }
  const routed = routeText(root);
  const bypass = judged.some((j) => j.script && isGated(j.rel, cfg.patterns));
  const reason = bypass
    ? `${gated.slice(0, 3).join(', ')}: goal gate: running a script that touches a gated file is the same write — ` +
      'open/finish the harness run instead of working around the gate.'
    : routed
      ? `${gated.slice(0, 3).join(', ')} is gated by the harness (.claude/harness-gate.json) and by teams (.claude/teams-dispatch.json). ${routed}` +
        'Either route opens a run that unlocks both gates; a mention in text does not.'
      : `${gated.slice(0, 3).join(', ')} is gated by the harness (.claude/harness-gate.json). ` +
    'Engage the harness before editing it: invoke the harness skill and follow its Process - ' +
    'the graph MCP, the Workflow engine, or an Agent Team fallback run whose plan, goal-spec and ' +
    'sound critique are on disk. A mention in text does not engage it.';
  const full = `${reason} ${SUBAGENT_NOTE}`;
  record('deny', full);
  deny(full);
}

// The last gated decision, for the mod's status line. Outside .harness-markers (anyRecentMarker
// reads every file there as a timestamp). Best-effort: never throws, never changes the verdict.
function recordDecision(root, d) {
  try {
    writeFileSync(join(root, '.claude', '.harness-last-decision.json'), JSON.stringify(d));
  } catch {
    /* best-effort */
  }
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
