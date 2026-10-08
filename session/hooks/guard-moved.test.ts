import { test, expect } from 'claude-code/testing'

import { bash, denial, guardWorld, PASSED, ran } from './testkit.ts'

const edit = ($: any, tool: 'Edit' | 'Write', file_path: string) =>
  $.tool.call({ tool, file_path, ...(tool === 'Edit' ? { old_string: 'a', new_string: 'b' } : { content: 'x' }) } as never)

const running = (argv: readonly string[]) => (argv[0] === 'pgrep' ? ran('4321\n') : ran(''))
const dirty = (argv: readonly string[]) => (argv.includes('status') ? ran(' M a.ts\n') : ran(''))

// ---- running-script (ported from the old plugin's .sh guard) ----
for (const tool of ['Edit', 'Write'] as const) {
  test(`.sh guard (${tool}): pgrep hit denies and names the pid`, async ($, on) => {
    const seen = guardWorld(on, { proc: running })
    const r = await edit($, tool, '/p/run.sh')
    expect(denial(r)).toMatch(/4321/)
    expect(denial(r)).toMatch(/Copy it and edit the copy/)
    expect(seen.procs.some(a => a[0] === 'pgrep' && a.includes('/p/run.sh'))).toBe(true)
  })
}

test('.sh guard: pgrep exit 1 passes', async ($, on) => {
  guardWorld(on, { proc: () => ran('', 1) })
  expect(await edit($, 'Edit', '/p/run.sh')).toEqual(PASSED)
})

test('.sh guard: pgrep throwing passes (fail open)', async ($, on) => {
  guardWorld(on, {
    proc: () => {
      throw new Error('no pgrep')
    },
  })
  expect(await edit($, 'Edit', '/p/run.sh')).toEqual(PASSED)
})

test('.sh guard: a non-script is not checked', async ($, on) => {
  const seen = guardWorld(on, { proc: running })
  expect(await edit($, 'Write', '/p/notes.md')).toEqual(PASSED)
  expect(seen.procs).toHaveLength(0)
})

test('.sh guard: a .bash script is checked too', async ($, on) => {
  guardWorld(on, { proc: running })
  expect(denial(await edit($, 'Edit', '/p/run.bash'))).toMatch(/4321/)
})

// ---- worktree-dirty-remove (ported from the old plugin's worktree guard) ----
test('worktree guard: --force with a dirty tree denies and names the dirty files', async ($, on) => {
  guardWorld(on, { proc: dirty })
  const r = denial(await bash($, 'git worktree remove --force /wt/x'))
  expect(r).toMatch(/uncommitted changes/)
  expect(r).toMatch(/M a\.ts/)
  expect(r).toMatch(/Commit/)
})

test('worktree guard: --force with a clean tree passes', async ($, on) => {
  guardWorld(on, { proc: () => ran('') })
  expect(await bash($, 'git worktree remove --force /wt/x')).toEqual(PASSED)
})

test('worktree guard: no --force runs no status', async ($, on) => {
  const seen = guardWorld(on, { proc: () => ran(' M a.ts\n') })
  expect(await bash($, 'git worktree remove /wt/x')).toEqual(PASSED)
  expect(seen.procs).toHaveLength(0)
})

test('worktree guard: a failing status (path gone) passes', async ($, on) => {
  guardWorld(on, { proc: () => ran('', 128) })
  expect(await bash($, 'git worktree remove --force /wt/gone')).toEqual(PASSED)
})

test('worktree guard: -C <dir> resolves a relative target against it', async ($, on) => {
  const seen = guardWorld(on, { proc: dirty })
  const r = await bash($, 'git -C /x worktree remove --force ../y/w')
  expect(denial(r)).toMatch(/\/y\/w/)
  expect(seen.procs.some(a => a.includes('-C') && a.includes('/y/w'))).toBe(true)
})

test('worktree guard: -f is --force', async ($, on) => {
  guardWorld(on, { proc: dirty })
  expect(denial(await bash($, 'git worktree remove -f /wt/x'))).toMatch(/uncommitted/)
})

// ---- the mode matrix: deny-class never asks ----
test('running-script under guard_mode=confirm is denied, no ask', { options: { guard_mode: 'confirm' } }, async ($, on) => {
  const seen = guardWorld(on, { proc: running })
  expect(denial(await edit($, 'Edit', '/p/run.sh'))).toMatch(/4321/)
  expect(seen.asks).toEqual([])
})

test('running-script under guard_mode=deny is denied', { options: { guard_mode: 'deny' } }, async ($, on) => {
  guardWorld(on, { proc: running })
  expect(denial(await edit($, 'Write', '/p/run.sh'))).toMatch(/4321/)
})

test('running-script under guard_mode=off passes', { options: { guard_mode: 'off' } }, async ($, on) => {
  guardWorld(on, { proc: running })
  expect(await edit($, 'Edit', '/p/run.sh')).toEqual(PASSED)
})

test('worktree-dirty-remove under guard_mode=confirm is denied, no ask', { options: { guard_mode: 'confirm' } }, async ($, on) => {
  const seen = guardWorld(on, { proc: dirty })
  expect(denial(await bash($, 'git worktree remove --force /wt/x'))).toMatch(/uncommitted/)
  expect(seen.asks).toEqual([])
})

test('worktree-dirty-remove under guard_mode=deny is denied', { options: { guard_mode: 'deny' } }, async ($, on) => {
  guardWorld(on, { proc: dirty })
  expect(denial(await bash($, 'git worktree remove --force /wt/x'))).toMatch(/uncommitted/)
})

test('worktree-dirty-remove under guard_mode=off passes', { options: { guard_mode: 'off' } }, async ($, on) => {
  guardWorld(on, { proc: dirty })
  expect(await bash($, 'git worktree remove --force /wt/x')).toEqual(PASSED)
})
