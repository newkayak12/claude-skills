#!/usr/bin/env node
// Deterministically prepare a harness patch release across both manifests and README status.
// Usage: node patch.mjs '{"summary":"concise release note","repoRoot":"/abs/repo"}'
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PLUGIN_ROOT = resolve(HERE, '..', '..');
const DEFAULT_REPO_ROOT = resolve(DEFAULT_PLUGIN_ROOT, '..');

function fail(message) {
  process.stderr.write(`patch.mjs: ${message}\n`);
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

function readJson(path, label) {
  if (!existsSync(path)) fail(`${label} not found: ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function nextPatch(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) fail(`plugin version is not plain semver: ${version}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function main() {
  const args = parseArgs();
  const summary = String(args.summary || '').trim();
  if (!summary) fail('summary is required so README Status stays in sync');
  if (/\r|\n/.test(summary)) fail('summary must be a single line');

  const repoRoot = resolve(args.repoRoot || DEFAULT_REPO_ROOT);
  const pluginRoot = args.repoRoot ? join(repoRoot, 'harness') : DEFAULT_PLUGIN_ROOT;
  const pluginPath = join(pluginRoot, '.claude-plugin', 'plugin.json');
  const marketplacePath = join(repoRoot, '.claude-plugin', 'marketplace.json');
  const readmePath = join(pluginRoot, 'README.md');
  const plugin = readJson(pluginPath, 'harness plugin.json');
  const marketplace = readJson(marketplacePath, 'marketplace.json');
  if (!existsSync(readmePath)) fail(`harness README not found: ${readmePath}`);
  if (plugin.name !== 'harness') fail(`expected harness plugin, found: ${plugin.name || '<unnamed>'}`);

  const entry = (marketplace.plugins || []).find((candidate) => candidate.name === 'harness');
  if (!entry) fail('marketplace has no harness plugin entry');
  if (entry.version !== plugin.version) {
    fail(`version mismatch: plugin.json=${plugin.version}, marketplace.json=${entry.version}`);
  }

  const previousVersion = plugin.version;
  const version = nextPatch(previousVersion);
  const readme = readFileSync(readmePath, 'utf8');
  if (!readme.includes('## Status\n')) fail('README has no "## Status" heading');
  if (readme.includes(`- v${version} —`)) fail(`README already has a v${version} status entry`);

  plugin.version = version;
  entry.version = version;
  const nextReadme = readme.replace('## Status\n', `## Status\n- v${version} — ${summary}\n`);

  const report = {
    repoRoot,
    previousVersion,
    version,
    summary,
    dryRun: args.dryRun === true,
    files: [pluginPath, marketplacePath, readmePath],
  };
  if (!report.dryRun) {
    writeFileSync(pluginPath, JSON.stringify(plugin, null, 2) + '\n');
    writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + '\n');
    writeFileSync(readmePath, nextReadme);
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main();
