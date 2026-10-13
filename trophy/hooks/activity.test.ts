import { test, expect } from 'claude-code/testing'

import { addActivity, markActive, osOf, versionOn } from './logic.ts'

test('osOf reads HOME and USERPROFILE into four labels', () => {
  expect(osOf('/Users/a')).toBe('darwin')
  expect(osOf('/home/a')).toBe('linux')
  expect(osOf('/root')).toBe('linux')
  expect(osOf('C:\\Users\\a')).toBe('win32')
  expect(osOf('C:/Users/a')).toBe('win32')
  expect(osOf('/c/Users/a')).toBe('win32')
  expect(osOf(undefined, 'C:\\Users\\a')).toBe('win32')
  expect(osOf(undefined, undefined)).toBe('other')
  expect(osOf('weird')).toBe('other')
})

test('addActivity sums sessions per day and cc|os; markActive adds a zero and never increments', () => {
  let a = addActivity({}, '2026-10-13', '2.1.296', 'darwin')
  a = addActivity(a, '2026-10-13', '2.1.296', 'darwin')
  a = addActivity(a, '2026-10-13', '2.1.297', 'darwin')
  expect(a).toEqual({ '2026-10-13': { '2.1.296|darwin': 2, '2.1.297|darwin': 1 } })

  const m = markActive(a, '2026-10-14', '2.1.296', 'darwin')
  expect(m['2026-10-14']).toEqual({ '2.1.296|darwin': 0 })
  const again = markActive(m, '2026-10-14', '2.1.296', 'darwin')
  expect(again['2026-10-14']).toEqual({ '2.1.296|darwin': 0 })
  expect(markActive(a, '2026-10-13', '2.1.296', 'darwin')['2026-10-13']!['2.1.296|darwin']).toBe(2)
  expect(a['2026-10-14']).toBeUndefined()
})

test('versionOn gives the newest entry on or before the day that names the plugin', () => {
  const versions = {
    '2026-10-10': { think: '1.0.0', develop: '1.0.0' },
    '2026-10-12': { think: '1.1.0' },
  }
  expect(versionOn(versions, '2026-10-13', 'think')).toBe('1.1.0')
  expect(versionOn(versions, '2026-10-13', 'develop')).toBe('1.0.0')
  expect(versionOn(versions, '2026-10-11', 'think')).toBe('1.0.0')
  expect(versionOn(versions, '2026-10-09', 'think')).toBeUndefined()
  expect(versionOn(versions, '2026-10-13', 'nope')).toBeUndefined()
})
