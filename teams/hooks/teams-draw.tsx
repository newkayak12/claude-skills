/*
 * Teams-only drawing: icons and tints per state, text that is cut with `…`, columns that start at the same
 * character on every row, and the one place lines of segments become Ink Text. Pure: every function takes
 * strings and a width; mod.tsx decides what to show. Width is counted in display cells (Hangul, CJK and emoji
 * take two; combining marks, ZWJ and variation selectors none; the icons and the spinner one).
 */
import type { Decision, Handoff, Mark, ReportPayload, SummaryItem, SummaryTask, SummaryTaskEntry, SummaryWorker, WorkState } from '../types'
import { f2Key } from './pane'
import type { Page, RowRef } from './pane'

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

// cut to w display cells at a word boundary: whole words, then … (never inside a word). `key · name` keeps the key and the
// first word of the name, + … in a cell of its own. When even `key · first word…` does not fit, the key stands alone, no
// trailing ' · '. A lone · before the … is backed off. Only the first word of a plain title stays when nothing more fits;
// a first token wider than w is cut by clipText.
export function clipWords(s: string, w: number): string {
  if (width(s) <= w) return s
  const ends = Array.from(s.matchAll(/\S+/g), m => ({ word: m[0], end: m.index! + m[0].length }))
  const named = ends[1]?.word === '·' && ends.length > 2
  const keep = named ? 3 : 1
  let n = 0
  while (n < ends.length && width(s.slice(0, ends[n]!.end)) + 1 <= w) n++
  while (n > 0 && ends[n - 1]!.word === '·') n--
  if (n < keep) {
    const first = ends[0]!.word
    return width(first) <= w ? first : clipText(s, w)
  }
  const head = s.slice(0, ends[n - 1]!.end)
  return head.endsWith('…') ? head : `${head}…`
}

/* --- icons and tints: one glyph and one colour per state, no faces --- */

export const ICON: Record<WorkState | 'failed' | 'held', string> = { acting: '●', idle: '◌', you: '⚑', done: '✔', stalled: '⏸', failed: '✘', held: '⏸' }
export const TINT: Record<WorkState | 'failed' | 'held', Tint> = { acting: 'claude', idle: 'inactive', you: 'warning', done: 'success', stalled: 'inactive', failed: 'error', held: 'inactive' }

// the EPIC list: ● running, ⚑ waits on a person, ⏸ stalled, ⏸ held (the engine's hold, whatever the state word)
export const epicState = (t: Pick<SummaryTaskEntry, 'live' | 'state' | 'hold'>): WorkState | 'held' => (t.hold ? 'held' : t.state === 'waiting_human' ? 'you' : t.live ? 'acting' : 'stalled')

// a held task's word, undefined when not held; a capacity park is the engine's capacity_parked, or its own hold reason `waiting_capacity: …`
const heldWord = (t: Pick<SummaryTaskEntry, 'hold' | 'capacity_parked'>, say: Say): string | undefined =>
  !t.hold ? undefined : t.capacity_parked || t.hold.reason?.startsWith('waiting_capacity') ? `${say('wordHeld')} · ${say('bandParked')}` : say('wordHeld')

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
// text takes no room. Columns give way in `shrink` order, each down to `min`; a row still too wide then loses the first
// shrink column below `min` (to 0), so the caller has nothing left to cut.
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
  // a pane too narrow even then: the first shrink column goes on giving way below `min`, so no row is cut by the caller
  const c0 = shrink[0]
  if (c0 !== undefined && !fits(widths) && widths[c0]! > 0) {
    const over = widths.reduce((n, w) => n + w, 0) + gap * Math.max(0, widths.filter(w => w > 0).length - 1) - total
    widths[c0] = Math.max(0, widths[c0]! - over)
  }
  return widths.map((w, c) => (w === 1 && (natural[c] ?? 0) > 1 ? 0 : w))
}

// A cell is text, or segments of its own colours (the Phase rail): those are padded, never cut, so a column holding one is
// dropped whole rather than shrunk.
export type Cell = string | Seg[]
export const cellText = (c: Cell): string => (typeof c === 'string' ? c : c.map(x => x.t).join(''))

