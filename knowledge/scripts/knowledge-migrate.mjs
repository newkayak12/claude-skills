// migrate: copy a built sqlite store into PostgreSQL + pgvector.
//
// The target tables mirror the sqlite tables one to one (documents with their
// embeddings, document relations, graph nodes and edges, metadata), keyed by
// workspace, so the pgvector backend (card 162) can answer the same queries
// and a row count on each side proves the copy. postgres-sync.mjs stays the
// jsonl sync; it has no embedding column for notes or nodes, so it cannot
// carry what sqlite computed.
//
// A run replaces the workspace's rows in one transaction: re-running it is safe.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
// pgvector indexes (HNSW) take at most 2000 dimensions; a column holds more.
export const PG_INDEX_MAX_DIMENSIONS = 2000;

const q = (value) => (value === null || value === undefined ? 'NULL' : `'${String(value).replace(/\u0000/g, '').replace(/'/g, "''")}'`);
const qJson = (text) => `${q(text ?? '{}')}::jsonb`;

function vectorLiteral(blob) {
  if (!blob || !blob.byteLength) return 'NULL';
  const copy = new Uint8Array(blob.byteLength);
  copy.set(blob);
  const vector = new Float32Array(copy.buffer);
  return `'[${Array.from(vector, (v) => (Number.isFinite(v) ? Number(v.toPrecision(8)) : 0)).join(',')}]'::vector`;
}

export function migrateTarget(root, options = {}, env = process.env) {
  let file = {};
  const configPath = join(root, options.config || '.knowledge/postgres.json');
  if (existsSync(configPath)) file = JSON.parse(readFileSync(configPath, 'utf8'));
  const workspaceId = options.workspace || env.KNOWLEDGE_PG_WORKSPACE || file.workspace_id;
  const schema = options.schema || env.KNOWLEDGE_PG_SCHEMA || file.schema || 'knowledge';
  if (!workspaceId) throw new Error('migrate needs a workspace: --workspace, KNOWLEDGE_PG_WORKSPACE, or workspace_id in .knowledge/postgres.json');
  if (!IDENTIFIER.test(schema)) throw new Error(`Invalid PostgreSQL schema: ${schema}`);
  return { workspaceId, schema };
}

export function readSqliteStore(db) {
  const documents = db.prepare(`
    SELECT rowid, kind, document_id, note_id, path, title, section, text, terms, body,
           source_ref, domain, metadata_json, text_hash, embedding
    FROM documents ORDER BY rowid
  `).all();
  const keyByRowid = new Map(documents.map((d) => [d.rowid, d]));
  const relations = db.prepare('SELECT document_rowid, relation_type, participant_note_id FROM document_relations').all()
    .map((r) => ({ ...r, document: keyByRowid.get(r.document_rowid) }))
    .filter((r) => r.document);
  const nodes = db.prepare('SELECT * FROM graph_nodes ORDER BY node_id').all();
  const edges = db.prepare('SELECT * FROM graph_edges ORDER BY edge_id').all();
  const metadata = db.prepare('SELECT key, value FROM metadata ORDER BY key').all();
  const dimensions = Number(metadata.find((m) => m.key === 'embedding_dimensions')?.value) || null;
  return { documents, relations, nodes, edges, metadata, dimensions };
}

