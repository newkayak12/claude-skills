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
// The adapter paths (broker-tools adapter argv, runAdapter) reach claude through
// teams/adapters/claude-exec-adapter.mjs, which takes the lean flags additively (--setting-sources,
// repeatable --plugin-dir, --mcp-config). Their final `claude` argv is captured here by a stub
// claude binary behind the real adapter.
//
// What is proved and what is not (named, not faked):
//   - tm_ask from an adapter node: the lean --mcp-config declares the teams server, which lists
//     tm_ask, and the adapter allows mcp__teams__tm_ask. The prompt carries the exact task_id and
//     key. A stand-in model calls the real tm_ask from inside team_run's adapter session: the ask is
//     logged, team_run parks the node (pending, not failed, node_parked in the ledger), the daemon's
//     answer unparks it, and the node's next session carries the answer in its prompt. NOT proved:
//     a real claude deciding to call tm_ask (the stand-in plays the model); PARTIAL.
//   - A2.2: a child driver drives ONE node and ends its turn (driverPrompt); the manager starts a
//     fresh driver process for the next node when the run moved on (serviceDeadDriver, no restart
//     spent). Proved with a stand-in driver: two consecutive nodes, two driver processes, distinct
//     pids. NOT proved: a real claude driver obeying the one-node instruction; PARTIAL. Ready nodes
//     of one run are now taken one driver at a time, so parallel nodes no longer overlap.
//   - NOT met anywhere: the user's global CLAUDE.md. `--setting-sources project` leaves it in the
//     start context and no flag drops it alone (nodelaunch.mjs header), so no test claims it.

process.env.TEAMS_RUNS_DIR ??= 'off';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { driverArgv } from '../mcp/taskmanager-drivers.mjs';
import { answerArgv, judgeArgv } from '../mcp/daemon.mjs';
import { loadVendors, probeCache, runAdapter } from '../mcp/broker-vendors.mjs';
import { loadRun, saveRun } from '../mcp/graph.mjs';
import { BROKER_TOOLS, callBrokerTool } from '../mcp/broker-tools.mjs';
import { composePrompt } from '../mcp/prompts.mjs';
import { REGION_THRESHOLD_LINES, regionPointer } from '../mcp/nodelaunch.mjs';
import { referencedPlugins } from '../mcp/pluginroots.mjs';

const ADAPTER = fileURLToPath(new URL('../adapters/claude-exec-adapter.mjs', import.meta.url));
const ADAPTER_FLAGS = new Set(['--detect', '--isolated', '--verify', '--no-wiki', '--add-dir', '--cwd', '--output', '--prompt-file', '--events-output', '--stage', '--sandbox', '--model', '--setting-sources', '--plugin-dir', '--mcp-config']);

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

// ---------- the claude adapter takes the lean flags additively ----------

