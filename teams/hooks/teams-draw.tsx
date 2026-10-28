/*
 * Teams-only drawing: icons and tints per state, text that is cut with `…`, columns that start at the same
 * character on every row, and the one place lines of segments become Ink Text. Pure: every function takes
 * strings and a width; mod.tsx decides what to show. Width is counted in display cells (Hangul, CJK and emoji
 * take two; combining marks, ZWJ and variation selectors none; the icons and the spinner one).
 */
import type { Handoff, RunNumbers, SummaryItem, SummaryTaskEntry, SummaryWorker, WorkState } from '../types'

export type Tint = 'success' | 'claude' | 'inactive' | 'error' | 'warning'
export type Seg = { t: string; tint?: Tint; dim?: boolean; bold?: boolean }
export type Line = Seg[]
// the resolved components from $.ui.resolve(e)
export type Ui = { Box: any; Text: any }

// display cells of one code point: wide glyphs 2, combining marks / ZWJ / variation selectors 0, the rest 1
function cellsOf(ch: string): number {
  const c = ch.codePointAt(0)!
  if ((c >= 0x300 && c <= 0x36f) || c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f)) return 0
  if (
    (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff)
  ) return 2
  return 1
}

export const width = (s: string) => Array.from(s).reduce((n, ch) => n + cellsOf(ch), 0)
export const padText = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - width(s)))

// cut to w display cells; the cut ends in … and never splits a glyph (a mark or a ZWJ join stays with its base)
export function clipText(s: string, w: number): string {
  if (width(s) <= w) return s
  if (w <= 0) return ''
  const clusters: string[] = []
  let joined = false
  for (const ch of Array.from(s)) {
    if (clusters.length > 0 && (cellsOf(ch) === 0 || joined)) clusters[clusters.length - 1] += ch
    else clusters.push(ch)
    joined = ch === '‍'
  }
  let out = ''
  let used = 0
  for (const cl of clusters) {
    const n = width(cl)
    if (used + n > w - 1) break
    out += cl
    used += n
  }
  return `${out.trimEnd()}…`
}

/* --- icons and tints: one glyph and one colour per state, no faces --- */

export const ICON: Record<WorkState | 'failed', string> = { acting: '●', idle: '◌', you: '⚑', done: '✔', stalled: '⊘', failed: '✘' }
export const TINT: Record<WorkState | 'failed', Tint> = { acting: 'claude', idle: 'inactive', you: 'warning', done: 'success', stalled: 'inactive', failed: 'error' }

// the EPIC list: ● running, ⚑ waits on a person, ⊘ stalled
export const epicState = (t: Pick<SummaryTaskEntry, 'live' | 'state'>): WorkState => (t.state === 'waiting_human' ? 'you' : t.live ? 'acting' : 'stalled')

/* --- numbers and words in a cell --- */

// 35s, 4m, 1h 2m; null is blank
export function since(ms: number | null): string {
  if (ms === null) return ''
  const m = Math.floor(ms / 60000)
  return ms < 60000 ? `${Math.floor(ms / 1000)}s` : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

// `$0.42`, `~$0.42` when estimated, blank when unknown
export const costText = (usd: number | null, estimated: boolean) => (usd === null ? '' : `${estimated ? '~' : ''}$${usd.toFixed(2)}`)

// `2/3`; a known try with no limit is `2/-`; neither is blank
export const tryText = (n: number | null, max: number | null) => (n === null ? '' : `${n}/${max ?? '-'}`)

/* --- columns --- */

// Widths of the columns of `rows` so that they, with `gap` between the non-empty ones, fit `total`. A column with no
// text takes no room. Columns give way in `shrink` order, each down to `min`; whatever is left over is cut by the caller.
// With a `drop` list, a row still too wide after shrinking loses the next listed column whole (width 0, its gap goes with
// it) and shrinks again with the freed room; the first shrink column (the title) keeps `titleMin` until every drop is
// spent, and only then gives way toward `min`. A column cut to 1 cell would be a bare … and becomes 0.
export function columnWidths(
  rows: readonly (readonly string[])[], total: number, gap: number, shrink: readonly number[], min = 4,
  drop: readonly number[] = [], titleMin = min,
): number[] {
  const count = rows.reduce((n, r) => Math.max(n, r.length), 0)
  const natural = Array.from({ length: count }, (_, c) => rows.reduce((n, r) => Math.max(n, width(r[c] ?? '')), 0))
  const plan = (dropped: number, titleFloor: number): number[] => {
    const widths = [...natural]
    for (const c of drop.slice(0, dropped)) if (c < widths.length) widths[c] = 0
    const spent = () => widths.reduce((n, w) => n + w, 0) + gap * Math.max(0, widths.filter(w => w > 0).length - 1)
    shrink.forEach((c, i) => {
      const over = spent() - total
      if (over <= 0) return
      const w = widths[c]
      const floor = i === 0 ? titleFloor : min
      if (w !== undefined && w > floor) widths[c] = Math.max(floor, w - over)
    })
    return widths
  }
  const fits = (ws: readonly number[]) => ws.reduce((n, w) => n + w, 0) + gap * Math.max(0, ws.filter(w => w > 0).length - 1) <= total
  let widths = plan(0, titleMin)
  for (let k = 1; k <= drop.length && !fits(widths); k++) widths = plan(k, titleMin)
  if (!fits(widths)) widths = plan(drop.length, min)
  return widths.map((w, c) => (w === 1 && (natural[c] ?? 0) > 1 ? 0 : w))
}

// one row cut and padded to its column widths; `tints` colour a column, the rest is plain
export function rowLine(cells: readonly string[], widths: readonly number[], gap: number, tints: readonly (Tint | 'dim' | undefined)[] = []): Line {
  const out: Line = []
  widths.forEach((w, c) => {
    if (w <= 0) return
    if (out.length > 0) out.push({ t: ' '.repeat(gap) })
    const tint = tints[c]
    out.push({ t: padText(clipText(cells[c] ?? '', w), w), tint: tint === 'dim' ? undefined : tint, dim: tint === 'dim' })
  })
  return out
}

export const plain = (l: Line) => l.map(s => s.t).join('')

// the one place Ink is touched: lines of segments as Text; a line wider than the pane is cut by the pane
export function renderLines(ui: Ui, lines: readonly Line[], keyOf = 'l') {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column">
      {lines.map((l, i) => (
        <Text key={`${keyOf}${i}`} wrap="truncate-end">
          {l.length === 0 ? ' ' : l.map((s, j) => <Text key={j} color={s.tint} bold={s.bold} dimColor={s.dim}>{s.t}</Text>)}
        </Text>
      ))}
    </Box>
  )
}

