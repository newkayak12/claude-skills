import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, extractPhrases } from './build-trophy-index.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'build-trophy-index.mjs');

function fixture(skills, plugins = ['alpha']) {
  const root = mkdtempSync(join(tmpdir(), 'trophy-idx-'));
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(
    join(root, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ plugins: plugins.map((name) => ({ name })) }),
  );
  mkdirSync(join(root, 'trophy', 'data'), { recursive: true });
  for (const [path, body] of Object.entries(skills)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

const run = (root, ...args) =>
  spawnSync('node', [SCRIPT, '--root', root, ...args], { encoding: 'utf8' });

test('extracts phrases after "Triggers on:"', () => {
  assert.deepEqual(
    extractPhrases('Use when x. Triggers on: "B Phrase", "a phrase".'),
    ['a phrase', 'b phrase'],
  );
});

test('extracts phrases after "Triggers:"', () => {
  assert.deepEqual(extractPhrases('Use when x. Triggers: "one", "two" Not for y.'), ['one', 'two']);
});

test('no trigger line gives no phrases', () => {
  assert.deepEqual(extractPhrases('Use when x. "quoted but not a trigger"'), []);
});

test('buildIndex reads folded multi-line descriptions', () => {
  const root = fixture({
    'alpha/skills/one/SKILL.md':
      '---\nname: one\ndescription: >-\n  Use when x. Triggers\n  on: "wrapped phrase", "do this\n  properly".\nlicense: MIT\n---\nbody\n',
    'alpha/skills/two/SKILL.md': '---\nname: two\ndescription: Use when y. Triggers: "Plain"\n---\n',
    'alpha/skills/three/SKILL.md': '---\nname: three\ndescription: Use when z.\n---\n',
  });
  assert.deepEqual(buildIndex(root), [
    { skill: 'alpha:one', plugin: 'alpha', phrases: ['do this properly', 'wrapped phrase'] },
    { skill: 'alpha:three', plugin: 'alpha', phrases: [] },
    { skill: 'alpha:two', plugin: 'alpha', phrases: ['plain'] },
  ]);
});

test('skills of a plugin missing from marketplace.json are skipped', () => {
  const root = fixture({
    'alpha/skills/one/SKILL.md': '---\nname: one\ndescription: Use when x.\n---\n',
    'ghost/skills/two/SKILL.md': '---\nname: two\ndescription: Use when y.\n---\n',
  });
  assert.deepEqual(buildIndex(root).map((s) => s.skill), ['alpha:one']);
});

test('--check exits 0 right after a write and 1 after a phrase changes', () => {
  const root = fixture({
    'alpha/skills/one/SKILL.md': '---\nname: one\ndescription: Use when x. Triggers: "first"\n---\n',
  });
  assert.equal(run(root, '--check').status, 1);
  assert.equal(run(root).status, 0);
  assert.equal(run(root, '--check').status, 0);
  writeFileSync(
    join(root, 'alpha/skills/one/SKILL.md'),
    '---\nname: one\ndescription: Use when x. Triggers: "second"\n---\n',
  );
  assert.equal(run(root, '--check').status, 1);
  assert.match(readFileSync(join(root, 'trophy/data/triggers.ts'), 'utf8'), /first/);
});
