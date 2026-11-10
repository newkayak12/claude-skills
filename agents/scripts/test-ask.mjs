import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ask, claudeAnswer, command, DEPTH_ENV, nested, parseArgs } from './ask.mjs'

// A fake CLI on PATH: records its argv and stdin, answers like the real one.
function fakeBin(name, body) {
  const dir = mkdtempSync(join(tmpdir(), 'ask-bin-'))
  const p = join(dir, name)
  writeFileSync(p, `#!/bin/sh\n${body}\n`)
  chmodSync(p, 0o755)
  return dir
}
const brief = () => {
  const d = mkdtempSync(join(tmpdir(), 'ask-brief-'))
  const f = join(d, 'brief.md')
  writeFileSync(f, '질문: 이 설계에서 놓친 위험은?\n')
  return f
}
const env = bin => ({ ...process.env, PATH: `${bin}:/usr/bin:/bin`, [DEPTH_ENV]: '' })

test('codex runs read only, without a session, in the given directory, the brief on stdin', () => {
  const argv = command('codex', { cwd: '/w', model: 'gpt-5', last: '/t/last.md' })
  assert.deepEqual(argv.slice(0, 2), ['codex', 'exec'])
  for (const flag of ['--sandbox', 'read-only', '--ephemeral', '--skip-git-repo-check']) assert.ok(argv.includes(flag), flag)
  assert.deepEqual(argv.slice(argv.indexOf('-C'), argv.indexOf('-C') + 2), ['-C', '/w'])
  assert.deepEqual(argv.slice(argv.indexOf('-m'), argv.indexOf('-m') + 2), ['-m', 'gpt-5'])
  assert.equal(argv.at(-1), '-')
})

test('claude runs with reading tools only and every other tool denied, no session kept', () => {
  const argv = command('claude', { cwd: '/w' })
  assert.deepEqual(argv.slice(0, 2), ['claude', '-p'])
  assert.deepEqual(argv.slice(argv.indexOf('--permission-mode'), argv.indexOf('--permission-mode') + 2), ['--permission-mode', 'dontAsk'])
  assert.equal(argv[argv.indexOf('--allowedTools') + 1], 'Read,Grep,Glob')
  assert.ok(argv.includes('--no-session-persistence'))
  assert.ok(!argv.includes('--model'))
})

test('an unknown target is refused', () => {
  assert.throws(() => command('gemini', {}), /codex or claude/)
})

test('codex: the answer is its last message; the child is marked as a second opinion', async () => {
  const bin = fakeBin('codex', [
    'out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done',
    'cat > /dev/null',
    `printf '다른 의견: 캐시 무효화가 빠져 있습니다 (depth %s)\\n' "$${DEPTH_ENV}" > "$out"`,
  ].join('\n'))
  const r = await ask({ to: 'codex', promptFile: brief(), cwd: tmpdir() }, env(bin))
  assert.equal(r.exit, 0)
  assert.equal(r.answer, '다른 의견: 캐시 무효화가 빠져 있습니다 (depth 1)')
})

test('claude: the answer is `result` of its JSON; is_error becomes an error', async () => {
  let bin = fakeBin('claude', `cat > /dev/null\necho '{"type":"result","is_error":false,"result":"동의하지 않습니다: 락 범위가 넓습니다","model":"claude-x"}'`)
  let r = await ask({ to: 'claude', promptFile: brief() }, env(bin))
  assert.equal(r.answer, '동의하지 않습니다: 락 범위가 넓습니다')
  assert.equal(r.model, 'claude-x')
  bin = fakeBin('claude', `cat > /dev/null\necho '{"type":"result","is_error":true,"result":"Not logged in"}'`)
  r = await ask({ to: 'claude', promptFile: brief() }, env(bin))
  assert.match(r.error, /Not logged in/)
})

test('a second opinion never asks for a third, whatever the marker holds', async () => {
  for (const v of ['1', '2', 'abc', ' yes ']) {
    const r = await ask({ to: 'codex', promptFile: brief() }, { ...process.env, [DEPTH_ENV]: v })
    assert.match(r.error, /already a second opinion/, v)
  }
  assert.equal(nested({ [DEPTH_ENV]: '' }), false)
  assert.equal(nested({ [DEPTH_ENV]: '0' }), false)
})

