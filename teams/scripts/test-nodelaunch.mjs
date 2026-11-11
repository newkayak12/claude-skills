// test-nodelaunch.mjs - the shared node launch contract (card 130 F1/F2): per-stage model
// resolution, lean launch args, ledger entry shapes, stream usage, region pointers.
process.env.TEAMS_RUNS_DIR ??= 'off';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STAGE_KEYS, DEFAULT_MODELS, normalizeStage, resolveStageModel, stageSkillList, leanLaunchArgs,
  nodeStartEntry, nodeEndEntry, usageFromStream, REGION_THRESHOLD_LINES, regionPointer,
} from '../mcp/nodelaunch.mjs';
import { resolveTeamOptions, TEAM_DEFAULTS } from '../mcp/teamconfig.mjs';
import { resolvePluginDir, teamsPluginRoot } from '../mcp/pluginroots.mjs';
import { STAGE_SKILLS } from '../mcp/stagecontract.mjs';
import { GRAPH_STAGE_SKILLS } from '../mcp/mounts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Hermetic: resolve sibling plugins from this checkout, not from whatever CLAUDE_PLUGIN_ROOT the host set.
process.env.CLAUDE_PLUGIN_ROOT = resolve(HERE, '..');
const MCP = resolve(HERE, '..', 'mcp');
// A help text listing exactly the flags a lean session needs; tests never spawn claude.
const HELP = 'Options:\n  --strict-mcp-config   Only use MCP servers from --mcp-config\n  --mcp-config <configs...>  Load MCP servers\n  --setting-sources <sources>  Comma-separated list\n';

test('stage keys and built-in defaults', () => {
  assert.deepEqual([...STAGE_KEYS], ['implement', 'test', 'driver', 'plan', 'setgoal', 'critique', 'review', 'gate', 'report', 'judge', 'goal_gate']);
  for (const s of ['implement', 'test', 'driver']) assert.equal(DEFAULT_MODELS[s], 'sonnet', s);
  for (const s of ['plan', 'setgoal', 'critique', 'review', 'gate', 'report', 'judge', 'goal_gate']) assert.equal(DEFAULT_MODELS[s], 'opus', s);
  assert.deepEqual(Object.keys(DEFAULT_MODELS).sort(), [...STAGE_KEYS].sort());
  for (const s of STAGE_KEYS) assert.equal(resolveStageModel(s), DEFAULT_MODELS[s], `${s} with no opts`);
});

test('A1.2: tm_open argument beats team.json beats the built-in default; others keep theirs', () => {
  const opts = { models: { implement: 'haiku' }, teamModels: { implement: 'opus', plan: 'sonnet' } };
  assert.equal(resolveStageModel('implement', opts), 'haiku', 'tm_open wins over team.json');
  assert.equal(resolveStageModel('plan', opts), 'sonnet', 'team.json wins over the default');
  assert.equal(resolveStageModel('critique', opts), 'opus', 'unoverridden stage keeps its default');
  assert.equal(resolveStageModel('test', opts), 'sonnet');
  assert.equal(resolveStageModel('implement', { teamModels: { implement: 'opus' } }), 'opus');
  assert.equal(resolveStageModel('implement', { models: { implement: '  ' }, teamModels: { implement: 'opus' } }), 'opus', 'a blank override is no override');
});

test('aliases pass through as given; unknown stages fall back to their role and never throw', () => {
  assert.equal(resolveStageModel('implement', { models: { implement: 'opus' } }), 'opus');
  assert.equal(resolveStageModel('plan', { models: { plan: 'claude-sonnet-5-5' } }), 'claude-sonnet-5-5');
  assert.equal(resolveStageModel('implement', { models: { implement: 'sonnet[1m]' } }), 'sonnet[1m]');
  assert.equal(resolveStageModel('mystery'), 'sonnet');
  assert.equal(resolveStageModel('plan-critique-x'), 'opus', 'judge-like unknown name');
  for (const bad of [undefined, null, 42, {}, '', 'x:y:z']) assert.doesNotThrow(() => resolveStageModel(bad));
  for (const badOpts of [null, undefined, 'x', { models: 'nope', teamModels: 7 }]) assert.equal(resolveStageModel('gate', badOpts), 'opus');
});

test('manager stage names map onto the taxonomy', () => {
  for (const s of ['shape', 'accept', 'integrate', 'plan-integrate']) { assert.equal(normalizeStage(s), 'judge', s); assert.equal(resolveStageModel(s), 'opus', s); }
  assert.equal(normalizeStage('gate:goal'), 'goal_gate');
  assert.equal(normalizeStage('implement:U1:2'), 'implement');
  assert.equal(normalizeStage('areas-critique'), 'critique');
  assert.equal(normalizeStage('draft'), null);
  assert.equal(resolveStageModel('shape', { models: { judge: 'sonnet' } }), 'sonnet', 'the judge key covers the manager judges');
  assert.equal(resolveStageModel('shape', { models: { shape: 'haiku', judge: 'sonnet' } }), 'haiku', 'a specific key beats the group key');
});

