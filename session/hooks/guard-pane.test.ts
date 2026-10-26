import { test, expect } from 'claude-code/testing'

import { bash, guardWorld, SURFACES, texts } from './testkit.ts'
import type { Surface } from './testkit.ts'

const PANE = {
  title: 'Denied calls', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20 }, view: {},
} as any

const D = (id: string, ts: number, tool: string, call: string, source: string) => ({ id, ts, tool, call, reason: `why ${id}`, source })
const THREE = [
  D('a', 1000, 'Bash', 'git push -f origin main', 'guard'),
  D('b', 2000, 'Bash', 'curl http://x', 'native'),
  D('c', 3000, 'Bash', 'git reset --hard', 'declined'),
]

const mount = ($: any, surface: Surface) =>
  $.ui.mount({ plugin: 'session', surface, component: 'Pane', requestId: 'guard-denials', props: PANE })

// terminal, desktop, mobile and vscode
for (const surface of SURFACES) {
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
    expect(lines).toContain('○ declined')
    expect(lines).toContain('● native  ')
    expect(lines).toContain('✘ guard   ')
  })

  test(`${surface}: each stop is one row, newest first, columns in order time · tool · what · rule · source · copy`, async ($, on) => {
    guardWorld(on, { store: { 'session.denials': RULED } })
    await $.session.start({ cwd: '/w', surface, isInteractive: true })
    const tree = await (await mount($, surface)).drawn()
    const rowsOf = (n: any): any[] =>
      Array.isArray(n) ? n.flatMap(rowsOf) : n?.props?.gap === 1 && (n.children ?? []).some((k: any) => k?.type === 'Button' && k.props?.label === 'copy') ? [n] : (n?.children ?? []).flatMap?.(rowsOf) ?? []
    const rows = rowsOf(tree)
    expect(rows).toHaveLength(2)
    const cells = rows.map(r => r.children.map((k: any) => (k.type === 'Button' ? `[${k.props.label}]` : texts(k).join('')))) as string[][]
    expect(cells[0]).toEqual([hm(AT), 'Write', '/p/.env', 'secret-write'.padEnd(20), '✘ guard   ', '[copy]'])
    expect(cells[1]![0]).toBe(hm(AT - 60_000))
    expect(cells[1]!.slice(1)).toEqual(['Bash ', 'git push -f origin main', 'force-push-protected', '○ declined', '[copy]'])
  })

  test(`${surface}: no second reason line, no bracketed key label on a Button`, async ($, on) => {
    guardWorld(on, { store: { 'session.denials': THREE } })
    await $.session.start({ cwd: '/w', surface, isInteractive: true })
    const tree = await (await mount($, surface)).drawn()
    expect(texts(tree).some(l => l.startsWith('why '))).toBe(false)
    const labels = [...JSON.stringify(tree).matchAll(/"label":"([^"]*)"/g)].map(m => m[1]!)
    expect(labels.sort()).toEqual(['copy', 'copy', 'copy', 'q'])
    expect(labels.some(l => l.includes('['))).toBe(false)
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

test('the header names the guard mode and the stopped count once, without a title or "this session"', async ($, on) => {
  guardWorld(on, { store: { 'session.denials': THREE } })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const lines = texts(await (await mount($, 'terminal')).drawn())
  expect(lines).toContain('confirm mode · 3 stopped')
  expect(lines.some(l => l.includes('guard:') || l.includes('this session'))).toBe(false)
})

test('the header shows an empty ring as 0 stopped, with no denials and the footer', async ($, on) => {
  guardWorld(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const lines = texts(await (await mount($, 'terminal')).drawn())
  expect(lines).toContain('confirm mode · 0 stopped')
  expect(lines).toContain('no denials')
  expect(lines).toContain('· /session-denials closes')
})

test('guard_mode=deny shows in the header', { options: { guard_mode: 'deny' } }, async ($, on) => {
  guardWorld(on, { store: { 'session.denials': THREE } })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(texts(await (await mount($, 'terminal')).drawn())).toContain('deny mode · 3 stopped')
})

test('each row shows its rule id, its source and its local HH:MM', async ($, on) => {
  guardWorld(on, { store: { 'session.denials': RULED } })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const lines = texts(await (await mount($, 'terminal')).drawn())
  const at = (s: string) => lines.findIndex(l => l.trim() === s)
  expect(at('secret-write')).toBeGreaterThan(-1)
  expect(at('force-push-protected')).toBeGreaterThan(-1)
  expect(lines).toContain(hm(AT))
  expect(lines).toContain(hm(AT - 60_000))
  // newest first: the secret-write stop (AT) comes before the force-push stop
  expect(at('secret-write')).toBeLessThan(at('force-push-protected'))
})

test('a stop with no rule reads a dash', async ($, on) => {
  guardWorld(on, { store: { 'session.denials': [D('n', AT, 'Bash', 'curl x', 'native')] } })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(texts(await (await mount($, 'terminal')).drawn()).some(l => l.trim() === '—')).toBe(true)
})

test('an unknown source renders a dash with no mark and does not throw', async ($, on) => {
  guardWorld(on, { store: { 'session.denials': [D('u', AT, 'Bash', 'curl x', 'mystery')] } })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const lines = texts(await (await mount($, 'terminal')).drawn())
  expect(lines.some(l => /[✘○●]/.test(l))).toBe(false)
  expect(lines.filter(l => l.trim() === '—')).toHaveLength(2)
  expect(lines).toContain('confirm mode · 1 stopped')
})

test('the footer is the one dim line: Esc, the q Button, the command', async ($, on) => {
  guardWorld(on, { store: { 'session.denials': THREE } })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const tree = await (await mount($, 'terminal')).drawn()
  expect(texts(tree)).toEqual(expect.arrayContaining(['Esc ·', '· /session-denials closes']))
  expect(JSON.stringify(tree)).toMatch(/"label":"q"/)
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
