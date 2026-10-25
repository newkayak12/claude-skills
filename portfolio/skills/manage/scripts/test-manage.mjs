import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bump, layout, parseMap, renumber, snapshot, verify } from './manage.mjs'

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

test('deck snapshot copies deck.mdx without bumping', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-'))
  writeFileSync(join(root, 'skeleton.md'), SKEL)
  writeFileSync(join(root, 'deck.mdx'), '---\noutput: build/deck.pptx\n---\n')
  const r = snapshot(root, { kind: 'deck', level: 'patch', note: 'x' })
  assert.equal(r.bumped, false)
  assert.ok(existsSync(join(root, 'snapshot/deck/deck-v4.0.0/deck.mdx')))
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
