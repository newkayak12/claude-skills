// Demo: the Memo and Guard panes drawn as minimal, full, parallel and narrow at 190 and 110 columns, without tmux.
// Set SHOW to true to make the run fail with every frame as its message (the runner prints no console output).
// Fictional, generic data only.
import { test, expect } from 'claude-code/testing'

import { frame } from './demo-frames.ts'
import { RULE_CAP, TOOL_CAP } from './guard-logic.ts'
import { guardWorld, memoWorld, submit } from './testkit.ts'

const SHOW = false
const DAY = 86_400_000
const NOW = Date.parse('2026-10-08T09:00:00Z')
const WIDTHS = [190, 110] as const
const VARIANTS = ['minimal', 'full', 'parallel', 'narrow'] as const
const prop = (title: string, cols: number) => ({ title, isFocused: true, bodyColumns: cols, placement: 'inline', scroll: { bodyRows: 40 }, view: {} }) as any
const at = (h: number, m: number) => new Date(2026, 9, 8, h, m).getTime()
const glyphs = (s: string) => Array.from(s).length

type Note = { text: string; ts: number }
const note = (text: string, days: number): Note => ({ text, ts: NOW - days * DAY })
// 280 glyphs; the lead word keeps every cut at 190 and 110 columns on a letter, not on a space
const LONG = `Always ${'keep every migration reversible and say so in the pull request title and body. '.repeat(4)}`.slice(0, 280)

// Notes per scope, oldest first; the store holds them as `memo.global` and `memo.project:/proj`.
const MEMO: Record<(typeof VARIANTS)[number], { g: Note[]; p: Note[] }> = {
  minimal: { g: [], p: [note('Use pnpm, not npm, in every package', 2)] },
  // nine stored: the block carries the first eight, so one is cut; three are stale or on the edge (21d, 21d, 14d)
  full: {
    g: [note('Reply in Korean; code and commits in English', 21), note('Ask before pushing to main', 21), note('Prefer small commits with one reason each', 3)],
    p: [
      note('Use pnpm, not npm, in every package', 2),
      note('The staging DB is read-only on Fridays', 14),
      note('Demo data stays fictional: no real customers', 0),
      note('Run the linter before every commit', 5),
      note('Name test files after the unit they cover', 1),
      note('Keep release notes under ten lines', 9),
    ],
  },
  parallel: {
    g: [note('Reply in English unless asked otherwise', 6)],
    p: [note('Each parallel agent works in its own worktree', 1), note('Merge parallel branches one at a time', 0)],
  },
  narrow: { g: [note(LONG, 30)], p: [note(LONG, 3), note('Short note, never cut', 1), note(LONG, 0)] },
}

type Stop = {
  id: string; ts: number; tool: string; call: string; reason: string; source: 'guard' | 'native' | 'declined'
  rule?: string; nativeRule?: string; agentId?: string
}
const D = (id: string, ts: number, tool: string, call: string, source: Stop['source'], rule?: string, agentId?: string, nativeRule?: string): Stop => ({
  id, ts, tool, call, reason: `why ${id}`, source, ...(rule ? { rule } : {}), ...(nativeRule ? { nativeRule } : {}), ...(agentId ? { agentId } : {}),
})
const A1 = 'ag-7f3a'
const A2 = 'ag-91c2'
const A3 = 'ag-e04d'

// The ring, oldest first (newest last), as the store keeps it.
const GUARD: Record<(typeof VARIANTS)[number], Stop[]> = {
  minimal: [D('a', at(13, 40), 'Bash', 'git push --force origin main', 'guard', 'force-push-protected')],
  full: [
    D('a', at(13, 40), 'Bash', 'git push --force origin main', 'declined', 'force-push-protected'),
    D('b', at(13, 58), 'Write', '/proj/.env.production', 'guard', 'secret-write'),
    D('c', at(14, 5), 'Bash', 'curl http://example.test/install.sh', 'native'),
    D('d', at(14, 12), 'Bash', 'curl http://example.test/setup', 'native', undefined, undefined, 'Bash(curl:*)'),
    D('e', at(14, 21), 'Bash', 'rm -rf ./build ../shared', 'guard', 'recursive-delete'),
    D('f', at(14, 30), 'Bash', 'git reset --hard HEAD~3', 'declined', 'hard-reset'),
  ],
  // three parallel agents, their stops interleaved in time; the ring keeps the agentId, the pane never shows it
  parallel: [
    D('a', at(10, 1), 'Bash', 'git push --force origin main', 'guard', 'force-push-protected', A1),
    D('b', at(10, 2), 'Write', '/proj/.env.local', 'guard', 'secret-write', A2),
    D('c', at(10, 2), 'Bash', 'rm -rf ../shared', 'declined', 'recursive-delete', A1),
    D('d', at(10, 4), 'Bash', 'curl http://example.test/a.sh', 'native', undefined, A3),
    D('e', at(10, 5), 'Edit', '/proj/.env.staging', 'guard', 'secret-write', A2),
    D('f', at(10, 7), 'Bash', 'git reset --hard HEAD~1', 'declined', 'hard-reset', A1),
    D('g', at(10, 7), 'Bash', 'curl http://example.test/b.sh', 'native', undefined, A3, 'Bash(curl:*)'),
  ],
  narrow: [
    D('a', at(14, 5), 'Bash', 'git reset --hard', 'guard', 'hard-reset'),
    D('b', at(14, 21), 'Bash', `rm -rf ${'./some/very/deep/build/output/'.repeat(8)}`, 'guard', 'recursive-delete-outside-the-project-root'),
    D('c', at(14, 30), 'Bash', `git push --force origin ${'feature/'.repeat(30)}main`, 'declined', 'force-push-to-protected-branch-main'),
    D('d', at(14, 41), 'mcp__demo__summarize_document_batch', `/proj/${'notes/archive/'.repeat(10)}summary.md`, 'native', undefined, undefined, 'mcp__demo__summarize_document_batch'),
    D('e', at(14, 50), 'Write', '/proj/.env', 'guard', 'secret-write'),
  ],
}