/* --- the Floor: worker lines and the hand-off feed --- */

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

// icon · spinner (acting only) · worker · word (node's icon and word; `fixed` localizes a fixed word by its word_key)
export function workerCells(workers: readonly SummaryWorker[], frameNo: number, fixed: (key: string) => string): StoryCells[] {
  return workers.map(w => ({
    cells: [w.icon, w.state === 'acting' ? SPINNER[frameNo % SPINNER.length]! : '', w.id, w.word_key ? fixed(w.word_key) : w.word],
    tints: [TINT[w.state], TINT[w.state], undefined, 'dim'],
  }))
}

// time · who · what · to whom
export const handoffCells = (feed: readonly Handoff[]): string[][] => feed.slice(0, 5).map(h => [h.time, h.from, h.what, h.to ? `→ ${h.to}` : ''])

/* --- the STORY rows --- */

export type StoryCells = { cells: string[]; tints: (Tint | 'dim' | undefined)[] }

export type StoryRow = StoryCells & { note: string }

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

// Line 1: marker · icon · title · doing · verdict · attempt n/max · judge score vs threshold · cost · retry spend · wall ·
// harness (an S task's stages and run). Line 2 (`note`): the gap the judge named when it rejected at or above the
// threshold (`gapWord` words it), else its reason; whole, the caller clips it. The recorded numbers (item.metrics) win
// over the live ones; an item with none (an S task) keeps its try/max, elapsed and cost. `judge` words the score
// (localized by the caller).
export function storyCells(
  item: SummaryItem, verdict: string, harness: string, selected: boolean, fixed: (key: string) => string,
  judge: (score: number, threshold: number | null) => string = (score, threshold) => `judge ${score}${threshold === null ? '' : ` vs ${threshold}`}`,
  gapWord: (gap: string) => string = gap => `own gap: ${gap}`,
): StoryRow {
  const m = item.metrics ?? null
  const j = m?.judge ?? null
  const retry = m?.retry_cost_usd ?? 0
  const recorded = m !== null && ((m.cost_usd ?? 0) > 0 || retry > 0)
  const threshold = j?.threshold ?? null
  const over = j !== null && threshold !== null ? (j.score >= threshold ? 'success' : 'warning') : undefined
  return {
    cells: [
      selected ? '▸' : '', item.icon, item.title, item.word_key ? fixed(item.word_key) : item.word, verdict,
      m === null ? tryText(item.try, item.max) : tryText(m.attempt, m.max_attempts),
      j === null ? '' : judge(j.score, threshold),
      recorded ? costText(m.cost_usd ?? 0, false) : costText(item.cost_usd, item.cost_estimated),
      retry > 0 ? `+${costText(retry, false)}` : '',
      since(m !== null && (m.wall_ms ?? 0) > 0 ? m.wall_ms : item.elapsed_ms),
      harness,
    ],
    tints: [undefined, TINT[item.state], undefined, undefined, undefined, m?.out_of_retries ? 'error' : undefined, over, 'dim', 'dim', 'dim', 'dim'],
    note: j?.gap ? gapWord(oneLine(j.gap)) : j?.reason ? oneLine(j.reason) : '',
  }
}
// the harness text gives way first, then doing, then the title; the second line (note) is clipped by the caller
export const STORY_SHRINK = [10, 3, 2] as const

