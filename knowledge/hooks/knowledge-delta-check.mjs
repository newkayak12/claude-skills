#!/usr/bin/env node
// Lightweight knowledge delta hook.
//
// Runs after common edit tools, detects changed Markdown files that belong to an
// existing knowledge workspace, and records check results plus reindex queues.
// It never blocks a tool call and exits quietly outside knowledge workspaces.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KNOWLEDGE_MARKERS = [
  'knowledge-system-plan.md',
  'vault-plan.md',
  'index.md',
  '_rag',
  '_graph',
  '_ontology',
  '_knowledge',
  '.knowledge',
];

const LINK_SCAN_SKIP_DIRS = new Set(['_rag', '_graph', '_ontology', '_knowledge', '.git']);

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function candidateFiles(input) {
  const ti = input.tool_input || {};
  const raw = [
    ti.file_path,
    ti.notebook_path,
    ...asArray(ti.file_paths),
    ...asArray(ti.paths),
  ];
  return [...new Set(raw.filter(Boolean).map(String))];
}

function inside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function markerScore(dir) {
  let score = 0;
  for (const marker of KNOWLEDGE_MARKERS) {
    if (existsSync(join(dir, marker))) score += 1;
  }
  if (basename(dir) === 'knowledge-system') score += 2;
  return score;
}

function findKnowledgeRoot(cwd, filePath) {
  const abs = isAbsolute(filePath) ? resolve(filePath) : resolve(cwd, filePath);
  if (!inside(cwd, abs)) return null;

  let dir = dirname(abs);
  let best = null;
  while (inside(cwd, dir)) {
    if (markerScore(dir) >= 2 || existsSync(join(dir, '_rag')) || existsSync(join(dir, '_graph'))) {
      best = dir;
      break;
    }
    const next = dirname(dir);
    if (next === dir) break;
    dir = next;
  }

  if (best) return { root: best, file: abs };

  const parts = relative(cwd, abs).split(/[\\/]/);
  const idx = parts.indexOf('knowledge-system');
  if (idx >= 0) {
    return { root: resolve(cwd, ...parts.slice(0, idx + 1)), file: abs };
  }
  return null;
}

function hasFrontmatter(text) {
  if (!text.startsWith('---\n')) return false;
  return text.indexOf('\n---', 4) !== -1;
}

function frontmatterFields(text) {
  if (!hasFrontmatter(text)) return new Set();
  const end = text.indexOf('\n---', 4);
  const body = text.slice(4, end);
  const fields = new Set();
  for (const line of body.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):/.exec(line);
    if (match) fields.add(match[1]);
  }
  return fields;
}

function frontmatterScalar(text, field) {
  if (!hasFrontmatter(text)) return null;
  const end = text.indexOf('\n---', 4);
  for (const line of text.slice(4, end).split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/.exec(line);
    if (match?.[1] !== field || !match[2]) continue;
    return match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return null;
}

function extractWikiLinks(text) {
  const out = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = re.exec(text))) {
    const raw = match[1].split('|')[0].split('#')[0].trim();
    if (raw && !/^[a-z]+:\/\//i.test(raw)) out.push(raw);
  }
  return [...new Set(out)];
}

function markdownLinkIndex(root) {
  const paths = new Set();
  const names = new Set();
  const pending = [root];

  while (pending.length) {
    const dir = pending.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!LINK_SCAN_SKIP_DIRS.has(entry.name)) pending.push(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

      const abs = join(dir, entry.name);
      const rel = relative(root, abs).replace(/\\/g, '/').replace(/\.md$/, '');
      paths.add(rel);
      names.add(basename(rel));
    }
  }

  return { paths, names };
}

function linkExists(target, index) {
  const normalized = target.replace(/\\/g, '/').replace(/\.md$/, '');
  return (
    index.paths.has(normalized) ||
    index.paths.has(`notes/${normalized}`) ||
    index.paths.has(`mocs/${normalized}`) ||
    (!normalized.includes('/') && index.names.has(normalized))
  );
}

function staleByMtime(sourceFile, artifactFile) {
  try {
    return statSync(sourceFile).mtimeMs > statSync(artifactFile).mtimeMs;
  } catch {
    return false;
  }
}

