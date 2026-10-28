#!/usr/bin/env node
// claude-skills repo rules as command hooks (moved here from the retired mods plugin).
// Usage: repo-rules.mjs <start|bash>; hook JSON on stdin. `prepush` (git hook) takes no JSON. Fails open on every error: no output, exit 0.
//   start: git fetch; a systemMessage when origin/main is ahead of HEAD.
//   bash:  `git push` and the version-bump scripts are denied while a teams task for this repo
//          (main checkout or any linked worktree) holds the push, i.e. its daemon is not done, or
//          is done without a report, and tm_clean has not run; otherwise they run without a confirm
//          (CLAUDE_CODE_SESSION_ATTENDED=1); the repo checked is the one the push targets (every
//          `cd <path>` segment before the push, joined by `&&`, `||`, `;` or `|`, applied in order from cwd,
//          then `git -C <path>` relative to that; `~` and `~/x` expanded with $HOME, else cwd); `git commit` with a staged README.md and no staged
//          KOR.md beside it gets a systemMessage. An unquoted `$NAME` argument to `rm` and an in-place write
//          to a repo file (sed -i, redirect, inline code) are denied; see bashDeny.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

const git = (cwd, args, timeout = 10000) =>
  execFileSync('git', args, { cwd, timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

const ARG = String.raw`(?:"[^"]*"|'[^']*'|[^\s;&|]+)`
const GIT_PUSH = String.raw`\bgit((?:\s+(?:-C|-c)\s+${ARG})*)\s+push\b`
const ASK = new RegExp(`${GIT_PUSH}|patch-harness\\.mjs|skills/patch/patch\\.mjs`)
const COMMIT = /\bgit\s+commit\b/

// Ids of teams tasks for this repo that still hold a push. Tasks are the dirs under
// $HARNESS_TASKS_DIR (else $HOME/.harness/tasks). Not vendored: the gate in
// teams/hooks/dispatch-gate.mjs (taskOpenFor) asks only "is a daemon running"; a push hold also
// waits for the report, so the release rule lives here.
//   Released when (a) the ledger's last event among tm_open|tm_retry|daemon_spawned|daemon_done|clean
//   is daemon_done AND <task.cwd>/<docs_dir>/E-<run_id[0:8]>/80-report.md exists, whatever the
//   outcome; or (b) that last event is clean (tm_clean). A report without daemon_done stays held
//   (a crashed daemon), and so does a failed task without its report. No ledger = just opened = held.
const samePath = p => { try { return realpathSync(p) } catch { return resolve(p) } }
const DOCS_DIR = '.teams_output/team' // TEAM_DEFAULTS.docs_dir; task.team.opts.docs_dir overrides (teams/mcp/tickets.mjs docPaths)

function holdsPush(task, id, dir) {
  let ledger = ''
  try { ledger = readFileSync(join(dir, 'ledger.jsonl'), 'utf8') } catch { /* no ledger yet: just opened */ }
  const last = ledger.trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    .filter(e => ['tm_open', 'tm_retry', 'daemon_spawned', 'daemon_done', 'clean'].includes(e.event)).pop()
  if (last?.event === 'clean') return false
  if (last?.event !== 'daemon_done') return true
  const docs = task.team?.opts?.docs_dir || DOCS_DIR
  return !existsSync(join(String(task.cwd), docs, `E-${String(task.run_id || id).slice(0, 8)}`, '80-report.md'))
}

// The shared git dir of a checkout: one value for the main checkout and every linked worktree of
// a repo. null when cwd is not a git checkout (a deleted worktree, a path that is gone).
function commonDir(cwd, run = git) {
  try {
    const out = run(cwd, ['rev-parse', '--git-common-dir']).trim()
    return out ? samePath(resolve(cwd, out)) : null
  } catch { return null }
}

// Same repo as the push: equal git common dirs; when the task's cwd no longer resolves to a repo,
// the realpath of its cwd against the push's top level.
function sameRepo(taskCwd, root, rootCommon, run) {
  if (!taskCwd) return false
  const taskCommon = rootCommon ? commonDir(taskCwd, run) : null
  return taskCommon ? taskCommon === rootCommon : samePath(taskCwd) === samePath(root)
}

function openTasks(root, env = process.env, run = git) {
  const tasksRoot = env.HARNESS_TASKS_DIR ? resolve(env.HARNESS_TASKS_DIR) : join(env.HOME || '', '.harness', 'tasks')
  let ids = []
  try { ids = readdirSync(tasksRoot) } catch { return [] }
  const rootCommon = commonDir(root, run)
  const open = []
  for (const id of ids) {
    let task
    try { task = JSON.parse(readFileSync(join(tasksRoot, id, 'task.json'), 'utf8')) } catch { continue }
    // released tasks first: it is a file read, the repo compare below spawns git
    if (!task || !holdsPush(task, id, join(tasksRoot, id)) || !sameRepo(String(task.cwd || ''), root, rootCommon, run)) continue
    open.push(id)
  }
  return open
}

// The directory a command works in: the command is split at `&&`, `||`, `;`, `|`, newline (outside quotes);
// each `cd <path>` segment before the push moves the base from cwd, in order, then each
// `git [-c k=v] -C <path> ... push` moves it again (relative to the previous). Paths in quotes or
// bare; a leading `~` or `~/x` is expanded with env.HOME.
const unquote = s => s.replace(/^(["'])(.*)\1$/, '$2')
const tilde = (s, env) => env.HOME && (s === '~' || s.startsWith('~/')) ? join(env.HOME, s.slice(1)) : s
// split() returns { text, op } per segment, op being the separator after it ('' for the last).
// The `|` of `>|` (clobber redirect) is not a separator.
function split(cmd) {
  const out = []
  let cur = '', q = ''
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (q) { if (c === q) q = ''; cur += c; continue }
    if (c === '"' || c === "'") { q = c; cur += c; continue }
    if (c === '|' && cur.endsWith('>')) { cur += c; continue }
    if (c === ';' || c === '&' || c === '|') {
      let op = c
      if (cmd[i + 1] === c && c !== ';') { op += c; i++ }
      out.push({ text: cur, op }); cur = ''
      continue
    }
    if (c === '\n') { out.push({ text: cur, op: '\n' }); cur = ''; continue }
    cur += c
  }
  out.push({ text: cur, op: '' })
  return out
}
const segments = cmd => split(cmd).map(s => s.text)
function targetDir(cmd, cwd, env = process.env) {
  let dir = cwd
  for (const seg of segments(cmd)) {
    const g = seg.match(new RegExp(GIT_PUSH))
    if (g) {
      for (const c of g[1].matchAll(new RegExp(String.raw`-C\s+(${ARG})`, 'g'))) dir = resolve(dir, tilde(unquote(c[1]), env))
      break
    }
    const cd = seg.match(new RegExp(String.raw`^\s*cd\s+(${ARG})\s*$`))
    if (cd) dir = resolve(dir, tilde(unquote(cd[1]), env))
  }
  return dir
}

// Top level of the repo a command targets. When that directory is not a git checkout (or git fails
// there) it falls back to cwd's top level: the old behaviour, so the hold fails closed. A failure
// on cwd itself throws and the caller fails open.
function targetRoot(cmd, cwd, run, env) {
  try { return run(targetDir(cmd, cwd, env), ['rev-parse', '--show-toplevel']).trim() || run(cwd, ['rev-parse', '--show-toplevel']).trim() } catch { /* fall back */ }
  return run(cwd, ['rev-parse', '--show-toplevel']).trim()
}

// Two denies on a simple command, parsed with segments(); anything not parsed is allowed. Claude Code only.
//   rm:    an unquoted `$NAME` / `${NAME}` without `:?` as an argument of a command whose first word is rm.
//   write: sed/perl in place, tee, a `>` / `>>` target, or inline node/python code (-e/-c or a heredoc)
//          with a write call, naming a repo path: inside the git top level of the target path itself (resolved against the cd-applied dir),
//          not under tmp/, not gitignored. `git` commands, /dev/*, and targets with `$` or backticks pass.
//   A heredoc body is data (cat, tee, git) unless it feeds a shell (scanned as a command) or an interpreter.
const SHELLS = /^(?:ba|z|da|k)?sh$/
const INTERP = /^(?:node(?:js)?|python[\d.]*)$/
const UNQUOTED_VAR = /\$(?:\{([A-Za-z_]\w*)(?![^}]*:\?)[^}]*\}|([A-Za-z_]\w*))/
const IN_PLACE = /^(?:-[nEeprlsazw0-9]*i|--in-place)/
const CODE_FLAG = /^(?:-[a-z]*[ecp]|--eval|--print)$/
const LITERAL = String.raw`\(\s*(['"` + '`' + String.raw`])([^'"` + '`' + String.raw`]+)\1`
const WRITE_CALLS = [
  new RegExp(String.raw`\b(?:writeFile|appendFile|createWriteStream|truncate|unlink|rm|rmdir|mkdir|rename)(?:Sync)?${LITERAL}`, 'g'),
  new RegExp(String.raw`\bcopyFile(?:Sync)?\([^,()]+,\s*(['"` + '`' + String.raw`])([^'"` + '`' + String.raw`]+)\1`, 'g'),
  /\bopen\(\s*(['"])([^'"]+)\1\s*,\s*(?:mode\s*=\s*)?['"][rbt]*[wax+]/g,
  /\bPath\(\s*(['"])([^'"]+)\1\s*\)\s*\.\s*(?:write_text|write_bytes|unlink|touch)\b/g,
  /\bos\.(?:remove|unlink|rename|replace|makedirs|mkdir|rmdir)\(\s*(['"])([^'"]+)\1/g,
  /\bshutil\.(?:rmtree|move)\(\s*(['"])([^'"]+)\1/g,
]

// Words of one segment, quotes removed: `text` is the value, `bare` only its unquoted part.
// `>` / `<` outside quotes are { op } tokens.
function words(seg) {
  const out = []
  let text = '', bare = '', q = '', has = false
  const flush = () => { if (has) out.push({ text, bare }); text = bare = ''; has = false }
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]
    if (q) { if (c === q) q = ''; else text += c; continue }
    if (c === '"' || c === "'") { q = c; has = true; continue }
    if (c === '\\' && i + 1 < seg.length) { text += seg[++i]; has = true; continue }
    if (/\s/.test(c)) { flush(); continue }
    if (c === '>' || c === '<') {
      flush()
      let op = c
      while (seg[i + 1] === c || (c === '>' && seg[i + 1] === '|')) op += seg[++i]
      out.push({ op })
      continue
    }
    text += c; bare += c; has = true
  }
  flush()
  return out
}

// Wrapper words that run the next command, with the options that take a value; `command -v/-V` only looks up.
const WRAPPERS = { sudo: /^-[ughpCDRTU]$/, env: /^-[uCS]$/, exec: /^-a$/, time: /^-[fo]$/, command: null, nohup: null }
// Drops leading `VAR=` words, shell keywords (`do rm`, `then sed -i`), a `(` / `{` group opener and wrapper
// words with their own options, so args[0] is the wrapped command.
const KEYWORDS = /^(?:if|then|else|elif|do|while|until|!)$/
function unwrap(args) {
  for (;;) {
    while (args.length && (/^\w+=/.test(args[0].text) || KEYWORDS.test(args[0].text) || /^[({]+$/.test(args[0].text))) args.shift()
    if (args.length && /^[({]+./.test(args[0].text)) args[0] = { ...args[0], text: args[0].text.replace(/^[({]+/, '') }
    const w = args.length ? basename(args[0].text) : ''
    if (!Object.hasOwn(WRAPPERS, w) || (w === 'command' && args.some(a => /^-[a-z]*[vV]/.test(a.text)))) return
    args.shift()
    while (args.length && args[0].text.startsWith('-')) args.splice(0, WRAPPERS[w]?.test(args[0].text) ? 2 : 1)
  }
}

// A segment's argument words and its `>` / `>>` target words (a heredoc delimiter or `<` target is neither).
function parse(seg) {
  const toks = words(seg), args = [], writes = []
  for (let i = 0; i < toks.length; i++) {
    if (!toks[i].op) { args.push(toks[i]); continue }
    const t = toks[++i]
    if (t && !t.op && toks[i - 1].op.startsWith('>')) writes.push(t)
  }
  return { args, writes }
}

// The command without its heredoc bodies, and each body with the line whose command reads it.
function heredocs(cmd) {
  const lines = cmd.split('\n'), head = [], docs = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    head.push(line)
    for (const m of line.matchAll(/(?<!<)<<(?!<)(-?)\s*(['"]?)([\w.-]+)\2/g)) {
      const body = []
      for (i++; i < lines.length; i++) {
        if ((m[1] ? lines[i].trim() : lines[i]) === m[3]) break
        body.push(lines[i])
      }
      docs.push({ line, body: body.join('\n') })
    }
  }
  return { head: head.join('\n'), docs }
}

const codePaths = code => WRITE_CALLS.flatMap(re => [...code.matchAll(re)].map(m => m[2]))

// The reason names the fix with the variable's own name, e.g. "${S:?}" for $S.
function rmDeny(name, rest) {
  if (name !== 'rm') return null
  for (const a of rest) {
    const v = UNQUOTED_VAR.exec(a.bare)
    if (v) return `rm with an unquoted $${v[1] ?? v[2]}: empty or split, it deletes the wrong files. Quote and guard it: "\${${v[1] ?? v[2]}:?}".`
  }
  return null
}

// Files an in-place sed/perl edits: its non-option words, minus the script when no -e/-f gives it.
function inPlaceFiles(rest) {
  const files = []
  let script = false
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i].text
    if (/^-[a-zA-Z]*[ef]$/.test(t) || /^--(?:expression|file)$/.test(t)) { script = true; i++ }
    else if (/^--(?:expression|file)=/.test(t)) script = true
    else if (!t.startsWith('-')) files.push(t)
  }
  if (!script) files.shift()
  return files
}

function writeTargets(name, rest, writes) {
  const out = writes.map(w => w.text)
  if (name === 'tee') out.push(...rest.filter(a => !a.text.startsWith('-')).map(a => a.text))
  else if ((name === 'sed' || name === 'perl') && rest.some(a => IN_PLACE.test(a.text))) out.push(...inPlaceFiles(rest))
  else if (INTERP.test(name)) rest.forEach((a, i) => { if (CODE_FLAG.test(a.text) && rest[i + 1]) out.push(...codePaths(rest[i + 1].text)) })
  return out
}

function bashDeny(cmd, cwd, env, run) {
  const tops = new Map()
  const top = dir => {
    if (!tops.has(dir)) {
      let d = dir
      while (!existsSync(d) && dirname(d) !== d) d = dirname(d)
      try { tops.set(dir, run(d, ['rev-parse', '--show-toplevel']).trim() || null) } catch { tops.set(dir, null) }
    }
    return tops.get(dir)
  }
  const repoPath = (p, dir) => {
    if (/[$`]/.test(p) || p.startsWith('/dev/')) return false
    const abs = resolve(dir, tilde(p, env))
    const t = top(dirname(abs))
    if (!t) return false
    const rel = relative(t, join(samePath(dirname(abs)), basename(abs)))
    if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel) || rel === 'tmp' || rel.startsWith('tmp/')) return false
    try { run(t, ['check-ignore', '-q', '--', rel]); return false } catch (e) { return e?.status === 1 }
  }
  const writeDeny = (p, name) => `Bash ${name} writes ${p}, a repo file, in place. Use Read/Edit/Write for repo files; Bash is for git, checks and tests.`
  // cd state { dir, prev, stack }: bare cd goes to $HOME, `cd -` to prev, pushd pushes the old dir
  // and cds, popd pops, options (-P, -L) are dropped. A cd next to `||`, `|` or `&` may not run and
  // is discarded. `(cd x)` restores the outer state at its closing `)`.
  const CD_SKIP = new Set(['||', '|', '&'])
  const scan = (text, st) => {
    const { head, docs } = heredocs(text)
    const subs = []
    let prevOp = ''
    for (const { text: seg, op } of split(head.replace(/\d*[<>]&(?:\d+|-)/g, ' ').replace(/&>>?/g, '>'))) {
      const before = prevOp
      prevOp = op
      for (let n = seg.match(/^\s*\(*/)[0].replace(/\s/g, '').length; n > 0; n--) subs.push({ dir: st.dir, prev: st.prev, stack: [...st.stack] })
      const closes = subs.length ? (seg.match(/\)+\s*$/)?.[0].replace(/\s/g, '').length ?? 0) : 0
      const restore = () => { for (let n = Math.min(closes, subs.length); n > 0; n--) Object.assign(st, subs.pop()) }
      const { args, writes } = parse(seg)
      unwrap(args)
      const name = args.length ? basename(args[0].text) : ''
      let rest = args.slice(1)
      if (name === 'git') { restore(); continue }
      if (name === 'cd' || name === 'pushd' || name === 'popd') {
        rest = rest.map((a, i) => i === rest.length - 1 && closes ? { ...a, text: a.text.replace(/\)+$/, '') } : a).filter(a => a.text !== '')
        if (!CD_SKIP.has(before) && !CD_SKIP.has(op)) {
          const opts = rest.filter(a => /^-[A-Za-z@]+$/.test(a.text)).length
          const operands = rest.slice(opts)
          if (name === 'popd') {
            if (!operands.length && st.stack.length) { st.prev = st.dir; st.dir = st.stack.pop() }
          } else if (operands.length <= 1 && (operands.length || name === 'cd')) {
            const to = !operands.length ? env.HOME : operands[0].text === '-' ? st.prev : resolve(st.dir, tilde(operands[0].text, env))
            if (to) {
              if (name === 'pushd') st.stack.push(st.dir)
              st.prev = st.dir
              st.dir = resolve(st.dir, to)
            }
          }
        }
        restore()
        continue
      }
      const dir = st.dir
      const hit = rmDeny(name, rest) ?? writeTargets(name, rest, writes).filter(p => repoPath(p, dir)).map(p => writeDeny(p, name || 'redirect'))[0]
      if (hit) return hit
      restore()
    }
    for (const d of docs) {
      const seg = segments(d.line).find(s => s.includes('<<')) ?? ''
      const name = basename(parse(seg).args[0]?.text ?? '')
      if (SHELLS.test(name)) {
        const hit = scan(d.body, { ...st, stack: [...st.stack] })
        if (hit) return hit
      } else if (INTERP.test(name)) {
        const p = codePaths(d.body).find(p => repoPath(p, st.dir))
        if (p) return writeDeny(p, name)
      }
    }
    return null
  }
  const start = samePath(cwd)
  return scan(cmd, { dir: start, prev: start, stack: [] })
}

export function decide(mode, input, env, run = git) {
  const cwd = input.cwd || process.cwd()
  if (mode === 'start') {
    run(cwd, ['fetch', '-q', 'origin'], 10000)
    const n = Number(run(cwd, ['rev-list', '--count', 'origin/main', '^HEAD']).trim())
    return n > 0 ? { systemMessage: `↓ origin/main is ${n} commit(s) ahead — pull before editing` } : {}
  }
  if (mode === 'bash') {
    const cmd = input.tool_input?.command
    if (input.tool_name !== 'Bash' || typeof cmd !== 'string') return {}
    if (ASK.test(cmd)) {
      const held = openTasks(targetRoot(cmd, cwd, run, env), env, run)
      if (held.length) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `Teams task still holds this repo: ${held.join(', ')}. It is released by daemon_done plus its 80-report.md, or by tm_clean.`,
          },
        }
      }
    }
    let reason = null
    try { reason = bashDeny(cmd, cwd, env, run) } catch { /* fail open */ }
    if (reason) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }
    if (COMMIT.test(cmd)) {
      const files = new Set(run(cwd, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean))
      const lonely = [...files].filter(f => f.endsWith('/README.md') && !files.has(f.replace(/README\.md$/, 'KOR.md')))
      if (lonely.length) return { systemMessage: `⚠ README without KOR: ${lonely.join(', ')}` }
    }
  }
  return {}
}

// prepush: run by git's pre-push hook (_repo/hooks/pre-push), so the hold applies to every
// client, not only Claude Code. Exit 1 refuses the push; read errors fail open.
if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === 'prepush') {
  let held = []
  try {
    held = openTasks(git(process.cwd(), ['rev-parse', '--show-toplevel']).trim())
  } catch {
    // fail open
  }
  if (held.length) {
    process.stderr.write(`push refused — teams task still holds this repo: ${held.join(', ')}. It is released by daemon_done plus its 80-report.md, or by tm_clean.\n`)
    process.exit(1)
  }
  process.exit(0)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    let raw = ''
    for await (const c of process.stdin) raw += c
    const out = decide(process.argv[2], raw.trim() ? JSON.parse(raw) : {}, process.env)
    if (Object.keys(out).length) process.stdout.write(JSON.stringify(out))
  } catch {
    // fail open
  }
}
