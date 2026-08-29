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
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  buildIndex,
  evalQuestions,
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
      user_terms: ['결제 승인 화면'],
      source_symbols: ['PaymentService.authorize'],
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

  const byOperatorTerm = await searchIndex(root, '결제 승인 화면', { limit: 2 });
  assert.equal(byOperatorTerm.results[0].id, 'payments');
  assert.equal(byOperatorTerm.results[0].lexical_match, true);

  const bySourceSymbol = await searchIndex(root, 'PaymentService.authorize', { limit: 2 });
  assert.equal(bySourceSymbol.results[0].id, 'payments');
  assert.equal(bySourceSymbol.results[0].lexical_match, true);
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

test('ranks an exact title match above unrelated notes and bodyless graph nodes', async () => fixture(async (root) => {
  // Reproduces the 583-note vault failure: the note whose title matched the
  // query verbatim was pushed past rank 50 by graph-node records with no body.
  const notes = [];
  for (let index = 0; index < 60; index += 1) {
    write(join(root, 'notes', `filler-${index}.md`), `# Filler ${index}\n\n창고 운영 관련 일반 설명 문단 ${index}.\n`);
    notes.push({
      id: `filler-${index}`,
      path: `notes/filler-${index}.md`,
      title: `Filler ${index}`,
      summary: `창고 운영 문서 ${index}`,
    });
  }
  write(join(root, 'notes', 'defect-index.md'), '# 결함 색인 — 69건\n\n출고 결함 69건을 유형별로 모아둔 색인 문서다.\n');
  notes.push({
    id: 'defect-index',
    path: 'notes/defect-index.md',
    title: '결함 색인 — 69건',
    summary: '출고 결함 색인',
    aliases: ['결함 색인'],
  });
  write(join(root, '_knowledge', 'catalog.jsonl'), jsonl(notes));
  write(join(root, '_graph', 'nodes.jsonl'), jsonl(
    Array.from({ length: 60 }, (unused, index) => ({ id: `bare-${index}`, canonical_name: `Bare${index}` })),
  ));

  await buildIndex(root, { provider: 'hash', dimensions: 128 });
  const found = await searchIndex(root, '결함 색인', { limit: 5 });
  assert.equal(found.results[0].id, 'defect-index');
  assert.equal(found.results[0].lexical_match, true);
  assert.equal(found.embedding_quality, 'lexical-baseline');
  assert.ok(found.lexical_candidates > 0);
}));

test('recovers inflected Korean matches through the trigram index', async () => fixture(async (root) => {
  write(join(root, 'notes', 'retry.md'), '# 재시도 정책\n\n승인 실패는 세 번 재시도한 뒤 수동 검토 큐로 보낸다.\n');
  write(join(root, '_knowledge', 'catalog.jsonl'), jsonl([
    { id: 'retry', path: 'notes/retry.md', title: '재시도 정책' },
  ]));
  await buildIndex(root, { provider: 'hash', dimensions: 128 });

  const found = await searchIndex(root, '재시도', { limit: 2 });
  assert.equal(found.results[0].id, 'retry');
  assert.ok(found.lexical_trigram_matches > 0);
}));

test('refuses to query an index built by an older schema', async () => fixture(async (root) => {
  seed(root);
  const built = await buildIndex(root, { provider: 'hash', dimensions: 64 });
  const db = new DatabaseSync(built.database);
  db.prepare('UPDATE metadata SET value = ? WHERE key = ?').run('0', 'schema_version');
  db.close();
  await assert.rejects(() => searchIndex(root, '결제', {}), /Run knowledge_index to rebuild/);
}));

test('scores answerable competency questions at full recall', async () => fixture(async (root) => {
  seed(root);
  write(join(root, '_knowledge', 'questions.jsonl'), jsonl([
    {
      id: 'payment-retry-policy',
      question: '결제 승인 재시도',
      kind: 'direct',
      required_note_ids: ['payments'],
    },
  ]));
  await buildIndex(root, { provider: 'hash', dimensions: 128 });

  const scored = await evalQuestions(root, { k: 5 });
  assert.equal(scored.total, 1);
  assert.equal(scored.hits, 1);
  assert.equal(scored.recall_at_k, 1);
  assert.equal(scored.mrr, 1);
  assert.equal(scored.questions[0].question_id, 'payment-retry-policy');
  assert.equal(scored.questions[0].hit, true);
  assert.equal(scored.questions[0].first_rank, 1);
  assert.deepEqual(scored.questions[0].required_notes, [{ note_id: 'payments', rank: 1 }]);
  assert.equal(indexStatus(root).stale, false);
}));

