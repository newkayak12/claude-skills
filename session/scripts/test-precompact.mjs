// node --test session/scripts/test-precompact.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMPACT_MARK, RECAP_PROMPT, precompactInstructions } from './precompact-logic.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const SECTIONS = ['Goal', 'Direction', 'In progress', 'Decisions', 'Open', 'Corrections']

test('auto emits the six sections', () => {
  const out = precompactInstructions({ trigger: 'auto' }, {})
  for (const s of SECTIONS) assert.ok(out.includes(s), s)
})

test('auto with other instructions emits', () => {
  const out = precompactInstructions({ trigger: 'auto', custom_instructions: 'keep the code' }, {})
  assert.ok(out.includes(RECAP_PROMPT))
})

test('manual without the mark is a no-op', () => {
  assert.equal(precompactInstructions({ trigger: 'manual' }, {}), '')
  assert.equal(precompactInstructions({ trigger: 'manual', custom_instructions: 'keep the code' }, {}), '')
})

test('the mark is a no-op on auto and manual', () => {
  for (const trigger of ['auto', 'manual']) {
    assert.equal(precompactInstructions({ trigger, custom_instructions: `${COMPACT_MARK}: x` }, {}), '')
    assert.equal(precompactInstructions({ trigger, custom_instructions: `  ${COMPACT_MARK}` }, {}), '')
  }
})

test('off is a no-op, true emits', () => {
  const input = { trigger: 'auto' }
  assert.equal(precompactInstructions(input, { CLAUDE_PLUGIN_OPTION_SMART_COMPACT_ENABLED: 'false' }), '')
  assert.ok(precompactInstructions(input, { CLAUDE_PLUGIN_OPTION_SMART_COMPACT_ENABLED: 'true' }).includes(RECAP_PROMPT))
})

test('null, empty and non-object input is a no-op', () => {
  for (const input of [null, undefined, {}, 'auto', 7, [], true]) assert.equal(precompactInstructions(input, {}), '')
})

const CLI = join(here, 'precompact.mjs')
const spawn = (input, env = {}) =>
  spawnSync('node', [CLI], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_OPTION_SMART_COMPACT_ENABLED: '', ...env } })

test('spawn: auto exits 0 with plain text', () => {
  const r = spawn(JSON.stringify({ trigger: 'auto' }))
  assert.equal(r.status, 0)
  assert.ok(r.stdout.includes(RECAP_PROMPT))
  assert.throws(() => JSON.parse(r.stdout))
})

test('spawn: malformed and manual exit 0 with empty stdout', () => {
  for (const input of ['not json', '', JSON.stringify({ trigger: 'manual' })]) {
    const r = spawn(input)
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
  }
})

test('RECAP_PROMPT and COMPACT_MARK match recap.ts and compact-logic.ts', () => {
  const recap = readFileSync(join(here, '../hooks/recap.ts'), 'utf8')
  const m = recap.match(/export const RECAP_PROMPT = `([^`]*)`/)
  assert.ok(m, 'template found in recap.ts')
  assert.ok(!m[1].includes('${') && !m[1].includes('\\'), 'template has no interpolation or escapes')
  assert.equal(RECAP_PROMPT, m[1])
  const logic = readFileSync(join(here, '../hooks/compact-logic.ts'), 'utf8')
  const c = logic.match(/export const COMPACT_MARK = '([^']*)'/)
  assert.ok(c, 'COMPACT_MARK found in compact-logic.ts')
  assert.equal(COMPACT_MARK, c[1])
})
