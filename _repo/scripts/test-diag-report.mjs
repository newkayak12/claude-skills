import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rank, main } from './diag-report.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = join(here, 'fixtures', 'diag-events.json')

test('rank orders by installs desc then count desc', () => {
  const r = rank([
    ['e', 'a', null, 'p', 'r', 1, 1, 1],
    ['e', 'b', null, 'p', 'r', 5, 1, 3],
    ['e', 'c', null, 'p', 'r', 9, 1, 3],
    ['e', null, 'm', 'p', 'r', 2, 1, 2],
  ])
  assert.deepEqual(r.map((x) => x.name), ['c', 'b', 'm', 'a'])
})

test('missing POSTHOG_PERSONAL_KEY exits 2 and makes no fetch', async () => {
  let called = 0
  const code = await main([], {}, async () => { called++ }, () => {}, () => {})
  assert.equal(code, 2)
  assert.equal(called, 0)
  const env = { ...process.env }
  delete env.POSTHOG_PERSONAL_KEY
  const p = spawnSync('node', [join(here, 'diag-report.mjs')], { env, encoding: 'utf8' })
  assert.equal(p.status, 2)
  assert.match(p.stderr, /usage/)
})

test('--fixture prints the ranked table without network', async () => {
  const lines = []
  const code = await main(['--fixture', fixture], {}, async () => { throw new Error('fetch') }, (s) => lines.push(s))
  assert.equal(code, 0)
  assert.deepEqual(lines.join('\n').split('\n'), [
    'skill|tool · plugin · reason · count · days seen · installs',
    'mcp__plugin_knowledge_knowledge-local__knowledge_search · knowledge · mcp_error · 9 · 3 · 3',
    'trophy:list · trophy · is_error · 5 · 2 · 3',
    'develop:sql-pro · develop · unsuccessful · 2 · 1 · 2',
    'think:mentor · think · user_report · 1 · 1 · 2',
    'harness · harness · forked_unsuccessful · 4 · 2 · 1',
    '- · - · timeout · 3 · 2 · 1',
  ])
})
