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
  // a card reference turns card mode on: one word left, so the card number leads the slug
  assert.equal(epicSlug('card 46 backlog 2026 memo'), 'card-46-memo');
});

// The three requests card 66 lists, as the 2026-10-23 board showed them (the real plan path for card 48).
const CARD66 = [
  ['Backlog card 48, plan `_repo/docs/plans/2026-10-17-graph-harness-into-teams.md` (graph + harness). '
    + 'Read it fully, no version bump, tasks only.', 'card-48-graph-harness-into-teams'],
  ['Backlog card 51: read it fully, no version bump, only parts. Then check the pane.', 'card-51'],
  ['Backlog cards 62, 63, 64: read each teams plugin, no version bump. Parts only.', 'cards-62-64-teams'],
];

test('card mode: the three card-66 requests', () => {
  for (const [request, slug] of CARD66) assert.equal(epicSlug(request), slug, request);
  assert.equal(epicSlug(CARD66[0][0]).length, 32);
});

test('card mode: prefix shapes', () => {
  assert.equal(epicSlug('Card 12: read it fully'), 'card-12');
  assert.equal(epicSlug('Backlog card #7: fix'), 'card-7-fix');
  assert.equal(epicSlug('Backlog cards 3 & 4 & 5 & 6: fix'), 'cards-3-6-fix'); // 3+ consecutive: a range
  assert.equal(epicSlug('Backlog cards 5 and 6: fix'), 'cards-5-6-fix'); // two are listed, not a range
  assert.equal(epicSlug('Backlog cards 1, 3, 4: fix'), 'cards-1-3-4-fix'); // not consecutive: all listed
  assert.equal(epicSlug('Backlog cards 5 and 9: fix'), 'cards-5-9-fix');
  assert.equal(epicSlug('Backlog cards 5 and 9: fix pane'), 'fix-pane'); // 2+ words and no plan topic: words only
  assert.equal(epicSlug('Backlog card 12 (_repo/docs/backlog.md): fix pane'), 'fix-pane');
});

test('card mode: first sentence only; a .md inside a path does not end it', () => {
  assert.equal(epicSlug('Backlog card 9: fix pane! Then rename things.'), 'fix-pane');
  assert.equal(epicSlug('Backlog card 9 (_repo/docs/backlog.md) fix pane. Rename things'), 'fix-pane');
  assert.equal(epicSlug('Card 9 fix pane layout?'), 'fix-pane-layout');
});

test('card mode: plan topic is verbatim, replaces other words, prefix kept whole at the cap', () => {
  assert.equal(epicSlug('Card 3: plan _repo/docs/plans/done/2026-10-01-memo-pane.md, fix other things'), 'card-3-memo-pane');
  const long = epicSlug('Backlog card 48: plan `_repo/docs/plans/mod/2026-10-23-graph-harness-into-teams-and-everything-else.md`');
  assert.equal(long, 'card-48-graph-harness-into-teams');
  assert.ok(long.length <= 32 && SHAPE.test(long));
  // a prefix longer than 32 is cut back to its last '-' boundary
  const cut = epicSlug('Backlog cards 1111, 2222, 3333, 4444, 5555, 6666, 7777: fix');
  assert.equal(cut, 'cards-1111-2222-3333-4444-5555');
  assert.ok(cut.length <= 32 && SHAPE.test(cut));
});

test('no card reference: unchanged, whole request, filler words kept', () => {
  assert.equal(epicSlug('Read version notes'), 'read-version-notes');
  assert.equal(epicSlug('Fix pane. Then rename things'), 'fix-pane-then-rename-things');
  assert.equal(epicSlug('Fix the card layout'), 'fix-layout');
  assert.equal(epicSlug('Fix cards layout'), 'fix-layout');
  assert.equal(epicSlug('Edit view.mjs. rename things'), 'edit-rename-things');
});

test('a possessive \'s drops; a plural possessive stays a word', () => {
  const card94 = 'Backlog card 94\'s three open defects (_repo/docs/backlog.md, "teams-status shows …"; …).';
  assert.equal(epicSlug(card94), 'open-defects-teams-status-shows');
  for (const r of [card94, 'Fix the user\'s pane', 'Fix Bob’s pane']) {
    assert.ok(!/(^|-)s(-|$)/.test(epicSlug(r)), r);
  }
  assert.equal(epicSlug('Fix the user\'s pane'), 'fix-pane');
  assert.equal(epicSlug('Fix Bob’s pane'), 'fix-bob-pane');
  assert.equal(epicSlug('Fix the users\' pane'), 'fix-users-pane');
});

test('a contraction keeps its word: only the apostrophe drops', () => {
  assert.equal(epicSlug('It\'s broken'), 'its-broken');
  assert.equal(epicSlug('Let\'s go'), 'lets-go');
  assert.equal(epicSlug('What’s new here'), 'whats-new-here');
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
    epicSlug('Fix skeleton gaps in develop skills'), ...CARD66.map(([request]) => epicSlug(request)), uniqueSlug(epicSlug('x'.repeat(40)), ['x'.repeat(32)])];
  const labels = [packageName('P2', 'Memo pane'), packageName('PLAN-F3', '메모'), packageName('AUDIT', ''),
    packageName('QA-F1', 'run the whole suite against staging environment'), 'integration', 'integration-2'];
  for (const s of slugs) {
    for (const l of labels) {
      const r = spawnSync('git', ['check-ref-format', '--branch', `teams/${s}/${l}`], { encoding: 'utf8' });
      assert.equal(r.status, 0, `teams/${s}/${l}: ${r.stderr}`);
    }
  }
});
