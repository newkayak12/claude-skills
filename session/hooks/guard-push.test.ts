import { test, expect } from 'claude-code/testing'

import { bash, confirmMatrix, guardWorld, PASSED, passes, ran } from './testkit.ts'

// current branch, remote default, git helper failures
const git = (branch: string, head = 'refs/remotes/origin/main') => (argv: readonly string[]) => {
  if (argv.includes('--show-current')) return ran(`${branch}\n`)
  if (argv.includes('symbolic-ref')) return ran(`${head}\n`)
  return ran('')
}
const W = { proc: git('feature') }

confirmMatrix('FP-1', { tool: 'Bash', command: 'git push -f origin main' }, W)
confirmMatrix('FP-2', { tool: 'Bash', command: 'git push --force-with-lease origin HEAD:master' }, W)
confirmMatrix('FP-3', { tool: 'Bash', command: 'git push origin +main' }, W)
confirmMatrix('FP-4', { tool: 'Bash', command: 'git push -f' }, { proc: git('main') })
confirmMatrix('FP-5', { tool: 'Bash', command: 'git -C ../r push --force origin trunk' }, W)

test('FP-6 an extra protected branch from config', { options: { guard_extra_protected_branches: 'release, stable' } }, async ($, on) => {
  const seen = guardWorld(on, { ...W, answer: 'Cancel' })
  expect(await bash($, 'git push -f origin release')).not.toEqual(PASSED)
  expect(seen.asks).toHaveLength(1)
})

test('FP-7 the remote default branch is protected', async ($, on) => {
  const seen = guardWorld(on, { proc: git('feature', 'refs/remotes/origin/develop'), answer: 'Cancel' })
  expect(await bash($, 'git push -f origin develop')).not.toEqual(PASSED)
  expect(seen.asks).toHaveLength(1)
})

passes('FP-8 plain push', { tool: 'Bash', command: 'git push' }, W)
passes('FP-9 non-force refspec', { tool: 'Bash', command: 'git push origin feature:feature' }, W)
passes('FP-10 force on a feature branch', { tool: 'Bash', command: 'git push --force origin feature' }, W)
passes('FP-11 bare force on a feature branch', { tool: 'Bash', command: 'git push -f' }, W)
passes('FP-12 helper git failure', { tool: 'Bash', command: 'git push -f' }, { proc: () => ran('', 128) })
passes('FP-13 push with -u', { tool: 'Bash', command: 'git push -u origin main' }, W)
