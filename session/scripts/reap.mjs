#!/usr/bin/env node
// /reap-list from a shell: list leftover teams processes and worktrees, or stop and remove the
// finished ones. Gathers ps, `git worktree list --porcelain`, merged/dirty state and the task dirs,
// then lets reap-logic.mjs decide. Never forced, never by name: SIGTERM by pid, `git worktree remove`.
//   node reap.mjs --list [--json]      show
//   node reap.mjs --reap [--dry-run]   stop finished processes, remove finished worktrees
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PS_ARGV, classify, daemonTaskId, parsePorcelain, parsePs, planReap, reportPath } from './reap-logic.mjs'

const USAGE = 'usage: node reap.mjs --list [--json] | --reap [--dry-run]\n'
const KEEP_EVENT = /"event":"(tm_open|tm_retry|daemon_spawned|daemon_done|clean)"/
const CLAUDE_BIN = cmd => {
  const bin = String(cmd).trim().split(/\s+/)[0] || ''
  return bin.split('/').pop() === 'claude' || /\/claude\/versions\/[^/]+$/.test(bin)
}

const defaults = () => ({
  exec: (argv, opts = {}) => {
    const r = spawnSync(argv[0], argv.slice(1), { cwd: opts.cwd, encoding: 'utf8', timeout: 15000 })
    return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || (r.error ? String(r.error.message) : '') }
  },
  kill: (pid, sig) => process.kill(pid, sig),
  readFile: p => readFileSync(p, 'utf8'),
  exists: p => existsSync(p),
  readdir: p => readdirSync(p),
  realpath: p => { try { return realpathSync(p) } catch { return p } },
  cwdOf: pid => { try { return readlinkSync(`/proc/${pid}/cwd`) } catch { return '' } },
  // HARNESS_TASKS_DIR of a process (the default root when unset), or null when /proc/<pid>/environ cannot be read.
  environOf: pid => {
    try {
      const v = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').find(e => e.startsWith('HARNESS_TASKS_DIR='))
      return (v && v.slice(18)) || join(homedir(), '.harness', 'tasks')
    } catch { return null }
  },
  now: () => Date.now(),
  pid: process.pid,
  cwd: process.cwd(),
  env: process.env,
  tasksDir: process.env.HARNESS_TASKS_DIR || join(homedir(), '.harness', 'tasks'),
  out: s => process.stdout.write(s + '\n'),
  err: s => process.stderr.write(s),
})

const ancestors = (rows, pid) => {
  const byPid = new Map(rows.map(r => [r.pid, r]))
  const out = [pid]
  for (let at = byPid.get(pid); at && at.ppid > 0 && !out.includes(at.ppid); at = byPid.get(at.ppid)) out.push(at.ppid)
  return out
}

function readTasks(d, worktrees, mainPath) {
  const nonMain = worktrees.filter(w => !w.main && w.path !== mainPath).map(w => w.path)
  const repoPaths = new Set(worktrees.map(w => d.realpath(w.path)))
  let names = []
  try { names = d.readdir(d.tasksDir) } catch { return [] }
  const tasks = []
  for (const id of names) {
    let t
    try { t = JSON.parse(d.readFile(join(d.tasksDir, id, 'task.json'))) } catch { continue }
    if (!t || typeof t !== 'object') continue
    let raw = ''
    try { raw = d.readFile(join(d.tasksDir, id, 'ledger.jsonl')) } catch { raw = '' }
    const text = JSON.stringify(t) + raw
    const task = {
      id,
      run_id: t.run_id || id,
      cwd: t.cwd || '',
      docs_dir: t.team && t.team.opts && t.team.opts.docs_dir,
      worktrees: nonMain.filter(p => text.includes(p)),
      ledger: raw.split('\n').filter(l => KEEP_EVENT.test(l)).join('\n'),
      inRepo: !!t.cwd && repoPaths.has(d.realpath(t.cwd)),
    }
    task.hasReport = d.exists(reportPath(task))
    tasks.push(task)
  }
  return tasks
}

