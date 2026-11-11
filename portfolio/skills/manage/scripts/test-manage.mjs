import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { addQuestion, readQuestions, roundCheck, freezeStable, enginePathWarnings, safeArea, bump, claims, compare, confirmedFacts, deckPages, headings, intake, resumePages, keepRender, layout, parseMap, readMaterial, readRounds, renumber, round, scaffold, selection, settle, settled, settledNote, snapshot, step, sync, verify, verifyBuild } from './manage.mjs'
import { deflateRawSync } from 'node:zlib'

const SKEL = `# 가상 포트폴리오
version: v4.0.0

## 1 표지
## 2 핵심 역량
근거: 3쪽, 4·5쪽
## 3 검색 개편 — 왜
3~4쪽에서 이어진다.
## 4 검색 개편 — 결과
## 5 배치 알림

| 번호 | 대상 | 쪽 |
|---|---|---|
| 1 | 결과 표 | 4 |
| 2 | 알림 그림 | 5 |
`

test('bump levels', () => {
  assert.deepEqual(bump([4, 0, 0], 'major'), [5, 0, 0])
  assert.deepEqual(bump([4, 1, 2], 'minor'), [4, 2, 0])
  assert.deepEqual(bump([4, 1, 2], 'patch'), [4, 1, 3])
  assert.throws(() => bump([1, 0, 0], 'huge'))
})

test('parseMap refuses duplicates', () => {
  assert.throws(() => parseMap('3:4,3:5'))
  assert.throws(() => parseMap('3:4,5:4'))
  assert.equal(parseMap('3:4,4:3').get(4), 3)
})

test('swap renumbers headings, refs and the 쪽 column once and moves the pages (double-replace regression)', () => {
  const r = renumber(SKEL, parseMap('3:4,4:3'))
  assert.match(r.text, /## 3 검색 개편 — 결과\n## 4 검색 개편 — 왜\n3~4쪽에서 이어진다\.\n## 5 배치 알림/)
  assert.match(r.text, /근거: 4쪽, 3·5쪽/)
  assert.deepEqual(r.warnings, [])
  assert.match(r.text, /\| 1 \| 결과 표 \| 3 \|/)
  assert.match(r.text, /\| 2 \| 알림 그림 \| 5 \|/)
  assert.deepEqual(verify(r.text).problems, [])
  // the same swap again returns the original: nothing was replaced twice in one pass
  assert.equal(renumber(r.text, parseMap('3:4,4:3')).text, SKEL)
})

test('a range keeps its span when its pages only swap inside it, and warns when it breaks', () => {
  assert.equal(renumber('## 4 a\n## 5 b\n## 6 c\n4~6쪽 요약.', parseMap('4:5,5:4')).text.split('\n').pop(), '4~6쪽 요약.')
  const r = renumber('## 1 a\n1~2쪽\n## 2 b\n## 3 c\n## 4 d', parseMap('2:4,4:2'))
  assert.equal(r.text, '## 1 a\n1~2쪽\n## 2 d\n## 3 c\n## 4 b')
  assert.deepEqual(r.warnings, ['range 1~2쪽 is no longer contiguous: 1·4쪽'])
})

test('version change lines and non-page sections stay where they are', () => {
  const text = 'version: v2.0.0\nv2.0.0 변경(2026-01-02, 본인 결정): 두 장 교환 (4↔5쪽)\n\n## 4 결과\n이유는 5쪽.\n## 5 왜\n\n## 맞춰야 할 것\n| 번호 | 쪽 |\n|---|---|\n| 1 | 4 |\n'
  const r = renumber(text, parseMap('4:5,5:4'))
  assert.equal(r.text, 'version: v2.0.0\nv2.0.0 변경(2026-01-02, 본인 결정): 두 장 교환 (4↔5쪽)\n\n## 4 왜\n## 5 결과\n이유는 4쪽.\n\n## 맞춰야 할 것\n| 번호 | 쪽 |\n|---|---|\n| 1 | 5 |\n')
})

test('verify flags order and dangling references', () => {
  assert.deepEqual(verify(SKEL).problems, [])
  assert.ok(verify('## 2 a\n## 1 b').problems.includes('heading 1 after 2'))
  assert.ok(verify(SKEL.replace('3쪽, ', '9쪽, ')).problems.includes('9쪽 points at no heading'))
})

test('snapshot copies the current skeleton, bumps and logs once', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-'))
  writeFileSync(join(root, 'portfolio-skeleton.md'), SKEL)
  const r = snapshot(root, { kind: 'skeleton', level: 'minor', note: '검색 블록 두 장 순서 교환', date: '2026-01-02' })
  assert.equal(r.from, 'v4.0.0')
  assert.equal(r.to, 'v4.1.0')
  assert.equal(readFileSync(join(root, 'snapshot/skeleton/skeleton-v4.0.0/portfolio-skeleton.md'), 'utf8'), SKEL)
  const now = readFileSync(join(root, 'portfolio-skeleton.md'), 'utf8')
  // no --by: the line names no decider (it never claims the user decided)
  assert.match(now, /version: v4\.1\.0\nv4\.1\.0 변경\(2026-01-02\): 검색 블록 두 장 순서 교환\n\n## 1 표지/)
  assert.match(readFileSync(join(root, 'snapshot/README.md'), 'utf8'), /\| v4\.0\.0 \| 2026-01-02 \| 5 \| → v4\.1\.0: 검색 블록/)
  // the next snapshot is of v4.1.0; the same version cannot be taken twice
  writeFileSync(join(root, 'portfolio-skeleton.md'), SKEL)
  assert.throws(() => snapshot(root, { kind: 'skeleton', level: 'patch', note: 'x' }), /already taken/)
})

test('the first deck snapshot is deck-v1.0.0 and leaves skeleton alone', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-'))
  writeFileSync(join(root, 'portfolio-skeleton.md'), SKEL)
  writeFileSync(join(root, 'portfolio-deck.mdx'), '---\noutput: build/deck.pptx\n---\n')
  const r = snapshot(root, { kind: 'deck', level: 'patch', note: 'x' })
  assert.equal(r.to, 'v1.0.0')
  assert.ok(existsSync(join(root, 'snapshot/deck/deck-v1.0.0/portfolio-deck.mdx')))
  assert.equal(readFileSync(join(root, 'portfolio-skeleton.md'), 'utf8'), SKEL)
})

// The shape of a real workspace (fictional content): `## N쪽 ·` headings, a `## 구성` section before
// the pages, `# 블록 (N~M쪽)` chapters, quoted history lines, a page count in the head.
const REAL = `# 가상 포트폴리오 · 6장
version: v2.0.0
> v1.2.0(2026-01-01, 본인 지시): 3쪽 재작성, 5쪽 추가

## 구성 — 왜 이렇게 바뀌었나
블록 순서: 도입(1쪽) → 검색(2~3쪽) → 알림(4~5쪽).

# 도입 (1쪽)
## 1쪽 · 표지

# 검색 개편 (2~3쪽)
## 2쪽 · \`@s2\` · 문제
## 3쪽 · \`@s3\` · 해결 — 근거 2쪽

# 알림 배치 (4~5쪽)
## 4쪽 · \`@s4\` · 문제
## 5쪽 · \`@s5\` · 결과

# 부록 (6쪽)
## 6쪽 · 첨부

## 맞춰야 할 것
- 3쪽 그림
`

test('a `## N쪽 ·` heading is a page heading', () => {
  const v = verify(REAL)
  assert.deepEqual(v.headings, [1, 2, 3, 4, 5, 6])
  assert.deepEqual(v.problems, [])
})

test('quoted history lines are neither renumbered nor verified', () => {
  const r = renumber(REAL, parseMap('3:2,2:3'))
  assert.match(r.text, /> v1\.2\.0\(2026-01-01, 본인 지시\): 3쪽 재작성, 5쪽 추가/)
  assert.deepEqual(verify('## 1쪽 a\n> v1.0.0(2026-01-01, 본인 지시): 9쪽 삭제').problems, [])
})

