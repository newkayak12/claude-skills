#!/usr/bin/env node
// Feeds JSON stdin cases to .claude/hooks/repo-rules.mjs and checks its output.
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
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

// scratch tasks root, set before any spawn so every hook run inherits it (the real ~/.harness/tasks is never read)
const tasks = join(root, 'tasks')
mkdirSync(tasks)
process.env.HARNESS_TASKS_DIR = tasks

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

// teams tasks: push/bump refused while a task for this checkout is open. A task is released by
// daemon_done plus its 80-report.md (whatever the outcome), or by a last `clean` event.
// An event is a name or a full ledger object ({ event: 'daemon_done', state: 'blocked' }).
const task = (id, cwd, events) => {
  mkdirSync(join(tasks, id), { recursive: true })
  writeFileSync(join(tasks, id, 'task.json'), JSON.stringify({ cwd, run_id: id }))
  if (events) writeFileSync(join(tasks, id, 'ledger.jsonl'), events.map(e => JSON.stringify(typeof e === 'string' ? { event: e } : e)).join('\n') + '\n')
}
// the report the daemon renders: <cwd>/.teams_output/team/E-<run_id[0:8]>/80-report.md
const report = (id, cwd) => {
  const dir = join(cwd, '.teams_output', 'team', `E-${id.slice(0, 8)}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '80-report.md'), '# report\n')
}
const drop = id => rmSync(join(tasks, id), { recursive: true, force: true })
const denied = (r, id) => decision(r) === 'deny' && r.out.hookSpecificOutput.permissionDecisionReason.includes(id)
const prepush = () => spawnSync('node', [hook, 'prepush'], { cwd: clone, encoding: 'utf8' })
// cwd written unresolved (macOS /var vs /private/var) to prove realpath matching
const unresolved = clone.replace(/^\/private/, '')
task('t-open', unresolved, ['tm_open'])
check('open task: push unattended -> deny', denied(bash('git push origin main', clone), 't-open'))
check('open task: push attended -> deny', denied(bash('git push origin main', clone, ATT), 't-open'))
check('open task: teams patch -> deny', denied(bash("node teams/skills/patch/patch.mjs '{}'", clone), 't-open'))
check('open task: git status -> pass', decision(bash('git status', clone)) === undefined)
const held = prepush()
check('prepush: open task -> exit 1 naming the id', held.status === 1 && /t-open/.test(held.stderr))
writeFileSync(join(tasks, 't-open/ledger.jsonl'), '{"event":"tm_open"}\n{"event":"daemon_spawned"}\n{"event":"daemon_done"}\n')
check('daemon_done without a report -> deny', denied(bash('git push origin main', clone), 't-open') && prepush().status === 1)
report('t-open', unresolved)
check('daemon_done last -> push unattended pass, attended ask', decision(bash('git push origin main', clone)) === undefined && decision(bash('git push origin main', clone, ATT)) === 'ask')
check('prepush: daemon_done -> exit 0', prepush().status === 0)
writeFileSync(join(tasks, 't-open/ledger.jsonl'), '{"event":"tm_open"}\n{"event":"daemon_done"}\n{"event":"tm_retry"}\n')
check('retry after daemon_done -> deny', denied(bash('git push origin main', clone), 't-open'))
writeFileSync(join(tasks, 't-open/ledger.jsonl'), '{"event":"daemon_done"}\n')
task('t-other', join(root, 'elsewhere'), ['tm_open'])
check('open task with another cwd -> pass', decision(bash('git push origin main', clone)) === undefined)
task('t-nolog', clone)
check('task with no ledger -> deny', denied(bash('git push origin main', clone), 't-nolog'))
writeFileSync(join(tasks, 't-nolog/task.json'), '{not json')
check('corrupt task.json -> fail open', decision(bash('git push origin main', clone)) === undefined)

// release rule: daemon_done + report, whatever the outcome; or a last `clean` event
for (const [id, done] of [['t-blocked', { event: 'daemon_done', state: 'blocked' }], ['t-partial', { event: 'daemon_done', state: 'complete', partial: true }]]) {
  task(id, clone, ['tm_open', 'daemon_spawned', done])
  check(`${id}: failed task without a report -> deny`, denied(bash('git push origin main', clone), id) && prepush().status === 1)
  report(id, clone)
  check(`${id}: same task with 80-report.md -> pass`, decision(bash('git push origin main', clone)) === undefined && prepush().status === 0)
  drop(id)
}
task('t-crash', clone, ['tm_open', 'daemon_spawned'])
report('t-crash', clone)
check('report without daemon_done -> deny', denied(bash('git push origin main', clone), 't-crash') && prepush().status === 1)
drop('t-crash')
task('t-clean', clone, ['tm_open', 'daemon_spawned', 'clean'])
check('last event clean, no report -> pass', decision(bash('git push origin main', clone)) === undefined && prepush().status === 0)
writeFileSync(join(tasks, 't-clean/ledger.jsonl'), '{"event":"clean"}\n{"event":"tm_retry"}\n')
check('retry after clean -> deny', denied(bash('git push origin main', clone), 't-clean'))
drop('t-clean')
task('t-docs', clone, ['tm_open', 'daemon_done'])
writeFileSync(join(tasks, 't-docs/task.json'), JSON.stringify({ cwd: clone, run_id: 't-docs', team: { opts: { docs_dir: 'out/docs' } } }))
report('t-docs', clone)
check('docs_dir from task.team.opts: report under the default path does not release', denied(bash('git push origin main', clone), 't-docs'))
mkdirSync(join(clone, 'out/docs/E-t-docs'), { recursive: true })
writeFileSync(join(clone, 'out/docs/E-t-docs/80-report.md'), '# report\n')
check('docs_dir from task.team.opts: report there releases', decision(bash('git push origin main', clone)) === undefined)
drop('t-docs')

// linked worktrees: tasks and pushes are compared by the shared git dir, not the checkout path
const wtRoot = mkdtempSync(join(tmpdir(), 'repo-rules-wt-'))
const main = join(wtRoot, 'main')
const linked = join(wtRoot, 'linked')
const unrelated = join(wtRoot, 'unrelated')
for (const d of [main, unrelated]) {
  mkdirSync(d)
  sh(d, 'init', '-q', '-b', 'main')
  sh(d, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'one')
}
sh(main, 'worktree', 'add', '-q', linked, '-b', 'side')
const prepushAt = cwd => spawnSync('node', [hook, 'prepush'], { cwd, encoding: 'utf8' })
const heldBy = r => r.status === 1 && /t-wt/.test(r.stderr)
task('t-wt', main, ['tm_open', 'daemon_spawned'])
check('worktree: task in main holds a prepush from the worktree', heldBy(prepushAt(linked)))
check('worktree: task in main holds a bash push from the worktree', denied(bash('git push origin main', linked), 't-wt'))
check('worktree: task in main holds a push from main', heldBy(prepushAt(main)))
task('t-wt', linked, ['tm_open', 'daemon_spawned'])
check('worktree: task in the worktree holds a push from main', heldBy(prepushAt(main)) && denied(bash('git push origin main', main), 't-wt'))
check('worktree: unrelated repo is not held', prepushAt(unrelated).status === 0 && decision(bash('git push origin main', unrelated)) === undefined)
check('worktree: a task in another repo does not hold the clone', prepushAt(clone).status === 0)
// the repo compared is the one the push targets: cwd, `git -C`, or a leading `cd`
// task t-wt is in the linked worktree of `main`; `unrelated` has no task
const free = r => decision(r) === undefined
check('target: cwd in another repo -> no deny', free(bash('git push origin main', unrelated)))
check('target: git -C other-repo from the held repo -> no deny', free(bash(`git -C ${unrelated} push origin main`, main)))
check('target: git -C other-repo (quoted) from a worktree -> no deny', free(bash(`git -C "${unrelated}" push`, linked)))
check('target: cd other-repo && push from the held repo -> no deny', free(bash(`cd ${unrelated} && git push`, main)))
check('target: cd other-repo; push from the held repo -> no deny', free(bash(`cd ${unrelated}; git push`, main)))
check('target: git -C ../other (relative) from the held repo -> no deny', free(bash('git -C ../unrelated push', main)))
check('target: push in the main checkout -> deny', denied(bash('git push', main), 't-wt'))
check('target: push in a linked worktree -> deny', denied(bash('git push', linked), 't-wt'))
check('target: git -C main from an unrelated cwd -> deny', denied(bash(`git -C ${main} push`, unrelated), 't-wt'))
check('target: git -C worktree from an unrelated cwd -> deny', denied(bash(`git -C ${linked} push`, unrelated), 't-wt'))
check('target: git -C ../main (relative) from an unrelated cwd -> deny', denied(bash('git -C ../main push', unrelated), 't-wt'))
check('target: cd worktree && push from an unrelated cwd -> deny', denied(bash(`cd ${linked} && git push`, unrelated), 't-wt'))
check('target: git -C not a checkout -> falls back to cwd, held', denied(bash(`git -C ${join(wtRoot, 'nope')} push`, main), 't-wt'))
check('target: git -C other-repo attended -> still asks', decision(bash(`git -C ${unrelated} push`, main, ATT)) === 'ask')
rmSync(linked, { recursive: true, force: true })
const gone = prepushAt(main)
check('worktree: deleted task worktree does not crash, and does not hold', gone.status === 0 && gone.stderr === '')
task('t-wt', main, ['tm_open', 'daemon_spawned'])
check('worktree: with the worktree deleted, a task in main still holds a push from main', heldBy(prepushAt(main)))
drop('t-wt')

// package worktrees: a slugged task (teams/<slug>/P1-x) and a legacy one (harness/<id8>/P1) hold and release
// a push from their linked worktree the same way; the hook keys on the task cwd and the E-<id8> report path
const pkgMain = join(wtRoot, 'pkg-main')
mkdirSync(pkgMain)
sh(pkgMain, 'init', '-q', '-b', 'main')
sh(pkgMain, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'one')
for (const [label, id, branch] of [
  ['slugged', 'aaaa1111-0000-0000-0000-000000000001', 'teams/fix-names/P1-x'],
  ['legacy', 'bbbb2222-0000-0000-0000-000000000002', 'harness/bbbb2222/P1'],
]) {
  const pkg = join(wtRoot, `pkg-${label}`)
  sh(pkgMain, 'worktree', 'add', '-q', pkg, '-b', branch)
  task(id, pkgMain, ['tm_open', 'daemon_spawned'])
  const heldHere = () => denied(bash('git push origin HEAD', pkg), id) && prepushAt(pkg).status === 1
  const freeHere = () => decision(bash('git push origin HEAD', pkg)) === undefined && prepushAt(pkg).status === 0
  check(`${label} package worktree: open task -> push and prepush deny`, heldHere())
  writeFileSync(join(tasks, id, 'ledger.jsonl'), '{"event":"tm_open"}\n{"event":"daemon_done"}\n')
  check(`${label} package worktree: daemon_done without a report -> deny`, heldHere())
  report(id, pkgMain)
  check(`${label} package worktree: daemon_done + 80-report.md -> allow`, freeHere())
  rmSync(join(pkgMain, '.teams_output'), { recursive: true, force: true })
  writeFileSync(join(tasks, id, 'ledger.jsonl'), '{"event":"tm_open"}\n{"event":"clean"}\n')
  check(`${label} package worktree: clean event -> allow`, freeHere())
  drop(id)
}

check('garbage stdin -> fail open', run('bash', 'not json').code === 0 && Object.keys(run('bash', 'not json').out).length === 0)
check('bad cwd -> fail open', run('bash', { tool_name: 'Bash', tool_input: { command: 'git commit' }, cwd: '/nonexistent' }).code === 0)

rmSync(wtRoot, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
