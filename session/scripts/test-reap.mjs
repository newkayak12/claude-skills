import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parsePs, parsePorcelain, classify, planReap, fmtAge, reportPath, taskFinished } from './reap-logic.mjs'

const ps = (pid, ppid, cmd, start = 'Thu Oct 22 09:01:09 2026') => `${String(pid).padStart(7)} ${String(ppid).padStart(7)} ${start} ${cmd}`
const row = (pid, ppid, cmd, start = 'Thu Oct 22 09:01:09 2026') => ({ pid, ppid, start, cmd })
const ev = (...names) => names.map(event => JSON.stringify({ ts: 1, event })).join('\n')
const MAIN = '/repo'
const WT = '/repo/.claude/worktrees/a'
const task = (o = {}) => ({ id: 'aaaaaaaa-1111', run_id: 'bbbbbbbb-2222', cwd: MAIN, worktrees: [WT], ledger: ev('tm_open', 'daemon_spawned'), hasReport: false, ...o })
const wts = [{ path: MAIN, main: true, branch: 'main' }, { path: WT, main: false, branch: 'work' }]

test('parsePs reads pid, ppid, start and command', () => {
  const r = parsePs(ps(10, 1, 'claude -p hello') + '\n' + ps(11, 10, 'node x.mjs'))
  assert.deepEqual(r[0], { pid: 10, ppid: 1, start: 'Thu Oct 22 09:01:09 2026', cmd: 'claude -p hello' })
  assert.equal(r.length, 2)
})
test('parsePs normalises the double space of a one-digit day', () => {
  assert.equal(parsePs(ps(5, 1, 'x', 'Wed Oct  8 10:09:00 2026'))[0].start, 'Wed Oct 8 10:09:00 2026')
})
test('parsePs skips junk and handles empty and non-string input', () => {
  assert.deepEqual(parsePs(''), [])
  assert.deepEqual(parsePs(undefined), [])
  assert.equal(parsePs('garbage\n\n' + ps(1, 0, 'init')).length, 1)
})
test('parsePorcelain marks the first block as main and reads branch, detached, locked', () => {
  const text = `worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo/w\nHEAD def\nbranch refs/heads/feat\nlocked why\n\nworktree /repo/d\nHEAD 123\ndetached\nprunable gone\n`
  const w = parsePorcelain(text)
  assert.equal(w.length, 3)
  assert.equal(w[0].main, true)
  assert.equal(w[1].branch, 'feat')
  assert.equal(w[1].locked, true)
  assert.equal(w[2].detached, true)
  assert.equal(w[2].branch, null)
  assert.equal(w[2].prunable, true)
  assert.equal(w[2].main, false)
})
test('parsePorcelain on empty text gives []', () => {
  assert.deepEqual(parsePorcelain(''), [])
  assert.deepEqual(parsePorcelain(null), [])
})
test('fmtAge formats seconds, minutes, hours, days', () => {
  const t = Date.parse('Thu Oct 22 09:00:00 2026')
  assert.equal(fmtAge('Thu Oct 22 09:00:00 2026', t + 5000), '5s')
  assert.equal(fmtAge('Thu Oct 22 09:00:00 2026', t + 7 * 60000), '7m')
  assert.equal(fmtAge('Thu Oct 22 09:00:00 2026', t + (3 * 60 + 5) * 60000), '3h05m')
  assert.equal(fmtAge('Thu Oct 22 09:00:00 2026', t + 50 * 3600000), '2d02h')
})
test('fmtAge returns empty for bad text, future start or missing now', () => {
  assert.equal(fmtAge('nonsense', Date.now()), '')
  assert.equal(fmtAge('Thu Oct 22 09:00:00 2026', 0), '')
  assert.equal(fmtAge('Thu Oct 22 09:00:00 2026', undefined), '')
})
test('taskFinished: daemon_done and clean finish, spawned does not', () => {
  assert.equal(taskFinished(task({ ledger: ev('tm_open', 'daemon_spawned', 'daemon_done') })), true)
  assert.equal(taskFinished(task({ ledger: ev('tm_open', 'daemon_done', 'clean') })), true)
  assert.equal(taskFinished(task({ ledger: ev('tm_open', 'daemon_spawned') })), false)
})
test('taskFinished: a retry after daemon_done makes it live again', () => {
  assert.equal(taskFinished(task({ ledger: ev('daemon_done', 'tm_retry') })), false)
})
test('taskFinished: 80-report.md alone finishes a task whose ledger names no event', () => {
  assert.equal(taskFinished(task({ ledger: '', hasReport: true })), true)
  assert.equal(taskFinished(task({ ledger: '', hasReport: false })), false)
})
test('taskFinished: a stale report does not override a live ledger', () => {
  assert.equal(taskFinished(task({ ledger: ev('tm_open', 'daemon_spawned'), hasReport: true })), false)
})
test('taskFinished survives a malformed ledger line, a ledger-only dir and a missing ledger', () => {
  assert.equal(taskFinished(task({ ledger: '{oops\n' + ev('daemon_done') })), true)
  assert.equal(taskFinished(task({ ledger: undefined })), false)
  assert.equal(taskFinished({ id: 'x' }), false)
  assert.equal(taskFinished(undefined), false)
})
test('reportPath uses docs_dir, and a default when it is missing', () => {
  assert.equal(reportPath({ cwd: '/r', docs_dir: 'out', run_id: '12345678-abc' }), '/r/out/E-12345678/80-report.md')
  assert.equal(reportPath({ cwd: '/r', id: 'abcdefgh-1' }), '/r/.teams_output/team/E-abcdefgh/80-report.md')
})

