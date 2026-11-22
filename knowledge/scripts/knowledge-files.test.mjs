import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { STORE_CONFIG_SCHEMA, loadStoreConfig } from './knowledge-config.mjs';
import { listSources, pageText, readSource, readStoreFile, resolveInside } from './knowledge-files.mjs';
import { buildIndex, handleMcpMessage } from './sqlite-knowledge.mjs';

function tmp() {
  return mkdtempSync(join(tmpdir(), 'knowledge-files-'));
}

function put(path, text = 'x') {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

function store(config) {
  const root = tmp();
  put(join(root, 'index.md'), '# Index\nhello index');
  put(join(root, 'vault-plan.md'), '# Rules\nhello rules');
  if (config) put(join(root, '_knowledge', 'config.json'), JSON.stringify(config));
  return root;
}

test('files: pageText pages by characters and ends with next_offset null', () => {
  const text = '0123456789';
  const a = pageText(text, { max_chars: 4 });
  assert.deepEqual([a.text, a.offset, a.returned_chars, a.total_chars, a.next_offset], ['0123', 0, 4, 10, 4]);
  const b = pageText(text, { offset: 4, max_chars: 4 });
  assert.deepEqual([b.text, b.next_offset], ['4567', 8]);
  const c = pageText(text, { offset: 8, max_chars: 4 });
  assert.deepEqual([c.text, c.returned_chars, c.next_offset], ['89', 2, null]);
  const whole = pageText(text);
  assert.deepEqual([whole.text, whole.next_offset], [text, null]);
});

test('files: pageText refuses bad arguments and an offset past the end is empty', () => {
  assert.throws(() => pageText('abc', { offset: -1 }));
  assert.throws(() => pageText('abc', { offset: 1.5 }));
  assert.throws(() => pageText('abc', { max_chars: 0 }));
  const past = pageText('abc', { offset: 3, max_chars: 2 });
  assert.deepEqual([past.text, past.next_offset, past.total_chars], ['', null, 3]);
  assert.equal(pageText('abc', { offset: 99 }).text, '');
});

test('files: resolveInside refuses traversal, absolute, NUL, empty and symlink escapes', () => {
  const base = tmp();
  const outside = tmp();
  put(join(outside, 'secret.md'), 'secret');
  put(join(base, 'a', 'b.md'), 'ok');
  symlinkSync(join(outside, 'secret.md'), join(base, 'link.md'));
  symlinkSync(outside, join(base, 'dirlink'));
  for (const bad of ['', '../x', 'a/../../x', '/etc/passwd', 'a\0b', '..\\x', 'a\\..\\..\\x', 'link.md', 'dirlink/new.md', 'dirlink/secret.md']) {
    assert.throws(() => resolveInside(base, bad), undefined, JSON.stringify(bad));
  }
  assert.throws(() => resolveInside(base, '../x'), /outside/);
  assert.ok(resolveInside(base, 'a/b.md').endsWith(join('a', 'b.md')));
  assert.ok(resolveInside(base, 'a/missing.md').endsWith(join('a', 'missing.md')));
});

test('files: readStoreFile reads default index and rules and honours the config', () => {
  const root = store();
  assert.match(readStoreFile(root, 'index').text, /hello index/);
  assert.match(readStoreFile(root, 'rules').text, /hello rules/);
  const paged = readStoreFile(root, 'index', { max_chars: 7 });
  assert.equal(paged.text, '# Index');
  assert.equal(paged.next_offset, 7);

  const custom = store({ files: { rules: 'docs/rules.md' } });
  put(join(custom, 'docs', 'rules.md'), 'custom rules');
  assert.equal(readStoreFile(custom, 'rules').text, 'custom rules');
  assert.match(readStoreFile(custom, 'index').text, /hello index/);

  const escape = store({ files: { index: '../outside.md' } });
  assert.throws(() => readStoreFile(escape, 'index'), /outside/);
});

test('files: readStoreFile names the path and the config key when the file is missing', () => {
  const root = tmp();
  assert.throws(() => readStoreFile(root, 'rules'), (error) => /vault-plan\.md/.test(error.message) && /files\.rules/.test(error.message));
  assert.throws(() => readStoreFile(root, 'other'));
});

test('files: listSources is recursive, sorted, filtered, limited and skips escaping symlinks', () => {
  const root = store();
  assert.equal(listSources(root).total, 0);
  const sources = join(root, 'sources');
  put(join(sources, 'b.md'), 'bb');
  put(join(sources, 'a', 'z.txt'), 'zzz');
  put(join(sources, 'a', 'c.md'), 'c');
  const outside = tmp();
  put(join(outside, 'secret.md'), 'secret');
  symlinkSync(join(outside, 'secret.md'), join(sources, 'leak.md'));
  symlinkSync(outside, join(sources, 'leakdir'));
  const all = listSources(root);
  assert.deepEqual(all.results.map((r) => r.path), ['a/c.md', 'a/z.txt', 'b.md']);
  assert.equal(all.total, 3);
  assert.equal(all.truncated, false);
  assert.equal(all.results[2].bytes, 2);
  assert.ok(all.results[0].modified);
  assert.deepEqual(listSources(root, { prefix: 'a/' }).results.map((r) => r.path), ['a/c.md', 'a/z.txt']);
  assert.throws(() => listSources(root, { prefix: '../' }), /outside/);
  const cut = listSources(root, { limit: 2 });
  assert.equal(cut.results.length, 2);
  assert.equal(cut.truncated, true);
  assert.equal(cut.total, 3);
});

test('files: readSource pages text and refuses escapes, directories and binaries', () => {
  const root = store();
  const sources = join(root, 'sources');
  put(join(sources, 'a', 'note.txt'), 'abcdefghij');
  put(join(sources, 'bin.dat'), Buffer.from([65, 0, 66]));
  put(join(root, '_knowledge', 'catalog.jsonl'), '{}');
  const page = readSource(root, 'a/note.txt', { offset: 2, max_chars: 3 });
  assert.equal(page.text, 'cde');
  assert.equal(page.next_offset, 5);
  assert.equal(page.bytes, 10);
  assert.equal(page.binary, false);
  assert.throws(() => readSource(root, '../_knowledge/catalog.jsonl'), /outside/);
  assert.throws(() => readSource(root, '/etc/hosts'));
  assert.throws(() => readSource(root, 'a'), /director/i);
  const bin = readSource(root, 'bin.dat');
  assert.equal(bin.binary, true);
  assert.equal(bin.text, undefined);
});

test('files: config key files has schema defaults and merges with the store config', () => {
  const spec = STORE_CONFIG_SCHEMA.properties.files;
  assert.equal(spec.additionalProperties, false);
  assert.equal(spec.properties.index.default, 'index.md');
  assert.equal(spec.properties.rules.default, 'vault-plan.md');
  assert.deepEqual(loadStoreConfig(tmp(), {}).files, { index: 'index.md', rules: 'vault-plan.md' });
  const root = store({ files: { rules: 'docs/rules.md' } });
  assert.deepEqual(loadStoreConfig(root, {}).files, { index: 'index.md', rules: 'docs/rules.md' });
});

const LONG = `# Long\n\n${'abcdefghij'.repeat(40)}\n`;

async function mcp(root, name, args) {
  const out = await handleMcpMessage({
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args },
  }, { root, db: null });
  return out.result;
}

