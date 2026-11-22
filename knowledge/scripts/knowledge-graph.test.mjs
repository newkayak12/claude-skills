import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  DEFAULT_RELATION_TYPES,
  buildGraph,
  graphConfig,
  nameProblems,
  openAiCompatibleChat,
  parseModelJson,
  questionReachability,
  validateEdges,
} from './knowledge-graph.mjs';
import { appendJsonl, consumeQueue, readQueue } from './knowledge-jobs.mjs';
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

test('edges: with no relation_types a default list applies; an unknown type is refused unknown-type', () => {
  const want = 'DEPENDS_ON,CALLS,READS,WRITES,STORES,RETURNS,PRODUCES,CONSUMES,IMPLEMENTS,EXTENDS,CONFIGURES,CONTAINS,PART_OF,INSTANCE_OF,ALIAS_OF,OWNS,MEMBER_OF,WORKS_ON,SUPERSEDES,REPLACES,CAUSES,PREFERS'.split(',').sort();
  assert.deepEqual([...DEFAULT_RELATION_TYPES].sort(), want);
  for (const config of [graphConfig({}), graphConfig({ graph: { relation_types: [] } })]) {
    assert.deepEqual([...config.relation_types].sort(), want);
    assert.equal(config.ontology, false);
    assert.equal(config.max_name_chars, 40);
  }
  assert.equal(graphConfig({ graph: { relation_types: ['PEER_OF'] } }).ontology, true);
  const base = { source: 'a', target: 'b', evidence: 'x', source_refs: ['n.md'] };
  const { accepted, rejected } = validateEdges([
    { ...base, type: 'PREFERS_FORMAL_LANGUAGE' },
    { ...base, type: 'DEPENDS_ON' },
    { ...base, type: 'PREFERS', target: 'c' },
  ], { nodeIds: new Set(['a', 'b', 'c']), sourceText: () => 'x', config: graphConfig({}) });
  assert.deepEqual(rejected.map((r) => r.reasons), [['unknown-type']]);
  assert.deepEqual(accepted.map((e) => e.type), ['DEPENDS_ON', 'PREFERS']);
});

