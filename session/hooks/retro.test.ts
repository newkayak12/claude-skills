import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { clockAt, memoryState, memoryStore, texts } from './testkit.ts'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 80 } as any
const PANE = {
  title: 'Session', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20 }, view: {},
} as any

const LAST = { day: '2026-10-07', files: 4, commits: 2, denied: 1, longestMs: 372000, fileList: ['/w/a.ts', '/w/b.ts'] }
const LEDGER = {
  files: ['/w/a.ts'], commits: [{ hash: 'abc1234', subject: 's' }], denied: [], steps: [1000, 373000],
}
const END = { reason: 'other', sessionId: 's1' } as never

const world = (on: On, seed: { store?: Record<string, unknown>; state?: Record<string, unknown> } = {}) => {
  const store = memoryStore(on, seed.store)
  const cells = memoryState(on)
  for (const [k, v] of Object.entries(seed.state ?? {})) cells.set(k, v)
  clockAt(on)
  const ui: string[] = []
  for (const name of ['ui.toast', 'ui.status', 'ui.open'] as const) {
    on(name, () => {
      ui.push(name)
      return { value: undefined } as never
    })
  }
  const registered: string[] = []
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return Box({}) as never
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  return { store, cells, ui, registered }
}

const start = ($: any, interactive = true) =>
  $.session.start({ cwd: '/w', surface: interactive ? 'terminal' : null, isInteractive: interactive })
const band = ($: any) => $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'AbovePrompt', props: BAND })

test('headless: no ui call at all, and session.end still stores the summary', async ($, on) => {
  const { store, ui } = world(on, { state: { 'session.ledger': LEDGER } })
  on('session.surfaces', () => ({ value: [] }))

  await start($, false)
  await $.session.end(END)

  expect(ui).toEqual([])
  expect(store.get('session.last')).toMatchObject({ files: 1, commits: 1, denied: 0, longestMs: 372000 })
})

test('an empty ledger stores nothing', async ($, on) => {
  const { store } = world(on)

  await $.session.end(END)

  expect(store.has('session.last')).toBe(false)
})

test('a steps-only ledger stores nothing and keeps the previous summary', async ($, on) => {
  const { store } = world(on, { store: { 'session.last': LAST }, state: { 'session.ledger': { files: [], commits: [], denied: [], steps: [1000, 5000] } } })

  await $.session.end(END)

  expect(store.get('session.last')).toEqual(LAST)
})

test('a broken store does not throw', async ($, on) => {
  const { store } = world(on, { state: { 'session.ledger': LEDGER } })
  store.broken = true

  await $.session.end(END)
})

test('session.end resets the ledger in place', async ($, on) => {
  const { cells } = world(on, { state: { 'session.ledger': LEDGER } })

  await $.session.end(END)

  expect(cells.get('session.ledger')).toEqual({ files: [], commits: [], denied: [], steps: [] })
})

test('a stored summary and an interactive start show the band with the numbers', async ($, on) => {
  world(on, { store: { 'session.last': LAST } })
  await start($)

  const lines = texts(await (await band($)).drawn())

  expect(lines.some(l => l.includes('last session: 4 files, 2 commits, 1 denied, longest gap 6m12s'))).toBe(true)
})

test('no stored summary and no band', async ($, on) => {
  world(on)
  await start($)

  expect(texts(await (await band($)).drawn())).toEqual([])
})

test('dismiss removes the band and the key; a second start shows none', async ($, on) => {
  const { store } = world(on, { store: { 'session.last': LAST } })
  await start($)
  const ui = await band($)
  await ui.drawn()

  await ui.press({ key: 'dismiss' })
  await ui.unmount()

  expect(store.has('session.last')).toBe(false)
  expect(texts(await (await band($)).drawn())).toEqual([])
  await start($)
  expect(texts(await (await band($)).drawn())).toEqual([])
})

test('the band shows once: a second start without dismiss shows none, retro still works', async ($, on) => {
  const { store } = world(on, { store: { 'session.last': LAST } })
  await start($)
  const first = await band($)
  expect(texts(await first.drawn()).length).toBeGreaterThan(0)
  await first.unmount()

  expect(store.has('session.last')).toBe(false)
  await start($)

  expect(texts(await (await band($)).drawn())).toEqual([])
  await $.command.run({ command: 'session', args: 'retro' } as any)
  const lines = texts(await (await $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'session', props: PANE })).drawn())
  expect(lines.some(l => l.includes('last session'))).toBe(true)
})

test('the Retro button opens the pane on the Retro tab', async ($, on) => {
  const { ui, cells } = world(on, { store: { 'session.last': LAST }, state: { 'session.tab': 'orphans' } })
  await start($)
  const b = await band($)
  await b.drawn()

  await b.press({ key: 'retro' })

  expect(ui).toContain('ui.open')
  expect(cells.get('session.tab')).toBe('retro')
})

test('/session retro shows the stored summary when the live ledger is empty', async ($, on) => {
  const { ui } = world(on, { store: { 'session.last': LAST } })
  await start($)

  const out = await $.command.run({ command: 'session', args: 'retro' } as any)
  const lines = texts(await (await $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'session', props: PANE })).drawn())

  expect(out.text).toMatch(/pane/i)
  expect(ui).toContain('ui.open')
  expect(lines.some(l => l.includes('last session') && l.includes('2026-10-07'))).toBe(true)
  expect(lines).toContain('files (4)')
  expect(lines.some(l => l.includes('/w/a.ts'))).toBe(true)
})

test('a broken store at start leaves no band and no throw', async ($, on) => {
  const { store } = world(on, { store: { 'session.last': LAST } })
  store.getBroken = true

  await start($)

  expect(texts(await (await band($)).drawn())).toEqual([])
})
