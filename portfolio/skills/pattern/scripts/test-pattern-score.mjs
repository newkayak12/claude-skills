import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { KEYS, bodyLines, counts, score, compareVersions } from './pattern-score.mjs'

const SKEL = `# 가상 포트폴리오
## 구성
이 구간은 쪽이 아니라 세지 않는다.

## 1쪽 · 문제
검색 응답이 느렸습니다. 원인을 비교해 캐시를 선택했습니다.
각주: 이 각주는 되었습니다 성능 개선 90%
  각주 이어짐 팀에서 관여했습니다
notes: 말로 할 것, 되었습니다
> v1.0.0 이력: 되었습니다
글감: a/A1
| 표 | 되었습니다 |

## 2쪽 · 결과
응답 시간 40% 감소. 안정적인 서비스 운영 개선.
`

const DECK = `---
template: t.pptx
---

## @s1 1쪽
title: 검색이 느렸다
text1:
  - 응답 시간 820ms 감소
  - 성능 개선 되었습니다
pic1: assets/a.svg
notes: 말로 99% 개선 되었습니다
footnote: 각주 되었습니다 성능 개선
`

test('notes, footnotes, history, tables and heads are out of scope', () => {
  const l = bodyLines(SKEL).join('\n')
  assert.ok(!/구간은|각주|notes|이력|표/.test(l), l)
  assert.ok(/원인을 비교해/.test(l))
})

test('deck: notes, footnote, picture slots excluded', () => {
  const l = bodyLines(DECK).join('\n')
  assert.ok(!/99%|각주|svg/.test(l), l)
  assert.ok(/820ms/.test(l))
})

test('counts on a fixed key set', () => {
  const s = score(SKEL), c = counts(SKEL)
  assert.deepEqual(Object.keys(s), KEYS)
  assert.deepEqual([c.sentences, c.decision_verb, c.decision_marks, c.passive, c.impact_claims, c.impact_with_number], [4, 1, 1, 0, 2, 1])
  assert.deepEqual(s, { decision_verb_pct: 25, active_pct: 100, own_subject_pct: 100, specific_pct: 100,
    number_density_pct: 50, failure_pct: 0, decision_marks_pct: 25 })
})

test('a version with nothing to count still has every key', () => {
  const s = score('# 빈 것\n')
  assert.deepEqual(Object.keys(s), KEYS)
  assert.ok(Object.values(s).every(v => v === 0))
})

test('compareVersions: same keys, delta, basis carried', () => {
  const r = compareVersions(SKEL, DECK, 'a.md', 'b.mdx')
  assert.deepEqual(r.keys, KEYS)
  assert.deepEqual(Object.keys(r.a.scores), Object.keys(r.b.scores))
  assert.equal(r.delta.active_pct, r.b.scores.active_pct - r.a.scores.active_pct)
  assert.ok(r.b.counts.passive >= 1)
  assert.equal(r.basis.basis_version, 1)
})

test('cli: json on stdout, flat score files and basis written, two runs identical', () => {
  const d = mkdtempSync(join(tmpdir(), 'pscore-'))
  try {
    writeFileSync(join(d, 'a.md'), SKEL)
    writeFileSync(join(d, 'b.mdx'), DECK)
    const bin = join(dirname(fileURLToPath(import.meta.url)), 'pattern-score.mjs')
    const run = () => spawnSync('node', [bin, join(d, 'a.md'), join(d, 'b.mdx'), '--out', join(d, 'o')], { encoding: 'utf8' })
    const one = run(), two = run()
    assert.equal(one.status, 0)
    assert.equal(one.stdout, two.stdout)
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(d, 'o', 'pattern-a.json'), 'utf8'))), KEYS)
    assert.equal(JSON.parse(readFileSync(join(d, 'o', 'pattern-basis.json'), 'utf8')).basis_version, 1)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