// A daemon's tasks root and what that root holds for its task: { tasksDir, exists, task }, or null
// when its environ is unreadable. A root other than ours is read here so the logic stays pure.
function procInfoOf(d, pid, id) {
  const raw = d.environOf(pid)
  if (!raw) return null
  const root = d.realpath(raw)
  if (root === d.realpath(d.tasksDir)) return { tasksDir: root }
  const dir = join(raw, id)
  const info = { tasksDir: root, exists: d.exists(dir), task: { id, ledger: '', hasReport: false } }
  if (!info.exists) return info
  try {
    const t = JSON.parse(d.readFile(join(dir, 'task.json')))
    const task = { id, run_id: (t && t.run_id) || id, cwd: (t && t.cwd) || '', docs_dir: t && t.team && t.team.opts && t.team.opts.docs_dir, ledger: '' }
    try { task.ledger = d.readFile(join(dir, 'ledger.jsonl')).split('\n').filter(l => KEEP_EVENT.test(l)).join('\n') } catch { /* no ledger */ }
    task.hasReport = d.exists(reportPath(task))
    info.task = task
  } catch { /* no task.json: stays unfinished */ }
  return info
}

// Pids that belong to the task this process runs in: its live daemon and the drivers it spawned.
function taskPids(d, id, rows) {
  const live = new Set(rows.map(r => r.pid))
  const pids = []
  try {
    const t = JSON.parse(d.readFile(join(d.tasksDir, id, 'task.json')))
    if (t && t.daemon && Number(t.daemon.pid)) pids.push(Number(t.daemon.pid))
  } catch { /* no task.json */ }
  try {
    for (const l of d.readFile(join(d.tasksDir, id, 'ledger.jsonl')).split('\n')) {
      if (!l.includes('child_driver_spawned')) continue
      try { const e = JSON.parse(l); if (e && e.event === 'child_driver_spawned' && Number(e.pid)) pids.push(Number(e.pid)) } catch { /* skip */ }
    }
  } catch { /* no ledger */ }
  return pids.filter(p => live.has(p))
}

function gather(d) {
  const ps = d.exec(PS_ARGV)
  const rows = parsePs(ps.stdout)
  const wl = d.exec(['git', 'worktree', 'list', '--porcelain'], { cwd: d.cwd })
  const worktrees = parsePorcelain(wl.code === 0 ? wl.stdout : '')
  const mainPath = (worktrees.find(w => w.main) || {}).path
  const mainRef = worktrees.length && worktrees[0].branch ? worktrees[0].branch : 'HEAD'
  const flags = {}
  for (const w of worktrees) {
    if (w.main) continue
    const merged = w.head ? d.exec(['git', 'merge-base', '--is-ancestor', w.head, mainRef], { cwd: mainPath }).code === 0 : false
    const st = d.exec(['git', 'status', '--porcelain'], { cwd: w.path })
    flags[w.path] = { merged, dirty: st.code === 0 ? st.stdout.trim() !== '' : undefined }
  }
  const tasks = readTasks(d, worktrees, mainPath)

  // Never touched: this CLI, everything above it, the nearest claude (the engine), and the live
  // daemon and drivers of the task it runs in.
  const chain = ancestors(rows, d.pid)
  const engine = chain.find(p => { const r = rows.find(x => x.pid === p); return r && CLAUDE_BIN(r.cmd) })
  const selfPids = [...chain]
  if (engine && !selfPids.includes(engine)) selfPids.push(engine)
  const current = d.env.TEAMS_TASK_ID || (tasks.find(t => { const dp = taskPids(d, t.id, rows)[0]; return dp && chain.includes(dp) }) || {}).id
  if (current) for (const p of taskPids(d, current, rows)) if (!selfPids.includes(p)) selfPids.push(p)
  const selfCwds = [d.cwd, ...selfPids.map(p => d.cwdOf(p))].filter(Boolean)

  // The caller and everything above it never appear in the listing; their command line can quote anything.
  const listed = rows.filter(r => !chain.includes(r.pid))
  const procInfo = {}
  for (const r of listed) { const id = daemonTaskId(r.cmd); if (id) procInfo[r.pid] = procInfoOf(d, r.pid, id) }
  const items = classify({ rows: listed, worktrees, tasks, flags, selfPids, selfCwds, mainPath, now: d.now(), tasksDir: d.realpath(d.tasksDir), procInfo })
  return { items, selfPids }
}

