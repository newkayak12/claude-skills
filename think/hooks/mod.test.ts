import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = 10 * 3_600_000
const PANE = 'brainstorming-status'

const L = (persona: string, kind: string, to = '', text = '', round = 1) => JSON.stringify({ ts: 't', round, persona, to, kind, text })
const LIVE = [
  L('SRE', 'persona', 'sonnet', 'on-call', 0),
  L('PO', 'persona', 'sonnet', 'ship', 0),
  L('Claude', 'merge', 'O1', 'Single queue'),
  L('Claude', 'merge', 'O2', 'Split queues'),
  L('SRE', 'attack', 'O2', 'doubles on-call', 2),
  L('PO', 'rebut', 'O2', 'shared runbook', 2),
]
const ENDED = [...LIVE, L('Claude', 'cut', 'O1', 'over budget', 4), L('Claude', 'result', '', 'O2 wins, SRE vs PO on on-call', 4)]

type File = { name: string; mtimeMs: number; body: string }

function world(on: On, files: File[], opts: { surfaces?: readonly ('terminal' | 'desktop')[]; language?: string } = {}) {
  const store = new Map<string, unknown>()
  const seen = { opened: [] as any[], closed: [] as string[], commands: [] as string[], lists: 0, files, panes: new Set<string>() }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: opts.surfaces ?? ['terminal'] }))
  on('command.register', (_$, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('settings.read', () => ({ value: opts.language === undefined ? {} : { language: opts.language } }) as never)
  on('fs.list', () => {
    seen.lists += 1
    return { value: seen.files.map(f => ({ name: f.name, kind: 'file', size: f.body.length, mtimeMs: f.mtimeMs, isLink: false })) } as never
  })
  on('fs.read', (_$, e) => {
    const f = seen.files.find(one => String(e.path).endsWith(`/${one.name}`))
    if (f === undefined) throw new Error('ENOENT')
    return { value: f.body } as never
  })
  on('state.get', (_$, e) => ({ value: { value: store.get(e.key), version: 0 } }) as never)
  on('state.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: { isSet: true, version: 1 } } as never
  })
  on('ui.open', (_$, e) => {
    seen.opened.push(e)
    seen.panes.add(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', (_$, e) => {
    seen.closed.push(e.id)
    seen.panes.delete(e.id)
    return { value: undefined } as never
  })
  on('ui.focus', () => ({ value: {} }) as never)
  on('ui.render', (_$, e) => (e.component === 'AbovePrompt' ? { type: 'Text', children: ['engine band'] } : undefined) as never)
  on('ui.panes', () =>({ value: [...seen.panes].map(id => ({ id, title: 'Brainstorming', isPlaced: true })) }) as never)
  return seen
}

const start = ($: Engine) => $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
const run = ($: Engine) => $.command.run({ command: PANE, args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never)
const pane = ($: Engine) =>
  $.ui.mount({ plugin: 'think', surface: 'terminal', component: 'Pane', requestId: PANE, props: { title: 'Brainstorming', isFocused: true, bodyColumns: 80, placement: 'dock' } } as never)
const band = ($: Engine) =>
  $.ui.mount({ plugin: 'think', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10, contentRows: 0 }, view: {} } } as never)
const shown = async (ui: { drawn: () => Promise<unknown> }) => JSON.stringify(await ui.drawn())

async function seeded($: Engine, on: On, lines: string[], mtimeMs = NOW + 1000, opts: { language?: string } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const seen = world(on, [{ name: 'queue-design.jsonl', mtimeMs, body: lines.join('\n') }], opts)
  await start($)
  return { seen, clock }
}

test('no surface: no command and no folder read', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, [], { surfaces: [] })
  await start($)
  expect(seen.commands).toEqual([])
  expect(seen.lists).toBe(0)
})

test('the command opens the pane with focus and Esc-to-close', async ($, on) => {
  const { seen } = await seeded($, on, LIVE)
  expect(seen.commands).toEqual([PANE])
  expect(JSON.stringify(await run($))).toContain('pane opened')
  expect(seen.opened[0]).toMatchObject({ id: PANE, focus: true, closeOnEscape: true })
})

test('the command again closes it', async ($, on) => {
  const { seen } = await seeded($, on, LIVE)
  await run($)
  expect(JSON.stringify(await run($))).toContain('pane closed')
  expect(seen.closed).toEqual([PANE])
})

test('q closes it', async ($, on) => {
  const { seen } = await seeded($, on, LIVE)
  await run($)
  const ui = await pane($)
  expect((await ui.find({ key: 'close' }))?.props).toMatchObject({ hotkey: 'q' })
  await ui.press({ key: 'close' })
  expect(seen.closed).toEqual([PANE])
})

test('Timeline shows lines and who is speaking; a persona chip filters', async ($, on) => {
  await seeded($, on, LIVE)
  const ui = await pane($)
  let text = await shown(ui)
  expect(text).toContain('Speaking now: PO')
  expect(text).toContain('doubles on-call')
  expect(text).toContain('shared runbook')
  await ui.press({ key: 'who:SRE' })
  await ui.redraw()
  text = await shown(ui)
  expect(text).toContain('doubles on-call')
  expect(text).not.toContain('shared runbook')
})

test('Tab onto a persona chip filters by it', async ($, on) => {
  await seeded($, on, LIVE)
  const ui = await pane($)
  await $.ui.focus({ component: 'Pane', requestId: PANE, plugin: 'think', element: 'who:PO', origin: { kind: 'person' } } as never)
  await ui.redraw()
  const text = await shown(ui)
  expect(text).toContain('shared runbook')
  expect(text).not.toContain('doubles on-call')
})

test('↓ scrolls the timeline window', async ($, on) => {
  const many = [...LIVE, ...Array.from({ length: 20 }, (_, i) => L('SRE', 'attack', 'O1', `point ${i}`, 2))]
  await seeded($, on, many)
  const ui = await pane($)
  let text = await shown(ui)
  expect(text).toContain('Single queue')
  await $.ui.scroll({ component: 'Pane', requestId: PANE, offset: 5, by: 5 } as never)
  await ui.redraw()
  text = await shown(ui)
  expect(text).not.toContain('Single queue')
  expect(text).toContain('6-17/26')
})

test('Options shows for/against per option; Result shows the result', async ($, on) => {
  await seeded($, on, ENDED)
  const ui = await pane($)
  await ui.press({ key: 'options' })
  await ui.redraw()
  let text = await shown(ui)
  expect(text).toContain('O2 Split queues')
  expect(text).toContain('+1 / −1')
  expect(text).toContain('cut: over budget')
  await ui.press({ key: 'result' })
  await ui.redraw()
  text = await shown(ui)
  expect(text).toContain('O2 wins, SRE vs PO on on-call')
})

test('band while live, in Korean', async ($, on) => {
  await seeded($, on, LIVE, NOW + 1000, { language: 'Korean' })
  expect(await shown(await band($))).toContain('브레인스토밍 · 2/3 · 발언 중: PO')
})

test('end card after a debate finishes; Dismiss hides it', async ($, on) => {
  await seeded($, on, ENDED)
  const ui = await band($)
  expect(await shown(ui)).toContain('Brainstorming · debate ended')
  await ui.press({ key: 'dismiss' })
  await ui.redraw()
  expect(await shown(ui)).not.toContain('debate ended')
})

test('no band for a debate that ended before this session', async ($, on) => {
  await seeded($, on, ENDED, NOW - 1000)
  expect(await shown(await band($))).not.toContain('Brainstorming')
})
