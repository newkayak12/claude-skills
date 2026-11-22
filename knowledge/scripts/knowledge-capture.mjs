// knowledge_capture: save content that arrived over MCP as a linked Markdown
// note. The engine decides every link, never the caller's prose:
//   - a note is linked only when its title or an alias appears in the text;
//   - index hits the text does not name are reported as skipped, never linked;
//   - each linked note gets a backlink, and a capture that links to nothing is
//     listed in a map-of-content, so no capture is an orphan;
//   - the same concept (title or alias already in the catalog) creates nothing
//     and returns merged_into.
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { loadStoreConfig } from './knowledge-config.mjs';
import { resolveInside } from './knowledge-files.mjs';
import { appendJsonl, writeDeltaJobs } from './knowledge-jobs.mjs';
import { findKnowledgeRoot, inside, looksLikeStore, storeRootForWrite } from './knowledge-paths.mjs';

const WORD = /[\p{L}\p{N}_]/u;
const HANGUL = /[가-힣]/;
// Regions a link must never be written into.
const PROTECTED = /```[\s\S]*?```|`[^`\n]*`|\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\)|<[^>\n]+>/g;

export function normalizeTerm(value) {
  return String(value || '').normalize('NFC').toLowerCase().replace(/[\s\p{P}]+/gu, ' ').trim();
}

export function slugify(value) {
  const slug = String(value || '').normalize('NFC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return slug || 'note';
}

function readCatalog(root) {
  const path = join(root, '_knowledge', 'catalog.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${path}:${index + 1}: ${error.message}`);
    }
  });
}

function protectedRanges(text) {
  const ranges = [];
  for (const match of text.matchAll(PROTECTED)) ranges.push([match.index, match.index + match[0].length]);
  return ranges;
}

function overlaps(ranges, start, end) {
  return ranges.some(([a, b]) => start < b && end > a);
}

// The one Korean particle list: capture links across it, the index tokenizer strips it.
export const KOREAN_PARTICLES = ['에서는', '에서', '으로', '에게', '까지', '부터', '와', '과', '을', '를', '이', '가', '은', '는', '의', '에', '로', '도', '만'];

function followedByParticle(rest) {
  return KOREAN_PARTICLES.some((item) => rest.startsWith(item) && !WORD.test(rest[item.length] || ' '));
}

// First place `term` appears in `text` as a whole word, outside code and links.
// A Hangul term may be followed by a listed particle (결제 승인을, 결제 승인은), not by other Hangul (결제 승인서).
export function findTerm(text, term, ranges = protectedRanges(text)) {
  const needle = term.normalize('NFC').toLowerCase();
  const hay = text.toLowerCase();
  if (!needle || hay.length !== text.length) return -1;
  const hangulEnd = HANGUL.test(needle.at(-1));
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at === -1) return -1;
    const before = hay[at - 1];
    const after = hay[at + needle.length];
    const okBefore = !before || !WORD.test(before);
    const okAfter = !after || !WORD.test(after) || (hangulEnd && HANGUL.test(after) && followedByParticle(hay.slice(at + needle.length)));
    if (okBefore && okAfter && !overlaps(ranges, at, at + needle.length)) return at;
    from = at + 1;
  }
}

function termsOf(entry) {
  return [entry.title, ...(entry.aliases || []), ...(entry.user_terms || [])]
    .filter((term) => typeof term === 'string' && term.trim());
}

function linkTarget(path) {
  return path.replace(/\\/g, '/').replace(/\.md$/, '');
}

function linkLine(target, title) {
  return `- [[${target}|${title}]]`;
}

function hasLinkTo(text, target) {
  return text.includes(`[[${target}|`) || text.includes(`[[${target}]]`) || text.includes(`[[${target}#`);
}

