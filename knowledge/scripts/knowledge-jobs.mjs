// Delta job queues under <store>/_knowledge/jobs. The PostToolUse hook and the
// MCP capture tool both write through this one function; each caller decides
// which queues a change needs.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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

function queuePath(root, kind) {
  if (!QUEUE_FILES[kind]) throw new Error(`Unknown queue: ${kind}`);
  return join(root, '_knowledge', 'jobs', QUEUE_FILES[kind]);
}

// The non-empty lines of one queue, as written (strings), oldest first.
export function readQueue(root, kind) {
  const path = queuePath(root, kind);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line.trim());
}

// Remove the given lines (one occurrence each) and nothing else. The file is
// re-read right before the rewrite, so an entry appended after readQueue stays.
export function consumeQueue(root, kind, lines) {
  const path = queuePath(root, kind);
  if (!lines.length || !existsSync(path)) return;
  const pending = new Map();
  for (const line of lines) pending.set(line, (pending.get(line) || 0) + 1);
  const kept = readQueue(root, kind).filter((line) => {
    const count = pending.get(line) || 0;
    if (!count) return true;
    pending.set(line, count - 1);
    return false;
  });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, kept.map((line) => `${line}\n`).join(''));
  renameSync(temp, path);
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
