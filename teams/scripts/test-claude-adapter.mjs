import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const adapter = fileURLToPath(new URL('../adapters/claude-exec-adapter.mjs', import.meta.url));

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'claude-adapter-test-'));
  const binary = join(dir, 'claude');
  writeFileSync(binary, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
let prompt = '';
process.stdin.on('data', c => prompt += c);
process.stdin.on('end', () => {
  fs.writeFileSync('observed.json', JSON.stringify({args, prompt, cwd:process.cwd()}));
  if(process.env.MOCK_QUOTA) { console.log(JSON.stringify({is_error:true, result:"You've hit your limit"})); process.exit(1); }
  const permission_denials = process.env.MOCK_DENIALS ? JSON.parse(process.env.MOCK_DENIALS) : undefined;
  // MOCK_ERROR: an is_error envelope that still exits 0; MOCK_RESULT: the JSON reply the node gives.
  if(process.env.MOCK_ERROR) { console.log(JSON.stringify({is_error:true, result:'tool run failed', permission_denials})); return; }
  if(process.env.MOCK_PROSE) { console.log(JSON.stringify({result:'cannot do that', permission_denials})); return; }
  const run = prompt.match(/then return (\\S+): node -e "(.+)" (".+") (\\S+)$/);
  const read = prompt.match(/Return exactly (.+)\\. Do not/);
  if(run) {
    // MOCK_NO_BASH: the session answers but its Bash call needs approval (acceptEdits, headless).
    if(!process.env.MOCK_NO_BASH) require('node:child_process').execFileSync('node', ['-e', run[2], JSON.parse(run[3]), run[4]]);
    console.log(JSON.stringify({result:run[1]})); return;
  }
  if(read) { console.log(JSON.stringify({result:read[1]})); return; }
  const reply = process.env.MOCK_RESULT || JSON.stringify({stage_ok:true, verified:true, checks:['check -> passed'], evidence:'e'});
  console.log(JSON.stringify({result:reply, usage:{input_tokens:12,output_tokens:4}, permission_denials}));
});
`);
  chmodSync(binary, 0o755);
  writeFileSync(join(dir, 'prompt.md'), 'Execute this isolated stage.');
  return { dir, run(extra = [], env = {}) {
    const result = spawnSync('node', [adapter, '--cwd', dir, '--output', join(dir, 'result.json'), ...extra],
      { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...env } });
    return { ...result, report: JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8')) };
  } };
}

test('Claude adapter starts fresh, keeps cwd, uses explicit efficient model, and imposes no spending cap', () => {
  const f = fixture();
  try {
    const r = f.run(['--prompt-file', join(f.dir, 'prompt.md'), '--stage', 'test', '--events-output', join(f.dir, 'events.jsonl')], { TEAMS_WIKI_ROOT: undefined });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.report.stage_ok, true);
    assert.equal(r.report.usage.input_tokens, 12);
    const observed = JSON.parse(readFileSync(join(f.dir, 'observed.json')));
    assert.equal(realpathSync(observed.cwd), realpathSync(f.dir), 'same directory; macOS reports $TMPDIR under /private/var');
    assert.ok(observed.args.includes('--no-session-persistence'));
    assert.ok(observed.args.includes('--strict-mcp-config'));
    assert.equal(observed.args[observed.args.indexOf('--model') + 1], 'sonnet');
    assert.ok(!observed.args.some(a => /resume|continue|max-turns|max-budget|skip-permissions/.test(a)));
    assert.equal(observed.prompt, 'Execute this isolated stage.');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('Claude probes real writes and restricts read-only tool profile', () => {
  const f = fixture();
  try {
    assert.equal(f.run(['--detect']).report.vendor.ready, true);
    const r = f.run(['--detect', '--sandbox', 'read-only', '--model', 'explicit-model']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.report.vendor.reachable, true);
    assert.equal(r.report.vendor.ready, false);
    const args = JSON.parse(readFileSync(join(f.dir, 'observed.json'))).args;
    assert.equal(args[args.indexOf('--tools') + 1], 'Read,Glob,Grep');
    assert.equal(args[args.indexOf('--model') + 1], 'explicit-model');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('a workspace-write probe is ready only if the session can run a command, not just write a file', () => {
  const f = fixture();
  try {
    assert.equal(f.run(['--detect']).report.vendor.ready, true);
    const blocked = f.run(['--detect'], { MOCK_NO_BASH: '1' });
    assert.equal(blocked.report.vendor.reachable, true);
    assert.equal(blocked.report.vendor.ready, false, 'code-sprint-S3: Write worked, `node --test` needed approval');
    assert.match(blocked.report.vendor.reason, /could not run a command/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('Claude adapter retains quota diagnostics and rejects malformed stage output', () => {
  const f = fixture();
  try {
    const args = ['--prompt-file', join(f.dir, 'prompt.md')];
    const limited = f.run(args, { MOCK_QUOTA: '1' });
    assert.equal(limited.status, 1);
    assert.match(limited.report.last_message, /hit your limit/);
    assert.equal(f.run(args, { MOCK_PROSE: '1' }).status, 1);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('Claude accepts danger-full-access and bypasses the permission prompt there', () => {
  const f = fixture();
  try {
    const r = f.run(['--prompt-file', join(f.dir, 'prompt.md'), '--stage', 'test', '--sandbox', 'danger-full-access']);
    assert.equal(r.status, 0, r.stderr);
    const observed = JSON.parse(readFileSync(join(f.dir, 'observed.json')));
    assert.equal(observed.args[observed.args.indexOf('--permission-mode') + 1], 'bypassPermissions');
    assert.equal(observed.args[observed.args.indexOf('--tools') + 1], 'Read,Glob,Grep,Edit,Write,Bash');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

// P4:review:U1 (portfolio-refresh Sprint): a review node with no Bash split verified:true/
// false across three attempts on the same evidence, because it could not re-run `wc -w` or
// a validator script itself. --verify grants Bash under the read-only profile for exactly
// that - broker.mjs decides which stages pass it (review, gate) - while a disallow list
// keeps the mutating verbs off, since there is still no Edit/Write tool and no OS sandbox
// backing "read-only" for this vendor (see the adapter's own top-of-file comment).
test('--verify grants Bash under read-only, with a disallow list for the mutating verbs', () => {
  const f = fixture();
  try {
    const r = f.run(['--detect', '--sandbox', 'read-only', '--verify']);
    assert.equal(r.status, 0, r.stderr);
    const args = JSON.parse(readFileSync(join(f.dir, 'observed.json'))).args;
    assert.equal(args[args.indexOf('--tools') + 1], 'Read,Glob,Grep,Bash');
    // dontAsk denies a tool no allow rule names: without this every gate read 'tool denied'
    assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
    assert.equal(args[args.indexOf('--allowedTools') + 1], 'Bash');
    const disallowed = args[args.indexOf('--disallowedTools') + 1];
    for (const verb of ['git commit', 'git push', 'git add', 'rm', 'mv', 'cp']) {
      assert.match(disallowed, new RegExp(`Bash\\(${verb.replace(/ /g, '\\s')}:\\*\\)`), `${verb} must be disallowed`);
    }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('--verify without read-only changes nothing - workspace-write already has Bash', () => {
  const f = fixture();
  try {
    f.run(['--prompt-file', join(f.dir, 'prompt.md'), '--stage', 'test', '--sandbox', 'workspace-write', '--verify']);
    const observed = JSON.parse(readFileSync(join(f.dir, 'observed.json')));
    assert.equal(observed.args[observed.args.indexOf('--tools') + 1], 'Read,Glob,Grep,Edit,Write,Bash');
    assert.equal(observed.args.includes('--disallowedTools'), false);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

// The bypass must be something a run opts into, never what every stage silently gets.
test('workspace-write still defers to the project permission layer', () => {
  const f = fixture();
  try {
    f.run(['--prompt-file', join(f.dir, 'prompt.md'), '--stage', 'test', '--sandbox', 'workspace-write']);
    const observed = JSON.parse(readFileSync(join(f.dir, 'observed.json')));
    assert.equal(observed.args[observed.args.indexOf('--permission-mode') + 1], 'acceptEdits');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

// The project wiki: TEAMS_WIKI_ROOT hands a worker exactly one MCP server (teams-wiki) and names
// its tools in --allowedTools (--tools only limits built-ins). --no-wiki or no root: the old empty config.
const WIKI_SERVER = fileURLToPath(new URL('../mcp/wiki.mjs', import.meta.url));
const argvOf = f => JSON.parse(readFileSync(join(f.dir, 'observed.json'))).args;
const withoutRoot = { TEAMS_WIKI_ROOT: '' };

test('TEAMS_WIKI_ROOT set: one teams-wiki server rooted there, its six tools allowed, strict config kept', () => {
  const f = fixture();
  try {
    const r = f.run(['--prompt-file', join(f.dir, 'prompt.md'), '--stage', 'implement'], { TEAMS_WIKI_ROOT: '/proj/main' });
    assert.equal(r.status, 0, r.stderr);
    const args = argvOf(f);
    assert.ok(args.includes('--strict-mcp-config'));
    assert.deepEqual(JSON.parse(args[args.indexOf('--mcp-config') + 1]), {
      mcpServers: { 'teams-wiki': { command: process.execPath, args: [WIKI_SERVER, '--root', '/proj/main'] } },
    });
    assert.equal(args[args.indexOf('--allowedTools') + 1],
      'mcp__teams-wiki__wiki_search,mcp__teams-wiki__wiki_get,mcp__teams-wiki__wiki_resume,mcp__teams-wiki__wiki_list,mcp__teams-wiki__wiki_status,mcp__teams-wiki__wiki_write');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('--no-wiki (a judging stage) or an unset TEAMS_WIKI_ROOT: the old empty config exactly, no allowed tools', () => {
  const f = fixture();
  try {
    for (const [extra, env] of [[['--no-wiki'], { TEAMS_WIKI_ROOT: '/proj/main' }], [[], withoutRoot]]) {
      const r = f.run(['--prompt-file', join(f.dir, 'prompt.md'), '--stage', 'test', ...extra], env);
      assert.equal(r.status, 0, r.stderr);
      const args = argvOf(f);
      assert.equal(args[args.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
      assert.ok(args.includes('--strict-mcp-config'));
      assert.equal(args.includes('--allowedTools'), false);
    }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('--verify keeps its --disallowedTools list next to the wiki tools', () => {
  const f = fixture();
  try {
    f.run(['--prompt-file', join(f.dir, 'prompt.md'), '--sandbox', 'read-only', '--verify'], { TEAMS_WIKI_ROOT: '/proj/main' });
    const args = argvOf(f);
    assert.match(args[args.indexOf('--disallowedTools') + 1], /Bash\(git commit:\*\)/);
    assert.match(args[args.indexOf('--allowedTools') + 1], /^Bash,.*wiki_write/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

// E-32e8068c (2026-10-18): a gate denied Bash could not re-run the suite, rejected on that alone, and
// the engine read it as a verdict on the work. The json envelope's permission_denials[] says which
// tool was denied; a Bash command the node needed (not one --disallowedTools blocks on purpose) makes
// the report `blocked`, not a reject. Exit stays 0: the broker discards the payload of a non-zero exit.
const denial = command => ({ tool_name: 'Bash', tool_use_id: 't1', tool_input: { command } });
const gateRun = (f, denials, env = {}) => f.run(['--prompt-file', join(f.dir, 'prompt.md'), '--stage', 'gate', '--sandbox', 'read-only', '--verify'],
  { ...withoutRoot, ...(denials === undefined ? {} : { MOCK_DENIALS: JSON.stringify(denials) }), ...env });
const BLOCKED = { stage_ok: false, blocked: 'tool denied', reason: 'blocked: tool denied' };

test('a Bash command the node needed was denied and the node gave no verdict: blocked: tool denied, exit 0', () => {
  const f = fixture();
  try {
    const r = gateRun(f, [denial('node --test teams/scripts/test-x.mjs')], { MOCK_PROSE: '1' });
    assert.equal(r.status, 0, 'the broker reads the report only from a zero exit');
    assert.deepEqual(r.report.result, {
      stage_ok: false, blocked: 'tool denied', reason: 'blocked: tool denied', denied: ['node --test teams/scripts/test-x.mjs'],
    });
    assert.equal('match_pct' in r.report.result, false);
    assert.equal('accept' in r.report.result, false);
    assert.equal(r.report.stage_ok, false);
    assert.equal(r.report.verification_error, 'blocked: tool denied');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

// A denied node whose last reply is still a usable result object (the same parse the non-denied
// path accepts) judged: the result stands with the denied commands attached, and the exit code and
// verification_error are what they would be without the denial. Only no usable result, or an
// unexplained refusal, stays blocked. One rule for every node kind (no stage/--verify condition).
const DENIED = ['node --test teams/scripts/test-x.mjs'];
const denials1 = [denial(DENIED[0])];
const settled = (r, result, stage_ok) => {
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.report.result, { ...result, denied: DENIED });
  assert.equal(r.report.stage_ok, stage_ok);
  assert.equal(r.report.verification_error, '');
};

test('denial + a usable accept: the result is kept with result.denied, verification_error empty, exit 0', () => {
  const f = fixture();
  try {
    const accept = { stage_ok: true, accept: true, match_pct: 100, evidence: 'read the tree' };
    settled(gateRun(f, denials1, { MOCK_RESULT: JSON.stringify(accept) }), accept, true);
    const plain = { stage_ok: true, verified: true, checks: ['check -> passed'], evidence: 'e' };
    settled(gateRun(f, denials1), plain, true);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('denial + a usable reject that gives a reason is kept the same way (any complete verdict stands)', () => {
  const f = fixture();
  try {
    const reject = { stage_ok: true, accept: false, reason: 'P2 misses AC 3' };
    settled(gateRun(f, denials1, { MOCK_RESULT: JSON.stringify(reject) }), reject, true);
    const failed = { stage_ok: false, reason: 'the build is red' };
    settled(gateRun(f, denials1, { MOCK_RESULT: JSON.stringify(failed) }), failed, false);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('the rule is the same for every node kind: a worker stage keeps its result too', () => {
  const f = fixture();
  try {
    const r = f.run(['--prompt-file', join(f.dir, 'prompt.md'), '--stage', 'implement'], { ...withoutRoot, MOCK_DENIALS: JSON.stringify(denials1) });
    settled(r, { stage_ok: true, verified: true, checks: ['check -> passed'], evidence: 'e' }, true);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('denial + prose or no object (an array, a bare string): blocked: tool denied, exit 0, as before', () => {
  const f = fixture();
  try {
    for (const env of [{ MOCK_PROSE: '1' }, { MOCK_RESULT: '[1,2]' }, { MOCK_RESULT: '"done"' }, { MOCK_RESULT: 'all good' }]) {
      const r = gateRun(f, denials1, env);
      assert.equal(r.status, 0, JSON.stringify(env));
      assert.deepEqual(r.report.result, { ...BLOCKED, denied: DENIED }, JSON.stringify(env));
      assert.equal(r.report.stage_ok, false);
      assert.equal(r.report.verification_error, 'blocked: tool denied', JSON.stringify(env));
    }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('denial + an unexplained refusal stays blocked; the same refusal with a reason is kept with denied', () => {
  const f = fixture();
  try {
    for (const refusal of [{ stage_ok: false }, { stage_ok: true, accept: false }, { stage_ok: true, verified: false, gaps: [' '] },
      { stage_ok: true, sound: false, reason: null, problems: [] }]) {
      const r = gateRun(f, denials1, { MOCK_RESULT: JSON.stringify(refusal) });
      assert.equal(r.status, 0, JSON.stringify(refusal));
      assert.deepEqual(r.report.result, { ...BLOCKED, denied: DENIED }, JSON.stringify(refusal));
      assert.equal(r.report.stage_ok, false);
      assert.equal(r.report.verification_error, 'blocked: tool denied', JSON.stringify(refusal));
    }
    const explained = { stage_ok: false, reason: 'cannot run the suite, but the diff misses AC 2' };
    settled(gateRun(f, denials1, { MOCK_RESULT: JSON.stringify(explained) }), explained, false);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('the adapter\'s local refusal check agrees with the daemon\'s unexplainedRefusal on the same fixtures', async () => {
  const { unexplainedRefusal } = await import('../mcp/daemon.mjs');
  const f = fixture();
  try {
    const fixtures = [
      { stage_ok: false }, { stage_ok: false, reason: 'r' }, { stage_ok: true, accept: false }, { stage_ok: true, accept: false, reason: 'r' },
      { stage_ok: true, verified: false }, { stage_ok: true, verified: false, gaps: ['g'] }, { stage_ok: true, verified: false, gaps: [' '] },
      { stage_ok: true, sound: false, problems: [{ kind: 'A', text: 'x' }] }, { stage_ok: true, sound: false, problems: [] },
      { stage_ok: true, verified: false, unowned: ['report -> NONE'] }, { stage_ok: true, accept: false, evidence: 'e' },
      { stage_ok: true, accept: false, retry: 'again' }, { stage_ok: true, accept: false, uncovered: ['F1'] },
      { stage_ok: false, judge_failed: true }, { stage_ok: true, accept: true }, { stage_ok: true, verified: true },
      { stage_ok: false, reason: '' }, { stage_ok: false, reason: null, gaps: null },
    ];
    for (const fx of fixtures) {
      const r = gateRun(f, denials1, { MOCK_RESULT: JSON.stringify(fx) });
      const standing = r.report.verification_error === '';
      assert.equal(standing, unexplainedRefusal(fx) === null, JSON.stringify(fx));
      assert.equal(r.report.result.blocked === 'tool denied', !standing, JSON.stringify(fx));
    }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('denial + ok false (an is_error envelope, exit 0 from claude): pinned as today - blocked, exit 0', () => {
  const f = fixture();
  try {
    const r = gateRun(f, denials1, { MOCK_ERROR: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.report.result, { ...BLOCKED, denied: DENIED });
    assert.equal(r.report.stage_ok, false);
    assert.equal(r.report.verification_error, 'blocked: tool denied');
    // without the denial the same envelope is a plain failure, exit 1, no denied key
    const plain = gateRun(f, undefined, { MOCK_ERROR: '1' });
    assert.equal(plain.status, 1);
    assert.equal(plain.report.verification_error, 'tool run failed');
    assert.equal('denied' in (plain.report.result || {}), false);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('no denial (absent, empty, or only a deliberate one): no denied key, and a usable result keeps its exit code', () => {
  const f = fixture();
  try {
    for (const denials of [undefined, [], [denial('rm -rf x')]]) {
      const r = gateRun(f, denials);
      assert.equal(r.status, 0, r.stderr);
      assert.equal('denied' in r.report.result, false, JSON.stringify(denials));
      assert.equal(r.report.verification_error, '');
    }
    const prose = gateRun(f, undefined, { MOCK_PROSE: '1' });
    assert.equal(prose.status, 1);
    assert.equal(prose.report.result, undefined);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('empty or absent permission_denials leave the report and exit code as they were', () => {
  const f = fixture();
  try {
    const plain = gateRun(f);
    assert.equal(plain.status, 0, plain.stderr);
    assert.equal(plain.report.stage_ok, true);
    assert.equal(plain.report.result.blocked, undefined);
    const empty = gateRun(f, []);
    assert.equal(empty.status, 0, empty.stderr);
    assert.deepEqual(empty.report, plain.report);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('a denial of a command --disallowedTools blocks on purpose, or of a tool other than Bash, is not blocked', () => {
  const f = fixture();
  try {
    for (const denials of [
      [denial('rm -rf x')], [denial('git commit -m x')], [denial('sed -i s/a/b/ f')],
      [{ tool_name: 'Edit', tool_input: { file_path: 'a.txt' } }], [denial('rm -rf x'), { tool_name: 'Write', tool_input: {} }],
    ]) {
      const r = gateRun(f, denials);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.report.stage_ok, true, JSON.stringify(denials));
      assert.equal(r.report.result.blocked, undefined, JSON.stringify(denials));
    }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('a verb that only shares a prefix with the disallow list, or a read-only sed, still counts; denied[] lists only those', () => {
  const f = fixture();
  try {
    const r = gateRun(f, [denial('rm -rf x'), denial('sed -n 1,5p a.txt'), denial('git status'), denial('rmdir d')], { MOCK_PROSE: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.report.result.blocked, 'tool denied');
    assert.deepEqual(r.report.result.denied, ['sed -n 1,5p a.txt', 'git status', 'rmdir d']);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('a detect run, or a failed adapter exit, never reads permission_denials', () => {
  const f = fixture();
  try {
    const d = f.run(['--detect', '--sandbox', 'read-only'], { ...withoutRoot, MOCK_DENIALS: JSON.stringify([denial('node -v')]) });
    assert.equal(d.status, 0, d.stderr);
    assert.equal(d.report.vendor.reachable, true);
    assert.equal(d.report.result, undefined);
    const quota = f.run(['--prompt-file', join(f.dir, 'prompt.md')], { ...withoutRoot, MOCK_QUOTA: '1', MOCK_DENIALS: JSON.stringify([denial('node -v')]) });
    assert.equal(quota.status, 1);
    assert.equal(quota.report.result, undefined);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
