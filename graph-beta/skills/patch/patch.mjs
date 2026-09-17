#!/usr/bin/env node
// Prepare a patch release for a plugin in this marketplace: bump x.y.Z in plugin.json and the
// marketplace entry, and prepend one status line to README (## Status) AND KOR.md (## 상태) -
// this repository moves the two together. For a source checkout only.
// Usage: node patch.mjs '{"plugin":"graph-beta","repoRoot":"/abs","summary":"...","summary_ko":"...","dryRun":true}'
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(HERE, '..', '..', '..');

function fail(m) { process.stderr.write(`patch.mjs: ${m}\n`); process.exit(2); }
function parseArgs() {
  const raw = process.argv[2];
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { fail(`argv[1] is not valid JSON: ${e.message}`); }
}
function readJson(path, label) {
  if (!existsSync(path)) fail(`${label} not found: ${path}`);
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { fail(`${label} is not valid JSON: ${e.message}`); }
}
function nextPatch(v) {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(v);
  if (!m) fail(`plugin version is not plain semver: ${v}`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}
function oneLine(v, name) {
  const s = String(v || '').trim();
  if (!s) fail(`${name} is required so the status logs stay in sync`);
  if (/\r|\n/.test(s)) fail(`${name} must be a single line`);
  return s;
}
function prepend(text, heading, line, label) {
  if (!text.includes(`${heading}\n`)) fail(`${label} has no "${heading}" heading`);
  if (text.includes(line)) fail(`${label} already has this status entry`);
  return text.replace(`${heading}\n`, `${heading}\n${line}\n`);
}

function main() {
  const args = parseArgs();
  const plugin = String(args.plugin || 'graph-beta');
  const summary = oneLine(args.summary, 'summary');
  const summaryKo = oneLine(args.summary_ko, 'summary_ko');
  const repoRoot = resolve(args.repoRoot || DEFAULT_REPO_ROOT);
  const pluginRoot = join(repoRoot, plugin);
  const pluginPath = join(pluginRoot, '.claude-plugin', 'plugin.json');
  const marketplacePath = join(repoRoot, '.claude-plugin', 'marketplace.json');
  const readmePath = join(pluginRoot, 'README.md');
  const korPath = join(pluginRoot, 'KOR.md');
  const pluginJson = readJson(pluginPath, `${plugin} plugin.json`);
  const marketplace = readJson(marketplacePath, 'marketplace.json');
  if (!existsSync(readmePath)) fail(`README not found: ${readmePath}`);
  if (!existsSync(korPath)) fail(`KOR.md not found: ${korPath}`);
  if (pluginJson.name !== plugin) fail(`expected plugin "${plugin}", found: ${pluginJson.name || '<unnamed>'}`);
  const entry = (marketplace.plugins || []).find((p) => p.name === plugin);
  if (!entry) fail(`marketplace has no ${plugin} entry`);
  if (entry.version !== pluginJson.version) fail(`version mismatch: plugin.json=${pluginJson.version}, marketplace.json=${entry.version}`);

  const previousVersion = pluginJson.version;
  const version = nextPatch(previousVersion);
  const nextReadme = prepend(readFileSync(readmePath, 'utf8'), '## Status', `- v${version} — ${summary}`, 'README');
  const nextKor = prepend(readFileSync(korPath, 'utf8'), '## 상태', `- v${version} — ${summaryKo}`, 'KOR.md');
  pluginJson.version = version;
  entry.version = version;

  const report = { plugin, repoRoot, previousVersion, version, summary, summary_ko: summaryKo, dryRun: args.dryRun === true, files: [pluginPath, marketplacePath, readmePath, korPath] };
  if (!report.dryRun) {
    writeFileSync(pluginPath, JSON.stringify(pluginJson, null, 2) + '\n');
    writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + '\n');
    writeFileSync(readmePath, nextReadme);
    writeFileSync(korPath, nextKor);
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main();