const daemonCmd = 'node /repo/teams/mcp/daemon.mjs --task aaaaaaaa-1111'
const driverCmd = `claude -p Run the harness in ${WT} for E-bbbbbbbb`
const procs = (items, pid) => items.find(i => i.type === 'proc' && i.pid === pid)

test('classify: daemon of a live task is live and not reapable', () => {
  const [d] = classify({ rows: [row(100, 1, daemonCmd)], tasks: [task()] })
  assert.equal(d.kind, 'daemon'); assert.equal(d.state, 'live'); assert.equal(d.reapable, false)
})
test('classify: daemon of a finished task is finished and reapable', () => {
  const [d] = classify({ rows: [row(100, 1, daemonCmd)], tasks: [task({ ledger: ev('daemon_done') })] })
  assert.equal(d.state, 'finished'); assert.equal(d.reapable, true); assert.equal(d.task, 'aaaaaaaa-1111')
})
test('classify: a driver is matched by run prefix or worktree path', () => {
  const t = task({ ledger: ev('clean') })
  const items = classify({ rows: [row(1, 0, 'claude -p E-bbbbbbbb go'), row(2, 0, `claude -p cd ${WT}`)], tasks: [t] })
  assert.equal(items[0].kind, 'driver'); assert.equal(items[0].state, 'finished')
  assert.equal(items[1].kind, 'driver'); assert.equal(items[1].state, 'finished')
})
test('classify: a judge prompt is a judge', () => {
  const [j] = classify({ rows: [row(5, 1, 'claude -p You are the judge for aaaaaaaa-1111')], tasks: [task({ ledger: ev('daemon_done') })] })
  assert.equal(j.kind, 'judge'); assert.equal(j.state, 'finished')
})
test('classify: a finished report with no ledger event makes its processes finished', () => {
  const [d] = classify({ rows: [row(100, 1, daemonCmd)], tasks: [task({ ledger: '', hasReport: true })] })
  assert.equal(d.state, 'finished')
})
test('classify: a process of no task here is other and never reapable', () => {
  const [p] = classify({ rows: [row(9, 1, 'claude -p something unrelated')], tasks: [task({ ledger: ev('daemon_done') })] })
  assert.equal(p.state, 'other'); assert.equal(p.kind, 'other'); assert.equal(p.reapable, false)
})
test('classify: a task marked inRepo false is ignored, so its daemon is other', () => {
  const [d] = classify({ rows: [row(100, 1, daemonCmd)], tasks: [task({ inRepo: false, ledger: ev('daemon_done') })] })
  assert.equal(d.state, 'other'); assert.equal(d.reapable, false)
})
test('classify: a main-checkout path in a command does not tie it to a task', () => {
  const [p] = classify({ rows: [row(9, 1, 'claude -p edit /repo/README.md')], tasks: [task({ ledger: ev('daemon_done'), worktrees: [MAIN] })], mainPath: MAIN })
  assert.equal(p.state, 'other')
})
test('classify: two tasks matching one process, one live, keeps it live', () => {
  const t2 = task({ id: 'cccccccc-3', run_id: 'dddddddd', worktrees: [WT], ledger: ev('daemon_spawned') })
  const [p] = classify({ rows: [row(1, 0, `claude -p in ${WT}`)], tasks: [task({ ledger: ev('daemon_done') }), t2] })
  assert.equal(p.state, 'live'); assert.equal(p.reapable, false)
})
test('classify: ps helpers and unrelated rows are not listed', () => {
  const items = classify({ rows: [row(1, 0, 'ps -A -o pid='), row(2, 0, 'bash'), row(3, 0, '/usr/bin/dbus-daemon --session')], tasks: [task()] })
  assert.deepEqual(items, [])
})
test('classify: empty input does not throw', () => {
  assert.deepEqual(classify({}), [])
  assert.deepEqual(classify(undefined), [])
  assert.deepEqual(classify({ rows: [], worktrees: [], tasks: [] }), [])
})
test('classify: a task with no docs_dir and a ledger-only record classify fine', () => {
  const [d] = classify({ rows: [row(1, 0, daemonCmd)], tasks: [{ id: 'aaaaaaaa-1111', ledger: ev('daemon_done') }] })
  assert.equal(d.state, 'finished')
})
test('classify: age is filled when now is given', () => {
  const [d] = classify({ rows: [row(1, 0, daemonCmd, 'Thu Oct 22 09:00:00 2026')], tasks: [task()], now: Date.parse('Thu Oct 22 09:10:00 2026') })
  assert.equal(d.age, '10m')
})

