import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '../hooks/knowledge-delta-check.mjs';
import { addRelated, captureNote, findTerm } from './knowledge-capture.mjs';
import { handleMcpMessage } from './sqlite-knowledge.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-capture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function put(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

// A store with two notes: one the capture will name, one it will not.
function store(t) {
  const project = tempDir(t);
  const root = join(project, 'knowledge-system');
  const notes = [
    { id: 'payment-authorization', path: 'notes/payment-authorization.md', title: 'Payment Authorization', aliases: ['결제 승인'] },
    { id: 'retry-policy', path: 'notes/retry-policy.md', title: 'Retry Policy', aliases: [] },
  ];
  for (const note of notes) {
    put(join(root, note.path), `---\nid: ${note.id}\ntitle: ${note.title}\nsources:\n  - src/x.ts\n---\n\n# ${note.title}\n\nBody.\n\n## Sources\n\n- \`src/x.ts\`\n`);
  }
  put(join(root, '_knowledge', 'catalog.jsonl'), `${notes.map((n) => JSON.stringify(n)).join('\n')}\n`);
  return { project, root };
}

const read = (path) => readFileSync(path, 'utf8');
const catalogRows = (root) => read(join(root, '_knowledge', 'catalog.jsonl')).trim().split('\n').map((l) => JSON.parse(l));

function inboundLinks(root, target) {
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('_')) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith('.md') && read(abs).includes(`[[${target}|`)) hits.push(abs);
    }
  };
  walk(root);
  return hits;
}

test('writes the note with frontmatter and appends its catalog row', async (t) => {
  const { project, root } = store(t);
  const result = await captureNote(project, {
    title: 'Card Decline Handling',
    content: 'When Payment Authorization fails the order is held.',
    aliases: ['decline flow'],
    sources: ['https://example.test/doc'],
  });
  assert.equal(result.created, true);
  assert.equal(result.path, 'notes/card-decline-handling.md');
  const note = read(join(root, result.path));
  for (const field of ['id: card-decline-handling', 'title: Card Decline Handling', '  - decline flow', '  - "https://example.test/doc"']) {
    assert.ok(note.includes(field), field);
  }
  const row = catalogRows(root).at(-1);
  assert.deepEqual([row.id, row.path, row.title], ['card-decline-handling', 'notes/card-decline-handling.md', 'Card Decline Handling']);
  assert.deepEqual(row.related, ['payment-authorization']);
});

test('links only a note the text names; an index hit it does not name is skipped with a reason', async (t) => {
  const { project, root } = store(t);
  const search = async () => ({ results: [
    { note_id: 'retry-policy', title: 'Retry Policy', score: 0.4 },
    { note_id: 'payment-authorization', title: 'Payment Authorization', score: 0.3 },
  ] });
  const result = await captureNote(project, {
    title: 'Hold on decline',
    content: 'payment authorization is retried once, then held.',
  }, { search });
  assert.deepEqual(result.linked_to.map((l) => l.id), ['payment-authorization']);
  assert.deepEqual(result.skipped_candidates, [{ id: 'retry-policy', title: 'Retry Policy', reason: 'not-in-text', score: 0.4 }]);
  const note = read(join(root, result.path));
  assert.ok(note.includes('[[notes/payment-authorization|payment authorization]] is retried'));
  assert.ok(!note.includes('retry-policy'));
});

test('a Korean alias links through a particle; code spans and words containing it do not', () => {
  assert.equal(findTerm('결제 승인을 거절했다', '결제 승인'), 0);
  assert.equal(findTerm('`결제 승인` 코드', '결제 승인'), -1);
  assert.equal(findTerm('Prepayment Authorization', 'Payment Authorization'), -1);
  assert.equal(findTerm('see [[x|Payment Authorization]]', 'Payment Authorization'), -1);
});

test('a Hangul match extends only across a listed particle', () => {
  assert.equal(findTerm('결제 승인서 검토', '결제 승인'), -1);
  assert.equal(findTerm('결제 승인서', '결제 승인'), -1);
  assert.equal(findTerm('결제 승인 검토', '결제 승인'), 0);
  assert.equal(findTerm('결제 승인은 끝났다', '결제 승인'), 0);
  assert.equal(findTerm('결제 승인.', '결제 승인'), 0);
});

