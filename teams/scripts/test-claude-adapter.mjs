import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, realpathSync } from 'node:fs';
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
  const run = prompt.match(/then return (\\S+): node -e "(.+)" (".+") (\\S+)$/);
  const read = prompt.match(/Return exactly (.+)\\. Do not/);
  if(run) {
    // MOCK_NO_BASH: the session answers but its Bash call needs approval (acceptEdits, headless).
    if(!process.env.MOCK_NO_BASH) require('node:child_process').execFileSync('node', ['-e', run[2], JSON.parse(run[3]), run[4]]);
    console.log(JSON.stringify({result:run[1]})); return;
  }
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
    assert.equal(realpathSync(observed.cwd), realpathSync(f.dir), 'same directory; macOS reports $TMPDIR under /private/var');
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

test('a workspace-write probe is ready only if the session can run a command, not just write a file', () => {
  const f = fixture();
  try {
    assert.equal(f.run(['--detect']).report.vendor.ready, true);
    const blocked = f.run(['--detect'], { MOCK_NO_BASH: '1' });
    assert.equal(blocked.report.vendor.reachable, true);
    assert.equal(blocked.report.vendor.ready, false, 'code-sprint-S3: Write worked, `node --test` needed approval');
    assert.match(blocked.report.vendor.reason, /could not run a command/);
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

test('Claude accepts danger-full-access and bypasses the permission prompt there', () => {
  const f = fixture();
  try {
    const r = f.run(['--prompt-file', join(f.dir, 'prompt.md'), '--stage', 'test', '--sandbox', 'danger-full-access']);
    assert.equal(r.status, 0, r.stderr);
    const observed = JSON.parse(readFileSync(join(f.dir, 'observed.json')));
    assert.equal(observed.args[observed.args.indexOf('--permission-mode') + 1], 'bypassPermissions');
    assert.equal(observed.args[observed.args.indexOf('--tools') + 1], 'Read,Glob,Grep,Edit,Write,Bash');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

// The bypass must be something a run opts into, never what every stage silently gets.
test('workspace-write still defers to the project permission layer', () => {
  const f = fixture();
  try {
    f.run(['--prompt-file', join(f.dir, 'prompt.md'), '--stage', 'test', '--sandbox', 'workspace-write']);
    const observed = JSON.parse(readFileSync(join(f.dir, 'observed.json')));
    assert.equal(observed.args[observed.args.indexOf('--permission-mode') + 1], 'acceptEdits');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
