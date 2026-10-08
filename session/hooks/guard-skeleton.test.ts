import { test, expect } from 'claude-code/testing'

import { guardWorld, PASSED } from './testkit.ts'
import { splitCommands } from './guard-logic.ts'

const argvs = (cmd: string) => splitCommands(cmd).map(c => c.argv)

test('splitter: separators give four argv lists, the $( ) body one more marked sub', () => {
  const all = splitCommands('a && rm -rf x; b | c $(d)')
  expect(all.filter(c => !c.sub).map(c => c.argv)).toEqual([['a'], ['rm', '-rf', 'x'], ['b'], ['c', '$(…)']])
  expect(all.filter(c => c.sub).map(c => c.argv)).toEqual([['d']])
})

test('splitter: a heredoc body that feeds cat is text, not commands', () => {
  expect(argvs("cat <<'EOF'\nrm -rf /\nEOF")).toEqual([['cat']])
})

test('splitter: a heredoc body that feeds bash is code', () => {
  const all = argvs("bash <<'EOF'\nrm x\nEOF")
  expect(all).toContainEqual(['bash'])
  expect(all).toContainEqual(['rm', 'x'])
})

test('splitter: quoted arguments stay arguments', () => {
  expect(argvs('grep -r "rm -rf" .')).toEqual([['grep', '-r', 'rm -rf', '.']])
})

test('splitter: an unterminated quote gives nothing', () => {
  expect(argvs('echo "oops')).toEqual([])
  expect(argvs('rm -rf "$(')).toEqual([])
})

test('a throwing classify returns next(e) value', async ($, on) => {
  guardWorld(on, { cwd: new Error('cwd is gone') })
  expect(await $.tool.call({ tool: 'Bash', command: 'rm -rf /' } as never)).toEqual(PASSED)
})

test('plain commands pass through the Bash hook untouched', async ($, on) => {
  const w = guardWorld(on)
  expect(await $.tool.call({ tool: 'Bash', command: 'ls -la' } as never)).toEqual(PASSED)
  expect(w.asks).toEqual([])
})
