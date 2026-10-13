#!/usr/bin/env node
// harness/scripts/test-goal-gate.mjs - the PreToolUse gate against the 2026-09-28 adversarial
// findings (_repo/docs/plans/2026-09-28-teams-adversarial-fixes.md G1-G6): engagement only from a
// record, the root from the target, the gate's own files gated, Bash writes judged, forged
// future timestamps ignored.
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, rmSync, chmodSync, existsSync, readdirSync } from 'node:fs';
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
const patch = (dir, command, extra = {}) => ({ tool_name: 'apply_patch', cwd: dir, session_id: 's1', tool_input: { command }, ...extra });

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

test('Codex apply_patch: gated targets deny and ungated targets allow', () => {
  const dir = project();
  assert.equal(run(patch(dir, '*** Begin Patch\n*** Add File: src/a.mjs\n+x\n*** End Patch')), 'deny');
  assert.equal(run(patch(dir, '*** Begin Patch\n*** Add File: README.md\n+x\n*** End Patch')), 'allow');
  assert.equal(run(patch(dir, '*** Begin Patch\n*** Update File: README.md\n@@\n-x\n+y\n*** Update File: src/a.mjs\n@@\n-x\n+y\n*** End Patch')), 'deny');
});

test('Codex registers goal-gate for apply_patch without Claude modules', () => {
  const config = JSON.parse(readFileSync(join(HERE, '..', 'hooks', 'codex.json'), 'utf8'));
  assert.equal(config.modules, undefined);
  assert.match(config.hooks.PreToolUse[0].matcher, /apply_patch/);
  assert.match(config.hooks.PreToolUse[0].hooks[0].command, /goal-gate\.mjs/);
});

