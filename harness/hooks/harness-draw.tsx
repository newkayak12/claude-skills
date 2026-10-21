/*
 * Harness-only drawing: the state glyphs, the layout of the pane and the three-row band as lines of styled
 * segments, and the demo fixtures. Pure: every function takes a row (status.ts) and a width and returns lines;
 * mod.tsx only renders them (renderLines). draw.tsx stays the copy shared with graph, so nothing here edits it.
 *
 * Width is counted in code points: every glyph used is one column in a terminal.
 */
import type { HarnessRow, PaneTab, RowStage } from '../types'
import type { Ui } from './draw'
import {
  costText, countsText, cycleRun, doingOf, elapsedText, inStageText, isActing, lastStep, latestRound, openingOrder, otherRunLabel,
  pickRun, railItems, rankedProblems, restLine, roundHeading, roundText, runCount, runPosition, runState, severityOf,
  topFinding, waitsOnYou, youLine,
} from './status'
import type { RailItem, RailMark } from './status'

/* --- glyphs: only these nine mark state; no faces --- */

export const GLYPH = { edit: '✎', read: '⌕', run: '▸', think: '…', judge: '⚖', done: '✔', fail: '✘', idle: '◌', you: '⚑' } as const
export const STATE_GLYPHS: readonly string[] = Object.values(GLYPH)
export const RAIL_MARK: Record<RailMark, string> = { done: GLYPH.done, failed: GLYPH.fail, current: '●', pending: '○' }
// rail connectors and dots, and the plain typography the text uses; with the nine, everything the pane may print beyond ASCII
export const RAIL_GLYPHS: readonly string[] = ['━', '┄', '●', '○']
export const TYPOGRAPHY: readonly string[] = ['·', '—', '↳', '◀', '▶', '─', '│', '╭', '╮', '╰', '╯']
export const ALLOWED: readonly string[] = [...STATE_GLYPHS, ...RAIL_GLYPHS, ...TYPOGRAPHY]

// the spinner: the action glyphs that fit the stage, one frame per tick
const FRAMES: Record<RowStage, readonly string[]> = {
  plan: [GLYPH.edit, GLYPH.think],
  setgoal: [GLYPH.edit, GLYPH.think],
  critique: [GLYPH.judge, GLYPH.think],
  implement: [GLYPH.edit, GLYPH.read, GLYPH.run],
  gate: [GLYPH.judge, GLYPH.think],
  report: [GLYPH.edit, GLYPH.think],
}
export function spinnerFrame(tick: number, stage: RowStage = 'implement'): string {
  const frames = FRAMES[stage]
  const i = Number.isFinite(tick) ? Math.trunc(tick) : 0
  return frames[((i % frames.length) + frames.length) % frames.length]!
}

// One glyph for the run: waits on you ⚑; acting, the spinner frame; otherwise idle ◌ (waiting on a vendor, stalled, no now.json)
export const stateGlyph = (r: HarnessRow, tick: number) => (waitsOnYou(r) ? GLYPH.you : isActing(r) ? spinnerFrame(tick, r.stage) : GLYPH.idle)

/* --- lines of segments --- */

export type Tint = 'success' | 'claude' | 'inactive' | 'error'
export type Seg = { t: string; tint?: Tint; bold?: boolean; dim?: boolean }
export type Line = Seg[]

const seg = (t: string, o: Omit<Seg, 't'> = {}): Seg => ({ t, ...o })
export const plain = (l: Line) => l.map(s => s.t).join('')
export const width = (s: string) => Array.from(s).length
export const lineWidth = (l: Line) => l.reduce((n, s) => n + width(s.t), 0)

// cut to w columns; the cut ends in …
export function clipLine(l: Line, w: number): Line {
  if (lineWidth(l) <= w) return l
  if (w <= 0) return []
  const out: Line = []
  let left = w - 1
  for (const s of l) {
    if (left <= 0) break
    const cs = Array.from(s.t)
    if (cs.length <= left) {
      out.push(s)
      left -= cs.length
    } else {
      out.push({ ...s, t: cs.slice(0, left).join('') })
      break
    }
  }
  const last = out[out.length - 1]
  if (last === undefined) return [seg('…')]
  out[out.length - 1] = { ...last, t: `${last.t.trimEnd()}…` }
  return out
}

