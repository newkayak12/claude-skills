// The codex adapter's stage output schemas go to OpenAI's strict structured outputs, which refuse
// the whole request (400 invalid_json_schema) unless every object has additionalProperties:false
// and lists every property in required. code-beta-X2 (2026-09-26): upstream_defects was neither,
// and every codex implement node failed "adapter exit 1" before codex did any work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLAUDE_ADAPTER = join(dirname(fileURLToPath(import.meta.url)), '..', 'adapters', 'claude-exec-adapter.mjs');
const BROKER_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'broker.mjs');
const ADAPTER = join(dirname(fileURLToPath(import.meta.url)), '..', 'adapters', 'codex-exec-adapter.mjs');

// Every object node strict: additionalProperties false, required === every property key.
function strictViolations(schema, path = '$', out = []) {
  if (!schema || typeof schema !== 'object') return out;
  const types = [].concat(schema.type || []);
  if (types.includes('object') || schema.properties) {
    if (schema.additionalProperties !== false) out.push(`${path}: additionalProperties must be false`);
    const keys = Object.keys(schema.properties || {}).sort();
    const req = [...(schema.required || [])].sort();
    if (JSON.stringify(keys) !== JSON.stringify(req)) out.push(`${path}: required ${JSON.stringify(req)} != properties ${JSON.stringify(keys)}`);
    for (const [k, v] of Object.entries(schema.properties || {})) strictViolations(v, `${path}.${k}`, out);
  }
  if (schema.items) strictViolations(schema.items, `${path}[]`, out);
  return out;
}

function fakeCodex(dir, reply) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'codex'), `#!/usr/bin/env node
const fs = require('node:fs');
const a = process.argv.slice(2);
if (a.includes('--version')) { console.log('codex 0.0.0'); process.exit(0); }
const schema = a.includes('--output-schema') ? a[a.indexOf('--output-schema') + 1] : null;
if (schema) fs.copyFileSync(schema, ${JSON.stringify(join(dir, 'seen-schema.json'))});
const out = a[a.indexOf('-o') + 1];
fs.writeFileSync(out, ${JSON.stringify(JSON.stringify(reply))});
process.exit(0);
`);
  chmodSync(join(bin, 'codex'), 0o755);
  return bin;
}