test('a section before the pages does not stop the sort: swapping two pages moves them', () => {
  const r = renumber(REAL, parseMap('2:3,3:2'))
  assert.match(r.text, /# 검색 개편 \(2~3쪽\)\n## 2쪽 · `@s3` · 해결 — 근거 3쪽\n## 3쪽 · `@s2` · 문제\n/)
  assert.match(r.text, /^## 구성 — 왜 이렇게 바뀌었나$/m)
  assert.ok(r.text.indexOf('## 구성') < r.text.indexOf('# 도입'))
  assert.deepEqual(verify(r.text).problems, [])
})

test('a block swap moves each `#` block with its pages, its title renumbered (regression: block order swap)', () => {
  const r = renumber(REAL, parseMap('2:4,3:5,4:2,5:3'))
  const order = [...r.text.matchAll(/^# (.+)$/gm)].map(m => m[1])
  assert.deepEqual(order, ['가상 포트폴리오 · 6장', '도입 (1쪽)', '알림 배치 (2~3쪽)', '검색 개편 (4~5쪽)', '부록 (6쪽)'])
  assert.match(r.text, /# 알림 배치 \(2~3쪽\)\n## 2쪽 · `@s4` · 문제\n## 3쪽 · `@s5` · 결과\n\n# 검색 개편/)
  assert.match(r.text, /블록 순서: 도입\(1쪽\) → 검색\(4~5쪽\) → 알림\(2~3쪽\)\./)
  assert.match(r.text, /## 맞춰야 할 것\n- 5쪽 그림\n$/)
  assert.deepEqual(verify(r.text).problems, [])
})

test('layout finds the template where portfolio-deck.mdx says', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-'))
  mkdirSync(join(root, 'template'))
  writeFileSync(join(root, 'template/template.pptx'), '')
  writeFileSync(join(root, 'portfolio-deck.mdx'), '---\ntemplate: template/template.pptx\noutput: build/deck.pptx\n---\n')
  const l = layout(root)
  assert.ok(l.present.includes('template/template.pptx'))
  assert.ok(!l.missing.includes('template.pptx'))
})

test('layout finds a Korean file name stored decomposed (NFD, as macOS zips write it)', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-'))
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs', '확정사실.md'.normalize('NFD')), '')
  assert.ok(layout(root).present.includes('docs/확정사실.md'))
})

test('snapshot writes its row into the `## skeleton` table by column name, with the stated page count', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-'))
  writeFileSync(join(root, 'skeleton.md'), REAL)
  mkdirSync(join(root, 'snapshot'))
  const readme = '# 스냅샷\n\n## deck\n| 버전 | 날짜 | 한 줄 |\n|---|---|---|\n| `deck-v1.0.0` | 2026-01-01 | 첫 덱 |\n\n## skeleton\n| 버전 | 날짜 | 장수 | 한 줄 |\n|---|---|---|---|\n| `skeleton-v1.0.0` | 2026-01-01 | 5 | 첫 판 |\n\n## 되돌리는 방법\n복사해서 덮는다.\n'
  writeFileSync(join(root, 'snapshot/README.md'), readme)
  snapshot(root, { kind: 'skeleton', level: 'patch', note: '첨부 제목 추가', date: '2026-01-03' })
  const out = readFileSync(join(root, 'snapshot/README.md'), 'utf8')
  assert.match(out, /\| `skeleton-v1\.0\.0` \| 2026-01-01 \| 5 \| 첫 판 \|\n\| `skeleton-v2\.0\.0` \| 2026-01-03 \| 6 \| → v2\.0\.1: 첨부 제목 추가 \|\n\n## 되돌리는 방법/)
  assert.match(out, /\| `deck-v1\.0\.0` \| 2026-01-01 \| 첫 덱 \|\n\n## skeleton/)
})

test('snapshot follows the workspace: quoted history line, newest-first table', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-'))
  writeFileSync(join(root, 'skeleton.md'), REAL)
  mkdirSync(join(root, 'snapshot'))
  writeFileSync(join(root, 'snapshot/README.md'), '## skeleton\n| 버전 | 날짜 | 장수 | 한 줄 |\n|---|---|---|---|\n| `skeleton-v1.1.0` | 2026-01-02 | 6 | 둘째 |\n| `skeleton-v1.0.0` | 2026-01-01 | 5 | 첫 판 |\n')
  snapshot(root, { kind: 'skeleton', level: 'patch', note: '검증', by: '본인', date: '2026-01-03' })
  assert.match(readFileSync(join(root, 'skeleton.md'), 'utf8'), /^version: v2\.0\.1\n> v2\.0\.1\(2026-01-03, 본인 결정\): 검증\n> v1\.2\.0/m)
  assert.match(readFileSync(join(root, 'snapshot/README.md'), 'utf8'), /\|---\|---\|---\|---\|\n\| `skeleton-v2\.0\.0` \| 2026-01-03 \| 6 \| → v2\.0\.1: 검증 \|\n\| `skeleton-v1\.1\.0`/)
})

test('snapshot needs a version line and a note', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-'))
  mkdirSync(join(root, 'snapshot'))
  writeFileSync(join(root, 'skeleton.md'), '# no version\n')
  assert.throws(() => snapshot(root, { kind: 'skeleton', level: 'patch', note: 'x' }), /version/)
  assert.throws(() => snapshot(root, { kind: 'skeleton', level: 'patch' }), /note/)
})

// fixtures/workspace has the shape of the user's real workspace with fictional content: `## N쪽 ·`
// headings, `#` blocks, an appendix table, quoted history lines, the README's own tables, `template/`,
// a `sources/NN_프로젝트/A1….md` ledger. A mismatch found in a real run is added here first (card 68).
const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'workspace')
const copies = []
after(() => { for (const d of copies) rmSync(d, { recursive: true, force: true }) })
const workspace = () => { const root = mkdtempSync(join(tmpdir(), 'manage-ws-')); copies.push(root); cpSync(WORKSPACE, root, { recursive: true }); return root }

test('real-shape workspace: layout finds every part, verify finds no problem', () => {
  assert.deepEqual(layout(WORKSPACE).missing, [])
  assert.deepEqual(verify(readFileSync(join(WORKSPACE, 'portfolio-skeleton.md'), 'utf8')).problems, [])
})

test('real-shape workspace: a block swap keeps the appendix table, align table and history right', () => {
  const r = renumber(readFileSync(join(WORKSPACE, 'portfolio-skeleton.md'), 'utf8'), parseMap('2:4,3:5,4:2,5:3'))
  assert.deepEqual(r.warnings, [])
  assert.deepEqual(verify(r.text).problems, [])
  assert.match(r.text, /# 알림 배치 \(2~3쪽\)\n## 2쪽 · `@s4` · 문제\n## 3쪽 · `@s5` · 결과 \[v3\.1\.0 안\]\n2~3쪽 요약은 6쪽 회고로\.\n\n# 검색 개편 \(4~5쪽\)/)
  assert.match(r.text, /\| A1 \| 검색 쿼리 세부 \| 7 \| 5쪽 \|\n\| A2 \| 응답 시간 그래프 \| 8 \| 4쪽 \|\n\| A3 \| 알림 흐름도 \| 9 \| 3쪽 \|/)
  assert.match(r.text, /\| 1 \| 결과 표 \| 수치 출처 \| 본인 확인 대기 \| 5 \|/)
  assert.match(r.text, /^> v3\.1\.0\(2026-01-05, 본인 지시\): 5쪽 결과 표 교체, 8쪽 부록 추가$/m)
  assert.match(r.text, /^> v3\.0\.0\(2026-01-02, 본인 결정\): 알림 블록을 검색 뒤로 \(4~5쪽\)$/m)
})

test('real-shape workspace: snapshot follows its history form and newest-first table', () => {
  const root = workspace()
  const r = snapshot(root, { kind: 'skeleton', level: 'patch', note: '부록 제목 정리', date: '2026-01-06' })
  assert.equal(r.to, 'v3.1.1')
  assert.match(readFileSync(join(root, 'portfolio-skeleton.md'), 'utf8'), /^version: v3\.1\.1\n> v3\.1\.1\(2026-01-06\): 부록 제목 정리\n> v3\.1\.0/m)
  assert.match(readFileSync(join(root, 'snapshot/README.md'), 'utf8'), /\|---\|---\|---\|---\|\n\| `skeleton-v3\.1\.0` \| 2026-01-06 \| 9 \| → v3\.1\.1: 부록 제목 정리 \|\n\| `skeleton-v3\.0\.0`/)
})

test('compare names each item that dropped and the verdict (card 70)', () => {
  const before = { 'Technical Depth': 6, 'Impact and Results': 5, 'Portfolio Narrative': 7 }
  const r = compare(before, { 'Technical Depth': 7, 'Impact and Results': 5, 'Portfolio Narrative': 6 })
  assert.equal(r.verdict, 'mixed')
  assert.deepEqual(r.dropped, ['Portfolio Narrative'])
  assert.deepEqual(r.items.find(i => i.item === 'Technical Depth'), { item: 'Technical Depth', before: 6, after: 7, delta: 1 })
  assert.equal(compare(before, { ...before, 'Impact and Results': 6 }).verdict, 'better')
  assert.equal(compare(before, { ...before, 'Impact and Results': 4 }).verdict, 'worse')
  assert.equal(compare(before, before).verdict, 'same')
})

test('compare lists items scored on one side only instead of comparing them', () => {
  const r = compare({ a: 5, b: 6 }, { a: 5, c: 7 })
  assert.deepEqual(r.unmatched, ['b', 'c'])
  assert.equal(r.verdict, 'same')
})

test('real-shape workspace: a deck snapshot counts deck versions, carries assets and a NOTES.md, rows into `## deck`', () => {
  const root = workspace()
  const r = snapshot(root, { kind: 'deck', level: 'minor', note: '렌더 지침 적용', date: '2026-01-07' })
  assert.deepEqual([r.from, r.to, r.skeleton], ['v1.0.0', 'v1.1.0', 'v3.1.0'])
  assert.ok(existsSync(join(root, 'snapshot/deck/deck-v1.1.0/assets/s2.svg')))
  assert.equal(readFileSync(join(root, 'snapshot/deck/deck-v1.1.0/NOTES.md'), 'utf8'), '# deck-v1.1.0\n\n2026-01-07. skeleton v3.1.0 반영. 렌더 지침 적용\n')
  assert.match(readFileSync(join(root, 'snapshot/README.md'), 'utf8'), /\| `deck-v1\.0\.0` \| 2026-01-01 \| 첫 덱 \|\n\| `deck-v1\.1\.0` \| 2026-01-07 \| 렌더 지침 적용 \|\n\n## skeleton/)
  assert.match(readFileSync(join(root, 'portfolio-skeleton.md'), 'utf8'), /^version: v3\.1\.0$/m)
})

test('a `·` pair stays ascending after a swap, and a moved heading with `(n/N)` is listed for a hand fix', () => {
  const r = renumber('## 7 a (1/2)\n## 8 b (2/2)\n7·8쪽', parseMap('7:8,8:7'))
  assert.equal(r.text, '## 7 b (2/2)\n7·8쪽\n## 8 a (1/2)')
  assert.deepEqual(r.warnings, ['7쪽 → 8쪽 heading keeps "(1/2)": check it by hand', '8쪽 → 7쪽 heading keeps "(2/2)": check it by hand'])
})

// card 103: each reproduced against the engine before the fix
test('a `N쪽` in a `쪽` column cell is swapped once (double-replace regression)', () => {
  const r = renumber('## 3 a\n## 4 b\n\n| 번호 | 쪽 |\n|---|---|\n| 1 | 3쪽 |\n| 2 | 4쪽 · 7쪽 |\n', parseMap('3:4,4:3'))
  assert.match(r.text, /\| 1 \| 4쪽 \|\n\| 2 \| 3쪽 · 7쪽 \|/)
})

test('fenced code is neither a heading, a block nor a reference', () => {
  const text = '# Part A\n## 1. Intro\n```bash\n# comment\n## 2 not heading\n3쪽\n```\n## 2. Second'
  const r = renumber(text, parseMap('1:2,2:1'))
  assert.equal(r.text, '# Part A\n## 1. Second\n## 2. Intro\n```bash\n# comment\n## 2 not heading\n3쪽\n```')
  assert.deepEqual(verify(r.text).problems, [])
  assert.deepEqual(headings(text), [1, 2])
})

test('a map whose target is a page left in place is refused', () => {
  assert.throws(() => renumber('## 3 a\n## 4 b', parseMap('3:4')), /page 4 stays/)
  assert.doesNotThrow(() => renumber('## 3 a\n## 5 b', parseMap('3:4')))
})

test('renumber writes the file only when the result verifies (--force writes anyway)', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-write-'))
  const before = '## 1 a\n2쪽에서 이어진다.\n## 2 b\n'
  writeFileSync(join(root, 'skeleton.md'), before)
  const cli = (...a) => JSON.parse(spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'manage.mjs'), ...a], { cwd: root, encoding: 'utf8' }).stdout)
  // a dangling reference makes the result fail verify: the file stays as it was
  writeFileSync(join(root, 'skeleton.md'), '## 1 a\n9쪽 참고.\n## 2 b\n')
  const r = cli('renumber', '--map', '1:2,2:1')
  assert.equal(r.written, false)
  assert.deepEqual(r.problems, ['9쪽 points at no heading'])
  assert.equal(readFileSync(join(root, 'skeleton.md'), 'utf8'), '## 1 a\n9쪽 참고.\n## 2 b\n')
  assert.equal(cli('renumber', '--map', '1:2,2:1', '--force').written, true)
  writeFileSync(join(root, 'skeleton.md'), before)
  assert.equal(cli('renumber', '--map', '1:2,2:1').written, true)
})

// card 54: the eight-step flow's new parts
test('scaffold creates the selection table, template analysis and render/feedback folders, never overwriting', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-scaffold-'))
  writeFileSync(join(root, 'deck.catalog.md'), '# Catalog\n\n## Voice\n\n- 했다 60%\n\n## Palette\n\n- 10243F\n\n## Type\n\n- 본문 18pt\n\n## @s1 · 표지\n')
  const r = scaffold(root)
  assert.deepEqual(r.created, ['CLAUDE.md', 'sources/선정.md', 'template/analysis.md', 'template/next-render.md', 'snapshot/render', 'feedback',
    'style/문체.md', 'style/표기규칙.md', 'style/레이아웃.md', 'style/이력서-서식.md', 'docs/확인할-것.md'])
  assert.match(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), /manage\.mjs scaffold[\s\S]*portfolio-skeleton\.md[\s\S]*resume-deck\.mdx[\s\S]*template\/next-render\.md/)
  assert.match(readFileSync(join(root, 'template/next-render.md'), 'utf8'), /\| 쪽 \| 칸 \| 증상 \| 확인 \| 적용 \|/)
  const analysis = readFileSync(join(root, 'template/analysis.md'), 'utf8')
  assert.match(analysis, /## Palette\n\n- 10243F\n\n## Type\n\n- 본문 18pt\n\n## Voice\n\n- 했다 60%\n\n## 스타일 규칙/)
  assert.ok(!analysis.includes('@s1'))
  writeFileSync(join(root, 'sources/선정.md'), '내 표')
  assert.deepEqual(scaffold(root).created, [])
  assert.equal(readFileSync(join(root, 'sources/선정.md'), 'utf8'), '내 표')
})

test('files under their old names (NFC or NFD) are read, reported by layout and renamed by scaffold, content kept', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-legacy-'))
  mkdirSync(join(root, 'template'))
  writeFileSync(join(root, 'README.md'), '# 작업 안내\n')
  writeFileSync(join(root, 'skeleton.md'), SKEL)
  writeFileSync(join(root, 'deck.mdx'), '---\ntemplate: template/t.pptx\n---\n')
  writeFileSync(join(root, 'template', 't.pptx'), '')
  writeFileSync(join(root, 'template', '분석.md'.normalize('NFD')), '# 내 분석\n')
  writeFileSync(join(root, 'template', '다음렌더-지침.md'), '# 내 지침\n')
  const before = layout(root)
  assert.deepEqual(before.legacy, [
    { from: 'skeleton.md', to: 'portfolio-skeleton.md' },
    { from: 'deck.mdx', to: 'portfolio-deck.mdx' },
    { from: 'README.md', to: 'CLAUDE.md' },
    { from: 'template/분석.md', to: 'template/analysis.md' },
    { from: 'template/다음렌더-지침.md', to: 'template/next-render.md' }])
  for (const p of ['CLAUDE.md', 'portfolio-skeleton.md', 'portfolio-deck.mdx', 'template/analysis.md', 'template/next-render.md', 'template/t.pptx']) {
    assert.ok(before.present.includes(p), `${p} present under its old name`)
  }
  assert.ok(existsSync(join(root, 'template', '분석.md'.normalize('NFD'))), 'layout touches nothing')
  // commands read the old name until it is renamed
  assert.equal(snapshot(root, { kind: 'deck', level: 'patch', note: 'x' }).to, 'v1.0.0')
  assert.ok(existsSync(join(root, 'snapshot/deck/deck-v1.0.0/deck.mdx')))
  const r = scaffold(root)
  assert.equal(r.renamed.length, 5)
  assert.ok(!r.created.includes('CLAUDE.md'), 'the README became CLAUDE.md; no guide is written over it')
  assert.ok(!r.created.some(p => p.startsWith('template/')), 'renamed, not created empty')
  assert.equal(readFileSync(join(root, 'template/analysis.md'), 'utf8'), '# 내 분석\n')
  assert.equal(readFileSync(join(root, 'template/next-render.md'), 'utf8'), '# 내 지침\n')
  assert.equal(readFileSync(join(root, 'portfolio-skeleton.md'), 'utf8'), SKEL)
  const guide = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
  assert.ok(guide.startsWith('# 작업 안내\n\n# 포트폴리오 작업 공간'), 'the README text stays first, the guide appended below it')
  assert.deepEqual(r.appended, ['CLAUDE.md'])
  assert.equal(scaffold(root).appended, undefined, 'appended once')
  assert.equal(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), guide)
  assert.ok(!existsSync(join(root, 'skeleton.md')) && !existsSync(join(root, 'deck.mdx')) && !existsSync(join(root, 'README.md')))
  assert.deepEqual(readdirSync(join(root, 'template')).sort(), ['analysis.md', 'next-render.md', 't.pptx'])
  assert.equal(layout(root).legacy, undefined)
  // both names present: the English one wins and the old one is left for the user to look at
  writeFileSync(join(root, 'template', '분석.md'), 'old')
  assert.equal(scaffold(root).renamed, undefined)
  assert.equal(readFileSync(join(root, 'template/analysis.md'), 'utf8'), '# 내 분석\n')
})

