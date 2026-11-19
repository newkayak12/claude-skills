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