// one row cut and padded to its column widths; `tints` colour a column, the rest is plain
export function rowLine(cells: readonly Cell[], widths: readonly number[], gap: number, tints: readonly (Tint | 'dim' | undefined)[] = []): Line {
  const out: Line = []
  widths.forEach((w, c) => {
    if (w <= 0) return
    if (out.length > 0) out.push({ t: ' '.repeat(gap) })
    const cell = cells[c] ?? ''
    if (typeof cell !== 'string') {
      out.push(...cell, { t: ' '.repeat(Math.max(0, w - width(cellText(cell)))) })
      return
    }
    const tint = tints[c]
    out.push({ t: padText(cell.includes(' · ') ? clipWords(cell, w) : clipText(cell, w), w), tint: tint === 'dim' ? undefined : tint, dim: tint === 'dim' })
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

/* --- worker lines and the hand-off feed (Phase detail reads them) --- */

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

export type StoryCells = { cells: string[]; tints: (Tint | 'dim' | undefined)[] }

// icon · spinner (acting only) · worker · word (node's icon and word; `fixed` localizes a fixed word by its word_key)
export function workerCells(workers: readonly SummaryWorker[], frameNo: number, fixed: (key: string) => string): StoryCells[] {
  return workers.map(w => ({
    cells: [ICON[w.state], w.state === 'acting' ? SPINNER[frameNo % SPINNER.length]! : '', w.id, w.word_key ? fixed(w.word_key) : w.word],
    tints: [TINT[w.state], TINT[w.state], undefined, 'dim'],
  }))
}

// time · who · what · to whom. `word(key, vars, raw)` draws an engine word by its key (raw when it knows none); a hand-off with
// no key keeps the engine's text
export type HandoffWord = (key: string, vars: Record<string, string | number> | undefined, raw: string) => string
export const handoffCells = (feed: readonly Handoff[], word: HandoffWord = (_key, _vars, raw) => raw): string[][] =>
  feed.slice(0, 5).map(h => {
    const from = h.from_key ? word(h.from_key, undefined, h.from) : h.from
    // a hand-off to the person: the state word says it, the target cell stays empty, so the person is named once
    if (h.to_key === 'partyYou') return [h.time, from, word('wordYou', undefined, 'needs you'), '']
    const to = h.to_key ? word(h.to_key, undefined, h.to) : h.to
    return [h.time, from, h.what_key ? word(h.what_key, h.what_vars, h.what) : h.what, to ? `→ ${to}` : '']
  })

/* --- HOME and FLOOR: rows as cells, the pane draws them --- */

export type Say = (key: string, vars?: Record<string, string | number>) => string
type Dim = Tint | 'dim' | undefined
// one selectable row: its id (kept per level), what it opens (RowRef), the column group it aligns with, its cells
export type PageRow = { id: string; block: string; ref: RowRef; cells: Cell[]; tints: Dim[] }
// `named`: the shrink column holds `key · name`; its floor is `key · first word` + 1, computed from the rows, and below
// every drop it floors at the key + 1 (key whole)
export type BlockPlan = { shrink: number[]; drop?: number[]; titleMin?: number; named?: boolean; narrow?: number[] }

const POINTER = '▸'
const MARK_ICON: Record<Mark, string> = { done: '✔', running: '●', pending: '○', failed: '✘' }
const MARK_TINT: Record<Mark, Dim> = { done: 'success', running: 'claude', pending: 'dim', failed: 'error' }
export const PHASE_KEYS = ['plan', 'build', 'integrate', 'qa', 'gate', 'report'] as const
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// a Phase's name (the rail keeps `Integ` and `Rep`); a key the table lacks draws as it is
const phaseName = (say: Say, key: string, rail = false) =>
  say(rail && key === 'integrate' ? 'f2RailIntegrate' : rail && key === 'report' ? 'f2RailReport' : `f2PhaseName${cap(key)}`)

// an ended EPIC is folded on HOME: a state the run or the ticket ends in
const ENDED = new Set(['complete', 'done', 'finished', 'failed', 'cancelled', 'canceled'])
export const isEnded = (t: Pick<SummaryTaskEntry, 'state'>): boolean => ENDED.has(String(t.state).toLowerCase())

export const epicElapsed = (t: SummaryTaskEntry, now: number): number | null =>
  t.live ? (t.created_at === null ? null : Math.max(0, now - t.created_at)) : t.age_ms

// the Phase rail: ✔Plan ●Build ○Integ ○QA ○Gate ○Rep, each in its state's colour
const railSegs = (stages: SummaryTask['stages'], say: Say): Seg[] =>
  stages.flatMap((g, i): Seg[] => [
    ...(i === 0 ? [] : [{ t: ' ' }]),
    { t: `${MARK_ICON[g.state]}${phaseName(say, g.key, true)}`, ...(g.state === 'pending' ? { dim: true } : { tint: MARK_TINT[g.state] as Tint, bold: g.state === 'running' }) },
  ])

// F3's in-stage progress as its own keys (Build n/m, QA n/m, SGk stage); blank when the engine sent none
export function progressText(p: SummaryTask['progress'], say: Say): string {
  if (p === undefined) return ''
  if (p.key === 'build') return say('progBuild', { done: p.done, total: p.total })
  if (p.key === 'qa') return say('progQa', { done: p.done, total: p.total })
  return say('progSg', { k: p.k, n: p.n, stage: p.stage_key === undefined ? '' : say(`sgStage${cap(p.stage_key)}`) }).replace(/\s{2,}/g, ' ')
}

const miniBar = (done: number, total: number, w = 8): string => {
  const k = total > 0 ? Math.min(w, Math.round((w * done) / total)) : 0
  return '█'.repeat(k) + '░'.repeat(w - k)
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const stalledOf = (t: Pick<SummaryTaskEntry, 'workers'>) => t.workers.filter(w => w.state === 'stalled' && Number.isInteger(w.minutes))
export const storyLabel = (key: string) => key.slice(key.lastIndexOf('/') + 1)
const where = (t: Pick<SummaryTaskEntry, 'title'>, story: string | null) => (story === null ? t.title : `${t.title} › ${storyLabel(story)}`)

export type HomeOpts = {
  now: number; compact: boolean; unfolded: Record<string, boolean>; say: Say
  fixed: (key: string) => string // a state word by its word_key
  verdict: (v: string | null) => string // a verdict word, blank for none
  reportReady: (taskId: string) => boolean
}
export type HomeModel = { flags: PageRow[]; body: PageRow[]; flagLine: Line }

// The flag section: asks (stage 'ask'), other cards waiting on a person, drivers F3 reports stalled with minutes, STORYs out of
// retries; every EPIC in list order. Each row ends with the key that jumps to the next one.
function flagRows(listed: readonly SummaryTaskEntry[], o: HomeOpts): PageRow[] {
  const { say, now } = o
  const out: PageRow[] = []
  for (const t of listed) {
    for (const c of t.you.cards ?? []) {
      const story = c.key.includes('/') ? c.key.slice(c.key.lastIndexOf('/') + 1) : null
      const ask = c.stage === 'ask'
      out.push({
        id: `f:${t.task_id}:${ask ? 'ask' : 'card'}:${c.key}`, block: 'flag', ref: { type: 'flag', epic: t.task_id, story, ask },
        cells: [' ', '⚑', where(t, story), c.question !== '' ? `"${oneLine(c.question)}"` : c.title, c.since === null ? '' : say('f2FlagAge', { m: since(Math.max(0, now - c.since)) }), 'n'],
        tints: [undefined, 'warning', undefined, undefined, 'dim', 'dim'],
      })
    }
    // a held task was stopped on purpose: no silent-driver row
    for (const w of t.hold ? [] : stalledOf(t)) {
      out.push({
        id: `f:${t.task_id}:stall:${w.id}`, block: 'flag', ref: { type: 'flag', epic: t.task_id, story: w.id, ask: false },
        cells: [' ', ICON.stalled, where(t, w.id), say('f2FlagDriverSilent', { m: `${w.minutes}m` }), '', 'n'],
        tints: [undefined, 'error', undefined, 'dim', undefined, 'dim'],
      })
    }
    for (const id of t.metrics?.out_of_retries ?? []) {
      out.push({
        id: `f:${t.task_id}:retry:${id}`, block: 'flag', ref: { type: 'flag', epic: t.task_id, story: id, ask: false },
        cells: [' ', '⚑', where(t, id), say('runOutOfRetries'), '', 'n'],
        tints: [undefined, 'warning', undefined, 'dim', undefined, 'dim'],
      })
    }
  }
  return out
}

// One STORY row: icon · key · title · status · try · mini bar · score · reason · agents · elapsed. The score is the judge's last
// verdict: `91/80` for an accept, `last 61/80` for a reject with its reason beside it. While a retry runs (the judged attempt is
// older than the current one) an old accept is not drawn as current; an old reject stays as `last`, and the status is the
// state's word, never the old verdict. A stalled driver (F3's workers[] verdict) replaces the status with `⏸ 23m`. Mini bar
// and agents are blank when the engine does not know them.
function storyRow(t: SummaryTaskEntry, item: SummaryItem, o: HomeOpts): PageRow {
  const { say, compact } = o
  const m = item.metrics ?? null
  const j = m?.judge ?? null
  const retrying = j !== null && j.attempt != null && m?.attempt != null && j.attempt < m.attempt
  const num = t.metrics?.stories?.find(x => x.id === item.key.split(':')[0])
  const stalled = t.workers.find(w => w.id === item.key && w.state === 'stalled' && Number.isInteger(w.minutes))
  const rejected = j !== null && j.verdict === 'reject'
  const accepted = j !== null && !retrying && j.verdict === 'accept'
  const score = j === null || !(rejected || accepted) ? ''
    : rejected ? oneLine(say('f2RowRejected', { score: j.score, threshold: j.threshold ?? '-', reason: '' })).replace(/[\s·]+$/, '')
      : j.threshold === null ? String(j.score) : `${j.score}/${j.threshold}`
  const reason = rejected && j.reason ? clipText(oneLine(j.reason), 40) : ''
  // in a held task a STORY reads held, unless it waits on the person or has failed
  const held = item.state === 'you' || item.state === 'failed' ? undefined : heldWord(t, say)
  const status = held ?? (stalled !== undefined ? say('f2RowStalledMinutes', { m: stalled.minutes! }) : (retrying ? '' : o.verdict(item.last_verdict)) || o.fixed(item.word_key))
  const elapsed = since(m !== null && (m.wall_ms ?? 0) > 0 ? m.wall_ms : item.elapsed_ms)
  const state: WorkState | 'failed' | 'held' = held !== undefined ? 'held' : stalled !== undefined ? 'stalled' : item.state
  return {
    id: `s:${t.task_id}:${item.key}`, block: 'story', ref: { type: 'story', epic: t.task_id, story: item.key },
    cells: [
      ' ', '', ICON[state], storyLabel(item.key), item.title, status, item.try === null ? '' : say('f2RowRetrying', { n: item.try, max: item.max ?? '-' }),
      compact || num?.progress == null ? '' : miniBar(num.progress.done, num.progress.total), score, reason,
      compact || num?.agents == null ? '' : say('f2RowAgents', { n: num.agents }), elapsed,
    ],
    tints: [undefined, undefined, TINT[state], 'dim', undefined, held !== undefined ? 'dim' : stalled !== undefined ? 'error' : accepted ? 'success' : 'dim','dim', 'claude', accepted ? 'success' : rejected ? 'warning' : undefined, 'dim', 'dim', 'dim'],
  }
}

// HOME's rows: the flag section on top, then the running EPICs (always open, STORY rows under each), then the ended ones folded
// (opened by `d`, shut by `a`). Values F3 supplies (Build n/m, estimated mark, ledger cost) are placed, never computed.
export function homeRows(listed: readonly SummaryTaskEntry[], o: HomeOpts): HomeModel {
  const { say, now, compact } = o
  const flags = flagRows(listed, o)
  const body: PageRow[] = []
  const epicRow = (t: SummaryTaskEntry, open: boolean): PageRow => {
    const ended = isEnded(t)
    const state = epicState(t)
    const stage = t.stages.find(g => g.state === 'running')
    const cost = t.cost.usd > 0 || t.cost.estimated ? costText(t.cost.usd, t.cost.estimated === true) : ''
    const after = t.cost.post_stop_usd == null ? '' : say('afterStop', { usd: costText(t.cost.post_stop_usd, false) })
    const keyName = `${t.key} · ${t.title}`
    const wt = t.worktree ? `⑂ ${t.worktree}` : ''
    const ref: RowRef = { type: 'epic', epic: t.task_id, ended, unfolded: o.unfolded[t.task_id] === true }
    if (ended) {
      const ago = say('f2FoldEnded', { ago: since(epicElapsed(t, now)), done: t.done, total: t.total })
      return {
        id: `e:${t.task_id}`, block: 'ended', ref,
        cells: [' ', open ? '▾' : '▸', ICON.done, keyName, wt, o.reportReady(t.task_id) ? `${ago} · ${say('f2FoldHasReport')}` : ago, [cost, after].filter(Boolean).join(' ')],
        tints: [undefined, 'claude', 'success', undefined, 'dim', 'dim', 'dim'],
      }
    }
    return {
      id: `e:${t.task_id}`, block: 'epic', ref,
      cells: [
        ' ', '▾', ICON[state], keyName, wt, compact ? (stage === undefined ? '' : phaseName(say, stage.key)) : railSegs(t.stages, say),
        compact ? '' : (state === 'you' ? say('wordYou') : heldWord(t, say) ?? ''),compact ? '' : progressText(t.progress, say), compact ? '' : `STORY ${t.done}/${t.total}`, since(epicElapsed(t, now)), [cost, after].filter(Boolean).join(' '),
      ],
      tints: [undefined, 'claude', TINT[state], undefined, 'dim', compact ? 'claude' : undefined, 'dim', 'dim', 'dim', 'dim', 'dim'],
    }
  }
  for (const t of listed) {
    if (isEnded(t)) continue
    body.push(epicRow(t, true), ...t.items.filter(item => item.key !== t.key).map(item => storyRow(t, item, o)))
  }
  for (const t of listed) {
    if (!isEnded(t)) continue
    const open = o.unfolded[t.task_id] === true
    body.push(epicRow(t, open), ...(open ? t.items.filter(item => item.key !== t.key).map(item => storyRow(t, item, o)) : []))
  }
  // mobile: the whole section on one line, `⚑ 2` and where each waits
  const flagLine: Line = [
    { t: '⚑ ', tint: 'warning' }, { t: String(flags.length), tint: 'warning', bold: true },
    { t: `  ${flags.map(f => `${cellText(f.cells[2]!)}${f.cells[1] === ICON.stalled ? ` ${ICON.stalled}` : ''}`).join(' · ')}` },
  ]
  return { flags, body, flagLine }
}

// the shrink and drop order of each column group: the title (cell 4) shrinks last; the STORY row sheds mini bar, then agents,
// then the reason, then `try n/max` (so the score is never cut); the EPIC row (cell 3 = `key · name`, 4 = `⑂ wt`, 5 rail,
// 6 you-word, 7 progress, 8 STORY n/m, 9 since, 10 cost) sheds the rail, the you-word, cost, since, then ⑂; progress (Build n/m)
// and the STORY count go only below inner 44 (`narrow`, NARROW_BELOW), where the first word is kept instead; the key·name cell never goes below `key · first word` before that, so at inner 44
// the row shows the key without the title.
// The FLOOR row (cell 2 = `n Name`) never cuts the Phase name: desks, decisions, elapsed and cost drop in that order, and the
// who/Report hint (cell 5, kept at 20 cells, the size-S ko hint) is the only shrink column, so it is the last cell cut
export const HOME_PLANS: Record<string, BlockPlan> = {
  flag: { shrink: [3, 2], drop: [5, 4], titleMin: 12 },
  epic: { shrink: [3], drop: [5, 6, 10, 9, 4], named: true, narrow: [5, 6, 7, 8, 10, 9, 4] },
  ended: { shrink: [3], drop: [6, 5, 4, 2], named: true },
  story: { shrink: [4], drop: [7, 10, 9, 6, 11], titleMin: 12 },
  phase: { shrink: [5], drop: [9, 10, 6, 3, 4], titleMin: 20 },
}

// below this inner width a plan's `narrow` drop order applies (EPIC: Build n/m and STORY n/m go before since and cost, so `key · first word`
// stays); from here up the row keeps them and the name gives way to the key
const NARROW_BELOW = 44

// The lines of `rows`, one per row in order; each column group is aligned on its own widths, the selected row carries ▸
export function pageLines(rows: readonly PageRow[], selected: string | null, inner: number, plans: Record<string, BlockPlan> = HOME_PLANS): Line[] {
  const withPointer = (r: PageRow): Cell[] => [r.id === selected ? POINTER : ' ', ...r.cells.slice(1)]
  const widthsOf = new Map<string, number[]>()
  for (const block of new Set(rows.map(r => r.block))) {
    const plan = plans[block] ?? { shrink: [2] }
    const texts = rows.filter(r => r.block === block).map(r => withPointer(r).map(cellText))
    // a `named` block: floor of the key·name cell per block from its rows — `key · first word` + 1 for the …, and the key + 1 last
    const at = plan.shrink[0] ?? 0
    const sep = (s: string) => s.indexOf(' · ')
    const first = (s: string) => width(s.slice(0, sep(s) + 3) + (s.slice(sep(s) + 3).split(/\s/)[0] ?? ''))
    const named = plan.named === true
    const titleMin = named ? texts.reduce((n, r) => Math.max(n, sep(r[at] ?? '') < 0 ? 0 : first(r[at]!) + 1), 0) : plan.titleMin
    const min = named ? texts.reduce((n, r) => Math.max(n, sep(r[at] ?? '') < 0 ? 0 : sep(r[at]!) + 1), 4) : 4
    widthsOf.set(block, columnWidths(texts, inner, 2, plan.shrink, min, inner < NARROW_BELOW && plan.narrow !== undefined ? plan.narrow : plan.drop, titleMin))
  }
  return rows.map(r => rowLine(withPointer(r), widthsOf.get(r.block)!, 2, r.id === selected ? r.tints.map((x, c) => (c === 0 ? 'claude' : x)) : r.tints))
}

// The plain text of HOME's EPIC rows (running, then ended) laid out at `inner` cells by the path the pane draws
export function epicLines(listed: readonly SummaryTaskEntry[], inner: number, o: HomeOpts): string[] {
  const body = homeRows(listed, o).body.filter(r => r.block === 'epic' || r.block === 'ended')
  return pageLines(body, null, inner).map(l => plain(l).trimEnd())
}

// HOME's header: how many EPICs, the machine-wide drivers (and load when the engine sends it), spend and elapsed of the listed EPICs
export function homeHeader(listed: readonly SummaryTaskEntry[], now: number, say: Say): { epics: string; drivers: string; right: string } {
  const d = listed.map(t => t.metrics?.drivers).find(x => x != null && x.live != null)
  const drivers = d == null || d.live == null ? ''
    : d.cap != null && typeof d.load === 'number' ? say('f2HomeDrivers', { n: d.live, max: d.cap, l: d.load })
      : `${say('runDrivers')} ${d.cap == null ? say('runLive', { n: d.live }) : say('runLiveCap', { n: d.live, cap: d.cap })}`
  const spent = listed.reduce((n, t) => n + t.cost.usd, 0)
  const elapsed = listed.filter(t => t.live && t.created_at !== null).reduce((n, t) => Math.max(n, now - t.created_at!), 0)
  const right = [spent > 0 ? costText(spent, listed.some(t => t.cost.estimated === true)) : '', elapsed > 0 ? since(elapsed) : ''].filter(Boolean).join(' · ')
  return { epics: `${say('teamEpic')} ${listed.length}`, drivers, right }
}

// FLOOR: the six Phases of one EPIC, one row each: mark · number and name · elapsed · cost · who works · decisions · ⚑ and ⏸ counts.
// Elapsed and cost are the ledger's per-Phase numbers (metrics.stages), counts come from the engine's phases[]; absent, blank.
// The name is never cut: at a narrow pane desks, decisions, elapsed and cost drop in that order (HOME_PLANS.phase), the hint last.
const STEP_ID = { plan: 'p:1', implement: 'p:2', test: 'p:2t', gate: 'p:5', report: 'p:6' } as const
export function floorRows(t: SummaryTaskEntry, say: Say): PageRow[] {
  // a size-S entry: its five steps (engine's `steps`), the running one reads `<stage> · k/n` from progress
  if (t.steps !== undefined) {
    const p = t.progress
    return t.steps.map((st): PageRow => {
      const name = say(`sgStage${cap(st.key)}`)
      const label = st.state === 'running' && p?.key === 'sg' ? say('f2FloorStepOf', { stage: name, k: p.k, n: p.n }) : name
      return {
        id: STEP_ID[st.key], block: 'phase', ref: { type: 'phase', epic: t.task_id, phase: st.phase },
        cells: [
          ' ', MARK_ICON[st.state], label, st.state === 'pending' ? '–' : '', '',
          st.key === 'report' ? say('f2FloorReportHintS') : st.acting > 0 ? `${st.acting} ${say('wordActing')}` : '',
          '', st.you > 0 ? `⚑ ${st.you}` : '', st.stalled > 0 ? `${ICON.stalled} ${st.stalled}` : '',
        ],
        tints: [undefined, MARK_TINT[st.state], undefined, 'dim', 'dim', 'dim', undefined, 'warning', 'error'],
      }
    })
  }
  // role counts and `STORY n / subagent n` only where a Phase has package desks (stories > 0); the two cells exist on every row or none
  const desks = (t.phases ?? []).some(p => (p.stories ?? 0) > 0)
  return PHASE_KEYS.map((key, i): PageRow => {
    const state: Mark = t.stages.find(g => g.key === key)?.state ?? 'pending'
    const pc = t.phases?.find(p => p.key === key)
    const ledger = t.metrics?.stages?.find(x => x.stage === key)
    const usd = ledger === undefined ? 0 : ledger.cost_usd + ledger.retry_cost_usd
    const started = state !== 'pending'
    return {
      id: `p:${i + 1}`, block: 'phase', ref: { type: 'phase', epic: t.task_id, phase: i + 1 },
      cells: [
        ' ', MARK_ICON[state], `${i + 1} ${phaseName(say, key)}`,
        !started ? '–' : ledger !== undefined && ledger.wall_ms > 0 ? since(ledger.wall_ms) : '', started && usd > 0 ? costText(usd, false) : '',
        key === 'report' ? say('f2FloorReportHint') : pc !== undefined && pc.acting > 0 ? `${pc.acting} ${say('wordActing')}` : '',
        pc !== undefined && typeof pc.decisions === 'number' ? say('f2FloorDecisionsN', { n: pc.decisions }) : '',
        pc !== undefined && pc.you > 0 ? `⚑ ${pc.you}` : '', pc !== undefined && pc.stalled > 0 ? `${ICON.stalled} ${pc.stalled}` : '',
        ...(!desks ? [] : [
          pc !== undefined && (pc.stories ?? 0) > 0 ? Object.entries(pc.roles ?? {}).map(([role, n]) => `${role} ${n}`).join(', ') : '',
          pc !== undefined && (pc.stories ?? 0) > 0 ? say('f2FloorStoriesAgents', { s: pc.stories!, a: pc.subagents ?? 0 }) : '',
        ]),
      ],
      tints: [undefined, MARK_TINT[state], undefined, 'dim', 'dim', 'dim', undefined, 'warning', 'error', ...(desks ? ['dim' as const, 'dim' as const] : [])],
    }
  })
}

/* --- Phase detail, STORY detail, Log, STORY report: text pages, one Line per row --- */

type Vars = Record<string, string | number>
// an engine word by its key: the table's word, else the raw value the engine sent
export type Wo = (key: string, fallback: string, vars?: Vars) => string
// fields the engine sends beside ../types: the Phase of a worker and its hand-offs (view-floor), the keys of a decision (view-status)
// doing_key / doing_vars: what the worker is doing as an ACTIVITY_KEYS key and plain words (view-activity.mjs); model: the raw id of its stream
export type PhaseWorker = SummaryWorker & { phase?: string; doing_key?: string; doing_vars?: Record<string, string>; model?: string | null }
export type PhaseEntry = SummaryTaskEntry & { phase_handoffs?: Record<string, Handoff[]> }
// times: a node's same verdict recorded n times, shown once (view-status.mjs decisionsView; only when n > 1)
export type DecisionX = Decision & { phase?: string; actor_key?: string; text_key?: string; text_vars?: Vars; reason_key?: string; reason_vars?: Vars; times?: number }
export type LogRow = { ts: number; time: string; node: string | null; state: string; what_key: string; numbers: Record<string, string | number | null>; note: string | null }
type FlowCell = { state: Mark; score?: number; threshold?: number | null; reason?: string }
// the bus as view-bus.mjs hands it over (card 126): one thread per sub-topic, messages newest last; a payload without the key has none
export type ThreadMessage = { from: string; to: string; body: string; ts: number; time: string }
export type StoryThread = { topic: string; story: string; messages: ThreadMessage[] }
// `view.mjs --once --format story` (lib/view-story.mjs): states are the four marks, labels keys and numbers
export type StoryPayload = {
  task_id: string; story: string; missing?: boolean; state: string; attempt: number | null
  flow: { key: string; state: Mark }[]
  progress: { try_done: number; try_total: number; total_done: number; total_all: number }
  grid: { stages: string[]; attempts: { attempt: number; cells: Record<string, FlowCell | null> }[] }
  participants: { source: string; total: { kind: string; model?: string | null; n: number }[]; live: { kind: string; model?: string | null; n: number }[] }
  workers: SummaryWorker[]; log: LogRow[]
  threads?: StoryThread[]
}
// `--format story-report`: sections are [{ key: result|verdict|files|decisions|left|seeLog, lines }], `text` the engine's file
// `verdict` is the engine's numbers (null where it has none) so the pane parses no key=value line
export type StoryVerdict = { score: number | null; threshold: number | null; attempt: number | null; max: number | null; tests?: string }
export type StoryReport = { task_id: string; story: string; missing?: boolean; finished: boolean; text: string; sections: { key: string; lines: string[] }[]; verdict?: StoryVerdict }

export type PageOpts = {
  say: Say; wo: Wo
  fixed: (key: string) => string // a state word by its word_key
  verdictOf: (v: string | null) => string // the verdict word; an unknown verdict reads as a rejection
  frame: number; now: number
}

// text pages show this many lines and scroll by w s; a dim ▲ n / ▼ n line says how many lie beyond
export const PAGE_ROWS = 14
export function windowOf(lines: readonly Line[], offset: number, rows = PAGE_ROWS): { lines: Line[]; max: number } {
  const max = Math.max(0, lines.length - rows)
  const at = Math.min(Math.max(0, offset), max)
  const below = lines.length - at - rows
  return {
    max,
    lines: [...(at > 0 ? [[{ t: `▲ ${at}`, dim: true }] as Line] : []), ...lines.slice(at, at + rows), ...(below > 0 ? [[{ t: `▼ ${below}`, dim: true }] as Line] : [])],
  }
}

const INDENT: Seg = { t: '  ' }
const head = (t: string): Line => [{ t, bold: true }]
const none: Line = [INDENT, { t: '–', dim: true }]
// rows of cells aligned on their own widths, indented under a heading
function table(rows: readonly (readonly Cell[])[], tints: readonly (readonly Dim[])[], inner: number, shrink: number[], drop: number[] = []): Line[] {
  if (rows.length === 0) return []
  const widths = columnWidths(rows.map(r => r.map(cellText)), inner - INDENT.t.length, 2, shrink, 4, drop)
  return rows.map((r, i) => [INDENT, ...rowLine(r, widths, 2, tints[i] ?? [])])
}

// A worker the page lists as running (acting, waiting on a person, stalled). `⏸ 23m` only for the engine's stalled verdict with
// whole minutes; a stalled worker without them reads as idle, so no ⏸ is drawn from nothing (F2-AC-42).
// `detail` (Phase detail): STORY · node · role · what · model · elapsed, the node (a table word), role, model and elapsed as the engine
// sent them (blank when it sent none). The what-cell is the worker's activity phrase from the table (doing_key + doing_vars); a worker
// with none says its state word, never the raw `doing` text.
export const shortModel = (m: string | null | undefined): string => {
  const raw = String(m ?? '').trim()
  return raw === '' ? '' : /(opus|sonnet|haiku)/i.exec(raw)?.[1]?.toLowerCase() ?? raw.replace(/^claude-/, '')
}
const activityWord = (w: PhaseWorker, o: PageOpts): string => {
  const said = w.doing_key !== undefined && /^act[A-Z]/.test(w.doing_key) ? o.wo(w.doing_key, '', w.doing_vars) : ''
  return said !== '' ? said : o.fixed(w.state)
}
const nodeWord = (node: string | undefined, o: PageOpts): string => (node === undefined || node === '' ? '' : o.wo(`sgStage${cap(node)}`, o.wo(`stage${cap(node)}`, node)))
// `held` (the task's held word): every row but one waiting on the person reads held, with no minutes; its idle desks are listed too
export function runningRows(workers: readonly PhaseWorker[], o: PageOpts, detail = false, held?: string): StoryCells[] {
  const live = workers.filter(w => w.state === 'acting' || w.state === 'you' || w.state === 'stalled' || (held !== undefined && w.state === 'idle'))
  return workerCells(live, o.frame, o.fixed).map((c, i) => {
    const w = live[i]!
    const isHeld = held !== undefined && w.state !== 'you'
    const what = w.state === 'stalled' ? c.cells[3]! : activityWord(w, o)
    const row: StoryCells = isHeld ? { cells: [ICON.held, '', w.id, held], tints: [TINT.held, TINT.held, undefined, 'dim'] }
      : w.state !== 'stalled' ?{ cells: [c.cells[0]!, c.cells[1]!, c.cells[2]!, what], tints: c.tints }
      : !Number.isInteger(w.minutes) ? { cells: [ICON.idle, '', w.id, c.cells[3]!], tints: [TINT.idle, TINT.idle, undefined, 'dim'] }
        : { cells: [ICON.stalled, '', w.id, o.say('f2RowStalledMinutes', { m: w.minutes! })], tints: [TINT.stalled, TINT.stalled, undefined, 'error'] }
    if (!detail) return row
    const [icon, spin, id, text] = row.cells as [string, string, string, string]
    const [t0, t1, t2, t3] = row.tints
    const here = w.state !== 'stalled' && !isHeld
    return {
      cells: [icon, spin, id, here ? nodeWord(w.node, o) : '', here ? w.role ?? '' : '', text, shortModel(w.model), here ? since(w.elapsed_ms ?? null) : ''],
      tints: [t0, t1, t2, 'dim', 'dim', t3, 'dim', 'dim'],
    }
  })
}

// a Phase hand-off's what: a verdict's score as its own phrase, else the engine's word
const handoffWhat = (h: Handoff, base: string, o: PageOpts): string => {
  const v = h.what_key === 'handVerdict' ? h.what_vars?.v : undefined
  return h.score !== undefined && (v === 'accept' || v === 'reject') ? o.say(v === 'accept' ? 'f2PhaseAccept' : 'f2PhaseReject', { score: h.score }) : base
}
// a Phase hand-off as one row: time · STORY · who · what (a verdict's score, its reason) · to whom (a verdict's next role)
function phaseFeed(feed: readonly Handoff[], o: PageOpts): string[][] {
  const base = handoffCells(feed, (key, vars, raw) => o.wo(key, raw, vars))
  return base.map((b, i) => {
    const h = feed[i]!
    const why = h.reason === undefined ? '' : `"${oneLine(h.reason)}"`
    return [b[0]!, h.story ?? '', b[1]!, [handoffWhat(h, b[2]!, o), why].filter(Boolean).join(' '), h.to_role !== undefined ? `→ ${h.to_role}` : b[3]!]
  })
}

// one decision as the thread draws it: time · who · what and score (×n when the node said it n times) · node · why, with the verdict's own lines
// under it. Who and why come by their keys when the engine sent them (a person's answer is `actorHuman`), so a Korean render holds no engine English.
type DecisionParts = { time: string; actor: string; label: string; node: string; why: string; tint: Dim; subs: string[] }
function decisionParts(d: DecisionX, o: PageOpts): DecisionParts {
  const { wo } = o
  const actorKey = d.actor_key ?? (d.actor === 'human' ? 'actorHuman' : undefined)
  const actor = actorKey === undefined ? d.actor ?? '—' : wo(actorKey, d.actor ?? '—')
  const kind = d.kind === 'verdict' ? o.verdictOf(d.verdict ?? null) : wo(`kind${cap(d.kind)}`, d.kind)
  const score = d.score !== null && d.score !== undefined ? ` ${d.score}%` : ''
  const times = d.times !== undefined && d.times > 1 ? ` ${o.say('f2EntryTimes', { n: d.times })}` : ''
  const why = d.text_key !== undefined ? wo(d.text_key, d.text ?? '', d.text_vars)
    : d.reason_key !== undefined ? wo(d.reason_key, d.reason ?? '', d.reason_vars)
      : d.reason ?? d.text ?? d.title ?? ''
  const subs = [
    ...(d.blocking ?? []).map(x => `${o.say('lineBlocking')}: ${x}`), ...(d.problems ?? []).map(x => `${o.say('lineProblems')}: ${x}`),
    ...(d.gaps ?? []).map(x => `${o.say('lineGaps')}: ${x}`), ...(d.evidence ? [`${o.say('lineEvidence')}: ${d.evidence}`] : []),
  ]
  const tint: Dim = d.verdict === 'reject' || d.kind === 'defect' ? 'error' : d.kind === 'answer' || d.kind === 'decision' ? 'warning' : undefined
  return { time: d.time ?? '', actor, label: `${kind}${score}${times}`, node: d.node ?? d.card ?? '', why: oneLine(why), tint, subs }
}

// The Phase's own rows, by one rule shared with rowIdsOf: its live workers (`w:<id>`), its hand-offs, five at most (`h:<i>`) and the
// decisions the engine tagged with the Phase (`d:<i>`)
const LIVE_STATES = new Set(['acting', 'you', 'stalled'])
// a held task's desks with unfinished work read idle (never stalled): they stay listed. The S desk's item carries the EPIC key
const heldDesk = (t: PhaseEntry, w: PhaseWorker): boolean =>
  !!t.hold && w.state === 'idle' && t.items.some(x => x.state !== 'failed' && (storyLabel(x.key) === (w.item ?? w.id) || (w.id === 'S' && x.key === t.key)))
const phaseWorkers = (t: PhaseEntry, phase: string): PhaseWorker[] => (t.workers as PhaseWorker[]).filter(w => (w.phase ?? 'build') === phase && (LIVE_STATES.has(w.state) || heldDesk(t, w)))
export const phaseThread = (decisions: readonly DecisionX[] | null, phase: string): DecisionX[] => (decisions === null ? [] : decisions.filter(d => d.phase === phase))
export const phaseFeedOf = (t: PhaseEntry, phase: string): Handoff[] => (t.phase_handoffs?.[phase] ?? []).slice(0, 5)
export function phaseRowIds(t: PhaseEntry, phase: string, decisions: readonly DecisionX[] | null): string[] {
  return [...phaseWorkers(t, phase).map(w => `w:${w.id}`), ...phaseFeedOf(t, phase).map((_, i) => `h:${i}`), ...phaseThread(decisions, phase).map((_, i) => `d:${i}`)]
}

// A line of the Phase page, and the row it is when it is one (the pane draws a row as a Button)
export type PhaseItem = { line: Line; row?: PageRow }
const POINT: Seg = { t: `${POINTER} `, tint: 'claude' }
function phaseSection(rows: PageRow[], sel: string | null, inner: number, shrink: number[], drop: number[] = []): PhaseItem[] {
  if (rows.length === 0) return [{ line: none }]
  const widths = columnWidths(rows.map(r => r.cells.map(cellText)), inner - INDENT.t.length, 2, shrink, 4, drop)
  return rows.map(r => ({ row: r, line: [r.id === sel ? POINT : INDENT, ...rowLine(r.cells, widths, 2, r.tints)] }))
}

// Phase detail: Running, Handed over, Decisions (this Phase), in that order. The hand-offs are the Phase's own (the engine's
// phase_handoffs), the decisions the engine tagged with this Phase (`phase`), and the Phase's own counts from phases[] on its
// FLOOR row (acting, you, stalled, decisions) only when present; nothing recorded is a dim –. A worker, hand-off or decision is a row
// of its own: a driver opens its STORY, a hand-off or decision opens its ENTRY.
export function phaseModel(t: PhaseEntry, phase: (typeof PHASE_KEYS)[number], decisions: readonly DecisionX[] | null, o: PageOpts, inner: number, sel: string | null): PhaseItem[] {
  const { say } = o
  const no = PHASE_KEYS.indexOf(phase) + 1
  const live = phaseWorkers(t, phase)
  const cells = runningRows(live, o, true, heldWord(t, say))
  const running = live.map((w, i): PageRow => {
    const item = t.items.find(x => storyLabel(x.key) === (w.item ?? w.id))
    return {
      id: `w:${w.id}`, block: 'run', cells: cells[i]!.cells, tints: cells[i]!.tints,
      ref: { type: 'worker', epic: t.task_id, phase: no, story: item?.key ?? null, judge: w.id === 'judge' || w.role === 'judge' },
    }
  })
  const handoffs = phaseFeedOf(t, phase)
  const feed = phaseFeed(handoffs, o).map((cs, i): PageRow => ({
    id: `h:${i}`, block: 'hand', cells: cs, tints: ['dim', 'dim', undefined, undefined, undefined], ref: { type: 'entry', epic: t.task_id, phase: no, entry: `h:${i}` },
  }))
  const thread = phaseThread(decisions, phase).map(d => decisionParts(d, o))
  const dwidths = columnWidths(thread.map(d => [d.time, d.actor, d.label, d.node, d.why]), inner - INDENT.t.length, 2, [4, 3], 4)
  const pc = t.phases?.find(p => p.key === phase)
  const counts = pc === undefined ? [] : [
    pc.acting > 0 ? `${pc.acting} ${say('wordActing')}` : '', pc.you > 0 ? `⚑ ${pc.you}` : '', pc.stalled > 0 ? `${ICON.stalled} ${pc.stalled}` : '',
    typeof pc.decisions === 'number' ? say('f2FloorDecisionsN', { n: pc.decisions }) : '',
  ].filter(Boolean)
  return [
    ...(counts.length === 0 ? [] : [{ line: [INDENT, { t: counts.join(' · '), dim: true }] as Line }]),
    { line: head(say('f2PhaseRunning')) },
    // a narrow pane sheds the role, then the node, then the model before the what-cell is cut to nothing
    ...phaseSection(running, sel, inner, [5], [4, 3, 6]),
    { line: head(say('f2PhaseHandoffs')) },
    ...phaseSection(feed, sel, inner, [3]),
    { line: head(say('f2PhaseDecisions')) },
    ...(thread.length === 0 ? [{ line: none }] : thread.flatMap((d, i): PhaseItem[] => {
      const row: PageRow = {
        id: `d:${i}`, block: 'dec', cells: [d.time, d.actor, d.label, d.node, d.why], tints: ['dim', undefined, d.tint, 'dim', undefined],
        ref: { type: 'entry', epic: t.task_id, phase: no, entry: `d:${i}` },
      }
      return [
        { row, line: [row.id === sel ? POINT : INDENT, ...rowLine(row.cells, dwidths, 2, row.tints)] },
        ...d.subs.map((x): PhaseItem => ({ line: [INDENT, { t: `  ${x}`, dim: true }] })),
      ]
    })),
  ]
}

// text cut at word boundaries into lines of at most `w` cells (a word wider than that is cut by clipText)
function wrapWords(text: string, w: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const word of oneLine(text).split(' ').filter(Boolean)) {
    const next = cur === '' ? word : `${cur} ${word}`
    if (width(next) <= w) cur = next
    else {
      if (cur !== '') out.push(cur)
      cur = width(word) <= w ? word : clipText(word, w)
    }
  }
  return cur === '' ? out : [...out, cur]
}

// ENTRY: one hand-off or decision of a Phase, with the fields it carries and no others: what it is (with its score and ×n), when · who ·
// where, the reason in full, then the verdict's own blocking / problems / gaps and a defect's evidence. A field the entry lacks is not drawn.
export function entryLines(t: PhaseEntry, phase: (typeof PHASE_KEYS)[number], entryId: string | undefined, decisions: readonly DecisionX[] | null, o: PageOpts, inner: number): Line[] {
  const meta = (parts: (string | null | undefined)[]): Line[] => (parts.filter(Boolean).length === 0 ? [] : [[{ t: parts.filter(Boolean).join(' · '), dim: true }]])
  const text = (s: string, prefix = ''): Line[] => wrapWords(s, Math.max(8, inner - width(prefix))).map((l, i): Line => [{ t: i === 0 ? prefix + l : ' '.repeat(width(prefix)) + l }])
  const at = Number(entryId?.slice(2))
  if (entryId?.startsWith('d:') && Number.isInteger(at)) {
    const d = phaseThread(decisions, phase)[at]
    if (d !== undefined) {
      const p = decisionParts(d, o)
      return [[{ t: p.label, bold: true, tint: p.tint === 'dim' ? undefined : p.tint }], ...meta([p.time, p.actor === '—' ? '' : p.actor, p.node]), ...(p.why === '' ? [] : text(p.why)), ...p.subs.flatMap(x => text(x))]
    }
  }
  if (entryId?.startsWith('h:') && Number.isInteger(at)) {
    const h = phaseFeedOf(t, phase)[at]
    if (h !== undefined) {
      const c = handoffCells([h], (key, vars, raw) => o.wo(key, raw, vars))[0]!
      return [[{ t: handoffWhat(h, c[2]!, o), bold: true }], ...meta([c[0], h.story, [c[1], h.to_role !== undefined ? `→ ${h.to_role}` : c[3]].filter(Boolean).join(' ')]), ...(h.reason === undefined ? [] : text(h.reason))]
    }
  }
  return [[{ t: '–', dim: true }]]
}

// the lines of `items` from `at`, `rows` of them, a dim ▲ n / ▼ n line telling how many lie beyond (the Phase page keeps its selected row in view)
export function windowItems(items: readonly PhaseItem[], at: number, rows = PAGE_ROWS): PhaseItem[] {
  const max = Math.max(0, items.length - rows)
  const from = Math.min(Math.max(0, at), max)
  const below = items.length - from - rows
  return [...(from > 0 ? [{ line: [{ t: `▲ ${from}`, dim: true }] as Line }] : []), ...items.slice(from, from + rows), ...(below > 0 ? [{ line: [{ t: `▼ ${below}`, dim: true }] as Line }] : [])]
}

// the line label of the STORY page, padded to one width
const labelled = (labels: readonly string[], i: number): Seg => ({ t: padText(labels[i]!, Math.max(...labels.map(width)) + 2), bold: true })

// STORY detail, top block: FLOW (one mark and node per stage, a solid link into a started stage, a dotted one before a pending
// one), the try's progress bar and numbers, the subagents by kind and model. Blank lines are left out, never faked.
export function storyTop(p: StoryPayload | null, say: Say): Line[] {
  if (p === null || p.missing === true) return []
  const labels = [say('f2StoryFlow'), say('f2StoryProgress'), say('f2StoryParticipants')]
  const flow: Line = [labelled(labels, 0)]
  p.flow.forEach((f, i) => {
    if (i > 0) flow.push({ t: f.state === 'pending' ? ' ┄ ' : ' ━ ', dim: f.state === 'pending' })
    flow.push({ t: `${MARK_ICON[f.state]}${f.key}`, ...(f.state === 'pending' ? { dim: true } : { tint: MARK_TINT[f.state] as Tint, bold: f.state === 'running' }) })
  })
  const out: Line[] = [flow]
  const pr = p.progress
  if (pr.try_total > 0) {
    out.push([
      labelled(labels, 1), { t: miniBar(pr.try_done, pr.try_total, 12), tint: 'claude' },
      { t: `  ${say('f2StoryTryLine', { n: pr.try_done, m: pr.try_total, t: pr.total_done, u: pr.total_all, k: p.grid.attempts.length })}` },
    ])
  }
  const sum = (l: { n: number }[]) => l.reduce((n, x) => n + x.n, 0)
  if (p.participants.total.length > 0) {
    out.push([labelled(labels, 2), { t: say('f2StoryAgents', { total: sum(p.participants.total), live: sum(p.participants.live) }) }])
    out.push([{ t: ' '.repeat(Math.max(...labels.map(width)) + 2) }, { t: p.participants.total.map(x => `${x.kind} ×${x.n}${x.model ? ` ${x.model}` : ''}`).join('  '), dim: true }])
  }
  return out
}

// the attempt-by-node grid: a header of the nodes, one row per attempt (n/max), a mark per node, a rejected judge as `✘ 61/80`
// with its reason after the row
export function storyGrid(p: StoryPayload | null, max: number | null, say: Say, inner: number): Line[] {
  if (p === null || p.missing === true || p.grid.attempts.length === 0) return []
  const stages = p.grid.stages
  const rows: Cell[][] = [[say('f2StoryGrid'), ...stages, '']]
  const tints: Dim[][] = [['dim', ...stages.map((): Dim => 'dim'), undefined]]
  for (const a of p.grid.attempts) {
    const bad = stages.map(k => a.cells[k]).find(c => c != null && c.state === 'failed' && c.reason !== undefined)
    rows.push([
      `${a.attempt}/${max ?? '-'}`,
      ...stages.map(k => {
        const c = a.cells[k]
        return c == null ? '' : c.state === 'failed' && c.score !== undefined ? `${MARK_ICON.failed} ${c.score}/${c.threshold ?? '-'}` : MARK_ICON[c.state]
      }),
      bad?.reason ? `"${bad.reason}"` : '',
    ])
    tints.push(['dim', ...stages.map(k => { const c = a.cells[k]; return c == null ? undefined : MARK_TINT[c.state] }), 'warning'])
  }
  const widths = columnWidths(rows.map(r => r.map(cellText)), inner, 2, [stages.length + 1], 4)
  return rows.map((r, i) => rowLine(r, widths, 2, tints[i]))
}

// who works the STORY now (the payload's workers: its drivers and the judge), under the Now heading
export function storyNow(p: StoryPayload | null, o: PageOpts, inner: number, t?: PhaseEntry): Line[] {
  if (p === null || p.missing === true) return []
  // under a hold, the Phase page's rule: the held desk stays listed though idle
  const held = t === undefined ? undefined : heldWord(t, o.say)
  const workers = held === undefined ? p.workers : (p.workers as PhaseWorker[]).filter(w => LIVE_STATES.has(w.state) || heldDesk(t!, w))
  const running = runningRows(workers, o, false, held)
  return running.length === 0 ? [] : [head(o.say('f2StoryNow')), ...table(running.map(r => r.cells), running.map(r => r.tints), inner, [3])]
}

// a bus key as a person reads it: `E-xxxxxxxx/P2` is P2, the person is `you` (the same word the asks use), the rest as stored
const busName = (key: string, say: Say) => (/^E-[^/]+\/(.+)$/.exec(key)?.[1] ?? (key === 'person' ? say('wordYou') : key === 'teamleader' ? 'TeamLeader' : key))

// the bus threads of a STORY: a heading, then per thread its sub-topic (`P2`, `all`) and one message per line, from · -> · to · body ·
// time, newest last. The columns are measured over every thread so they align across them; only the body gives way, cut with …
export function storyThreads(p: StoryPayload | null, say: Say, inner: number): Line[] {
  const threads = p === null || p.missing === true ? [] : (p.threads ?? []).filter(t => t.messages.length > 0)
  if (threads.length === 0) return []
  // a narrow pane keeps the clock and drops the date before the body is left with a few cells
  const rowsOf = (short: boolean) => threads.map(t => t.messages.map(m => [busName(m.from, say), '->', busName(m.to, say), oneLine(m.body), short ? m.time.replace(/^\S+ /, '') : m.time]))
  const room = inner - INDENT.t.length
  let rows = rowsOf(false)
  let widths = columnWidths(rows.flat(), room, 2, [3], 4)
  if (widths[3]! < Math.min(16, Math.max(...rows.flat().map(r => width(r[3]!))))) {
    rows = rowsOf(true)
    widths = columnWidths(rows.flat(), room, 2, [3], 4)
  }
  const out: Line[] = [head(say('storyThreads'))]
  threads.forEach((t, i) => {
    out.push([INDENT, { t: t.story, dim: true }])
    for (const r of rows[i]!) out.push([INDENT, ...rowLine(r, widths, 2, ['claude', 'dim', undefined, undefined, 'dim'])])
  })
  return out
}

// STORY detail's selectable rows: the ask the person can answer, the Log, the Report
export function storyRows(t: SummaryTaskEntry, story: string, sd: StoryPayload | null, doc: StoryReport | null, o: Pick<PageOpts, 'say' | 'now'>): PageRow[] {
  const { say, now } = o
  const rows: PageRow[] = []
  const ask = (t.you.cards ?? []).find(c => c.stage === 'ask' && storyLabel(c.key) === story)
  const ref = (row: 'log' | 'report' | 'answer'): RowRef => ({ type: 'storyRow', epic: t.task_id, story, row })
  if (ask !== undefined) {
    rows.push({
      id: 'r:answer', block: 'srow', ref: ref('answer'),
      cells: [' ', say('askTo', { who: ask.who }), ask.question !== '' ? `"${oneLine(ask.question)}"` : ask.title, ask.since === null ? '' : say('f2FlagAge', { m: since(Math.max(0, now - ask.since)) }), say('f2StoryAnswerRow')],
      tints: [undefined, 'warning', undefined, 'dim', 'dim'],
    })
  }
  const last = sd !== null && sd.missing !== true ? sd.log.at(-1) : undefined
  rows.push({
    id: 'r:log', block: 'srow', ref: ref('log'),
    cells: [' ', last === undefined ? say('f2PageLog') : say('f2StoryLogRow', { n: sd!.log.length, ago: since(Math.max(0, now - last.ts)) }), '', '', ''],
    tints: [undefined, undefined, undefined, undefined, undefined],
  })
  rows.push({
    id: 'r:report', block: 'srow', ref: ref('report'),
    cells: [' ', doc?.finished === true ? say('f2PageReport') : say('f2StoryReportRow'), '', '', ''],
    tints: [undefined, doc?.finished === true ? undefined : 'dim', undefined, undefined, undefined],
  })
  return rows
}

// the Log: newest first, time · node · what · note; a label is a key plus numbers, the note is data in quotes
export function logLines(p: StoryPayload | null, o: PageOpts, inner: number): Line[] {
  if (p === null || p.missing === true) return []
  const rows = [...p.log].reverse().map((r): { cells: Cell[]; tints: Dim[] } => ({
    cells: [r.time, r.node === null ? '' : `${r.state === 'done' ? ICON.done : r.state === 'failed' ? ICON.failed : r.state === 'waiting' ? ICON.you : ICON.acting} ${r.node}`,
      o.wo(f2Key(r.what_key), r.what_key, r.numbers as Vars), r.note ? `"${oneLine(r.note)}"` : ''],
    tints: ['dim', r.state === 'failed' ? 'error' : r.state === 'waiting' ? 'warning' : r.state === 'done' ? 'success' : 'claude', undefined, r.state === 'failed' ? 'warning' : 'dim'],
  }))
  const widths = columnWidths(rows.map(r => r.cells.map(cellText)), inner, 2, [3, 2], 4, [3])
  return rows.map(r => rowLine(r.cells, widths, 2, r.tints))
}

const SECTION_LABEL: Record<string, string> = {
  result: 'f2ReportResult', verdict: 'f2ReportVerdict', files: 'f2ReportFiles', decisions: 'f2ReportDecisions', left: 'f2ReportLeft', seeLog: 'f2ReportSeeLog',
}

// The STORY Report: one row per section, its label from the table and its lines as written, joined by ·; the judge line from
// its numbers. Before the gate passes there is no report and none is drawn (a dim line says so).
export function storyReportLines(p: StoryReport | null, say: Say, inner: number): Line[] {
  if (p === null || !p.finished) return [[{ t: say('f2ReportNotAvailable'), dim: true }]]
  const rows = p.sections.filter(s => s.lines.length > 0 && SECTION_LABEL[s.key] !== undefined).map((s): { cells: string[]; tints: Dim[] } => {
    const v = p.verdict
    const text = s.key === 'verdict'
      ? say('f2ReportVerdictLine', { score: v?.score ?? '', threshold: v?.threshold ?? '', n: v?.attempt ?? '', max: v?.max ?? '' }) + (v?.tests === undefined ? '' : ` · ${say(v.tests === 'pass' ? 'f2ReportTestsPass' : 'f2ReportTestsFail')}`)
      : s.lines.map(oneLine).join(' · ')
    return { cells: [say(SECTION_LABEL[s.key]!), text], tints: [undefined, s.key === 'seeLog' ? 'claude' : undefined] }
  })
  const widths = columnWidths(rows.map(r => r.cells), inner, 2, [1], 4)
  return rows.map(r => rowLine(r.cells, widths, 2, r.tints).map((seg, i) => (i === 0 ? { ...seg, bold: true } : seg)))
}

// `waiting_human` -> `WaitingHuman`: an engine state word as the tail of a table key
const camelWord = (w: string) => w.toLowerCase().split('_').map(cap).join('')

// The EPIC report's needs, placed from the engine's entries ({ text, reason_key, reason_vars }): an entry with a key is drawn by
// it (`never dispatched`, `state: x`), the text before its `: ` is the name as sent. No entries (an older engine): the items as sent.
export function needsOf(needs: ReportPayload['needs'], wo: Wo): string[] {
  return (needs.entries ?? needs.items.map(text => ({ text }))).map(e => {
    if (e.reason_key === undefined || e.name === undefined || e.reason === undefined) return e.text
    // `state: x` carries the node's state word, drawn by the state or ticket key it names (an unknown one as received)
    const st = e.reason_vars?.state
    const vars = typeof st === 'string' ? { ...e.reason_vars, state: wo(`state${camelWord(st)}`, wo(`ticket${camelWord(st)}`, st)) } : e.reason_vars
    return `${e.name}: ${wo(e.reason_key, e.reason, vars)}`
  })
}

// The row ids a page draws, from the listing alone (no words): what the tick keeps the selection against
export function rowIdsOf(page: Page, listed: readonly SummaryTaskEntry[], unfolded: Record<string, boolean>, decisions: readonly DecisionX[] | null = null): string[] {
  const same: Say = key => key
  if (page.name === 'PHASE') {
    const found = listed.find(t => t.task_id === page.epic)
    return found === undefined ? [] : phaseRowIds(found as PhaseEntry, PHASE_KEYS[Math.min(5, Math.max(0, (page.phase ?? 1) - 1))]!, decisions)
  }
  if (page.name === 'STORY') {
    const found = listed.find(t => t.task_id === page.epic)
    return found === undefined || page.story === null ? [] : storyRows(found, storyLabel(page.story), null, null, { say: same, now: 0 }).map(r => r.id)
  }
  if (page.name === 'HOME') {
    const home = homeRows(listed, { now: 0, compact: false, unfolded, say: same, fixed: same, verdict: v => v ?? '', reportReady: () => false })
    return [...home.flags, ...home.body].map(r => r.id)
  }
  const entry = page.name === 'FLOOR' ? listed.find(t => t.task_id === page.epic) : undefined
  return entry === undefined ? [] : floorRows(entry, same).map(r => r.id)
}

// The footer on one line: close stays whole; prev/next and the open hint stay when they fit; the key hint takes what is
// left and ends in … when cut, or is dropped when under 6 columns remain. The language marker (`l EN`) is reserved first,
// so it is returned whole whatever the width.
// The Input draws its own `⏎ submit` (9 columns and a gap) beside the hint while focused.
const INPUT_CHROME = 10
// The keys Input with submitLabel "" still draws a bare `⏎` (2 columns with its gap) after the hint.
export const KEYS_CHROME = 2

export function footerPlan(parts: { steps: number; open: string; close: string; hint: string; marker: string }, inner: number, chrome = INPUT_CHROME): { hint: string; marker: string } {
  const fixed = [parts.steps > 0 ? parts.steps + 2 * (parts.steps - 1) : 0, width(parts.open), width(parts.close), width(parts.marker)].filter(n => n > 0)
  const room = inner - chrome - fixed.reduce((n, w) => n + w, 0) - 2 * fixed.length
  if (room < 6) return { hint: '', marker: parts.marker }
  const segments: string[] = []
  let start = 0; let depth = 0
  for (let i = 0; i < parts.hint.length; i += 1) {
    if (parts.hint[i] === '(') depth += 1
    else if (parts.hint[i] === ')') depth -= 1
    else if (depth === 0 && parts.hint.startsWith(' · ', i)) { segments.push(parts.hint.slice(start, i)); start = i + 3; i += 2 }
  }
  segments.push(parts.hint.slice(start))
  if (width(segments.join(' · ')) <= room) return { hint: parts.hint, marker: parts.marker }
  const keyed = segments.some(s => /(^|\s)[aq](?:\s|$)/.test(s))
  const kept = [...segments]
  const detail = kept.findIndex(s => / \([^()]*\)$/.test(s))
  if (detail >= 0 && width(kept.join(' · ')) > room) kept[detail] = kept[detail]!.replace(/ \([^()]*\)$/, '')
  // the movement key (`w s …`) is shared by every page, so it goes before any other segment
  if (kept.length > 1 && width(kept.join(' · ')) > room && /^w s /.test(kept[0]!)) kept.shift()
  for (let i = kept.length - 1; i >= 0 && width(kept.join(' · ')) > room; i -= 1) {
    if (/((^|\s)[aq](?:\s|$))/.test(kept[i]!)) continue
    if (!keyed && i === 0) continue
    kept.splice(i, 1)
  }
  const hint = width(kept.join(' · ')) > room ? clipText(kept.join(' · '), room) : kept.join(' · ')
  return { hint, marker: parts.marker }
}

export function crumbFit(crumbs: readonly string[], room: number): string[] {
  const out = [...crumbs]
  if (out.length === 0 || room <= 0) return []
  // Floors: one whole first glyph plus '…' (width(), so Hangul needs 3). Below the room the floors need
  // (e.g. three crumbs under 12 cols) the result may exceed room; the Text's end-truncation clips it.
  const floor = (s: string) => width([...s][0] ?? '') + 1
  const first = () => clipText(out[0]!, Math.max(floor(out[0]!), room - (out.length > 1 ? width(` › ${out.slice(1).join(' › ')}`) : 0)))
  if (width(out.join(' › ')) > room) out[0] = first()
  if (width(out.join(' › ')) > room && out.length > 2) {
    const tail = out.slice(2).join(' › ')
    out[1] = clipText(out[1]!, Math.max(floor(out[1]!), room - width(`${out[0]} › ${tail ? `${out[1]} › ${tail}` : out[1]}`)))
  }
  if (width(out.join(' › ')) > room) {
    const prefix = out.slice(0, -1).join(' › ')
    out[out.length - 1] = clipText(out[out.length - 1]!, Math.max(2, room - width(prefix ? `${prefix} › ` : '')))
  }
  return out
}
