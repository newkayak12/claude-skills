import { test, expect } from 'claude-code/testing'

import { checkKill } from './kill.ts'
import { ancestorsOf, parsePs } from './procs.ts'
import { mount, PS, T, world } from './orphankit.ts'
import { texts } from './testkit.ts'

const rows = parsePs(PS)
const seen = rows.find(r => r.pid === 4310)!
const verdict = (s = seen, fresh = rows, engine = 4242) => checkKill(s, fresh, engine, ancestorsOf(fresh, engine))

test('checkKill: a live child with the same cmd and start passes', () => {
  expect(verdict()).toEqual({ ok: true, pid: 4310 })
})

test('checkKill: a changed command or start time (pid reuse) refuses', () => {
  expect(verdict({ ...seen, cmd: 'claude -p something else' }).ok).toBe(false)
  expect(verdict({ ...seen, start: 'Wed Oct 8 09:00:00 2026' }).ok).toBe(false)
})

test('checkKill: the engine, an ancestor and the wrapped child refuse', () => {
  expect(verdict(rows.find(r => r.pid === 4242)!).ok).toBe(false)
  expect(verdict(rows.find(r => r.pid === 1)!).ok).toBe(false)
  expect(verdict(rows.find(r => r.pid === 4301)!).ok).toBe(false)
  expect(verdict(rows.find(r => r.pid === 9000)!).ok).toBe(false)
})

test('checkKill: a gone pid is flagged gone; a helper of ours and a non-claude process refuse', () => {
  const gone = verdict(seen, rows.filter(r => r.pid !== 4310))
  expect(gone).toEqual({ ok: false, reason: 'already gone', gone: true })
  const own = parsePs(`${PS}\n 5000  4242 ${T} ps -A -o pid=,ppid=`)
  expect(verdict(own.find(r => r.pid === 5000)!, own).ok).toBe(false)
  expect(verdict(rows.find(r => r.pid === 4320)!).ok).toBe(false)
})

// ---- the [stop] button, through the pane ----
const settle = () => new Promise(res => (globalThis as any).setTimeout(res, 20))
const kills = (procs: string[][]) => procs.filter(p => p[0] === 'kill')

const setup = async ($: any, on: any, answer: string | Error, whenAsked?: (w: ReturnType<typeof world>) => void) => {
  const w = world(on)
  const toasts: string[] = []
  on('ui.toast', (_$: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const asks: string[] = []
  on('tool.call', (_$: any, e: any) => {
    if (e.tool === 'AskUserQuestion') {
      const q = e.questions[0].question as string
      asks.push(q)
      whenAsked?.(w)
      if (answer instanceof Error) throw answer
      return { result: { questions: [], answers: { [q]: answer } }, text: '' } as never
    }
    return { result: 'done', text: '' } as never
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session', args: '' } as any)
  const ui = await mount($)
  await ui.press({ key: 'tab-orphans' })
  await ui.unmount()
  const orphans = await mount($)
  await orphans.drawn()
  return { w, toasts, asks, ui: orphans }
}

test('stop, happy path: ask shows the full command, then exactly one kill -TERM', async ($, on) => {
  const { w, asks, ui } = await setup($, on, 'Stop')

  await ui.press({ key: 'stop-4310' })
  await settle()

  expect(asks).toHaveLength(1)
  expect(asks[0]).toContain('/usr/local/bin/claude -p job two')
  expect(kills(w.procs)).toEqual([['kill', '-TERM', '4310']])
})

test('stop: the command changed since it was listed -> no kill, a toast', async ($, on) => {
  const { w, toasts, ui } = await setup($, on, 'Stop')
  w.body.ps = PS.replace('claude -p job two', 'claude -p a different job')

  await ui.press({ key: 'stop-4310' })
  await settle()

  expect(kills(w.procs)).toEqual([])
  expect(toasts.join('\n')).toMatch(/changed/)
})

test('stop: a reused pid (same cmd, new start time) -> no kill', async ($, on) => {
  const { w, ui } = await setup($, on, 'Stop')
  w.body.ps = PS.replace(`4310  4242 ${T}`, '4310  4242 Wed Oct  8 10:13:00 2026')

  await ui.press({ key: 'stop-4310' })
  await settle()

  expect(kills(w.procs)).toEqual([])
})

test('stop: the pid is gone -> no kill, no throw, the row clears', async ($, on) => {
  const { w, toasts, ui } = await setup($, on, 'Stop')
  w.body.ps = PS.split('\n').filter(l => !l.includes(' 4310 ')).join('\n')

  await ui.press({ key: 'stop-4310' })
  await settle()

  expect(kills(w.procs)).toEqual([])
  expect(toasts.join('\n')).toMatch(/gone/)
  expect(w.cells.get('session.orphans')).toEqual([expect.objectContaining({ pid: 4300 })])
})

test('stop: ask declined or dismissed -> no kill', async ($, on) => {
  const declined = await setup($, on, 'Cancel')
  await declined.ui.press({ key: 'stop-4310' })
  await settle()
  expect(kills(declined.w.procs)).toEqual([])
})

test('stop: ask throws (unanswerable) -> no kill', async ($, on) => {
  const { w, ui } = await setup($, on, new Error('no one to ask'))

  await ui.press({ key: 'stop-4310' })
  await settle()

  expect(kills(w.procs)).toEqual([])
})

test('stop: the pid changed between ask and signal -> no kill', async ($, on) => {
  const { w, ui } = await setup($, on, 'Stop', w => {
    w.body.ps = PS.replace('claude -p job two', 'claude -p swapped')
  })

  await ui.press({ key: 'stop-4310' })
  await settle()

  expect(kills(w.procs)).toEqual([])
})

test('the pane shows the stop button next to each row', async ($, on) => {
  const { ui } = await setup($, on, 'Cancel')

  expect(texts(await ui.drawn()).filter(l => l.includes('claude -p')).length).toBeGreaterThan(1)
})
