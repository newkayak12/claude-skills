import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { parseArgs, validateKnowledge } from './validate-knowledge.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'validate-knowledge-'));
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

function jsonl(records) {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

function contentHash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function seed(root) {
  write(join(root, 'notes', 'stock-ledger.md'), '# Stock ledger\n');
  write(join(root, 'notes', 'stock-status.md'), '# Stock status\n');
  write(join(root, 'notes', 'stock-contrast.md'), '# Stock contrast\n');
  write(join(root, '_knowledge', 'catalog.jsonl'), jsonl([
    { id: 'stock-ledger', path: 'notes/stock-ledger.md', title: '재고 수불부' },
    { id: 'stock-status', path: 'notes/stock-status.md', title: '재고 현황표' },
    {
      id: 'stock-contrast',
      path: 'notes/stock-contrast.md',
      title: '재고 표 대조',
      type: 'relation',
      relation_type: 'contrast',
      participants: ['stock-ledger', 'stock-status'],
      evidence_by_participant: {
        'stock-ledger': ['mapper.xml#getStockGoodsListVer2'],
        'stock-status': ['mapper.xml#selectStockStatusDataTables'],
      },
      lookup_layers: ['operator', 'code'],
      user_terms: ['재고 수불부', '재고 현황표'],
      source_symbols: ['getStockGoodsListVer2', 'selectStockStatusDataTables'],
    },
  ]));
  write(join(root, '_knowledge', 'questions.jsonl'), jsonl([
    {
      id: 'stock-difference',
      question: '재고 수불부와 현황표 차이는?',
      lookup_job: 'compare stock reports',
      kind: 'comparison',
      required_note_ids: ['stock-contrast'],
      required_user_terms: ['재고 수불부', '재고 현황표'],
      required_source_symbols: ['getStockGoodsListVer2', 'selectStockStatusDataTables'],
    },
  ]));
  write(join(root, '_knowledge', 'question-results.jsonl'), jsonl([
    {
      question_id: 'stock-difference',
      coverage: 'complete',
      answer_note_ids: ['stock-contrast'],
      evidence_refs: [
        'mapper.xml#getStockGoodsListVer2',
        'mapper.xml#selectStockStatusDataTables',
      ],
      answer_note_hashes: {
        'stock-contrast': contentHash(join(root, 'notes', 'stock-contrast.md')),
      },
      missing: [],
      evaluated_at: '2026-08-28T00:00:00Z',
    },
  ]));
  write(
    join(root, '_knowledge', 'coverage.md'),
    '# Coverage\n\nAnswerability: 1/1 complete; 0 partial; 0 unanswerable; 100%\n',
  );
}

test('parses bounded validator options', () => {
  assert.deepEqual(parseArgs(['--root', 'vault', '--require-answerability', '--json']), {
    root: 'vault',
    requireAnswerability: true,
    json: true,
  });
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/);
});

test('passes a complete comparison with two-sided evidence and vocabulary bridges', () => {
  fixture((root) => {
    seed(root);
    const result = validateKnowledge(root, { requireAnswerability: true });
    assert.equal(result.ok, true, result.errors.join('\n'));
    assert.deepEqual(result.counts.questions, {
      total: 1,
      complete: 1,
      partial: 0,
      unanswerable: 0,
    });
  });
});

test('fails partial questions and missing participant evidence', () => {
  fixture((root) => {
    seed(root);
    const catalogPath = join(root, '_knowledge', 'catalog.jsonl');
    const catalog = readRecords(catalogPath);
    delete catalog[2].evidence_by_participant['stock-status'];
    write(catalogPath, jsonl(catalog));
    write(join(root, '_knowledge', 'question-results.jsonl'), jsonl([
      {
        question_id: 'stock-difference',
        coverage: 'partial',
        answer_note_ids: ['stock-contrast'],
        evidence_refs: ['mapper.xml#getStockGoodsListVer2'],
        missing: ['stock status evidence'],
      },
    ]));
    const result = validateKnowledge(root, { requireAnswerability: true });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /lacks evidence for stock-status/);
    assert.match(result.errors.join('\n'), /is partial/);
  });
});

test('fails incomplete cross-layer bridges and unsupported human confirmation', () => {
  fixture((root) => {
    seed(root);
    const catalogPath = join(root, '_knowledge', 'catalog.jsonl');
    const catalog = readRecords(catalogPath);
    delete catalog[2].source_symbols;
    catalog[0].review_status = 'human-confirmed';
    write(catalogPath, jsonl(catalog));
    const result = validateKnowledge(root, { requireAnswerability: true });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /needs source_symbols/);
    assert.match(result.errors.join('\n'), /needs reviewed_by/);
    assert.match(result.errors.join('\n'), /do not cover required_source_symbols/);
  });
});

test('rejects vocabulary values duplicated across semantic fields', () => {
  fixture((root) => {
    seed(root);
    const catalogPath = join(root, '_knowledge', 'catalog.jsonl');
    const catalog = readRecords(catalogPath);
    catalog[2].aliases = ['getStockGoodsListVer2'];
    catalog[2].user_terms = ['getStockGoodsListVer2'];
    catalog[2].source_symbols = ['getStockGoodsListVer2'];
    write(catalogPath, jsonl(catalog));
    const result = validateKnowledge(root, { requireAnswerability: true });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /repeats "getStockGoodsListVer2" across aliases and user_terms/);
    assert.match(result.errors.join('\n'), /repeats "getStockGoodsListVer2" across aliases and source_symbols/);
  });
});

