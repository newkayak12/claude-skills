import { expect, test } from 'claude-code/testing'

import type { HarnessRow } from '../types'
import {
  ALLOWED, DEMO_NOW, DEMO_SCENARIOS, GLYPH, RAIL_GLYPHS, STATE_GLYPHS, bandLines, clip, clipLine, demoRows, fit, frame, fs, leftRight, lineWidth,
  innerWidth, paneContent, paneHead, paneLines, parseDemoArg, plain, railLine, renderDemo, spinnerFrame, stateGlyph, tabRowPlan,
} from './harness-draw'
import { openingOrder, otherRunLabel, pickRun, railItems, runPosition } from './status'

const WIDTHS = [190, 110]
const row = (slug: string, over: Partial<HarnessRow> = {}): HarnessRow => ({
  slug, stage: 'implement', round: null, waiting: null, stalled: false, now: null, started_at: null, max_critique_rounds: 3,
  severity: { blocker: 0, major: 0, minor: 0, nit: 0 }, rounds: [], passed: 0, failed: 0, total: 0, ...over,
})
const nowOf = { stage: 'implement', doing: 'x', round: null, last_step: null, next: null, waiting: null, cost_usd: null, at: null, since: null }

test('the state glyphs are the nine of the design and no faces', () => {
  expect([...STATE_GLYPHS].sort()).toEqual(['✎', '⌕', '▸', '…', '⚖', '✔', '✘', '◌', '⚑'].sort())
  expect(Object.keys(GLYPH).sort()).toEqual(['done', 'edit', 'fail', 'idle', 'judge', 'read', 'run', 'think', 'you'])
  expect([...RAIL_GLYPHS]).toEqual(['━', '┄', '●', '○'])
  for (const g of ALLOWED) expect(/\p{Emoji_Presentation}|[☺☻☹]/u.test(g)).toBe(false)
})

test('spinnerFrame advances one frame per tick, wraps, and uses only state glyphs', () => {
  for (const stage of ['plan', 'setgoal', 'critique', 'implement', 'gate', 'report'] as const) {
    const frames = [0, 1, 2, 3, 4, 5].map(t => spinnerFrame(t, stage))
    for (const f of frames) expect(STATE_GLYPHS.includes(f)).toBe(true)
    expect(spinnerFrame(0, stage)).not.toBe(spinnerFrame(1, stage))
    expect(new Set(frames).size).toBeGreaterThan(1)
  }
  expect([0, 1, 2, 3].map(t => spinnerFrame(t, 'implement'))).toEqual(['✎', '⌕', '▸', '✎'])
  expect(spinnerFrame(-1, 'implement')).toBe('▸')
  expect(spinnerFrame(Number.NaN, 'implement')).toBe('✎')
  expect(spinnerFrame(1)).toBe('⌕')
})

test('stateGlyph: ⚑ waits on you, a spinner frame while acting, ◌ otherwise', () => {
  const acting = row('a', { now: nowOf })
  expect(STATE_GLYPHS.includes(stateGlyph(acting, 0))).toBe(true)
  expect(stateGlyph(acting, 0)).not.toBe('◌')
  expect(stateGlyph(acting, 1)).not.toBe(stateGlyph(acting, 0))
  expect(stateGlyph({ ...acting, waiting: { who: 'you', what: 'x' } }, 0)).toBe('⚑')
  expect(stateGlyph({ ...acting, waiting: { who: 'vendor', what: 'x' } }, 0)).toBe('◌')
  expect(stateGlyph({ ...acting, stalled: true }, 0)).toBe('◌')
  expect(stateGlyph(row('idle'), 0)).toBe('◌')
})

