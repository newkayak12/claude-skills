#!/usr/bin/env node
// Build and query a local SQLite index from portable knowledge artifacts.
//
// Markdown and JSONL remain canonical. The SQLite database is a disposable,
// locally rebuilt retrieval index for FTS, embeddings, and graph traversal.
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let DatabaseSync = null;
let sqliteLoadError = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch (error) {
  sqliteLoadError = error;
}

const RUNTIME_HINT = 'Requires Node 24+, or Node 22.5-23 with --experimental-sqlite and an FTS5-enabled SQLite build. '
  + 'The bundled Docker image (knowledge/compose.yaml) provides a working runtime.';

function openSqlite(path, options = undefined) {
  if (!DatabaseSync) {
    throw new Error(`node:sqlite is unavailable (${sqliteLoadError?.message || 'unknown error'}). ${RUNTIME_HINT}`);
  }
  return options ? new DatabaseSync(path, options) : new DatabaseSync(path);
}

const DEFAULT_DB = '.knowledge/knowledge.sqlite';
const DEFAULT_DIMENSIONS = 384;
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_MODEL = 'embeddinggemma';
const SCHEMA_VERSION = '5';
const RRF_K = 60;
// A relation note is about two or more other notes. One matched participant is
// evidence about that participant, not about the relation, so promotion needs a
// second one before it counts as a signal at all.
const RELATION_PARTICIPANT_FLOOR = 2;
const DEFAULT_HOLDOUT_RATIO = 0.35;
const ARTIFACT_PATHS = {
  catalog: ['_knowledge/catalog.jsonl'],
  chunks: ['_rag/chunks.jsonl', 'rag/chunks.jsonl'],
  nodes: ['_graph/nodes.jsonl', 'graph/nodes.jsonl'],
  edges: ['_graph/edges.jsonl', 'graph/edges.jsonl'],
  questions: ['_knowledge/questions.jsonl'],
};
// Questions are an evaluation set, not indexed content: they must not decide
// where the knowledge root is, nor make a built index look stale when edited.
const INDEXED_ARTIFACT_KINDS = ['catalog', 'chunks', 'nodes', 'edges'];

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift() || 'status';
  const options = {
    root: process.cwd(),
    db: null,
    provider: process.env.KNOWLEDGE_EMBED_PROVIDER || 'hash',
    model: process.env.KNOWLEDGE_EMBED_MODEL || DEFAULT_OLLAMA_MODEL,
    ollamaUrl: process.env.OLLAMA_HOST || DEFAULT_OLLAMA_URL,
    dimensions: DEFAULT_DIMENSIONS,
    limit: 8,
    k: 10,
    kind: null,
    domain: null,
    docType: null,
    section: null,
    pathPrefix: null,
    group: 'note',
    split: 'all',
    holdout: DEFAULT_HOLDOUT_RATIO,
    baseline: null,
    lexicalWeight: null,
    embedChars: null,
    sweep: null,
    rerankerUrl: null,
    rerankerModel: null,
    rerankDepth: DEFAULT_RERANK_DEPTH,
    reuseEmbeddings: true,
  };

  while (args.length) {
    const arg = args.shift();
    const value = () => {
      const next = args.shift();
      if (!next) throw new Error(`${arg} requires a value`);
      return next;
    };
    if (arg === '--root') options.root = value();
    else if (arg === '--db') options.db = value();
    else if (arg === '--provider') options.provider = value();
    else if (arg === '--model') options.model = value();
    else if (arg === '--ollama-url') options.ollamaUrl = value();
    else if (arg === '--dimensions') options.dimensions = Number(value());
    else if (arg === '--limit') options.limit = Number(value());
    else if (arg === '--k') options.k = Number(value());
    else if (arg === '--kind') options.kind = value();
    else if (arg === '--domain') options.domain = value();
    else if (arg === '--doc-type') options.docType = value();
    else if (arg === '--section') options.section = value();
    else if (arg === '--path-prefix') options.pathPrefix = value();
    else if (arg === '--group') options.group = value();
    else if (arg === '--split') options.split = value();
    else if (arg === '--holdout') options.holdout = Number(value());
    else if (arg === '--baseline') options.baseline = value();
    else if (arg === '--lexical-weight') options.lexicalWeight = Number(value());
    else if (arg === '--embed-chars') options.embedChars = Number(value());
    else if (arg === '--no-reuse-embeddings') options.reuseEmbeddings = false;
    else if (arg === '--reranker-url') options.rerankerUrl = value();
    else if (arg === '--reranker-model') options.rerankerModel = value();
    else if (arg === '--rerank-depth') options.rerankDepth = Number(value());
    else if (arg === '--sweep') {
      options.sweep = value().split(',').map((part) => Number(part.trim()));
    }
    else if (!options.query && ['search', 'neighbors', 'get'].includes(command)) options.query = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!['index', 'search', 'neighbors', 'get', 'status', 'serve', 'eval', 'list'].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  if (!['note', 'none'].includes(options.group)) {
    throw new Error('--group must be note or none');
  }
  if (!['hash', 'ollama'].includes(options.provider)) {
    throw new Error(`Unsupported embedding provider: ${options.provider}`);
  }
  if (!Number.isInteger(options.dimensions) || options.dimensions < 32 || options.dimensions > 4096) {
    throw new Error('--dimensions must be an integer from 32 to 4096');
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50) {
    throw new Error('--limit must be an integer from 1 to 50');
  }
  if (!Number.isInteger(options.k) || options.k < 1 || options.k > 50) {
    throw new Error('--k must be an integer from 1 to 50');
  }
  if (!['all', 'dev', 'holdout'].includes(options.split)) {
    throw new Error('--split must be all, dev, or holdout');
  }
  if (!Number.isFinite(options.holdout) || options.holdout < 0.1 || options.holdout > 0.5) {
    throw new Error('--holdout must be a ratio from 0.1 to 0.5');
  }
  if (options.lexicalWeight !== null
    && (!Number.isFinite(options.lexicalWeight) || options.lexicalWeight < 0 || options.lexicalWeight > 1)) {
    throw new Error('--lexical-weight must be a ratio from 0 to 1');
  }
  if (options.embedChars !== null
    && (!Number.isInteger(options.embedChars) || options.embedChars < 128 || options.embedChars > 32768)) {
    throw new Error('--embed-chars must be an integer from 128 to 32768');
  }
  if (!Number.isInteger(options.rerankDepth) || options.rerankDepth < 1 || options.rerankDepth > 200) {
    throw new Error('--rerank-depth must be an integer from 1 to 200');
  }
  if (options.sweep !== null
    && (!options.sweep.length || options.sweep.length > 8
      || options.sweep.some((weight) => !Number.isFinite(weight) || weight < 0 || weight > 1))) {
    throw new Error('--sweep must be 1 to 8 comma-separated ratios from 0 to 1');
  }
  return { command, ...options };
}

function inside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function hasArtifacts(root) {
  return INDEXED_ARTIFACT_KINDS.flatMap((kind) => ARTIFACT_PATHS[kind]).some((path) => existsSync(join(root, path)));
}

function findKnowledgeRoot(inputRoot) {
  const root = resolve(inputRoot);
  if (hasArtifacts(root)) return root;
  for (const candidate of ['knowledge-system', 'knowledge-base', 'knowledge-artifacts']) {
    const nested = join(root, candidate);
    if (hasArtifacts(nested)) return nested;
  }
  return root;
}