test('requires pending human review notes to be tracked in the review artifact', () => {
  fixture((root) => {
    seed(root);
    const catalogPath = join(root, '_knowledge', 'catalog.jsonl');
    const catalog = readRecords(catalogPath);
    catalog[0].review_status = 'needs-human-review';
    write(catalogPath, jsonl(catalog));
    const missing = validateKnowledge(root, { requireAnswerability: true });
    assert.equal(missing.ok, false);
    assert.match(missing.errors.join('\n'), /needs-human-review\.md: required/);

    write(
      join(root, '_knowledge', 'needs-human-review.md'),
      '# Needs Human Review\n\n- `stock-ledger`: confirm intended inventory semantics\n',
    );
    const tracked = validateKnowledge(root, { requireAnswerability: true });
    assert.equal(tracked.ok, true, tracked.errors.join('\n'));
  });
});

test('fails a stale complete result after an answer note changes', () => {
  fixture((root) => {
    seed(root);
    write(join(root, 'notes', 'stock-contrast.md'), '# Changed stock contrast\n');
    const result = validateKnowledge(root, { requireAnswerability: true });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /stale or missing hash for stock-contrast/);
  });
});

test('requires hashes for every answer note, not only required notes', () => {
  fixture((root) => {
    seed(root);
    const resultPath = join(root, '_knowledge', 'question-results.jsonl');
    const results = readRecords(resultPath);
    results[0].answer_note_ids.push('stock-ledger');
    write(resultPath, jsonl(results));
    const result = validateKnowledge(root, { requireAnswerability: true });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /stale or missing hash for stock-ledger/);
  });
});

test('fails graph-check questions when graph artifacts are absent', () => {
  fixture((root) => {
    seed(root);
    const questionPath = join(root, '_knowledge', 'questions.jsonl');
    const questions = readRecords(questionPath);
    questions[0].graph_check = true;
    questions[0].required_graph_node_ids = ['stock-ledger', 'stock-status'];
    write(questionPath, jsonl(questions));
    const result = validateKnowledge(root, { requireAnswerability: true });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /graph_check questions exist but graph artifacts are missing/);
  });
});

test('gates graph questions on typed evidenced paths', () => {
  fixture((root) => {
    seed(root);
    const questionPath = join(root, '_knowledge', 'questions.jsonl');
    const questions = readRecords(questionPath);
    questions[0].graph_check = true;
    questions[0].required_graph_node_ids = ['stock-ledger', 'stock-status'];
    write(questionPath, jsonl(questions));
    write(join(root, '_graph', 'nodes.jsonl'), jsonl([
      { id: 'stock-contrast' }, { id: 'stock-ledger' }, { id: 'stock-status' },
    ]));
    write(join(root, '_graph', 'edges.jsonl'), jsonl([
      {
        id: 'contrast-ledger',
        from: 'stock-contrast',
        to: 'stock-ledger',
        type: 'CONTRASTS_WITH',
        source_refs: ['mapper.xml#getStockGoodsListVer2'],
      },
      {
        id: 'contrast-status',
        from: 'stock-contrast',
        to: 'stock-status',
        type: 'related_to',
      },
    ]));
    write(join(root, '_graph', 'question-reachability.jsonl'), jsonl([
      {
        question_id: 'stock-difference',
        reachable: true,
        answer_node_ids: ['stock-ledger', 'stock-status'],
        max_hops: 1,
        paths: [
          { node_ids: ['stock-contrast', 'stock-ledger'], edge_ids: ['contrast-ledger'] },
          { node_ids: ['stock-contrast', 'stock-status'], edge_ids: ['contrast-status'] },
        ],
        evidence_refs: ['mapper.xml#getStockGoodsListVer2'],
      },
    ]));
    const result = validateKnowledge(root, { requireAnswerability: true });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /needs a specific relationship type/);
    assert.match(result.errors.join('\n'), /needs source_refs/);
  });
});

test('passes bounded directed graph paths that cover every required node', () => {
  fixture((root) => {
    seed(root);
    const questionPath = join(root, '_knowledge', 'questions.jsonl');
    const questions = readRecords(questionPath);
    questions[0].graph_check = true;
    questions[0].required_graph_node_ids = ['stock-ledger', 'stock-status'];
    write(questionPath, jsonl(questions));
    write(join(root, '_graph', 'nodes.jsonl'), jsonl([
      { id: 'stock-contrast' }, { id: 'stock-ledger' }, { id: 'stock-status' },
    ]));
    write(join(root, '_graph', 'edges.jsonl'), jsonl([
      {
        id: 'contrast-ledger',
        from: 'stock-contrast',
        to: 'stock-ledger',
        type: 'CONTRASTS_WITH',
        source_refs: ['mapper.xml#getStockGoodsListVer2'],
      },
      {
        id: 'contrast-status',
        from: 'stock-contrast',
        to: 'stock-status',
        type: 'CONTRASTS_WITH',
        source_refs: ['mapper.xml#selectStockStatusDataTables'],
      },
    ]));
    write(join(root, '_graph', 'question-reachability.jsonl'), jsonl([
      {
        question_id: 'stock-difference',
        reachable: true,
        answer_node_ids: ['stock-ledger', 'stock-status'],
        max_hops: 1,
        paths: [
          { node_ids: ['stock-contrast', 'stock-ledger'], edge_ids: ['contrast-ledger'] },
          { node_ids: ['stock-contrast', 'stock-status'], edge_ids: ['contrast-status'] },
        ],
        evidence_refs: [
          'mapper.xml#getStockGoodsListVer2',
          'mapper.xml#selectStockStatusDataTables',
        ],
      },
    ]));
    const result = validateKnowledge(root, { requireAnswerability: true });
    assert.equal(result.ok, true, result.errors.join('\n'));
    assert.equal(result.counts.graph_questions, 1);
  });
});

function readRecords(path) {
  return String(readFileSync(path)).trim().split('\n').map(JSON.parse);
}
