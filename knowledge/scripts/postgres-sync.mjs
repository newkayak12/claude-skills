#!/usr/bin/env node
// Synchronize portable knowledge artifacts into PostgreSQL.
//
// The Markdown vault and JSONL artifacts remain canonical. PostgreSQL is a
// rebuildable query index, updated with idempotent upserts and soft deletion.
import {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_CONFIG = '.knowledge/postgres.json';
const DEFAULT_INTERVAL_MS = 5000;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift() || 'once';
  const options = { root: process.cwd(), config: DEFAULT_CONFIG, dryRun: false };
  while (args.length) {
    const arg = args.shift();
    if (arg === '--root') options.root = args.shift();
    else if (arg === '--config') options.config = args.shift();
    else if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['init', 'once', 'watch'].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  return { command, ...options };
}

function loadConfig(root, configPath = DEFAULT_CONFIG) {
  const absolute = isAbsolute(configPath) ? resolve(configPath) : resolve(root, configPath);
  if (!existsSync(absolute)) throw new Error(`PostgreSQL sync config not found: ${absolute}`);
  const config = JSON.parse(readFileSync(absolute, 'utf8'));
  if (config.enabled === false) throw new Error('PostgreSQL sync is disabled by config');
  if (!config.workspace_id || typeof config.workspace_id !== 'string') {
    throw new Error('postgres.json requires a non-empty workspace_id');
  }
  const schema = config.schema || 'knowledge';
  if (!IDENTIFIER.test(schema)) throw new Error(`Invalid PostgreSQL schema: ${schema}`);
  const embeddingDimensions = config.embedding_dimensions ?? null;
  if (
    embeddingDimensions !== null &&
    (!Number.isInteger(embeddingDimensions) || embeddingDimensions < 1 || embeddingDimensions > 2000)
  ) {
    throw new Error('embedding_dimensions must be an integer from 1 to 2000');
  }
  return {
    enabled: true,
    workspaceId: config.workspace_id,
    schema,
    embeddingDimensions,
    intervalMs: Math.max(1000, Number(config.interval_ms) || DEFAULT_INTERVAL_MS),
    syncCatalog: config.sync?.catalog !== false,
    syncRag: config.sync?.rag !== false,
    syncGraph: config.sync?.graph !== false,
    configPath: absolute,
  };
}

function readJsonl(path) {
  if (!existsSync(path)) return null;
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

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function asStrings(value) {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value])
    .filter((item) => item !== undefined && item !== null)
    .map((item) => (typeof item === 'string' ? item : stableJson(item)));
}

function safeArtifactPath(root, path) {
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return absolute;
}

function catalogRows(root) {
  const records = readJsonl(join(root, '_knowledge', 'catalog.jsonl'));
  if (records === null) return null;
  return records.map((record, index) => {
    const noteId = String(record.id || '').trim();
    if (!noteId) throw new Error(`catalog.jsonl:${index + 1}: missing id`);
    const path = String(record.path || '').trim();
    const notePath = path && safeArtifactPath(root, path);
    const body = notePath && existsSync(notePath) ? readFileSync(notePath, 'utf8') : null;
    return {
      noteId,
      path,
      title: record.title ?? null,
      summary: record.summary ?? null,
      noteType: record.type ?? null,
      domain: record.domain ?? null,
      tags: asStrings(record.tags),
      aliases: asStrings(record.aliases),
      entities: asStrings(record.entities),
      sourceRefs: asStrings(record.source_refs ?? record.sources),
      status: record.status ?? null,
      confidence: record.confidence ?? null,
      body,
      metadata: record,
      contentHash: hash(stableJson(record) + '\n' + (body ?? '')),
    };
  });
}

