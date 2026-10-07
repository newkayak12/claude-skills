#!/usr/bin/env node
// Writes trophy/data/triggers.json from every <plugin>/skills/*/SKILL.md whose plugin is listed
// in .claude-plugin/marketplace.json. `--check` writes nothing and exits 1 when the file is stale.
// Usage: node _repo/scripts/build-trophy-index.mjs [--check] [--root <dir>]
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join('trophy', 'data', 'triggers.json');

// Same simple frontmatter reading as validate_plugins.py: `key: value`, folded lines joined.
function frontmatter(text) {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const fields = {};
  let key = null;
  let buf = [];
  const flush = () => {
    if (key && buf.length) fields[key] = buf.join(' ').trim();
  };
  for (const line of text.slice(3, end).trim().split('\n')) {
    const m = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (m) {
      flush();
      key = m[1];
      const val = m[2].trim().replace(/^(['"])(.*)\1$/, '$2').replace(/^[>-]+/, '').trim();
      buf = val ? [val] : [];
    } else if (key && line.startsWith('  ')) {
      buf.push(line.trim());
    }
  }
  flush();
  return fields;
}

// Double-quoted strings after `Triggers on:` or `Triggers:`, lower-cased and sorted.
export function extractPhrases(description) {
  const m = description.match(/Triggers(?:\s+on)?:([\s\S]*)/);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1].trim().toLowerCase()).sort();
}

export function buildIndex(root) {
  const market = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const index = [];
  for (const { name: plugin } of market.plugins) {
    const skillsDir = join(root, plugin, 'skills');
    if (!existsSync(skillsDir)) continue;
    for (const dir of readdirSync(skillsDir)) {
      const file = join(skillsDir, dir, 'SKILL.md');
      if (!existsSync(file)) continue;
      const fm = frontmatter(readFileSync(file, 'utf8'));
      index.push({
        skill: `${plugin}:${fm.name || dir}`,
        plugin,
        phrases: extractPhrases(fm.description || ''),
      });
    }
  }
  return index.sort((a, b) => a.skill.localeCompare(b.skill));
}

function main(argv) {
  const rootAt = argv.indexOf('--root');
  const root =
    rootAt === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..', '..') : argv[rootAt + 1];
  const next = JSON.stringify(buildIndex(root), null, 2) + '\n';
  const file = join(root, OUT);
  if (argv.includes('--check')) {
    const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (current !== next) {
      console.error(`${OUT} is stale: run node _repo/scripts/build-trophy-index.mjs`);
      process.exit(1);
    }
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, next);
  console.log(`wrote ${OUT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
