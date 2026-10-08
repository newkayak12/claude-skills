import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { guardWorld, PASSED, ran } from './testkit.ts'
import type { GuardWorld } from './testkit.ts'

// Nobody can answer here: every rule passes, nothing is asked, run, logged or stored.
type Case = { call: Record<string, unknown>; proc?: GuardWorld['proc'] }

const CASES = {
  'recursive-delete': { call: { tool: 'Bash', command: 'rm -rf /' } },
  'force-push': {
    call: { tool: 'Bash', command: 'git push -f origin main' },
    proc: (argv: readonly string[]) => ran(argv.includes('--show-current') ? 'main\n' : ''),
  },
  'reset-clean': { call: { tool: 'Bash', command: 'git reset --hard' } },
  'secret-path': { call: { tool: 'Write', file_path: '/proj/.env', content: 'A=1' } },
  'running-script': { call: { tool: 'Edit', file_path: '/p/run.sh', old_string: 'a', new_string: 'b' }, proc: () => ran('4321\n') },
  'worktree-dirty-remove': {
    call: { tool: 'Bash', command: 'git worktree remove --force /wt/x' },
    proc: (argv: readonly string[]) => ran(argv.includes('status') ? ' M a.ts\n' : ''),
  },
} satisfies Record<string, Case>

const check = async ($: Engine, on: On, c: Case, bypass: boolean) => {
  const seen = guardWorld(on, { surfaces: [], proc: c.proc, bypass, answer: 'Cancel' })
  expect(await $.tool.call(c.call as never)).toEqual(PASSED)
  expect(seen.asks).toEqual([])
  expect(seen.procs).toEqual([])
  expect(seen.store.writes).toBe(0)
  expect(seen.toasts).toEqual([])
  expect(seen.statuses).toEqual([])
}

test('HL-recursive-delete', async ($, on) => check($, on, CASES['recursive-delete'], false))
test('HL-force-push', async ($, on) => check($, on, CASES['force-push'], false))
test('HL-reset-clean', async ($, on) => check($, on, CASES['reset-clean'], false))
test('HL-secret-path', async ($, on) => check($, on, CASES['secret-path'], false))
test('HL-running-script', async ($, on) => check($, on, CASES['running-script'], false))
test('HL-worktree-dirty-remove', async ($, on) => check($, on, CASES['worktree-dirty-remove'], false))

for (const [id, c] of Object.entries(CASES)) {
  test(`HL-${id} bypass`, async ($, on) => check($, on, c, true))
}

// deny mode must not turn headless into a stall either: the options are per test, so one test per rule
test('HL-recursive-delete guard_mode=deny', { options: { guard_mode: 'deny' } }, async ($, on) => check($, on, CASES['recursive-delete'], false))
test('HL-force-push guard_mode=deny', { options: { guard_mode: 'deny' } }, async ($, on) => check($, on, CASES['force-push'], false))
test('HL-reset-clean guard_mode=deny', { options: { guard_mode: 'deny' } }, async ($, on) => check($, on, CASES['reset-clean'], false))
test('HL-secret-path guard_mode=deny', { options: { guard_mode: 'deny' } }, async ($, on) => check($, on, CASES['secret-path'], false))
test('HL-running-script guard_mode=deny', { options: { guard_mode: 'deny' } }, async ($, on) => check($, on, CASES['running-script'], false))
test('HL-worktree-dirty-remove guard_mode=deny', { options: { guard_mode: 'deny' } }, async ($, on) => check($, on, CASES['worktree-dirty-remove'], false))
