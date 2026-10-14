/*
 * What the harness pane shows, as plain functions: the reasons the run files hold and the flow built
 * from them. No engine calls here; mod.tsx reads the files and draws what these return.
 */
import type { RunInfo, StageKey, StageMark } from '../types'

export const NONE = '—' // the harness records no vendor or model, so the agent column reads this

const oneLine = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

// a reason field is a string, or a list of strings / { text | reason | message } entries
function texts(v: unknown): string[] {
  if (typeof v === 'string') return v.trim() === '' ? [] : [v]
  if (!Array.isArray(v)) return []
  return v.flatMap(x => {
    if (typeof x === 'string') return texts(x)
    if (typeof x === 'object' && x !== null) {
      const r = x as Record<string, unknown>
      return texts(r.text ?? r.reason ?? r.message ?? r.problem ?? r.gap)
    }
    return []
  })
}

const join = (parts: string[], max: number) => oneLine(parts.join('; '), max)

// 02-critique.json: why the critique was not sound (blocking, problems, reason)
export function critiqueReason(c: Record<string, unknown> | undefined): string {
  if (c === undefined) return ''
  return join([...texts(c.reason), ...texts(c.blocking), ...texts(c.problems)], 240)
}

// subgoals/<id>/gate-<n>.json {pass, reason, gaps[]}
export function gateReason(g: Record<string, unknown> | undefined): string {
  if (g === undefined) return ''
  return join([...texts(g.reason), ...texts(g.gaps)], 240)
}

// 04-goal-gate.json {match_pct, pass, reason}
export function goalReason(g: Record<string, unknown> | undefined): string {
  if (g === undefined) return ''
  return join([...texts(g.reason), ...texts(g.out_of_spec)], 240)
}

// 45s, 3m 12s, 1h 5m; '' when unknown
export function clock(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return ''
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

// Elapsed on the Now line: the harness writes no start time, so this is the time since the run's
// newest file changed. A finished run has none.
export const sinceLast = (r: RunInfo, now: number) => (r.finished || r.lastMs <= 0 ? '' : clock(now - r.lastMs))

export type FlowLine = {
  kind: 'stage' | 'sub' | 'attempt'
  depth: number // an attempt: 0 first gate verdict, each retry one deeper, under the reject it answers
  state: StageMark
  stage?: StageKey
  id?: string
  title?: string
  n?: number
  reason: string // why it was rejected; '' when it was not
}

// Stages in order; the implement stage opens into its subgoals, each with its gate verdicts, a retry nested
// under the reject it answers. Critique and goal-gate rejects carry their reason.
export function flowLines(r: RunInfo): FlowLine[] {
  const out: FlowLine[] = []
  for (const g of r.stages) {
    if (g.key === 'implement' && r.subs.length > 0) {
      for (const sub of r.subs) {
        out.push({ kind: 'sub', depth: 0, state: sub.state, id: sub.id, title: sub.title, reason: '' })
        sub.gates.forEach((gt, i) =>
          out.push({ kind: 'attempt', depth: i, state: gt.pass ? 'done' : 'failed', id: sub.id, n: gt.n, reason: gt.pass ? '' : gt.reason }),
        )
      }
      continue
    }
    const reason = g.key === 'critique' ? (g.state === 'failed' ? r.critique.reason : '') : g.key === 'gate' && g.state === 'failed' ? r.goalReason : ''
    out.push({ kind: 'stage', depth: 0, state: g.state, stage: g.key, reason })
  }
  return out
}
