#!/usr/bin/env node

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BEGIN = '<!-- harness-codex-beta:begin -->';
const END = '<!-- harness-codex-beta:end -->';
const CLAUDE_BLOCK = `${BEGIN}
## Harness Codex integration beta

Stable harness remains the default. Only when the requester explicitly asks for the Codex
integration beta, run:

\`\`\`js
Workflow({
  scriptPath: ".claude/harness-codex-beta/engine/pipeline.js",
  args: {
    request: "<the request>",
    codex_provider: "auto",
    codex_adapter_path: ".claude/harness-codex-beta/engine/codex-exec-adapter.mjs",
    codex_add_dirs: []
  }
})
\`\`\`

Use \`codex_provider: "required"\` when provider failure must stop the graph. Add paths to
\`codex_add_dirs\` only with the requester's approval. Do not invoke this beta recursively from
an active Codex session.
${END}`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

let config;
try {
  config = JSON.parse(process.argv[2] || '');
} catch (error) {
  fail(`codex-integration-beta-install: expected one JSON argument (${error.message})`);
}

if (!config || typeof config.projectDir !== 'string' || !config.projectDir.trim()) {
  fail('codex-integration-beta-install: projectDir is required');
}

const projectDir = resolve(config.projectDir);
if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
  fail(`codex-integration-beta-install: projectDir is not a directory: ${projectDir}`);
}

const skillDir = dirname(fileURLToPath(import.meta.url));
const sourceEngine = join(skillDir, 'assets', 'engine');
const targetRoot = join(projectDir, '.claude', 'harness-codex-beta');
const targetEngine = join(targetRoot, 'engine');
const actions = [];

mkdirSync(targetEngine, { recursive: true });

function sameFile(left, right) {
  return readFileSync(left).equals(readFileSync(right));
}

function installOwnedFile(name, mode) {
  const source = join(sourceEngine, name);
  const target = join(targetEngine, name);
  if (!existsSync(target)) {
    copyFileSync(source, target);
    chmodSync(target, mode);
    actions.push({ path: target, status: 'created' });
    return;
  }
  if (!config.refresh) {
    actions.push({ path: target, status: 'kept' });
    return;
  }
  if (sameFile(source, target)) {
    actions.push({ path: target, status: 'unchanged' });
    return;
  }
  copyFileSync(source, target);
  chmodSync(target, mode);
  actions.push({ path: target, status: 'refreshed' });
}

installOwnedFile('pipeline.js', 0o644);
installOwnedFile('codex-exec-adapter.mjs', 0o755);

const claudePath = join(projectDir, 'CLAUDE.md');
if (existsSync(claudePath)) {
  const current = readFileSync(claudePath, 'utf8');
  if (current.includes(BEGIN) && current.includes(END)) {
    actions.push({ path: claudePath, status: 'kept' });
  } else {
    const separator = current.length && !current.endsWith('\n') ? '\n\n' : current.length ? '\n' : '';
    writeFileSync(claudePath, `${current}${separator}${CLAUDE_BLOCK}\n`);
    actions.push({ path: claudePath, status: 'created', detail: 'appended beta invocation block' });
  }
} else {
  writeFileSync(claudePath, `${CLAUDE_BLOCK}\n`);
  actions.push({ path: claudePath, status: 'created' });
}

process.stdout.write(JSON.stringify({
  ok: true,
  beta_root: targetRoot,
  stable_paths_touched: [],
  actions,
}, null, 2) + '\n');
