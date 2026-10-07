// Prints the open harness fallback runs of every worktree of the repo at argv[2] as JSON.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2]
let trees = [root]
try {
  trees = execFileSync('git', ['-C', root, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' })
    .split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9))
} catch {}

// A run untouched for 12 h is abandoned, not open.
const STALE_MS = 12 * 60 * 60 * 1000
const newest = dir => {
  let t = 0
  for (const f of readdirSync(dir, { recursive: true })) {
    try { t = Math.max(t, statSync(join(dir, String(f))).mtimeMs) } catch {}
  }
  return t
}

const json = p => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
const runs = []
for (const tree of trees) {
  const base = join(tree, '.harness-run')
  if (!existsSync(base)) continue
  for (const slug of readdirSync(base)) {
    const dir = join(base, slug)
    if (slug === 'broker' || !existsSync(join(dir, 'manifest.json')) || existsSync(join(dir, '05-report.md'))) continue
    if (Date.now() - newest(dir) > STALE_MS) continue
    const spec = json(join(dir, '02-goal-spec.json'))
    const crit = json(join(dir, '02-critique.json'))
    const ids = (spec?.subgoals ?? []).map(s => s.id)
    let passed = 0, failed = 0
    for (const id of ids) {
      const r = json(join(dir, 'subgoals', id, 'result.json'))
      if (r?.passed === true) passed++
      else if (r?.passed === false) failed++
    }
    const stage = !existsSync(join(dir, '01-plan.md')) ? 'plan'
      : !spec ? 'setgoal'
      : crit?.sound !== true ? 'critique'
      : passed + failed < ids.length ? 'implement'
      : !existsSync(join(dir, '04-goal-gate.json')) ? 'goal-gate'
      : 'report'
    runs.push({ dir, slug, stage, passed, failed, total: ids.length })
  }
}
process.stdout.write(JSON.stringify(runs))
