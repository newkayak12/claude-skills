#!/usr/bin/env node
// Validate answerability artifacts for a linked Markdown knowledge vault.
// The validator is read-only: builders create the artifacts; this script gates them.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const QUESTION_KINDS = new Set([
  'lookup',
  'synonym',
  'comparison',
  'cross-layer',
  'multi-source',
  'freshness',
]);
const COVERAGE_VALUES = new Set(['complete', 'partial', 'unanswerable']);
const RELATION_TYPES = new Set(['contrast', 'equivalence', 'sequence']);
const USER_LAYERS = new Set(['operator', 'ui']);
const IMPLEMENTATION_LAYERS = new Set(['code', 'database']);
const LOOKUP_LAYERS = new Set([...USER_LAYERS, ...IMPLEMENTATION_LAYERS]);
const REVIEW_STATUSES = new Set(['source-checked', 'needs-human-review', 'human-confirmed']);

function asStrings(value) {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value])
    .filter((item) => item !== undefined && item !== null)
    .map(String)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const options = { root: process.cwd(), requireAnswerability: false, json: false };
  const args = [...argv];
  while (args.length) {
    const arg = args.shift();
    if (arg === '--root') {
      const value = args.shift();
      if (!value) throw new Error('--root requires a value');
      options.root = value;
    } else if (arg === '--require-answerability') {
      options.requireAnswerability = true;
    } else if (arg === '--json') {
      options.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function readJsonl(path, errors, required = false) {
  if (!existsSync(path)) {
    if (required) errors.push(`${relative(process.cwd(), path)}: required artifact is missing`);
    return [];
  }
  const records = [];
  for (const [index, raw] of readFileSync(path, 'utf8').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const record = JSON.parse(line);
      if (!record || Array.isArray(record) || typeof record !== 'object') {
        errors.push(`${path}:${index + 1}: record must be a JSON object`);
      } else {
        records.push({ ...record, __line: index + 1 });
      }
    } catch (error) {
      errors.push(`${path}:${index + 1}: invalid JSON: ${error.message}`);
    }
  }
  if (required && !records.length) errors.push(`${path}: at least one record is required`);
  return records;
}

function uniqueById(records, field, label, path, errors) {
  const result = new Map();
  for (const record of records) {
    const id = String(record[field] || '').trim();
    if (!id) {
      errors.push(`${path}:${record.__line}: missing ${field}`);
      continue;
    }
    if (result.has(id)) {
      errors.push(`${path}:${record.__line}: duplicate ${label} ${JSON.stringify(id)}`);
      continue;
    }
    result.set(id, record);
  }
  return result;
}

function inside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function noteContentHash(root, record) {
  const notePath = String(record?.path || '').trim();
  const absolute = resolve(root, notePath);
  if (!notePath || !inside(root, absolute) || !existsSync(absolute)) return null;
  return createHash('sha256').update(readFileSync(absolute)).digest('hex');
}

function validateCatalog(root, records, path, errors) {
  const catalog = uniqueById(records, 'id', 'note id', path, errors);
  const pendingHumanReview = [];
  for (const [id, record] of catalog) {
    const notePath = String(record.path || '').trim();
    const absolute = resolve(root, notePath);
    if (!notePath) errors.push(`${path}:${record.__line}: note ${id} is missing path`);
    else if (!inside(root, absolute) || !existsSync(absolute)) {
      errors.push(`${path}:${record.__line}: note ${id} path does not resolve inside the vault`);
    }

    const relationType = String(record.relation_type || '').trim();
    const isRelation = record.type === 'relation' || relationType;
    if (isRelation) {
      if (record.type !== 'relation') {
        errors.push(`${path}:${record.__line}: relation_type requires type "relation"`);
      }
      if (!RELATION_TYPES.has(relationType)) {
        errors.push(`${path}:${record.__line}: relation note ${id} has invalid relation_type`);
      }
      const participants = asStrings(record.participants);
      if (new Set(participants).size < 2) {
        errors.push(`${path}:${record.__line}: relation note ${id} needs at least two participants`);
      }
      const evidence = record.evidence_by_participant;
      if (!evidence || Array.isArray(evidence) || typeof evidence !== 'object') {
        errors.push(`${path}:${record.__line}: relation note ${id} needs evidence_by_participant`);
      } else {
        for (const participant of participants) {
          if (!catalog.has(participant) && participant !== id) {
            errors.push(`${path}:${record.__line}: relation note ${id} references unknown participant ${participant}`);
          }
          if (!asStrings(evidence[participant]).length) {
            errors.push(`${path}:${record.__line}: relation note ${id} lacks evidence for ${participant}`);
          }
        }
      }
    }

    const layers = new Set(asStrings(record.lookup_layers));
    for (const layer of layers) {
      if (!LOOKUP_LAYERS.has(layer)) {
        errors.push(`${path}:${record.__line}: note ${id} has invalid lookup layer ${layer}`);
      }
    }
    const crossesLayers = [...layers].some((layer) => USER_LAYERS.has(layer)) &&
      [...layers].some((layer) => IMPLEMENTATION_LAYERS.has(layer));
    if (crossesLayers && !asStrings(record.user_terms).length) {
      errors.push(`${path}:${record.__line}: cross-layer note ${id} needs user_terms`);
    }
    if (crossesLayers && !asStrings(record.source_symbols).length) {
      errors.push(`${path}:${record.__line}: cross-layer note ${id} needs source_symbols`);
    }
    const vocabularyFields = ['aliases', 'user_terms', 'source_symbols'];
    const vocabularyOwners = new Map();
    for (const field of vocabularyFields) {
      for (const value of asStrings(record[field])) {
        const normalized = value.normalize('NFKC').toLocaleLowerCase();
        const prior = vocabularyOwners.get(normalized);
        if (prior && prior !== field) {
          errors.push(`${path}:${record.__line}: note ${id} repeats ${JSON.stringify(value)} across ${prior} and ${field}`);
        } else {
          vocabularyOwners.set(normalized, field);
        }
      }
    }

    if (record.review_status && !REVIEW_STATUSES.has(record.review_status)) {
      errors.push(`${path}:${record.__line}: note ${id} has invalid review_status`);
    }
    if (record.review_status === 'needs-human-review') pendingHumanReview.push(id);
    if (record.review_status === 'human-confirmed') {
      for (const field of ['reviewed_by', 'reviewed_at', 'review_evidence']) {
        if (!asStrings(record[field]).length) {
          errors.push(`${path}:${record.__line}: human-confirmed note ${id} needs ${field}`);
        }
      }
      if (record.reviewed_at && Number.isNaN(Date.parse(record.reviewed_at))) {
        errors.push(`${path}:${record.__line}: human-confirmed note ${id} has invalid reviewed_at`);
      }
    }
  }
  if (pendingHumanReview.length) {
    const reviewPath = join(root, '_knowledge', 'needs-human-review.md');
    if (!existsSync(reviewPath)) {
      errors.push(`${reviewPath}: required for notes awaiting human review`);
    } else {
      const reviewText = readFileSync(reviewPath, 'utf8');
      for (const id of pendingHumanReview) {
        if (!reviewText.includes(id)) {
          errors.push(`${reviewPath}: missing pending note ${id}`);
        }
      }
    }
  }
  return catalog;
}

function valuesCovered(required, records, field) {
  const actual = new Set(records.flatMap((record) => asStrings(record?.[field])));
  return asStrings(required).filter((value) => !actual.has(value));
}

function validateQuestions(root, questions, questionPath, results, resultPath, catalog, errors) {
  const questionMap = uniqueById(questions, 'id', 'question id', questionPath, errors);
  const resultMap = uniqueById(results, 'question_id', 'question result', resultPath, errors);
  const counts = { total: questionMap.size, complete: 0, partial: 0, unanswerable: 0 };
  const citations = { required: 0, cited: 0, on_key: 0, off_key: 0, full: 0, scored: 0 };

  for (const [id, question] of questionMap) {
    if (!String(question.question || '').trim()) {
      errors.push(`${questionPath}:${question.__line}: question ${id} is missing question text`);
    }
    if (!String(question.lookup_job || '').trim()) {
      errors.push(`${questionPath}:${question.__line}: question ${id} is missing lookup_job`);
    }
    if (!QUESTION_KINDS.has(question.kind)) {
      errors.push(`${questionPath}:${question.__line}: question ${id} has invalid kind`);
    }
    const requiredNoteIds = asStrings(question.required_note_ids);
    if (!requiredNoteIds.length) {
      errors.push(`${questionPath}:${question.__line}: question ${id} needs required_note_ids`);
    }
    for (const noteId of requiredNoteIds) {
      if (!catalog.has(noteId)) {
        errors.push(`${questionPath}:${question.__line}: question ${id} references unknown note ${noteId}`);
      }
    }

    const requiredRecords = requiredNoteIds.map((noteId) => catalog.get(noteId)).filter(Boolean);
    if (question.kind === 'comparison' && !requiredRecords.some(
      (record) => record.type === 'relation' && record.relation_type === 'contrast',
    )) {
      errors.push(`${questionPath}:${question.__line}: comparison question ${id} needs a contrast note`);
    }
    if (question.kind === 'cross-layer') {
      if (!asStrings(question.required_user_terms).length ||
          !asStrings(question.required_source_symbols).length) {
        errors.push(`${questionPath}:${question.__line}: cross-layer question ${id} needs required user terms and source symbols`);
      }
    }
    for (const [field, noteField] of [
      ['required_user_terms', 'user_terms'],
      ['required_source_symbols', 'source_symbols'],
    ]) {
      const missing = valuesCovered(question[field], requiredRecords, noteField);
      if (missing.length) {
        errors.push(`${questionPath}:${question.__line}: question ${id} required notes do not cover ${field}: ${missing.join(', ')}`);
      }
    }

    const result = resultMap.get(id);
    if (!result) {
      errors.push(`${resultPath}: missing result for question ${id}`);
      continue;
    }
    if (!COVERAGE_VALUES.has(result.coverage)) {
      errors.push(`${resultPath}:${result.__line}: question ${id} has invalid coverage`);
      continue;
    }
    counts[result.coverage] += 1;
    const citedNoteIds = new Set(asStrings(result.answer_note_ids));
    const onKey = requiredNoteIds.filter((noteId) => citedNoteIds.has(noteId)).length;
    citations.scored += 1;
    citations.required += requiredNoteIds.length;
    citations.cited += citedNoteIds.size;
    citations.on_key += onKey;
    citations.off_key += citedNoteIds.size - onKey;
    if (onKey === requiredNoteIds.length) citations.full += 1;
    if (result.coverage !== 'complete') {
      errors.push(`${resultPath}:${result.__line}: question ${id} is ${result.coverage}`);
      continue;
    }
    const answerNoteIdList = asStrings(result.answer_note_ids);
    const answerNoteIds = new Set(answerNoteIdList);
    const absent = requiredNoteIds.filter((noteId) => !answerNoteIds.has(noteId));
    if (absent.length) {
      errors.push(`${resultPath}:${result.__line}: complete result ${id} omits required notes: ${absent.join(', ')}`);
    }
    if (!asStrings(result.evidence_refs).length) {
      errors.push(`${resultPath}:${result.__line}: complete result ${id} needs evidence_refs`);
    }
    if (asStrings(result.missing).length) {
      errors.push(`${resultPath}:${result.__line}: complete result ${id} cannot contain missing items`);
    }
    if (!String(result.evaluated_at || '').trim()) {
      errors.push(`${resultPath}:${result.__line}: complete result ${id} needs evaluated_at`);
    }
    const noteHashes = result.answer_note_hashes;
    if (!noteHashes || Array.isArray(noteHashes) || typeof noteHashes !== 'object') {
      errors.push(`${resultPath}:${result.__line}: complete result ${id} needs answer_note_hashes`);
    } else {
      for (const noteId of answerNoteIdList) {
        if (!catalog.has(noteId)) {
          errors.push(`${resultPath}:${result.__line}: complete result ${id} references unknown answer note ${noteId}`);
          continue;
        }
        const expected = noteContentHash(root, catalog.get(noteId));
        if (!expected || noteHashes[noteId] !== expected) {
          errors.push(`${resultPath}:${result.__line}: complete result ${id} has stale or missing hash for ${noteId}`);
        }
      }
    }
    const answerRecords = answerNoteIdList.map((noteId) => catalog.get(noteId)).filter(Boolean);
    const allowedEvidence = new Set(answerRecords.flatMap((record) => [
      ...asStrings(record.source_refs ?? record.sources),
      ...Object.values(record.evidence_by_participant || {}).flatMap(asStrings),
    ]));
    const unsupportedEvidence = asStrings(result.evidence_refs)
      .filter((sourceRef) => !allowedEvidence.has(sourceRef));
    if (unsupportedEvidence.length) {
      errors.push(`${resultPath}:${result.__line}: complete result ${id} cites evidence absent from required notes: ${unsupportedEvidence.join(', ')}`);
    }
  }
  for (const [id, result] of resultMap) {
    if (!questionMap.has(id)) {
      errors.push(`${resultPath}:${result.__line}: result references unknown question ${id}`);
    }
  }
  return { questionMap, counts, citations };
}

function edgeId(record) {
  return String(record.id || record.edge_id || '').trim();
}

function graphNodeId(record) {
  return String(record.id || record.node_id || record.canonical_name || '').trim();
}

function validateReachability(root, questions, nodes, edges, errors) {
  const graphQuestions = [...questions.values()].filter((question) => question.graph_check === true);
  const nodesPath = join(root, '_graph', 'nodes.jsonl');
  const edgesPath = join(root, '_graph', 'edges.jsonl');
  const reachabilityPath = join(root, '_graph', 'question-reachability.jsonl');
  const graphExists = existsSync(nodesPath) || existsSync(edgesPath);
  if (!graphExists) {
    if (graphQuestions.length) {
      errors.push(`${reachabilityPath}: graph_check questions exist but graph artifacts are missing`);
    }
    return { checked: 0 };
  }
  if (!graphQuestions.length) {
    errors.push(`${reachabilityPath}: graph artifacts exist but no question has graph_check true`);
    return { checked: 0 };
  }

  const reachability = readJsonl(reachabilityPath, errors, true);
  const resultMap = uniqueById(
    reachability,
    'question_id',
    'reachability result',
    reachabilityPath,
    errors,
  );
  const nodeMap = new Map();
  for (const node of nodes) {
    const id = graphNodeId(node);
    if (!id) errors.push(`${nodesPath}:${node.__line}: graph node needs a stable id`);
    else if (nodeMap.has(id)) errors.push(`${nodesPath}:${node.__line}: duplicate graph node id ${id}`);
    else nodeMap.set(id, node);
  }
  const edgeMap = new Map();
  for (const edge of edges) {
    const id = edgeId(edge);
    if (!id) errors.push(`${edgesPath}:${edge.__line}: graph edge needs a stable id`);
    else if (edgeMap.has(id)) errors.push(`${edgesPath}:${edge.__line}: duplicate graph edge id ${id}`);
    else edgeMap.set(id, edge);
  }

  for (const question of graphQuestions) {
    const requiredNodes = asStrings(question.required_graph_node_ids);
    if (!requiredNodes.length) {
      errors.push(`question ${question.id}: graph_check requires required_graph_node_ids`);
    }
    for (const nodeId of requiredNodes) {
      if (!nodeMap.has(nodeId)) errors.push(`${nodesPath}: graph question ${question.id} references unknown node ${nodeId}`);
    }
    const result = resultMap.get(question.id);
    if (!result) {
      errors.push(`${reachabilityPath}: missing result for graph question ${question.id}`);
      continue;
    }
    if (result.reachable !== true) {
      errors.push(`${reachabilityPath}:${result.__line}: graph question ${question.id} is not reachable`);
      continue;
    }
    const answerNodes = new Set(asStrings(result.answer_node_ids));
    const absent = requiredNodes.filter((node) => !answerNodes.has(node));
    if (absent.length) {
      errors.push(`${reachabilityPath}:${result.__line}: graph question ${question.id} omits nodes: ${absent.join(', ')}`);
    }
    const maxHops = Number(result.max_hops);
    if (!Number.isInteger(maxHops) || maxHops < 0) {
      errors.push(`${reachabilityPath}:${result.__line}: graph question ${question.id} has invalid max_hops`);
    }
    const paths = Array.isArray(result.paths) ? result.paths : [];
    const pathEvidence = new Set();
    if (!paths.length) {
      errors.push(`${reachabilityPath}:${result.__line}: graph question ${question.id} needs paths`);
    }
    for (const [pathIndex, path] of paths.entries()) {
      const nodeIds = asStrings(path.node_ids);
      const edgeIds = asStrings(path.edge_ids);
      for (const nodeId of nodeIds) {
        if (!nodeMap.has(nodeId)) {
          errors.push(`${reachabilityPath}:${result.__line}: path ${pathIndex + 1} references unknown node ${nodeId}`);
        }
      }
      if (nodeIds.length !== edgeIds.length + 1) {
        errors.push(`${reachabilityPath}:${result.__line}: path ${pathIndex + 1} must have one more node than edge`);
      }
      if (Number.isInteger(maxHops) && edgeIds.length > maxHops) {
        errors.push(`${reachabilityPath}:${result.__line}: path ${pathIndex + 1} exceeds max_hops`);
      }
      for (const [edgeIndex, id] of edgeIds.entries()) {
        const edge = edgeMap.get(id);
        if (!edge) {
          errors.push(`${reachabilityPath}:${result.__line}: path references unknown edge ${id}`);
          continue;
        }
        const type = String(edge.relationship_type ?? edge.type ?? edge.relation ?? '').trim();
        if (!type || type.toLocaleUpperCase() === 'RELATED_TO') {
          errors.push(`${edgesPath}:${edge.__line}: reachability edge ${id} needs a specific relationship type`);
        }
        const edgeSourceRefs = asStrings(edge.source_refs ?? edge.sources);
        if (!edgeSourceRefs.length) {
          errors.push(`${edgesPath}:${edge.__line}: reachability edge ${id} needs source_refs`);
        }
        for (const sourceRef of edgeSourceRefs) pathEvidence.add(sourceRef);
        const source = String(edge.source_node_id ?? edge.source_id ?? edge.from ?? edge.source ?? '').trim();
        const target = String(edge.target_node_id ?? edge.target_id ?? edge.to ?? edge.target ?? '').trim();
        if (source !== nodeIds[edgeIndex] || target !== nodeIds[edgeIndex + 1]) {
          errors.push(`${reachabilityPath}:${result.__line}: path ${pathIndex + 1} does not follow edge ${id} direction`);
        }
      }
    }
    const pathNodes = new Set(paths.flatMap((path) => asStrings(path.node_ids)));
    const uncovered = requiredNodes.filter((node) => !pathNodes.has(node));
    if (uncovered.length) {
      errors.push(`${reachabilityPath}:${result.__line}: graph paths do not cover required nodes: ${uncovered.join(', ')}`);
    }
    if (!asStrings(result.evidence_refs).length) {
      errors.push(`${reachabilityPath}:${result.__line}: graph question ${question.id} needs evidence_refs`);
    }
    const unsupportedEvidence = asStrings(result.evidence_refs)
      .filter((sourceRef) => !pathEvidence.has(sourceRef));
    if (unsupportedEvidence.length) {
      errors.push(`${reachabilityPath}:${result.__line}: graph question ${question.id} cites evidence absent from its path edges: ${unsupportedEvidence.join(', ')}`);
    }
  }
  for (const [questionId, result] of resultMap) {
    if (!questions.has(questionId) || questions.get(questionId).graph_check !== true) {
      errors.push(`${reachabilityPath}:${result.__line}: reachability references non-graph question ${questionId}`);
    }
  }
  return { checked: graphQuestions.length };
}

function validateCoverage(root, counts, required, errors) {
  const path = join(root, '_knowledge', 'coverage.md');
  if (!required) return;
  if (!existsSync(path)) {
    if (required) errors.push(`${path}: required artifact is missing`);
    return;
  }
  const text = readFileSync(path, 'utf8');
  const match = /^Answerability:\s*(\d+)\/(\d+) complete;\s*(\d+) partial;\s*(\d+) unanswerable;\s*([\d.]+)%\s*$/mi.exec(text);
  if (!match) {
    errors.push(`${path}: missing canonical Answerability summary line`);
    return;
  }
  const actual = {
    complete: Number(match[1]),
    total: Number(match[2]),
    partial: Number(match[3]),
    unanswerable: Number(match[4]),
    percentage: Number(match[5]),
  };
  const expectedPercentage = counts.total ? Number(((counts.complete / counts.total) * 100).toFixed(2)) : 0;
  if (
    actual.complete !== counts.complete || actual.total !== counts.total ||
    actual.partial !== counts.partial || actual.unanswerable !== counts.unanswerable ||
    actual.percentage !== expectedPercentage
  ) {
    errors.push(`${path}: Answerability summary does not match question results`);
  }
}

function citationRates(citations) {
  return {
    ...citations,
    recall: citations.required ? Number((citations.on_key / citations.required).toFixed(4)) : 0,
    precision: citations.cited ? Number((citations.on_key / citations.cited).toFixed(4)) : 0,
  };
}

// Citation precision is reported, never gated. An answer that cites a note outside
// required_note_ids is usually supporting context, not an error - but without the number,
// any change that makes answers cite more notes wins on recall by construction.
function validateCitations(root, citations, errors) {
  const path = join(root, '_knowledge', 'coverage.md');
  if (!existsSync(path)) return;
  const match = /^Citations:\s*recall\s*(\d+)\/(\d+);\s*precision\s*(\d+)\/(\d+);\s*off-key\s*(\d+);\s*full\s*(\d+)\/(\d+)\s*$/mi
    .exec(readFileSync(path, 'utf8'));
  if (!match) return;
  const stated = match.slice(1).map(Number);
  const actual = [
    citations.on_key, citations.required,
    citations.on_key, citations.cited,
    citations.off_key, citations.full, citations.scored,
  ];
  if (stated.some((value, index) => value !== actual[index])) {
    errors.push(`${path}: Citations summary does not match question results`);
  }
}

function validateKnowledge(inputRoot, options = {}) {
  const root = resolve(inputRoot);
  const errors = [];
  const warnings = [];
  const catalogPath = join(root, '_knowledge', 'catalog.jsonl');
  const questionPath = join(root, '_knowledge', 'questions.jsonl');
  const resultPath = join(root, '_knowledge', 'question-results.jsonl');
  const requireAnswerability = options.requireAnswerability === true;
  const catalogRecords = readJsonl(catalogPath, errors, requireAnswerability);
  const catalog = validateCatalog(root, catalogRecords, catalogPath, errors);
  const questions = readJsonl(questionPath, errors, requireAnswerability);
  const results = readJsonl(resultPath, errors, requireAnswerability);
  const { questionMap, counts, citations } = validateQuestions(
    root,
    questions,
    questionPath,
    results,
    resultPath,
    catalog,
    errors,
  );
  const nodes = readJsonl(join(root, '_graph', 'nodes.jsonl'), errors, false);
  const edges = readJsonl(join(root, '_graph', 'edges.jsonl'), errors, false);
  const graph = validateReachability(root, questionMap, nodes, edges, errors);
  validateCoverage(root, counts, requireAnswerability || questionMap.size > 0, errors);
  validateCitations(root, citations, errors);
  if (!requireAnswerability && !questions.length) {
    warnings.push('answerability artifacts were not required and no competency questions were checked');
  }
  return {
    ok: errors.length === 0,
    root,
    counts: { notes: catalog.size, questions: counts, graph_questions: graph.checked },
    citations: citationRates(citations),
    errors,
    warnings,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = validateKnowledge(options.root, options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const q = result.counts.questions;
    process.stdout.write(
      `Knowledge answerability: ${q.complete}/${q.total} complete; ` +
      `${q.partial} partial; ${q.unanswerable} unanswerable\n`,
    );
    const c = result.citations;
    if (c.scored) {
      process.stdout.write(
        `Citations: recall ${c.on_key}/${c.required} (${c.recall}); ` +
        `precision ${c.on_key}/${c.cited} (${c.precision}); ` +
        `off-key ${c.off_key}; full ${c.full}/${c.scored}\n`,
      );
    }
    for (const warning of result.warnings) process.stdout.write(`WARN: ${warning}\n`);
    for (const error of result.errors) process.stderr.write(`ERROR: ${error}\n`);
    process.stdout.write(result.ok ? 'PASSED — knowledge contract is valid\n' : 'FAILED — knowledge contract violations found\n');
  }
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

export { parseArgs, validateKnowledge };
