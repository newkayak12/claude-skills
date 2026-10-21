#!/usr/bin/env node
// portfolio:manage engine. Run from the workspace root; every subcommand prints one JSON object.
//   layout                         which workspace paths exist / are missing; touches nothing
//   snapshot --kind skeleton|deck --level major|minor|patch --note <text> [--by <who>] [--date YYYY-MM-DD]
//       copies the current file to snapshot/<kind>/<kind>-v<cur>/, bumps `version:` in skeleton.md,
//       adds the `v<new> 변경(...)` line under it and one row to snapshot/README.md
//   renumber --map "3:4,4:3" [--file skeleton.md] [--dry-run]
//       one pass over headings `## N`, `N쪽`, `N·M쪽`, `N~M쪽` and every `쪽` table column, then moves
//       the page sections into the new order and verifies; `vX.Y.Z 변경` lines are left as written
//   verify [--file skeleton.md]    heading numbers ascending; every page reference points at a heading
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const LAYOUT = ['skeleton.md', 'deck.mdx', 'template.pptx', 'deck.catalog.md', 'build', 'snapshot', 'sources', 'docs/확정사실.md']

export function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true
      else { out[a.slice(2)] = next; i++ }
    } else out._.push(a)
  }
  return out
}

const VERSION = /^version:[ \t]*v(\d+)\.(\d+)\.(\d+)[ \t]*$/m
const CHANGE_LINE = /^v\d+\.\d+\.\d+ 변경/

export function bump(v, level) {
  const [a, b, c] = v
  if (level === 'major') return [a + 1, 0, 0]
  if (level === 'minor') return [a, b + 1, 0]
  if (level === 'patch') return [a, b, c + 1]
  throw new Error(`level must be major|minor|patch, got ${level}`)
}

export function snapshot(root, { kind, level, note, by = '본인', date }) {
  if (kind !== 'skeleton' && kind !== 'deck') throw new Error('kind must be skeleton|deck')
  if (!note) throw new Error('--note is required')
  const skelPath = join(root, 'skeleton.md')
  const skel = readFileSync(skelPath, 'utf8')
  const m = skel.match(VERSION)
  if (!m) throw new Error('skeleton.md has no `version: vX.Y.Z` line')
  const cur = [Number(m[1]), Number(m[2]), Number(m[3])]
  const curS = `v${cur.join('.')}`
  const src = kind === 'skeleton' ? skelPath : join(root, 'deck.mdx')
  const dir = join(root, 'snapshot', kind, `${kind}-${curS}`)
  if (existsSync(dir)) throw new Error(`${dir} exists: snapshot of ${curS} already taken`)
  mkdirSync(dir, { recursive: true })
  copyFileSync(src, join(dir, kind === 'skeleton' ? 'skeleton.md' : 'deck.mdx'))
  if (kind === 'deck') return { kind, snapshot: dir, version: curS, bumped: false }

  const next = `v${bump(cur, level).join('.')}`
  const day = date || new Date().toISOString().slice(0, 10)
  const updated = skel.replace(VERSION, `version: ${next}\n${next} 변경(${day}, ${by} 결정): ${note}`)
  writeFileSync(skelPath, updated)
  const readme = join(root, 'snapshot', 'README.md')
  const head = '| 버전 | 날짜 | 장수 | 바뀐 것 |\n|---|---|---|---|\n'
  const body = existsSync(readme) ? readFileSync(readme, 'utf8') : `# 스냅샷\n\n${head}`
  const pages = headings(skel).length
  writeFileSync(readme, `${body.replace(/\n*$/, '\n')}| ${curS} | ${day} | ${pages} | → ${next}: ${note} |\n`)
  return { kind, snapshot: dir, from: curS, to: next, level, readme }
}

export function parseMap(s) {
  const map = new Map()
  for (const pair of String(s).split(',').map(x => x.trim()).filter(Boolean)) {
    const [a, b] = pair.split(':').map(Number)
    if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error(`bad map entry "${pair}"`)
    if (map.has(a)) throw new Error(`page ${a} mapped twice`)
    map.set(a, b)
  }
  const targets = [...map.values()]
  if (new Set(targets).size !== targets.length) throw new Error('two pages map to the same new number')
  return map
}

