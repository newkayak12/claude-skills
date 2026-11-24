import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findStore, readRecords, firstLine, scrubLine, keyOf, tagOf, groupRecords, whyLine, renderCards, applyToBacklog } from './failures-to-backlog.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'failures-to-backlog.mjs')
const fx = join(here, 'fixtures', 'failures-to-backlog')
const store = join(fx, 'store')
const named = join(store, 'trophy_fixture-abc.json')
const SECTION = '### Failure records (auto)'

// Every spawn gets a temp HOME and an explicit --backlog (a temp copy), so no path can reach the real ones.
const scratch = mkdtempSync(join(tmpdir(), 'f2b-'))
after(() => rmSync(scratch, { recursive: true, force: true }))
let seq = 0
const home = join(scratch, 'home')
mkdirSync(home)

function work() {
  const dir = join(scratch, `w${seq++}`)
  mkdirSync(dir)
  const backlog = join(dir, 'backlog.md')
  copyFileSync(join(fx, 'backlog.md'), backlog)
  return { dir, backlog }
}
const cli = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, HOME: home } })
const read = (p) => readFileSync(p, 'utf8')
const records = () => readRecords(named)
function jsonFile(dir, name, arr) {
  const p = join(dir, name)
  writeFileSync(p, JSON.stringify({ 'trophy.failures': arr }))
  return p
}
const find = (groups, reason) => groups.find((g) => g.reason === reason)

test('findStore picks the named file, not the inline file or the .tmp. leftover', () => {
  assert.equal(findStore(store), named)
})

test('findStore: empty dir, missing dir, inline file without the key give null', () => {
  const empty = join(scratch, 'empty')
  mkdirSync(empty)
  assert.equal(findStore(empty), null)
  assert.equal(findStore(join(scratch, 'missing')), null)
  const d = join(scratch, 'inline-only')
  mkdirSync(d)
  writeFileSync(join(d, 'trophy_inline-x.json'), '{"trophy.other": []}')
  writeFileSync(join(d, 'trophy_bad.json'), '{not json')
  assert.equal(findStore(d), null)
  assert.equal(readRecords(join(d, 'trophy_inline-x.json')), null)
})

test('findStore prefers a named file over an inline one that also holds the key', () => {
  const d = join(scratch, 'both')
  mkdirSync(d)
  jsonFile(d, 'trophy_inline-a.json', [])
  jsonFile(d, 'trophy_zzz.json', [])
  assert.equal(findStore(d), join(d, 'trophy_zzz.json'))
})

test('readRecords keeps objects only and survives junk entries', () => {
  const r = records()
  assert.equal(r.length, 13)
  assert.ok(r.every((e) => e && typeof e === 'object'))
})

test('no records: empty store dir, missing store, --from without the key, missing --from file', () => {
  const { backlog } = work()
  const before = read(backlog)
  const empty = join(scratch, 'empty2')
  mkdirSync(empty)
  const nokey = join(scratch, 'nokey.json')
  writeFileSync(nokey, '{"a": 1}')
  for (const args of [['--store', empty], ['--store', join(scratch, 'nope')], ['--from', nokey], ['--from', join(scratch, 'nope.json')]]) {
    const p = cli([...args, '--backlog', backlog])
    assert.equal(p.status, 0, args.join(' '))
    assert.equal(p.stdout, 'no records\n')
  }
  assert.equal(read(backlog), before)
})

test('--write with an unreadable backlog exits 1; a dry run numbers from 1', () => {
  const missing = join(scratch, 'nodir', 'b.md')
  const w = cli(['--store', store, '--backlog', missing, '--write'])
  assert.equal(w.status, 1)
  assert.match(w.stderr, /cannot read backlog/)
  const d = cli(['--store', store, '--backlog', missing])
  assert.equal(d.status, 0)
  assert.match(d.stdout, /^1\. \*\*/)
})

test('outcome entries yield no group and their reason never reaches stdout', () => {
  const groups = groupRecords(records())
  assert.equal(groups.length, 8)
  assert.ok(!groups.some((g) => /goal_failed/.test(g.reason)))
  const { backlog } = work()
  const p = cli(['--store', store, '--backlog', backlog])
  assert.doesNotMatch(p.stdout, /subgoal_failed|goal_failed|leftover/)
  assert.deepEqual(groupRecords([{ kind: 'outcome', reason: 'x' }, null, 'junk', { reason: 'no kind' }]), [])
  assert.deepEqual(groupRecords(undefined), [])
})

