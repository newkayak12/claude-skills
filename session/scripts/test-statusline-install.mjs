import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync,
  symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseArgs, settingsPath, dataDirFrom, normalizeDir, commandFor, isOurs, decide, serialize,
} from './statusline-install-logic.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const CLI = join(here, 'statusline-install.mjs')
const FIXTURE = JSON.stringify({ model: { display_name: 'Opus' }, context_window: { used_percentage: 10 } })

// every CLI test lives in its own mkdtemp dir; HOME and CLAUDE_CONFIG_DIR point into it,
// so nothing here can resolve the real ~/.claude/settings.json
function sandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sl-install-')))
  const cfg = join(root, 'cfg')
  mkdirSync(cfg)
  return {
    root,
    settings: join(root, 'settings.json'),
    data: join(root, 'data'),
    run(args, { input } = {}) {
      return spawnSync(process.execPath, [CLI, ...args], {
        encoding: 'utf8',
        input,
        env: { ...process.env, HOME: root, CLAUDE_CONFIG_DIR: cfg },
      })
    },
    cli(mode, extra = []) {
      return this.run([mode, '--settings', this.settings, '--data', this.data, ...extra])
    },
    write(obj) {
      writeFileSync(this.settings, typeof obj === 'string' ? obj : serialize(obj))
    },
    read() {
      return readFileSync(this.settings, 'utf8')
    },
    json() {
      return JSON.parse(this.read())
    },
    done() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

const CMD = 'node "/d/statusline/statusline.mjs"'
const OURS = { type: 'command', command: CMD }
const FOREIGN = { type: 'command', command: 'echo mine' }
const opts = (mode, extra = {}) => ({ mode, ...extra })

test('decide: show', () => {
  for (const s of [{}, { statusLine: OURS }, { statusLine: FOREIGN }]) {
    const r = decide(s, CMD, opts('show'))
    assert.equal(r.action, 'show')
    assert.equal(r.exit, 0)
    assert.deepEqual(r.next.statusLine, OURS)
  }
})

test('decide: add', () => {
  const s = { theme: 'dark' }
  const r = decide(s, CMD, opts('on'))
  assert.deepEqual([r.action, r.exit, r.current], ['add', 0, null])
  assert.deepEqual(r.next, { theme: 'dark', statusLine: OURS })
  assert.deepEqual(s, { theme: 'dark' })
})

test('decide: refresh', () => {
  const s = { statusLine: OURS }
  const r = decide(s, CMD, opts('on'))
  assert.deepEqual([r.action, r.exit], ['refresh', 0])
  assert.equal(serialize(r.next), serialize(s))
})

test('decide: blocked', () => {
  const s = { a: 1, statusLine: FOREIGN }
  const r = decide(s, CMD, opts('on'))
  assert.deepEqual([r.action, r.exit], ['blocked', 3])
  assert.equal(serialize(r.next), serialize(s))
  assert.equal(decide(s, CMD, opts('on', { replace: false })).action, 'blocked')
})

test('decide: replace', () => {
  const r = decide({ a: 1, statusLine: FOREIGN, z: 2 }, CMD, opts('on', { replace: true }))
  assert.deepEqual([r.action, r.exit], ['replace', 0])
  assert.deepEqual(r.current, FOREIGN)
  assert.deepEqual(Object.keys(r.next), ['a', 'statusLine', 'z'])
  assert.deepEqual(r.next.statusLine, OURS)
})

test('decide: remove', () => {
  const r = decide({ b: 1, statusLine: OURS, a: { x: [1, 2] } }, CMD, opts('off'))
  assert.deepEqual([r.action, r.exit], ['remove', 0])
  assert.equal(serialize(r.next), serialize({ b: 1, a: { x: [1, 2] } }))
})

test('decide: absent', () => {
  const s = { a: 1 }
  const r = decide(s, CMD, opts('off'))
  assert.deepEqual([r.action, r.exit], ['absent', 0])
  assert.equal(serialize(r.next), serialize(s))
})

test('decide: foreign-kept', () => {
  const s = { a: 1, statusLine: FOREIGN }
  const r = decide(s, CMD, opts('off', { replace: true }))
  assert.deepEqual([r.action, r.exit], ['foreign-kept', 0])
  assert.equal(serialize(r.next), serialize(s))
})

test('decide: --replace absent never changes a foreign entry', () => {
  for (const mode of ['show', 'on', 'off']) {
    const s = { statusLine: FOREIGN }
    const r = decide(s, CMD, opts(mode, { replace: false }))
    if (mode !== 'show') assert.deepEqual(r.next.statusLine, FOREIGN)
  }
})

test('isOurs: exact command only', () => {
  assert.equal(isOurs(OURS, CMD), true)
  assert.equal(isOurs({ type: 'command', command: 'node /d/statusline/statusline.mjs' }, CMD), true)
  assert.equal(isOurs({ type: 'command', command: `${CMD} --x` }, CMD), false)
  assert.equal(isOurs({ type: 'command', command: 'bash "/d/statusline/statusline.mjs"' }, CMD), false)
  assert.equal(isOurs({ type: 'text', command: CMD }, CMD), false)
  assert.equal(isOurs(null, CMD), false)
  assert.equal(isOurs({ type: 'command', command: 'node "/e/statusline/statusline.mjs"' }, CMD, [commandFor('/e')]), true)
})

test('parseArgs: modes, flags, errors', () => {
  assert.deepEqual(parseArgs([]), { mode: 'show', replace: false, data: undefined, settings: undefined })
  const r = parseArgs(['on', '--replace', '--data', '/x', '--settings', '/y'])
  assert.deepEqual(r, { mode: 'on', replace: true, data: '/x', settings: '/y' })
  assert.ok(parseArgs(['--data']).error)
  assert.ok(parseArgs(['--nope']).error)
  assert.equal(parseArgs(['--data', '']).data, '')
})

test('settingsPath honours CLAUDE_CONFIG_DIR', () => {
  assert.equal(settingsPath({ CLAUDE_CONFIG_DIR: '/c' }, '/h'), '/c/settings.json')
  assert.equal(settingsPath({}, '/h'), '/h/.claude/settings.json')
})

test('commandFor quotes the path, spaces included', () => {
  assert.equal(commandFor('/a b'), 'node "/a b/statusline/statusline.mjs"')
  assert.equal(isOurs({ type: 'command', command: commandFor('/a b') }, commandFor('/a b')), true)
})

test('dataDirFrom: explicit', () => {
  const r = dataDirFrom({ data: '/x/data', scriptPath: '/r/scripts/s.mjs', env: {}, home: '/h' })
  assert.deepEqual(r, { dir: '/x/data', source: 'given' })
})

test('dataDirFrom: literal placeholder', () => {
  const scriptPath = '/h/.claude/plugins/cache/m/session/1.0.0/scripts/statusline-install.mjs'
  for (const data of ['${CLAUDE_PLUGIN_DATA}', '', undefined]) {
    const r = dataDirFrom({ data, scriptPath, env: {}, home: '/h' })
    assert.deepEqual(r, { dir: '/h/.claude/plugins/data/session-m', source: 'derived-cache' })
  }
})

test('dataDirFrom: cache path', () => {
  const r = dataDirFrom({
    scriptPath: '/c/plugins/cache/mkt-x/session/0.14.1/scripts/statusline-install.mjs', env: { CLAUDE_CONFIG_DIR: '/other' }, home: '/h',
  })
  assert.deepEqual(r, { dir: '/c/plugins/data/session-mkt-x', source: 'derived-cache' })
})

test('dataDirFrom: inline path', () => {
  const scriptPath = '/repo/session/scripts/statusline-install.mjs'
  assert.deepEqual(dataDirFrom({ scriptPath, env: {}, home: '/h' }),
    { dir: '/h/.claude/plugins/data/session-inline', source: 'derived-inline' })
  assert.deepEqual(dataDirFrom({ data: '${CLAUDE_PLUGIN_DATA}', scriptPath, env: { CLAUDE_CONFIG_DIR: '/c' }, home: '/h' }),
    { dir: '/c/plugins/data/session-inline', source: 'derived-inline' })
})

test('dataDirFrom: cache dir refused', () => {
  const r = dataDirFrom({ data: '/h/.claude/plugins/cache/m/session/1.0.0', scriptPath: '/r/s.mjs', env: {}, home: '/h' })
  assert.ok(r.error)
  assert.equal(r.dir, undefined)
  assert.ok(dataDirFrom({ data: '/h/.claude/plugins/cache', scriptPath: '/r/s.mjs', env: {}, home: '/h' }).error)
})

test('normalizeDir drops trailing slash and dots', () => {
  assert.equal(normalizeDir('/a/b/'), '/a/b')
  assert.equal(normalizeDir('/a/x/../b'), '/a/b')
})

test('normalize: trailing slash', () => {
  const sb = sandbox()
  try {
    sb.write({ theme: 'dark' })
    assert.equal(sb.run(['on', '--settings', sb.settings, '--data', `${sb.data}/`]).status, 0)
    assert.ok(sb.json().statusLine)
    const off = sb.cli('off')
    assert.equal(off.status, 0, off.stderr)
    assert.deepEqual(sb.json(), { theme: 'dark' })
  } finally { sb.done() }
})

test('normalize: substituted equals derived', () => {
  const cfg = '/tmp/cfgx'
  const given = dataDirFrom({ data: `${cfg}/plugins/data/session-m`, scriptPath: '/r/s.mjs', env: {}, home: '/h' })
  const derived = dataDirFrom({
    scriptPath: `${cfg}/plugins/cache/m/session/1.0.0/scripts/statusline-install.mjs`, env: {}, home: '/h',
  })
  assert.equal(commandFor(given.dir), commandFor(derived.dir))
  assert.equal(given.source, 'given')
  assert.equal(derived.source, 'derived-cache')
})

test('normalize: symlinked data dir', () => {
  const sb = sandbox()
  try {
    const real = join(sb.root, 'realdata')
    mkdirSync(real)
    const link = join(sb.root, 'linkdata')
    symlinkSync(real, link)
    sb.write({ theme: 'dark' })
    assert.equal(sb.run(['on', '--settings', sb.settings, '--data', link]).status, 0)
    assert.ok(existsSync(join(real, 'statusline', 'statusline.mjs')))
    const off = sb.run(['off', '--settings', sb.settings, '--data', real])
    assert.equal(off.status, 0, off.stderr)
    assert.deepEqual(sb.json(), { theme: 'dark' })
    assert.ok(!existsSync(join(real, 'statusline')))
  } finally { sb.done() }
})

test('cli: on renders', () => {
  const sb = sandbox()
  try {
    const r = sb.cli('on')
    assert.equal(r.status, 0, r.stderr)
    const command = `node "${join(sb.data, 'statusline', 'statusline.mjs')}"`
    assert.deepEqual(sb.json(), { statusLine: { type: 'command', command } })
    assert.deepEqual(readdirSync(join(sb.data, 'statusline')).sort(), ['statusline-logic.mjs', 'statusline.mjs'])
    const line = spawnSync(command, { shell: true, input: FIXTURE, encoding: 'utf8' })
    assert.equal(line.status, 0)
    assert.ok(line.stdout.includes('🤖'), line.stdout)
    assert.ok(!readdirSync(sb.root).some(f => f.includes('.tmp-')))
  } finally { sb.done() }
})

test('cli: show unchanged', () => {
  const sb = sandbox()
  try {
    sb.write({ theme: 'dark', statusLine: FOREIGN })
    const before = [sb.read(), statSync(sb.settings).mtimeMs]
    const r = sb.cli('show')
    assert.equal(r.status, 0)
    assert.deepEqual([sb.read(), statSync(sb.settings).mtimeMs], before)
    assert.ok(!existsSync(sb.data))
    assert.match(r.stdout, new RegExp(`settings: ${sb.settings}`))
    assert.match(r.stdout, /data: .* \(given\)/)
    assert.match(r.stdout, /current: \{"type":"command","command":"echo mine"\}/)
    assert.match(r.stdout, /will write/)
    assert.match(sb.run(['--settings', join(sb.root, 'none.json')]).stdout, /current: none[\s\S]*\(derived-inline\)|\(derived-inline\)[\s\S]*current: none/)
  } finally { sb.done() }
})

test('cli: blocked', () => {
  const sb = sandbox()
  try {
    sb.write({ theme: 'dark', statusLine: FOREIGN })
    const before = sb.read()
    const r = sb.cli('on')
    assert.equal(r.status, 3)
    assert.match(r.stdout, /your own statusLine is set; rerun with --replace only after the person agrees/)
    assert.equal(sb.read(), before)
    assert.ok(!existsSync(sb.data))
  } finally { sb.done() }
})

test('cli: replace', () => {
  const sb = sandbox()
  try {
    sb.write({ theme: 'dark', statusLine: FOREIGN })
    const r = sb.cli('on', ['--replace'])
    assert.equal(r.status, 0, r.stderr)
    const j = sb.json()
    assert.equal(j.theme, 'dark')
    assert.equal(j.statusLine.command, `node "${join(sb.data, 'statusline', 'statusline.mjs')}"`)
    assert.deepEqual(JSON.parse(readFileSync(join(sb.data, 'statusline', 'previous.json'), 'utf8')), FOREIGN)
    assert.match(r.stdout, /echo mine/)
  } finally { sb.done() }
})

test('cli: off keeps other keys', () => {
  const sb = sandbox()
  try {
    sb.write({ z: 1, a: { b: [1] } })
    assert.equal(sb.cli('on').status, 0)
    const withOurs = sb.json()
    withOurs.after = true
    sb.write(withOurs)
    const r = sb.cli('off')
    assert.equal(r.status, 0, r.stderr)
    assert.equal(sb.read(), serialize({ z: 1, a: { b: [1] }, after: true }))
    assert.ok(!existsSync(join(sb.data, 'statusline')))
    assert.match(r.stdout, /removed:/)
    assert.match(r.stdout, /removed files: .*statusline\.mjs/)
    assert.doesNotMatch(r.stdout, /^files:/m)
  } finally { sb.done() }
})

test('cli: off foreign', () => {
  const sb = sandbox()
  try {
    sb.write({ statusLine: FOREIGN, a: 1 })
    const before = sb.read()
    const r = sb.cli('off')
    assert.equal(r.status, 0)
    assert.equal(sb.read(), before)
    assert.match(r.stdout, /not ours, left alone/)
  } finally { sb.done() }
})

test('cli: off absent', () => {
  const sb = sandbox()
  try {
    sb.write({ a: 1 })
    const before = sb.read()
    const r = sb.cli('off')
    assert.equal(r.status, 0)
    assert.equal(sb.read(), before)
    assert.equal(sb.cli('off').status, 0)
  } finally { sb.done() }
})

test('cli: refresh', () => {
  const sb = sandbox()
  try {
    assert.equal(sb.cli('on').status, 0)
    const copy = join(sb.data, 'statusline', 'statusline.mjs')
    const before = sb.read()
    writeFileSync(copy, '// stale\n')
    const r = sb.cli('on')
    assert.equal(r.status, 0, r.stderr)
    assert.equal(sb.read(), before)
    assert.equal(readFileSync(copy, 'utf8'), readFileSync(join(here, 'statusline.mjs'), 'utf8'))
    assert.match(r.stdout, /recopied/)
  } finally { sb.done() }
})

test('cli: unparsable', () => {
  const sb = sandbox()
  try {
    for (const body of ['{ not json', '[1,2]', 'null']) {
      sb.write(body)
      for (const mode of ['on', 'off']) {
        const r = sb.cli(mode, ['--replace'])
        assert.equal(r.status, 2, body)
        assert.equal(sb.read(), body)
      }
    }
    assert.ok(!existsSync(sb.data))
  } finally { sb.done() }
})

test('cli: symlinked settings', () => {
  const sb = sandbox()
  try {
    const target = join(sb.root, 'dotfiles.json')
    writeFileSync(target, serialize({ theme: 'dark' }))
    symlinkSync(target, sb.settings)
    const r = sb.cli('on')
    assert.equal(r.status, 0, r.stderr)
    assert.ok(sb.settings && statSync(sb.settings).isFile())
    assert.equal(realpathSync(sb.settings), target)
    assert.ok(JSON.parse(readFileSync(target, 'utf8')).statusLine)
    assert.ok(!readdirSync(sb.root).some(f => f.includes('.tmp-')))
    assert.equal(sb.cli('off').status, 0)
    assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { theme: 'dark' })
  } finally { sb.done() }
})