test('clip, clipLine, fit and leftRight never exceed the width and cut with …', () => {
  expect(clip('hello', 5)).toBe('hello')
  expect(clip('hello world', 6)).toBe('hello…')
  expect(clip('hi there ', 4)).toBe('hi…')
  expect(clip('x', 0)).toBe('')
  expect(plain(clipLine([{ t: 'ab' }, { t: 'cdef', bold: true }], 4))).toBe('abc…')
  // low priority leaves first; a segment with min is cut before it leaves; never-drop segments only truncate
  const segs = [fs('NAME', { fixed: true }), fs('doing a long sentence', { sep: ' · ', drop: 1, min: 6 }), fs('round 2', { sep: ' · ', drop: 3 }), fs('6m', { sep: ' · ', drop: 4 })]
  expect(plain(fit(segs, 100))).toBe('NAME · doing a long sentence · round 2 · 6m')
  expect(plain(fit(segs, 40))).toBe('NAME · doing a long sentence · round 2')
  expect(plain(fit(segs, 28))).toBe('NAME · doing a long sentence')
  expect(plain(fit(segs, 25))).toBe('NAME · doing a long sent…')
  expect(plain(fit(segs, 13))).toBe('NAME · doing…')
  expect(plain(fit(segs, 6))).toBe('NAME')
  const long = [fs('RUN-NAME-IS-LONG', { sep: ' ' }), fs('⚑ asks you: a very long question', { sep: ' · ' })]
  const cut = plain(fit(long, 30))
  expect(lineWidth(fit(long, 30)) <= 30).toBe(true)
  expect(cut).toContain('…')
  // the right side sheds pieces before the left truncates
  const lr = leftRight([{ t: 'a long left side of a line' }], [fs('keep', { fixed: true }), fs(' · '.padEnd(40, 'x'), { drop: 1 })], 40)
  expect(plain(lr)).toHaveLength(40)
  expect(plain(lr).startsWith('a long left side of a line')).toBe(true)
  expect(plain(lr).endsWith('keep')).toBe(true)
  expect(plain(leftRight([{ t: 'x'.repeat(50) }], [fs('right', { fixed: true })], 20))).toHaveLength(20)
  expect(frame('T', [[{ t: 'abc' }], []], 12)).toEqual(['╭─ T ──────╮', '│ abc      │', '│          │', '╰──────────╯'])
})

test('band at 110: low-priority segments drop first; the run name and ⚑ only truncate with …', () => {
  const lead = row('csv-export', {
    stage: 'setgoal', round: 2, total: 3, started_at: new Date(DEMO_NOW - 72 * 60_000).toISOString(),
    rounds: [{ round: 1, sound: false, problems: [{ severity: 'major', text: 'no download check' }] }],
    now: { ...nowOf, stage: 'setgoal', doing: 'SetGoal is rewriting the spec after critique rejected it', round: 2, cost_usd: 3.4, since: new Date(DEMO_NOW - 6 * 60_000).toISOString() },
  })
  const wide = bandLines([lead, row('o')], { width: 190, nowMs: DEMO_NOW, tick: 0 }).map(plain)
  expect(wide[0]).toContain('harness csv-export · SetGoal is rewriting the spec after critique rejected it · round 2 of 3 · 6m')
  expect(wide[0]!.trimEnd().endsWith('+1 run')).toBe(true)
  expect(wide[1]).toContain('subgoals 0/3')
  // 110 with a long name: the doing sentence is cut or dropped, the round and time go, the run name is whole until nothing else is left
  const tight = bandLines([lead, row('o')], { width: 60, nowMs: DEMO_NOW, tick: 0 }).map(plain)
  expect(tight).toHaveLength(3)
  for (const l of tight) expect(lineWidth([{ t: l }]) <= 60).toBe(true)
  expect(tight[0]).not.toContain('round')
  expect(tight[0]).toContain('csv-export')
  expect(tight[0]).toContain('+1')
  expect(tight[2]).toContain('$3.40')
  // the name and ⚑ truncate when they alone do not fit
  const waits = row('a-very-long-run-name-that-does-not-fit-on-one-row', { waiting: { who: 'you', what: 'approve the spec before critique starts' }, now: { ...nowOf, waiting: { who: 'you', what: 'approve the spec before critique starts' } } })
  const row1 = plain(bandLines([waits], { width: 50, nowMs: DEMO_NOW, tick: 0 })[0]!)
  expect(lineWidth([{ t: row1 }]) <= 50).toBe(true)
  expect(row1.startsWith('⚑ ')).toBe(true)
  expect(row1).toContain('…')
  expect(row1).toContain('a-very-')
  expect(row1).not.toContain('harness')
})

test('the band draws harness runs only: three rows, never a graph row', () => {
  for (const s of DEMO_SCENARIOS) {
    for (const w of WIDTHS) {
      const rows = bandLines(openingOrder(demoRows(s), {}), { width: w, nowMs: DEMO_NOW, tick: 0 }).map(plain)
      expect(rows).toHaveLength(3)
      expect(rows.some(l => /graph/i.test(l))).toBe(false)
    }
  }
})