test('grouping merges same plugin, target, reason and scrubbed line; ordered by count then tag', () => {
  const groups = groupRecords(records())
  const a = find(groups, 'mcp_error')
  assert.equal(a.count, 3)
  assert.equal(a.firstDay, '2026-11-01')
  assert.equal(a.lastDay, '2026-11-03')
  assert.deepEqual(a.versions, ['1.0.0', '1.0.1'])
  assert.deepEqual(a.ccs, ['2.1.300', '2.1.301'])
  const b = find(groups, 'is_error')
  assert.equal(b.count, 2)
  assert.equal(b.line, 'failed to read <path> on port 8080')
  assert.equal(b.target, 'list')
  assert.deepEqual(groups.slice(0, 2).map((g) => g.reason), ['mcp_error', 'is_error'])
  const rest = groups.slice(2)
  assert.ok(rest.every((g) => g.count === 1))
  assert.deepEqual(rest.map((g) => g.tag), rest.map((g) => g.tag).sort())
  assert.equal(groups.reduce((n, g) => n + g.count, 0), 3 + 2 + 6)
})

test('fallbacks: no plugin/skill/tool gives "-", local {} gives an empty line, note-only is read', () => {
  const groups = groupRecords(records())
  const f = find(groups, 'unknown')
  assert.equal(f.plugin, '-')
  assert.equal(f.target, '-')
  assert.equal(f.line, '')
  assert.equal(find(groups, 'user_report').line, '<path> is missing')
  assert.equal(find(groups, 'r_missing').line, 'only a note')
  assert.equal(firstLine({ text: '\n  \n  hi  \nlater' }), 'hi')
  assert.equal(firstLine({ text: ' ', note: 'n' }), 'n')
  assert.equal(firstLine({}), '')
  assert.equal(firstLine(null), '')
})

test('scrub: absolute and ~ paths become <path>', () => {
  assert.equal(scrubLine('read /Users/someone/x/y.txt now'), 'read <path> now')
  assert.equal(scrubLine('read ~/notes/a.md now'), 'read <path> now')
  assert.equal(scrubLine('/abs/only'), '<path>')
  assert.equal(scrubLine('at (/opt/z/q.js)'), 'at (<path>)')
})

test('scrub: uuid, 32-hex and 10+ digit runs become <id>; short digits stay', () => {
  assert.equal(scrubLine('s 123e4567-e89b-12d3-a456-426614174000 x'), 's <id> x')
  assert.equal(scrubLine('h 0123456789abcdef0123456789abcdef x'), 'h <id> x')
  assert.equal(scrubLine('profile p · account 123456789012 · region r'), 'profile p · account <id> · region r')
  assert.equal(scrubLine('acct123456789012'), 'acct<id>')
  assert.equal(scrubLine('1234567890'), '<id>')
  assert.equal(scrubLine('123456789'), '123456789')
  assert.equal(scrubLine('port 8080, 3 retries, v2.1.300'), 'port 8080, 3 retries, v2.1.300')
  assert.equal(scrubLine('abcdefabcdefabcdefabcdefabcdefabcdef'), 'abcdefabcdefabcdefabcdefabcdefabcdef')
})

test('scrub: a line over 120 characters is cut to 120 plus an ellipsis; 120 exactly is kept', () => {
  assert.equal(scrubLine('q'.repeat(120)), 'q'.repeat(120))
  assert.equal(scrubLine('q'.repeat(121)), 'q'.repeat(120) + '…')
  assert.equal(find(groupRecords(records()), 'too_long').line, 'q'.repeat(120) + '…')
  assert.equal(scrubLine(undefined), '')
})

test('fixture account number never survives into a group or a card', () => {
  const a = find(groupRecords(records()), 'mcp_error')
  assert.match(a.line, /account <id> ·/)
  assert.doesNotMatch(renderCards(groupRecords(records())), /\d{10,}|\/tmp|\/opt|alpha|beta/)
})

test('tag format, derivation, stability, independence from count/version/cc/day', () => {
  const groups = groupRecords(records())
  for (const g of groups) {
    assert.match(g.tag, /^\[fail:[0-9a-f]{8}\]$/)
    assert.equal(g.tag, '[fail:' + createHash('sha1').update(g.key).digest('hex').slice(0, 8) + ']')
    assert.equal(g.key, keyOf(g))
    assert.equal(tagOf(g.key), g.tag)
  }
  assert.deepEqual(groupRecords(records()).map((g) => g.tag), groups.map((g) => g.tag))
  const extra = { kind: 'bug', reason: 'mcp_error', plugin: 'knowledge', skill: 'search', version: '9.9.9', cc: '9.9.9', day: '2030-01-01', local: { text: '<tool_use_error>profile demo-profile · account 123456789012 · region xx-test-1' } }
  const more = groupRecords([...records(), extra, extra])
  assert.equal(find(more, 'mcp_error').count, 5)
  assert.equal(find(more, 'mcp_error').tag, find(groups, 'mcp_error').tag)
  assert.equal(new Set(groups.map((g) => g.tag)).size, groups.length)
  const other = groupRecords([{ ...extra, reason: 'other' }])
  assert.notEqual(other[0].tag, find(groups, 'mcp_error').tag)
})

