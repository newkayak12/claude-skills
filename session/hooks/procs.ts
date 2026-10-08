// Pure process-table logic over `ps -A -o pid=,ppid=,lstart=,command=` text.

export type Row = { pid: number; ppid: number; start: string; cmd: string }

export const PS_ARGV = ['ps', '-A', '-o', 'pid=,ppid=,lstart=,command='] as const

const CLAUDE_P = /\bclaude\b.*\s-p(\s|$)/
const LINE = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d{1,2}:\d\d:\d\d\s+\d{4})\s+(.*)$/

// A line that does not parse is skipped.
export const parsePs = (text: string): Row[] =>
  text.split('\n').flatMap(line => {
    const m = LINE.exec(line)
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), start: (m[3] ?? '').replace(/\s+/g, ' '), cmd: m[4] ?? '' }] : []
  })

// Everything below `engine` in the tree, the engine itself excluded.
export const descendants = (rows: Row[], engine: number): Row[] => {
  const below = new Set<number>([engine])
  for (let grew = true; grew; ) {
    grew = false
    for (const r of rows) {
      if (!below.has(r.pid) && below.has(r.ppid)) {
        below.add(r.pid)
        grew = true
      }
    }
  }
  return rows.filter(r => below.has(r.pid) && r.pid !== engine)
}

// The pids from `engine` up to the root, engine included.
export const ancestorsOf = (rows: Row[], engine: number): number[] => {
  const byPid = new Map(rows.map(r => [r.pid, r]))
  const out: number[] = [engine]
  for (let at = byPid.get(engine); at && at.ppid > 0 && !out.includes(at.ppid); at = byPid.get(at.ppid)) out.push(at.ppid)
  return out
}

// `claude -p` children of the engine; a wrapper shell and its child are one job: the outer one is listed.
export const matchOrphans = (rows: Row[], engine: number): Row[] => {
  const hits = descendants(rows, engine).filter(r => CLAUDE_P.test(r.cmd))
  const pids = new Set(hits.map(r => r.pid))
  return hits.filter(r => !pids.has(r.ppid))
}

// `Wed Oct  8 10:09:00 2026` (local time) against now; '' when the text does not parse.
export const fmtAge = (start: string, now: number): string => {
  const t = Date.parse(start)
  if (Number.isNaN(t) || now < t) return ''
  const s = Math.floor((now - t) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}
