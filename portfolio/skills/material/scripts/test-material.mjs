// node --test portfolio/skills/material/scripts/test-material.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(import.meta.dirname, 'material.mjs');
const PARTS = ['meta.md', 'problem.md', 'decision.md', 'result.md', 'learned.md', 'gaps.md', 'history.md'];
const DATE = '2026-01-02';

// A fresh project dir inside a parent that also holds a sibling dir, to catch writes outside cwd.
function project() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'material-test-'));
  const cwd = path.join(parent, 'proj');
  fs.mkdirSync(cwd);
  fs.mkdirSync(path.join(parent, 'sibling'));
  fs.writeFileSync(path.join(parent, 'sibling', 'keep.txt'), 'keep');
  return { parent, cwd };
}
function run(cwd, args, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, MATERIAL_DATE: DATE, ...env },
  });
  const out = r.stdout;
  assert.ok(out.endsWith('\n') && out.trim().split('\n').length === 1, `one line on stdout: ${out}`);
  return { code: r.status, json: JSON.parse(out) };
}
const init = (cwd, id, title = 'T ' + id, source = 'resume.md#' + id) =>
  run(cwd, ['init', '--id', id, '--title', title, '--source', source]);
// path -> "mtimeMs:content" for every file under dir
function snap(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) out[p] = 'symlink';
      else if (e.isDirectory()) walk(p);
      else out[p] = `${fs.statSync(p).mtimeMs}:${fs.readFileSync(p, 'utf8')}`;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

test('id: slug of source plus title, Hangul kept, deterministic', () => {
  const { cwd } = project();
  const a = run(cwd, ['id', '--source', 'Resume.md#프로젝트 A', '--title', '캐시  도입']);
  assert.equal(a.code, 0);
  assert.equal(a.json.id, 'resume-md-프로젝트-a--캐시-도입');
  assert.deepEqual(run(cwd, ['id', '--source', 'Resume.md#프로젝트 A', '--title', '캐시  도입']).json, a.json);
  assert.equal(fs.existsSync(path.join(cwd, 'material')), false, 'id writes nothing');
});