test('reports unretrieved required notes as misses in the aggregate scores', async () => fixture(async (root) => {
  seed(root);
  write(join(root, '_knowledge', 'questions.jsonl'), jsonl([
    { id: 'payment-retry-policy', question: '결제 승인 재시도', required_note_ids: ['payments'] },
    { id: 'refund-policy', question: '환불 정책은 무엇인가', required_note_ids: ['refunds'] },
  ]));
  await buildIndex(root, { provider: 'hash', dimensions: 128 });

  const scored = await evalQuestions(root, { k: 5 });
  assert.equal(scored.total, 2);
  assert.equal(scored.hits, 1);
  assert.equal(scored.required_note_ids, 2);
  assert.equal(scored.required_note_ids_found, 1);
  assert.equal(scored.recall_at_k, 0.5);
  assert.equal(scored.mrr, 0.5);
  const missed = scored.questions.find((item) => item.question_id === 'refund-policy');
  assert.equal(missed.hit, false);
  assert.equal(missed.first_rank, null);
  assert.deepEqual(missed.required_notes, [{ note_id: 'refunds', rank: null }]);
}));

test('bounds the eval depth and requires a declared question set', async () => fixture(async (root) => {
  assert.equal(parseArgs(['eval', '--k', '3']).k, 3);
  assert.throws(() => parseArgs(['eval', '--k', '99']), /--k/);

  seed(root);
  await buildIndex(root, { provider: 'hash', dimensions: 128 });
  await assert.rejects(() => evalQuestions(root, {}), /No competency questions found at .*questions\.jsonl/);
}));

test('ranks a title match above a passing body mention of the same term', async () => fixture(async (root) => {
  // The title-matching note is the long one and never repeats the term in its
  // body; the rival is short and mentions the term twice. Length normalisation
  // alone therefore prefers the rival — only the title weight can flip it.
  write(join(root, 'notes', 'stock-count.md'), `# 분기 점검 절차\n\n${[
    '창고 담당자는 분기마다 정해진 순서로 점검을 수행한다.',
    '점검 대상 구역은 온도와 습도 기준에 따라 구분해 관리한다.',
    '파렛트 라벨을 확인하고 위치 배정을 다시 확인한다.',
    '이상 항목은 사유 코드를 기록한 뒤 검수 큐로 보낸다.',
    '결과는 주간 운영 회의에서 지표로 검토한다.',
    '보고서는 담당 팀장이 승인한 뒤 보관한다.',
    '승인되지 않은 항목은 다음 분기로 이월한다.',
    '이월 항목은 별도 목록으로 관리하고 추적한다.',
  ].join('\n')}\n`);
  write(join(root, 'notes', 'handbook.md'), '# Warehouse Operations Handbook\n\n창고 점검에는 재고 실사 절차가 포함된다. 재고 실사 결과는 보고서로 남긴다.\n');
  write(join(root, '_knowledge', 'catalog.jsonl'), jsonl([
    { id: 'stock-count', path: 'notes/stock-count.md', title: '재고 실사', summary: '분기 절차 안내' },
    { id: 'handbook', path: 'notes/handbook.md', title: 'Warehouse Operations Handbook', summary: '창고 운영 안내' },
  ]));
  await buildIndex(root, { provider: 'hash', dimensions: 128 });

  const found = await searchIndex(root, '재고 실사', { limit: 5 });
  const order = found.results.map((item) => item.id);
  assert.ok(order.indexOf('stock-count') < order.indexOf('handbook'), `unexpected order: ${order.join(', ')}`);
  assert.equal(found.results[0].id, 'stock-count');
}));

