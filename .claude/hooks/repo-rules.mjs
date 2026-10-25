#!/usr/bin/env node
// claude-skills repo rules as command hooks (moved here from the retired mods plugin).
// Usage: repo-rules.mjs <start|bash>; hook JSON on stdin. `prepush` (git hook) takes no JSON. Fails open on every error: no output, exit 0.
//   start: git fetch; a systemMessage when origin/main is ahead of HEAD.
//   bash:  `git push` and the version-bump scripts are denied while a teams task for this repo
//          (main checkout or any linked worktree) holds the push, i.e. its daemon is not done, or
//          is done without a report, and tm_clean has not run; otherwise they ask first, only in an attended session
//          (CLAUDE_CODE_SESSION_ATTENDED=1); the repo checked is the one the push targets (a leading
//          `cd <path> &&|;` and `git -C <path>` resolved from cwd, else cwd); `git commit` with a staged README.md and no staged
//          KOR.md beside it gets a systemMessage.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'

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

// The directory a command works in: a leading `cd <path> &&|;` moves the base from cwd, then each
// `git [-c k=v] -C <path> ... push` moves it again (relative to the previous). Paths in quotes or bare.
const unquote = s => s.replace(/^(["'])(.*)\1$/, '$2')
function targetDir(cmd, cwd) {
  let dir = cwd
  const cd = cmd.match(new RegExp(String.raw`^\s*cd\s+(${ARG})\s*(?:&&|;)`))
  if (cd) dir = resolve(dir, unquote(cd[1]))
  const g = cmd.match(new RegExp(GIT_PUSH))
  if (g) for (const c of g[1].matchAll(new RegExp(String.raw`-C\s+(${ARG})`, 'g'))) dir = resolve(dir, unquote(c[1]))
  return dir
}

// Top level of the repo a command targets. When that directory is not a git checkout (or git fails
// there) it falls back to cwd's top level: the old behaviour, so the hold fails closed. A failure
// on cwd itself throws and the caller fails open.
function targetRoot(cmd, cwd, run) {
  try { return run(targetDir(cmd, cwd), ['rev-parse', '--show-toplevel']).trim() || run(cwd, ['rev-parse', '--show-toplevel']).trim() } catch { /* fall back */ }
  return run(cwd, ['rev-parse', '--show-toplevel']).trim()
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
      const held = openTasks(targetRoot(cmd, cwd, run), env, run)
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
    if (ASK.test(cmd) && env.CLAUDE_CODE_SESSION_ATTENDED === '1') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: `Run \`${cmd.slice(0, 120)}\`? (push / version bump)`,
        },
      }
    }
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
