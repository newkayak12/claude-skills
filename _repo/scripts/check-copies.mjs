#!/usr/bin/env node
// Drift check for hand-maintained copies. Usage: node _repo/scripts/check-copies.mjs  (any cwd)
// 1. Byte-identical groups: every top-level */hooks/ensure-trophy.sh (globbed, _repo excluded),
//    harness/hooks vs graph/hooks draw.tsx and draw.test.ts,
//    teams/mcp/diagram.mjs vs develop/skills/architecture-designer/scripts/diagram.mjs.
// 2. Plan-prompt plugin list: the "(plugins: …)" list in harness/engine/pipeline.js must equal the
//    marketplace plugins that ship at least one skills/**/SKILL.md, minus harness, graph, teams, trophy.
// Exit 1 on any drift, naming each drifted group.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EXCLUDE = new Set(['harness', 'graph', 'teams', 'trophy'])

const plugins = readdirSync(root).filter(
  (n) => !n.startsWith('.') && n !== '_repo' && n !== 'node_modules' && statSync(join(root, n)).isDirectory(),
)
const groups = [
  plugins.map((p) => `${p}/hooks/ensure-trophy.sh`).filter((f) => existsSync(join(root, f))),
  ['harness/hooks/draw.tsx', 'graph/hooks/draw.tsx'],
  ['harness/hooks/draw.test.ts', 'graph/hooks/draw.test.ts'],
  ['teams/mcp/diagram.mjs', 'develop/skills/architecture-designer/scripts/diagram.mjs'],
]

const problems = []
for (const files of groups) {
  const bodies = files.map((f) => (existsSync(join(root, f)) ? readFileSync(join(root, f)) : null))
  const missing = files.filter((_, i) => !bodies[i])
  if (missing.length) problems.push(`missing: ${missing.join(', ')}`)
  const present = bodies.filter(Boolean)
  if (present.some((b) => !b.equals(present[0]))) problems.push(`drift: ${files.join(' = ')}`)
}

const hasSkill = (dir) =>
  existsSync(dir) &&
  readdirSync(dir).some((n) => n === 'SKILL.md' || (statSync(join(dir, n)).isDirectory() && hasSkill(join(dir, n))))
const market = JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'))
const want = market.plugins
  .map((p) => p.name)
  .filter((n) => !EXCLUDE.has(n) && hasSkill(join(root, n, 'skills')))
  .sort()
const src = readFileSync(join(root, 'harness/engine/pipeline.js'), 'utf8')
const i = src.indexOf('(plugins:')
if (i < 0) {
  problems.push('harness/engine/pipeline.js: no "(plugins:" list')
} else {
  const got = [...src.slice(i, src.indexOf(')', i)).matchAll(/([a-z-]+):\*/g)].map((m) => m[1]).sort()
  if (got.join() !== want.join()) {
    problems.push(`drift: harness/engine/pipeline.js plugins\n  got:  ${got.join(', ')}\n  want: ${want.join(', ')}`)
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log('ok: copies and plugin list agree')