export const clip = (text: string, w: number) => plain(clipLine([seg(text)], w))

// A row of segments that must fit w. Lowest priority goes first: `drop` > 0 segments leave in descending order,
// each first cut to `min` columns (… at the cut) when it has one; segments with no `drop` never leave, and only
// truncate (widest first) unless `fixed`. `right` on the last segment pads it to the right edge. Never wider than w.
export type FitSeg = { parts: Seg[]; sep?: string; drop?: number; min?: number; fixed?: boolean; right?: boolean }
export const fs = (text: string, o: Omit<FitSeg, 'parts'> & Omit<Seg, 't'> = {}): FitSeg => {
  const { sep, drop, min, fixed, right, ...style } = o
  return { parts: [seg(text, style)], sep, drop, min, fixed, right }
}
const fw = (f: FitSeg) => lineWidth(f.parts)

export function fit(input: readonly FitSeg[], w: number): Line {
  const segs = input.filter(f => fw(f) > 0)
  const total = () => segs.reduce((n, f, i) => n + (i > 0 ? width(f.sep ?? '') : 0) + fw(f), 0)
  while (total() > w) {
    let top = -1
    segs.forEach((f, i) => {
      if ((f.drop ?? 0) > 0 && (top < 0 || f.drop! >= segs[top]!.drop!)) top = i
    })
    if (top < 0) break
    const f = segs[top]!
    const over = total() - w
    if (f.min !== undefined && fw(f) > f.min) segs[top] = { ...f, parts: clipLine(f.parts, Math.max(f.min, fw(f) - over)) }
    else segs.splice(top, 1)
  }
  while (total() > w) {
    let wide = -1
    segs.forEach((f, i) => {
      if (!f.fixed && (f.drop ?? 0) === 0 && fw(f) > 2 && (wide < 0 || fw(f) > fw(segs[wide]!))) wide = i
    })
    if (wide < 0) break
    const f = segs[wide]!
    // the widest gives way toward the next widest, so several long segments share the cut
    const next = Math.max(0, ...segs.filter((g, i) => i !== wide && !g.fixed && (g.drop ?? 0) === 0).map(fw))
    segs[wide] = { ...f, parts: clipLine(f.parts, Math.max(2, fw(f) - (total() - w), Math.min(next, fw(f) - 1))) }
  }
  const out: Line = []
  const pad = w - total()
  segs.forEach((f, i) => {
    if (i > 0 && f.sep) out.push(seg(f.sep, { dim: true }))
    if (f.right && i === segs.length - 1 && i > 0 && pad > 0) out.push(seg(' '.repeat(pad)))
    out.push(...f.parts)
  })
  return clipLine(out, w)
}

// left text, right text on the same line: the right side sheds low-priority pieces first, then the left truncates
export function leftRight(left: Line, rightSegs: readonly FitSeg[], w: number, minLeft = 10): Line {
  const right = fit(rightSegs, Math.max(0, w - Math.min(lineWidth(left), minLeft) - 2))
  const rw = lineWidth(right)
  const l = clipLine(left, w - rw - (rw > 0 ? 2 : 0))
  return [...l, seg(' '.repeat(Math.max(rw > 0 ? 2 : 0, w - lineWidth(l) - rw))), ...right]
}

// a plain bordered frame for the demo text; lines are padded or cut to the inside width
export function frame(title: string, lines: readonly Line[], w: number): string[] {
  const inner = w - 4
  const top = `╭─ ${title} ${'─'.repeat(Math.max(0, w - 5 - width(title)))}╮`
  const body = lines.map(l => {
    const c = clipLine(l, inner)
    return `│ ${plain(c)}${' '.repeat(inner - lineWidth(c))} │`
  })
  return [clip(top, w), ...body, `╰${'─'.repeat(w - 2)}╯`]
}

// the one place Ink is touched: lines of segments as Text
export function renderLines(ui: Ui, lines: readonly Line[]) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column">
      {lines.map((l, i) => (
        <Text key={i} wrap="truncate-end">
          {l.length === 0 ? ' ' : l.map((s, j) => <Text key={j} color={s.tint} bold={s.bold} dimColor={s.dim}>{s.t}</Text>)}
        </Text>
      ))}
    </Box>
  )
}

/* --- the rail --- */