test('the linked note gets one backlink and the new note is never an orphan', async (t) => {
  const { project, root } = store(t);
  const result = await captureNote(project, { title: 'Decline', content: '결제 승인을 실패하면 보류한다.' });
  assert.deepEqual(result.backlinked_from, ['notes/payment-authorization.md']);
  const other = read(join(root, 'notes/payment-authorization.md'));
  assert.ok(/## Related\n\n- \[\[notes\/decline\|Decline\]\]\n\n## Sources/.test(other), other);
  assert.equal(inboundLinks(root, 'notes/decline').length, 1);
  assert.equal(addRelated(other, 'notes/decline', 'Decline'), null);
});

test('a capture that names no note is listed in the fallback map of content', async (t) => {
  const { project, root } = store(t);
  const result = await captureNote(project, { title: 'Lunch Menu', content: 'Nothing related here.' });
  assert.deepEqual(result.linked_to, []);
  assert.deepEqual(result.backlinked_from, ['mocs/captures.md']);
  assert.equal(inboundLinks(root, 'notes/lunch-menu').length, 1);
});

test('the new note has no dead links and no duplicate id or title', async (t) => {
  const { project, root } = store(t);
  const result = await captureNote(project, { title: 'Decline', content: 'Payment Authorization and Retry Policy both apply.' });
  assert.deepEqual(result.linked_to.map((l) => l.id).sort(), ['payment-authorization', 'retry-policy']);
  for (const path of [result.path, ...result.backlinked_from]) {
    assert.deepEqual(analyze(root, join(root, path)).broken_links, [], path);
  }
  const rows = catalogRows(root);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  assert.equal(new Set(rows.map((r) => r.title.toLowerCase())).size, rows.length);
});

test('the same concept returns merged_into and writes nothing', async (t) => {
  const { project, root } = store(t);
  const before = read(join(root, '_knowledge', 'catalog.jsonl'));
  for (const args of [{ title: 'payment  authorization', content: 'x' }, { title: 'Other', aliases: ['결제 승인'], content: 'x' }]) {
    const result = await captureNote(project, args);
    assert.equal(result.created, false);
    assert.equal(result.merged_into.id, 'payment-authorization');
  }
  assert.equal(read(join(root, '_knowledge', 'catalog.jsonl')), before);
  assert.equal(existsSync(join(root, '_knowledge', 'jobs')), false);
});

test('catalog, graph and embed queues receive the capture', async (t) => {
  const { project, root } = store(t);
  const result = await captureNote(project, { title: 'Decline', content: 'Retry Policy applies.' });
  assert.deepEqual(result.jobs, ['catalog', 'embed', 'graph']);
  const jobs = join(root, '_knowledge', 'jobs');
  const catalogJob = JSON.parse(read(join(jobs, 'catalog-delta-queue.jsonl')).trim());
  assert.deepEqual([catalogJob.file, catalogJob.note_id, catalogJob.operation], ['notes/decline.md', 'decline', 'upsert-note']);
  const embed = read(join(jobs, 'embed-queue.jsonl')).trim().split('\n').map((l) => JSON.parse(l).file);
  assert.deepEqual(embed, ['notes/decline.md', 'notes/retry-policy.md']);
});

test('ids: a slug collision gets a suffix, a taken caller id is refused', async (t) => {
  const { project, root } = store(t);
  put(join(root, 'notes', 'decline.md'), '# untracked\n');
  const result = await captureNote(project, { title: 'Decline', content: 'x' });
  assert.equal(result.id, 'decline-2');
  await assert.rejects(captureNote(project, { title: 'New', id: 'retry-policy', content: 'x' }), /already taken/);
  await assert.rejects(captureNote(project, { title: 'New', id: '../escape', content: 'x' }), /must be letters/);
});

test('config moves notes and names a map of content; env overrides the file', async (t) => {
  const { project, root } = store(t);
  put(join(root, '_knowledge', 'config.json'), JSON.stringify({ notes_dir: 'inbox', link: { moc: 'mocs/all.md' } }));
  const result = await captureNote(project, { title: 'Decline', content: 'Retry Policy applies.' });
  assert.equal(result.path, 'inbox/decline.md');
  assert.deepEqual(result.backlinked_from, ['notes/retry-policy.md', 'mocs/all.md']);
  process.env.KNOWLEDGE_NOTES_DIR = 'elsewhere';
  t.after(() => { delete process.env.KNOWLEDGE_NOTES_DIR; });
  const second = await captureNote(project, { title: 'Second', content: 'x' });
  assert.equal(second.path, 'elsewhere/second.md');
});

test('over MCP: tools/list names knowledge_capture, and a fresh project gets knowledge-system/', async (t) => {
  const project = tempDir(t);
  const list = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { root: project });
  assert.ok(list.result.tools.some((tool) => tool.name === 'knowledge_capture'));
  const call = await handleMcpMessage({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'knowledge_capture', arguments: { title: 'First', content: 'Hello.' } },
  }, { root: project });
  assert.equal(call.result.isError, undefined, call.result.content?.[0]?.text);
  const result = call.result.structuredContent;
  assert.equal(result.root, join(project, 'knowledge-system'));
  assert.ok(existsSync(join(project, 'knowledge-system', 'notes', 'first.md')));
  assert.ok(result.skipped_candidates.some((s) => s.reason === 'no-index'));
  assert.equal(existsSync(join(project, '_knowledge')), false);
});