test('selection reads the table; claims refuses an excluded item and lists only chosen ones the other way', () => {
  const root = claimsWorkspace()
  writeFileSync(join(root, 'sources/선정.md'), '# 선정\n\n| 글감 | 쓰임 | 쪽 | 이유 | 대표 |\n|---|---|---|---|---|\n| retro--검색-지연 | 본문 | 2~3 | 강한 신호 | 응답 시간 |\n| retro--알림-배치 | 제외 | | 다른 일 | |\n| retro--미사용 | 보류 | | | |\n')
  const sel = selection(root)
  assert.deepEqual(sel.rows.map(r => r.use), ['본문', '제외', '보류'])
  assert.deepEqual(sel.problems, ['retro--미사용: 쓰임 "보류" is not 본문 | 부록 | 제외'])
  const r = claims(CLAIMS_SKEL, readMaterial(root), [], sel)
  assert.ok(r.problems.some(p => p.kind === 'excluded' && p.page === 4 && p.text === 'retro--알림-배치'))
  assert.deepEqual(r.uncited_items, [])
  assert.deepEqual(r.unselected, [])
  assert.equal(selection(mkdtempSync(join(tmpdir(), 'manage-nosel-'))), null)
})

test('keep-render copies the previews under the deck version with one review row per page', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-render-'))
  assert.throws(() => keepRender(root, 'v1.0.0'), /no previews/)
  mkdirSync(join(root, 'build/pages'), { recursive: true })
  for (const n of [1, 2, 10]) writeFileSync(join(root, `build/pages/p-${n}.png`), 'png')
  const r = keepRender(root, 'v1.2.0')
  assert.equal(r.kept, 3)
  assert.ok(existsSync(join(root, 'snapshot/render/deck-v1.2.0/pages/p-10.png')))
  assert.equal(readFileSync(r.review, 'utf8'), '# 렌더 검토 · deck-v1.2.0\n\n| 쪽 | 본 것 | 문제 | next-render |\n|---|---|---|---|\n| 1 | | | |\n| 2 | | | |\n| 3 | | | |\n')
  writeFileSync(r.review, '채운 검토')
  keepRender(root, 'v1.2.0')
  assert.equal(readFileSync(r.review, 'utf8'), '채운 검토')
  assert.throws(() => keepRender(root, '1.2'), /--version/)
})

// card 102: a fictional workspace with two material items, the skeleton citing them by `글감:`
function claimsWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'manage-claims-'))
  const item = (id, parts) => {
    mkdirSync(join(root, 'sources/material', id), { recursive: true })
    for (const [p, body] of Object.entries(parts)) writeFileSync(join(root, 'sources/material', id, `${p}.md`), body)
  }
  item('retro--검색-지연', {
    meta: '# 메타\n\ntitle: 검색 지연\nstatus: selected\n',
    problem: '# 문제\n\n- 목록 조회가 매번 전체 인덱스를 스캔해 응답이 느렸다. — "전체 스캔" (retro.md + "## 검색")\n',
    decision: '# 결정\n\n- 조회 결과를 캐시에 두기로 했다. 갱신 주기가 길어서다. — "갱신은 하루 한 번" (retro.md + "## 검색")\n',
    result: '# 결과\n\n| number | evidence source | label |\n|---|---|---|\n| 820ms → 210ms | retro.md + "## 측정" | |\n| 40% | 근거 없음 | |\n| 3배 | retro.md + "## 메모" | 본인 확인 |\n| 12만 건 | retro.md + "## 규모" | |\n',
  })
  item('retro--알림-배치', {
    meta: '# 메타\n\ntitle: 알림 배치\nstatus: selected\n',
    result: '# 결과\n\n| number | evidence source | label |\n|---|---|---|\n| 2주 | 체감상 (메시지 3) | user-stated |\n',
  })
  item('retro--미사용', { meta: '# 메타\n\ntitle: 미사용\n', result: '# 결과\n\n수치 없음 — 자료에 단위·퍼센트가 붙은 수치가 없다.\n' })
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs/확정사실.md'), '# 확정사실\n\n## 서술 기준\n- 진행 중인 장은 완료했을 때 기준으로 쓴다\n\n## 구조\n- 서로 다른 일은 한 블록에 섞지 않는다\n\n## 정정\n- 2026-01-03 본인: 다른 팀 결정\n')
  return root
}
const CLAIMS_SKEL = `# 가상 포트폴리오
version: v1.0.0

## 1 표지
가상 인물 · 백엔드 개발자
## 2 검색 — 문제
글감: retro--검색-지연
전체 스캔 때문에 목록 조회가 느렸다.
응답 시간 820ms → 210ms.
## 3 검색 — 결과
글감: retro--검색-지연
조회 비용이 40% 줄었다.
처리량은 3배가 됐다.
배포 위험을 줄이기 위해 카나리 배포를 도입했다.
캐시를 효율적으로 운용했다.
## 4 알림
글감: retro--알림-배치, retro--없는-글감
알림 배치 준비에 2주가 걸렸다.
대기 시간이 5분 줄었다.
## 5 회고
장애 대응 시간이 30분 줄었다.

## 맞춰야 할 것
| 번호 | 대상 | 쪽 |
|---|---|---|
| 1 | 결과 표 | 3 |
`

test('claims: each figure and reason checked against the material its page cites (card 102)', () => {
  const root = claimsWorkspace()
  const r = claims(CLAIMS_SKEL, readMaterial(root), settled(root))
  const kinds = r.problems.map(p => `${p.page}:${p.kind}`)
  assert.deepEqual(kinds.sort(), ['3:to_confirm', '3:unsupported', '4:not_in_material', '4:unknown_id', '5:uncited'].sort())
  assert.equal(r.ok, false)
  assert.match(r.problems.find(p => p.kind === 'unsupported').text, /^40%/)
  assert.match(r.problems.find(p => p.kind === 'to_confirm').text, /카나리/)
  // the reason sentence the material does say (전체 스캔) is grounded; the cover carries no claim
  assert.ok(!r.problems.some(p => p.page === 2 || p.page === 1))
  assert.deepEqual(r.listed.self_confirmed.map(x => x.text.split(' ')[0]), ['3배'])
  assert.deepEqual(r.listed.user_stated.map(x => x.id), ['retro--알림-배치'])
  assert.deepEqual(r.listed.tone.map(x => x.phrase), ['효율적으로'])
})

test('claims: the other way, results no page carries and items no page cites are listed', () => {
  const root = claimsWorkspace()
  const r = claims(CLAIMS_SKEL, readMaterial(root), settled(root))
  assert.deepEqual(r.unused_results, [{ id: 'retro--검색-지연', figure: '12만건' }])
  assert.deepEqual(r.uncited_items, ['retro--미사용'])
  assert.deepEqual(r.settled, ['진행 중인 장은 완료했을 때 기준으로 쓴다', '서로 다른 일은 한 블록에 섞지 않는다'])
})

test('claims: a sentence already marked [확인 필요] is not raised again, and a clean skeleton is ok', () => {
  const root = claimsWorkspace()
  const clean = '## 1 검색\n글감: retro--검색-지연\n응답 시간 820ms → 210ms.\n카나리 배포를 도입했다 위해 [확인 필요: 이유].\n'
  const r = claims(clean, readMaterial(root))
  assert.deepEqual(r.problems, [])
  assert.equal(r.ok, true)
})

test('claims reads deck.mdx: one page per slide, cites from the slide comment, slot values as lines', () => {
  const root = claimsWorkspace()
  const deck = '---\ntemplate: t.pptx\n---\n\n## @s1 표지\ntitle: 가상 인물\n\n## @s3 2쪽 · 글감: retro--검색-지연\ntitle: 검색이 느렸다\ntext1:\n  - 응답 시간 820ms → 210ms\n  - 조회 비용 40% 감소\npic1: assets/a.svg\nnotes: 99% 말로\n\n## @s3\ntitle: 알림\ntext1: 대기 5분 감소\n'
  const pages = deckPages(deck)
  assert.match(pages, /^## 1쪽\n가상 인물/m)
  assert.match(pages, /## 2쪽\n글감: retro--검색-지연\n검색이 느렸다\n응답 시간 820ms → 210ms\n조회 비용 40% 감소/)
  assert.ok(!pages.includes('99%') && !pages.includes('a.svg'))
  const r = claims(pages, readMaterial(root))
  assert.deepEqual(r.problems.map(p => `${p.page}:${p.kind}`), ['2:unsupported', '3:uncited'])
})

test('claims reads resume.md: each section or entry heading is a page, its bullets the lines (card 104)', () => {
  const root = claimsWorkspace()
  const resume = '---\ntemplate: template/resume.docx\n---\n# 가상 인물\nbackend@example.invalid\n## 경력\n### 가상 회사 · 2021–2024\n- 응답 시간 820ms → 210ms\n- 조회 비용 40% 감소\n글감: retro--검색-지연\n### 다른 회사\n- 대기 5분 감소\n'
  const pages = resumePages(resume)
  assert.ok(!pages.includes('example.invalid'), 'the header is not a claim')
  const r = claims(pages, readMaterial(root))
  assert.deepEqual(r.problems.map(p => `${p.page}:${p.kind}`), ['2:unsupported', '3:uncited'])
})

test('claims reads a ledger workspace: a figure on a ledger line, `근거 없음` on that line', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-ledger-'))
  mkdirSync(join(root, 'sources/01_가상검색'), { recursive: true })
  writeFileSync(join(root, 'sources/01_가상검색/A1_검색개편.md'), '# A1 검색 개편\n\n- 결과: 응답 50% 단축 (측정 문서)\n- 비용: 30% 절감 근거 없음\n')
  const r = claims('## 1 검색\n글감: 01_가상검색/A1\n응답이 50% 줄었다.\n비용이 30% 줄었다.\n', readMaterial(root))
  assert.deepEqual(r.problems.map(p => p.kind), ['unsupported'])
})

test('claims reads B- and C-grade ledger files as items, not only A', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-ledger-'))
  mkdirSync(join(root, 'sources/01_가상검색'), { recursive: true })
  writeFileSync(join(root, 'sources/01_가상검색/B1_캐시.md'), '# B1 캐시\n\n- 결과: 응답 2.7초 → 0.4초 (측정 문서)\n')
  writeFileSync(join(root, 'sources/01_가상검색/C2_로그.md'), '# C2 로그\n\n- 로그 12건 정리\n')
  const items = readMaterial(root)
  assert.deepEqual([...items.keys()].sort(), ['01_가상검색/B1', '01_가상검색/C2'])
  const r = claims('## 1 검색\n글감: 01_가상검색/B1, 01_가상검색/C2\n응답이 2.7초에서 줄었다.\n로그 12건을 정리했다.\n', items)
  assert.deepEqual(r.problems, [])
})

test('claims: a figure only docs/확정사실.md states is listed as confirmed, not not_in_material', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-ledger-'))
  mkdirSync(join(root, 'sources/01_가상검색'), { recursive: true })
  writeFileSync(join(root, 'sources/01_가상검색/A1_검색.md'), '# A1 검색\n\n- 결과: 응답 50% 단축\n')
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs/확정사실.md'), '# 확정사실\n\n## 사실\n- 근속 9개월, 배포 47초\n')
  const r = claims('## 1 검색\n글감: 01_가상검색/A1\n9개월 동안 배포를 47초로 줄였다.\n응답이 80% 줄었다.\n', readMaterial(root), [], null, confirmedFacts(root))
  assert.deepEqual(r.problems.map(p => p.text.split(' ')[0]), ['80%'])
  assert.deepEqual(r.listed.confirmed.map(x => x.text.split(' ')[0]), ['9개월', '47초'])
})

test('claims: a template label (`해결:`) is not read as a reason sentence', () => {
  const root = claimsWorkspace()
  const r = claims('## 1 검색\n글감: retro--검색-지연\n해결: 카나리 배포 도입\n', readMaterial(root))
  assert.deepEqual(r.problems.filter(p => p.kind === 'to_confirm'), [])
  const why = claims('## 1 검색\n글감: retro--검색-지연\n해결: 장애가 잦았기 때문에 카나리 배포 도입\n', readMaterial(root))
  assert.deepEqual(why.problems.map(p => p.kind), ['to_confirm'])
})

test('claims and settle CLI say so when docs/확정사실.md has no 서술 기준 or 구조 section', () => {
  const root = workspace()
  writeFileSync(join(root, 'docs/확정사실.md'), '# 확정사실\n\n## 사실\n- 근속 9개월\n')
  const out = JSON.parse(spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'manage.mjs'), 'claims'], { cwd: root, encoding: 'utf8' }).stdout)
  assert.match(out.settled_note, /서술 기준.*구조/)
  writeFileSync(join(root, 'f.json'), '[]')
  const s = JSON.parse(settleCli(root, '--findings', 'f.json').stdout)
  assert.match(s.settled_note, /서술 기준.*구조/)
  writeFileSync(join(root, 'docs/확정사실.md'), '# 확정사실\n\n## 구조\n- 서로 다른 일은 한 블록에 섞지 않는다\n')
  assert.equal(JSON.parse(settleCli(root, '--findings', 'f.json').stdout).settled_note, undefined)
})