test('AC-2: models merges by key across team.json and tm_open and reports its source', () => {
  const { opts, sources, notes } = resolveTeamOptions({ models: { plan: 'sonnet' } }, { models: { plan: 'opus', implement: 'haiku' } });
  assert.deepEqual(opts.models, { plan: 'sonnet', implement: 'haiku' });
  assert.equal(sources.models, 'args');
  assert.deepEqual(notes, []);
  const fileOnly = resolveTeamOptions({}, { models: { test: 'haiku' } });
  assert.deepEqual(fileOnly.opts.models, { test: 'haiku' });
  assert.equal(fileOnly.sources.models, 'team.json');
  const none = resolveTeamOptions({}, {});
  assert.deepEqual(none.opts.models, {});
  assert.equal(none.sources.models, 'default');
  assert.notEqual(none.opts.models, TEAM_DEFAULTS.models, 'models is a fresh copy, not an alias of the default');
  // the merged result feeds the resolver
  assert.equal(resolveStageModel('implement', { models: opts.models }), 'haiku');
  assert.equal(resolveStageModel('plan', { models: opts.models }), 'sonnet');
});

test('AC-2: a wrongly typed models value is ignored with a note', () => {
  for (const bad of ['sonnet', ['plan'], { plan: 5 }, { plan: '' }]) {
    const { opts, notes } = resolveTeamOptions({}, { models: bad });
    assert.deepEqual(opts.models, {}, JSON.stringify(bad));
    assert.equal(notes.length, 1, JSON.stringify(bad));
  }
});

test('this repo\'s .claude/team.json carries no models key', () => {
  const root = resolve(HERE, '..', '..');
  assert.ok(!/models/.test(readFileSync(join(root, '.claude', 'team.json'), 'utf8')));
});

test('tm_open and tm_next-style schemas accept models as an object of strings', () => {
  const src = readFileSync(join(MCP, 'taskmanager-tools.mjs'), 'utf8');
  assert.match(src, /models: \{ type: 'object', additionalProperties: \{ type: 'string' \}/);
});

const dirsOf = (args) => args.flatMap((a, i) => (a === '--plugin-dir' ? [args[i + 1]] : []));

test('leanLaunchArgs: strict MCP, the teams server, project settings only', () => {
  const args = leanLaunchArgs('implement', {}, { helpText: HELP });
  assert.ok(args.includes('--strict-mcp-config'));
  const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]);
  assert.deepEqual(Object.keys(config.mcpServers), ['teams'], 'the one server that serves tm_ask and team_*');
  const server = config.mcpServers.teams;
  assert.ok(server.args[0].endsWith(join('mcp', 'server.mjs')) || server.args[0].endsWith('/mcp/server.mjs'));
  assert.ok(server.args[0].startsWith(teamsPluginRoot()));
  assert.deepEqual(args.slice(args.indexOf('--setting-sources'), args.indexOf('--setting-sources') + 2), ['--setting-sources', 'project']);
  assert.equal(args.indexOf('--mcp-config') - args.indexOf('--strict-mcp-config'), 1);
  assert.deepEqual(JSON.parse(leanLaunchArgs('test', { root: '/tmp/wiki' }, { helpText: HELP })[2]).mcpServers.teams.args.slice(-2), ['--root', '/tmp/wiki']);
});

test('leanLaunchArgs: plugin dirs are the teams root plus that stage\'s skills plus task.plugin_dirs, nothing else', () => {
  const root = teamsPluginRoot();
  // implement has no graph skills: the teams root alone
  assert.deepEqual(dirsOf(leanLaunchArgs('implement', {}, { helpText: HELP })), [root]);
  // test has one skill plugin (completion)
  const testArgs = leanLaunchArgs('test', {}, { helpText: HELP });
  assert.deepEqual(dirsOf(testArgs), [root, resolvePluginDir('completion', root)]);
  assert.ok(dirsOf(testArgs)[1].endsWith('/completion'));
  assert.ok(!dirsOf(testArgs).some((d) => /\/(think|cognition|agents|develop)$/.test(d)), 'no other stage\'s plugin');
  // plan: only agents, not think or completion
  const plan = dirsOf(leanLaunchArgs('plan', {}, { helpText: HELP }));
  assert.ok(plan.some((d) => d.endsWith('/agents')));
  assert.ok(!plan.some((d) => d.endsWith('/think') || d.endsWith('/completion')));
  // task.plugin_dirs are kept when they are plugins; the root is never repeated
  const extra = leanLaunchArgs('implement', { plugin_dirs: [resolve(root, '..', 'write'), root] }, { helpText: HELP });
  assert.deepEqual(dirsOf(extra), [root, resolve(root, '..', 'write')]);
});

