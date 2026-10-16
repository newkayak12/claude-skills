// Tests for check-skeleton.mjs. Run: node --test _repo/scripts/test-check-skeleton.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scan } from './check-skeleton.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, 'check-skeleton.mjs')
const FIX = join(here, 'fixtures', 'skeleton')
const run = (root) => spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' })
const find = (list, id) => list.find((i) => i.id === id)

test('missing sections are listed exactly; fenced heading and lowercase heading do not count', () => {
  const { active } = scan(FIX, new Set())
  assert.deepEqual(find(active, 'a:missing').missing, ['Process', 'Output Template', 'Related Skills'])
})

test('over 200 lines is listed with its count and no missing sections', () => {
  const long = find(scan(FIX, new Set()).active, 'a:long')
  assert.equal(long.lines, 205)
  assert.deepEqual(long.missing, [])
})

test('exactly 200 lines is not flagged, and a complete skill is unlisted', () => {
  const { active, frozen } = scan(FIX, new Set())
  for (const id of ['a:edge200', 'a:complete']) {
    assert.equal(find(active, id), undefined)
    assert.equal(find(frozen, id), undefined)
  }
})

test('a Set-passed id routes to frozen, not active', () => {
  const { active, frozen } = scan(FIX, new Set(['a:missing']))
  assert.ok(find(frozen, 'a:missing'))
  assert.equal(find(active, 'a:missing'), undefined)
})

test('fixture root without teams/mcp: warns, teams/skills is frozen only, exit 0', () => {
  const r = run(FIX)
  assert.equal(r.status, 0)
  assert.equal(r.stderr.trim().split('\n').length, 1)
  assert.match(r.stderr, /^warning: teams mounts unreadable/)
  const [activePart, frozenPart] = r.stdout.split(/^frozen/m)
  assert.ok(frozenPart !== undefined, 'frozen heading printed')
  assert.match(activePart, /a:missing/)
  assert.match(activePart, /a:long/)
  assert.doesNotMatch(activePart, /teams:frozen-one/)
  assert.match(frozenPart, /teams:frozen-one/)
})

test('mounts that throw on import: warns, exit 0, report still printed', () => {
  const root = mkdtempSync(join(tmpdir(), 'skeleton-'))
  try {
    mkdirSync(join(root, 'teams', 'mcp'), { recursive: true })
    writeFileSync(join(root, 'teams', 'mcp', 'graph.mjs'), 'throw new Error("boom")\n')
    mkdirSync(join(root, 'teams', 'skills', 'solo'), { recursive: true })
    writeFileSync(join(root, 'teams', 'skills', 'solo', 'SKILL.md'), '# solo\n')
    const r = run(root)
    assert.equal(r.status, 0)
    assert.match(r.stderr, /^warning: teams mounts unreadable/)
    assert.match(r.stdout.split(/^frozen/m)[1], /teams:solo/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('nonexistent root: one warning, no skill lines, exit 0', () => {
  const r = run(join(tmpdir(), 'skeleton-no-such-root'))
  assert.equal(r.status, 0)
  assert.match(r.stderr, /^warning: root not found/)
  assert.equal(r.stdout, '')
})