test('no instance name appears in engine code', () => {
  for (const dir of [here, join(here, '..', 'hooks'), join(here, '..', 'servers')]) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.mjs') || name.endsWith('.test.mjs')) continue;
      assert.doesNotMatch(read(join(dir, name)), /\b(noah|genna)\b/i, name);
    }
  }
});

// ---- knowledge_note_replace (card 164, U5) ----
import { symlinkSync } from 'node:fs';
import { buildIndex } from './sqlite-knowledge.mjs';
import { replaceNote } from './knowledge-capture.mjs';

const ODD_ROW = '{ "title" : "Odd Note",   "path":"notes/odd.md", "id":"odd", "extra": [1,  2] }';

function replaceStore(t) {
  delete process.env.KNOWLEDGE_NOTES_DIR;
  const { project, root } = store(t);
  put(join(root, 'notes', 'odd.md'), '# Odd\n');
  const catalog = join(root, '_knowledge', 'catalog.jsonl');
  put(catalog, `${read(catalog)}${ODD_ROW}\n`);
  put(join(root, 'index.md'), '# index\n');
  put(join(root, 'vault-plan.md'), '# plan\n');
  put(join(root, 'sources', 'x.md'), 'source text\n');
  put(join(root, '_rag', 'x.md'), '# rag\n');
  put(join(root, '_graph', 'x.md'), '# graph\n');
  put(join(root, 'docs', 'other.md'), '# other\n');
  put(join(project, 'outside.md'), 'outside\n');
  return { project, root, catalog };
}

const NEW_NOTE = '---\nid: retry-policy\ntitle: Retry Backoff Policy\n---\n\n# Retry Backoff Policy\n\nZephyrquokka backoff doubles each attempt.\n';

function snapshot(root, project) {
  const files = ['notes/retry-policy.md', 'index.md', 'vault-plan.md', 'sources/x.md', '_knowledge/catalog.jsonl'];
  return [...files.map((f) => read(join(root, f))), read(join(project, 'outside.md'))];
}

test('replace: by id rewrites the file and only its catalog row; other lines stay verbatim', async (t) => {
  const { project, root, catalog } = replaceStore(t);
  const before = read(catalog).split('\n');
  const result = await replaceNote(project, { id: 'retry-policy', content: NEW_NOTE });
  assert.equal(result.replaced, true);
  assert.equal(result.id, 'retry-policy');
  assert.equal(result.path, 'notes/retry-policy.md');
  assert.equal(result.catalogued, true);
  assert.equal(result.indexed, null);
  assert.equal(result.index_error, null);
  assert.equal(read(join(root, 'notes', 'retry-policy.md')), NEW_NOTE);
  assert.equal(result.bytes, Buffer.byteLength(NEW_NOTE));
  const after = read(catalog).split('\n');
  assert.equal(after.length, before.length);
  assert.equal(after[0], before[0]);
  assert.equal(after[2], ODD_ROW);
  assert.equal(after.at(-1), '');
  const row = JSON.parse(after[1]);
  assert.equal(row.title, 'Retry Backoff Policy');
  assert.match(row.summary, /Zephyrquokka/);
  assert.deepEqual([row.id, row.path], ['retry-policy', 'notes/retry-policy.md']);
  assert.equal(catalogRows(root).length, 3);
  assert.equal(readdirSync(join(root, '_knowledge')).some((n) => n.includes('tmp')), false);
  const job = JSON.parse(read(join(root, '_knowledge', 'jobs', 'catalog-delta-queue.jsonl')).trim().split('\n').at(-1));
  assert.deepEqual([job.file, job.note_id, job.reason], ['notes/retry-policy.md', 'retry-policy', 'knowledge_note_replace']);
  assert.deepEqual(result.jobs, ['catalog', 'embed', 'graph']);
});