test('claude is also told, explicitly, no shell, no edits, no web, no MCP servers', () => {
  const argv = command('claude', { cwd: '/w' })
  const deny = argv[argv.indexOf('--disallowedTools') + 1].split(',')
  for (const t of ['Bash', 'Edit', 'Write', 'WebFetch', 'Agent']) assert.ok(deny.includes(t), t)
  assert.ok(argv.includes('--strict-mcp-config'))
  assert.equal(argv[argv.indexOf('--tools') + 1], 'Read,Grep,Glob', 'only the reading tools exist at all')
  const cx = command('codex', { cwd: '/w', last: '/l' })
  assert.equal(cx[cx.indexOf('-c') + 1], 'mcp_servers={}', 'codex loads no MCP server')
})

test('the CLI entry runs from a path with spaces and % in it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ask dir %20 #'))
  const copy = join(dir, 'ask.mjs')
  writeFileSync(copy, readFileSync(new URL('./ask.mjs', import.meta.url)))
  const r = spawnSync(process.execPath, [copy, '--to', 'gemini'], { encoding: 'utf8' })
  assert.match(r.stdout, /codex or claude/)
  assert.equal(r.status, 1)
})

test('a child that ignores SIGTERM is killed; one that exits before reading the brief does not crash the script', async () => {
  let bin = fakeBin('claude', "trap '' TERM\nsleep 30")
  const t0 = Date.now()
  let r = await ask({ to: 'claude', promptFile: brief(), timeout: '1' }, env(bin))
  assert.match(r.error, /no answer within 1s/)
  assert.ok(Date.now() - t0 < 12000, 'stopped within the grace period')
  bin = fakeBin('claude', 'exit 4')
  r = await ask({ to: 'claude', promptFile: brief() }, env(bin))
  assert.equal(r.exit, 4)
})

test('codex reporting a sandbox that never started is an error naming --attach; --attach puts the files in the brief', async () => {
  let bin = fakeBin('codex', [
    'out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done',
    'cat > /dev/null',
    `echo 'Verdict: blocked — bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted' > "$out"`,
  ].join('\n'))
  let r = await ask({ to: 'codex', promptFile: brief(), cwd: tmpdir() }, env(bin))
  assert.equal(r.sandbox_down, true)
  assert.match(r.error, /--attach/)
  const dir = mkdtempSync(join(tmpdir(), 'ask-att-'))
  writeFileSync(join(dir, 'a.js'), 'const x = 1\nconst y = 2\n')
  bin = fakeBin('codex', [
    'out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done',
    'cat > "$out"',
  ].join('\n'))
  r = await ask({ to: 'codex', promptFile: brief(), cwd: dir, attach: 'a.js' }, env(bin))
  assert.match(r.answer, /----- a\.js -----/)
  assert.match(r.answer, / {3}2 {2}const y = 2/)
  assert.deepEqual(r.attached, ['a.js'])
  r = await ask({ to: 'codex', promptFile: brief(), cwd: dir, attach: 'missing.js' }, env(bin))
  assert.match(r.error, /--attach missing\.js/)
})

test('claude output that is not valid JSON is an error, not a crash', async () => {
  const bin = fakeBin('claude', "cat > /dev/null\necho '{not json'")
  const r = await ask({ to: 'claude', promptFile: brief() }, env(bin))
  assert.match(r.error, /not json/)
})

test('a missing CLI, a missing brief and a silent or failing child are errors that say why', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'ask-empty-'))
  mkdirSync(join(empty, 'x'))
  let r = await ask({ to: 'codex', promptFile: brief() }, { ...process.env, PATH: empty, [DEPTH_ENV]: '' })
  assert.match(r.error, /codex is not on PATH/)
  r = await ask({ to: 'claude', promptFile: '/nope.md' }, process.env)
  assert.match(r.error, /--prompt-file/)
  const bin = fakeBin('codex', 'cat > /dev/null\necho "auth required" >&2\nexit 3')
  r = await ask({ to: 'codex', promptFile: brief() }, env(bin))
  assert.equal(r.exit, 3)
  assert.match(r.error, /auth required/)
})

test('a child past its timeout is stopped and reported', async () => {
  const mark = join(mkdtempSync(join(tmpdir(), 'ask-mark-')), 'alive')
  const bin = fakeBin('claude', `sleep 3 && touch '${mark}'`)
  const t0 = Date.now()
  const r = await ask({ to: 'claude', promptFile: brief(), timeout: '1' }, env(bin))
  assert.match(r.error, /no answer within 1s/)
  assert.ok(Date.now() - t0 < 2500, 'ask returned at the timeout, not when the child would have ended')
  await new Promise(res => setTimeout(res, 3000))
  assert.ok(!existsSync(mark), 'the child was stopped: it never reached its next command')
})

