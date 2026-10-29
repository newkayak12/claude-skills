#!/usr/bin/env node
// Feeds JSON stdin cases to .claude/hooks/repo-rules.mjs and checks its output.
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The write refusal applies only to the hook's own repo (its git common dir, found from the script's
// location). A write-deny fixture is therefore its own hook repo: it carries a copy of the hook and runs
// it. `hook` is the script the next run executes; the real one unless a section switches it to a copy.
const realHook = join(dirname(fileURLToPath(import.meta.url)), '../../.claude/hooks/repo-rules.mjs')
let hook = realHook
const copyHook = repo => {
  const dir = join(repo, '.claude/hooks')
  mkdirSync(dir, { recursive: true })
  copyFileSync(realHook, join(dir, 'repo-rules.mjs'))
  return join(dir, 'repo-rules.mjs')
}
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'ignore' })
const gitOut = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const commonOf = cwd => realpathSync(resolve(cwd, gitOut(cwd, 'rev-parse', '--git-common-dir')))

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

// no confirm on push or bump (user, 2026-10-26: "github 관련해서 그냥 하라고 묻지말고"); only an open task holds them
check('git push attended -> pass', decision(bash('git push origin main', clone, ATT)) === undefined)
check('git push unattended -> pass', decision(bash('git push origin main', clone)) === undefined)
check('patch-harness attended -> pass', decision(bash('node _repo/scripts/patch-harness.mjs x', clone, ATT)) === undefined)
check('teams patch attended -> pass', decision(bash("node teams/skills/patch/patch.mjs '{}'", clone, ATT)) === undefined)
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
check('daemon_done last -> push pass, attended or not', decision(bash('git push origin main', clone)) === undefined && decision(bash('git push origin main', clone, ATT)) === undefined)
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
check('target: git -C other-repo attended -> pass', decision(bash(`git -C ${unrelated} push`, main, ATT)) === undefined)
// compound targets: cd segments applied in order, `git -C` relative to them, `~` from env HOME
const home = { HOME: wtRoot }
check('target: cd main && git -C ../unrelated push -> no deny', free(bash(`cd ${main} && git -C ../unrelated push`, unrelated)))
check('target: cd unrelated && git -C ../main push from an unrelated cwd -> deny', denied(bash(`cd ${unrelated} && git -C ../main push`, unrelated), 't-wt'))
check('target: cd ~/main && push (HOME) from an unrelated cwd -> deny', denied(bash('cd ~/main && git push', unrelated, home), 't-wt'))
check('target: cd "~/unrelated" && push (HOME) from the held repo -> no deny', free(bash('cd "~/unrelated" && git push', main, home)))
check("target: git -C '~/main' push (HOME) from an unrelated cwd -> deny", denied(bash("git -C '~/main' push", unrelated, home), 't-wt'))
check('target: git -C ~/unrelated push (HOME) from the held repo -> no deny', free(bash('git -C ~/unrelated push', main, home)))
check('target: cd ~ && git -C main push (HOME) -> deny', denied(bash('cd ~ && git -C main push', unrelated, home), 't-wt'))
check('target: git status && cd main && push (non-leading cd) -> deny', denied(bash(`git status && cd ${main} && git push`, unrelated), 't-wt'))
check('target: git status && cd unrelated && push (non-leading cd) -> no deny', free(bash(`git status && cd ${unrelated} && git push`, main)))
check('target: cd ../unrelated && cd ../main && push (chained cd) -> deny', denied(bash('cd ../unrelated && cd ../main && git push', unrelated), 't-wt'))
check('target: cd ../main && cd ../unrelated && push (chained cd) -> no deny', free(bash('cd ../main && cd ../unrelated && git push', main)))
check('target: ls; cd unrelated; git push (semicolons) -> no deny', free(bash(`ls; cd ${unrelated}; git push`, main)))
check('target: ls; cd main; git push (semicolons) from an unrelated cwd -> deny', denied(bash(`ls; cd ${main}; git push`, unrelated), 't-wt'))
check('target: cd to a path that is not a checkout -> falls back to cwd, held', denied(bash(`cd ${join(wtRoot, 'nope')} && git push`, main), 't-wt'))
check('target: cd ~/nope (HOME) not a checkout -> falls back to cwd, held', denied(bash('cd ~/nope && git push', main, home), 't-wt'))
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

