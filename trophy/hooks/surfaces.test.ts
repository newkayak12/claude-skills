// The consent card, fail band, last-send band and skill toast on terminal, desktop, mobile and vscode (mod.md rule 8):
// every drawn tree holds only Box, Text, Button, Link, Code, Markdown; headless opens and toasts nothing.
import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CONSENT_VERSION } from './logic.ts'
import { memoryStore, onlyShared, sessionAt, SURFACES } from './testkit.ts'
import type { Surface } from './testkit.ts'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 80 } as any
const MARKETPLACE = JSON.stringify({ plugins: [{ name: 'develop', source: './develop' }] })
const UNLOCKED = { 'trophy.installId': 'install-1', 'trophy.unlocked': { 'first-blood': '2026-10-06' } }
const FAIL = { tool_name: 'Skill', tool_input: { skill: 'develop:clean-code' }, tool_use_id: 't1', error: 'boom' } as never

const texts = (node: any): string[] =>
  Array.isArray(node)
    ? node.flatMap(texts)
    : node?.type === 'Text'
      ? [(node.children ?? []).join('')]
      : node?.children
        ? texts(node.children)
        : []

// The engine's answers beneath the plugin, with the surfaces the client reports; returns the toasts and opens seen.
const world = async ($: any, on: On, surface: Surface | null, seed: Record<string, unknown> = {}) => {
  memoryStore(on, seed)
  sessionAt(on).surfaces = surface ? [surface] : []
  const toasts: string[] = []
  const opened: string[] = []
  const fetches: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return Box({}) as never
  })
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } as any }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('http.fetch', (_$, e) => {
    fetches.push(String(e.init?.body))
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
  })
  on('fs.read', (_$, e) => {
    if (e.path.endsWith('/.claude-plugin/marketplace.json')) return { value: MARKETPLACE } as never
    throw new Error('ENOENT')
  })
  on('fs.list', () => ({ value: [{ name: 'clean-code', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }) as never)
  on('fs.write', () => ({ value: undefined }))
  on('session.usage', () => ({ deny: 'no usage' }))
  on('session.version', () => ({ value: { version: '2.1.293', base: '2.1.293' } }) as never)
  on('tool.call', { tool: 'Skill' }, () => ({ result: { success: true, commandName: 'x' } }) as never)
  on('classic.PostToolUseFailure', () => ({}))
  // The event claims an interactive session: only the surfaces the engine reports (rule 2) may decide.
  await $.session.start({ cwd: '/work', surface: surface ?? 'terminal', isInteractive: true })
  const mount = (s: Surface) => $.ui.mount({ plugin: 'trophy', surface: s, component: 'AbovePrompt', props: BAND })
  return { toasts, opened, fetches, mount }
}

for (const surface of SURFACES) {
  test(`${surface}: consent card draws three buttons from shared elements`, async ($, on) => {
    const w = await world($, on, surface, UNLOCKED)
    const ui = await w.mount(surface)

    onlyShared(await ui.drawn())
    for (const key of ['send', 'decline', 'show']) expect(await ui.find({ key })).toBeDefined()
  })

  test(`${surface}: fail band draws the count and the 보기 button from shared elements`, async ($, on) => {
    const w = await world($, on, surface, { 'trophy.consent': 'no', 'trophy.consentVersion': CONSENT_VERSION })
    await $.classic.PostToolUseFailure(FAIL)
    const ui = await w.mount(surface)
    const tree = await ui.drawn()

    onlyShared(tree)
    expect(texts(tree)).toContain('✘ 1')
    expect(await ui.find({ key: 'see' })).toBeDefined()
  })

  test(`${surface}: last-send band, Send sends once and toasts one line`, async ($, on) => {
    const w = await world($, on, surface, { ...UNLOCKED, 'trophy.consentVersion': CONSENT_VERSION })
    const ui = await w.mount(surface)
    onlyShared(await ui.drawn())

    await ui.press({ key: 'send' })

    expect(w.fetches).toHaveLength(1)
    expect(w.toasts.filter(t => t.includes('sent'))).toHaveLength(1)
    onlyShared(await (await w.mount(surface)).drawn())
  })

  test(`${surface}: skill toast, one ◆ line on a repeat call`, async ($, on) => {
    const w = await world($, on, surface, { 'trophy.consent': 'no', 'trophy.consentVersion': CONSENT_VERSION })
    await $.tool.call({ tool: 'Skill', skill: 'develop:clean-code' }) // first use unlocks: 🏆 only
    w.toasts.length = 0
    await $.tool.call({ tool: 'Skill', skill: 'develop:clean-code' })

    expect(w.toasts).toEqual(['◆ develop:clean-code'])
  })
}

test('no surface attached (event says interactive): no card, no band, no fetch, no toast, nothing opens', async ($, on) => {
  const w = await world($, on, null, UNLOCKED)
  await $.tool.call({ tool: 'Skill', skill: 'develop:clean-code' })
  await $.classic.PostToolUseFailure(FAIL)
  const ui = await w.mount('terminal')

  expect(await ui.find({ key: 'send' })).toBeUndefined()
  expect(await ui.find({ key: 'see' })).toBeUndefined()
  expect(w.toasts).toEqual([])
  expect(w.opened).toEqual([])
  expect(w.fetches).toEqual([])
})