const wt = (input, path = WT) => classify({ worktrees: wts, mainPath: MAIN, ...input }).find(i => i.type === 'worktree' && i.path === path)
test('worktree: never the main checkout', () => {
  const w = wt({ tasks: [task({ cwd: MAIN, ledger: ev('daemon_done') })], flags: { [MAIN]: { merged: true, dirty: false } } }, MAIN)
  assert.equal(w.removable, false)
})
test('worktree: merged and clean is removable', () => {
  const w = wt({ tasks: [], flags: { [WT]: { merged: true, dirty: false } } })
  assert.equal(w.removable, true); assert.equal(w.state, 'removable')
})
test('worktree: finished task and clean tree is removable though unmerged', () => {
  const w = wt({ tasks: [task({ ledger: ev('daemon_done') })], flags: { [WT]: { merged: false, dirty: false } } })
  assert.equal(w.removable, true)
})
test('worktree: dirty is kept even if merged', () => {
  const w = wt({ tasks: [], flags: { [WT]: { merged: true, dirty: true } } })
  assert.equal(w.removable, false); assert.match(w.reason, /uncommitted/)
})
test('worktree: unknown dirty state is kept', () => {
  assert.equal(wt({ tasks: [], flags: { [WT]: { merged: true } } }).removable, false)
  assert.equal(wt({ tasks: [], flags: {} }).removable, false)
})
test('worktree: unmerged with an unfinished task is kept', () => {
  const w = wt({ tasks: [task()], flags: { [WT]: { merged: false, dirty: false } } })
  assert.equal(w.removable, false)
})
test('worktree: merged but its task still runs is kept', () => {
  assert.equal(wt({ tasks: [task()], flags: { [WT]: { merged: true, dirty: false } } }).removable, false)
})
test('worktree: unmerged with no task is kept', () => {
  assert.equal(wt({ tasks: [], flags: { [WT]: { merged: false, dirty: false } } }).removable, false)
})
test('worktree: holding a selfPid cwd is kept', () => {
  const flags = { [WT]: { merged: true, dirty: false } }
  assert.equal(wt({ tasks: [], flags, selfCwds: [WT] }).removable, false)
  assert.equal(wt({ tasks: [], flags, selfCwds: [`${WT}/sub/dir`] }).removable, false)
  assert.equal(wt({ tasks: [], flags, selfCwds: ['/repo/.claude/worktrees/ab'] }).removable, true)
})
test('worktree: locked is kept', () => {
  const w = classify({ worktrees: [{ path: MAIN, main: true }, { path: WT, locked: true }], flags: { [WT]: { merged: true, dirty: false } } })[1]
  assert.equal(w.removable, false)
})

