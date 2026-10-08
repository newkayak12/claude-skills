import { test, expect } from 'claude-code/testing'

import { memoWorld, submit, texts } from './testkit.ts'

const PANE = { title: 'Memo', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20 }, view: {} } as any
const mount = ($: any) => $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'memo', props: PANE })
const T0 = Date.parse('2026-10-08T09:00:00Z')
const SEED = { 'memo.global': [{ text: 'reply in Korean', ts: T0 }], 'memo.project:/proj': [{ text: 'use staging DB', ts: T0 }] }

test('pane text carries the injected block, line for line', async ($, on) => {
  memoWorld(on, { store: SEED })
  const block = (await submit($)).context![0]!.split('\n')
  const lines = texts(await (await mount($)).drawn())
  const at = lines.indexOf(block[0]!)
  expect(at).toBeGreaterThan(-1)
  expect(lines.slice(at, at + block.length)).toEqual(block)
})

test('an empty store shows the usage line', async ($, on) => {
  memoWorld(on)
  expect(texts(await (await mount($)).drawn()).some(l => l.startsWith('usage: /memo'))).toBe(true)
})

test('read-only: no inputs, no buttons', async ($, on) => {
  memoWorld(on, { store: SEED })
  const json = JSON.stringify(await (await mount($)).drawn())
  expect(json).not.toMatch(/"type":"(Button|Input|TextInput)"/)
})

test('/memo opens the pane interactively; headless opens none and list answers', async ($, on) => {
  const seen = memoWorld(on, { store: SEED })
  await $.command.run({ command: 'memo', args: '' } as never)
  expect(seen.opened).toEqual(['memo'])
})

test('headless: no pane', async ($, on) => {
  const seen = memoWorld(on, { store: SEED, surfaces: [] })
  const r = await $.command.run({ command: 'memo', args: '' } as never)
  expect(seen.opened).toEqual([])
  expect(r.text).toContain('use staging DB')
})
