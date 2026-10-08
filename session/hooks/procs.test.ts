import { test, expect } from 'claude-code/testing'

import { ancestorsOf, descendants, fmtAge, matchOrphans, parsePs } from './procs.ts'

const T = 'Wed Oct  8 10:09:00 2026'
// engine 4242. 4300 is a wrapper shell of the child 4301 (one job); 4310 is a second job;
// 9000 is a claude -p outside this session; 4320 is not claude -p.
const PS = [
  `    1     0 ${T} /sbin/launchd`,
  `  500     1 ${T} /Applications/Terminal`,
  ` 4242   500 ${T} /usr/local/bin/claude`,
  ` 4300  4242 ${T} sh -c claude -p "job one"`,
  ` 4301  4300 ${T} /usr/local/bin/claude -p job one`,
  ` 4310  4242 ${T} /usr/local/bin/claude -p job two`,
  ` 4320  4242 ${T} node /x/server.js`,
  ` 9000     1 ${T} /usr/local/bin/claude -p unrelated`,
  'this line is garbage',
  '',
].join('\n')

test('parsePs reads pid, ppid, start and command and skips garbage', () => {
  const rows = parsePs(PS)
  expect(rows).toHaveLength(8)
  expect(rows[4]).toEqual({ pid: 4301, ppid: 4300, start: T.replace('  ', ' '), cmd: '/usr/local/bin/claude -p job one' })
})

test('descendants are below the engine only', () => {
  expect(descendants(parsePs(PS), 4242).map(r => r.pid)).toEqual([4300, 4301, 4310, 4320])
})

test('a wrapper shell and its child are one row (the inner claude -p); a sibling outside the tree is absent', () => {
  expect(matchOrphans(parsePs(PS), 4242).map(r => r.pid)).toEqual([4301, 4310])
})

test('ancestors run from the engine to the root', () => {
  expect(ancestorsOf(parsePs(PS), 4242)).toEqual([4242, 500, 1])
})

test('age reads minutes since the start, blank on garbage', () => {
  const t = Date.parse('Oct 8 2026 10:09:00')
  expect(fmtAge('Wed Oct 8 10:09:00 2026', t + 5 * 60_000)).toBe('5m')
  expect(fmtAge('nonsense', t)).toBe('')
})
