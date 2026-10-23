// Pure decisions for /reap-list: which teams processes and worktrees are left over, and which of
// them may be stopped or removed. Inputs are text and plain records the caller gathered (ps text,
// `git worktree list --porcelain` text, per-worktree merged/dirty flags, task records); nothing
// here touches the disk, a process or git. The identity check mirrors session/hooks/procs.ts and kill.ts.

export const PS_ARGV = ['ps', '-A', '-o', 'pid=,ppid=,lstart=,command=']

const CLAUDE_P = /\bclaude\b.*\s-p(\s|$)/
const DAEMON = /\bdaemon\.mjs\s+--task\s+(\S+)/
const JUDGE = /\bjudge\b/i
const OWN = /^(ps -A |sh -c echo \$PPID)/
const LINE = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d{1,2}:\d\d:\d\d\s+\d{4})\s+(.*)$/
const LEDGER_EVENTS = ['tm_open', 'tm_retry', 'daemon_spawned', 'daemon_done', 'clean']
export const DEFAULT_DOCS_DIR = '.teams_output/team'

// A line that does not parse is skipped.
export function parsePs(text) {
  return String(text ?? '').split('\n').flatMap(line => {
    const m = LINE.exec(line)
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), start: m[3].replace(/\s+/g, ' '), cmd: m[4] }] : []
  })
}

// `git worktree list --porcelain`: blocks separated by a blank line. The first block is the main checkout.
export function parsePorcelain(text) {
  const out = []
  for (const block of String(text ?? '').split(/\n\s*\n/)) {
    let wt = null
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) {
        wt = { path: line.slice(9).trim(), head: '', branch: null, detached: false, bare: false, locked: false, prunable: false, main: false }
      } else if (!wt) {
        continue
      } else if (line.startsWith('HEAD ')) wt.head = line.slice(5).trim()
      else if (line.startsWith('branch ')) wt.branch = line.slice(7).trim().replace(/^refs\/heads\//, '')
      else if (line === 'detached') wt.detached = true
      else if (line === 'bare') wt.bare = true
      else if (line === 'locked' || line.startsWith('locked ')) wt.locked = true
      else if (line === 'prunable' || line.startsWith('prunable ')) wt.prunable = true
    }
    if (wt) out.push(wt)
  }
  if (out.length) out[0].main = true
  return out
}

