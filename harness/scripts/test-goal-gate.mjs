#!/usr/bin/env node
// harness/scripts/test-goal-gate.mjs - the PreToolUse gate against the 2026-09-28 adversarial
// findings (_repo/docs/plans/2026-09-28-teams-adversarial-fixes.md G1-G6): engagement only from a
// record, the root from the target, the gate's own files gated, Bash writes judged, forged
// future timestamps ignored.
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, '..', 'hooks', 'goal-gate.mjs');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    process.stdout.write(`ok - ${name}\n`);
  } catch (e) {
    failures += 1;
    process.stdout.write(`not ok - ${name}\n  ${String((e && e.stack) || e).split('\n').slice(0, 4).join('\n  ')}\n`);
  }
}

function write(p, s) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, s);
}

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'goal-gate-'));
  write(join(dir, '.claude', 'harness-gate.json'), JSON.stringify({ patterns: ['\\.[cm]?js$', '/SKILL\\.md$'], window_hours: 2 }));
  execFileSync('git', ['init', '-q', dir]);
  return dir;
}

function transcript(dir, entries) {
  const p = join(dir, 'transcript.jsonl');
  writeFileSync(p, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return p;
}

const now = () => new Date().toISOString();
const toolUse = (id, name, input, ts = now()) => ({ type: 'assistant', timestamp: ts, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, isError, text = '', ts = now()) => ({ type: 'user', timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: text }] } });
const prose = (text) => ({ type: 'assistant', timestamp: now(), message: { role: 'assistant', content: [{ type: 'text', text }] } });

function run(input, env = {}) {
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '', ...env } });
  assert.equal(r.status, 0, r.stderr);
  if (!r.stdout.trim()) return 'allow';
  return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision;
}

const edit = (dir, fp, extra = {}) => ({ tool_name: 'Edit', cwd: dir, session_id: 's1', tool_input: { file_path: fp }, ...extra });
const bash = (dir, command, extra = {}) => ({ tool_name: 'Bash', cwd: dir, session_id: 's1', tool_input: { command }, ...extra });

function fallbackRun(dir, { sound = true, report = false, critiqueFirst = false } = {}) {
  const run = join(dir, '.harness-run', 'x');
  write(join(run, 'manifest.json'), '{"request":"r"}');
  write(join(run, '01-plan.md'), 'plan: do the thing properly');
  if (critiqueFirst) write(join(run, '02-critique.json'), JSON.stringify({ sound, problems: [] }));
  write(join(run, '02-goal-spec.json'), JSON.stringify({ goal: 'g', acceptance: ['a'], subgoals: [{ id: 'S1', title: 't', acceptance: ['a'] }] }));
  if (critiqueFirst) {
    const old = new Date(Date.now() - 60 * 1000);
    utimesSync(join(run, '02-critique.json'), old, old);
  } else {
    write(join(run, '02-critique.json'), JSON.stringify({ sound, problems: [] }));
  }
  if (report) write(join(run, '05-report.md'), 'report');
  return run;
}

// ---- G1: engagement only from a record ----

test('G1: not engaged - a gated edit is denied, an ungated one allowed', () => {
  const dir = project();
  const t = transcript(dir, [prose('hello')]);
  assert.equal(run(edit(dir, join(dir, 'src', 'a.mjs'), { transcript_path: t })), 'deny');
  assert.equal(run(edit(dir, join(dir, 'README.md'), { transcript_path: t })), 'allow');
});

test('G1: the engine path or the deny text as prose does not engage (B1)', () => {
  const dir = project();
  const first = run(edit(dir, join(dir, 'a.mjs'), { transcript_path: transcript(dir, [prose('x')]) }));
  assert.equal(first, 'deny');
  const t = transcript(dir, [
    prose('Workflow({ scriptPath: "harness/engine/pipeline.js" }) and "skill": "harness" and <command-name>/harness</command-name>'),
    toolResult('z', false, 'This path is gated ... harness/engine/pipeline.js ...'),
  ]);
  assert.equal(run(edit(dir, join(dir, 'a.mjs'), { transcript_path: t })), 'deny');
});