const MARK_TINT: Record<RailMark, Tint> = { done: 'success', failed: 'error', current: 'claude', pending: 'inactive' }
const SEV_TINT = { blocker: 'error', major: 'error', minor: 'claude', nit: 'inactive' } as const

// `✔ Plan ━━ ✔ SetGoal ━━ ✘ Critique ━━ ● SetGoal again ┄┄ ○ Critique ┄┄ ○ Subgoals 0/3 ┄┄ ○ Goal gate ┄┄ ○ Report`
// compact: short labels, single connectors
export function railLine(items: readonly RailItem[], compact: boolean): Line {
  const out: Line = []
  items.forEach((it, i) => {
    out.push(seg(`${RAIL_MARK[it.mark]} ${compact ? it.short : it.label}`, { tint: MARK_TINT[it.mark], bold: it.mark === 'current' }))
    const next = items[i + 1]
    if (next !== undefined) {
      const solid = next.mark !== 'pending'
      out.push(seg(compact ? (solid ? ' ━ ' : ' ┄ ') : solid ? ' ━━ ' : ' ┄┄ ', { tint: solid ? 'success' : 'inactive' }))
    }
  })
  return out
}

// the rail at the width it is given: full labels when they fit, else the compact one, cut with … at last
function railFit(items: readonly RailItem[], w: number): Line {
  const full = railLine(items, false)
  return clipLine(lineWidth(full) <= w ? full : railLine(items, true), w)
}

const bar = (done: number, total: number, cells: number) => {
  const filled = total > 0 ? Math.min(cells, Math.max(0, Math.round((cells * done) / total))) : 0
  return '━'.repeat(filled) + '─'.repeat(cells - filled)
}

/* --- the pane --- */

export type PaneCtx = {
  width: number // columns inside the frame
  nowMs: number
  tick: number
  pos: { k: number; n: number }
  other: string | null // otherRunLabel
  tab: PaneTab
  maxLines?: number // cap on a findings list before `+N more`
}

const compactAt = (inner: number) => inner < 150
const TABS: { key: PaneTab; label: string; short: string }[] = [
  { key: 'now', label: 'Now', short: 'Now' },
  { key: 'flow', label: 'Flow', short: 'Flow' },
  { key: 'findings', label: 'Findings', short: 'Findings' },
  { key: 'rules', label: 'Gate rules', short: 'Rules' },
]

const glyphSeg = (g: string): Seg => seg(g, { tint: g === GLYPH.idle ? 'inactive' : 'claude', bold: true })
// the Now line's own glyph: the spinner while the run acts, otherwise idle (⚑ belongs to the You line)
const nowGlyph = (r: HarnessRow, tick: number) => (isActing(r) ? spinnerFrame(tick, r.stage) : GLYPH.idle)

export function headerLine(r: HarnessRow, c: PaneCtx): Line {
  const compact = compactAt(c.width)
  const multi = c.pos.n > 1
  const state = runState(r)
  const runs = compact ? `${runCount(c.pos, true)}${multi ? ' ◀▶' : ''}` : `${runCount(c.pos)}${multi ? ' ◀ [ ] ▶' : ''}`
  const right = [
    fs(state, { tint: r.stalled ? 'error' : waitsOnYou(r) ? 'claude' : 'success', drop: 2 }),
    fs(elapsedText(r, c.nowMs), { sep: ' · ', drop: 4 }),
    fs(costText(r), { sep: ' · ', drop: 3 }),
    fs(runs, { sep: ' · ', fixed: true }),
  ]
  return leftRight([seg(r.slug, { bold: true })], right, c.width)
}

const nowLine = (r: HarnessRow, c: PaneCtx, compact: boolean): Line => {
  const d = doingOf(r)
  const left: Line = [glyphSeg(nowGlyph(r, c.tick)), seg(compact ? ' ' : ' Now   ', { dim: true }), seg(d.text, d.canned ? { dim: true } : {})]
  return leftRight(left, [fs(roundText(r, compact), { drop: 1 }), fs(inStageText(r, c.nowMs, compact), { sep: ' · ', drop: 2 })], c.width, 20)
}

const lastLine = (r: HarnessRow, c: PaneCtx, compact: boolean): Line => {
  const s = lastStep(r, c.nowMs)
  return leftRight([seg(compact ? '  last: ' : '        last step: ', { dim: true }), seg(s.text)], [fs(s.age, { dim: true, drop: 1 })], c.width, 20)
}

