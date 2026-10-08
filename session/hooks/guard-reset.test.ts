import { test, expect } from 'claude-code/testing'

import { bash, guardWorld, PASSED, confirmMatrix, passes } from './testkit.ts'

confirmMatrix('RS-1', { tool: 'Bash', command: 'git reset --hard' })
confirmMatrix('RS-2', { tool: 'Bash', command: 'git reset --hard HEAD~3' })
confirmMatrix('RS-3', { tool: 'Bash', command: 'git -C x reset --hard origin/main && make' })
confirmMatrix('RS-4', { tool: 'Bash', command: 'git clean -fdx' })

passes('RS-5 soft', { tool: 'Bash', command: 'git reset --soft HEAD~1' })
passes('RS-6 mixed', { tool: 'Bash', command: 'git reset --mixed' })
passes('RS-7 unstage', { tool: 'Bash', command: 'git reset HEAD file' })
passes('RS-8 dry run', { tool: 'Bash', command: 'git clean -n' })
passes('RS-9 files only', { tool: 'Bash', command: 'git clean -f' })
passes('RS-10 echo', { tool: 'Bash', command: 'echo "git reset --hard"' })
passes('RS-11 commit message', { tool: 'Bash', command: 'git commit -m "reset --hard"' })
passes('RS-12 heredoc body', { tool: 'Bash', command: "cat <<'EOF'\ngit reset --hard\nEOF" })
passes('RS-13 force dry run', { tool: 'Bash', command: 'git clean -fdn' })

test('RS-14 the ask says what is lost', async ($, on) => {
  const seen = guardWorld(on, { answer: 'Cancel' })
  expect(await bash($, 'git reset --hard')).not.toEqual(PASSED)
  expect(seen.asks[0]).toMatch(/git reset --hard/)
})