// unquoted variable as an rm argument: refused; every other shape passes (the hook only classifies `rm` as a simple command's first word)
const rmReason = r => r.out.hookSpecificOutput?.permissionDecisionReason ?? ''
const rmDenied = r => decision(r) === 'deny' && rmReason(r).includes('"${S:?}"')
check('rm: rm -f $S/*.p2 -> deny, reason names "${S:?}"', rmDenied(bash('rm -f $S/*.p2', clone)))
check('rm: rm -rf ${S}/x -> deny', rmDenied(bash('rm -rf ${S}/x', clone)))
check('rm: unquoted var after && in a chain -> deny', rmDenied(bash('cd d && rm -f $S/*.p2', clone)))
check('rm: unquoted var on the second line of a command -> deny', rmDenied(bash('ls\nrm -f $S/*.p2', clone)))
check('rm: rm -f ${S}/*.p2 -> deny', rmDenied(bash('rm -f ${S}/*.p2', clone)))
for (const c of ['true; rm -f $S/*.p2', 'S=1 rm -f $S/x', 'sudo rm -f $S/x', 'sudo -u root rm -f $S/x', 'command rm -f $S/x',
  'env A=1 rm -f $S/x', 'nohup rm -f $S/x', 'time rm -f $S/x', 'exec rm -f $S/x', 'A=1 sudo env B=2 rm -f $S/x',
  'for f in a b; do rm -f $S/$f; done', 'if true; then rm -f $S/x; fi', '(rm -f $S/x)', '{ rm -f $S/x; }', '! rm -f $S/x']) {
  check(`rm: ${c} -> deny`, rmDenied(bash(c, clone)))
}
for (const c of ['sudo rm -f "${S:?}"/x', 'env A=1 rm "${S:?}"/x', 'command -v rm', 'sudo rm $(cmd)', 'S=1 rm -f "$S"/x']) {
  check(`rm: ${c} -> no deny`, free(bash(c, clone)))
}
for (const c of ['rm -f "${S:?}"/*.p2', 'rm "$S"', 'rm ${S:?}/x', 'rm $(cmd)', 'rm $1', 'rm $@', 'rm -f x.p2',
  'find . -exec rm {} +', 'find . -name x | xargs rm', 'git rm $F', 'git commit -m "rm -f $S"', 'echo "rm $S"', "echo 'rm $S'"]) {
  check(`rm: ${c} -> no deny`, free(bash(c, clone)))
}

