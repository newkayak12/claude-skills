// teams/scripts/test-names.mjs - pure naming functions (mcp/names.mjs): epic slug, package label,
// collision suffix. No server, no filesystem; `git check-ref-format` is spawned only to prove
// every name is a legal ref component.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { epicSlug, packageName, uniqueSlug } from '../mcp/names.mjs';

const SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CARD46 = 'Backlog card 46 (_repo/docs/backlog.md): tasks, branches and worktrees named in words a person can read. '
  + 'A branch is teams/<slug>/P1-pkg and view.mjs shows it.';
const USER_SENTENCE = 'backlog harness의 티캣,을 4522629같은거 말고 자연어로 정하면 더 좋을 것 같음 사람이 알 수 있게';

test('ascii request: stopwords dropped, words in order', () => {
  assert.equal(epicSlug('Fix skeleton gaps in develop skills'), 'fix-skeleton-gaps-develop-skills');
  assert.equal(epicSlug('Add the memo pane'), 'add-memo-pane');
  assert.equal(epicSlug('card 46 backlog 2026 memo'), 'memo');
});

test('path and file tokens give no words (card 46 request)', () => {
  assert.equal(epicSlug(CARD46), 'tasks-branches-worktrees-named');
  const a = epicSlug('Backlog card 12 (_repo/docs/backlog.md): fix pane');
  assert.equal(a, 'fix-pane');
  assert.ok(!epicSlug('Edit view.mjs and teams/mcp/x.mjs: rename things').startsWith('view'));
  assert.equal(epicSlug('Edit view.mjs. rename things'), 'edit-rename-things');
});

test('wrapped file tokens give no words', () => {
  assert.equal(epicSlug('Fix `view.mjs` rendering'), 'fix-rendering');
  for (const w of ['**view.mjs**', '“view.mjs”', '<view.mjs>', 'view.mjs—']) {
    assert.equal(epicSlug(`Fix ${w} rendering`), 'fix-rendering', w);
  }
  assert.equal(epicSlug('Backlog card 48 (`_repo/docs/backlog.md`): fix pane layout'), 'fix-pane-layout');
});

test('deterministic and insensitive to case, whitespace, punctuation', () => {
  const base = epicSlug('Fix skeleton gaps');
  assert.equal(epicSlug('Fix skeleton gaps'), base);
  for (const v of ['FIX SKELETON GAPS', '  fix   skeleton\n gaps  ', 'Fix, skeleton; gaps!', '(fix) skeleton: gaps.']) {
    assert.equal(epicSlug(v), base, v);
  }
});

test('long input is cut at a word boundary, <= 32, no trailing dash', () => {
  assert.equal(epicSlug('alpha bravo charlie delta echo foxtrot golf'), 'alpha-bravo-charlie-delta-echo');
  assert.equal(epicSlug('x'.repeat(50)), 'x'.repeat(32));
  const inputs = ['one two three four five six seven eight nine ten eleven twelve'];
  for (let i = 0; i < 200; i++) {
    inputs.push(Array.from({ length: 1 + (i % 12) }, (_, j) => 'w'.repeat(1 + ((i * 7 + j * 5) % 14)) + (j % 3 ? '' : i)).join(' '));
  }
  for (const r of inputs) {
    const s = epicSlug(r);
    assert.ok(s.length <= 32 && SHAPE.test(s), `${r} -> ${s}`);
  }
});

test('Korean-only request is romanized (pinned spellings)', () => {
  assert.equal(epicSlug('메모 패널 개선'), 'memo-paeneol-gaeseon');
  assert.equal(epicSlug('한국어'), 'hangukeo'); // no liaison
  assert.equal(epicSlug('값 닭 읽다'), 'gap-dak-ikda');
  assert.equal(epicSlug('밖'), 'bak');
});