function resolveDbPath(root, dbPath = null) {
  const configured = dbPath || process.env.KNOWLEDGE_DB_PATH || DEFAULT_DB;
  return isAbsolute(configured) ? resolve(configured) : resolve(root, configured);
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${path}:${index + 1}: ${error.message}`);
      }
    });
}

function artifactPath(root, kind) {
  const relativePath = ARTIFACT_PATHS[kind].find((path) => existsSync(join(root, path)));
  return join(root, relativePath || ARTIFACT_PATHS[kind][0]);
}

function asStrings(value) {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value])
    .filter((item) => item !== undefined && item !== null)
    .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)));
}

function safeRead(root, path) {
  if (!path) return null;
  const absolute = resolve(root, path);
  if (!inside(root, absolute) || !existsSync(absolute)) return null;
  try {
    return readFileSync(absolute, 'utf8');
  } catch {
    return null;
  }
}

function normalizeDocument(record) {
  return {
    kind: record.kind,
    id: String(record.id),
    noteId: record.noteId ? String(record.noteId) : null,
    path: record.path || null,
    title: record.title || null,
    section: record.section || null,
    text: String(record.text || '').trim(),
    terms: String(record.terms || '').trim(),
    body: String(record.body || '').trim(),
    sourceRef: record.sourceRef || null,
    domain: record.domain || null,
    relation: record.relation || null,
    metadata: record.metadata || {},
  };
}

// A relation note's participants are the stable note IDs it relates. They live
// only inside the catalog record, so lift them out here: query time needs them
// as rows, not as JSON to re-parse. Under two participants there is nothing to
// relate, and the answerability contract requires at least two.
function relationOf(record) {
  if (String(record.type || '').trim() !== 'relation') return null;
  const participants = [...new Set(asStrings(record.participants).map((id) => id.trim()).filter(Boolean))];
  if (participants.length < RELATION_PARTICIPANT_FLOOR) return null;
  return {
    relationType: String(record.relation_type || '').trim() || 'relation',
    participants,
  };
}

function collectKnowledge(root) {
  const documents = [];
  const catalogPath = artifactPath(root, 'catalog');
  const chunksPath = artifactPath(root, 'chunks');
  const nodesPath = artifactPath(root, 'nodes');
  const edgesPath = artifactPath(root, 'edges');
  const catalog = readJsonl(catalogPath);
  const chunks = readJsonl(chunksPath);
  const nodes = readJsonl(nodesPath);
  const edges = readJsonl(edgesPath);

  catalog.forEach((record, index) => {
    const id = String(record.id || '').trim();
    if (!id) throw new Error(`${catalogPath}:${index + 1}: missing id`);
    const notePath = String(record.path || '').trim();
    const body = safeRead(root, notePath);
    const metadataText = [
      record.summary,
      ...asStrings(record.tags),
      ...asStrings(record.aliases),
      ...asStrings(record.user_terms),
      ...asStrings(record.source_symbols),
      ...asStrings(record.entities),
    ].filter(Boolean).join('\n');
    documents.push(normalizeDocument({
      kind: 'note',
      id,
      noteId: id,
      path: notePath,
      title: record.title || id,
      text: [metadataText, body].filter(Boolean).join('\n\n'),
      terms: metadataText,
      body,
      sourceRef: notePath || asStrings(record.source_refs ?? record.sources)[0] || null,
      domain: record.domain,
      relation: relationOf(record),
      metadata: record,
    }));
  });

  chunks.forEach((record, index) => {
    const id = String(record.id || record.chunk_id || '').trim();
    const text = record.text ?? record.content;
    if (!id) throw new Error(`${chunksPath}:${index + 1}: missing id`);
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error(`${chunksPath}:${index + 1}: missing text`);
    }
    const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
    documents.push(normalizeDocument({
      kind: 'chunk',
      id,
      noteId: record.note_id ?? metadata.note_id,
      path: record.path ?? metadata.path,
      title: record.title,
      section: record.section ?? metadata.section,
      text,
      body: text,
      sourceRef: record.source_ref ?? metadata.source_ref,
      domain: record.domain ?? metadata.domain,
      metadata: record,
    }));
  });

  nodes.forEach((record, index) => {
    const name = record.canonical_name ?? record.name ?? record.title;
    const id = String(record.id || record.node_id || name || '').trim();
    if (!id) throw new Error(`${nodesPath}:${index + 1}: missing id or canonical_name`);
    documents.push(normalizeDocument({
      kind: 'node',
      id,
      title: name || id,
      text: [
        name,
        record.description,
        ...asStrings(record.aliases),
        ...asStrings(record.user_terms),
        ...asStrings(record.source_symbols),
      ].filter(Boolean).join('\n'),
      terms: [
        ...asStrings(record.aliases),
        ...asStrings(record.user_terms),
        ...asStrings(record.source_symbols),
      ].filter(Boolean).join('\n'),
      body: record.description,
      sourceRef: asStrings(record.source_refs ?? record.sources)[0] || null,
      domain: record.domain,
      metadata: record,
    }));
  });

  const fingerprint = createHash('sha256');
  for (const kind of INDEXED_ARTIFACT_KINDS) {
    const absolute = artifactPath(root, kind);
    if (existsSync(absolute)) {
      fingerprint.update(relative(root, absolute)).update('\0').update(readFileSync(absolute));
    }
  }
  for (const document of documents.filter((item) => item.kind === 'note')) {
    fingerprint.update(document.path || '').update('\0').update(document.text);
  }

  return {
    documents,
    nodes,
    edges,
    fingerprint: fingerprint.digest('hex'),
    artifacts: Object.fromEntries(
      INDEXED_ARTIFACT_KINDS.map((kind) => [kind, existsSync(artifactPath(root, kind))]),
    ),
  };
}

function tokenize(text) {
  const normalized = String(text || '').normalize('NFKC').toLocaleLowerCase();
  const tokens = [];
  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    for (const segment of segmenter.segment(normalized)) {
      if (segment.isWordLike) tokens.push(segment.segment);
    }
  } catch {
    tokens.push(...normalized.match(/[\p{L}\p{N}_-]+/gu) || []);
  }
  const compact = normalized.replace(/\s+/g, ' ');
  for (let index = 0; index <= compact.length - 3; index += 1) {
    const gram = compact.slice(index, index + 3);
    if (/\s{2}/.test(gram)) continue;
    tokens.push(`~${gram}`);
  }
  return tokens;
}

function hashEmbedding(text, dimensions = DEFAULT_DIMENSIONS) {
  const vector = new Float32Array(dimensions);
  for (const token of tokenize(text)) {
    const digest = createHash('sha256').update(token).digest();
    const first = digest.readUInt32LE(0) % dimensions;
    const second = digest.readUInt32LE(4) % dimensions;
    const weight = token.startsWith('~') ? 0.35 : 1;
    vector[first] += (digest[8] & 1 ? 1 : -1) * weight;
    vector[second] += (digest[9] & 1 ? 1 : -1) * weight * 0.5;
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm) for (let index = 0; index < vector.length; index += 1) vector[index] /= norm;
  return vector;
}

function normalizeVector(values) {
  const vector = Float32Array.from(values);
  let norm = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) throw new Error('Embedding contains a non-finite value');
    norm += value * value;
  }
  norm = Math.sqrt(norm);
  if (norm) for (let index = 0; index < vector.length; index += 1) vector[index] /= norm;
  return vector;
}

// An embedding model silently drops whatever runs past its context window, so a
// long note is indexed by its opening and the rest is invisible to semantic
// search while full-text still matches it — a note that only lexical can find.
// The budget is in characters, not tokens, because the tokenizer is not
// available here; for CJK text one token per character is the conservative
// direction to be wrong in. Only models with a known window get one.
const EMBEDDING_CONTEXT_CHARS = {
  embeddinggemma: 1800,
};

function embeddingContextChars(provider, model, override = null) {
  if (override !== null && Number.isFinite(override)) return override > 0 ? override : null;
  if (provider !== 'ollama') return null;
  const family = String(model || '').split(':')[0].trim().toLowerCase();
  return EMBEDDING_CONTEXT_CHARS[family] ?? null;
}

// Windows overlap so a passage straddling a boundary is whole in one of them.
function textWindows(text, budget) {
  const value = String(text ?? '');
  if (!budget || value.length <= budget) return [value];
  const stride = Math.max(1, Math.floor(budget * 0.85));
  const windows = [];
  for (let start = 0; start < value.length; start += stride) {
    windows.push(value.slice(start, start + budget));
    if (start + budget >= value.length) break;
  }
  return windows;
}

// Mean-pooling the windows keeps one vector per document, so the rest of the
// engine — grouping, fusion, promotion — is untouched by how long a note is.
function poolVectors(vectors) {
  if (vectors.length === 1) return vectors[0];
  const pooled = new Float32Array(vectors[0].length);
  for (const vector of vectors) {
    for (let index = 0; index < pooled.length; index += 1) pooled[index] += vector[index];
  }
  return normalizeVector(pooled);
}

// EmbeddingGemma is trained with an instruction glued to the front of the text,
// and it encodes a question and a stored passage differently: a query carries
// `task: search result | query: …`, a document carries `title: … | text: …`.
// Ollama's /api/embed does not add them — raw text goes in, so without this an
// index embeds every question as if it were a passage, which is the exact case
// the asymmetric training was for. Prompts are model-specific, so an unknown
// model gets none rather than a guess; the id is recorded in the index metadata
// so a query is only ever prefixed the way its documents were.
const EMBEDDING_PROMPTS = {
  embeddinggemma: {
    id: 'embeddinggemma-v1',
    document: (title, text) => `title: ${String(title || '').trim() || 'none'} | text: ${text}`,
    query: (text) => `task: search result | query: ${text}`,
  },
};

function embeddingPrompt(provider, model) {
  if (provider !== 'ollama') return null;
  const family = String(model || '').split(':')[0].trim().toLowerCase();
  return EMBEDDING_PROMPTS[family] ?? null;
}

function promptById(id) {
  if (!id || id === 'none') return null;
  return Object.values(EMBEDDING_PROMPTS).find((prompt) => prompt.id === id) ?? null;
}

async function ollamaEmbeddings(texts, options) {
  const endpoint = new URL('/api/embed', options.ollamaUrl).toString();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: options.model, input: texts }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Ollama embedding failed (${response.status}): ${detail}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== texts.length) {
    throw new Error('Ollama returned an invalid embeddings response');
  }
  return payload.embeddings.map(normalizeVector);
}

async function embedTexts(texts, options) {
  if (options.provider === 'hash') {
    return texts.map((text) => hashEmbedding(text, options.dimensions));
  }
  const embeddings = [];
  for (let index = 0; index < texts.length; index += 32) {
    embeddings.push(...await ollamaEmbeddings(texts.slice(index, index + 32), options));
  }
  return embeddings;
}

function vectorBuffer(vector) {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

function bufferVector(value) {
  const bytes = Buffer.from(value);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Float32Array(copy);
}

function cosine(left, right) {
  if (left.length !== right.length) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function createSchema(db) {
  try {
    createSchemaTables(db);
  } catch (error) {
    if (/fts5/i.test(error.message)) {
      throw new Error(`This runtime's bundled SQLite has no FTS5 module, so the full-text index cannot be created (${error.message}). ${RUNTIME_HINT}`);
    }
    throw error;
  }
}

