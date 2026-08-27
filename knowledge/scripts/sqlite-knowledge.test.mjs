import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  buildIndex,
  getDocument,
  graphNeighbors,
  handleMcpMessage,
  indexStatus,
  parseArgs,
  searchIndex,
} from './sqlite-knowledge.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'sqlite-knowledge-'));
  return Promise.resolve(run(root)).finally(() => rmSync(root, { recursive: true, force: true }));
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function jsonl(records) {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

function seed(root) {
  write(join(root, 'notes', 'payments.md'), '# Payments\n\n결제 승인은 PaymentService가 담당한다.\n');
  write(join(root, 'notes', 'shipping.md'), '# Shipping\n\n배송 추적과 택배 상태를 설명한다.\n');
  write(join(root, '_knowledge', 'catalog.jsonl'), jsonl([
    {
      id: 'payments',
      path: 'notes/payments.md',
      title: 'Payment Authorization',
      summary: '결제 승인 처리',
      aliases: ['payment approval'],
      source_refs: ['src/PaymentService.ts'],
    },
    {
      id: 'shipping',
      path: 'notes/shipping.md',
      title: 'Shipping Tracking',
      summary: '배송 조회',
      source_refs: ['src/ShippingService.ts'],
    },
  ]));
  write(join(root, '_rag', 'chunks.jsonl'), jsonl([
    {
      id: 'payment-retry',
      note_id: 'payments',
      title: 'Payment retry policy',
      text: '결제 승인 실패는 세 번 재시도한 뒤 수동 검토 큐로 보낸다.',
      source_ref: 'notes/payments.md#retry',
    },
  ]));
  write(join(root, '_graph', 'nodes.jsonl'), jsonl([
    { id: 'checkout', canonical_name: 'CheckoutService', label: 'Service' },
    { id: 'payments-service', canonical_name: 'PaymentService', label: 'Service', aliases: ['결제 서비스'] },
  ]));
  write(join(root, '_graph', 'edges.jsonl'), jsonl([
    {
      id: 'checkout-payments',
      from: 'checkout',
      to: 'payments-service',
      type: 'DEPENDS_ON',
      evidence: 'Checkout delegates authorization.',
      source_refs: ['src/CheckoutService.ts'],
    },
  ]));
}

test('parses commands and validates bounded options', () => {
  assert.deepEqual(
    parseArgs(['search', 'payments', '--limit', '3', '--kind', 'chunk']).command,
    'search',
  );
  assert.throws(() => parseArgs(['index', '--provider', 'remote']), /Unsupported/);
  assert.throws(() => parseArgs(['search', 'x', '--limit', '0']), /--limit/);
});

test('builds SQLite from catalog, RAG, and graph artifacts', async () => fixture(async (root) => {
  seed(root);
  const built = await buildIndex(root, { provider: 'hash', dimensions: 128 });
  assert.equal(built.documents, 5);
  assert.equal(built.notes, 2);
  assert.equal(built.chunks, 1);
  assert.equal(built.nodes, 2);
  assert.equal(built.edges, 1);

  const status = indexStatus(root);
  assert.equal(status.exists, true);
  assert.equal(status.stale, false);
  assert.equal(status.counts.chunk, 1);
  assert.equal(status.graph.edges, 1);

  const header = readFileSync(built.database).subarray(0, 15).toString();
  assert.equal(header, 'SQLite format 3');
}));

test('hybrid search returns grounded results and full records by ID', async () => fixture(async (root) => {
  seed(root);
  await buildIndex(root, { provider: 'hash', dimensions: 128 });

  const found = await searchIndex(root, '결제 승인 재시도', { limit: 3 });
  assert.equal(found.results[0].id, 'payment-retry');
  assert.equal(found.results[0].source_ref, 'notes/payments.md#retry');
  assert.equal(found.results[0].lexical_match, true);

  const fetched = getDocument(root, 'payments', { kind: 'note' });
  assert.equal(fetched.results.length, 1);
  assert.match(fetched.results[0].text, /PaymentService/);
  assert.equal(fetched.results[0].metadata.path, 'notes/payments.md');
}));

test('queries direct graph relationships by canonical name', async () => fixture(async (root) => {
  seed(root);
  await buildIndex(root, { provider: 'hash', dimensions: 128 });

  const graph = graphNeighbors(root, 'CheckoutService', { direction: 'out' });
  assert.equal(graph.node.id, 'checkout');
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].relationship_type, 'DEPENDS_ON');
  assert.equal(graph.edges[0].target.id, 'payments-service');
}));

test('detects stale source artifacts after indexing', async () => fixture(async (root) => {
  seed(root);
  await buildIndex(root, { provider: 'hash', dimensions: 128 });
  write(join(root, 'notes', 'payments.md'), '# Payments\n\n변경된 결제 정책\n');
  assert.equal(indexStatus(root).stale, true);
}));

test('supports portable knowledge-artifacts graph and RAG directories', async () => fixture(async (project) => {
  const root = join(project, 'knowledge-artifacts');
  write(join(root, 'rag', 'chunks.jsonl'), jsonl([
    { id: 'portable', text: 'portable RAG record', source_ref: 'docs/source.md' },
  ]));
  write(join(root, 'graph', 'nodes.jsonl'), jsonl([
    { id: 'portable-node', canonical_name: 'PortableNode' },
  ]));
  const built = await buildIndex(project, { provider: 'hash', dimensions: 64 });
  assert.equal(built.root, root);
  assert.equal(built.chunks, 1);
  assert.equal(built.nodes, 1);
}));

test('exposes index and retrieval through MCP tool calls', async () => fixture(async (root) => {
  seed(root);
  const initialize = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18' },
  }, { root, db: null });
  assert.equal(initialize.result.serverInfo.name, 'knowledge-local');

  const indexed = await handleMcpMessage({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'knowledge_index', arguments: { provider: 'hash' } },
  }, { root, db: null });
  assert.equal(indexed.result.structuredContent.documents, 5);

  const searched = await handleMcpMessage({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'knowledge_search', arguments: { query: '배송 추적', limit: 2 } },
  }, { root, db: null });
  assert.equal(searched.result.isError, undefined);
  assert.equal(searched.result.structuredContent.results[0].id, 'shipping');
}));