const youLineOf = (r: HarnessRow, c: PaneCtx, compact: boolean): Line => {
  const y = youLine(r)
  const head = y.you ? seg(GLYPH.you, { tint: 'claude', bold: true }) : seg(' ')
  return clipLine([head, seg(compact ? ' ' : ' You   ', { dim: true }), seg(y.text, y.you ? { bold: true } : {})], c.width)
}

const problemLine = (p: { n: number; severity: keyof typeof SEV_TINT; text: string }, w: number, compact: boolean): Line =>
  fit([
    fs(`  ${p.n}${compact ? ' ' : '  '}`, { fixed: true }),
    fs(p.severity.padEnd(7), { fixed: true, tint: SEV_TINT[p.severity] }),
    fs(p.text, { sep: '  ' }),
  ], w)

const TAB_NUM: Record<PaneTab, number> = { now: 1, flow: 2, findings: 3, rules: 4 }

// the Now tab's findings block: the latest round's verdict, its top two, and what is left
function nowFindings(r: HarnessRow, c: PaneCtx, compact: boolean): Line[] {
  const rd = latestRound(r)
  const heading = roundHeading(rd, compact)
  if (heading === null) return [[seg('No critique round yet', { dim: true })]]
  const out: Line[] = [clipLine([seg(heading, { bold: true })], c.width)]
  const ranked = rankedProblems(rd)
  ranked.slice(0, 2).forEach(p => out.push(problemLine(p, c.width, compact)))
  const rest = restLine(rd, 2)
  if (rest !== '') out.push(clipLine([seg(`     ${rest} · Findings ${compact ? '' : '('}${TAB_NUM.findings}${compact ? '' : ')'}`, { dim: true })], c.width))
  return out
}

// the Findings tab: the node's rollup over every round, then each round's problems
function findingsBody(r: HarnessRow, c: PaneCtx, compact: boolean): Line[] {
  const max = c.maxLines ?? 14
  const out: Line[] = [clipLine([seg(`All rounds · ${countsText(r.severity)}`, { bold: true })], c.width)]
  if (r.rounds.length === 0) return [...out, [seg('No critique round yet', { dim: true })]]
  for (const rd of r.rounds) {
    out.push([])
    out.push(clipLine([seg(roundHeading(rd, compact) ?? '', { bold: true })], c.width))
    for (const p of rankedProblems(rd)) out.push(problemLine(p, c.width, compact))
  }
  if (out.length <= max) return out
  return [...out.slice(0, max - 1), [seg(`  +${out.length - (max - 1)} more lines`, { dim: true })]]
}

// The tab row's right side: the run `]` would open, else how many more there are, else nothing; whichever fits `room`
function otherSide(c: PaneCtx, room: number): string {
  const more = c.pos.n - 1
  const short = more > 0 ? `+${more} run${more > 1 ? 's' : ''}` : ''
  const right = c.other !== null && width(c.other) <= room ? c.other : short
  return width(right) <= room ? right : ''
}

export function tabLine(c: PaneCtx, compact: boolean): Line {
  const left: Line = []
  TABS.forEach((t, i) => {
    const current = t.key === c.tab
    const n = TAB_NUM[t.key]
    left.push(seg(`${current ? '● ' : ''}${compact ? `${t.short} ${n}` : `${t.label} (${n})`}`, { bold: current, dim: !current }))
    if (i < TABS.length - 1) left.push(seg(compact ? '  ' : '   '))
  })
  return leftRight(left, [fs(otherSide(c, c.width - lineWidth(left) - 2), { dim: true })], c.width, lineWidth(left))
}

export type TabLabels = Record<PaneTab, { label: string; short: string }>
export const TAB_LABELS: TabLabels = Object.fromEntries(TABS.map(t => [t.key, { label: t.label, short: t.short }])) as TabLabels

