import { expect, test } from 'claude-code/testing'

import { achievements } from '../data/achievements.ts'
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

test('every achievement has English title and description and a Korean pair', () => {
  expect(achievements).toHaveLength(80)
  for (const a of achievements) {
    expect(HANGUL.test(a.title) || HANGUL.test(a.description)).toBe(false)
    expect(a.title.length > 0 && a.description.length > 0).toBe(true)
    expect(a.ko.title.length > 0 && a.ko.description.length > 0).toBe(true)
  }
})

// The English text may not drop or invent a number or a plugin/skill name the Korean carries.
const runs = (text: string, re: RegExp) => (text.match(re) ?? []).map(x => x.toLowerCase())
const covers = (have: string[], need: string[]) => {
  const left = [...have]
  return need.every(x => {
    const i = left.indexOf(x)
    if (i < 0) return false
    left.splice(i, 1)
    return true
  })
}

test('each English description keeps the numbers and skill words of the Korean one', () => {
  for (const a of achievements) {
    expect(covers(runs(a.description, /\d+/g), runs(a.ko.description, /\d+/g)), a.id).toBe(true)
    expect(covers(runs(a.description, /[A-Za-z][A-Za-z0-9-]*/g), runs(a.ko.description, /[A-Za-z][A-Za-z0-9-]*/g)), a.id).toBe(true)
    if ('count' in a.rule) {
      expect(a.description.includes(String(a.rule.count)), a.id).toBe(a.ko.description.includes(String(a.rule.count)))
    }
  }
})
