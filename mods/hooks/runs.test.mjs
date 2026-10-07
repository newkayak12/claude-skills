// node --test mods/hooks/runs.test.mjs — runs.mjs against throw-away git repos in the OS temp dir.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RUNS = join(dirname(fileURLToPath(import.meta.url)), 'runs.mjs')
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' })

// a repo with one commit, plus a linked worktree; returns both paths
function fixture() {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'mods-runs-')))
  const repo = join(top, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init')
  const wt = join(top, 'wt')
  git(repo, 'worktree', 'add', '-q', '-b', 'side', wt)
  return { top, repo, wt }
}

const put = (dir, rel, body = '{}') => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true })
  writeFileSync(join(dir, rel), typeof body === 'string' ? body : JSON.stringify(body))
}
const open = (tree, slug) => {
  const d = join(tree, '.harness-run', slug)
  put(d, 'manifest.json')
  return d
}
const run = root => JSON.parse(execFileSync('node', [RUNS, root], { encoding: 'utf8' }))
const spec = ids => ({ subgoals: ids.map(id => ({ id })) })

test('stage and pass counts of an open run, found in a linked worktree', () => {
  const { top, repo, wt } = fixture()
  try {
    const d = open(wt, 'alpha')
    put(d, '01-plan.md', '# plan')
    put(d, '02-goal-spec.json', spec(['s1', 's2', 's3']))
    put(d, '02-critique.json', { sound: true })
    put(d, 'subgoals/s1/result.json', { passed: true })
    put(d, 'subgoals/s2/result.json', { passed: false })
    const out = run(repo)
    assert.equal(out.length, 1)
    assert.deepEqual({ ...out[0], dir: undefined }, { dir: undefined, slug: 'alpha', stage: 'implement', passed: 1, failed: 1, total: 3 })
    assert.equal(out[0].dir, d)
  } finally {
    rmSync(top, { recursive: true, force: true })
  }
})

test('stage walks plan -> setgoal -> critique -> goal-gate -> report', () => {
  const { top, repo } = fixture()
  try {
    const d = open(repo, 'beta')
    const stage = () => run(repo)[0].stage
    assert.equal(stage(), 'plan')
    put(d, '01-plan.md', '# plan')
    assert.equal(stage(), 'setgoal')
    put(d, '02-goal-spec.json', spec(['s1']))
    assert.equal(stage(), 'critique')
    put(d, '02-critique.json', { sound: true })
    assert.equal(stage(), 'implement')
    put(d, 'subgoals/s1/result.json', { passed: true })
    assert.equal(stage(), 'goal-gate')
    put(d, '04-goal-gate.json')
    assert.equal(stage(), 'report')
  } finally {
    rmSync(top, { recursive: true, force: true })
  }
})

test('a run with 05-report.md is excluded', () => {
  const { top, repo } = fixture()
  try {
    const d = open(repo, 'done')
    put(d, '05-report.md', '# report')
    assert.deepEqual(run(repo), [])
  } finally {
    rmSync(top, { recursive: true, force: true })
  }
})

test('a run untouched for 13 h is excluded', () => {
  const { top, repo } = fixture()
  try {
    const d = open(repo, 'old')
    const old = new Date(Date.now() - 13 * 60 * 60 * 1000)
    utimesSync(join(d, 'manifest.json'), old, old)
    utimesSync(d, old, old)
    assert.deepEqual(run(repo), [])
  } finally {
    rmSync(top, { recursive: true, force: true })
  }
})

test('the broker dir is excluded', () => {
  const { top, repo } = fixture()
  try {
    open(repo, 'broker')
    assert.deepEqual(run(repo), [])
  } finally {
    rmSync(top, { recursive: true, force: true })
  }
})

test('a dir without a manifest is not a run; a non-repo root still answers', () => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'mods-runs-')))
  try {
    mkdirSync(join(top, '.harness-run', 'nomanifest'), { recursive: true })
    assert.deepEqual(run(top), [])
    open(top, 'solo')
    assert.deepEqual(run(top).map(r => r.slug), ['solo'])
  } finally {
    rmSync(top, { recursive: true, force: true })
  }
})
