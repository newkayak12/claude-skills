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
  listDocuments,
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
  assert.equal(parseArgs(['eval', '--lexical-weight', '0.55']).lexicalWeight, 0.55);
  assert.throws(() => parseArgs(['eval', '--lexical-weight', '1.4']), /--lexical-weight/);
});

test('overrides the fusion split so the weights can be swept, not guessed', async () => fixture(async (root) => {
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

  const defaults = await searchIndex(root, '결제 승인 재시도', { limit: 3 });
  assert.deepEqual(defaults.fusion_weights, { semantic: 0, lexical: 1 });

  const swept = await searchIndex(root, '결제 승인 재시도', { limit: 3, lexicalWeight: 0.3 });
  assert.deepEqual(swept.fusion_weights, { semantic: 0.7, lexical: 0.3 });

  // A run.json has to record which split produced it, or a sweep cannot be read
  // back afterwards.
  const scored = await evalQuestions(root, { k: 5, lexicalWeight: 0.3 });
  assert.deepEqual(scored.fusion_weights, { semantic: 0.7, lexical: 0.3 });
}));

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

test('partitions questions into a stable dev and holdout split', async () => fixture(async (root) => {
  assert.equal(parseArgs(['eval', '--split', 'holdout']).split, 'holdout');
  assert.throws(() => parseArgs(['eval', '--split', 'test']), /--split/);
  assert.throws(() => parseArgs(['eval', '--holdout', '0.9']), /--holdout/);

  seed(root);
  write(join(root, '_knowledge', 'questions.jsonl'), jsonl(
    Array.from({ length: 24 }, (unused, index) => ({
      id: `q${index}`,
      question: '결제 승인 재시도',
      required_note_ids: ['payments'],
    })),
  ));
  await buildIndex(root, { provider: 'hash', dimensions: 128 });

  const dev = await evalQuestions(root, { k: 5, split: 'dev' });
  const holdout = await evalQuestions(root, { k: 5, split: 'holdout' });
  // Ids differing only in their last characters must still spread across both
  // buckets; an unmixed hash drops the whole set into one split.
  assert.equal(dev.evaluated + holdout.evaluated, 24);
  assert.ok(holdout.evaluated >= 4 && holdout.evaluated <= 14, `holdout ${holdout.evaluated}`);
  assert.equal(holdout.skipped_by_split, dev.evaluated);
  assert.ok(dev.questions.every((item) => item.split === 'dev'));

  const devIds = new Set(dev.questions.map((item) => item.question_id));
  const again = await evalQuestions(root, { k: 5, split: 'dev' });
  assert.deepEqual(new Set(again.questions.map((item) => item.question_id)), devIds);
  const all = await evalQuestions(root, { k: 5 });
  assert.equal(all.evaluated, 24);
  assert.equal(all.questions.filter((item) => item.split === 'holdout').length, holdout.evaluated);
}));

test('ranks unretrieved required notes as repair targets with their vocabulary gap', async () => fixture(async (root) => {
  seed(root);
  write(join(root, '_knowledge', 'questions.jsonl'), jsonl([
    { id: 'refund-window', question: '환불 가능 기간', required_note_ids: ['refunds'] },
    { id: 'refund-owner', question: '환불 담당자', required_note_ids: ['refunds'] },
    { id: 'retry-owner', question: '결제 승인 재시도 담당 팀', required_note_ids: ['shipping'] },
  ]));
  await buildIndex(root, { provider: 'hash', dimensions: 128 });

  const scored = await evalQuestions(root, { k: 1 });
  const [first, second] = scored.repair_targets;
  assert.equal(first.note_id, 'refunds');
  assert.equal(first.in_catalog, false);
  assert.equal(first.gap, 'missing-note');
  assert.deepEqual(first.blocked_questions, ['refund-window', 'refund-owner']);
  assert.equal(second.note_id, 'shipping');
  assert.equal(second.in_catalog, true);
  assert.equal(second.gap, 'no-lookup-vocabulary');
}));