test('replace: by path notes/retry-policy.md works the same', async (t) => {
  const { project, root, catalog } = replaceStore(t);
  const before = read(catalog).split('\n');
  const result = await replaceNote(project, { path: 'notes/retry-policy.md', content: NEW_NOTE });
  assert.equal(result.id, 'retry-policy');
  assert.equal(read(join(root, 'notes', 'retry-policy.md')), NEW_NOTE);
  const after = read(catalog).split('\n');
  assert.equal(after[2], ODD_ROW);
  assert.equal(JSON.parse(after[1]).title, 'Retry Backoff Policy');
  assert.equal(after[0], before[0]);
});

test('replace: an uncatalogued note inside notes_dir is written and reported catalogued: false', async (t) => {
  const { project, root, catalog } = replaceStore(t);
  put(join(root, 'notes', 'loose.md'), '# loose\n');
  const before = read(catalog);
  const result = await replaceNote(project, { path: 'notes/loose.md', content: '# Loose two\n\nText.\n' });
  assert.equal(result.catalogued, false);
  assert.equal(read(join(root, 'notes', 'loose.md')), '# Loose two\n\nText.\n');
  assert.equal(read(catalog), before);
});

test('replace: refusals throw and leave the store unchanged', async (t) => {
  const { project, root } = replaceStore(t);
  symlinkSync(join(project, 'outside.md'), join(root, 'notes', 'link-out.md'));
  symlinkSync(join(root, 'index.md'), join(root, 'notes', 'link-index.md'));
  symlinkSync(join(root, 'sources', 'x.md'), join(root, 'notes', 'link-source.md'));
  put(join(root, 'notes', 'x.txt'), 'text\n');
  const before = snapshot(root, project);
  const content = '# changed\n';
  const cases = [
    [{ id: 'no-such-id' }, /unknown/i],
    [{ path: '../outside.md' }, /outside/],
    [{ path: join(project, 'outside.md') }, /outside|absolute/],
    [{ path: 'notes/link-out.md' }, /outside/],
    [{ path: 'notes/link-index.md' }, /refus/i],
    [{ path: 'notes/link-source.md' }, /refus/i],
    [{ path: 'sources/x.md' }, /refus/i],
    [{ path: 'index.md' }, /refus/i],
    [{ path: 'vault-plan.md' }, /refus/i],
    [{ path: 'notes/missing.md' }, /knowledge_capture/],
    [{ path: '_knowledge/catalog.jsonl' }, /\.md|refus/i],
    [{ path: '_rag/x.md' }, /refus/i],
    [{ path: '_graph/x.md' }, /refus/i],
    [{ path: '_rag/chunks.jsonl' }, /\.md/],
    [{ path: 'docs/other.md' }, /notes|catalog/i],
    [{ path: 'notes/x.txt' }, /\.md/],
    [{ id: 'retry-policy', content: '---\nid: other-id\n---\n\nbody\n' }, /id/],
    [{}, /exactly one/i],
    [{ id: 'retry-policy', path: 'notes/retry-policy.md' }, /exactly one/i],
  ];
  for (const [args, pattern] of cases) {
    await assert.rejects(replaceNote(project, { content, ...args }), pattern, JSON.stringify(args));
  }
  assert.deepEqual(snapshot(root, project), before);
  assert.equal(read(join(root, 'notes', 'x.txt')), 'text\n');
});

test('replace: refuses a project with no store and creates none', async (t) => {
  const project = tempDir(t);
  await assert.rejects(replaceNote(project, { path: 'notes/a.md', content: 'x' }), /store/i);
  assert.equal(existsSync(join(project, 'knowledge-system')), false);
});

test('replace: content is required', async (t) => {
  const { project } = replaceStore(t);
  await assert.rejects(replaceNote(project, { id: 'retry-policy' }), /content/);
});