test('card format: title, Why, Acceptance, "1 records", bare – for a missing day, no " — line" when empty', () => {
  const groups = groupRecords(records())
  const cards = renderCards(groups, 10).split('\n\n')
  assert.equal(cards.length, 8)
  const a = find(groups, 'mcp_error')
  const [t, why, acc] = cards[0].split('\n')
  assert.equal(t, `10. **knowledge search: mcp_error — ${a.line} ${a.tag}**`)
  assert.equal(why, '   - Why: 3 records, 2026-11-01–2026-11-03; plugin versions: 1.0.0, 1.0.1; Claude Code: 2.1.300, 2.1.301; reason: mcp_error; line: ' + a.line)
  assert.equal(acc, '   - Acceptance: the failure no longer recurs in a later run of failures-to-backlog.mjs')
  const g = find(groups, 'r_missing')
  assert.equal(whyLine(g), '   - Why: 1 records, –; plugin versions: ; Claude Code: ; reason: r_missing; line: only a note')
  const f = find(groups, 'unknown')
  const fc = cards.find((c) => c.includes(f.tag)).split('\n')
  assert.match(fc[0], /^\d+\. \*\*- -: unknown \[fail:[0-9a-f]{8}\]\*\*$/)
  assert.match(fc[1], /records, 2026-11-06–2026-11-06; plugin versions: 1\.0\.0; Claude Code: 2\.1\.300; reason: unknown; line: $/)
  assert.deepEqual(cards.map((c) => Number(/^(\d+)\./.exec(c)[1])), [10, 11, 12, 13, 14, 15, 16, 17])
})

test('dry run prints the cards, numbered from the highest N. (Frozen included) + 1, and leaves the backlog byte-identical', () => {
  const { backlog } = work()
  const before = readFileSync(backlog)
  const p = cli(['--store', store, '--backlog', backlog])
  assert.equal(p.status, 0)
  const titles = p.stdout.split('\n').filter((l) => /^\d+\. \*\*/.test(l))
  assert.equal(titles.length, 8)
  assert.match(titles[0], /^10\. \*\*knowledge search: mcp_error — /)
  assert.match(titles[7], /^17\. /)
  assert.equal(p.stdout.trimEnd(), renderCards(groupRecords(records()), 10))
  assert.ok(readFileSync(backlog).equals(before))
  const q = cli(['--from', named, '--backlog', backlog])
  assert.equal(q.stdout, p.stdout)
  assert.ok(readFileSync(backlog).equals(before))
})

test('--write inserts the auto section before ## Frozen, cards N+1..N+G, removing it restores the original', () => {
  const { backlog } = work()
  const original = read(backlog)
  const p = cli(['--store', store, '--backlog', backlog, '--write'])
  assert.equal(p.status, 0)
  assert.equal(p.stdout, 'backlog updated\n')
  const out = read(backlog)
  const s = out.indexOf(SECTION)
  const f = out.indexOf('## Frozen')
  assert.ok(s > 0 && s < f)
  assert.equal(out.slice(0, s) + out.slice(f), original)
  const block = out.slice(s, f)
  const nums = block.split('\n').filter((l) => /^\d+\. \*\*/.test(l)).map((l) => Number(/^(\d+)\./.exec(l)[1]))
  assert.deepEqual(nums, [10, 11, 12, 13, 14, 15, 16, 17])
  assert.equal(block.trimEnd(), `${SECTION}\n\n${renderCards(groupRecords(records()), 10)}`)
})

test('re-run with the same records is byte-identical and says "backlog unchanged"', () => {
  const { backlog } = work()
  cli(['--store', store, '--backlog', backlog, '--write'])
  const once = readFileSync(backlog)
  const p = cli(['--store', store, '--backlog', backlog, '--write'])
  assert.equal(p.status, 0)
  assert.equal(p.stdout, 'backlog unchanged\n')
  assert.ok(readFileSync(backlog).equals(once))
})