async function indexedStore() {
  const root = store();
  put(join(root, 'notes', 'long.md'), LONG);
  put(join(root, '_knowledge', 'catalog.jsonl'), `${JSON.stringify({ id: 'long', path: 'notes/long.md', title: 'Long', summary: 'long note' })}\n`);
  await buildIndex(root, { provider: 'hash', dimensions: 64 });
  return root;
}

test('mcp get: max_chars pages an id and offset continues it exactly', async () => {
  const root = await indexedStore();
  const whole = (await mcp(root, 'knowledge_get', { id: 'long', kind: 'note' })).structuredContent.results[0].text;
  const a = (await mcp(root, 'knowledge_get', { id: 'long', kind: 'note', max_chars: 50 })).structuredContent;
  assert.equal(a.results[0].text.length, 50);
  assert.equal(a.results[0].page.next_offset, 50);
  const b = (await mcp(root, 'knowledge_get', { id: 'long', kind: 'note', offset: 50 })).structuredContent;
  assert.equal(a.results[0].text + b.results[0].text, whole);
  assert.equal(b.results[0].page.next_offset, null);
});

test('mcp get: without paging args the result has no page key', async () => {
  const root = await indexedStore();
  const r = (await mcp(root, 'knowledge_get', { id: 'long', kind: 'note' })).structuredContent.results[0];
  assert.equal('page' in r, false);
  assert.equal(r.text.includes('abcdefghij'), true);
});