const FNV = (s: string) => {
  let h = 0x811c9dc5
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}
const demos = DEMO_SCENARIOS.flatMap(s => WIDTHS.map(w => ({ s, w, text: renderDemo(s, w) })))

test('demo: every line fits the width, the tab row is one line, nothing but the allowed glyphs', () => {
  expect(demos).toHaveLength(8)
  for (const { s, w, text } of demos) {
    const lines = text.split('\n')
    for (const l of lines) expect([s, w, l, lineWidth([{ t: l }]) <= w]).toEqual([s, w, l, true])
    // framed lines are exactly the width, so no label is pushed under another
    for (const l of lines.filter(x => /^[│╭╰]/.test(x))) expect([s, w, lineWidth([{ t: l }])]).toEqual([s, w, w])
    // one tab row per pane; the band is three plain rows
    const panes = lines.filter(l => l.startsWith('# ') && l.includes('pane') || l.includes('after next') || l.includes('findings tab'))
    expect(lines.filter(l => /● (Now|Flow|Findings|Gate rules)|(Now|Flow) .*● Findings/.test(l))).toHaveLength(panes.length)
    expect(lines.filter(l => l.startsWith('# ') && l.includes('band'))).toHaveLength(1)
    const bandAt = lines.findIndex(l => l.includes('band'))
    expect(lines.slice(bandAt + 1).filter(l => l.trim() !== '')).toHaveLength(3)
    // glyphs: anything past ASCII is one of the nine, a rail glyph, or plain typography (including the › of the Korean-free text)
    for (const ch of text) if (ch.charCodeAt(0) > 127) expect([ch, ALLOWED.includes(ch)]).toEqual([ch, true])
    // state glyphs sit where state is shown: a pane's Now line and the band's first row
    lines.forEach((l, i) => {
      if (l.startsWith('╭')) expect([s, w, STATE_GLYPHS.includes(Array.from(lines[i + 3]!)[2]!)]).toEqual([s, w, true]) // header, blank, then Now
    })
    const band = lines.slice(bandAt + 1).filter(l => l.trim() !== '')
    expect(STATE_GLYPHS.includes(Array.from(band[0]!)[0]!)).toBe(true)
  }
})

test('demo: long text ends in … and no glyph is cut', () => {
  const narrow110 = renderDemo('narrow', 110).split('\n')
  expect(narrow110.some(l => /…\s*│$/.test(l))).toBe(true) // framed pane: the cut ends at the border
  expect(narrow110.some(l => l.endsWith('…'))).toBe(true) // the band
  expect(renderDemo('narrow', 190).split('\n').some(l => l.includes('…'))).toBe(true)
  // every glyph is one code point, so a cut never splits one
  for (const { text } of demos) for (const l of text.split('\n')) expect(/[\ud800-\udfff]/.test(l)).toBe(false)
})

test('demo: the opening order, the switch and the other-run label show in the parallel fixture', () => {
  const ordered = openingOrder(demoRows('parallel'), {})
  expect(ordered[0]!.slug).toBe('fix-date-filter') // waits on you
  expect(pickRun(ordered, null)!.slug).toBe('fix-date-filter')
  expect(runPosition(ordered, null)).toEqual({ k: 1, n: 3 })
  expect(otherRunLabel(ordered, null)).toBe('other run: csv-export · Implement 1/3 (+1)')
  const text = renderDemo('parallel', 190)
  // the keys named are the keys bound: the pane's key catcher takes [ and ] as key presses
  expect(text).toContain('run 1 of 3 ◀ [ ] ▶')
  expect(text).toContain('run 2 of 3 ◀ [ ] ▶')
  expect(text).toContain('other run: csv-export · Implement 1/3 (+1)')
  expect(text).toContain('+2 runs')
  expect(renderDemo('parallel', 110)).toContain('1/3 ◀▶')
  // the full fixture is the §3 mockup's rail and findings
  const full = renderDemo('full', 190)
  expect(full).toContain('✔ Plan ━━ ✔ SetGoal ━━ ✘ Critique ━━ ● SetGoal again ┄┄ ○ Critique ┄┄ ○ Subgoals 0/3 ┄┄ ○ Goal gate ┄┄ ○ Report')
  expect(full).toContain('Critique round 1 · rejected · 4 major, 1 nit')
  expect(full).toContain('round 2 of 3 · 6m in this stage')
  expect(full).toContain('last step: edited the goal spec')
  expect(full).toContain('12s ago')
  expect(plain(railLine(railItems(demoRows('minimal')[0]!), false))).toBe('● Plan ┄┄ ○ SetGoal ┄┄ ○ Critique ┄┄ ○ Subgoals ┄┄ ○ Goal gate ┄┄ ○ Report')
})

