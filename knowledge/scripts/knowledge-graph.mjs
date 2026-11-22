#!/usr/bin/env node
// Graph build: an OpenAI-compatible chat model reads each catalog note and
// proposes entities and relations; the engine keeps only edges that pass the
// graph-builder rules, writes _graph/*.jsonl atomically, computes question
// reachability, and rebuilds the sqlite index.
//
// The model is optional. Without an endpoint the command says so and changes
// nothing; the graph-builder skill path is the same as before.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTerm, slugify } from './knowledge-capture.mjs';
import { loadStoreConfig } from './knowledge-config.mjs';
import { consumeQueue, readQueue } from './knowledge-jobs.mjs';
import { findKnowledgeRoot, inside } from './knowledge-paths.mjs';
import { PROBE_FILE, chooseModel, probeHardware, writeProbe } from './knowledge-probe.mjs';

export const DEFAULT_WEAK_TYPES = ['RELATED_TO', 'RELATES_TO', 'ASSOCIATED_WITH', 'LINKED_TO', 'USES', 'HAS', 'CONNECTED_TO', 'IS_RELATED_TO'];
const TYPE_FORMAT = /^[A-Z][A-Z0-9_]*$/;

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${path}:${index + 1}: ${error.message}`);
    }
  });
}

function jsonl(records) {
  return records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '');
}

const squash = (text) => String(text || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

// Active voice only: one direction per fact, so a passive inverse cannot double an edge.
export const DEFAULT_RELATION_TYPES = [
  'DEPENDS_ON', 'CALLS', 'READS', 'WRITES', 'STORES', 'RETURNS', 'PRODUCES', 'CONSUMES',
  'IMPLEMENTS', 'EXTENDS', 'CONFIGURES', 'CONTAINS', 'PART_OF', 'INSTANCE_OF', 'ALIAS_OF', 'OWNS',
  'MEMBER_OF', 'WORKS_ON', 'SUPERSEDES', 'REPLACES', 'CAUSES', 'PREFERS',
];

export function graphConfig(storeConfig) {
  const graph = storeConfig.graph && typeof storeConfig.graph === 'object' ? storeConfig.graph : {};
  const configured = Array.isArray(graph.relation_types) ? graph.relation_types.map(String) : [];
  return {
    ontology: configured.length > 0,
    relation_types: configured.length ? configured : DEFAULT_RELATION_TYPES,
    max_name_chars: Number.isInteger(graph.max_name_chars) && graph.max_name_chars > 0 ? graph.max_name_chars : 40,
    symmetric: Array.isArray(graph.symmetric) ? graph.symmetric.map(String) : [],
    weak_types: Array.isArray(graph.weak_types) ? graph.weak_types.map(String) : DEFAULT_WEAK_TYPES,
    max_hops: Number.isInteger(graph.max_hops) ? graph.max_hops : 3,
    max_note_chars: Number.isInteger(graph.max_note_chars) ? graph.max_note_chars : 6000,
  };
}

const KO_VERBAL = /(고|며|면서|는데|지만|었다|했다|한다|이다|니다|어요|아요|해요)$/;
const KO_FINAL = /(했다|한다|었다|이다|니다|어요|아요|해요)$/;
const EN_AUX = /\b(is|are|was|were|has|have|had|does|did|will|should|must|can)\b/i;

// Reasons a node name is refused: a clause or a sentence is not an entity.
export function nameProblems(name, config) {
  const text = typeof name === 'string' ? name.trim() : '';
  if (!text) return [];
  const problems = [];
  if ([...text].length > config.max_name_chars) problems.push('name-too-long');
  const words = text.split(/\s+/);
  const sentence = /[!?。]$/.test(text)
    || (/\.$/.test(text) && words.length > 3)
    || /[,;] /.test(text)
    || words.length > 6
    || (words.length >= 3 && words.filter((w) => KO_VERBAL.test(w)).length >= 2)
    || (words.length >= 2 && KO_FINAL.test(words[words.length - 1]))
    || (words.length >= 5 && EN_AUX.test(text));
  if (sentence) problems.push('name-is-sentence');
  return problems;
}

export function normalizeType(value) {
  return String(value || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
}

/**
 * Check proposed edges against the graph-builder rules.
 * edges: [{ source, target, type, evidence, source_refs }] with node ids.
 * sourceText(path) returns the file text an edge cites, or null.
 * Returns { accepted, rejected: [{ edge, reasons }] }.
 */
export function validateEdges(edges, { nodeIds, sourceText, config }) {
  const weak = new Set(config.weak_types.map(normalizeType));
  weak.add('RELATED_TO');
  const allowed = new Set(config.relation_types.map(normalizeType));
  const typeReason = config.ontology ? 'not-in-ontology' : 'unknown-type';
  const symmetric = new Set(config.symmetric.map(normalizeType));
  const accepted = [];
  const rejected = [];
  const byKey = new Map();
  for (const raw of edges) {
    const edge = { ...raw, type: normalizeType(raw.type) };
    const reasons = [];
    const refs = Array.isArray(edge.source_refs) ? edge.source_refs.filter(Boolean) : [];
    for (const end of ['source', 'target']) {
      if (edge[end] && nodeIds.has(edge[end])) continue;
      const bad = nameProblems(edge.proposed?.[end], config);
      for (const reason of bad.length ? bad : [`unknown-${end}-node`]) if (!reasons.includes(reason)) reasons.push(reason);
    }
    if (edge.source && edge.source === edge.target) reasons.push('self-loop');
    if (!TYPE_FORMAT.test(edge.type)) reasons.push('bad-type-format');
    else if (weak.has(edge.type)) reasons.push('vague-type');
    else if (!allowed.has(edge.type)) reasons.push(typeReason);
    if (!refs.length) reasons.push('missing-source-refs');
    if (!String(edge.evidence || '').trim()) reasons.push('missing-evidence');
    else if (refs.length && !refs.some((ref) => squash(sourceText(ref)).includes(squash(edge.evidence)))) {
      reasons.push('evidence-not-in-source');
    }
    if (!reasons.length) {
      const key = `${edge.source}\u0000${edge.type}\u0000${edge.target}`;
      const reverse = `${edge.target}\u0000${edge.type}\u0000${edge.source}`;
      if (byKey.has(key)) {
        const kept = byKey.get(key);
        kept.source_refs = [...new Set([...kept.source_refs, ...refs])];
        continue;
      }
      if (byKey.has(reverse) && !symmetric.has(edge.type)) reasons.push('reversed-duplicate');
    }
    if (reasons.length) {
      rejected.push({ edge: raw, reasons });
      continue;
    }
    const record = {
      id: `e-${createHash('sha1').update(`${edge.source}|${edge.type}|${edge.target}`).digest('hex').slice(0, 12)}`,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      evidence: String(edge.evidence).trim(),
      source_refs: refs,
      confidence: edge.confidence ?? 'extracted',
    };
    byKey.set(`${edge.source}\u0000${edge.type}\u0000${edge.target}`, record);
    accepted.push(record);
  }
  return { accepted, rejected };
}

// Directed BFS within maxHops; returns { node_ids, edge_ids } or null.
function shortestPath(adjacency, from, to, maxHops) {
  if (from === to) return { node_ids: [from], edge_ids: [] };
  const seen = new Set([from]);
  let frontier = [{ node: from, nodes: [from], edges: [] }];
  for (let hop = 0; hop < maxHops && frontier.length; hop += 1) {
    const next = [];
    for (const step of frontier) {
      for (const edge of adjacency.get(step.node) || []) {
        if (seen.has(edge.target)) continue;
        const path = { node: edge.target, nodes: [...step.nodes, edge.target], edges: [...step.edges, edge.id] };
        if (edge.target === to) return { node_ids: path.nodes, edge_ids: path.edges };
        seen.add(edge.target);
        next.push(path);
      }
    }
    frontier = next;
  }
  return null;
}

// One result per graph_check question, in the shape validate-knowledge checks.
export function questionReachability(questions, nodes, edges, defaultMaxHops = 3) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const adjacency = new Map();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    adjacency.get(edge.source).push(edge);
  }
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const results = [];
  for (const question of questions.filter((q) => q.graph_check === true)) {
    const required = (question.required_graph_node_ids || []).map(String);
    const maxHops = Number.isInteger(question.max_hops) ? question.max_hops : defaultMaxHops;
    const missing = required.filter((id) => !nodeIds.has(id));
    const paths = [];
    let reachable = required.length > 0 && !missing.length;
    const [anchor, ...rest] = required;
    for (const other of rest) {
      if (!reachable) break;
      const path = shortestPath(adjacency, anchor, other, maxHops) || shortestPath(adjacency, other, anchor, maxHops);
      if (!path) reachable = false;
      else paths.push(path);
    }
    if (reachable && required.length === 1) paths.push({ node_ids: [anchor], edge_ids: [] });
    const evidence = [...new Set(paths.flatMap((path) => path.edge_ids.flatMap((id) => edgeById.get(id)?.source_refs || [])))];
    results.push({
      question_id: question.id,
      reachable,
      answer_node_ids: reachable ? required : [],
      max_hops: maxHops,
      paths: reachable ? paths : [],
      evidence_refs: evidence,
      ...(missing.length ? { missing_nodes: missing } : {}),
    });
  }
  return results;
}

function chatUrl(base) {
  const url = base.replace(/\/+$/, '');
  return url.endsWith('/v1') ? `${url}/chat/completions` : `${url}/v1/chat/completions`;
}

export function parseModelJson(text) {
  const body = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('model reply has no JSON object');
  return JSON.parse(body.slice(start, end + 1));
}

export function openAiCompatibleChat({ url, model, apiKey, timeoutMs = 300000, fetchImpl = fetch }) {
  return async (messages) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(chatUrl(url), {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, messages, temperature: 0, response_format: { type: 'json_object' } }),
      });
      if (!response.ok) throw new Error(`chat endpoint ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const payload = await response.json();
      return payload.choices?.[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timer);
    }
  };
}

