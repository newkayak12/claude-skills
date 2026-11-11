#!/usr/bin/env node
// Card 130 P2: nodelaunch.mjs wired into every node spawn site - an explicit --model per stage,
// lean launch args, node_start / node_end ledger events, one process per node, region prompts.
//
//   node --test teams/scripts/test-node-launch-sites.mjs
//
// Spawn sites: driverArgv (taskmanager-drivers.mjs), judgeArgv + answerArgv (daemon.mjs), the
// adapter argv of broker-tools.mjs and runAdapter (broker-vendors.mjs). The detect probe in
// broker-vendors.mjs probe() is not a node launch and stays as it was.
//
// PARTIAL (named, not faked): teams/adapters/claude-exec-adapter.mjs builds the claude argv of a
// broker-adapter node and is outside this package. It accepts no lean flags, so for the adapter
// paths only an explicit --model and the flags the adapter accepts are asserted, plus what the
// adapter itself already passes (--strict-mcp-config with an empty or wiki-only MCP config). The
// teams-MCP-with-tm_ask config, the stage's plugin dirs and the CLAUDE.md exclusion for those
// nodes are not met, and the last test of this file pins that fact so the gap stays visible.
// A graph node behind the adapter therefore cannot reach tm_ask; the STORY-level parking path
// (taskmanager-asks.mjs, taskmanager-children.mjs:211, daemon.mjs:681) is unchanged.
// A child driver is still one claude process for a whole run (a team_next loop), so "one process
// per node" is proved on the adapter path; the driver-loop form is a partial of F2-US-2.

process.env.TEAMS_RUNS_DIR ??= 'off';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { driverArgv } from '../mcp/taskmanager-drivers.mjs';
import { answerArgv, judgeArgv } from '../mcp/daemon.mjs';
import { runAdapter } from '../mcp/broker-vendors.mjs';
import { BROKER_TOOLS, callBrokerTool } from '../mcp/broker-tools.mjs';
import { composePrompt } from '../mcp/prompts.mjs';
import { REGION_THRESHOLD_LINES, regionPointer } from '../mcp/nodelaunch.mjs';
import { referencedPlugins } from '../mcp/pluginroots.mjs';

const ADAPTER = fileURLToPath(new URL('../adapters/claude-exec-adapter.mjs', import.meta.url));
const ADAPTER_FLAGS = new Set(['--detect', '--isolated', '--verify', '--no-wiki', '--add-dir', '--cwd', '--output', '--prompt-file', '--events-output', '--stage', '--sandbox', '--model']);

// ---------- helpers ----------

const modelsOf = (argv) => argv.flatMap((a, i) => (a === '--model' ? [argv[i + 1]] : []));
const valuesOf = (argv, flag) => argv.flatMap((a, i) => (a === flag ? [argv[i + 1]] : []));
const dirsOf = (argv) => valuesOf(argv, '--plugin-dir').map((d) => basename(d));