function ragRows(root) {
  const records = readJsonl(join(root, '_rag', 'chunks.jsonl'));
  if (records === null) return null;
  return records.map((record, index) => {
    const chunkId = String(record.id || record.chunk_id || '').trim();
    if (!chunkId) throw new Error(`chunks.jsonl:${index + 1}: missing id`);
    const text = record.text ?? record.content;
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error(`chunks.jsonl:${index + 1}: missing text`);
    }
    const embedding = record.embedding ?? null;
    if (
      embedding !== null &&
      (!Array.isArray(embedding) || !embedding.length || embedding.some((v) => !Number.isFinite(v)))
    ) {
      throw new Error(`chunks.jsonl:${index + 1}: embedding must be a finite number array`);
    }
    const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
    return {
      chunkId,
      noteId: record.note_id ?? metadata.note_id ?? null,
      text,
      sourceRef: record.source_ref ?? metadata.source_ref ?? null,
      title: record.title ?? null,
      section: record.section ?? metadata.section ?? null,
      docType: record.doc_type ?? null,
      domain: record.domain ?? null,
      metadata,
      embedding,
      embeddingModel: record.embedding_model ?? metadata.embedding_model ?? null,
      contentHash: hash(text),
    };
  });
}

function graphNodeRows(root) {
  const records = readJsonl(join(root, '_graph', 'nodes.jsonl'));
  if (records === null) return null;
  return records.map((record, index) => {
    const canonicalName = record.canonical_name ?? record.name ?? record.title ?? null;
    const nodeId = String(record.id || record.node_id || canonicalName || '').trim();
    if (!nodeId) throw new Error(`nodes.jsonl:${index + 1}: missing id or canonical_name`);
    return {
      nodeId,
      label: record.label ?? record.type ?? record.class ?? 'Entity',
      canonicalName,
      aliases: asStrings(record.aliases),
      description: record.description ?? record.summary ?? null,
      sourceRefs: asStrings(record.source_refs ?? record.sources),
      properties: record,
      contentHash: hash(stableJson(record)),
    };
  });
}

function graphEdgeRows(root) {
  const records = readJsonl(join(root, '_graph', 'edges.jsonl'));
  if (records === null) return null;
  return records.map((record, index) => {
    const sourceNodeId = String(
      record.source_node_id ?? record.source_id ?? record.from ?? record.source ?? '',
    ).trim();
    const targetNodeId = String(
      record.target_node_id ?? record.target_id ?? record.to ?? record.target ?? '',
    ).trim();
    const relationshipType = String(
      record.relationship_type ?? record.type ?? record.relation ?? record.label ?? '',
    ).trim();
    if (!sourceNodeId || !targetNodeId || !relationshipType) {
      throw new Error(
        `edges.jsonl:${index + 1}: missing source, target, or relationship type`,
      );
    }
    const identity = stableJson({
      sourceNodeId,
      targetNodeId,
      relationshipType,
      evidence: record.evidence ?? null,
      sourceRefs: asStrings(record.source_refs ?? record.sources),
    });
    return {
      edgeId: String(record.id || record.edge_id || hash(identity)),
      sourceNodeId,
      targetNodeId,
      relationshipType,
      evidence: record.evidence ?? null,
      confidence: record.confidence ?? null,
      sourceRefs: asStrings(record.source_refs ?? record.sources),
      validFrom: record.valid_from ?? null,
      validTo: record.valid_to ?? null,
      properties: record.properties ?? record,
      contentHash: hash(stableJson(record)),
    };
  });
}

