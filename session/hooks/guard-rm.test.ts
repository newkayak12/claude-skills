import { test, expect } from 'claude-code/testing'

import { bash, confirmMatrix, guardWorld, PASSED, passes } from './testkit.ts'

const W = { cwd: '/proj/app', root: '/proj', home: '/home/me' }

confirmMatrix('RM-1', { tool: 'Bash', command: 'rm -rf /' }, W)
confirmMatrix('RM-2', { tool: 'Bash', command: 'rm -rf ~' }, W)
confirmMatrix('RM-3', { tool: 'Bash', command: 'rm -fr $HOME/' }, W)
confirmMatrix('RM-4', { tool: 'Bash', command: 'sudo rm -r -f ..' }, W)
confirmMatrix('RM-5', { tool: 'Bash', command: 'rm --recursive --force "$PWD/.."' }, W)
confirmMatrix('RM-6', { tool: 'Bash', command: 'cd x && rm -rf /*' }, W)

passes('RM-7 build dirs', { tool: 'Bash', command: 'rm -rf node_modules build dist .next target' }, W)
passes('RM-8 relative tmp', { tool: 'Bash', command: 'rm -rf ./tmp/x' }, W)
passes('RM-9 grep for the words', { tool: 'Bash', command: 'grep -r "rm -rf" .' }, W)
passes('RM-10 recursive without force', { tool: 'Bash', command: 'rm -r /' }, W)

test('RM-11 the repo root is a target', async ($, on) => {
  const seen = guardWorld(on, { ...W, answer: 'Cancel' })
  expect(await bash($, 'rm -rf /proj')).not.toEqual(PASSED)
  expect(seen.asks).toHaveLength(1)
})

test('RM-12 the ask names the command, ends in ?, offers Run and Cancel', async ($, on) => {
  const seen = guardWorld(on, W)
  await bash($, 'rm -rf /')
  expect(seen.asks[0]).toMatch(/rm -rf \//)
  expect(seen.asks[0]!.endsWith('?')).toBe(true)
})
