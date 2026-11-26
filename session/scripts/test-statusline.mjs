import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, branchLabel, roundHalfEven } from './statusline-logic.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const NODE_SCRIPT = join(here, 'statusline.mjs')
const REFERENCE = join(here, 'fixtures', 'statusline-command.sh')
const NOW = new Date(2026, 10, 26, 9, 5)

// jq is the test-only oracle: the reference script needs it, the product never does.
const hasJq = spawnSync('jq', ['--version']).status === 0
const oracle = { skip: hasJq ? false : 'jq not installed (test-only oracle for the reference script)' }

const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '')

test('roundHalfEven matches printf %.0f', () => {
  assert.equal(roundHalfEven(42.5), 42)
  assert.equal(roundHalfEven(43.5), 44)
  assert.equal(roundHalfEven(0), 0)
  assert.equal(roundHalfEven(99.6), 100)
  assert.equal(roundHalfEven(0.5), 0)
  assert.equal(roundHalfEven(1.5), 2)
})

test('branchLabel maps every prefix, copying the first-occurrence quirk', () => {
  const cases = {
    main: '🌿 main', master: '🌿 main', develop: '🔧 dev', dev: '🔧 dev',
    'feat/x': '✨ feat: x', 'feature/y': '✨ feat: y',
    'fix/x': '🐛 fix: x', 'bugfix/x': '🐛 fix: bugx', 'hotfix/x': '🐛 fix: hotx',
    'release/1.2': '🚀 release: 1.2', 'chore/c': '🔨 chore: c', 'docs/d': '📝 docs: d',
    weird: '🌀 weird',
  }
  for (const [b, want] of Object.entries(cases)) assert.equal(branchLabel(b), want, b)
  assert.equal(branchLabel(''), '')
})

test('render: full line with fixed time, colours and order', () => {
  const out = render({
    model: { display_name: 'Opus' },
    context_window: { used_percentage: 42.5 },
    rate_limits: { five_hour: { used_percentage: 10 }, seven_day: { used_percentage: 20 } },
  }, { now: NOW, branch: 'feat/x' })
  assert.equal(out,
    '\x1b[0;36m🤖 Opus\x1b[0m | \x1b[0;33m🕐 09:05\x1b[0m | \x1b[0;35m✨ feat: x\x1b[0m | \x1b[0;34m🧠 Ctx: 42%\x1b[0m | \x1b[0;32m⏱️ 5h: 10% | 📅 7d: 20%\x1b[0m')
})

test('render: model missing, ctx missing, no branch, no limits', () => {
  assert.equal(strip(render({}, { now: NOW })), '🤖 Unknown | 🕐 09:05 | 🧠 Ctx: -')
})

test('render: ctx 0/42.5/43.5/99.6', () => {
  const ctx = v => strip(render({ context_window: { used_percentage: v } }, { now: NOW })).split(' | ')[2]
  assert.equal(ctx(0), '🧠 Ctx: 0%')
  assert.equal(ctx(42.5), '🧠 Ctx: 42%')
  assert.equal(ctx(43.5), '🧠 Ctx: 44%')
  assert.equal(ctx(99.6), '🧠 Ctx: 100%')
  assert.equal(ctx(null), '🧠 Ctx: -')
})

test('render: limits none / 5h / 7d / both', () => {
  const lim = rl => strip(render({ rate_limits: rl }, { now: NOW })).split(' | ').slice(3).join(' | ')
  assert.equal(lim(undefined), '')
  assert.equal(lim({ five_hour: { used_percentage: 5 } }), '⏱️ 5h: 5%')
  assert.equal(lim({ seven_day: { used_percentage: 7 } }), '📅 7d: 7%')
  assert.equal(lim({ five_hour: { used_percentage: 5 }, seven_day: { used_percentage: 7 } }), '⏱️ 5h: 5% | 📅 7d: 7%')
})

