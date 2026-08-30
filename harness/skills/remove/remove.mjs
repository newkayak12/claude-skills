#!/usr/bin/env node
// Deterministically remove the project-local files created by the harness install skill.
// Usage: node remove.mjs '{"projectDir":"/abs/project","purgeConventions":false}'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  rmdirSync,
  statSync,
} from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';

function fail(message) {
  process.stderr.write(`remove.mjs: ${message}\n`);
  process.exit(2);
}

function parseArgs() {
  const raw = process.argv[2];
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`argv[1] is not valid JSON: ${error.message}`);
  }
}

function removeKnownPath(path) {
  if (!existsSync(path)) return 'absent';
  rmSync(path, { recursive: true, force: true });
  return 'removed';
}

function removeHookRegistration(settingsPath, notes) {
  if (!existsSync(settingsPath)) return 'absent';

  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    notes.push('settings.json is not valid JSON — left untouched; remove the goal-gate.mjs hook by hand');
    return 'parse-error';
  }

  const groups = settings?.hooks?.PreToolUse;
  if (!Array.isArray(groups)) return 'absent';

  let removed = 0;
  const keptGroups = [];
  for (const group of groups) {
    if (!group || !Array.isArray(group.hooks)) {
      keptGroups.push(group);
      continue;
    }
    const hooks = group.hooks.filter((hook) => {
      const isHarnessHook =
        String(hook?.command || '').trim() ===
        'node "$CLAUDE_PROJECT_DIR/.claude/hooks/goal-gate.mjs"';
      if (isHarnessHook) removed += 1;
      return !isHarnessHook;
    });
    if (hooks.length) keptGroups.push({ ...group, hooks });
  }

  if (!removed) return 'absent';
  if (keptGroups.length) settings.hooks.PreToolUse = keptGroups;
  else delete settings.hooks.PreToolUse;
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return 'removed';
}

function removeClaudeBlock(claudeMdPath, notes) {
  if (!existsSync(claudeMdPath)) return 'absent';
  const current = readFileSync(claudeMdPath, 'utf8');
  const beginCount = (current.match(/<!-- harness:begin\b/g) || []).length;
  const endCount = (current.match(/<!-- harness:end -->/g) || []).length;
  if (!beginCount && !endCount) return 'absent';
  if (beginCount !== endCount) {
    notes.push('CLAUDE.md has unmatched harness markers — left untouched');
    return 'marker-error';
  }

  const lines = current.split(/\r?\n/);
  const malformedMarkerLine = lines.some((line) => {
    if (line.includes('<!-- harness:begin')) {
      return !/^\s*<!-- harness:begin\b[^>]*-->\s*$/.test(line);
    }
    if (line.includes('<!-- harness:end -->')) {
      return !/^\s*<!-- harness:end -->\s*$/.test(line);
    }
    return false;
  });
  let markerOpen = false;
  let invalidOrder = false;
  for (const line of lines) {
    if (/^\s*<!-- harness:begin\b[^>]*-->\s*$/.test(line)) {
      if (markerOpen) invalidOrder = true;
      markerOpen = true;
    } else if (/^\s*<!-- harness:end -->\s*$/.test(line)) {
      if (!markerOpen) invalidOrder = true;
      markerOpen = false;
    }
  }
  if (malformedMarkerLine || invalidOrder || markerOpen) {
    notes.push('CLAUDE.md has malformed or misordered harness markers — left untouched');
    return 'marker-error';
  }

  const kept = [];
  let insideHarnessBlock = false;
  let justRemovedBlock = false;
  for (const line of lines) {
    if (/^\s*<!-- harness:begin\b[^>]*-->\s*$/.test(line)) {
      insideHarnessBlock = true;
      continue;
    }
    if (insideHarnessBlock) {
      if (/^\s*<!-- harness:end -->\s*$/.test(line)) {
        insideHarnessBlock = false;
        justRemovedBlock = true;
      }
      continue;
    }
    if (justRemovedBlock && !line.trim() && kept.at(-1)?.trim() === '') {
      justRemovedBlock = false;
      continue;
    }
    justRemovedBlock = false;
    kept.push(line);
  }
  const next = kept.join('\n').replace(/\n+$/, '');
  if (!next.trim()) {
    rmSync(claudeMdPath);
    return 'removed-file';
  }
  writeFileSync(claudeMdPath, next + '\n');
  return 'removed-block';
}

function removeGitignoreLine(gitignorePath) {
  if (!existsSync(gitignorePath)) return 'absent';
  const current = readFileSync(gitignorePath, 'utf8');
  const lines = current.split(/\r?\n/);
  const kept = lines.filter((line) => line.trim() !== '.claude/.harness-markers/');
  if (kept.length === lines.length) return 'absent';

  while (kept.length && kept.at(-1) === '') kept.pop();
  if (!kept.some((line) => line.trim())) {
    rmSync(gitignorePath);
    return 'removed-file';
  }
  writeFileSync(gitignorePath, kept.join('\n') + '\n');
  return 'removed-line';
}

function removeEmptyDir(path, cleaned) {
  if (!existsSync(path)) return;
  try {
    rmdirSync(path);
    cleaned.push(path);
  } catch (error) {
    if (error.code !== 'ENOTEMPTY') throw error;
  }
}

function main() {
  const args = parseArgs();
  const projectDir = resolve(args.projectDir || process.cwd());
  if (projectDir === parse(projectDir).root) fail('refusing to target a filesystem root');
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    fail(`projectDir is not a directory: ${projectDir}`);
  }

  const claudeDir = join(projectDir, '.claude');
  const notes = [];
  const actions = {};
  actions.hookScript = removeKnownPath(join(claudeDir, 'hooks', 'goal-gate.mjs'));
  actions.settings = removeHookRegistration(join(claudeDir, 'settings.json'), notes);
  actions.gate = removeKnownPath(join(claudeDir, 'harness-gate.json'));
  actions.embeddedRuntime = removeKnownPath(join(claudeDir, 'harness'));
  actions.markers = removeKnownPath(join(claudeDir, '.harness-markers'));
  actions.claudeMd = removeClaudeBlock(join(projectDir, 'CLAUDE.md'), notes);
  actions.gitignore = removeGitignoreLine(join(projectDir, '.gitignore'));

  if (args.purgeConventions === true) {
    actions.conventions = removeKnownPath(join(claudeDir, 'conventions'));
    notes.push('purgeConventions=true: the entire .claude/conventions directory was removed');
  } else {
    actions.conventions = existsSync(join(claudeDir, 'conventions')) ? 'kept' : 'absent';
    if (actions.conventions === 'kept') {
      notes.push('conventions were preserved because projects own and may customize them; use purgeConventions=true to remove them too');
    }
  }

  const cleanedDirs = [];
  removeEmptyDir(join(claudeDir, 'hooks'), cleanedDirs);
  removeEmptyDir(claudeDir, cleanedDirs);
  actions.cleanedDirs = cleanedDirs;

  process.stdout.write(JSON.stringify({ projectDir, actions, notes }, null, 2) + '\n');
}

main();
