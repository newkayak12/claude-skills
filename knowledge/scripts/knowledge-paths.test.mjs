import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findKnowledgeRoot,
  findRootForFile,
  storeRootForWrite,
} from './knowledge-paths.mjs';

function project(t) {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-paths-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function put(path, text = '') {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

function seedStore(dir) {
  put(join(dir, '_knowledge', 'catalog.jsonl'), '{"id":"a","path":"notes/a.md"}\n');
  put(join(dir, 'notes', 'a.md'), '# A\n');
}

for (const name of ['', 'knowledge-system', 'knowledge-base', 'knowledge-artifacts']) {
  test(`hook and indexer agree on a store at ${name || 'the project root'}`, (t) => {
    const dir = project(t);
    const store = name ? join(dir, name) : dir;
    seedStore(store);
    assert.equal(findKnowledgeRoot(dir), store);
    assert.equal(findRootForFile(dir, join(store, 'notes', 'a.md')).root, store);
    assert.equal(storeRootForWrite(dir), store);
  });
}

test('a project with no store reads at its root and writes under knowledge-system/', (t) => {
  const dir = project(t);
  assert.equal(findKnowledgeRoot(dir), dir);
  assert.equal(storeRootForWrite(dir), join(dir, 'knowledge-system'));
  assert.equal(findRootForFile(dir, join(dir, 'README.md')), null);
});

test('after the first write under knowledge-system/, every entry point lands there', (t) => {
  const dir = project(t);
  const store = storeRootForWrite(dir);
  seedStore(store);
  assert.equal(findKnowledgeRoot(dir), store);
  assert.equal(findRootForFile(dir, join(store, 'notes', 'a.md')).root, store);
  assert.equal(storeRootForWrite(dir), store);
});

test('an empty knowledge-system/ directory is the store before any artifact exists', (t) => {
  const dir = project(t);
  mkdirSync(join(dir, 'knowledge-system', 'notes'), { recursive: true });
  assert.equal(findKnowledgeRoot(dir), join(dir, 'knowledge-system'));
  assert.equal(findRootForFile(dir, join(dir, 'knowledge-system', 'notes', 'b.md')).root, join(dir, 'knowledge-system'));
});

test('config root redirects once and is not chained', (t) => {
  const dir = project(t);
  const first = join(dir, 'knowledge-system');
  const second = join(dir, 'elsewhere');
  seedStore(first);
  seedStore(second);
  put(join(first, '_knowledge', 'config.json'), JSON.stringify({ root: '../elsewhere' }));
  put(join(second, '_knowledge', 'config.json'), JSON.stringify({ root: '../third' }));
  assert.equal(findKnowledgeRoot(dir), second);
  assert.equal(storeRootForWrite(dir), second);
});

test('a broken config names its file', (t) => {
  const dir = project(t);
  seedStore(dir);
  put(join(dir, '_knowledge', 'config.json'), '{not json');
  assert.throws(() => findKnowledgeRoot(dir), /config\.json/);
});

test('a file outside cwd has no store', (t) => {
  const dir = project(t);
  seedStore(dir);
  assert.equal(findRootForFile(join(dir, 'notes'), join(dir, 'other', 'x.md')), null);
});
