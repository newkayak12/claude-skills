import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  buildGraph,
  graphConfig,
  openAiCompatibleChat,
  parseModelJson,
  questionReachability,
  validateEdges,
} from './knowledge-graph.mjs';
import { chooseModel, pickTier, probeHardware } from './knowledge-probe.mjs';
import { validateKnowledge } from './validate-knowledge.mjs';

const GB = 1024 * 1024 * 1024;

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-graph-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function put(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function treeHash(dir) {
  const hash = createHash('sha1');
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d).sort()) {
      const abs = join(d, name);
      hash.update(abs);
      try {
        hash.update(readFileSync(abs));
      } catch {
        walk(abs);
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

test('probe: CPU-only 13 GB is small; 16 GB RAM or 8 GB VRAM is medium; 16 GB VRAM is large; no nvidia-smi is no GPU', () => {
  const facts = (ram, smi) => probeHardware({ nvidiaSmi: () => smi, totalMem: ram * GB, freeMem: 5 * GB, cores: 12 });
  assert.equal(pickTier(facts(13, null)), 'small');
  assert.equal(pickTier(facts(16, null)), 'medium');
  assert.equal(pickTier(facts(13, '8192\n')), 'medium');
  assert.equal(pickTier(facts(13, '16384\n8192\n')), 'large');
  assert.deepEqual(facts(13, null).gpu, { present: false, vendor: null, vram_mb: 0 });
  assert.equal(facts(13, null).cores, 12);
});

test('model choice: env model > env tier > config model > config tier > probe', () => {
  const facts = probeHardware({ nvidiaSmi: () => null, totalMem: 13 * GB, freeMem: 5 * GB, cores: 4 });
  assert.deepEqual(chooseModel(facts, {}, {}), { tier: 'small', model: 'qwen2.5:3b', source: 'probe' });
  assert.deepEqual(chooseModel(facts, { tier: 'medium' }, {}), { tier: 'medium', model: 'qwen2.5:7b', source: 'config' });
  assert.deepEqual(chooseModel(facts, { model: 'm1' }, { KNOWLEDGE_LLM_TIER: 'large' }), { tier: 'large', model: 'qwen2.5:14b', source: 'env' });
  assert.equal(chooseModel(facts, { models: { small: 'gemma3:4b' } }, {}).model, 'gemma3:4b');
  assert.equal(chooseModel(facts, {}, { KNOWLEDGE_LLM_MODEL: 'x', KNOWLEDGE_LLM_TIER: 'small' }).model, 'x');
  assert.throws(() => chooseModel(facts, {}, { KNOWLEDGE_LLM_TIER: 'huge' }), /KNOWLEDGE_LLM_TIER/);
});

test('edges: each graph-builder rule rejects with its reason', () => {
  const text = 'The Order Service depends on the Payments DB.';
  const nodeIds = new Set(['order', 'payments', 'cache']);
  const ok = { source: 'order', target: 'payments', type: 'depends on', evidence: 'order service depends on the payments db', source_refs: ['notes/a.md'] };
  const edges = [
    ok,
    { ...ok, source_refs: ['notes/b.md'] },
    { ...ok, type: 'related_to' },
    { ...ok, type: 'USES' },
    { ...ok, evidence: '' },
    { ...ok, evidence: 'the cache stores sessions' },
    { ...ok, source_refs: [] },
    { ...ok, target: 'ghost' },
    { ...ok, target: 'order' },
    { ...ok, source: 'payments', target: 'order' },
    { ...ok, type: '관계' },
  ];
  const { accepted, rejected } = validateEdges(edges, {
    nodeIds,
    sourceText: (path) => (path === 'notes/a.md' || path === 'notes/b.md' ? text : null),
    config: graphConfig({}),
  });
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].type, 'DEPENDS_ON');
  assert.deepEqual(accepted[0].source_refs, ['notes/a.md', 'notes/b.md']);
  assert.deepEqual(rejected.map((r) => r.reasons), [
    ['vague-type'],
    ['vague-type'],
    ['missing-evidence'],
    ['evidence-not-in-source'],
    ['missing-source-refs'],
    ['unknown-target-node'],
    ['self-loop'],
    ['reversed-duplicate'],
    ['bad-type-format'],
  ]);
});

test('edges: an ontology allow-list rejects other types; a symmetric type may go both ways', () => {
  const config = graphConfig({ graph: { relation_types: ['DEPENDS_ON', 'PEER_OF'], symmetric: ['PEER_OF'] } });
  const base = { evidence: 'x', source_refs: ['n.md'] };
  const { accepted, rejected } = validateEdges([
    { ...base, source: 'a', target: 'b', type: 'OWNS' },
    { ...base, source: 'a', target: 'b', type: 'PEER_OF' },
    { ...base, source: 'b', target: 'a', type: 'PEER_OF' },
  ], { nodeIds: new Set(['a', 'b']), sourceText: () => 'x', config });
  assert.deepEqual(rejected.map((r) => r.reasons), [['not-in-ontology']]);
  assert.equal(accepted.length, 2);
});

