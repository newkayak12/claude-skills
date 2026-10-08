import { descendants, matchOrphans } from './procs.ts'
import type { Row } from './procs.ts'

export type Verdict = { ok: true; pid: number } | { ok: false; reason: string; gone?: boolean }

// What `$.process.run` itself starts for this module: never a target.
const OWN = /^(ps -A |sh -c echo \$PPID)/

// May `seen` (the row the person saw) be signalled, judged against a FRESH process table?
// Every refusal is a reason for a toast; none sends anything.
export const checkKill = (seen: Row, fresh: Row[], engine: number, ancestors: number[]): Verdict => {
  if (!Number.isInteger(engine) || engine <= 0) return { ok: false, reason: 'the session process is unknown' }
  if (seen.pid === engine) return { ok: false, reason: 'that is the session itself' }
  if (ancestors.includes(seen.pid)) return { ok: false, reason: 'that process is above the session' }
  const now = fresh.find(r => r.pid === seen.pid)
  if (!now) return { ok: false, reason: 'already gone', gone: true }
  if (!descendants(fresh, engine).some(r => r.pid === seen.pid)) return { ok: false, reason: 'no longer a child of this session' }
  if (now.cmd !== seen.cmd || now.start !== seen.start) return { ok: false, reason: 'the process changed since it was listed (pid reused?)' }
  if (OWN.test(now.cmd)) return { ok: false, reason: 'that is a helper of this plugin' }
  if (!matchOrphans(fresh, engine).some(r => r.pid === seen.pid)) return { ok: false, reason: 'not a claude -p job' }
  return { ok: true, pid: seen.pid }
}