// Add one list line to the note's `## Related` section, creating it before
// `## Sources` (or at the end) when absent. Returns null when already linked.
export function addRelated(text, target, title) {
  if (hasLinkTo(text, target)) return null;
  const line = linkLine(target, title);
  const lines = text.replace(/\s+$/, '').split('\n');
  const heading = lines.findIndex((l) => /^##\s+Related\s*$/i.test(l));
  if (heading >= 0) {
    let end = heading + 1;
    while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end += 1;
    let insertAt = end;
    while (insertAt > heading + 1 && !lines[insertAt - 1].trim()) insertAt -= 1;
    lines.splice(insertAt, 0, line);
    return `${lines.join('\n')}\n`;
  }
  const sources = lines.findIndex((l) => /^##\s+Sources\s*$/i.test(l));
  const block = ['## Related', '', line, ''];
  if (sources >= 0) lines.splice(sources, 0, ...block);
  else lines.push('', ...block.slice(0, 3));
  return `${lines.join('\n')}\n`;
}

function yamlScalar(value) {
  const text = String(value);
  return /^[\p{L}\p{N}][\p{L}\p{N} _./-]*$/u.test(text) && !/^(true|false|null|yes|no|~)$/i.test(text)
    ? text
    : JSON.stringify(text);
}

function frontmatter(fields) {
  const out = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (!value.length) continue;
      out.push(`${key}:`);
      for (const item of value) out.push(`  - ${yamlScalar(item)}`);
    } else {
      out.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  out.push('---');
  return out.join('\n');
}

function stringList(value, name) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${name} must be an array of strings`);
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function summaryOf(content) {
  const line = content.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#') && !l.startsWith('```'));
  return (line || '').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1').slice(0, 200);
}

function findDuplicate(catalog, title, aliases) {
  const wanted = new Set([title, ...aliases].map(normalizeTerm).filter(Boolean));
  for (const entry of catalog) {
    const terms = [entry.id, ...termsOf(entry)].map(normalizeTerm);
    const hit = terms.find((term) => wanted.has(term));
    if (hit) return { entry, term: hit };
  }
  return null;
}

function chooseId(root, notesDir, catalog, requested, title) {
  const taken = new Set(catalog.map((entry) => entry.id));
  const free = (id) => !taken.has(id) && !existsSync(join(root, notesDir, `${id}.md`));
  if (requested !== undefined) {
    const id = String(requested).trim();
    if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(id)) throw new Error(`id ${JSON.stringify(id)} must be letters, digits, '.', '_' or '-'`);
    if (!free(id)) throw new Error(`id ${id} is already taken`);
    return id;
  }
  const base = slugify(title);
  if (free(base)) return base;
  for (let n = 2; ; n += 1) if (free(`${base}-${n}`)) return `${base}-${n}`;
}

// Link the first mention of each candidate in the body, longest term first so
// "결제 승인 정책" wins over "결제 승인". Returns the new body and what was linked.
function linkBody(body, candidates, maxLinks) {
  const ranges = protectedRanges(body);
  const claimed = [];
  const linked = [];
  const overflow = [];
  const options = [];
  for (const candidate of candidates) {
    for (const term of candidate.terms) {
      const at = findTerm(body, term, ranges);
      if (at >= 0) options.push({ candidate, term, at, end: at + term.length });
    }
  }
  options.sort((a, b) => (b.end - b.at) - (a.end - a.at) || a.at - b.at);
  const done = new Set();
  for (const option of options) {
    if (done.has(option.candidate.id)) continue;
    if (overlaps(claimed, option.at, option.end)) continue;
    if (linked.length >= maxLinks) {
      overflow.push(option.candidate);
      done.add(option.candidate.id);
      continue;
    }
    claimed.push([option.at, option.end]);
    linked.push(option);
    done.add(option.candidate.id);
  }
  // Terms that only appear where a link may not go (code, an existing link)
  // still count as mentioned, but get no inline link: they go to Related only.
  let out = body;
  for (const option of [...linked].sort((a, b) => b.at - a.at)) {
    const shown = out.slice(option.at, option.end);
    out = `${out.slice(0, option.at)}[[${option.candidate.target}|${shown}]]${out.slice(option.end)}`;
  }
  return { body: out, linked, overflow };
}

function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function addToMoc(root, mocPath, target, title) {
  const abs = join(root, mocPath);
  if (!inside(root, abs)) throw new Error(`moc ${mocPath} is outside the store`);
  const current = existsSync(abs)
    ? readFileSync(abs, 'utf8')
    : `${frontmatter({ id: slugify(mocPath.replace(/\.md$/, '')), title: 'Captures', type: 'moc', sources: ['knowledge_capture'] })}\n\n# Captures\n\nNotes saved by knowledge_capture.\n`;
  const next = addRelated(current, target, title);
  if (next === null) return false;
  writeText(abs, next);
  return true;
}

/**
 * @param {string} inputRoot project or store directory
 * @param {object} args { title, content, aliases?, sources?, id?, type?, domain?, tags?, summary? }
 * @param {object} deps { search?: async (root, query, {limit}) => {results} } for index candidates
 */