// The live tab row: Buttons (hotkeys 1-4) on the left, the other-run label on the right. Each Button draws as
// `<n>: <label>` with `● ` on the current one, and the row never wraps: the compact labels when the full ones do
// not fit, and the right side only when it fits what is left.
export function tabRowPlan(c: PaneCtx, labels: TabLabels = TAB_LABELS): { items: { key: PaneTab; label: string }[]; right: string } {
  const widthOf = (names: string[]) => names.reduce((n, t, i) => n + 3 + width(t) + (TABS[i]!.key === c.tab ? 2 : 0), 0) + 3 * (names.length - 1)
  const pick = (form: 'label' | 'short') => TABS.map(t => labels[t.key][form])
  const form = widthOf(pick('label')) <= c.width ? 'label' : 'short'
  return {
    items: TABS.map(t => ({ key: t.key, label: labels[t.key][form] })),
    right: otherSide(c, c.width - widthOf(pick(form)) - 2),
  }
}

// Columns inside the pane's own round border and padding, from the columns the engine gives the body
export const innerWidth = (bodyColumns: number) => Math.max(20, bodyColumns - 4)

// Terminal cells of a string: Hangul, CJK and full-width forms take two
export const cells = (t: string) => [...t].reduce((n, c) => n + (/[ᄀ-ᅟ⺀-꓏가-힣＀-｠]/.test(c) ? 2 : 1), 0)

// The host Input draws '⏎ submit' at the row's end; its gap plus label
export const SUBMIT_HINT_CELLS = 1 + cells('⏎ submit')

// The footer keys row (lead, [ q ], tail, then prev/next beside it): prev/next join only when keys, steps and the
// host's submit hint all fit the width; otherwise the keys stay one row and [ ] still step
export function footerFits(
  t: { lead: string; tail: string; prev: string; next: string }, w: number, runs: number,
): { steps: boolean } {
  const keys = cells(t.lead) + 1 + 5 + 1 + cells(t.tail)
  const steps = 1 + cells(t.prev) + 2 + cells(t.next)
  return { steps: runs > 1 && keys + steps + SUBMIT_HINT_CELLS <= w }
}

// header, Now / last step / You, the rail
export function paneHead(r: HarnessRow, c: PaneCtx): Line[] {
  const compact = compactAt(c.width)
  const rail = railItems(r)
  const barText = r.total > 0 && !compact ? `subgoals ${r.passed}/${r.total} ${bar(r.passed, r.total, 10)}` : ''
  return ([
    headerLine(r, c), [],
    nowLine(r, c, compact), lastLine(r, c, compact), youLineOf(r, c, compact), [],
    leftRight(railFit(rail, c.width - (barText === '' ? 0 : width(barText) + 2)), [fs(barText, { dim: true })], c.width, 20), [],
  ] as Line[]).map(l => clipLine(l, c.width))
}

// the Now tab's findings, or the Findings tab (the node's rollup over every round)
export function paneContent(r: HarnessRow, c: PaneCtx): Line[] {
  const compact = compactAt(c.width)
  return (c.tab === 'findings' ? findingsBody(r, c, compact) : nowFindings(r, c, compact)).map(l => clipLine(l, c.width))
}

// The pane's body for the run, between the frame's top and bottom: head, the tab's content and the tab row. The
// Flow and Gate rules tabs are mod.tsx's own (they read the run's files); this draws Now and Findings.
export function paneLines(r: HarnessRow, c: PaneCtx): Line[] {
  return [...paneHead(r, c), ...paneContent(r, c), [], clipLine(tabLine(c, compactAt(c.width)), c.width)]
}

/* --- the band: three rows for the leading run --- */

const INDENT = '          ' // under `⚑ harness `, so the rows read as one block