const mkItems = (rows, ledger = ev('daemon_done')) => classify({ rows, tasks: [task({ ledger })] })
test('planReap: finished process is killed, live one is not', () => {
  const fin = [row(100, 1, daemonCmd)]
  assert.deepEqual(planReap(mkItems(fin), fin, [50]).kill.map(r => r.pid), [100])
  assert.deepEqual(planReap(mkItems(fin, ev('daemon_spawned')), fin, [50]).kill, [])
})
test('planReap: other processes are never killed', () => {
  const fin = [row(9, 1, 'claude -p unrelated')]
  assert.deepEqual(planReap(mkItems(fin), fin, [50]).kill, [])
})
test('planReap: a process gone from fresh ps is dropped', () => {
  const rows = [row(100, 1, daemonCmd)]
  assert.deepEqual(planReap(mkItems(rows), [], [50]).kill, [])
})
test('planReap: pid reuse (start differs or cmd differs) is dropped', () => {
  const rows = [row(100, 1, daemonCmd)]
  const items = mkItems(rows)
  assert.deepEqual(planReap(items, [row(100, 1, daemonCmd, 'Fri Oct 23 01:00:00 2026')], [50]).kill, [])
  assert.deepEqual(planReap(items, [row(100, 1, 'claude -p other')], [50]).kill, [])
})
test('planReap: selfPids and their ancestors (the session) are dropped', () => {
  const rows = [row(10, 1, 'claude -p E-bbbbbbbb session'), row(20, 10, 'node cli.mjs'), row(30, 1, daemonCmd)]
  const plan = planReap(mkItems(rows), rows, [20])
  assert.deepEqual(plan.kill.map(r => r.pid), [30])
})
test('planReap: a selfPid that is itself listed is dropped', () => {
  const rows = [row(30, 1, daemonCmd)]
  assert.deepEqual(planReap(mkItems(rows), rows, [30]).kill, [])
})
test('planReap: wrapper and child give one kill, the innermost', () => {
  const rows = [row(40, 1, `sh -c claude -p E-bbbbbbbb x`), row(41, 40, 'claude -p E-bbbbbbbb x')]
  assert.deepEqual(planReap(mkItems(rows), rows, [50]).kill.map(r => r.pid), [41])
})
test('planReap: a wrapper whose child is not a candidate is still killed', () => {
  const rows = [row(40, 1, 'claude -p E-bbbbbbbb x'), row(41, 40, 'node child.mjs')]
  assert.deepEqual(planReap(mkItems(rows), rows, [50]).kill.map(r => r.pid), [40])
})
test('planReap: helper commands of this plugin are never killed', () => {
  const items = [{ type: 'proc', pid: 7, ppid: 1, start: 'Thu Oct 22 09:01:09 2026', cmd: 'ps -A -o pid=', kind: 'driver', state: 'finished', reapable: true }]
  assert.deepEqual(planReap(items, [row(7, 1, 'ps -A -o pid=')], [50]).kill, [])
})
test('planReap: an item forged finished but not reapable is dropped', () => {
  const items = [{ type: 'proc', pid: 7, ppid: 1, start: 'Thu Oct 22 09:01:09 2026', cmd: 'claude -p x', kind: 'other', state: 'finished', reapable: false }]
  assert.deepEqual(planReap(items, [row(7, 1, 'claude -p x')], [50]).kill, [])
})
test('planReap: only removable worktrees are listed for removal', () => {
  const items = classify({ worktrees: [{ path: MAIN, main: true }, { path: WT }, { path: '/repo/w2' }], tasks: [], flags: { [WT]: { merged: true, dirty: false }, '/repo/w2': { merged: true, dirty: true } } })
  assert.deepEqual(planReap(items, [], [50]).remove.map(w => w.path), [WT])
})
test('planReap: empty ps, empty items and missing arguments do not throw', () => {
  assert.deepEqual(planReap([], [], []), { kill: [], remove: [] })
  assert.deepEqual(planReap(undefined, undefined, undefined), { kill: [], remove: [] })
  assert.deepEqual(planReap(mkItems([row(100, 1, daemonCmd)]), [], [1]).kill, [])
})

test('source: reap-logic.mjs is pure and never forces, deletes branches or kills by name', () => {
  const src = readFileSync(fileURLToPath(new URL('./reap-logic.mjs', import.meta.url)), 'utf8')
  for (const bad of ['branch -D', '--force', 'pkill', 'killall', 'SIGKILL', 'process.kill', 'child_process', 'node:fs', 'teams/']) {
    assert.equal(src.includes(bad), false, `reap-logic.mjs contains ${bad}`)
  }
  assert.equal(/^import\s/m.test(src), false, 'no imports')
})