function createSchemaTables(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    DROP TABLE IF EXISTS metadata;
    DROP TABLE IF EXISTS documents;
    DROP TABLE IF EXISTS graph_nodes;
    DROP TABLE IF EXISTS graph_edges;
    DROP TABLE IF EXISTS documents_fts;
    DROP TABLE IF EXISTS documents_trgm;
    DROP TABLE IF EXISTS document_relations;

    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE documents (
      rowid INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      document_id TEXT NOT NULL,
      note_id TEXT,
      path TEXT,
      title TEXT,
      section TEXT,
      text TEXT NOT NULL,
      terms TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      source_ref TEXT,
      domain TEXT,
      metadata_json TEXT NOT NULL,
      text_hash TEXT NOT NULL DEFAULT '',
      embedding BLOB NOT NULL,
      UNIQUE(kind, document_id)
    );
    CREATE VIRTUAL TABLE documents_fts USING fts5(
      title,
      terms,
      body,
      content='documents',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );
    CREATE VIRTUAL TABLE documents_trgm USING fts5(
      title,
      terms,
      body,
      content='documents',
      content_rowid='rowid',
      tokenize='trigram'
    );
    CREATE TABLE document_relations (
      document_rowid INTEGER NOT NULL,
      relation_type TEXT NOT NULL,
      participant_note_id TEXT NOT NULL,
      PRIMARY KEY (document_rowid, participant_note_id)
    );
    CREATE TABLE graph_nodes (
      node_id TEXT PRIMARY KEY,
      canonical_name TEXT,
      label TEXT,
      aliases_json TEXT NOT NULL,
      properties_json TEXT NOT NULL
    );
    CREATE TABLE graph_edges (
      edge_id TEXT PRIMARY KEY,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      relationship_type TEXT NOT NULL,
      evidence TEXT,
      source_refs_json TEXT NOT NULL,
      properties_json TEXT NOT NULL
    );
    CREATE INDEX graph_edges_source_idx ON graph_edges(source_node_id);
    CREATE INDEX graph_edges_target_idx ON graph_edges(target_node_id);
    CREATE INDEX documents_kind_idx ON documents(kind);
    CREATE INDEX document_relations_participant_idx ON document_relations(participant_note_id);
  `);
}

function edgeIdentity(record) {
  return createHash('sha256').update(JSON.stringify({
    source: record.source_node_id ?? record.source_id ?? record.from ?? record.source,
    target: record.target_node_id ?? record.target_id ?? record.to ?? record.target,
    type: record.relationship_type ?? record.type ?? record.relation ?? record.label,
    evidence: record.evidence ?? null,
  })).digest('hex');
}

// Re-embedding a corpus that barely changed is the whole cost of a rebuild: with
// a real provider the SQL is seconds and the embeddings are minutes. Reusing a
// vector keyed by the exact text that produced it gives incremental cost with
// full-rebuild correctness — the index is still built from scratch every time,
// so a deleted or renamed note cannot leave a stale row behind, which is the
// failure mode a partial reindex has and this does not.
function loadEmbeddingCache(dbPath, config, promptId) {
  if (!existsSync(dbPath)) return new Map();
  let db;
  try {
    db = openSqlite(dbPath, { readOnly: true });
    const metadata = Object.fromEntries(
      db.prepare('SELECT key, value FROM metadata').all().map((row) => [row.key, row.value]),
    );
    // A vector is only reusable under the exact conditions that produced it.
    const reusable = metadata.schema_version === SCHEMA_VERSION
      && metadata.embedding_provider === config.provider
      // The hash provider encodes its dimensions in the model name, so model
      // equality already covers them; an Ollama model's dimensions come from the
      // model itself and are not a separate degree of freedom.
      && metadata.embedding_model === config.model
      && (metadata.embedding_prompt || 'none') === promptId;
    if (!reusable) return new Map();
    const cache = new Map();
    for (const row of db.prepare('SELECT text_hash, embedding FROM documents WHERE text_hash != \'\'').all()) {
      if (!cache.has(row.text_hash)) cache.set(row.text_hash, row.embedding);
    }
    return cache;
  } catch {
    // A cache that cannot be read is not an error; it just means everything is
    // embedded again.
    return new Map();
  } finally {
    db?.close();
  }
}

async function buildIndex(inputRoot, options = {}) {
  const root = findKnowledgeRoot(inputRoot);
  const dbPath = resolveDbPath(root, options.db);
  const provider = options.provider || 'hash';
  const dimensions = options.dimensions || DEFAULT_DIMENSIONS;
  const model = provider === 'hash' ? `local-hash-v1:${dimensions}` : (options.model || DEFAULT_OLLAMA_MODEL);
  const config = {
    provider,
    dimensions,
    model,
    ollamaUrl: options.ollamaUrl || DEFAULT_OLLAMA_URL,
  };
  const data = collectKnowledge(root);
  if (!data.documents.length && !data.edges.length) {
    throw new Error(`No knowledge artifacts found under ${root}`);
  }
  const prompt = embeddingPrompt(provider, model);
  const contextChars = embeddingContextChars(provider, model, options.embedChars ?? null);
  const windows = data.documents.map((document) => {
    const body = [document.section, document.text].filter(Boolean).join('\n');
    const text = prompt
      ? prompt.document(document.title, body)
      : [document.title, document.section, document.text].filter(Boolean).join('\n');
    return textWindows(text, contextChars);
  });
  // The hash covers the exact text that was embedded, prompt prefix included, so
  // a document whose title, section, or body changed misses the cache and is
  // re-embedded; one that did not is reused byte for byte.
  const textHashes = windows.map((group) => createHash('sha256').update(group.join('\u0000')).digest('hex'));
  const cache = options.reuseEmbeddings === false
    ? new Map()
    : loadEmbeddingCache(dbPath, config, prompt ? prompt.id : 'none');
  const pending = [];
  windows.forEach((group, index) => {
    if (!cache.has(textHashes[index])) pending.push({ index, group });
  });
  const computed = await embedTexts(pending.flatMap((item) => item.group), config);
  const byIndex = new Map();
  let cursor = 0;
  for (const item of pending) {
    byIndex.set(item.index, poolVectors(computed.slice(cursor, cursor + item.group.length)));
    cursor += item.group.length;
  }
  const embeddings = windows.map((group, index) => byIndex.get(index)
    ?? bufferVector(cache.get(textHashes[index])));
  const embeddingsReused = windows.length - pending.length;

  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openSqlite(dbPath);
  try {
    createSchema(db);
    db.exec('BEGIN IMMEDIATE');
    const insertMeta = db.prepare('INSERT INTO metadata(key, value) VALUES (?, ?)');
    const metadata = {
      schema_version: SCHEMA_VERSION,
      knowledge_root: root,
      source_fingerprint: data.fingerprint,
      indexed_at: new Date().toISOString(),
      embedding_provider: provider,
      embedding_model: model,
      embedding_dimensions: String(embeddings[0]?.length || dimensions),
      embedding_prompt: prompt ? prompt.id : 'none',
      embedding_context_chars: contextChars ? String(contextChars) : 'unbounded',
    };
    for (const [key, value] of Object.entries(metadata)) insertMeta.run(key, value);

    const insertDocument = db.prepare(`
      INSERT INTO documents(
        kind, document_id, note_id, path, title, section, text, terms, body,
        source_ref, domain, metadata_json, text_hash, embedding
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = db.prepare('INSERT INTO documents_fts(rowid, title, terms, body) VALUES (?, ?, ?, ?)');
    const insertTrgm = db.prepare('INSERT INTO documents_trgm(rowid, title, terms, body) VALUES (?, ?, ?, ?)');
    const insertRelation = db.prepare(`
      INSERT INTO document_relations(document_rowid, relation_type, participant_note_id)
      VALUES (?, ?, ?)
    `);
    data.documents.forEach((document, index) => {
      const result = insertDocument.run(
        document.kind,
        document.id,
        document.noteId,
        document.path,
        document.title,
        document.section,
        document.text,
        document.terms,
        document.body,
        document.sourceRef,
        document.domain,
        JSON.stringify(document.metadata),
        textHashes[index],
        vectorBuffer(embeddings[index]),
      );
      insertFts.run(result.lastInsertRowid, document.title || '', document.terms, document.body);
      insertTrgm.run(result.lastInsertRowid, document.title || '', document.terms, document.body);
      for (const participant of document.relation?.participants || []) {
        insertRelation.run(result.lastInsertRowid, document.relation.relationType, participant);
      }
    });

    const insertNode = db.prepare(`
      INSERT INTO graph_nodes(node_id, canonical_name, label, aliases_json, properties_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    data.nodes.forEach((record, index) => {
      const name = record.canonical_name ?? record.name ?? record.title ?? null;
      const id = String(record.id || record.node_id || name || '').trim();
      if (!id) throw new Error(`nodes.jsonl:${index + 1}: missing id or canonical_name`);
      insertNode.run(
        id,
        name,
        record.label ?? record.type ?? record.class ?? 'Entity',
        JSON.stringify(asStrings(record.aliases)),
        JSON.stringify(record),
      );
    });

    const insertEdge = db.prepare(`
      INSERT INTO graph_edges(
        edge_id, source_node_id, target_node_id, relationship_type,
        evidence, source_refs_json, properties_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    data.edges.forEach((record, index) => {
      const source = String(record.source_node_id ?? record.source_id ?? record.from ?? record.source ?? '').trim();
      const target = String(record.target_node_id ?? record.target_id ?? record.to ?? record.target ?? '').trim();
      const type = String(record.relationship_type ?? record.type ?? record.relation ?? record.label ?? '').trim();
      if (!source || !target || !type) {
        throw new Error(`edges.jsonl:${index + 1}: missing source, target, or relationship type`);
      }
      insertEdge.run(
        String(record.id || record.edge_id || edgeIdentity(record)),
        source,
        target,
        type,
        record.evidence ?? null,
        JSON.stringify(asStrings(record.source_refs ?? record.sources)),
        JSON.stringify(record),
      );
    });
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  } finally {
    db.close();
  }

  return {
    root,
    database: dbPath,
    documents: data.documents.length,
    notes: data.documents.filter((item) => item.kind === 'note').length,
    chunks: data.documents.filter((item) => item.kind === 'chunk').length,
    nodes: data.nodes.length,
    edges: data.edges.length,
    relations: data.documents.filter((item) => item.relation).length,
    embedding_provider: provider,
    embedding_model: model,
    embedding_dimensions: embeddings[0]?.length || dimensions,
    embedding_quality: embeddingQuality(provider),
    embedding_prompt: prompt ? prompt.id : 'none',
    embedding_context_chars: contextChars,
    documents_windowed: windows.filter((group) => group.length > 1).length,
    embeddings_reused: embeddingsReused,
    embeddings_computed: pending.length,
    notice: provider === 'hash'
      ? 'hash is a dependency-free lexical feature baseline, not a semantic embedding. Search ranks full-text matches first; use --provider ollama for semantic retrieval.'
      : null,
    source_fingerprint: data.fingerprint,
  };
}

function readMetadata(db) {
  return Object.fromEntries(db.prepare('SELECT key, value FROM metadata').all().map((row) => [row.key, row.value]));
}

function openIndex(inputRoot, dbPath = null) {
  const root = findKnowledgeRoot(inputRoot);
  const database = resolveDbPath(root, dbPath);
  if (!existsSync(database)) {
    throw new Error(`SQLite knowledge index not found: ${database}. Run knowledge_index first.`);
  }
  const db = openSqlite(database, { readOnly: true });
  const version = readMetadata(db).schema_version;
  if (version !== SCHEMA_VERSION) {
    db.close();
    throw new Error(`SQLite knowledge index at ${database} uses schema ${version || 'unknown'}, but this build requires ${SCHEMA_VERSION}. Run knowledge_index to rebuild.`);
  }
  return { root, database, db };
}

function ftsTokens(text) {
  return [...new Set(tokenize(text).filter((token) => !token.startsWith('~')))].slice(0, 16);
}

// The trigram tokenizer cannot match terms shorter than three characters.
function trigramTokens(text) {
  return [...new Set(tokenize(text).filter((token) => !token.startsWith('~')))]
    .filter((token) => [...token].length >= 3)
    .slice(0, 16);
}

function columnMatch(column, tokens) {
  return tokens.map((token) => `${column}:"${token.replaceAll('"', '""')}"`).join(' OR ');
}

function snippet(text, query, maxLength = 700) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  const terms = tokenize(query).filter((token) => !token.startsWith('~'));
  const lower = normalized.toLocaleLowerCase();
  const position = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] || 0;
  const start = Math.max(0, position - Math.floor(maxLength / 3));
  const end = Math.min(normalized.length, start + maxLength);
  return `${start ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`;
}

