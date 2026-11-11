// pattern-score.mjs — two versions of a skeleton or deck.mdx counted on one fixed key set.
//   node pattern-score.mjs <a> <b> [--out <dir>]
// stdout: one JSON object { basis_version, keys, basis, a: {file, scope, scores}, b: {...}, delta }.
// --out writes <dir>/pattern-a.json, <dir>/pattern-b.json (flat `{ "<key>": <number> }`, the shape
// manage's `compare --before/--after` reads) and <dir>/pattern-basis.json (the counting basis).
// Counting basis: references/counting-basis.md. Both files change together, and BASIS_VERSION moves with them.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BASIS_VERSION = 1
// every score is a share in 0-100 and higher reads better, so manage's `compare` (a drop = worse) is right
export const KEYS = ['decision_verb_pct', 'active_pct', 'own_subject_pct', 'specific_pct',
  'number_density_pct', 'failure_pct', 'decision_marks_pct']

export const BASIS = {
  sentence: '본문 줄을 . ! ? 와 줄바꿈으로 자른 조각, 공백 제외 4자 이상',
  decision_verb: /제안|채택|배제|결정했|판단했|선택했|도입하기로/,
  passive: /되었|되어|됐|되었고|되었습니다/,
  vague_participation: /관여|참여|기여/,
  team_subject: /저희 팀|우리 팀|팀에서|팀이/,
  impact_claim: /개선|감소|향상|단축|증가|절감|안정|처리|성능|확대|줄였|높였/,
  figure: /\d/,
  failure_mark: /실패|장애|오류|롤백|잘못|한계|아쉬|부족|되돌/,
  decision_mark: /대신|대안|비교|트레이드오프|이유는|선택한 이유/,
  out_of_scope: '`notes:`, `각주:`, `주:`, `footnote:`, `[^n]:` 줄과 그 들여쓴 이어짐 · 제목 · `>` 이력 · 표 · `글감:`/`근거:` · 그림 경로 · `!drop`',
  pct: '정수 반올림 %, 분모 0이면 0. 점수는 모두 0-100이고 높을수록 좋다: active_pct = 100 - 피동 %, own_subject_pct = 100 - 팀 주어 %, specific_pct = 100 - 모호 참여 %',
}

const SLOT_OUT = /^(notes|footnote|footnotes|각주|주)\s*:/i
const FOOT_DEF = /^\[\^[^\]]+\]\s*:/
const META = /^(글감|근거)\s*[:：]/
const PIC = /\.(png|jpe?g|svg|gif)(\s*\|.*)?$/i

// body lines of the pages only; notes and footnote slots never reach the counter
export function bodyLines(text) {
  const t = text.replace(/^---\n[\s\S]*?\n---\n/, '')
  const deck = /^##\s+@s\d+/m.test(t)
  const out = []
  let on = false
  let skipIndent = false
  let skipOut = false
  for (const raw of t.split('\n')) {
    if (/^```/.test(raw)) { skipIndent = !skipIndent; continue }
    if (skipIndent) continue
    if (/^##\s+/.test(raw)) { on = deck ? /^##\s+@s\d+/.test(raw) : /^##\s+\d+/.test(raw); skipOut = false; continue }
    if (/^#\s/.test(raw) || !on) continue
    const l = raw.trim()
    if (!l) { continue }
    if (skipOut && /^\s/.test(raw)) continue
    skipOut = false
    if (SLOT_OUT.test(l) || FOOT_DEF.test(l)) { skipOut = true; continue }
    if (l.startsWith('>') || l.startsWith('|') || META.test(l) || l === '!drop') continue
    const kv = l.match(/^([A-Za-z_]\w*):\s*(.*)$/)
    if (kv) {
      if (PIC.test(kv[2]) || /^!drop$/.test(kv[2])) continue
      if (kv[2]) out.push(kv[2])
      continue
    }
    out.push(l.replace(/^[-*]\s+/, ''))
  }
  return out
}
export function sentences(lines) {
  return lines.flatMap(l => l.split(/[.!?。]\s*/)).map(s => s.trim()).filter(s => s.replace(/\s/g, '').length >= 4)
}

// raw tallies behind the scores, reported beside them
export function counts(text) {
  const ss = sentences(bodyLines(text))
  const n = re => ss.filter(s => re.test(s)).length
  const impact = ss.filter(s => BASIS.impact_claim.test(s))
  return {
    sentences: ss.length,
    decision_verb: n(BASIS.decision_verb),
    passive: n(BASIS.passive),
    team_subject: n(BASIS.team_subject),
    vague_participation: n(BASIS.vague_participation),
    impact_claims: impact.length,
    impact_with_number: impact.filter(s => BASIS.figure.test(s)).length,
    failure_marks: n(BASIS.failure_mark),
    decision_marks: n(BASIS.decision_mark),
  }
}

export function score(text) {
  const c = counts(text)
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0)
  const rest = (a, b) => (b ? 100 - pct(a, b) : 0)
  return {
    decision_verb_pct: pct(c.decision_verb, c.sentences),
    active_pct: rest(c.passive, c.sentences),
    own_subject_pct: rest(c.team_subject, c.sentences),
    specific_pct: rest(c.vague_participation, c.sentences),
    number_density_pct: pct(c.impact_with_number, c.impact_claims),
    failure_pct: pct(c.failure_marks, c.sentences),
    decision_marks_pct: pct(c.decision_marks, c.sentences),
  }
}

export function basisJson() {
  const o = { basis_version: BASIS_VERSION, keys: KEYS }
  for (const [k, v] of Object.entries(BASIS)) o[k] = v instanceof RegExp ? v.source : v
  return o
}

export function compareVersions(aText, bText, aName = 'a', bName = 'b') {
  const a = score(aText), b = score(bText)
  const delta = Object.fromEntries(KEYS.map(k => [k, b[k] - a[k]]))
  return {
    basis_version: BASIS_VERSION, keys: KEYS, basis: basisJson(),
    a: { file: aName, scope: 'pages', scores: a, counts: counts(aText) },
    b: { file: bName, scope: 'pages', scores: b, counts: counts(bText) }, delta,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const oi = args.indexOf('--out')
  const out = oi >= 0 ? args.splice(oi, 2)[1] : null
  if (args.length !== 2) { console.error('usage: pattern-score.mjs <a> <b> [--out <dir>]'); process.exit(2) }
  const res = compareVersions(readFileSync(args[0], 'utf8'), readFileSync(args[1], 'utf8'), basename(args[0]), basename(args[1]))
  if (out) {
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'pattern-a.json'), JSON.stringify(res.a.scores, null, 2) + '\n')
    writeFileSync(join(out, 'pattern-b.json'), JSON.stringify(res.b.scores, null, 2) + '\n')
    writeFileSync(join(out, 'pattern-basis.json'), JSON.stringify(res.basis, null, 2) + '\n')
  }
  console.log(JSON.stringify(res, null, 2))
}
