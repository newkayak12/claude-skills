// node --test session/scripts/test-precompact.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  BRIDGE_MAX_AGE_MS,
  COMPACT_MARK,
  EXTEND_PREFACE,
  RECAP_PROMPT,
  bridgeFresh,
  handoffBridgePath,
  hashRoot,
  makeBridgeRecord,
  precompactInstructions,
} from './precompact-logic.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const SECTIONS = ['Goal', 'Direction', 'In progress', 'Decisions', 'Open', 'Corrections']

test('auto emits the six sections', () => {
  const out = precompactInstructions({ trigger: 'auto' }, {})
  for (const s of SECTIONS) assert.ok(out.includes(s), s)
})

test('auto with other instructions emits', () => {
  const out = precompactInstructions({ trigger: 'auto', custom_instructions: 'keep the code' }, {})
  assert.ok(out.includes(RECAP_PROMPT))
})

test('manual without the mark is a no-op', () => {
  assert.equal(precompactInstructions({ trigger: 'manual' }, {}), '')
  assert.equal(precompactInstructions({ trigger: 'manual', custom_instructions: 'keep the code' }, {}), '')
})

test('the mark is a no-op on auto and manual', () => {
  for (const trigger of ['auto', 'manual']) {
    assert.equal(precompactInstructions({ trigger, custom_instructions: `${COMPACT_MARK}: x` }, {}), '')
    assert.equal(precompactInstructions({ trigger, custom_instructions: `  ${COMPACT_MARK}` }, {}), '')
  }
})

test('off is a no-op, true emits', () => {
  const input = { trigger: 'auto' }
  assert.equal(precompactInstructions(input, { CLAUDE_PLUGIN_OPTION_SMART_COMPACT_ENABLED: 'false' }), '')
  assert.ok(precompactInstructions(input, { CLAUDE_PLUGIN_OPTION_SMART_COMPACT_ENABLED: 'true' }).includes(RECAP_PROMPT))
})

test('null, empty and non-object input is a no-op', () => {
  for (const input of [null, undefined, {}, 'auto', 7, [], true]) assert.equal(precompactInstructions(input, {}), '')
})

const CLI = join(here, 'precompact.mjs')
const spawn = (input, env = {}) =>
  spawnSync('node', [CLI], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_OPTION_SMART_COMPACT_ENABLED: '', ...env } })

test('spawn: auto exits 0 with plain text', () => {
  const r = spawn(JSON.stringify({ trigger: 'auto' }))
  assert.equal(r.status, 0)
  assert.ok(r.stdout.includes(RECAP_PROMPT))
  assert.throws(() => JSON.parse(r.stdout))
})

test('spawn: malformed and manual exit 0 with empty stdout', () => {
  for (const input of ['not json', '', JSON.stringify({ trigger: 'manual' })]) {
    const r = spawn(input)
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
  }
})