// The band for the harness runs in opening order: the leading run's three rows (what it is doing and whether it
// waits on you / how far / what it cost and what came back last), `+N` for the others. No graph run is drawn here.
export function bandLines(ordered: readonly HarnessRow[], o: { width: number; nowMs: number; tick: number }): Line[] {
  const r = ordered[0]
  if (r === undefined) return []
  const w = o.width
  const compact = w < 150
  const more = ordered.length - 1
  const y = youLine(r)
  const d = doingOf(r)
  const row1 = fit([
    { parts: [glyphSeg(stateGlyph(r, o.tick))], fixed: true },
    fs('harness', { sep: ' ', drop: 6, dim: true }),
    fs(r.slug, { sep: ' ', bold: true }),
    fs(d.text, { sep: ' · ', drop: 1, min: 16, dim: d.canned }),
    y.you ? fs(`asks you: ${y.text}`, { sep: ' · ', tint: 'claude', bold: true }) : fs(''),
    fs(roundText(r, compact), { sep: ' · ', drop: 4 }),
    more > 0 ? { ...fs(compact ? `+${more}` : `+${more} run${more > 1 ? 's' : ''}`, { sep: '  ', fixed: true, dim: true }), right: true } : fs(''),
  ], w)
  const rail = railItems(r)
  const sub = r.total > 0 ? `subgoals ${r.passed}/${r.total}` : ''
  // the rail already names the subgoals, so the right-hand count goes first when the row is tight
  const row2 = fit([
    fs(INDENT, { fixed: true }),
    { parts: railFit(rail, Math.max(8, w - INDENT.length)) },
    { ...fs(sub, { sep: '  ', drop: 1, dim: true }), right: true },
  ], w)
  const finding = topFinding(r)
  const row3 = fit([
    fs(INDENT, { fixed: true }),
    fs(costText(r), { fixed: true, bold: true }),
    fs(elapsedText(r, o.nowMs), { sep: ' · ', fixed: true }),
    finding === null ? fs('') : fs(`top finding: ${finding}`,{ sep: ' · ', drop: 2, min: 24 }),
  ], w)
  return [row1, row2, row3]
}

/* --- the demo: fixtures rendered to plain text, no live run --- */

export const DEMO_SCENARIOS = ['minimal', 'full', 'parallel', 'narrow'] as const
export type DemoScenario = (typeof DEMO_SCENARIOS)[number]
export const DEMO_NOW = Date.parse('2026-10-18T10:00:00Z')

const iso = (agoMs: number) => new Date(DEMO_NOW - agoMs).toISOString()
const MIN = 60_000
const sev = (...s: [keyof typeof SEV_TINT, string][]) => s.map(([severity, text]) => ({ severity, text }))
const base = (slug: string, over: Partial<HarnessRow> = {}): HarnessRow => ({
  slug, stage: 'plan', round: null, waiting: null, stalled: false, now: null, started_at: null, max_critique_rounds: 3,
  severity: { blocker: 0, major: 0, minor: 0, nit: 0 }, rounds: [], passed: 0, failed: 0, total: 0, ...over,
})
const withSeverity = (r: HarnessRow): HarnessRow => ({ ...r, severity: severityOf(r.rounds.flatMap(x => x.problems)) })
const nowOf = (o: Partial<NonNullable<HarnessRow['now']>>): NonNullable<HarnessRow['now']> => ({
  stage: null, doing: null, round: null, last_step: null, next: null, waiting: null, cost_usd: null, at: null, since: null, ...o,
})

const csvExport = withSeverity(base('csv-export', {
  stage: 'setgoal', round: 3, started_at: iso(72 * MIN), total: 3,
  rounds: [
    {
      round: 1, sound: false,
      problems: sev(
        ['major', '"export button" has no check that a file actually downloads — the acceptance cannot be tested'],
        ['major', 'the large-report subgoal edits the auth middleware, outside the plan'],
        ['nit', 'subgoal titles mix verbs and nouns'],
        ['major', 'no subgoal covers an empty report'],
        ['major', 'the goal spec names no column order for the file'],
      ),
    },
    {
      round: 2, sound: false,
      problems: sev(
        ['minor', 'the empty-report subgoal does not say what the file contains'],
        ['blocker', 'the column order is still unspecified, so two subgoals can disagree on it'],
        ['minor', 'subgoal s3 repeats the download check of s1'],
      ),
    },
  ],
  now: nowOf({
    stage: 'setgoal', round: 3, cost_usd: 3.4, at: iso(12_000), since: iso(6 * MIN),
    doing: 'SetGoal is rewriting the spec — critique round 2 rejected it (1 blocker, 2 minor)',
    last_step: 'edited the goal spec — split "export button" into two subgoals',
    next: 'critique round 3 judges the new spec, then 3 subgoals are built',
  }),
}))

