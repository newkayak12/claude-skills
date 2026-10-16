#!/usr/bin/env node
// Report-only skeleton check. Usage: node _repo/scripts/check-skeleton.mjs [root]  (any cwd)
// Scans <root>/<plugin>/skills/<name>/SKILL.md and lists, per skill, the missing sections
// (Process, Output Template, What Claude Does / What You Do, Related Skills) and its line count
// when over 200. A section is present when a `## ` heading outside a ``` / ~~~ fence starts with
// its exact, case-sensitive name.
// Frozen (listed apart, per skill.md "teams-mounted skills stay frozen"): every <root>/teams/skills/*
// plus the skills named by <root>/teams/mcp/{graph,mounts,stagecontract}.mjs.
// Always exits 0: a bad root or unreadable mounts only print a warning on stderr.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SECTIONS = [
  ['Process', ['Process']],
  ['Output Template', ['Output Template']],
  ['What Claude Does', ['What Claude Does', 'What You Do']],
  ['Related Skills', ['Related Skills']],
]
const MAX_LINES = 200

const dirs = (d) =>
  existsSync(d) ? readdirSync(d).filter((n) => !n.startsWith('.') && statSync(join(d, n)).isDirectory()) : []

function inspect(file) {
  const text = readFileSync(file, 'utf8')
  const lines = (text.match(/\n/g) || []).length + (text && !text.endsWith('\n') ? 1 : 0)
  const headings = []
  let fence = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    else if (!fence && line.startsWith('## ')) headings.push(line.slice(3))
  }
  const missing = SECTIONS.filter(([, names]) => !headings.some((h) => names.some((n) => h.startsWith(n)))).map(
    ([label]) => label,
  )
  return { missing, lines }
}

export function scan(root, frozen) {
  const out = { active: [], frozen: [] }
  for (const plugin of dirs(root)) {
    if (plugin === '_repo' || plugin === 'node_modules') continue
    for (const name of dirs(join(root, plugin, 'skills'))) {
      const file = join(root, plugin, 'skills', name, 'SKILL.md')
      if (!existsSync(file)) continue
      const id = `${plugin}:${name}`
      const { missing, lines } = inspect(file)
      if (missing.length || lines > MAX_LINES) out[frozen.has(id) ? 'frozen' : 'active'].push({ id, missing, lines })
    }
  }
  return out
}

export async function engineMounts(root) {
  const mounts = new Set()
  try {
    const load = (f) => import(pathToFileURL(join(root, 'teams', 'mcp', f)).href)
    const { KINDS } = await load('graph.mjs')
    const { GRAPH_STAGE_SKILLS } = await load('mounts.mjs')
    const { STAGE_SKILLS } = await load('stagecontract.mjs')
    for (const def of Object.values(KINDS)) for (const list of Object.values(def.skills || {})) list.forEach((s) => mounts.add(s))
    for (const list of Object.values(GRAPH_STAGE_SKILLS)) (list || []).forEach((s) => mounts.add(s))
    for (const list of Object.values(STAGE_SKILLS)) (list || []).forEach((s) => mounts.add(s))
    return { mounts, warning: null }
  } catch (e) {
    return { mounts: new Set(), warning: `warning: teams mounts unreadable (${e.message}); frozen = teams/skills/* only` }
  }
}

const show = ({ id, missing, lines }) =>
  [id, missing.length ? `missing: ${missing.join(', ')}` : '', lines > MAX_LINES ? `lines: ${lines}` : '']
    .filter(Boolean)
    .join('  ')

function print(title, items) {
  console.log(`${title} (${items.length})`)
  for (const i of items) console.log(`  ${show(i)}`)
  const counts = SECTIONS.map(([l]) => `${l} ${items.filter((i) => i.missing.includes(l)).length}`)
  console.log(`  missing: ${counts.join(', ')}; over ${MAX_LINES} lines: ${items.filter((i) => i.lines > MAX_LINES).length}`)
}

async function main() {
  const arg = process.argv[2]
  const root = arg ? resolve(arg) : join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`warning: root not found: ${root}`)
    return
  }
  const { mounts, warning } = await engineMounts(root)
  if (warning) console.error(warning)
  for (const name of dirs(join(root, 'teams', 'skills'))) mounts.add(`teams:${name}`)
  const { active, frozen } = scan(root, mounts)
  print('skeleton problems', active)
  print('frozen (teams-mounted, do not pull)', frozen)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