test('Codex MCP entry tools are denied inside a run and allowed in the main session', () => {
  for (const tool_name of ['mcp__graph-engineering__graph_open', 'mcp__task-manager__tm_open', 'mcp__task-manager__tm_run']) {
    assert.equal(run({ tool_name, cwd: project(), tool_input: {} }, { HARNESS_NODE: '1' }), 'deny', tool_name);
    assert.equal(run({ tool_name, cwd: project(), tool_input: {} }), 'allow', tool_name);
  }
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

test('1.28 S1: a linked worktree inside the project sees the main root\'s open run', () => {
  const dir = project();
  execFileSync('git', ['-C', dir, 'add', '.claude/harness-gate.json']);
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init']);
  const wt = join(dir, '.claude', 'worktrees', 'w');
  execFileSync('git', ['-C', dir, 'worktree', 'add', '-q', wt]);
  assert.equal(run(edit(wt, join(wt, 'a.mjs'))), 'deny');
  fallbackRun(dir);
  assert.equal(run(edit(wt, join(wt, 'a.mjs'))), 'allow');
  assert.equal(run(bash(wt, 'echo x > a.mjs')), 'allow');
});

test('1.28 S2: read-only segments do not pull their paths into the gate', () => {
  const dir = project();
  assert.equal(run(bash(dir, 'grep x a/SKILL.md; rm -f "$T"')), 'allow');
  assert.equal(run(bash(dir, 'T=$(mktemp); diff a.mjs b.mjs > $T; rm $T')), 'allow');
});

test('1.28 S3: writes through assignments, redirects and sed -i stay denied', () => {
  const dir = project();
  assert.equal(run(bash(dir, 'F=a.mjs; cat $F; rm $F')), 'deny');
  assert.equal(run(bash(dir, 'echo x > a/SKILL.md')), 'deny');
  assert.equal(run(bash(dir, 'sed -i s/a/b/ x.mjs')), 'deny');
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
    // a data heredoc into a non-code file that is never run is prose, whatever verbs it holds
    "cat > notes.txt <<EOF\nrm a.mjs\nEOF",
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
    // a data heredoc whose file is a script or is run later, and whose body writes, counts
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

// ---- data mentions are not writes: a gated path named in prose is not a write of it ----

// bashWriteTargets in a child: importing the hook here would run its main().
function writeTargets(command, cwd) {
  const code = `import(${JSON.stringify(process.env.GATE_HOOK || HOOK)}).then((m) => process.stdout.write(JSON.stringify(m.bashWriteTargets(${JSON.stringify(command)}, ${JSON.stringify(cwd)}))))`;
  return JSON.parse(execFileSync('node', ['--input-type=commonjs', '-e', code], { encoding: 'utf8' }));
}

test('data mentions are not writes: R1', () => {
  const dir = project();
  const cmd = "mkdir -p d && cat > d/request.md <<'EOF'\nthen install the patch in packages/csv/src/record.mjs; rm the old one\nEOF";
  const t = writeTargets(cmd, dir);
  assert.ok(!t.includes(join(dir, 'packages/csv/src/record.mjs')), t.join(' '));
});

test("data mentions are not writes: R2'", () => {
  const dir = project();
  const cmd = "git commit -F - <<'EOF'\nfix: install skill\nrm stale harness/skills/install/SKILL.md\nEOF";
  const t = writeTargets(cmd, dir);
  assert.ok(!t.includes(join(dir, 'harness/skills/install/SKILL.md')), t.join(' '));
});

test("data mentions are not writes: R3'", () => {
  const dir = project();
  const cmd = "for p in $(pgrep -f 'teams/mcp/taskmanager.mjs'); do ps -o pid,cmd -p $p; done; rm -f /tmp/y";
  const t = writeTargets(cmd, dir);
  assert.ok(!t.includes(join(dir, 'teams/mcp/taskmanager.mjs')), t.join(' '));
  assert.ok(t.includes('/tmp/y'), t.join(' '));
});

const KEEP = {
  K1: ["cat > teams/mcp/x.mjs <<'EOF'\nhi\nEOF", 'teams/mcp/x.mjs'],
  K2: ["bash <<'EOF'\nsed -i s/a/b/ teams/mcp/x.mjs\nEOF", 'teams/mcp/x.mjs'],
  K3: ['node -e "require(\'fs\').writeFileSync(\'teams/mcp/x.mjs\',\'\')"', 'teams/mcp/x.mjs'],
  K4: ['cp a.mjs teams/mcp/x.mjs', 'teams/mcp/x.mjs'],
  K5: ["cat > go.sh <<'EOF'\nrm teams/mcp/x.mjs\nEOF\nbash go.sh", 'teams/mcp/x.mjs'],
  // a path reaching a writer through argv of a heredoc-fed interpreter, a run-later script,
  // a shell variable, a pipe into xargs, or a for-loop list
  K6: ["python3 - teams/mcp/x.mjs <<'EOF'\nimport sys; open(sys.argv[1],'w')\nEOF", 'teams/mcp/x.mjs'],
  K7: ["cat > /tmp/g.sh <<'EOF'\nrm \"$1\"\nEOF\nbash /tmp/g.sh teams/mcp/x.mjs", 'teams/mcp/x.mjs'],
  K8: ['F=teams/mcp/x.mjs; rm "$F"', 'teams/mcp/x.mjs'],
  K9: ['echo teams/mcp/x.mjs | xargs rm', 'teams/mcp/x.mjs'],
  K10: ['for f in teams/mcp/x.mjs; do rm "$f"; done', 'teams/mcp/x.mjs'],
  // the targets come from a list file, stdin or a heredoc, not from the writer's own argv
  K11: ['echo teams/mcp/x.mjs > /tmp/l; xargs rm < /tmp/l', 'teams/mcp/x.mjs'],
  K12: ['echo teams/mcp/x.mjs > /tmp/l; xargs -a /tmp/l rm', 'teams/mcp/x.mjs'],
  K13: ['echo teams/mcp/x.mjs | git rm --pathspec-from-file=-', 'teams/mcp/x.mjs'],
  K14: ['echo teams/mcp/x.mjs | parallel rm', 'teams/mcp/x.mjs'],
  K15: ['while read f; do rm "$f"; done <<EOF\nteams/mcp/x.mjs\nEOF', 'teams/mcp/x.mjs'],
  K16: ["git rm -q --pathspec-from-file=- <<'EOF'\nteams/mcp/x.mjs\nEOF", 'teams/mcp/x.mjs'],
  K17: ["cat > /tmp/p.txt <<'EOF'\nrm teams/mcp/x.mjs\nEOF\ncd /tmp && bash p.txt", 'teams/mcp/x.mjs'],
  K18: ["cat > /tmp/p.txt <<'EOF'\nrm teams/mcp/x.mjs\nEOF\nbash /tmp/p.t*", 'teams/mcp/x.mjs'],
  K20: ["cat > /tmp/p.txt <<'EOF'\nrm teams/mcp/x.mjs\nEOF\ntimeout 60 bash /tmp/p.txt", 'teams/mcp/x.mjs'],
  K21: ["cat > /tmp/p.txt <<'EOF'\nrm teams/mcp/x.mjs\nEOF\nX=1 bash /tmp/p.txt", 'teams/mcp/x.mjs'],
  K22: ["cat > /tmp/p.txt <<'EOF'\nrm teams/mcp/x.mjs\nEOF\ncd /tmp && chmod +x p.txt && ./p.txt", 'teams/mcp/x.mjs'],
  K23: ["cat > /tmp/run <<'EOF'\nrm teams/mcp/x.mjs\nEOF\nchmod +x /tmp/run && /tmp/run", 'teams/mcp/x.mjs'],
  K24: ["cat > /tmp/p.txt <<'EOF'\nrm teams/mcp/x.mjs\nEOF\nbash /tmp/p.txt <<'EOF2'\ny\nEOF2", 'teams/mcp/x.mjs'],
  K19: ['while read f; do rm "$f"; done <<< teams/mcp/x.mjs', 'teams/mcp/x.mjs'],
  K25: ["F=teams/mcp/x.mjs\npython3 - \"$F\" <<'EOF'\nimport sys,os; os.remove(sys.argv[1])\nEOF", 'teams/mcp/x.mjs'],
  K26: ["export F=teams/mcp/x.mjs\npython3 - <<'EOF'\nimport os; os.remove(os.environ['F'])\nEOF", 'teams/mcp/x.mjs'],
  K27: ['F=teams/mcp/x.mjs\nnode - "$F" <<EOF\nrequire("fs").unlinkSync(process.argv[2])\nEOF', 'teams/mcp/x.mjs'],
  K28: ['F=teams/mcp/x.mjs\nbash -s "$F" <<EOF\nrm $1\nEOF', 'teams/mcp/x.mjs'],
  K29: ['F=teams/mcp/x.mjs\nbash <<EOF\nrm $F\nEOF', 'teams/mcp/x.mjs'],
  K30: ["for f in teams/mcp/x.mjs; do\npython3 - \"$f\" <<'EOF'\nimport sys,os; os.remove(sys.argv[1])\nEOF\ndone", 'teams/mcp/x.mjs'],
  K31: ['echo teams/mcp/x.mjs | git checkout-index --stdin -f', 'teams/mcp/x.mjs'],
};
for (const [id, [cmd, rel]] of Object.entries(KEEP)) {
  test(`data mentions are not writes: ${id}`, () => {
    const dir = project();
    const t = writeTargets(cmd, dir);
    assert.ok(t.includes(join(dir, rel)), t.join(' '));
  });
}

// ---- last decision: the gate records its last gated decision for the mod ----

const DECISION = (dir) => join(dir, '.claude', '.harness-last-decision.json');
function rawRun(input) {
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '' } });
  return { stdout: r.stdout, status: r.status };
}

test('last decision: a denied gated Write records deny and the target', () => {
  const dir = project();
  assert.equal(run({ tool_name: 'Write', cwd: dir, session_id: 'sd', tool_input: { file_path: join(dir, 'a.mjs') } }), 'deny');
  const d = JSON.parse(readFileSync(DECISION(dir), 'utf8'));
  assert.equal(d.decision, 'deny');
  assert.equal(d.target, '/a.mjs');
  assert.equal(d.tool, 'Write');
  assert.equal(d.session_id, 'sd');
  assert.equal(typeof d.ts, 'number');
  assert.ok(d.reason);
});

test('last decision: an engaged gated Write records allow', () => {
  const dir = project();
  const t = transcript(dir, [toolUse('g1', 'mcp__graph__graph_open', {}), toolResult('g1', false)]);
  assert.equal(run({ tool_name: 'Write', cwd: dir, session_id: 'sa', transcript_path: t, tool_input: { file_path: join(dir, 'a.mjs') } }), 'allow');
  const d = JSON.parse(readFileSync(DECISION(dir), 'utf8'));
  assert.equal(d.decision, 'allow');
  assert.equal(d.target, '/a.mjs');
});

test('last decision: an ungated Write creates no decision file', () => {
  const dir = project();
  assert.equal(run({ tool_name: 'Write', cwd: dir, session_id: 'su', tool_input: { file_path: join(dir, 'a.txt') } }), 'allow');
  assert.equal(existsSync(DECISION(dir)), false);
});

test('last decision: a read-only .claude dir leaves stdout and exit code unchanged', () => {
  const input = (dir) => ({ tool_name: 'Write', cwd: dir, session_id: 'sr', tool_input: { file_path: join(dir, 'a.mjs') } });
  const a = project();
  const b = project();
  const before = rawRun(input(a));
  chmodSync(join(b, '.claude'), 0o555);
  try {
    const after = rawRun(input(b));
    assert.equal(after.status, before.status);
    assert.equal(after.stdout, before.stdout);
    assert.equal(existsSync(DECISION(b)), false);
  } finally {
    chmodSync(join(b, '.claude'), 0o755);
  }
});

test('last decision: the decision file never lands in .harness-markers', () => {
  const dir = project();
  run({ tool_name: 'Write', cwd: dir, session_id: 'sm', tool_input: { file_path: join(dir, 'a.mjs') } });
  const t = transcript(dir, [toolUse('g2', 'mcp__graph__graph_open', {}), toolResult('g2', false)]);
  run({ tool_name: 'Write', cwd: dir, session_id: 'sm', transcript_path: t, tool_input: { file_path: join(dir, 'a.mjs') } });
  const m = join(dir, '.claude', '.harness-markers');
  const files = existsSync(m) ? readdirSync(m) : [];
  assert.ok(!files.some((f) => /decision/.test(f)), files.join(' '));
});

// ---- 1.30: only paths inside the root; executed scripts judged by their contents ----

const BYPASS = /running a script that touches a gated file/;

function denyReason(input) {
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '' } });
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason : '';
}

