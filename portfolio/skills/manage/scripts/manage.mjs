#!/usr/bin/env node
// portfolio:manage engine. Run from the workspace root; every subcommand prints one JSON object.
//   layout                         which workspace paths exist / are missing; touches nothing
//   snapshot --kind skeleton|deck --level major|minor|patch --note <text> [--by <who>] [--date YYYY-MM-DD]
//       skeleton: copies it to snapshot/skeleton/skeleton-v<cur>/, bumps `version:`, adds the history
//       line under it and one row to snapshot/README.md; deck: its own count (newest deck-v* + level),
//       deck.mdx + assets/ + NOTES.md into snapshot/deck/deck-v<new>/, one row in the `## deck` table
//   renumber --map "3:4,4:3" [--file skeleton.md] [--dry-run] [--force]
//       (written only when verify finds no problem, or with --force; fenced code is left alone;
//       a target page the map leaves in place is refused)
//       one pass over headings `## N`, `N쪽`, `N·M쪽`, `N~M쪽` and every `쪽` table column, then moves
//       the page sections into the new order and verifies; history lines (`vX.Y.Z 변경`, `vX.Y.Z(`,
//       and the same quoted with `>`) are left as written
//   verify [--file skeleton.md]    heading numbers ascending; every page reference points at a heading
//   compare --before <scores.json> --after <scores.json>
//       per-item change between two `{ "<item>": <score> }` files scored with the same rubric;
//       names every item that dropped and the verdict (better | worse | mixed | same);
//       with --claims-before/--claims-after (two `claims` outputs) a claim that lost its ground makes it worse
//   claims [--file skeleton.md]
//       each page's figures and reason sentences against the material its `글감:` line cites:
//       problems (uncited, unknown_id, not_in_material, unsupported = `근거 없음`, to_confirm = a reason
//       the items do not say), listed (본인 확인, user-stated, tone phrases), unused_results (figures in
//       cited items no page carries), uncited_items, settled (확정사실.md `## 서술 기준`/`## 구조` lines)
// A page heading is `## N`, `## N.`, `## N)` or `## N쪽`. A `# ` chapter heading bounds a block: pages
// sort inside their block, and blocks holding pages sort by their first page; other sections stay put.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  const day = date || new Date().toISOString().slice(0, 10)
  const readme = join(root, 'snapshot', 'README.md')
  if (kind === 'deck') return deckSnapshot(root, { level, note, day, skelS: curS, readme })
  const dir = join(root, 'snapshot', kind, `${kind}-${curS}`)
  if (existsSync(dir)) throw new Error(`${dir} exists: snapshot of ${curS} already taken`)
  mkdirSync(dir, { recursive: true })
  copyFileSync(skelPath, join(dir, 'skeleton.md'))

  const next = `v${bump(cur, level).join('.')}`
  // the history line follows the file's own form: quoted `> vX.Y.Z(날짜, 누가): …` when it already uses it
  const quoted = /^>\s*v\d+\.\d+\.\d+\(/m.test(skel)
  const line = quoted ? `> ${next}(${day}, ${by} 결정): ${note}` : `${next} 변경(${day}, ${by} 결정): ${note}`
  const updated = skel.replace(VERSION, `version: ${next}\n${line}`)
  writeFileSync(skelPath, updated)
  const head = '| 버전 | 날짜 | 장수 | 바뀐 것 |\n|---|---|---|---|\n'
  const body = existsSync(readme) ? readFileSync(readme, 'utf8') : `# 스냅샷\n\n${head}`
  writeFileSync(readme, readmeRow(body, { cur: curS, next, day, pages: pageCount(skel), note }))
  return { kind, snapshot: dir, from: curS, to: next, level, readme }
}