test('compare: a claim that lost its ground makes the round worse whatever the scores (card 102)', () => {
  const root = claimsWorkspace()
  const items = () => readMaterial(root)
  const before = claims('## 1 검색\n글감: retro--검색-지연\n응답 시간 820ms → 210ms.\n', items())
  const after = claims('## 1 검색\n글감: retro--검색-지연\n응답 시간 820ms → 210ms.\n조회 비용이 40% 줄었다.\n', items())
  const r = compare({ Impact: 5 }, { Impact: 7 }, before, after)
  assert.equal(r.verdict, 'worse')
  assert.deepEqual(r.lost_ground.map(p => p.kind), ['unsupported'])
  assert.equal(compare({ Impact: 5 }, { Impact: 7 }, before, before).verdict, 'better')
  assert.equal(compare({ Impact: 5 }, { Impact: 7 }).lost_ground, undefined)
})

// ── settle: findings that re-raise a 확정사실.md line (card 102); all names invented ──
const SETTLE_DOC = '# 확정사실\n\n## 서술 기준\n- 진행 중인 장은 완료했을 때 기준으로 쓴다\n\n## 구조\n- 서로 다른 일은 한 블록에 섞지 않는다\n\n## 정정\n- 2026-01-03 본인: 팀장 직함은 파트장으로 바로잡는다\n'
const F_BASIS = { id: 'f1', text: '진행 중인 장은 완료한 시점 기준으로 서술해야 한다' }
const F_OTHER = { id: 'f2', text: '표지 제목의 글꼴이 작아서 눈에 띄지 않는다' }
const F_STRUCT = { id: 'f3', text: '서로 다른 일은 한 블록에 섞어 쓰면 안 된다' }
const F_FIX = { id: 'f4', text: '팀장 직함은 파트장으로 바로잡는다고 2026-01-03에 본인이 말했다' }
const settleRoot = doc => {
  const root = mkdtempSync(join(tmpdir(), 'manage-settle-'))
  if (doc !== undefined) { mkdirSync(join(root, 'docs')); writeFileSync(join(root, 'docs/확정사실.md'), doc) }
  return root
}
const settleCli = (root, ...a) => spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'manage.mjs'), 'settle', ...a], { cwd: root, encoding: 'utf8' })

test('settle: a paraphrase of a 서술 기준 or 구조 line is settled with its line and share; the rest stays kept in input order', () => {
  const lines = settled(settleRoot(SETTLE_DOC))
  const r = settle([F_OTHER, F_BASIS, F_FIX, F_STRUCT], lines)
  assert.deepEqual(r.kept, [F_OTHER, F_FIX])
  assert.deepEqual(r.settled.map(s => s.finding), [F_BASIS, F_STRUCT])
  assert.equal(r.settled[0].line, '진행 중인 장은 완료했을 때 기준으로 쓴다')
  assert.equal(r.settled[1].line, '서로 다른 일은 한 블록에 섞지 않는다')
  for (const s of r.settled) { assert.equal(typeof s.share, 'number'); assert.ok(s.share >= 0.5 && s.share <= 1) }
})

test('settle: a finding echoing the 정정 line is kept (corrections are never matched)', () => {
  const root = settleRoot(SETTLE_DOC)
  assert.ok(!settled(root).some(l => l.includes('파트장')))
  assert.deepEqual(settle([F_FIX], settled(root)), { kept: [F_FIX], settled: [] })
})

test('settle: no settled lines keeps everything; an empty array is empty both ways', () => {
  assert.deepEqual(settle([F_BASIS, F_OTHER], settled(settleRoot())), { kept: [F_BASIS, F_OTHER], settled: [] })
  assert.deepEqual(settle([], ['진행 중인 장은 완료했을 때 기준으로 쓴다']), { kept: [], settled: [] })
})

test('settle: a 2-stem line under 서술 기준 never settles a finding that contains both stems', () => {
  const lines = settled(settleRoot('# 확정사실\n\n## 서술 기준\n- 배포 점검\n'))
  assert.deepEqual(lines, ['배포 점검'])
  const f = { id: 'g1', text: '배포 점검을 매번 하지 않아서 문제다' }
  assert.deepEqual(settle([f], lines), { kept: [f], settled: [] })
})

test('settle: a finding sharing exactly 2 stems with a 4-stem line is kept (share 0.5 but under the 3-stem minimum)', () => {
  const lines = ['달빛 상점 주문 처리']
  const f = { id: 'g2', text: '주문 처리 속도가 느리다' }
  assert.deepEqual(settle([f], lines), { kept: [f], settled: [] })
  const f3 = { id: 'g3', text: '달빛 상점 주문 흐름이 느리다' } // 3 of 4 stems: settled
  assert.equal(settle([f3], lines).settled.length, 1)
})

test('settle CLI: one JSON line {kept, settled}', () => {
  const root = settleRoot(SETTLE_DOC)
  writeFileSync(join(root, 'findings.json'), JSON.stringify([F_BASIS, F_OTHER]))
  const r = settleCli(root, '--findings', 'findings.json')
  assert.equal(r.status, 0)
  const rows = r.stdout.trim().split('\n')
  assert.equal(rows.length, 1)
  const out = JSON.parse(rows[0])
  assert.deepEqual(out.kept, [F_OTHER])
  assert.deepEqual(out.settled.map(s => s.finding), [F_BASIS])
  assert.deepEqual(Object.keys(out.settled[0]).sort(), ['finding', 'line', 'share'])
})

test('settle CLI: no docs/확정사실.md keeps every finding and says the file is missing; an empty file array gives empty lists', () => {
  const root = settleRoot()
  writeFileSync(join(root, 'findings.json'), JSON.stringify([F_BASIS, F_OTHER]))
  const missing = 'docs/확정사실.md not found: no settled decision or confirmed fact is read'
  assert.deepEqual(JSON.parse(settleCli(root, '--findings', 'findings.json').stdout), { kept: [F_BASIS, F_OTHER], settled: [], settled_note: missing })
  writeFileSync(join(root, 'none.json'), '[]')
  assert.deepEqual(JSON.parse(settleCli(root, '--findings', 'none.json').stdout), { kept: [], settled: [], settled_note: missing })
})

// A workspace synced from macOS keeps Korean names decomposed (NFD); Linux matches bytes (card 140).
test('NFD names: 확정사실 and 선정 are read, layout lists them present, scaffold does not write an NFC twin', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-nfd-'))
  mkdirSync(join(root, 'docs')); mkdirSync(join(root, 'sources'))
  writeFileSync(join(root, 'docs', '확정사실.md'.normalize('NFD')), SETTLE_DOC + '\n- 응답 시간 2.7초\n')
  writeFileSync(join(root, 'sources', '선정.md'.normalize('NFD')), '# 선정\n\n| 글감 | 쓰임 | 쪽 | 이유 | 대표 |\n|---|---|---|---|---|\n| 01_가상/A1 | 본문 | 3 | 핵심 | 예 |\n')
  assert.ok(!existsSync(join(root, 'docs', '확정사실.md'.normalize('NFC'))), 'the fixture holds only the NFD name')
  assert.deepEqual(settled(root), ['진행 중인 장은 완료했을 때 기준으로 쓴다', '서로 다른 일은 한 블록에 섞지 않는다'])
  assert.equal(confirmedFacts(root).length, 1)
  assert.equal(selection(root).rows.length, 1)
  const l = layout(root)
  assert.ok(l.present.includes('docs/확정사실.md') && l.present.includes('sources/선정.md'))
  assert.ok(!scaffold(root).created.includes('sources/선정.md'))
  assert.deepEqual(readdirSync(join(root, 'sources')), ['선정.md'.normalize('NFD')])
  assert.equal(settledNote(root), undefined)
})

test('settledNote: a file with neither section is named; so is a missing one', () => {
  assert.match(settledNote(settleRoot('# 확정사실\n\n## 쓰지 않는 것\n- 직함\n')), /no `## 서술 기준` or `## 구조` section/)
  assert.match(settledNote(settleRoot()), /not found/)
})

test('settle CLI: a missing flag, a missing file and a non-array file are errors naming --findings', () => {
  const root = settleRoot(SETTLE_DOC)
  writeFileSync(join(root, 'obj.json'), '{"id":"f1"}')
  for (const a of [[], ['--findings', 'missing.json'], ['--findings', 'obj.json']]) {
    const r = settleCli(root, ...a)
    assert.notEqual(r.status, 0)
    assert.match(JSON.parse(r.stdout).error, /--findings/)
  }
})

test('settle CLI: a findings entry without string text exits non-zero and names its index', () => {
  const root = settleRoot(SETTLE_DOC)
  writeFileSync(join(root, 'bad.json'), JSON.stringify([F_OTHER, { id: 'x2' }]))
  const r = settleCli(root, '--findings', 'bad.json')
  assert.notEqual(r.status, 0)
  assert.match(JSON.parse(r.stdout).error, /findings\[1\]/)
})

test('settle CLI: an absolute --findings path and a ../ path are refused', () => {
  const root = settleRoot(SETTLE_DOC)
  writeFileSync(join(root, 'findings.json'), JSON.stringify([F_OTHER]))
  writeFileSync(join(root, '..', 'manage-outside-findings.json'), JSON.stringify([F_OTHER]))
  for (const p of [join(root, 'findings.json'), '../manage-outside-findings.json']) {
    const r = settleCli(root, '--findings', p)
    assert.notEqual(r.status, 0, p)
    assert.match(JSON.parse(r.stdout).error, /inside the workspace/, p)
  }
})

// ── round: one record of the collect → build loop (card 124); all names invented ──
const MANAGE = join(dirname(fileURLToPath(import.meta.url)), 'manage.mjs')
const st = (step, verdict, criteria = `기준 ${step}`, by = 'judge') => ({ step, criteria, verdict, by, reason: 'r' })
// a round input needs exactly steps 1-7: the steps a test names are kept in order, the rest are filled in as pass;
// `raw: true` leaves the steps as given, for the cases that are refused for their step list
const full = steps => [...steps, ...[1, 2, 3, 4, 5, 6, 7].filter(k => !steps.some(s => s.step === k)).map(k => st(k, 'pass'))]
const roundIn = (r, o = {}) => {
  const { raw, ...rest } = o
  const input = { round: r, n: 3, steps: [st(1, 'pass'), st(4, 'fail')], feedback: [], ...rest }
  return raw || !Array.isArray(input.steps) ? input : { ...input, steps: full(input.steps) }
}
const roundCli = (root, input, ...a) => spawnSync(process.execPath, [MANAGE, 'round', ...(a.length ? a : ['--input', '-'])], { cwd: root, input: JSON.stringify(input), encoding: 'utf8' })
const recOf = (root, n) => JSON.parse(readFileSync(join(root, `snapshot/rounds/round-${n}.json`), 'utf8'))
// mtimes are set, never raced: the copied fixture is "now"; a round file stamped in the future leaves it older
const future = 4_000_000_000
const stamp = (root, rel, t) => utimesSync(join(root, rel), t, t)
const afterRound = (root, n, t = future) => stamp(root, `snapshot/rounds/round-${n}.json`, t)
const edit = (root, rel) => writeFileSync(join(root, rel), `${readFileSync(join(root, rel), 'utf8')}\n<!-- edited -->\n`)

test('round 1, no previous file: empty started_from, no clauses, diff.new is every gap, record and summary written', () => {
  const root = workspace()
  const r = round(root, roundIn(1, { steps: [st(1, 'pass'), st(4, 'fail', '표 정렬'), st(7, 'skipped', '쪽 읽기')], feedback: [{ id: 'f1', text: 'x' }], feedback_mode: 'panel' }))
  assert.deepEqual(r, { round: 1, rounds: 1, stop_reason: null, continue: true, gaps: ['s4/표 정렬', 's7/쪽 읽기'], record_dir: 'snapshot/rounds/round-01' })
  const rec = recOf(root, 1)
  assert.deepEqual(rec.started_from, { gaps: [], feedback: [] })
  assert.deepEqual(rec.changed, [])
  assert.equal(rec.gate.clauses, null)
  assert.deepEqual(rec.gate.diff, { resolved: [], carried: [], new: ['s4/표 정렬', 's7/쪽 읽기'] })
  assert.deepEqual(rec.gate.verdict, { 1: 'pass', 2: 'pass', 3: 'pass', 4: 'fail', 5: 'pass', 6: 'pass', 7: 'skipped' })
  assert.deepEqual(rec.feedback, { mode: 'panel', ids: ['f1'] })
  assert.deepEqual(rec.steps[1], { step: 4, criteria: '표 정렬', verdict: 'fail', by: 'judge', reason: 'r' })
  assert.deepEqual([rec.round, rec.stop_reason, rec.continue], [1, null, true])
})

test('round 2: started_from comes from round 1, and the diff names resolved, carried and new', () => {
  const root = workspace()
  round(root, roundIn(1, { steps: [st(2, 'fail', 'a'), st(3, 'fail', 'b')], feedback: [{ id: 'f1', text: 'x' }, { id: 'f2', text: 'y' }], feedback_mode: 'panel' }))
  const r = round(root, roundIn(2, { steps: [st(2, 'pass', 'a'), st(3, 'fail', 'b'), st(5, 'skipped', 'c')], feedback: [{ id: 'f2', text: 'y' }, { id: 'f9', text: 'z' }], feedback_mode: 'panel' }))
  const rec = recOf(root, 2)
  assert.deepEqual(rec.started_from, { gaps: ['s2/a', 's3/b'], feedback: ['f1', 'f2'] })
  assert.deepEqual(rec.gate.diff, { resolved: ['s2/a'], carried: ['s3/b'], new: ['s5/c'] })
  assert.deepEqual(rec.gate.clauses, { no_new_gap: false, no_new_feedback: false, no_file_changed: true })
  assert.deepEqual([r.rounds, r.gaps], [2, ['s3/b', 's5/c']])
})