test('AC-4: manager and graph scopes use different maps; critique differs between them', () => {
  assert.deepEqual(stageSkillList('critique', { scope: 'manager' }), STAGE_SKILLS.critique);
  assert.deepEqual(stageSkillList('critique', { scope: 'graph' }), GRAPH_STAGE_SKILLS.critique);
  assert.notDeepEqual(stageSkillList('critique', { scope: 'manager' }), stageSkillList('critique', { scope: 'graph' }));
  const dirs = (scope) => dirsOf(leanLaunchArgs('critique', { scope }, { helpText: HELP })).map((d) => d.split('/').pop());
  assert.ok(dirs('manager').includes('cognition'));
  assert.ok(!dirs('graph').includes('cognition'));
  assert.ok(dirs('graph').includes('think'));
  // defaults are derived from the stage
  assert.deepEqual(stageSkillList('critique'), GRAPH_STAGE_SKILLS.critique, 'critique defaults to the graph map');
  assert.deepEqual(stageSkillList('shape'), STAGE_SKILLS.shape, 'shape is manager-only');
  assert.deepEqual(stageSkillList('judge'), [], 'the judge group key names no map entry');
  assert.deepEqual(stageSkillList('goal_gate'), STAGE_SKILLS['gate:goal']);
  assert.deepEqual(stageSkillList('plan-integrate'), STAGE_SKILLS['plan-integrate']);
  // the driver runs a whole graph run: every graph skill
  assert.deepEqual(new Set(stageSkillList('driver')), new Set(Object.values(GRAPH_STAGE_SKILLS).flat()));
  // tm_open skills overrides, false turns them off
  assert.deepEqual(stageSkillList('critique', { stage_skills: { critique: ['a:b'] } }), ['a:b']);
  assert.deepEqual(stageSkillList('critique', { stage_skills: false }), []);
  assert.deepEqual(stageSkillList('critique', { stage_skills: { plan: ['a:b'] }, scope: 'manager' }), STAGE_SKILLS.critique);
});

test('AC-5: a flag the help text does not list is not emitted; an unreadable help fails open', () => {
  const none = leanLaunchArgs('implement', {}, { helpText: 'Options:\n  --model <model>\n' });
  assert.ok(!none.includes('--strict-mcp-config') && !none.includes('--mcp-config') && !none.includes('--setting-sources'));
  assert.deepEqual(dirsOf(none), [teamsPluginRoot()]);
  const noStrict = leanLaunchArgs('implement', {}, { helpText: '  --mcp-config <c>\n  --setting-sources <s>\n' });
  assert.ok(!noStrict.includes('--strict-mcp-config'), '"--mcp-config" alone must not count as --strict-mcp-config');
  const open = leanLaunchArgs('implement', {}, { helpText: null });
  assert.ok(open.includes('--strict-mcp-config') && open.includes('--mcp-config') && open.includes('--setting-sources'));
  // no flag that merely hides CLAUDE.md at the cost of auth or MCP is ever emitted
  for (const a of [leanLaunchArgs('plan', {}, { helpText: HELP }), open]) assert.ok(!a.includes('--bare') && !a.includes('--safe-mode'));
});

test('AC-6: node_start and node_end entries have exactly these fields and are null-safe', () => {
  assert.deepEqual(nodeStartEntry({ run_id: 'r', node_id: 'implement:U1', stage: 'implement', model: 'sonnet', pid: 41 }),
    { event: 'node_start', run_id: 'r', node_id: 'implement:U1', stage: 'implement', model: 'sonnet', pid: 41 });
  assert.deepEqual(nodeEndEntry({ run_id: 'r', node_id: 'implement:U1', stage: 'implement', model: 'sonnet', api_calls: 7, peak_context_tokens: 18000 }),
    { event: 'node_end', run_id: 'r', node_id: 'implement:U1', stage: 'implement', model: 'sonnet', api_calls: 7, peak_context_tokens: 18000 });
  assert.deepEqual(nodeStartEntry(), { event: 'node_start', run_id: null, node_id: null, stage: null, model: null, pid: null });
  assert.deepEqual(nodeEndEntry({}), { event: 'node_end', run_id: null, node_id: null, stage: null, model: null, api_calls: null, peak_context_tokens: null });
  assert.deepEqual(nodeEndEntry(undefined), nodeEndEntry({}));
});

const line = (o) => JSON.stringify(o);
const asst = (id, input, read, create) => line({ type: 'assistant', message: { id, role: 'assistant', usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: create, output_tokens: 9 } } });