// in-place write to a repo file: refused with a pointer to Read/Edit/Write. A repo path resolves inside the
// git top level of the (cd-applied) working dir and is neither under tmp/ nor gitignored.
writeFileSync(join(clone, '.gitignore'), 'build/\n')
const cloneHook = copyHook(clone)
const mainHook = copyHook(main)
hook = cloneHook
const writeDenied = r => decision(r) === 'deny' && rmReason(r).includes('Read/Edit/Write')
const EOF = 'EOF'
for (const [name, c] of [
  ['sed -i on a repo file', "sed -i 's/a/b/' teams/mcp/x.mjs"],
  ['sed -i.bak', "sed -i.bak 's/a/b/' teams/mcp/x.mjs"],
  ['sed -e script then file', "sed -i -e 's/a/b/' teams/mcp/x.mjs"],
  ['perl -pi -e', "perl -pi -e 's/a/b/' teams/mcp/x.mjs"],
  ['K1 cat > file <<EOF', `cat > teams/mcp/x.mjs <<'${EOF}'\nbody\n${EOF}`],
  ['K2 bash <<EOF with sed -i', `bash <<'${EOF}'\nsed -i s/a/b/ teams/mcp/x.mjs\n${EOF}`],
  ['K3 node -e writeFileSync', `node -e "require('fs').writeFileSync('teams/mcp/x.mjs','')"`],
  ['K5 write-then-run, script in the repo', `cat > go.sh <<'${EOF}'\nrm teams/mcp/x.mjs\n${EOF}\nbash go.sh`],
  ['node --eval appendFileSync', `node --eval "require('fs').appendFileSync('teams/mcp/x.mjs','x')"`],
  ['python3 -c open(...,w)', `python3 -c "open('teams/x.py','w').write('')"`],
  ['python heredoc write', `python3 - <<'${EOF}'\nopen('teams/x.py', 'w').write('x')\n${EOF}`],
  ['python heredoc Path.write_text', `python3 <<'${EOF}'\nfrom pathlib import Path\nPath('teams/x.py').write_text('x')\n${EOF}`],
  ['echo > file', 'echo x > teams/a.md'],
  ['echo >> file', 'echo x >> teams/a.md'],
  ['echo >file (no space)', 'echo x>teams/a.md'],
  ['printf | tee file', 'printf x | tee teams/a.md'],
  ['tee -a file', 'echo x | tee -a teams/a.md'],
  ['tee file <<EOF', `tee teams/a.md <<'${EOF}'\nbody\n${EOF}`],
  ['redirect after cd', 'cd teams && echo x > a.md'],
  ['absolute repo path', `echo x > ${clone}/teams/a.md`],
  ['perl -i -pe', "perl -i -pe 's/a/b/' teams/mcp/x.mjs"],
  ['cd x && sed -i', "cd teams && sed -i 's/a/b/' mcp/x.mjs"],
  ['true; sed -i', "true; sed -i 's/a/b/' teams/mcp/x.mjs"],
  ['VAR=1 sed -i', "A=1 sed -i 's/a/b/' teams/mcp/x.mjs"],
  ['sudo sed -i', "sudo sed -i 's/a/b/' teams/mcp/x.mjs"],
  ['sudo -u root sed -i', "sudo -u root sed -i 's/a/b/' teams/mcp/x.mjs"],
  ['command sed -i', "command sed -i 's/a/b/' teams/mcp/x.mjs"],
  ['env A=1 sed -i', "env A=1 sed -i 's/a/b/' teams/mcp/x.mjs"],
  ['nohup sed -i', "nohup sed -i 's/a/b/' teams/mcp/x.mjs"],
  ['time sed -i', "time sed -i 's/a/b/' teams/mcp/x.mjs"],
  ['exec sed -i', "exec sed -i 's/a/b/' teams/mcp/x.mjs"],
  ['VAR=1 env sed -i', "A=1 env B=2 sed -i 's/a/b/' teams/mcp/x.mjs"],
  ['env python3 -c write', `env A=1 python3 -c "open('teams/x.py','w').write('')"`],
  ['cat <<EOF > file', `cat <<'${EOF}' > teams/mcp/x.mjs\nbody\n${EOF}`],
  ['echo | tee file', 'echo x | tee teams/mcp/x.mjs'],
  ['echo >> file', 'echo x >> teams/mcp/x.mjs'],
  ['sudo tee file', 'echo x | sudo tee teams/mcp/x.mjs'],
  ['do sed -i in a loop', "for f in a; do sed -i 's/a/b/' teams/mcp/x.mjs; done"],
  ['then redirect', 'if true; then echo x > teams/a.md; fi'],
  ['subshell sed -i', "(sed -i 's/a/b/' teams/mcp/x.mjs)"],
]) {
  check(`write: ${name} -> deny, reason names Read/Edit/Write`, writeDenied(bash(c, clone)))
}
check('write: cd into the repo from outside it -> deny', writeDenied(bash(`cd ${clone} && sed -i 's/a/b/' teams/mcp/x.mjs`, root)))
hook = mainHook
check('write: sed -i in a linked worktree -> deny', writeDenied(bash("sed -i 's/a/b/' teams/mcp/x.mjs", main)))
{
  // a real linked worktree of `main`, running main's hook copy: same common dir, so it still denies
  const linked2 = join(wtRoot, 'linked2')
  sh(main, 'worktree', 'add', '-q', linked2, '-b', 'side2')
  check('write: main checkout and its linked worktree report the same git common dir', commonOf(main) === commonOf(linked2))
  check('write: sed -i in a git worktree add worktree, main hook copy -> deny', writeDenied(bash("sed -i 's/a/b/' teams/mcp/x.mjs", linked2)))
  check('write: redirect in a git worktree add worktree, main hook copy -> deny', writeDenied(bash('echo x > teams/a.md', linked2)))
  check('write: absolute path into main from the linked worktree -> deny', writeDenied(bash(`echo x > ${main}/README.md`, linked2)))
}
hook = cloneHook
for (const [name, c] of [
  ['R1 data heredoc into tmp/ naming repo paths', `mkdir -p tmp/d && cat > tmp/d/request.md <<'${EOF}'\ninstall patch rm packages/csv/src/record.mjs\n${EOF}`],
  ['R2 git commit -F - <<EOF', `git commit -F - <<'${EOF}'\nharness/skills/install/SKILL.md: install patch rm\n${EOF}`],
  ['R3 pgrep with a repo path', "pgrep -af 'teams/mcp/taskmanager.mjs'"],
  ['R3 ps with $(pgrep ...)', "ps -o pid,cmd -p $(pgrep -f 'teams/mcp/taskmanager.mjs')"],
  ['git commit -m "$(cat <<EOF ...)"', `git commit -m "$(cat <<'${EOF}'\nfix teams/mcp/x.mjs\n${EOF}\n)"`],
  ['git apply, git mv', 'git apply p.diff && git mv a.md b.md'],
  ['sed without -i', "sed 's/a/b/' teams/mcp/x.mjs"],
  ['sed -n', "sed -n '1,5p' teams/mcp/x.mjs"],
  ['sudo sed -i under tmp/', "sudo sed -i 's/a/b/' tmp/x.txt"],
  ['env sed -i on /tmp', "env A=1 sed -i 's/a/b/' /tmp/x.txt"],
  ['sudo sed without -i', "sudo sed 's/a/b/' teams/mcp/x.mjs"],
  ['command -v sed', 'command -v sed'],
  ['cat a repo file', 'cat teams/mcp/x.mjs'],
  ['pipe to stdout', 'cat teams/mcp/x.mjs | grep a | head -3'],
  ['grep a repo path', 'grep -n foo teams/mcp/x.mjs'],
  ['echo mentioning a repo path', 'echo "teams/mcp/x.mjs"'],
  ['redirect under tmp/', 'echo x > tmp/o.txt'],
  ['redirect to /tmp', 'echo x > /tmp/o.txt'],
  ['redirect to a scratchpad outside the repo', `echo x > ${root}/scratch/o.txt`],
  ['sed -i under tmp/', 'sed -i s/a/b/ tmp/x.txt'],
  ['sed -i on /tmp', "sed -i 's/a/b/' /tmp/x.txt"],
  ['sed -i on a gitignored path', "sed -i 's/a/b/' build/out.js"],
  ['redirect to a gitignored path', 'echo x > build/out.js'],
  ['check command', 'node _repo/scripts/test-repo-rules.mjs'],
  ['script run by path', 'node scripts/run.mjs'],
  ['>/dev/null', 'ls >/dev/null'],
  ['2>&1', 'ls teams 2>&1'],
  ['&>/dev/null', 'ls teams &>/dev/null'],
  ['> /dev/null 2>&1', 'ls teams > /dev/null 2>&1'],
  ['tee to /tmp', 'ls | tee /tmp/ls.txt'],
  ['node -e reading a repo file', `node -e "console.log(require('fs').readFileSync('teams/mcp/x.mjs','utf8'))"`],
  ['node -e writing /tmp from a repo read', `node -e "require('fs').writeFileSync('/tmp/o', require('fs').readFileSync('teams/x','utf8'))"`],
  ['python -c writing /tmp', `python3 -c "open('/tmp/o','w').write('x')"`],
  ['python -c reading a repo file', `python3 -c "print(open('teams/x.py').read())"`],
  ['python heredoc writing tmp/', `python3 - <<'${EOF}'\nopen('tmp/o', 'w').write('x')\n${EOF}`],
  ['bash heredoc that only reads', `bash <<'${EOF}'\ncat teams/mcp/x.mjs\n${EOF}`],
]) {
  check(`write: ${name} -> no deny`, free(bash(c, clone)))
}
check('write: sed -i with cwd outside any repo -> no deny', free(bash("sed -i 's/a/b/' teams/mcp/x.mjs", root)))
check('write: redirect with cwd outside any repo -> no deny', free(bash('echo x > out.txt', root)))
check('write: cd out of the repo, then sed -i -> no deny', free(bash(`cd ${root} && sed -i 's/a/b/' teams/mcp/x.mjs`, clone)))
// split/cd state: `>|` is one redirect, the repo is that of the target path (not the cd dir), and cd,
// pushd, popd, `cd -`, bare cd and subshells move the dir the way a shell does
check('write: >| clobber redirect to a repo file -> deny', writeDenied(bash('echo x >| README.md', clone)))
check('write: absolute repo path, cwd outside any repo -> deny', writeDenied(bash(`echo x > ${clone}/README.md`, root)))
check('write: absolute repo path after cd to an outside dir -> deny', writeDenied(bash(`cd ${root} && echo x > ${clone}/README.md`, clone)))
check('write: absolute path under tmp/ of the repo after cd outside -> no deny', free(bash(`cd ${root} && echo x > ${clone}/tmp/o.txt`, clone)))
check('write: pushd outside, then redirect there -> no deny', free(bash('pushd /tmp && echo hi > x.txt', clone)))
check('write: cd /tmp && cd - && redirect -> deny (original dir)', writeDenied(bash('cd /tmp && cd - && echo hi > README.md', clone)))
check('write: pushd /tmp && popd && redirect -> deny (original dir)', writeDenied(bash('pushd /tmp && popd && echo hi > README.md', clone)))
check('write: cd -P /tmp && redirect (option stripped) -> no deny', free(bash('cd -P /tmp && echo hi > x.txt', clone)))
check('write: bare cd goes to HOME outside a repo -> no deny', free(bash('cd && echo hi > README.md', clone, { HOME: root })))
check('write: bare cd goes to HOME inside the repo -> deny', writeDenied(bash('cd && echo hi > README.md', root, { HOME: clone })))
check('write: (cd /tmp); redirect -> deny (subshell restores)', writeDenied(bash('(cd /tmp); echo hi > README.md', clone)))
check('write: (cd /tmp && redirect) -> no deny (inside the subshell)', free(bash('(cd /tmp && echo hi > x.txt)', clone)))
check('write: cd /tmp || redirect -> deny (cd discarded)', writeDenied(bash('cd /tmp || echo hi > README.md', clone)))
check('write: nonexistent cwd -> fail open', free(bash("sed -i 's/a/b/' teams/mcp/x.mjs", '/nonexistent')))
check('write: redirect to an unresolved variable -> no deny', free(bash('echo x > "$OUT"', clone)))
check('write/rm: unbalanced quote -> exit 0', bash("sed -i 's/a/b teams/mcp/x.mjs", clone).code === 0 && bash('rm "$S', clone).code === 0)

