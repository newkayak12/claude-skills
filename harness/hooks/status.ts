/*
 * What the harness pane shows, as plain functions: the reasons the run files hold and the flow built
 * from them. No engine calls here; mod.tsx reads the files and draws what these return.
 */
import type { HarnessRow, PaneTab, RowNow, RowProblem, RowRound, RowStage, RowWaiting, RunInfo, Severity, StageKey, StageMark } from '../types'

export const NONE = '—' // the harness records no vendor or model, so the agent column reads this

const oneLine = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/*
 * The failed stages of a run as `node engine/fallback-check.mjs` gives them (`failures` on each row): the reason, the
 * next step and the severity are the node's; these are readers and a text builder, they decide nothing. Local to this
 * file: HarnessRow in ../types is not widened, a row carries `failures` as RunRow.
 */
export type FailureSeverity = 'info' | 'needs you' | 'gave up'
export type RowFailure = { key: string; at: number; what: string; reason: string; next_step: string | null; severity: FailureSeverity }
export type RunRow = HarnessRow & { failures: RowFailure[] }

const FAILURE_SEVERITIES: readonly string[] = ['info', 'needs you', 'gave up']
const FAILURE_MARK: Record<FailureSeverity, string> = { info: '↻', 'needs you': '⚠', 'gave up': '✗' }
export const FAILURE_TOAST_MS = 10_000 // the toast of a failure that needs a person or ended the run; info keeps the default
const PUSH_MAX = 200

// One failure, tolerant: a field of the wrong type drops the whole entry (never a guess).
export function normalizeFailure(v: unknown): RowFailure | null {
  const o = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  if (o === null || typeof o.key !== 'string' || o.key === '' || typeof o.at !== 'number' || !Number.isFinite(o.at)) return null
  if (typeof o.what !== 'string' || typeof o.reason !== 'string' || !FAILURE_SEVERITIES.includes(o.severity as string)) return null
  if (o.next_step !== null && typeof o.next_step !== 'string') return null
  return { key: o.key, at: o.at, what: o.what, reason: o.reason, next_step: o.next_step, severity: o.severity as FailureSeverity }
}

// a row's failures, oldest first as the node lists them; a row the node did not give (the demo's) has none
export const failuresOf = (r: HarnessRow): RowFailure[] => (r as Partial<RunRow>).failures ?? []

// The reason of the newest failure under a key: the key itself or a longer one at a `|` (so `r|gate|S1|1` is not `r|gate|S1|10`).
export function reasonFor(failures: readonly RowFailure[], key: string): string {
  return failures.filter(f => f.key === key || f.key.startsWith(`${key}|`)).pop()?.reason ?? ''
}

// `<icon> <run> <what> failed: <reason> → <next_step>` (no arrow without a next step); a failure that needs a person or
// gave up also has a push text (cut at 200) and a longer toast. The icon and the timeout follow the severity only.
export function failureToast(run: string, f: RowFailure): { text: string; pushText: string | null; timeoutMs?: number } {
  const text = `${FAILURE_MARK[f.severity]} ${run} ${f.what} failed: ${f.reason}${f.next_step === null ? '' : ` → ${f.next_step}`}`
  return f.severity === 'info' ? { text, pushText: null } : { text, pushText: text.slice(0, PUSH_MAX), timeoutMs: FAILURE_TOAST_MS }
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

/*
 * The rows of `node engine/fallback-check.mjs --list --json`: what the pane and band say about each open
 * run. Glyph-free; harness-draw.tsx owns the glyphs and the layout.
 */

export const SEVERITIES = ['blocker', 'major', 'minor', 'nit'] as const
const ROW_STAGES: readonly RowStage[] = ['plan', 'setgoal', 'critique', 'implement', 'gate', 'report']

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0)
const orNull = (v: unknown) => (typeof v === 'string' ? v : null)

export const emptySeverity = (): Severity => ({ blocker: 0, major: 0, minor: 0, nit: 0 })

function normalizeWaiting(v: unknown): RowWaiting | null {
  const o = obj(v)
  if (o === null || (o.who !== 'you' && o.who !== 'vendor') || typeof o.what !== 'string') return null
  return { who: o.who, what: o.what }
}

function normalizeNow(v: unknown): RowNow | null {
  const o = obj(v)
  if (o === null) return null
  return {
    stage: orNull(o.stage), doing: orNull(o.doing),
    round: typeof o.round === 'number' && Number.isInteger(o.round) ? o.round : null,
    last_step: orNull(o.last_step), next: orNull(o.next), waiting: normalizeWaiting(o.waiting),
    cost_usd: typeof o.cost_usd === 'number' && Number.isFinite(o.cost_usd) ? o.cost_usd : null,
    at: orNull(o.at), since: orNull(o.since),
  }
}

