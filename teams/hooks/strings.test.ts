import { expect, test } from 'claude-code/testing'

import { DASH_WORD_KEYS } from '../scripts/lib/view-dashboard.mjs'
import { ENGINE_WORD_KEYS } from '../scripts/lib/view-events.mjs'
import { LANE_KEYS, NOW_KINDS, SUBJECT_KEY_OF, SUBJECT_KEYS, SUMMARY_WORD_KEYS, TASK_STATES, TICKET_STATES } from '../scripts/lib/view-summary.mjs'
import { STAGE_KEYS } from '../scripts/lib/view-stages.mjs'
import { latinOutside } from './lang-allow'
import { STRINGS, SUBJECT_KEY } from './mod'

const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

test('STRINGS: en and ko have identical keys and every ko value is a non-empty string', () => {
  expect(Object.keys(STRINGS.ko).sort()).toEqual(Object.keys(STRINGS.en).sort())
  for (const value of Object.values(STRINGS.ko)) expect(typeof value === 'string' && value.length > 0).toBe(true)
})

test('STRINGS: every en key exists in ko', () => {
  for (const key of Object.keys(STRINGS.en)) expect(key in STRINGS.ko ? key : `missing in ko: ${key}`).toBe(key)
})

test('STRINGS: every ko value is non-empty, naming the key', () => {
  for (const [key, value] of Object.entries(STRINGS.ko)) expect(value.length > 0 ? key : `empty ko: ${key}`).toBe(key)
})

test('STRINGS: en and ko hold equal {name} sets per key', () => {
  const en = STRINGS.en as Record<string, string>
  const ko = STRINGS.ko as Record<string, string>
  for (const key of Object.keys(en)) expect(names(en[key]) + '' === names(ko[key] ?? '') + '' ? key : `placeholders differ: ${key}`).toBe(key)
})

test('STRINGS: engine keys the node hands over are all in the table', () => {
  const en = STRINGS.en as Record<string, string>
  const all = [...ENGINE_WORD_KEYS, ...DASH_WORD_KEYS, ...SUMMARY_WORD_KEYS]
  expect(all.length > 0).toBe(true)
  for (const key of all) expect(key in en ? key : `engine key missing in STRINGS.en: ${key}`).toBe(key)
})

// Each place mod.tsx builds a key from an engine value: `${prefix}${Cap(value)}`. A value the engine can emit with no key draws raw English.
// Lists come from the engine where it exports one (NOW_KINDS, STAGE_KEYS, LANE_KEYS); the rest are read from the engine's emitters
// (view-collect task states, view-dashboard tile keys, view-status TEAMS, view-events log and decision kinds) and named here.
const cap = (v: string) => v[0]!.toUpperCase() + v.slice(1)
// mod.tsx camel(): `IN_PROGRESS` and `waiting_human` -> `InProgress`, `WaitingHuman`
const camel = (v: string) => v.toLowerCase().split('_').map(cap).join('')
const FAMILIES: Record<string, string[]> = {
  now: NOW_KINDS, // mod.tsx Floor: now${kind}
  stage: [...STAGE_KEYS, ...NOW_KINDS], // Dash/Summary/Stories stage${key}; Dash Now stage${now.kind}
  lane: LANE_KEYS,
  state: [...TASK_STATES, 'failed'], // Report/Dash state${camel(task.state)}; TASK_STATES is tied to the collect code by scripts/test-state-lists.mjs
  ticket: [...TICKET_STATES, 'stalled', 'unknown'], // Stories page and EPIC list ticket${camel(state)}; TICKET_STATES is tied to tickets.mjs the same way
  done: ['complete', 'partial', 'blocked', 'cancelled', 'running', 'waiting_human'], // an EPIC's daemon_done state: done${camel(state)}
  team: ['planning', 'develop', 'qa', 'audit', 'epic'],
  tile: ['progress', 'stories', 'cost', 'waiting', 'drivers'],
  kind: ['proposal', 'retry', 'rejudge', 'resplit', 'defect', 'answer', 'decision'],
  log: ['passed', 'failed', 'filed', 'integrated', 'dispatched', 'waiting', 'finished'],
}
test('STRINGS: every engine value of a key family has its key in en and ko', () => {
  for (const lang of ['en', 'ko'] as const) {
    const table = STRINGS[lang] as Record<string, string>
    for (const [prefix, values] of Object.entries(FAMILIES)) {
      expect(values.length > 0).toBe(true)
      for (const v of values) expect(`${prefix}${camel(v)}` in table ? 1 : `${lang} missing ${prefix}${camel(v)}`).toBe(1)
    }
  }
})

// the engine's subject words (view-summary.mjs SUBJECT_KEY_OF): the mod's lookup equals the engine's, every key is in en and ko, and en says the engine's own word
test('STRINGS: every engine subject word has its key in en and ko, English equal to the engine text', () => {
  expect(SUBJECT_KEYS.length > 0).toBe(true)
  expect(SUBJECT_KEY).toEqual(SUBJECT_KEY_OF)
  for (const [word, key] of Object.entries(SUBJECT_KEY_OF)) {
    expect([key, (STRINGS.en as Record<string, string>)[key]]).toEqual([key, word])
    const ko = (STRINGS.ko as Record<string, string>)[key]
    expect([key, ko !== undefined && ko.length > 0, latinOutside(ko ?? '', []).length]).toEqual([key, true, 0])
  }
})

test('latinOutside: id tokens are data, a bare prefix is not', () => {
  expect(latinOutside('SG1 진행', []).length).toBe(0)
  expect(latinOutside('P1 QA-F1 E-1a2b', []).length).toBe(0)
  expect(latinOutside('SG 진행', []).join(' ')).toBe('SG')
})

test('STRINGS: ko nextShape, nextAreas and tileStories keep to the allow-list', () => {
  const ko = STRINGS.ko as Record<string, string>
  for (const k of ['nextShape', 'nextAreas', 'tileStories']) {
    expect(latinOutside(ko[k].replace(/\{\w+\}/g, ''), []).length === 0 ? k : `${k} has a Latin word outside ALLOW`).toBe(k)
  }
  expect(ko.tileStories).toBe(ko.tabStories)
})
