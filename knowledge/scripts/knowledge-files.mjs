// Read access to a store's own files: its index and rules notes (named by the
// `files` config key) and its read-only `sources/` folder. Every path from a
// caller is confined to its base directory, symlinks included.
import { existsSync, lstatSync, openSync, readSync, closeSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadStoreConfig } from './knowledge-config.mjs';
import { inside } from './knowledge-paths.mjs';

const SOURCES_DIR = 'sources';
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const BINARY_PROBE = 8192;

export function pageText(text, { offset, max_chars } = {}) {
  const start = offset ?? 0;
  if (!Number.isInteger(start) || start < 0) throw new Error(`offset must be an integer >= 0, got ${offset}`);
  if (max_chars !== undefined && max_chars !== null && (!Number.isInteger(max_chars) || max_chars < 1)) {
    throw new Error(`max_chars must be an integer >= 1, got ${max_chars}`);
  }
  const total = text.length;
  const end = max_chars == null ? total : Math.min(total, start + max_chars);
  const page = start >= total ? '' : text.slice(start, end);
  return {
    text: page,
    offset: start,
    returned_chars: page.length,
    total_chars: total,
    next_offset: page && end < total ? end : null,
  };
}

// Nearest existing ancestor's realpath plus the part that does not exist yet.
// A dangling symlink counts as existing (lstat), and fails realpath: refused.
function realWithTail(path) {
  let head = path;
  const tail = [];
  for (;;) {
    let exists = true;
    try {
      lstatSync(head);
    } catch {
      exists = false;
    }
    if (exists) return join(realpathSync.native(head), ...tail);
    const parent = dirname(head);
    if (parent === head) return path;
    tail.unshift(basename(head));
    head = parent;
  }
}

export function resolveInside(base, relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) throw new Error('path is empty');
  if (relPath.includes('\0')) throw new Error(`path contains a NUL byte: ${JSON.stringify(relPath)}`);
  if (isAbsolute(relPath) || relPath.startsWith('/') || relPath.startsWith('\\')) {
    throw new Error(`path is outside ${basename(base)}: absolute paths are refused (${relPath})`);
  }
  if (relPath.split(/[\\/]+/).includes('..')) throw new Error(`path is outside ${basename(base)}: '..' is refused (${relPath})`);
  let realBase;
  try {
    realBase = realpathSync.native(base);
  } catch {
    throw new Error(`${base} does not exist`);
  }
  let real;
  try {
    real = realWithTail(resolve(realBase, relPath));
  } catch {
    throw new Error(`path is outside ${basename(base)}: cannot resolve ${relPath}`);
  }
  if (!inside(realBase, real)) throw new Error(`path is outside ${basename(base)}: ${relPath} resolves beyond it`);
  return real;
}

function readText(path) {
  return readFileSync(path, 'utf8');
}

export function readStoreFile(root, which, paging = {}) {
  if (which !== 'index' && which !== 'rules') throw new Error(`file must be 'index' or 'rules', got ${JSON.stringify(which)}`);
  const rel = loadStoreConfig(root).files[which];
  const path = resolveInside(root, rel);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${rel} not found in the store (config key files.${which})`);
  }
  return { root, file: which, path: rel, ...pageText(readText(path), paging) };
}

export function listSources(root, { prefix, limit } = {}) {
  const sourcesDir = join(root, SOURCES_DIR);
  const cap = Number.isInteger(limit) && limit >= 1 ? Math.min(limit, MAX_LIMIT) : DEFAULT_LIMIT;
  const out = { root, sources_dir: SOURCES_DIR, prefix: prefix ?? null, total: 0, truncated: false, results: [] };
  if (!existsSync(sourcesDir)) {
    if (prefix) {
      try {
        resolveInside(sourcesDir, prefix);
      } catch (error) {
        if (!String(error.message).endsWith('does not exist')) throw error;
      }
    }
    return out;
  }
  if (prefix) resolveInside(sourcesDir, prefix);
  const realSources = realpathSync(sourcesDir);
  const found = [];
  const seen = new Set();
  const walk = (dir) => {
    const realDir = realpathSync(dir);
    if (seen.has(realDir)) return;
    seen.add(realDir);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      let real;
      let stat;
      try {
        real = realpathSync(full);
        stat = statSync(full);
      } catch {
        continue;
      }
      if (!inside(realSources, real)) continue;
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) {
        found.push({ path: relative(sourcesDir, full).split(sep).join('/'), bytes: stat.size, modified: stat.mtime.toISOString() });
      }
    }
  };
  walk(sourcesDir);
  const wanted = prefix ? found.filter((item) => item.path.startsWith(prefix.replace(/\\/g, '/').replace(/^\.\//, ''))) : found;
  wanted.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { ...out, total: wanted.length, truncated: wanted.length > cap, results: wanted.slice(0, cap) };
}

export function readSource(root, path, paging = {}) {
  const abs = resolveInside(join(root, SOURCES_DIR), path);
  if (!existsSync(abs)) throw new Error(`${path} not found in ${SOURCES_DIR}/`);
  const stat = statSync(abs);
  if (stat.isDirectory()) throw new Error(`${path} is a directory, not a file`);
  const fd = openSync(abs, 'r');
  let head;
  try {
    const probe = Buffer.alloc(Math.min(BINARY_PROBE, stat.size));
    readSync(fd, probe, 0, probe.length, 0);
    head = probe;
  } finally {
    closeSync(fd);
  }
  if (head.includes(0)) return { root, path, bytes: stat.size, binary: true };
  return { root, path, bytes: stat.size, binary: false, ...pageText(readText(abs), paging) };
}