test('a gap id is s<step>/<criterion id>: rewording a criterion with the same id carries the gap, never resolved plus new', () => {
  const root = workspace()
  round(root, roundIn(1, { n: 9, steps: [{ ...st(6, 'fail', 'deck check'), id: 'c-check' }] })); afterRound(root, 1)
  round(root, roundIn(2, { n: 9, steps: [{ ...st(6, 'fail', 'deck-builder check passes on deck.mdx'), id: 'c-check' }] }))
  assert.deepEqual(recOf(root, 2).gate.gaps, ['s6/c-check'])
  assert.deepEqual(recOf(root, 2).gate.diff, { resolved: [], carried: ['s6/c-check'], new: [] })
})

test('a gap id without a criterion id never holds a newline: whitespace runs collapse to one space', () => {
  const r = round(workspace(), roundIn(1, { steps: [st(6, 'fail', 'deck\n  check')] }))
  assert.deepEqual(r.gaps, ['s6/deck check'])
})

test('a criterion id must be a non-empty string without a slash or whitespace', () => {
  for (const id of ['', ' ', 'a/b', 'a b', 3]) {
    assert.throws(() => round(workspace(), roundIn(1, { steps: [{ ...st(6, 'fail'), id }] })), /steps\[\d\]\.id/, JSON.stringify(id))
  }
})

// ── intake: the findings a round consumes, parsed from the feedback text in node ──
const FB = (clashes, prio = '1. **무엇을** 3쪽 · **왜** x · **어떻게** y · `근거: A1`\n2. **무엇을** 5쪽 · `근거: C1`\n3. **무엇을** 7쪽 · 근거 없음') => [
  '**[총평 / First Impression]**', '좋음', '', '**[개선 우선순위 / Improvement Priorities]**', prio, '',
  '**[예상 인터뷰 질문 / Expected Interview Questions]**', '- A: 왜?', '', '---', '', '**부록 / Appendix**', '',
  '**[충돌 / Clashes]**', ...clashes, '', '**[주장 감사 / Claim Audit]**',
  'A1 "30분 → 4분" — 기준선 없음', 'A2 "안정화" — 수치 없음', '**[정합성 / Consistency]**', 'C1 3쪽과 9쪽 기간 다름', 'C2 스킬 근거 없음',
].join('\n')

test('intake takes priorities and survived clashes, text from the appendix; dropped and uncited are not consumed', () => {
  const r = intake(FB(['패널 / Panel: A Staff · B EM · C Tech Lead · D OSS/DevTools — sonnet, 2 rounds', 'A2 — B: 기준선 있음 — survived', 'C2 — D: 근거 있음 — dropped']))
  assert.equal(r.mode, 'panel')
  assert.deepEqual(r.findings.map(f => f.id.split('#')[0]), ['A1', 'C1', 'A2'])
  assert.deepEqual(r.findings.map(f => f.text), ['"30분 → 4분" — 기준선 없음', '3쪽과 9쪽 기간 다름', '"안정화" — 수치 없음'])
  assert.deepEqual(r.not_consumed, ['3. **무엇을** 7쪽 · 근거 없음'])
})

test('intake with the panel not run is single-context and takes the priorities only', () => {
  const r = intake(FB(['패널 미실행 / panel could not run — single-context review']))
  assert.equal(r.mode, 'single-context')
  assert.deepEqual(r.findings.map(f => f.id.split('#')[0]), ['A1', 'C1'])
})

