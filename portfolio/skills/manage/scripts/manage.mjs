#!/usr/bin/env node
// portfolio:manage engine. Run from the workspace root; every subcommand prints one JSON object.
//   layout                         which workspace paths exist / are missing; touches nothing
//   snapshot --kind skeleton|deck --level major|minor|patch --note <text> [--by <who>] [--date YYYY-MM-DD]
//       copies the current file to snapshot/<kind>/<kind>-v<cur>/, bumps `version:` in skeleton.md,
//       adds the `v<new> 변경(...)` line under it and one row to snapshot/README.md
//   renumber --map "3:4,4:3" [--file skeleton.md] [--dry-run]
//       one pass over headings `## N`, `N쪽`, `N·M쪽`, `N~M쪽` and every `쪽` table column, then moves
//       the page sections into the new order and verifies; history lines (`vX.Y.Z 변경`, `vX.Y.Z(`,
//       and the same quoted with `>`) are left as written
//   verify [--file skeleton.md]    heading numbers ascending; every page reference points at a heading
// A page heading is `## N`, `## N.`, `## N)` or `## N쪽`. A `# ` chapter heading bounds a block: pages
// sort inside their block, and blocks holding pages sort by their first page; other sections stay put.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const LAYOUT = ['skeleton.md', 'deck.mdx', 'template.pptx', 'deck.catalog.md', 'build', 'snapshot', 'sources', 'docs/확정사실.md']