test('--act bypasses permissions on both CLIs; without it nothing does', () => {
  const cx = command('codex', { cwd: '/w', last: '/l', act: true })
  assert.ok(cx.includes('--dangerously-bypass-approvals-and-sandbox'))
  assert.ok(!cx.includes('read-only'))
  assert.equal(cx[cx.indexOf('-c') + 1], 'mcp_servers={}')
  const cl = command('claude', { cwd: '/w', act: true, model: 'sonnet' })
  assert.equal(cl[cl.indexOf('--permission-mode') + 1], 'bypassPermissions')
  assert.ok(!cl.includes('--disallowedTools') && !cl.includes('--tools'), 'every tool is there')
  assert.ok(cl.includes('--strict-mcp-config') && cl.includes('--no-session-persistence'))
  for (const to of ['codex', 'claude']) {
    const ro = command(to, { cwd: '/w', last: '/l' }).join(' ')
    assert.doesNotMatch(ro, /bypass/, to)
  }
  assert.equal(parseArgs(['--act', '--to', 'codex']).act, true)
})

test('--act reports the files the child changed and whether it committed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ask-act-'))
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' })
  git('init', '-q')
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  writeFileSync(join(dir, 'dirty.txt'), 'x\n')
  git('add', 'a.txt'); git('commit', '-qm', 'init')
  // dirty.txt was untracked before and is left alone; a.txt is edited; 새.txt is new
  const bin = fakeBin('claude', `cat > /dev/null\necho two >> a.txt\necho hi > '새.txt'\necho '{"result":"done","is_error":false}'`)
  let r = await ask({ to: 'claude', promptFile: brief(), cwd: dir, act: true }, env(bin))
  assert.equal(r.mode, 'act')
  assert.equal(r.answer, 'done')
  assert.deepEqual(r.changed.sort(), [' M a.txt', '?? 새.txt'])
  assert.equal(r.head_moved, false)
  // a child that commits, then fails, still reports it
  const bin2 = fakeBin('claude', `cat > /dev/null\ngit -c user.name=t -c user.email=t@t commit -qam x\nexit 2`)
  r = await ask({ to: 'claude', promptFile: brief(), cwd: dir, act: true }, env(bin2))
  assert.equal(r.exit, 2)
  assert.equal(r.head_moved, true)
  assert.deepEqual(r.changed, [], 'a.txt is committed, so no longer a change')
  // read mode never looks
  r = await ask({ to: 'claude', promptFile: brief(), cwd: dir }, env(bin))
  assert.equal(r.changed, undefined)
  assert.equal(r.mode, 'read')
  // outside a git repo the change list is unknown, not empty
  const plain = mkdtempSync(join(tmpdir(), 'ask-plain-'))
  r = await ask({ to: 'claude', promptFile: brief(), cwd: plain, act: true }, env(bin))
  assert.equal(r.changed, null)
})

test('--dry-run prints the command and runs nothing; args parse', async () => {
  // PATH has no codex: a run that went past the dry-run return would answer "not on PATH"
  const r = await ask({ to: 'codex', promptFile: brief(), dryRun: true, cwd: '/w' }, { ...process.env, PATH: '/nowhere' })
  assert.equal(r.error, undefined)
  assert.equal(r.command[0], 'codex')
  assert.equal(r.answer, undefined)
  const cli = spawnSync(process.execPath, [new URL('./ask.mjs', import.meta.url).pathname, '--to', 'claude',
    '--prompt-file', brief(), '--dry-run'], { encoding: 'utf8', env: { ...process.env, PATH: '/nowhere', [DEPTH_ENV]: '' } })
  assert.equal(JSON.parse(cli.stdout).command[0], 'claude', 'the CLI prints the command')
  assert.deepEqual(parseArgs(['--to', 'claude', '--prompt-file', 'b.md', '--dry-run']), { to: 'claude', promptFile: 'b.md', dryRun: true })
  assert.deepEqual(claudeAnswer('noise\n{"result":"ok"}\n'), { answer: 'ok', isError: false, model: undefined })
})