{
  const { decide } = await import(hook)
  const boom = () => { throw new Error('git broke') }
  const d = c => decide('bash', { tool_name: 'Bash', tool_input: { command: c }, cwd: clone }, process.env, boom)
  check('write: git failing inside the detector -> fail open', Object.keys(d("sed -i 's/a/b/' teams/mcp/x.mjs")).length === 0)
  check('rm: the rm deny needs no git (still denies when git fails)', d('rm -f $S/x').hookSpecificOutput?.permissionDecision === 'deny')
  // commonDir null on one side: real git everywhere except the --git-common-dir lookup of one side
  const own = dirname(cloneHook)
  const realGit = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const failing = pick => (cwd, args) => {
    if (args.includes('--git-common-dir') && pick(cwd)) throw new Error('common dir lookup failed')
    return realGit(cwd, args)
  }
  const e = (c, run) => decide('bash', { tool_name: 'Bash', tool_input: { command: c }, cwd: clone }, process.env, run)
  const sed = "sed -i 's/a/b/' teams/mcp/x.mjs"
  check('write: common dir lookups working (control) -> deny', e(sed, failing(() => false)).hookSpecificOutput?.permissionDecision === 'deny')
  check('write: commonDir null for the target -> fail open', Object.keys(e(sed, failing(cwd => cwd !== own))).length === 0)
  check('write: commonDir null for the hook own location -> fail open', Object.keys(e(sed, failing(cwd => cwd === own))).length === 0)
  check('write: commonDir null on both sides -> fail open', Object.keys(e(sed, failing(() => true))).length === 0)
}

