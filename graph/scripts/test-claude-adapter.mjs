import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const adapter = fileURLToPath(new URL('../adapters/claude-exec-adapter.mjs', import.meta.url));

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'claude-adapter-test-'));
  const binary = join(dir, 'claude');
  writeFileSync(binary, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
let prompt = '';
process.stdin.on('data', c => prompt += c);
process.stdin.on('end', () => {
  fs.writeFileSync('observed.json', JSON.stringify({args, prompt, cwd:process.cwd()}));
  if(process.env.MOCK_QUOTA) { console.log(JSON.stringify({is_error:true, result:"You've hit your limit"})); process.exit(1); }
  if(process.env.MOCK_PROSE) { console.log(JSON.stringify({result:'cannot do that'})); return; }
  const write = prompt.match(/Use Write to create (.+) containing exactly (.+)\\. Do not/);
  const read = prompt.match(/Return exactly (.+)\\. Do not/);
  if(write) { fs.writeFileSync(write[1], write[2]); console.log(JSON.stringify({result:write[2]})); return; }
  if(read) { console.log(JSON.stringify({result:read[1]})); return; }
  console.log(JSON.stringify({result:JSON.stringify({stage_ok:true, verified:true, checks:['check -> passed'], evidence:'e'}), usage:{input_tokens:12,output_tokens:4}}));
});
`);
  chmodSync(binary, 0o755);
  writeFileSync(join(dir, 'prompt.md'), 'Execute this isolated stage.');
  return { dir, run(extra = [], env = {}) {
    const result = spawnSync('node', [adapter, '--cwd', dir, '--output', join(dir, 'result.json'), ...extra],
      { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...env } });
    return { ...result, report: JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8')) };
  } };
}

test('Claude adapter starts fresh, keeps cwd, uses explicit efficient model, and imposes no spending cap', () => {
  const f = fixture();
  try {
    const r = f.run(['--prompt-file', join(f.dir, 'prompt.md'), '--stage', 'test', '--events-output', join(f.dir, 'events.jsonl')]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.report.stage_ok, true);
    assert.equal(r.report.usage.input_tokens, 12);
    const observed = JSON.parse(readFileSync(join(f.dir, 'observed.json')));
    assert.equal(observed.cwd, f.dir);
    assert.ok(observed.args.includes('--no-session-persistence'));
    assert.ok(observed.args.includes('--strict-mcp-config'));
    assert.equal(observed.args[observed.args.indexOf('--model') + 1], 'sonnet');
    assert.ok(!observed.args.some(a => /resume|continue|max-turns|max-budget|skip-permissions/.test(a)));
    assert.equal(observed.prompt, 'Execute this isolated stage.');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('Claude probes real writes and restricts read-only tool profile', () => {
  const f = fixture();
  try {
    assert.equal(f.run(['--detect']).report.vendor.ready, true);
    const r = f.run(['--detect', '--sandbox', 'read-only', '--model', 'explicit-model']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.report.vendor.reachable, true);
    assert.equal(r.report.vendor.ready, false);
    const args = JSON.parse(readFileSync(join(f.dir, 'observed.json'))).args;
    assert.equal(args[args.indexOf('--tools') + 1], 'Read,Glob,Grep');
    assert.equal(args[args.indexOf('--model') + 1], 'explicit-model');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('Claude adapter retains quota diagnostics and rejects malformed stage output', () => {
  const f = fixture();
  try {
    const args = ['--prompt-file', join(f.dir, 'prompt.md')];
    const limited = f.run(args, { MOCK_QUOTA: '1' });
    assert.equal(limited.status, 1);
    assert.match(limited.report.last_message, /hit your limit/);
    assert.equal(f.run(args, { MOCK_PROSE: '1' }).status, 1);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
