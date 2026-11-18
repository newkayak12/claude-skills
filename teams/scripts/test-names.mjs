// teams/scripts/test-names.mjs - pure naming functions (mcp/names.mjs): epic slug, package label,
// collision suffix. No server, no filesystem; `git check-ref-format` is spawned only to prove
// every name is a legal ref component.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { epicName, epicSlug, givenName, packageName, taskName, uniqueSlug } from '../mcp/names.mjs';

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

const R130 = [
  'Card 130 part 1, model per stage (PRD F1): team.json / tm_open take a model per stage\nAcceptance:\n- a test',
  'Card 130 parts 2 and 4, lean short sessions (PRD F2): every driver, judge and broker adapter node spawn uses --strict-mcp-config',
  'Card 130 part 3, budget holds for every size (PRD F3): budget_usd stops a size-S driver',
];
const LONG_KO = '팀 대시보드에서 에픽 이름이 키만 보여서 사람이 무슨 작업인지 전혀 알 수 없는 문제를 고친다는 아주 긴 한국어 제목입니다';
const CARD125 = 'Backlog card 125: mod 상태를 소켓 하나로 합친다. 뷰어는 그대로 둔다.';
const GOLDEN = [
  ['a', ['Backlog card 127: every EPIC row reads as its key plus a short natural-language name, never the key alone. '
    + 'User, 2026-11-04, on a pane with rows `● E-0ad41780 ⑂ c…`: "EPIC 이름 이렇게 못알아보게 하지 말고".\nAcceptance:\n- a test', {}],
    'every EPIC row reads as its key plus a short…'],
  ['b', ['[backlog priority 0] Card 130 part 1, model per stage (PRD F1): team.json / tm_open take a model per stage (implement and test default Sonnet)', {}],
    'model per stage'],
  ['c', ['[backlog priority 0] Card 130 part 1, model per stage (PRD F1): team.json', { requests: R130 }],
    'model per stage · lean short sessions +1'],
  ['d', [CARD125, {}], 'mod 상태를 소켓 하나로 합친다'],
  ['e', ['[backlog priority 0] 테스트 fixture를 격리한다', { requests: ['테스트 fixture를 격리한다', '영역 겹침을 차단한다'] }],
    '테스트 fixture를 격리한다 · 영역 겹침을 차단한다'],
  ['f', ['Backlog card 145: tm_open takes `request` and `requests` together when they say the same thing, so callers stop failing on it.', {}],
    'tm_open takes request and requests together…'],
  ['g', ['[backlog priority 0] Card 145: a', { requests: ['Card 145: a', 'Card 146: b'], title: 'Cards 145 and 146: tm_open and tm_clean stop failing' }],
    'tm_open and tm_clean stop failing'],
  // (h) a chat sentence, not a title: whole tokens only, cut between tokens (a readable name is the stored one, below)
  ['h', [USER_SENTENCE, {}], 'backlog harness의 티캣,을 4522629같은거 말고 자연어로 정하면 더 좋을 것 같음 사람이…'],
  ['i', ['', { requests: [{ request: 'Card 130 part 3, budget holds for every size (PRD F3): x', acceptance: ['a'] }] }],
    'budget holds for every size'],
  ['j', ['', {}], 'untitled work'],
  ['j2', ['   ', {}], 'untitled work'],
  ['j3', ['1234 -- 56', {}], 'untitled work'],
  ['j4', ['Backlog card 51.', {}], 'untitled work'],
  ['j5', ['E-0ad41780', {}], 'untitled work'],
  ['k', [`${CARD125}   \nAcceptance:\n- 소켓 하나`, {}], 'mod 상태를 소켓 하나로 합친다'],
];

for (const [id, [request, opts], want] of GOLDEN) {
  test(`card 127 golden (${id}): ${want}`, () => {
    assert.deepStrictEqual(epicName(request, opts), want);
  });
}