test('render: non-object input falls back to Unknown', () => {
  assert.match(render(null, { now: NOW }), /Unknown/)
})

// Equality against the vendored reference, same stdin, TZ=UTC.
const sandbox = mkdtempSync(join(tmpdir(), 'statusline-test-'))
const GIT = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false']
const git = (cwd, ...a) => {
  const r = spawnSync('git', [...GIT, ...a], { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
}
function repoOn(name, branch, detached = false) {
  const dir = join(sandbox, name)
  mkdirSync(dir)
  git(dir, 'init', '-q', '-b', branch)
  writeFileSync(join(dir, 'f'), 'x')
  git(dir, 'add', 'f')
  git(dir, 'commit', '-q', '-m', 'c')
  if (detached) git(dir, 'checkout', '-q', '--detach')
  return dir
}
const plain = join(sandbox, 'plain')
mkdirSync(plain)
const dirs = {
  main: repoOn('main', 'main'),
  'feat/x': repoOn('feat', 'feat/x'),
  'hotfix/x': repoOn('hotfix', 'hotfix/x'),
  'bugfix/x': repoOn('bugfix', 'bugfix/x'),
  'release/1.2': repoOn('release', 'release/1.2'),
  weird: repoOn('weird', 'weird'),
  detached: repoOn('detached', 'main', true),
  'non-repo': plain,
  missing: join(sandbox, 'does-not-exist'),
}

const run = (cmd, args, stdin) => {
  const r = spawnSync(cmd, args, { input: stdin, encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } })
  return { out: r.stdout, err: r.stderr, status: r.status }
}
const norm = s => s.replace(/🕐 \d\d:\d\d/, '🕐 HH:MM')
function same(input) {
  const stdin = JSON.stringify(input)
  const a = run('node', [NODE_SCRIPT], stdin)
  const b = run('sh', [REFERENCE], stdin)
  assert.equal(a.status, 0)
  assert.equal(a.err, '')
  assert.strictEqual(norm(a.out), norm(b.out))
  assert.ok(!a.out.endsWith('\n'))
}

for (const [name, dir] of Object.entries(dirs)) {
  test(`equal to reference: branch ${name}`, oracle, () => {
    same({
      model: { display_name: 'Opus' },
      workspace: { current_dir: dir },
      context_window: { used_percentage: 12 },
      rate_limits: { five_hour: { used_percentage: 3 }, seven_day: { used_percentage: 4 } },
    })
  })
}

test('equal to reference: cwd fallback', oracle, () => {
  same({ model: { display_name: 'Opus' }, cwd: dirs.main })
})

for (const v of [undefined, 0, 42.5, 43.5, 99.6]) {
  test(`equal to reference: ctx ${v}`, oracle, () => {
    same({ model: { display_name: 'Opus' }, workspace: { current_dir: dirs.main }, context_window: v === undefined ? {} : { used_percentage: v } })
  })
}

const L = {
  none: undefined,
  '5h': { five_hour: { used_percentage: 41.5 } },
  '7d': { seven_day: { used_percentage: 0 } },
  both: { five_hour: { used_percentage: 99.6 }, seven_day: { used_percentage: 7 } },
}
for (const [name, rl] of Object.entries(L)) {
  test(`equal to reference: limits ${name}`, oracle, () => {
    same({ model: { display_name: 'Opus' }, workspace: { current_dir: dirs.main }, rate_limits: rl })
  })
}

test('equal to reference: model missing', oracle, () => {
  same({ workspace: { current_dir: dirs.main } })
})

for (const s of ['not json', '']) {
  test(`garbage stdin ${JSON.stringify(s)}: exit 0, Unknown, empty stderr`, () => {
    const r = run('node', [NODE_SCRIPT], s)
    assert.equal(r.status, 0)
    assert.match(r.out, /Unknown/)
    assert.equal(r.err, '')
  })
}

test.after(() => rmSync(sandbox, { recursive: true, force: true }))