// Runs the real adapter with a stub `claude` first on PATH; returns the argv and env the stub saw.
function adapterThroughStub(adapterArgs, env = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'node-launch-adapter-')));
  try {
    const bin = join(dir, 'claude');
    writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs');
let p = ''; process.stdin.on('data', (c) => { p += c; });
process.stdin.on('end', () => { fs.writeFileSync(${JSON.stringify(join(dir, 'observed.json'))}, JSON.stringify({ args: process.argv.slice(2), wikiOff: process.env.TEAMS_WIKI_OFF || null })); console.log(JSON.stringify({ result: '{"stage_ok":true}' })); });
`);
    chmodSync(bin, 0o755);
    writeFileSync(join(dir, 'prompt.md'), 'x');
    const full = { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...env };
    if (!('TEAMS_WIKI_ROOT' in env)) delete full.TEAMS_WIKI_ROOT;
    const r = spawnSync(process.execPath, [ADAPTER, '--cwd', dir, '--output', join(dir, 'out.json'), '--prompt-file', join(dir, 'prompt.md'), ...adapterArgs], { encoding: 'utf8', env: full });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(readFileSync(join(dir, 'observed.json'), 'utf8'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('claude adapter: with none of the lean flags its claude argv is what it always was (strict, an empty MCP config, no plugin dirs)', () => {
  const { args, wikiOff } = adapterThroughStub(['--sandbox', 'read-only', '--model', 'opus']);
  assert.ok(args.includes('--strict-mcp-config'));
  assert.deepEqual(modelsOf(args), ['opus']);
  assert.deepEqual(JSON.parse(valuesOf(args, '--mcp-config')[0]), { mcpServers: {} });
  assert.ok(!args.includes('--plugin-dir') && !args.includes('--setting-sources') && !args.includes('--allowedTools'));
  assert.equal(wikiOff, null);
});

test('claude adapter: --mcp-config replaces the MCP config once (still strict), --setting-sources and each --plugin-dir are passed on, tm_ask is allowed', () => {
  const cfg = JSON.stringify({ mcpServers: { teams: { command: 'node', args: ['/teams/mcp/server.mjs'] } } });
  const { args, wikiOff } = adapterThroughStub(['--sandbox', 'read-only', '--no-wiki', '--model', 'opus', '--setting-sources', 'project', '--plugin-dir', '/p/teams', '--plugin-dir', '/p/develop', '--mcp-config', cfg]);
  assert.ok(args.includes('--strict-mcp-config'));
  assert.deepEqual(valuesOf(args, '--mcp-config'), [cfg]);
  assert.deepEqual(valuesOf(args, '--setting-sources'), ['project']);
  assert.deepEqual(valuesOf(args, '--plugin-dir'), ['/p/teams', '/p/develop']);
  assert.deepEqual(valuesOf(args, '--allowedTools'), ['mcp__teams__tm_ask']);
  assert.equal(wikiOff, '1', 'a judging stage (--no-wiki) never sees wiki_* on the lean teams server');
});

test('claude adapter: a worker with a wiki root gets the wiki tools beside tm_ask, and the wiki stays on', () => {
  const cfg = JSON.stringify({ mcpServers: { teams: { command: 'node', args: ['/teams/mcp/server.mjs'] } } });
  const { args, wikiOff } = adapterThroughStub(['--sandbox', 'workspace-write', '--mcp-config', cfg], { TEAMS_WIKI_ROOT: '/proj' });
  const allowed = valuesOf(args, '--allowedTools')[0].split(',');
  assert.ok(allowed.includes('mcp__teams__tm_ask') && allowed.includes('mcp__teams__wiki_search'));
  assert.equal(wikiOff, null);
});

// ---------- AC-X1 .. AC-X3: the final claude argv of a graph node, behind the real adapter ----------

// The builtin claude vendor (the real adapter) with a stub `claude` first on PATH. The stub logs its
// pid, argv and env per call to invocations.jsonl and answers each stage with a valid result.
async function withStubClaude(fn, { env = {} } = {}) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'node-launch-real-')));
  // CLAUDE_PLUGIN_ROOT is off so the plugin root is this checkout's teams/ (see withoutOverrides).
  const saved = Object.fromEntries(['PATH', 'BROKER_VENDORS', 'TEAMS_WIKI_ROOT', 'TEAMS_ASK_TASK_ID', 'CLAUDE_PLUGIN_ROOT'].map((k) => [k, process.env[k]]));
  try {
    mkdirSync(join(cwd, 'bin'));
    writeFileSync(join(cwd, 'bin', 'claude'), `#!/usr/bin/env node
const fs = require('node:fs');
let prompt = ''; process.stdin.on('data', (c) => { prompt += c; });
process.stdin.on('end', () => {
  const stage = (prompt.match(/^# (\\w+) node/) || [])[1];
  fs.appendFileSync(${JSON.stringify(join(cwd, 'invocations.jsonl'))}, JSON.stringify({ stage, pid: process.pid, args: process.argv.slice(2), wikiOff: process.env.TEAMS_WIKI_OFF || null, prompt }) + '\\n');
  const result = { stage_ok: true, handoff: 'h', evidence: 'e', changed_files: [], checks: ['c -> pass'], verified: true, sound: true, accept: true, match_pct: 100, gaps: [] };
  if (stage === 'setgoal') result.spec = ${JSON.stringify(SPEC)};
  console.log(JSON.stringify({ type: 'result', result: JSON.stringify(result), num_turns: 1, usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 } }));
});
`);
    chmodSync(join(cwd, 'bin', 'claude'), 0o755);
    process.env.PATH = `${join(cwd, 'bin')}:${process.env.PATH}`;
    delete process.env.BROKER_VENDORS;
    delete process.env.TEAMS_WIKI_ROOT;
    delete process.env.TEAMS_ASK_TASK_ID;
    delete process.env.CLAUDE_PLUGIN_ROOT;
    Object.assign(process.env, env);
    // Readiness is answered from the cache, so no probe (a paid claude call) runs: the key holds
    // the vendor, the cwd, the sandbox and the model routing picks ('sonnet' balanced, else none).
    for (const sandbox of ['read-only', 'workspace-write', 'danger-full-access']) {
      for (const model of ['default', 'sonnet']) probeCache.set(['claude', cwd, sandbox, model].join(' '), Promise.resolve({ ready: true, reachable: true, reason: '', quota: false }));
    }
    return await fn(cwd);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    for (const k of Object.keys(env)) { if (!(k in saved)) delete process.env[k]; }
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('AC-X1: a graph node\'s final claude argv is lean - strict MCP, the teams server alone, project settings, the teams root plus that stage\'s plugin dirs', () => withStubClaude(async (cwd) => {
  const { invocations } = await runNodes(cwd);
  assert.deepEqual(invocations.map((i) => i.stage), ['plan', 'setgoal', 'critique', 'implement']);
  for (const { stage, args } of invocations) {
    assertLean(args, `node ${stage}`);
    for (const f of args.filter((a) => a.startsWith('--'))) assert.ok(ADAPTER_FLAGS.has(f) || ['-p', '--output-format', '--no-session-persistence', '--strict-mcp-config', '--tools', '--permission-mode', '--allowedTools'].includes(f), `${stage}: unexpected claude flag ${f}`);
    assert.deepEqual(valuesOf(args, '--allowedTools').join(',').split(',').filter((t) => t === 'mcp__teams__tm_ask'), ['mcp__teams__tm_ask'], `${stage}: tm_ask is allowed`);
  }
  // the plugin dirs follow each node's own Method, never every installed plugin
  const dirs = Object.fromEntries(invocations.map((i) => [i.stage, dirsOf(i.args).sort()]));
  assert.deepEqual(dirs.plan, ['agents', 'teams'], 'plan: agents:agent-task-decomposer');
  assert.deepEqual(dirs.setgoal, ['teams'], 'setgoal mounts no skill');
  assert.deepEqual(dirs.critique, ['teams', 'think'], 'critique: think:devils-advocate');
  assert.deepEqual(dirs.implement, ['develop', 'teams'], 'implement: develop:clean-code');
  assert.deepEqual(invocations.map((i) => modelsOf(i.args)), [['opus'], ['opus'], ['opus'], ['sonnet']], 'the explicit model still rides next to the lean flags');
}));

test('AC-X1: --setting-sources project is the only settings source, so the user scope is not read', () => withStubClaude(async (cwd) => {
  const { invocations } = await runNodes(cwd, {}, ['plan']);
  assert.deepEqual(valuesOf(invocations[0].args, '--setting-sources'), ['project']);
}));

test('a node behind a judging stage gets no wiki on the lean teams server; its tm_ask stays allowed', () => withStubClaude(async (cwd) => {
  const { invocations } = await runNodes(cwd, {}, ['plan', 'setgoal', 'critique']);
  assert.equal(invocations[2].stage, 'critique');
  assert.equal(invocations[2].wikiOff, '1');
}));

test('A2.2 at the session boundary: two consecutive nodes of one run are two claude processes (distinct pids, one spawn each)', () => withStubClaude(async (cwd) => {
  const { invocations } = await runNodes(cwd, {}, ['plan', 'setgoal']);
  assert.equal(invocations.length, 2);
  assert.notEqual(invocations[0].pid, invocations[1].pid);
}));

test('runAdapter forwards the lean flags next to the model for the builtin claude adapter only; a vendor already carrying --mcp-config, another adapter, and the detect path are left as they are', () => withoutOverrides(async () => {
  const claude = loadVendors('/w').claude;
  const s = stubSpawn();
  await runAdapter(claude, ['--cwd', '/w'], '/w', { stage: 'implement', lean: { stage_skills: { implement: ['develop:clean-code'] } }, spawn: s.spawn });
  const args = s.calls[0].args;
  assert.deepEqual(modelsOf(args), ['sonnet']);
  assert.ok(!args.includes('--strict-mcp-config'), 'the adapter takes no such flag: it is strict by itself (AC-X1 reads the claude argv behind it)');
  assert.deepEqual(valuesOf(args, '--setting-sources'), ['project']);
  assert.deepEqual(dirsOf(args).sort(), ['develop', 'teams']);
  assert.deepEqual(Object.keys(JSON.parse(valuesOf(args, '--mcp-config')[0]).mcpServers), ['teams']);

  await runAdapter(claude, ['--cwd', '/w', '--mcp-config', '{}'], '/w', { stage: 'implement', lean: {}, spawn: s.spawn });
  assert.deepEqual(valuesOf(s.calls[1].args, '--mcp-config'), ['{}'], 'already carried: not added twice');
  await runAdapter(VENDOR, ['--cwd', '/w'], '/w', { stage: 'implement', lean: {}, spawn: s.spawn });
  assert.ok(!s.calls[2].args.includes('--strict-mcp-config') && !s.calls[2].args.includes('--plugin-dir'), 'another adapter gets the model only');
  assert.deepEqual(modelsOf(s.calls[2].args), ['sonnet']);
  const detect = ['--detect', '--cwd', '/w', '--sandbox', 'read-only', '--output', '/w/p.json'];
  await runAdapter(claude, detect, '/w', { timeoutMs: 1000, spawn: s.spawn });
  assert.deepEqual(s.calls[3].args, [...claude.args, ...detect], 'the probe path stays byte-identical');
}));

// ---------- tm_ask from an adapter node ----------

test('tm_ask is reachable from an adapter node: the lean --mcp-config declares the teams server, and that server lists tm_ask and team_*', () => withStubClaude(async (cwd) => {
  const { invocations } = await runNodes(cwd, {}, ['plan']);
  const server = JSON.parse(valuesOf(invocations[0].args, '--mcp-config')[0]).mcpServers.teams;
  const r = spawnSync(server.command, server.args, {
    input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n', encoding: 'utf8', env: { ...process.env },
  });
  const names = JSON.parse(r.stdout.trim().split('\n')[0]).result.tools.map((t) => t.name);
  assert.ok(names.includes('tm_ask') && names.includes('team_next') && names.includes('team_run'), 'the one teams server serves both');
}));

test('a package child\'s prompt carries the exact tm_ask call (task_id and key); with no task known it states the generic rule', () => withStubClaude(async (cwd) => {
  const task_id = '1a2b0001-1111-2222-3333-444444444444';
  process.env.TEAMS_ASK_TASK_ID = task_id;
  const { run_id } = await call('team_open', { request: 'r', cwd, vendor: 'claude', allocation: 'balanced', host_vendor: 'codex', flow: 'develop', goal_judges: 1 });
  const run = loadRun(cwd, run_id);
  run.package = { id: 'P1', origin: 'shape' };
  saveRun(run);
  await call('team_next', { run_id, cwd });
  await call('team_run', { run_id, cwd, node_id: 'plan' });
  const prompt = readFileSync(join(cwd, 'invocations.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))[0].prompt;
  assert.ok(prompt.includes(`tm_ask({task_id: "${task_id}", key: "E-1a2b0001/P1", question})`), 'the node is told the call it makes');
  assert.match(prompt, /logged/);
}).then(() => withStubClaude(async (cwd) => {
  const { invocations } = await runNodes(cwd, {}, ['plan']);
  assert.doesNotMatch(invocations[0].prompt, /tm_ask\(\{task_id/);
  assert.match(invocations[0].prompt, /ask the leader with tm_ask/);
})));

test('a tm_ask with the prompt\'s task_id and key is logged and parks the STORY; the answer unparks it and resumes the driver with it (taskmanager-asks.mjs, under test)', async () => {
  const keys = ['HARNESS_TASKS_DIR', 'HARNESS_TEST_NO_DAEMON', 'HARNESS_TEST_NO_DRIVER', 'HARNESS_CHILD_DRIVER', 'STUB_LOG'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'node-launch-ask-')));
  try {
    process.env.HARNESS_TASKS_DIR = root;
    process.env.HARNESS_TEST_NO_DAEMON = '1';
    delete process.env.HARNESS_TEST_NO_DRIVER;
    process.env.STUB_LOG = join(root, 'driver-calls.jsonl');
    writeFileSync(join(root, 'driver.mjs'), "import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.STUB_LOG, JSON.stringify({ argv: process.argv.slice(2) }) + '\\n');\nsetTimeout(() => {}, 1500);\n");
    process.env.HARNESS_CHILD_DRIVER = `node ${join(root, 'driver.mjs')}`;
    const tm = await import('../mcp/taskmanager.mjs');
    const graph = await import('../mcp/graph.mjs');
    const daemon = await import('../mcp/daemon.mjs');
    const { storyKey } = await import('../mcp/tickets.mjs');

    const task_id = '1a2b0002-1111-2222-3333-444444444444';
    const childCwd = mkdtempSync(join(root, 'wt-'));
    mkdirSync(join(childCwd, '.teams_output', 'broker', 'runs'), { recursive: true });
    writeFileSync(join(childCwd, '.teams_output', 'broker', 'runs', 'c1.json'), JSON.stringify({ run_id: 'c1', flow: 'develop', max_retries: 2, cwd: childCwd, spec: { subgoals: [{ id: 'U1', title: 'unit' }] }, nodes: [graph.node('implement:U1:1', 'implement', [], { state: 'pending', subgoal_id: 'U1' })] }));
    const path = tm.taskPath(task_id);
    mkdirSync(dirname(path), { recursive: true });
    const done = (id, stage, deps) => graph.node(id, stage, deps, { state: 'done', result: { stage_ok: true } });
    writeFileSync(path, JSON.stringify({
      run_id: task_id, kind: 'task', store_path: path, cwd: root, request: 'r', created_at: Date.now(), flow: 'develop', flow_chosen: 'develop', size: 'L', max_retries: 2, driver_restarts: 2,
      spec: { acceptance: ['a'], packages: [{ id: 'P1', title: 'module a', flow: 'develop', brief: 'b', acceptance: ['a'], touches: ['a.txt'], deps: [] }] },
      nodes: [done('size', 'size', []), done('shape', 'shape', ['size']), done('critique', 'critique', ['shape']),
        graph.node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', state: 'running', child: { run_id: 'c1', cwd: childCwd, driver: { pid: 2 ** 22 + 777, restarts: [], started_at: Date.now() - 1000 } } }),
        graph.node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1' })],
    }, null, 2));

    // the key a node is handed is the one broker-tools derives from the package id and the task id
    const key = storyKey(task_id, 'P1');
    const out = await tm.callTool('tm_ask', { task_id, key, question: 'cents or dollars?' });
    assert.equal(out.state, 'parked');
    const load = () => JSON.parse(readFileSync(path, 'utf8'));
    const ledger = () => readFileSync(join(tm.taskDir(task_id), 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const asked = ledger().filter((e) => e.event === 'asked');
    assert.deepEqual(asked.map((e) => [e.key, e.question, e.ask_id]), [[key, 'cents or dollars?', out.ask_id]], 'the ask is logged');
    const parked = load();
    const n = parked.nodes.find((x) => x.node_id === 'dispatch:P1:1');
    assert.equal(tm.serviceDeadDriver(parked, n.child, n.node_id), false, 'parked: the dead driver is not restarted');
    assert.equal(tm.dispatchSettled(parked, n), false, 'parked: the STORY is not folded');

    const callsFile = process.env.STUB_LOG;
    const calls = () => (existsSync(callsFile) ? readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
    assert.equal(calls().length, 0, 'nothing resumed while parked');
    await daemon.stepOnce(task_id, { judge: async () => { throw new Error('no judge expected'); }, answer: async () => JSON.stringify({ verdict: 'answer', answer: 'cents' }) });
    assert.equal(ledger().filter((e) => e.event === 'answered').length, 1, 'the answer is logged');
    const end = Date.now() + 6000;
    while (!calls().length && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls().length, 1, 'unparked: the driver is resumed once');
    assert.match(calls()[0].argv.at(-1), /cents/, 'with the answer in its prompt');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(root, { recursive: true, force: true });
  }
});

test('spawnChildDriver names the task to the adapter sessions of a package run (TEAMS_ASK_TASK_ID) and to nobody else', async () => {
  const { spawnChildDriver } = await import('../mcp/taskmanager-drivers.mjs');
  const saved = Object.fromEntries(['HARNESS_CHILD_DRIVER', 'HARNESS_TASKS_DIR', 'TEAMS_ASK_TASK_ID'].map((k) => [k, process.env[k]]));
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'node-launch-env-')));
  try {
    process.env.HARNESS_TASKS_DIR = root;
    process.env.TEAMS_ASK_TASK_ID = 'inherited-from-elsewhere';
    const out = join(root, 'env.jsonl');
    writeFileSync(join(root, 'driver.mjs'), `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(out)}, JSON.stringify({ id: process.env.TEAMS_ASK_TASK_ID || null }) + '\\n');\n`);
    process.env.HARNESS_CHILD_DRIVER = `node ${join(root, 'driver.mjs')}`;
    const task = { run_id: '1a2b0003-1111-2222-3333-444444444444', cwd: root, nodes: [{ node_id: 'dispatch:P1:1', stage: 'dispatch', subgoal_id: 'P1', child: { run_id: 'c1', cwd: root } }] };
    spawnChildDriver(task, 'dispatch:P1:1', task.nodes[0].child);
    spawnChildDriver(task, 'S', { run_id: 'size-s-run', cwd: root });
    const end = Date.now() + 6000;
    while ((!existsSync(out) || readFileSync(out, 'utf8').trim().split('\n').length < 2) && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    const ids = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l).id).sort();
    assert.deepEqual(ids, [null, task.run_id].sort(), 'the package run is told; a size-S run inherits nothing');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- one driver process per node (A2.2, the child driver loop) ----------

// A stand-in driver: reads the run it is told to continue, settles ONE pending node (unless
// STUB_NOOP), logs its pid and prompt, and exits 0 - what a driver that ends its turn after its node does.
const NODE_DRIVER = `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const prompt = process.argv.at(-1);
const m = prompt.match(/run_id (\\S+) at cwd (\\S+)\\. Do not/);
appendFileSync(process.env.STUB_LOG, JSON.stringify({ pid: process.pid, prompt }) + '\\n');
if (m && !process.env.STUB_NOOP) {
  const file = join(m[2], '.teams_output', 'broker', 'runs', m[1] + '.json');
  const run = JSON.parse(readFileSync(file, 'utf8'));
  const n = run.nodes.find((x) => x.state === 'pending');
  if (n) { n.state = 'done'; n.result = { stage_ok: true }; }
  writeFileSync(file, JSON.stringify(run));
}
`;

async function withNodeDrivers(fn) {
  const keys = ['HARNESS_TASKS_DIR', 'HARNESS_TEST_NO_DAEMON', 'HARNESS_TEST_NO_DRIVER', 'HARNESS_CHILD_DRIVER', 'STUB_LOG', 'STUB_NOOP', 'TEAMS_ASK_TASK_ID'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'node-launch-drv-')));
  try {
    process.env.HARNESS_TASKS_DIR = root;
    process.env.HARNESS_TEST_NO_DAEMON = '1';
    delete process.env.HARNESS_TEST_NO_DRIVER;
    delete process.env.STUB_NOOP;
    process.env.STUB_LOG = join(root, 'drivers.jsonl');
    writeFileSync(join(root, 'driver.mjs'), NODE_DRIVER);
    process.env.HARNESS_CHILD_DRIVER = `node ${join(root, 'driver.mjs')}`;
    const graph = await import('../mcp/graph.mjs');
    const childCwd = mkdtempSync(join(root, 'wt-'));
    mkdirSync(join(childCwd, '.teams_output', 'broker', 'runs'), { recursive: true });
    writeFileSync(join(childCwd, '.teams_output', 'broker', 'runs', 'c1.json'), JSON.stringify({
      run_id: 'c1', flow: 'develop', max_retries: 2, cwd: childCwd, spec: { subgoals: [{ id: 'U1', title: 'unit' }] },
      nodes: [graph.node('implement:U1:1', 'implement', [], { state: 'pending', subgoal_id: 'U1' }), graph.node('test:U1:1', 'test', ['implement:U1:1'], { state: 'pending', subgoal_id: 'U1' })],
    }));
    const child = { run_id: 'c1', cwd: childCwd };
    const node = { node_id: 'dispatch:P1:1', stage: 'dispatch', subgoal_id: 'P1', state: 'running', child };
    const task = { run_id: '1a2b0004-1111-2222-3333-444444444444', kind: 'task', cwd: root, driver_restarts: 2, nodes: [node] };
    const calls = () => (existsSync(process.env.STUB_LOG) ? readFileSync(process.env.STUB_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
    const exited = async (driver) => {
      const end = Date.now() + 8000;
      while (!existsSync(driver.exit) && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
      assert.ok(existsSync(driver.exit), 'the driver process exited');
    };
    const settled = () => loadRun(childCwd, 'c1').nodes.filter((x) => x.state === 'done').map((x) => x.node_id);
    return await fn({ task, node, child, calls, exited, settled });
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(root, { recursive: true, force: true });
  }
}

test('A2.2: a driver drives one node and ends its turn; the manager starts a fresh driver process for the next node, spending no restart', () => withNodeDrivers(async ({ task, node, child, calls, exited, settled }) => {
  const { spawnChildDriver, serviceDeadDriver } = await import('../mcp/taskmanager-drivers.mjs');
  child.driver = spawnChildDriver(task, node.node_id, child);
  const first = child.driver;
  await exited(first);
  assert.deepEqual(settled(), ['implement:U1:1'], 'driver 1 settled its one node');
  assert.equal(serviceDeadDriver(task, child, node.node_id), true, 'the run moved on: a driver for the next node is started');
  const second = child.driver;
  assert.notEqual(second.pid, first.pid, 'a separate process');
  assert.deepEqual(second.restarts, [], 'no restart spent: finishing a node is not a death');
  await exited(second);
  assert.deepEqual(settled(), ['implement:U1:1', 'test:U1:1'], 'driver 2 settled the next node');
  const seen = calls();
  assert.equal(seen.length, 2, 'two nodes, two driver spawns');
  assert.notEqual(seen[0].pid, seen[1].pid, 'two consecutive nodes: two driver processes (distinct pids)');
  assert.match(seen[0].prompt, /for ONE node only/, 'the driver is told to take one node and end its turn');
  assert.match(seen[1].prompt, /finished its node and ended its turn/);
  const ledger = readFileSync(join(process.env.HARNESS_TASKS_DIR, task.run_id, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(ledger.filter((e) => e.event === 'child_driver_next_node').length, 1);
  assert.equal(ledger.filter((e) => e.event === 'child_driver_restarted').length, 0);
}));

test('A2.2: a driver that exits with its run unmoved is still a death - the restart is counted', () => withNodeDrivers(async ({ task, node, child, calls, exited, settled }) => {
  const { spawnChildDriver, serviceDeadDriver } = await import('../mcp/taskmanager-drivers.mjs');
  process.env.STUB_NOOP = '1';
  child.driver = spawnChildDriver(task, node.node_id, child);
  await exited(child.driver);
  assert.deepEqual(settled(), []);
  assert.equal(serviceDeadDriver(task, child, node.node_id), true);
  assert.equal(child.driver.restarts.length, 1, 'no node finished, so this is a restart and spends the budget');
  await exited(child.driver);
  assert.equal(calls().length, 2);
}));

// ---------- a node that asks its leader parks, and runs again with the answer ----------

test('tm_ask from an adapter node: the ask is logged, the node parks (not failed), and the answer unparks it - the node reruns with the answer in its prompt', async () => {
  const keys = ['HARNESS_TASKS_DIR', 'HARNESS_TEST_NO_DAEMON', 'HARNESS_TEST_NO_DRIVER', 'HARNESS_CHILD_DRIVER', 'STUB_LOG'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'node-launch-park-')));
  const task_id = '1a2b0005-1111-2222-3333-444444444444';
  try {
    process.env.HARNESS_TASKS_DIR = root;
    process.env.HARNESS_TEST_NO_DAEMON = '1';
    delete process.env.HARNESS_TEST_NO_DRIVER;
    process.env.STUB_LOG = join(root, 'driver-calls.jsonl');
    writeFileSync(join(root, 'driver.mjs'), "import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.STUB_LOG, JSON.stringify({ argv: process.argv.slice(2) }) + '\\n');\nsetTimeout(() => {}, 1000);\n");
    process.env.HARNESS_CHILD_DRIVER = `node ${join(root, 'driver.mjs')}`;
    const tm = await import('../mcp/taskmanager.mjs');
    const graph = await import('../mcp/graph.mjs');
    const daemon = await import('../mcp/daemon.mjs');
    const { storyKey } = await import('../mcp/tickets.mjs');
    const tmUrl = new URL('../mcp/taskmanager.mjs', import.meta.url).href;

    await withStubClaude(async (cwd) => {
      const { run_id } = await call('team_open', { request: 'r', cwd, vendor: 'claude', allocation: 'balanced', host_vendor: 'codex', flow: 'develop', goal_judges: 1 });
      const run = loadRun(cwd, run_id);
      run.package = { id: 'P1', origin: 'shape' };
      saveRun(run);
      const path = tm.taskPath(task_id);
      mkdirSync(dirname(path), { recursive: true });
      const done = (id, stage, deps) => graph.node(id, stage, deps, { state: 'done', result: { stage_ok: true } });
      writeFileSync(path, JSON.stringify({
        run_id: task_id, kind: 'task', store_path: path, cwd: root, request: 'r', created_at: Date.now(), flow: 'develop', flow_chosen: 'develop', size: 'L', max_retries: 2, driver_restarts: 2,
        spec: { acceptance: ['a'], packages: [{ id: 'P1', title: 'module a', flow: 'develop', brief: 'b', acceptance: ['a'], touches: ['a.txt'], deps: [] }] },
        nodes: [done('size', 'size', []), done('shape', 'shape', ['size']), done('critique', 'critique', ['shape']),
          graph.node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', state: 'running', child: { run_id, cwd, driver: { pid: 2 ** 22 + 778, restarts: [], started_at: Date.now() - 1000 } } }),
          graph.node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1' })],
      }, null, 2));
      const key = storyKey(task_id, 'P1');

      // The stand-in model: the first run of `plan` calls the real tm_ask (a separate process,
      // like the teams MCP server a claude session talks to) and ends its turn parked; the run
      // that carries the answer delivers.
      writeFileSync(join(cwd, 'bin', 'claude'), `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