test('replace: over MCP re-indexes with the existing index settings and the note is found', async (t) => {
  const { project } = replaceStore(t);
  await buildIndex(project, { provider: 'hash', dimensions: 64, embedChars: 512 });
  const call = (name, args) => handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { root: project });
  const meta = async () => (await call('knowledge_status', {})).result.structuredContent.metadata;
  const pick = (m) => [m.embedding_provider, m.embedding_model, m.embedding_dimensions, m.embedding_context_chars];
  const beforeMeta = pick(await meta());
  assert.equal(beforeMeta[2], '64');
  assert.equal(beforeMeta[3], '512');
  const replaced = await call('knowledge_note_replace', { id: 'retry-policy', content: NEW_NOTE });
  assert.equal(replaced.result.isError, undefined, replaced.result.content?.[0]?.text);
  const out = replaced.result.structuredContent;
  assert.ok(out.indexed > 0);
  assert.equal(out.index_error, null);
  assert.deepEqual(pick(await meta()), beforeMeta);
  const found = (await call('knowledge_search', { query: 'Zephyrquokka' })).result.structuredContent;
  assert.equal(found.results[0].note_id, 'retry-policy');
  const got = (await call('knowledge_get', { id: 'retry-policy' })).result.structuredContent;
  assert.ok(got.results.some((r) => String(r.text).includes('Zephyrquokka')));
});

test('replace: a throwing deps.index still replaces the file and reports index_error', async (t) => {
  const { project, root } = replaceStore(t);
  const result = await replaceNote(project, { id: 'retry-policy', content: NEW_NOTE }, { index: async () => { throw new Error('boom'); } });
  assert.equal(read(join(root, 'notes', 'retry-policy.md')), NEW_NOTE);
  assert.equal(result.indexed, null);
  assert.match(result.index_error, /boom/);
});

test('replace: with no built index the file is replaced, a job queued, and no index created', async (t) => {
  const { project, root } = replaceStore(t);
  const call = await handleMcpMessage({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'knowledge_note_replace', arguments: { id: 'retry-policy', content: NEW_NOTE } },
  }, { root: project });
  assert.equal(call.result.isError, undefined, call.result.content?.[0]?.text);
  const out = call.result.structuredContent;
  assert.equal(out.indexed, null);
  assert.equal(out.index_error, null);
  assert.equal(read(join(root, 'notes', 'retry-policy.md')), NEW_NOTE);
  assert.equal(existsSync(join(root, '.knowledge')), false);
  assert.equal(existsSync(join(root, '_knowledge', 'jobs', 'embed-queue.jsonl')), true);
});

test('replace: tools/list names knowledge_note_replace', async (t) => {
  const list = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { root: tempDir(t) });
  const tool = list.result.tools.find((x) => x.name === 'knowledge_note_replace');
  assert.ok(tool);
  assert.ok(tool.inputSchema.required.includes('content'));
});

// ---- replace: identity checks (card 164, s4 attempt 2) ----
import { linkSync, statSync as statOf } from 'node:fs';

// Probe, never assume: true when 'A.md' and 'a.md' name one file here.
function caseInsensitive(dir) {
  put(join(dir, 'caseprobe.md'), 'x');
  return existsSync(join(dir, 'CASEPROBE.md'));
}

test('replace: case variants of protected files are refused (probe the filesystem)', async (t) => {
  const { project, root } = replaceStore(t);
  if (!caseInsensitive(root)) return t.skip('case-sensitive filesystem');
  put(join(root, 'notes', 'rules.md'), '# rules\n');
  put(join(root, '_knowledge', 'config.json'), JSON.stringify({ files: { rules: 'notes/rules.md' } }));
  const before = snapshot(root, project);
  const rulesBefore = read(join(root, 'notes', 'rules.md'));
  const run = async (paths, pattern) => {
    for (const path of paths) await assert.rejects(replaceNote(project, { content: '# changed\n', path }), pattern, path);
  };
  try {
    await run(['notes/RULES.md', 'Notes/Rules.md'], /refus/i);
    process.env.KNOWLEDGE_NOTES_DIR = '.';
    await run(['Sources/x.md', 'INDEX.md', 'VAULT-PLAN.md', '_RAG/x.md', '_Graph/x.md', 'sources/X.md'], /refus/i);
  } finally {
    delete process.env.KNOWLEDGE_NOTES_DIR;
  }
  assert.deepEqual(snapshot(root, project), before);
  assert.equal(read(join(root, 'notes', 'rules.md')), rulesBefore);
});