const FN = new Set('a an the and or of to in for on with by as its is be from that which when into onto under after over about'.split(' '));
const GLUE = new Set('and or to in into under after of for with'.split(' '));
// Two glue words side by side ("Port and to ESM", "Delete and after") mean a path between them was removed and
// nothing marks it: the name is stranded, so none may have them.
function assertNoAdjacentGlue(n, what = n) {
  for (const item of n.replace(/ \+\d+$/, '').split(' · ')) {
    const ws = item.replace(/…$/, '').toLowerCase().split(/\s+/);
    for (let i = 1; i < ws.length; i++) assert.ok(!(GLUE.has(ws[i - 1]) && GLUE.has(ws[i])), `${what}: ${item} has "${ws[i - 1]} ${ws[i]}"`);
  }
}
// '…' only as the last character of an item; no trailing English function word on an item.
function assertCleanItems(n, what = n) {
  for (const item of n.replace(/ \+\d+$/, '').split(' · ')) {
    assert.ok(!item.slice(0, -1).includes('…'), `${what}: … inside ${item}`);
    const last = item.replace(/…$/, '').split(/\s+/).at(-1).toLowerCase();
    assert.ok(!FN.has(last), `${what}: ends on function word ${item}`);
  }
}

test('card 127 property: every golden and a long Korean sentence give a clean name', () => {
  for (const [request, opts] of [...GOLDEN.map(([, args]) => args), [LONG_KO, {}]]) {
    const n = epicName(request, opts);
    assert.ok(/\p{L}/u.test(n) && n.length <= 60, n);
    assert.ok(!/\[backlog|\bcards? \d+|E-[0-9a-f]{8}/i.test(n), n);
    assertCleanItems(n);
  }
  assert.match(epicName(LONG_KO), /\p{Script=Hangul}/u);
});

test('card 127 golden (h) readable: the stored model-written name wins; the sentence alone is cut between tokens', () => {
  const stored = givenName('티켓 이름을 자연어로');
  assert.deepStrictEqual(stored, '티켓 이름을 자연어로');
  assert.deepStrictEqual(taskName({ name: stored, request: USER_SENTENCE }), '티켓 이름을 자연어로');
  const alone = epicName(USER_SENTENCE);
  assert.deepStrictEqual(alone, 'backlog harness의 티캣,을 4522629같은거 말고 자연어로 정하면 더 좋을 것 같음 사람이…');
  assert.ok(!alone.endsWith('티캣') && alone.length <= 60);
  assert.deepStrictEqual(taskName({ request: USER_SENTENCE }), alone);
});

test('card 127 givenName: first line, whole-token cut at 60, blank gives empty', () => {
  assert.deepStrictEqual(givenName('first line here\nsecond line'), 'first line here');
  assert.deepStrictEqual(givenName('\n  \n  티켓 이름을 자연어로 \n둘째 줄'), '티켓 이름을 자연어로');
  assert.deepStrictEqual(givenName('   '), '');
  assert.deepStrictEqual(givenName(''), '');
  assert.deepStrictEqual(givenName(undefined), '');
  assert.deepStrictEqual(givenName('12345 !!!'), '');
  const eighty = 'abcde '.repeat(13).trim(); // 77 chars, 13 whole tokens
  assert.ok(eighty.length > 60);
  const cut = givenName(eighty);
  assert.deepStrictEqual(cut, `${'abcde '.repeat(10).trim()}…`); // 59 chars + …
  assert.ok(cut.length <= 60 && cut.endsWith('…'));
  const eighty2 = 'Rename the board column so that people see the ended EPICs first in every view'; // 78 chars
  assert.deepStrictEqual(givenName(eighty2), 'Rename the board column so that people see the ended EPICs…');
  assert.deepStrictEqual(givenName('x'.repeat(80)), `${'x'.repeat(59)}…`); // one long token: the only in-token cut, marked
  // a name that fits is kept as written, comma and subordinate words included
  assert.deepStrictEqual(givenName('Fix it, then when done ask'), 'Fix it, then when done ask');
});

const REAL = [
  ['Backlog card 90: rm with a bare unquoted $VAR is refused by repo-rules.mjs', 'rm with a bare unquoted $VAR is refused by repo-rules.mjs'],
  ['Fix the flaky CI test in teams/scripts/test-taskmanager.mjs', 'Fix the flaky CI test…'],
  ['[backlog priority 2] Backlog card 133: teams measured against gstack and cursor/plugins', 'teams measured against gstack…'],
  ['Add support for the --dry-run flag to patch.mjs so the bump can be previewed', 'Add support for the --dry-run flag to patch.mjs…'],
  ['카드 140: 팀 보드에서 STORY 칸반이 보이게 한다', '팀 보드에서 STORY 칸반이 보이게 한다'],
  ['W2 hygiene test vs a pre-existing .teams_wiki', 'W2 hygiene test vs a pre-existing .teams_wiki'],
];

test('card 127 property: real path-bearing and Korean card-prefixed requests', () => {
  for (const [request, want] of REAL) {
    const n = epicName(request);
    assert.ok(/\p{L}/u.test(n) && n.length <= 60, n);
    assert.ok(!/\[backlog|(?:cards?|카드)\s*\d+|E-[0-9a-f]{8}/i.test(n), n);
    assertCleanItems(n);
    for (const w of n.replace(/…$/, '').split(' ')) assert.ok(request.includes(w), `${n}: ${w} not a whole source word`);
  }
  for (const [request, want] of REAL) assert.equal(epicName(request), want, request);
});

// Gate-2 inputs: a file token (view.mjs) stays whole in the middle of a clause; a path token (a/b.ts, tmp/)
// is removed whole, never shortened to its basename.
const MID = [
  ['Rename view.mjs to viewer.mjs', 'Rename view.mjs to viewer.mjs'],
  ['Move teams/mcp/daemon.mjs logging into teams/mcp/proc.mjs', 'Move logging…'],
  ['Write tests onto view.mjs', 'Write tests onto view.mjs'],
  ['Fix the bug inside daemon.mjs', 'Fix the bug inside daemon.mjs'],
  ['Split the logic out of broker.mjs', 'Split the logic out of broker.mjs'],
  ['Move the wiki under _repo/docs/', 'Move the wiki…'],
  ['Update README.md and KOR.md for the trophy plugin', 'Update README.md and KOR.md for the trophy plugin'],
  // a removal that leaves under 2 content words before it: the head and a mark (the tm_open name is the readable path)
  ['Port src/a.ts, src/b.ts and src/c.ts to ESM', 'Port…'],
  ['Delete tmp/ and .harness-run/ after the bench', 'Delete…'],
  ['Copy x/y.md to z/w.md', 'Copy…'],
  ['Update docs in a/b.md and tidy', 'Update docs…'],
  // a removal before a content word keeps the plain removal
  ['Move teams/mcp/daemon.mjs logging now', 'Move logging now'],
  ['Refactor the broker so that normalize.mjs and independence.mjs share code', 'Refactor the broker…'],
  ['Add support for the --dry-run flag to patch.mjs so the bump tool works', 'Add support for the --dry-run flag to patch.mjs…'],
  ['Fix the crash in the view when task.json is missing', 'Fix the crash in the view when task.json is missing'],
  ['백로그 카드 141: 대시보드 색상을 바꾼다', '대시보드 색상을 바꾼다'],
  ['카드 127번: EPIC 이름을 자연어로', 'EPIC 이름을 자연어로'],
  ['카드 12번과 13번: 보드 색을 바꾼다', '보드 색을 바꾼다'],
  ['카드 12, 13번 보드 색을 바꾼다', '보드 색을 바꾼다'],
  ['harness/engine/pipeline.js에서 codex 폴백이 안 된다', 'codex 폴백이 안 된다'],
  ['codex 폴백이 안 한다', 'codex 폴백이 안 한다'],
  ['폴백이 못 한다', '폴백이 못 한다'],
  ['PRD: write a PRD for the onboarding flow', 'write a PRD for the onboarding flow'],
  ['Fix: crash when task.json is missing', 'crash when task.json is missing'],
];

test('card 127 property: mid-clause file tokens stay whole, path tokens go whole; no cut sentence, no card number', () => {
  const END = new Set('a an the its their and or but so that to for by from of in on at via as is be with into onto inside under out over about through across within between than while after before if when because which until unless'.split(' '));
  for (const [request, want] of MID) {
    const n = epicName(request);
    assert.equal(n, want, request);
    const words = n.replace(/…$/, '').split(' ');
    assert.ok(!END.has(words.at(-1).toLowerCase()), n);
    assertNoAdjacentGlue(n, request);
    assert.ok(!/(?:cards?|카드)\s*#?\d+|\d+\s*번|^번|\s번$|\[backlog|E-[0-9a-f]{8}/i.test(n), n);
    assert.ok(!/ 안$| 못$/.test(n), n);
    // one word only as a marked head: 'Port…' says a path was removed (see the removal cases above)
    assert.ok(words.length >= 2 || /[가-힣]/.test(n) || n.endsWith('…'), `single word: ${n}`);
  }
});

const ODD = ['a', 'A', 'the', 'an', 'its', 'a the an', '.', '...', ',', ':', ';', '?!', '()', '(a)', '`', '``', '—', '- - -', '/', '//', 'x/', '/x/',
    'src/a/b.ts', 'teams/mcp/proc.mjs teams/mcp/names.mjs', '🚀', '🚀 🔥', 'E-0ad41780', '[backlog priority 1]', 'Card 5', 'card 5:', '카드', '카드 5번', '번',
    '안', '못 다', '다', '한다', '안 한다', 'a.\nb', '\n\n', 'the. the. the', 'a: b: c', ': a', 'PRD:', 'Fix:', 'x'.repeat(500), `${'word '.repeat(80)}end`,
    'a '.repeat(200), '가'.repeat(200), '한다 '.repeat(30), 'in on at', 'and', '…', 'a …', 'Wait… x', '…a'];
const ODD_CALLS = [
  ...ODD.map((s) => [s, {}]),
  ...ODD.map((s) => ['', { requests: [s, s] }]),
  ...ODD.map((s) => ['x', { title: s }]),
  ...ODD.map((s) => [s, { requests: [{ request: s }, { text: s }, { title: s }, null, 7, {}] }]),
  ['a', { requests: ['a', 'b'] }], ['x', { requests: [{ request: 'an' }] }], ['', { requests: ['a', 'b'] }],
];

test('card 127 property: odd input never throws and never gives an empty name', () => {
  for (const [req, opts] of ODD_CALLS) {
    let n;
    assert.doesNotThrow(() => { n = epicName(req, opts); }, `${JSON.stringify(req)} ${JSON.stringify(opts)}`);
    assert.ok(typeof n === 'string' && n.trim().length > 0 && n.length <= 60, `${JSON.stringify(req)} -> ${n}`);
    for (const item of n.replace(/ \+\d+$/, '').split(' · ')) assert.ok(!item.slice(0, -1).includes('…'), `${JSON.stringify(req)} -> ${n}`);
    assert.ok(/\p{L}/u.test(n), `${JSON.stringify(req)} -> ${n}`);
  }
  for (const s of ['a', 'the', 'an', 'its']) assert.equal(epicName(s), 'untitled work', s);
  assert.equal(epicName('', { requests: ['a', 'b'] }), 'untitled work');
  assert.equal(epicName('x', { requests: [{ request: 'an' }] }), 'untitled work');
  assert.equal(taskName({ request: 'the' }), 'untitled work');
});

test('card 127 taskName: stored name, empty name, request only, requests only', () => {
  assert.equal(taskName({ name: 'stored name', request: CARD125 }), 'stored name');
  assert.equal(taskName({ name: '', request: CARD125 }), 'mod 상태를 소켓 하나로 합친다');
  assert.equal(taskName({ request: CARD125 }), 'mod 상태를 소켓 하나로 합친다');
  assert.equal(taskName({ request: '', requests: R130 }), 'model per stage · lean short sessions +1');
});

// Live-phrasing regressions (fictional text, same shape as the real requests that read badly).
const LIVE = [
  // first line is only a prefix and a parenthetical: the next line, its `N:` label stripped
  ['Backlog cards 11 and 12 (billing mod, `billing/hooks/`).\n11: billing\'s Refund tab says what failed and groups repeats. Rows (2026-01-01) carry no target.',
    'billing\'s Refund tab says what failed and groups repeats'],
  // an E-key removed after `of` leaves no dangling `of`; the carryover scaffolding is stripped
  ['Carryover D2 of E-1a2b3c4d on the integrated `gcp` plugin (this worktree, branch gcp-int, holds P1–P5). 1) `gcp/mcp/exec.mjs`: ENOENT returns a message',
    'the integrated gcp plugin'],
  ['Fix the cache of E-1a2b3c4d on the worker', 'Fix the cache on the worker'],
  // `items N-M ..., on top of P1` is scaffolding; the next line carries the content
  ['Card 20 items 5-7 (ended jobs resume), on top of P1 (`aaaa1111`):\n- tm_retry on an ended blocked job starts its daemon;',
    'tm_retry on an ended blocked job starts its daemon'],
  ['Card 20 items 3 and repeated rejections, on top of P1 (`aaaa1111`):\n- no package or gate accepts with a score below threshold;',
    'no package or gate accepts with a score below threshold'],
  ['Card 20 items 1 and 2 on top of P1 (`aaaa1111`, `recordKind` already on main; read `x/y/test.mjs`). Use the recorded failure kind to pick the path:\n- a thing',
    'Use the recorded failure kind to pick the path'],
  ['Card 20 items 3 and repeated rejections, on top of P1:\n- no package or gate accepts with match_pct below goal_threshold;',
    'no package or gate accepts with match_pct below…'],
  // leftover plus a package label
  ['Backlog card 30 leftover, QA-F1 D1 (high): a tm_open per-stage `models` override is dropped on the broker adapter path.',
    'a tm_open per-stage models override is dropped…'],
  // a comma cut of 3 words is used ('Move a finished' is 3 words), so the name is the head before the comma
  ['Move a finished, tested read-only cache server and its skill into the core plugin. The code is done.',
    'Move a finished…'],
  // a leading `in <file>` after the card prefix gives way to the real clause
  ['Backlog card 31 in _repo/docs/notes.md (heading "Misc"): `.claude/hooks/guard.mjs` runs whatever path it is reached by, so its checks cannot switch off silently.\n\nCause: x',
    'runs whatever path it is reached…'],
  // a cut ends before the first relative boundary or a participle phrase, never mid-clause
  ['Fix the flaky retry test in teams/scripts/test-x.mjs that times out on slow CI machines',
    'Fix the flaky retry test…'],
  ['Card 9: `.claude/hooks/repo-rules.mjs` denies a repo write reached through a symlinked path, even when its parent is new.',
    'denies a repo write reached through a symlinked path…'],
  ['Card 12: tm_clean on a running task waits or says how, instead of failing the call.', 'tm_clean on a running task waits or says how…'],
  ['Backlog card 40 in _repo/docs/notes.md: make the pre-push hook print which task holds the repo and how to release it',
    'make the pre-push hook print…'],
  // Korean: a verb after an adverbial particle stays; a label clause yields to the clause after it
  ['카드 7번: 설정 창을 좁은 폭에 맞춘다', '설정 창을 좁은 폭에 맞춘다'],
  ['사용자가 부탁한 것: 보드 색을 밝은 톤에 맞춘다', '보드 색을 밝은 톤에 맞춘다'],
  ['카드 7번: 설정 창을 바꾼다', '설정 창을 바꾼다'],
];

test('card 127 property: live-shaped requests read as a short sentence', () => {
  for (const [request, want] of LIVE) {
    assert.deepStrictEqual(epicName(request), want, request);
    assertCleanItems(want, request);
  }
});

// The 13 inputs of the gate-3 name sheet, each with the name it gives now (every one whole tokens: C1 verbatim or a head ending in …).
const GATE3 = [
  ['Backlog card 160: the trophy pane loses its scroll position when a new unlock arrives, so the list jumps to the top.', {},
    'the trophy pane loses its scroll position…'],
  ['[backlog priority 1] Card 161: knowledge eval writes a per-question CSV next to the summary so regressions can be traced', {},
    'knowledge eval writes a per-question CSV next…'],
  ['카드 162번: 세션 메모 창에서 긴 메모가 잘려서 끝까지 읽을 수 없다', {}, '세션 메모 창에서 긴 메모가 잘려서 끝까지 읽을 수 없다'],
  ['백로그 카드 163: 하네스 리포트에 실패한 게이트 이름과 점수를 같이 보여준다. 기존 포맷은 유지한다.', {},
    '하네스 리포트에 실패한 게이트 이름과 점수를 같이 보여준다'],
  ['Make tm_board sort EPICs by last activity instead of creation time', {}, 'Make tm_board sort EPICs by last activity…'],
  ['Investigate why the daemon leaks file handles after a cancelled driver exits', {}, 'Investigate why the daemon leaks file handles…'],
  ['[backlog priority 0] Card 164: a', { requests: ['Card 164: deck-builder renders Korean fonts without tofu on Linux', 'Card 165: resume-builder keeps page breaks stable',
    'Card 166 (portfolio): office_render retries a stuck LibreOffice once'] }, 'deck-builder renders Korean fonts without tofu on Linux +2'],
  ['README와 KOR.md의 설치 섹션을 최신 마켓플레이스 명령으로 고친다', {}, 'README와 KOR.md의 설치 섹션을 최신 마켓플레이스 명령으로 고친다'],
  ['When a STORY is rejected three times in a row, the engine should stop retrying and ask a human which way to go', {},
    'When a STORY is rejected three times in a row…'],
  ['Card 167 part 2 (PRD F4): `teams/scripts/view.mjs --once --format json` emits name and worktree for each EPIC', {},
    '--once --format json emits name and worktree for each EPIC'],
  ['EPIC 이름을 사람이 의미를 알 수 있는 자연어로 바꾼다', {}, 'EPIC 이름을 사람이 의미를 알 수 있는 자연어로 바꾼다'],
  ['EPIC 이름 이렇게 못알아보게 하지 말고 EPIC + 자연어 설명으로', {}, 'EPIC 이름 이렇게 못알아보게 하지 말고 EPIC + 자연어 설명으로'],
  ['좁은 창에서 EPIC 이름을 읽을 수 없다', {}, '좁은 창에서 EPIC 이름을 읽을 수 없다'],
];

test('card 127 GATE3: the 13 gate-3 inputs give their pinned whole-token names', () => {
  assert.equal(GATE3.length, 13);
  for (const [request, opts, want] of GATE3) {
    assert.deepStrictEqual(epicName(request, opts), want, request);
    assertCleanItems(want, request);
  }
});

// A source '…' is never kept or turned into a space: a token with an interior '…' goes whole, and so does one that ends in '…'.
// A removal with words before it is a cut: those words + '…' (a head of under 2 content words is still head + '…').
// A removal first in the clause has nothing to qualify and drops silently.
const ELL = [
  ['Resume breaks the load…save path', 'Resume breaks…'],
  ['The load…save path breaks on resume', 'path breaks on resume'],
  ['A load…save bug breaks resume', 'bug breaks resume'],
  ['In the load…save path, resume breaks', 'path, resume breaks'],
  ['로딩…저장 경로가 깨진다', '경로가 깨진다'],
  ['Fix the flaky daemon… restart loop after a cancel', 'Fix the flaky…'],
  ['Fix the daemon… restart loop after a cancel', 'Fix…'],
  ['저장… 경로가 깨진다', '경로가 깨진다'],
  ['Fix the flaky daemon restart loop …', 'Fix the flaky daemon restart loop…'],
];

test('card 127 whole tokens: a token holding … goes whole, interior or trailing', () => {
  for (const [request, want] of ELL) {
    assert.deepStrictEqual(epicName(request), want, request);
    assert.ok(!epicName(request).slice(0, -1).includes('…'), request);
    assertCleanItems(epicName(request), request);
  }
});

test('card 127 negatives: no pinned name reads cut, ends on 티캣, or keeps a dropped phrase', () => {
  const pinned = [...GOLDEN.map(([, , want]) => want), ...REAL.map(([, want]) => want), ...MID.map(([, want]) => want),
    ...LIVE.map(([, want]) => want), ...GATE3.map(([, , want]) => want), ...ELL.map(([, want]) => want)];
  assert.ok(pinned.length >= 60);
  for (const n of pinned) {
    assert.ok(!/(^| )읽( |$)/.test(n), n);
    assert.ok(!/티캣$/.test(n), n);
    assert.ok(!/점수 같이$/.test(n), n);
    assert.ok(!/ in row$/.test(n), n);
    assert.ok(!n.split(/\s+/).some((t) => /^[\w.~@/-]*\/[\w.~@/-]*$/.test(t)), `${n}: a path-only token survived`);
  }
});

// AC-2, independent of names.mjs: source tokens are a plain whitespace split of the raw input (title, requests, request;
// every line, since a name may come from a later line) with edge punctuation trimmed; nothing else.
const EDGE = /^[`"'“”‘’()[\]{}<>:,.;!?]+|[`"'“”‘’()[\]{}<>:,.;!?]+$/g;
const trimEdge = (t) => t.replace(EDGE, '');
function sourceTokens(request, opts = {}) {
  const raws = [opts.title, request, ...(Array.isArray(opts.requests) ? opts.requests : [])]
    .map((r) => (r && typeof r === 'object' ? [r.request, r.text, r.title] : [r])).flat();
  return new Set(raws.filter((r) => typeof r === 'string').flatMap((r) => r.normalize('NFC').split(/\s+/)).map(trimEdge).filter(Boolean));
}
// Output tokens that are neither a source token nor a `…`-ending head of one.
function violations(request, opts, name) {
  const src = [...sourceTokens(request, opts)];
  if (name === 'untitled work') return [];
  return name.replace(/ \+\d+$/, '').split(' · ').flatMap((item) => item.split(/\s+/)).map(trimEdge).filter(Boolean)
    .filter((tok) => (tok.endsWith('…') ? !src.some((s) => s.startsWith(tok.slice(0, -1))) : !src.includes(tok)));
}

const PRE_REPAIR = [
  ['카드 162번: 세션 메모 창에서 긴 메모가 잘려서 끝까지 읽을 수 없다', '세션 메모 창에서 긴 메모가 잘려서 끝까지 읽 수'],
  ['EPIC 이름을 사람이 의미를 알 수 있는 자연어로 바꾼다', 'EPIC 이름 사람이 의미 알 수 있는 자연어로'],
  [USER_SENTENCE, 'backlog harness의 티캣'],
];

test('card 127 whole tokens: the checker is red on the three pre-repair names', () => {
  for (const [request, old] of PRE_REPAIR) assert.ok(violations(request, {}, old).length > 0, old);
  assert.deepStrictEqual(violations(PRE_REPAIR[0][0], {}, PRE_REPAIR[0][1]), ['읽']);
  assert.deepStrictEqual(violations(PRE_REPAIR[2][0], {}, PRE_REPAIR[2][1]), ['티캣']);
  // and green on a name that is whole tokens, or a head ending in …
  assert.deepStrictEqual(violations(PRE_REPAIR[0][0], {}, '세션 메모 창에서 긴 메모가…'), []);
});

test('card 127 whole tokens: no output token is a strict prefix of an input token unless followed by …', () => {
  const inputs = [
    ...GOLDEN.map(([, [request, opts]]) => [request, opts]),
    ...REAL.map(([request]) => [request, {}]),
    ...MID.map(([request]) => [request, {}]),
    ...LIVE.map(([request]) => [request, {}]),
    ...GATE3.map(([request, opts]) => [request, opts]),
    ...ELL.map(([request]) => [request, {}]),
    [LONG_KO, {}],
    ...ODD_CALLS,
  ];
  assert.ok(inputs.length > 200);
  for (const [request, opts] of inputs) {
    assert.deepStrictEqual(violations(request, opts, epicName(request, opts)), [],
      `${JSON.stringify(request).slice(0, 80)} -> ${epicName(request, opts)}`);
    assertNoAdjacentGlue(epicName(request, opts), JSON.stringify(request).slice(0, 80));
  }
});