// ---- CLI: reap.mjs run(argv, deps) ----
import { run } from './reap.mjs'

const TID = 'aaaaaaaa-1111'
const D_CMD = `node /x/teams/mcp/daemon.mjs --task ${TID}`
const files = (ledger = ev('tm_open', 'daemon_spawned', 'daemon_done')) => ({
  [`/t/${TID}/task.json`]: JSON.stringify({ run_id: 'bbbbbbbb-2222', cwd: MAIN, daemon: { pid: 100 }, wt: WT }),
  [`/t/${TID}/ledger.jsonl`]: ledger,
})
function fake({ fs = files(), flags = { merged: true, dirty: false }, killThrows = false, removeFails = false, env = {} } = {}) {
  const calls = { exec: [], kill: [], out: [], err: [] }
  const psText = [ps(40, 1, '/usr/bin/claude'), ps(50, 40, 'node reap.mjs --reap'), ps(100, 1, D_CMD)].join('\n')
  const deps = {
    exec: (argv, opts = {}) => {
      calls.exec.push({ argv, cwd: opts.cwd })
      const k = argv.join(' ')
      if (argv[0] === 'ps') return { code: 0, stdout: psText, stderr: '' }
      if (k === 'git worktree list --porcelain') return { code: 0, stdout: `worktree ${MAIN}\nHEAD aaa\nbranch refs/heads/main\n\nworktree ${WT}\nHEAD bbb\nbranch refs/heads/work\n`, stderr: '' }
      if (argv[1] === 'merge-base') return { code: flags.merged ? 0 : 1, stdout: '', stderr: '' }
      if (argv[1] === 'status') return { code: 0, stdout: flags.dirty ? ' M f\n' : '', stderr: '' }
      if (argv[1] === 'worktree' && argv[2] === 'remove') return removeFails ? { code: 128, stdout: '', stderr: 'fatal: cannot remove\n' } : { code: 0, stdout: '', stderr: '' }
      return { code: 1, stdout: '', stderr: 'unexpected' }
    },
    kill: (pid, sig) => { calls.kill.push([pid, sig]); if (killThrows) throw new Error('EPERM') },
    readFile: p => { if (p in fs) return fs[p]; throw new Error('ENOENT') },
    exists: p => p in fs,
    readdir: p => { if (p === '/t') return [TID]; throw new Error('ENOENT') },
    realpath: p => p,
    cwdOf: pid => (pid === 50 ? '/elsewhere' : ''),
    now: () => Date.parse('Thu Oct 22 10:01:09 2026'),
    pid: 50,
    cwd: '/elsewhere',
    env,
    tasksDir: '/t',
    out: s => calls.out.push(s),
    err: s => calls.err.push(s),
  }
  return { deps, calls }
}