test('reachability: bounded directed paths in the shape validate-knowledge reads', () => {
  const nodes = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const edges = [
    { id: 'e1', source: 'a', target: 'b', source_refs: ['n1.md'] },
    { id: 'e2', source: 'b', target: 'c', source_refs: ['n2.md'] },
  ];
  const [ok, far, missing] = questionReachability([
    { id: 'q1', graph_check: true, required_graph_node_ids: ['a', 'c'] },
    { id: 'q2', graph_check: true, required_graph_node_ids: ['a', 'c'], max_hops: 1 },
    { id: 'q3', graph_check: true, required_graph_node_ids: ['a', 'zz'] },
    { id: 'q4', graph_check: false },
  ], nodes, edges);
  assert.deepEqual(ok.paths, [{ node_ids: ['a', 'b', 'c'], edge_ids: ['e1', 'e2'] }]);
  assert.deepEqual(ok.evidence_refs, ['n1.md', 'n2.md']);
  assert.equal(far.reachable, false);
  assert.deepEqual(missing.missing_nodes, ['zz']);
});

test('model replies: fenced JSON parses; prose without JSON fails', () => {
  assert.deepEqual(parseModelJson('```json\n{"entities":[]}\n```'), { entities: [] });
  assert.throws(() => parseModelJson('I cannot help'), /no JSON/);
});

test('chat client posts an OpenAI-compatible request', async () => {
  let seen;
  const chat = openAiCompatibleChat({
    url: 'http://llm.test:11434/v1/',
    model: 'm',
    apiKey: 'k',
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) };
    },
  });
  assert.equal(await chat([{ role: 'user', content: 'hi' }]), '{}');
  assert.equal(seen.url, 'http://llm.test:11434/v1/chat/completions');
  assert.equal(seen.init.headers.authorization, 'Bearer k');
  assert.equal(JSON.parse(seen.init.body).response_format.type, 'json_object');
});

