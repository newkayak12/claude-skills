import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { backendFor, backendName, sizeAdvice } from './knowledge-backend.mjs';
import { migrateSql, migrateTarget } from './knowledge-migrate.mjs';
import { buildIndex, indexStatus, migrateToPgvector, searchIndex } from './sqlite-knowledge.mjs';

function put(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function builtStore(t) {
  const project = mkdtempSync(join(tmpdir(), 'knowledge-migrate-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const root = join(project, 'knowledge-system');
  put(join(root, 'notes', 'a.md'), "---\nid: a\ntitle: Alpha's note\nsources:\n  - x\n---\n\n# Alpha\n\nAlpha depends on Beta.\n");
  put(join(root, 'notes', 'b.md'), '---\nid: b\ntitle: Beta\nsources:\n  - y\n---\n\n# Beta\n\nBeta stores rows.\n');
  put(join(root, '_knowledge', 'catalog.jsonl'), '{"id":"a","path":"notes/a.md","title":"Alpha\'s note","summary":"alpha"}\n{"id":"b","path":"notes/b.md","title":"Beta","summary":"beta"}\n');
  put(join(root, '_graph', 'nodes.jsonl'), '{"id":"a","canonical_name":"Alpha"}\n{"id":"b","canonical_name":"Beta"}\n');
  put(join(root, '_graph', 'edges.jsonl'), '{"id":"e1","source":"a","target":"b","type":"DEPENDS_ON","evidence":"Alpha depends on Beta.","source_refs":["notes/a.md"]}\n');
  return { project, root };
}

test('backend: sqlite by default, config or env may name another, pgvector is refused until wired', (t) => {
  const { root } = builtStore(t);
  assert.equal(backendName(root, {}, {}), 'sqlite');
  assert.equal(backendName(root, {}, { KNOWLEDGE_BACKEND: 'pgvector' }), 'pgvector');
  assert.throws(() => backendFor(root, {}, { KNOWLEDGE_BACKEND: 'pgvector' }), /not wired/);
  assert.throws(() => backendName(root, { backend: 'mongo' }, {}), /unknown backend/);
  put(join(root, '_knowledge', 'config.json'), JSON.stringify({ storage: { backend: 'pgvector' } }));
  assert.equal(backendName(root, {}, {}), 'pgvector');
});

test('entry points go through the backend: a store set to pgvector refuses search', async (t) => {
  const { project, root } = builtStore(t);
  await buildIndex(project);
  assert.ok((await searchIndex(project, 'Alpha')).results.length > 0);
  put(join(root, '_knowledge', 'config.json'), JSON.stringify({ storage: { backend: 'pgvector' } }));
  await assert.rejects(async () => searchIndex(project, 'Alpha'), /not wired/);
});

test('status reports size, the threshold and whether pgvector is advised', async (t) => {
  const { project, root } = builtStore(t);
  await buildIndex(project);
  const status = indexStatus(project);
  assert.equal(status.backend, 'sqlite');
  assert.equal(status.size.documents, Object.values(status.counts).reduce((a, b) => a + b, 0));
  assert.ok(status.size.bytes >= status.bytes);
  assert.equal(status.size.pgvector_advised, false);
  put(join(root, '_knowledge', 'config.json'), JSON.stringify({ storage: { pgvector_threshold: { documents: 2 } } }));
  assert.equal(indexStatus(project).size.pgvector_advised, true);
  assert.match(sizeAdvice(50000, 1, {}).reason, /documents 50000 >= 20000/);
});

test('migrate SQL mirrors every sqlite row, escapes quotes and replaces the workspace', async (t) => {
  const { project, root } = builtStore(t);
  await buildIndex(project);
  const out = join(project, 'migrate.sql');
  const result = migrateToPgvector(project, { workspace: 'ws1', schema: 'kn', sqlOut: out });
  const sql = readFileSync(out, 'utf8');
  assert.deepEqual(result.source, {
    documents: result.source.documents, embeddings: result.source.documents, relations: 0, nodes: 2, edges: 1, metadata: result.source.metadata,
  });
  assert.equal((sql.match(/INSERT INTO kn\.kn_documents /g) || []).length, result.source.documents);
  assert.equal((sql.match(/INSERT INTO kn\.kn_graph_edges /g) || []).length, 1);
  assert.ok(sql.includes("'Alpha''s note'"));
  assert.ok(sql.includes("DELETE FROM kn.kn_documents WHERE workspace_id = 'ws1';"));
  assert.match(result.vector_index, /^hnsw vector\(384\)$/);
  assert.ok(/'\[-?\d/.test(sql), 'embeddings are written as vector literals');
});

test('migrate: more than 2000 dimensions copies rows but skips the index; a workspace is required', (t) => {
  const { sql, vectorIndex } = migrateSql({ documents: [], relations: [], nodes: [], edges: [], metadata: [], dimensions: 3072 }, { workspaceId: 'w', schema: 's' });
  assert.match(vectorIndex, /skipped: 3072 dimensions > 2000/);
  assert.ok(!sql.includes('hnsw'));
  const { root } = builtStore(t);
  assert.throws(() => migrateTarget(root, {}, {}), /needs a workspace/);
  assert.throws(() => migrateTarget(root, { workspace: 'w', schema: 'bad-name' }, {}), /Invalid PostgreSQL schema/);
  put(join(root, '.knowledge', 'postgres.json'), JSON.stringify({ workspace_id: 'from-file', schema: 'kx' }));
  assert.deepEqual(migrateTarget(root, {}, {}), { workspaceId: 'from-file', schema: 'kx' });
});
