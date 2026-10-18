// Demo: the Memo and Guard panes drawn minimal, full and narrow at 190 and 110 columns, without tmux.
// Set SHOW to true to make the run fail with every frame as its message (the runner prints no console output).
import { test, expect } from 'claude-code/testing'

import { frame } from './demo-frames.ts'
import { guardWorld, memoWorld, submit, texts } from './testkit.ts'

const SHOW = false
const DAY = 86_400_000
const NOW = Date.parse('2026-10-08T09:00:00Z')
const WIDTHS = [190, 110] as const
const prop = (title: string, cols: number) => ({ title, isFocused: true, bodyColumns: cols, placement: 'inline', scroll: { bodyRows: 40 }, view: {} }) as any
const at = (h: number, m: number) => new Date(2026, 9, 8, h, m).getTime()
const note = (text: string, days: number) => ({ text, ts: NOW - days * DAY })
const LONG = `${'Keep every migration reversible and say so in the pull request title and body. '.repeat(3)}Done.`.slice(0, 280)

const MEMO = {
  minimal: { 'memo.project:/proj': [note('Use pnpm, not npm, in every package', 2)] },
  full: {
    'memo.global': [note('Reply in Korean; code and commits in English', 21), note('Ask before pushing to main', 21)],
    'memo.project:/proj': [
      note('Use pnpm, not npm, in every package', 2),
      note('The staging DB is read-only on Fridays', 14),
      note('Demo data stays fictional: no real customers', 0),
    ],
  },
  narrow: { 'memo.global': [note(LONG, 30)], 'memo.project:/proj': [note(LONG, 3), note(LONG, 0)] },
}

const D = (id: string, ts: number, tool: string, call: string, source: string, rule?: string, reason = `why ${id}`) => ({
  id, ts, tool, call, reason, source, ...(rule ? { rule } : {}),
})
const GUARD = {
  minimal: [] as ReturnType<typeof D>[],
  full: [
    D('a', at(13, 40), 'Bash', 'git push --force origin main', 'declined', 'force-push-protected', 'session: the person declined (force-push-protected).'),
    D('b', at(13, 58), 'Write', '/proj/.env.production', 'guard', 'secret-write', 'session: /proj/.env.production looks like a secret file.'),
    D('c', at(14, 5), 'Bash', 'curl http://example.test/install.sh', 'native', undefined, 'Permission denied by rule'),
    D('d', at(14, 21), 'Bash', 'rm -rf ./build ../shared', 'guard', 'recursive-delete', 'session: recursive force delete of ../shared can wipe the project or home.'),
  ],
  narrow: [
    D('e', at(14, 21), 'Bash', `rm -rf ${'./some/very/deep/build/output/'.repeat(8)}`, 'guard', 'recursive-delete', 'session: recursive force delete can wipe the project or home. '.repeat(4)),
    D('f', at(14, 30), 'Bash', `git push --force origin ${'feature/'.repeat(30)}main`, 'declined', 'force-push-protected'),
  ],
}

const shown: string[] = []
const check = (name: string, lines: string[], cols: number) => {
  shown.push(`### ${name} · ${cols}`, ...lines, '')
  for (const l of lines) {
    expect(Array.from(l).length).toBeLessThanOrEqual(cols)
    expect(l).not.toMatch(/�/)
    // a cut cell ends in an ellipsis right after its last glyph (a row's other cells may follow it)
    if (l.includes('…')) expect(l).toMatch(/\S…/)
  }
}

for (const kind of ['minimal', 'full', 'narrow'] as const) {
  for (const cols of WIDTHS) {
    test(`memo pane ${kind} at ${cols} columns fits and truncates with an ellipsis`, async ($, on) => {
      memoWorld(on, { store: MEMO[kind] })
      if (kind !== 'minimal') await submit($)
      const tree = await (await $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'memo', props: prop('Memo', cols) })).drawn()
      const lines = frame(tree as any, 'Memo', cols)
      check(`memo ${kind}`, lines, cols)
      expect(texts(tree).some(l => /\d+\/1200 chars$/.test(l))).toBe(true)
      if (kind === 'narrow') expect(lines.some(l => l.includes('…'))).toBe(true)
      if (kind === 'full') expect(lines.some(l => l.includes('14 days old'))).toBe(true)
    })

    test(`guard pane ${kind} at ${cols} columns fits and truncates with an ellipsis`, async ($, on) => {
      guardWorld(on, { store: { 'session.denials': GUARD[kind] } })
      await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
      const tree = await (await $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'guard-denials', props: prop('Denied calls', cols) })).drawn()
      const lines = frame(tree as any, 'Guard', cols)
      check(`guard ${kind}`, lines, cols)
      expect(lines.some(l => l.includes(`guard: confirm mode · ${GUARD[kind].length} stopped`))).toBe(true)
      if (kind === 'narrow') expect(lines.some(l => l.includes('…'))).toBe(true)
    })
  }
}

test('frames', () => {
  if (SHOW) throw new Error(`\n${shown.join('\n')}`)
})