function q(value) {
  if (value === undefined || value === null) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function qJson(value) {
  return `${q(stableJson(value))}::jsonb`;
}

function qArray(value) {
  const values = asStrings(value);
  if (!values.length) return `ARRAY[]::text[]`;
  return `ARRAY[${values.map(q).join(', ')}]::text[]`;
}

function qVector(value) {
  if (value === undefined || value === null) return 'NULL';
  return `${q(`[${value.join(',')}]`)}::vector`;
}

function createSchemaSql(config) {
  const s = config.schema;
  const vectorIndex = config.embeddingDimensions
    ? `\nCREATE INDEX IF NOT EXISTS rag_chunks_embedding_${config.embeddingDimensions}_hnsw_idx\n  ON ${s}.rag_chunks USING hnsw ((embedding::vector(${config.embeddingDimensions})) vector_cosine_ops)\n  WHERE embedding IS NOT NULL AND vector_dims(embedding) = ${config.embeddingDimensions};`
    : '';
  return `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA IF NOT EXISTS ${s};

CREATE TABLE IF NOT EXISTS ${s}.workspaces (
  workspace_id text PRIMARY KEY,
  last_synced_at timestamptz
);

CREATE TABLE IF NOT EXISTS ${s}.notes (
  workspace_id text NOT NULL,
  note_id text NOT NULL,
  path text NOT NULL,
  title text,
  summary text,
  note_type text,
  domain text,
  tags text[] NOT NULL DEFAULT '{}',
  aliases text[] NOT NULL DEFAULT '{}',
  entities text[] NOT NULL DEFAULT '{}',
  source_refs text[] NOT NULL DEFAULT '{}',
  status text,
  confidence text,
  body text,
  metadata jsonb NOT NULL DEFAULT '{}',
  content_hash text NOT NULL,
  sync_batch text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, note_id)
);

CREATE TABLE IF NOT EXISTS ${s}.rag_chunks (
  workspace_id text NOT NULL,
  chunk_id text NOT NULL,
  note_id text,
  text text NOT NULL,
  source_ref text,
  title text,
  section text,
  doc_type text,
  domain text,
  metadata jsonb NOT NULL DEFAULT '{}',
  embedding vector,
  embedding_model text,
  content_hash text NOT NULL,
  sync_batch text NOT NULL,
  search_document tsvector GENERATED ALWAYS AS
    (to_tsvector('simple', coalesce(title, '') || ' ' || text)) STORED,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, chunk_id)
);

CREATE TABLE IF NOT EXISTS ${s}.graph_nodes (
  workspace_id text NOT NULL,
  node_id text NOT NULL,
  label text NOT NULL,
  canonical_name text,
  aliases text[] NOT NULL DEFAULT '{}',
  description text,
  source_refs text[] NOT NULL DEFAULT '{}',
  properties jsonb NOT NULL DEFAULT '{}',
  content_hash text NOT NULL,
  sync_batch text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, node_id)
);

CREATE TABLE IF NOT EXISTS ${s}.graph_edges (
  workspace_id text NOT NULL,
  edge_id text NOT NULL,
  source_node_id text NOT NULL,
  target_node_id text NOT NULL,
  relationship_type text NOT NULL,
  evidence text,
  confidence text,
  source_refs text[] NOT NULL DEFAULT '{}',
  valid_from timestamptz,
  valid_to timestamptz,
  properties jsonb NOT NULL DEFAULT '{}',
  content_hash text NOT NULL,
  sync_batch text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, edge_id)
);

CREATE INDEX IF NOT EXISTS notes_workspace_path_idx ON ${s}.notes (workspace_id, path);
CREATE INDEX IF NOT EXISTS notes_title_trgm_idx ON ${s}.notes USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS rag_chunks_workspace_note_idx ON ${s}.rag_chunks (workspace_id, note_id);
CREATE INDEX IF NOT EXISTS rag_chunks_search_idx ON ${s}.rag_chunks USING gin (search_document);
CREATE INDEX IF NOT EXISTS graph_nodes_workspace_name_idx
  ON ${s}.graph_nodes (workspace_id, canonical_name);
CREATE INDEX IF NOT EXISTS graph_edges_source_idx
  ON ${s}.graph_edges (workspace_id, source_node_id, relationship_type);
CREATE INDEX IF NOT EXISTS graph_edges_target_idx
  ON ${s}.graph_edges (workspace_id, target_node_id, relationship_type);${vectorIndex}
`;
}

function upsertSql(config, artifacts, batch = randomUUID()) {
  const s = config.schema;
  const workspace = q(config.workspaceId);
  const statements = [
    `INSERT INTO ${s}.workspaces (workspace_id, last_synced_at) VALUES (${workspace}, now())\n` +
      `ON CONFLICT (workspace_id) DO UPDATE SET last_synced_at = EXCLUDED.last_synced_at;`,
  ];

  if (artifacts.catalog !== null) {
    for (const row of artifacts.catalog) {
      statements.push(`INSERT INTO ${s}.notes
  (workspace_id, note_id, path, title, summary, note_type, domain, tags, aliases, entities,
   source_refs, status, confidence, body, metadata, content_hash, sync_batch, deleted_at)
VALUES
  (${workspace}, ${q(row.noteId)}, ${q(row.path)}, ${q(row.title)}, ${q(row.summary)},
   ${q(row.noteType)}, ${q(row.domain)}, ${qArray(row.tags)}, ${qArray(row.aliases)},
   ${qArray(row.entities)}, ${qArray(row.sourceRefs)}, ${q(row.status)}, ${q(row.confidence)},
   ${q(row.body)}, ${qJson(row.metadata)}, ${q(row.contentHash)}, ${q(batch)}, NULL)
ON CONFLICT (workspace_id, note_id) DO UPDATE SET
  path = EXCLUDED.path, title = EXCLUDED.title, summary = EXCLUDED.summary,
  note_type = EXCLUDED.note_type, domain = EXCLUDED.domain, tags = EXCLUDED.tags,
  aliases = EXCLUDED.aliases, entities = EXCLUDED.entities, source_refs = EXCLUDED.source_refs,
  status = EXCLUDED.status, confidence = EXCLUDED.confidence, body = EXCLUDED.body,
  metadata = EXCLUDED.metadata, content_hash = EXCLUDED.content_hash,
  sync_batch = EXCLUDED.sync_batch, updated_at = now(), deleted_at = NULL;`);
    }
    statements.push(
      `UPDATE ${s}.notes SET deleted_at = now() WHERE workspace_id = ${workspace} ` +
        `AND sync_batch <> ${q(batch)} AND deleted_at IS NULL;`,
    );
  }

  if (artifacts.rag !== null) {
    for (const row of artifacts.rag) {
      statements.push(`INSERT INTO ${s}.rag_chunks
  (workspace_id, chunk_id, note_id, text, source_ref, title, section, doc_type, domain,
   metadata, embedding, embedding_model, content_hash, sync_batch, deleted_at)
VALUES
  (${workspace}, ${q(row.chunkId)}, ${q(row.noteId)}, ${q(row.text)}, ${q(row.sourceRef)},
   ${q(row.title)}, ${q(row.section)}, ${q(row.docType)}, ${q(row.domain)},
   ${qJson(row.metadata)}, ${qVector(row.embedding)}, ${q(row.embeddingModel)},
   ${q(row.contentHash)}, ${q(batch)}, NULL)
ON CONFLICT (workspace_id, chunk_id) DO UPDATE SET
  note_id = EXCLUDED.note_id, text = EXCLUDED.text, source_ref = EXCLUDED.source_ref,
  title = EXCLUDED.title, section = EXCLUDED.section, doc_type = EXCLUDED.doc_type,
  domain = EXCLUDED.domain, metadata = EXCLUDED.metadata,
  embedding = CASE
    WHEN ${s}.rag_chunks.content_hash = EXCLUDED.content_hash
      THEN coalesce(EXCLUDED.embedding, ${s}.rag_chunks.embedding)
    ELSE EXCLUDED.embedding
  END,
  embedding_model = CASE
    WHEN ${s}.rag_chunks.content_hash = EXCLUDED.content_hash
      THEN coalesce(EXCLUDED.embedding_model, ${s}.rag_chunks.embedding_model)
    ELSE EXCLUDED.embedding_model
  END,
  content_hash = EXCLUDED.content_hash, sync_batch = EXCLUDED.sync_batch,
  updated_at = now(), deleted_at = NULL;`);
    }
    statements.push(
      `UPDATE ${s}.rag_chunks SET deleted_at = now() WHERE workspace_id = ${workspace} ` +
        `AND sync_batch <> ${q(batch)} AND deleted_at IS NULL;`,
    );
  }

  if (artifacts.nodes !== null) {
    for (const row of artifacts.nodes) {
      statements.push(`INSERT INTO ${s}.graph_nodes
  (workspace_id, node_id, label, canonical_name, aliases, description, source_refs,
   properties, content_hash, sync_batch, deleted_at)
VALUES
  (${workspace}, ${q(row.nodeId)}, ${q(row.label)}, ${q(row.canonicalName)},
   ${qArray(row.aliases)}, ${q(row.description)}, ${qArray(row.sourceRefs)},
   ${qJson(row.properties)}, ${q(row.contentHash)}, ${q(batch)}, NULL)
ON CONFLICT (workspace_id, node_id) DO UPDATE SET
  label = EXCLUDED.label, canonical_name = EXCLUDED.canonical_name,
  aliases = EXCLUDED.aliases, description = EXCLUDED.description,
  source_refs = EXCLUDED.source_refs, properties = EXCLUDED.properties,
  content_hash = EXCLUDED.content_hash, sync_batch = EXCLUDED.sync_batch,
  updated_at = now(), deleted_at = NULL;`);
    }
    statements.push(
      `UPDATE ${s}.graph_nodes SET deleted_at = now() WHERE workspace_id = ${workspace} ` +
        `AND sync_batch <> ${q(batch)} AND deleted_at IS NULL;`,
    );
  }

  if (artifacts.edges !== null) {
    for (const row of artifacts.edges) {
      statements.push(`INSERT INTO ${s}.graph_edges
  (workspace_id, edge_id, source_node_id, target_node_id, relationship_type, evidence,
   confidence, source_refs, valid_from, valid_to, properties, content_hash, sync_batch, deleted_at)
VALUES
  (${workspace}, ${q(row.edgeId)}, ${q(row.sourceNodeId)}, ${q(row.targetNodeId)},
   ${q(row.relationshipType)}, ${q(row.evidence)}, ${q(row.confidence)},
   ${qArray(row.sourceRefs)}, ${q(row.validFrom)}, ${q(row.validTo)},
   ${qJson(row.properties)}, ${q(row.contentHash)}, ${q(batch)}, NULL)
ON CONFLICT (workspace_id, edge_id) DO UPDATE SET
  source_node_id = EXCLUDED.source_node_id, target_node_id = EXCLUDED.target_node_id,
  relationship_type = EXCLUDED.relationship_type, evidence = EXCLUDED.evidence,
  confidence = EXCLUDED.confidence, source_refs = EXCLUDED.source_refs,
  valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to,
  properties = EXCLUDED.properties, content_hash = EXCLUDED.content_hash,
  sync_batch = EXCLUDED.sync_batch, updated_at = now(), deleted_at = NULL;`);
    }
    statements.push(
      `UPDATE ${s}.graph_edges SET deleted_at = now() WHERE workspace_id = ${workspace} ` +
        `AND sync_batch <> ${q(batch)} AND deleted_at IS NULL;`,
    );
  }

  return `BEGIN;\n${statements.join('\n')}\nCOMMIT;\n`;
}

function loadArtifacts(root, config) {
  return {
    catalog: config.syncCatalog ? catalogRows(root) : null,
    rag: config.syncRag ? ragRows(root) : null,
    nodes: config.syncGraph ? graphNodeRows(root) : null,
    edges: config.syncGraph ? graphEdgeRows(root) : null,
  };
}

function connectionEnv(env = process.env) {
  const next = { ...env };
  if (env.DATABASE_URL) {
    const url = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
      throw new Error('DATABASE_URL must use postgres:// or postgresql://');
    }
    next.PGHOST = decodeURIComponent(url.hostname);
    if (url.port) next.PGPORT = url.port;
    next.PGDATABASE = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (url.username) next.PGUSER = decodeURIComponent(url.username);
    if (url.password) next.PGPASSWORD = decodeURIComponent(url.password);
    const sslmode = url.searchParams.get('sslmode');
    if (sslmode) next.PGSSLMODE = sslmode;
  }
  if (!next.PGDATABASE) {
    throw new Error('Set DATABASE_URL or libpq PGDATABASE/PGHOST/PGUSER environment variables');
  }
  return next;
}