function extended() {
  const { dir } = work()
  const mk = (day) => ({ kind: 'bug', reason: 'mcp_error', plugin: 'knowledge', skill: 'search', version: '1.0.0', cc: '2.1.300', day, local: { text: '<tool_use_error>profile demo-profile · account 123456789012 · region xx-test-1' } })
  const mk2 = { kind: 'bug', reason: 'is_error', plugin: 'trophy', tool: 'list', version: '0.5.0', cc: '2.1.300', day: '2026-12-01', local: { text: 'failed to read /var/gamma/three.txt on port 8080' } }
  return jsonFile(dir, 'more.json', [...records(), mk('2026-10-30'), mk('2026-11-09'), mk2])
}

test('re-run with more records changes only the matched cards count and day range', () => {
  const { backlog } = work()
  cli(['--store', store, '--backlog', backlog, '--write'])
  const before = read(backlog).split('\n')
  const p = cli(['--from', extended(), '--backlog', backlog, '--write'])
  assert.equal(p.stdout, 'backlog updated\n')
  const after = read(backlog).split('\n')
  assert.equal(after.length, before.length)
  const changed = before.map((l, i) => i).filter((i) => before[i] !== after[i])
  assert.equal(changed.length, 2)
  const [ia, ib] = changed
  assert.equal(after[ia].replace(/^( {3}- Why: )\d+ records, [^;]*;/, '$1X;'), before[ia].replace(/^( {3}- Why: )\d+ records, [^;]*;/, '$1X;'))
  assert.equal(after[ib].replace(/^( {3}- Why: )\d+ records, [^;]*;/, '$1X;'), before[ib].replace(/^( {3}- Why: )\d+ records, [^;]*;/, '$1X;'))
  assert.match(after[ia], /^ {3}- Why: 5 records, 2026-10-30–2026-11-09;/)
  assert.match(after[ib], /^ {3}- Why: 3 records, 2026-11-02–2026-12-01;/)
})

test('a hand-edited Acceptance line survives a re-run', () => {
  const { backlog } = work()
  cli(['--store', store, '--backlog', backlog, '--write'])
  const edited = read(backlog).replace('   - Acceptance: the failure no longer recurs in a later run of failures-to-backlog.mjs', '   - Acceptance: HAND EDITED').replace(/(HAND EDITED[\s\S]*?)   - Acceptance: the failure no longer recurs in a later run of failures-to-backlog.mjs/, '$1   - Acceptance: second hand edit')
  writeFileSync(backlog, edited)
  const p = cli(['--from', extended(), '--backlog', backlog, '--write'])
  assert.equal(p.stdout, 'backlog updated\n')
  const out = read(backlog)
  assert.ok(out.includes('   - Acceptance: HAND EDITED\n'))
  assert.ok(out.includes('   - Acceptance: second hand edit\n'))
  assert.match(out, /Why: 5 records, 2026-10-30–2026-11-09;/)
  const same = cli(['--store', store, '--backlog', backlog, '--write'])
  assert.equal(same.status, 0)
  assert.ok(read(backlog).includes('   - Acceptance: HAND EDITED\n'))
})

test('a deleted card is not recreated while its records are absent; a recurrence recreates it (known limit)', () => {
  const { dir, backlog } = work()
  cli(['--store', store, '--backlog', backlog, '--write'])
  const long = find(groupRecords(records()), 'too_long')
  const lines = read(backlog).split('\n')
  const at = lines.findIndex((l) => /^\d+\. \*\*/.test(l) && l.includes(long.tag))
  lines.splice(at, 4) // title, Why, Acceptance, blank
  writeFileSync(backlog, lines.join('\n'))
  const deleted = readFileSync(backlog)
  assert.ok(!deleted.toString().includes(long.tag))
  const onlyA = jsonFile(dir, 'a.json', records().filter((e) => e && e.reason === 'mcp_error'))
  const p = cli(['--from', onlyA, '--backlog', backlog, '--write'])
  assert.equal(p.stdout, 'backlog unchanged\n')
  assert.ok(readFileSync(backlog).equals(deleted))
  const q = cli(['--store', store, '--backlog', backlog, '--write'])
  assert.equal(q.stdout, 'backlog updated\n')
  const out = read(backlog)
  assert.equal(out.split(long.tag).length - 1, 1)
  assert.match(out, new RegExp(`^18\\. \\*\\*demo long: too_long.*${long.tag.replace(/[[\]]/g, '\\$&')}\\*\\*$`, 'm'))
})

test('applyToBacklog is pure: no groups returns the text; no ## Frozen appends the section', () => {
  assert.equal(applyToBacklog('abc\n', []), 'abc\n')
  const out = applyToBacklog('# B\n\n1. **x**\n', groupRecords(records()).slice(0, 1))
  assert.ok(out.startsWith('# B\n\n1. **x**\n\n' + SECTION + '\n\n2. **'))
})