test('ranks a curated alias or user term above a passing body mention', async () => fixture(async (root) => {
  // Same shape as the title test: the curated note is long and carries the term
  // only in its alias and user term, while the rival repeats it in a short body.
  write(join(root, 'notes', 'ops-digest.md'), `# Quarterly Ops Digest\n\n${[
    '주요 운영 이슈를 분기 단위로 모아 정리한 문서다.',
    '각 이슈는 발생 시점과 영향 범위를 함께 기록한다.',
    '반복되는 민원은 사유 코드별로 집계해 추세를 본다.',
    '계약 갱신 시점에는 단가와 손해 배상 조항을 재검토한다.',
    '주간 스냅샷은 대시보드에 자동으로 반영된다.',
    '이상 징후는 운영 채널로 즉시 공유한다.',
    '분기 종료 후에는 담당 팀장이 요약본을 승인한다.',
    '승인된 요약본은 사내 위키에 보관한다.',
  ].join('\n')}\n`);
  write(join(root, 'notes', 'carrier-report.md'), '# Carrier Performance Report\n\n출고 지연 민원이 늘었다. 출고 지연 원인을 택배사별로 분석한다.\n');
  write(join(root, '_knowledge', 'catalog.jsonl'), jsonl([
    {
      id: 'ops-digest',
      path: 'notes/ops-digest.md',
      title: 'Quarterly Ops Digest',
      summary: '분기 운영 요약',
      aliases: ['출고 지연'],
      user_terms: ['출고 지연 리포트'],
    },
    { id: 'carrier-report', path: 'notes/carrier-report.md', title: 'Carrier Performance Report', summary: '택배사 성과' },
  ]));
  await buildIndex(root, { provider: 'hash', dimensions: 128 });

  const found = await searchIndex(root, '출고 지연', { limit: 5 });
  const order = found.results.map((item) => item.id);
  assert.ok(order.indexOf('ops-digest') < order.indexOf('carrier-report'), `unexpected order: ${order.join(', ')}`);
  assert.equal(found.results[0].id, 'ops-digest');
}));

test('still matches an inflected Korean body term the title does not contain', async () => fixture(async (root) => {
  write(join(root, 'notes', 'approval.md'), '# 승인 정책\n\n승인 실패는 세 번 재시도한 뒤 수동 검토 큐로 보낸다.\n');
  write(join(root, '_knowledge', 'catalog.jsonl'), jsonl([
    { id: 'approval', path: 'notes/approval.md', title: '승인 정책', summary: '승인 처리 규칙' },
  ]));
  await buildIndex(root, { provider: 'hash', dimensions: 128 });

  const found = await searchIndex(root, '재시도', { limit: 2 });
  assert.equal(found.results[0].id, 'approval');
  assert.equal(found.results[0].lexical_match, true);
  assert.ok(found.lexical_trigram_matches > 0);
  assert.equal(found.lexical_word_matches, 0);
}));

test('ranks a long title-and-alias match above many short body mentions', async () => fixture(async (root) => {
  // The fixture-vault geometry: one long note whose title and alias match the
  // query but whose body never repeats it, against many short notes that mention
  // it twice in the body. Scalar bm25() column weights lose this because BM25
  // normalises by the document's total length across every column.
  const notes = [];
  for (let index = 0; index < 20; index += 1) {
    write(join(root, 'notes', `filler-${index}.md`), `# Filler ${index}\n\n반품 회수 절차를 언급한다. 반품 회수 일정은 별도로 관리한다.\n`);
    notes.push({
      id: `filler-${index}`,
      path: `notes/filler-${index}.md`,
      title: `Filler ${index}`,
      summary: `운영 메모 ${index}`,
    });
  }
  write(join(root, 'notes', 'returns.md'), `# 반품 회수\n\n${Array.from({ length: 40 }, (unused, index) => (
    `창고 담당자는 지정된 순서에 따라 구역별 처리 절차를 수행한다 ${index}.`
  )).join('\n')}\n`);
  notes.push({
    id: 'returns',
    path: 'notes/returns.md',
    title: '반품 회수',
    summary: '구역별 처리 절차',
    aliases: ['반품 회수'],
  });
  write(join(root, '_knowledge', 'catalog.jsonl'), jsonl(notes));
  await buildIndex(root, { provider: 'hash', dimensions: 128 });

  const found = await searchIndex(root, '반품 회수', { limit: 10 });
  const order = found.results.map((item) => item.id);
  assert.equal(found.results[0].id, 'returns', `unexpected order: ${order.join(', ')}`);
  assert.equal(found.results[0].lexical_match, true);
  assert.equal(found.lexical_word_matches, notes.length);
}));
