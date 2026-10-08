import { test, expect } from 'claude-code/testing'

import { guardWorld, PASSED, ran } from './testkit.ts'
import type { GuardWorld } from './testkit.ts'

// The release gate: calls that look dangerous to a careless matcher and are not. Each runs through the real
// register in default, bypass and headless; the value of next(e) comes back unchanged, nothing is asked or stored.
type Call = { tool: string } & Record<string, unknown>
const sh = (command: string): Call => ({ tool: 'Bash', command })
const feature = (argv: readonly string[]) => ran(argv.includes('--show-current') ? 'feature\n' : '')

const fp = (name: string, calls: Call[], proc?: GuardWorld['proc']) =>
  test(name, async ($, on) => {
    const w: GuardWorld = { proc, bypass: false, answer: 'Cancel', cwd: '/proj/app', root: '/proj', home: '/home/me' }
    const seen = guardWorld(on, w)
    for (const phase of ['default', 'bypass', 'headless'] as const) {
      w.bypass = phase === 'bypass'
      w.surfaces = phase === 'headless' ? [] : ['terminal']
      for (const c of calls) expect(await $.tool.call(c as never), `${phase}: ${JSON.stringify(c)}`).toEqual(PASSED)
    }
    expect(seen.asks).toEqual([])
    expect(seen.store.writes).toBe(0)
  })

fp('FP-1: rm -rf of build directories', [sh('rm -rf node_modules build dist .next target')])
fp('FP-2: rm -rf of a relative tmp path', [sh('rm -rf ./tmp/x')])
fp('FP-3: plain git push', [sh('git push')], feature)
fp('FP-4: git push --force on a feature branch', [sh('git push --force origin feature'), sh('git push -f')], feature)
fp('FP-5: git push origin feature:feature', [sh('git push origin feature:feature')], feature)
fp('FP-6: git reset --soft and --mixed', [sh('git reset --soft HEAD~1'), sh('git reset --mixed HEAD~2')])
fp('FP-7: git reset --hard as text: heredoc body, echo, grep, commit message', [
  sh("cat <<'EOF'\ngit reset --hard\nEOF"),
  sh('echo "git reset --hard"'),
  sh('grep -rn "git reset --hard" docs'),
  sh('git commit -m "docs: explain git reset --hard"'),
])
fp('FP-8: a heredoc into notes.md whose body names .env and a delete', [
  sh("cat > notes.md <<'EOF'\ncopy secrets into .env\nrm -rf ~\nEOF"),
])
fp('FP-9: Write of .env.example', [{ tool: 'Write', file_path: '/proj/.env.example', content: 'A=' }])
fp('FP-10: Edit of docs/env.md', [{ tool: 'Edit', file_path: '/proj/docs/env.md', old_string: 'a', new_string: 'b' }])
fp('FP-11: Read of .env', [{ tool: 'Read', file_path: '/proj/.env' }])
fp('FP-12: grep -r "rm -rf" .', [sh('grep -r "rm -rf" .')])
fp('FP-13: ps and pgrep -f deploy.sh', [sh('ps aux'), sh('pgrep -f deploy.sh')])
fp('FP-14: a markdown file with a private key header in a fenced example', [
  { tool: 'Write', file_path: '/proj/docs/keys.md', content: '```\n-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n```' },
])
fp('FP-15: an unparseable command passes', [sh('rm -rf "$(')])
fp('FP-16: rm -rf with an unknown variable', [sh('rm -rf "$VAR/"')])
