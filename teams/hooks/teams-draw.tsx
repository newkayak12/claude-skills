/*
 * Teams-only drawing: icons and tints per state, text that is cut with `…`, columns that start at the same
 * character on every row, and the one place lines of segments become Ink Text. Pure: every function takes
 * strings and a width; mod.tsx decides what to show. Width is counted in code points (every glyph used is
 * one column).
 */
import type { Handoff, SummaryItem, SummaryTaskEntry, SummaryWorker, WorkState } from '../types'

export type Tint = 'success' | 'claude' | 'inactive' | 'error' | 'warning'
export type Seg = { t: string; tint?: Tint; dim?: boolean; bold?: boolean }
export type Line = Seg[]
// the resolved components from $.ui.resolve(e)
export type Ui = { Box: any; Text: any }

export const width = (s: string) => Array.from(s).length
export const padText = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - width(s)))

// cut to w columns; the cut ends in …
export function clipText(s: string, w: number): string {
  if (width(s) <= w) return s
  if (w <= 0) return ''
  return `${Array.from(s).slice(0, w - 1).join('').trimEnd()}…`
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
export function columnWidths(rows: readonly (readonly string[])[], total: number, gap: number, shrink: readonly number[], min = 4): number[] {
  const count = rows.reduce((n, r) => Math.max(n, r.length), 0)
  const widths = Array.from({ length: count }, (_, c) => rows.reduce((n, r) => Math.max(n, width(r[c] ?? '')), 0))
  const spent = () => widths.reduce((n, w) => n + w, 0) + gap * Math.max(0, widths.filter(w => w > 0).length - 1)
  for (const c of shrink) {
    const over = spent() - total
    if (over <= 0) break
    const w = widths[c]
    if (w !== undefined && w > min) widths[c] = Math.max(min, w - over)
  }
  return widths
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

// icon · spinner (acting only) · worker · doing (an idle worker says `idleWord` in the same column, dim)
export function workerCells(workers: readonly SummaryWorker[], frameNo: number, idleWord: string): StoryCells[] {
  return workers.map(w => ({
    cells: [ICON[w.state], w.state === 'acting' ? SPINNER[frameNo % SPINNER.length]! : '', w.id, w.state === 'idle' ? idleWord : w.doing],
    tints: [TINT[w.state], TINT[w.state], undefined, 'dim'],
  }))
}

// time · who · what · to whom
export const handoffCells = (feed: readonly Handoff[]): string[][] => feed.slice(0, 5).map(h => [h.time, h.from, h.what, h.to ? `→ ${h.to}` : ''])

/* --- the STORY rows --- */

export type StoryCells = { cells: string[]; tints: (Tint | 'dim' | undefined)[] }

// icon · title · doing · verdict · try/max · elapsed · cost · harness (an S task's stages and run)
export function storyCells(item: SummaryItem, verdict: string, harness: string, selected: boolean): StoryCells {
  return {
    cells: [
      selected ? '▸' : '', ICON[item.state], item.title, item.doing, verdict, tryText(item.try, item.max),
      since(item.elapsed_ms), costText(item.cost_usd, item.cost_estimated), harness,
    ],
    tints: [undefined, TINT[item.state], undefined, undefined, undefined, 'dim', 'dim', 'dim', 'dim'],
  }
}
// the harness text gives way first, then doing, then the title
export const STORY_SHRINK = [8, 3, 2] as const

// The EPIC row is the title block: marker · icon · key · slug · title · state word · done/total · age. The slug is read
// from the summary, blank when the task has none (its column then takes no room). A live task's age runs
// from its creation, a stalled one's is how long it has stood; a stalled row is dim throughout.
export function epicCells(t: SummaryTaskEntry, state: WorkState, selected: boolean, now: number, stateWord: string): StoryCells {
  const cells = [
    selected ? '▸' : '', ICON[state], t.key, t.slug ?? '', t.title, stateWord, `${t.done}/${t.total}`,
    since(t.live ? (t.created_at === null ? null : Math.max(0, now - t.created_at)) : t.age_ms),
  ]
  return { cells, tints: t.live ? [undefined, TINT[state], undefined, 'dim', undefined, 'dim', undefined, 'dim'] : cells.map(() => 'dim' as const) }
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