test('AC-7: claude stream-json - calls counted per assistant message, peak is the largest single call', () => {
  const stream = [
    line({ type: 'system', subtype: 'init' }),
    asst('m1', 3, 1000, 20000),   // 21003
    asst('m1', 3, 1000, 20000),   // same message, second content block: one call
    line({ type: 'user', message: { content: 'x' } }),
    asst('m2', 5, 21000, 800),    // 21805
    asst('m3', 2, 21800, 3000),   // 24802
    line({ type: 'result', subtype: 'success', num_turns: 3, usage: { input_tokens: 10, cache_read_input_tokens: 43800, cache_creation_input_tokens: 23800 } }),
  ].join('\n');
  assert.deepEqual(usageFromStream(stream), { api_calls: 3, peak_context_tokens: 24802 });
});

test('AC-7: adapter events - a claude json envelope, a codex event stream, a result-only stream', () => {
  const envelope = line({ type: 'result', subtype: 'success', num_turns: 4, usage: { input_tokens: 4, cache_read_input_tokens: 9000, cache_creation_input_tokens: 1000 } });
  assert.deepEqual(usageFromStream(envelope), { api_calls: 4, peak_context_tokens: 10004 });
  assert.deepEqual(usageFromStream(`[${envelope}]`), { api_calls: 4, peak_context_tokens: 10004 });
  const codex = [line({ type: 'thread.started' }), line({ type: 'turn.completed', usage: { input_tokens: 5000, output_tokens: 10 } }), line({ type: 'turn.completed', usage: { input_tokens: 7000, output_tokens: 10 } })].join('\n');
  assert.deepEqual(usageFromStream(codex), { api_calls: 2, peak_context_tokens: 7000 });
});

test('AC-7: no usage, an empty stream or garbage returns nulls and never throws', () => {
  const nulls = { api_calls: null, peak_context_tokens: null };
  for (const t of ['', '   \n', 'garbage\n{}\n[', undefined, null, 5, '{"type":"result"}', '{"type":"system"}\n{"type":"user"}']) assert.deepEqual(usageFromStream(t), nulls, String(t));
  // a vendor that reports calls but no token usage
  assert.deepEqual(usageFromStream(line({ type: 'assistant', message: { id: 'a' } })), { api_calls: 1, peak_context_tokens: null });
  assert.deepEqual(usageFromStream('null\n3\n"x"\n' + asst('m1', 1, 1, 1)), { api_calls: 1, peak_context_tokens: 3 });
});

test('AC-8: regionPointer returns a pointer above 400 lines and null at or under it', () => {
  assert.equal(REGION_THRESHOLD_LINES, 400);
  const lines = (n, trailing = '') => Array.from({ length: n }, (_, i) => `l${i}`).join('\n') + trailing;
  assert.equal(regionPointer('a.js', lines(399)), null);
  assert.equal(regionPointer('a.js', lines(400)), null);
  assert.equal(regionPointer('a.js', lines(400, '\n')), null, 'a trailing newline is not a line');
  assert.equal(regionPointer('a.js', ''), null);
  assert.equal(regionPointer('a.js', undefined), null);
  assert.equal(regionPointer('a.js', lines(401)), 'a.js:L1-L401');
  assert.equal(regionPointer('a.js', lines(401), { range: [120, 180] }), 'a.js:L120-L180');
  assert.equal(regionPointer('a.js', lines(401), { range: [300, 9999] }), 'a.js:L300-L401', 'range is clamped to the file');
  assert.equal(regionPointer('a.js', lines(1000), { symbols: ['foo', 'bar'] }), 'a.js#foo,bar');
  assert.equal(regionPointer('a.js', lines(100), { symbols: ['foo'] }), null, 'a small file gets no pointer even with symbols');
  assert.match(regionPointer('a.js', lines(500), { symbols: [] }), /^a\.js:L1-L500$/);
});

test('AC-9: nodelaunch.mjs writes nothing, calls no network, and spawns only one `claude --help`', () => {
  const src = readFileSync(join(MCP, 'nodelaunch.mjs'), 'utf8');
  assert.ok(!/writeFile|appendFile|createWriteStream|mkdir|rmSync|unlink|rename\(|\bfetch\(|https?:\/\/|node:(http|https|net|dgram)/.test(src), 'no write or network API');
  assert.ok(!/\bspawn\(|\bspawnSync\(|\bexec\(|\bexecSync\(|execFile\(|\bfork\(/.test(src), 'no other process API');
  const calls = src.match(/execFileSync\(/g) || [];
  assert.equal(calls.length, 1, 'exactly one call');
  assert.match(src, /execFileSync\('claude', \['--help'\]/);
  assert.equal((src.match(/'--help'/g) || []).length, 1);
});
