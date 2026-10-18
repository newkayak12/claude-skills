import { test, expect } from 'claude-code/testing'

import { bash, guardWorld, texts } from './testkit.ts'

const PANE = {
  title: 'Denied calls', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20 }, view: {},
} as any

const D = (id: string, ts: number, tool: string, call: string, source: string) => ({ id, ts, tool, call, reason: `why ${id}`, source })
const THREE = [
  D('a', 1000, 'Bash', 'git push -f origin main', 'guard'),
  D('b', 2000, 'Bash', 'curl http://x', 'native'),
  D('c', 3000, 'Bash', 'git reset --hard', 'declined'),
]

const mount = ($: any, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'session', surface, component: 'Pane', requestId: 'guard-denials', props: PANE })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: an empty log says no denials`, async ($, on) => {
    guardWorld(on)
    await $.session.start({ cwd: '/w', surface, isInteractive: true })
    expect(texts(await (await mount($, surface)).drawn())).toContain('no denials')
  })

  test(`${surface}: three entries draw newest first with their labels`, async ($, on) => {
    guardWorld(on, { store: { 'session.denials': THREE } })
    await $.session.start({ cwd: '/w', surface, isInteractive: true })
    const lines = texts(await (await mount($, surface)).drawn())
    const at = (s: string) => lines.findIndex(l => l.includes(s))
    expect(at('git reset --hard')).toBeGreaterThan(-1)
    expect(at('git reset --hard')).toBeLessThan(at('curl http://x'))
    expect(at('curl http://x')).toBeLessThan(at('git push -f origin main'))
    expect(lines).toContain('declined')
    expect(lines).toContain('native')
    expect(lines).toContain('guard')
  })

  test(`${surface}: [Copy rule] on a git reset --hard entry shows Bash(git reset:*)`, async ($, on) => {
    guardWorld(on, { store: { 'session.denials': THREE } })
    await $.session.start({ cwd: '/w', surface, isInteractive: true })
    const ui = await mount($, surface)
    await ui.drawn()
    await ui.press({ key: 'copy-c' })
    await ui.unmount()
    const lines = texts(await (await mount($, surface)).drawn())
    expect(lines.some(l => l.includes('Bash(git reset:*)') && l.includes('/permissions'))).toBe(true)
    expect(lines.some(l => l.includes('Bash(git push:*)'))).toBe(false)
  })
}

test('/session-denials is registered and opens the pane', async ($, on) => {
  const seen = guardWorld(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(seen.commands).toContain('session-denials')
  await $.command.run({ command: 'session-denials', args: '' } as any)
  expect(seen.opened).toEqual(['guard-denials'])
})

test('a guard deny toasts and sets the status', async ($, on) => {
  const seen = guardWorld(on, { answer: 'Cancel' })
  await bash($, 'rm -rf /')
  expect(seen.toasts).toHaveLength(1)
  expect(seen.statuses.at(-1)).toMatch(/guard: 1 denied/)
})

test('headless: no toast, no status, no open', async ($, on) => {
  const seen = guardWorld(on, { surfaces: [] })
  await bash($, 'rm -rf /')
  await $.command.run({ command: 'session-denials', args: '' } as any)
  expect(seen.toasts).toEqual([])
  expect(seen.statuses).toEqual([])
  expect(seen.opened).toEqual([])
})

const hm = (ts: number) => {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const AT = new Date(2026, 9, 8, 14, 21).getTime()
const RULED = [
  { ...D('a', AT - 60_000, 'Bash', 'git push -f origin main', 'declined'), rule: 'force-push-protected' },
  { ...D('b', AT, 'Write', '/p/.env', 'guard'), rule: 'secret-write' },
]

test('the header names the guard mode and the stopped count', async ($, on) => {
  guardWorld(on, { store: { 'session.denials': THREE } })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(texts(await (await mount($, 'terminal')).drawn())).toContain('guard: confirm mode · 3 stopped')
})

test('the header shows an empty ring as 0 stopped', async ($, on) => {
  guardWorld(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(texts(await (await mount($, 'terminal')).drawn())).toContain('guard: confirm mode · 0 stopped')
})

test('guard_mode=deny shows in the header', { options: { guard_mode: 'deny' } }, async ($, on) => {
  guardWorld(on, { store: { 'session.denials': THREE } })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(texts(await (await mount($, 'terminal')).drawn())).toContain('guard: deny mode · 3 stopped')
})

test('each row shows its rule id, its source and its local HH:MM', async ($, on) => {
  guardWorld(on, { store: { 'session.denials': RULED } })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const lines = texts(await (await mount($, 'terminal')).drawn())
  expect(lines).toContain('secret-write')
  expect(lines).toContain('force-push-protected')
  expect(lines).toContain(hm(AT))
  expect(lines).toContain(hm(AT - 60_000))
  // newest first: the secret-write stop (AT) comes before the force-push stop
  expect(lines.indexOf('secret-write')).toBeLessThan(lines.indexOf('force-push-protected'))
})

test('a stop with no rule reads a dash', async ($, on) => {
  guardWorld(on, { store: { 'session.denials': [D('n', AT, 'Bash', 'curl x', 'native')] } })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(texts(await (await mount($, 'terminal')).drawn())).toContain('—')
})

test('the guard pane opens with closeOnEscape', async ($, on) => {
  const seen = guardWorld(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-denials', args: '' } as any)
  expect(seen.openArgs[0]).toMatchObject({ id: 'guard-denials', closeOnEscape: true })
})

test('[q] closes the guard pane through the dismiss Button', async ($, on) => {
  const seen = guardWorld(on, { store: { 'session.denials': THREE } })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'close' })
  expect(seen.closed).toEqual(['guard-denials'])
  expect(JSON.stringify(await ui.drawn())).toMatch(/"hotkey":"q"/)
})

test('/session-denials again on an open pane closes it', async ($, on) => {
  const seen = guardWorld(on, { panes: [{ id: 'guard-denials', title: 'Denied calls', isShown: true, isFocused: true, isPlaced: true }] } as never)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'session-denials', args: '' } as any)
  expect(r.text).toBe('Denials pane closed.')
  expect(seen.closed).toEqual(['guard-denials'])
  expect(seen.opened).toEqual([])
})

test('headless keeps the text answer and opens and closes nothing', async ($, on) => {
  const seen = guardWorld(on, { surfaces: [] })
  const r = await $.command.run({ command: 'session-denials', args: '' } as any)
  expect(r.text).toBe('Nothing to show here: no screen is attached.')
  expect(seen.opened).toEqual([])
  expect(seen.closed).toEqual([])
})