function normalizeRound(v: unknown, i: number): RowRound {
  const o = obj(v) ?? {}
  const problems: RowProblem[] = (Array.isArray(o.problems) ? (o.problems as unknown[]) : []).map(p => {
    const q = obj(p)
    const sev = String(q?.severity ?? '').toLowerCase()
    return {
      severity: (SEVERITIES as readonly string[]).includes(sev) ? (sev as RowProblem['severity']) : 'major',
      text: oneLine(q?.text ?? (typeof p === 'string' ? p : ''), 240),
    }
  })
  return { round: typeof o.round === 'number' && Number.isInteger(o.round) && o.round >= 1 ? o.round : i + 1, sound: typeof o.sound === 'boolean' ? o.sound : null, problems }
}

export function severityOf(problems: readonly RowProblem[]): Severity {
  const out = emptySeverity()
  for (const p of problems) out[p.severity]++
  return out
}

// One row, tolerant: a missing or malformed field takes a safe default and nothing throws. No slug, no row.
export function normalizeRow(v: unknown): RunRow | null {
  const o = obj(v)
  if (o === null || typeof o.slug !== 'string' || o.slug === '') return null
  const rounds = (Array.isArray(o.rounds) ? (o.rounds as unknown[]) : []).map(normalizeRound)
  const sev = obj(o.severity)
  const now = normalizeNow(o.now)
  const cap = o.max_critique_rounds
  return {
    slug: o.slug,
    stage: ROW_STAGES.includes(o.stage as RowStage) ? (o.stage as RowStage) : 'plan',
    round: typeof o.round === 'number' && Number.isInteger(o.round) ? o.round : null,
    waiting: normalizeWaiting(o.waiting) ?? now?.waiting ?? null,
    stalled: o.stalled === true,
    now,
    started_at: orNull(o.started_at),
    max_critique_rounds: typeof cap === 'number' && Number.isInteger(cap) && cap >= 1 ? cap : 2,
    severity: sev === null ? severityOf(rounds.flatMap(r => r.problems)) : { blocker: count(sev.blocker), major: count(sev.major), minor: count(sev.minor), nit: count(sev.nit) },
    rounds, passed: count(o.passed), failed: count(o.failed), total: count(o.total),
    failures: (Array.isArray(o.failures) ? (o.failures as unknown[]) : []).map(normalizeFailure).filter((f): f is RowFailure => f !== null),
  }
}

// The --list --json output. Empty, invalid or not a list is null: the caller keeps its last good list.
// `[]` is a real answer (no open runs).
export function parseRows(text: unknown): HarnessRow[] | null {
  if (typeof text !== 'string' || text.trim() === '') return null
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(v)) return null
  return v.map(normalizeRow).filter((r): r is RunRow => r !== null)
}

// The `--show <dir> --json` output: one row. Anything else is null.
export function parseRow(text: unknown): RunRow | null {
  if (typeof text !== 'string' || text.trim() === '') return null
  try {
    return normalizeRow(JSON.parse(text))
  } catch {
    return null
  }
}

export const waitsOnYou = (r: HarnessRow) => r.waiting?.who === 'you'
// rejects the person can have seen: rejected critique rounds and failed subgoals
export const rejectCount = (r: HarnessRow) => r.rounds.filter(x => x.sound === false).length + r.failed
export const hasNewReject = (r: HarnessRow, looked: Record<string, number>) => rejectCount(r) > (looked[r.slug] ?? 0)
export const markLooked = (looked: Record<string, number>, r: HarnessRow | null): Record<string, number> =>
  r === null || looked[r.slug] === rejectCount(r) ? looked : { ...looked, [r.slug]: rejectCount(r) }

// The run waiting on you, else one with a reject since you last looked, else the most recently changed
// (--list already sorts newest first; the sort here is stable).
export function openingOrder(rows: readonly HarnessRow[], looked: Record<string, number>): HarnessRow[] {
  const rank = (r: HarnessRow) => (waitsOnYou(r) ? 0 : hasNewReject(r, looked) ? 1 : 2)
  return rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map(x => x.r)
}

