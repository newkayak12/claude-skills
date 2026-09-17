import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PATCH = fileURLToPath(new URL('../skills/patch/patch.mjs', import.meta.url));

function repo(version = '0.9.0', mkVersion = version) {
  const root = mkdtempSync(join(tmpdir(), 'patch-repo-'));
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  mkdirSync(join(root, 'graph-beta', '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins: [{ name: 'graph-beta', version: mkVersion }, { name: 'harness', version: '1.2.3' }] }, null, 2) + '\n');
  writeFileSync(join(root, 'graph-beta', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'graph-beta', version }, null, 2) + '\n');
  writeFileSync(join(root, 'graph-beta', 'README.md'), '# graph-beta\n\n## Status\n\n- v0.9.0 — old\n');
  writeFileSync(join(root, 'graph-beta', 'KOR.md'), '# graph-beta\n\n## 상태\n\n- v0.9.0 — 이전\n');
  return root;
}
function run(root, args) {
  const r = spawnSync(process.execPath, [PATCH, JSON.stringify({ repoRoot: root, ...args })], { encoding: 'utf8' });
  return { status: r.status, report: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}

test('dry run reports next version and touches nothing', () => {
  const root = repo();
  try {
    const { status, report } = run(root, { summary: 'fix a', summary_ko: 'a 수정', dryRun: true });
    assert.equal(status, 0);
    assert.equal(report.previousVersion, '0.9.0');
    assert.equal(report.version, '0.9.1');
    assert.equal(JSON.parse(readFileSync(join(root, 'graph-beta', '.claude-plugin', 'plugin.json'), 'utf8')).version, '0.9.0');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('real run bumps both manifests and prepends both status logs', () => {
  const root = repo();
  try {
    assert.equal(run(root, { summary: 'fix a', summary_ko: 'a 수정' }).status, 0);
    assert.equal(JSON.parse(readFileSync(join(root, 'graph-beta', '.claude-plugin', 'plugin.json'), 'utf8')).version, '0.9.1');
    const mk = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
    assert.equal(mk.plugins.find((p) => p.name === 'graph-beta').version, '0.9.1');
    assert.equal(mk.plugins.find((p) => p.name === 'harness').version, '1.2.3');
    assert.match(readFileSync(join(root, 'graph-beta', 'README.md'), 'utf8'), /## Status\n- v0\.9\.1 — fix a\n/);
    assert.match(readFileSync(join(root, 'graph-beta', 'KOR.md'), 'utf8'), /## 상태\n- v0\.9\.1 — a 수정\n/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('refuses without summary_ko, and on a version mismatch', () => {
  const a = repo();
  const b = repo('0.9.0', '0.8.0');
  try {
    assert.equal(run(a, { summary: 'x' }).status, 2);
    assert.match(run(a, { summary: 'x' }).stderr, /summary_ko/);
    assert.equal(run(b, { summary: 'x', summary_ko: 'y' }).status, 2);
    assert.match(run(b, { summary: 'x', summary_ko: 'y' }).stderr, /version mismatch/);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

test('the plugin argument selects another plugin directory', () => {
  const root = repo();
  try {
    const r = run(root, { plugin: 'harness', summary: 'x', summary_ko: 'y', dryRun: true });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /plugin\.json not found/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
