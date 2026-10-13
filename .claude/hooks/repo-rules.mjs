#!/usr/bin/env node
// claude-skills repo rules as command hooks (moved here from the retired mods plugin).
// Usage: repo-rules.mjs <start|bash>; hook JSON on stdin. Fails open on every error: no output, exit 0.
//   start: git fetch; a systemMessage when origin/main is ahead of HEAD.
//   bash:  `git push` and the version-bump scripts are denied while a harness run is open or
//          reports an unwaived missing criterion; otherwise they ask first, only in an attended session
//          (CLAUDE_CODE_SESSION_ATTENDED=1); `git commit` with a staged README.md and no staged
//          KOR.md beside it gets a systemMessage.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const git = (cwd, args, timeout = 10000) =>
  execFileSync('git', args, { cwd, timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

const ASK = /\bgit\s+push\b|patch-harness\.mjs|skills\/patch\/patch\.mjs/
const COMMIT = /\bgit\s+commit\b/

// .harness-run/<slug>/ with a manifest and no 05-report.md (open), or a 05-report whose table has
// "missing" in a row's verdict (second) cell and no "waived:" line.
function heldRuns(root) {
  const base = join(root, '.harness-run')
  if (!existsSync(base)) return []
  return readdirSync(base).filter(slug => {
    const dir = join(base, slug)
    if (!existsSync(join(dir, 'manifest.json'))) return false
    const report = join(dir, '05-report.md')
    if (!existsSync(report)) return true
    const text = readFileSync(report, 'utf8')
    return /^\|[^|\n]*\|\s*missing\s*\|/im.test(text) && !/^waived:/im.test(text)
  }).map(slug => {
    const report = join(base, slug, '05-report.md')
    return existsSync(report) ? `${slug} (missing criteria)` : `${slug} (no 05-report)`
  })
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
      const held = heldRuns(run(cwd, ['rev-parse', '--show-toplevel']).trim())
      if (held.length) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `Harness run not finished: ${held.join(', ')}. Close it with 05-report.md first; a missing criterion ships only with a "waived: <user's words>" line.`,
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