async function queryEmbedding(text, metadata, options = {}) {
  const provider = metadata.embedding_provider;
  const dimensions = Number(metadata.embedding_dimensions);
  if (provider === 'hash') return hashEmbedding(text, dimensions);
  if (provider === 'ollama') {
    // An index built before prompts existed carries no `embedding_prompt`, and
    // prefixing a query its documents never saw would shift it away from them.
    const prompt = promptById(metadata.embedding_prompt);
    return (await ollamaEmbeddings([prompt ? prompt.query(text) : text], {
      model: metadata.embedding_model,
      ollamaUrl: options.ollamaUrl || process.env.OLLAMA_HOST || DEFAULT_OLLAMA_URL,
    }))[0];
  }
  throw new Error(`Unsupported index embedding provider: ${provider}`);
}

// A hit in the title is the strongest evidence that a document is *about* the
// query; a hit in the controlled vocabulary (summary, tags, aliases, user terms,
// symbols, entities) is deliberate curation; a hit in the body may be a single
// passing mention.
const COLUMN_RRF_WEIGHTS = { title: 0.5, terms: 0.35, body: 0.15 };

// Rank each column separately and fuse the rank lists. Scalar bm25() column
// weights cannot separate those tiers: BM25 normalises by the document's total
// length across all columns, so a long note whose title matches loses to a short
// note that merely mentions the term. Rank position carries no such scale.
// Filters read the document row plus the JSON metadata the indexer already
// stores, so scoped lookups do not require dropping into raw SQL.
const FILTERABLE_METADATA = { docType: 'doc_type', section: 'section' };

function documentFilter(options = {}, alias = 'd') {
  const clauses = [];
  const params = [];
  if (options.kind) { clauses.push(`${alias}.kind = ?`); params.push(options.kind); }
  if (options.domain) { clauses.push(`${alias}.domain = ?`); params.push(options.domain); }
  if (options.pathPrefix) { clauses.push(`${alias}.path LIKE ?`); params.push(`${options.pathPrefix}%`); }
  for (const [option, key] of Object.entries(FILTERABLE_METADATA)) {
    if (!options[option]) continue;
    clauses.push(`(json_extract(${alias}.metadata_json, '$.${key}') = ? OR json_extract(${alias}.metadata_json, '$.metadata.${key}') = ?)`);
    params.push(options[option], options[option]);
  }
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
}

function ftsRanks(db, table, tokens, filter = { sql: '', params: [] }) {
  const scores = new Map();
  for (const [column, weight] of Object.entries(COLUMN_RRF_WEIGHTS)) {
    const match = columnMatch(column, tokens);
    if (!match) continue;
    const rows = db.prepare(`
      SELECT d.rowid
      FROM ${table} f
      JOIN documents d ON d.rowid = f.rowid
      WHERE ${table} MATCH ?${filter.sql}
      ORDER BY bm25(${table})
      LIMIT 200
    `).all(match, ...filter.params);
    rows.forEach((row, index) => {
      const rowid = Number(row.rowid);
      scores.set(rowid, (scores.get(rowid) || 0) + weight / (RRF_K + index + 1));
    });
  }
  return new Map([...scores.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([rowid], index) => [rowid, index]));
}

// Collapse the word and substring rankings into one lexical ordering so the
// provider weights below still compare exactly two signals.
function fuseLexicalRanks(wordRanks, trigramRanks) {
  const scored = [...new Set([...wordRanks.keys(), ...trigramRanks.keys()])].map((rowid) => {
    const word = wordRanks.get(rowid);
    const trigram = trigramRanks.get(rowid);
    return {
      rowid,
      score: (word === undefined ? 0 : 0.7 / (RRF_K + word + 1))
        + (trigram === undefined ? 0 : 0.3 / (RRF_K + trigram + 1)),
    };
  }).sort((left, right) => right.score - left.score);
  return new Map(scored.map((item, index) => [item.rowid, index]));
}

// Weighted like the curated-vocabulary column: enough to lift a relation note
// past a participant it already ranks beside, never enough to invent a top hit
// out of a note the query barely reached. Promotion only ever adds score, so a
// relation note that matched the query lexically cannot be demoted by it.
const RELATION_RRF_WEIGHT = 0.35;

// A promoted side is appended to the end of the result window, not inserted
// behind the relation note that vouched for it. Being retrievable is the whole
// requirement — a comparison needs its sides inside the top k, not ranked
// second — and scoring them near the top spends the best slots of every other
// query on notes that matched nothing. Measured on a real vault, promoting into
// the top slots traded four comparison answers for three non-relational ones:
// recall rose, MRR fell, and five previously-answered questions broke.

// Promotion may never take more than this share of the window. A relation note
// with five declared sides would otherwise decide the entire result on the
// strength of a single match.
const RELATION_PARTICIPANT_WINDOW_SHARE = 0.5;

// Only a relation note the query actually reached may pull its participants up.
// The rank that decides this is the fused one, not the lexical one: a contrast
// note is often reached *through* its participants — forward promotion puts it
// first while its own lexical rank stays in the tail — and reading lexical rank
// here would disqualify exactly the notes that earned their place.
const RELATION_SOURCE_RANK_LIMIT = 8;

function rrfScore(rank) {
  return rank === undefined || rank === null || !Number.isFinite(rank) ? 0 : 1 / (RRF_K + rank + 1);
}

function noteIdOf(row) {
  return row?.note_id || (row?.kind === 'note' ? row.document_id : null);
}

