import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  catalogRows,
  connectionEnv,
  createSchemaSql,
  graphEdgeRows,
  loadConfig,
  ragRows,
  upsertSql,
} from './postgres-sync.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'postgres-knowledge-sync-'));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

test('loads catalog bodies and stable retrieval metadata', () => {
  fixture((root) => {
    write(join(root, 'notes', 'billing.md'), '# Billing\n');
    write(
      join(root, '_knowledge', 'catalog.jsonl'),
      `${JSON.stringify({
        id: 'billing',
        path: 'notes/billing.md',
        title: "Customer's Billing",
        tags: ['payments'],
        user_terms: ['결제 화면'],
        source_symbols: ['BillingService.charge'],
        source_refs: ['src/billing.ts'],
      })}\n`,
    );

    const rows = catalogRows(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].body, '# Billing\n');
    assert.deepEqual(rows[0].tags, ['payments']);
    assert.deepEqual(rows[0].userTerms, ['결제 화면']);
    assert.deepEqual(rows[0].sourceSymbols, ['BillingService.charge']);
    assert.match(rows[0].contentHash, /^[a-f0-9]{64}$/);
  });
});

test('loads RAG embeddings and derives deterministic graph edge ids', () => {
  fixture((root) => {
    write(
      join(root, '_rag', 'chunks.jsonl'),
      `${JSON.stringify({ id: 'c1', text: 'hello', embedding: [0.1, 0.2] })}\n`,
    );
    write(
      join(root, '_graph', 'edges.jsonl'),
      `${JSON.stringify({ from: 'a', to: 'b', type: 'DEPENDS_ON', source_refs: ['x.md'] })}\n`,
    );

    assert.deepEqual(ragRows(root)[0].embedding, [0.1, 0.2]);
    const first = graphEdgeRows(root)[0].edgeId;
    const second = graphEdgeRows(root)[0].edgeId;
    assert.equal(first, second);
    assert.match(first, /^[a-f0-9]{64}$/);
  });
});

test('generates pgvector schema and idempotent upsert with soft deletion', () => {
  const config = {
    schema: 'knowledge',
    workspaceId: 'workspace-1',
    embeddingDimensions: 1536,
  };
  const schemaSql = createSchemaSql(config);
  assert.match(schemaSql, /CREATE EXTENSION IF NOT EXISTS vector/);
  assert.match(schemaSql, /embedding::vector\(1536\)/);

  const sql = upsertSql(
    config,
    {
      catalog: [{
        noteId: 'n1', path: 'n.md', title: "It's here", summary: null, noteType: 'concept',
        domain: null, tags: [], aliases: [], userTerms: [], sourceSymbols: [], entities: [],
        sourceRefs: [], status: null,
        confidence: null, body: 'body', metadata: {}, contentHash: 'hash',
      }],
      rag: null,
      nodes: null,
      edges: null,
    },
    'batch-1',
  );
  assert.match(sql, /ON CONFLICT \(workspace_id, note_id\) DO UPDATE/);
  assert.match(sql, /user_terms = EXCLUDED\.user_terms/);
  assert.match(sql, /It''s here/);
  assert.match(sql, /SET deleted_at = now\(\)/);
  assert.match(sql, /COMMIT/);
});

test('validates config and keeps DATABASE_URL credentials out of psql arguments', () => {
  fixture((root) => {
    write(
      join(root, '.knowledge', 'postgres.json'),
      JSON.stringify({ workspace_id: 'w1', schema: 'knowledge', embedding_dimensions: 768 }),
    );
    const config = loadConfig(root);
    assert.equal(config.embeddingDimensions, 768);

    const env = connectionEnv({
      DATABASE_URL: 'postgresql://alice:s%40cret@db.example.com:5433/app?sslmode=require',
    });
    assert.equal(env.PGHOST, 'db.example.com');
    assert.equal(env.PGPORT, '5433');
    assert.equal(env.PGDATABASE, 'app');
    assert.equal(env.PGUSER, 'alice');
    assert.equal(env.PGPASSWORD, 's@cret');
    assert.equal(env.PGSSLMODE, 'require');
  });
});