for (const stage of ['implement', 'test']) {
  test(`the ${stage} output schema is valid under strict structured outputs, and a null optional field comes back absent`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-schema-'));
    try {
      spawnSync('git', ['init', '-q'], { cwd: dir });
      const reply = stage === 'implement'
        ? { stage_ok: true, handoff: 'h', changed_files: [], checks: ['c -> ok'], evidence: 'e', upstream_defects: null }
        : { stage_ok: true, verified: true, checks: ['c -> ok'], evidence: 'e', upstream_defects: [{ package: 'P1', title: 't', evidence: null, touches: null }] };
      const bin = fakeCodex(dir, reply);
      writeFileSync(join(dir, 'prompt.md'), 'do it');
      const r = spawnSync('node', [ADAPTER, '--stage', stage, '--cwd', dir, '--prompt-file', join(dir, 'prompt.md'), '--output', join(dir, 'out.json'), '--sandbox', 'danger-full-access'],
        { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
      const schema = JSON.parse(readFileSync(join(dir, 'seen-schema.json'), 'utf8'));
      assert.deepEqual(strictViolations(schema), [], 'schema must pass strict structured outputs');
      const out = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'));
      assert.ok(out.result, r.stderr + JSON.stringify(out).slice(0, 400));
      if (stage === 'implement') assert.equal('upstream_defects' in out.result, false);
      else assert.deepEqual(out.result.upstream_defects, [{ package: 'P1', title: 't' }]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

// broker.mjs passes --verify to whichever vendor's adapter runs a review/gate dispatch,
// uniformly across vendors (see broker.mjs's `verifies` flag). The claude adapter needs it
// to change its --tools profile; codex has no such flag - its -s sandbox already governs
// writes at the OS level regardless of stage - so this only has to prove the codex adapter
// recognizes the flag instead of calling usage() (exit 2) on an argument it does not know.
test('the adapter accepts --verify as a recognized no-op (broker sends it to every vendor uniformly for review/gate)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-verify-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const reply = { stage_ok: true, verified: true, checks: ['c -> ok'], evidence: 'e' };
    const bin = fakeCodex(dir, reply);
    writeFileSync(join(dir, 'prompt.md'), 'do it');
    // No --stage: this is exactly how broker.mjs dispatches a reasoning node (review/gate) -
    // unstaged, so review's own shape is not forced through implement/test's strict schema.
    const r = spawnSync('node', [
      ADAPTER, '--cwd', dir, '--prompt-file', join(dir, 'prompt.md'),
      '--output', join(dir, 'out.json'), '--sandbox', 'read-only', '--verify',
    ], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.notEqual(r.status, 2, `--verify must not be treated as an unknown argument: ${r.stderr}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('code-beta-X4: a retry claiming the file its earlier attempt left dirty is carried, not contradicted; a file nobody touched still is', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-carry-'));
  try {
    const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
    writeFileSync(join(dir, 'src.mjs'), 'export {};\n');
    writeFileSync(join(dir, 'b.mjs'), 'export {};\n');
    git('add', '.'); git('commit', '-qm', 'stub');
    writeFileSync(join(dir, 'src.mjs'), 'export const a = 1;\n'); // attempt 1's work, uncommitted
    const run = (claim) => {
      const bin = fakeCodex(dir, { stage_ok: true, handoff: 'h', changed_files: claim, checks: ['node --test -> 1 pass'], evidence: 'e', upstream_defects: null });
      // this attempt's own write
      writeFileSync(join(bin, 'codex'), readFileSync(join(bin, 'codex'), 'utf8').replace("process.exit(0);\n`", '').replace(/process\.exit\(0\);\s*$/, `fs.writeFileSync(${JSON.stringify(join(dir, 'b.mjs'))}, 'export const b = ' + Date.now() + ';\\n');\nprocess.exit(0);\n`));
      writeFileSync(join(dir, 'prompt.md'), 'do it');
      spawnSync('node', [ADAPTER, '--stage', 'implement', '--cwd', dir, '--prompt-file', join(dir, 'prompt.md'), '--output', join(dir, 'out.json'), '--sandbox', 'danger-full-access', '--isolated'],
        { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
      return JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'));
    };
    const ok = run(['src.mjs', 'b.mjs (modified)']);
    assert.equal(ok.ok, true, JSON.stringify(ok.result && ok.result.verification_error));
    assert.deepEqual(ok.result.carried_files, ['src.mjs']);
    const ghost = run(['b.mjs', 'ghost.mjs']);
    assert.equal(ghost.ok, false);
    assert.match(ghost.result.verification_error, /ghost\.mjs/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- flags broker.mjs passes, and the project wiki config ----------

// A fake codex that records its argv and answers a valid implement reply; a fake claude likewise.
function recordingCodex(dir) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'codex'), `#!/usr/bin/env node
const fs = require('node:fs');
const a = process.argv.slice(2);
if (a.includes('--version')) { console.log('codex 0.0.0'); process.exit(0); }
fs.writeFileSync(${JSON.stringify(join(dir, 'argv.json'))}, JSON.stringify(a));
fs.writeFileSync(a[a.indexOf('-o') + 1], ${JSON.stringify(JSON.stringify({ stage_ok: true, handoff: 'h', changed_files: [], checks: ['c -> ok'], evidence: 'e', upstream_defects: null }))});
`);
  writeFileSync(join(bin, 'claude'), `#!/usr/bin/env node
console.log(JSON.stringify({ result: '{}' }));
`);
  chmodSync(join(bin, 'codex'), 0o755);
  chmodSync(join(bin, 'claude'), 0o755);
  return bin;
}

// Every flag the adapter-args block of broker.mjs can pass, with whether it takes a value. The test
// below reads the block's own source, so a flag added there without being added here fails it -
// the way 0.47.0 broke (--no-wiki reached codex, which exited 2).
const BROKER_FLAGS = { '--stage': 'implement', '--cwd': 'CWD', '--prompt-file': 'PROMPT', '--events-output': 'EVENTS', '--output': 'OUT',
  '--sandbox': 'read-only', '--verify': null, '--no-wiki': null, '--isolated': null, '--add-dir': 'ADD', '--model': 'm' };

test('every flag the broker adapter-args block can pass is accepted by both adapters (no usage exit, no unknown argument)', () => {
  const src = readFileSync(BROKER_SRC, 'utf8');
  const start = src.indexOf("...(reasoning ? [] : ['--stage'");
  const end = src.indexOf('\n', src.indexOf("if (chosenModel) args.push('--model'", start));
  assert.ok(start > 0 && end > start, 'the broker adapter-args block moved: update this test');
  const seen = new Set(src.slice(start, end).match(/'--[a-z-]+'/g).map((x) => x.slice(1, -1)));
  assert.deepEqual([...seen].filter((f) => !(f in BROKER_FLAGS)), [], 'broker passes a flag this test does not know');
  assert.deepEqual(Object.keys(BROKER_FLAGS).filter((f) => !seen.has(f)), [], 'this test lists a flag the broker no longer passes');

  const dir = mkdtempSync(join(tmpdir(), 'adapter-flags-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const bin = recordingCodex(dir);
    writeFileSync(join(dir, 'prompt.md'), 'do it');
    const val = (v) => ({ CWD: dir, PROMPT: join(dir, 'prompt.md'), EVENTS: join(dir, 'events.jsonl'), OUT: join(dir, 'out.json'), ADD: dir }[v] || v);
    const full = Object.entries(BROKER_FLAGS).flatMap(([f, v]) => (v === null ? [f] : [f, val(v)]));
    const noStage = full.filter((x, i) => x !== '--stage' && full[i - 1] !== '--stage'); // a reasoning node
    for (const [label, argv] of [['judging staged (test)', full], ['judging reasoning', noStage], ['non-judging', full.filter((x) => !['--no-wiki', '--verify'].includes(x))]]) {
      for (const adapter of [ADAPTER, CLAUDE_ADAPTER]) {
        const r = spawnSync('node', [adapter, ...argv], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEAMS_WIKI_ROOT: '' } });
        assert.notEqual(r.status, 2, `${label} ${adapter}: ${r.stderr}`);
        assert.doesNotMatch(r.stderr, /usage:|unknown argument/, `${label} ${adapter}`);
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const WIKI_SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'wiki.mjs');
function codexArgv(extra, env, root = 'x') {
  const dir = mkdtempSync(join(tmpdir(), 'codex-wiki-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const bin = recordingCodex(dir);
    writeFileSync(join(dir, 'prompt.md'), 'do it');
    spawnSync('node', [ADAPTER, '--stage', 'implement', '--cwd', dir, '--prompt-file', join(dir, 'prompt.md'), '--output', join(dir, 'out.json'), '--sandbox', 'danger-full-access', ...extra],
      { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEAMS_WIKI_ROOT: '', ...env } });
    return JSON.parse(readFileSync(join(dir, 'argv.json'), 'utf8'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const cOverrides = (argv) => argv.flatMap((x, i) => (argv[i - 1] === '-c' ? [x] : []));

test('TEAMS_WIKI_ROOT set: codex exec gets exactly two -c pairs (command, args) that parse back to the exact values, awkward root included', () => {
  const root = '/proj/my "quoted" dir\\back';
  const argv = codexArgv([], { TEAMS_WIKI_ROOT: root });
  assert.equal(argv.filter((x) => x === '-c').length, 2);
  const [cmd, args] = cOverrides(argv);
  assert.equal(cmd.slice(0, cmd.indexOf('=')), 'mcp_servers.teams-wiki.command');
  assert.equal(JSON.parse(cmd.slice(cmd.indexOf('=') + 1)), process.execPath);
  assert.equal(args.slice(0, args.indexOf('=')), 'mcp_servers.teams-wiki.args');
  assert.deepEqual(JSON.parse(args.slice(args.indexOf('=') + 1)), [WIKI_SERVER, '--root', root]);
  assert.ok(isAbsolute(WIKI_SERVER));
  assert.equal(argv[argv.length - 1], 'do it', 'the prompt stays last');
});

test('codex exec argv is unchanged without TEAMS_WIKI_ROOT or with --no-wiki; the write/smoke probes (--detect) never get it', () => {
  assert.equal(codexArgv([], {}).includes('-c'), false);
  assert.equal(codexArgv(['--no-wiki'], { TEAMS_WIKI_ROOT: '/proj/main' }).includes('-c'), false);
  const dir = mkdtempSync(join(tmpdir(), 'codex-detect-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const bin = recordingCodex(dir);
    spawnSync('node', [ADAPTER, '--detect', '--cwd', dir, '--output', join(dir, 'out.json'), '--sandbox', 'danger-full-access'],
      { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEAMS_WIKI_ROOT: '/proj/main' } });
    const seen = (() => { try { return readFileSync(join(dir, 'argv.json'), 'utf8'); } catch { return '[]'; } })();
    assert.equal(JSON.parse(seen).includes('-c'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