test('cli --list prints aligned lines for processes and worktrees', () => {
  const { deps, calls } = fake()
  assert.equal(run(['--list'], deps), 0)
  const procLine = calls.out.find(l => l.startsWith('proc') && l.includes('daemon'))
  assert.ok(procLine, calls.out.join('\n'))
  assert.match(procLine, /^proc\s+100\s+1h00m\s+daemon\s+finished\s+aaaaaaaa\s+node /)
  const tree = calls.out.find(l => l.startsWith('tree') && l.includes(WT))
  assert.match(tree, /removable\s+work\s+\/repo\/\.claude\/worktrees\/a\s+merged into main$/)
  assert.equal(calls.out.some(l => l.includes('reap.mjs')), false, 'the CLI itself is not a claude -p/daemon row')
})
test('cli --list --json prints one parseable array', () => {
  const { deps, calls } = fake()
  assert.equal(run(['--list', '--json'], deps), 0)
  assert.equal(calls.out.length, 1)
  const arr = JSON.parse(calls.out[0])
  assert.ok(Array.isArray(arr))
  assert.deepEqual(arr.filter(i => i.type === 'proc').map(i => [i.pid, i.state]), [[100, 'finished']])
  assert.equal(arr.find(i => i.type === 'worktree' && i.path === WT).state, 'removable')
})
test('cli --reap stops by pid with SIGTERM and removes the worktree without --force', () => {
  const { deps, calls } = fake()
  assert.equal(run(['--reap'], deps), 0)
  assert.deepEqual(calls.kill, [[100, 'SIGTERM']])
  const rm = calls.exec.filter(c => c.argv[1] === 'worktree' && c.argv[2] === 'remove')
  assert.deepEqual(rm.map(c => c.argv), [['git', 'worktree', 'remove', WT]])
  assert.equal(rm[0].cwd, MAIN)
  assert.ok(calls.out.some(l => l.startsWith('stopped: pid 100')))
  assert.ok(calls.out.includes(`removed: ${WT}`))
  assert.equal(calls.exec.some(c => c.argv.includes('--force') || c.argv.includes('-f')), false)
})
test('cli --reap re-reads ps before acting', () => {
  const { deps, calls } = fake()
  run(['--reap'], deps)
  assert.equal(calls.exec.filter(c => c.argv[0] === 'ps').length, 2)
})
test('cli --reap --dry-run kills and removes nothing', () => {
  const { deps, calls } = fake()
  assert.equal(run(['--reap', '--dry-run'], deps), 0)
  assert.deepEqual(calls.kill, [])
  assert.equal(calls.exec.some(c => c.argv[2] === 'remove'), false)
  assert.ok(calls.out.some(l => l.startsWith('would stop: pid 100')))
  assert.ok(calls.out.includes(`would remove: ${WT}`))
})
test('cli --reap exits 1 and prints failed: when an action fails', () => {
  const a = fake({ killThrows: true })
  assert.equal(run(['--reap'], a.deps), 1)
  assert.ok(a.calls.out.some(l => l.startsWith('failed: stop pid 100 (EPERM)')))
  const b = fake({ removeFails: true })
  assert.equal(run(['--reap'], b.deps), 1)
  assert.ok(b.calls.out.some(l => l.startsWith(`failed: remove ${WT} (fatal: cannot remove)`)))
})
test('cli --reap leaves a live task, a dirty worktree and an unmerged one alone', () => {
  const live = fake({ fs: files(ev('tm_open', 'daemon_spawned')) })
  run(['--reap'], live.deps)
  assert.deepEqual(live.calls.kill, [])
  assert.equal(live.calls.exec.some(c => c.argv[2] === 'remove'), false)
  const dirty = fake({ flags: { merged: true, dirty: true } })
  run(['--reap'], dirty.deps)
  assert.equal(dirty.calls.exec.some(c => c.argv[2] === 'remove'), false)
})
test('cli never stops the daemon of the task it runs in', () => {
  const { deps, calls } = fake({ env: { TEAMS_TASK_ID: TID } })
  assert.equal(run(['--reap'], deps), 0)
  assert.deepEqual(calls.kill, [])
})
test('cli never stops its own ancestors', () => {
  const fs = files()
  fs[`/t/${TID}/task.json`] = JSON.stringify({ run_id: 'bbbbbbbb-2222', cwd: MAIN, daemon: { pid: 40 } })
  const { deps, calls } = fake({ fs })
  run(['--reap'], deps)
  assert.equal(calls.kill.some(([p]) => p === 40 || p === 50), false)
})
test('cli with no flag, both modes or a stray flag prints usage and exits 2', () => {
  for (const argv of [[], ['--list', '--reap'], ['--json'], ['--dry-run'], ['--list', '--bogus'], ['--list', '--dry-run']]) {
    const { deps, calls } = fake()
    assert.equal(run(argv, deps), 2, argv.join(' '))
    assert.match(calls.err.join(''), /^usage: /)
    assert.deepEqual(calls.kill, [])
  }
})
test('source: reap.mjs imports only reap-logic.mjs and node built-ins, and never forces or SIGKILLs', () => {
  const src = readFileSync(fileURLToPath(new URL('./reap.mjs', import.meta.url)), 'utf8')
  for (const m of src.matchAll(/^import\s.*?from\s+'([^']+)'/gm)) assert.ok(m[1].startsWith('node:') || m[1] === './reap-logic.mjs', `import ${m[1]}`)
  for (const bad of ["'--force'", 'branch -D', 'pkill', 'killall', 'SIGKILL', 'teams/']) assert.equal(src.includes(bad), false, `reap.mjs contains ${bad}`)
})
