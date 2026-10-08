import { expect, test } from 'claude-code/testing'

import { STRINGS } from './mod'

const HANGUL = /[\uAC00-\uD7A3]/

test('STRINGS: en and ko have identical keys and every value is a non-empty string', () => {
  expect(Object.keys(STRINGS.ko).sort()).toEqual(Object.keys(STRINGS.en).sort())
  for (const lang of [STRINGS.en, STRINGS.ko]) {
    for (const value of Object.values(lang)) expect(typeof value === 'string' && value.length > 0).toBe(true)
  }
})

test('STRINGS.en has no Hangul', () => {
  for (const value of Object.values(STRINGS.en)) expect(HANGUL.test(value)).toBe(false)
})

test('the consent question lists the same data in both languages; ko is the original text', () => {
  for (const part of ['skill names', 'daily counts', 'error codes', 'no prompts or paths']) {
    expect(STRINGS.en.consentAsk).toContain(part)
  }
  expect(STRINGS.ko.consentAsk).toBe('trophy: 익명 사용 통계를 보낼까요? (스킬명·일별 횟수·오류 코드만, 프롬프트·경로 없음)')
})