export function demoRows(s: DemoScenario): HarnessRow[] {
  switch (s) {
    case 'minimal':
      return [base('fix-date-filter')]
    case 'full':
      return [csvExport]
    case 'parallel':
      return [
        withSeverity({
          ...csvExport, stage: 'implement', round: 3, passed: 1,
          rounds: [...csvExport.rounds, { round: 3, sound: true, problems: [] }],
          now: nowOf({
            stage: 'implement', round: 3, cost_usd: 5.15, at: iso(8_000), since: iso(4 * MIN),
            doing: 'Subgoal s2 is being built — the date range check',
            last_step: 'edited src/export/range.ts — added the end-before-start check', next: 'its gate judges s2, then s3 starts',
          }),
        }),
        base('fix-date-filter', {
          stage: 'setgoal', started_at: iso(20 * MIN), total: 2,
          waiting: { who: 'you', what: 'approve the goal spec — 2 subgoals touch the billing API' },
          now: nowOf({
            stage: 'setgoal', doing: 'SetGoal wrote the spec and waits for approval', at: iso(2 * MIN), since: iso(2 * MIN),
            last_step: 'wrote the goal spec with 2 subgoals', next: 'critique judges the spec after you approve it',
            waiting: { who: 'you', what: 'approve the goal spec — 2 subgoals touch the billing API' },
          }),
        }),
      ]
    case 'narrow':
      return [
        withSeverity(base('export-quarterly-revenue-report-with-regional-breakdown', {
          stage: 'critique', round: 3, started_at: iso(190 * MIN), total: 5, passed: 0,
          waiting: { who: 'you', what: 'confirm whether the legacy invoice PDF route stays or goes before the third critique round starts' },
          rounds: [
            { round: 1, sound: false, problems: sev(['blocker', 'the plan changes the invoice table without a migration step'], ['major', 'no acceptance for currency rounding']) },
            { round: 2, sound: false, problems: sev(['major', 'the regional breakdown subgoal depends on a subgoal that comes after it'], ['minor', 'the file name pattern is left open'], ['nit', 'typo in subgoal s4']) },
          ],
          now: nowOf({
            stage: 'critique', round: 3, cost_usd: 12.8, at: iso(40_000), since: iso(11 * MIN),
            doing: 'Critique is judging the third version of the spec for the quarterly revenue report and its regional breakdown',
            last_step: 'rewrote subgoal s2 so the regional breakdown no longer depends on s4 and the currency rounding has its own acceptance',
            next: 'the third critique round judges the new spec, then 5 subgoals are built one by one',
            waiting: { who: 'you', what: 'confirm whether the legacy invoice PDF route stays or goes before the third critique round starts' },
          }),
        })),
      ]
  }
}

// The command's argument: `demo` takes the scenario after the current one (the first when none), `demo <name>` that
// scenario, `demo off` leaves the demo; anything else is no demo argument (null: the live run).
export function parseDemoArg(args: string, current: DemoScenario | null): DemoScenario | 'off' | null {
  const [head, name] = args.trim().toLowerCase().split(/\s+/)
  if (head !== 'demo') return null
  if (name === 'off') return 'off'
  const named = DEMO_SCENARIOS.find(s => s === name)
  if (named !== undefined) return named
  return DEMO_SCENARIOS[(current === null ? 0 : DEMO_SCENARIOS.indexOf(current) + 1) % DEMO_SCENARIOS.length]!
}

// The pane (Now, and for `full` also Findings) and the band for one scenario at one width, as plain text; the
// report quotes it and the test pins it.
export function renderDemo(scenario: DemoScenario, w: number): string {
  const rows = demoRows(scenario)
  const ordered = openingOrder(rows, {})
  const out: string[] = []
  const pane = (title: string, selected: string | null, tab: PaneTab) => {
    const r = pickRun(ordered, selected)
    if (r === null) return
    const ctx: PaneCtx = { width: w - 4, nowMs: DEMO_NOW, tick: 0, pos: runPosition(ordered, selected), other: otherRunLabel(ordered, selected), tab }
    out.push(`# ${title}`, ...frame('Harness', paneLines(r, ctx), w))
  }
  pane(`${scenario} · pane · ${w} columns`, null, 'now')
  if (scenario === 'parallel') pane(`${scenario} · after next · ${w} columns`, cycleRun(ordered, null, 1), 'now')
  if (scenario === 'full') pane(`${scenario} · findings tab · ${w} columns`, null, 'findings')
  out.push(`# ${scenario} · band · ${w} columns`, ...bandLines(ordered, { width: w, nowMs: DEMO_NOW, tick: 0 }).map(plain))
  return out.join('\n')
}
