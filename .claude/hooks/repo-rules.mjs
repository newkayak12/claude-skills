#!/usr/bin/env node
// claude-skills repo rules as command hooks (moved here from the retired mods plugin).
// Usage: repo-rules.mjs <start|bash>; hook JSON on stdin. `prepush` (git hook) takes no JSON. Fails open on every error: no output, exit 0.
//   start: git fetch; a systemMessage when origin/main is ahead of HEAD.
//   bash:  `git push` and the version-bump scripts are denied while a teams task for this checkout
//          is open; otherwise they ask first, only in an attended session
//          (CLAUDE_CODE_SESSION_ATTENDED=1); `git commit` with a staged README.md and no staged
//          KOR.md beside it gets a systemMessage.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'

const git = (cwd, args, timeout = 10000) =>
  execFileSync('git', args, { cwd, timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

const ASK = /\bgit\s+push\b|patch-harness\.mjs|skills\/patch\/patch\.mjs/
const COMMIT = /\bgit\s+commit\b/

// Ids of teams tasks for this checkout that are still open. Logic vendored from taskOpenFor in
// teams/hooks/dispatch-gate.mjs: a task dir under $HARNESS_TASKS_DIR (else $HOME/.harness/tasks)
// whose task.json cwd is this checkout, and whose last ledger event among
// tm_open|tm_retry|daemon_spawned|daemon_done is not daemon_done (no ledger = open).
const samePath = p => { try { return realpathSync(p) } catch { return resolve(p) } }
function openTasks(root, env = process.env) {
  const tasksRoot = env.HARNESS_TASKS_DIR ? resolve(env.HARNESS_TASKS_DIR) : join(env.HOME || '', '.harness', 'tasks')
  let ids = []
  try { ids = readdirSync(tasksRoot) } catch { return [] }
  const here = samePath(root)
  const open = []
  for (const id of ids) {
    let task
    try { task = JSON.parse(readFileSync(join(tasksRoot, id, 'task.json'), 'utf8')) } catch { continue }
    if (!task || samePath(String(task.cwd || '')) !== here) continue
    let ledger = ''
    try { ledger = readFileSync(join(tasksRoot, id, 'ledger.jsonl'), 'utf8') } catch { /* no ledger yet: just opened */ }
    const last = ledger.trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
      .filter(e => ['tm_open', 'tm_retry', 'daemon_spawned', 'daemon_done'].includes(e.event)).pop()
    if (!last || last.event !== 'daemon_done') open.push(id)
  }
  return open
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
      const held = openTasks(run(cwd, ['rev-parse', '--show-toplevel']).trim(), env)
      if (held.length) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `Teams task still open for this checkout: ${held.join(', ')}. Let it finish or tm_clean it first.`,
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
    process.stderr.write(`push refused — teams task still open for this checkout: ${held.join(', ')}. Let it finish or tm_clean it first.\n`)
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