test('1.30 AC-1: a cd outside the root keeps its relative paths outside the root', () => {
  const dir = project();
  for (const c of [
    'cd /tmp/x && cp a.js paginate.js',
    'cd /tmp/x && node --test t.mjs',
    'cp /tmp/a.js /tmp/b.js',
    'cd /tmp/x && echo hi > out.js',
    'cd /tmp/x && git log --output=o.js',
  ]) assert.equal(run(bash(dir, c)), 'allow', c);
});

test('1.30 AC-1: inside the root, or when the cd cannot be followed, the old reach stays', () => {
  const dir = project();
  mkdirSync(join(dir, 'sub'));
  for (const c of [
    'cp a.js paginate.js',
    'cd sub && cp a.js paginate.js',
    'cd /tmp/x || cp a.js paginate.js',
    '(cd /tmp/x; cp a.js paginate.js)',
    'cd $SOME && cp a.js paginate.js',
    'cd - && cp a.js paginate.js',
    'cd /tmp/x; cd ' + dir + '; echo hi > out.js',
  ]) assert.equal(run(bash(dir, c)), 'deny', c);
});

const outside = () => mkdtempSync(join(tmpdir(), 'goal-gate-out-'));
const SH = (d) => `#!/bin/sh\ncp /etc/hostname ${d}/paginate.js\n`;
const SPELLINGS = [
  ['s.sh', SH, (s) => `bash ${s}`],
  ['s.sh', SH, (s) => `sh ${s}`],
  ['s.py', (d) => `open('${d}/paginate.js', 'w').write('x')\n`, (s) => `python3 ${s}`],
  ['s.mjs', (d) => `import { writeFileSync } from 'node:fs';\nwriteFileSync('${d}/paginate.js', 'x');\n`, (s) => `node ${s}`],
  ['s.js', (d) => `require('fs').writeFileSync('${d}/paginate.js', 'x');\n`, (s) => `node ${s}`],
  ['s.rb', (d) => `File.write("${d}/paginate.js", "x")\n`, (s) => `ruby ${s}`],
  ['s.sh', SH, (s) => s],
  ['s.sh', SH, (s) => `. ${s}`],
  ['s.sh', SH, (s) => `sh -c "$(cat ${s})"`],
];
for (const [name, body, cmd] of SPELLINGS) {
  test(`1.30 AC-2: a script outside the root that writes a gated file is denied: ${cmd('SCRIPT')}`, () => {
    const dir = project();
    const sdir = outside();
    const sp = join(sdir, name);
    write(sp, body(dir));
    chmodSync(sp, 0o755);
    const input = bash(dir, cmd(sp));
    assert.equal(run(input), 'deny');
    assert.match(denyReason(input), BYPASS);
  });
}

