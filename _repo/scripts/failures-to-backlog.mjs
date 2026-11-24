#!/usr/bin/env node
// Turns the local trophy failure records (plugin store key `trophy.failures`) into one backlog card per group.
// Usage: node _repo/scripts/failures-to-backlog.mjs [--from <json> | --store <dir>] [--backlog <path>] [--write]
// Dry run (default) prints the cards and writes nothing, even with --backlog.
// Exports: findStore, readRecords, firstLine, scrubLine, keyOf, tagOf, groupRecords, cardLines, whyLine,
//          renderCards, applyToBacklog, main
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KEY = 'trophy.failures'
const SECTION = '### Failure records (auto)'
const ACCEPTANCE = '   - Acceptance: the failure no longer recurs in a later run of failures-to-backlog.mjs'
const MAX_LINE = 120
const USAGE = 'usage: failures-to-backlog.mjs [--from <json> | --store <dir>] [--backlog <path>] [--write]'

const str = (v) => (typeof v === 'string' ? v : '')
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})

function failuresOf(file) {
  try {
    const arr = obj(JSON.parse(readFileSync(file, 'utf8')))[KEY]
    return Array.isArray(arr) ? arr : null
  } catch {
    return null
  }
}

// Named (non-inline) store file first; an inline one only when it is the sole file holding the key.
export function findStore(dir) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return null
  }
  const held = names
    .filter((n) => /^trophy_.*\.json$/.test(n) && !n.includes('.tmp.'))
    .sort()
    .filter((n) => failuresOf(join(dir, n)))
  const pick = held.find((n) => !n.startsWith('trophy_inline')) ?? held[0]
  return pick ? join(dir, pick) : null
}

// Raw entries of a store file (objects only), or null when the file has no failures key.
export function readRecords(file) {
  const arr = failuresOf(file)
  return arr ? arr.filter((e) => e && typeof e === 'object') : null
}

export function firstLine(local) {
  const l = obj(local)
  for (const field of [l.text, l.note]) {
    const hit = str(field)
      .split('\n')
      .map((s) => s.trim())
      .find(Boolean)
    if (hit) return hit
  }
  return ''
}