test('G1: a successful Workflow tool_use of pipeline.js engages; a failed one does not; a stale one does not', () => {
  const dir = project();
  const ok = transcript(dir, [toolUse('w1', 'Workflow', { scriptPath: 'harness/engine/pipeline.js' }), toolResult('w1', false)]);
  assert.equal(run(edit(dir, join(dir, 'a.mjs'), { transcript_path: ok })), 'allow');
  const dir2 = project();
  const bad = transcript(dir2, [toolUse('w1', 'Workflow', { scriptPath: 'harness/engine/pipeline.js' }), toolResult('w1', true, 'refused')]);
  assert.equal(run(edit(dir2, join(dir2, 'a.mjs'), { transcript_path: bad })), 'deny');
  const dir3 = project();
  const old = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const stale = transcript(dir3, [toolUse('w1', 'Workflow', { scriptPath: 'harness/engine/pipeline.js' }, old), toolResult('w1', false, '', old)]);
  assert.equal(run(edit(dir3, join(dir3, 'a.mjs'), { transcript_path: stale })), 'deny');
});

test('G1: an MCP graph_open / tm_open tool_use engages', () => {
  for (const name of ['mcp__graph-engineering__graph_open', 'mcp__teams__tm_open', 'mcp__teams__tm_run']) {
    const dir = project();
    const t = transcript(dir, [toolUse('m1', name, { request: 'r' }), toolResult('m1', false)]);
    assert.equal(run(edit(dir, join(dir, 'a.mjs'), { transcript_path: t })), 'allow', name);
  }
});

test('G1: an open fallback run engages only with plan, spec and a sound critique newer than the spec, and no report', () => {
  const ok = project();
  fallbackRun(ok);
  assert.equal(run(edit(ok, join(ok, 'a.mjs'))), 'allow');
  const unsound = project();
  fallbackRun(unsound, { sound: false });
  assert.equal(run(edit(unsound, join(unsound, 'a.mjs'))), 'deny');
  const reported = project();
  fallbackRun(reported, { report: true });
  assert.equal(run(edit(reported, join(reported, 'a.mjs'))), 'deny');
  const staleCritique = project();
  fallbackRun(staleCritique, { critiqueFirst: true });
  assert.equal(run(edit(staleCritique, join(staleCritique, 'a.mjs'))), 'deny');
});

test('G1: an open broker node engages', () => {
  const dir = project();
  write(join(dir, '.harness-run', 'broker', 'open-nodes.json'), JSON.stringify({ n1: { opened_at: Date.now() } }));
  assert.equal(run(edit(dir, join(dir, 'a.mjs'))), 'allow');
});

// ---- G5: forged future timestamps ----

test('G5: a future-dated marker or broker node does not engage', () => {
  const dir = project();
  write(join(dir, '.claude', '.harness-markers', 'forged'), String(Date.now() + 10 * 365 * 86400 * 1000));
  assert.equal(run(edit(dir, join(dir, 'a.mjs'))), 'deny');
  const dir2 = project();
  write(join(dir2, '.harness-run', 'broker', 'open-nodes.json'), JSON.stringify({ n1: { opened_at: Date.now() + 86400 * 1000 } }));
  assert.equal(run(edit(dir2, join(dir2, 'a.mjs'))), 'deny');
});

test('G5: a live marker still passes a parallel subagent', () => {
  const dir = project();
  write(join(dir, '.claude', '.harness-markers', 'other'), String(Date.now()));
  assert.equal(run(edit(dir, join(dir, 'a.mjs'))), 'allow');
});

// ---- G2: the root comes from the target ----

test('G2: a cwd in a subdir still finds the config; /tmp files are not gated', () => {
  const dir = project();
  mkdirSync(join(dir, 'teams', 'mcp'), { recursive: true });
  assert.equal(run(edit(join(dir, 'teams'), join(dir, 'teams', 'mcp', 'a.mjs'))), 'deny');
  assert.equal(run(edit(join(dir, 'teams'), 'mcp/a.mjs')), 'deny');
  assert.equal(run(edit(dir, join(tmpdir(), 'scratch-x.mjs'))), 'allow');
});

test('G2: patterns are case-insensitive and anchored to the root-relative path', () => {
  const dir = project();
  assert.equal(run(edit(dir, join(dir, 'A.MJS'))), 'deny');
  assert.equal(run(edit(dir, join(dir, 'x.cjs'))), 'deny');
  assert.equal(run(edit(dir, join(dir, 'skills', 'foo', 'skill.md'))), 'deny');
});

test('G2: a sibling git worktree of a gated repo is gated', () => {
  const dir = project();
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  const wt = `${dir}-wt`;
  execFileSync('git', ['-C', dir, 'worktree', 'add', '-q', wt]);
  assert.equal(run(edit(wt, join(wt, 'a.mjs'))), 'deny');
  assert.equal(run(edit(wt, join(wt, 'notes.txt'))), 'allow');
  rmSync(wt, { recursive: true, force: true });
});