test('cli: mode casing', () => {
  const sb = sandbox()
  try {
    assert.equal(sb.cli(' ON ').status, 0)
    assert.ok(sb.json().statusLine)
    assert.equal(sb.cli('OFF').status, 0)
    assert.ok(!('statusLine' in sb.json()))
    const r = sb.run(['--settings', sb.settings, '--data', sb.data])
    assert.equal(r.status, 0)
    assert.match(r.stdout, /will write/)
  } finally { sb.done() }
})

test('cli: unknown mode', () => {
  const sb = sandbox()
  try {
    const r = sb.cli('toggle')
    assert.equal(r.status, 2)
    assert.match(r.stderr, /usage:/)
    assert.ok(!existsSync(sb.settings))
    assert.ok(!existsSync(sb.data))
  } finally { sb.done() }
})

test('cli: two mode words', () => {
  const sb = sandbox()
  try {
    for (const words of [['show', 'off'], ['on', 'on'], ['on', 'off']]) {
      const r = sb.run([...words, '--settings', sb.settings, '--data', sb.data])
      assert.equal(r.status, 2, words.join(' '))
      assert.match(r.stderr, /usage:/)
    }
    assert.ok(!existsSync(sb.settings))
    assert.ok(!existsSync(sb.data))
  } finally { sb.done() }
})