export function migrateSql(store, { workspaceId, schema }) {
  const s = schema;
  const w = q(workspaceId);
  const lines = [
    'CREATE EXTENSION IF NOT EXISTS vector;',
    `CREATE SCHEMA IF NOT EXISTS ${s};`,
    `CREATE TABLE IF NOT EXISTS ${s}.kn_documents (
  workspace_id text NOT NULL, kind text NOT NULL, document_id text NOT NULL,
  note_id text, path text, title text, section text, text text NOT NULL,
  terms text NOT NULL DEFAULT '', body text NOT NULL DEFAULT '', source_ref text, domain text,
  metadata jsonb NOT NULL, text_hash text NOT NULL DEFAULT '', embedding vector,
  PRIMARY KEY (workspace_id, kind, document_id));`,
    `CREATE TABLE IF NOT EXISTS ${s}.kn_document_relations (
  workspace_id text NOT NULL, kind text NOT NULL, document_id text NOT NULL,
  relation_type text NOT NULL, participant_note_id text NOT NULL,
  PRIMARY KEY (workspace_id, kind, document_id, participant_note_id));`,
    `CREATE TABLE IF NOT EXISTS ${s}.kn_graph_nodes (
  workspace_id text NOT NULL, node_id text NOT NULL, canonical_name text, label text,
  aliases jsonb NOT NULL, properties jsonb NOT NULL, PRIMARY KEY (workspace_id, node_id));`,
    `CREATE TABLE IF NOT EXISTS ${s}.kn_graph_edges (
  workspace_id text NOT NULL, edge_id text NOT NULL, source_node_id text NOT NULL,
  target_node_id text NOT NULL, relationship_type text NOT NULL, evidence text,
  source_refs jsonb NOT NULL, properties jsonb NOT NULL, PRIMARY KEY (workspace_id, edge_id));`,
    `CREATE TABLE IF NOT EXISTS ${s}.kn_metadata (
  workspace_id text NOT NULL, key text NOT NULL, value text NOT NULL, PRIMARY KEY (workspace_id, key));`,
    'BEGIN;',
  ];
  for (const table of ['kn_document_relations', 'kn_documents', 'kn_graph_edges', 'kn_graph_nodes', 'kn_metadata']) {
    lines.push(`DELETE FROM ${s}.${table} WHERE workspace_id = ${w};`);
  }
  for (const d of store.documents) {
    lines.push(`INSERT INTO ${s}.kn_documents VALUES (${[
      w, q(d.kind), q(d.document_id), q(d.note_id), q(d.path), q(d.title), q(d.section), q(d.text),
      q(d.terms), q(d.body), q(d.source_ref), q(d.domain), qJson(d.metadata_json), q(d.text_hash), vectorLiteral(d.embedding),
    ].join(', ')});`);
  }
  for (const r of store.relations) {
    lines.push(`INSERT INTO ${s}.kn_document_relations VALUES (${[
      w, q(r.document.kind), q(r.document.document_id), q(r.relation_type), q(r.participant_note_id),
    ].join(', ')});`);
  }
  for (const n of store.nodes) {
    lines.push(`INSERT INTO ${s}.kn_graph_nodes VALUES (${[
      w, q(n.node_id), q(n.canonical_name), q(n.label), qJson(n.aliases_json), qJson(n.properties_json),
    ].join(', ')});`);
  }
  for (const e of store.edges) {
    lines.push(`INSERT INTO ${s}.kn_graph_edges VALUES (${[
      w, q(e.edge_id), q(e.source_node_id), q(e.target_node_id), q(e.relationship_type), q(e.evidence),
      qJson(e.source_refs_json), qJson(e.properties_json),
    ].join(', ')});`);
  }
  for (const m of store.metadata) lines.push(`INSERT INTO ${s}.kn_metadata VALUES (${w}, ${q(m.key)}, ${q(m.value)});`);
  lines.push('COMMIT;');
  const dims = store.dimensions;
  let vectorIndex = 'none';
  if (dims && dims <= PG_INDEX_MAX_DIMENSIONS) {
    lines.push(`CREATE INDEX IF NOT EXISTS kn_documents_embedding_${dims}_hnsw_idx ON ${s}.kn_documents
  USING hnsw ((embedding::vector(${dims})) vector_cosine_ops) WHERE embedding IS NOT NULL AND vector_dims(embedding) = ${dims};`);
    vectorIndex = `hnsw vector(${dims})`;
  } else if (dims) {
    vectorIndex = `skipped: ${dims} dimensions > ${PG_INDEX_MAX_DIMENSIONS}, rows are copied but not indexed`;
  }
  return { sql: `${lines.join('\n')}\n`, vectorIndex };
}

export function countsOf(store) {
  return {
    documents: store.documents.length,
    embeddings: store.documents.filter((d) => d.embedding && d.embedding.byteLength).length,
    relations: store.relations.length,
    nodes: store.nodes.length,
    edges: store.edges.length,
    metadata: store.metadata.length,
  };
}

// SQL that returns the same counts from PostgreSQL, one `name|count` per line.
export function countSql({ workspaceId, schema }) {
  const w = q(workspaceId);
  return [
    ['documents', `${schema}.kn_documents`, ''],
    ['embeddings', `${schema}.kn_documents`, ' AND embedding IS NOT NULL'],
    ['relations', `${schema}.kn_document_relations`, ''],
    ['nodes', `${schema}.kn_graph_nodes`, ''],
    ['edges', `${schema}.kn_graph_edges`, ''],
    ['metadata', `${schema}.kn_metadata`, ''],
  ].map(([name, table, extra]) => `SELECT '${name}|' || count(*) FROM ${table} WHERE workspace_id = ${w}${extra};`).join('\n');
}

// Run SQL through psql: PG* env for a reachable server, or a command prefix
// such as `docker exec -i <container> psql -U postgres` when there is no port.
export function runPsql(sql, { psql = ['psql'], env = process.env } = {}) {
  const [command, ...args] = psql;
  const result = spawnSync(command, [...args, '-X', '-At', '--set', 'ON_ERROR_STOP=1', '--quiet'], {
    input: sql,
    encoding: 'utf8',
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error?.code === 'ENOENT') throw new Error(`${command} is required but was not found in PATH`);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'psql failed').trim());
  return result.stdout;
}