test("1.30 AC-2: an over-cap script falls back to the command's own path words", () => {
  const dir = project();
  const sdir = outside();
  write(join(sdir, 'big.py'), `open('${dir}/paginate.js', 'w')\n` + '#'.repeat(600 * 1024));
  assert.equal(run(bash(dir, `python3 ${join(sdir, 'big.py')} ${join(dir, 'paginate.js')}`)), 'deny');
  assert.equal(run(bash(dir, `python3 ${join(sdir, 'big.py')}`)), 'allow');
});

test('1.30 AC-2: engaged, the same script runs', () => {
  const dir = project();
  const sdir = outside();
  write(join(sdir, 's.py'), `open('${dir}/paginate.js', 'w')\n`);
  const t = transcript(dir, [toolUse('g3', 'mcp__graph__graph_open', {}), toolResult('g3', false)]);
  assert.equal(run(bash(dir, `python3 ${join(sdir, 's.py')}`, { transcript_path: t })), 'allow');
});

test('1.30 AC-3: no open run - a gated repo script, a /tmp script on /tmp, and a committed repo script run', () => {
  const dir = project();
  write(join(dir, 'tests', 't.mjs'), "import { writeFileSync } from 'node:fs';\nwriteFileSync('tests/out.mjs', 'x');\n");
  write(join(dir, 'scripts', 'check.py'), "import os\nopen('SKILL.md')\nopen('tests/t.mjs')\nopen('x.js', 'w')\n");
  write(join(dir, 'scripts', 'fresh.py'), "import os\nopen('x.js', 'w')\n");
  execFileSync('git', ['-C', dir, 'add', 'scripts/check.py']);
  execFileSync('git', ['-C', dir, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'c']);
  const sdir = outside();
  write(join(sdir, 'ok.py'), "open('/tmp/only-here.txt', 'w').write('x')\n");
  assert.equal(run(bash(dir, 'node --test tests/t.mjs')), 'allow');
  assert.equal(run(bash(dir, 'python3 scripts/check.py')), 'allow');
  assert.equal(run(bash(dir, `python3 ${join(sdir, 'ok.py')}`)), 'allow');
  // an uncommitted in-repo script is not reviewed code: judged by its contents
  assert.equal(run(bash(dir, 'python3 scripts/fresh.py')), 'deny');
  // so is a committed one that was edited since
  write(join(dir, 'scripts', 'check.py'), "open('x.js', 'w')\n");
  assert.equal(run(bash(dir, 'python3 scripts/check.py')), 'deny');
});

