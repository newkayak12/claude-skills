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