const short = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s))

function listLines(items) {
  const procs = items.filter(i => i.type === 'proc')
  const wts = items.filter(i => i.type === 'worktree')
  const lines = []
  const w = (xs, f) => Math.max(0, ...xs.map(x => String(f(x)).length))
  const pw = w(procs, i => i.pid), aw = w(procs, i => i.age), kw = w(procs, i => i.kind), sw = w(procs, i => i.state)
  for (const i of procs) lines.push(`proc  ${String(i.pid).padStart(pw)}  ${i.age.padEnd(aw)}  ${i.kind.padEnd(kw)}  ${i.state.padEnd(sw)}  ${(i.task || '-').slice(0, 8)}  ${short(i.cmd, 80)}`)
  const stw = w(wts, i => i.state), bw = w(wts, i => i.branch || '(detached)')
  for (const i of wts) lines.push(`tree  ${i.state.padEnd(stw)}  ${(i.branch || '(detached)').padEnd(bw)}  ${i.path}  ${i.reason}`)
  return lines
}

export function run(argv, deps = {}) {
  const d = { ...defaults(), ...deps }
  const a = new Set(argv)
  const list = a.has('--list'), reap = a.has('--reap')
  if (list === reap || [...a].some(x => !['--list', '--json', '--reap', '--dry-run'].includes(x))
    || (a.has('--json') && !list) || (a.has('--dry-run') && !reap)) {
    d.err(USAGE)
    return 2
  }

  const { items, selfPids } = gather(d)
  if (list) {
    if (a.has('--json')) d.out(JSON.stringify(items))
    else for (const l of listLines(items)) d.out(l)
    return 0
  }

  const fresh = parsePs(d.exec(PS_ARGV).stdout)
  const freshRoots = {}
  for (const it of items) if (it.state === 'orphan') { const raw = d.environOf(it.pid); if (raw) freshRoots[it.pid] = d.realpath(raw) }
  const plan = planReap(items, fresh, selfPids, freshRoots)
  const killed = new Set(plan.kill.map(r => r.pid))
  const dry = a.has('--dry-run')
  let failed = 0
  for (const r of plan.kill) {
    if (dry) { d.out(`would stop: pid ${r.pid} ${short(r.cmd, 80)}`); continue }
    try { d.kill(r.pid, 'SIGTERM'); d.out(`stopped: pid ${r.pid} ${short(r.cmd, 80)}`) } catch (e) { failed++; d.out(`failed: stop pid ${r.pid} (${e && e.message})`) }
  }
  for (const it of items) {
    if (it.type === 'proc' && it.reapable && !killed.has(it.pid)) d.out(`skipped: pid ${it.pid} (gone, reused, protected or inside another job)`)
  }
  const mainPath = (items.find(i => i.type === 'worktree' && i.reason === 'main checkout') || {}).path || d.cwd
  for (const it of plan.remove) {
    if (dry) { d.out(`would remove: ${it.path}`); continue }
    const r = d.exec(['git', 'worktree', 'remove', it.path], { cwd: mainPath })
    if (r.code === 0) d.out(`removed: ${it.path}`)
    else { failed++; d.out(`failed: remove ${it.path} (${String(r.stderr).trim().split('\n')[0]})`) }
  }
  return failed ? 1 : 0
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = run(process.argv.slice(2))
}
