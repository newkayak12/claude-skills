import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { memoryStore, sessionAt } from './testkit.ts'
import { batchBody, buildBatch } from './logic.ts'

const NOW = Date.parse('2026-10-07T09:00:00Z')
const PANE = {
  title: 'Diag', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20 }, view: {},
} as any

const texts = (node: any): string[] =>
  Array.isArray(node)
    ? node.flatMap(texts)
    : node?.type === 'Text'
      ? [(node.children ?? []).join('')]
      : node?.children
        ? texts(node.children)
        : []

const entry = (i: number, o: object = {}) => ({
  ts: NOW - (100 - i) * 1000, day: '2026-10-06', kind: 'bug', reason: 'is_error', plugin: 'develop',
  skill: 'clean-code', session: `s${i}`, local: { text: `boom ${i}` }, ...o,
})

const bottom = (on: On) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
}

const mount = async ($: any, on: On, surface: 'terminal' | 'desktop', store: Record<string, unknown>) => {
  memoryStore(on, store)
  sessionAt(on, NOW)
  bottom(on)
  await $.session.start({ cwd: '/w', surface, isInteractive: true })
  return $.ui.mount({ plugin: 'diag', surface, component: 'Pane', requestId: 'diag', props: PANE })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(surface === 'terminal' ? 'pane lists newest first and at most 30 rows' : 'desktop: pane lists newest first and at most 30 rows', async ($, on) => {
    const log = Array.from({ length: 40 }, (_, i) => entry(i, { skill: `s${i}` }))
    const ui = await mount($, on, surface, { 'diag.log': log })

    const titles = texts(await ui.drawn()).filter(l => l.includes('2026-10-06 · bug · is_error'))

    expect(titles).toHaveLength(30)
    expect(titles[0]).toContain('develop:s39')
    expect(titles[29]).toContain('develop:s10')
  })

  test(surface === 'terminal' ? 'pane shows reason and raw local text, first 5 lines' : 'desktop: pane shows reason and raw local text, first 5 lines', async ($, on) => {
    const text = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'].join('\n')
    const ui = await mount($, on, surface, { 'diag.log': [entry(1, { local: { text } })] })

    const lines = texts(await ui.drawn())

    expect(lines.some(l => l.includes('is_error') && l.includes('develop:clean-code'))).toBe(true)
    expect(lines).toContain('l5')
    expect(lines).not.toContain('l6')
  })

  test(surface === 'terminal' ? 'send-state line follows trophy consent and version' : 'desktop: send-state line follows trophy consent and version', async ($, on) => {
    // trophy owns these values; the test plays trophy.
    const trophy: Record<string, unknown> = {}
    const mine = new Map<string, unknown>()
    on('state.get', (_$, e) => ({
      value: { value: e.plugin === 'trophy' ? trophy[e.key] : mine.get(e.key), version: 1 },
    }) as never)
    on('state.set', (_$, e) => {
      mine.set(e.key, e.value)
      return { value: { isSet: true, version: 1 } } as never
    })
    const first = await mount($, on, surface, {})
    await first.unmount()
    const drawn = async () => {
      const ui = await $.ui.mount({ plugin: 'diag', surface, component: 'Pane', requestId: 'diag', props: PANE })
      const lines = texts(await ui.drawn())
      await ui.unmount()
      return lines
    }
    expect(await drawn()).toContain('전송: 꺼짐 (로컬만)')

    trophy.consent = 'yes'
    expect(await drawn()).toContain('전송: 꺼짐 (로컬만)')

    trophy.consentVersion = 2
    expect(await drawn()).toContain('전송: trophy 동의 yes → 켜짐')
  })

  test(surface === 'terminal' ? 'copy body includes skill, reason, day and raw text' : 'desktop: copy body includes skill, reason, day and raw text', async ($, on) => {
    const copied: any[] = []
    on('ui.copy', (_$, e) => {
      copied.push(e)
      return { value: { isCopied: true } } as never
    })
    const ui = await mount($, on, surface, { 'diag.log': [entry(1, { local: { text: 'raw engine error' } })] })
    await ui.drawn()

    await ui.press({ key: 'copy-0' })

    expect(copied).toHaveLength(1)
    for (const part of ['develop:clean-code', 'is_error', '2026-10-06', 'raw engine error']) {
      expect(copied[0].text).toContain(part)
    }
  })

  test(surface === 'terminal' ? 'pane preview equals the sent body' : 'desktop: pane preview equals the sent body', async ($, on) => {
    const log = [
      entry(1),
      entry(2, { session: 'x', local: { text: 'SECRET-raw' } }),
      entry(3, { kind: 'outcome', reason: 'subgoal_failed', plugin: undefined, skill: undefined, local: { slug: 'SECRET-slug' } }),
      entry(4, { day: '2026-10-07' }),
    ]
    const ui = await mount($, on, surface, { 'diag.log': log, 'diag.installId': 'iid-1' })

    const shown = texts(await ui.drawn()).find(l => l.startsWith('{"api_key"'))
    const sent = batchBody(buildBatch(log as any, undefined, '2026-10-06'), 'iid-1')

    expect(shown).toBe(sent)
    expect(shown).not.toContain('SECRET')
    expect(shown).not.toContain('2026-10-07T')
  })
}

test('/diag opens the pane; /diag bug still records', async ($, on) => {
  const store = memoryStore(on)
  sessionAt(on, NOW)
  bottom(on)
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } as any }
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })

  const out = await $.command.run({ command: 'diag', args: '' } as any)
  const bug = await $.command.run({ command: 'diag', args: 'bug it broke' } as any)

  expect(opened).toEqual(['diag'])
  expect(out.text).toMatch(/pane/i)
  expect(bug.text).toBe('Recorded.')
  expect((store.get('diag.log') as any[])[0].kind).toBe('report')
})

test('/diag bug answers a line when the store throws', async ($, on) => {
  const store = memoryStore(on)
  sessionAt(on, NOW)
  bottom(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  store.broken = true

  const out = await $.command.run({ command: 'diag', args: 'bug note' } as any)

  expect(out.text).toBe('Could not record the report.')
})