export type Say = (key: string, vars?: Record<string, string | number>) => string

// The Home tab's task-level numbers, one per line as label · value: budget, drivers live/cap, stalled drivers, denials,
// defects, STORYs out of retries, scoped out. Lines with nothing to say (no budget, no stall, none out of retries) are left out.
export function runCells(run: RunNumbers, say: Say): StoryCells[] {
  const usd = (n: number) => `$${n.toFixed(2)}`
  const out: StoryCells[] = []
  const add = (label: string, value: string, tint?: Tint) => out.push({ cells: [label, value], tints: ['dim', tint] })
  if (run.budget !== null) add(say('runBudget'), say('runBudgetOf', { spent: usd(run.budget.spent_usd), limit: usd(run.budget.limit_usd) }), run.budget.spent_usd >= run.budget.limit_usd ? 'warning' : undefined)
  const d = run.drivers
  if (d.live !== null) add(say('runDrivers'), d.cap === null ? say('runLive', { n: d.live }) : say('runLiveCap', { n: d.live, cap: d.cap }))
  if (d.stalled.length > 0) add(say('runStalled'), d.stalled.map(x => say('runStalledOne', { id: x.id ?? '·', m: x.minutes })).join(', '), 'warning')
  add(say('runDenials'), String(run.denials))
  add(say('runDefects'), say('runDefectsOf', { filed: run.defects.filed, dropped: run.defects.dropped }))
  if (run.out_of_retries.length > 0) add(say('runOutOfRetries'), run.out_of_retries.join(', '), 'error')
  if (run.scoped_out > 0) add(say('runScopedOut'), String(run.scoped_out))
  return out
}

// The EPIC row is the title block: marker · icon · key · title · state word · done/total · age. The slug is not a pane
// column (the Report header and view.mjs show it). A live task's age runs
// from its creation, a stalled one's is how long it has stood; a stalled row is dim throughout.
export function epicCells(t: SummaryTaskEntry, state: WorkState, selected: boolean, now: number, stateWord: string): StoryCells {
  const cells = [
    selected ? '▸' : '', ICON[state], t.key, t.title, stateWord, `${t.done}/${t.total}`,
    since(t.live ? (t.created_at === null ? null : Math.max(0, now - t.created_at)) : t.age_ms),
  ]
  return { cells, tints: t.live ? [undefined, TINT[state], undefined, undefined, 'dim', undefined, 'dim'] : cells.map(() => 'dim' as const) }
}

/* --- the tab row and the footer, planned against the pane's inner width --- */

// The tab row on one line of `inner` columns. The cost text goes first (shown only when tabs and cost fit), then the
// gap between tabs closes from 2 to 1, then the longest label is cut with … until the row fits.
export function tabRowPlan(labels: readonly string[], cost: string, inner: number): { labels: string[]; gap: number; cost: string | null } {
  const total = (ls: readonly string[], gap: number) => ls.reduce((n, l) => n + width(l), 0) + gap * Math.max(0, ls.length - 1)
  if (cost !== '' && total(labels, 2) + 2 + width(cost) <= inner) return { labels: [...labels], gap: 2, cost }
  if (total(labels, 2) <= inner) return { labels: [...labels], gap: 2, cost: null }
  const out = [...labels]
  while (total(out, 1) > inner) {
    let at = 0
    out.forEach((l, i) => { if (width(l) > width(out[at]!)) at = i })
    if (width(out[at]!) <= 4) break
    out[at] = clipText(labels[at]!, width(out[at]!) - 1)
  }
  return { labels: out, gap: 1, cost: null }
}

// The Input draws its own `⏎ submit` (9 columns and a gap) beside the hint while focused.
const INPUT_CHROME = 10

// The footer on one line: close stays whole; prev/next and the open hint stay when they fit; the key hint takes what is
// left and ends in … when cut, or is dropped when under 6 columns remain.
export function footerPlan(parts: { steps: number; open: string; close: string; hint: string }, inner: number): { hint: string } {
  const fixed = [parts.steps > 0 ? parts.steps + 2 * (parts.steps - 1) : 0, width(parts.open), width(parts.close)].filter(n => n > 0)
  const room = inner - INPUT_CHROME - fixed.reduce((n, w) => n + w, 0) - 2 * fixed.length
  return { hint: room >= 6 ? clipText(parts.hint, room) : '' }
}