// HARNESS_*_DRIVER overrides replace the whole command line; every test but the override ones
// runs with them off. CLAUDE_PLUGIN_ROOT is off too, so the plugin root is this checkout's teams/
// and its sibling plugins are the ones named (an installed layout has <plugin>/<version> dirs).
function withoutOverrides(fn) {
  const keys = ['HARNESS_CHILD_DRIVER', 'HARNESS_JUDGE_DRIVER', 'HARNESS_ANSWER_DRIVER', 'CLAUDE_PLUGIN_ROOT'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  const restore = () => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
  try {
    const out = fn();
    return out && typeof out.then === 'function' ? out.finally(restore) : (restore(), out);
  } catch (e) { restore(); throw e; }
}

const taskWith = (models, child_opts) => ({ team: { opts: { models: models || {} } }, ...(child_opts ? { child_opts } : {}) });

function assertLean(argv, label) {
  assert.ok(argv.includes('--strict-mcp-config'), `${label}: --strict-mcp-config`);
  const configs = valuesOf(argv, '--mcp-config');
  assert.equal(configs.length, 1, `${label}: exactly one --mcp-config`);
  const cfg = JSON.parse(configs[0]);
  assert.deepEqual(Object.keys(cfg.mcpServers), ['teams'], `${label}: the teams server only`);
  assert.match(cfg.mcpServers.teams.args[0], /mcp[\\/]server\.mjs$/, `${label}: the one server that serves tm_ask and team_*`);
  assert.deepEqual([...new Set(valuesOf(argv, '--setting-sources'))], ['project'], `${label}: project settings only, never the user's`);
  assert.equal(argv.filter((a) => a === '--setting-sources').length, 1, `${label}: --setting-sources once`);
  assert.ok(!argv.includes('--bare') && !argv.includes('--safe-mode'), `${label}: no flag that also drops auth or tm_ask`);
}

// ---------- AC-1: one explicit --model per spawn path, by stage ----------

test('driverArgv: one --model, sonnet by default; models.driver overrides; child_opts.model wins, still one --model', () => withoutOverrides(() => {
  assert.deepEqual(modelsOf(driverArgv(null)), ['sonnet']);
  assert.deepEqual(modelsOf(driverArgv(taskWith({}), { harness: true })), ['sonnet'], 'the size-S harness driver is the same stage');
  assert.deepEqual(modelsOf(driverArgv(taskWith({ driver: 'opus' }))), ['opus']);
  assert.deepEqual(modelsOf(driverArgv(taskWith({ driver: 'opus' }, { model: 'haiku' }))), ['haiku']);
}));

test('judgeArgv: a manager judge and the goal gate run on opus by default; models.<stage> and child_opts.model override, one --model', () => withoutOverrides(() => {
  const shape = { node_id: 'shape:1', stage: 'shape' };
  const goal = { node_id: 'gate:goal:1', stage: 'gate' };
  assert.deepEqual(modelsOf(judgeArgv(taskWith({}), shape)), ['opus']);
  assert.deepEqual(modelsOf(judgeArgv(taskWith({}), goal)), ['opus']);
  assert.deepEqual(modelsOf(judgeArgv(null)), ['opus'], 'no node: the judge stage');
  assert.deepEqual(modelsOf(judgeArgv(taskWith({ goal_gate: 'sonnet' }), goal)), ['sonnet']);
  assert.deepEqual(modelsOf(judgeArgv(taskWith({ shape: 'haiku', judge: 'sonnet' }), shape)), ['haiku'], 'a specific key beats the group key');
  assert.deepEqual(modelsOf(judgeArgv(taskWith({ judge: 'sonnet' }, { model: 'fable' }), shape)), ['fable']);
}));

test('answerArgv (the daemon\'s other child spawn): one --model, opus by default, child_opts.model wins', () => withoutOverrides(() => {
  assert.deepEqual(modelsOf(answerArgv({})), ['opus']);
  assert.deepEqual(modelsOf(answerArgv(taskWith({ judge: 'sonnet' }))), ['sonnet']);
  assert.deepEqual(modelsOf(answerArgv({ child_opts: { model: 'haiku' } })), ['haiku']);
  assert.ok(answerArgv({}).includes('--tools=Read,Grep,Glob'), 'its read-only tool limits are untouched');
}));

// A stub for node:child_process spawn: records every call, hands out distinct pids.
function stubSpawn(stdout = '') {
  const calls = [];
  let pid = 5000;
  const spawn = (command, args, options) => {
    const child = new EventEmitter();
    child.pid = ++pid;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    calls.push({ command, args, options, pid: child.pid });
    setImmediate(() => { if (stdout) child.stdout.emit('data', Buffer.from(stdout)); child.emit('close', 0); });
    return child;
  };
  return { spawn, calls };
}
const VENDOR = { command: 'node', args: ['/adapters/x.mjs'] };

test('runAdapter: a node launch carries one explicit --model by stage (implement sonnet, a judge opus); a model already in the args is kept once', async () => {
  const s = stubSpawn();
  await runAdapter(VENDOR, ['--stage', 'implement', '--cwd', '/w'], '/w', { stage: 'implement', spawn: s.spawn });
  await runAdapter(VENDOR, ['--cwd', '/w'], '/w', { stage: 'critique', spawn: s.spawn });
  await runAdapter(VENDOR, ['--cwd', '/w'], '/w', { stage: 'gate:goal', models: { goal_gate: 'sonnet' }, spawn: s.spawn });
  await runAdapter(VENDOR, ['--cwd', '/w', '--model', 'haiku'], '/w', { stage: 'implement', spawn: s.spawn });
  assert.deepEqual(s.calls.map((c) => modelsOf(c.args)), [['sonnet'], ['opus'], ['sonnet'], ['haiku']]);
  assert.equal(s.calls[0].command, 'node');
  assert.equal(s.calls[0].args[0], '/adapters/x.mjs', 'the vendor\'s own args stay first');
});

test('runAdapter: the detect probe path is byte-identical - no stage, no --model added, the args exactly as given', async () => {
  const s = stubSpawn();
  const detect = ['--detect', '--cwd', '/w', '--sandbox', 'read-only', '--output', '/w/p.json'];
  await runAdapter(VENDOR, detect, '/w', { timeoutMs: 1000, spawn: s.spawn });
  assert.deepEqual(s.calls[0].args, ['/adapters/x.mjs', ...detect]);
});

// ---------- AC-3: lean argv on the paths whose argv is ours ----------

test('driverArgv is lean: strict MCP with the teams server only, project settings, the driver\'s plugin dirs and not a manager judge\'s', () => withoutOverrides(() => {
  for (const argv of [driverArgv(null), driverArgv(taskWith({}), { harness: true })]) {
    assertLean(argv, 'driver');
    assert.ok(argv.slice(0, 8).join(' ') === 'claude -p --output-format stream-json --verbose --dangerously-skip-permissions --setting-sources project');
    const dirs = dirsOf(argv);
    assert.ok(dirs.includes('teams'), 'the teams plugin itself');
    assert.ok(dirs.every((d) => d === 'teams' || referencedPlugins().includes(d) || ['graph', 'harness'].includes(d)), `only plugins the graph's method tables name: ${dirs}`);
  }
  assert.deepEqual(dirsOf(driverArgv(null)).sort(), ['teams', ...referencedPlugins()].sort(), 'the driver runs every graph stage: exactly their plugins, no installed extras');
  const harness = dirsOf(driverArgv(taskWith({}), { harness: true }));
  assert.ok(harness.includes('graph') && harness.includes('harness'), `the size-S harness driver keeps its own plugins: ${harness}`);
  assert.ok(!dirsOf(driverArgv(null)).includes('harness'));
}));

test('judgeArgv is lean and mounts only the plugins of the stage it judges', () => withoutOverrides(() => {
  const shape = judgeArgv(taskWith({}), { node_id: 'shape:1', stage: 'shape' });
  assertLean(shape, 'judge shape');
  assert.deepEqual(dirsOf(shape).sort(), ['develop', 'teams'], 'shape: domain-driven-design and architecture-designer live in develop');
  const goal = judgeArgv(taskWith({}), { node_id: 'gate:goal:1', stage: 'gate' });
  assertLean(goal, 'judge gate:goal');
  assert.deepEqual(dirsOf(goal).sort(), ['cognition', 'teams']);
  const any = dirsOf(judgeArgv(null));
  assert.ok(any.includes('develop') && any.includes('think'), `no node: every manager stage's plugins, as before: ${any}`);
}));

// ---------- AC-13: the overrides still replace the whole command line ----------

test('HARNESS_CHILD_DRIVER and HARNESS_JUDGE_DRIVER still replace the command line; no lean args, no resolved model', () => withoutOverrides(() => {
  process.env.HARNESS_CHILD_DRIVER = 'node child-stub.mjs --x';
  assert.deepEqual(driverArgv(taskWith({ driver: 'opus' })), ['node', 'child-stub.mjs', '--x']);
  process.env.HARNESS_JUDGE_DRIVER = 'node judge-stub.mjs';
  assert.deepEqual(judgeArgv(taskWith({}), { node_id: 'shape:1', stage: 'shape' }), ['node', 'judge-stub.mjs']);
  assert.deepEqual(judgeArgv(taskWith({}, { model: 'haiku' }), { node_id: 'shape:1', stage: 'shape' }), ['node', 'judge-stub.mjs', '--model', 'haiku'],
    'tm_open\'s model is still forwarded to a stub, as the spawn site did before');
  process.env.HARNESS_ANSWER_DRIVER = 'node answer-stub.mjs a';
  assert.deepEqual(answerArgv({}), ['node', 'answer-stub.mjs', 'a']);
  assert.deepEqual(answerArgv({ child_opts: { model: 'haiku' } }), ['node', 'answer-stub.mjs', 'a', '--model', 'haiku']);
}));

// ---------- broker-tools adapter nodes: model, ledger, one process per node ----------

const call = (name, args, ctx) => callBrokerTool(name, args, ctx);
const SPEC = { goal: 'G', acceptance: ['A'], subgoals: [{ id: 'U1', title: 'first', acceptance: ['a'], test: ['t'], deps: [], files: ['big.mjs'] }] };
const OBSERVED_EVENTS = [
  { type: 'assistant', message: { id: 'm1', usage: { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 } } },
  { type: 'assistant', message: { id: 'm2', usage: { input_tokens: 50, cache_read_input_tokens: 1500, cache_creation_input_tokens: 50 } } },
  { type: 'result', num_turns: 2, usage: { input_tokens: 150, cache_read_input_tokens: 2400, cache_creation_input_tokens: 50 } },
].map((e) => JSON.stringify(e)).join('\n') + '\n';

// A project-registered `claude` vendor that is a stand-in script: it logs its argv and pid, writes
// a claude-shaped events stream, and answers each stage with a valid result.
async function withClaudeVendor(fn, { teamJson } = {}) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'node-launch-')));
  const savedVendors = process.env.BROKER_VENDORS;
  delete process.env.BROKER_VENDORS;
  try {
    const adapter = join(cwd, 'stand-in-adapter.mjs');
    writeFileSync(adapter, `
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const a = process.argv.slice(2), get = (k) => a[a.indexOf(k) + 1];
const cwd = get('--cwd'), output = get('--output');
if (a.includes('--detect')) { writeFileSync(output, JSON.stringify({ vendor: { ready: true, reachable: true } })); process.exit(0); }
const prompt = readFileSync(get('--prompt-file'), 'utf8');
const stage = prompt.match(/^# (\\w+) node/)[1];
appendFileSync(join(cwd, 'invocations.jsonl'), JSON.stringify({ stage, pid: process.pid, args: a, prompt }) + '\\n');
writeFileSync(get('--events-output'), ${JSON.stringify(OBSERVED_EVENTS)});
const result = { stage_ok: true, handoff: 'h', evidence: 'e', changed_files: [], checks: ['c -> pass'], verified: true, sound: true, accept: true, match_pct: 100, gaps: [] };
if (stage === 'setgoal') result.spec = ${JSON.stringify(SPEC)};
writeFileSync(output, JSON.stringify({ stage_ok: true, result }));
`);
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    writeFileSync(join(cwd, '.claude', 'broker-vendors.json'), JSON.stringify({
      claude: { command: process.execPath, args: [adapter], requires_binary: null, sandboxes: ['read-only', 'workspace-write'], default_sandbox: 'workspace-write' },
    }));
    if (teamJson) writeFileSync(join(cwd, '.claude', 'team.json'), JSON.stringify(teamJson));
    return await fn(cwd);
  } finally {
    if (savedVendors === undefined) delete process.env.BROKER_VENDORS; else process.env.BROKER_VENDORS = savedVendors;
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function runNodes(cwd, open = {}, nodeIds = ['plan', 'setgoal', 'critique', 'implement:U1:1']) {
  const { run_id } = await call('team_open', { request: 'r', cwd, vendor: 'claude', allocation: 'balanced', host_vendor: 'codex', flow: 'develop', goal_judges: 1, ...open });
  for (const node_id of nodeIds) {
    await call('team_next', { run_id, cwd });
    const v = await call('team_run', { run_id, cwd, node_id });
    assert.equal(v.state, 'done', `${node_id}: ${JSON.stringify(v)}`);
  }
  const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return {
    run_id,
    invocations: lines(join(cwd, 'invocations.jsonl')),
    ledger: lines(join(cwd, '.teams_output', 'broker', 'ledger.jsonl')),
  };
}

test('broker adapter nodes: the spawn argv always carries one --model by stage (implement sonnet, plan/setgoal/critique opus) and only flags the adapter accepts', () => withClaudeVendor(async (cwd) => {
  const { invocations } = await runNodes(cwd);
  assert.deepEqual(invocations.map((i) => [i.stage, modelsOf(i.args)]), [
    ['plan', ['opus']], ['setgoal', ['opus']], ['critique', ['opus']], ['implement', ['sonnet']],
  ]);
  for (const { stage, args } of invocations) {
    for (const f of args.filter((a) => a.startsWith('--'))) assert.ok(ADAPTER_FLAGS.has(f), `${stage}: the adapter would refuse ${f}`);
  }
}));

test('broker adapter nodes: team.json models.<stage> is honoured, and a run-level model still wins', () => withClaudeVendor(async (cwd) => {
  const { invocations } = await runNodes(cwd, {}, ['plan']);
  assert.deepEqual(modelsOf(invocations[0].args), ['haiku']);
}, { teamJson: { models: { plan: 'haiku' } } }).then(() => withClaudeVendor(async (cwd) => {
  const { invocations } = await runNodes(cwd, { model: 'pinned-model' }, ['plan']);
  assert.deepEqual(modelsOf(invocations[0].args), ['pinned-model']);
}, { teamJson: { models: { plan: 'haiku' } } })));

test('node_start is written through record() before the spawn and names the node, stage and resolved model', () => withClaudeVendor(async (cwd) => {
  const { run_id, ledger, invocations } = await runNodes(cwd);
  const starts = ledger.filter((e) => e.event === 'node_start');
  assert.deepEqual(starts.map((e) => [e.node_id, e.stage, e.model]), [
    ['plan', 'plan', 'opus'], ['setgoal', 'setgoal', 'opus'], ['critique', 'critique', 'opus'], ['implement:U1:1', 'implement', 'sonnet'],
  ]);
  assert.ok(starts.every((e) => e.run_id === run_id && typeof e.ts === 'number'));
  for (const [i, s] of starts.entries()) {
    const at = ledger.indexOf(s);
    const end = ledger.findIndex((e, j) => j > at && e.event === 'node_end' && e.node_id === s.node_id);
    assert.ok(end > at, `${s.node_id}: node_end follows node_start`);
    assert.deepEqual(modelsOf(invocations[i].args), [s.model], 'the recorded model is the one the spawn carried');
  }
}));

test('node_end carries the call count and the peak context of that node\'s stream', () => withClaudeVendor(async (cwd) => {
  const { ledger } = await runNodes(cwd, {}, ['plan']);
  const [end] = ledger.filter((e) => e.event === 'node_end');
  assert.equal(end.node_id, 'plan');
  assert.equal(end.stage, 'plan');
  assert.equal(end.model, 'opus');
  assert.equal(end.api_calls, 2);
  assert.equal(end.peak_context_tokens, 1600, 'the largest input + cache_read + cache_creation of one call');
}));

test('node_end with no readable usage records null values and never fails the node', () => withClaudeVendor(async (cwd) => {
  const adapter = join(cwd, 'stand-in-adapter.mjs');
  writeFileSync(adapter, readFileSync(adapter, 'utf8').replace(/writeFileSync\(get\('--events-output'\), .*\);/, ''));
  const { ledger } = await runNodes(cwd, {}, ['plan']);
  const [end] = ledger.filter((e) => e.event === 'node_end');
  assert.deepEqual([end.api_calls, end.peak_context_tokens], [null, null]);
}));

// ---------- AC-5: one process per node ----------

test('two consecutive nodes of one run spawn two separate adapter processes (distinct pids)', () => withClaudeVendor(async (cwd) => {
  const { invocations } = await runNodes(cwd, {}, ['plan', 'setgoal']);
  assert.equal(invocations.length, 2);
  assert.notEqual(invocations[0].pid, invocations[1].pid);
}));

test('two consecutive runAdapter calls are two spawn calls with two pids (stubbed spawn)', async () => {
  const s = stubSpawn();
  await runAdapter(VENDOR, ['--stage', 'implement'], '/w', { stage: 'implement', spawn: s.spawn });
  await runAdapter(VENDOR, ['--stage', 'test'], '/w', { stage: 'test', spawn: s.spawn });
  assert.equal(s.calls.length, 2);
  assert.notEqual(s.calls[0].pid, s.calls[1].pid);
});

// ---------- AC-6, AC-8: the prompt ----------

function promptFor(files, opts) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'node-launch-prompt-')));
  try {
    const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    writeFileSync(join(cwd, 'big.mjs'), lines(REGION_THRESHOLD_LINES + 100));
    writeFileSync(join(cwd, 'edge.mjs'), lines(REGION_THRESHOLD_LINES));
    writeFileSync(join(cwd, 'small.mjs'), lines(10));
    const run = { cwd, request: 'r', context: '', allocation: 'ordered' };
    const briefing = { upstream: [], subgoal: { id: 'U1', title: 't', kind: 'subgoal', files, acceptance: ['a'], test: ['t'] } };
    return composePrompt(run, { node_id: 'implement:U1:1', stage: 'implement', subgoal_id: 'U1' }, briefing, opts);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

test('composePrompt: a required file over the threshold becomes a region pointer, one at or under it stays a whole-file reference', () => {
  const prompt = promptFor(['big.mjs', 'edge.mjs', 'small.mjs', 'gone.mjs'], { regionPointer });
  const paths = prompt.slice(prompt.indexOf('Required paths:'), prompt.indexOf('### Acceptance'));
  assert.match(paths, new RegExp(`- big\\.mjs:L1-L${REGION_THRESHOLD_LINES + 100}\\b`), 'a pointer, with the line range');
  assert.doesNotMatch(paths, /- big\.mjs\n/, 'no bare whole-file reference for the big file');
  assert.match(paths, /- edge\.mjs\n/, 'exactly at the threshold is still a whole file');
  assert.match(paths, /- small\.mjs\n/);
  assert.match(paths, /- gone\.mjs\n/, 'a file that does not exist yet (the node will create it) is listed as given');
});

test('composePrompt without a regionPointer lists every path as given (prompts.mjs cannot import nodelaunch.mjs: a cycle through stagecontract)', () => {
  const paths = (p) => p.slice(p.indexOf('Required paths:'), p.indexOf('### Acceptance'));
  assert.match(paths(promptFor(['big.mjs'])), /- big\.mjs\n/);
});

test('team_run writes the adapter prompt with region pointers: the node\'s own prompt file points at the range, not the whole file', () => withClaudeVendor(async (cwd) => {
  writeFileSync(join(cwd, 'big.mjs'), Array.from({ length: REGION_THRESHOLD_LINES + 50 }, (_, i) => `l${i}`).join('\n') + '\n');
  const { invocations } = await runNodes(cwd, {}, ['plan', 'setgoal', 'critique', 'implement:U1:1']);
  const prompt = invocations.at(-1).prompt;
  assert.match(prompt, new RegExp(`- big\\.mjs:L1-L${REGION_THRESHOLD_LINES + 50}\\b`));
}));

test('composePrompt states that a node needing more context asks the leader with tm_ask, and that the ask is logged', () => {
  const prompt = promptFor(['small.mjs']);
  assert.match(prompt, /tm_ask/);
  assert.match(prompt, /logged/);
});

// ---------- AC-8: the lean argv keeps tm_ask reachable; the adapter path is the named partial ----------

test('tm_ask is reachable from a lean driver and judge: the one teams server (tm_* and team_* tools) is attached under --strict-mcp-config', () => withoutOverrides(() => {
  for (const argv of [driverArgv(null), judgeArgv(null)]) {
    const cfg = JSON.parse(valuesOf(argv, '--mcp-config')[0]);
    assert.equal(cfg.mcpServers.teams.command, process.execPath);
    assert.ok(existsSync(cfg.mcpServers.teams.args[0]), 'the server script exists');
  }
}));

test('PARTIAL: the claude adapter (outside this package) keeps its own strict, wiki-only MCP config - no tm_ask, no plugin dirs, no setting-sources for an adapter node', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'node-launch-adapter-')));
  try {
    const bin = join(dir, 'claude');
    writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs');
let p = ''; process.stdin.on('data', (c) => { p += c; });
process.stdin.on('end', () => { fs.writeFileSync('observed.json', JSON.stringify({ args: process.argv.slice(2) })); console.log(JSON.stringify({ result: '{"stage_ok":true}' })); });
`);
    chmodSync(bin, 0o755);
    writeFileSync(join(dir, 'prompt.md'), 'x');
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
    delete env.TEAMS_WIKI_ROOT;
    const r = spawnSync(process.execPath, [ADAPTER, '--cwd', dir, '--output', join(dir, 'out.json'), '--prompt-file', join(dir, 'prompt.md'), '--sandbox', 'read-only', '--model', 'opus'], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    const { args } = JSON.parse(readFileSync(join(dir, 'observed.json'), 'utf8'));
    assert.ok(args.includes('--strict-mcp-config'), 'the adapter already runs strict');
    assert.deepEqual(modelsOf(args), ['opus'], 'the explicit model reaches the adapter\'s own claude argv');
    assert.deepEqual(JSON.parse(valuesOf(args, '--mcp-config')[0]), { mcpServers: {} }, 'unmet: no teams server, so no tm_ask');
    assert.ok(!args.includes('--plugin-dir') && !args.includes('--setting-sources'), 'unmet: no stage plugin dirs or settings limit');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the broker tool table is unchanged: no tool schema moved with this wiring', () => {
  assert.deepEqual(BROKER_TOOLS.map((t) => t.name), ['team_open', 'team_next', 'team_run', 'team_submit', 'team_retry', 'team_status']);
});