// a git repo outside this repo: no path exemption is involved, the scratch repo is a real `git init`
// in the OS temp dir. The real hook (this repo's location) sees a different common dir and lets it pass;
// the same repo carrying its own hook copy is its own hook repo and denies.
{
  const scratch = mkdtempSync(join(tmpdir(), 'repo-rules-scratch-'))
  sh(scratch, 'init', '-q', '-b', 'main')
  writeFileSync(join(scratch, 'notes.txt'), 'a\n')
  sh(scratch, 'add', 'notes.txt')
  sh(scratch, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'one')
  check('write: scratch repo common dir differs from this repo', commonOf(scratch) !== commonOf(dirname(realHook)))
  hook = realHook
  check('write: echo > file in a scratch repo outside this repo -> pass', free(bash('echo x > notes.txt', scratch)))
  check('write: sed -i in a scratch repo outside this repo -> pass', free(bash("sed -i 's/a/b/' notes.txt", scratch)))
  check('write: tracked file, absolute path, scratch repo outside this repo -> pass', free(bash(`echo x > ${scratch}/notes.txt`, scratch)))
  hook = copyHook(scratch)
  check('write: echo > file in a repo that carries its own hook copy -> deny', writeDenied(bash('echo x > notes.txt', scratch)))
  check('write: sed -i in a repo that carries its own hook copy -> deny', writeDenied(bash("sed -i 's/a/b/' notes.txt", scratch)))
  hook = cloneHook
  rmSync(scratch, { recursive: true, force: true })
}

check('garbage stdin -> fail open', run('bash', 'not json').code === 0 && Object.keys(run('bash', 'not json').out).length === 0)
check('bad cwd -> fail open', run('bash', { tool_name: 'Bash', tool_input: { command: 'git commit' }, cwd: '/nonexistent' }).code === 0)

rmSync(wtRoot, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