// The prompt names the rules validateEdges and nameProblems hold the reply to.
export function systemPrompt(config) {
  return [
    'You extract a knowledge graph from one note. Reply with one JSON object and nothing else:',
    '{"entities":[{"name":"...","type":"PascalCaseClass","aliases":["..."]}],',
    ' "relations":[{"source":"entity name","target":"entity name","type":"UPPER_SNAKE_VERB","evidence":"a sentence copied exactly from the note"}]}',
    'Rules: every relation needs evidence copied word for word from the note. Use only these relation types:',
    `${config.relation_types.join(', ')}; never RELATED_TO, USES or HAS.`,
    `Entity names are short noun phrases, at most ${config.max_name_chars} characters, never a clause or a sentence.`,
    'Prefer the known entity names given below when the note means the same thing. Skip anything the note does not state.',
  ].join('\n');
}

function notePrompt(entry, text, knownNames, maxChars) {
  const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}\n[...]` : text;
  return `Known entities: ${knownNames.slice(0, 200).join('; ') || '(none)'}\n\nNote "${entry.title || entry.id}" (${entry.path}):\n\n${clipped}`;
}

function cleanLabel(value) {
  const label = String(value || '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
  return label || 'Entity';
}

/**
 * Extract nodes and candidate edges from every catalog note.
 * chat(messages) -> reply text. Notes are read once; replies that are not JSON
 * are counted as failed notes, never guessed at.
 */
export async function extractGraph(root, { chat, config, log = () => {}, limit = Infinity, only = null, deleted = new Set(), base = null }) {
  const catalog = readJsonl(join(root, '_knowledge', 'catalog.jsonl')).filter((entry) => entry.id && entry.path);
  const nameToId = new Map();
  // Model-given names refused by nameProblems; catalog and base-graph names never come here.
  const refusedNames = new Map();
  const refuse = (key, reasons) => {
    if (!refusedNames.has(key)) refusedNames.set(key, reasons);
  };
  const nodes = new Map();
  for (const entry of catalog) {
    for (const term of [entry.id, entry.title, ...(entry.aliases || [])]) if (term) nameToId.set(normalizeTerm(term), entry.id);
    if (deleted.has(entry.path)) continue;
    nodes.set(entry.id, { id: entry.id, canonical_name: entry.title || entry.id, label: cleanLabel(entry.type || 'Note'), aliases: entry.aliases || [], note_path: entry.path });
  }
  // Incremental: the entity nodes of the existing graph stay resolvable by name.
  for (const node of base?.nodes || []) {
    if (nodes.has(node.id) || node.note_path) continue;
    nodes.set(node.id, node);
    for (const term of [node.canonical_name, ...(node.aliases || [])]) if (term && !nameToId.has(normalizeTerm(term))) nameToId.set(normalizeTerm(term), node.id);
  }
  const knownNames = catalog.map((entry) => entry.title).filter(Boolean);
  const texts = new Map();
  const candidates = [];
  const failed = [];
  const done = new Set();
  const touched = new Map();
  let processed = 0;
  for (const entry of catalog) {
    if (processed >= limit) break;
    if (only && !only.has(entry.path)) continue;
    const abs = join(root, entry.path);
    if (!inside(root, abs) || !existsSync(abs)) {
      failed.push({ path: entry.path, reason: 'missing-file' });
      continue;
    }
    processed += 1;
    const text = readFileSync(abs, 'utf8');
    texts.set(entry.path, text);
    log(`[${processed}/${Math.min(catalog.length, limit)}] ${entry.path}`);
    let reply;
    try {
      reply = parseModelJson(await chat([
        { role: 'system', content: systemPrompt(config) },
        { role: 'user', content: notePrompt(entry, text, knownNames, config.max_note_chars) },
      ]));
    } catch (error) {
      failed.push({ path: entry.path, reason: error.name === 'AbortError' ? 'timeout' : error.message.slice(0, 200) });
      continue;
    }
    done.add(entry.path);
    const touch = (id) => {
      if (!touched.has(id)) touched.set(id, new Set());
      touched.get(id).add(entry.path);
    };
    const localIds = new Map();
    for (const entity of Array.isArray(reply.entities) ? reply.entities : []) {
      const name = String(entity?.name || '').trim();
      if (!name) continue;
      const key = normalizeTerm(name);
      let id = nameToId.get(key);
      if (!id) {
        const problems = nameProblems(name, config);
        if (problems.length) {
          refuse(key, problems);
          continue;
        }
        id = `n-${slugify(name)}`;
        nameToId.set(key, id);
      }
      for (const alias of Array.isArray(entity.aliases) ? entity.aliases : []) {
        if (typeof alias === 'string' && alias.trim() && !nameToId.has(normalizeTerm(alias))) nameToId.set(normalizeTerm(alias), id);
      }
      localIds.set(key, id);
      touch(id);
      if (!nodes.has(id)) {
        nodes.set(id, { id, canonical_name: name, label: cleanLabel(entity.type), aliases: (entity.aliases || []).filter((a) => typeof a === 'string'), source_refs: [entry.path] });
      }
    }
    for (const relation of Array.isArray(reply.relations) ? reply.relations : []) {
      // An endpoint the model did not list as an entity still becomes a node
      // when the note itself names it; anything else stays unknown and is refused.
      const resolveName = (name) => {
        const key = normalizeTerm(name);
        const known = localIds.get(key) || nameToId.get(key);
        if (known) touch(known);
        if (known || !key) return known || null;
        const problems = nameProblems(String(name), config);
        if (problems.length) {
          refuse(key, problems);
          return null;
        }
        if (!normalizeTerm(text).includes(key)) return null;
        const id = `n-${slugify(String(name).trim())}`;
        nameToId.set(key, id);
        localIds.set(key, id);
        touch(id);
        if (!nodes.has(id)) nodes.set(id, { id, canonical_name: String(name).trim(), label: 'Entity', aliases: [], source_refs: [entry.path] });
        return id;
      };
      candidates.push({
        source: resolveName(relation?.source),
        target: resolveName(relation?.target),
        type: relation?.type,
        evidence: relation?.evidence,
        source_refs: [entry.path],
        proposed: { source: relation?.source ?? null, target: relation?.target ?? null },
      });
    }
  }
  const sourceText = (path) => {
    if (texts.has(path)) return texts.get(path);
    const abs = join(root, path);
    return inside(root, abs) && existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  };
  const { accepted, rejected } = validateEdges(candidates, { nodeIds: new Set(nodes.keys()), sourceText, config });
  const rejectedNodes = {};
  for (const reasons of refusedNames.values()) for (const reason of reasons) rejectedNodes[reason] = (rejectedNodes[reason] || 0) + 1;
  const counts = { rejected_nodes: refusedNames.size, rejected_nodes_by_reason: rejectedNodes };
  if (!base) return { nodes: [...nodes.values()], edges: accepted, rejected, failed, processed, done: [...done], ...counts };
  return { ...mergeIncremental({ base, nodes, accepted, rejected, touched, replaced: new Set([...done, ...deleted]) }), failed, processed, done: [...done], ...counts };
}

// Replace what the re-extracted (and deleted) notes contributed: their edges,
// their claim on entity nodes, their rejected edges. Everything else is kept as
// it was; an entity node a kept edge still uses is never dropped.
function mergeIncremental({ base, nodes, accepted, rejected, touched, replaced }) {
  const edges = new Map();
  for (const edge of base.edges) {
    const refs = (edge.source_refs || []).filter((ref) => !replaced.has(ref));
    if (!refs.length) continue;
    // An edge kept from another note still loses an endpoint whose note was deleted.
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    edges.set(`${edge.source}\u0000${edge.type}\u0000${edge.target}`, refs.length === (edge.source_refs || []).length ? edge : { ...edge, source_refs: refs });
  }
  for (const edge of accepted) {
    const key = `${edge.source}\u0000${edge.type}\u0000${edge.target}`;
    const kept = edges.get(key);
    if (kept) edges.set(key, { ...kept, source_refs: [...new Set([...kept.source_refs, ...edge.source_refs])] });
    else edges.set(key, edge);
  }
  const used = new Set([...edges.values()].flatMap((edge) => [edge.source, edge.target]));
  const merged = [];
  for (const node of nodes.values()) {
    if (node.note_path) {
      merged.push(node);
      continue;
    }
    const refs = [...new Set([...(node.source_refs || []).filter((ref) => !replaced.has(ref)), ...(touched.get(node.id) || [])])];
    if (!refs.length && !used.has(node.id)) continue;
    merged.push(refs.length ? { ...node, source_refs: refs } : node);
  }
  const keptRejected = (base.rejected || []).filter((item) => !(item.edge?.source_refs || []).some((ref) => replaced.has(ref)));
  return { nodes: merged, edges: [...edges.values()], rejected: [...keptRejected, ...rejected] };
}

// Write every _graph file into a temp dir, then rename into place, so a run
// that fails before this point leaves _graph exactly as it was.
export function writeGraph(root, { nodes, edges, rejected, reachability }) {
  const graphDir = join(root, '_graph');
  const temp = join(root, '.knowledge', `graph-build-${process.pid}`);
  rmSync(temp, { recursive: true, force: true });
  mkdirSync(temp, { recursive: true });
  const files = {
    'nodes.jsonl': jsonl(nodes),
    'edges.jsonl': jsonl(edges),
    'rejected-edges.jsonl': jsonl(rejected),
    'question-reachability.jsonl': jsonl(reachability),
  };
  for (const [name, text] of Object.entries(files)) writeFileSync(join(temp, name), text);
  mkdirSync(graphDir, { recursive: true });
  // The previous graph (hand-built by the skill, or an earlier run) is kept
  // once, so a full rebuild never silently loses it.
  const previous = join(root, '.knowledge', 'graph-previous');
  rmSync(previous, { recursive: true, force: true });
  for (const name of Object.keys(files)) {
    if (!existsSync(join(graphDir, name))) continue;
    mkdirSync(previous, { recursive: true });
    renameSync(join(graphDir, name), join(previous, name));
  }
  for (const name of Object.keys(files)) renameSync(join(temp, name), join(graphDir, name));
  rmSync(temp, { recursive: true, force: true });
  return Object.keys(files).map((name) => `_graph/${name}`);
}

export function endpointFrom(storeConfig, env = process.env) {
  const llm = storeConfig.llm && typeof storeConfig.llm === 'object' ? storeConfig.llm : {};
  return {
    url: env.KNOWLEDGE_LLM_URL || llm.url || null,
    apiKey: env.KNOWLEDGE_LLM_API_KEY || null,
    timeoutMs: Number(env.KNOWLEDGE_LLM_TIMEOUT_MS) || llm.timeout_ms || 300000,
    llm,
  };
}

// Ollama only (KNOWLEDGE_LLM_PULL=1): the OpenAI-compatible API cannot fetch a
// model, so ask ollama's own /api/pull for the one the probe picked.
export async function pullOllamaModel(url, model, log = () => {}, fetchImpl = fetch) {
  const base = url.replace(/\/+$/, '').replace(/\/v1$/, '');
  log(`pulling ${model} from ${base}`);
  const response = await fetchImpl(`${base}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: false }),
  });
  if (!response.ok) throw new Error(`model pull ${model} failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
}

function readProbe(root) {
  const path = join(root, PROBE_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export async function buildGraph(inputRoot, options = {}) {
  const root = findKnowledgeRoot(inputRoot);
  const storeConfig = loadStoreConfig(root);
  const endpoint = endpointFrom(storeConfig, options.env || process.env);
  if (!endpoint.url && !options.chat) {
    return {
      root,
      status: 'no-endpoint',
      message: 'No LLM endpoint configured (KNOWLEDGE_LLM_URL or llm.url in _knowledge/config.json); _graph was not changed. Without one, build the graph with the graph-builder skill.',
    };
  }
  const nodesPath = join(root, '_graph', 'nodes.jsonl');
  const edgesPath = join(root, '_graph', 'edges.jsonl');
  const incremental = options.full !== true && existsSync(nodesPath) && existsSync(edgesPath);
  const queueLines = readQueue(root, 'graph');
  const queued = new Map();
  for (const line of queueLines) {
    let file = null;
    try {
      file = JSON.parse(line)?.file;
    } catch {
      // an unreadable line names no note; it is consumed with the rest
    }
    if (typeof file !== 'string' || !file) continue;
    queued.set(line, isAbsolute(file) ? relative(root, file) : file.replace(/^\.\//, ''));
  }
  const queuedFiles = new Set(queued.values());
  if (incremental && !queuedFiles.size) {
    consumeQueue(root, 'graph', queueLines);
    return {
      root,
      status: 'up-to-date',
      mode: 'incremental',
      notes_queued: 0,
      notes_deleted: 0,
      queue_remaining: readQueue(root, 'graph').length,
      nodes: readJsonl(nodesPath).length,
      edges: readJsonl(edgesPath).length,
      message: 'The graph update queue is empty; _graph was not changed.',
    };
  }
  const deleted = new Set(incremental ? [...queuedFiles].filter((file) => !existsSync(join(root, file))) : []);
  const only = incremental ? new Set([...queuedFiles].filter((file) => !deleted.has(file))) : null;
  const base = incremental ? { nodes: readJsonl(nodesPath), edges: readJsonl(edgesPath), rejected: readJsonl(join(root, '_graph', 'rejected-edges.jsonl')) } : null;
  const probe = readProbe(root);
  const facts = probe ? { gpu: probe.gpu, ram_mb: probe.ram_mb, ram_available_mb: probe.ram_available_mb, cores: probe.cores } : probeHardware(options.probeSources);
  const choice = chooseModel(facts, endpoint.llm, options.env || process.env);
  if (!probe || probe.model !== choice.model) writeProbe(root, facts, choice);
  if (!options.chat && (options.env || process.env).KNOWLEDGE_LLM_PULL === '1') {
    await pullOllamaModel(endpoint.url, choice.model, options.log);
  }
  const chat = options.chat || openAiCompatibleChat({ url: endpoint.url, model: choice.model, apiKey: endpoint.apiKey, timeoutMs: endpoint.timeoutMs });
  const config = graphConfig(storeConfig);
  const started = Date.now();
  const extracted = await extractGraph(root, { chat, config, log: options.log, limit: options.limit ?? Infinity, only, deleted, base });
  if (extracted.processed && extracted.failed.length === extracted.processed && !deleted.size) {
    throw new Error(`every note failed extraction (${extracted.failed[0]?.reason}); _graph was not changed`);
  }
  const questions = readJsonl(join(root, '_knowledge', 'questions.jsonl'));
  const reachability = questionReachability(questions, extracted.nodes, extracted.edges, config.max_hops);
  const written = writeGraph(root, { ...extracted, reachability });
  // Only now, with _graph on disk, do queue entries go. A note that failed stays
  // queued for the next run; so does anything a --limit run never reached.
  const failedPaths = new Set(extracted.failed.map((item) => item.path));
  if (incremental || options.limit === undefined) {
    consumeQueue(root, 'graph', queueLines.filter((line) => !failedPaths.has(queued.get(line))));
  }
  const rejectedByReason = {};
  for (const item of extracted.rejected) for (const reason of item.reasons) rejectedByReason[reason] = (rejectedByReason[reason] || 0) + 1;
  let index = null;
  if (options.index !== false) {
    const { buildIndex } = await import('./sqlite-knowledge.mjs');
    index = await buildIndex(root, options.indexOptions || {});
  }
  return {
    root,
    status: 'built',
    mode: incremental ? 'incremental' : 'full',
    notes_queued: queuedFiles.size,
    notes_deleted: deleted.size,
    queue_remaining: readQueue(root, 'graph').length,
    model: choice,
    notes_processed: extracted.processed,
    notes_failed: extracted.failed,
    nodes: extracted.nodes.length,
    edges: extracted.edges.length,
    rejected_edges: extracted.rejected.length,
    rejected_by_reason: rejectedByReason,
    rejected_nodes: extracted.rejected_nodes,
    rejected_nodes_by_reason: extracted.rejected_nodes_by_reason,
    reachability: reachability.map((r) => ({ question_id: r.question_id, reachable: r.reachable, ...(r.missing_nodes ? { missing_nodes: r.missing_nodes } : {}) })),
    written,
    seconds: Math.round((Date.now() - started) / 1000),
    index: index ? { database: index.database, documents: index.documents } : null,
  };
}

function parseArgs(argv) {
  const [command = 'build', ...rest] = argv;
  const options = { root: process.cwd(), index: true };
  while (rest.length) {
    const arg = rest.shift();
    if (arg === '--root') options.root = rest.shift();
    else if (arg === '--no-index') options.index = false;
    else if (arg === '--full') options.full = true;
    else if (arg === '--limit') options.limit = Number(rest.shift());
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['build', 'probe'].includes(command)) throw new Error(`Unknown command: ${command} (build | probe)`);
  return { command, ...options };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'probe') {
    const root = findKnowledgeRoot(args.root);
    const facts = probeHardware();
    const choice = chooseModel(facts, endpointFrom(loadStoreConfig(root)).llm);
    const { path, record } = writeProbe(root, facts, choice);
    process.stdout.write(`${JSON.stringify({ path, ...record }, null, 2)}\n`);
    return;
  }
  const result = await buildGraph(resolve(args.root), {
    index: args.index,
    limit: args.limit,
    full: args.full,
    log: (line) => process.stderr.write(`${line}\n`),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === 'no-endpoint') process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
