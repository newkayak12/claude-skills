// Delta job queues under <store>/_knowledge/jobs. The PostToolUse hook and the
// MCP capture tool both write through this one function; each caller decides
// which queues a change needs.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const QUEUE_FILES = {
  catalog: 'catalog-delta-queue.jsonl',
  answerability: 'answerability-check-queue.jsonl',
  embed: 'embed-queue.jsonl',
  graph: 'graph-update-queue.jsonl',
  ontology: 'ontology-review-queue.jsonl',
};

export function appendJsonl(path, record) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`);
}

// base: { file, note_id, reason, queued_at }; flags: { catalog, answerability, embed, graph, ontology }.
// Returns the queue names written, in QUEUE_FILES order.
export function writeDeltaJobs(root, base, flags = {}) {
  const jobsDir = join(root, '_knowledge', 'jobs');
  const job = {
    file: base.file,
    reason: base.reason,
    queued_at: base.queued_at || new Date().toISOString(),
  };
  const written = [];
  if (flags.catalog) {
    appendJsonl(join(jobsDir, QUEUE_FILES.catalog), {
      ...job,
      note_id: base.note_id ?? null,
      operation: 'upsert-note',
      scope: 'single-note',
      beta: true,
    });
    written.push('catalog');
  }
  if (flags.answerability) {
    appendJsonl(join(jobsDir, QUEUE_FILES.answerability), {
      ...job,
      note_id: base.note_id ?? null,
      operation: 'recheck-affected-questions',
      scope: 'note-dependents',
    });
    written.push('answerability');
  }
  for (const kind of ['embed', 'graph', 'ontology']) {
    if (!flags[kind]) continue;
    appendJsonl(join(jobsDir, QUEUE_FILES[kind]), job);
    written.push(kind);
  }
  return written;
}
