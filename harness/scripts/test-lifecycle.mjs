#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = resolve(HERE, '..');
const REMOVE = join(HARNESS_ROOT, 'skills', 'remove', 'remove.mjs');
const PATCH = join(HARNESS_ROOT, 'skills', 'patch', 'patch.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'harness-lifecycle-'));

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function run(script, args) {
  return JSON.parse(execFileSync(process.execPath, [script, JSON.stringify(args)], { encoding: 'utf8' }));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

try {
  // remove: delete harness-owned artifacts while preserving neighboring settings/content.
  const project = join(scratch, 'project');
  write(join(project, '.claude', 'hooks', 'goal-gate.mjs'), '// harness hook\n');
  write(join(project, '.claude', 'harness-gate.json'), '{}\n');
  write(join(project, '.claude', 'harness', 'engine', 'pipeline.js'), '// embedded\n');
  write(join(project, '.claude', '.harness-markers', 'session'), 'marker\n');
  write(join(project, '.claude', 'conventions', 'coding.md'), '# customized\n');
  write(
    join(project, '.claude', 'settings.json'),
    JSON.stringify({
      permissions: { allow: ['Read'] },
      hooks: {
        PreToolUse: [{
          matcher: 'Write|Task',
          hooks: [
            { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/goal-gate.mjs"' },
            { type: 'command', command: 'node tools/custom-goal-gate.mjs' },
            { type: 'command', command: 'node .claude/hooks/keep-me.mjs' },
          ],
        }],
      },
    }, null, 2) + '\n',
  );
  write(
    join(project, 'CLAUDE.md'),
    '# Project\n\nBefore.\n\n<!-- harness:begin v1 -->\n## Harness\nRules.\n<!-- harness:end -->\n\nAfter.\n',
  );
  write(join(project, '.gitignore'), 'node_modules/\n.claude/.harness-markers/\ndist/\n');

  const removed = run(REMOVE, { projectDir: project });
  assert.equal(removed.actions.hookScript, 'removed');
  assert.equal(removed.actions.conventions, 'kept');
  assert.equal(existsSync(join(project, '.claude', 'hooks', 'goal-gate.mjs')), false);
  assert.equal(existsSync(join(project, '.claude', 'harness')), false);
  assert.equal(existsSync(join(project, '.claude', 'harness-gate.json')), false);
  assert.equal(existsSync(join(project, '.claude', 'conventions', 'coding.md')), true);
  const settings = readJson(join(project, '.claude', 'settings.json'));
  assert.deepEqual(settings.permissions, { allow: ['Read'] });
  assert.equal(settings.hooks.PreToolUse[0].hooks.length, 2);
  assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /custom-goal-gate/);
  assert.match(settings.hooks.PreToolUse[0].hooks[1].command, /keep-me/);
  assert.equal(readFileSync(join(project, 'CLAUDE.md'), 'utf8'), '# Project\n\nBefore.\n\nAfter.\n');
  assert.equal(readFileSync(join(project, '.gitignore'), 'utf8'), 'node_modules/\ndist/\n');

  const removedAgain = run(REMOVE, { projectDir: project });
  assert.equal(removedAgain.actions.hookScript, 'absent');
  assert.equal(removedAgain.actions.settings, 'absent');
  assert.equal(removedAgain.actions.conventions, 'kept');
  run(REMOVE, { projectDir: project, purgeConventions: true });
  assert.equal(existsSync(join(project, '.claude', 'conventions')), false);

  // remove: malformed user-owned files are preserved for manual cleanup.
  const malformed = join(scratch, 'malformed');
  write(join(malformed, '.claude', 'settings.json'), '{broken');
  write(join(malformed, 'CLAUDE.md'), 'keep\n<!-- harness:begin v1 -->\n');
  const malformedReport = run(REMOVE, { projectDir: malformed });
  assert.equal(malformedReport.actions.settings, 'parse-error');
  assert.equal(malformedReport.actions.claudeMd, 'marker-error');
  assert.equal(readFileSync(join(malformed, '.claude', 'settings.json'), 'utf8'), '{broken');
  assert.equal(readFileSync(join(malformed, 'CLAUDE.md'), 'utf8'), 'keep\n<!-- harness:begin v1 -->\n');

  const misordered = join(scratch, 'misordered');
  write(join(misordered, 'CLAUDE.md'), '<!-- harness:end -->\nkeep\n<!-- harness:begin v1 -->\n');
  const misorderedReport = run(REMOVE, { projectDir: misordered });
  assert.equal(misorderedReport.actions.claudeMd, 'marker-error');
  assert.equal(
    readFileSync(join(misordered, 'CLAUDE.md'), 'utf8'),
    '<!-- harness:end -->\nkeep\n<!-- harness:begin v1 -->\n',
  );

  // patch: synchronized dry-run and write across both manifests + README status.
  const repo = join(scratch, 'repo');
  write(
    join(repo, 'harness', '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'harness', version: '1.2.3' }, null, 2) + '\n',
  );
  write(
    join(repo, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ plugins: [{ name: 'other', version: '9.0.0' }, { name: 'harness', version: '1.2.3' }] }, null, 2) + '\n',
  );
  write(join(repo, 'harness', 'README.md'), '# harness\n\n## Status\n- v1.2.3 — previous\n');

  const dryRun = run(PATCH, { repoRoot: repo, summary: 'lifecycle helpers', dryRun: true });
  assert.equal(dryRun.version, '1.2.4');
  assert.equal(readJson(join(repo, 'harness', '.claude-plugin', 'plugin.json')).version, '1.2.3');
  const patched = run(PATCH, { repoRoot: repo, summary: 'lifecycle helpers' });
  assert.equal(patched.previousVersion, '1.2.3');
  assert.equal(patched.version, '1.2.4');
  assert.equal(readJson(join(repo, 'harness', '.claude-plugin', 'plugin.json')).version, '1.2.4');
  assert.equal(readJson(join(repo, '.claude-plugin', 'marketplace.json')).plugins[1].version, '1.2.4');
  assert.match(readFileSync(join(repo, 'harness', 'README.md'), 'utf8'), /## Status\n- v1\.2\.4 — lifecycle helpers\n/);

  // patch: mismatched versions fail before any file is changed.
  const mismatch = join(scratch, 'mismatch');
  write(
    join(mismatch, 'harness', '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'harness', version: '2.0.0' }, null, 2) + '\n',
  );
  write(
    join(mismatch, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ plugins: [{ name: 'harness', version: '2.0.1' }] }, null, 2) + '\n',
  );
  write(join(mismatch, 'harness', 'README.md'), '# harness\n\n## Status\n');
  const before = readFileSync(join(mismatch, 'harness', '.claude-plugin', 'plugin.json'), 'utf8');
  const failed = spawnSync(process.execPath, [PATCH, JSON.stringify({ repoRoot: mismatch, summary: 'no write' })], { encoding: 'utf8' });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /version mismatch/);
  assert.equal(readFileSync(join(mismatch, 'harness', '.claude-plugin', 'plugin.json'), 'utf8'), before);

  process.stdout.write('PASS harness lifecycle tests\n');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