test('trailing Korean particle is dropped before romanizing; longest wins; lone particle kept', () => {
  const sentence = 'harness UI 티켓을 같은거';
  const s = epicSlug(sentence);
  assert.ok(!s.split('-').includes('eul') && s !== 'harness-ui-tikaet-eul-gateungeo', s);
  assert.equal(s, 'harness-ui');
  assert.equal(epicSlug('티켓을 같은거'), 'tiket-gateungeo'); // Korean-only: 을 off 티켓을
  assert.equal(epicSlug('서버에서 파일으로'), 'seobeo-pail'); // 에서 and 으로 beat 에 / 로
  assert.equal(epicSlug('을'), 'eul'); // only a particle: kept
  assert.equal(epicSlug('이 의'), 'i-ui');
  assert.equal(epicSlug('메모 패널 개선'), 'memo-paeneol-gaeseon'); // 선 is no particle
});

test('mixed request: two+ ascii words win; fewer romanize Hangul too', () => {
  assert.equal(epicSlug('메모 pane fix 개선'), 'pane-fix');
  const s = epicSlug(USER_SENTENCE);
  assert.notEqual(s, 'harness');
  assert.ok(s.startsWith('harness-ui-tikaet'), s);
  assert.ok(s.length <= 32 && SHAPE.test(s));
});

test('no ascii word and no Hangul gives task-<6 hex>, deterministic', () => {
  const s = epicSlug('🚀 !!! ???');
  assert.match(s, /^task-[0-9a-f]{6}$/);
  assert.equal(epicSlug('🚀 !!! ???'), s);
  assert.notEqual(epicSlug('🔥'), s);
  assert.match(epicSlug(''), /^task-[0-9a-f]{6}$/);
});

test('uniqueSlug', () => {
  assert.equal(uniqueSlug('x', []), 'x');
  assert.equal(uniqueSlug('x', ['x']), 'x-2');
  assert.equal(uniqueSlug('x', ['x', 'x-2']), 'x-3');
  assert.equal(uniqueSlug('x', new Set(['x', 'x-2'])), 'x-3');
  const long = 'alpha-bravo-charlie-delta-echo-f'; // 32 chars
  assert.equal(long.length, 32);
  const u = uniqueSlug(long, [long]);
  assert.ok(u.length <= 32 && u.endsWith('-2') && SHAPE.test(u), u);
  assert.equal(uniqueSlug('abcdefghijklmnopqrstuvwxyzabc-d', ['abcdefghijklmnopqrstuvwxyzabc-d']), 'abcdefghijklmnopqrstuvwxyzabc-2');
});

test('packageName', () => {
  assert.equal(packageName('P2', 'Memo pane'), 'P2-memo-pane');
  assert.equal(packageName('P2', ''), 'P2');
  assert.equal(packageName('P2', undefined), 'P2');
  assert.ok(packageName('PLAN-F3', '메모').startsWith('PLAN-F3-'));
  assert.equal(packageName('PLAN-F3', '메모'), 'PLAN-F3-memo');
  const long = packageName('P1', 'implementation of the extraordinarily long configuration handler');
  assert.ok(long.slice('P1-'.length).length <= 24, long);
  assert.equal(long, 'P1-implementation');
  assert.ok(!long.endsWith('-'));
});

test('every name is a legal git branch', () => {
  const slugs = [epicSlug(CARD46), epicSlug(USER_SENTENCE), epicSlug('메모 패널 개선'), epicSlug('🚀'),
    epicSlug('Fix skeleton gaps in develop skills'), uniqueSlug(epicSlug('x'.repeat(40)), ['x'.repeat(32)])];
  const labels = [packageName('P2', 'Memo pane'), packageName('PLAN-F3', '메모'), packageName('AUDIT', ''),
    packageName('QA-F1', 'run the whole suite against staging environment'), 'integration', 'integration-2'];
  for (const s of slugs) {
    for (const l of labels) {
      const r = spawnSync('git', ['check-ref-format', '--branch', `teams/${s}/${l}`], { encoding: 'utf8' });
      assert.equal(r.status, 0, `teams/${s}/${l}: ${r.stderr}`);
    }
  }
});