test('calls a run regressed when any question loses ground against a baseline', async () => fixture(async (root) => {
  seed(root);
  write(join(root, '_knowledge', 'questions.jsonl'), jsonl([
    { id: 'payment-retry-policy', question: '결제 승인 재시도', required_note_ids: ['payments'] },
    { id: 'courier-status', question: '택배 추적 상태', required_note_ids: ['shipping'] },
  ]));
  await buildIndex(root, { provider: 'hash', dimensions: 128 });
  const baselinePath = join(root, 'baseline.json');

  writeFileSync(baselinePath, JSON.stringify({
    questions: [
      { question_id: 'payment-retry-policy', hit: false, first_rank: null },
      { question_id: 'courier-status', hit: true, first_rank: 1 },
      { question_id: 'retired-question', hit: true, first_rank: 2 },
    ],
  }));
  const improved = await evalQuestions(root, { k: 5, baseline: baselinePath });
  assert.equal(improved.baseline.verdict, 'improved');
  assert.equal(improved.baseline.compared, 2);
  assert.equal(improved.baseline.regressions.length, 0);
  assert.deepEqual(improved.baseline.improvements.map((item) => item.question_id), ['payment-retry-policy']);

  writeFileSync(baselinePath, JSON.stringify({
    questions: [
      { question_id: 'payment-retry-policy', hit: true, first_rank: 1 },
      { question_id: 'courier-status', hit: true, first_rank: 1 },
      { question_id: 'refund-window', hit: true, first_rank: 1 },
    ],
  }));
  const regressed = await evalQuestions(root, { k: 5, baseline: baselinePath, domain: 'billing' });
  assert.equal(regressed.baseline.verdict, 'regressed');
  assert.ok(regressed.baseline.regressions.some((item) => item.question_id === 'courier-status'));
  assert.equal(regressed.baseline.unmatched, 0);
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

test('keeps the best lexical match ahead of a semantically closer rival', async () => fixture(async (root) => {
  // Each target is long and generic, so its hash vector is diluted and it sits
  // near the bottom of the semantic ranking; every filler is short and
  // dominated by one term, so fillers hold the semantic top. The note that won
  // on lexical evidence must still come first — one rank of lexical advantage
  // has to outweigh any semantic contribution the hash provider can make, and
  // the gap only bites once the corpus is large enough to push the target far
  // down the semantic list.
  const terms = ['대표송장', '부피중량', '결함 색인', '반품 회수', '출고 검수'];
  const body = Array.from({ length: 30 }, (unused, line) => `운영 절차 상세 설명 문단 ${line}. 담당자는 정해진 순서를 따른다.`).join('\n\n');
  const notes = [];
  terms.forEach((term, index) => {
    write(join(root, 'notes', `target-${index}.md`), `# ${term} 처리\n\n${body}\n`);
    notes.push({
      id: `target-${index}`,
      path: `notes/target-${index}.md`,
      title: `${term} 처리`,
      aliases: [term],
    });
  });
  for (let index = 0; index < 60; index += 1) {
    const term = terms[index % terms.length];
    write(join(root, 'notes', `log-${index}.md`), `# 작업 로그 ${index}\n\n${term} 관련해서 ${term} 확인 요청 있었음.\n`);
    notes.push({ id: `log-${index}`, path: `notes/log-${index}.md`, title: `작업 로그 ${index}` });
  }
  write(join(root, '_knowledge', 'catalog.jsonl'), jsonl(notes));
  await buildIndex(root, { provider: 'hash', dimensions: 128 });

  const found = await searchIndex(root, '대표송장', { limit: 3 });
  assert.ok(found.results[0].semantic_score < found.results[1].semantic_score, 'fixture must pit a weak-vector target against a strong-vector rival');
  assert.equal(found.results[0].id, 'target-0', `unexpected order: ${found.results.map((item) => item.id).join(', ')}`);
}));

function seedStockTables(root, { withRelation = true } = {}) {
  write(join(root, 'notes', 'stock-ledger.md'), `# 재고 수불부\n\n${[
    '재고 수불부는 기간별 입고와 출고 수량을 품목 단위로 누적해 보여준다.',
    '출고 모수는 확정된 출고 지시 기준으로 집계한다.',
    '조회 조건은 창고, 품목, 기간을 조합해 지정한다.',
  ].join('\n')}\n`);
  write(join(root, 'notes', 'stock-change.md'), `# 재고 변동표\n\n${[
    '재고 변동표는 변동 사유를 버킷으로 분해해 증감을 보여준다.',
    '버킷은 입고, 출고, 조정, 폐기로 구분한다.',
    '집계 단위는 일자이며 창고별로 나눈다.',
  ].join('\n')}\n`);
  const notes = [
    {
      id: 'stock-ledger',
      path: 'notes/stock-ledger.md',
      title: '재고 수불부',
      summary: '기간별 입출고 누적',
      source_symbols: ['getStockGoodsListVer2'],
    },
    {
      id: 'stock-change',
      path: 'notes/stock-change.md',
      title: '재고 변동표',
      summary: '사유 버킷 분해',
      source_symbols: ['getStockChangeGridVer2'],
    },
  ];
  if (withRelation) {
    write(join(root, 'notes', 'stock-contrast.md'), `# 재고 보고서 대조\n\n${[
      '두 보고서는 같은 원장에서 나오지만 집계 축이 다르다.',
      '한쪽은 누적 잔고를, 다른 쪽은 사유별 증감을 답한다.',
      '따라서 합계가 어긋나 보여도 오류가 아니다.',
    ].join('\n')}\n`);
    notes.push({
      id: 'stock-contrast',
      path: 'notes/stock-contrast.md',
      title: '재고 보고서 대조',
      type: 'relation',
      relation_type: 'contrast',
      participants: ['stock-ledger', 'stock-change'],
      summary: '집계 축 차이',
    });
  }
  write(join(root, '_knowledge', 'catalog.jsonl'), jsonl(notes));
}

test('promotes a relation note above its participants when the query names two of them', async () => fixture(async (root) => {
  seedStockTables(root);
  const built = await buildIndex(root, { provider: 'hash', dimensions: 128 });
  assert.equal(built.relations, 1);

  const found = await searchIndex(root, '재고 수불부와 재고 변동표 차이', { limit: 5 });
  const order = found.results.map((item) => item.id);
  assert.equal(found.results[0].id, 'stock-contrast', `unexpected order: ${order.join(', ')}`);
  assert.ok(order.indexOf('stock-contrast') < order.indexOf('stock-ledger'));
  assert.ok(order.indexOf('stock-contrast') < order.indexOf('stock-change'));
  assert.equal(found.relation_promotions, 1);
  assert.deepEqual(found.relation_promoted_ids, ['stock-contrast']);
  assert.equal(found.results[0].relation_promoted, 2);
}));

test('leaves a relation note unpromoted when the query reaches only one participant', async () => fixture(async (root) => {
  seedStockTables(root);
  await buildIndex(root, { provider: 'hash', dimensions: 128 });

  const found = await searchIndex(root, '수불부 누적 잔고', { limit: 5 });
  const order = found.results.map((item) => item.id);
  assert.equal(found.relation_promotions, 0);
  assert.deepEqual(found.relation_promoted_ids, []);
  assert.equal(found.results[0].id, 'stock-ledger', `unexpected order: ${order.join(', ')}`);
  const promoted = order.indexOf('stock-contrast');
  assert.ok(promoted === -1 || promoted > order.indexOf('stock-ledger'), `unexpected order: ${order.join(', ')}`);
}));

test('leaves ordering untouched in a vault that declares no relation notes', async () => fixture(async (root) => {
  seedStockTables(root, { withRelation: false });
  const built = await buildIndex(root, { provider: 'hash', dimensions: 128 });
  assert.equal(built.relations, 0);

  // The unpromoted baseline ordering: with no relation rows to join, the two
  // participants must come back in exactly the order lexical fusion alone gives.
  const found = await searchIndex(root, '재고 수불부와 재고 변동표 차이', { limit: 5 });
  assert.deepEqual(found.results.map((item) => item.id), ['stock-change', 'stock-ledger']);
  assert.equal(found.relation_promotions, 0);
  assert.deepEqual(found.relation_promoted_ids, []);
  assert.deepEqual(found.results.map((item) => item.relation_promoted), [0, 0]);
}));

// The participants are named only in code vocabulary, so a question phrased in
// the language of the contrast reaches the relation note and nothing else.
function seedContrastOnly(root) {
  const notes = [];
  for (const [id, symbol] of [['stock-ledger', 'getStockGoodsListVer2'], ['stock-change', 'getStockChangeGridVer2']]) {
    write(join(root, 'notes', `${id}.md`), `# ${symbol}\n\n${symbol}는 창고별 집계를 반환한다.\n`);
    notes.push({ id, path: `notes/${id}.md`, title: symbol, summary: '창고별 집계', source_symbols: [symbol] });
  }
  write(join(root, 'notes', 'stock-contrast.md'), '# 재고 보고서 대조\n\n두 보고서는 집계 축이 다르다.\n');
  notes.push({
    id: 'stock-contrast',
    path: 'notes/stock-contrast.md',
    title: '재고 보고서 대조',
    type: 'relation',
    relation_type: 'contrast',
    participants: ['stock-ledger', 'stock-change'],
    summary: '집계 축 차이',
  });
  for (let index = 0; index < 12; index += 1) {
    const id = `filler-${index}`;
    write(join(root, 'notes', `${id}.md`), `# 주문 정산 ${index}\n\n주문 정산 화면 ${index} 처리 절차.\n`);
    notes.push({ id, path: `notes/${id}.md`, title: `주문 정산 ${index}`, summary: '정산 화면' });
  }
  write(join(root, '_knowledge', 'catalog.jsonl'), jsonl(notes));
}

test('pulls the declared participants in when only the relation note matches', async () => fixture(async (root) => {
  seedContrastOnly(root);
  await buildIndex(root, { provider: 'hash', dimensions: 128 });
  write(join(root, '_knowledge', 'questions.jsonl'), jsonl([{
    id: 'stock-table-differences',
    question: '재고 보고서 대조',
    kind: 'comparison',
    required_note_ids: ['stock-contrast', 'stock-ledger', 'stock-change'],
  }]));

  const found = await searchIndex(root, '재고 보고서 대조', { limit: 5 });
  const order = found.results.map((item) => item.id);
  assert.equal(order[0], 'stock-contrast', `unexpected order: ${order.join(', ')}`);
  assert.equal(found.relation_participant_promotions, 2);
  assert.deepEqual(
    [...found.relation_participant_promoted_ids].sort(),
    ['stock-change', 'stock-ledger'],
  );
  // Inherited, not matched: the participants carry no lexical hit of their own
  // and must still stay below the relation note that vouched for them.
  for (const id of ['stock-ledger', 'stock-change']) {
    const item = found.results.find((result) => result.id === id);
    assert.equal(item.lexical_match, false);
    assert.equal(item.relation_promotion, 'relation-matched');
    assert.ok(item.score < found.results[0].score);
    assert.ok(order.indexOf(id) > order.indexOf('stock-contrast'));
  }

  // The comparison question needs every side, so this is the whole point:
  // without the reverse promotion only one of three required notes is retrieved.
  const scored = await evalQuestions(root, { k: 5 });
  assert.equal(scored.questions[0].hit, true);
  assert.equal(scored.recall_at_k, 1);
}));

test('promotes a participant that matched only weakly, below a wall of distractors', async () => fixture(async (root) => {
  // The case a "did it match at all" guard gets wrong: the sides do match, and
  // are still unreachable. Every distractor answers more of the query's words
  // than the vendor notes do, so lexical rank alone buries them.
  const notes = [];
  write(join(root, 'notes', 'box-size-contrast.md'), '# 택배사별 박스 사이즈 코드가 다른 이유\n\n계약 시점의 운임표를 그대로 쓰기 때문이다.\n');
  notes.push({
    id: 'box-size-contrast',
    path: 'notes/box-size-contrast.md',
    title: '택배사별 박스 사이즈 코드가 다른 이유',
    type: 'relation',
    relation_type: 'contrasts',
    participants: ['hanjin', 'cj'],
    summary: '계약 부록 차이',
  });
  for (const [id, name] of [['hanjin', '한진'], ['cj', '씨제이']]) {
    write(join(root, 'notes', `${id}.md`), `# ${name} 벤더\n\n송장 채번과 정산 주기. 박스 사이즈 코드는 계약 부록에 있다.\n`);
    notes.push({ id, path: `notes/${id}.md`, title: `${name} 벤더`, summary: '벤더 연동 규격' });
  }
  for (let index = 0; index < 12; index += 1) {
    const id = `distractor-${index}`;
    write(join(root, 'notes', `${id}.md`), `# 택배사 코드 매핑 ${index}\n\n택배사 코드 체계와 사이즈 구분, 택배사별 차이 ${index}.\n`);
    notes.push({ id, path: `notes/${id}.md`, title: `택배사 코드 매핑 ${index}`, summary: '코드 매핑' });
  }
  write(join(root, '_knowledge', 'catalog.jsonl'), jsonl(notes));
  write(join(root, '_knowledge', 'questions.jsonl'), jsonl([{
    id: 'box-size-code',
    question: '택배사별 박스 사이즈 코드가 왜 다른가',
    kind: 'comparison',
    required_note_ids: ['box-size-contrast', 'hanjin', 'cj'],
  }]));
  await buildIndex(root, { provider: 'hash', dimensions: 128 });

  const found = await searchIndex(root, '택배사별 박스 사이즈 코드가 왜 다른가', { limit: 5 });
  const order = found.results.map((item) => item.id);
  assert.equal(order[0], 'box-size-contrast', `unexpected order: ${order.join(', ')}`);
  for (const id of ['hanjin', 'cj']) {
    assert.ok(order.includes(id), `${id} missing: ${order.join(', ')}`);
  }
  // Only the side that would not have come back is promoted, and it enters at
  // the tail of the window — retrievable, not ranked second.
  const promoted = found.results.filter((item) => item.relation_promotion === 'relation-matched');
  assert.equal(found.relation_participant_promotions, 1);
  assert.equal(promoted.length, 1);
  assert.equal(promoted[0].lexical_match, true, 'the promoted side did match, just too weakly');
  assert.equal(order.at(-1), promoted[0].id, `unexpected order: ${order.join(', ')}`);

  const scored = await evalQuestions(root, { k: 5 });
  assert.equal(scored.questions[0].hit, true);
}));

// A contrast note that the query reaches only weakly on its own words, but that
// forward promotion lifts to the top through its participants.
function seedForwardPromotedContrast(root) {
  const notes = [];
  const filler = '계약 시점 운임표를 승계하고 정산 조건과 반품 규정, 집화 스케줄, 부피 계수를 다르게 적용한다. '.repeat(6);
  write(join(root, 'notes', 'box-size-contrast.md'), `# 계약 부록 승계 문제\n\n택배사별 박스 사이즈 코드가 왜 다른가에 대한 답이다. ${filler}\n`);
  notes.push({
    id: 'box-size-contrast',
    path: 'notes/box-size-contrast.md',
    title: '계약 부록 승계 문제',
    type: 'relation',
    relation_type: 'contrasts',
    participants: ['hanjin', 'cj', 'lotte'],
    summary: '계약 부록 차이',
  });
  for (const [id, name] of [['hanjin', '한진'], ['cj', '씨제이'], ['lotte', '롯데']]) {
    write(join(root, 'notes', `${id}.md`), `# ${name} 벤더 연동\n\n${name} 벤더 연동 규격. 박스 사이즈 코드는 계약 부록에 있다. ${'송장 채번과 집화, 반품 회수, 정산 주기, 에러 매핑, 주소 정제. '.repeat(5)}\n`);
    notes.push({ id, path: `notes/${id}.md`, title: `${name} 벤더 연동`, summary: '벤더 연동 규격' });
  }
  for (let index = 0; index < 30; index += 1) {
    const id = `distractor-${index}`;
    write(join(root, 'notes', `${id}.md`), `# 택배사 박스 사이즈 코드 매핑 ${index}\n\n택배사별 박스 사이즈 코드가 다른 규칙 ${index}.\n`);
    notes.push({ id, path: `notes/${id}.md`, title: `택배사 박스 사이즈 코드 매핑 ${index}`, summary: '코드 매핑' });
  }
  write(join(root, '_knowledge', 'catalog.jsonl'), jsonl(notes));
  write(join(root, '_knowledge', 'questions.jsonl'), jsonl([{
    id: 'box-size-code',
    question: '택배사별 박스 사이즈 코드가 왜 다른가',
    kind: 'comparison',
    required_note_ids: ['box-size-contrast', 'hanjin', 'cj', 'lotte'],
  }]));
}

test('nominates participants off the fused order, not the lexical one', async () => fixture(async (root) => {
  // The relation note is buried in the lexical list — thirty distractors answer
  // more of the query's words — and reaches the top only because its own
  // participants promoted it. Judging it by lexical rank would disqualify it
  // from vouching for those same participants.
  seedForwardPromotedContrast(root);
  await buildIndex(root, { provider: 'hash', dimensions: 128 });

  const found = await searchIndex(root, '택배사별 박스 사이즈 코드가 왜 다른가', { limit: 10 });
  const order = found.results.map((item) => item.id);
  assert.equal(order[0], 'box-size-contrast', `unexpected order: ${order.join(', ')}`);
  assert.equal(found.results[0].relation_promotion, 'participants-matched');
  assert.equal(found.relation_participant_promotions, 3);
  for (const id of ['hanjin', 'cj', 'lotte']) {
    assert.ok(order.includes(id), `${id} missing: ${order.join(', ')}`);
    assert.ok(found.results.find((item) => item.id === id).score < found.results[0].score);
  }

  const scored = await evalQuestions(root, { k: 10 });
  assert.equal(scored.recall_at_k, 1);
  assert.equal(scored.questions[0].hit, true);
}));

test('caps promotion at half the window and leaves retrievable sides alone', async () => fixture(async (root) => {
  seedForwardPromotedContrast(root);
  await buildIndex(root, { provider: 'hash', dimensions: 128 });

  // Three declared sides, a window of four: promotion may claim two slots.
  const capped = await searchIndex(root, '택배사별 박스 사이즈 코드가 왜 다른가', { limit: 4 });
  const promoted = capped.results.filter((item) => item.relation_promotion === 'relation-matched');
  assert.equal(promoted.length, 2);
  assert.equal(capped.results[0].id, 'box-size-contrast');
  assert.deepEqual(
    capped.results.slice(0, 2).map((item) => item.relation_promotion),
    ['participants-matched', null],
    'promotion must not take the top slots',
  );

  // A side that ranks on its own evidence is not moved to the tail.
  const found = await searchIndex(root, '한진 벤더 연동 규격', { limit: 5 });
  const hanjin = found.results.find((item) => item.id === 'hanjin');
  assert.equal(found.results[0].id, 'hanjin', `unexpected order: ${found.results.map((item) => item.id).join(', ')}`);
  assert.equal(hanjin.relation_promotion, null);
}));

test('does not re-promote participants the query already matched', async () => fixture(async (root) => {
  seedStockTables(root);
  await buildIndex(root, { provider: 'hash', dimensions: 128 });

  const found = await searchIndex(root, '재고 수불부와 재고 변동표 차이', { limit: 5 });
  assert.equal(found.relation_promotions, 1);
  assert.equal(found.relation_participant_promotions, 0);
  assert.deepEqual(found.relation_participant_promoted_ids, []);
  assert.deepEqual(
    found.results.map((item) => item.relation_promotion),
    ['participants-matched', null, null],
  );
}));

test('keeps one result per note so chunks do not crowd out sibling notes', async () => fixture(async (root) => {
  // A multi-note question needs its siblings in the top k; without grouping,
  // one heavily chunked note fills the slots with copies of itself.
  const notes = [];
  const chunks = [];
  ['ledger', 'status', 'change'].forEach((name) => {
    write(join(root, 'notes', `stock-${name}.md`), `# 재고 ${name} 표\n\n재고 집계 기준 설명.\n`);
    notes.push({ id: `stock-${name}`, path: `notes/stock-${name}.md`, title: `재고 ${name} 표`, user_terms: ['재고 집계'] });
  });
  for (let index = 0; index < 12; index += 1) {
    chunks.push({ id: `ledger-c${index}`, note_id: 'stock-ledger', text: `재고 집계 기준 세부 ${index}. 재고 집계 재고 집계.`, source_ref: `notes/stock-ledger.md#${index}` });
  }
  write(join(root, '_knowledge', 'catalog.jsonl'), jsonl(notes));
  write(join(root, '_rag', 'chunks.jsonl'), jsonl(chunks));
  await buildIndex(root, { provider: 'hash', dimensions: 128 });

  const grouped = await searchIndex(root, '재고 집계', { limit: 5 });
  assert.equal(grouped.group, 'note');
  assert.equal(grouped.distinct_notes, 3);
  const noteIds = new Set(grouped.results.map((item) => item.note_id));
  assert.ok(['stock-ledger', 'stock-status', 'stock-change'].every((id) => noteIds.has(id)), `missing siblings: ${[...noteIds].join(', ')}`);

  const raw = await searchIndex(root, '재고 집계', { limit: 5, group: 'none' });
  assert.ok(raw.distinct_notes < raw.results.length, 'ungrouped results should repeat a note across chunks');
}));

test('filters search and list by domain, doc_type, section, and path prefix', async () => fixture(async (root) => {
  write(join(root, 'notes', 'a.md'), '# 상품 정책 A\n\n상품 등록 규칙.\n');
  write(join(root, 'notes', 'b.md'), '# 상품 사건 B\n\n상품 장애 기록.\n');
  write(join(root, '_knowledge', 'catalog.jsonl'), jsonl([
    { id: 'a', path: 'notes/a.md', title: '상품 정책 A', domain: 'goods', doc_type: '정책' },
    { id: 'b', path: 'notes/b.md', title: '상품 사건 B', domain: 'goods', doc_type: '사건' },
  ]));
  write(join(root, '_rag', 'chunks.jsonl'), jsonl([
    { id: 'a-claim', note_id: 'a', text: '상품 코드가 아니라 표시명을 키로 쓴다.', source_ref: 'notes/a.md#claim', metadata: { section: '주장', doc_type: '정책', domain: 'goods' } },
  ]));
  await buildIndex(root, { provider: 'hash', dimensions: 64 });

  const policy = await searchIndex(root, '상품', { docType: '정책', group: 'none' });
  assert.deepEqual(policy.results.map((item) => item.id).sort(), ['a', 'a-claim']);
  const claim = await searchIndex(root, '상품', { section: '주장' });
  assert.deepEqual(claim.results.map((item) => item.id), ['a-claim']);

  const listed = listDocuments(root, { domain: 'goods', kind: 'note' });
  assert.deepEqual(listed.results.map((item) => item.id), ['a', 'b']);
  assert.equal(listed.results[0].doc_type, '정책');
  assert.throws(() => listDocuments(root, {}), /at least one filter/);

  const status = indexStatus(root);
  assert.ok(status.filters.metadata_keys_seen.includes('doc_type'));
}));
