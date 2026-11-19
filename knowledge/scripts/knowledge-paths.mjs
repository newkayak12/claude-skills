// Where a knowledge store lives. One rule for the indexer, the MCP server and
// the delta hook, so all three land on the same directory for the same project.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const ARTIFACT_PATHS = {
  catalog: ['_knowledge/catalog.jsonl'],
  chunks: ['_rag/chunks.jsonl', 'rag/chunks.jsonl'],
  nodes: ['_graph/nodes.jsonl', 'graph/nodes.jsonl'],
  edges: ['_graph/edges.jsonl', 'graph/edges.jsonl'],
  questions: ['_knowledge/questions.jsonl'],
};
// Questions are an evaluation set, not indexed content: they must not decide
// where the knowledge root is, nor make a built index look stale when edited.
export const INDEXED_ARTIFACT_KINDS = ['catalog', 'chunks', 'nodes', 'edges'];
export const NESTED_ROOT_NAMES = ['knowledge-system', 'knowledge-base', 'knowledge-artifacts'];
// A project with no store yet gets one here, never at the project root, so the
// first write cannot pin the project root itself as the knowledge root.
export const DEFAULT_STORE_DIR = 'knowledge-system';
export const CONFIG_PATH = '_knowledge/config.json';

const MARKERS = [
  'knowledge-system-plan.md',
  'vault-plan.md',
  'index.md',
  '_rag',
  '_graph',
  '_ontology',
  '_knowledge',
  '.knowledge',
];

export function inside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function hasArtifacts(dir) {
  return INDEXED_ARTIFACT_KINDS.flatMap((kind) => ARTIFACT_PATHS[kind]).some((path) => existsSync(join(dir, path)));
}

function markerScore(dir) {
  let score = 0;
  for (const marker of MARKERS) if (existsSync(join(dir, marker))) score += 1;
  if (basename(dir) === DEFAULT_STORE_DIR) score += 2;
  return score;
}

// A directory is a store when it holds an indexed artifact, or enough of the
// layout's markers (a vault being written before its catalog exists).
export function looksLikeStore(dir) {
  return hasArtifacts(dir) || markerScore(dir) >= 2 || existsSync(join(dir, '_rag')) || existsSync(join(dir, '_graph'));
}

export function readStoreConfig(root) {
  const path = join(root, CONFIG_PATH);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
}

// `root` in a store's config moves the store elsewhere. It is read once from the
// first resolved root and never chained, since the file lives inside the root it names.
function redirect(root) {
  const target = readStoreConfig(root).root;
  if (typeof target !== 'string' || !target.trim()) return root;
  return isAbsolute(target) ? resolve(target) : resolve(root, target);
}

function locate(inputRoot) {
  const root = resolve(inputRoot);
  if (hasArtifacts(root)) return root;
  for (const name of NESTED_ROOT_NAMES) {
    const nested = join(root, name);
    if (hasArtifacts(nested)) return nested;
  }
  if (looksLikeStore(root)) return root;
  for (const name of NESTED_ROOT_NAMES) {
    const nested = join(root, name);
    if (existsSync(nested)) return nested;
  }
  return null;
}

// Read side: the store under inputRoot, or inputRoot itself when there is none
// (status and search on an empty project report an empty store there).
export function findKnowledgeRoot(inputRoot) {
  const found = locate(inputRoot);
  return found ? redirect(found) : resolve(inputRoot);
}

// Write side: the store under inputRoot, or `<inputRoot>/knowledge-system` when
// the project has none yet. The caller creates it.
export function storeRootForWrite(inputRoot) {
  const found = locate(inputRoot);
  if (found) return redirect(found);
  const root = resolve(inputRoot);
  return basename(root) === DEFAULT_STORE_DIR ? root : join(root, DEFAULT_STORE_DIR);
}

// Hook side: walk up from an edited file, bounded by cwd, to the first store.
export function findRootForFile(cwd, filePath) {
  const base = resolve(cwd);
  const abs = isAbsolute(filePath) ? resolve(filePath) : resolve(base, filePath);
  if (!inside(base, abs)) return null;
  let dir = dirname(abs);
  while (inside(base, dir)) {
    if (looksLikeStore(dir)) return { root: dir, file: abs };
    const next = dirname(dir);
    if (next === dir) break;
    dir = next;
  }
  const parts = relative(base, abs).split(/[\\/]/);
  const idx = parts.indexOf(DEFAULT_STORE_DIR);
  if (idx >= 0) return { root: resolve(base, ...parts.slice(0, idx + 1)), file: abs };
  return null;
}
