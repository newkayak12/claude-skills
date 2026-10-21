/*
 * Graph-only drawing: the band row and the pane as lines of styled segments, and the demo fixtures. Pure: every
 * function takes a row (status.ts) and a width and returns lines; mod.tsx only renders them (renderLines).
 * Follows harness/hooks/harness-draw.tsx. draw.tsx stays the copy shared with teams and harness, so nothing here edits it.
 *
 * Width is counted in terminal cells (cells): a Korean syllable is 2, so a line that fits by cells never wraps.
 */
import type { GraphRow, GraphRowNode } from '../types'
import type { Ui } from './draw'
import { NONE, ageText, costText, cycleRun, openingOrder, pickRun, runPosition, standalone } from './status'

/* --- cell width --- */

// [from, to, cells]: zero-width and double-width ranges; every other code point is one cell
const WIDTH_RANGES: readonly (readonly [number, number, number])[] = [
  [0x0, 0x1f, 0], [0x300, 0x36f, 0], [0x200b, 0x200f, 0], [0xfe0f, 0xfe0f, 0],
  [0x1100, 0x115f, 2], [0x2e80, 0xa4cf, 2], [0xac00, 0xd7a3, 2], [0xf900, 0xfaff, 2], [0xfe30, 0xfe4f, 2],
  [0xff00, 0xff60, 2], [0xffe0, 0xffe6, 2], [0x1f300, 0x1faff, 2], [0x20000, 0x3fffd, 2],
]
const cellOf = (cp: number) => WIDTH_RANGES.find(([a, b]) => cp >= a && cp <= b)?.[2] ?? 1
export const cells = (text: string) => Array.from(text).reduce((n, c) => n + cellOf(c.codePointAt(0)!), 0)

/* --- glyphs: only these mark state --- */

export const GLYPH = { edit: '✎', read: '⌕', run: '▸', think: '…', judge: '⚖', done: '✔', fail: '✘', idle: '◌', you: '⚑', todo: '○' } as const

// the spinner: the action glyphs that fit the stage, one frame per tick
const FRAMES: Record<string, readonly string[]> = {
  plan: [GLYPH.edit, GLYPH.think],
  setgoal: [GLYPH.edit, GLYPH.think],
  critique: [GLYPH.judge, GLYPH.think],
  implement: [GLYPH.edit, GLYPH.read, GLYPH.run],
  test: [GLYPH.run, GLYPH.read],
  gate: [GLYPH.judge, GLYPH.think],
  report: [GLYPH.edit, GLYPH.think],
}
export function spinnerFrame(tick: number, stage = 'implement'): string {
  const f = FRAMES[stage] ?? FRAMES.implement!
  return f[((tick % f.length) + f.length) % f.length]!
}

/* --- lines of segments --- */

export type Tint = 'success' | 'claude' | 'inactive' | 'error'
export type Seg = { t: string; tint?: Tint; bold?: boolean; dim?: boolean }
export type Line = Seg[]

const seg = (t: string, o: Omit<Seg, 't'> = {}): Seg => ({ t, ...o })
export const plain = (l: Line) => l.map(s => s.t).join('')
export const lineWidth = (l: Line) => l.reduce((n, s) => n + cells(s.t), 0)

// cut to w cells; the cut ends in …
export function clipLine(l: Line, w: number): Line {
  if (lineWidth(l) <= w) return l
  if (w <= 0) return []
  const out: Line = []
  let left = w - 1
  for (const s of l) {
    if (left <= 0) break
    let kept = ''
    let cut = false
    for (const c of Array.from(s.t)) {
      const n = cellOf(c.codePointAt(0)!)
      if (n > left) {
        cut = true
        break
      }
      kept += c
      left -= n
    }
    if (kept !== '') out.push({ ...s, t: kept })
    if (cut) break
  }
  const last = out[out.length - 1]
  if (last === undefined) return [seg('…')]
  out[out.length - 1] = { ...last, t: `${last.t.trimEnd()}…` }
  return out
}

export const clip = (text: string, w: number) => plain(clipLine([seg(text)], w))
const pad = (text: string, w: number) => text + ' '.repeat(Math.max(0, w - cells(text)))