// Rank relation notes by how many of their declared participants the lexical
// pass already matched. Only declared `participants` count: co-occurrence and
// shared anchors are candidate signals, not evidence of a relation.
function relationRanks(db, lexicalRanks, rowsById) {
  const matchedNoteIds = new Set();
  for (const rowid of lexicalRanks.keys()) {
    const noteId = noteIdOf(rowsById.get(rowid));
    if (noteId) matchedNoteIds.add(noteId);
  }
  if (matchedNoteIds.size < RELATION_PARTICIPANT_FLOOR) return new Map();
  const rows = db.prepare(`
    SELECT document_rowid AS rowid, count(*) AS matched
    FROM document_relations
    WHERE participant_note_id IN (${[...matchedNoteIds].map(() => '?').join(', ')})
    GROUP BY document_rowid
    HAVING matched >= ${RELATION_PARTICIPANT_FLOOR}
  `).all(...matchedNoteIds);
  const promoted = rows
    .map((row) => ({ rowid: Number(row.rowid), matched: Number(row.matched) }))
    // A kind filter narrows rowsById, and a relation note outside it is not a candidate.
    .filter((item) => rowsById.has(item.rowid))
    .sort((left, right) => (right.matched - left.matched)
      || ((lexicalRanks.get(left.rowid) ?? Infinity) - (lexicalRanks.get(right.rowid) ?? Infinity))
      || (left.rowid - right.rowid));
  return new Map(promoted.map((item, index) => [item.rowid, {
    rank: index,
    matched: item.matched,
    direction: 'participants-matched',
  }]));
}

// The reverse of relationRanks. A comparison question is usually phrased in the
// language of the contrast, not of its sides: the relation note matches and its
// participants — the notes holding the per-side evidence the answer needs — do
// not appear at all. Their declared membership in a matched relation is the same
// evidence that justifies forward promotion, read the other way.
function relationParticipantRanks(db, provisional, relationPromotions, rowsById, limit) {
  const sourceRowids = provisional
    .slice(0, RELATION_SOURCE_RANK_LIMIT)
    .map((item) => item.rowid)
    .filter((rowid) => rowsById.has(rowid));
  if (!sourceRowids.length) return new Map();
  const provisionalScores = new Map(provisional.map((item) => [item.rowid, item.score]));
  const provisionalRanks = new Map(provisional.map((item, index) => [item.rowid, index]));

  const rowidByNoteId = new Map();
  for (const [rowid, row] of rowsById) {
    if (row.kind !== 'note') continue;
    const noteId = noteIdOf(row);
    if (noteId && !rowidByNoteId.has(noteId)) rowidByNoteId.set(noteId, rowid);
  }

  const rows = db.prepare(`
    SELECT document_rowid AS rowid, participant_note_id AS note_id
    FROM document_relations
    WHERE document_rowid IN (${sourceRowids.map(() => '?').join(', ')})
  `).all(...sourceRowids);

  const nominations = new Map();
  for (const row of rows) {
    const rowid = rowidByNoteId.get(String(row.note_id));
    if (rowid === undefined) continue;
    // A note already promoted forward is the relation, not one of its sides.
    if (relationPromotions.has(rowid)) continue;
    const existing = nominations.get(rowid) ?? { rowid, matched: 0, bestSourceRank: Infinity };
    existing.matched += 1;
    existing.bestSourceRank = Math.min(existing.bestSourceRank, provisionalRanks.get(Number(row.rowid)) ?? Infinity);
    nominations.set(rowid, existing);
  }

  // Having matched the query is not the same as being retrievable: a
  // sentence-shaped Korean query yields hundreds of candidates, and a side
  // sitting at rank 22 of 353 is as absent from the top k as one that never
  // matched at all. A zero score is the same story — where a note sits among the
  // other zeroes is tie order, not retrieval.
  //
  // Promoted sides take the last slots of the window, which moves the boundary
  // they are judged against: a side at rank 9 of 10 is retrievable until two of
  // its siblings are appended, and then it is not. Solving for that boundary
  // rather than reading it once is what keeps a promotion from evicting the very
  // sibling it was meant to join.
  const needsHelp = (item, window) => {
    const score = provisionalScores.get(item.rowid) ?? 0;
    return !(score > 0 && (provisionalRanks.get(item.rowid) ?? Infinity) < window);
  };
  const sides = [...nominations.values()];
  let promotedCount = 0;
  for (let pass = 0; pass <= sides.length; pass += 1) {
    const next = sides.filter((item) => needsHelp(item, limit - promotedCount)).length;
    if (next === promotedCount) break;
    promotedCount = next;
  }
  for (const item of sides) {
    if (!needsHelp(item, limit - promotedCount)) nominations.delete(item.rowid);
  }

  const ordered = [...nominations.values()]
    .sort((left, right) => (left.bestSourceRank - right.bestSourceRank)
      || (right.matched - left.matched)
      || (left.rowid - right.rowid));
  return new Map(ordered.map((item, index) => [item.rowid, {
    rank: index,
    matched: item.matched,
    source_rank: item.bestSourceRank,
    direction: 'relation-matched',
  }]));
}

const DEFAULT_RERANK_DEPTH = 50;
const RERANK_DOCUMENT_CHARS = 1200;