function runPsql(sql, env = process.env) {
  const result = spawnSync('psql', ['-X', '--set', 'ON_ERROR_STOP=1', '--quiet'], {
    input: sql,
    encoding: 'utf8',
    env: connectionEnv(env),
  });
  if (result.error?.code === 'ENOENT') throw new Error('psql is required but was not found in PATH');
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'psql failed').trim());
}

function artifactFingerprint(root, config) {
  const paths = [
    config.configPath,
    join(root, '_knowledge', 'catalog.jsonl'),
    join(root, '_rag', 'chunks.jsonl'),
    join(root, '_graph', 'nodes.jsonl'),
    join(root, '_graph', 'edges.jsonl'),
    join(root, '_knowledge', 'jobs', 'postgres-sync-queue.jsonl'),
  ];
  return hash(
    paths
      .filter(existsSync)
      .map((path) => `${path}:${statSync(path).size}:${statSync(path).mtimeMs}`)
      .join('\n'),
  );
}

function syncOnce(root, config, { dryRun = false, initOnly = false } = {}) {
  const schemaSql = createSchemaSql(config);
  const artifacts = initOnly ? null : loadArtifacts(root, config);
  const sql = artifacts ? `${schemaSql}\n${upsertSql(config, artifacts)}` : schemaSql;
  if (dryRun) {
    process.stdout.write(sql);
  } else {
    runPsql(sql);
  }
  return artifacts;
}