// openingOrder, kept: `frozen` is the slug order of the last call. While the open slugs are the same set, that order
// stands, so a look (markLooked) or a changed row never moves a run under `[` / `]`; a run that opens or closes, or
// no `frozen` (null), orders again from `looked`.
export function frozenOrder(rows: readonly HarnessRow[], looked: Record<string, number>, frozen: readonly string[] | null): HarnessRow[] {
  const bySlug = new Map(rows.map(r => [r.slug, r]))
  const same = frozen !== null && frozen.length === rows.length && bySlug.size === rows.length && frozen.every(s => bySlug.has(s))
  return same ? frozen.map(s => bySlug.get(s)!) : openingOrder(rows, looked)
}

// The run shown: the selected slug while it is open, else the first in opening order.
export const pickRun = (ordered: readonly HarnessRow[], selected: string | null): HarnessRow | null =>
  ordered.find(r => r.slug === selected) ?? ordered[0] ?? null

export function runPosition(ordered: readonly HarnessRow[], selected: string | null): { k: number; n: number } {
  const at = ordered.findIndex(r => r.slug === pickRun(ordered, selected)?.slug)
  return { k: at < 0 ? 0 : at + 1, n: ordered.length }
}

export const runCount = ({ k, n }: { k: number; n: number }, compact = false) => (compact ? `${k}/${n}` : `run ${k} of ${n}`)

// `[` and `]`: the slug a step lands on, stopping at the first and the last run; with fewer than two runs, nothing changes.
export function cycleRun(ordered: readonly HarnessRow[], selected: string | null, step: 1 | -1): string | null {
  if (ordered.length < 2) return selected
  const at = Math.max(0, ordered.findIndex(r => r.slug === pickRun(ordered, selected)?.slug))
  return ordered[Math.min(ordered.length - 1, Math.max(0, at + step))]!.slug
}

const STAGE_NAME: Record<RowStage, string> = { plan: 'Plan', setgoal: 'SetGoal', critique: 'Critique', implement: 'Implement', gate: 'Goal gate', report: 'Report' }
export const stageName = (s: RowStage) => STAGE_NAME[s]

// `Implement 2/4`, `Critique round 2`; ` · stalled` when it is
export function stageLabel(r: HarnessRow): string {
  const base = r.stage === 'implement' && r.total > 0 ? `${STAGE_NAME.implement} ${r.passed}/${r.total}` : STAGE_NAME[r.stage]
  return r.stalled ? `${base} · stalled` : base
}

// The tab row's right side: the run `]` would open (on the last run, the previous one), and how many more there are
export function otherRunLabel(ordered: readonly HarnessRow[], selected: string | null): string | null {
  if (ordered.length < 2) return null
  const at = Math.max(0, ordered.findIndex(r => r.slug === pickRun(ordered, selected)?.slug))
  const other = ordered[at + 1 < ordered.length ? at + 1 : at - 1]!
  return `other run: ${other.slug} · ${stageLabel(other)}${ordered.length > 2 ? ` (+${ordered.length - 2})` : ''}`
}

/* --- the spinner --- */

// Acting: now.json is there, the run waits on no one, and it is not stalled (it is open: the list holds only open runs).
export const isActing = (r: HarnessRow) => r.now !== null && r.waiting === null && !r.stalled

// The faster interval runs only while a displayed run acts, a pane or band is shown, and a surface exists.
export const spinnerPlan = (rows: readonly (HarnessRow | null)[], surfaces: number, shown: boolean): { run: boolean } => ({
  run: surfaces > 0 && shown && rows.some(r => r !== null && isActing(r)),
})

/* --- times, cost, sentences --- */