// The deck counts its own versions, apart from skeleton: the next one after the newest
// snapshot/deck/deck-vX.Y.Z (v1.0.0 when there is none). The folder holds that version: deck.mdx,
// assets/ when there is one, and a NOTES.md with the note; the row goes into README's `## deck` table.
function deckSnapshot(root, { level, note, day, skelS, readme }) {
  const base = join(root, 'snapshot', 'deck')
  let names = []
  try { names = readdirSync(base) } catch { /* first deck snapshot */ }
  const vers = names.map(n => n.match(/^deck-v(\d+)\.(\d+)\.(\d+)$/)).filter(Boolean).map(m => m.slice(1).map(Number))
  const newest = vers.sort((x, y) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2])[0]
  const next = `v${(newest ? bump(newest, level) : [1, 0, 0]).join('.')}`
  const dir = join(base, `deck-${next}`)
  mkdirSync(dir, { recursive: true })
  copyFileSync(join(root, 'deck.mdx'), join(dir, 'deck.mdx'))
  if (existsSync(join(root, 'assets'))) cpSync(join(root, 'assets'), join(dir, 'assets'), { recursive: true })
  writeFileSync(join(dir, 'NOTES.md'), `# deck-${next}\n\n${day}. skeleton ${skelS} 반영. ${note}\n`)
  if (existsSync(readme)) writeFileSync(readme, readmeRow(readFileSync(readme, 'utf8'), { cur: next, day, note }, 'deck'))
  return { kind: 'deck', snapshot: dir, from: newest ? `v${newest.join('.')}` : null, to: next, skeleton: skelS, readme }
}

// The page count the skeleton states in its head (`28장`), else the number of page headings.
export function pageCount(skel) {
  const m = skel.split('\n').slice(0, 15).join('\n').match(/(\d+)\s*장/)
  return m ? Number(m[1]) : headings(skel).length
}

