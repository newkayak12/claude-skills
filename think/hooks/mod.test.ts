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
type Surface = 'terminal' | 'desktop' | 'mobile' | 'vscode'
// Every surface a pane, band or toast draws on (mod.md rule 8).
const SURFACES = ['terminal', 'desktop', 'mobile', 'vscode'] as const satisfies readonly Surface[]

const SHARED = new Set(['Box', 'Text', 'Button', 'Link', 'Code', 'Markdown'])
// Fails if a drawn tree holds a node type the four surfaces do not all carry.
const onlyShared = (tree: any) => {
  const types = new Set<string>()
  const walk = (n: any): void => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (n === null || typeof n !== 'object') return
    if (typeof n.type === 'string') types.add(n.type)
    walk(n.children)
  }
  walk(tree)
  expect([...types].filter(t => !SHARED.has(t))).toEqual([])
}

function world(on: On, files: File[], opts: { surfaces?: readonly Surface[]; language?: string } = {}) {
  const store = new Map<string, unknown>()
  const seen = { opened: [] as any[], closed: [] as string[], commands: [] as string[], toasts: [] as string[], lists: 0, files, panes: new Set<string>() }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined } as never
  })
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

const start = ($: Engine, surface: Surface = 'terminal') => $.session.start({ cwd: '/proj', surface, isInteractive: true })
const run = ($: Engine) => $.command.run({ command: PANE, args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never)
const pane = ($: Engine, surface: Surface = 'terminal') =>
  $.ui.mount({ plugin: 'think', surface, component: 'Pane', requestId: PANE, props: { title: 'Brainstorming', isFocused: true, bodyColumns: 80, placement: 'dock' } } as never)
const band = ($: Engine, surface: Surface = 'terminal') =>
  $.ui.mount({ plugin: 'think', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10, contentRows: 0 }, view: {} } } as never)
const shown = async (ui: { drawn: () => Promise<unknown> }) => JSON.stringify(await ui.drawn())

async function seeded($: Engine, on: On, lines: string[], mtimeMs = NOW + 1000, opts: { language?: string; surface?: Surface } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const surface = opts.surface ?? 'terminal'
  const seen = world(on, [{ name: 'queue-design.jsonl', mtimeMs, body: lines.join('\n') }], { language: opts.language, surfaces: [surface] })
  await start($, surface)
  return { seen, clock }
}

test('headless (no surface): no command, no folder read, nothing opens, nothing toasts', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, [{ name: 'queue-design.jsonl', mtimeMs: NOW + 1000, body: ENDED.join('\n') }], { surfaces: [] })
  await start($)
  expect(seen.commands).toEqual([])
  expect(seen.lists).toBe(0)
  expect(seen.opened).toEqual([])
  expect(seen.toasts).toEqual([])
})

// mod.md rule 8: every pane and band draws on terminal, desktop, mobile and vscode, with only the shared elements.
for (const surface of SURFACES) {
  const at = { surface }

  test(`${surface}: the command opens the pane with focus and Esc-to-close`, async ($, on) => {
    const { seen } = await seeded($, on, LIVE, NOW + 1000, at)
    expect(seen.commands).toEqual([PANE])
    expect(JSON.stringify(await run($))).toContain('pane opened')
    expect(seen.opened[0]).toMatchObject({ id: PANE, focus: true, closeOnEscape: true })
  })

  test(`${surface}: the command again closes it`, async ($, on) => {
    const { seen } = await seeded($, on, LIVE, NOW + 1000, at)
    await run($)
    expect(JSON.stringify(await run($))).toContain('pane closed')
    expect(seen.closed).toEqual([PANE])
  })

  test(`${surface}: q closes it`, async ($, on) => {
    const { seen } = await seeded($, on, LIVE, NOW + 1000, at)
    await run($)
    const ui = await pane($, surface)
    expect((await ui.find({ key: 'close' }))?.props).toMatchObject({ hotkey: 'q' })
    await ui.press({ key: 'close' })
    expect(seen.closed).toEqual([PANE])
  })

  test(`${surface}: pane tabs draw only shared elements`, async ($, on) => {
    await seeded($, on, ENDED, NOW + 1000, at)
    const ui = await pane($, surface)
    onlyShared(await ui.drawn())
    for (const key of ['options', 'result']) {
      await ui.press({ key })
      await ui.redraw()
      onlyShared(await ui.drawn())
    }
  })

  test(`${surface}: Timeline shows lines and who is speaking; a persona chip filters`, async ($, on) => {
    await seeded($, on, LIVE, NOW + 1000, at)
    const ui = await pane($, surface)
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

  test(`${surface}: Tab onto a persona chip filters by it`, async ($, on) => {
    await seeded($, on, LIVE, NOW + 1000, at)
    const ui = await pane($, surface)
    await $.ui.focus({ component: 'Pane', requestId: PANE, plugin: 'think', element: 'who:PO', origin: { kind: 'person' } } as never)
    await ui.redraw()
    const text = await shown(ui)
    expect(text).toContain('shared runbook')
    expect(text).not.toContain('doubles on-call')
  })

  test(`${surface}: ↓ scrolls the timeline window`, async ($, on) => {
    const many = [...LIVE, ...Array.from({ length: 20 }, (_, i) => L('SRE', 'attack', 'O1', `point ${i}`, 2))]
    await seeded($, on, many, NOW + 1000, at)
    const ui = await pane($, surface)
    let text = await shown(ui)
    expect(text).toContain('Single queue')
    await $.ui.scroll({ component: 'Pane', requestId: PANE, offset: 5, by: 5 } as never)
    await ui.redraw()
    text = await shown(ui)
    expect(text).not.toContain('Single queue')
    expect(text).toContain('6-17/26')
  })

  test(`${surface}: Options shows for/against per option; Result shows the result`, async ($, on) => {
    await seeded($, on, ENDED, NOW + 1000, at)
    const ui = await pane($, surface)
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

  test(`${surface}: band while live, in Korean, draws only shared elements`, async ($, on) => {
    await seeded($, on, LIVE, NOW + 1000, { language: 'Korean', surface })
    const ui = await band($, surface)
    expect(await shown(ui)).toContain('브레인스토밍 · 2/3 · 발언 중: PO')
    onlyShared(await ui.drawn())
  })

  test(`${surface}: end card after a debate finishes; Dismiss hides it`, async ($, on) => {
    await seeded($, on, ENDED, NOW + 1000, at)
    const ui = await band($, surface)
    expect(await shown(ui)).toContain('Brainstorming · debate ended')
    onlyShared(await ui.drawn())
    await ui.press({ key: 'dismiss' })
    await ui.redraw()
    expect(await shown(ui)).not.toContain('debate ended')
  })

  test(`${surface}: no band for a debate that ended before this session`, async ($, on) => {
    await seeded($, on, ENDED, NOW - 1000, at)
    expect(await shown(await band($, surface))).not.toContain('Brainstorming')
  })
}
