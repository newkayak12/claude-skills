// The codex adapter's stage output schemas go to OpenAI's strict structured outputs, which refuse
// the whole request (400 invalid_json_schema) unless every object has additionalProperties:false
// and lists every property in required. code-beta-X2 (2026-09-26): upstream_defects was neither,
// and every codex implement node failed "adapter exit 1" before codex did any work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