test('init: creates seven parts with status raw; second init is exists and changes nothing', () => {
  const { cwd } = project();
  const r = run(cwd, ['init', '--id', 'a', '--title', 'Title A', '--source', 'doc.md#A', '--period', '2024', '--role', 'lead', '--tags', 'x,y']);
  assert.equal(r.json.result, 'created');
  for (const p of PARTS) assert.ok(fs.existsSync(path.join(cwd, 'material', 'a', p)), p);
  const meta = fs.readFileSync(path.join(cwd, 'material/a/meta.md'), 'utf8');
  for (const l of ['title: Title A', 'status: raw', 'source: doc.md#A', 'period: 2024', 'role: lead', 'tags: x,y']) {
    assert.ok(meta.split('\n').includes(l), l);
  }
  const result = fs.readFileSync(path.join(cwd, 'material/a/result.md'), 'utf8');
  assert.match(result, /\| number \| evidence source \| label \|/);
  assert.match(result, /user-stated/);
  assert.match(result, /근거 없음/);
  assert.match(fs.readFileSync(path.join(cwd, 'material/a/problem.md'), 'utf8'), /^# 문제/);

  fs.appendFileSync(path.join(cwd, 'material/a/problem.md'), 'filled by hand\n');
  const before = snap(path.join(cwd, 'material'));
  const again = run(cwd, ['init', '--id', 'a', '--title', 'Other', '--source', 'other.md']);
  assert.equal(again.json.result, 'exists');
  assert.deepEqual(snap(path.join(cwd, 'material')), before);
});

test('init: a partial folder reports exists and is not completed', () => {
  const { cwd } = project();
  fs.mkdirSync(path.join(cwd, 'material/p'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'material/p/meta.md'), 'title: P\n');
  const before = snap(path.join(cwd, 'material'));
  assert.equal(init(cwd, 'p').json.result, 'exists');
  assert.deepEqual(snap(path.join(cwd, 'material')), before);
});

test('match: new / same / ambiguous (string difference only, never resolved, nothing written)', () => {
  const { cwd } = project();
  const m = (id, source, title) => run(cwd, ['match', '--id', id, '--source', source, '--title', title]).json;
  assert.equal(m('x', 'a.md#p1', 'Cache').result, 'new');
  assert.equal(fs.existsSync(path.join(cwd, 'material')), false, 'match writes nothing');

  init(cwd, 'a-p1--cache', 'Cache', 'a.md#p1');
  const same = m('x', ' A.md#P1 ', 'cache');            // normalised: trim, case-fold, whitespace
  assert.equal(same.result, 'same');
  assert.equal(same.candidates[0].id, 'a-p1--cache');
  assert.equal(m('y', 'a.md#p1', 'Queue').result, 'ambiguous');                            // same source, different title
  assert.equal(m('z', 'b.md#p9', 'Cache').result, 'ambiguous');                            // same title, other source
  assert.equal(m('w', 'b.md#p9', 'Brand new').result, 'new');

  // Fixtures below are string comparisons only: a renamed episode ("Cache layer") is seen as
  // "same source, different title", not recognised semantically; same episode under two sources
  // is seen as "same title, different source". Both are reported, never resolved.
  const renamed = m('r', 'a.md#p1', 'Cache layer');
  assert.equal(renamed.result, 'ambiguous');
  assert.equal(renamed.candidates[0].reason, 'same source, different title');
  const twoSources = m('t', 'c.md#q', 'Cache');
  assert.equal(twoSources.result, 'ambiguous');
  assert.equal(twoSources.candidates[0].reason, 'same title, different source');
  assert.deepEqual(Object.keys(twoSources.candidates[0]).sort(), ['id', 'reason', 'source', 'title']);

  const files = snap(path.join(cwd, 'material'));
  m('t', 'c.md#q', 'Cache');
  assert.deepEqual(snap(path.join(cwd, 'material')), files, 'match wrote no file');
});

test('match: also reads index.md rows', () => {
  const { cwd } = project();
  fs.mkdirSync(path.join(cwd, 'material'));
  fs.writeFileSync(path.join(cwd, 'material/index.md'),
    '| id | title | status | source |\n|---|---|---|---|\n| old | Old Story | raw | notes.md |\n');
  const r = run(cwd, ['match', '--id', 'n', '--source', 'notes.md', '--title', 'old story']).json;
  assert.equal(r.result, 'same');
  assert.equal(r.candidates[0].id, 'old');
});

test('index: every item once with status; N then N+1 rows; re-run is byte identical', () => {
  const { cwd } = project();
  init(cwd, 'b'); init(cwd, 'a'); init(cwd, 'c');
  const r1 = run(cwd, ['index']).json;
  assert.deepEqual(r1.rows.map((r) => r.id), ['a', 'b', 'c']);
  assert.ok(r1.rows.every((r) => r.status === 'raw'));
  assert.deepEqual(r1.skipped, []);
  const idx = path.join(cwd, 'material/index.md');
  const first = fs.readFileSync(idx, 'utf8');
  run(cwd, ['index']);
  assert.equal(fs.readFileSync(idx, 'utf8'), first);

  init(cwd, 'd');
  fs.mkdirSync(path.join(cwd, 'material/nometa'));
  const r2 = run(cwd, ['index']).json;
  assert.equal(r2.rows.length, 4);
  assert.deepEqual(r2.skipped, ['nometa']);
  const body = fs.readFileSync(idx, 'utf8').split('\n').filter((l) => /^\| \[[a-d]\]/.test(l));
  assert.equal(body.length, 4);
  assert.equal(new Set(body).size, 4);
  assert.ok(body[0].startsWith('| [a](a/meta.md) | T a | raw | resume.md#a |'));
});

test('foreign: lists hand-made files; no subcommand modifies them', () => {
  const { cwd } = project();
  init(cwd, 'a');
  const mat = path.join(cwd, 'material');
  fs.writeFileSync(path.join(mat, 'notes.md'), 'mine');
  fs.writeFileSync(path.join(mat, 'a', 'extra.md'), 'mine too');
  fs.mkdirSync(path.join(mat, 'loose'));
  fs.writeFileSync(path.join(mat, 'loose', 'x.txt'), 'x');
  const handmade = [path.join(mat, 'notes.md'), path.join(mat, 'a/extra.md'), path.join(mat, 'loose/x.txt')];
  const state = (p) => `${fs.statSync(p).mtimeMs}:${fs.readFileSync(p, 'utf8')}`;
  const before = Object.fromEntries(handmade.map((p) => [p, state(p)]));

  assert.deepEqual(run(cwd, ['foreign']).json, { foreign: ['a/extra.md', 'loose/x.txt', 'notes.md'] });
  run(cwd, ['id', '--source', 's', '--title', 't']);
  run(cwd, ['match', '--id', 'q', '--source', 's', '--title', 't']);
  init(cwd, 'b');
  init(cwd, 'a');
  run(cwd, ['index']);
  run(cwd, ['log', '--id', 'a', '--note', 'n', '--status', 'shaped', '--later-step', 'shape']);
  run(cwd, ['foreign']);
  for (const p of handmade) {
    assert.equal(state(p), before[p], p);
  }
  assert.equal(run(cwd, ['foreign']).json.foreign.length, 3, 'index.md and the seven parts are not foreign');
  assert.deepEqual(run(project().cwd, ['foreign']).json, { foreign: [] });
});

test('log: appends a dated line, keeps earlier lines, status edit touches only the status line', () => {
  const { cwd } = project();
  init(cwd, 'a');
  const hist = path.join(cwd, 'material/a/history.md');
  const metaP = path.join(cwd, 'material/a/meta.md');
  const h0 = fs.readFileSync(hist, 'utf8');
  const m0 = fs.readFileSync(metaP, 'utf8');

  run(cwd, ['log', '--id', 'a', '--note', 'first note'], { MATERIAL_DATE: '2026-03-04' });
  const h1 = fs.readFileSync(hist, 'utf8');
  assert.ok(h1.startsWith(h0));
  assert.equal(h1.slice(h0.length), '- 2026-03-04: first note\n');
  assert.equal(fs.readFileSync(metaP, 'utf8'), m0, 'no --status: meta untouched');

  const r = run(cwd, ['log', '--id', 'a', '--note', 'moved', '--status', 'shaped', '--later-step', 'shape']);
  assert.equal(r.code, 0);
  const h2 = fs.readFileSync(hist, 'utf8');
  assert.ok(h2.startsWith(h1));
  assert.equal(h2.slice(h1.length), `- ${DATE}: moved (status: raw -> shaped; step: shape)\n`);
  assert.equal(fs.readFileSync(metaP, 'utf8'), m0.replace('status: raw', 'status: shaped'));

  const bad = run(cwd, ['log', '--id', 'ghost', '--note', 'x']);
  assert.equal(bad.code, 1);
  assert.match(bad.json.error, /unknown id/);
  assert.equal(fs.existsSync(path.join(cwd, 'material/ghost')), false);
  const before = snap(path.join(cwd, 'material'));
  assert.equal(run(cwd, ['log', '--id', 'a', '--note', 'x', '--status', 'done', '--later-step', 'shape']).code, 1);
  assert.deepEqual(snap(path.join(cwd, 'material')), before, 'invalid status writes nothing');
});

test('status guard: step 1 never changes status; --status needs --later-step, else refused and nothing written', () => {
  const { cwd } = project();
  init(cwd, 'a');
  const mat = path.join(cwd, 'material');
  const before = snap(mat);
  const refused = run(cwd, ['log', '--id', 'a', '--note', 'moved', '--status', 'shaped']);
  assert.equal(refused.code, 1);
  assert.match(refused.json.error, /later steps/);
  const refusedInit = run(cwd, ['init', '--id', 'b', '--title', 't', '--source', 's', '--status', 'shaped']);
  assert.equal(refusedInit.code, 1);
  assert.match(refusedInit.json.error, /later steps/);
  assert.deepEqual(snap(mat), before, 'refused calls write nothing');
  assert.match(fs.readFileSync(path.join(mat, 'a/meta.md'), 'utf8'), /^status: raw$/m);
  // the step-1 flow (init, log without --status, answer, index) leaves status raw
  run(cwd, ['log', '--id', 'a', '--note', 'step-1 note']);
  run(cwd, ['index']);
  assert.match(fs.readFileSync(path.join(mat, 'a/meta.md'), 'utf8'), /^status: raw$/m);
  assert.match(fs.readFileSync(path.join(mat, 'index.md'), 'utf8'), /\| \[a\]\(a\/meta\.md\) \| T a \| raw \|/);
});

test('id: a source that already ends in the title does not repeat it', () => {
  const { cwd } = project();
  assert.equal(run(cwd, ['id', '--source', 'retro.md#검색 API 지연', '--title', '검색 API 지연']).json.id, 'retro-md--검색-api-지연');
  assert.equal(run(cwd, ['id', '--source', 'retro.md', '--title', '검색 지연']).json.id, 'retro-md--검색-지연');
});

test('match: a linked index row still matches; a merged second source is same afterwards', () => {
  const { cwd } = project();
  init(cwd, 'a', 'Search latency', 'retro.md#a');
  run(cwd, ['index']);
  fs.rmSync(path.join(cwd, 'material/a/meta.md'));
  assert.equal(run(cwd, ['match', '--id', 'a', '--source', 'retro.md#a', '--title', 'Search latency']).json.result, 'same');
  const { cwd: c2 } = project();
  init(c2, 'a', 'Search latency', 'retro.md#a');
  assert.equal(run(c2, ['match', '--id', 'x', '--source', 'notes.md', '--title', 'Search latency']).json.result, 'ambiguous');
  const added = run(c2, ['log', '--id', 'a', '--note', 'merged notes.md', '--add-source', 'notes.md']).json;
  assert.match(added.line, /source added: notes\.md/);
  assert.match(fs.readFileSync(path.join(c2, 'material/a/meta.md'), 'utf8'), /^source: retro\.md#a\nalso: notes\.md$/m);
  assert.equal(run(c2, ['match', '--id', 'x', '--source', 'notes.md', '--title', 'Search latency']).json.result, 'same');
  assert.equal(run(c2, ['log', '--id', 'a', '--note', 'merged notes.md', '--add-source', 'notes.md']).json.result, 'unchanged');
});

test('gaps: counts open and answered questions per item from gaps.md', () => {
  const { cwd } = project();
  init(cwd, 'a'); init(cwd, 'b');
  fs.appendFileSync(path.join(cwd, 'material/a/gaps.md'), '- [result] 기준은?\n- [problem] 언제?\n');
  run(cwd, ['answer', '--id', 'a', '--question', '[problem] 언제?', '--citation', 'notes.md#1']);
  const r = run(cwd, ['gaps']).json;
  assert.equal(r.open, 1);
  assert.deepEqual(r.items, [{ id: 'a', open: 1, answered: 1 }, { id: 'b', open: 0, answered: 0 }]);
});

const QUESTION = '[result] 40% 단축은 무엇을 기준으로 측정했나요?';
const CITE = 'retro2.md + "## 에피소드 A"';
function withGaps(cwd, id = 'a') {
  init(cwd, id);
  const gaps = path.join(cwd, 'material', id, 'gaps.md');
  fs.appendFileSync(gaps, `- ${QUESTION}\n- [problem] 장애 시각은 언제인가요?\n`);
  return gaps;
}

test('answer: the question line stays visible, marked answered with its citation, never deleted', () => {
  const { cwd } = project();
  const gaps = withGaps(cwd);
  const r = run(cwd, ['answer', '--id', 'a', '--question', QUESTION, '--citation', CITE]);
  assert.equal(r.code, 0);
  assert.equal(r.json.result, 'answered');
  const lines = fs.readFileSync(gaps, 'utf8').split('\n');
  assert.ok(lines.includes(`- [답변됨] ${QUESTION} — 답변: ${CITE}`), 'answered line kept with citation');
  assert.ok(!lines.includes(`- ${QUESTION}`), 'no longer listed as open');
  assert.ok(lines.includes('- [problem] 장애 시각은 언제인가요?'), 'other open question untouched');
  assert.equal(lines.filter((l) => l.includes('40% 단축은')).length, 1, 'question not deleted, not duplicated');
});

test('answer: a re-run without the answer leaves every question open; unknown or ambiguous questions are refused', () => {
  const { cwd } = project();
  const gaps = withGaps(cwd);
  const before = snap(path.join(cwd, 'material'));
  run(cwd, ['log', '--id', 'a', '--note', 'no new material']);
  run(cwd, ['index']);
  const text = fs.readFileSync(gaps, 'utf8');
  assert.ok(text.includes(`- ${QUESTION}\n`) && !text.includes('[답변됨]'));
  assert.equal(run(cwd, ['answer', '--id', 'a', '--question', '없는 질문', '--citation', CITE]).code, 1);
  assert.equal(run(cwd, ['answer', '--id', 'ghost', '--question', QUESTION, '--citation', CITE]).code, 1);
  assert.equal(fs.readFileSync(gaps, 'utf8'), text);
  assert.notDeepEqual(snap(path.join(cwd, 'material')), before, 'sanity: the log call did write once');
  fs.appendFileSync(gaps, `- ${QUESTION}\n`);
  assert.match(run(cwd, ['answer', '--id', 'a', '--question', QUESTION, '--citation', CITE]).json.error, /ambiguous/);
});

test('answer: the same answer again is unchanged; a different citation for an answered question is refused', () => {
  const { cwd } = project();
  const gaps = withGaps(cwd);
  run(cwd, ['answer', '--id', 'a', '--question', QUESTION, '--citation', CITE]);
  const once = fs.readFileSync(gaps, 'utf8');
  const again = run(cwd, ['answer', '--id', 'a', '--question', QUESTION, '--citation', CITE]);
  assert.equal(again.json.result, 'unchanged');
  assert.equal(fs.readFileSync(gaps, 'utf8'), once);
  assert.equal(run(cwd, ['answer', '--id', 'a', '--question', QUESTION, '--citation', 'other.md + L1']).code, 1);
  assert.equal(fs.readFileSync(gaps, 'utf8'), once);
});

test('no-op run: repeating an identical operation changes no byte of any file under material/, history.md included', () => {
  const { cwd } = project();
  const mat = path.join(cwd, 'material');
  const sha = (dir) => {
    const out = {};
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else out[path.relative(dir, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      }
    };
    walk(dir);
    return out;
  };
  const pass = (env) => {
    run(cwd, ['init', '--id', 'a', '--title', 'T a', '--source', 'resume.md#a'], env);
    run(cwd, ['log', '--id', 'a', '--note', 'retro.md: problem and decision filled'], env);
    run(cwd, ['answer', '--id', 'a', '--question', QUESTION, '--citation', CITE], env);
    run(cwd, ['index'], env);
  };
  withGaps(cwd);
  pass({});
  const first = sha(mat);
  assert.ok(Object.keys(first).length > 7);
  pass({ MATERIAL_DATE: '2027-05-06' });          // identical input, another day
  assert.deepEqual(sha(mat), first);
  assert.equal(fs.readFileSync(path.join(mat, 'a/history.md'), 'utf8').match(/retro\.md: problem/g).length, 1);
});

test('one marker and one rule: 근거 없음 only, answered questions kept, status reserved (script, SKILL.md, references agree)', () => {
  const root = path.join(import.meta.dirname, '..');
  const files = [path.join(root, 'SKILL.md'), ...fs.readdirSync(path.join(root, 'references')).map((f) => path.join(root, 'references', f)), SCRIPT, import.meta.filename];
  const read = (f) => fs.readFileSync(f, 'utf8');
  const marker = '확인 ' + '필요';
  for (const f of files) assert.ok(!read(f).includes(marker), `${path.basename(f)} has the old marker`);
  const skill = read(path.join(root, 'SKILL.md'));
  const parts = read(path.join(root, 'references/parts.md'));
  assert.match(skill, /근거 없음/);
  assert.match(parts, /근거 없음/);
  assert.match(skill, /\[답변됨\]/);
  assert.match(parts, /\[답변됨\]/);
  assert.ok(!/delete that question/i.test(parts), 'parts.md no longer deletes answered questions');
  assert.match(skill, /never changes (the )?status/i);
  assert.match(skill, /a no-op run writes nothing, history\.md included/i);
  assert.match(skill, /--later-step/);
});

test('writes stay under material/; hostile ids are rejected', () => {
  const { parent, cwd } = project();
  init(cwd, 'a');
  const outsideBefore = snap(parent);
  const inside = (s) => Object.fromEntries(Object.entries(s).filter(([p]) => !p.startsWith(path.join(cwd, 'material'))));
  for (const bad of ['../x', '..', 'a/b', '/etc/x', 'a\\b', '.hidden', '']) {
    for (const args of [
      ['init', '--id', bad, '--title', 't', '--source', 's'],
      ['log', '--id', bad, '--note', 'n'],
      ['match', '--id', bad, '--source', 's', '--title', 't'],
    ]) {
      const r = run(cwd, args);
      assert.equal(r.code, 1, args.join(' '));
      assert.ok(r.json.error);
    }
  }
  assert.deepEqual(snap(parent), outsideBefore);
  // a symlinked material/<id> pointing out is not followed
  const target = path.join(parent, 'sibling');
  fs.symlinkSync(target, path.join(cwd, 'material/link'));
  const before = snap(target);
  assert.equal(run(cwd, ['log', '--id', 'link', '--note', 'n']).code, 1);
  assert.deepEqual(snap(target), before);
  // across the whole run nothing outside material/ in the project or its parent appeared
  run(cwd, ['index']);
  assert.deepEqual(inside(snap(parent)), inside(outsideBefore));
  assert.deepEqual(fs.readdirSync(cwd), ['material']);
});

test('usage errors: JSON {error}, non-zero exit', () => {
  const { cwd } = project();
  for (const args of [[], ['nope'], ['id', '--source', 's'], ['init', '--id', 'a', '--title', 't'],
    ['init', '--id', 'a', '--title', 't', '--source', 's', '--status', 'bogus'], ['log', '--id', 'a'], ['id', '--bogus', 'x'], ['id', '--source']]) {
    const r = run(cwd, args);
    assert.equal(r.code, 1, args.join(' '));
    assert.deepEqual(Object.keys(r.json), ['error']);
  }
  assert.equal(fs.existsSync(path.join(cwd, 'material')), false);
});

test('every subcommand prints exactly one JSON object; script imports only node: built-ins', () => {
  const { cwd } = project();
  for (const args of [
    ['id', '--source', 's', '--title', 't'],
    ['match', '--id', 'i', '--source', 's', '--title', 't'],
    ['init', '--id', 'i', '--title', 't', '--source', 's'],
    ['index'],
    ['log', '--id', 'i', '--note', 'n'],
    ['foreign'],
  ]) {
    const r = run(cwd, args); // run() asserts a single stdout line that parses as JSON
    assert.equal(r.code, 0, args[0]);
    assert.equal(typeof r.json, 'object');
    assert.ok(!Array.isArray(r.json));
  }
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const specs = [...src.matchAll(/^import\s.*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  assert.ok(specs.length > 0);
  assert.ok(specs.every((s) => s.startsWith('node:')), specs.join());
  assert.ok(!/\brequire\(|import\(/.test(src));
});

// Card 69 (a): a workspace whose material is a per-project ledger, sources/NN_프로젝트/A1….md, is read as it is.
function ledgerProject({ nfd = false } = {}) {
  const { cwd } = project();
  const n = (s) => (nfd ? s.normalize('NFD') : s);
  fs.mkdirSync(path.join(cwd, 'sources', n('01_가상검색')), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'sources', n('02_가상알림')), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'sources', n('01_가상검색'), n('A1_검색개편.md')), '# 검색 개편\n\n- 문제: 느렸다\n');
  fs.writeFileSync(path.join(cwd, 'sources', n('01_가상검색'), n('A2_캐시.md')), '- 제목 없는 글\n');
  fs.writeFileSync(path.join(cwd, 'sources', n('02_가상알림'), n('A1_알림.md')), '# 알림 배치\n');
  fs.writeFileSync(path.join(cwd, 'sources', 'README.md'), '# not an item\n');
  return cwd;
}

test('ledger lists every A-file per project folder, NFC ids, title from the first heading', () => {
  const cwd = ledgerProject({ nfd: true });
  const r = run(cwd, ['ledger']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.items.map((i) => [i.id, i.title, i.written]), [
    ['01_가상검색/A1', '검색 개편', false], ['01_가상검색/A2', 'A2_캐시', false], ['02_가상알림/A1', '알림 배치', false],
  ]);
});

test('ledger-log appends one line under ## 이력 at the end, once; the rest of the file is untouched', () => {
  const cwd = ledgerProject();
  const file = path.join(cwd, 'sources', '01_가상검색', 'A1_검색개편.md');
  const before = fs.readFileSync(file, 'utf8');
  const args = ['ledger-log', '--item', '01_가상검색/A1', '--note', 'skeleton 2쪽', '--status', 'written', '--later-step', 'manage'];
  assert.equal(run(cwd, args).json.result, 'logged');
  assert.equal(fs.readFileSync(file, 'utf8'), `${before}\n## 이력\n- ${DATE} skeleton 2쪽 (status: written, manage)\n`);
  assert.equal(run(cwd, args).json.result, 'unchanged');
  run(cwd, ['ledger-log', '--item', '01_가상검색/A1', '--note', '3쪽으로 이동']);
  assert.match(fs.readFileSync(file, 'utf8'), /## 이력\n- .* \(status: written, manage\)\n- 2026-01-02 3쪽으로 이동\n$/);
  assert.equal(run(cwd, ['ledger']).json.items[0].written, true);
  assert.ok(!fs.existsSync(path.join(cwd, 'material')));
});

test('ledger-log refuses a status without its later step, and an unknown item', () => {
  const cwd = ledgerProject();
  assert.equal(run(cwd, ['ledger-log', '--item', '01_가상검색/A1', '--note', 'x', '--status', 'written']).code, 1);
  assert.match(run(cwd, ['ledger-log', '--item', '09_없음/A1', '--note', 'x']).json.error, /no ledger item/);
});

test('a manage workspace (sources/ at the root) keeps items in sources/material/, run from the root (card 103)', () => {
  const { cwd } = project();
  fs.mkdirSync(path.join(cwd, 'sources'));
  assert.equal(init(cwd, 'a').json.result, 'created');
  assert.ok(fs.existsSync(path.join(cwd, 'sources/material/a/meta.md')));
  assert.ok(!fs.existsSync(path.join(cwd, 'material')), 'no stray material/ at the root');
  assert.deepEqual(run(cwd, ['index']).json.rows.map((r) => r.id), ['a']);
  // a project that already keeps ./material/ goes on using it
  const other = project().cwd;
  fs.mkdirSync(path.join(other, 'sources'));
  fs.mkdirSync(path.join(other, 'material'));
  init(other, 'b');
  assert.ok(fs.existsSync(path.join(other, 'material/b/meta.md')));
});