const HEADING = /^(##\s+)(\d+)(?=[.)\s])/
const REF = /(\d+)(?:([·~])(\d+))?쪽/g

export function headings(text) {
  return text.split('\n').map(l => l.match(HEADING)).filter(Boolean).map(m => Number(m[2]))
}

// Every number is looked up once against the original map, so a 3→4 and 4→3 swap cannot apply twice.
export function renumber(text, map) {
  const to = n => (map.has(n) ? map.get(n) : n)
  const warnings = []
  let changes = 0
  const swap = n => { const v = to(n); if (v !== n) changes++; return v }
  let pageCol = -1
  const lines = text.split('\n').map(line => {
    if (CHANGE_LINE.test(line)) return line
    const h = line.match(HEADING)
    if (h) { pageCol = -1; return line.replace(HEADING, (_, p, n) => `${p}${swap(Number(n))}`) }
    if (/^\s*\|/.test(line)) {
      const cells = line.split('|')
      if (cells.some(c => c.trim() === '쪽')) { pageCol = cells.findIndex(c => c.trim() === '쪽'); return line }
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) return line
      if (pageCol >= 0 && cells[pageCol] !== undefined) {
        cells[pageCol] = cells[pageCol].replace(/\d+/g, n => String(swap(Number(n))))
        return refs(cells.join('|'))
      }
      return refs(line)
    }
    pageCol = -1
    return refs(line)
  })
  function refs(line) {
    return line.replace(REF, (all, a, sep, b) => {
      if (!sep) return `${swap(Number(a))}쪽`
      if (sep === '·') return `${swap(Number(a))}·${swap(Number(b))}쪽`
      // a range maps as the set of its pages: kept as min~max when that set is still contiguous
      const lo = Number(a), hi = Number(b)
      const pages = []
      for (let n = lo; n <= hi; n++) pages.push(to(n))
      const min = Math.min(...pages), max = Math.max(...pages)
      if (max - min + 1 !== pages.length || new Set(pages).size !== pages.length) {
        warnings.push(`range ${all} is no longer contiguous: ${[...pages].sort((x, y) => x - y).join('·')}쪽`)
        return all
      }
      if (min !== lo || max !== hi) changes++
      return `${min}~${max}쪽`
    })
  }
  return { text: reorder(lines).join('\n'), changes, warnings }
}

// Moves each `## N` page section (heading up to the next `## ` line) so pages read in ascending order;
// sections without a number keep their place after the pages.
function reorder(lines) {
  const starts = lines.map((l, i) => (/^##\s/.test(l) ? i : -1)).filter(i => i >= 0)
  if (!starts.length) return lines
  const pre = lines.slice(0, starts[0])
  const sections = starts.map((s, k) => lines.slice(s, starts[k + 1] ?? lines.length))
  const num = sec => { const m = sec[0].match(HEADING); return m ? Number(m[2]) : null }
  const firstText = sections.findIndex(s => num(s) === null)
  const run = firstText < 0 ? sections : sections.slice(0, firstText)
  const rest = firstText < 0 ? [] : sections.slice(firstText)
  // a section's trailing blank lines stay at the boundary, not with the moved page
  const sorted = [...run].sort((x, y) => num(x) - num(y))
  const tail = run.length && run[run.length - 1].at(-1) === '' ? [''] : []
  const trimmed = sorted.map(s => { const c = [...s]; while (c.length > 1 && c.at(-1) === '') c.pop(); return c })
  return [...pre, ...trimmed.flat(), ...tail, ...rest.flat()]
}

export function verify(text) {
  const hs = headings(text)
  const problems = []
  for (let i = 1; i < hs.length; i++) if (hs[i] <= hs[i - 1]) problems.push(`heading ${hs[i]} after ${hs[i - 1]}`)
  const known = new Set(hs)
  for (const m of text.matchAll(REF)) {
    for (const n of [m[1], m[3]].filter(Boolean).map(Number)) if (!known.has(n)) problems.push(`${m[0]} points at no heading`)
  }
  return { headings: hs, problems }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0]
  const root = process.cwd()
  const file = join(root, args.file || 'skeleton.md')
  let out
  if (cmd === 'layout') {
    out = { present: LAYOUT.filter(p => existsSync(join(root, p))), missing: LAYOUT.filter(p => !existsSync(join(root, p))) }
  } else if (cmd === 'snapshot') {
    out = snapshot(root, { kind: args.kind, level: args.level, note: args.note, by: args.by, date: args.date })
  } else if (cmd === 'renumber') {
    const r = renumber(readFileSync(file, 'utf8'), parseMap(args.map))
    if (!args['dry-run']) writeFileSync(file, r.text)
    out = { file, changes: r.changes, warnings: r.warnings, written: !args['dry-run'], ...verify(r.text) }
  } else if (cmd === 'verify') {
    out = verify(readFileSync(file, 'utf8'))
  } else {
    throw new Error('usage: manage.mjs layout | snapshot | renumber | verify')
  }
  process.stdout.write(`${JSON.stringify(out)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { main() } catch (e) { process.stdout.write(`${JSON.stringify({ error: e.message })}\n`); process.exit(1) }
}
