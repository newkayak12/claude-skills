import { expect, test } from 'claude-code/testing'

import { byPersona, newest, page, parse, summarize } from './debate'

const L = (persona: string, kind: string, to = '', text = '', round = 1) => JSON.stringify({ ts: 't', round, persona, to, kind, text })

const LOG = [
  L('SRE', 'persona', 'sonnet', 'on-call first', 0),
  L('PO', 'persona', 'sonnet', 'ship fast', 0),
  L('SRE', 'option', 'O1', 'one queue'),
  L('PO', 'option', 'O2', 'two queues'),
  L('Claude', 'merge', 'O1', 'Single queue'),
  L('Claude', 'merge', 'O2', 'Split queues'),
  L('SRE', 'attack', 'O2', 'doubles on-call', 2),
  L('PO', 'rebut', 'O2', 'shared runbook', 2),
  L('PO', 'support', 'O2', 'faster', 2),
].join('\n')

test('parse skips torn and foreign lines', () => {
  const lines = parse(`${L('A', 'option', 'O1', 'x')}\n{"broken\n{"foo":1}\n\n`)
  expect(lines).toHaveLength(1)
  expect(lines[0]).toMatchObject({ persona: 'A', kind: 'option', to: 'O1', text: 'x' })
})

test('summarize: personas, merged options, for/against, phase, speaking', () => {
  const d = summarize(parse(LOG))
  expect(d.personas).toEqual(['SRE', 'PO'])
  expect(d.options.map(o => [o.id, o.title, o.pros, o.cons])).toEqual([['O1', 'Single queue', 0, 0], ['O2', 'Split queues', 2, 1]])
  expect(d.phase).toBe(2)
  expect(d.speaking).toBe('PO')
  expect(d.ended).toBe(false)
})

test('summarize: proposals stand in before the merge', () => {
  const d = summarize(parse([L('SRE', 'option', 'O1', 'one queue')].join('\n')))
  expect(d.options.map(o => o.title)).toEqual(['one queue'])
  expect(d.phase).toBe(1)
})

test('summarize: cut and result end the debate', () => {
  const d = summarize(parse(`${LOG}\n${L('Claude', 'cut', 'O1', 'violates budget', 4)}\n${L('Claude', 'result', '', 'O2 wins', 4)}`))
  expect(d.options[0]!.cut).toBe('violates budget')
  expect(d.ended).toBe(true)
  expect(d.speaking).toBe(null)
  expect(d.result).toBe('O2 wins')
  expect(d.phase).toBe(3)
  expect(d.fallback).toBe(false)
})

test('summarize: fallback ends it and says so', () => {
  const d = summarize(parse(`${LOG}\n${L('Claude', 'fallback', '', 'only 1 agent left')}`))
  expect(d.ended).toBe(true)
  expect(d.fallback).toBe(true)
})

test('byPersona keeps one speaker, null keeps all', () => {
  const lines = parse(LOG)
  expect(byPersona(lines, 'SRE')).toHaveLength(3)
  expect(byPersona(lines, null)).toHaveLength(9)
})

test('page clamps the offset', () => {
  const xs = [1, 2, 3, 4, 5]
  expect(page(xs, 0, 2)).toEqual({ items: [1, 2], offset: 0 })
  expect(page(xs, 9, 2)).toEqual({ items: [4, 5], offset: 3 })
  expect(page(xs, -3, 2)).toEqual({ items: [1, 2], offset: 0 })
})

test('newest picks the latest .jsonl file', () => {
  const f = newest([
    { name: 'a.jsonl', kind: 'file', mtimeMs: 1 },
    { name: 'b.jsonl', kind: 'file', mtimeMs: 3 },
    { name: 'c.txt', kind: 'file', mtimeMs: 9 },
    { name: 'd.jsonl', kind: 'dir', mtimeMs: 9 },
  ])
  expect(f?.name).toBe('b.jsonl')
})
