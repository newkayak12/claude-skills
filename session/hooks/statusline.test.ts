import { test, expect } from 'claude-code/testing'

import { register, settingsRead, withStatusLine } from './statusline.ts'

const ROOT = '/plug/session'
const COMMAND = { type: 'command', command: `node "${ROOT}/scripts/statusline.mjs"` }
const KEY = 'session@inline'
const off = (v: boolean, key = KEY) => ({ pluginConfigs: { [key]: { options: { status_line: v } } } })
const layer = (source: string, settings: Record<string, unknown>) => ({ source, settings })
const SOURCES = ['plugin', 'user', 'project', 'local', 'flag', 'policy']

test('statusline: no layer holds statusLine -> merged settings plus the command, other keys kept', () => {
  const merged = { model: 'opus', permissions: { allow: ['Read'] } }
  expect(withStatusLine(merged, [layer('user', { model: 'opus' })], ROOT)).toEqual({ ...merged, statusLine: COMMAND })
  expect(withStatusLine(merged, [], ROOT)).toEqual({ ...merged, statusLine: COMMAND })
})

for (const source of SOURCES) {
  test(`statusline: a ${source} layer holding statusLine -> unchanged`, () => {
    const own = { type: 'command', command: 'echo mine' }
    const merged = { statusLine: own }
    expect(withStatusLine(merged, [layer(source, merged)], ROOT)).toBe(merged)
  })
}

test('statusline: a one-source read passes through', async () => {
  const merged = { model: 'opus' }
  const got = await settingsRead(() => ROOT, { source: 'user', layers: [] }, async () => merged)
  expect(got).toBe(merged)
})

test('statusline: a merged read through the hook adds the command', async () => {
  const merged = { model: 'opus' }
  const got = await settingsRead(() => ROOT, { layers: [layer('user', merged)] }, async () => merged)
  expect(got).toEqual({ model: 'opus', statusLine: COMMAND })
})

test('statusline: user layer status_line false -> unchanged (also under the marketplace and bare keys)', () => {
  const merged = { model: 'opus' }
  for (const key of [KEY, 'session@newkayak12-claude-skills', 'session']) {
    expect(withStatusLine(merged, [layer('user', off(false, key))], ROOT)).toBe(merged)
  }
})

test('statusline: another plugin\'s status_line false does not turn it off', () => {
  expect(withStatusLine({}, [layer('user', off(false, 'other@inline'))], ROOT)).toEqual({ statusLine: COMMAND })
})

test('statusline: user false + local true -> the higher layer wins, line present', () => {
  expect(withStatusLine({}, [layer('user', off(false)), layer('local', off(true))], ROOT)).toEqual({ statusLine: COMMAND })
  const merged = {}
  expect(withStatusLine(merged, [layer('user', off(true)), layer('local', off(false))], ROOT)).toBe(merged)
})

test('statusline: register options status_line false with silent layers -> line present', async () => {
  let hook: any
  const on: any = (_event: string, h: unknown) => {
    hook = h
    return { catch: () => undefined }
  }
  register(on, { status_line: false })
  const got = await hook({ plugin: { root: ROOT } }, { layers: [] }, async () => ({}))
  expect(got).toEqual({ statusLine: COMMAND })
})

test('statusline: same layers and next value twice -> deep-equal answers', async () => {
  const layers = [layer('user', { model: 'opus' })]
  const a = await settingsRead(() => ROOT, { layers }, async () => ({ model: 'opus' }))
  const b = await settingsRead(() => ROOT, { layers }, async () => ({ model: 'opus' }))
  expect(a).toEqual(b)
})

test('statusline: a throwing root lookup fails open to next(e)', async () => {
  const merged = { model: 'opus' }
  const got = await settingsRead(
    () => {
      throw new Error('no root')
    },
    { layers: [] },
    async () => merged,
  )
  expect(got).toBe(merged)
})
