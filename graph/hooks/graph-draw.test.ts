import { expect, test } from 'claude-code/testing'

import {
  DEMO_NOW, DEMO_SCENARIOS, bandLines, cells, clipLine, demoRows, detailLines, footerKeys, lineWidth, paneBody, paneFooter, paneLines, plain, renderDemo,
} from './graph-draw'
import type { Line, PaneCtx } from './graph-draw'
import { cycleRun, openingOrder, pickRun, runPosition, standalone } from './status'
import type { GraphRow } from '../types'

const WIDTHS = [190, 110]
const ctxFor = (w: number, over: Partial<PaneCtx> = {}): PaneCtx => ({ width: w - 4, nowMs: DEMO_NOW, tick: 0, pos: { k: 1, n: 1 }, ...over })
const leading = (s: (typeof DEMO_SCENARIOS)[number]) => pickRun(openingOrder(standalone(demoRows(s)), {}), null)!
const text = (ls: Line[]) => ls.map(plain)
const noWords = (s: string) => s.split(/[\s·]+/).filter(x => /^\p{L}+$/u.test(x))

test('cells agrees with the width table: wide and zero-width code points', () => {
  expect(cells('—…⚑한')).toBe(5)
  expect(cells('abc')).toBe(3)
  expect(cells('한국어')).toBe(6)
  expect(cells('á')).toBe(1)
})

test('clipLine cuts by cells and the cut ends in …', () => {
  const l = clipLine([{ t: '한국어 제목이 길다' }], 7)
  expect(lineWidth(l)).toBeLessThanOrEqual(7)
  expect(plain(l).endsWith('…')).toBe(true)
  expect(plain(clipLine([{ t: 'short' }], 9))).toBe('short')
})

test('band: one standalone row with name, node, last step, age and cost', () => {
  const rows = demoRows('full')
  const lines = bandLines(rows, { width: 190, nowMs: DEMO_NOW, tick: 0 })
  expect(lines.length).toBe(1)
  const t = plain(lines[0]!)
  expect(t).toContain('graph')
  expect(t).toContain('c4e1f2a9')
  expect(t).toContain('implement U2')
  expect(t).toContain('Wrote 14 tests')
  expect(t).toContain('38m')
  expect(t).toContain('$3.40')
  expect(t).not.toContain('+')
  expect(t).not.toContain('\n')
})

test('band: cost reads — when null, and a waiting run leads with ⚑', () => {
  const minimal = plain(bandLines(demoRows('minimal'), { width: 190, nowMs: DEMO_NOW, tick: 0 })[0]!)
  expect(minimal.endsWith('—')).toBe(true)
  const waiting = plain(bandLines(openingOrder(standalone(demoRows('parallel')), {}), { width: 190, nowMs: DEMO_NOW, tick: 0 })[0]!)
  expect(waiting.startsWith('⚑')).toBe(true)
})

test('band: +N counts the rest of the standalone runs, never an owned run', () => {
  const ordered = openingOrder(standalone(demoRows('parallel')), {})
  expect(ordered.length).toBe(2)
  const t = plain(bandLines(demoRows('parallel'), { width: 190, nowMs: DEMO_NOW, tick: 0 })[0]!)
  expect(t).toMatch(/\+1$/)
  expect(t).not.toContain('b33f00d1')
})

test('band: a stalled run reads stalled with its age, dimmed, with no spinner glyph', () => {
  const stalled: GraphRow = { ...demoRows('full')[0]!, stalled: true, last_change_ms: DEMO_NOW - 3 * 3_600_000 }
  const line = bandLines([stalled], { width: 190, nowMs: DEMO_NOW, tick: 0 })[0]!
  expect(plain(line)).toContain('stalled · 3h 0m')
  expect(line.every(s => s.dim === true || s.t.trim() === '' || s.tint === 'inactive')).toBe(true)
  for (const g of ['✎', '⌕', '▸', '⚖']) expect(plain(line)).not.toContain(g)
})