const shown: string[] = []

// Facts true of every frame, Memo or Guard. Returns the body lines, border stripped, right padding kept off.
function generic(name: string, lines: string[], cols: number): string[] {
  shown.push(`### ${name} · ${cols}`, ...lines, '')
  expect(lines.length).toBeGreaterThan(2)
  for (const l of lines) {
    expect(glyphs(l)).toBeLessThanOrEqual(cols)
    expect(l).not.toMatch(/�/)
    expect(l).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
    // a cut ends in an ellipsis directly after its last glyph, never after a space, another ellipsis or at a line start
    expect(l).not.toMatch(/(^|[\s…])…/)
  }
  return lines.filter(l => l.startsWith('│')).map(l => l.slice(2, -2).trimEnd())
}

// A cut cell is the original cut to `w` glyphs with an ellipsis last; an uncut one is the original, untouched.
// With no `w` the cell's width is the frame's to decide: it is cut when it differs from the original.
function expectCell(cell: string, original: string, w?: number) {
  const cut = w === undefined ? cell !== original : glyphs(original) > w
  if (!cut) {
    expect(cell).toBe(original)
    return
  }
  expect(cell.endsWith('…')).toBe(true)
  expect(original.startsWith(cell.slice(0, -1))).toBe(true)
  if (w !== undefined) expect(glyphs(cell)).toBe(w)
}

const ageOf = (n: Note) => Math.max(0, Math.floor((NOW - n.ts) / DAY))