// The template is where deck.mdx's front matter `template:` says, else the root template.pptx.
export function layout(root) {
  let template = 'template.pptx'
  try {
    const m = readFileSync(join(root, 'deck.mdx'), 'utf8').match(/^template:[ \t]*["']?([^"'\n]+?)["']?[ \t]*$/m)
    if (m) template = m[1]
  } catch { /* no deck.mdx: it is listed missing */ }
  const paths = LAYOUT.map(p => (p === 'template.pptx' ? template : p))
  // a Korean name copied from macOS (zip, rsync) is stored decomposed (NFD); look for both forms
  const has = p => existsSync(join(root, p.normalize('NFC'))) || existsSync(join(root, p.normalize('NFD')))
  return { present: paths.filter(has), missing: paths.filter(p => !has(p)) }
}

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
const CHANGE_LINE = /^\s*(?:>\s*)?v\d+\.\d+\.\d+(?:\s*변경|\s*\()/

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
  // the history line follows the file's own form: quoted `> vX.Y.Z(날짜, 누가): …` when it already uses it
  const quoted = /^>\s*v\d+\.\d+\.\d+\(/m.test(skel)
  const line = quoted ? `> ${next}(${day}, ${by} 결정): ${note}` : `${next} 변경(${day}, ${by} 결정): ${note}`
  const updated = skel.replace(VERSION, `version: ${next}\n${line}`)
  writeFileSync(skelPath, updated)
  const readme = join(root, 'snapshot', 'README.md')
  const head = '| 버전 | 날짜 | 장수 | 바뀐 것 |\n|---|---|---|---|\n'
  const body = existsSync(readme) ? readFileSync(readme, 'utf8') : `# 스냅샷\n\n${head}`
  writeFileSync(readme, readmeRow(body, { cur: curS, next, day, pages: pageCount(skel), note }))
  return { kind, snapshot: dir, from: curS, to: next, level, readme }
}

// The page count the skeleton states in its head (`28장`), else the number of page headings.
export function pageCount(skel) {
  const m = skel.split('\n').slice(0, 15).join('\n').match(/(\d+)\s*장/)
  return m ? Number(m[1]) : headings(skel).length
}

// One row for the snapshot table: into the table under a `## skeleton` heading when there is one,
// cells filled by that table's column names; else appended at the end of the file.
export function readmeRow(body, { cur, next, day, pages, note }) {
  const lines = body.split('\n')
  const sec = lines.findIndex(l => /^##\s+skeleton\b/i.test(l))
  if (sec >= 0) {
    let h = sec + 1
    while (h < lines.length && !/^\s*\|/.test(lines[h]) && !/^#/.test(lines[h])) h++
    if (h < lines.length && /^\s*\|/.test(lines[h])) {
      let end = h
      while (end + 1 < lines.length && /^\s*\|/.test(lines[end + 1])) end++
      const cols = lines[h].split('|').slice(1, -1).map(c => c.trim())
      const tick = end > h + 1 && lines[h + 2].includes('`')
      const cell = c => (/버전/.test(c) ? (tick ? `\`skeleton-${cur}\`` : cur) : /날짜/.test(c) ? day : /장수/.test(c) ? String(pages)
        : /바뀐|한 줄|메모|내용/.test(c) ? `→ ${next}: ${note}` : '')
      // newest first when the table already reads that way (its first row is the higher version)
      const ver = l => (l || '').match(/v(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number)
      const [a, b] = [ver(lines[h + 2]), ver(lines[h + 3])]
      const newestFirst = a && b && (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) > 0
      lines.splice(newestFirst ? h + 2 : end + 1, 0, `| ${cols.map(cell).join(' | ')} |`)
      return lines.join('\n')
    }
  }
  return `${body.replace(/\n*$/, '\n')}| ${cur} | ${day} | ${pages} | → ${next}: ${note} |\n`
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

const HEADING = /^(##\s+)(\d+)(?=쪽|[.)\s])/
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
    if (h) {
      // the heading's own number (and its `쪽`) is swapped once; references later in its text are swapped as refs
      pageCol = -1
      const own = h[0].length + (line.slice(h[0].length).startsWith('쪽') ? 1 : 0)
      return `${h[1]}${swap(Number(h[2]))}${line.slice(h[0].length, own)}${refs(line.slice(own))}`
    }
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

const H1 = /^#\s/
const pageOf = sec => { const m = sec[0].match(HEADING); return m ? Number(m[2]) : null }
const blankTail = sec => { let n = 0; while (n < sec.length - 1 && sec[sec.length - 1 - n] === '') n++; return n }

// Sorts the items whose key is not null into ascending key order, in the slots those items held;
// each slot keeps its own trailing blank lines, so blank-line rhythm does not move with an item.
function slotSort(items, key) {
  const slots = items.map((it, i) => (key(it) === null ? -1 : i)).filter(i => i >= 0)
  const sorted = slots.map(i => items[i]).sort((x, y) => key(x) - key(y))
  const out = [...items]
  slots.forEach((slot, k) => {
    const c = [...sorted[k]]
    while (c.length > 1 && c.at(-1) === '') c.pop()
    out[slot] = [...c, ...Array(blankTail(items[slot])).fill('')]
  })
  return out
}

// Pages sort inside each `# ` block in the slots pages held (unnumbered `##` sections keep their
// place); then blocks that hold pages sort by their first page, in the slots such blocks held.
function reorder(lines) {
  const h1s = lines.map((l, i) => (H1.test(l) ? i : -1)).filter(i => i >= 0)
  const cuts = [0, ...h1s.filter(i => i > 0)]
  const blocks = cuts.map((c, k) => lines.slice(c, cuts[k + 1] ?? lines.length)).map(block => {
    const starts = block.map((l, i) => (/^##\s/.test(l) ? i : -1)).filter(i => i >= 0)
    if (!starts.length) return { lines: block, first: null }
    const head = block.slice(0, starts[0])
    const secs = slotSort(starts.map((s, k) => block.slice(s, starts[k + 1] ?? block.length)), pageOf)
    const pages = secs.map(pageOf).filter(n => n !== null)
    return { lines: [...head, ...secs.flat()], first: pages.length ? Math.min(...pages) : null }
  })
  const movable = b => (H1.test(b.lines[0] || '') ? b.first : null)
  return slotSort(blocks.map(b => Object.assign(b.lines, { first: movable(b) })), b => b.first).flat()
}

export function verify(text) {
  const hs = headings(text)
  const problems = []
  for (let i = 1; i < hs.length; i++) if (hs[i] <= hs[i - 1]) problems.push(`heading ${hs[i]} after ${hs[i - 1]}`)
  const known = new Set(hs)
  const live = text.split('\n').filter(l => !CHANGE_LINE.test(l)).join('\n')
  for (const m of live.matchAll(REF)) {
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
    out = layout(root)
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