test('replace: a notes/ file hard-linked to index, rules or a source is refused', async (t) => {
  const { project, root } = replaceStore(t);
  linkSync(join(root, 'index.md'), join(root, 'notes', 'hl-index.md'));
  linkSync(join(root, 'vault-plan.md'), join(root, 'notes', 'hl-plan.md'));
  linkSync(join(root, 'sources', 'x.md'), join(root, 'notes', 'hl-source.md'));
  const before = snapshot(root, project);
  for (const path of ['notes/hl-index.md', 'notes/hl-plan.md', 'notes/hl-source.md']) {
    await assert.rejects(replaceNote(project, { content: '# changed\n', path }), /refus/i, path);
  }
  assert.deepEqual(snapshot(root, project), before);
  assert.equal(statOf(join(root, 'index.md')).ino, statOf(join(root, 'notes', 'hl-index.md')).ino);
});

test('replace: notes_dir at or above the store root does not widen beyond protections', async (t) => {
  const { project, root } = replaceStore(t);
  const before = snapshot(root, project);
  const insensitive = caseInsensitive(root);
  try {
    for (const dir of ['.', '..', '/']) {
      process.env.KNOWLEDGE_NOTES_DIR = dir;
      const paths = ['sources/x.md', 'index.md', 'vault-plan.md', 'docs/other.md', 'notes/missing.md'];
      if (insensitive) paths.push('Sources/x.md', 'INDEX.md');
      for (const path of paths) {
        await assert.rejects(replaceNote(project, { content: '# changed\n', path }), /refus|notes_dir|knowledge_capture/i, `${dir} ${path}`);
      }
    }
    // a catalogued note still replaces
    const ok = await replaceNote(project, { id: 'retry-policy', content: NEW_NOTE });
    assert.equal(ok.replaced, true);
  } finally {
    delete process.env.KNOWLEDGE_NOTES_DIR;
  }
  const after = snapshot(root, project);
  assert.deepEqual([...after.slice(1, 4), after[5]], [...before.slice(1, 4), before[5]]);
  assert.equal(read(join(root, 'docs', 'other.md')), '# other\n');
});

test('replace: content missing the frontmatter id of a catalogued note is refused', async (t) => {
  const { project, root } = replaceStore(t);
  const before = snapshot(root, project);
  for (const content of ['# no frontmatter\n', '---\ntitle: T\n---\n\nbody\n']) {
    await assert.rejects(replaceNote(project, { id: 'retry-policy', content }), /id/);
    await assert.rejects(replaceNote(project, { path: 'notes/retry-policy.md', content }), /id/);
  }
  assert.deepEqual(snapshot(root, project), before);
});

import { renameSync as moveFile } from 'node:fs';

test('replace: a protected folder symlinked to a folder inside notes/ is refused by either name', async (t) => {
  for (const dir of ['sources', '_rag', '_knowledge', '_graph']) {
    const { project, root } = replaceStore(t);
    put(join(root, dir, 'x.md'), `# ${dir}\n`);
    mkdirSync(join(root, 'notes', 'deep'), { recursive: true });
    moveFile(join(root, dir), join(root, 'notes', 'deep', dir));
    symlinkSync(join('notes', 'deep', dir), join(root, dir));
    const target = join(root, 'notes', 'deep', dir, 'x.md');
    const before = [read(target), ...snapshot(root, project)];
    for (const path of [`${dir}/x.md`, `notes/deep/${dir}/x.md`]) {
      await assert.rejects(replaceNote(project, { content: '# changed\n', path }), /refus/i, `${dir} ${path}`);
    }
    assert.deepEqual([read(target), ...snapshot(root, project)], before, dir);
  }
});

test('replace: index and rules files that are symlinks or linked into notes/ are refused', async (t) => {
  const { project, root } = replaceStore(t);
  put(join(root, 'notes', 'real-index.md'), '# real index\n');
  put(join(root, 'notes', 'real-plan.md'), '# real plan\n');
  rmSync(join(root, 'index.md'));
  rmSync(join(root, 'vault-plan.md'));
  symlinkSync(join('notes', 'real-index.md'), join(root, 'index.md'));
  symlinkSync(join('notes', 'real-plan.md'), join(root, 'vault-plan.md'));
  symlinkSync(join('..', 'index.md'), join(root, 'notes', 'sl-index.md'));
  const before = ['notes/real-index.md', 'notes/real-plan.md'].map((f) => read(join(root, f)));
  for (const path of ['notes/real-index.md', 'notes/real-plan.md', 'notes/sl-index.md', 'index.md', 'vault-plan.md']) {
    await assert.rejects(replaceNote(project, { content: '# changed\n', path }), /refus/i, path);
  }
  assert.deepEqual(['notes/real-index.md', 'notes/real-plan.md'].map((f) => read(join(root, f))), before);
});