let prompt = ''; process.stdin.on('data', (c) => { prompt += c; });
process.stdin.on('end', () => {
  fs.appendFileSync(${JSON.stringify(join(cwd, 'invocations.jsonl'))}, JSON.stringify({ pid: process.pid, prompt }) + '\\n');
  let result = { stage_ok: true, handoff: 'planned with the answer', evidence: 'e' };
  if (!prompt.includes('## Answers to your tm_ask')) {
    const code = 'import(' + JSON.stringify(${JSON.stringify(tmUrl)}) + ').then(async (m) => { const r = await m.callTool("tm_ask", { task_id: ' + JSON.stringify(${JSON.stringify(task_id)}) + ', key: ' + JSON.stringify(${JSON.stringify(key)}) + ', question: "cents or dollars?" }); process.stdout.write(JSON.stringify(r)); })';
    const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: process.env });
    fs.appendFileSync(${JSON.stringify(join(cwd, 'asked.jsonl'))}, (r.stdout || r.stderr) + '\\n');
    result = { stage_ok: false, reason: 'parked on tm_ask' };
  }
  console.log(JSON.stringify({ type: 'result', result: JSON.stringify(result), num_turns: 1, usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 } }));
});
`);
      const invocations = () => readFileSync(join(cwd, 'invocations.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      const taskLedger = () => readFileSync(join(tm.taskDir(task_id), 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

      await call('team_next', { run_id, cwd });
      const parked = await call('team_run', { run_id, cwd, node_id: 'plan' });
      assert.equal(parked.parked, true, JSON.stringify(parked));
      assert.equal(parked.state, 'pending', 'parked, not failed: the node is run again, no retry spent');
      assert.match(invocations()[0].prompt, new RegExp(`tm_ask\\(\\{task_id: "${task_id}", key: "${key}"`), 'the node was told its exact call');
      const asked = taskLedger().filter((e) => e.event === 'asked');
      assert.deepEqual(asked.map((e) => [e.key, e.question]), [[key, 'cents or dollars?']], 'the ask is logged');
      assert.deepEqual(parked.ask_ids, [asked[0].ask_id]);
      const planNode = loadRun(cwd, run_id).nodes.find((x) => x.node_id === 'plan');
      assert.equal(planNode.state, 'pending');
      assert.deepEqual(planNode.parked_asks, [asked[0].ask_id]);
      const events = readFileSync(join(cwd, '.teams_output', 'broker', 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert.equal(events.filter((e) => e.event === 'node_parked' && e.node_id === 'plan').length, 1);
      const disk = JSON.parse(readFileSync(path, 'utf8'));
      const n = disk.nodes.find((x) => x.node_id === 'dispatch:P1:1');
      assert.equal(tm.serviceDeadDriver(disk, n.child, n.node_id), false, 'parked: the STORY is not restarted or folded');

      // answering unparks it
      await daemon.stepOnce(task_id, { judge: async () => { throw new Error('no judge expected'); }, answer: async () => JSON.stringify({ verdict: 'answer', answer: 'cents' }) });
      assert.equal(taskLedger().filter((e) => e.event === 'answered').length, 1, 'the answer is logged');
      await call('team_next', { run_id, cwd });
      const again = await call('team_run', { run_id, cwd, node_id: 'plan' });
      assert.equal(again.state, 'done', JSON.stringify(again));
      assert.equal(invocations().length, 2, 'a second session for the same node');
      assert.notEqual(invocations()[0].pid, invocations()[1].pid);
      assert.match(invocations()[1].prompt, /## Answers to your tm_ask\nQuestion: cents or dollars\?\nAnswer: cents/, 'the answer is in the node\'s own prompt');
    }, { env: { TEAMS_ASK_TASK_ID: task_id } });
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(root, { recursive: true, force: true });
  }
});

test('the broker tool table is unchanged: no tool schema moved with this wiring', () => {
  assert.deepEqual(BROKER_TOOLS.map((t) => t.name), ['team_open', 'team_next', 'team_run', 'team_submit', 'team_retry', 'team_status']);
});