// One row for the snapshot table: into the table under a `## skeleton` (or `## deck`) heading when
// there is one, cells filled by that table's column names; else appended at the end of the file.
// A skeleton row says what the next version changes (`→ vB: …`); a deck row is that version's own note.
export function readmeRow(body, { cur, next, day, pages, note }, kind = 'skeleton') {
  const lines = body.split('\n')
  const sec = lines.findIndex(l => new RegExp(`^##\\s+${kind}\\b`, 'i').test(l))
  if (sec >= 0) {
    let h = sec + 1
    while (h < lines.length && !/^\s*\|/.test(lines[h]) && !/^#/.test(lines[h])) h++
    if (h < lines.length && /^\s*\|/.test(lines[h])) {
      let end = h
      while (end + 1 < lines.length && /^\s*\|/.test(lines[end + 1])) end++
      const cols = lines[h].split('|').slice(1, -1).map(c => c.trim())
      const tick = end > h + 1 && lines[h + 2].includes('`')
      const cell = c => (/버전/.test(c) ? (tick ? `\`${kind}-${cur}\`` : cur) : /날짜/.test(c) ? day : /장수/.test(c) ? String(pages)
        : /바뀐|한 줄|메모|내용/.test(c) ? (next ? `→ ${next}: ${note}` : note) : '')
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

// Lines inside a ``` or ~~~ fence are code, never a heading or a reference.
export function fenced(lines) {
  let open = null
  return lines.map(l => {
    const m = l.match(/^\s*(```|~~~)/)
    if (m && (!open || m[1] === open)) { const inside = !!open; open = open ? null : m[1]; return inside || !!open }
    return !!open
  })
}

export function headings(text) {
  const lines = text.split('\n')
  const code = fenced(lines)
  return lines.map((l, i) => !code[i] && l.match(HEADING)).filter(Boolean).map(m => Number(m[2]))
}

// Every number is looked up once against the original map, so a 3→4 and 4→3 swap cannot apply twice.
// A target that is a page the map leaves in place would make two pages share a number: refused.
export function renumber(text, map) {
  const present = new Set(headings(text))
  for (const [from, target] of map) {
    if (target !== from && present.has(target) && !map.has(target)) throw new Error(`page ${from} → ${target}: page ${target} stays, add it to the map`)
  }
  const to = n => (map.has(n) ? map.get(n) : n)
  const warnings = []
  let changes = 0
  const swap = n => { const v = to(n); if (v !== n) changes++; return v }
  let pageCol = -1
  const src = text.split('\n')
  const code = fenced(src)
  const lines = src.map((line, i) => {
    if (code[i] || CHANGE_LINE.test(line)) return line
    const h = line.match(HEADING)
    if (h) {
      // the heading's own number (and its `쪽`) is swapped once; references later in its text are swapped as refs
      pageCol = -1
      const own = h[0].length + (line.slice(h[0].length).startsWith('쪽') ? 1 : 0)
      // a block order mark `(2/3)` in a moved heading is not renumbered: listed for a hand fix
      const nth = line.match(/\((\d+)\/(\d+)\)/)
      if (nth && to(Number(h[2])) !== Number(h[2])) warnings.push(`${Number(h[2])}쪽 → ${to(Number(h[2]))}쪽 heading keeps "${nth[0]}": check it by hand`)
      return `${h[1]}${swap(Number(h[2]))}${line.slice(h[0].length, own)}${refs(line.slice(own))}`
    }
    if (/^\s*\|/.test(line)) {
      const cells = line.split('|')
      if (cells.some(c => c.trim() === '쪽')) { pageCol = cells.findIndex(c => c.trim() === '쪽'); return line }
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) return line
      if (pageCol >= 0 && cells[pageCol] !== undefined) {
        // the `쪽` cell is swapped once as a column; refs run on the other cells only (`3쪽` in it is not swapped twice)
        return cells.map((c, k) => (k === pageCol ? c.replace(/\d+/g, n => String(swap(Number(n)))) : refs(c))).join('|')
      }
      return refs(line)
    }
    pageCol = -1
    return refs(line)
  })
  function refs(line) {
    return line.replace(REF, (all, a, sep, b) => {
      if (!sep) return `${swap(Number(a))}쪽`
      // a `·` pair is written in ascending order after the swap (7·8쪽 stays 7·8쪽, not 8·7쪽)
      if (sep === '·') return `${[swap(Number(a)), swap(Number(b))].sort((x, y) => x - y).join('·')}쪽`
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
  const code = fenced(lines)
  const h1s = lines.map((l, i) => (!code[i] && H1.test(l) ? i : -1)).filter(i => i >= 0)
  const cuts = [0, ...h1s.filter(i => i > 0)]
  const blocks = cuts.map((c, k) => [lines.slice(c, cuts[k + 1] ?? lines.length), code.slice(c, cuts[k + 1] ?? lines.length)]).map(([block, bcode]) => {
    const starts = block.map((l, i) => (!bcode[i] && /^##\s/.test(l) ? i : -1)).filter(i => i >= 0)
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
  const all = text.split('\n')
  const code = fenced(all)
  const live = all.filter((l, i) => !code[i] && !CHANGE_LINE.test(l)).join('\n')
  for (const m of live.matchAll(REF)) {
    for (const n of [m[1], m[3]].filter(Boolean).map(Number)) if (!known.has(n)) problems.push(`${m[0]} points at no heading`)
  }
  return { headings: hs, problems }
}

// Items scored on only one side are listed apart: a rubric that changed between rounds is not a comparison.
// With two `claims` results, a claim that lost its ground (a problem the earlier round did not have)
// makes the round worse whatever the scores say.
export function compare(before, after, claimsBefore, claimsAfter) {
  const items = Object.keys(before).filter(k => k in after).map(item => ({ item, before: before[item], after: after[item], delta: after[item] - before[item] }))
  const unmatched = [...Object.keys(before), ...Object.keys(after)].filter(k => !(k in before && k in after))
  const dropped = items.filter(i => i.delta < 0).map(i => i.item)
  const rose = items.filter(i => i.delta > 0).map(i => i.item)
  let verdict = dropped.length && rose.length ? 'mixed' : dropped.length ? 'worse' : rose.length ? 'better' : 'same'
  if (!claimsBefore || !claimsAfter) return { verdict, items, dropped, unmatched }
  const key = p => `${p.kind}|${p.text}`
  const had = new Set(claimsBefore.problems.map(key))
  const lostGround = claimsAfter.problems.filter(p => !had.has(key(p)))
  if (lostGround.length) verdict = 'worse'
  return { verdict, items, dropped, unmatched, lost_ground: lostGround }
}

// ── claims: the skeleton's claims checked against the material, both ways ──
// A page cites its material with one line `글감: <id>, <id>` (an item folder under sources/material/
// or material/, or a ledger item `NN_프로젝트/A1`). A figure is a number with a unit or a percentage.
// (a Korean particle may follow the unit: `3배가`; `12만 건` is one figure)
const FIG = /(\d[\d,]*(?:\.\d+)?)\s*((?:[만억천]\s*)?(?:%|ms|초|분|시간|개월|일|주|배|건|명|회|개|대|원|GB|MB|KB|TB|TPS|QPS|RPS|x)|[만억천])(?![A-Za-z])/gu
const CITE = /^\s*(?:[-*]\s*)?글감\s*:\s*(.+)$/
// a sentence that gives a reason, cause or solution; grounded only when the cited items say it
const REASON = /때문|위해|위한|그래서|따라서|덕분|인해|원인|해결|선택했|결정했|판단했/
// phrases the user rejected as machine-written; listed, not failed
const TONE = ['효율적으로', '획기적', '극대화', '성공적으로', '원활한', '원활하게', '시너지', '견고한', '혁신적', '함으로써', '다양한 ', '핵심적인', '도모']
const figs = s => [...String(s).matchAll(FIG)].map(m => `${m[1].replace(/,/g, '')}${m[2].replace(/\s+/g, '')}`)
const stems = s => (String(s).match(/[\p{L}\p{N}]+/gu) || [])
  .filter(w => w.length >= 2 && !REASON.test(w))
  .map(w => (/^[\p{Script=Hangul}]/u.test(w) ? w.slice(0, 2) : w.toLowerCase()))

// result.md rows: `| number | evidence source | label |`
function resultRows(text) {
  return text.split('\n').filter(l => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l))
    .map(l => l.split('|').slice(1, -1).map(c => c.trim()))
    .filter(c => c.length >= 3 && c[0] && c[0] !== 'number')
    .map(([number, evidence, label]) => ({ figs: figs(number), evidence, label }))
}

export function readMaterial(root) {
  const items = new Map()
  const read = p => { try { return readFileSync(p, 'utf8') } catch { return '' } }
  const ls = d => { try { return readdirSync(d, { withFileTypes: true }) } catch { return [] } }
  for (const base of [join(root, 'sources', 'material'), join(root, 'material')]) {
    for (const e of ls(base).filter(e => e.isDirectory())) {
      if (items.has(e.name)) continue
      const parts = ['problem', 'decision', 'result', 'learned', 'meta'].map(p => read(join(base, e.name, `${p}.md`)))
      const result = parts[2]
      items.set(e.name, { id: e.name, text: parts.join('\n'), rows: resultRows(result), cited: false })
    }
  }
  for (const p of ls(join(root, 'sources')).filter(e => e.isDirectory() && /^\d+_/.test(e.name))) {
    for (const f of ls(join(root, 'sources', p.name)).filter(e => e.isFile() && /^A\d+.*\.md$/.test(e.name))) {
      const text = read(join(root, 'sources', p.name, f.name))
      // a ledger has no result table: each line holding a figure is its row, `근거 없음` on that line marks it
      const rows = text.split('\n').filter(l => figs(l).length)
        .map(l => ({ figs: figs(l), evidence: /근거 없음/.test(l) ? '근거 없음' : l, label: /본인 확인/.test(l) ? '본인 확인' : '' }))
      items.set(`${p.name.normalize('NFC')}/${f.name.match(/^A\d+/)[0]}`, { id: `${p.name.normalize('NFC')}/${f.name.match(/^A\d+/)[0]}`, text, rows, cited: false })
    }
  }
  return items
}

// Settled writing bases and structure decisions the checks must not raise again: the lines under
// `## 서술 기준` and `## 구조` in docs/확정사실.md, handed to feedback and drift checks as they are.
export function settled(root) {
  let text = ''
  try { text = readFileSync(join(root, 'docs', '확정사실.md'), 'utf8') } catch { return [] }
  const out = []
  let on = false
  for (const l of text.split('\n')) {
    if (/^##\s/.test(l)) on = /^##\s+(서술 기준|구조)/.test(l)
    else if (on && /^\s*-\s+\S/.test(l)) out.push(l.replace(/^\s*-\s+/, '').trim())
  }
  return out
}

export function claims(text, items, settledLines = []) {
  const problems = [], listed = { self_confirmed: [], user_stated: [], tone: [] }
  const carried = new Map()   // item id → figures some page carries
  const lines = text.split('\n')
  const pages = []
  let cur = null
  for (const l of lines) {
    const h = l.match(HEADING)
    if (h) { cur = { page: Number(h[2]), body: [], ids: [] }; pages.push(cur); continue }
    if (/^#{1,2}\s/.test(l)) { cur = null; continue }
    if (!cur || CHANGE_LINE.test(l)) continue
    const c = l.match(CITE)
    if (c) cur.ids.push(...c[1].split(/[,;]/).map(s => s.trim()).filter(Boolean))
    else if (l.trim()) cur.body.push(l.trim())
  }
  for (const p of pages) {
    const known = p.ids.filter(id => items.has(id))
    for (const id of p.ids.filter(id => !items.has(id))) problems.push({ page: p.page, kind: 'unknown_id', text: id })
    for (const id of known) items.get(id).cited = true
    const ground = known.map(id => items.get(id))
    for (const line of p.body) {
      for (const t of TONE) if (line.includes(t)) listed.tone.push({ page: p.page, phrase: t.trim(), text: line })
      const fs = figs(line)
      const reason = REASON.test(line) && !/\[확인 필요/.test(line)
      if ((fs.length || reason) && !known.length) { problems.push({ page: p.page, kind: 'uncited', text: line }); continue }
      for (const f of fs) {
        const hit = ground.map(it => ({ it, row: it.rows.find(r => r.figs.includes(f)) })).find(x => x.row)
        if (!hit) { problems.push({ page: p.page, kind: 'not_in_material', text: `${f} — ${line}` }); continue }
        if (!carried.has(hit.it.id)) carried.set(hit.it.id, new Set())
        carried.get(hit.it.id).add(f)
        const { evidence, label } = hit.row
        if (/근거 없음/.test(evidence)) problems.push({ page: p.page, kind: 'unsupported', text: `${f} — ${line}` })
        else if (/본인 확인/.test(label)) listed.self_confirmed.push({ page: p.page, id: hit.it.id, text: `${f} — ${line}` })
        else if (/user-stated/.test(label)) listed.user_stated.push({ page: p.page, id: hit.it.id, text: `${f} — ${line}` })
      }
      if (reason) {
        // grounded when at least half of the sentence's word stems appear in the cited items
        const own = stems(line)
        const pool = new Set(stems(ground.map(it => it.text).join('\n')))
        const share = own.length ? own.filter(s => pool.has(s)).length / own.length : 1
        if (share < 0.5) problems.push({ page: p.page, kind: 'to_confirm', text: line })
      }
    }
  }
  // the other way: figures in cited items no page carries, and items no page cites
  const unused = []
  for (const it of items.values()) {
    if (!it.cited) continue
    for (const r of it.rows) for (const f of r.figs) if (!carried.get(it.id)?.has(f) && !/근거 없음/.test(r.evidence)) unused.push({ id: it.id, figure: f })
  }
  const uncitedItems = [...items.values()].filter(it => !it.cited).map(it => it.id)
  return { ok: problems.length === 0, pages: pages.length, problems, listed, unused_results: unused, uncited_items: uncitedItems, settled: settledLines }
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
    // written only when the result verifies (or with --force); a broken result leaves the file as it was
    const v = verify(r.text)
    const write = !args['dry-run'] && (!v.problems.length || args.force === true)
    if (write) writeFileSync(file, r.text)
    out = { file, changes: r.changes, warnings: r.warnings, written: write, ...v }
    // renumber reads one file; the deck's own page numbers are fixed by hand and said so
    if (!/deck\.mdx$/.test(file) && existsSync(join(root, 'deck.mdx'))) {
      out.by_hand = ['deck.mdx: slide order, `<!-- N. … -->` comments and page cells (toc, appendix toc) are not renumbered']
    }
  } else if (cmd === 'verify') {
    out = verify(readFileSync(file, 'utf8'))
  } else if (cmd === 'compare') {
    if (typeof args.before !== 'string' || typeof args.after !== 'string') throw new Error('--before and --after are required')
    const load = p => JSON.parse(readFileSync(join(root, p), 'utf8'))
    const both = typeof args['claims-before'] === 'string' && typeof args['claims-after'] === 'string'
    out = compare(load(args.before), load(args.after), both ? load(args['claims-before']) : undefined, both ? load(args['claims-after']) : undefined)
  } else if (cmd === 'claims') {
    out = claims(readFileSync(file, 'utf8'), readMaterial(root), settled(root))
  } else {
    throw new Error('usage: manage.mjs layout | snapshot | renumber | verify | compare | claims')
  }
  process.stdout.write(`${JSON.stringify(out)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { main() } catch (e) { process.stdout.write(`${JSON.stringify({ error: e.message })}\n`); process.exit(1) }
}
