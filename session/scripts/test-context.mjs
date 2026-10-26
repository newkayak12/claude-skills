import test from 'node:test'
import assert from 'node:assert/strict'
import { statusLinePercent, fmtContext } from './context-logic.mjs'

const measured = {
  context_window_size: 1000000,
  total_input_tokens: 57877,
  current_usage: { input_tokens: 4, cache_creation_input_tokens: 16625, cache_read_input_tokens: 41248, output_tokens: 5 },
}

test('measured example from U1 gives 6% of 1M', () => {
  assert.deepEqual(statusLinePercent(measured), { percent: 6, tokens: 57877, window: 1000000, base: 'current_usage' })
})
test('falls back to total_input_tokens without current_usage', () => {
  const r = statusLinePercent({ context_window_size: 200000, total_input_tokens: 100000 })
  assert.equal(r.percent, 50)
  assert.equal(r.base, 'total_input_tokens')
})
test('edge values 0, 100 and over 100 are not clamped', () => {
  assert.equal(statusLinePercent({ context_window_size: 1000, total_input_tokens: 0 }).percent, 0)
  assert.equal(statusLinePercent({ context_window_size: 1000, total_input_tokens: 1000 }).percent, 100)
  assert.equal(statusLinePercent({ context_window_size: 1000, total_input_tokens: 1500 }).percent, 150)
})
test('missing, zero or invalid window gives null percent without throwing', () => {
  for (const w of [undefined, 0, -5, NaN, 'x', null]) {
    const r = statusLinePercent({ context_window_size: w, total_input_tokens: 10 })
    assert.equal(r.percent, null)
    assert.equal(r.tokens, 10)
  }
})
test('missing or invalid usage gives a safe value', () => {
  for (const u of [undefined, null, 'x', 5, {}]) {
    assert.deepEqual(statusLinePercent(u), { percent: null, tokens: 0, window: 0, base: 'total_input_tokens' })
  }
  assert.equal(statusLinePercent({ context_window_size: 100, current_usage: { input_tokens: 'a' } }).percent, 0)
})
test('fmtContext shows percent, threshold and tokens', () => {
  const s = fmtContext(statusLinePercent(measured), 70)
  assert.ok(s.includes('6%'))
  assert.ok(s.includes('70%'))
  assert.ok(s.includes('57,877'))
})
test('fmtContext handles an unknown percent', () => {
  const s = fmtContext(statusLinePercent(undefined), 70)
  assert.ok(s.includes('unknown'))
  assert.ok(s.includes('70%'))
  assert.ok(fmtContext(undefined, 70).includes('70%'))
})