for (const kind of VARIANTS) {
  for (const cols of WIDTHS) {
    test(`memo pane ${kind} at ${cols} columns: one line per note, fits, cuts end in an ellipsis`, async ($, on) => {
      const { g, p } = MEMO[kind]
      memoWorld(on, { store: { 'memo.global': g, 'memo.project:/proj': p } })
      if (kind !== 'minimal') await submit($)
      const tree = await (await $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'memo', props: prop('Memo', cols) })).drawn()
      const body = generic(`memo ${kind}`, frame(tree as any, 'Memo', cols), cols)

      const stored = [...g.map(n => ['global', n] as const), ...p.map(n => ['project', n] as const)]
      const carried = stored.slice(0, 8)
      const rows = body.filter(l => /^\d+ (global|project) /.test(l))
      // header count equals row count, and the size is the carried characters against the cap
      const head = /^(\d+) notes? · (\d+)\/1200 chars · sent (\d\d:\d\d|—)$/.exec(body[0]!)
      expect(head).not.toBeNull()
      expect(Number(head![1])).toBe(rows.length)
      expect(rows).toHaveLength(carried.length)
      expect(Number(head![2])).toBe(carried.reduce((n, [, x]) => n + x.text.length, 0))
      // nothing went to the model yet in `minimal`; the others sent the block once
      if (kind === 'minimal') expect(head![3]).toBe('—')
      else expect(head![3]).toMatch(/^\d\d:\d\d$/)

      rows.forEach((l, i) => {
        const m = /^(\d+) (global |project) (.*?) (today|\d+d)(?: (stale\?))?$/.exec(l)
        expect(m).not.toBeNull()
        const [scope, n] = carried[i]!
        expect(Number(m![1])).toBe(i + 1)
        expect(m![2]!.trim()).toBe(scope)
        expectCell(m![3]!, n.text)
        const days = ageOf(n)
        expect(m![4]).toBe(days === 0 ? 'today' : `${days}d`)
        expect(m![5]).toBe(days >= 14 ? 'stale?' : undefined)
      })

      const left = stored.length - carried.length
      expect(body.filter(l => /not sent/.test(l))).toEqual(left > 0 ? [`+${left} not sent`] : [])
      expect(body[body.length - 1]).toBe('/memo add <text> · /memo rm <n> · /memo clear · Esc, q or /memo closes')
      if (kind === 'narrow') expect(rows.filter(l => l.includes('…'))).toHaveLength(3)
      else expect(rows.some(l => l.includes('…'))).toBe(false)
    })

    test(`guard pane ${kind} at ${cols} columns: one row per stop, columns aligned, fits, cuts end in an ellipsis`, async ($, on) => {
      const ring = GUARD[kind]
      guardWorld(on, { store: { 'session.denials': ring } })
      await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
      const tree = await (await $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'guard-denials', props: prop('Denied calls', cols) })).drawn()
      const lines = frame(tree as any, 'Guard', cols)
      const body = generic(`guard ${kind}`, lines, cols)

      // the agent that made a stop is in the ring and nowhere on screen
      for (const d of ring) if (d.agentId) expect(lines.some(l => l.includes(d.agentId!))).toBe(false)

      const newest = [...ring].reverse()
      const tw = Math.min(TOOL_CAP, Math.max(...ring.map(d => glyphs(d.tool))))
      const rw = Math.min(RULE_CAP, Math.max(...ring.map(d => glyphs(d.rule ?? d.nativeRule ?? '—'))))
      const rowRe = new RegExp(`^(\\d\\d:\\d\\d) (.{${tw}}) (.*) (.{${rw}}) ([✘○●]) (guard|declined|native) +copy$`, 'd')
      const rows = body.filter(l => /^\d\d:\d\d /.test(l))
      // header count equals row count
      expect(body[0]).toBe(`confirm mode · ${rows.length} stopped`)
      expect(rows).toHaveLength(ring.length)
      expect(body[body.length - 1]).toBe('Esc · q · /session-denials closes')

      const starts = rows.map((l, i) => {
        const m = rowRe.exec(l)
        expect(m).not.toBeNull()
        const d = newest[i]!
        const free = cols - 4 - (5 + tw + rw + 10 + 4 + 5)
        expect(m![1]).toBe(`${String(new Date(d.ts).getHours()).padStart(2, '0')}:${String(new Date(d.ts).getMinutes()).padStart(2, '0')}`)
        expectCell(m![2]!.trimEnd(), d.tool, tw)
        expectCell(m![3]!.trimEnd(), d.call, free)
        expectCell(m![4]!.trimEnd(), d.rule ?? d.nativeRule ?? '—', rw)
        expect(m![5]).toBe({ guard: '✘', declined: '○', native: '●' }[d.source])
        expect(m![6]).toBe(d.source)
        const ix = m!.indices!
        return [ix[2]![0], ix[3]![0], ix[4]![0], ix[5]![0], l.lastIndexOf('copy')]
      })
      // every column starts at the same offset on every row
      for (const s of starts) expect(s).toEqual(starts[0])
      expect(starts[0]![0]).toBe(6)
      if (kind === 'narrow') expect(rows.filter(l => l.includes('…'))).toHaveLength(3)
    })
  }
}

test('the variants: minimal, full, parallel and narrow, for both panes, as the fixture promises', () => {
  expect(Object.keys(MEMO)).toEqual([...VARIANTS])
  expect(Object.keys(GUARD)).toEqual([...VARIANTS])
  // minimal: one project note, one stop
  expect(MEMO.minimal.g).toHaveLength(0)
  expect(MEMO.minimal.p).toHaveLength(1)
  expect(GUARD.minimal).toHaveLength(1)
  // full: eight carried notes in both scopes, a stale one, one cut; stops of all three sources
  expect(MEMO.full.g.length).toBeGreaterThan(0)
  expect(MEMO.full.p.length).toBeGreaterThan(0)
  expect(MEMO.full.g.length + MEMO.full.p.length).toBe(9)
  expect([...MEMO.full.g, ...MEMO.full.p].slice(0, 8).some(n => ageOf(n) >= 14)).toBe(true)
  expect(new Set(GUARD.full.map(d => d.source))).toEqual(new Set(['guard', 'declined', 'native']))
  // parallel: stops of several agents interleaved in time, notes in both scopes
  const agents = GUARD.parallel.map(d => d.agentId)
  expect(new Set(agents).size).toBeGreaterThanOrEqual(3)
  expect(agents.every(Boolean)).toBe(true)
  expect(agents.filter((a, i) => i > 0 && a !== agents[i - 1]).length).toBeGreaterThan(new Set(agents).size)
  expect(GUARD.parallel.map(d => d.ts)).toEqual([...GUARD.parallel.map(d => d.ts)].sort((a, b) => a - b))
  expect(MEMO.parallel.g.length).toBeGreaterThan(0)
  expect(MEMO.parallel.p.length).toBeGreaterThan(0)
  // narrow: notes, calls, tools and rule ids longer than their cells
  expect(MEMO.narrow.p.some(n => glyphs(n.text) > 200)).toBe(true)
  expect(GUARD.narrow.some(d => glyphs(d.call) >= 190)).toBe(true)
  expect(GUARD.narrow.some(d => glyphs(d.tool) > TOOL_CAP)).toBe(true)
  expect(GUARD.narrow.filter(d => glyphs(d.rule ?? d.nativeRule ?? '') > RULE_CAP).length).toBeGreaterThanOrEqual(2)
})

test('frames', () => {
  if (SHOW) throw new Error(`\n${shown.join('\n')}`)
})