test('G2: CLAUDE_PROJECT_DIR is the fallback root; no config anywhere means no gate', () => {
  const bare = mkdtempSync(join(tmpdir(), 'goal-gate-bare-'));
  assert.equal(run(edit(bare, join(bare, 'a.mjs'))), 'allow');
});

// ---- G3: the gate's own files ----

test('G3: the gate config, hook, settings and markers are gated whatever the patterns say', () => {
  const dir = project();
  write(join(dir, '.claude', 'harness-gate.json'), JSON.stringify({ patterns: ['^/nothing$'] }));
  for (const p of ['.claude/harness-gate.json', '.claude/settings.json', '.claude/settings.local.json', '.claude/hooks/goal-gate.mjs', '.claude/.harness-markers/s1']) {
    assert.equal(run(edit(dir, join(dir, p))), 'deny', p);
  }
  assert.equal(run(bash(dir, 'echo 9999999999999 > .claude/.harness-markers/s2')), 'deny');
  assert.equal(run(bash(dir, 'rm .claude/harness-gate.json')), 'deny');
});

// ---- G4: Bash writes ----

test('G4: Bash writes to a gated path are denied; reads and runs are allowed', () => {
  const dir = project();
  const deny = [
    'echo x > teams/mcp/a.mjs',
    'cat <<EOF >> a.mjs\nx\nEOF',
    "sed -i 's/a/b/' teams/mcp/a.mjs",
    'perl -pi -e s/a/b/ a.mjs',
    'cp /tmp/x.mjs teams/mcp/a.mjs',
    'mv a.txt b.mjs',
    'tee a.mjs < /dev/null',
    'node -e "require(\'fs\').writeFileSync(\'teams/mcp/a.mjs\', \'x\')"',
    "python3 -c \"open('a.mjs','w').write('x')\"",
    'git checkout -- teams/mcp/a.mjs',
    'cd sub && echo x > ../a.mjs',
  ];
  for (const c of deny) assert.equal(run(bash(dir, c)), 'deny', c);
  const allow = [
    'node teams/scripts/test-x.mjs',
    'cat teams/mcp/a.mjs',
    'grep -n foo teams/mcp/a.mjs > /tmp/out.txt',
    'node teams/scripts/test-x.mjs 2>&1 | tail -5',
    'echo hi > README.md',
    'git status',
    'git log --oneline -5 -- a.mjs',
  ];
  for (const c of allow) assert.equal(run(bash(dir, c)), 'allow', c);
});

// ---- long-loop G1/G2/G2b (_repo/docs/plans/2026-09-28-teams-long-loop.md) ----

test('LL-G1: a hand-written broker ledger is gated - it would engage the gate itself', () => {
  const dir = project();
  assert.equal(run(edit(dir, join(dir, '.harness-run', 'broker', 'open-nodes.json'))), 'deny');
  assert.equal(run(bash(dir, 'echo {} > .harness-run/broker/open-nodes.json')), 'deny');
});

test('LL-G2: a write verb is exempt only as a plain argument of a read-only command; wrappers stay denied', () => {
  const dir = project();
  const allow = [
    'grep -n cp x.mjs',
    'rg -n "rm" teams/mcp/a.mjs',
    'cat a.mjs | grep -n mv',
    'grep -n "a;cp" a.mjs',
    'wc -l a.mjs && grep -c rm a.mjs',
    'echo cp a.mjs',
    'git log --oneline -- rm a.mjs',
    'git diff -- a.mjs | grep rm',
  ];
  for (const c of allow) assert.equal(run(bash(dir, c)), 'allow', c);
  const deny = [
    'sudo cp x a.mjs',
    'env cp x a.mjs',
    'nohup cp x a.mjs',
    'ls | xargs rm a.mjs',
    'find . -name a.mjs -exec rm {} \\;',
    'eval "cp x a.mjs"',
    'bash -c "rm a.mjs"',
    'command cp x a.mjs',
    'exec cp x a.mjs',
    'flock /tmp/l cp x a.mjs',
    'grep x a.mjs; cp y a.mjs',
    'grep $(rm a.mjs) x',
    'grep `rm a.mjs` x',
    'git log --output=a.mjs',
    'git diff --output a.mjs',
    'echo cp > a.mjs',
    'doas cp x a.mjs',
    'stdbuf -o0 cp x a.mjs',
    'ionice cp x a.mjs',
    'parallel cp x ::: a.mjs',
    'watch cp x a.mjs',
    'rg --pre rm x a.mjs',
    'less -o a.mjs x',
    // an interpreter or shell anywhere in the simple command, not only as its first word
    'timeout 5 python3 -c "open(\'a.mjs\',\'w\').write(\'x\')"',
    'nice node -e "require(\'fs\').writeFileSync(\'a.mjs\', \'x\')"',
    'timeout 5 bash -c "echo > a.mjs"',
    "env python3 - <<EOF\nopen('a.mjs','w')\nEOF",
  ];
  for (const c of deny) assert.equal(run(bash(dir, c)), 'deny', c);
});

