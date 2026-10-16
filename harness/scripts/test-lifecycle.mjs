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
const PATCH = join(HARNESS_ROOT, '..', '_repo', 'scripts', 'patch-harness.mjs');
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
  // Only the lines inside the harness block go; the project's own lines (even ones install would
  // also write, like .claude/settings.local.json) stay.
  write(
    join(project, '.gitignore'),
    'node_modules/\n# harness:begin\n.claude/.harness-markers/\n.harness-run/\n# harness:end\ndist/\n.claude/settings.local.json\n',
  );

  const removed = run(REMOVE, { projectDir: project });
  assert.equal(removed.actions.gitignore, 'removed-block');
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
  assert.equal(readFileSync(join(project, '.gitignore'), 'utf8'), 'node_modules/\ndist/\n.claude/settings.local.json\n');

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

  // install: an old registration without Bash is widened; .gitignore gets the lines it lacks, in a block.
  const INSTALL = join(HARNESS_ROOT, 'skills', 'install', 'install.mjs');
  const old = join(scratch, 'old-install');
  write(join(old, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{
    matcher: 'Write|Edit|MultiEdit|NotebookEdit|Task|Agent',
    hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/goal-gate.mjs"' }],
  }] } }, null, 2) + '\n');
  write(join(old, '.gitignore'), 'node_modules/\n.claude/.harness-markers/\n');
  const installed = run(INSTALL, { projectDir: old, gate: { patterns: ['\\.[cm]?js$'] } });
  assert.equal(installed.actions.settings, 'widened');
  assert.match(readJson(join(old, '.claude', 'settings.json')).hooks.PreToolUse[0].matcher, /\|Bash\|?/);
  assert.match(readJson(join(old, '.claude', 'settings.json')).hooks.PreToolUse[0].matcher, /\|Skill\b/);
  assert.match(JSON.parse(readFileSync(join(HARNESS_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse[0].matcher, /\|Skill\b/);
  assert.equal(installed.actions.gitignore, 'appended');
  assert.equal(
    readFileSync(join(old, '.gitignore'), 'utf8'),
    'node_modules/\n.claude/.harness-markers/\n# harness:begin\n.harness-run/\n.claude/.harness-last-decision.json\n.claude/settings.local.json\n# harness:end\n',
  );
  const fresh = join(scratch, 'fresh-install');
  mkdirSync(fresh, { recursive: true });
  const freshReport = run(INSTALL, { projectDir: fresh, gate: { patterns: ['\\.[cm]?js$'] } });
  assert.equal(freshReport.actions.settings, 'created');
  assert.equal(freshReport.actions.gitignore, 'created');
  assert.equal(
    readFileSync(join(fresh, '.gitignore'), 'utf8'),
    '# harness:begin\n.claude/.harness-markers/\n.harness-run/\n.claude/.harness-last-decision.json\n.claude/settings.local.json\n# harness:end\n',
  );
  assert.match(readJson(join(fresh, '.claude', 'settings.json')).hooks.PreToolUse[0].matcher, /Bash.*Skill/);
  assert.equal(run(INSTALL, { projectDir: fresh }).actions.gitignore, 'present');
  // install -> remove on a fresh repo leaves no decision file and no .gitignore.
  write(join(fresh, '.claude', '.harness-last-decision.json'), '{}\n');
  const freshRemoved = run(REMOVE, { projectDir: fresh });
  assert.equal(freshRemoved.actions.decision, 'removed');
  assert.equal(freshRemoved.actions.gitignore, 'removed-file');
  assert.equal(existsSync(join(fresh, '.claude', '.harness-last-decision.json')), false);
  assert.equal(existsSync(join(fresh, '.gitignore')), false);

  // install -> remove on a project that already lists node_modules/, .harness-run/,
  // .claude/settings.local.json and dist/: install writes only what is missing; all four survive.
  const listed = join(scratch, 'listed');
  const LISTED = 'node_modules/\n.harness-run/\n.claude/settings.local.json\ndist/\n';
  write(join(listed, '.gitignore'), LISTED);
  const listedInstalled = run(INSTALL, { projectDir: listed });
  assert.equal(listedInstalled.actions.gitignore, 'appended');
  assert.equal(
    readFileSync(join(listed, '.gitignore'), 'utf8'),
    LISTED + '# harness:begin\n.claude/.harness-markers/\n.claude/.harness-last-decision.json\n# harness:end\n',
  );
  assert.equal(run(INSTALL, { projectDir: listed }).actions.gitignore, 'present');
  assert.equal(run(REMOVE, { projectDir: listed }).actions.gitignore, 'removed-block');
  assert.equal(readFileSync(join(listed, '.gitignore'), 'utf8'), LISTED);

  // install: every line already listed -> no block is written.
  const allListed = join(scratch, 'all-listed');
  const ALL_LISTED = '.claude/.harness-markers/\n.harness-run/\n.claude/.harness-last-decision.json\n.claude/settings.local.json\n';
  write(join(allListed, '.gitignore'), ALL_LISTED);
  assert.equal(run(INSTALL, { projectDir: allListed }).actions.gitignore, 'present');
  assert.equal(readFileSync(join(allListed, '.gitignore'), 'utf8'), ALL_LISTED);

  // remove: a legacy install (lines, no marker) is left in place and reported.
  const legacy = join(scratch, 'legacy');
  const LEGACY = 'node_modules/\n.claude/.harness-markers/\n.harness-run/\n';
  write(join(legacy, '.gitignore'), LEGACY);
  const legacyReport = run(REMOVE, { projectDir: legacy });
  assert.equal(legacyReport.actions.gitignore, 'legacy-left');
  assert.ok(legacyReport.notes.some((n) => /legacy/.test(n) && /\.gitignore/.test(n)), 'notes name the legacy .gitignore');
  assert.equal(readFileSync(join(legacy, '.gitignore'), 'utf8'), LEGACY);
  const bare = join(scratch, 'no-gitignore-at-all');
  mkdirSync(bare, { recursive: true });
  assert.equal(run(REMOVE, { projectDir: bare }).actions.gitignore, 'absent');

  // install and remove: a broken or duplicate marker -> marker-error, file byte-identical.
  const BROKEN = {
    'missing-end': 'node_modules/\n# harness:begin\n.harness-run/\n',
    'missing-begin': 'node_modules/\n.harness-run/\n# harness:end\n',
    'misordered': '# harness:end\n.harness-run/\n# harness:begin\n',
    'duplicate': '# harness:begin\n.harness-run/\n# harness:end\n# harness:begin\n.claude/settings.local.json\n# harness:end\n',
  };
  for (const [name, content] of Object.entries(BROKEN)) {
    for (const [verb, script] of [['remove', REMOVE], ['install', INSTALL]]) {
      const dir = join(scratch, `broken-${name}-${verb}`);
      write(join(dir, '.gitignore'), content);
      const report = run(script, { projectDir: dir });
      assert.equal(report.actions.gitignore, 'marker-error', `${verb} ${name}`);
      assert.ok(report.notes.some((n) => /\.gitignore/.test(n) && /marker/.test(n)), `${verb} ${name} notes`);
      assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), content, `${verb} ${name} untouched`);
    }
  }

  // remove under the gate: configured and enforcing, no run open. The plugin's goal-gate hook
  // judges the real remove.mjs invocation and lets it finish; a hand edit of the same files is denied.
  const gated = join(scratch, 'gated');
  mkdirSync(gated, { recursive: true });
  run(INSTALL, { projectDir: gated, gate: { patterns: ['\\.[cm]?js$'] } });
  const HOOK = join(HARNESS_ROOT, 'hooks', 'goal-gate.mjs');
  const judge = (input) => {
    const r = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ cwd: gated, session_id: 'lifecycle', ...input }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: '' },
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
  };
  for (const p of ['settings.json', 'harness-gate.json']) {
    assert.equal(judge({ tool_name: 'Edit', tool_input: { file_path: join(gated, '.claude', p) } }), 'deny', `gate enforces ${p}`);
  }
  const removeCall = `node "${REMOVE}" '{\n  "projectDir": "${gated}",\n  "purgeConventions": false\n}'`;
  assert.equal(judge({ tool_name: 'Bash', tool_input: { command: removeCall } }), 'allow', 'remove.mjs passes the gate');
  const gatedRemoved = run(REMOVE, { projectDir: gated });
  assert.equal(gatedRemoved.actions.hookScript, 'removed');
  assert.equal(gatedRemoved.actions.gate, 'removed');
  assert.equal(gatedRemoved.actions.settings, 'removed');
  assert.equal(existsSync(join(gated, '.claude', 'harness-gate.json')), false);
  assert.equal(existsSync(join(gated, '.claude', 'hooks', 'goal-gate.mjs')), false);

  // patch: synchronized dry-run and write across both manifests + bilingual README/KOR status.
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
  write(join(repo, 'harness', 'KOR.md'), '# harness\n\n## 상태\n- v1.2.3 — 이전\n');

  const dryRun = run(PATCH, { repoRoot: repo, summary: 'lifecycle helpers', summary_ko: '라이프사이클 헬퍼', dryRun: true });
  assert.equal(dryRun.version, '1.2.4');
  assert.equal(readJson(join(repo, 'harness', '.claude-plugin', 'plugin.json')).version, '1.2.3');
  assert.equal(readFileSync(join(repo, 'harness', 'KOR.md'), 'utf8'), '# harness\n\n## 상태\n- v1.2.3 — 이전\n');
  const patched = run(PATCH, { repoRoot: repo, summary: 'lifecycle helpers', summary_ko: '라이프사이클 헬퍼' });
  assert.equal(patched.previousVersion, '1.2.3');
  assert.equal(patched.version, '1.2.4');
  assert.equal(readJson(join(repo, 'harness', '.claude-plugin', 'plugin.json')).version, '1.2.4');
  assert.equal(readJson(join(repo, '.claude-plugin', 'marketplace.json')).plugins[1].version, '1.2.4');
  assert.match(readFileSync(join(repo, 'harness', 'README.md'), 'utf8'), /## Status\n- v1\.2\.4 — lifecycle helpers\n/);
  assert.match(readFileSync(join(repo, 'harness', 'KOR.md'), 'utf8'), /## 상태\n- v1\.2\.4 — 라이프사이클 헬퍼\n/);

  // patch: refuses an English-only release — a summary with no summary_ko must fail loudly
  // before touching any file, not silently produce a half-updated bilingual pair.
  const koMissing = join(scratch, 'ko-missing-summary');
  write(
    join(koMissing, 'harness', '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'harness', version: '1.0.0' }, null, 2) + '\n',
  );
  write(
    join(koMissing, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ plugins: [{ name: 'harness', version: '1.0.0' }] }, null, 2) + '\n',
  );
  write(join(koMissing, 'harness', 'README.md'), '# harness\n\n## Status\n');
  write(join(koMissing, 'harness', 'KOR.md'), '# harness\n\n## 상태\n');
  const beforePlugin = readFileSync(join(koMissing, 'harness', '.claude-plugin', 'plugin.json'), 'utf8');
  const beforeReadme = readFileSync(join(koMissing, 'harness', 'README.md'), 'utf8');
  const koMissingFailed = spawnSync(
    process.execPath,
    [PATCH, JSON.stringify({ repoRoot: koMissing, summary: 'english only' })],
    { encoding: 'utf8' },
  );
  assert.notEqual(koMissingFailed.status, 0);
  assert.match(koMissingFailed.stderr, /summary_ko is required/);
  assert.equal(readFileSync(join(koMissing, 'harness', '.claude-plugin', 'plugin.json'), 'utf8'), beforePlugin);
  assert.equal(readFileSync(join(koMissing, 'harness', 'README.md'), 'utf8'), beforeReadme);

  // patch: refuses when KOR.md has no "## 상태" heading to prepend into.
  const koNoHeading = join(scratch, 'ko-no-heading');
  write(
    join(koNoHeading, 'harness', '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'harness', version: '1.0.0' }, null, 2) + '\n',
  );
  write(
    join(koNoHeading, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ plugins: [{ name: 'harness', version: '1.0.0' }] }, null, 2) + '\n',
  );
  write(join(koNoHeading, 'harness', 'README.md'), '# harness\n\n## Status\n');
  write(join(koNoHeading, 'harness', 'KOR.md'), '# harness\n\n(no status section yet)\n');
  const noHeadingFailed = spawnSync(
    process.execPath,
    [PATCH, JSON.stringify({ repoRoot: koNoHeading, summary: 'x', summary_ko: 'y' })],
    { encoding: 'utf8' },
  );
  assert.notEqual(noHeadingFailed.status, 0);
  assert.match(noHeadingFailed.stderr, /KOR\.md has no "## 상태" heading/);

  // patch: refuses when KOR.md is missing entirely (pre-existing project layouts predating
  // the bilingual requirement).
  const koFileMissing = join(scratch, 'ko-file-missing');
  write(
    join(koFileMissing, 'harness', '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'harness', version: '1.0.0' }, null, 2) + '\n',
  );
  write(
    join(koFileMissing, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ plugins: [{ name: 'harness', version: '1.0.0' }] }, null, 2) + '\n',
  );
  write(join(koFileMissing, 'harness', 'README.md'), '# harness\n\n## Status\n');
  const koFileMissingFailed = spawnSync(
    process.execPath,
    [PATCH, JSON.stringify({ repoRoot: koFileMissing, summary: 'x', summary_ko: 'y' })],
    { encoding: 'utf8' },
  );
  assert.notEqual(koFileMissingFailed.status, 0);
  assert.match(koFileMissingFailed.stderr, /harness KOR\.md not found/);

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
  write(join(mismatch, 'harness', 'KOR.md'), '# harness\n\n## 상태\n');
  const before = readFileSync(join(mismatch, 'harness', '.claude-plugin', 'plugin.json'), 'utf8');
  const failed = spawnSync(process.execPath, [PATCH, JSON.stringify({ repoRoot: mismatch, summary: 'no write', summary_ko: '쓰기 없음' })], { encoding: 'utf8' });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /version mismatch/);
  assert.equal(readFileSync(join(mismatch, 'harness', '.claude-plugin', 'plugin.json'), 'utf8'), before);

  process.stdout.write('PASS harness lifecycle tests\n');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