export const parseMs = (iso: string | null): number | null => {
  const t = iso === null ? NaN : Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

// 45s, 6m, 1h 12m; '' when unknown
export function span(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return ''
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

const since = (iso: string | null, nowMs: number) => {
  const t = parseMs(iso)
  return t === null ? '' : span(nowMs - t)
}

// `$3.40`, or `—` unless now.json carries a number
export const costText = (r: HarnessRow) => (r.now?.cost_usd != null ? `$${r.now.cost_usd.toFixed(2)}` : NONE)
export const elapsedText = (r: HarnessRow, nowMs: number) => since(r.started_at, nowMs)
export const runState = (r: HarnessRow) => (r.stalled ? 'stalled' : waitsOnYou(r) ? 'waiting on you' : 'running')

const STAGE_DOING: Record<RowStage, string> = {
  plan: 'Plan is drafting the approach',
  setgoal: 'SetGoal is writing the goal spec',
  critique: 'Critique is judging the spec',
  implement: 'Subgoals are being built and judged',
  gate: 'The goal gate is judging the result',
  report: 'Report is being written',
}

// what the run is doing, in a sentence: now.doing (canned false), else the stage's own (canned true)
export function doingOf(r: HarnessRow): { text: string; canned: boolean } {
  const live = oneLine(r.now?.doing ?? '', 200)
  return live === '' ? { text: STAGE_DOING[r.stage], canned: true } : { text: live, canned: false }
}
export const doingText = (r: HarnessRow) => doingOf(r).text

// The status line: open runs per stage in flow order, `Plan(6) / Implement(11)`; a stalled row counts under its stage;
// no rows is no status.
export function stageStatus(rows: readonly HarnessRow[]): string | undefined {
  const parts = ROW_STAGES.map(s => ({ s, n: rows.filter(r => r.stage === s).length })).filter(x => x.n > 0)
  return parts.length === 0 ? undefined : parts.map(({ s, n }) => `${s.charAt(0).toUpperCase()}${s.slice(1)}(${n})`).join(' / ')
}

export const roundText = (r: HarnessRow, compact = false) =>
  r.round === null ? '' : compact ? `round ${r.round}/${r.max_critique_rounds}` : `round ${r.round} of ${r.max_critique_rounds}`

export const inStageText = (r: HarnessRow, nowMs: number, compact = false) => {
  const t = since(r.now?.since ?? null, nowMs)
  return t === '' ? '' : compact ? t : `${t} in this stage`
}

// the driver's latest step and how old it is; '—' and no age when it wrote none
export function lastStep(r: HarnessRow, nowMs: number): { text: string; age: string } {
  const text = oneLine(r.now?.last_step ?? '', 120)
  const age = since(r.now?.at ?? null, nowMs)
  return text === '' ? { text: NONE, age: '' } : { text, age: age === '' ? '' : `${age} ago` }
}

// The You line without its glyph: you = the run waits on a person (⚑ in the pane)
export function youLine(r: HarnessRow): { you: boolean; text: string } {
  if (r.waiting?.who === 'you') return { you: true, text: oneLine(r.waiting.what, 200) }
  const next = oneLine(r.now?.next ?? '', 200)
  const vendor = r.waiting?.who === 'vendor' ? `waiting on a vendor: ${oneLine(r.waiting.what, 120)}` : ''
  return { you: false, text: ['nothing needed', vendor, next === '' ? '' : `next: ${next}`].filter(Boolean).join(' · ') }
}

/* --- the rail: a loop shows as repeats --- */

export type RailMark = 'done' | 'failed' | 'current' | 'pending'
export type RailItem = { label: string; short: string; mark: RailMark }

const STAGE_AT: Record<RowStage, number> = { plan: 0, setgoal: 1, critique: 2, implement: 3, gate: 4, report: 5 }

// Plan, SetGoal, then Critique and (when it rejected) SetGoal again, until a critique accepts; then the subgoals,
// the goal gate, the report. A round exists once its critique file does, so the one in progress is the pending
// or current item after the last round.
export function railItems(r: HarnessRow): RailItem[] {
  const at = STAGE_AT[r.stage]
  const item = (label: string, mark: RailMark, short = label): RailItem => ({ label, short, mark })
  const items: RailItem[] = [
    item('Plan', at === 0 ? 'current' : 'done'),
    item('SetGoal', at > 1 || r.rounds.length > 0 ? 'done' : at === 1 ? 'current' : 'pending'),
  ]
  r.rounds.forEach((rd, i) => {
    items.push(item('Critique', rd.sound === false ? 'failed' : 'done'))
    if (rd.sound !== false) return
    const lastRound = i === r.rounds.length - 1
    // the last rejected round at the cap goes on to implement (fallback.md): its SetGoal again is drawn only while current
    if (lastRound && r.rounds.length >= r.max_critique_rounds && at !== 1) return
    items.push(item('SetGoal again', !lastRound || at > 1 ? 'done' : at === 1 ? 'current' : 'pending', 'SetGoal'))
  })
  const latest = r.rounds[r.rounds.length - 1]
  if (latest === undefined || (latest.sound === false && r.rounds.length < r.max_critique_rounds)) items.push(item('Critique', at === 2 ? 'current' : at > 2 ? 'done' : 'pending'))
  const judged = r.total > 0 && r.passed + r.failed >= r.total
  items.push(item(r.total > 0 ? `Subgoals ${r.passed}/${r.total}` : 'Subgoals', at === 3 ? 'current' : at > 3 ? (r.failed > 0 && judged ? 'failed' : 'done') : 'pending'))
  items.push(item('Goal gate', at === 4 ? 'current' : at > 4 ? 'done' : 'pending', 'Gate'))
  items.push(item('Report', at === 5 ? 'current' : 'pending'))
  return items
}

/* --- findings --- */

// `4 major, 1 nit`; `no findings` when there are none
export function countsText(s: Severity): string {
  const parts = SEVERITIES.filter(k => s[k] > 0).map(k => `${s[k]} ${k}`)
  return parts.length === 0 ? 'no findings' : parts.join(', ')
}

export const latestRound = (r: HarnessRow): RowRound | null => r.rounds[r.rounds.length - 1] ?? null
const verdictOf = (rd: RowRound) => (rd.sound === false ? 'rejected' : rd.sound === true ? 'sound' : 'judged')

// `Critique round 1 · rejected · 4 major, 1 nit`: the Now view's findings heading; null before any critique
export function roundHeading(rd: RowRound | null, compact = false): string | null {
  if (rd === null) return null
  return `${compact ? `Critique r${rd.round}` : `Critique round ${rd.round}`} · ${verdictOf(rd)} · ${countsText(severityOf(rd.problems))}`
}

// the round's problems, most severe first (stable), numbered as the round lists them
export function rankedProblems(rd: RowRound | null): { n: number; severity: RowProblem['severity']; text: string }[] {
  if (rd === null) return []
  return rd.problems
    .map((p, i) => ({ n: i + 1, severity: p.severity, text: oneLine(p.text, 240) }))
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.n - b.n)
}

// the counts of what a list cut to `shown` entries leaves out: `2 major, 1 nit`; '' when nothing
export function restText(rd: RowRound | null, shown: number): string {
  const rest = rankedProblems(rd).slice(shown)
  return rest.length === 0 ? '' : countsText(severityOf(rest))
}

// `+3: 2 major, 1 nit`: the pane's cut-count line; '' when nothing is cut
export function restLine(rd: RowRound | null, shown: number): string {
  const rest = rankedProblems(rd).slice(shown)
  return rest.length === 0 ? '' : `+${rest.length}: ${countsText(severityOf(rest))}`
}

// the most severe finding of the latest round that has any
export function topFinding(r: HarnessRow): string | null {
  for (let i = r.rounds.length - 1; i >= 0; i--) {
    const first = rankedProblems(r.rounds[i]!)[0]
    if (first !== undefined && first.text !== '') return first.text
  }
  return null
}

/* --- what the mod reads and shows --- */

// The one reader of the run files is the node CLI (it works with no mod, compat-claude); the mod runs it.
export const listArgv = (pluginRoot: string, cwd: string): string[] => ['node', `${pluginRoot}/engine/fallback-check.mjs`, '--list', '--json', '--cwd', cwd]
// A finished run is not in the list; its own failures are the node's answer for its directory.
export const showArgv = (pluginRoot: string, runDir: string): string[] => ['node', `${pluginRoot}/engine/fallback-check.mjs`, '--show', runDir, '--json']

// The rows on screen: the band's leading run, and the pane's run while the pane is open.
export function shownRows(ordered: readonly HarnessRow[], selected: string | null, paneOpen: boolean): HarnessRow[] {
  const lead = ordered[0]
  if (lead === undefined) return []
  const picked = paneOpen ? pickRun(ordered, selected) : null
  return picked === null || picked === lead ? [lead] : [lead, picked]
}

// The pane opens on Now when a run is open, else on the gate rules (the one tab that answers with no run).
export const openTab = (hasRun: boolean): PaneTab => (hasRun ? 'now' : 'rules')

/* --- the run-switch keys `[` and `]` --- */

// `[` is the previous run, `]` the next. A Button hotkey cannot be either (the engine takes one digit or lowercase
// letter), so the pane draws an autoFocus Input that takes every printable key while the pane holds the focus (the
// moment hotkeys are armed too); the Input's text is read here, its last character is the key just pressed.
export type PaneKey = { kind: 'step'; by: 1 | -1 } | { kind: 'tab'; tab: PaneTab } | { kind: 'close' } | null

const KEY_TABS: Record<string, PaneTab> = { '1': 'now', '2': 'flow', '3': 'findings', '4': 'rules' }

// `[` / `]` step the run, `1`-`4` pick a tab, `q` closes; any other text (or none, or a non-string) is no key.
export function paneKey(text: unknown): PaneKey {
  if (typeof text !== 'string' || text === '') return null
  const k = [...text].pop()!
  if (k === ']') return { kind: 'step', by: 1 }
  if (k === '[') return { kind: 'step', by: -1 }
  if (k === 'q') return { kind: 'close' }
  const tab = KEY_TABS[k]
  return tab === undefined ? null : { kind: 'tab', tab }
}