test('mcp get: file index and rules read without a built index and page', async () => {
  const root = store();
  const idx = (await mcp(root, 'knowledge_get', { file: 'index' })).structuredContent;
  assert.equal(idx.text, '# Index\nhello index');
  const rules = (await mcp(root, 'knowledge_get', { file: 'rules', max_chars: 10 })).structuredContent;
  assert.equal(rules.text, '# Rules\nhe');
  assert.equal(rules.next_offset, 10);
});

test('mcp get: neither or both of id and file is an error', async () => {
  const root = store();
  assert.equal((await mcp(root, 'knowledge_get', {})).isError, true);
  assert.equal((await mcp(root, 'knowledge_get', { id: 'x', file: 'index' })).isError, true);
});

test('mcp get: tools/list shows file, offset and max_chars and no required id', async () => {
  const out = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { root: store(), db: null });
  const tool = out.result.tools.find((t) => t.name === 'knowledge_get');
  const p = tool.inputSchema.properties;
  assert.deepEqual(p.file.enum, ['index', 'rules']);
  assert.deepEqual([p.offset.type, p.offset.minimum, p.max_chars.type, p.max_chars.minimum], ['integer', 0, 'integer', 1]);
  assert.equal(tool.inputSchema.required, undefined);
});

function sourcesStore() {
  const root = store();
  put(join(root, 'sources', 'a.txt'), 'alpha text 0123456789');
  put(join(root, 'sources', 'sub', 'b.txt'), 'beta');
  put(join(root, 'secret.txt'), 'TOP SECRET');
  put(join(root, '_knowledge', 'catalog.jsonl'), '{"id":"x"}\n');
  return root;
}

test('mcp source: list shows two seeded files and read pages with max_chars', async () => {
  const root = sourcesStore();
  const list = (await mcp(root, 'knowledge_source_list', {})).structuredContent;
  assert.deepEqual(list.results.map((r) => r.path), ['a.txt', 'sub/b.txt']);
  const p1 = (await mcp(root, 'knowledge_source', { path: 'a.txt', max_chars: 5 })).structuredContent;
  assert.equal(p1.text, 'alpha');
  const p2 = (await mcp(root, 'knowledge_source', { path: 'a.txt', offset: p1.next_offset })).structuredContent;
  assert.equal(p1.text + p2.text, 'alpha text 0123456789');
  assert.equal((await mcp(root, 'knowledge_source_list', { prefix: 'sub/' })).structuredContent.total, 1);
});

test('mcp source: escapes are refused with outside', async () => {
  const root = sourcesStore();
  const outside = mkdtempSync(join(tmpdir(), 'knowledge-out-'));
  put(join(outside, 'x.txt'), 'out');
  symlinkSync(join(outside, 'x.txt'), join(root, 'sources', 'link.txt'));
  for (const path of ['../_knowledge/catalog.jsonl', '/etc/hosts', 'link.txt']) {
    const r = await mcp(root, 'knowledge_source', { path });
    assert.equal(r.isError, true, path);
    assert.match(r.content[0].text, /outside/, path);
  }
  const l = await mcp(root, 'knowledge_source_list', { prefix: '../' });
  assert.equal(l.isError, true);
  assert.match(l.content[0].text, /outside/);
});

test('mcp source: a file beside sources is never listed or read', async () => {
  const root = sourcesStore();
  const list = (await mcp(root, 'knowledge_source_list', {})).structuredContent;
  assert.equal(JSON.stringify(list).includes('secret'), false);
  for (const path of ['secret.txt', '../secret.txt']) {
    assert.equal((await mcp(root, 'knowledge_source', { path })).isError, true, path);
  }
});

test('mcp source: a prefix on a store with no sources dir lists nothing', async () => {
  const list = (await mcp(store(), 'knowledge_source_list', { prefix: 'a/' })).structuredContent;
  assert.equal(list.total, 0);
  assert.deepEqual(list.results, []);
  assert.equal((await mcp(store(), 'knowledge_source_list', { prefix: '../' })).isError, true);
});

test('mcp source: tools/list states read-only and confined to sources', async () => {
  const out = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { root: store(), db: null });
  for (const name of ['knowledge_source_list', 'knowledge_source']) {
    const tool = out.result.tools.find((t) => t.name === name);
    assert.match(tool.description, /read-only/i);
    assert.match(tool.description, /sources\//);
  }
  const read = out.result.tools.find((t) => t.name === 'knowledge_source');
  assert.deepEqual(read.inputSchema.required, ['path']);
});