test('band: a stalled run that waits on the person still leads with ⚑', () => {
  for (const w of WIDTHS) {
    const t = plain(bandLines(demoRows('narrow'), { width: w, nowMs: DEMO_NOW, tick: 0 })[0]!)
    expect(t.startsWith('⚑')).toBe(true)
    expect(t).toContain('stalled ·')
    expect(t.startsWith('◌')).toBe(false)
  }
})

test('pane header: right part is id8 · state · age · cost · run k of n, no key names', () => {
  const r = leading('full')
  const head = plain(paneBody(r, ctxFor(190, { pos: { k: 1, n: 2 } }))[1]!)
  expect(head.endsWith('c4e1f2a9 · running · 38m · $3.40 · run 1 of 2')).toBe(true)
  expect(head).not.toMatch(/\bq\b|\[|\]/)
})

test('pane: a Now line, a last-step line with its age, and — when the last step is null', () => {
  const full = text(paneBody(leading('full'), ctxFor(190)))
  expect(full.some(l => l.includes('Now') && l.includes('implement U2') && l.includes('try 2 of 3') && l.includes('codex·gpt-5') && l.endsWith('3m'))).toBe(true)
  expect(full.some(l => l.includes('Last') && l.includes('Wrote 14 tests') && l.endsWith('2m'))).toBe(true)
  const none = text(paneBody(leading('minimal'), ctxFor(190)))
  expect(none.some(l => /Last\s+—\s+—$/.test(l))).toBe(true)
})

test('pane: the ⚑ waits line names unavailable_vendors, and only a blocked run has it', () => {
  const blocked = text(paneBody(leading('narrow'), ctxFor(190)))
  expect(blocked.some(l => l.startsWith('⚑ waits on you') && l.includes('unavailable: codex, gemini'))).toBe(true)
  expect(text(paneBody(leading('full'), ctxFor(190))).some(l => l.includes('waits on you'))).toBe(false)
})

test('pane: each subgoal is one line and its columns start at the same cell on every row', () => {
  for (const w of WIDTHS) {
    const lines = paneBody(leading('full'), ctxFor(w))
    const sg = lines.filter(l => /^U\d/.test(plain(l)))
    expect(sg.length).toBe(3)
    const offsets = (l: Line) => l.map((_, i) => lineWidth(l.slice(0, i)))
    for (const l of sg.slice(1)) expect(offsets(l)).toEqual(offsets(sg[0]!))
    expect(plain(sg[1]!)).toContain('try 2')
    expect(plain(sg[1]!)).toContain('codex·gpt-5')
  }
})

test('pane: a rejected try is one ↳ line with reason and feedback, ending in … when long', () => {
  const rej = text(paneBody(leading('full'), ctxFor(110))).filter(l => l.includes('↳'))
  expect(rej.length).toBe(1)
  expect(rej[0]).toContain('try 1 rejected: the legacy endpoint')
  expect(rej[0]!.endsWith('…')).toBe(true)
  const wide = text(paneBody(leading('full'), ctxFor(400))).find(l => l.includes('↳'))!
  expect(wide).toContain('— Return the buffered body')
  expect(wide.endsWith('…')).toBe(false)
})

test('pane: a gates count counts gates, not attempts, on the Subgoals line', () => {
  const gates = (s: (typeof DEMO_SCENARIOS)[number]) => text(paneBody(leading(s), ctxFor(190))).find(l => l.startsWith('Subgoals'))!
  expect(gates('full').endsWith('gates 1/4')).toBe(true)
  expect(gates('parallel').endsWith('gates 0/1')).toBe(true)
  expect(gates('narrow').endsWith('gates 0/2')).toBe(true)
})

test('pane: a subgoal that has not started has no try; the last step of a run has its age', () => {
  const sg = (s: (typeof DEMO_SCENARIOS)[number], id: string) => text(paneBody(leading(s), ctxFor(190))).find(l => l.startsWith(`${id} `))!
  expect(sg('full', 'U3')).not.toContain('try')
  expect(sg('full', 'U2')).toContain('try 2')
  expect(sg('narrow', 'U2')).not.toContain('try')
  expect(sg('parallel', 'U1')).not.toContain('try')
  const last = text(paneBody(leading('parallel'), ctxFor(190))).find(l => l.includes('Last'))!
  expect(last).toContain('Listed the keys that expire this month')
  expect(last.endsWith('48m')).toBe(true)
})