// `Wed Oct  8 10:09:00 2026` (local time) against now (ms); '' when the text does not parse.
export function fmtAge(start, now) {
  const t = Date.parse(start)
  if (Number.isNaN(t) || typeof now !== 'number' || now < t) return ''
  const s = Math.floor((now - t) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h${String(m % 60).padStart(2, '0')}m` : `${Math.floor(h / 24)}d${String(h % 24).padStart(2, '0')}h`
}

// Where a task's report is: <cwd>/<docs_dir>/E-<run_id[0:8]>/80-report.md. docs_dir may be missing.
export function reportPath(task) {
  const docs = (task && task.docs_dir) || DEFAULT_DOCS_DIR
  const run = String((task && (task.run_id || task.id)) || '').slice(0, 8)
  return `${String((task && task.cwd) || '')}/${docs}/E-${run}/80-report.md`
}

// A task is finished by daemon_done or a clean event as the last ledger event of its kind, or, when
// the ledger names none, by its 80-report.md (task.hasReport, which the caller checked). A later
// tm_retry or daemon_spawned makes it live again. Malformed ledger lines are skipped.
export function taskFinished(task) {
  const events = String((task && task.ledger) ?? '').split('\n').flatMap(l => {
    if (!l.trim()) return []
    try { const e = JSON.parse(l); return e && LEDGER_EVENTS.includes(e.event) ? [e.event] : [] } catch { return [] }
  })
  const last = events[events.length - 1]
  if (last === 'daemon_done' || last === 'clean') return true
  if (last) return false
  return !!(task && task.hasReport)
}

const kindOf = cmd => (DAEMON.test(cmd) ? 'daemon' : JUDGE.test(cmd) ? 'judge' : 'driver')

// The tasks a process belongs to: a daemon names its id; a driver or judge carries the id, the run
// prefix `E-xxxxxxxx`, or the path of one of the task's linked worktrees in its prompt.
function tasksOf(cmd, tasks, mainPath) {
  const d = DAEMON.exec(cmd)
  if (d) return tasks.filter(t => t.id === d[1])
  return tasks.filter(t => {
    if (t.id && cmd.includes(t.id)) return true
    const run = String(t.run_id || '').slice(0, 8)
    if (run && cmd.includes(`E-${run}`)) return true
    return (t.worktrees || []).some(w => w && w !== mainPath && cmd.includes(w))
  })
}

// input: { rows, worktrees, tasks, flags, selfPids, selfCwds, mainPath, now }
//   rows      parsePs output
//   worktrees parsePorcelain output
//   tasks     [{ id, run_id, cwd, docs_dir, worktrees: [path], ledger: text, hasReport, inRepo }]
//   flags     { [worktree path]: { merged, dirty } }
//   selfPids  this process and the session it runs in
//   selfCwds  cwd of each selfPid
// Returns items: { type: 'proc' | 'worktree', state, ... }. A process of no task here is 'other'.
export function classify(input) {
  const { rows = [], worktrees = [], flags = {}, selfCwds = [], now } = input || {}
  const tasks = (input && input.tasks ? input.tasks : []).filter(t => t && t.inRepo !== false)
  const mainPath = (input && input.mainPath) || (worktrees.find(w => w.main) || {}).path
  const items = []
  const fin = new Map(tasks.map(t => [t, taskFinished(t)]))

  for (const r of rows) {
    if (!(CLAUDE_P.test(r.cmd) || DAEMON.test(r.cmd)) || OWN.test(r.cmd)) continue
    const hit = tasksOf(r.cmd, tasks, mainPath)
    const item = { type: 'proc', pid: r.pid, ppid: r.ppid, start: r.start, cmd: r.cmd, age: fmtAge(r.start, now), kind: 'other', task: null, state: 'other', reapable: false }
    if (hit.length) {
      const done = hit.every(t => fin.get(t))
      Object.assign(item, { kind: kindOf(r.cmd), task: hit[0].id, state: done ? 'finished' : 'live', reapable: done })
    }
    items.push(item)
  }

  for (const w of worktrees) {
    const owners = tasks.filter(t => t.cwd === w.path || (t.worktrees || []).includes(w.path))
    const f = flags[w.path] || {}
    const item = { type: 'worktree', path: w.path, branch: w.branch, head: w.head, task: owners.length ? owners[0].id : null, merged: !!f.merged, dirty: !!f.dirty, removable: false, state: 'keep', reason: '' }
    if (w.main || w.path === mainPath) item.reason = 'main checkout'
    else if (w.bare) item.reason = 'bare'
    else if (w.locked) item.reason = 'locked'
    else if (f.dirty !== false) item.reason = f.dirty === undefined ? 'dirty state unknown' : 'uncommitted changes'
    else if (selfCwds.some(c => c === w.path || String(c).startsWith(`${w.path}/`))) item.reason = 'this session runs inside it'
    else if (owners.some(t => !fin.get(t))) item.reason = 'its task is still running'
    else if (f.merged) { item.removable = true; item.reason = 'merged into main' }
    else if (owners.length && owners.every(t => fin.get(t))) { item.removable = true; item.reason = 'task finished' }
    else item.reason = owners.length ? 'unmerged' : 'unmerged, no task'
    if (item.removable) item.state = 'removable'
    items.push(item)
  }
  return items
}

const ancestorsOf = (rows, pid) => {
  const byPid = new Map(rows.map(r => [r.pid, r]))
  const out = [pid]
  for (let at = byPid.get(pid); at && at.ppid > 0 && !out.includes(at.ppid); at = byPid.get(at.ppid)) out.push(at.ppid)
  return out
}

const below = (rows, root) => {
  const set = new Set([root])
  for (let grew = true; grew; ) {
    grew = false
    for (const r of rows) if (!set.has(r.pid) && set.has(r.ppid)) { set.add(r.pid); grew = true }
  }
  set.delete(root)
  return set
}

// What may be stopped or removed, judged against a FRESH process table. Only finished items are
// considered. A process is dropped when it is gone, was reused (start or cmd differs), is the
// session, above the session, one of selfPids, or a helper of this plugin. A wrapper and its child
// are one job: only the innermost is listed. Worktrees need `removable` from classify.
export function planReap(items, freshPs, selfPids) {
  const fresh = freshPs || []
  const protect = new Set([0, 1])
  for (const p of selfPids || []) for (const a of ancestorsOf(fresh, p)) protect.add(a)
  for (const p of selfPids || []) protect.add(p)

  const cands = []
  for (const it of items || []) {
    if (!it || it.type !== 'proc' || it.state !== 'finished' || !it.reapable) continue
    const now = fresh.find(r => r.pid === it.pid)
    if (!now) continue
    if (now.cmd !== it.cmd || now.start !== it.start) continue
    if (protect.has(it.pid) || OWN.test(now.cmd)) continue
    cands.push(now)
  }
  const kill = cands.filter(c => {
    const inner = below(fresh, c.pid)
    return !cands.some(o => o !== c && inner.has(o.pid))
  })
  const remove = (items || []).filter(it => it && it.type === 'worktree' && it.state === 'removable' && it.removable === true)
  return { kill, remove }
}