// ---- gate routing (_repo/docs/plans/2026-10-12-gate-routing.md) ----

function routeReason(dir, env = {}) {
  const home = mkdtempSync(join(tmpdir(), 'route-home-'));
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(edit(dir, join(dir, 'a.js'))), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '', HOME: home, ...env } });
  rmSync(home, { recursive: true, force: true });
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason : '';
}
const TEAMS_LINE = '  - A spec document, planning, QA, several areas, or unsure -> Skill({skill: "teams:orchestrate", args: "<the user\'s request>"})\n';
const addTeams = (dir) => write(join(dir, '.claude', 'teams-dispatch.json'), '{}');
const addGraph = (dir) => write(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { 'graph-engineering': {} } }));

test('routing AC-1: harness + teams, simple development names the harness skill, the rest teams', () => {
  const dir = project();
  addTeams(dir);
  const r = routeReason(dir);
  assert.match(r, /This project also dispatches through teams \+ harness; route by the kind of work\./);
  assert.ok(r.includes('Simple development (a code change with its tests, one area) -> Skill({skill: "harness:harness"})\n'));
  assert.ok(r.includes(TEAMS_LINE));
});

test('routing AC-2: harness + graph + teams, simple development names graph', () => {
  const dir = project();
  addTeams(dir);
  addGraph(dir);
  const r = routeReason(dir);
  assert.match(r, /teams \+ harness \+ graph/);
  assert.ok(r.includes('Skill({skill: "graph:orchestrate"})'));
  assert.ok(!r.includes('harness:harness'));
  assert.ok(r.includes(TEAMS_LINE));
});