// Lookarounds, not \b: ids glued to letters (`acct123456789012`) must go too.
export function scrubLine(s) {
  const t = str(s)
    .replace(/(?<![\w<>.~\/])\/[^\s"'<>)\]]+/g, '<path>')
    .replace(/(?<![\w<>.])~(?:\/[^\s"'<>)\]]*)?(?![\w~-])/g, '<path>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/(?=[0-9a-f]*\d)[0-9a-f]{32,}/gi, '<id>')
    .replace(/\d{10,}/g, '<id>')
  return t.length > MAX_LINE ? t.slice(0, MAX_LINE) + '…' : t
}

const part = (v) => scrubLine(str(v).replace(/\s+/g, ' ').trim()) || '-'

function normalize(e) {
  const r = obj(e)
  return {
    kind: str(r.kind),
    plugin: part(r.plugin),
    target: part(str(r.skill) || str(r.tool)),
    reason: part(r.reason),
    line: scrubLine(firstLine(r.local)),
    version: scrubLine(str(r.version)),
    cc: scrubLine(str(r.cc)),
    day: str(r.day).trim(),
  }
}

export const keyOf = (p) => [p.plugin, p.target, p.reason, p.line].join(' · ')

export const tagOf = (key) => '[fail:' + createHash('sha1').update(key).digest('hex').slice(0, 8) + ']'

export function groupRecords(records) {
  const groups = new Map()
  for (const e of Array.isArray(records) ? records : []) {
    const r = normalize(e)
    if (r.kind !== 'bug' && r.kind !== 'report') continue
    const key = keyOf(r)
    let g = groups.get(key)
    if (!g) {
      g = { key, tag: tagOf(key), plugin: r.plugin, target: r.target, reason: r.reason, line: r.line, count: 0, firstDay: '', lastDay: '', versions: [], ccs: [] }
      groups.set(key, g)
    }
    g.count++
    if (r.day && (!g.firstDay || r.day < g.firstDay)) g.firstDay = r.day
    if (r.day && r.day > g.lastDay) g.lastDay = r.day
    if (r.version && !g.versions.includes(r.version)) g.versions.push(r.version)
    if (r.cc && !g.ccs.includes(r.cc)) g.ccs.push(r.cc)
  }
  for (const g of groups.values()) {
    g.versions.sort()
    g.ccs.sort()
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1))
}

export const whyLine = (g) =>
  `   - Why: ${g.count} records, ${g.firstDay}–${g.lastDay}; plugin versions: ${g.versions.join(', ')}; ` +
  `Claude Code: ${g.ccs.join(', ')}; reason: ${g.reason}; line: ${g.line}`

export function cardLines(g, n) {
  const tail = g.line ? ` — ${g.line}` : ''
  return [`${n}. **${g.plugin} ${g.target}: ${g.reason}${tail} ${g.tag}**`, whyLine(g), ACCEPTANCE]
}

export const renderCards = (groups, start = 1) =>
  groups.map((g, i) => cardLines(g, start + i).join('\n')).join('\n\n')

const highestNumber = (lines) => lines.reduce((m, l) => Math.max(m, Number(/^(\d+)\. /.exec(l)?.[1] ?? 0)), 0)

// Edits only the auto section (or inserts it before `## Frozen`); a known tag gets its Why count and days rewritten.
export function applyToBacklog(text, groups) {
  if (!groups.length) return text
  const lines = text.split('\n')
  let next = highestNumber(lines) + 1
  const start = lines.indexOf(SECTION)
  if (start < 0) {
    const cards = groups.map((g) => cardLines(g, next++).join('\n')).join('\n\n')
    const block = `${SECTION}\n\n${cards}\n\n`
    const frozen = lines.findIndex((l) => l.startsWith('## Frozen'))
    if (frozen < 0) return text.replace(/\n*$/, '\n\n') + block.replace(/\n+$/, '\n')
    lines.splice(frozen, 0, ...block.split('\n').slice(0, -1))
    return lines.join('\n')
  }
  let end = lines.findIndex((l, i) => i > start && /^##+ /.test(l))
  if (end < 0) end = lines.length
  const added = []
  for (const g of groups) {
    const title = lines.findIndex((l, i) => i > start && i < end && /^\d+\. \*\*/.test(l) && l.includes(g.tag))
    if (title < 0) {
      added.push('', ...cardLines(g, next++))
      continue
    }
    for (let i = title + 1; i < end && !/^\d+\. /.test(lines[i]); i++) {
      if (/^ {3}- Why: \d+ records, [^;]*;/.test(lines[i])) {
        lines[i] = lines[i].replace(/^( {3}- Why: )\d+ records, [^;]*;/, `$1${g.count} records, ${g.firstDay}–${g.lastDay};`)
        break
      }
    }
  }
  let at = end
  while (at > start + 1 && lines[at - 1].trim() === '') at--
  lines.splice(at, 0, ...added)
  return lines.join('\n')
}

export function main(argv, env = process.env, out = console.log, err = console.error) {
  const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined)
  if (argv.includes('--help') || argv.includes('-h')) {
    out(USAGE)
    return 0
  }
  const from = arg('--from')
  const store = arg('--store') ?? join(env.HOME || homedir(), '.claude', 'plugins', 'store')
  const file = from ?? findStore(store)
  const groups = groupRecords((file && readRecords(file)) || [])
  if (!groups.length) {
    out('no records')
    return 0
  }
  const backlog = resolve(arg('--backlog') ?? join(dirname(fileURLToPath(import.meta.url)), '../docs/backlog.md'))
  let text = ''
  try {
    text = readFileSync(backlog, 'utf8')
  } catch (e) {
    if (argv.includes('--write')) {
      err(`cannot read backlog: ${e.code ?? e.message}`)
      return 1
    }
  }
  if (!argv.includes('--write')) {
    out(renderCards(groups, highestNumber(text.split('\n')) + 1))
    return 0
  }
  const updated = applyToBacklog(text, groups)
  if (updated !== text) writeFileSync(backlog, updated)
  out(updated === text ? 'backlog unchanged' : 'backlog updated')
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2), process.env)
}