test('cli: extra args foreign', () => {
  const sb = sandbox()
  try {
    const script = join(sb.data, 'statusline', 'statusline.mjs')
    for (const command of [`node "${script}" --x`, `bash "${script}"`]) {
      sb.write({ statusLine: { type: 'command', command } })
      const before = sb.read()
      assert.equal(sb.cli('on').status, 3, command)
      assert.equal(sb.cli('off').status, 0)
      assert.equal(sb.read(), before)
    }
    sb.write({ statusLine: { type: 'command', command: `node ${script}` } })
    assert.equal(sb.cli('on').status, 0)
  } finally { sb.done() }
})

test('cli: off after replace', () => {
  const sb = sandbox()
  try {
    sb.write({ theme: 'dark', statusLine: FOREIGN })
    assert.equal(sb.cli('on', ['--replace']).status, 0)
    const r = sb.cli('off')
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(sb.json(), { theme: 'dark' })
    const prev = join(sb.data, 'statusline', 'previous.json')
    assert.ok(r.stdout.includes(prev))
    assert.deepEqual(JSON.parse(readFileSync(prev, 'utf8')), FOREIGN)
    assert.ok(!existsSync(join(sb.data, 'statusline', 'statusline.mjs')))
  } finally { sb.done() }
})

test('cli: data dir inside plugin cache refused', () => {
  const sb = sandbox()
  try {
    const bad = join(sb.root, 'plugins', 'cache', 'm', 'session', '1.0.0')
    const r = sb.run(['on', '--settings', sb.settings, '--data', bad])
    assert.equal(r.status, 2)
    assert.ok(!existsSync(sb.settings))
    assert.ok(!existsSync(bad))
  } finally { sb.done() }
})

test('cli: no --data derives the inline dir under CLAUDE_CONFIG_DIR', () => {
  const sb = sandbox()
  try {
    const r = sb.run(['on', '--settings', sb.settings, '--data', '${CLAUDE_PLUGIN_DATA}'])
    assert.equal(r.status, 0, r.stderr)
    const want = join(sb.root, 'cfg', 'plugins', 'data', 'session-inline')
    assert.match(r.stdout, new RegExp(`data: ${want} \\(derived-inline\\)`))
    assert.ok(existsSync(join(want, 'statusline', 'statusline.mjs')))
  } finally { sb.done() }
})