function vault(t) {
  const project = tempDir(t);
  const root = join(project, 'knowledge-system');
  const notes = {
    'notes/order-service.md': '---\nid: order-service\ntitle: Order Service\nsources:\n  - src/order.ts\n---\n\n# Order Service\n\nThe Order Service depends on the Payments DB.\n',
    'notes/payments-db.md': '---\nid: payments-db\ntitle: Payments DB\nsources:\n  - db.sql\n---\n\n# Payments DB\n\nThe Payments DB is owned by the Billing Team.\n',
  };
  for (const [path, text] of Object.entries(notes)) put(join(root, path), text);
  put(join(root, '_knowledge', 'catalog.jsonl'), [
    { id: 'order-service', path: 'notes/order-service.md', title: 'Order Service', summary: 'orders' },
    { id: 'payments-db', path: 'notes/payments-db.md', title: 'Payments DB', summary: 'payments' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  put(join(root, '_knowledge', 'questions.jsonl'), `${JSON.stringify({ id: 'q1', question: 'Who owns the data the Order Service needs?', required_note_ids: ['order-service', 'payments-db'], graph_check: true, required_graph_node_ids: ['order-service', 'n-billing-team'] })}\n`);
  return { project, root };
}

const replies = {
  'Order Service': { entities: [{ name: 'Order Service', type: 'service' }, { name: 'Payments DB', type: 'database' }], relations: [
    { source: 'Order Service', target: 'Payments DB', type: 'DEPENDS_ON', evidence: 'The Order Service depends on the Payments DB.' },
    { source: 'Order Service', target: 'Payments DB', type: 'RELATED_TO', evidence: 'The Order Service depends on the Payments DB.' },
  ] },
  'Payments DB': { entities: [{ name: 'Billing Team', type: 'team' }], relations: [
    { source: 'Billing Team', target: 'Payments DB', type: 'OWNS', evidence: 'The Payments DB is owned by the Billing Team.' },
    { source: 'Payments DB', target: 'Billing Team', type: 'OWNED_BY', evidence: 'invented sentence' },
  ] },
};

const fakeChat = async (messages) => {
  const title = /Note "([^"]+)"/.exec(messages[1].content)[1];
  return JSON.stringify(replies[title]);
};

test('build: extraction to _graph, rejected edges with reasons, reachability, sqlite index', async (t) => {
  const { project, root } = vault(t);
  const result = await buildGraph(project, {
    chat: fakeChat,
    env: {},
    probeSources: { nvidiaSmi: () => null, totalMem: 13 * GB, freeMem: 5 * GB, cores: 12 },
  });
  assert.equal(result.status, 'built');
  assert.deepEqual([result.nodes, result.edges, result.rejected_edges], [3, 2, 2]);
  assert.deepEqual(result.rejected_by_reason, { 'vague-type': 1, 'evidence-not-in-source': 1 });
  assert.equal(result.model.tier, 'small');
  assert.equal(JSON.parse(readFileSync(join(root, '.knowledge', 'hardware-probe.json'), 'utf8')).source, 'probe');
  // Billing Team -OWNS-> Payments DB and Order Service -DEPENDS_ON-> Payments DB do not chain
  // in one direction, so the question is honestly unreachable.
  assert.deepEqual(result.reachability, [{ question_id: 'q1', reachable: false }]);
  assert.ok(result.index.documents > 0);
  const edges = readFileSync(join(root, '_graph', 'edges.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(edges.map((e) => `${e.source} ${e.type} ${e.target}`).sort(), [
    'n-billing-team OWNS payments-db',
    'order-service DEPENDS_ON payments-db',
  ]);
});

test('build output passes validate-knowledge when the question is reachable', async (t) => {
  const { project, root } = vault(t);
  put(join(root, '_knowledge', 'questions.jsonl'), `${JSON.stringify({ id: 'q1', question: 'What does the Order Service need?', required_note_ids: ['order-service'], graph_check: true, required_graph_node_ids: ['order-service', 'payments-db'] })}\n`);
  await buildGraph(project, { chat: fakeChat, env: {}, index: false, probeSources: { nvidiaSmi: () => null, totalMem: 13 * GB, freeMem: GB, cores: 2 } });
  const reach = JSON.parse(readFileSync(join(root, '_graph', 'question-reachability.jsonl'), 'utf8'));
  assert.equal(reach.reachable, true);
  const report = validateKnowledge(root);
  // The fixture question is minimal, so question-format errors are expected;
  // none may come from the graph files or the reachability result.
  const graphErrors = report.errors.map((e) => e.replaceAll(root, '')).filter((e) => /_graph|graph|reachab/.test(e));
  assert.deepEqual(graphErrors, []);
});

test('endpoints: a note id resolves; a name the note states becomes a node; an invented name stays unknown', async (t) => {
  const { project } = vault(t);
  const chat = async (messages) => (/Note "Order Service"/.test(messages[1].content)
    ? JSON.stringify({ entities: [], relations: [
      { source: 'order-service', target: 'Payments DB', type: 'DEPENDS_ON', evidence: 'The Order Service depends on the Payments DB.' },
      { source: 'Order Service', target: 'Ghost Queue', type: 'CALLS', evidence: 'The Order Service depends on the Payments DB.' },
    ] })
    : JSON.stringify({ entities: [], relations: [] }));
  const result = await buildGraph(project, { chat, env: {}, index: false, probeSources: { nvidiaSmi: () => null, totalMem: GB, freeMem: GB, cores: 1 } });
  assert.equal(result.edges, 1);
  assert.deepEqual(result.rejected_by_reason, { 'unknown-target-node': 1 });
});

test('no endpoint: says so and leaves _graph byte for byte', async (t) => {
  const { project, root } = vault(t);
  put(join(root, '_graph', 'nodes.jsonl'), '{"id":"hand-made"}\n');
  const before = treeHash(root);
  const result = await buildGraph(project, { env: {} });
  assert.equal(result.status, 'no-endpoint');
  assert.match(result.message, /KNOWLEDGE_LLM_URL/);
  assert.equal(treeHash(root), before);
});

test('every note failing (timeout, bad JSON) leaves _graph as it was; a rebuild keeps the previous graph', async (t) => {
  const { project, root } = vault(t);
  put(join(root, '_graph', 'nodes.jsonl'), '{"id":"hand-made"}\n');
  const before = treeHash(join(root, '_graph'));
  await assert.rejects(buildGraph(project, { chat: async () => 'not json', env: {}, index: false, probeSources: { nvidiaSmi: () => null, totalMem: GB, freeMem: GB, cores: 1 } }), /_graph was not changed/);
  assert.equal(treeHash(join(root, '_graph')), before);
  await buildGraph(project, { chat: fakeChat, env: {}, index: false, probeSources: { nvidiaSmi: () => null, totalMem: GB, freeMem: GB, cores: 1 } });
  assert.equal(readFileSync(join(root, '.knowledge', 'graph-previous', 'nodes.jsonl'), 'utf8'), '{"id":"hand-made"}\n');
});