test('pane: "under <key>" is in the tab row only when ctx.owner is given', () => {
  const r = leading('full')
  const owned = text(paneBody(r, ctxFor(190, { owner: 'E-3f9a21c0/P2' })))
  expect(owned[0]).toContain('under E-3f9a21c0/P2')
  expect(owned.slice(1).some(l => l.includes('under '))).toBe(false)
  expect(text(paneBody(r, ctxFor(190))).some(l => l.includes('under '))).toBe(false)
})

test('pane: a teams-engine row with no cost or last step reads — for both', () => {
  const r: GraphRow = { ...leading('full'), cost_usd: null, last_step: null, nodes: leading('full').nodes.map(n => ({ ...n, last_step: null })) }
  const t = text(paneBody(r, ctxFor(190)))
  expect(t[1]).toContain('· — ·')
  expect(t.some(l => /^\s*Last\s+—/.test(l))).toBe(true)
})

test('footer: one dim line, [ ] only with two runs or more, label q, no word twice', () => {
  expect(plain(paneFooter(1))).toBe('[ q ] close')
  expect(plain(paneFooter(2))).toBe('[ prev next ]  [ q ] close')
  expect(footerKeys(1).some(k => k.key === '[ ]')).toBe(false)
  for (const n of [1, 2, 3]) {
    const f = paneFooter(n)
    expect(f.every(s => s.dim === true)).toBe(true)
    const words = noWords(plain(f))
    expect(new Set(words).size).toBe(words.length)
  }
  const lines = paneLines(leading('full'), ctxFor(190, { pos: { k: 1, n: 2 } }))
  expect(plain(lines[lines.length - 1]!)).toBe('[ prev next ]  [ q ] close')
  expect(text(lines.slice(0, -1)).some(l => /\[ q \] close|\[ prev/.test(l))).toBe(false)
})

test('every scenario at 190 and 110 fits: no line over its width, no break, no cut glyph, long text ends in …', () => {
  for (const s of DEMO_SCENARIOS) {
    for (const w of WIDTHS) {
      const out = renderDemo(s, w)
      const lines = out.split('\n')
      expect(lines.length).toBeGreaterThan(5)
      for (const l of lines) {
        expect(cells(l)).toBeLessThanOrEqual(w)
        expect(/[�\r\t]/.test(l)).toBe(false)
        expect(/\p{Surrogate}/u.test(l)).toBe(false)
      }
      const ordered = openingOrder(standalone(demoRows(s)), {})
      const pane = paneBody(pickRun(ordered, null)!, ctxFor(w, { pos: runPosition(ordered, null) }))
      for (const l of pane) expect(lineWidth(l)).toBeLessThanOrEqual(w - 4)
      for (const l of text(pane).filter(x => x.includes('↳'))) expect(l.endsWith('…') || cells(l) < w - 4).toBe(true)
      const head = plain(pane[1]!)
      const pos = runPosition(ordered, null)
      expect(head).toMatch(/[0-9a-f]{8} · (running|blocked|stalled|complete) · \d+[smhd]( \d+[smhd])? · (\$[\d.]+|—) · run \d of \d$/)
      expect(head.endsWith(` · run ${pos.k} of ${pos.n}`)).toBe(true)
      expect(lines.filter(l => l.startsWith('# ')).length).toBe(s === 'parallel' ? 3 : 2)
    }
  }
  expect(renderDemo('narrow', 110)).toContain('…')
  expect(renderDemo('full', 110).split('\n').some(l => l.includes('↳') && l.includes('…'))).toBe(true)
})

test('parallel shows two standalone runs and no owned run; [ ] reach both', () => {
  const rows = demoRows('parallel')
  expect(rows.filter(r => r.owner !== null).length).toBe(1)
  const ordered = openingOrder(standalone(rows), {})
  expect(ordered.map(r => r.id8)).toEqual(['5ee1abcd', 'f00dbabe'])
  expect(cycleRun(ordered, null, 1)).toBe(ordered[1]!.run_id)
  for (const w of WIDTHS) {
    const out = renderDemo('parallel', w)
    expect(out).toContain('run 1 of 2')
    expect(out).toContain('run 2 of 2')
    expect(out).toContain('[ prev next ]  [ q ] close')
    expect(out).not.toContain('b33f00d1')
    expect(out).not.toContain('E-3f9a21c0/P2')
  }
})

test('detailLines: skipped nodes absent, attempt shown from 2, agent column aligned, feedback and reason under their node', () => {
  const r = leading('full')
  const nodes = [
    ...r.nodes.filter(n => n.node_id === 'plan' || n.node_id === 'gate:U2:1' || n.node_id === 'implement:U2:2'),
    { ...r.nodes[0]!, node_id: 'test:U9:1', stage: 'test', subgoal_id: 'U9', state: 'skipped', attempt: 1 },
  ]
  const ls = text(detailLines({ ...r, nodes }, ctxFor(190)))
  const body = ls.slice(3)
  expect(ls.join('\n')).not.toContain('U9')
  expect(body.some(l => l.includes('implement U2 (attempt 2)'))).toBe(true)
  expect(body.some(l => l.includes('plan ') && !l.includes('attempt'))).toBe(true)
  expect(body.some(l => l.startsWith('  feedback: Return the buffered body'))).toBe(true)
  expect(body.some(l => l.startsWith('  the legacy endpoint still streams'))).toBe(true)
  const col = body.filter(l => /^[✔✘▸✎⌕…◌○] /u.test(l)).map(l => l.indexOf('codex') >= 0 ? l.indexOf('codex') : l.indexOf('claude-sonnet'))
  expect(new Set(col).size).toBe(1)
})

test('detailLines: the words come from ctx.words (Korean session)', () => {
  const r = leading('full')
  const nodes = r.nodes.filter(n => n.node_id === 'implement:U2:2')
  const words = { attempt: '({n}번째 시도)', feedback: '전달된 피드백', more: '+{n}건 더' }
  const ls = text(detailLines({ ...r, nodes }, ctxFor(190, { words })))
  expect(ls.some(l => l.includes('(2번째 시도)'))).toBe(true)
  expect(ls.some(l => l.startsWith('  전달된 피드백: '))).toBe(true)
  const many = Array.from({ length: 30 }, (_, i) => ({ ...r.nodes[0]!, node_id: `plan:${i}`, subgoal_id: `S${i}`, state: 'done', attempt: 1, feedback: null, reason: null }))
  expect(text(detailLines({ ...r, nodes: many }, ctxFor(190, { words }))).pop()).toBe('  +6건 더')
})

test('detailLines: at most 24 node rows then "+n more"; every line fits both widths, a cut ends in …', () => {
  const r = leading('full')
  const many = Array.from({ length: 30 }, (_, i) => ({ ...r.nodes[0]!, node_id: `plan:${i}`, subgoal_id: `S${i}`, state: 'done', attempt: 1, feedback: null, reason: null }))
  const ls = text(detailLines({ ...r, nodes: many }, ctxFor(190)))
  expect(ls.filter(l => l.startsWith('✔')).length).toBe(24)
  expect(ls[ls.length - 1]).toBe('  +6 more')
  for (const w of WIDTHS) {
    for (const d of detailLines(leading('narrow'), ctxFor(w))) {
      expect(lineWidth(d)).toBeLessThanOrEqual(w - 4)
    }
  }
  const cut = detailLines(leading('narrow'), ctxFor(40)).map(plain)
  expect(cut.some(l => l.endsWith('…'))).toBe(true)
})

// Producer for the demo renders. The plugin test runner reads no env and imports no node:fs, so each render is
// printed between marker lines; graph/scripts/split-demo.mjs cuts `claude plugin test .` stdout into files.
test('prints every demo render between marker lines', () => {
  for (const s of DEMO_SCENARIOS) {
    for (const w of WIDTHS) {
      console.log(`=== demo-${s}-${w} ===\n${renderDemo(s, w)}\n=== end ===`)
    }
  }
})