async function watch(root, config) {
  let lastSuccessfulFingerprint = null;
  process.stdout.write(
    `Watching ${root} for PostgreSQL knowledge sync (${config.intervalMs}ms interval)\n`,
  );
  while (true) {
    const fingerprint = artifactFingerprint(root, config);
    if (fingerprint !== lastSuccessfulFingerprint) {
      try {
        const artifacts = syncOnce(root, config);
        const counts = Object.fromEntries(
          Object.entries(artifacts).map(([key, rows]) => [key, rows?.length ?? 0]),
        );
        process.stdout.write(`Synced ${JSON.stringify(counts)}\n`);
        lastSuccessfulFingerprint = fingerprint;
      } catch (error) {
        process.stderr.write(`PostgreSQL sync failed; will retry: ${error.message}\n`);
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, config.intervalMs));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = resolve(options.root);
  const config = loadConfig(root, options.config);
  if (options.command === 'watch') {
    if (options.dryRun) throw new Error('--dry-run is not supported with watch');
    await watch(root, config);
    return;
  }
  const artifacts = syncOnce(root, config, {
    dryRun: options.dryRun,
    initOnly: options.command === 'init',
  });
  if (!options.dryRun) {
    const label = options.command === 'init'
      ? `Initialized PostgreSQL schema ${config.schema}`
      : `Synced ${Object.values(artifacts).reduce((sum, rows) => sum + (rows?.length ?? 0), 0)} records`;
    process.stdout.write(`${label}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

export {
  catalogRows,
  connectionEnv,
  createSchemaSql,
  graphEdgeRows,
  graphNodeRows,
  loadArtifacts,
  loadConfig,
  parseArgs,
  ragRows,
  stableJson,
  upsertSql,
};