// A cross-encoder reads the query and one candidate together, so it can settle
// what bi-encoder similarity and lexical rank can only approximate — but it
// costs a forward pass per candidate, which is why it reorders a shortlist
// instead of the corpus. Same contract as the embedding provider: nothing is
// installed, nothing is required, and an absent endpoint is not an error. The
// wire format is the Cohere/Jina shape that llama.cpp `/v1/rerank` and
// text-embeddings-inference both speak.
async function rerankCandidates(query, candidates, options) {
  const endpoint = new URL('/v1/rerank', options.rerankerUrl).toString();
  const documents = candidates.map((item) => [
    item.row.title,
    item.row.section,
    String(item.row.text || '').slice(0, RERANK_DOCUMENT_CHARS),
  ].filter(Boolean).join('\n'));
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: options.rerankerModel || undefined,
      query,
      documents,
      top_n: documents.length,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`rerank failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
  }
  const payload = await response.json();
  const results = Array.isArray(payload.results) ? payload.results : null;
  if (!results) throw new Error('rerank returned no results array');
  const scored = results
    .map((entry) => ({
      candidate: candidates[Number(entry.index)],
      score: Number(entry.relevance_score ?? entry.score),
    }))
    .filter((entry) => entry.candidate && Number.isFinite(entry.score));
  if (scored.length !== candidates.length) {
    throw new Error(`rerank returned ${scored.length} usable scores for ${candidates.length} candidates`);
  }
  scored.sort((left, right) => right.score - left.score);
  return scored.map((entry) => ({ ...entry.candidate, rerank_score: entry.score }));
}

function noteKey(row) {
  return row.note_id || `${row.kind}:${row.document_id}`;
}

// The hash provider is a lexical feature hash, not a trained embedding: its
// nearest neighbours are noise on short queries, and a long note's vector is
// diluted enough that it loses to any short note repeating the term. Giving it
// no weight leaves lexical evidence to decide the order whenever there is any;
// with no lexical match every score is zero and the secondary sort on
// semantic_score still orders the vector-only fallback.
// The semantic split is a starting point, not a measured constant. A trained
// embedding wins the paraphrased questions lexical search cannot reach, and
// loses the ones that quote an exact screen label back at the index — meaning
// similarity dilutes an exact term match. Sweep `--lexical-weight` against a
// saved eval run before treating either number as settled.
function fusionWeights(provider, lexicalWeight = null) {
  if (lexicalWeight !== null && Number.isFinite(lexicalWeight)) {
    return { semantic: Number((1 - lexicalWeight).toFixed(4)), lexical: Number(lexicalWeight.toFixed(4)) };
  }
  return provider === 'hash'
    ? { semantic: 0, lexical: 1 }
    : { semantic: 0.7, lexical: 0.3 };
}

function embeddingQuality(provider) {
  return provider === 'hash' ? 'lexical-baseline' : 'semantic';
}

function retrievalMode(lexicalReturned, total) {
  if (!total) return 'empty';
  if (!lexicalReturned) return 'vector';
  return lexicalReturned === total ? 'fts' : 'hybrid-fts-vector';
}

async function searchIndex(inputRoot, query, options = {}) {
  if (!String(query || '').trim()) throw new Error('query is required');
  const limit = Math.min(50, Math.max(1, Number(options.limit) || 8));
  const { root, database, db } = openIndex(inputRoot, options.db);
  try {
    const metadata = readMetadata(db);
    const weights = fusionWeights(metadata.embedding_provider, options.lexicalWeight ?? null);
    // A weight sweep re-scores the same questions several times over. The query
    // vector does not depend on the fusion weights, and with a real provider it
    // is the one part of a search that costs an HTTP round trip, so the caller
    // may hand in a cache to pay for it once.
    const cache = options.embeddingCache instanceof Map ? options.embeddingCache : null;
    const cacheKey = `${metadata.embedding_model}\u0000${query}`;
    let queryVector = cache?.get(cacheKey);
    if (!queryVector) {
      queryVector = await queryEmbedding(query, metadata, options);
      cache?.set(cacheKey, queryVector);
    }
    const filter = documentFilter(options);
    const allRows = db.prepare(`SELECT * FROM documents d WHERE 1 = 1${filter.sql}`).all(...filter.params);
    const rowsById = new Map(allRows.map((row) => [Number(row.rowid), row]));

    // Documents with no indexed body cannot be matched on meaning; scoring them
    // semantically lets short metadata-only records crowd out real notes.
    const semanticRanks = new Map();
    allRows
      .filter((row) => String(row.text || '').trim())
      .map((row) => ({ row, score: cosine(queryVector, bufferVector(row.embedding)) }))
      .filter((item) => item.score !== null)
      .sort((left, right) => right.score - left.score)
      .forEach((item, rank) => semanticRanks.set(Number(item.row.rowid), { rank, score: item.score }));

    // Word matching is exact, so inflected forms ("재시도한" vs "재시도") miss it.
    // The trigram index recovers those substring hits before fusion.
    const wordRanks = ftsRanks(db, 'documents_fts', ftsTokens(query), filter);
    const trigramRanks = ftsRanks(db, 'documents_trgm', trigramTokens(query), filter);
    const lexicalRanks = fuseLexicalRanks(wordRanks, trigramRanks);
    const relationPromotions = relationRanks(db, lexicalRanks, rowsById);

    // Fuse over the union of both candidate sets. Ranking only the semantic list
    // would cap how far a lexical match can climb, no matter how exact it is.
    const candidates = new Set([
      ...semanticRanks.keys(),
      ...lexicalRanks.keys(),
      ...relationPromotions.keys(),
    ]);
    const ranked = [...candidates].map((rowid) => {
      const semanticHit = semanticRanks.get(rowid);
      const lexicalRank = lexicalRanks.get(rowid);
      const promotion = relationPromotions.get(rowid);
      const semanticRrf = semanticHit ? 1 / (RRF_K + semanticHit.rank + 1) : 0;
      const lexicalRrf = lexicalRank === undefined ? 0 : 1 / (RRF_K + lexicalRank + 1);
      const relationRrf = promotion ? 1 / (RRF_K + promotion.rank + 1) : 0;
      return {
        rowid,
        row: rowsById.get(rowid),
        semantic: semanticHit ? semanticHit.score : null,
        lexicalRank,
        promotion,
        score: (weights.semantic * semanticRrf) + (weights.lexical * lexicalRrf)
          + (RELATION_RRF_WEIGHT * relationRrf),
      };
    }).sort((left, right) => (right.score - left.score)
      || ((right.semantic ?? -1) - (left.semantic ?? -1)));

    // A note split into chunks would otherwise fill the top slots with itself
    // and leave no room for the sibling notes a multi-note question needs.
    const seen = new Set();
    const grouped = options.group === 'none' ? ranked : ranked.filter((item) => {
      const key = noteKey(item.row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Reranking runs before the window is built, so promotion still decides
    // retrievability on the order a reader would actually see. A shortlist is
    // reordered and spliced back; the tail keeps its fused order.
    let reranked = grouped;
    let rerankState = { applied: false, error: null, depth: 0 };
    if (options.rerankerUrl) {
      const depth = Math.min(
        Math.max(limit, Number(options.rerankDepth) || DEFAULT_RERANK_DEPTH),
        grouped.length,
      );
      const shortlist = grouped.slice(0, depth);
      try {
        reranked = [...await rerankCandidates(query, shortlist, options), ...grouped.slice(depth)];
        rerankState = { applied: true, error: null, depth };
      } catch (error) {
        // Falling back to the fused order keeps search working, but a silent
        // fallback would quietly turn a benchmark into a different experiment,
        // so the failure is reported rather than swallowed.
        rerankState = { applied: false, error: error.message, depth };
      }
    }

    // Participants are nominated off the fused order — a contrast note usually
    // arrives at the top through forward promotion rather than its own keywords,
    // so reading lexical rank here would disqualify exactly the notes that
    // earned their place — and then take the last slots of the window instead of
    // the best ones.
    const participantPromotions = relationParticipantRanks(db, reranked, relationPromotions, rowsById, limit);
    const promotedRowids = new Set(participantPromotions.keys());
    const promoted = [...participantPromotions.entries()]
      .sort(([, left], [, right]) => left.rank - right.rank)
      .slice(0, Math.max(1, Math.floor(limit * RELATION_PARTICIPANT_WINDOW_SHARE)))
      .map(([rowid, promotion]) => ({
        ...(reranked.find((item) => item.rowid === rowid)
          ?? { rowid, row: rowsById.get(rowid), semantic: null, lexicalRank: undefined, score: 0 }),
        promotion,
      }))
      .filter((item) => item.row);
    // Promotion appends to the window, so somebody leaves it. Naming who turns
    // "a sibling note dropped out" from a guess into a measurement.
    const evicted = promoted.length
      ? reranked.slice(Math.max(0, limit - promoted.length), limit)
        .filter((item) => !promotedRowids.has(item.rowid))
      : [];
    const results = promoted.length
      ? [
        ...reranked.filter((item) => !promotedRowids.has(item.rowid)).slice(0, limit - promoted.length),
        ...promoted,
      ]
      : reranked.slice(0, limit);

    const lexicalReturned = results.filter((item) => item.lexicalRank !== undefined).length;
    return {
      query,
      root,
      database,
      retrieval: retrievalMode(lexicalReturned, results.length),
      lexical_candidates: lexicalRanks.size,
      lexical_word_matches: wordRanks.size,
      lexical_trigram_matches: trigramRanks.size,
      lexical_matches_returned: lexicalReturned,
      group: options.group === 'none' ? 'none' : 'note',
      distinct_notes: new Set(results.map((item) => noteKey(item.row))).size,
      candidates_before_grouping: ranked.length,
      relation_promotions: relationPromotions.size,
      relation_promoted_ids: [...relationPromotions.keys()].map((rowid) => rowsById.get(rowid).document_id),
      relation_participant_promotions: participantPromotions.size,
      relation_participant_promoted_ids: [...participantPromotions.keys()]
        .map((rowid) => rowsById.get(rowid).document_id),
      relation_participant_evicted_ids: evicted.map((item) => item.row.document_id),
      fusion_weights: weights,
      embedding_quality: embeddingQuality(metadata.embedding_provider),
      embedding_provider: metadata.embedding_provider,
      embedding_model: metadata.embedding_model,
      embedding_prompt: metadata.embedding_prompt || 'none',
      reranked: rerankState.applied,
      rerank_model: rerankState.applied ? (options.rerankerModel || null) : null,
      rerank_depth: rerankState.depth || null,
      rerank_error: rerankState.error,
      results: results.map(({ row, semantic: semanticScore, lexicalRank, promotion, score, rerank_score: rerankScore }) => ({
        kind: row.kind,
        id: row.document_id,
        note_id: row.note_id,
        title: row.title,
        section: row.section,
        path: row.path,
        source_ref: row.source_ref,
        domain: row.domain,
        score: Number(score.toFixed(8)),
        semantic_score: semanticScore === null ? null : Number(semanticScore.toFixed(6)),
        rerank_score: rerankScore === undefined ? null : Number(rerankScore.toFixed(6)),
        lexical_match: lexicalRank !== undefined,
        relation_promoted: promotion ? promotion.matched : 0,
        relation_promotion: promotion ? promotion.direction : null,
        text: snippet(row.text, query),
      })),
    };
  } finally {
    db.close();
  }
}

function requiredNoteRanks(results, requiredNoteIds) {
  // A required note counts as retrieved when its own record ranks, or when one
  // of its chunks does: both carry note_id, and either answers the question.
  const ranksByNoteId = new Map();
  results.forEach((result, index) => {
    const noteId = result.note_id || (result.kind === 'note' ? result.id : null);
    if (noteId && !ranksByNoteId.has(noteId)) ranksByNoteId.set(noteId, index + 1);
  });
  return requiredNoteIds.map((noteId) => ({ note_id: noteId, rank: ranksByNoteId.get(noteId) ?? null }));
}

// A question set that is entirely tuned against is no longer a measurement.
// The bucket is derived from the question id alone, so dev and holdout stay the
// same across runs, machines, and reorderings of questions.jsonl without any
// side file to keep in sync — and a question can never drift between splits
// while vocabulary is being repaired against the dev half.
function splitBucket(questionId) {
  let hash = 2166136261;
  for (let index = 0; index < questionId.length; index += 1) {
    hash ^= questionId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  // Finalize with an avalanche mix. Without it, ids that differ only in their
  // last characters — question-1 … question-94 — differ only in the low bits
  // FNV touched last, and taking the high bits as the bucket drops the whole
  // set into one split.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

function bridgeFieldsByNoteId(root) {
  const catalogPath = artifactPath(root, 'catalog');
  const byNoteId = new Map();
  if (!existsSync(catalogPath)) return byNoteId;
  for (const record of readJsonl(catalogPath)) {
    const id = String(record.id || '').trim();
    if (!id) continue;
    byNoteId.set(id, {
      domain: record.domain ?? null,
      aliases: asStrings(record.aliases).length,
      user_terms: asStrings(record.user_terms).length,
      source_symbols: asStrings(record.source_symbols).length,
    });
  }
  return byNoteId;
}

// Ranks the notes that eval could not retrieve by how many questions they block,
// and states which lookup-vocabulary fields those notes are missing. This turns
// "recall is 0.71" into a specific next edit; a note absent from the catalog is
// an extraction gap, not a vocabulary one, and is reported as such.
function repairTargets(questions, bridges) {
  const targets = new Map();
  for (const question of questions) {
    for (const required of question.required_notes) {
      if (required.rank !== null) continue;
      const existing = targets.get(required.note_id) ?? {
        note_id: required.note_id,
        in_catalog: bridges.has(required.note_id),
        ...(bridges.get(required.note_id) ?? { domain: null, aliases: 0, user_terms: 0, source_symbols: 0 }),
        blocked_questions: [],
      };
      existing.blocked_questions.push(question.question_id);
      targets.set(required.note_id, existing);
    }
  }
  return [...targets.values()]
    .map((target) => ({
      ...target,
      gap: target.in_catalog
        ? (target.user_terms + target.source_symbols + target.aliases === 0 ? 'no-lookup-vocabulary' : 'ranking')
        : 'missing-note',
    }))
    .sort((a, b) => b.blocked_questions.length - a.blocked_questions.length
      || a.note_id.localeCompare(b.note_id));
}

// A single recall number hides the trade: a vocabulary edit that lifts three
// questions and sinks two reads as progress. Comparing per question against a
// saved run makes the sunk ones the decision, which is the only safe rule when
// the question set is small enough that one question moves recall by points.
function compareQuestionSets(questions, priorQuestions) {
  const before = new Map((priorQuestions ?? []).map((item) => [item.question_id, item]));
  const improvements = [];
  const regressions = [];
  let compared = 0;
  for (const question of questions) {
    const prior = before.get(question.question_id);
    if (!prior) continue;
    compared += 1;
    const priorRank = prior.first_rank ?? null;
    const rank = question.first_rank ?? null;
    const move = {
      question_id: question.question_id,
      first_rank_before: priorRank,
      first_rank_after: rank,
      hit_before: prior.hit === true,
      hit_after: question.hit === true,
    };
    if (prior.hit === true && question.hit !== true) regressions.push(move);
    else if (priorRank !== null && (rank === null || rank > priorRank)) regressions.push(move);
    else if (prior.hit !== true && question.hit === true) improvements.push(move);
    else if (rank !== null && (priorRank === null || rank < priorRank)) improvements.push(move);
  }
  return {
    compared,
    unmatched: questions.length - compared,
    improvements,
    regressions,
    verdict: regressions.length ? 'regressed' : improvements.length ? 'improved' : 'unchanged',
  };
}

function compareToBaseline(questions, baselinePath) {
  const raw = JSON.parse(readFileSync(baselinePath, 'utf8'));
  return { path: baselinePath, ...compareQuestionSets(questions, raw.questions) };
}

async function evalQuestions(inputRoot, options = {}) {
  const root = findKnowledgeRoot(inputRoot);
  const questionsPath = artifactPath(root, 'questions');
  if (!existsSync(questionsPath)) {
    throw new Error(`No competency questions found at ${questionsPath}. Declare them before running eval.`);
  }
  const k = Math.min(50, Math.max(1, Number(options.k) || 10));
  const split = options.split || 'all';
  const holdoutRatio = Number.isFinite(options.holdout) ? options.holdout : DEFAULT_HOLDOUT_RATIO;
  const records = readJsonl(questionsPath);
  const bridges = bridgeFieldsByNoteId(root);

  const questions = [];
  let requiredTotal = 0;
  let requiredFound = 0;
  let reciprocalSum = 0;
  let skipped = 0;
  let fusionUsed = null;
  let rerankApplied = 0;
  let rerankError = null;
  for (const [index, record] of records.entries()) {
    const id = String(record.id || '').trim();
    const question = String(record.question || '').trim();
    if (!id) throw new Error(`${questionsPath}:${index + 1}: missing id`);
    if (!question) throw new Error(`${questionsPath}:${index + 1}: missing question`);
    const bucket = splitBucket(id) < holdoutRatio ? 'holdout' : 'dev';
    if (split !== 'all' && bucket !== split) {
      skipped += 1;
      continue;
    }
    const requiredNoteIds = asStrings(record.required_note_ids);
    const found = await searchIndex(root, question, { ...options, limit: k });
    fusionUsed = found.fusion_weights;
    if (found.reranked) rerankApplied += 1;
    if (found.rerank_error && !rerankError) rerankError = found.rerank_error;
    const required = requiredNoteRanks(found.results, requiredNoteIds);
    const ranks = required.map((item) => item.rank).filter((rank) => rank !== null);
    const firstRank = ranks.length ? Math.min(...ranks) : null;
    requiredTotal += required.length;
    requiredFound += ranks.length;
    reciprocalSum += firstRank === null ? 0 : 1 / firstRank;
    questions.push({
      question_id: id,
      question,
      kind: record.kind ?? null,
      split: bucket,
      required_notes: required,
      hit: required.length > 0 && ranks.length === required.length,
      first_rank: firstRank,
      distinct_notes: found.distinct_notes,
      retrieval: found.retrieval,
      results_returned: found.results.length,
    });
  }

  return {
    root,
    database: resolveDbPath(root, options.db),
    questions_path: questionsPath,
    k,
    kind: options.kind || null,
    fusion_weights: fusionUsed,
    // A run scored with a reranker attached is not comparable to one without,
    // so the baseline comparison has to be able to see which it was.
    reranker: options.rerankerUrl
      ? { model: options.rerankerModel || null, depth: options.rerankDepth ?? null, applied: rerankApplied, error: rerankError }
      : null,
    split,
    holdout_ratio: holdoutRatio,
    evaluated: questions.length,
    skipped_by_split: skipped,
    total: questions.length,
    hits: questions.filter((item) => item.hit).length,
    required_note_ids: requiredTotal,
    required_note_ids_found: requiredFound,
    recall_at_k: requiredTotal ? Number((requiredFound / requiredTotal).toFixed(6)) : 0,
    mean_distinct_notes: questions.length
      ? Number((questions.reduce((sum, item) => sum + item.distinct_notes, 0) / questions.length).toFixed(2))
      : 0,
    mrr: questions.length ? Number((reciprocalSum / questions.length).toFixed(6)) : 0,
    repair_targets: repairTargets(questions, bridges),
    baseline: options.baseline ? compareToBaseline(questions, options.baseline) : null,
    questions,
  };
}

// A sweep is not three eval runs pasted together: the question set, the split,
// and the index are identical across weights, so the only honest comparison is
// per question against the first weight in the list. The query vectors are
// shared, so the extra weights cost SQL and arithmetic, not embeddings.
async function sweepFusionWeights(inputRoot, options = {}) {
  const weights = options.sweep;
  const cache = new Map();
  const runs = [];
  for (const lexicalWeight of weights) {
    runs.push(await evalQuestions(inputRoot, {
      ...options,
      sweep: null,
      baseline: null,
      lexicalWeight,
      embeddingCache: cache,
    }));
  }

  const [reference] = runs;
  const points = runs.map((run, index) => ({
    lexical_weight: run.fusion_weights?.lexical ?? weights[index],
    semantic_weight: run.fusion_weights?.semantic ?? null,
    hits: run.hits,
    recall_at_k: run.recall_at_k,
    mrr: run.mrr,
    ...(index === 0
      ? { reference: true }
      : compareQuestionSets(run.questions, reference.questions)),
  }));

  // Rank by hits, then MRR — a tie on answered questions is broken by how high
  // the first correct answer sits.
  const best = [...points].sort((left, right) => right.hits - left.hits || right.mrr - left.mrr)[0];
  return {
    root: reference.root,
    database: reference.database,
    questions_path: reference.questions_path,
    k: reference.k,
    split: reference.split,
    holdout_ratio: reference.holdout_ratio,
    evaluated: reference.evaluated,
    embedding_queries_cached: cache.size,
    sweep: points,
    best_lexical_weight: best.lexical_weight,
    // A sweep that names a winner it cannot separate from the reference is a
    // tie, and reporting it as a win is how a guess becomes a default.
    decisive: best.hits !== reference.hits || best.mrr !== reference.mrr,
  };
}

function getDocument(inputRoot, id, options = {}) {
  if (!String(id || '').trim()) throw new Error('id is required');
  const { root, database, db } = openIndex(inputRoot, options.db);
  try {
    const rows = db.prepare(`
      SELECT kind, document_id AS id, note_id, path, title, section, text,
             source_ref, domain, metadata_json
      FROM documents
      WHERE document_id = ? ${options.kind ? 'AND kind = ?' : ''}
      ORDER BY CASE kind WHEN 'chunk' THEN 0 WHEN 'note' THEN 1 ELSE 2 END
    `).all(id, ...(options.kind ? [options.kind] : []));
    return {
      root,
      database,
      results: rows.map((row) => ({ ...row, metadata: JSON.parse(row.metadata_json), metadata_json: undefined })),
    };
  } finally {
    db.close();
  }
}

function graphNeighbors(inputRoot, query, options = {}) {
  if (!String(query || '').trim()) throw new Error('node query is required');
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 25));
  const direction = options.direction || 'both';
  if (!['in', 'out', 'both'].includes(direction)) throw new Error('direction must be in, out, or both');
  const { root, database, db } = openIndex(inputRoot, options.db);
  try {
    const exact = db.prepare(`
      SELECT * FROM graph_nodes
      WHERE node_id = ? OR lower(canonical_name) = lower(?)
      LIMIT 1
    `).get(query, query);
    const node = exact || db.prepare(`
      SELECT * FROM graph_nodes
      WHERE lower(canonical_name) LIKE lower(?) OR lower(aliases_json) LIKE lower(?)
      ORDER BY canonical_name
      LIMIT 1
    `).get(`%${query}%`, `%${query}%`);
    if (!node) return { root, database, query, node: null, edges: [] };

    const clauses = [];
    const params = [];
    if (direction === 'out' || direction === 'both') {
      clauses.push('source_node_id = ?');
      params.push(node.node_id);
    }
    if (direction === 'in' || direction === 'both') {
      clauses.push('target_node_id = ?');
      params.push(node.node_id);
    }
    let sql = `SELECT * FROM graph_edges WHERE (${clauses.join(' OR ')})`;
    if (options.relationship) {
      sql += ' AND relationship_type = ?';
      params.push(options.relationship);
    }
    sql += ' ORDER BY relationship_type, source_node_id, target_node_id LIMIT ?';
    params.push(limit);
    const edges = db.prepare(sql).all(...params);
    const nodeIds = [...new Set(edges.flatMap((edge) => [edge.source_node_id, edge.target_node_id]))];
    const related = new Map();
    const getNode = db.prepare('SELECT * FROM graph_nodes WHERE node_id = ?');
    for (const nodeId of nodeIds) {
      const found = getNode.get(nodeId);
      if (found) related.set(nodeId, found);
    }
    const shapeNode = (value) => value ? ({
      id: value.node_id,
      canonical_name: value.canonical_name,
      label: value.label,
      aliases: JSON.parse(value.aliases_json),
    }) : null;
    return {
      root,
      database,
      query,
      node: shapeNode(node),
      edges: edges.map((edge) => ({
        id: edge.edge_id,
        source: shapeNode(related.get(edge.source_node_id)) || { id: edge.source_node_id },
        target: shapeNode(related.get(edge.target_node_id)) || { id: edge.target_node_id },
        relationship_type: edge.relationship_type,
        evidence: edge.evidence,
        source_refs: JSON.parse(edge.source_refs_json),
      })),
    };
  } finally {
    db.close();
  }
}

function listDocuments(inputRoot, options = {}) {
  const limit = Math.min(500, Math.max(1, Number(options.limit) || 50));
  const filter = documentFilter(options);
  if (!filter.params.length) throw new Error('list requires at least one filter: --kind, --domain, --doc-type, --section, or --path-prefix');
  const { root, database, db } = openIndex(inputRoot, options.db);
  try {
    const rows = db.prepare(`
      SELECT kind, document_id AS id, note_id, path, title, section, domain, metadata_json
      FROM documents d WHERE 1 = 1${filter.sql}
      ORDER BY path, rowid
      LIMIT ?
    `).all(...filter.params, limit);
    return {
      root,
      database,
      filters: Object.fromEntries(['kind', 'domain', 'docType', 'section', 'pathPrefix'].filter((key) => options[key]).map((key) => [key, options[key]])),
      total: rows.length,
      results: rows.map(({ metadata_json: metadataJson, ...row }) => {
        const metadata = JSON.parse(metadataJson);
        return { ...row, doc_type: metadata.doc_type ?? metadata.metadata?.doc_type ?? null };
      }),
    };
  } finally {
    db.close();
  }
}

function indexStatus(inputRoot, options = {}) {
  const root = findKnowledgeRoot(inputRoot);
  const database = resolveDbPath(root, options.db);
  if (!existsSync(database)) {
    return { root, database, exists: false, stale: hasArtifacts(root) };
  }
  const db = openSqlite(database, { readOnly: true });
  try {
    const metadata = readMetadata(db);
    const counts = Object.fromEntries(
      db.prepare('SELECT kind, count(*) AS count FROM documents GROUP BY kind').all()
        .map((row) => [row.kind, Number(row.count)]),
    );
    const graph = {
      nodes: Number(db.prepare('SELECT count(*) AS count FROM graph_nodes').get().count),
      edges: Number(db.prepare('SELECT count(*) AS count FROM graph_edges').get().count),
    };
    let currentFingerprint = null;
    try { currentFingerprint = collectKnowledge(root).fingerprint; } catch {}
    return {
      root,
      database,
      exists: true,
      stale: currentFingerprint !== null && currentFingerprint !== metadata.source_fingerprint,
      metadata,
      counts,
      graph,
      filters: {
        column: ['kind', 'domain', 'path-prefix'],
        metadata: Object.values(FILTERABLE_METADATA),
        metadata_keys_seen: db.prepare(`
          SELECT DISTINCT j.key FROM documents, json_each(documents.metadata_json) j
          WHERE j.type NOT IN ('object', 'array') ORDER BY j.key
        `).all().map((row) => row.key),
      },
      bytes: statSync(database).size,
    };
  } finally {
    db.close();
  }
}

const MCP_TOOLS = [
  {
    name: 'knowledge_index',
    description: 'Build or refresh the local SQLite retrieval index from canonical Markdown and JSONL knowledge artifacts.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['hash', 'ollama'], description: 'hash is dependency-free; ollama provides semantic embeddings.' },
        model: { type: 'string', description: 'Ollama embedding model when provider is ollama.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'knowledge_search',
    description: 'Search the SQLite knowledge index with hybrid full-text and vector retrieval, returning source references for grounded answers.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 8 },
        kind: { type: 'string', enum: ['note', 'chunk', 'node'] },
        domain: { type: 'string' },
        docType: { type: 'string', description: 'Matches metadata doc_type.' },
        section: { type: 'string', description: 'Matches metadata section.' },
        pathPrefix: { type: 'string' },
        group: { type: 'string', enum: ['note', 'none'], default: 'note', description: 'note keeps one best result per note so chunks do not crowd out sibling notes.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'knowledge_get',
    description: 'Fetch complete indexed content and metadata by stable note, chunk, or node ID.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        kind: { type: 'string', enum: ['note', 'chunk', 'node'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'knowledge_neighbors',
    description: 'Traverse direct incoming or outgoing relationships for a graph node stored in SQLite.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Node ID, canonical name, or alias fragment.' },
        direction: { type: 'string', enum: ['in', 'out', 'both'], default: 'both' },
        relationship: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'knowledge_status',
    description: 'Report index location, source freshness, counts, and embedding configuration.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

async function callMcpTool(root, dbPath, name, args = {}) {
  if (name === 'knowledge_index') {
    return buildIndex(root, {
      db: dbPath,
      provider: args.provider || process.env.KNOWLEDGE_EMBED_PROVIDER || 'hash',
      model: args.model || process.env.KNOWLEDGE_EMBED_MODEL || DEFAULT_OLLAMA_MODEL,
      ollamaUrl: process.env.OLLAMA_HOST || DEFAULT_OLLAMA_URL,
      dimensions: DEFAULT_DIMENSIONS,
    });
  }
  if (name === 'knowledge_search') return searchIndex(root, args.query, { ...args, db: dbPath });
  if (name === 'knowledge_get') return getDocument(root, args.id, { ...args, db: dbPath });
  if (name === 'knowledge_neighbors') return graphNeighbors(root, args.query, { ...args, db: dbPath });
  if (name === 'knowledge_status') return indexStatus(root, { db: dbPath });
  throw new Error(`Unknown tool: ${name}`);
}

function writeMessage(message, output = process.stdout) {
  output.write(`${JSON.stringify(message)}\n`);
}

async function handleMcpMessage(message, context) {
  if (!message || message.jsonrpc !== '2.0') return null;
  if (message.method === 'notifications/initialized' || message.method?.startsWith('notifications/')) return null;
  if (message.id === undefined) return null;
  if (message.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'knowledge-local', version: '1.0.0' },
      },
    };
  }
  if (message.method === 'ping') return { jsonrpc: '2.0', id: message.id, result: {} };
  if (message.method === 'tools/list') {
    return { jsonrpc: '2.0', id: message.id, result: { tools: MCP_TOOLS } };
  }
  if (message.method === 'tools/call') {
    try {
      const result = await callMcpTool(
        context.root,
        context.db,
        message.params?.name,
        message.params?.arguments || {},
      );
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        },
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [{ type: 'text', text: error.message }],
          isError: true,
        },
      };
    }
  }
  return {
    jsonrpc: '2.0',
    id: message.id,
    error: { code: -32601, message: `Method not found: ${message.method}` },
  };
}

async function serveMcp(context, input = process.stdin, output = process.stdout) {
  input.setEncoding('utf8');
  let buffer = '';
  for await (const chunk of input) {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        writeMessage({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, output);
        continue;
      }
      const response = await handleMcpMessage(message, context);
      if (response) writeMessage(response, output);
    }
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const root = resolve(options.root);
  let result;
  if (options.command === 'index') result = await buildIndex(root, options);
  else if (options.command === 'search') result = await searchIndex(root, options.query, options);
  else if (options.command === 'neighbors') result = graphNeighbors(root, options.query, options);
  else if (options.command === 'get') result = getDocument(root, options.query, options);
  else if (options.command === 'status') result = indexStatus(root, options);
  else if (options.command === 'eval') {
    result = options.sweep ? await sweepFusionWeights(root, options) : await evalQuestions(root, options);
  }
  else if (options.command === 'list') result = listDocuments(root, options);
  else if (options.command === 'serve') {
    await serveMcp({ root, db: options.db });
    return;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

export {
  MCP_TOOLS,
  buildIndex,
  callMcpTool,
  collectKnowledge,
  embeddingPrompt,
  evalQuestions,
  findKnowledgeRoot,
  getDocument,
  graphNeighbors,
  handleMcpMessage,
  hashEmbedding,
  indexStatus,
  listDocuments,
  parseArgs,
  promptById,
  rerankCandidates,
  searchIndex,
  serveMcp,
  sweepFusionWeights,
  textWindows,
};