test('paneHead and paneContent make up paneLines, and the tab row is the one line below them', () => {
  const rows = demoRows('parallel')
  const ordered = openingOrder(rows, {})
  for (const w of [186, 106]) {
    for (const tab of ['now', 'findings'] as const) {
      const r = pickRun(ordered, null)!
      const c = { width: w, nowMs: DEMO_NOW, tick: 0, pos: runPosition(ordered, null), other: otherRunLabel(ordered, null), tab }
      const whole = paneLines(r, c).map(plain)
      const parts = [...paneHead(r, c), ...paneContent(r, c)].map(plain)
      expect(whole.slice(0, parts.length)).toEqual(parts)
      expect(whole).toHaveLength(parts.length + 2)
      expect(whole[whole.length - 2]).toBe('')
    }
  }
})

test('tabRowPlan: four tabs on one row; short labels when the full ones do not fit; the other run only when it fits', () => {
  const ctx = (width: number, over: object = {}) => ({ width, nowMs: DEMO_NOW, tick: 0, pos: { k: 1, n: 3 }, other: 'other run: csv-export · Implement 1/3 (+1)', tab: 'now' as const, ...over })
  const wide = tabRowPlan(ctx(186))
  expect(wide.items.map(i => i.label)).toEqual(['Now', 'Flow', 'Findings', 'Gate rules'])
  expect(wide.items.map(i => i.key)).toEqual(['now', 'flow', 'findings', 'rules'])
  expect(wide.right).toBe('other run: csv-export · Implement 1/3 (+1)')
  const mid = tabRowPlan(ctx(76))
  expect(mid.items[3]!.label).toBe('Gate rules')
  expect(mid.right).toBe('+2 runs')
  const narrow = tabRowPlan(ctx(36))
  expect(narrow.items.map(i => i.label)).toEqual(['Now', 'Flow', 'Findings', 'Rules'])
  expect(narrow.right).toBe('')
  // one run: nothing on the right
  expect(tabRowPlan(ctx(186, { pos: { k: 1, n: 1 }, other: null })).right).toBe('')
  // the left side of the row never wider than the width; the right fits what is left
  for (const w of [190, 110, 76, 44, 36]) {
    const p = tabRowPlan(ctx(w))
    const left = p.items.reduce((n, i, k) => n + 3 + Array.from(i.label).length + (i.key === 'now' ? 2 : 0) + (k > 0 ? 3 : 0), 0)
    expect(left + (p.right === '' ? 0 : 2 + Array.from(p.right).length) <= Math.max(w, left)).toBe(true)
  }
})

test('innerWidth: the columns inside the pane border and padding, never under 20', () => {
  expect(innerWidth(194)).toBe(190)
  expect(innerWidth(114)).toBe(110)
  expect(innerWidth(10)).toBe(20)
})

test('parseDemoArg: demo steps through the scenarios, a name picks one, off leaves; any other argument is the live run', () => {
  expect(parseDemoArg('', null)).toBeNull()
  expect(parseDemoArg('status', null)).toBeNull()
  expect(parseDemoArg('demo', null)).toBe('minimal')
  expect(parseDemoArg('demo', 'minimal')).toBe('full')
  expect(parseDemoArg(' DEMO  narrow ', 'full')).toBe('narrow')
  expect(parseDemoArg('demo', 'narrow')).toBe('minimal')
  expect(parseDemoArg('demo parallel', null)).toBe('parallel')
  expect(parseDemoArg('demo off', 'full')).toBe('off')
  expect(parseDemoArg('demo nonsense', 'full')).toBe('parallel')
})

test('demo text is pinned: any change to a fixture or its layout changes a hash (the report quotes this text)', () => {
  expect(Object.fromEntries(demos.map(d => [`${d.s}@${d.w}`, `${FNV(d.text)}:${d.text.split('\n').length}`]))).toEqual({
    'minimal@190': '9a3ab233:18', 'minimal@110': 'c076c198:18',
    'full@190': 'a7057b17:42', 'full@110': '6c7e1d8a:42',
    'parallel@190': 'e04fabfe:32', 'parallel@110': '403fbb18:32',
    'narrow@190': '2564e6f6:21', 'narrow@110': 'd6d469a7:21',
  })
})