test('nodes: a name past max_name_chars is refused name-too-long', async (t) => {
  const config = graphConfig({});
  assert.deepEqual(nameProblems('x'.repeat(41), config), ['name-too-long']);
  assert.deepEqual(nameProblems('x'.repeat(40), config), []);
  assert.deepEqual(nameProblems(` ${'x'.repeat(40)} `, config), []);
  assert.deepEqual(nameProblems('x'.repeat(11), graphConfig({ graph: { max_name_chars: 10 } })), ['name-too-long']);
  for (const bad of [0, -5, '12', 1.5, null]) assert.equal(graphConfig({ graph: { max_name_chars: bad } }).max_name_chars, 40);
  const { project, root } = vault(t);
  const long = 'x'.repeat(41);
  const note = join(root, 'notes', 'order-service.md');
  put(note, `${readFileSync(note, 'utf8')}\nThe Order Service calls ${long} daily.\n`);
  const chat = async (messages) => (/Note "Order Service"/.test(messages[1].content)
    ? JSON.stringify({ entities: [{ name: long, type: 'thing' }], relations: [
      { source: 'Order Service', target: long, type: 'CALLS', evidence: `The Order Service calls ${long} daily.` },
    ] })
    : JSON.stringify({ entities: [], relations: [] }));
  const result = await buildGraph(project, { chat, env: {}, index: false, probeSources: { nvidiaSmi: () => null, totalMem: GB, freeMem: GB, cores: 1 } });
  const lines = (name) => readFileSync(join(root, '_graph', name), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(!lines('nodes.jsonl').some((n) => n.canonical_name === long));
  assert.equal(result.edges, 0);
  assert.deepEqual(lines('rejected-edges.jsonl').map((r) => r.reasons), [['name-too-long']]);
  assert.ok(result.rejected_nodes_by_reason['name-too-long'] >= 1);
  assert.ok(result.rejected_nodes >= 1);
});

test('nodes: a name holding a clause is refused name-is-sentence', () => {
  const config = graphConfig({});
  for (const name of ['비관락 잡고 했고 외부 요청 없고', 'The cache stores sessions.', '캐시가 세션을 저장한다']) {
    assert.deepEqual(nameProblems(name, config), ['name-is-sentence'], name);
  }
  for (const name of ['Order Service', 'Spring Boot 3.x', '최고 관리자', '재고 창고', '광고 보고', 'Acme Inc.', '바다', '수요', '푸른 바다']) {
    assert.deepEqual(nameProblems(name, config), [], name);
  }
  const { rejected } = validateEdges([
    { source: 'a', target: null, type: 'DEPENDS_ON', evidence: 'x', source_refs: ['n.md'], proposed: { source: 'a', target: '비관락 잡고 했고 외부 요청 없고' } },
  ], { nodeIds: new Set(['a']), sourceText: () => 'x', config });
  assert.deepEqual(rejected.map((r) => r.reasons), [['name-is-sentence']]);
});

test('prompt: the system prompt names the relation types and at most max_name_chars', async (t) => {
  const systems = [];
  const chat = async (messages) => {
    systems.push(messages[0].content);
    return JSON.stringify({ entities: [], relations: [] });
  };
  const probeSources = { nvidiaSmi: () => null, totalMem: GB, freeMem: GB, cores: 1 };
  const first = vault(t);
  await buildGraph(first.project, { chat, env: {}, index: false, probeSources });
  assert.ok(systems.length > 0);
  assert.ok(systems[0].includes('DEPENDS_ON'));
  assert.ok(systems[0].includes('at most 40'));
  const second = vault(t);
  put(join(second.root, '_knowledge', 'config.json'), JSON.stringify({ graph: { max_name_chars: 10 } }));
  systems.length = 0;
  await buildGraph(second.project, { chat, env: {}, index: false, probeSources });
  assert.ok(systems.length > 0);
  assert.ok(systems[0].includes('at most 10'));
  assert.ok(!systems[0].includes('at most 40'));
});

test('nodes: a relation endpoint that fails the name rules and is absent from the note is still counted', async (t) => {
  const { project } = vault(t);
  const clause = '비관락 잡고 했고 외부 요청 없고';
  const chat = async (messages) => (/Note "Order Service"/.test(messages[1].content)
    ? JSON.stringify({ entities: [], relations: [
      { source: 'Order Service', target: clause, type: 'CALLS', evidence: 'The Order Service depends on the Payments DB.' },
    ] })
    : JSON.stringify({ entities: [], relations: [] }));
  const result = await buildGraph(project, { chat, env: {}, index: false, probeSources: { nvidiaSmi: () => null, totalMem: GB, freeMem: GB, cores: 1 } });
  assert.equal(result.edges, 0);
  assert.deepEqual(result.rejected_by_reason, { 'name-is-sentence': 1 });
  assert.deepEqual(result.rejected_nodes_by_reason, { 'name-is-sentence': 1 });
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
  assert.deepEqual(result.rejected_by_reason, { 'vague-type': 1, 'evidence-not-in-source': 1, 'unknown-type': 1 });
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

const probeSources = { nvidiaSmi: () => null, totalMem: GB, freeMem: GB, cores: 1 };

function countingChat(inner = fakeChat) {
  const titles = [];
  const chat = async (messages) => {
    titles.push(/Note "([^"]+)"/.exec(messages[1].content)[1]);
    return inner(messages);
  };
  return { chat, titles };
}

const queueFile = (root) => join(root, '_knowledge', 'jobs', 'graph-update-queue.jsonl');
const queue = (root, ...files) => {
  for (const file of files) appendJsonl(queueFile(root), { file, reason: 'edited', queued_at: '2026-11-19T00:00:00.000Z' });
};
const lines = (path) => readFileSync(path, 'utf8').split('\n').filter(Boolean);

test('incremental: a queued note is re-extracted alone, an unqueued note is not re-sent to the model', async (t) => {
  const { project, root } = vault(t);
  const counter = countingChat();
  const run = (extra = {}) => buildGraph(project, { chat: counter.chat, env: {}, index: false, probeSources, ...extra });
  const full = await run();
  assert.equal(full.mode, 'full');
  assert.deepEqual(counter.titles, ['Order Service', 'Payments DB']);
  const edgesBefore = lines(join(root, '_graph', 'edges.jsonl'));
  const nodesBefore = lines(join(root, '_graph', 'nodes.jsonl'));
  counter.titles.length = 0;
  queue(root, 'notes/payments-db.md');
  const result = await run();
  assert.deepEqual(counter.titles, ['Payments DB']);
  assert.equal(result.mode, 'incremental');
  assert.deepEqual([result.notes_queued, result.notes_deleted, result.queue_remaining], [1, 0, 0]);
  assert.deepEqual([result.nodes, result.edges], [3, 2]);
  // Lines of the note that was not queued are byte-equal.
  const edgesAfter = lines(join(root, '_graph', 'edges.jsonl'));
  const orderEdge = edgesBefore.find((l) => l.includes('"order-service"'));
  assert.ok(edgesAfter.includes(orderEdge));
  assert.ok(nodesBefore.filter((l) => l.includes('Order Service')).every((l) => lines(join(root, '_graph', 'nodes.jsonl')).includes(l)));
  assert.equal(lines(queueFile(root)).length, 0);
});

test('incremental: a rerun with --full re-extracts every note and ignores the existing graph', async (t) => {
  const { project, root } = vault(t);
  const counter = countingChat();
  await buildGraph(project, { chat: counter.chat, env: {}, index: false, probeSources });
  counter.titles.length = 0;
  const result = await buildGraph(project, { chat: counter.chat, env: {}, index: false, probeSources, full: true });
  assert.equal(result.mode, 'full');
  assert.equal(counter.titles.length, 2);
});

test('queue (a): entries leave the queue only after _graph is written', { skip: process.getuid?.() === 0 }, async (t) => {
  const { project, root } = vault(t);
  await buildGraph(project, { chat: fakeChat, env: {}, index: false, probeSources });
  queue(root, 'notes/payments-db.md');
  chmodSync(join(root, '_graph'), 0o500);
  // The temp dir's own cleanup may run first; restore only what is still there.
  t.after(() => existsSync(join(root, '_graph')) && chmodSync(join(root, '_graph'), 0o700));
  await assert.rejects(buildGraph(project, { chat: fakeChat, env: {}, index: false, probeSources }));
  assert.equal(lines(queueFile(root)).length, 1);
  chmodSync(join(root, '_graph'), 0o700);
  const result = await buildGraph(project, { chat: fakeChat, env: {}, index: false, probeSources });
  assert.equal(result.queue_remaining, 0);
  assert.equal(lines(queueFile(root)).length, 0);
});

test('queue (b): a note whose extraction failed stays queued and keeps its earlier nodes and edges', async (t) => {
  const { project, root } = vault(t);
  await buildGraph(project, { chat: fakeChat, env: {}, index: false, probeSources });
  queue(root, 'notes/order-service.md', 'notes/payments-db.md');
  const chat = async (messages) => (/Note "Payments DB"/.test(messages[1].content) ? 'not json' : fakeChat(messages));
  const result = await buildGraph(project, { chat, env: {}, index: false, probeSources });
  assert.equal(result.notes_failed.length, 1);
  assert.equal(result.queue_remaining, 1);
  assert.match(lines(queueFile(root))[0], /payments-db\.md/);
  const edges = lines(join(root, '_graph', 'edges.jsonl')).map((l) => JSON.parse(l));
  assert.ok(edges.some((e) => e.type === 'OWNS' && e.source === 'n-billing-team'));
});

test('queue (c): a queued note that no longer exists loses its nodes and edges with no model call', async (t) => {
  const { project, root } = vault(t);
  await buildGraph(project, { chat: fakeChat, env: {}, index: false, probeSources });
  rmSync(join(root, 'notes', 'payments-db.md'));
  queue(root, 'notes/payments-db.md');
  const counter = countingChat();
  const result = await buildGraph(project, { chat: counter.chat, env: {}, index: false, probeSources });
  assert.equal(counter.titles.length, 0);
  assert.deepEqual([result.mode, result.notes_deleted, result.queue_remaining], ['incremental', 1, 0]);
  const nodes = lines(join(root, '_graph', 'nodes.jsonl')).map((l) => JSON.parse(l).id);
  assert.deepEqual(nodes, ['order-service']);
  assert.equal(lines(join(root, '_graph', 'edges.jsonl')).length, 0);
});

test('queue (d): an empty queue with an existing _graph makes no model call and leaves _graph untouched', async (t) => {
  const { project, root } = vault(t);
  await buildGraph(project, { chat: fakeChat, env: {}, index: false, probeSources });
  const mtimes = () => ['nodes.jsonl', 'edges.jsonl'].map((n) => statSync(join(root, '_graph', n)).mtimeMs);
  const before = mtimes();
  const counter = countingChat();
  const result = await buildGraph(project, { chat: counter.chat, env: {}, index: false, probeSources });
  assert.equal(counter.titles.length, 0);
  assert.deepEqual([result.status, result.mode, result.notes_queued], ['up-to-date', 'incremental', 0]);
  assert.deepEqual(mtimes(), before);
});

test('queue: consumeQueue removes only the given entries and keeps one appended after the read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-queue-'));
  try {
    queue(dir, 'a.md', 'b.md');
    const read = readQueue(dir, 'graph');
    queue(dir, 'c.md');
    consumeQueue(dir, 'graph', read.slice(0, 1));
    assert.deepEqual(lines(queueFile(dir)).map((l) => JSON.parse(l).file), ['b.md', 'c.md']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every note failing (timeout, bad JSON) leaves _graph as it was; a rebuild keeps the previous graph', async (t) => {
  const { project, root } = vault(t);
  put(join(root, '_graph', 'nodes.jsonl'), '{"id":"hand-made"}\n');
  const before = treeHash(join(root, '_graph'));
  await assert.rejects(buildGraph(project, { chat: async () => 'not json', env: {}, index: false, full: true, probeSources: { nvidiaSmi: () => null, totalMem: GB, freeMem: GB, cores: 1 } }), /_graph was not changed/);
  assert.equal(treeHash(join(root, '_graph')), before);
  await buildGraph(project, { chat: fakeChat, env: {}, index: false, full: true, probeSources: { nvidiaSmi: () => null, totalMem: GB, freeMem: GB, cores: 1 } });
  assert.equal(readFileSync(join(root, '.knowledge', 'graph-previous', 'nodes.jsonl'), 'utf8'), '{"id":"hand-made"}\n');
});