test('LL-G2b: an inline script that only mentions a gated path is allowed; one that can write is denied', () => {
  const dir = project();
  const allow = [
    "python3 -c \"print(len('a.mjs'))\"",
    "python3 - <<'EOF'\nprint('teams/mcp/a.mjs has', 3, 'lines')\nEOF",
    'node -e "console.log(\'a.mjs\')"',
    "cat <<EOF > notes.txt\nsee teams/mcp/a.mjs\nEOF",
    "git commit -q -F - <<'EOF'\nfix teams/mcp/a.mjs\nEOF",
    "git commit -q -F - <<'EOF'\nremove stale teams/mcp/a.mjs, open the rest\nEOF",
    "cat > notes.txt <<EOF\nopen teams/mcp/a.mjs later\nEOF",
  ];
  for (const c of allow) assert.equal(run(bash(dir, c)), 'allow', c);
  const deny = [
    "python3 - <<'EOF'\nopen('a.mjs','w').write('x')\nEOF",
    "python3 - <<'EOF'\nimport shutil; shutil.copy('b', 'a.mjs')\nEOF",
    "node - <<'EOF'\nrequire('fs').writeFileSync('a.mjs', 'x')\nEOF",
    "cat <<EOF | bash\nrm a.mjs\nEOF",
    "cat <<EOF | python3\nopen('a.mjs','w')\nEOF",
    "bash <<EOF\necho a.mjs\nEOF",
    "cat <<EOF > a.mjs\nx\nEOF",
    'python3 -c "import os; os.replace(\'b\', \'a.mjs\')"',
    'node -e "require(\'child_process\').execSync(\'touch a.mjs\')"',
    // a quoted <<EOF is not a heredoc and swallows nothing
    'grep -n "<<EOF" x\ncp y a.mjs',
    // a heredoc that never closes is judged as a whole command
    'cat <<EOF\nrm a.mjs',
    // a data heredoc whose body writes, or whose file is a script or is run later, counts
    "cat > notes.txt <<EOF\nrm a.mjs\nEOF",
    "cat > /tmp/gen.py <<EOF\nopen('a.mjs','w')\nEOF",
    "cat > /tmp/x.sh <<EOF\necho hi > a.mjs.bak\ntouch a.mjs\nEOF\nbash /tmp/x.sh",
    "cat > /tmp/run.txt <<EOF\nwriteFileSync a.mjs\nEOF\nnode /tmp/run.txt",
    'python3 -c "getattr(__builtins__, \'op\'+\'en\')(\'a.mjs\', \'w\')"',
  ];
  for (const c of deny) assert.equal(run(bash(dir, c)), 'deny', c);
});

test('G4: Bash writes pass once engaged', () => {
  const dir = project();
  fallbackRun(dir);
  assert.equal(run(bash(dir, 'echo x > a.mjs')), 'allow');
});

// ---- fail-open ----

test('fail-open: bad JSON input, bad regex config', () => {
  const r = spawnSync('node', [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const dir = project();
  write(join(dir, '.claude', 'harness-gate.json'), JSON.stringify({ patterns: ['('] }));
  assert.equal(run(edit(dir, join(dir, 'a.mjs'))), 'allow');
});

// ---- parity: the repo's installed copy is the plugin's hook ----

test('parity: .claude/hooks/goal-gate.mjs equals harness/hooks/goal-gate.mjs', () => {
  const repo = join(HERE, '..', '..');
  assert.equal(readFileSync(join(repo, '.claude', 'hooks', 'goal-gate.mjs'), 'utf8'), readFileSync(HOOK, 'utf8'));
});

if (failures) {
  process.stdout.write(`\n${failures} failed\n`);
  process.exit(1);
}
process.stdout.write('\nall passed\n');