test('routing AC-2: graph enabled in the user settings counts', () => {
  const dir = project();
  addTeams(dir);
  const home = mkdtempSync(join(tmpdir(), 'route-home-'));
  write(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'graph@newkayak12-claude-skills': true } }));
  const r = routeReason(dir, { HOME: home });
  assert.ok(r.includes('Skill({skill: "graph:orchestrate"})'));
});

test('routing AC-4: one gate only keeps today\'s message; harness + graph without teams too', () => {
  const dir = project();
  const today = routeReason(dir);
  assert.match(today, /Engage the harness before editing it: invoke the harness skill/);
  assert.ok(!today.includes('teams:orchestrate'));
  addGraph(dir);
  assert.equal(routeReason(dir), today);
});

test('routing: a broken teams config still routes nothing wrong and the verdict stays deny', () => {
  const dir = project();
  write(join(dir, '.claude', 'teams-dispatch.json'), '{not json');
  assert.equal(run(edit(dir, join(dir, 'a.js'))), 'deny');
  assert.match(routeReason(dir), /Engage the harness before editing it/);
});

// ---- subagent recursion: a blocked subagent stops and reports ----

function reasonOfInput(input) {
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '' } });
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason : '';
}
const skill = (dir, name, extra = {}) => ({ tool_name: 'Skill', cwd: dir, session_id: 's1', tool_input: { skill: name }, ...extra });
const NOTE = 'A subagent that sees this must not invoke the harness again — stop and report to its caller.';

test('AC-1: a subagent denied on a gated edit is told to stop and report, not to invoke the harness', () => {
  const dir = project();
  const input = edit(dir, join(dir, 'a.js'), { agent_id: 'sub1', agent_type: 'general-purpose' });
  assert.equal(run(input), 'deny');
  const why = reasonOfInput(input);
  assert.match(why, /Do not invoke the harness skill/);
  assert.match(why, /Stop and report this block/);
  assert.ok(!why.includes('invoke the harness skill and follow'));
});

test('AC-1: the main session verdict is unchanged and its deny text carries the subagent sentence', () => {
  const dir = project();
  const why = reasonOfInput(edit(dir, join(dir, 'a.js')));
  assert.match(why, /Engage the harness before editing it: invoke the harness skill/);
  assert.ok(why.endsWith(NOTE));
});

