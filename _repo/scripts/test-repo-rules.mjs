#!/usr/bin/env node
// Feeds JSON stdin cases to .claude/hooks/repo-rules.mjs and checks its output.
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const hook = join(dirname(fileURLToPath(import.meta.url)), '../../.claude/hooks/repo-rules.mjs')
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'ignore' })

// a repo with an origin one commit ahead of the clone, to exercise start and commit
const root = mkdtempSync(join(tmpdir(), 'repo-rules-'))
const origin = join(root, 'origin')
const clone = join(root, 'clone')
mkdirSync(origin)
sh(origin, 'init', '-q', '-b', 'main')
sh(origin, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'one')
sh(root, 'clone', '-q', origin, clone)
sh(origin, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'two')

const run = (mode, input, env = {}) => {
  const r = spawnSync('node', [hook, mode], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CODE_SESSION_ATTENDED: '', ...env },
  })
  return { code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : {} }
}
const bash = (command, cwd, env) => run('bash', { tool_name: 'Bash', tool_input: { command }, cwd }, env)
const ATT = { CLAUDE_CODE_SESSION_ATTENDED: '1' }
const decision = r => r.out.hookSpecificOutput?.permissionDecision

let failed = 0
const check = (name, ok) => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
}

check('start: origin ahead -> systemMessage', /1 commit\(s\) ahead/.test(run('start', { cwd: clone }).out.systemMessage ?? ''))
sh(clone, 'pull', '-q')
check('start: up to date -> silent', Object.keys(run('start', { cwd: clone }).out).length === 0)
check('start: not a repo -> fail open', run('start', { cwd: root }).code === 0)

check('git push attended -> ask', decision(bash('git push origin main', clone, ATT)) === 'ask')
check('git push unattended -> pass', decision(bash('git push origin main', clone)) === undefined)
check('patch-harness attended -> ask', decision(bash('node _repo/scripts/patch-harness.mjs x', clone, ATT)) === 'ask')
check('teams patch attended -> ask', decision(bash("node teams/skills/patch/patch.mjs '{}'", clone, ATT)) === 'ask')
check('git status attended -> pass', decision(bash('git status', clone, ATT)) === undefined)
check('non-Bash tool -> pass', Object.keys(run('bash', { tool_name: 'Write', tool_input: { command: 'git push' } }, ATT).out).length === 0)

mkdirSync(join(clone, 'p'))
writeFileSync(join(clone, 'p/README.md'), 'x')
sh(clone, 'add', 'p/README.md')
check('commit: README without KOR -> systemMessage', /README without KOR: p\/README.md/.test(bash('git commit -m x', clone).out.systemMessage ?? ''))
writeFileSync(join(clone, 'p/KOR.md'), 'x')
sh(clone, 'add', 'p/KOR.md')
check('commit: README with KOR -> silent', Object.keys(bash('git commit -m x', clone).out).length === 0)
check('non-commit with lonely README -> silent', Object.keys(bash('ls', clone).out).length === 0)

// harness runs: push/bump refused while a run is open or reports an unwaived missing criterion
const runDir = join(clone, '.harness-run/r1')
mkdirSync(runDir, { recursive: true })
mkdirSync(join(clone, '.harness-run/broker'))
writeFileSync(join(runDir, 'manifest.json'), '{}')
const denied = r => decision(r) === 'deny' && /r1/.test(r.out.hookSpecificOutput.permissionDecisionReason)
check('open run: push unattended -> deny', denied(bash('git push origin main', clone)))
check('open run: push attended -> deny', denied(bash('git push origin main', clone, ATT)))
check('open run: teams patch -> deny', denied(bash("node teams/skills/patch/patch.mjs '{}'", clone)))
check('open run: git status -> pass', decision(bash('git status', clone)) === undefined)
const prepush = () => spawnSync('node', [hook, 'prepush'], { cwd: clone, encoding: 'utf8' })
const held = prepush()
check('prepush: open run -> exit 1 naming the slug', held.status === 1 && /r1/.test(held.stderr))
writeFileSync(join(runDir, '05-report.md'), '| AC-1 | missing | no run |\n')
check('report with missing -> deny', denied(bash('git push origin main', clone)))
check('prepush: missing -> exit 1', prepush().status === 1)
writeFileSync(join(runDir, '05-report.md'), '| AC-1 | missing | no run |\nwaived: "ship it" (user)\n')
check('missing + waived -> today\'s behaviour', decision(bash('git push origin main', clone)) === undefined && decision(bash('git push origin main', clone, ATT)) === 'ask')
check('prepush: waived -> exit 0', prepush().status === 0)
writeFileSync(join(runDir, '05-report.md'), '| AC-1 | met | ok |\n')
check('clean report -> today\'s behaviour', decision(bash('git push origin main', clone)) === undefined)
writeFileSync(join(runDir, '05-report.md'), '| AC-3 | met | `| missing |` row → deny |\n')
check('"missing" quoted in evidence -> not held', decision(bash('git push origin main', clone)) === undefined)

check('garbage stdin -> fail open', run('bash', 'not json').code === 0 && Object.keys(run('bash', 'not json').out).length === 0)
check('bad cwd -> fail open', run('bash', { tool_name: 'Bash', tool_input: { command: 'git commit' }, cwd: '/nonexistent' }).code === 0)

process.exit(failed ? 1 : 0)
