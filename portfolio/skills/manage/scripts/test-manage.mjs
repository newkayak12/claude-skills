import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { bump, claims, compare, deckPages, headings, keepRender, layout, parseMap, readMaterial, renumber, scaffold, selection, settled, snapshot, verify } from './manage.mjs'

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
  writeFileSync(join(root, 'skeleton.md'), SKEL)
  const r = snapshot(root, { kind: 'skeleton', level: 'minor', note: '검색 블록 두 장 순서 교환', date: '2026-01-02' })
  assert.equal(r.from, 'v4.0.0')
  assert.equal(r.to, 'v4.1.0')
  assert.equal(readFileSync(join(root, 'snapshot/skeleton/skeleton-v4.0.0/skeleton.md'), 'utf8'), SKEL)
  const now = readFileSync(join(root, 'skeleton.md'), 'utf8')
  assert.match(now, /version: v4\.1\.0\nv4\.1\.0 변경\(2026-01-02, 본인 결정\): 검색 블록 두 장 순서 교환\n\n## 1 표지/)
  assert.match(readFileSync(join(root, 'snapshot/README.md'), 'utf8'), /\| v4\.0\.0 \| 2026-01-02 \| 5 \| → v4\.1\.0: 검색 블록/)
  // the next snapshot is of v4.1.0; the same version cannot be taken twice
  writeFileSync(join(root, 'skeleton.md'), SKEL)
  assert.throws(() => snapshot(root, { kind: 'skeleton', level: 'patch', note: 'x' }), /already taken/)
})

test('the first deck snapshot is deck-v1.0.0 and leaves skeleton alone', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-'))
  writeFileSync(join(root, 'skeleton.md'), SKEL)
  writeFileSync(join(root, 'deck.mdx'), '---\noutput: build/deck.pptx\n---\n')
  const r = snapshot(root, { kind: 'deck', level: 'patch', note: 'x' })
  assert.equal(r.to, 'v1.0.0')
  assert.ok(existsSync(join(root, 'snapshot/deck/deck-v1.0.0/deck.mdx')))
  assert.equal(readFileSync(join(root, 'skeleton.md'), 'utf8'), SKEL)
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

test('layout finds the template where deck.mdx says', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-'))
  mkdirSync(join(root, 'template'))
  writeFileSync(join(root, 'template/template.pptx'), '')
  writeFileSync(join(root, 'deck.mdx'), '---\ntemplate: template/template.pptx\noutput: build/deck.pptx\n---\n')
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
  snapshot(root, { kind: 'skeleton', level: 'patch', note: '검증', date: '2026-01-03' })
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
const workspace = () => { const root = mkdtempSync(join(tmpdir(), 'manage-ws-')); cpSync(WORKSPACE, root, { recursive: true }); return root }

test('real-shape workspace: layout finds every part, verify finds no problem', () => {
  assert.deepEqual(layout(WORKSPACE).missing, [])
  assert.deepEqual(verify(readFileSync(join(WORKSPACE, 'skeleton.md'), 'utf8')).problems, [])
})

test('real-shape workspace: a block swap keeps the appendix table, align table and history right', () => {
  const r = renumber(readFileSync(join(WORKSPACE, 'skeleton.md'), 'utf8'), parseMap('2:4,3:5,4:2,5:3'))
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
  assert.match(readFileSync(join(root, 'skeleton.md'), 'utf8'), /^version: v3\.1\.1\n> v3\.1\.1\(2026-01-06, 본인 결정\): 부록 제목 정리\n> v3\.1\.0/m)
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
  assert.match(readFileSync(join(root, 'skeleton.md'), 'utf8'), /^version: v3\.1\.0$/m)
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
  assert.deepEqual(r.created, ['sources/선정.md', 'template/분석.md', 'snapshot/render', 'snapshot/feedback'])
  const analysis = readFileSync(join(root, 'template/분석.md'), 'utf8')
  assert.match(analysis, /## Palette\n\n- 10243F\n\n## Type\n\n- 본문 18pt\n\n## Voice\n\n- 했다 60%\n\n## 스타일 규칙/)
  assert.ok(!analysis.includes('@s1'))
  writeFileSync(join(root, 'sources/선정.md'), '내 표')
  assert.deepEqual(scaffold(root).created, [])
  assert.equal(readFileSync(join(root, 'sources/선정.md'), 'utf8'), '내 표')
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
  assert.equal(readFileSync(r.review, 'utf8'), '# 렌더 검토 · deck-v1.2.0\n\n| 쪽 | 본 것 | 문제 | 다음렌더-지침 |\n|---|---|---|---|\n| 1 | | | |\n| 2 | | | |\n| 3 | | | |\n')
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

test('claims reads a ledger workspace: a figure on a ledger line, `근거 없음` on that line', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-ledger-'))
  mkdirSync(join(root, 'sources/01_가상검색'), { recursive: true })
  writeFileSync(join(root, 'sources/01_가상검색/A1_검색개편.md'), '# A1 검색 개편\n\n- 결과: 응답 50% 단축 (측정 문서)\n- 비용: 30% 절감 근거 없음\n')
  const r = claims('## 1 검색\n글감: 01_가상검색/A1\n응답이 50% 줄었다.\n비용이 30% 줄었다.\n', readMaterial(root))
  assert.deepEqual(r.problems.map(p => p.kind), ['unsupported'])
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