// A row of segments that must fit w. Lowest priority goes first: `drop` > 0 segments leave in descending order,
// each first cut to `min` cells (… at the cut) when it has one; segments with no `drop` never leave, and only
// truncate (widest first) unless `fixed`. `right` on the last segment pads it to the right edge. Never wider than w.
export type FitSeg = { parts: Seg[]; sep?: string; drop?: number; min?: number; fixed?: boolean; right?: boolean }
export const fs = (text: string, o: Omit<FitSeg, 'parts'> & Omit<Seg, 't'> = {}): FitSeg => {
  const { sep, drop, min, fixed, right, ...style } = o
  return { parts: [seg(text, style)], sep, drop, min, fixed, right }
}
const fw = (f: FitSeg) => lineWidth(f.parts)

export function fit(input: readonly FitSeg[], w: number): Line {
  const segs = input.filter(f => fw(f) > 0)
  const total = () => segs.reduce((n, f, i) => n + (i > 0 ? cells(f.sep ?? '') : 0) + fw(f), 0)
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
  const gap = w - total()
  segs.forEach((f, i) => {
    if (i > 0 && f.sep) out.push(seg(f.sep, { dim: true }))
    if (f.right && i === segs.length - 1 && i > 0 && gap > 0) out.push(seg(' '.repeat(gap)))
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
  const top = `╭─ ${title} ${'─'.repeat(Math.max(0, w - 5 - cells(title)))}╮`
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

/* --- what a row says --- */

const oneLine = (v: string | null) => (v ?? '').replace(/\s+/g, ' ').trim()
const nodeLabel = (n: GraphRowNode) => (n.subgoal_id !== null ? `${n.stage} ${n.subgoal_id}` : n.stage)
const runningNode = (r: GraphRow) => r.nodes.find(n => n.state === 'running') ?? null
const createdMs = (r: GraphRow) => {
  const ms = Date.parse(r.created_at)
  return Number.isFinite(ms) ? ms : null
}
const sinceText = (from: number | null, nowMs: number) => ageText(from === null ? null : nowMs - from)
const stateWord = (r: GraphRow) => (r.stalled ? 'stalled' : r.state)
const tryText = (n: GraphRowNode, max: number | null) => (n.attempt === null ? '' : `try ${n.attempt}${max !== null ? ` of ${max}` : ''}`)

const stateGlyph = (r: GraphRow, tick: number): Seg => {
  if (r.routing_blocked) return seg(GLYPH.you, { tint: 'claude', bold: true })
  if (r.state === 'complete') return seg(GLYPH.done, { tint: 'success', bold: true })
  const run = runningNode(r)
  if (run !== null && !r.stalled) return seg(spinnerFrame(tick, run.stage), { tint: 'claude', bold: true })
  return seg(GLYPH.idle, { tint: 'inactive', bold: true })
}

/* --- the band: one row for the leading standalone run --- */

// `ordered` is the opening order; an owned or closed run is dropped here too, so it never adds to +N.
// `reserve` cells at the end are left to mod.tsx's open button.
export function bandLines(ordered: readonly GraphRow[], o: { width: number; nowMs: number; tick: number; reserve?: number }): Line[] {
  const rows = standalone(ordered)
  const r = rows[0]
  if (r === undefined) return []
  const more = rows.length - 1
  const dim = r.stalled
  const run = runningNode(r)
  const plus: FitSeg = { ...fs(`+${more}`, { sep: '  ', fixed: true, dim: true }), right: true }
  const parts: FitSeg[] = [
    { parts: [dim ? seg(GLYPH.idle, { tint: 'inactive', bold: true }) : stateGlyph(r, o.tick)], fixed: true },
    fs('graph', { sep: ' ', drop: 6, dim: true }),
    fs(r.id8, { sep: ' ', bold: !dim, dim }),
  ]
  if (dim) parts.push(fs(`stalled · ${sinceText(r.last_change_ms, o.nowMs)}`, { sep: ' ', dim: true }))
  else {
    parts.push(
      run === null ? fs('') : fs(nodeLabel(run), { sep: ' · ', drop: 2, min: 10 }),
      r.last_step === null ? fs('') : fs(r.last_step, { sep: ' · ', drop: 4, min: 16, dim: true }),
      fs(sinceText(createdMs(r), o.nowMs), { sep: ' · ', drop: 3 }),
    )
  }
  parts.push(fs(costText(r), { sep: ' · ', fixed: true, bold: !dim, dim }), more > 0 ? plus : fs(''))
  return [fit(parts, o.width - (o.reserve ?? 0))]
}

/* --- the pane --- */

export type PaneCtx = { width: number; nowMs: number; tick: number; pos: { k: number; n: number }; owner?: string }

// the keys, as label pairs: `[ ]` only with a second run to go to
export const footerKeys = (n: number): { key: string; label: string }[] => [
  ...(n >= 2 ? [{ key: '[ ]', label: 'switch run' }] : []),
  { key: 'q', label: 'close' },
]
// one dim footer, the only place keys are named
export const paneFooter = (n: number): Line =>
  footerKeys(n).flatMap((k, i) => [...(i > 0 ? [seg('  ·  ', { dim: true })] : []), seg(`${k.key} ${k.label}`, { dim: true })])

const tabLine = (c: PaneCtx): Line => [seg('graph', { bold: true }), ...(c.owner !== undefined ? [seg(`  under ${c.owner}`, { dim: true })] : [])]

function headerLine(r: GraphRow, c: PaneCtx): Line {
  const right = [
    fs(r.id8, { fixed: true, bold: true }),
    fs(stateWord(r), { sep: ' · ', fixed: true }),
    fs(sinceText(createdMs(r), c.nowMs), { sep: ' · ', drop: 2 }),
    fs(costText(r), { sep: ' · ', fixed: true }),
    fs(`run ${c.pos.k} of ${c.pos.n}`, { sep: ' · ', drop: 1 }),
  ]
  return leftRight([seg(r.request, { bold: true })], right, c.width, 20)
}

function nowLine(r: GraphRow, c: PaneCtx): Line {
  const run = runningNode(r)
  const left: Line = [stateGlyph(r, c.tick), seg(' '), seg('Now   ', { dim: true }), seg(run === null ? 'idle' : nodeLabel(run), run === null ? { dim: true } : {})]
  if (run === null) return clipLine(left, c.width)
  const right = [
    fs(tryText(run, r.max_retries), { drop: 1 }),
    fs(run.agent ?? NONE, { sep: ' · ', drop: 3, min: 12 }),
    fs(run.started_at === null ? NONE : ageText(c.nowMs - run.started_at), { sep: ' · ', fixed: true }),
  ]
  return leftRight(left, right, c.width, 14)
}

function lastLine(r: GraphRow, c: PaneCtx): Line {
  const from = r.last_step === null ? undefined : r.nodes.filter(n => n.last_step === r.last_step).sort((a, b) => (b.finished_at ?? 0) - (a.finished_at ?? 0))[0]
  const age = from?.finished_at ?? null
  const left: Line = [seg('  '), seg('Last  ', { dim: true }), seg(r.last_step === null ? NONE : oneLine(r.last_step))]
  return leftRight(left, [fs(age === null ? NONE : ageText(c.nowMs - age), { dim: true })], c.width, 20)
}

const waitsLine = (r: GraphRow, c: PaneCtx): Line => {
  const names = Object.keys(r.unavailable_vendors)
  return clipLine([seg(GLYPH.you, { tint: 'claude', bold: true }), seg(' waits on you', { bold: true }), ...(names.length > 0 ? [seg(` · unavailable: ${names.join(', ')}`)] : [])], c.width)
}

const STAGES = ['implement', 'test', 'gate'] as const
const latest = (nodes: GraphRowNode[]) => nodes.reduce<GraphRowNode | null>((a, n) => (a === null || (n.attempt ?? 0) >= (a.attempt ?? 0) ? n : a), null)

function stageIcon(n: GraphRowNode | null, tick: number): Seg {
  if (n === null || n.state === 'pending') return seg(GLYPH.todo, { tint: 'inactive' })
  if (n.state === 'done') return seg(GLYPH.done, { tint: 'success' })
  if (n.state === 'failed') return seg(GLYPH.fail, { tint: 'error' })
  if (n.state === 'running') return seg(spinnerFrame(tick, n.stage), { tint: 'claude', bold: true })
  return seg(GLYPH.idle, { tint: 'inactive' })
}

// one line per subgoal, each column a segment of its own width, so the columns start at the same cell on every row;
// a rejected try adds one ↳ line under it
function subgoalLines(r: GraphRow, c: PaneCtx): Line[] {
  const per = r.subgoals.map(sg => {
    const mine = r.nodes.filter(n => n.subgoal_id === sg.id)
    const impl = latest(mine.filter(n => n.stage === 'implement'))
    const started = mine.map(n => n.started_at).filter((x): x is number => x !== null)
    const ended = mine.some(n => n.state === 'running') ? c.nowMs : Math.max(0, ...mine.map(n => n.finished_at ?? 0))
    return {
      sg, mine,
      id: sg.id,
      title: oneLine(sg.title),
      icons: STAGES.map(s => stageIcon(latest(mine.filter(n => n.stage === s)), c.tick)),
      tries: impl === null ? '' : tryText(impl, null),
      agent: impl?.agent ?? NONE,
      time: started.length === 0 || ended === 0 ? NONE : ageText(ended - Math.min(...started)),
    }
  })
  const col = (f: (p: (typeof per)[number]) => string) => Math.max(0, ...per.map(p => cells(f(p))))
  const idW = col(p => p.id)
  const tryW = col(p => p.tries)
  const agentW = Math.min(24, col(p => p.agent))
  const timeW = col(p => p.time)
  const rest = c.width - (idW + 2) - 7 - (tryW + 2) - (agentW + 2) - timeW
  const titleW = Math.max(8, Math.min(col(p => p.title), rest))
  const out: Line[] = []
  for (const p of per) {
    const icons: Seg[] = p.icons.flatMap((s, i) => (i > 0 ? [seg(' '), s] : [s]))
    out.push(clipLine([
      seg(pad(p.id, idW + 2), { bold: true }), ...icons, seg('  '),
      seg(pad(clip(p.title, titleW), titleW + 2)),
      seg(pad(p.tries, tryW + 2), { dim: true }),
      seg(pad(clip(p.agent, agentW), agentW + 2), { dim: true }),
      seg(pad(p.time, timeW), { dim: true }),
    ], c.width))
    for (const f of p.mine.filter(n => n.state === 'failed').sort((a, b) => (a.attempt ?? 0) - (b.attempt ?? 0))) {
      const retry = p.mine.find(n => n.stage === 'implement' && n.attempt === (f.attempt ?? 0) + 1)
      const why = [oneLine(f.reason), oneLine(retry?.feedback ?? f.feedback)].filter(x => x !== '').join(' — ')
      out.push(clipLine([seg(' '.repeat(idW + 2)), seg('↳ ', { dim: true }), seg(`try ${f.attempt ?? '?'} rejected`, { tint: 'error' }), seg(why === '' ? '' : `: ${why}`)], c.width))
    }
  }
  return out
}

// everything but the footer: mod.tsx draws the footer's keys as buttons
export function paneBody(r: GraphRow, c: PaneCtx): Line[] {
  const gates = r.nodes.filter(n => n.stage === 'gate')
  const out: Line[] = [tabLine(c), headerLine(r, c), [], nowLine(r, c), lastLine(r, c)]
  if (r.routing_blocked) out.push(waitsLine(r, c))
  if (r.subgoals.length > 0) {
    const done = gates.filter(n => n.state === 'done').length
    out.push([], leftRight([seg('Subgoals', { bold: true })], [fs(`gates ${done}/${gates.length}`, { dim: true })], c.width, 8), ...subgoalLines(r, c))
  }
  return out.map(l => clipLine(l, c.width))
}

export const paneLines = (r: GraphRow, c: PaneCtx): Line[] => [...paneBody(r, c), [], clipLine(paneFooter(c.pos.n), c.width)]

/* --- the demo: fixtures rendered to plain text, no live run. Fictional runs only. --- */

export const DEMO_SCENARIOS = ['minimal', 'full', 'parallel', 'narrow'] as const
export type DemoScenario = (typeof DEMO_SCENARIOS)[number]
export const DEMO_NOW = Date.parse('2026-10-18T10:00:00Z')

const MIN = 60_000
const at = (agoMs: number) => DEMO_NOW - agoMs
const node = (node_id: string, state: string, o: Partial<GraphRowNode> = {}): GraphRowNode => {
  const [stage = '', sg = null, n = null] = node_id.split(':')
  return {
    node_id, stage, subgoal_id: sg === 'goal' ? null : sg, state, attempt: n === null ? 1 : Number(n),
    agent: null, started_at: null, finished_at: null, reason: null, feedback: null, last_step: null, ...o,
  }
}
const run = (id8: string, request: string, over: Partial<GraphRow> = {}): GraphRow => ({
  id8, state: 'running', owner: null, created_at: new Date(at(10 * MIN)).toISOString(), cost_usd: null, running: null,
  run_id: `${id8}-0000-4000-8000-000000000000`, file: `/demo/.harness-run/broker/runs/${id8}.json`, request, max_retries: 3,
  last_change: new Date(at(MIN)).toISOString(), last_change_ms: at(MIN), age_ms: MIN, open: true, stalled: false,
  routing_blocked: false, unavailable_vendors: {}, subgoals: [], last_step: null, acting: false, rejects: 0, nodes: [], ...over,
})
const CODEX = 'codex·gpt-5'
const SONNET = 'claude-sonnet-5-5'

export function demoRows(s: DemoScenario): GraphRow[] {
  const minimal = run('0a1b2c3d', 'Add a health check endpoint', {
    created_at: new Date(at(4 * MIN)).toISOString(), last_change_ms: at(20_000), age_ms: 20_000, acting: true,
    running: { node_id: 'implement:U1:1', last_step: null },
    subgoals: [{ id: 'U1', title: 'Health route' }],
    nodes: [node('plan', 'done', { agent: SONNET, started_at: at(4 * MIN), finished_at: at(2 * MIN) }),
      node('implement:U1:1', 'running', { agent: CODEX, started_at: at(90_000) }), node('test:U1:1', 'pending'), node('gate:U1:1', 'pending')],
  })
  const full = run('c4e1f2a9', 'Migrate the invoice export to streaming CSV and keep the old endpoint working behind a flag', {
    created_at: new Date(at(38 * MIN)).toISOString(), cost_usd: 3.4, last_change_ms: at(30_000), age_ms: 30_000, acting: true, rejects: 1,
    last_step: 'Wrote 14 tests for the streaming writer', running: { node_id: 'implement:U2:2', last_step: 'Wrote 14 tests for the streaming writer' },
    subgoals: [{ id: 'U1', title: 'Streaming writer' }, { id: 'U2', title: 'Flag the old endpoint' }, { id: 'U3', title: 'Docs and changelog' }],
    nodes: [
      node('plan', 'done', { agent: SONNET, started_at: at(38 * MIN), finished_at: at(34 * MIN) }),
      node('implement:U1:1', 'done', { agent: CODEX, started_at: at(33 * MIN), finished_at: at(24 * MIN) }),
      node('test:U1:1', 'done', { agent: CODEX, started_at: at(24 * MIN), finished_at: at(2 * MIN), last_step: 'Wrote 14 tests for the streaming writer' }),
      node('gate:U1:1', 'done', { agent: SONNET, started_at: at(22 * MIN), finished_at: at(20 * MIN) }),
      node('implement:U2:1', 'done', { agent: CODEX, started_at: at(19 * MIN), finished_at: at(12 * MIN) }),
      node('test:U2:1', 'done', { agent: CODEX, started_at: at(12 * MIN), finished_at: at(9 * MIN) }),
      node('gate:U2:1', 'failed', {
        attempt: 1, agent: SONNET, started_at: at(9 * MIN), finished_at: at(7 * MIN),
        reason: 'the legacy endpoint still streams when the flag is off, so existing clients receive chunked output they cannot parse',
        feedback: 'Return the buffered body when the flag is off and add a regression test for the old response headers',
      }),
      node('implement:U2:2', 'running', { agent: CODEX, started_at: at(3 * MIN + 12_000), feedback: 'Return the buffered body when the flag is off and add a regression test for the old response headers' }),
      node('test:U2:2', 'pending'), node('gate:U2:2', 'pending'),
      node('implement:U3:1', 'pending'), node('test:U3:1', 'pending'), node('gate:U3:1', 'pending'),
      node('gate:goal:1', 'pending'), node('report', 'pending'),
    ],
  })
  const narrow = run('e7d90b12', '결제 웹훅 재시도 로직을 멱등하게 바꾸고 중복 처리 방지 테스트를 추가한다', {
    state: 'blocked', created_at: new Date(at(4 * 60 * MIN)).toISOString(), last_change_ms: at(3 * 60 * MIN + 5 * MIN), age_ms: 3 * 60 * MIN + 5 * MIN,
    stalled: true, routing_blocked: true, unavailable_vendors: { codex: 'quota', gemini: 'offline' }, rejects: 1,
    last_step: '중복 요청을 막는 키 생성 규칙을 정리했다',
    subgoals: [{ id: 'U1', title: '멱등 키 생성과 저장소 조회 흐름 정리' }, { id: 'U2', title: '중복 처리 방지 테스트' }],
    nodes: [
      node('plan', 'done', { agent: SONNET, started_at: at(4 * 60 * MIN), finished_at: at(235 * MIN) }),
      node('implement:U1:1', 'done', { agent: CODEX, started_at: at(230 * MIN), finished_at: at(210 * MIN), last_step: '중복 요청을 막는 키 생성 규칙을 정리했다' }),
      node('test:U1:1', 'done', { agent: CODEX, started_at: at(210 * MIN), finished_at: at(200 * MIN) }),
      node('gate:U1:1', 'failed', {
        agent: SONNET, started_at: at(200 * MIN), finished_at: at(190 * MIN),
        reason: '저장소 조회가 실패하면 같은 키로 두 번 결제가 승인될 수 있어 멱등성이 보장되지 않는다',
        feedback: '조회 실패 시 재시도하지 말고 요청을 보류 상태로 남기도록 고친다',
      }),
      node('implement:U2:1', 'pending'), node('test:U2:1', 'pending'), node('gate:U2:1', 'pending'),
    ],
  })
  if (s === 'minimal') return [minimal]
  if (s === 'full') return [full]
  if (s === 'narrow') return [narrow]
  const second = run('5ee1abcd', 'Rotate the API signing keys', {
    state: 'blocked', routing_blocked: true, unavailable_vendors: { gemini: 'quota' }, cost_usd: 0.8, created_at: new Date(at(52 * MIN)).toISOString(),
    last_change_ms: at(6 * MIN), age_ms: 6 * MIN, last_step: 'Listed the keys that expire this month',
    subgoals: [{ id: 'U1', title: 'Rotate and re-sign' }],
    nodes: [node('plan', 'done', { agent: SONNET, started_at: at(52 * MIN), finished_at: at(48 * MIN) }), node('implement:U1:1', 'pending')],
  })
  const owned = run('b33f00d1', 'Fix the retry loop in the worker', {
    owner: { task_id: 'demo-task', key: 'E-3f9a21c0/P2' }, acting: true, running: { node_id: 'implement:U1:1', last_step: null },
    subgoals: [{ id: 'U1', title: 'Retry loop' }], nodes: [node('implement:U1:1', 'running', { agent: CODEX, started_at: at(5 * MIN) })],
  })
  return [{ ...minimal, id8: 'f00dbabe', request: 'Add a health check endpoint', run_id: 'f00dbabe-0000-4000-8000-000000000000' }, second, owned]
}

// The pane and the band for one scenario at one width, as plain text. The owned run of `parallel` is absent from both.
export function renderDemo(scenario: DemoScenario, w: number): string {
  const ordered = openingOrder(standalone(demoRows(scenario)), {})
  const out: string[] = []
  const pane = (title: string, selected: string | null) => {
    const r = pickRun(ordered, selected)
    if (r === null) return
    const ctx: PaneCtx = { width: w - 4, nowMs: DEMO_NOW, tick: 0, pos: runPosition(ordered, selected) }
    out.push(`# ${title}`, ...frame('Graph', paneLines(r, ctx), w))
  }
  pane(`${scenario} · pane · ${w} columns`, null)
  if (scenario === 'parallel') pane(`${scenario} · after next · ${w} columns`, cycleRun(ordered, null, 1))
  out.push(`# ${scenario} · band · ${w} columns`, ...bandLines(ordered, { width: w, nowMs: DEMO_NOW, tick: 0 }).map(plain))
  return out.join('\n')
}
