import { expect, test } from 'claude-code/testing'

import { STRINGS } from './mod'

test('STRINGS: en and ko have identical keys and every ko value is a non-empty string', () => {
  expect(Object.keys(STRINGS.ko).sort()).toEqual(Object.keys(STRINGS.en).sort())
  for (const value of Object.values(STRINGS.ko)) expect(typeof value === 'string' && value.length > 0).toBe(true)
})

test('STRINGS: every en key exists in ko', () => {
  for (const key of Object.keys(STRINGS.en)) expect(key in STRINGS.ko ? key : `missing in ko: ${key}`).toBe(key)
})