export async function captureNote(inputRoot, args = {}, deps = {}) {
  const title = String(args.title || '').trim();
  const content = String(args.content || '').trim();
  if (!title) throw new Error('title is required');
  if (!content) throw new Error('content is required');
  const aliases = stringList(args.aliases, 'aliases').filter((a) => normalizeTerm(a) !== normalizeTerm(title));
  const sources = stringList(args.sources, 'sources');
  const tags = stringList(args.tags, 'tags');
  if (!sources.length) sources.push('mcp:knowledge_capture');

  const root = storeRootForWrite(inputRoot);
  const config = loadStoreConfig(root);
  const catalog = readCatalog(root);
  const skipped = [];

  const duplicate = findDuplicate(catalog, title, aliases);
  if (duplicate) {
    return {
      root,
      created: false,
      merged_into: { id: duplicate.entry.id, path: duplicate.entry.path, title: duplicate.entry.title, matched: duplicate.term },
      id: null,
      path: null,
      linked_to: [],
      backlinked_from: [],
      skipped_candidates: [],
      jobs: [],
    };
  }

  const notesDir = String(config.notes_dir).replace(/^\/+|\/+$/g, '') || 'notes';
  const id = chooseId(root, notesDir, catalog, args.id, title);
  const path = `${notesDir}/${id}.md`;
  const abs = join(root, path);
  if (!inside(root, abs)) throw new Error(`notes_dir ${notesDir} is outside the store`);
  const target = linkTarget(path);

  const candidates = [];
  for (const entry of catalog) {
    if (!entry.id || !entry.path) continue;
    const terms = termsOf(entry).filter((term) => term.trim().length >= config.link.min_term_length);
    if (!terms.length) continue;
    candidates.push({ id: entry.id, path: entry.path, title: entry.title || entry.id, target: linkTarget(entry.path), terms });
  }
  const { body, linked, overflow } = linkBody(content, candidates, config.link.max_links);
  for (const candidate of overflow) skipped.push({ id: candidate.id, title: candidate.title, reason: 'max-links' });

  // Index hits are a second opinion: what the store thinks is related. They are
  // reported so a person or a later edit can link them; the text did not name
  // them, so the engine does not.
  const linkedIds = new Set(linked.map((option) => option.candidate.id));
  if (config.link.search_candidates > 0) {
    if (typeof deps.search !== 'function') {
      skipped.push({ id: null, reason: 'no-index', detail: 'no search backend was given' });
    } else {
      try {
        const found = await deps.search(root, [title, ...aliases].join(' '), { limit: config.link.search_candidates });
        const seen = new Set();
        for (const result of found.results || []) {
          const noteId = result.note_id || result.id;
          if (!noteId || linkedIds.has(noteId) || seen.has(noteId)) continue;
          seen.add(noteId);
          skipped.push({ id: noteId, title: result.title ?? null, reason: 'not-in-text', score: result.score ?? null });
        }
      } catch (error) {
        skipped.push({ id: null, reason: 'no-index', detail: error.message });
      }
    }
  }

  let note = `${frontmatter({
    id,
    title,
    type: args.type || 'capture',
    domain: args.domain,
    status: 'draft',
    confidence: 'captured',
    captured_at: new Date().toISOString(),
    tags,
    aliases,
    sources,
    related: linked.map((option) => option.candidate.id),
  })}\n\n# ${title}\n\n${body}\n`;
  for (const option of linked) note = addRelated(note, option.candidate.target, option.candidate.title) ?? note;
  if (!/^##\s+Sources\s*$/im.test(note)) note = `${note.replace(/\s+$/, '')}\n\n## Sources\n\n${sources.map((s) => `- \`${s}\``).join('\n')}\n`;

  // Backlinks first collect, then write, so a failure leaves no half-linked store.
  const backlinks = [];
  for (const option of linked) {
    const otherAbs = join(root, option.candidate.path);
    if (!inside(root, otherAbs) || !existsSync(otherAbs)) {
      skipped.push({ id: option.candidate.id, title: option.candidate.title, reason: 'missing-file' });
      continue;
    }
    const next = addRelated(readFileSync(otherAbs, 'utf8'), target, title);
    if (next !== null) backlinks.push({ path: option.candidate.path, abs: otherAbs, text: next });
  }

  writeText(abs, note);
  for (const backlink of backlinks) writeText(backlink.abs, backlink.text);
  const backlinkedFrom = backlinks.map((backlink) => backlink.path);
  const mocs = [];
  if (config.link.moc) mocs.push(config.link.moc);
  if (!backlinkedFrom.length && !config.link.moc) mocs.push(config.link.fallback_moc);
  for (const moc of mocs) if (addToMoc(root, moc, target, title)) backlinkedFrom.push(moc);

  appendJsonl(join(root, '_knowledge', 'catalog.jsonl'), {
    id,
    path,
    title,
    summary: String(args.summary || summaryOf(content)),
    type: args.type || 'capture',
    ...(args.domain ? { domain: args.domain } : {}),
    tags,
    aliases,
    related: linked.map((option) => option.candidate.id),
    source_refs: sources,
    status: 'draft',
    confidence: 'captured',
  });

  const queuedAt = new Date().toISOString();
  const jobs = writeDeltaJobs(root, { file: path, note_id: id, reason: 'knowledge_capture', queued_at: queuedAt },
    { catalog: true, embed: true, graph: true });
  for (const changed of backlinkedFrom) {
    writeDeltaJobs(root, { file: changed, note_id: null, reason: 'knowledge_capture backlink', queued_at: queuedAt },
      { embed: true, graph: true });
  }

  return {
    root,
    created: true,
    merged_into: null,
    id,
    path: relative(root, abs).replace(/\\/g, '/'),
    linked_to: linked.map((option) => ({ id: option.candidate.id, path: option.candidate.path, title: option.candidate.title, term: option.term })),
    backlinked_from: backlinkedFrom,
    skipped_candidates: skipped,
    jobs,
  };
}

// Folders a replace never writes: read-only sources and the engine's own artifacts.
const REPLACE_DENIED_DIRS = ['sources', '_knowledge', '_rag', '_graph'];

// Native realpath returns the on-disk letter case; the JS one keeps the caller's.
function tryRealpath(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
}

// File identity (device + inode): equal for hard links and case variants.
function identityOf(path) {
  try {
    const { dev, ino } = statSync(path);
    return `${dev}:${ino}`;
  } catch {
    return null;
  }
}

function frontmatterField(content, key) {
  const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return null;
  const line = block[1].split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
  if (!line) return null;
  const value = line.slice(key.length + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
  return value || null;
}

function bodyOf(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

/**
 * Replace the full text of an existing note. Only a catalogued note or a file
 * inside notes_dir can be replaced; sources/, engine artifacts and the index
 * and rules files never can, whatever path or symlink names them.
 * @param {object} args { id? | path?, content }
 * @param {object} deps { index?: async (root) => ({documents}) } re-index after the write
 */
export async function replaceNote(inputRoot, args = {}, deps = {}) {
  const hasId = args.id !== undefined && args.id !== null;
  const hasPath = args.path !== undefined && args.path !== null;
  if (hasId === hasPath) throw new Error('knowledge_note_replace needs exactly one of id or path');
  if (typeof args.content !== 'string' || !args.content.trim()) throw new Error('content is required (the full Markdown, frontmatter included)');
  const content = args.content;

  const root = findKnowledgeRoot(inputRoot);
  if (!looksLikeStore(root)) throw new Error(`no knowledge store under ${inputRoot}; knowledge_note_replace never creates one`);
  const config = loadStoreConfig(root);
  const catalogPath = join(root, '_knowledge', 'catalog.jsonl');
  const rawLines = existsSync(catalogPath) ? readFileSync(catalogPath, 'utf8').split('\n') : [];
  const rows = rawLines.map((line) => {
    if (!line.trim()) return null;
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${catalogPath}: ${error.message}`);
    }
  });

  let relPath;
  if (hasId) {
    const found = rows.find((row) => row && row.id === args.id);
    if (!found || typeof found.path !== 'string') throw new Error(`unknown note id ${JSON.stringify(args.id)}`);
    relPath = found.path;
  } else {
    relPath = String(args.path);
  }
  if (!relPath.endsWith('.md')) throw new Error(`only .md notes can be replaced, got ${relPath}`);
  const real = resolveInside(root, relPath);
  const realRoot = realpathSync.native(root);

  // Protected targets are compared by device+inode, never by path text.
  const realTarget = tryRealpath(real) ?? real;
  const [top] = relative(realRoot, realTarget).split(sep);
  const [lexTop] = relPath.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.');
  const targetId = identityOf(real);
  // A protected folder may itself be a symlink to a deeper folder: compare the target
  // with the realpath of each protected folder, not with its first segment.
  const deniedDir = REPLACE_DENIED_DIRS.find((dir) => {
    const dirReal = tryRealpath(join(realRoot, dir));
    const dirId = identityOf(join(realRoot, dir));
    return top === dir || String(lexTop).toLowerCase() === dir
      || (dirReal !== null && (dirReal === realTarget || inside(dirReal, realTarget)))
      || (dirId !== null && identityOf(join(realRoot, top)) === dirId);
  });
  if (deniedDir) throw new Error(`refused: ${deniedDir}/ is not replaceable (${relPath})`);
  for (const which of ['index', 'rules']) {
    let target = null;
    try {
      target = identityOf(resolveInside(root, config.files[which]));
    } catch { /* a config path outside the store cannot equal a confined target */ }
    if (target && target === targetId) throw new Error(`refused: ${relPath} is the store's ${which} file`);
  }

  if (!existsSync(real) || !statSync(real).isFile()) {
    throw new Error(`${relPath} does not exist; use knowledge_capture to create a note`);
  }
  // A second name for the same inode could be a protected file; none is written through.
  if (statSync(real).nlink > 1) throw new Error(`refused: ${relPath} has more than one hard link`);

  const rowIndex = rows.findIndex((row) => row && typeof row.path === 'string' && identityOf(join(root, row.path)) === targetId);
  const row = rowIndex >= 0 ? rows[rowIndex] : null;
  if (!row) {
    const notesReal = tryRealpath(join(root, String(config.notes_dir).replace(/^\/+|\/+$/g, '') || '.'));
    // notes_dir at or above the store root never widens a replace past the catalog.
    if (!notesReal || notesReal === realRoot || !inside(realRoot, notesReal) || !inside(notesReal, tryRealpath(real) ?? real)) {
      throw new Error(`refused: ${relPath} is not in the catalog and not inside notes_dir ${config.notes_dir}`);
    }
  }
  const frontId = frontmatterField(content, 'id');
  if (row && frontId !== row.id) {
    throw new Error(`frontmatter id ${JSON.stringify(frontId)} must equal the catalog id ${JSON.stringify(row.id)}; an id is not changed or dropped by a replace`);
  }

  const previousBytes = statSync(real).size;
  writeFileSync(real, content);

  const outPath = row ? row.path : relative(realRoot, real).split(sep).join('/');
  if (row) {
    const title = frontmatterField(content, 'title') || (bodyOf(content).match(/^#\s+(.+)$/m) || [])[1]?.trim();
    const summary = summaryOf(bodyOf(content));
    const next = { ...row, ...(title ? { title } : {}), ...(summary ? { summary } : {}) };
    const lines = [...rawLines];
    lines[rowIndex] = JSON.stringify(next);
    const tmp = `${catalogPath}.${process.pid}.tmp`;
    writeFileSync(tmp, lines.join('\n'));
    renameSync(tmp, catalogPath);
  }

  const jobs = writeDeltaJobs(root, { file: outPath, note_id: row ? row.id : null, reason: 'knowledge_note_replace', queued_at: new Date().toISOString() },
    { catalog: true, embed: true, graph: true });

  let indexed = null;
  let indexError = null;
  try {
    const built = await deps.index?.(root);
    indexed = built?.documents ?? null;
  } catch (error) {
    indexError = error.message;
  }

  return {
    root,
    replaced: true,
    id: row ? row.id : null,
    path: outPath,
    previous_bytes: previousBytes,
    bytes: Buffer.byteLength(content),
    catalogued: Boolean(row),
    jobs,
    indexed,
    index_error: indexError,
  };
}

export const REPLACE_TOOL = {
  name: 'knowledge_note_replace',
  description: 'Replace the full Markdown of an existing note (by catalog id or store-relative path), keeping its id, updating its catalog title and summary, queueing delta jobs and re-indexing the store with the index\'s existing embedding settings. Never creates a note (use knowledge_capture) and never touches sources/, the index or rules files, or engine artifacts.',
  inputSchema: {
    type: 'object',
    required: ['content'],
    properties: {
      id: { type: 'string', description: 'Catalog id of the note. Give exactly one of id or path.' },
      path: { type: 'string', description: 'Store-relative .md path inside the catalog or notes_dir.' },
      content: { type: 'string', description: 'The whole new file, frontmatter included.' },
    },
    additionalProperties: false,
  },
};

export const CAPTURE_TOOL = {
  name: 'knowledge_capture',
  description: 'Save content as a linked Markdown note in the knowledge store. Links only notes whose title or alias the text names, backlinks them, returns merged_into instead of creating a note for a concept the catalog already has, and queues catalog, graph and embed updates. Run knowledge_index afterwards to search it.',
  inputSchema: {
    type: 'object',
    required: ['title', 'content'],
    properties: {
      title: { type: 'string' },
      content: { type: 'string', description: 'Markdown body, without frontmatter.' },
      aliases: { type: 'array', items: { type: 'string' } },
      sources: { type: 'array', items: { type: 'string' }, description: 'Where the content came from (URL, file, MCP server and call).' },
      id: { type: 'string', description: 'Stable id; refused if taken. Default: slug of the title.' },
      type: { type: 'string', default: 'capture' },
      domain: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string' },
    },
    additionalProperties: false,
  },
};