test('intake ids carry a content hash: the same appendix id with other text is another finding', () => {
  const a = intake(FB(['충돌 없음 / no clashes'])).findings[0].id
  const b = intake(FB(['충돌 없음 / no clashes']).replace('기준선 없음', '비교 대상 없음')).findings[0].id
  assert.match(a, /^A1#[0-9a-f]{8}$/)
  assert.notEqual(a, b)
  assert.equal(a, intake(FB(['충돌 없음 / no clashes'])).findings[0].id)
})

test('intake CLI: --feedback inside the workspace, --round N writes snapshot/rounds/findings-N.json; outside is refused', () => {
  const root = workspace()
  writeFileSync(join(root, 'fb.md'), FB(['충돌 없음 / no clashes']))
  const r = spawnSync(process.execPath, [MANAGE, 'intake', '--feedback', 'fb.md', '--round', '2'], { cwd: root, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout)
  const out = JSON.parse(r.stdout)
  assert.equal(out.written, 'snapshot/rounds/findings-2.json')
  assert.deepEqual(JSON.parse(readFileSync(join(root, out.written), 'utf8')), out.findings)
  const e = spawnSync(process.execPath, [MANAGE, 'intake', '--feedback', '../fb.md'], { cwd: root, encoding: 'utf8' })
  assert.equal(e.status, 1)
  assert.match(JSON.parse(e.stdout).error, /inside the workspace/)
})

test('intake refuses a text with no priorities block', () => {
  assert.throws(() => intake('**[총평 / First Impression]**\nx'), /개선 우선순위/)
})

// ── step: the engine records each step as it happens, so the order is read from the record ──
const stepAll = (root, r, verdicts = {}) => {
  for (let k = 1; k <= 7; k++) {
    step(root, { round: r, step: k, id: `c${k}`, criteria: `기준 ${k}` })
    step(root, { round: r, step: k, verdict: verdicts[k] ?? 'pass', by: 'judge', reason: 'r' })
  }
}

test('step records criteria then verdict per step with engine times; round without steps reads them, order recorded', () => {
  const root = workspace()
  stepAll(root, 1, { 4: 'fail' })
  const r = round(root, { round: 1, n: 3, feedback: [] })
  assert.deepEqual(r.gaps, ['s4/c4'])
  const rec = recOf(root, 1)
  assert.equal(rec.gate.order, 'recorded')
  assert.equal(rec.steps.length, 7)
  for (const [i, s] of rec.steps.entries()) {
    assert.ok(s.criteria_at <= s.verdict_at, `step ${s.step}`)
    if (i > 0) assert.ok(rec.steps[i - 1].verdict_at <= s.criteria_at, `gate before step ${s.step}`)
  }
})

test('step refuses a verdict before criteria, and criteria for step s+1 before step s has its verdict', () => {
  const root = workspace()
  assert.throws(() => step(root, { round: 1, step: 1, verdict: 'pass', by: 'judge' }), /step 1 has no criteria/)
  step(root, { round: 1, step: 1, criteria: 'a' })
  assert.throws(() => step(root, { round: 1, step: 2, criteria: 'b' }), /step 1 has no verdict/)
  step(root, { round: 1, step: 1, verdict: 'pass', by: 'judge' })
  assert.throws(() => step(root, { round: 1, step: 3, criteria: 'b' }), /next step is 2/)
  assert.throws(() => step(root, { round: 1, step: 1, verdict: 'fail', by: 'judge' }), /already has its verdict/)
})

test('round with steps given in the input records order: caller (not proven by the engine)', () => {
  const root = workspace()
  round(root, roundIn(1))
  assert.equal(recOf(root, 1).gate.order, 'caller')
})

test('round without steps and with fewer than seven recorded verdicts is refused, nothing written', () => {
  const root = workspace()
  step(root, { round: 1, step: 1, criteria: 'a' })
  assert.throws(() => round(root, { round: 1, n: 3, feedback: [] }), /steps-1\.json.*seven verdicts/)
  assert.ok(!existsSync(join(root, 'snapshot/rounds/round-1.json')))
})

test('step CLI: --input - records one entry and prints the step list so far', () => {
  const root = workspace()
  const r = spawnSync(process.execPath, [MANAGE, 'step', '--input', '-'], { cwd: root, input: JSON.stringify({ round: 1, step: 1, criteria: 'a' }), encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout)
  assert.deepEqual(JSON.parse(r.stdout).next, { step: 1, needs: 'verdict' })
})

test('skipped is a gap, never a pass', () => {
  const root = workspace()
  const r = round(root, roundIn(1, { steps: [st(7, 'skipped', '쪽 읽기'), st(6, 'fail', '쪽 읽기'), st(1, 'pass', '쪽 읽기')] }))
  assert.deepEqual(r.gaps, ['s7/쪽 읽기', 's6/쪽 읽기'])
  assert.deepEqual([recOf(root, 1).gate.verdict[7], recOf(root, 1).gate.verdict[6]], ['skipped', 'fail'])
  assert.equal(round(workspace(), roundIn(1, { steps: [st(7, 'skipped')] })).gaps.length, 1)
})

test('changed lists files that differ from round N-1, sorted and relative, and leaves snapshot/rounds/ out', () => {
  const root = workspace()
  round(root, roundIn(1, { n: 9 }))
  afterRound(root, 1)
  assert.deepEqual(round(root, roundIn(2, { n: 9 })).stop_reason, 'nothing_new')
  assert.deepEqual(recOf(root, 2).changed, [])
  writeFileSync(join(root, 'snapshot/rounds/note.json'), '{}')
  edit(root, 'portfolio-skeleton.md'); edit(root, 'docs/확정사실.md')
  mkdirSync(join(root, 'sources/새'), { recursive: true }); writeFileSync(join(root, 'sources/새/a.md'), 'a')
  round(root, roundIn(3, { n: 9 }))
  assert.deepEqual(recOf(root, 3).changed, ['docs/확정사실.md', 'portfolio-skeleton.md', 'sources/새/a.md'])
  assert.equal(recOf(root, 3).gate.clauses.no_file_changed, false)
})

test('changed is by content: a touch with the same bytes is not a change, an edit, a new file and a removed file are', () => {
  const root = workspace()
  round(root, roundIn(1, { n: 9 })); afterRound(root, 1)
  stamp(root, 'portfolio-skeleton.md', future + 20)
  round(root, roundIn(2, { n: 9 }))
  assert.deepEqual(recOf(root, 2).changed, [])
  assert.equal(recOf(root, 2).gate.clauses.no_file_changed, true)
  edit(root, 'portfolio-skeleton.md'); writeFileSync(join(root, 'sources/new.md'), 'n'); rmSync(join(root, 'docs/확정사실.md'))
  round(root, roundIn(3, { n: 9 }))
  assert.deepEqual(recOf(root, 3).changed, ['docs/확정사실.md', 'portfolio-skeleton.md', 'sources/new.md'])
})

test('the --input file itself is not a change', () => {
  const root = workspace()
  round(root, roundIn(1, { n: 9 })); afterRound(root, 1)
  writeFileSync(join(root, 'in.json'), JSON.stringify(roundIn(2, { n: 9 }))); stamp(root, 'in.json', future + 5)
  const r = roundCli(root, null, '--input', 'in.json')
  assert.equal(r.status, 0, r.stdout)
  assert.deepEqual(recOf(root, 2).changed, [])
  assert.equal(JSON.parse(r.stdout).stop_reason, 'nothing_new')
})

test('nothing_new fires when any one clause holds; only all three failing keeps the loop going', () => {
  const same = { steps: [st(4, 'fail', 'k')], feedback: [{ id: 'f1', text: 'x' }], feedback_mode: 'panel', n: 9 }
  const newGap = [st(4, 'fail', 'k'), st(5, 'fail', 'm')]
  const newFb = [{ id: 'f1', text: 'x' }, { id: 'f2', text: 'y' }]
  const prep = () => { const root = workspace(); round(root, roundIn(1, same)); afterRound(root, 1); return root }
  const run = (input, touch) => {
    const root = prep(); if (touch) edit(root, 'portfolio-skeleton.md')
    const r = round(root, roundIn(2, input))
    return [r.stop_reason, r.continue, recOf(root, 2).gate.clauses]
  }
  // all three true
  assert.deepEqual(run(same), ['nothing_new', false, { no_new_gap: true, no_new_feedback: true, no_file_changed: true }])
  // only no_new_gap
  assert.deepEqual(run({ ...same, feedback: newFb }, true), ['nothing_new', false, { no_new_gap: true, no_new_feedback: false, no_file_changed: false }])
  // only no_new_feedback
  assert.deepEqual(run({ ...same, steps: newGap }, true), ['nothing_new', false, { no_new_gap: false, no_new_feedback: true, no_file_changed: false }])
  // only no_file_changed
  assert.deepEqual(run({ ...same, steps: newGap, feedback: newFb }), ['nothing_new', false, { no_new_gap: false, no_new_feedback: false, no_file_changed: true }])
  // reproduction: same gaps, a new feedback id, no file changed
  assert.deepEqual(run({ ...same, feedback: newFb }), ['nothing_new', false, { no_new_gap: true, no_new_feedback: false, no_file_changed: true }])
  // none true
  assert.deepEqual(run({ ...same, steps: newGap, feedback: newFb }, true), [null, true, { no_new_gap: false, no_new_feedback: false, no_file_changed: false }])
})

test('clauses are not evaluated in round 1: nothing_new never fires there', () => {
  assert.equal(round(workspace(), roundIn(1, { steps: [], n: 9 })).stop_reason, null)
})

test('n_reached at round >= n, null before it', () => {
  const root = workspace()
  assert.deepEqual(round(root, roundIn(1, { n: 2 })), { round: 1, rounds: 1, stop_reason: null, continue: true, gaps: ['s4/기준 4'], record_dir: 'snapshot/rounds/round-01' })
  afterRound(root, 1); edit(root, 'portfolio-skeleton.md')
  const r = round(root, roundIn(2, { n: 2, steps: [st(4, 'fail'), st(6, 'fail')], feedback: [{ id: 'f9', text: 'z' }], feedback_mode: 'panel' }))
  assert.deepEqual([r.stop_reason, r.continue], ['n_reached', false])
})

test('blocked is recorded with its text and ends the loop', () => {
  const root = workspace()
  const r = round(root, roundIn(1, { blocked: 'renderer missing' }))
  assert.deepEqual([r.stop_reason, r.continue], ['blocked', false])
  assert.equal(recOf(root, 1).blocked, 'renderer missing')
})

test('waiting_user is refused: a user-wait is answered by the user, noah or the proposal, nothing written', () => {
  const root = workspace()
  assert.throws(() => round(root, roundIn(1, { waiting_user: '2쪽 구성을 바꿀까요?' })), /answered_by/)
  assert.equal(existsSync(join(root, 'snapshot/rounds/round-1.json')), false)
})

test('answered_by on steps 2-4 is kept by step and round and listed by the read form', () => {
  const root = workspace()
  for (let k = 1; k <= 7; k++) {
    step(root, { round: 1, step: k, id: `c${k}`, criteria: `기준 ${k}` })
    const answered = { 2: 'proposal', 3: 'noah' }[k]
    step(root, { round: 1, step: k, verdict: 'pass', by: 'judge', ...(answered && { answered_by: answered }) })
  }
  round(root, { round: 1, n: 2, feedback: [] })
  const rec = recOf(root, 1)
  assert.equal(rec.steps[1].answered_by, 'proposal')
  assert.equal(rec.steps[2].answered_by, 'noah')
  assert.equal(rec.steps[0].answered_by, undefined)
  assert.deepEqual(readRounds(root).items[0].answered, { 2: 'proposal', 3: 'noah' })
})

test('answered_by is refused on steps other than 2-4 and for values other than user, noah, proposal', () => {
  const root = workspace()
  step(root, { round: 1, step: 1, id: 'c1', criteria: '기준 1' })
  assert.throws(() => step(root, { round: 1, step: 1, verdict: 'pass', by: 'judge', answered_by: 'user' }), /steps 2-4/)
  step(root, { round: 1, step: 1, verdict: 'pass', by: 'judge' })
  step(root, { round: 1, step: 2, id: 'c2', criteria: '기준 2' })
  assert.throws(() => step(root, { round: 1, step: 2, verdict: 'pass', by: 'judge', answered_by: 'me' }), /user, noah or proposal/)
  assert.throws(() => round(workspace(), roundIn(1, { steps: [{ ...st(5, 'pass'), answered_by: 'user' }] })), /steps 2-4/)
})

test('precedence: blocked > nothing_new > n_reached', () => {
  const same = { steps: [st(4, 'fail', 'k')], feedback: [], n: 2 }
  const prep = () => { const root = workspace(); round(root, roundIn(1, same)); afterRound(root, 1); return root }
  // round 2 of n=2 with nothing new: nothing_new beats n_reached
  assert.equal(round(prep(), roundIn(2, same)).stop_reason, 'nothing_new')
  assert.equal(round(prep(), roundIn(2, { ...same, blocked: 'b' })).stop_reason, 'blocked')
  // all three clauses failing (new gap, new feedback id, a changed file) removes nothing_new, so n_reached is what is left
  const changed = prep(); edit(changed, 'portfolio-skeleton.md')
  assert.equal(round(changed, roundIn(2, { ...same, steps: [st(4, 'fail', 'k'), st(5, 'fail', 'z')], feedback: [{ id: 'f9', text: 'z' }], feedback_mode: 'panel' })).stop_reason, 'n_reached')
})

test('empty or blank criteria are refused: exit 1, an error object, nothing written', () => {
  for (const criteria of ['', '   ']) {
    const root = workspace()
    const r = roundCli(root, roundIn(1, { steps: [st(1, 'pass'), { step: 2, criteria, verdict: 'fail', by: 'judge' }] }))
    assert.equal(r.status, 1)
    assert.match(JSON.parse(r.stdout).error, /steps\[1\].*criteria/)
    assert.ok(!existsSync(join(root, 'snapshot/rounds')))
  }
})

test('round input is validated: step range, verdict, by, round, n, feedback; nothing is written', () => {
  const bad = [
    roundIn(1, { steps: [st(0, 'pass')] }), roundIn(1, { steps: [st(8, 'pass')] }), roundIn(1, { steps: [st(1, 'maybe')] }),
    roundIn(1, { steps: [st(1, 'pass', 'c', '')] }), roundIn(0), roundIn(1.5), roundIn(1, { n: 0 }), roundIn(1, { feedback: [{ id: 'a' }] }),
    roundIn(1, { steps: 'x' }),
  ]
  for (const input of bad) {
    const root = workspace()
    assert.throws(() => round(root, input), undefined, JSON.stringify(input))
    assert.ok(!existsSync(join(root, 'snapshot/rounds')))
  }
})

// A refused round: exit 1, a plain error naming the rule, and snapshot/rounds/ exactly as it was before the call.
const roundsDir = root => (existsSync(join(root, 'snapshot/rounds')) ? readdirSync(join(root, 'snapshot/rounds')).sort() : null)
const refused = (root, input, message) => {
  const before = roundsDir(root)
  const r = roundCli(root, input)
  assert.equal(r.status, 1, r.stdout)
  const { error, ...rest } = JSON.parse(r.stdout)
  assert.match(error, message)
  assert.doesNotMatch(error, /is not a function|undefined/)
  assert.deepEqual(rest, {}, 'no summary: stop_reason is not recorded')
  assert.deepEqual(roundsDir(root), before)
}
const prevFile = (root, content) => {
  mkdirSync(join(root, 'snapshot/rounds'), { recursive: true })
  writeFileSync(join(root, 'snapshot/rounds/round-1.json'), typeof content === 'string' ? content : JSON.stringify(content))
}

test('a steps list that is not exactly steps 1-7 once each is refused: empty, partial, step 3 twice', () => {
  const seven = /exactly seven.*steps 1-7/
  refused(workspace(), roundIn(1, { raw: true, steps: [] }), seven)
  refused(workspace(), roundIn(1, { raw: true, steps: [st(1, 'pass'), st(4, 'fail')] }), seven)
  refused(workspace(), roundIn(1, { raw: true, steps: [1, 2, 3, 3, 5, 6, 7].map(k => st(k, 'pass')) }), seven)
  refused(workspace(), roundIn(1, { raw: true, steps: [1, 2, 3, 4, 5, 6, 7, 7].map(k => st(k, 'pass')) }), seven)
})

test('round N>1 with no round-(N-1).json is refused and writes nothing', () => {
  const root = workspace()
  refused(root, roundIn(3, { n: 9 }), /round-2\.json.*missing/)
  round(root, roundIn(1, { n: 9 }))
  refused(root, roundIn(3, { n: 9 }), /round-2\.json.*missing/)
})

test('an existing round-N.json is never overwritten: refused, the file byte-identical', () => {
  const root = workspace()
  round(root, roundIn(1)); round(root, roundIn(2))
  for (const r of [1, 2]) {
    const before = readFileSync(join(root, `snapshot/rounds/round-${r}.json`))
    refused(root, roundIn(r, { steps: [st(2, 'fail', 'else')] }), /round-\d\.json already exists.*never overwrite/)
    assert.ok(readFileSync(join(root, `snapshot/rounds/round-${r}.json`)).equals(before))
  }
})

test('a previous record of the wrong shape is refused as malformed, never read as an empty round', () => {
  const cases = [
    [{}, /field round/], [[1, 2], /must be a JSON object/], ['null', /must be a JSON object/], ['{not json', /cannot be read as JSON/],
    [{ gate: { gaps: 'oops' }, feedback: 7 }, /field round/],
    [{ round: 1, n: 3, steps: [], gate: { gaps: 'oops' }, feedback: 7 }, /gate\.gaps/],
    [{ round: 1, n: 3, steps: [], gate: { gaps: [] }, feedback: 7 }, /feedback/],
    [{ round: 1, n: 3, steps: [], gate: { gaps: [] }, feedback: [{ text: 'no id' }] }, /feedback/],
    [{ round: 1, n: 3, steps: 'x', gate: { gaps: [] }, feedback: [] }, /steps/],
    [{ round: 1, n: 3, steps: [], gate: [], feedback: [] }, /gate/],
    [{ round: 1, n: 'three', steps: [], gate: { gaps: [] }, feedback: [] }, /field n/],
  ]
  for (const [content, why] of cases) {
    const root = workspace()
    prevFile(root, content)
    const before = readFileSync(join(root, 'snapshot/rounds/round-1.json'))
    refused(root, roundIn(2), new RegExp(`previous record malformed: snapshot/rounds/round-1\\.json .*${why.source}`))
    assert.ok(readFileSync(join(root, 'snapshot/rounds/round-1.json')).equals(before))
  }
})

test('n must equal the previous record n, and round may not pass n', () => {
  const root = workspace()
  round(root, roundIn(1, { n: 3 }))
  refused(root, roundIn(2, { n: 4 }), /n 4 differs from n 3 in snapshot\/rounds\/round-1\.json/)
  refused(root, roundIn(2, { n: 2 }), /n 2 differs from n 3/)
  refused(workspace(), roundIn(3, { n: 2 }), /round 3 is past n 2/)
  const late = workspace()
  round(late, roundIn(1, { n: 1 }))
  refused(late, roundIn(2, { n: 1 }), /round 2 is past n 1/)
})

test('a valid input with a valid predecessor still writes the record and gives the same stop_reason', () => {
  const root = workspace()
  round(root, roundIn(1, { n: 2 }))
  afterRound(root, 1); edit(root, 'portfolio-skeleton.md')
  const r = round(root, roundIn(2, { n: 2, steps: [st(4, 'fail'), st(6, 'fail')], feedback: [{ id: 'f9', text: 'z' }], feedback_mode: 'panel' }))
  assert.deepEqual([r.stop_reason, r.continue, r.rounds], ['n_reached', false, 2])
  assert.equal(recOf(root, 2).steps.length, 7)
})

test('feedback is recorded as {mode, ids}: the mode the input names, ids in input order', () => {
  for (const mode of ['panel', 'single-context']) {
    const root = workspace()
    round(root, roundIn(1, { feedback: [{ id: 'f2', text: 'y' }, { id: 'f1', text: 'x' }], feedback_mode: mode }))
    assert.deepEqual(recOf(root, 1).feedback, { mode, ids: ['f2', 'f1'] })
  }
})

test('empty feedback is recorded as {mode: null, ids: []}, with feedback_mode absent or null', () => {
  for (const o of [{}, { feedback_mode: null }, { feedback: undefined }]) {
    const root = workspace()
    round(root, roundIn(1, o))
    assert.deepEqual(recOf(root, 1).feedback, { mode: null, ids: [] })
  }
})

test('feedback without a valid feedback_mode is refused naming it, and no file is written', () => {
  const fb = [{ id: 'f1', text: 'x' }]
  for (const o of [{ feedback: fb }, { feedback: fb, feedback_mode: 'x' }, { feedback: fb, feedback_mode: '' }, { feedback: fb, feedback_mode: null }, { feedback: [], feedback_mode: 'x' }]) {
    const root = workspace()
    assert.throws(() => round(root, roundIn(1, o)), /feedback_mode/, JSON.stringify(o))
    assert.ok(!existsSync(join(root, 'snapshot/rounds')))
  }
})

test('round 2 reads round 1 the same whether it holds {mode, ids} or the legacy [{id, text}] array', () => {
  const run = legacy => {
    const root = workspace()
    round(root, roundIn(1, { feedback: [{ id: 'f1', text: 'x' }, { id: 'f2', text: 'y' }], feedback_mode: 'panel', n: 9 }))
    if (legacy) writeFileSync(join(root, 'snapshot/rounds/round-1.json'), JSON.stringify({ ...recOf(root, 1), feedback: [{ id: 'f1', text: 'x' }, { id: 'f2', text: 'y' }] }))
    afterRound(root, 1)
    round(root, roundIn(2, { feedback: [{ id: 'f2', text: 'y' }, { id: 'f9', text: 'z' }], feedback_mode: 'panel', n: 9 }))
    return recOf(root, 2)
  }
  const [obj, old] = [run(false), run(true)]
  assert.deepEqual(obj.started_from.feedback, ['f1', 'f2'])
  assert.deepEqual(old.started_from.feedback, obj.started_from.feedback)
  assert.equal(obj.gate.clauses.no_new_feedback, false)
  assert.deepEqual(old.gate.clauses, obj.gate.clauses)
})

test('round CLI: stdin and a file inside the workspace both work; an outside path and a missing --input are errors', () => {
  const root = workspace()
  const r = roundCli(root, roundIn(1))
  assert.equal(r.status, 0)
  assert.deepEqual(JSON.parse(r.stdout), { round: 1, rounds: 1, stop_reason: null, continue: true, gaps: ['s4/기준 4'], record_dir: 'snapshot/rounds/round-01' })
  assert.ok(existsSync(join(root, 'snapshot/rounds/round-1.json')))
  writeFileSync(join(root, 'in.json'), JSON.stringify(roundIn(2)))
  const f = roundCli(root, null, '--input', 'in.json')
  assert.equal(f.status, 0)
  assert.equal(JSON.parse(f.stdout).rounds, 2)
  for (const a of [['--input', '../x.json'], ['--input', join(root, 'in.json')], []]) {
    const e = spawnSync(process.execPath, [MANAGE, 'round', ...a], { cwd: root, input: '', encoding: 'utf8' })
    assert.equal(e.status, 1, a.join(' '))
    assert.ok(JSON.parse(e.stdout).error)
  }
})

test('round --read prints every recorded round from the files alone: verdicts, gate, changed, stop_reason, feedback', () => {
  const root = workspace()
  const empty = spawnSync(process.execPath, [MANAGE, 'round', '--read'], { cwd: root, encoding: 'utf8' })
  assert.equal(empty.status, 0, empty.stdout)
  assert.deepEqual(JSON.parse(empty.stdout), { rounds: 0, last: null, items: [] })
  round(root, roundIn(1, { n: 2, feedback: [{ id: 'f1', text: 'x' }], feedback_mode: 'panel' })); afterRound(root, 1)
  round(root, roundIn(2, { n: 2, steps: [st(4, 'fail'), st(6, 'fail')] }))
  const r = spawnSync(process.execPath, [MANAGE, 'round', '--read'], { cwd: root, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout)
  const out = JSON.parse(r.stdout)
  assert.equal(out.rounds, 2)
  assert.deepEqual(out.last, { round: 2, stop_reason: 'nothing_new', continue: false })
  assert.deepEqual(out.items.map(i => i.round), [1, 2])
  const two = recOf(root, 2)
  assert.deepEqual(out.items[1], { round: 2, n: 2, verdict: two.gate.verdict, gaps: two.gate.gaps, diff: two.gate.diff, clauses: two.gate.clauses, changed: two.changed, stop_reason: 'nothing_new', continue: false, feedback: two.feedback })
  assert.deepEqual(out.items[0].feedback, { mode: 'panel', ids: ['f1'] })
})

test('rounds counts the round-*.json files and the shared fixture is left alone', () => {
  const root = workspace()
  round(root, roundIn(1)); round(root, roundIn(2))
  assert.equal(round(root, roundIn(3)).rounds, 3)
  assert.deepEqual(readdirSync(join(root, 'snapshot/rounds')).sort(), ['end-1.json', 'end-2.json', 'end-3.json', 'round-01', 'round-02', 'round-03', 'round-1.json', 'round-2.json', 'round-3.json'])
  assert.ok(!existsSync(join(WORKSPACE, 'snapshot/rounds')))
})

// ── containment follows symlinks: a link inside the workspace that points out is outside ──
const outsideDir = () => { const d = mkdtempSync(join(tmpdir(), 'manage-out-')); copies.push(d); return d }
const manageCli = (script, root, ...a) => spawnSync(process.execPath, [script, ...a], { cwd: root, input: '', encoding: 'utf8' })

test('symlink: round --input and settle --findings through a link to an outside file are refused, the outside file is not read', () => {
  const root = workspace()
  const out = outsideDir()
  writeFileSync(join(out, 'in.json'), JSON.stringify(roundIn(1)))
  writeFileSync(join(out, 'findings.json'), JSON.stringify([F_OTHER]))
  symlinkSync(join(out, 'in.json'), join(root, 'in.json'))
  symlinkSync(join(out, 'findings.json'), join(root, 'findings.json'))
  const r = manageCli(MANAGE, root, 'round', '--input', 'in.json')
  assert.equal(r.status, 1)
  assert.match(JSON.parse(r.stdout).error, /must be a path inside the workspace root/)
  assert.ok(!existsSync(join(root, 'snapshot/rounds/round-1.json')), 'the outside file was read and acted on')
  const s = manageCli(MANAGE, root, 'settle', '--findings', 'findings.json')
  assert.equal(s.status, 1)
  assert.match(JSON.parse(s.stdout).error, /must be a path inside the workspace root/)
  assert.ok(!s.stdout.includes(F_OTHER.id), 'the outside file was read')
})

test('symlink: a link to an outside directory inside the path is refused too', () => {
  const root = workspace()
  const out = outsideDir()
  writeFileSync(join(out, 'in.json'), JSON.stringify(roundIn(1)))
  symlinkSync(out, join(root, 'docs-link'))
  const r = manageCli(MANAGE, root, 'round', '--input', 'docs-link/in.json')
  assert.equal(r.status, 1)
  assert.match(JSON.parse(r.stdout).error, /must be a path inside the workspace root/)
})

test('symlink: snapshot/rounds linked out writes nothing outside; a snapshot dir linked out does the same', () => {
  const root = workspace()
  const out = outsideDir()
  symlinkSync(out, join(root, 'snapshot/rounds'))
  assert.throws(() => round(root, roundIn(1)), /must be a path inside the workspace root/)
  const r = roundCli(root, roundIn(1))
  assert.equal(r.status, 1)
  assert.match(JSON.parse(r.stdout).error, /must be a path inside the workspace root/)
  assert.deepEqual(readdirSync(out), [])

  const root2 = workspace()
  const out2 = outsideDir()
  rmSync(join(root2, 'snapshot/skeleton'), { recursive: true })
  symlinkSync(out2, join(root2, 'snapshot/skeleton'))
  assert.throws(() => snapshot(root2, { kind: 'skeleton', level: 'patch', note: 'x' }), /must be a path inside the workspace root/)
  assert.deepEqual(readdirSync(out2), [])
  rmSync(join(root2, 'snapshot/deck'), { recursive: true })
  symlinkSync(out2, join(root2, 'snapshot/deck'))
  assert.throws(() => snapshot(root2, { kind: 'deck', level: 'patch', note: 'x' }), /must be a path inside the workspace root/)
  assert.deepEqual(readdirSync(out2), [])
})

test('symlink: a dangling link in the round-file position is refused', () => {
  const root = workspace()
  const out = outsideDir()
  mkdirSync(join(root, 'snapshot/rounds'), { recursive: true })
  symlinkSync(join(out, 'gone.json'), join(root, 'snapshot/rounds/round-1.json'))
  assert.throws(() => round(root, roundIn(1)), /must be a path inside the workspace root/)
  assert.deepEqual(readdirSync(out), [])
})

test('symlink: run through a link to the script from a cwd reached by a link, it still prints and accepts in-workspace paths', () => {
  const root = workspace()
  const holder = outsideDir()
  const scriptLink = join(holder, 'manage-link.mjs')
  symlinkSync(MANAGE, scriptLink)
  const wsLink = join(holder, 'ws-link')
  symlinkSync(root, wsLink)
  const l = manageCli(scriptLink, wsLink, 'layout')
  assert.equal(l.status, 0)
  assert.deepEqual(JSON.parse(l.stdout).missing, [])
  writeFileSync(join(root, 'in.json'), JSON.stringify(roundIn(1)))
  writeFileSync(join(root, 'findings.json'), JSON.stringify([F_OTHER]))
  const r = manageCli(scriptLink, wsLink, 'round', '--input', 'in.json')
  assert.equal(r.status, 0)
  assert.equal(JSON.parse(r.stdout).round, 1)
  assert.ok(existsSync(join(root, 'snapshot/rounds/round-1.json')))
  const s = manageCli(scriptLink, wsLink, 'settle', '--findings', 'findings.json')
  assert.equal(s.status, 0)
  assert.deepEqual(JSON.parse(s.stdout).kept, [F_OTHER])
  // a link that stays inside the workspace is fine
  writeFileSync(join(root, 'in2.json'), JSON.stringify(roundIn(2)))
  symlinkSync(join(root, 'in2.json'), join(root, 'in-link.json'))
  assert.equal(manageCli(MANAGE, wsLink, 'round', '--input', 'in-link.json').status, 0)
})

// card 141: sync, verify-build, layout's optional folders and conflict copies, snapshot --kind resume
const SLOT_SKEL = '# 가상\nversion: v1.0.0\n\n## 2쪽 · `@s2` · 문제\ntitle: 검색이 느렸다\ntext1:\n  - 응답 2.1초\n  - 원인은 인덱스 [1]{sup}\nnotes: 말할 것\npic1: assets/s2.svg\n\n## 3쪽 · `@s3` · 결과\ntitle: 응답 340ms\n\n## 4쪽 · `@s4` · 알림\ntitle: 알림 배치\n'
const SLOT_DECK = '---\ntemplate: template.pptx\n---\n\n## @s2 2쪽\ntitle: 검색이 느렸다\ntext1:\n  - 응답 2.1초\n  - 원인은 [옛 문구]{sup}\npic1: assets/s2.svg\n\n## @s3 3쪽\ntitle: 응답 **340ms**\n'

function zipOf(entries) {
  const parts = []; const central = []; let off = 0
  for (const [name, data] of Object.entries(entries)) {
    const raw = deflateRawSync(Buffer.from(data)); const nm = Buffer.from(name)
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(raw.length, 18); lh.writeUInt16LE(nm.length, 26)
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(raw.length, 20); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42)
    parts.push(lh, nm, raw); central.push(ch, nm); off += 30 + nm.length + raw.length
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16)
  return Buffer.concat([...parts, cd, end])
}
const slideXml = (...t) => `<p:sld>${t.map(x => `<a:t>${x}</a:t>`).join('')}</p:sld>`

function slotWs() {
  const root = mkdtempSync(join(tmpdir(), 'manage-slot-')); copies.push(root)
  writeFileSync(join(root, 'portfolio-skeleton.md'), SLOT_SKEL)
  writeFileSync(join(root, 'portfolio-deck.mdx'), SLOT_DECK)
  return root
}

test('sync reports each skeleton slot missing or different, ignoring markup, and writes only with the flag', () => {
  const root = slotWs()
  const r = sync(root)
  assert.deepEqual(r.different.map(d => `${d.slide}.${d.key}`), ['s2.text1'])
  assert.deepEqual(r.missing, [])
  assert.deepEqual(r.slide_missing, ['s4'])
  assert.equal(r.written, false)
  assert.equal(readFileSync(join(root, 'portfolio-deck.mdx'), 'utf8'), SLOT_DECK, 'a report writes nothing')
  writeFileSync(join(root, 'portfolio-skeleton.md'), SLOT_SKEL.replace('title: 응답 340ms', 'title: 응답 340ms\nsubtitle: 한 줄'))
  const w = sync(root, { write: true })
  assert.deepEqual(w.missing.map(m => m.key), ['subtitle'])
  assert.equal(w.written, true)
  const deck = readFileSync(join(root, 'portfolio-deck.mdx'), 'utf8')
  assert.match(deck, /text1:\n  - 응답 2\.1초\n  - 원인은 인덱스 \[1\]\{sup\}\npic1: assets\/s2\.svg/)
  assert.match(deck, /title: 응답 \*\*340ms\*\*\nsubtitle: 한 줄/)
  assert.ok(!deck.includes('@s4'), 'a missing slide is never created')
  assert.deepEqual([sync(root).missing, sync(root).different], [[], []])
})

test('verify-build: skeleton slot text, footnote marks and picture files against the built pptx', () => {
  const root = slotWs()
  assert.throws(() => verifyBuild(root), /build first/)
  mkdirSync(join(root, 'build'))
  writeFileSync(join(root, 'build', 'deck.pptx'), zipOf({
    'ppt/slides/slide1.xml': slideXml('검색이', ' 느렸다', '응답 2.1초', '원인은 인덱스 [1]'),
    'ppt/slides/slide2.xml': slideXml('응답 340ms', '알림 배치'), 'ppt/presentation.xml': '<x/>' }))
  const r = verifyBuild(root)
  assert.equal(r.checked, 5)
  assert.deepEqual(r.absent, [])
  assert.deepEqual(r.footnotes_absent, ['옛 문구'])
  assert.deepEqual(r.assets_absent, ['assets/s2.svg'])
  assert.equal(r.ok, false)
  mkdirSync(join(root, 'assets')); writeFileSync(join(root, 'assets', 's2.svg'), '<svg/>')
  writeFileSync(join(root, 'portfolio-deck.mdx'), SLOT_DECK.replace('[옛 문구]{sup}', '[1]{sup}'))
  assert.equal(verifyBuild(root).ok, true)
  writeFileSync(join(root, 'build', 'deck.pptx'), zipOf({ 'ppt/slides/slide1.xml': slideXml('검색이 느렸다') }))
  const bad = verifyBuild(root)
  assert.deepEqual(bad.absent.map(a => `${a.slide}.${a.key}`), ['s2.text1', 's2.text1', 's3.title', 's4.title'])
  assert.equal(bad.ok, false)
})

test('layout: optional folders are present or absent, a stray deck conflict copy warns', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-opt-')); copies.push(root)
  mkdirSync(join(root, 'style')); mkdirSync(join(root, 'decisions'))
  let l = layout(root)
  assert.deepEqual(l.optional, { present: ['decisions', 'style'], absent: ['feedback', 'consensus', 'stable', 'scripts', 'docs/확인할-것.md'] })
  assert.ok(!l.missing.includes('style') && l.warnings === undefined)
  writeFileSync(join(root, 'portfolio-deck.conflict-2026.mdx'), '')
  writeFileSync(join(root, 'deck.conflict-x.mdx'), '')
  writeFileSync(join(root, 'portfolio-deck.mdx'), '')
  l = layout(root)
  assert.equal(l.warnings.length, 2)
  assert.match(l.warnings[0], /^deck\.conflict-x\.mdx: /)
})

test('snapshot --kind resume counts its own versions, apart from deck', () => {
  const root = workspace()
  writeFileSync(join(root, 'resume-skeleton.md'), '# 이력서\n')
  writeFileSync(join(root, 'resume-deck.mdx'), '---\n---\n')
  const a = snapshot(root, { kind: 'resume', level: 'patch', note: '첫 판', date: '2026-01-08' })
  assert.equal(a.to, 'v1.0.0')
  assert.deepEqual(readdirSync(join(root, 'snapshot/resume/resume-v1.0.0')).sort(), ['NOTES.md', 'assets', 'resume-deck.mdx', 'resume-skeleton.md'])
  assert.equal(snapshot(root, { kind: 'resume', level: 'minor', note: '둘째', date: '2026-01-09' }).to, 'v1.1.0')
  assert.equal(snapshot(root, { kind: 'deck', level: 'patch', note: 'x' }).to, 'v1.0.1', 'deck keeps its own count (fixture holds deck-v1.0.0)')
})

// ── the standard workspace: round record folder, stable baseline, style, questions (all names invented) ──
test('round writes snapshot/rounds/round-NN/ with every record file, copies what exists, never overwrites', () => {
  const root = workspace()
  mkdirSync(join(root, 'snapshot/rounds'), { recursive: true })
  writeFileSync(join(root, 'snapshot/rounds/feedback-1.md'), '# 피드백 원문\n')
  const r = round(root, roundIn(1))
  assert.equal(r.record_dir, 'snapshot/rounds/round-01')
  const dir = join(root, r.record_dir)
  assert.deepEqual(readdirSync(dir).sort(), ['compare.json', 'feedback-after.json', 'feedback-before.json', 'feedback.md', 'noah.md', 'overrides.md',
    'pattern-a.json', 'pattern-b.json', 'portfolio-skeleton.md', 'report.md'])
  assert.equal(readFileSync(join(dir, 'portfolio-skeleton.md'), 'utf8'), readFileSync(join(root, 'portfolio-skeleton.md'), 'utf8'))
  assert.equal(readFileSync(join(dir, 'feedback.md'), 'utf8'), '# 피드백 원문\n')
  assert.match(readFileSync(join(dir, 'report.md'), 'utf8'), /\| 쪽 \| 칸 \| 이전 → 이후 \| 출처 \| 근거 파일 \| 이유 \|/)
  // a record file the person filled is not replaced when the folder is written again
  writeFileSync(join(dir, 'noah.md'), '판정: 통과\n')
  assert.throws(() => round(root, roundIn(1)), /already exists/)
  assert.equal(readFileSync(join(dir, 'noah.md'), 'utf8'), '판정: 통과\n')
  assert.deepEqual(readRounds(root).items.map(i => i.round), [1], 'the folder is not a round record')
})

test('round-check: a template report has open verification lines; an edit with no reason, a rejected finding with none and no noah verdict are problems', () => {
  const root = workspace()
  round(root, roundIn(1))
  let c = roundCheck(root, 1)
  assert.equal(c.ok, false)
  assert.ok(c.problems.includes('noah.md has no 판정'))
  assert.ok(c.problems.some(p => /검증: "pptx 문구/.test(p)))
  assert.ok(c.problems.some(p => /기본값으로 정한 것: empty/.test(p)))
  assert.ok(c.unfilled.includes('compare.json') && c.unfilled.includes('feedback.md'))
  const dir = join(root, 'snapshot/rounds/round-01')
  writeFileSync(join(dir, 'noah.md'), '판정: 보완\n근거: 인용\n')
  const rep = readFileSync(join(dir, 'report.md'), 'utf8')
  const filled = rep
    .replace('|---|---|---|---|---|---|\n', '|---|---|---|---|---|---|\n| 3 | 제목 | A → B | panel | feedback-1.md C2 | |\n')
    .replace('| 쓰지 않은 이유 |\n|---|---|---|\n', '| 쓰지 않은 이유 |\n|---|---|---|\n| C5 이름 바꾸자 | noah | |\n')
  writeFileSync(join(dir, 'report.md'), filled)
  c = roundCheck(root, 1)
  assert.ok(c.problems.includes('report.md 고친 것 row 1 (3): "이유" is empty'))
  assert.ok(c.problems.includes('report.md 쓰지 않은 지적 row 1 (C5 이름 바꾸자): "쓰지 않은 이유" is empty'))
  // every part answered: ok
  writeFileSync(join(dir, 'report.md'), filled
    .replace('| panel | feedback-1.md C2 | |', '| panel | feedback-1.md C2 | 숫자 근거가 글감에 있다 |').replace('| C5 이름 바꾸자 | noah | |', '| C5 이름 바꾸자 | noah | 확정사실에 있다 |')
    .replace(/\(작성\)[^\n]*/g, '없음').replace(/(- [^:\n]+:)\n/g, '$1 통과\n').replace(/(- [^:\n]+:)$/g, '$1 통과'))
  c = roundCheck(root, 1)
  assert.deepEqual(c.problems, [])
  assert.throws(() => roundCheck(root, 9), /does not exist/)
})

test('snapshot --stable freezes skeleton, deck, resume sources and style read-only, one README row, never overwritten', () => {
  const root = workspace()
  writeFileSync(join(root, 'resume-skeleton.md'), '# 이력서\n')
  scaffold(root)
  const r = freezeStable(root, { note: '첫 기준본', date: '2026-02-01' })
  assert.equal(r.stable, 'stable/2026-02-01-skeleton-v3.1.0')
  const dir = join(root, r.stable)
  assert.deepEqual(readdirSync(dir).sort(), ['portfolio-deck.mdx', 'portfolio-skeleton.md', 'resume-skeleton.md', 'style'])
  assert.deepEqual(readdirSync(join(dir, 'style')).length, 4)
  assert.throws(() => writeFileSync(join(dir, 'portfolio-skeleton.md'), 'x'), /EACCES|EPERM/)
  const readme = readFileSync(join(root, 'stable/README.md'), 'utf8')
  assert.match(readme, /\| 2026-02-01 \| skeleton v3\.1\.0 · deck v1\.0\.0 · resume - \| 첫 기준본 \|/)
  assert.throws(() => freezeStable(root, { date: '2026-02-01' }), /never overwritten/)
  freezeStable(root, { note: '둘째', date: '2026-02-02' })
  assert.equal(readFileSync(join(root, 'stable/README.md'), 'utf8').trim().split('\n').length, readme.trim().split('\n').length + 1)
  assert.deepEqual(layout(root).known.stable, ['2026-02-01-skeleton-v3.1.0', '2026-02-02-skeleton-v3.1.0'])
})

test('scaffold writes the style templates and the questions file once, the guide has the base principles and no pinned path', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-style-')); copies.push(root)
  scaffold(root)
  assert.match(readFileSync(join(root, 'style/문체.md'), 'utf8'), /## 규칙[\s\S]*## 내 문단/)
  assert.match(readFileSync(join(root, 'style/표기규칙.md'), 'utf8'), /## 각주[\s\S]*## 캡션/)
  assert.match(readFileSync(join(root, 'style/이력서-서식.md'), 'utf8'), /## ATS·파서 규칙/)
  writeFileSync(join(root, 'style/문체.md'), '내 규칙')
  assert.deepEqual(scaffold(root).created, [])
  assert.equal(readFileSync(join(root, 'style/문체.md'), 'utf8'), '내 규칙')
  const guide = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
  for (const w of ['## 기본 원칙', '안전 영역', '줄여 맞추지 않는다', 'AI나 도구의 흔적', 'docs/확인할-것.md', 'stable/<날짜>', 'consensus/', 'decisions/', 'analysis/']) assert.ok(guide.includes(w), w)
  assert.deepEqual(enginePathWarnings(root), [], 'the guide itself pins nothing')
  assert.equal(safeArea(root), null, 'an empty template gives no safe area')
  writeFileSync(join(root, 'style/레이아웃.md'), '# 레이아웃\n- top: 36\n- bottom: 30pt\n- left: 40\n- right: 40\n')
  assert.deepEqual(layout(root).safe_area, { top: 36, bottom: 30, left: 40, right: 40 })
})

test('layout lists the known folders, reports a broken analysis link and an engine path that is not on disk', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-known-')); copies.push(root)
  scaffold(root)
  mkdirSync(join(root, 'consensus')); writeFileSync(join(root, 'consensus/2026-02-01-순서.md'), '원문')
  mkdirSync(join(root, 'decisions')); writeFileSync(join(root, 'decisions/01-블록.md'), '정함')
  symlinkSync(join(root, 'no-such-archive'), join(root, 'analysis'))
  writeFileSync(join(root, 'style/표기규칙.md'), '# 표기\n실행: node ~/.claude/plugins/cache/x/portfolio/9.9.9/skills/manage/scripts/resume.py build\n' +
    'R=~/.claude/plugins/marketplaces/x/portfolio/skills/manage/scripts/old.py\n')
  writeFileSync(join(root, 'CLAUDE.md'), `${readFileSync(join(root, 'CLAUDE.md'), 'utf8')}\n\`node \${CLAUDE_PLUGIN_ROOT}/skills/manage/scripts/gone.mjs\` 그리고 \${CLAUDE_PLUGIN_ROOT}/skills/manage/scripts/manage.mjs\n`)
  const l = layout(root)
  assert.deepEqual(l.known.consensus, ['2026-02-01-순서.md'])
  assert.deepEqual(l.known.decisions, ['01-블록.md'])
  assert.equal(l.known.style.length, 4)
  assert.deepEqual(l.analysis, { link: join(root, 'no-such-archive'), ok: false })
  assert.ok(l.warnings.some(w => /^analysis\/: a broken link/.test(w)))
  assert.ok(l.warnings.some(w => /^style\/표기규칙\.md: names .*9\.9\.9.*resume\.py, a version-pinned plugin cache path/.test(w)))
  assert.ok(l.warnings.some(w => /^style\/표기규칙\.md: names ~\/\.claude\/plugins\/marketplaces\/.*old\.py, which does not exist/.test(w)), 'a `VAR=` assignment does not hide the path')
  assert.ok(l.warnings.some(w => /^CLAUDE\.md: .*gone\.mjs/.test(w)))
  assert.equal(l.warnings.filter(w => /manage\.mjs/.test(w)).length, 0, 'an engine file that exists is not warned')
  assert.ok(l.optional.present.includes('consensus') && l.optional.present.includes('docs/확인할-것.md'))
})

test('questions: add appends a dated line with its page, a duplicate is not added twice, read returns open and answered', () => {
  const root = workspace()
  assert.deepEqual(readQuestions(root).open, [])
  assert.deepEqual(addQuestion(root, { text: '이 수치는 본인 확인인가', page: 3, date: '2026-03-01' }), { added: true, date: '2026-03-01', page: '3쪽', text: '이 수치는 본인 확인인가' })
  assert.equal(addQuestion(root, { text: '이 수치는 본인 확인인가', page: '3쪽', date: '2026-03-02' }).duplicate, true)
  addQuestion(root, { text: '부록으로 옮길까', date: '2026-03-01' })
  const p = join(root, 'docs/확인할-것.md')
  assert.match(readFileSync(p, 'utf8'), /# 확인할 것[\s\S]*- \[ \] 2026-03-01 · 3쪽 · 이 수치는 본인 확인인가\n- \[ \] 2026-03-01 · - · 부록으로 옮길까\n$/)
  writeFileSync(p, readFileSync(p, 'utf8').replace('- [ ] 2026-03-01 · 3쪽 · 이 수치는 본인 확인인가', '- [x] 2026-03-01 · 3쪽 · 이 수치는 본인 확인인가 → 답: 맞다, 직접 했다'))
  const q = readQuestions(root)
  assert.deepEqual(q.answered, [{ date: '2026-03-01', page: '3쪽', text: '이 수치는 본인 확인인가', answer: '맞다, 직접 했다' }])
  assert.deepEqual(q.open.map(o => o.text), ['부록으로 옮길까'])
  assert.throws(() => addQuestion(root, { text: '' }), /--text/)
})

test('CLI: snapshot --stable, round-check and questions print one JSON object', () => {
  const root = workspace()
  const run = (...a) => JSON.parse(spawnSync(process.execPath, [MANAGE, ...a], { cwd: root, encoding: 'utf8' }).stdout)
  assert.match(run('snapshot', '--stable', '--note', '기준', '--date', '2026-04-01').stable, /^stable\/2026-04-01-skeleton-v3\.1\.0$/)
  assert.equal(run('questions', '--add', '--text', '묻는다', '--page', '2').added, true)
  assert.equal(run('questions', '--read').open.length, 1)
  assert.match(run('round-check', '--round', '1').error, /does not exist/)
})

test('readMaterial: ledger grades are A, B, C; X_ and other letters are never items', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-grades-'))
  const p = join(root, 'sources', '01_가상결제')
  mkdirSync(p, { recursive: true })
  for (const f of ['A1_정산.md', 'B2_재시도.md', 'C3_각주.md', 'D1_기타.md', 'X_쓰지않을것.md']) writeFileSync(join(p, f), '처리 30% 단축\n')
  const ids = [...readMaterial(root).keys()].sort()
  assert.deepEqual(ids, ['01_가상결제/A1', '01_가상결제/B2', '01_가상결제/C3'])
  rmSync(root, { recursive: true, force: true })
})
