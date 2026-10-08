import { test, expect } from 'claude-code/testing'

import { addCommit, addDeny, addFile, emptyLedger, fmtMs, stepSpan, summarize } from './ledger.ts'
import { clockAt, memoryState, memoryStore } from './testkit.ts'

const wire = (on: any) => {
  memoryStore(on)
  const cells = memoryState(on)
  const clock = clockAt(on)
  on('session.surfaces', () => ({ value: [] }))
  return { cells, clock }
}

const ledgerOf = (cells: Map<string, unknown>) => cells.get('session.ledger') as ReturnType<typeof emptyLedger>
const call = ($: any, tool: string, args: object) => $.tool.call({ tool, ...args } as never)

test('the same path twice is listed once', () => {
  let l = addFile(emptyLedger(), '/w/a.ts')
  l = addFile(l, '/w/a.ts')
  expect(l.files).toEqual(['/w/a.ts'])
})

test('git commit with its output is counted; git status is not', () => {
  const out = '[main 4b1ed51] feat: x\n 1 file changed'
  expect(addCommit(emptyLedger(), 'git commit -m x', out, true).commits).toEqual([{ hash: '4b1ed51', subject: 'feat: x' }])
  expect(addCommit(emptyLedger(), 'git status', out, true).commits).toEqual([])
  expect(addCommit(emptyLedger(), 'git commit -m x', out, false).commits).toEqual([])
})

test('a deny keeps tool and reason', () => {
  expect(addDeny(emptyLedger(), 'Bash', 'no').denied).toEqual([{ tool: 'Bash', reason: 'no' }])
})

test('longest gap ignores turn separators and takes the largest gap', () => {
  expect(stepSpan([1000, 1500, 0, 100000, 106000, 106100])).toBe(6000)
  expect(stepSpan([5])).toBe(0)
  expect(fmtMs(372000)).toBe('6m12s')
  expect(fmtMs(5000)).toBe('5s')
})

test('summarize counts and keeps the file list', () => {
  const l = addCommit(addFile(emptyLedger(), '/w/a'), 'git commit -m x', '[m abc1234] s', true)
  expect(summarize(l, '2026-10-08')).toEqual({ day: '2026-10-08', files: 1, commits: 1, denied: 0, longestMs: 0, fileList: ['/w/a'] })
})

test('Edit/Write/NotebookEdit record paths, Bash records commits, a deny from beneath is counted', async ($, on) => {
  const { cells, clock } = wire(on)
  on('tool.call', (_$, e) => {
    if (e.tool === 'Bash' && e.command.includes('rm')) return { deny: 'blocked' } as never
    if (e.tool === 'Bash') return { result: { stdout: '[main abc1234] feat: y\n' }, text: '' } as never
    return { result: 'ok', text: '' } as never
  })

  await call($, 'Edit', { file_path: '/w/a.ts', old_string: 'a', new_string: 'b' })
  await clock.advance(1000)
  await call($, 'Write', { file_path: '/w/a.ts', content: 'x' })
  await call($, 'NotebookEdit', { notebook_path: '/w/n.ipynb', new_source: '1' })
  await call($, 'Bash', { command: 'git commit -m y' })
  await call($, 'Bash', { command: 'git status' })
  const denied = await call($, 'Bash', { command: 'rm -rf x' })

  expect((denied as any).deny).toBe('blocked')
  const l = ledgerOf(cells)
  expect(l.files).toEqual(['/w/a.ts', '/w/n.ipynb'])
  expect(l.commits).toEqual([{ hash: 'abc1234', subject: 'feat: y' }])
  expect(l.denied).toEqual([{ tool: 'Bash', reason: 'blocked' }])
})

test('step timing: gaps between calls within a turn, a turn end separates turns', async ($, on) => {
  const { cells, clock } = wire(on)
  on('tool.call', () => ({ result: 'ok', text: '' }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }))

  await call($, 'Read', { file_path: '/w/a' })
  await clock.advance(372000)
  await call($, 'Read', { file_path: '/w/b' })
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't' } as never)
  await clock.advance(9_999_999)
  await call($, 'Read', { file_path: '/w/c' })

  expect(stepSpan(ledgerOf(cells).steps)).toBe(372000)
})

test('a throwing state write still returns the tool result', async ($, on) => {
  memoryStore(on)
  clockAt(on)
  on('session.surfaces', () => ({ value: [] }))
  on('state.get', () => {
    throw new Error('state is gone')
  })
  on('tool.call', () => ({ result: 'fine', text: '' }) as never)

  const r = await call($, 'Edit', { file_path: '/w/a', old_string: 'a', new_string: 'b' })

  expect(r).toEqual({ result: 'fine', text: '' })
})
