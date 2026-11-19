// Storage backend seam. index / search / get / neighbors / status reach the
// store through the backend a store names; sqlite is the only one wired. A
// pgvector backend (card 162) registers here with the same five methods and
// return shapes, and `migrate` already copies a sqlite store into its tables.
import { readStoreConfig } from './knowledge-paths.mjs';

export const KNOWN_BACKENDS = ['sqlite', 'pgvector'];
const registry = new Map();

export function registerBackend(name, impl) {
  for (const method of ['index', 'search', 'get', 'neighbors', 'status']) {
    if (typeof impl[method] !== 'function') throw new Error(`backend ${name} lacks ${method}()`);
  }
  registry.set(name, impl);
}

// Precedence: an explicit option, then KNOWLEDGE_BACKEND, then the store's
// config `storage.backend`, then sqlite.
export function backendName(root, options = {}, env = process.env) {
  let configured = null;
  try {
    configured = readStoreConfig(root).storage?.backend ?? null;
  } catch {
    configured = null;
  }
  const name = options.backend || env.KNOWLEDGE_BACKEND || configured || 'sqlite';
  if (!KNOWN_BACKENDS.includes(name)) throw new Error(`unknown backend ${name} (${KNOWN_BACKENDS.join(', ')})`);
  return name;
}

export function backendFor(root, options = {}, env = process.env) {
  const name = backendName(root, options, env);
  const impl = registry.get(name);
  if (!impl) {
    throw new Error(`backend ${name} is not wired in this build; keep storage.backend sqlite (migrate copies the store to pgvector ahead of the switch)`);
  }
  return impl;
}

// pgvector is advised once either limit is passed. Bench (2026-11-19, README):
// synthetic notes, hash provider (384 dims), 12-core CPU, 13 GB RAM; search is a
// full scan, so p95 grows linearly, ~19 ms per 1k documents: 1k 25 ms, 5k 97,
// 10k 187, 20k 384, 50k 1108. Budget: p95 under 400 ms -> 20000 documents. The
// byte limit catches larger embeddings (768 dims doubles the rows' size): 20k
// hash documents are 126 MB, so 256 MB.
export const DEFAULT_PGVECTOR_THRESHOLD = { documents: 20000, bytes: 256 * 1024 * 1024 };

export function sizeAdvice(documents, bytes, storeConfig = {}) {
  const configured = storeConfig.storage?.pgvector_threshold || {};
  const threshold = {
    documents: Number.isInteger(configured.documents) ? configured.documents : DEFAULT_PGVECTOR_THRESHOLD.documents,
    bytes: Number.isInteger(configured.bytes) ? configured.bytes : DEFAULT_PGVECTOR_THRESHOLD.bytes,
  };
  const over = [];
  if (documents >= threshold.documents) over.push(`documents ${documents} >= ${threshold.documents}`);
  if (bytes >= threshold.bytes) over.push(`bytes ${bytes} >= ${threshold.bytes}`);
  return {
    documents,
    bytes,
    threshold,
    pgvector_advised: over.length > 0,
    reason: over.length ? `${over.join(', ')}: run migrate, then switch storage.backend when the pgvector backend ships` : 'under both limits',
  };
}
