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
const SCHEMA_VERSION = '3';
const RRF_K = 60;
const ARTIFACT_PATHS = {
  catalog: ['_knowledge/catalog.jsonl'],
  chunks: ['_rag/chunks.jsonl', 'rag/chunks.jsonl'],
  nodes: ['_graph/nodes.jsonl', 'graph/nodes.jsonl'],
  edges: ['_graph/edges.jsonl', 'graph/edges.jsonl'],
};

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
    kind: null,
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
    else if (arg === '--kind') options.kind = value();
    else if (!options.query && ['search', 'neighbors', 'get'].includes(command)) options.query = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!['index', 'search', 'neighbors', 'get', 'status', 'serve'].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
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
  return { command, ...options };
}

function inside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function hasArtifacts(root) {
  return Object.values(ARTIFACT_PATHS).flat().some((path) => existsSync(join(root, path)));
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
    metadata: record.metadata || {},
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
  for (const kind of Object.keys(ARTIFACT_PATHS)) {
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
      Object.keys(ARTIFACT_PATHS).map((kind) => [kind, existsSync(artifactPath(root, kind))]),
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
  const embeddings = await embedTexts(
    data.documents.map((document) => [document.title, document.section, document.text].filter(Boolean).join('\n')),
    config,
  );

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
    };
    for (const [key, value] of Object.entries(metadata)) insertMeta.run(key, value);

    const insertDocument = db.prepare(`
      INSERT INTO documents(
        kind, document_id, note_id, path, title, section, text, terms, body,
        source_ref, domain, metadata_json, embedding
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = db.prepare('INSERT INTO documents_fts(rowid, title, terms, body) VALUES (?, ?, ?, ?)');
    const insertTrgm = db.prepare('INSERT INTO documents_trgm(rowid, title, terms, body) VALUES (?, ?, ?, ?)');
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
        vectorBuffer(embeddings[index]),
      );
      insertFts.run(result.lastInsertRowid, document.title || '', document.terms, document.body);
      insertTrgm.run(result.lastInsertRowid, document.title || '', document.terms, document.body);
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
    embedding_provider: provider,
    embedding_model: model,
    embedding_dimensions: embeddings[0]?.length || dimensions,
    embedding_quality: embeddingQuality(provider),
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

function ftsQuery(text) {
  const tokens = [...new Set(tokenize(text).filter((token) => !token.startsWith('~')))];
  return tokens.slice(0, 16).map((token) => `"${token.replaceAll('"', '""')}"`).join(' OR ');
}

// The trigram tokenizer cannot match terms shorter than three characters.
function trigramQuery(text) {
  const tokens = [...new Set(tokenize(text).filter((token) => !token.startsWith('~')))]
    .filter((token) => [...token].length >= 3);
  return tokens.slice(0, 16).map((token) => `"${token.replaceAll('"', '""')}"`).join(' OR ');
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
    return (await ollamaEmbeddings([text], {
      model: metadata.embedding_model,
      ollamaUrl: options.ollamaUrl || process.env.OLLAMA_HOST || DEFAULT_OLLAMA_URL,
    }))[0];
  }
  throw new Error(`Unsupported index embedding provider: ${provider}`);
}

// A hit in the title is the strongest evidence that a document is *about* the
// query; a hit in the controlled vocabulary (summary, tags, aliases, user terms,
// symbols, entities) is deliberate curation; a hit in the body may be a single
// passing mention. Weight the BM25 columns so those three tiers stay separated
// even when a long body repeats the term.
const BM25_COLUMN_WEIGHTS = '8.0, 4.0, 1.0';

function ftsRanks(db, table, match, kind = null) {
  const ranks = new Map();
  if (!match) return ranks;
  const rows = db.prepare(`
    SELECT d.rowid
    FROM ${table} f
    JOIN documents d ON d.rowid = f.rowid
    WHERE ${table} MATCH ? ${kind ? 'AND d.kind = ?' : ''}
    ORDER BY bm25(${table}, ${BM25_COLUMN_WEIGHTS})
    LIMIT 200
  `).all(match, ...(kind ? [kind] : []));
  rows.forEach((row, index) => ranks.set(Number(row.rowid), index));
  return ranks;
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

// The hash provider is a lexical feature hash, not a trained embedding: its
// nearest neighbours are noise on short queries, so exact matches must win.
function fusionWeights(provider) {
  return provider === 'hash'
    ? { semantic: 0.05, lexical: 0.95 }
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
    const weights = fusionWeights(metadata.embedding_provider);
    const queryVector = await queryEmbedding(query, metadata, options);
    const kindClause = options.kind ? ' WHERE kind = ?' : '';
    const allRows = db.prepare(`SELECT * FROM documents${kindClause}`).all(...(options.kind ? [options.kind] : []));
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
    const wordRanks = ftsRanks(db, 'documents_fts', ftsQuery(query), options.kind);
    const trigramRanks = ftsRanks(db, 'documents_trgm', trigramQuery(query), options.kind);
    const lexicalRanks = fuseLexicalRanks(wordRanks, trigramRanks);

    // Fuse over the union of both candidate sets. Ranking only the semantic list
    // would cap how far a lexical match can climb, no matter how exact it is.
    const candidates = new Set([...semanticRanks.keys(), ...lexicalRanks.keys()]);
    const results = [...candidates].map((rowid) => {
      const semanticHit = semanticRanks.get(rowid);
      const lexicalRank = lexicalRanks.get(rowid);
      const semanticRrf = semanticHit ? 1 / (RRF_K + semanticHit.rank + 1) : 0;
      const lexicalRrf = lexicalRank === undefined ? 0 : 1 / (RRF_K + lexicalRank + 1);
      return {
        row: rowsById.get(rowid),
        semantic: semanticHit ? semanticHit.score : null,
        lexicalRank,
        score: (weights.semantic * semanticRrf) + (weights.lexical * lexicalRrf),
      };
    }).sort((left, right) => (right.score - left.score)
      || ((right.semantic ?? -1) - (left.semantic ?? -1))).slice(0, limit);

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
      fusion_weights: weights,
      embedding_quality: embeddingQuality(metadata.embedding_provider),
      embedding_provider: metadata.embedding_provider,
      embedding_model: metadata.embedding_model,
      results: results.map(({ row, semantic: semanticScore, lexicalRank, score }) => ({
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
        lexical_match: lexicalRank !== undefined,
        text: snippet(row.text, query),
      })),
    };
  } finally {
    db.close();
  }
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
  findKnowledgeRoot,
  getDocument,
  graphNeighbors,
  handleMcpMessage,
  hashEmbedding,
  indexStatus,
  parseArgs,
  searchIndex,
  serveMcp,
};
