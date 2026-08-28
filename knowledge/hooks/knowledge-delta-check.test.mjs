import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { analyze, main } from './knowledge-delta-check.mjs';

function withFixture(run) {
  const fixture = mkdtempSync(join(tmpdir(), 'knowledge-delta-check-'));
  try {
    return run(fixture);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

function write(path, content = '') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function noteBody(body = '') {
  return `---
id: payment-authorization
title: Payment Authorization
type: concept
domain: billing
sources:
  - src/billing/PaymentService.ts
---

# Payment Authorization

${body}
`;
}

test('writes a report and queues an existing RAG corpus', () => {
  withFixture((fixture) => {
    const root = join(fixture, 'knowledge-system');
    const note = join(root, 'notes', 'payment-authorization.md');
    write(note, noteBody());
    mkdirSync(join(root, '_rag'), { recursive: true });

    main({ cwd: fixture, tool_input: { file_path: note } });

    const reportPath = join(root, '_knowledge', 'checks', 'latest.json');
    assert.equal(existsSync(reportPath), true, 'hook did not write its report');
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.deepEqual(report.missing_frontmatter, []);
    assert.equal(report.rag_delta_needed, true);
    assert.equal(existsSync(join(root, '_knowledge', 'jobs', 'embed-queue.jsonl')), true);
  });
});

test('queues catalog refresh without requiring RAG artifacts', () => {
  withFixture((fixture) => {
    const root = join(fixture, 'knowledge-system');
    const note = join(root, 'notes', 'billing', 'payment-authorization.md');
    write(note, noteBody());
    write(join(root, '_knowledge', 'catalog.jsonl'), '{}\n');

    main({ cwd: fixture, tool_input: { file_path: note } });

    const report = JSON.parse(
      readFileSync(join(root, '_knowledge', 'checks', 'latest.json'), 'utf8'),
    );
    assert.equal(report.catalog_delta_needed, true);
    assert.equal(report.rag_delta_needed, false);
    assert.equal(
      existsSync(join(root, '_knowledge', 'jobs', 'catalog-delta-queue.jsonl')),
      true,
    );
    const job = JSON.parse(
      readFileSync(join(root, '_knowledge', 'jobs', 'catalog-delta-queue.jsonl'), 'utf8'),
    );
    assert.equal(job.file, 'notes/billing/payment-authorization.md');
    assert.equal(job.note_id, 'payment-authorization');
    assert.equal(job.operation, 'upsert-note');
    assert.equal(job.scope, 'single-note');
    assert.equal(job.beta, true);
    assert.equal(existsSync(join(root, '_knowledge', 'jobs', 'embed-queue.jsonl')), false);
  });
});

test('queues competency recheck when an evaluated answer note changes', () => {
  withFixture((fixture) => {
    const root = join(fixture, 'knowledge-system');
    const note = join(root, 'notes', 'payment-authorization.md');
    write(note, noteBody());
    write(join(root, '_knowledge', 'question-results.jsonl'), '{}\n');

    main({ cwd: fixture, tool_input: { file_path: note } });

    const report = JSON.parse(
      readFileSync(join(root, '_knowledge', 'checks', 'latest.json'), 'utf8'),
    );
    assert.equal(report.answerability_delta_needed, true);
    const job = JSON.parse(
      readFileSync(
        join(root, '_knowledge', 'jobs', 'answerability-check-queue.jsonl'),
        'utf8',
      ),
    );
    assert.equal(job.note_id, 'payment-authorization');
    assert.equal(job.operation, 'recheck-affected-questions');
    assert.equal(job.scope, 'note-dependents');
  });
});

test('resolves wikilinks to notes in nested domain folders', () => {
  withFixture((fixture) => {
    const root = join(fixture, 'knowledge-system');
    const target = join(root, 'notes', 'billing', 'payment-authorization.md');
    const source = join(root, 'notes', 'workflows', 'checkout.md');
    write(target, noteBody());
    write(
      source,
      noteBody('See [[payment-authorization]] and [[billing/payment-authorization]].'),
    );

    const report = analyze(root, source);
    assert.deepEqual(report.broken_links, []);
    assert.equal(report.link_count, 2);
  });
});

test('still reports genuinely missing wikilinks', () => {
  withFixture((fixture) => {
    const root = join(fixture, 'knowledge-system');
    const source = join(root, 'notes', 'checkout.md');
    write(source, noteBody('See [[missing-note]].'));

    assert.deepEqual(analyze(root, source).broken_links, ['missing-note']);
  });
});

test('queues graph and ontology follow-up independently', () => {
  withFixture((fixture) => {
    const root = join(fixture, 'knowledge-system');
    const target = join(root, 'notes', 'payment-authorization.md');
    const source = join(root, 'notes', 'checkout.md');
    write(target, noteBody());
    write(source, noteBody('This concept relates to [[payment-authorization]].'));
    mkdirSync(join(root, '_graph'), { recursive: true });
    mkdirSync(join(root, '_ontology'), { recursive: true });

    main({ cwd: fixture, tool_input: { file_path: source } });

    const jobs = join(root, '_knowledge', 'jobs');
    assert.equal(existsSync(join(jobs, 'graph-update-queue.jsonl')), true);
    assert.equal(existsSync(join(jobs, 'ontology-review-queue.jsonl')), true);
  });
});

test('does not enqueue improvement memory as a catalog note', () => {
  withFixture((fixture) => {
    const root = join(fixture, 'knowledge-system');
    const improvementNotes = join(root, '_knowledge', 'improvement-notes.md');
    write(join(root, '_knowledge', 'catalog.jsonl'), '{}\n');
    write(improvementNotes, noteBody());

    main({ cwd: fixture, tool_input: { file_path: improvementNotes } });

    const report = JSON.parse(
      readFileSync(join(root, '_knowledge', 'checks', 'latest.json'), 'utf8'),
    );
    assert.equal(report.catalog_delta_needed, false);
    assert.equal(
      existsSync(join(root, '_knowledge', 'jobs', 'catalog-delta-queue.jsonl')),
      false,
    );
  });
});

test('fails open for invalid input and ignores files outside cwd', () => {
  withFixture((fixture) => {
    const outside = join(tmpdir(), 'outside-knowledge-note.md');
    assert.doesNotThrow(() => main(null));
    assert.doesNotThrow(() => main({ cwd: fixture, tool_input: { file_path: outside } }));
    assert.equal(existsSync(join(fixture, '_knowledge')), false);
  });
});