test('RECAP_PROMPT and COMPACT_MARK match recap.ts and compact-logic.ts', () => {
  const recap = readFileSync(join(here, '../hooks/recap.ts'), 'utf8')
  const m = recap.match(/export const RECAP_PROMPT = `([^`]*)`/)
  assert.ok(m, 'template found in recap.ts')
  assert.ok(!m[1].includes('${') && !m[1].includes('\\'), 'template has no interpolation or escapes')
  assert.equal(RECAP_PROMPT, m[1])
  const logic = readFileSync(join(here, '../hooks/compact-logic.ts'), 'utf8')
  const c = logic.match(/export const COMPACT_MARK = '([^']*)'/)
  assert.ok(c, 'COMPACT_MARK found in compact-logic.ts')
  assert.equal(COMPACT_MARK, c[1])
})

// ---- bridge file: the stored handoff for an auto-compact ----
// PreCompact stdin field names (session_id, transcript_path, cwd, trigger, custom_instructions) are a default to revisit.
const HANDOFF = 'STORED HANDOFF TEXT'
const lines3 = [{ uuid: 'u1' }, { uuid: 'u2' }, { uuid: 'u3' }, { uuid: 'u4' }].map((o) => JSON.stringify(o))

function setup({ record = {}, rawBridge, bridgeAt, transcript = lines3.join('\n') + '\n', skipBridge = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'pc-home-'))
  const root = mkdtempSync(join(tmpdir(), 'pc-root-'))
  const cwd = join(root, 'sub')
  mkdirSync(cwd)
  const tp = join(root, 'transcript.jsonl')
  if (transcript !== null) writeFileSync(tp, transcript)
  const bp = handoffBridgePath(home, bridgeAt ?? root)
  if (!skipBridge) {
    mkdirSync(dirname(bp), { recursive: true })
    if (rawBridge === 'dir') mkdirSync(bp)
    else
      writeFileSync(
        bp,
        rawBridge ??
          JSON.stringify(
            makeBridgeRecord({ key: 'k', sessionId: 's1', ts: Date.now(), text: HANDOFF, lastUuid: 'u3', lineCount: 3, ...record }),
          ),
      )
  }
  const stdin = (extra = {}) => JSON.stringify({ trigger: 'auto', session_id: 's1', transcript_path: tp, cwd, ...extra })
  return { home, root, cwd, tp, bp, stdin }
}
const run = (s, extra, env = {}) => spawn(s.stdin(extra), { HOME: s.home, ...env })

test('bridge: fresh record prints handoff, extend preface, then static sections', () => {
  const s = setup()
  const r = run(s)
  assert.equal(r.status, 0)
  const a = r.stdout.indexOf(HANDOFF)
  const b = r.stdout.indexOf(EXTEND_PREFACE)
  const c = r.stdout.indexOf(RECAP_PROMPT)
  assert.ok(a === 0 && b > a && c > b, `order ${a} ${b} ${c}`)
  assert.match(EXTEND_PREFACE, /extend/i)
})

const staleCases = {
  'missing bridge': { skipBridge: true },
  'unreadable bridge (directory)': { rawBridge: 'dir' },
  'malformed bridge JSON': { rawBridge: '{nope' },
  'another session_id': { record: { sessionId: 'other' } },
  'older than 7 days': { record: { ts: Date.now() - BRIDGE_MAX_AGE_MS - 60000 } },
  'lastUuid mismatch at lineCount': { record: { lastUuid: 'u2' } },
  'lineCount beyond the transcript': { record: { lineCount: 99, lastUuid: 'u3' } },
  'missing transcript file': { transcript: null },
}
for (const [name, opts] of Object.entries(staleCases)) {
  test(`bridge stale: ${name} prints RECAP_PROMPT as shipped`, () => {
    const r = run(setup(opts))
    assert.equal(r.status, 0)
    assert.equal(r.stdout, RECAP_PROMPT)
  })
}

test('bridge stale: no session_id / no transcript_path', () => {
  const s = setup()
  for (const extra of [{ session_id: undefined }, { transcript_path: undefined }]) {
    const r = run(s, extra)
    assert.equal(r.status, 0)
    assert.equal(r.stdout, RECAP_PROMPT)
  }
})

test('bridge stale: no HOME', () => {
  const s = setup()
  const r = spawnSync('node', [CLI], { input: s.stdin(), encoding: 'utf8', env: { PATH: process.env.PATH } })
  assert.equal(r.status, 0)
  assert.equal(r.stdout, RECAP_PROMPT)
})

test('bridge: manual, mark and disabled stay empty even with a fresh bridge', () => {
  const s = setup()
  assert.equal(run(s, { trigger: 'manual' }).stdout, '')
  assert.equal(run(s, { custom_instructions: `${COMPACT_MARK}: x` }).stdout, '')
  const off = run(s, {}, { CLAUDE_PLUGIN_OPTION_SMART_COMPACT_ENABLED: 'false' })
  assert.equal(off.stdout, '')
  assert.equal(off.status, 0)
})

test('bridge: invalid stdin JSON exits 0', () => {
  const r = spawn('{{{')
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
})

test('bridge: the nearest ancestor wins', () => {
  const s = setup()
  // a bridge at a higher ancestor (tmpdir) with other text; the nearer one (root) must win
  const upper = join(s.root, '..')
  const bp = handoffBridgePath(s.home, upper)
  mkdirSync(dirname(bp), { recursive: true })
  writeFileSync(bp, JSON.stringify(makeBridgeRecord({ key: 'k', sessionId: 's1', ts: Date.now(), text: 'UPPER', lastUuid: 'u3', lineCount: 3 })))
  const out = run(s).stdout
  assert.ok(out.startsWith(HANDOFF) && !out.includes('UPPER'))
})

test('bridge: a higher ancestor is used when no nearer file exists', () => {
  const s = setup({ bridgeAt: '/' })
  assert.ok(run(s).stdout.startsWith(HANDOFF))
})

test('contract: handoffBridgePath shape and hashRoot determinism', () => {
  const p = handoffBridgePath('/h', '/p/x')
  assert.match(p, /^\/h\/\.claude\/session\/handoff\/[0-9a-f]{8}\.json$/)
  assert.equal(p, handoffBridgePath('/h', '/p/x'))
  assert.notEqual(p, handoffBridgePath('/h', '/p/y'))
  assert.match(hashRoot('/p/x'), /^[0-9a-f]{8}$/)
  assert.equal(hashRoot(''), '811c9dc5')
  assert.equal(hashRoot('a'), 'e40c292c')
})

test('contract: makeBridgeRecord keys, max age, pure logic file', () => {
  const r = makeBridgeRecord({ key: 'k', sessionId: 's', ts: 1, text: 't', lastUuid: 'u', lineCount: 1, extra: 1 })
  assert.deepEqual(Object.keys(r).sort(), ['key', 'lastUuid', 'lineCount', 'sessionId', 'text', 'ts'])
  assert.equal(BRIDGE_MAX_AGE_MS, 604800000)
  const src = readFileSync(join(here, 'precompact-logic.mjs'), 'utf8')
  assert.ok(!/^\s*import[\s(]|require\(|node:/m.test(src))
})

test('contract: bridgeFresh unit and precompactInstructions with a bridge', () => {
  const rec = makeBridgeRecord({ key: 'k', sessionId: 's1', ts: 1000, text: 'T', lastUuid: 'u3', lineCount: 3 })
  const input = { trigger: 'auto', session_id: 's1', transcript_path: '/x' }
  assert.equal(bridgeFresh(rec, input, lines3, 2000), true)
  assert.equal(bridgeFresh(rec, input, lines3, 500), false)
  assert.equal(bridgeFresh({ ...rec, key: '' }, input, lines3, 2000), false)
  assert.equal(bridgeFresh({ ...rec, text: '' }, input, lines3, 2000), false)
  assert.equal(bridgeFresh({ ...rec, lineCount: 0 }, input, lines3, 2000), false)
  assert.equal(bridgeFresh(rec, { ...input, transcript_path: '' }, lines3, 2000), false)
  assert.equal(bridgeFresh(null, input, lines3, 2000), false)
  assert.equal(bridgeFresh(rec, input, null, 2000), false)
  const out = precompactInstructions(input, {}, { record: rec, lines: lines3, now: 2000 })
  assert.equal(out, `T\n\n${EXTEND_PREFACE}${RECAP_PROMPT}`)
  assert.equal(precompactInstructions({ ...input, trigger: 'manual' }, {}, { record: rec, lines: lines3, now: 2000 }), '')
  assert.equal(precompactInstructions(input, {}, { record: rec, lines: [], now: 2000 }), RECAP_PROMPT)
})