function appendJsonl(path, record) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`);
}

function analyze(root, file) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const text = readFileSync(file, 'utf8');
  const fields = frontmatterFields(text);
  const noteId = frontmatterScalar(text, 'id');
  const links = extractWikiLinks(text);
  const linkIndex = markdownLinkIndex(root);
  const brokenLinks = links.filter((target) => !linkExists(target, linkIndex));
  const catalogPath = join(root, '_knowledge', 'catalog.jsonl');
  const questionResultsPath = join(root, '_knowledge', 'question-results.jsonl');
  const nodesPath = join(root, '_graph', 'nodes.jsonl');
  const edgesPath = join(root, '_graph', 'edges.jsonl');
  const catalogPresent = existsSync(catalogPath);
  const questionResultsPresent = existsSync(questionResultsPath);
  const ragPresent = existsSync(join(root, '_rag'));
  const graphPresent = existsSync(join(root, '_graph'));
  const ontologyPresent = existsSync(join(root, '_ontology'));

  const missingFrontmatter = [];
  if (!hasFrontmatter(text)) {
    missingFrontmatter.push('frontmatter');
  } else {
    if (!fields.has('title')) missingFrontmatter.push('title');
    if (!fields.has('source') && !fields.has('sources') && !fields.has('provenance')) {
      missingFrontmatter.push('sources');
    }
  }

  const catalogDeltaNeeded = catalogPresent && !rel.split('/').some((part) => part.startsWith('_'));
  const answerabilityDeltaNeeded =
    questionResultsPresent && !rel.split('/').some((part) => part.startsWith('_'));
  const ragDeltaNeeded = ragPresent;
  const graphDeltaNeeded =
    graphPresent && (staleByMtime(file, nodesPath) || staleByMtime(file, edgesPath) || links.length > 0);
  const ontologyReviewSuggested =
    ontologyPresent && /\b(class|type|relation|entity|concept|alias|definition)\b/i.test(text);

  return {
    file: rel,
    note_id: noteId,
    checked_at: new Date().toISOString(),
    missing_frontmatter: missingFrontmatter,
    broken_links: brokenLinks,
    catalog_delta_needed: catalogDeltaNeeded,
    answerability_delta_needed: answerabilityDeltaNeeded,
    rag_delta_needed: ragDeltaNeeded,
    graph_delta_needed: graphDeltaNeeded,
    ontology_review_suggested: ontologyReviewSuggested,
    link_count: links.length,
  };
}

function main(input = readInput()) {
  if (!input || typeof input !== 'object') return;

  const cwd = resolve(input.cwd || process.cwd());
  const files = candidateFiles(input);
  if (!files.length) return;

  for (const raw of files) {
    const found = findKnowledgeRoot(cwd, raw);
    if (!found) continue;
    const { root, file } = found;
    if (!file.endsWith('.md') || !existsSync(file)) continue;
    if (relative(root, file).startsWith('_rag/') || relative(root, file).startsWith('_graph/')) continue;

    let report;
    try {
      report = analyze(root, file);
    } catch {
      continue;
    }

    const checksDir = join(root, '_knowledge', 'checks');
    const reportsDir = join(root, '_knowledge', 'reports');
    const jobsDir = join(root, '_knowledge', 'jobs');
    mkdirSync(checksDir, { recursive: true });
    mkdirSync(reportsDir, { recursive: true });

    writeFileSync(join(checksDir, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);
    appendJsonl(join(reportsDir, 'delta-checks.jsonl'), report);

    const jobBase = {
      file: report.file,
      reason: 'post-tool knowledge delta',
      queued_at: report.checked_at,
    };
    if (report.catalog_delta_needed) {
      appendJsonl(join(jobsDir, 'catalog-delta-queue.jsonl'), {
        ...jobBase,
        note_id: report.note_id,
        operation: 'upsert-note',
        scope: 'single-note',
        beta: true,
      });
    }
    if (report.answerability_delta_needed) {
      appendJsonl(join(jobsDir, 'answerability-check-queue.jsonl'), {
        ...jobBase,
        note_id: report.note_id,
        operation: 'recheck-affected-questions',
        scope: 'note-dependents',
      });
    }
    if (report.rag_delta_needed) appendJsonl(join(jobsDir, 'embed-queue.jsonl'), jobBase);
    if (report.graph_delta_needed) appendJsonl(join(jobsDir, 'graph-update-queue.jsonl'), jobBase);
    if (report.ontology_review_suggested) appendJsonl(join(jobsDir, 'ontology-review-queue.jsonl'), jobBase);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch {
    // Fail-open: this hook is a knowledge freshness nudge, never an editor blocker.
  }
}

export { analyze, main };