test('AC-2: a subagent calling Skill harness:harness (or harness) is denied; others and the main session pass', () => {
  const dir = project();
  for (const name of ['harness:harness', 'harness']) {
    assert.equal(run(skill(dir, name, { agent_id: 'sub1' })), 'deny');
    assert.match(reasonOfInput(skill(dir, name, { agent_id: 'sub1' })), /Stop and report this block/);
  }
  assert.equal(run(skill(dir, 'harness:harness')), 'allow');
  assert.equal(run(skill(dir, 'harness:install', { agent_id: 'sub1' })), 'allow');
  assert.equal(run(skill(dir, 'develop:clean-code', { agent_id: 'sub1' })), 'allow');
  assert.equal(run({ tool_name: 'Skill', cwd: dir, tool_input: {}, agent_id: 'sub1' }), 'allow');
});

test('HARNESS_NODE=1: every entry skill is denied with no gate config; non-entry skills and unset env pass', () => {
  const bare = mkdtempSync(join(tmpdir(), 'goal-gate-bare-'));
  const env = { HARNESS_NODE: '1' };
  for (const name of ['harness:harness', 'harness', 'graph:orchestrate', 'teams:orchestrate', 'teams:develop', 'teams:sprint', 'teams:document', 'teams:plan', 'teams:qa']) {
    assert.equal(run(skill(bare, name), env), 'deny', name);
  }
  assert.equal(run(skill(bare, 'harness:install'), env), 'allow');
  assert.equal(run(skill(bare, 'teams:board'), env), 'allow');
  assert.equal(run(skill(bare, 'teams:orchestrate'), { HARNESS_NODE: '' }), 'allow');
  // a subagent without a gate config is still left alone
  assert.equal(run(skill(bare, 'teams:orchestrate', { agent_id: 'a' })), 'allow');
  const dir = project();
  assert.equal(run(skill(dir, 'graph:orchestrate', { agent_id: 'a' })), 'deny');
});

test('HARNESS_NODE=1: a gated edit gets the stop-and-report text', () => {
  const dir = project();
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(edit(dir, join(dir, 'a.js'))), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '', HARNESS_NODE: '1' } });
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /Stop and report this block/);
});

// ---- the project copy defers to the enabled plugin ----

const PLUGIN_KEY = 'harness@newkayak12-claude-skills';

function projectCopy(dir) {
  const p = join(dir, '.claude', 'hooks', 'goal-gate.mjs');
  write(p, readFileSync(HOOK, 'utf8'));
  return p;
}

function runAt(hook, input, env = {}) {
  const r = spawnSync('node', [hook], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '', ...env } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
}

test('project copy + plugin enabled (project settings, local settings, user settings): allow without judging', () => {
  for (const where of ['project', 'local', 'user']) {
    const dir = project();
    const home = mkdtempSync(join(tmpdir(), 'goal-gate-home-'));
    const settings = { enabledPlugins: { [PLUGIN_KEY]: true } };
    if (where === 'project') write(join(dir, '.claude', 'settings.json'), JSON.stringify(settings));
    if (where === 'local') write(join(dir, '.claude', 'settings.local.json'), JSON.stringify(settings));
    if (where === 'user') write(join(home, '.claude', 'settings.json'), JSON.stringify(settings));
    const hook = projectCopy(dir);
    assert.equal(runAt(hook, edit(dir, join(dir, 'a.js')), { HOME: home }), 'allow', where);
  }
});

test('project copy, plugin not enabled (absent, false, bad JSON): existing verdicts', () => {
  for (const body of [null, JSON.stringify({ enabledPlugins: { [PLUGIN_KEY]: false } }), JSON.stringify({ enabledPlugins: { other: true } }), '{not json']) {
    const dir = project();
    const home = mkdtempSync(join(tmpdir(), 'goal-gate-home-'));
    if (body !== null) write(join(dir, '.claude', 'settings.json'), body);
    const hook = projectCopy(dir);
    assert.equal(runAt(hook, edit(dir, join(dir, 'a.js')), { HOME: home }), 'deny', String(body));
  }
});

test('plugin role (not under .claude/hooks) with the plugin enabled still judges', () => {
  const dir = project();
  const home = mkdtempSync(join(tmpdir(), 'goal-gate-home-'));
  write(join(dir, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { [PLUGIN_KEY]: true } }));
  assert.equal(runAt(HOOK, edit(dir, join(dir, 'a.js')), { HOME: home }), 'deny');
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
