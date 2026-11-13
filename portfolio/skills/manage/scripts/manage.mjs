#!/usr/bin/env node
// portfolio:manage engine. Run from the workspace root; every subcommand prints one JSON object.
//   layout                         which workspace paths exist / are missing; touches nothing
//   layout also lists `legacy` [{from, to}]: template files still under their old Korean names
//   scaffold                       creates what the eight-step flow needs and the workspace lacks:
//       sources/선정.md, template/analysis.md (catalog's Palette/Type/Voice), template/next-render.md,
//       snapshot/render/, feedback/; first renames template/분석.md → analysis.md and
//       template/다음렌더-지침.md → next-render.md (NFC or NFD), printed as `renamed`
//   sync [--write]                 portfolio-skeleton.md slots (`key: value` under a `## … @sN` heading) against
//       portfolio-deck.mdx: { missing, different, slide_missing }; written only with --write (a slide is never created)
//   verify-build                   each skeleton slot's text is in build/deck.pptx; `[x]{sup}` marks and picture files exist
//   layout also lists `optional` (feedback, decisions, style, stable, scripts: present | absent) and `warnings`
//       for a stray deck.*.mdx in the root; snapshot --kind resume keeps snapshot/resume/resume-vX.Y.Z
//   selection                      sources/선정.md rows (글감 · 쓰임 본문|부록|제외 · 쪽 · 이유 · 대표)
//   keep-render --version vX.Y.Z   build/pages/*.png → snapshot/render/deck-vX.Y.Z/pages/ + 검토.md
//   snapshot --kind skeleton|deck --level major|minor|patch --note <text> [--by <who>] [--date YYYY-MM-DD]
//       skeleton: copies it to snapshot/skeleton/skeleton-v<cur>/, bumps `version:`, adds the history
//       line under it (`(date, <by> 결정)` with --by, `(date)` without: it never names a decider not given) and one row to snapshot/README.md; deck: its own count (newest deck-v* + level),
//       deck.mdx + assets/ + NOTES.md into snapshot/deck/deck-v<new>/, one row in the `## deck` table
//   renumber --map "3:4,4:3" [--file skeleton.md] [--dry-run] [--force]
//       (written only when verify finds no problem, or with --force; fenced code is left alone;
//       a target page the map leaves in place is refused)
//       one pass over headings `## N`, `N쪽`, `N·M쪽`, `N~M쪽` and every `쪽` table column, then moves
//       the page sections into the new order and verifies; history lines (`vX.Y.Z 변경`, `vX.Y.Z(`,
//       and the same quoted with `>`) are left as written
//   verify [--file skeleton.md]    heading numbers ascending; every page reference points at a heading
//   compare --before <scores.json> --after <scores.json>
//       per-item change between two `{ "<item>": <score> }` files scored with the same rubric;
//       names every item that dropped and the verdict (better | worse | mixed | same);
//       with --claims-before/--claims-after (two `claims` outputs) a claim that lost its ground makes it worse
//   claims [--file skeleton.md | --file deck.mdx]   (deck.mdx: one page per `## @sN`, cites in its comment)
//       each page's figures and reason sentences against the material its `글감:` line cites:
//       problems (uncited, unknown_id, not_in_material, unsupported = `근거 없음`, to_confirm = a reason
//       the items do not say; a leading slot label such as `해결:` is not a reason), listed (본인 확인,
//       user-stated, tone phrases, confirmed = a figure only a 확정사실.md line states), unused_results (figures
//       in cited items no page carries), uncited_items, settled (확정사실.md `## 서술 기준`/`## 구조` lines),
//       settled_note when 확정사실.md has neither section (settle prints it too). Ledger items: any grade (A1, B2, C3)
//   settle --findings <file>       feedback findings against 확정사실.md: <file> is a JSON array of {id, text}
//       inside the workspace; {kept, settled}: a finding is settled ({finding, line, share}) when it shares
//       >= 3 word stems with a `## 서술 기준`/`## 구조` line of >= 3 stems and >= half of that line's stems;
//       `## 정정` lines are never matched; no 확정사실.md → all kept
//   round --input <file | ->       records one round of the collect → build loop as snapshot/rounds/round-N.json
//       (the schema's one owner; SKILL.md cites this block). <file> is a path inside the workspace, `-` is stdin.
//       input  { round: N>=1, n: >=1 (round <= n), steps: [{ step: 1-7, criteria: non-empty, verdict: pass|fail|skipped,
//                by: actor | judge | command name, reason?, id?: criterion id (no slash, no whitespace; the same
//                id every round for the same criterion) }] (exactly seven entries, steps 1-7 once each),
//                feedback?: [{ id, text }] (the kept findings after settle), feedback_mode: panel | single-context
//                (required when feedback is non-empty, how `feedback` ran; null or absent otherwise),
//                blocked?: reason }  (steps[].answered_by?: user | noah | proposal, steps 2-4 only: who settled the
//                user-wait; `waiting_user` is refused: a user-wait never ends a round)
//       refused before anything is written: empty criteria or `by`, steps other than 1-7 once each, round > n, an
//       existing round-N.json (never overwritten), N>1 with no round-(N-1).json, a round-(N-1).json that is not a
//       record (object with round N-1, integer n, steps array, gate.gaps array of strings, feedback { mode, ids }
//       or the legacy array of {id}), and an n different from round-(N-1).json's (n is fixed across one loop)
//       the caller never supplies a derived field; node computes them from round-(N-1).json and the workspace:
//       record { round, n, started_from: { gaps, feedback }  (round N-1's gate.gaps and feedback ids; empty in
//                round 1),
//                steps (as given, criteria trimmed),
//                gate: { verdict: { "<step>": fail > skipped > pass },
//                        gaps: ["s<step>/<id>"] (or s<step>/<criteria, whitespace collapsed> when no id) for every
//                        fail or skipped step, deduplicated; skipped is never pass,
//                        diff: { resolved: in N-1 not now, carried: in both, new: now only },
//                        clauses: { no_new_gap, no_new_feedback, no_file_changed } | null },
//                changed: workspace files (sorted, relative) added, removed or with other bytes (sha256) than in
//                         snapshot/rounds/end-(N-1).json, the manifest written when round N-1 was recorded; a touch
//                         is not a change; leaves out snapshot/rounds/ and the --input file; [] in round 1 (a
//                         round N-1 recorded before end manifests existed falls back to mtime),
//                stop_reason, continue, feedback: { mode: panel | single-context | null, ids: [finding ids in
//                input order] } (round N-1 written as the legacy [{ id, text }] array is read the same),
//                blocked? }
//       clauses are evaluated only from round 2 on (null in round 1):
//       no_new_gap = diff.new is empty; no_new_feedback = every feedback id was already in N-1; no_file_changed =
//       changed is empty. nothing_new fires when ANY ONE of the three holds; the gate records each.
//       stop_reason, first match wins: blocked > nothing_new > n_reached (round >= n) > null; continue is true only for null
//       also writes snapshot/rounds/end-N.json ({ path: sha256 } of the workspace as the round left it)
//       prints { round, rounds: count of round-*.json, stop_reason, continue, gaps }
//   intake --feedback <file> [--round N]   the findings one portfolio:feedback output gives the round, parsed in node:
//       ids from the 개선 우선순위 items' `근거: <ID>` and (panel mode) the Clashes entries marked survived, text from
//       the appendix line starting with the ID; id is `<ID>#<sha256(text)[0:8]>` (IDs restart every run, the hash
//       keeps a reworded finding new). A dropped clash is not consumed; a priority citing no ID is in not_consumed.
//       mode: single-context when the Clashes block says 패널 미실행 or is absent, else panel. With --round N also
//       writes snapshot/rounds/findings-N.json (the `settle --findings` input). Prints { mode, findings, not_consumed, written? }.
//   step --input -                 records one step entry as it happens into snapshot/rounds/steps-N.json, stamped with
//       the engine's time: { round, step, criteria, id? } (criteria phase) then { round, step, verdict, by, reason?, answered_by? }
//       (verdict phase). Refused: a verdict before its criteria or twice, criteria for step s+1 before step s's
//       verdict, a step out of 1-7 order, a round already recorded. Prints { round, steps, next: { step, needs } | null }.
//       `round` with no `steps` in its input reads steps-N.json (seven verdicts required) and records gate.order
//       'recorded' with each step's criteria_at and verdict_at; steps given in the input record gate.order 'caller'.
//   round --read                   the read form: { rounds, last: { round, stop_reason, continue } | null, items: [one per
//       round-N.json in round order: { round, n, verdict, gaps, diff, clauses, changed, stop_reason, continue,
//       feedback, answered?: { "<step>": answered_by }, waiting_user? (older records), blocked? }] }, from the files alone; writes nothing
//   round also writes the round's record folder snapshot/rounds/round-NN/ (never overwriting a file): the
//       skeleton of that round, feedback.md (previous vs this version), feedback-before/after.json,
//       pattern-a/b.json, compare.json, noah.md (the user-proxy verdict, written apart every round),
//       overrides.md and report.md (every edit carries source, evidence file and reason). Files that
//       already exist beside the record (rounds/feedback-N.md) are copied in; the rest are templates.
//   round-check --round N          the record folder read back: `unfilled` files still templates, and `problems`:
//       a report edit row with no source/evidence/reason, a rejected finding with no reason, an empty
//       section or verification line, noah.md with no 판정
//   snapshot --stable [--note <text>] [--date YYYY-MM-DD]
//       freezes skeleton + deck source + resume sources + style/ into stable/<date>-skeleton-v<ver>/ (files
//       read-only, never overwritten) and appends a row (date, versions, note) to stable/README.md
//   questions --add --text <q> [--page N] [--date D]   appends `- [ ] D · N쪽 · q` to docs/확인할-것.md
//   questions --read               { open, answered }: answered ones are lines `- [x] … → 답: …`
//   layout also lists `known` (style files, consensus, decisions, stable, docs/확인할-것.md), `safe_area` from
//       style/레이아웃.md, and warns on a broken analysis/ link and on CLAUDE.md/style/*.md naming an engine
//       path (`…/skills/<skill>/scripts/<file>`) that does not exist
// A page heading is `## N`, `## N.`, `## N)` or `## N쪽`. A `# ` chapter heading bounds a block: pages
// sort inside their block, and blocks holding pages sort by their first page; other sections stay put.
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

// Containment on real paths: a symlink inside the workspace that points out is outside. A path that does
// not exist yet resolves through its nearest existing ancestor; a dangling symlink counts as outside.
function realPath(p) {
  const rest = []
  let cur = resolve(p)
  for (;;) {
    try { return join(realpathSync(cur), ...rest.reverse()) } catch {
      let link = false
      try { link = lstatSync(cur).isSymbolicLink() } catch { /* not there */ }
      const up = dirname(cur)
      if (link || up === cur) return null
      rest.push(basename(cur))
      cur = up
    }
  }
}
function insideRoot(root, p) {
  const base = realPath(root)
  const real = realPath(p)
  if (base === null || real === null) return false
  const rel = relative(base, real)
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
function assertInside(root, p) {
  if (!insideRoot(root, p)) throw new Error(`${relative(root, resolve(p))} must be a path inside the workspace root ${root}`)
}

// A Korean name synced or copied from macOS (iCloud, zip, rsync) is stored decomposed (NFD) and Linux
// matches names byte for byte: every workspace path is looked up in both forms, NFC first. The NFC
// path is returned when neither exists, so a new file is written composed.
export function at(base, ...parts) {
  const rel = join(...parts)
  for (const form of ['NFC', 'NFD']) {
    const p = join(base, rel.normalize(form))
    if (existsSync(p)) return p
  }
  return join(base, rel.normalize('NFC'))
}

// Workspace names, prefixed by what they build (portfolio-*, resume-*) and in English for the template
// folder's working files. A workspace started before 2.14 has the old names: every command reads
// either, layout reports the old ones as `legacy`, and `scaffold` renames them.
export const SKELETON = 'portfolio-skeleton.md'      // the design; every wording change starts here
export const DECK = 'portfolio-deck.mdx'             // build source carried over from the skeleton
export const ANALYSIS = 'template/analysis.md'       // step 5: Palette, Type, Voice, style rules, figure colours
export const NEXT_RENDER = 'template/next-render.md' // step 7: render problems held for the next render
export const RESUME_DECK = 'resume-deck.mdx'        // step 9's build source, designed in resume-skeleton.md
export const LEGACY_NAMES = { [SKELETON]: 'skeleton.md', [DECK]: 'deck.mdx', [RESUME_DECK]: 'resume.md', 'CLAUDE.md': 'README.md',
  [ANALYSIS]: 'template/분석.md', [NEXT_RENDER]: 'template/다음렌더-지침.md' }
function legacyFound(root) {
  return Object.entries(LEGACY_NAMES).filter(([now, old]) => !existsSync(join(root, now)) && existsSync(at(root, old)))
}
// The file under its current name, else under its old one, else the current name (to be created).
export function wsFile(root, rel) {
  const now = join(root, rel)
  if (existsSync(now) || !LEGACY_NAMES[rel]) return now
  const old = at(root, LEGACY_NAMES[rel])
  return existsSync(old) ? old : now
}

const LAYOUT = ['CLAUDE.md', SKELETON, DECK, 'template.pptx', 'deck.catalog.md', 'build', 'snapshot', 'sources', 'docs/확정사실.md',
  'sources/선정.md', ANALYSIS, NEXT_RENDER]

const OPTIONAL = ['feedback', 'decisions', 'style', 'consensus', 'stable', 'scripts', 'docs/확인할-것.md']
const STYLE_FILES = ['문체.md', '표기규칙.md', '레이아웃.md', '이력서-서식.md']
const QUESTIONS = 'docs/확인할-것.md'
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

// `…/skills/<skill>/scripts/<file>` named in the workspace guide or a style file. A literal path (/…, ~/…)
// must exist; a variable or placeholder prefix (`${CLAUDE_PLUGIN_ROOT}/`, `<portfolio 플러그인>/`) is read
// against this plugin, when the skill is one of its own.
export function enginePathWarnings(root) {
  const files = ['CLAUDE.md', ...STYLE_FILES.map(f => `style/${f}`)]
  const out = []
  for (const rel of files) {
    let text = ''
    try { text = readFileSync(at(root, rel), 'utf8') } catch { continue }
    // `=` ends the prefix too: `R=~/.claude/…/resume.py` names the path after the assignment
    for (const m of text.matchAll(/([^\s`'"()<>|,=]*)(skills\/([\w-]+)\/scripts\/[\w.-]+)/g)) {
      const tail = m[2].replace(/\.+$/, '')
      const prefix = m[1]
      const named = `${prefix}${tail}`
      if (/\/plugins\/cache\/[^/]+\/[^/]+\/\d+\.\d+\.\d+\//.test(prefix)) {
        out.push(`${rel}: names ${named}, a version-pinned plugin cache path that goes stale on update; write the command without an install path`)
      } else if (/^[/~]/.test(prefix)) {
        if (!existsSync(prefix.startsWith('~') ? join(homedir(), named.slice(1)) : named)) out.push(`${rel}: names ${named}, which does not exist on disk; write the command without an install path`)
      } else if (existsSync(join(PLUGIN_ROOT, 'skills', m[3])) && !existsSync(join(PLUGIN_ROOT, tail))) {
        out.push(`${rel}: names ${named}, but the ${m[3]} skill has no ${tail.split('/').slice(2).join('/')}`)
      }
    }
  }
  return out
}

// style/레이아웃.md `- top: 36` lines (pt) → { top, bottom, left, right }, only when all four are numbers.
export function safeArea(root) {
  let text = ''
  try { text = readFileSync(at(root, 'style', '레이아웃.md'), 'utf8') } catch { return null }
  const v = {}
  for (const k of ['top', 'bottom', 'left', 'right']) {
    const m = text.match(new RegExp(`^\\s*-\\s*${k}\\s*:\\s*(\\d+(?:\\.\\d+)?)\\s*(?:pt)?\\s*$`, 'm'))
    if (m) v[k] = Number(m[1])
  }
  return Object.keys(v).length === 4 ? v : null
}

const listMd = d => { try { return readdirSync(d).filter(f => /\.md$/.test(f)).map(f => f.normalize('NFC')).sort() } catch { return [] } }
const listDirs = d => { try { return readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort() } catch { return [] } }

// The template is where deck.mdx's front matter `template:` says, else the root template.pptx.
export function layout(root) {
  let template = 'template.pptx'
  try {
    const m = readFileSync(wsFile(root, DECK), 'utf8').match(/^template:[ \t]*["']?([^"'\n]+?)["']?[ \t]*$/m)
    if (m) template = m[1]
  } catch { /* no deck source: it is listed missing */ }
  const paths = LAYOUT.map(p => (p === 'template.pptx' ? template : p))
  // a file under its old name is present (and listed in `legacy` below)
  const has = p => existsSync(at(root, p)) || (LEGACY_NAMES[p] !== undefined && existsSync(at(root, LEGACY_NAMES[p])))
  const out = { present: paths.filter(has), missing: paths.filter(p => !has(p)) }
  const legacy = legacyFound(root).map(([to, from]) => ({ from, to }))
  if (legacy.length) out.legacy = legacy   // old names: `scaffold` renames them
  // known folders a workspace may or may not keep: present or absent, never missing
  out.optional = { present: OPTIONAL.filter(has), absent: OPTIONAL.filter(p => !has(p)) }
  // a sync-conflict copy of a deck source in the root (`deck.conflict-….mdx`): named, left for the user
  let stray = []
  try { stray = readdirSync(root).filter(f => /^(portfolio-|resume-)?deck\..+\.mdx$/.test(f.normalize('NFC'))).sort() } catch { /* unreadable root */ }
  const warnings = stray.map(f => `${f}: a conflict copy of a deck source in the root; compare it with the real one, then move it to _archive/`)
  // analysis/ is the link to the user's raw archive outside the workspace: read-only, and a broken link is said
  try {
    if (lstatSync(join(root, 'analysis')).isSymbolicLink()) {
      const target = readlinkSync(join(root, 'analysis'))
      const ok = existsSync(join(root, 'analysis'))
      out.analysis = { link: target, ok }
      if (!ok) warnings.push(`analysis/: a broken link to ${target}; the archive is not reachable, re-link it (read-only, never copy it into the workspace)`)
    }
  } catch { /* no analysis/ */ }
  warnings.push(...enginePathWarnings(root))
  if (warnings.length) out.warnings = warnings
  const styleDir = at(root, 'style')
  out.known = {
    style: STYLE_FILES.filter(f => existsSync(join(styleDir, f.normalize('NFC'))) || existsSync(join(styleDir, f.normalize('NFD')))),
    consensus: listMd(at(root, 'consensus')), decisions: listMd(at(root, 'decisions')),
    stable: listDirs(at(root, 'stable')),
  }
  const sa = safeArea(root)
  if (sa) out.safe_area = sa
  return out
}

// The parts of the eight-step flow a workspace may still lack, created empty and never overwritten:
// step 2's selection table, step 5's template analysis (catalog's Palette, Type and Voice copied in),
// and the folders steps 7 and 8 keep per deck version.
const SELECTION_HEAD = '# 선정\n\n| 글감 | 쓰임 | 쪽 | 이유 | 대표 |\n|---|---|---|---|---|\n'
const NEXT_RENDER_HEAD = ['# next-render', '',
  '미리보기나 PowerPoint에서 발견한 문제를 모아 두는 곳. 다음 빌드 전에 모두 반영하고, 반영한 줄의 마지막 칸에 반영일과 덱 버전을 쓴다.', '',
  '| 쪽 | 칸 | 증상 | 확인 | 적용 |', '|---|---|---|---|---|', ''].join('\n')
// style/: the user's fixed rules, empty templates with their headings. Read before any sentence is written
// (voice, notation), by deck-builder (layout) and by resume-builder (resume format).
const STYLE_TEMPLATES = {
  '문체.md': ['# 문체', '', '## 규칙', '', '- ', '', '## 내 문단', '',
    '내가 직접 쓴 글만 붙인다. AI가 고치거나 쓴 글은 넣지 않는다. 문단마다 어디서 가져왔는지 한 줄.', '', '- ', ''].join('\n'),
  '표기규칙.md': ['# 표기규칙', '', '## 띄어쓰기와 문장부호', '', '- ', '', '## 각주', '',
    '- 각주는 번호 표시로 쓴다: 본문 `[1]{sup}`, 같은 쪽 아래에 같은 번호의 풀이. 번호는 쪽마다 1부터.', '', '## 캡션', '', '- ', ''].join('\n'),
  '레이아웃.md': ['# 레이아웃', '', '## 안전 영역 (pt)', '',
    '덱의 어떤 글, 그림, 사진도 이 여백을 넘지 않는다. 숫자만 쓴다 (deck-builder가 읽는다).', '',
    '- top: ', '- bottom: ', '- left: ', '- right: ', ''].join('\n'),
  '이력서-서식.md': ['# 이력서 서식', '', '## 글자와 간격', '', '| 요소 | 글자 크기 | 줄 간격 | 비고 |', '|---|---|---|---|', '',
    '## 머리글과 사진', '', '- ', '', '## ATS·파서 규칙', '', '- 파서가 먼저 읽는다: 표 안 표, 텍스트 상자, 머리글 바닥글 속 본문을 쓰지 않는다.', '- ', ''].join('\n'),
}
const QUESTIONS_HEAD = ['# 확인할 것', '',
  '한 라운드가 정하지 못한 질문. 한 줄에 하나: `- [ ] 날짜 · N쪽 · 질문`. 답은 같은 줄 끝에 ` → 답: …`을 붙이고 `[x]`로 바꾼다.', '', ''].join('\n')

// CLAUDE.md, which every Claude Code session opened in the workspace loads: the names and the first
// command, so a session that was told nothing still keeps the workspace in shape. Written only when
// the workspace has none (never over the user's own).
const WORKSPACE_GUIDE = `# 포트폴리오 작업 공간

이 폴더는 portfolio:manage 작업 공간이다. 지시가 없어도 작업을 시작할 때마다 먼저
\`manage.mjs scaffold\`를 돌린다 (옛 이름을 새 이름으로 바꾸고, 없는 부분만 만들며, 있는 파일은 덮지 않는다).
엔진 경로는 portfolio:manage 스킬이 알려 준다. 플러그인 설치 경로(버전 폴더)는 이 파일과 style/에 적지 않는다.
그다음 \`docs/확정사실.md\`와 \`docs/확인할-것.md\`(답이 달린 것)를 읽는다.

## 기본 원칙

- 안전 영역: 글, 캡션, 사진은 style/레이아웃.md의 여백을 넘지 않고 다른 상자에 닿지 않는다.
- 시인성이 먼저다: 글자 크기와 줄 간격을 줄여 맞추지 않는다. 글을 줄인다.
- 내 말투: 문장은 style/문체.md와 내가 직접 쓴 글(sources/)을 따른다. AI가 고친 글을 표본으로 쓰지 않는다.
- 이력서는 파서가 먼저 읽는다: style/이력서-서식.md의 ATS 규칙이 모양보다 앞선다.
- 산출물(덱, 이력서)에 AI나 도구의 흔적을 남기지 않는다. 빌더(deck-builder, resume-builder)의 마지막 확인으로 잡는다.

## 이름

| 파일 | 담는 것 |
|---|---|
| \`portfolio-skeleton.md\` | 포트폴리오 설계. 문구는 여기서 먼저 고친다 |
| \`portfolio-deck.mdx\` | 포트폴리오 빌드 원본 (출력 build/deck.pptx) |
| \`resume-skeleton.md\` | 이력서 설계. 사실은 portfolio-skeleton.md에서 가져온다 |
| \`resume-deck.mdx\` | 이력서 빌드 원본 (template/resume.docx → build/resume.docx, PDF) |
| \`template/analysis.md\` | 템플릿 분석: Palette · Type · Voice · 스타일 규칙 · 그림 색 |
| \`template/next-render.md\` | 렌더에서 본 문제. 다음 렌더 전에 한꺼번에 적용 |
| \`template/NOTES.md\` | 템플릿 특이사항 |
| \`docs/확정사실.md\` | 확정된 사실, 정정, 서술 기준 |
| \`docs/확인할-것.md\` | 한 라운드가 정하지 못한 질문 (날짜, 쪽). 답이 달리면 \`[x]\`로 읽는다 |
| \`style/문체.md\` | 문체 규칙과 내가 직접 쓴 문단 (AI가 고친 글은 넣지 않는다) |
| \`style/표기규칙.md\` | 띄어쓰기, 각주(번호 표시), 캡션 |
| \`style/레이아웃.md\` | 덱의 안전 영역 여백(pt). deck-builder가 읽는다 |
| \`style/이력서-서식.md\` | 글자·간격 표, 머리글과 사진, ATS·파서 규칙 |
| \`snapshot/rounds/round-NN/\` | 라운드 기록: 그 판의 skeleton, 피드백과 점수, noah 판정, override, report.md(고친 곳마다 이유) |
| \`stable/<날짜>-skeleton-v<버전>/\` | 고정한 기준본(skeleton, 덱·이력서 원본, style). README 표에 한 줄. 고치지 않는다 |
| \`consensus/<날짜>-<주제>.md\` | 토론 기록 원문. 고치지 않는다 |
| \`decisions/NN-<주제>.md\` | 정한 것과 이유 |
| \`analysis/\` | 바깥 원본 보관소로 가는 링크. 읽기만 하고 작업 공간에 복사하지 않는다 |

새 파일은 이 표의 이름을 따른다. 정리는 \`_archive/\`로 옮기고 지우지 않는다. 루트에는 skeleton과
deck(portfolio-*, resume-*)과 이 파일만 둔다.
`
export function scaffold(root) {
  const created = []
  // a file under its old Korean name is renamed, never copied: one file, its content untouched
  const renamed = legacyFound(root).map(([to, from]) => { renameSync(at(root, from), join(root, to)); return { from, to } })
  const make = (rel, body) => {
    const p = at(root, rel)
    if (existsSync(p)) return
    mkdirSync(join(p, '..'), { recursive: true })
    if (body === null) mkdirSync(p, { recursive: true })
    else writeFileSync(p, body)
    created.push(rel)
  }
  make('CLAUDE.md', WORKSPACE_GUIDE)
  // a CLAUDE.md the user already had (or the README renamed into it) keeps every line; the guide is
  // appended below it once, so the next session still reads the names and the scaffold rule
  const appended = []
  const guide = join(root, 'CLAUDE.md')
  if (!created.includes('CLAUDE.md') && !readFileSync(guide, 'utf8').includes('manage.mjs scaffold')) {
    writeFileSync(guide, readFileSync(guide, 'utf8').trimEnd() + '\n\n' + WORKSPACE_GUIDE)
    appended.push('CLAUDE.md')
  }
  make('sources/선정.md', SELECTION_HEAD)
  let catalog = ''
  try { catalog = readFileSync(join(root, 'deck.catalog.md'), 'utf8') } catch { /* no catalog yet */ }
  const section = name => (catalog.match(new RegExp(`^## ${name}\\b[^\\n]*\\n[\\s\\S]*?(?=^## |(?![\\s\\S]))`, 'm')) || [''])[0].trimEnd()
  const fromCatalog = ['Palette', 'Type', 'Voice'].map(section).filter(Boolean)
  make(ANALYSIS, ['# 템플릿 분석', '',
    ...(fromCatalog.length ? fromCatalog.flatMap(s => [s, '']) : ['(deck-builder catalog를 먼저 돌리면 Palette · Type · Voice가 여기 들어온다)', '']),
    '## 스타일 규칙', '', '- 간격 · 정렬 · 강조 방식 (템플릿에서 본 것만)', '',
    '## 그림 색', '', '- 그림(write:diagram)이 쓰는 색: Palette에서 고른다',
    '- 덱과 같은 색 계열 하나로 그린다. 한 가지 색(단색)으로만 칠하지 않는다.',
    '- 가장 중요한 부분이 한눈에 보이게 한다 (강조색은 그 부분에만).', ''].join('\n'))
  // an analysis written before the catalog existed still holds the placeholder line: fill it in place,
  // the rest of the file (style rules the user wrote) untouched
  const filled = []
  const ap = at(root, ANALYSIS)
  if (!created.includes(ANALYSIS) && fromCatalog.length && existsSync(ap)) {
    const text = readFileSync(ap, 'utf8')
    const ph = '(deck-builder catalog를 먼저 돌리면 Palette · Type · Voice가 여기 들어온다)'
    if (text.includes(ph)) { writeFileSync(ap, text.replace(ph, fromCatalog.join('\n\n'))); filled.push(ANALYSIS) }
  }
  make(NEXT_RENDER, NEXT_RENDER_HEAD)
  make('snapshot/render', null)
  make('feedback', null)   // feedback/YYYY-MM-DD.md, one review per day, ending with its fix table
  for (const [name, body] of Object.entries(STYLE_TEMPLATES)) make(`style/${name}`, body)
  make(QUESTIONS, QUESTIONS_HEAD)
  return { created, ...(renamed.length && { renamed }), ...(appended.length && { appended }), ...(filled.length && { filled }) }
}

// sources/선정.md rows: 글감 · 쓰임 (본문 | 부록 | 제외) · 쪽 · 이유 · 대표.
export function selection(root) {
  let text = ''
  try { text = readFileSync(at(root, 'sources', '선정.md'), 'utf8') } catch { return null }
  const rows = text.split('\n').filter(l => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l))
    .map(l => l.split('|').slice(1, -1).map(c => c.trim()))
    .filter(c => c[0] && c[0] !== '글감')
    .map(([id, use, page, why, lead]) => ({ id, use, page, why, lead }))
  const bad = rows.filter(r => !['본문', '부록', '제외'].includes(r.use)).map(r => `${r.id}: 쓰임 "${r.use}" is not 본문 | 부록 | 제외`)
  return { rows, problems: bad }
}

// After a render: build/pages/*.png kept under snapshot/render/deck-<v>/pages/ (build/ is regenerated
// in full), with a 검토.md holding one row per page to fill (쪽 · 본 것 · 문제 · next-render: what goes
// into template/next-render.md).
export function keepRender(root, version) {
  if (!/^v\d+\.\d+\.\d+$/.test(String(version))) throw new Error('--version vX.Y.Z (the deck version rendered) is required')
  const src = join(root, 'build', 'pages')
  let pages = []
  try { pages = readdirSync(src).filter(f => /\.png$/.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) } catch { /* none */ }
  if (!pages.length) throw new Error('build/pages has no previews: run deck-builder render first')
  const dir = join(root, 'snapshot', 'render', `deck-${version}`)
  mkdirSync(join(dir, 'pages'), { recursive: true })
  for (const f of pages) copyFileSync(join(src, f), join(dir, 'pages', f))
  const review = at(dir, '검토.md')
  if (!existsSync(review)) {
    writeFileSync(review, [`# 렌더 검토 · deck-${version}`, '', '| 쪽 | 본 것 | 문제 | next-render |', '|---|---|---|---|',
      ...pages.map((_, i) => `| ${i + 1} | | | |`), ''].join('\n'))
  }
  return { kept: pages.length, dir, review }
}

export function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true
      else { out[a.slice(2)] = next; i++ }
    } else out._.push(a)
  }
  return out
}

const VERSION = /^version:[ \t]*v(\d+)\.(\d+)\.(\d+)[ \t]*$/m
const CHANGE_LINE = /^\s*(?:>\s*)?v\d+\.\d+\.\d+(?:\s*변경|\s*\()/

export function bump(v, level) {
  const [a, b, c] = v
  if (level === 'major') return [a + 1, 0, 0]
  if (level === 'minor') return [a, b + 1, 0]
  if (level === 'patch') return [a, b, c + 1]
  throw new Error(`level must be major|minor|patch, got ${level}`)
}

export function snapshot(root, { kind, level, note, by, date }) {
  if (!['skeleton', 'deck', 'resume'].includes(kind)) throw new Error('kind must be skeleton|deck|resume')
  if (!note) throw new Error('--note is required')
  const skelPath = wsFile(root, SKELETON)
  const skel = readFileSync(skelPath, 'utf8')
  const m = skel.match(VERSION)
  if (!m) throw new Error(`${basename(skelPath)} has no \`version: vX.Y.Z\` line`)
  const cur = [Number(m[1]), Number(m[2]), Number(m[3])]
  const curS = `v${cur.join('.')}`
  const day = date || new Date().toISOString().slice(0, 10)
  const readme = join(root, 'snapshot', 'README.md')
  if (kind === 'deck' || kind === 'resume') return deckSnapshot(root, { kind, level, note, day, skelS: curS, readme })
  const dir = join(root, 'snapshot', kind, `${kind}-${curS}`)
  for (const p of [dir, skelPath, readme]) assertInside(root, p)
  if (existsSync(dir)) throw new Error(`${dir} exists: snapshot of ${curS} already taken`)
  mkdirSync(dir, { recursive: true })
  copyFileSync(skelPath, join(dir, basename(skelPath)))

  const next = `v${bump(cur, level).join('.')}`
  // the history line follows the file's own form: quoted `> vX.Y.Z(날짜, 누가): …` when it already uses it
  const quoted = /^>\s*v\d+\.\d+\.\d+\(/m.test(skel)
  // `--by` names who decided; without it the line names no one (never a 본인 결정 the user did not make)
  const when = typeof by === 'string' && by.trim() ? `${day}, ${by.trim()} 결정` : day
  const line = quoted ? `> ${next}(${when}): ${note}` : `${next} 변경(${when}): ${note}`
  const updated = skel.replace(VERSION, `version: ${next}\n${line}`)
  writeFileSync(skelPath, updated)
  const head = '| 버전 | 날짜 | 장수 | 바뀐 것 |\n|---|---|---|---|\n'
  const body = existsSync(readme) ? readFileSync(readme, 'utf8') : `# 스냅샷\n\n${head}`
  writeFileSync(readme, readmeRow(body, { cur: curS, next, day, pages: pageCount(skel), note }))
  return { kind, snapshot: dir, from: curS, to: next, level, readme }
}

// The deck counts its own versions, apart from skeleton: the next one after the newest
// snapshot/deck/deck-vX.Y.Z (v1.0.0 when there is none). The folder holds that version: deck.mdx,
// assets/ when there is one, and a NOTES.md with the note; the row goes into README's `## deck` table.
// kind `resume` is the same with its own count under snapshot/resume/, copying resume-skeleton.md and
// resume-deck.mdx (whichever exist).
function deckSnapshot(root, { kind = 'deck', level, note, day, skelS, readme }) {
  const base = join(root, 'snapshot', kind)
  let names = []
  try { names = readdirSync(base) } catch { /* first deck snapshot */ }
  const vers = names.map(n => n.match(new RegExp(`^${kind}-v(\\d+)\\.(\\d+)\\.(\\d+)$`))).filter(Boolean).map(m => m.slice(1).map(Number))
  const newest = vers.sort((x, y) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2])[0]
  const next = `v${(newest ? bump(newest, level) : [1, 0, 0]).join('.')}`
  const dir = join(base, `${kind}-${next}`)
  assertInside(root, dir)
  assertInside(root, readme)
  mkdirSync(dir, { recursive: true })
  const sources = kind === 'deck' ? [wsFile(root, DECK)] : ['resume-skeleton.md', RESUME_DECK].map(p => wsFile(root, p)).filter(existsSync)
  for (const f of sources) copyFileSync(f, join(dir, basename(f)))
  if (existsSync(join(root, 'assets'))) cpSync(join(root, 'assets'), join(dir, 'assets'), { recursive: true })
  writeFileSync(join(dir, 'NOTES.md'), `# ${kind}-${next}\n\n${day}. skeleton ${skelS} 반영. ${note}\n`)
  if (existsSync(readme)) writeFileSync(readme, readmeRow(readFileSync(readme, 'utf8'), { cur: next, day, note }, kind))
  return { kind, snapshot: dir, from: newest ? `v${newest.join('.')}` : null, to: next, skeleton: skelS, readme }
}

// The page count the skeleton states in its head (`28장`), else the number of page headings.
export function pageCount(skel) {
  const m = skel.split('\n').slice(0, 15).join('\n').match(/(\d+)\s*장/)
  return m ? Number(m[1]) : headings(skel).length
}

// One row for the snapshot table: into the table under a `## skeleton` (or `## deck`) heading when
// there is one, cells filled by that table's column names; else appended at the end of the file.
// A skeleton row says what the next version changes (`→ vB: …`); a deck row is that version's own note.
export function readmeRow(body, { cur, next, day, pages, note }, kind = 'skeleton') {
  const lines = body.split('\n')
  const sec = lines.findIndex(l => new RegExp(`^##\\s+${kind}\\b`, 'i').test(l))
  if (sec >= 0) {
    let h = sec + 1
    while (h < lines.length && !/^\s*\|/.test(lines[h]) && !/^#/.test(lines[h])) h++
    if (h < lines.length && /^\s*\|/.test(lines[h])) {
      let end = h
      while (end + 1 < lines.length && /^\s*\|/.test(lines[end + 1])) end++
      const cols = lines[h].split('|').slice(1, -1).map(c => c.trim())
      const tick = end > h + 1 && lines[h + 2].includes('`')
      const cell = c => (/버전/.test(c) ? (tick ? `\`${kind}-${cur}\`` : cur) : /날짜/.test(c) ? day : /장수/.test(c) ? String(pages)
        : /바뀐|한 줄|메모|내용/.test(c) ? (next ? `→ ${next}: ${note}` : note) : '')
      // newest first when the table already reads that way (its first row is the higher version)
      const ver = l => (l || '').match(/v(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number)
      const [a, b] = [ver(lines[h + 2]), ver(lines[h + 3])]
      const newestFirst = a && b && (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) > 0
      lines.splice(newestFirst ? h + 2 : end + 1, 0, `| ${cols.map(cell).join(' | ')} |`)
      return lines.join('\n')
    }
  }
  return `${body.replace(/\n*$/, '\n')}| ${cur} | ${day} | ${pages} | → ${next}: ${note} |\n`
}

export function parseMap(s) {
  const map = new Map()
  for (const pair of String(s).split(',').map(x => x.trim()).filter(Boolean)) {
    const [a, b] = pair.split(':').map(Number)
    if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error(`bad map entry "${pair}"`)
    if (map.has(a)) throw new Error(`page ${a} mapped twice`)
    map.set(a, b)
  }
  const targets = [...map.values()]
  if (new Set(targets).size !== targets.length) throw new Error('two pages map to the same new number')
  return map
}

const HEADING = /^(##\s+)(\d+)(?=쪽|[.)\s])/
const REF = /(\d+)(?:([·~])(\d+))?쪽/g

// Lines inside a ``` or ~~~ fence are code, never a heading or a reference.
export function fenced(lines) {
  let open = null
  return lines.map(l => {
    const m = l.match(/^\s*(```|~~~)/)
    if (m && (!open || m[1] === open)) { const inside = !!open; open = open ? null : m[1]; return inside || !!open }
    return !!open
  })
}

export function headings(text) {
  const lines = text.split('\n')
  const code = fenced(lines)
  return lines.map((l, i) => !code[i] && l.match(HEADING)).filter(Boolean).map(m => Number(m[2]))
}

// Every number is looked up once against the original map, so a 3→4 and 4→3 swap cannot apply twice.
// A target that is a page the map leaves in place would make two pages share a number: refused.
export function renumber(text, map) {
  const present = new Set(headings(text))
  for (const [from, target] of map) {
    if (target !== from && present.has(target) && !map.has(target)) throw new Error(`page ${from} → ${target}: page ${target} stays, add it to the map`)
  }
  const to = n => (map.has(n) ? map.get(n) : n)
  const warnings = []
  let changes = 0
  const swap = n => { const v = to(n); if (v !== n) changes++; return v }
  let pageCol = -1
  const src = text.split('\n')
  const code = fenced(src)
  const lines = src.map((line, i) => {
    if (code[i] || CHANGE_LINE.test(line)) return line
    const h = line.match(HEADING)
    if (h) {
      // the heading's own number (and its `쪽`) is swapped once; references later in its text are swapped as refs
      pageCol = -1
      const own = h[0].length + (line.slice(h[0].length).startsWith('쪽') ? 1 : 0)
      // a block order mark `(2/3)` in a moved heading is not renumbered: listed for a hand fix
      const nth = line.match(/\((\d+)\/(\d+)\)/)
      if (nth && to(Number(h[2])) !== Number(h[2])) warnings.push(`${Number(h[2])}쪽 → ${to(Number(h[2]))}쪽 heading keeps "${nth[0]}": check it by hand`)
      return `${h[1]}${swap(Number(h[2]))}${line.slice(h[0].length, own)}${refs(line.slice(own))}`
    }
    if (/^\s*\|/.test(line)) {
      const cells = line.split('|')
      if (cells.some(c => c.trim() === '쪽')) { pageCol = cells.findIndex(c => c.trim() === '쪽'); return line }
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) return line
      if (pageCol >= 0 && cells[pageCol] !== undefined) {
        // the `쪽` cell is swapped once as a column; refs run on the other cells only (`3쪽` in it is not swapped twice)
        return cells.map((c, k) => (k === pageCol ? c.replace(/\d+/g, n => String(swap(Number(n)))) : refs(c))).join('|')
      }
      return refs(line)
    }
    pageCol = -1
    return refs(line)
  })
  function refs(line) {
    return line.replace(REF, (all, a, sep, b) => {
      if (!sep) return `${swap(Number(a))}쪽`
      // a `·` pair is written in ascending order after the swap (7·8쪽 stays 7·8쪽, not 8·7쪽)
      if (sep === '·') return `${[swap(Number(a)), swap(Number(b))].sort((x, y) => x - y).join('·')}쪽`
      // a range maps as the set of its pages: kept as min~max when that set is still contiguous
      const lo = Number(a), hi = Number(b)
      const pages = []
      for (let n = lo; n <= hi; n++) pages.push(to(n))
      const min = Math.min(...pages), max = Math.max(...pages)
      if (max - min + 1 !== pages.length || new Set(pages).size !== pages.length) {
        warnings.push(`range ${all} is no longer contiguous: ${[...pages].sort((x, y) => x - y).join('·')}쪽`)
        return all
      }
      if (min !== lo || max !== hi) changes++
      return `${min}~${max}쪽`
    })
  }
  return { text: reorder(lines).join('\n'), changes, warnings }
}

const H1 = /^#\s/
const pageOf = sec => { const m = sec[0].match(HEADING); return m ? Number(m[2]) : null }
const blankTail = sec => { let n = 0; while (n < sec.length - 1 && sec[sec.length - 1 - n] === '') n++; return n }

// Sorts the items whose key is not null into ascending key order, in the slots those items held;
// each slot keeps its own trailing blank lines, so blank-line rhythm does not move with an item.
function slotSort(items, key) {
  const slots = items.map((it, i) => (key(it) === null ? -1 : i)).filter(i => i >= 0)
  const sorted = slots.map(i => items[i]).sort((x, y) => key(x) - key(y))
  const out = [...items]
  slots.forEach((slot, k) => {
    const c = [...sorted[k]]
    while (c.length > 1 && c.at(-1) === '') c.pop()
    out[slot] = [...c, ...Array(blankTail(items[slot])).fill('')]
  })
  return out
}

// Pages sort inside each `# ` block in the slots pages held (unnumbered `##` sections keep their
// place); then blocks that hold pages sort by their first page, in the slots such blocks held.
function reorder(lines) {
  const code = fenced(lines)
  const h1s = lines.map((l, i) => (!code[i] && H1.test(l) ? i : -1)).filter(i => i >= 0)
  const cuts = [0, ...h1s.filter(i => i > 0)]
  const blocks = cuts.map((c, k) => [lines.slice(c, cuts[k + 1] ?? lines.length), code.slice(c, cuts[k + 1] ?? lines.length)]).map(([block, bcode]) => {
    const starts = block.map((l, i) => (!bcode[i] && /^##\s/.test(l) ? i : -1)).filter(i => i >= 0)
    if (!starts.length) return { lines: block, first: null }
    const head = block.slice(0, starts[0])
    const secs = slotSort(starts.map((s, k) => block.slice(s, starts[k + 1] ?? block.length)), pageOf)
    const pages = secs.map(pageOf).filter(n => n !== null)
    return { lines: [...head, ...secs.flat()], first: pages.length ? Math.min(...pages) : null }
  })
  const movable = b => (H1.test(b.lines[0] || '') ? b.first : null)
  return slotSort(blocks.map(b => Object.assign(b.lines, { first: movable(b) })), b => b.first).flat()
}

export function verify(text) {
  const hs = headings(text)
  const problems = []
  for (let i = 1; i < hs.length; i++) if (hs[i] <= hs[i - 1]) problems.push(`heading ${hs[i]} after ${hs[i - 1]}`)
  const known = new Set(hs)
  const all = text.split('\n')
  const code = fenced(all)
  const live = all.filter((l, i) => !code[i] && !CHANGE_LINE.test(l)).join('\n')
  for (const m of live.matchAll(REF)) {
    for (const n of [m[1], m[3]].filter(Boolean).map(Number)) if (!known.has(n)) problems.push(`${m[0]} points at no heading`)
  }
  return { headings: hs, problems }
}

// Items scored on only one side are listed apart: a rubric that changed between rounds is not a comparison.
// With two `claims` results, a claim that lost its ground (a problem the earlier round did not have)
// makes the round worse whatever the scores say.
export function compare(before, after, claimsBefore, claimsAfter) {
  const items = Object.keys(before).filter(k => k in after).map(item => ({ item, before: before[item], after: after[item], delta: after[item] - before[item] }))
  const unmatched = [...Object.keys(before), ...Object.keys(after)].filter(k => !(k in before && k in after))
  const dropped = items.filter(i => i.delta < 0).map(i => i.item)
  const rose = items.filter(i => i.delta > 0).map(i => i.item)
  let verdict = dropped.length && rose.length ? 'mixed' : dropped.length ? 'worse' : rose.length ? 'better' : 'same'
  if (!claimsBefore || !claimsAfter) return { verdict, items, dropped, unmatched }
  // a figure problem is the same problem when its kind and figure are, whatever the sentence around it
  // became; counted, so a figure that now fails in one more place is still new
  const key = p => { const f = String(p.text).match(/^(\S+) — /); return `${p.kind}|${f ? f[1] : p.text}` }
  const had = new Map()
  for (const p of claimsBefore.problems) had.set(key(p), (had.get(key(p)) || 0) + 1)
  const lostGround = claimsAfter.problems.filter(p => {
    const n = had.get(key(p)) || 0
    if (n) { had.set(key(p), n - 1); return false }
    return true
  })
  if (lostGround.length) verdict = 'worse'
  return { verdict, items, dropped, unmatched, lost_ground: lostGround }
}

// ── claims: the skeleton's claims checked against the material, both ways ──
// A page cites its material with one line `글감: <id>, <id>` (an item folder under sources/material/
// or material/, or a ledger item `NN_프로젝트/A1`). A figure is a number with a unit or a percentage.
// (a Korean particle may follow the unit: `3배가`; `12만 건` is one figure; digits glued to a name,
// `HS256`, `S3`, are not a figure)
const FIG = /(?<![A-Za-z\d.])(\d[\d,]*(?:\.\d+)?)\s*((?:[만억천]\s*)?(?:%|ms|초|분|시간|개월|일|주|배|건|명|회|개|대|원|GB|MB|KB|TB|TPS|QPS|RPS|x)|[만억천])(?![A-Za-z])/gu
const CITE = /^\s*(?:[-*]\s*)?글감\s*:\s*(.+)$/
// a sentence that gives a reason, cause or solution; grounded only when the cited items say it
const REASON = /때문|위해|위한|그래서|따라서|덕분|인해|원인|해결|선택했|결정했|판단했/
const LABEL = /^\s*[^\s:：]{1,6}\s*[:：]\s*/
// phrases the user rejected as machine-written; listed, not failed
const TONE = ['효율적으로', '획기적', '극대화', '성공적으로', '원활한', '원활하게', '시너지', '견고한', '혁신적', '함으로써', '다양한 ', '핵심적인', '도모']
// `30 → 50초`, `4~6개`: the unit after the second number belongs to the first as well
const RANGE = /(?<![A-Za-z\d.])(\d[\d,]*(?:\.\d+)?)(\s*(?:→|->|~|～|–)\s*\d[\d,]*(?:\.\d+)?\s*)((?:[만억천]\s*)?(?:%|ms|초|분|시간|개월|일|주|배|건|명|회|개|대|원|GB|MB|KB|TB|TPS|QPS|RPS|x))(?![A-Za-z])/gu
// Not a figure: a number inside a date or time (`2024-02`, `09:30`, `3/4`), and a number set apart from
// a Korean unit that is only the first syllable of the next word (`2024-02, 배치`, `3 대응`).
const PARTICLE = /^(은|는|이|가|을|를|의|에|로|도|만|와|과|씩|째|당|간|까지|부터|보다|처럼|으로)/
export const figs = s => [...String(s).replace(RANGE, '$1$3$2$3').matchAll(FIG)].filter(m => {
  const str = m.input, at = m.index
  if (at > 0 && /[-/:]/.test(str[at - 1]) && /\d/.test(str[at - 2] || '')) return false
  const after = str.slice(at + m[0].length)
  if (/[-/:]\d/.test(after.slice(0, 2)) && !/[가-힣%]/.test(m[2])) return false
  const spaced = /\s/.test(m[0].slice(m[1].length, m[0].length - m[2].length))
  if (spaced && /^[가-힣]$/.test(m[2]) && /^[가-힣]/.test(after) && !PARTICLE.test(after)) return false
  return true
}).map(m => `${m[1].replace(/,/g, '')}${m[2].replace(/\s+/g, '')}`)
const stems = s => (String(s).match(/[\p{L}\p{N}]+/gu) || [])
  .filter(w => w.length >= 2 && !REASON.test(w))
  .map(w => (/^[\p{Script=Hangul}]/u.test(w) ? w.slice(0, 2) : w.toLowerCase()))

// result.md rows: `| number | evidence source | label |`
function resultRows(text) {
  return text.split('\n').filter(l => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l))
    .map(l => l.split('|').slice(1, -1).map(c => c.trim()))
    .filter(c => c.length >= 3 && c[0] && c[0] !== 'number')
    .map(([number, evidence, label]) => ({ figs: figs(number), evidence, label }))
}

export function readMaterial(root) {
  const items = new Map()
  const read = p => { try { return readFileSync(p, 'utf8') } catch { return '' } }
  const ls = d => { try { return readdirSync(d, { withFileTypes: true }) } catch { return [] } }
  for (const base of [join(root, 'sources', 'material'), join(root, 'material')]) {
    for (const e of ls(base).filter(e => e.isDirectory())) {
      if (items.has(e.name)) continue
      const parts = ['problem', 'decision', 'result', 'learned', 'meta'].map(p => read(join(base, e.name, `${p}.md`)))
      const result = parts[2]
      items.set(e.name, { id: e.name, text: parts.join('\n'), rows: resultRows(result), cited: false })
    }
  }
  for (const p of ls(join(root, 'sources')).filter(e => e.isDirectory() && /^\d+_/.test(e.name))) {
    // every grade's file (A1, B2, C3 …), not only A: a page may cite any of them. Grades are A, B, C
    // as material's ledger reads them; X_ files (topics not to use) are never items
    for (const f of ls(join(root, 'sources', p.name)).filter(e => e.isFile() && /^[ABC]\d+.*\.md$/.test(e.name))) {
      const text = read(join(root, 'sources', p.name, f.name))
      // a ledger has no result table: each line holding a figure is its row, `근거 없음` on that line marks it
      const rows = text.split('\n').filter(l => figs(l).length)
        .map(l => ({ figs: figs(l), evidence: /근거 없음/.test(l) ? '근거 없음' : l, label: /본인 확인/.test(l) ? '본인 확인' : '' }))
      const id = `${p.name.normalize('NFC')}/${f.name.match(/^[A-Z]\d+/)[0]}`
      items.set(id, { id, text, rows, cited: false })
    }
  }
  return items
}

// deck.mdx read as pages for `claims`: each `## @sN <comment>` slide is the next page (or the `N쪽`
// its comment names), its `글감: <id>, …` cites from the comment, and every slot value is a body line
// (`notes:`, pictures and `!drop` are not claims).
export function deckPages(text) {
  const out = []
  let page = 0
  for (const l of text.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n')) {
    const s = l.match(/^##\s+@s\d+\b(.*)$/)
    if (s) {
      page = Number(s[1].match(/(\d+)쪽/)?.[1] ?? page + 1)
      out.push(`## ${page}쪽`)
      const c = s[1].match(/글감\s*:\s*([^·|]+)/)
      if (c) out.push(`글감: ${c[1].trim()}`)
      continue
    }
    if (/^#\s/.test(l)) { out.push(l); continue }
    if (!out.length) continue
    const kv = l.match(/^([A-Za-z_][\w]*):\s*(.*)$/)
    if (kv) {
      if (kv[1] === 'notes' || /^!drop$|\.(png|jpe?g|svg|gif)(\s*\|.*)?$/i.test(kv[2])) continue
      if (kv[2]) out.push(kv[2])
    } else if (l.trim()) out.push(l.trim().replace(/^[-|]\s*/, ''))
  }
  return out.join('\n')
}

// resume.md read as pages for `claims`: every `##`/`###` heading (a section, a company entry) is the
// next page; its `글감:` lines cite, its bullets are the lines.
export function resumePages(text) {
  const out = []
  let page = 0
  for (const l of text.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n')) {
    if (/^#{2,3}\s/.test(l)) { out.push(`## ${++page}쪽`); continue }
    if (/^#\s/.test(l) || !page) continue
    if (l.trim()) out.push(l.trim().replace(/^[-*]\s+/, ''))
  }
  return out.join('\n')
}

// Settled writing bases and structure decisions the checks must not raise again: the lines under
// `## 서술 기준` and `## 구조` in docs/확정사실.md, handed to feedback and drift checks as they are.
export function settled(root) {
  let text = ''
  try { text = readFileSync(at(root, 'docs', '확정사실.md'), 'utf8') } catch { return [] }
  const out = []
  let on = false
  for (const l of text.split('\n')) {
    if (/^##\s/.test(l)) on = /^##\s+(서술 기준|구조)/.test(l)
    else if (on && /^\s*-\s+\S/.test(l)) out.push(l.replace(/^\s*-\s+/, '').trim())
  }
  return out
}

// A 확정사실.md that is missing, unreadable or has neither section leaves every settled decision
// unread: said, never silent.
export function settledNote(root) {
  let text
  try { text = readFileSync(at(root, 'docs', '확정사실.md'), 'utf8') } catch (e) {
    return e.code === 'ENOENT' ? 'docs/확정사실.md not found: no settled decision or confirmed fact is read'
      : `docs/확정사실.md cannot be read (${e.code || e.message}): no settled decision or confirmed fact is read`
  }
  return /^##\s+(서술 기준|구조)/m.test(text) ? undefined
    : 'docs/확정사실.md has no `## 서술 기준` or `## 구조` section: no settled decision is read; write them there'
}

// The lines of docs/확정사실.md holding a figure: facts the user confirmed, ground for a page figure
// its cited items do not carry (listed as confirmed, never not_in_material).
export function confirmedFacts(root) {
  let text = ''
  try { text = readFileSync(at(root, 'docs', '확정사실.md'), 'utf8') } catch { return [] }
  return text.split('\n').filter(l => figs(l).length).map(l => ({ figs: figs(l), text: l.trim() }))
}

// A finding re-raises a settled line when it shares >= SETTLE_MIN word stems with it and at least half
// of the line's stems; a line of fewer than SETTLE_MIN stems never matches. The best line per finding
// decides; `kept` keeps the input order and the original objects.
const SETTLE_SHARE = 0.5
const SETTLE_MIN = 3
export function settle(findings, lines) {
  const sets = lines.map(line => ({ line, st: [...new Set(stems(line))] })).filter(l => l.st.length >= SETTLE_MIN)
  const kept = []
  const out = []
  for (const finding of findings) {
    const have = new Set(stems(finding?.text ?? ''))
    let best = null
    for (const { line, st } of sets) {
      const shared = st.filter(w => have.has(w)).length
      const share = shared / st.length
      if (shared >= SETTLE_MIN && share >= SETTLE_SHARE && (!best || share > best.share)) best = { line, share }
    }
    if (best) out.push({ finding, line: best.line, share: Math.round(best.share * 100) / 100 })
    else kept.push(finding)
  }
  return { kept, settled: out }
}

// With a selection (sources/선정.md), a page citing an item marked 제외 is a problem, the reverse
// lists cover only 본문/부록 items, and items the table does not name are listed `unselected`.
export function claims(text, items, settledLines = [], sel = null, confirmed = []) {
  const use = new Map((sel?.rows || []).map(r => [r.id, r.use]))
  const problems = [], listed = { self_confirmed: [], user_stated: [], tone: [], confirmed: [], summary: [], in_text: [] }
  const carried = new Map()   // item id → figures some page carries
  const summary = []          // uncited lines with figures, kept for the summary check below
  const grounded = new Set()  // figures a citing page carries with ground (not `근거 없음`)
  const lines = text.split('\n')
  const pages = []
  let cur = null
  for (const l of lines) {
    const h = l.match(HEADING)
    if (h) { cur = { page: Number(h[2]), body: [], ids: [] }; pages.push(cur); continue }
    if (/^#{1,2}\s/.test(l)) { cur = null; continue }
    if (!cur || CHANGE_LINE.test(l)) continue
    const c = l.match(CITE)
    if (c) cur.ids.push(...c[1].split(/[,;]/).map(s => s.trim()).filter(Boolean))
    else if (l.trim()) cur.body.push(l.trim())
  }
  for (const p of pages) {
    const known = p.ids.filter(id => items.has(id))
    for (const id of p.ids.filter(id => !items.has(id))) problems.push({ page: p.page, kind: 'unknown_id', text: id })
    for (const id of known) items.get(id).cited = true
    for (const id of known.filter(id => use.get(id) === '제외')) problems.push({ page: p.page, kind: 'excluded', text: id })
    const ground = known.map(id => items.get(id))
    for (const line of p.body) {
      for (const t of TONE) if (line.includes(t)) listed.tone.push({ page: p.page, phrase: t.trim(), text: line })
      const fs = figs(line)
      // a template label (`해결:`, `문제:`) is a slot name, not a reason: read what follows it
      const reason = REASON.test(line.replace(LABEL, '')) && !/\[확인 필요/.test(line)
      if ((fs.length || reason) && !known.length) {
        // a page that needs no item (a profile): a line whose every figure 확정사실.md states passes
        const facts = fs.map(f => confirmed.find(c => c.figs.includes(f)))
        if (!reason && facts.every(Boolean)) fs.forEach((f, i) => listed.confirmed.push({ page: p.page, text: `${f} — ${line}`, fact: facts[i].text }))
        else if (!reason) summary.push({ page: p.page, fs, line })
        else problems.push({ page: p.page, kind: 'uncited', text: line })
        continue
      }
      for (const f of fs) {
        const hit = ground.map(it => ({ it, row: it.rows.find(r => r.figs.includes(f)) })).find(x => x.row)
        if (!hit) {
          const fact = confirmed.find(c => c.figs.includes(f))
          // a number the cited item states outside its results (a team of 3, one server): context, listed
          const said = ground.find(it => figs(it.text).includes(f))
          if (said) { grounded.add(f); listed.in_text.push({ page: p.page, id: said.id, text: `${f} — ${line}` }) }
          else if (fact) listed.confirmed.push({ page: p.page, text: `${f} — ${line}`, fact: fact.text })
          else problems.push({ page: p.page, kind: 'not_in_material', text: `${f} — ${line}` })
          continue
        }
        if (!carried.has(hit.it.id)) carried.set(hit.it.id, new Set())
        carried.get(hit.it.id).add(f)
        const { evidence, label } = hit.row
        if (/근거 없음/.test(evidence)) { problems.push({ page: p.page, kind: 'unsupported', text: `${f} — ${line}` }); continue }
        grounded.add(f)
        if (/본인 확인/.test(label)) listed.self_confirmed.push({ page: p.page, id: hit.it.id, text: `${f} — ${line}` })
        else if (/user-stated/.test(label)) listed.user_stated.push({ page: p.page, id: hit.it.id, text: `${f} — ${line}` })
      }
      if (reason) {
        // grounded when at least half of the sentence's word stems appear in the cited items
        const own = stems(line)
        const pool = new Set(stems(ground.map(it => it.text).join('\n')))
        const share = own.length ? own.filter(s => pool.has(s)).length / own.length : 1
        if (share < 0.5) problems.push({ page: p.page, kind: 'to_confirm', text: line })
      }
    }
  }
  // a summary page (cover, contents, strengths) repeats figures a citing page grounds: listed `summary`
  for (const s of summary) {
    if (s.fs.every(f => grounded.has(f) || confirmed.some(c => c.figs.includes(f)))) listed.summary.push({ page: s.page, text: s.line })
    else problems.push({ page: s.page, kind: 'uncited', text: s.line })
  }
  // the other way: figures in cited items no page carries, and items no page cites
  const unused = []
  for (const it of items.values()) {
    if (!it.cited) continue
    for (const r of it.rows) for (const f of r.figs) if (!carried.get(it.id)?.has(f) && !/근거 없음/.test(r.evidence)) unused.push({ id: it.id, figure: f })
  }
  const chosen = it => !use.size || ['본문', '부록'].includes(use.get(it.id))
  const uncitedItems = [...items.values()].filter(it => !it.cited && chosen(it)).map(it => it.id)
  const out = { ok: problems.length === 0, pages: pages.length, problems, listed, unused_results: unused.filter(u => chosen(items.get(u.id))), uncited_items: uncitedItems, settled: settledLines }
  if (use.size) out.unselected = [...items.keys()].filter(id => !use.has(id))
  return out
}

// ── round: the record is described in the header (`round --input`) ──
const ROUNDS_DIR = 'snapshot/rounds'
const VERDICTS = ['pass', 'skipped', 'fail'] // worst last: a step's gate verdict is its worst entry
// who settled a user-wait point (steps 2, 3, and a structure change in 4): the user, else noah, else the proposal
const ANSWERERS = ['user', 'noah', 'proposal']
function checkAnsweredBy(s, where) {
  if (s.answered_by === undefined) return
  if (!ANSWERERS.includes(s.answered_by)) throw new Error(`${where}answered_by must be user, noah or proposal`)
  if (s.step < 2 || s.step > 4) throw new Error(`${where}answered_by is only for the user-wait steps 2-4`)
}
const FEEDBACK_MODES = ['panel', 'single-context']
const isInt = v => Number.isInteger(v) && v >= 1
const isText = v => typeof v === 'string' && v.trim() !== ''

function checkRoundInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('round input must be a JSON object')
  if (!isInt(input.round)) throw new Error('round must be a positive integer')
  if (!isInt(input.n)) throw new Error('n must be a positive integer')
  if (!Array.isArray(input.steps)) throw new Error('steps must be an array')
  input.steps.forEach((s, i) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error(`steps[${i}] must be an object`)
    if (!Number.isInteger(s.step) || s.step < 1 || s.step > 7) throw new Error(`steps[${i}].step must be an integer 1-7`)
    if (!isText(s.criteria)) throw new Error(`steps[${i}].criteria must be a non-empty string`)
    if (!VERDICTS.includes(s.verdict)) throw new Error(`steps[${i}].verdict must be pass, fail or skipped`)
    if (!isText(s.by)) throw new Error(`steps[${i}].by must be a non-empty string`)
    if (s.reason !== undefined && typeof s.reason !== 'string') throw new Error(`steps[${i}].reason must be a string`)
    checkAnsweredBy(s, `steps[${i}].`)
    if (s.id !== undefined && (typeof s.id !== 'string' || !/^[^\s/]+$/.test(s.id))) {
      throw new Error(`steps[${i}].id must be a non-empty string without a slash or whitespace (the criterion id)`)
    }
  })
  const feedback = input.feedback ?? []
  if (!Array.isArray(feedback)) throw new Error('feedback must be an array of {id, text}')
  feedback.forEach((f, i) => {
    if (!f || typeof f !== 'object' || Array.isArray(f) || typeof f.id !== 'string' || typeof f.text !== 'string') {
      throw new Error(`feedback[${i}] must be an object with string id and string text`)
    }
  })
  if (feedback.length > 0 && !FEEDBACK_MODES.includes(input.feedback_mode)) {
    throw new Error(`feedback_mode must be ${FEEDBACK_MODES.join(' or ')} when feedback is not empty`)
  }
  if (feedback.length === 0 && input.feedback_mode != null && !FEEDBACK_MODES.includes(input.feedback_mode)) {
    throw new Error(`feedback_mode must be ${FEEDBACK_MODES.join(' or ')} when given`)
  }
  if (input.waiting_user !== undefined && input.waiting_user !== null) {
    throw new Error('waiting_user is not an input: a user-wait is answered by the user, else noah, else the proposal; record who as the step\'s answered_by (rounds.md: User-wait points)')
  }
  if (input.blocked !== undefined && input.blocked !== null && !isText(input.blocked)) throw new Error('blocked must be a non-empty string when given')
  const seen = input.steps.map(s => s.step).sort((a, b) => a - b)
  if (seen.length !== 7 || seen.some((s, i) => s !== i + 1)) {
    throw new Error(`steps must be exactly seven entries, one for each of steps 1-7 (rounds.md: the seven-step rule); got [${seen.join(', ')}]`)
  }
  if (input.round > input.n) throw new Error(`round ${input.round} is past n ${input.n}: a loop has no round beyond n`)
}

// The predecessor is read as a record, never as "whatever parses": a wrong shape is refused before any .map.
function readPrevRecord(root, input) {
  const prevPath = join(root, ROUNDS_DIR, `round-${input.round - 1}.json`)
  const rel = relative(root, prevPath)
  if (!existsSync(prevPath)) throw new Error(`round ${input.round} needs ${rel} and it is missing: rounds run in order, never skipping one`)
  const bad = why => new Error(`previous record malformed: ${rel} ${why}`)
  let prev
  try { prev = JSON.parse(readFileSync(prevPath, 'utf8')) } catch (e) { throw bad(`cannot be read as JSON: ${e.message}`) }
  if (!prev || typeof prev !== 'object' || Array.isArray(prev)) throw bad('must be a JSON object')
  if (prev.round !== input.round - 1) throw bad(`field round must be ${input.round - 1}`)
  if (!isInt(prev.n)) throw bad('field n must be a positive integer')
  if (!Array.isArray(prev.steps)) throw bad('field steps must be an array')
  if (!prev.gate || typeof prev.gate !== 'object' || Array.isArray(prev.gate)) throw bad('field gate must be an object')
  if (!Array.isArray(prev.gate.gaps) || prev.gate.gaps.some(g => typeof g !== 'string')) throw bad('field gate.gaps must be an array of strings')
  // feedback is `{ mode, ids }`, or the legacy `[{ id, text }]` array
  const legacy = Array.isArray(prev.feedback)
  const prevIds = legacy ? prev.feedback.map(f => f?.id) : prev.feedback?.ids
  if (!Array.isArray(prevIds) || prevIds.some(id => typeof id !== 'string')) {
    throw bad('field feedback must be { mode, ids: [string] } or an array of objects with a string id')
  }
  if (prev.n !== input.n) throw new Error(`n ${input.n} differs from n ${prev.n} in ${rel}: n is fixed across the rounds of one loop`)
  return { prev, prevPath, prevIds }
}

// sha256 of every file under root (never following a symlink), minus the rounds folder and `skip`.
function manifest(root, skip) {
  const out = {}
  const walk = rel => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (r === ROUNDS_DIR || skip.has(r) || e.isSymbolicLink()) continue
      if (e.isDirectory()) walk(r)
      else if (e.isFile()) out[r] = createHash('sha256').update(readFileSync(join(root, r))).digest('hex')
    }
  }
  walk('')
  return out
}

// Files added, removed or with other bytes than in `before` (a touch is not a change).
function changedFrom(before, now, skip) {
  const paths = new Set([...Object.keys(before), ...Object.keys(now)])
  return [...paths].filter(p => !skip.has(p) && before[p] !== now[p]).sort()
}

// Legacy fallback for a round N-1 recorded before end-N manifests: files whose mtime is later than `since`.
function changedSince(root, since, skip) {
  const out = []
  const walk = rel => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (r === ROUNDS_DIR || skip.has(r) || e.isSymbolicLink()) continue
      if (e.isDirectory()) walk(r)
      else if (e.isFile() && statSync(join(root, r)).mtimeMs > since) out.push(r)
    }
  }
  walk('')
  return out.sort()
}

// The findings one feedback run gives the round (rounds.md § Feedback each round), parsed from its text:
// ids from the 개선 우선순위 items' `근거: <ID>` and the Clashes entries marked survived, text from the
// appendix line that starts with the ID. The id carries a hash of that text, so an ID reused with new text
// (IDs restart every run) is a new finding. A dropped clash and a priority citing no ID are not consumed.
const FINDING_ID = /[CALRF]\d+/
export function intake(text) {
  const lines = text.split('\n')
  const blockOf = title => {
    const at = lines.findIndex(l => l.includes(`**[${title}`))
    if (at < 0) return null
    const end = lines.findIndex((l, i) => i > at && (/^\*\*\[/.test(l.trim()) || /^\*\*부록/.test(l.trim()) || l.trim() === '---'))
    return lines.slice(at + 1, end < 0 ? undefined : end).filter(l => l.trim() !== '')
  }
  const prio = blockOf('개선 우선순위')
  if (!prio) throw new Error('no [개선 우선순위 / Improvement Priorities] block: not a portfolio:feedback output')
  const clashes = blockOf('충돌') ?? []
  const mode = clashes.some(l => l.includes('패널 미실행')) || clashes.length === 0 ? 'single-context' : 'panel'
  const appendix = new Map()
  for (const l of lines) {
    const m = l.match(new RegExp(`^(${FINDING_ID.source})\\s+(.+)$`))
    if (m && !m[2].startsWith('—') && !appendix.has(m[1])) appendix.set(m[1], m[2].trim()) // `ID — who — survived` is a clash line
  }
  const ids = []
  const notConsumed = []
  for (const l of prio) {
    const m = l.match(new RegExp(`근거:\\s*(${FINDING_ID.source})`))
    if (m && appendix.has(m[1])) ids.push(m[1])
    else if (/^\s*\d+[.)]/.test(l)) notConsumed.push(l.trim())
  }
  if (mode === 'panel') {
    for (const l of clashes) {
      const m = l.match(new RegExp(`^(${FINDING_ID.source})\\s+—.*—\\s*survived\\s*$`))
      if (m && appendix.has(m[1])) ids.push(m[1])
    }
  }
  const findings = [...new Set(ids)].map(id => {
    const t = appendix.get(id)
    return { id: `${id}#${createHash('sha256').update(t).digest('hex').slice(0, 8)}`, text: t }
  })
  return { mode, findings, not_consumed: notConsumed }
}

// One step entry as it happens: criteria first, then its verdict, steps 1-7 in order. The engine stamps
// each with its own time into snapshot/rounds/steps-N.json, so the order is read from the record.
export function step(root, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('step input must be a JSON object')
  if (!isInt(input.round)) throw new Error('round must be a positive integer')
  if (!Number.isInteger(input.step) || input.step < 1 || input.step > 7) throw new Error('step must be an integer 1-7')
  const path = join(root, ROUNDS_DIR, `steps-${input.round}.json`)
  assertInside(root, path)
  if (existsSync(join(root, ROUNDS_DIR, `round-${input.round}.json`))) throw new Error(`round ${input.round} is already recorded`)
  const list = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : []
  const cur = list.at(-1)
  const at = new Date().toISOString()
  if (input.verdict !== undefined) {
    const entry = list.find(s => s.step === input.step)
    if (!entry) throw new Error(`step ${input.step} has no criteria yet: criteria come before the verdict`)
    if (entry.verdict !== undefined) throw new Error(`step ${input.step} already has its verdict`)
    if (!VERDICTS.includes(input.verdict)) throw new Error('verdict must be pass, fail or skipped')
    if (!isText(input.by)) throw new Error('by must be a non-empty string')
    if (input.reason !== undefined && typeof input.reason !== 'string') throw new Error('reason must be a string')
    checkAnsweredBy(input, '')
    Object.assign(entry, {
      verdict: input.verdict, by: input.by.trim(), ...(input.reason !== undefined && { reason: input.reason }),
      ...(input.answered_by !== undefined && { answered_by: input.answered_by }), verdict_at: at,
    })
  } else {
    const expected = cur ? cur.step + 1 : 1
    if (cur && cur.verdict === undefined) throw new Error(`step ${cur.step} has no verdict yet: the gate comes before step ${input.step}`)
    if (input.step !== expected) throw new Error(`next step is ${expected}: steps run 1-7 in order`)
    if (!isText(input.criteria)) throw new Error('criteria must be a non-empty string')
    if (input.id !== undefined && (typeof input.id !== 'string' || !/^[^\s/]+$/.test(input.id))) throw new Error('id must be a non-empty string without a slash or whitespace')
    list.push({ step: input.step, ...(input.id !== undefined && { id: input.id }), criteria: input.criteria.trim(), criteria_at: at })
  }
  mkdirSync(join(root, ROUNDS_DIR), { recursive: true })
  writeFileSync(path, `${JSON.stringify(list, null, 2)}\n`)
  const last = list.at(-1)
  const next = last.verdict === undefined ? { step: last.step, needs: 'verdict' } : last.step < 7 ? { step: last.step + 1, needs: 'criteria' } : null
  return { round: input.round, steps: list.map(s => ({ step: s.step, verdict: s.verdict ?? null })), next }
}

export function round(root, input, { skip = [] } = {}) {
  let recorded = null
  if (input && typeof input === 'object' && !Array.isArray(input) && input.steps === undefined && isInt(input.round)) {
    const path = join(root, ROUNDS_DIR, `steps-${input.round}.json`)
    assertInside(root, path)
    recorded = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : []
    if (recorded.length !== 7 || recorded.some(s => s.verdict === undefined)) {
      throw new Error(`no steps in the input and ${relative(root, path)} does not hold seven verdicts: record each step with \`step\` first`)
    }
    input = { ...input, steps: recorded.map(({ criteria_at, verdict_at, ...s }) => s) }
  }
  checkRoundInput(input)
  const roundsDir = join(root, ROUNDS_DIR)
  assertInside(root, roundsDir)
  assertInside(root, join(roundsDir, `round-${input.round}.json`))
  const feedback = input.feedback ?? []
  const target = join(root, ROUNDS_DIR, `round-${input.round}.json`)
  if (existsSync(target)) throw new Error(`${relative(root, target)} already exists: rounds never overwrite`)
  const { prev, prevPath, prevIds } = input.round > 1 ? readPrevRecord(root, input) : {}
  const startedFrom = prev ? { gaps: prev.gate.gaps, feedback: prevIds } : { gaps: [], feedback: [] }
  const steps = input.steps.map((s, i) => ({
    step: s.step, ...(s.id !== undefined && { id: s.id }), criteria: s.criteria.trim(), verdict: s.verdict, by: s.by.trim(),
    ...(s.reason !== undefined && { reason: s.reason }), ...(s.answered_by !== undefined && { answered_by: s.answered_by }),
    ...(recorded && { criteria_at: recorded[i].criteria_at, verdict_at: recorded[i].verdict_at }),
  }))
  const gaps = [...new Set(steps.filter(s => s.verdict !== 'pass').map(s => `s${s.step}/${s.id ?? s.criteria.replace(/\s+/g, ' ')}`))]
  const verdict = {}
  for (const s of steps) {
    if (VERDICTS.indexOf(s.verdict) > VERDICTS.indexOf(verdict[s.step] ?? 'pass')) verdict[s.step] = s.verdict
    verdict[s.step] ??= 'pass'
  }
  const diff = {
    resolved: startedFrom.gaps.filter(g => !gaps.includes(g)),
    carried: gaps.filter(g => startedFrom.gaps.includes(g)),
    new: gaps.filter(g => !startedFrom.gaps.includes(g)),
  }
  const skipSet = new Set(skip)
  const now = manifest(root, new Set())
  const prevManifest = join(root, ROUNDS_DIR, `end-${input.round - 1}.json`)
  const changed = !prev ? []
    : existsSync(prevManifest) ? changedFrom(JSON.parse(readFileSync(prevManifest, 'utf8')), now, skipSet)
    : changedSince(root, statSync(prevPath).mtimeMs, skipSet)
  const clauses = prev ? {
    no_new_gap: diff.new.length === 0,
    no_new_feedback: feedback.every(f => startedFrom.feedback.includes(f.id)),
    no_file_changed: changed.length === 0,
  } : null
  const nothingNew = clauses !== null && Object.values(clauses).some(Boolean)
  const last = input.round >= input.n
  const blocked = isText(input.blocked)
  const stopReason = blocked ? 'blocked' : nothingNew ? 'nothing_new' : last ? 'n_reached' : null
  const cont = stopReason === null
  const record = {
    round: input.round, n: input.n, started_from: startedFrom, steps,
    gate: { verdict, gaps, diff, clauses, order: recorded ? 'recorded' : 'caller' }, changed, stop_reason: stopReason, continue: cont,
    feedback: { mode: feedback.length > 0 ? input.feedback_mode : null, ids: feedback.map(f => f.id) },
    ...(blocked && { blocked: input.blocked }),
  }
  mkdirSync(join(root, ROUNDS_DIR), { recursive: true })
  writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`)
  // the workspace as this round left it: round N+1's `changed` is measured against it
  const endPath = join(root, ROUNDS_DIR, `end-${input.round}.json`)
  assertInside(root, endPath)
  writeFileSync(endPath, `${JSON.stringify(now)}\n`)
  const rounds = readdirSync(join(root, ROUNDS_DIR)).filter(f => /^round-\d+\.json$/.test(f)).length
  const { dir: record_dir } = writeRoundDir(root, input.round)
  return { round: input.round, rounds, stop_reason: stopReason, continue: cont, gaps, record_dir }
}

// The read form: every snapshot/rounds/round-N.json in round order, summarised from the files alone.
export function readRounds(root) {
  const dir = join(root, ROUNDS_DIR)
  assertInside(root, dir)
  const files = existsSync(dir) ? readdirSync(dir).filter(f => /^round-\d+\.json$/.test(f)) : []
  const items = files.map(f => JSON.parse(readFileSync(join(dir, f), 'utf8'))).sort((a, b) => a.round - b.round).map(r => ({
    round: r.round, n: r.n, verdict: r.gate.verdict, gaps: r.gate.gaps, diff: r.gate.diff, clauses: r.gate.clauses,
    changed: r.changed, stop_reason: r.stop_reason, continue: r.continue, feedback: r.feedback,
    ...(r.steps.some(s => s.answered_by) && { answered: Object.fromEntries(r.steps.filter(s => s.answered_by).map(s => [s.step, s.answered_by])) }),
    ...(r.waiting_user && { waiting_user: r.waiting_user }), ...(r.blocked && { blocked: r.blocked }),
  }))
  const l = items.at(-1)
  return { rounds: items.length, last: l ? { round: l.round, stop_reason: l.stop_reason, continue: l.continue } : null, items }
}

// Slot text, in the skeleton and in the deck source alike: under a `## … @sN …` heading, a line
// `key: value` (key lowercase ASCII) plus the indented lines after it. Not slots: `notes`, `place`, a
// picture path, `!drop`. Returns Map(slide id -> { order: [key], slots: Map(key -> value lines) }).
const SKIP_KEYS = new Set(['notes', 'place'])
// a slide's key: its archetype id, with its page when the heading names one (`@s12 6쪽`), since one
// archetype serves several pages
const slideKey = l => {
  const h = l.match(/^##\s.*@(s\d+)\b/)
  if (!h) return null
  const p = l.match(/(\d+)\s*쪽/)
  return p ? `${h[1]} ${p[1]}쪽` : h[1]
}
export function slotsOf(text) {
  const out = new Map()
  let cur = null
  let key = null
  for (const l of text.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n')) {
    const h = slideKey(l)
    if (h) { cur = { order: [], slots: new Map() }; out.set(h, cur); key = null; continue }
    if (/^#{1,2}\s/.test(l)) { cur = null; key = null; continue }
    if (!cur) continue
    // a table row naming its slots in backticks: `| 제목 \`text4\` | value |`, or several slots matched
    // to as many cells (`| \`text11\`·\`text10\` | a | b |`) or to one cell split at ` · `
    // (an indented `| a | b |` line is a table inside a slot value, read below as its continuation)
    const row = l.match(/^\|(.*)\|\s*$/)
    if (row) {
      key = null
      const cells = row[1].split('|').map(c => c.trim())
      const ids = [...(cells[0] || '').matchAll(/`([a-z][a-z0-9_]*)`/g)].map(m => m[1]).filter(k => !SKIP_KEYS.has(k))
      if (!ids.length) continue
      let vals = cells.slice(1)
      if (ids.length > 1 && vals.length === 1) vals = vals[0].split(/\s+·\s+/)
      if (vals.length !== ids.length) continue
      ids.forEach((k, i) => {
        const v = vals[i].replace(/<!--[\s\S]*?-->/g, '').trim()
        // not slot text: a drop, a picture path, an empty-slot note (`없음 …`)
        if (!v || /^`?!drop/.test(v) || /^`?[^\s`]+\.(png|jpe?g|svg|gif)\b/i.test(v) || /^없음(\s|\.|$)/.test(v)) return
        cur.order.push(k); cur.slots.set(k, v.split(/<br\s*\/?>|\s+\/\s+/).map(s => s.trim()).filter(Boolean))
      })
      continue
    }
    const kv = l.match(/^([a-z][a-z0-9_]*):[ \t]*(.*)$/)
    if (kv) {
      key = SKIP_KEYS.has(kv[1]) || kv[2] === '!drop' || /\.(png|jpe?g|svg|gif)(\s*\|.*)?$/i.test(kv[2]) ? null : kv[1]
      if (key) { cur.order.push(key); cur.slots.set(key, kv[2] ? [kv[2].trim()] : []) }
    } else if (key && /^[ \t]+\S/.test(l)) cur.slots.get(key).push(l.replace(/^( {2}|\t)/, '').trimEnd())   // nesting kept
    else key = null
  }
  return out
}
// the words a slot says, without the deck's markup: `**`, `[text]{fmt}`, `<br>`, list dashes, spacing
// (a skeleton writes a line break as ` / ` and numbers a footnote `1) `; the deck splits lines and
// numbers footnotes itself; a deck line may end in `\`)
const plain = s => s.trim().replace(/\s*\[확인 필요[^\]]*\]/g, '').replace(/\\$/, '').replace(/\s+\/\s+/g, ' ').replace(/^\d+\)\s+/, '').replace(/\\(.)/g, '$1').replace(/\[([^\]]*)\]\{[^}]*\}/g, '$1').replace(/\*\*/g, '').replace(/<br\s*\/?>/g, ' ').replace(/^[-|·•]\s*/, '').replace(/\s+/g, ' ').trim()

// skeleton -> deck source: each skeleton slot absent from, or different in, the deck's same slide.
// Writes only with `write`: a different slot is replaced, an absent one appended to its slide; a slide
// the deck lacks is reported and never created (structure is the user's).
export function sync(root, { write = false } = {}) {
  const skelPath = wsFile(root, SKELETON)
  const deckPath = wsFile(root, DECK)
  const skel = slotsOf(readFileSync(skelPath, 'utf8'))
  const deckText = readFileSync(deckPath, 'utf8')
  const deck = slotsOf(deckText)
  const missing = []; const different = []; const noSlide = []
  for (const [sid, s] of skel) {
    const d = deck.get(sid)
    if (!d) { if (s.slots.size) noSlide.push(sid); continue }
    for (const key of s.order) {
      const want = s.slots.get(key)
      if (!d.slots.has(key)) missing.push({ slide: sid, key, skeleton: want.join(' / ') })
      // line by line: a line split in two, or two joined, is a different slot (it lays out differently)
      else if (JSON.stringify(slotLinesOf(d.slots.get(key))) !== JSON.stringify(slotLinesOf(want))) {
        different.push({ slide: sid, key, skeleton: want.join(' / '), deck: d.slots.get(key).join(' / ') })
      }
    }
  }
  const out = { skeleton: basename(skelPath), deck: basename(deckPath), missing, different, slide_missing: noSlide, written: false }
  if (write && (missing.length || different.length)) {
    assertInside(root, deckPath)
    const lines = deckText.split('\n')
    // walk the deck once, slide by slide; an edit rewrites a slot's lines or appends before the next heading
    const res = []
    let sid = null; let skip = false
    const flush = () => {
      const add = missing.filter(m => m.slide === sid)
      const tail = []
      while (add.length && res.length && res.at(-1).trim() === '') tail.push(res.pop())
      for (const m of add) res.push(...slotLines(m.key, skel.get(sid).slots.get(m.key)))
      res.push(...tail)
    }
    for (const l of lines) {
      const h = slideKey(l)
      if (h || /^#{1,2}\s/.test(l)) { if (sid) flush(); sid = h; skip = false; res.push(l); continue }
      const kv = sid && l.match(/^([a-z][a-z0-9_]*):/)
      if (kv) {
        skip = false
        const diff = different.find(x => x.slide === sid && x.key === kv[1])
        if (diff) { res.push(...slotLines(kv[1], skel.get(sid).slots.get(kv[1]))); skip = true; continue }
      } else if (skip && /^[ \t]+\S/.test(l)) continue
      else skip = false
      res.push(l)
    }
    if (sid) flush()
    writeFileSync(deckPath, res.join('\n'))
    out.written = true
  }
  return out
}
const slotLinesOf = vals => vals.flatMap(v => v.split(/\s+\/\s+/)).map(plain).filter(Boolean)
// written to the deck: the skeleton's ` / ` line breaks become lines, `·` bullets become `- `
const slotLines = (key, raw) => {
  const vals = raw.flatMap(v => v.split(/\s+\/\s+/))
  return vals.length === 1 ? [`${key}: ${vals[0]}`] : [`${key}:`, ...vals.map(v => `  ${v.replace(/^(\s*)[·•]\s*/, '$1- ')}`)]
}

// Read a pptx (zip) with the standard library: the text of every slide, `<a:t>` runs joined.
export function pptxText(path) {
  const buf = readFileSync(path)
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end < 0) throw new Error(`${path} is not a zip file`)
  const count = buf.readUInt16LE(end + 10)
  let p = buf.readUInt32LE(end + 16)
  let text = ''
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10); const csize = buf.readUInt32LE(p + 20)
    const nlen = buf.readUInt16LE(p + 28); const elen = buf.readUInt16LE(p + 30); const clen = buf.readUInt16LE(p + 32)
    const lh = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nlen)
    p += 46 + nlen + elen + clen
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue
    const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28)
    const raw = buf.subarray(start, start + csize)
    const xml = (method === 8 ? inflateRawSync(raw) : raw).toString('utf8')
    for (const t of xml.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)) text += `${t[1]} `
    text += '\n'
  }
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

// build/deck.pptx against the sources: every skeleton slot's text is in the pptx, every footnote mark
// (`[x]{sup}`) of the deck source is, and every picture the deck source names exists.
export function verifyBuild(root) {
  const deckPath = wsFile(root, DECK)
  const deckText = readFileSync(deckPath, 'utf8')
  const pptx = join(root, 'build', 'deck.pptx')
  if (!existsSync(pptx)) throw new Error('build/deck.pptx does not exist: build first')
  const flat = s => s.replace(/\s+/g, '')
  const built = flat(pptxText(pptx))
  const absent = []
  let checked = 0
  for (const [sid, s] of slotsOf(readFileSync(wsFile(root, SKELETON), 'utf8'))) {
    for (const key of s.order) {
      for (const v of s.slots.get(key)) {
        // a footnote mark is checked on its own: the text matches with the mark or without it
        // (a table row's cell bars are not text: `| a | b |` is checked as `ab`)
        const want = flat(plain(v.replace(/\[[^\]]*\]\{[^}]*\bsup\b[^}]*\}/g, '')).replace(/\|/g, ''))
        const marked = flat(plain(v).replace(/\|/g, ''))
        if (!want) continue
        checked++
        if (!built.includes(want) && !built.includes(marked)) absent.push({ slide: sid, key, text: v })
      }
    }
  }
  const footnotes = [...deckText.matchAll(/\[([^\]]+)\]\{[^}]*\bsup\b[^}]*\}/g)].map(m => m[1])
  const footnotes_absent = footnotes.filter(f => !built.includes(flat(f)))
  const assets_absent = [...deckText.matchAll(/^\s*[a-z][a-z0-9_]*:[ \t]*(\S+\.(?:png|jpe?g|svg|gif))(?:\s*\|.*)?$/gim)]
    .map(m => m[1]).filter(f => !existsSync(join(dirname(deckPath), f)))
  return { checked, absent, footnotes: footnotes.length, footnotes_absent, assets_absent,
    ok: !absent.length && !footnotes_absent.length && !assets_absent.length }
}

// ── the round's record folder: snapshot/rounds/round-NN/ ──
// What a person reads to see what a round did and why: the skeleton of that round, the feedback and its
// scores (revision mode: previous vs this version), pattern two-version scores, `compare`, the user-proxy
// (noah) verdict written apart, the user's overrides, and report.md where every edit carries its reason.
const PH = '(작성)'
const REPORT_HEAD = n => ['# round ' + n + ' report', '',
  '고친 곳마다 출처(feedback 우선순위 | panel | noah), 근거 파일, 이유를 쓴다. 비어 있으면 round-check가 문제로 센다.', '',
  '## 고친 것', '', '| 쪽 | 칸 | 이전 → 이후 | 출처 | 근거 파일 | 이유 |', '|---|---|---|---|---|---|', '',
  '## 쓰지 않은 지적', '', '| 지적 | 출처 | 쓰지 않은 이유 |', '|---|---|---|', '',
  '## 기본값으로 정한 것', '', `${PH} 없으면 "없음"`, '',
  '## 사용자가 정할 구조', '', `${PH} 쪽 수, 블록, 순서, 본문/부록. 없으면 "없음"`, '',
  '## 검증', '',
  '- 렌더 화면 (고친 쪽):', '- pptx 문구 = skeleton (verify-build):', '- 자산 파일:', '- 각주 쌍:', '- 문장 일치 (claims):', '',
  '## 열린 질문', '', `${PH} docs/확인할-것.md에 날짜와 쪽을 붙여 적은 것. 없으면 "없음"`, ''].join('\n')
const NOAH_HEAD = n => ['# noah 판정 · round ' + n, '',
  '사용자 대리 판정. 패널과 따로, 매 라운드 쓴다. noah가 없으면 이유를 적는다.', '',
  '판정: ', '근거 (noah가 말한 기준, 인용): ', '다음 라운드에 넘길 것: ', ''].join('\n')
const OVERRIDES_HEAD = ['# override', '', '사용자가 지적이나 기본값을 뒤집은 것.', '', '| 지적 또는 기본값 | 사용자 결정 | 날짜 |', '|---|---|---|', ''].join('\n')
const roundDirOf = (root, n) => join(root, ROUNDS_DIR, `round-${String(n).padStart(2, '0')}`)

function writeRoundDir(root, n) {
  const dir = roundDirOf(root, n)
  assertInside(root, dir)
  mkdirSync(dir, { recursive: true })
  const made = []
  const make = (name, body, from) => {
    const p = join(dir, name)
    if (existsSync(p)) return
    if (from && existsSync(from)) copyFileSync(from, p)
    else writeFileSync(p, body)
    made.push(name)
  }
  const skel = wsFile(root, SKELETON)
  if (existsSync(skel)) make(basename(skel), '', skel)
  const fb = join(root, ROUNDS_DIR, `feedback-${n}.md`)
  make('feedback.md', ['# feedback · round ' + n, '', `이전 판과 이번 판을 견준다 (revision 모드). ${PH}`, ''].join('\n'), fb)
  for (const f of ['feedback-before.json', 'feedback-after.json', 'pattern-a.json', 'pattern-b.json', 'compare.json']) make(f, '{}\n')
  make('noah.md', NOAH_HEAD(n))
  make('overrides.md', OVERRIDES_HEAD)
  make('report.md', REPORT_HEAD(n))
  return { dir: relative(root, dir).split(sep).join('/'), made }
}

// The round folder read back: files still templates, and the report's edits without a reason.
export function roundCheck(root, n) {
  if (!isInt(n)) throw new Error('--round N must be a positive integer')
  const dir = roundDirOf(root, n)
  assertInside(root, dir)
  if (!existsSync(dir)) throw new Error(`${relative(root, dir)} does not exist: \`round\` writes it`)
  const read = f => { try { return readFileSync(join(dir, f), 'utf8') } catch { return null } }
  const unfilled = []
  const problems = []
  for (const f of ['feedback-before.json', 'feedback-after.json', 'pattern-a.json', 'pattern-b.json', 'compare.json']) {
    try { if (!Object.keys(JSON.parse(read(f) ?? '{}')).length) unfilled.push(f) } catch { problems.push(`${f}: not JSON`) }
  }
  if ((read('feedback.md') ?? '').includes(PH)) unfilled.push('feedback.md')
  const noah = read('noah.md')
  if (noah === null) problems.push('noah.md is missing: the user-proxy verdict is written every round')
  else if (!/^판정:[ \t]*\S/m.test(noah)) problems.push('noah.md has no 판정')
  const report = read('report.md')
  if (report === null) problems.push('report.md is missing')
  else {
    const sections = new Map()
    let cur = null
    for (const l of report.split('\n')) {
      const h = l.match(/^##\s+(.+?)\s*$/)
      if (h) { cur = h[1]; sections.set(cur, []) } else if (cur) sections.get(cur).push(l)
    }
    const rows = lines => {
      const t = lines.filter(l => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l)).map(l => l.split('|').slice(1, -1).map(c => c.trim()))
      return { head: t[0] ?? [], body: t.slice(1) }
    }
    const need = (title, cols) => {
      const sec = sections.get(title)
      if (!sec) { problems.push(`report.md has no \`## ${title}\` section`); return }
      const { head, body } = rows(sec)
      body.forEach((r, i) => {
        for (const c of cols) {
          const k = head.findIndex(h => h.includes(c))
          if (k < 0) problems.push(`report.md ${title}: no "${c}" column`)
          else if (!r[k] || r[k].includes(PH)) problems.push(`report.md ${title} row ${i + 1} (${r[0] || '?'}): "${c}" is empty`)
        }
      })
    }
    need('고친 것', ['출처', '근거', '이유'])
    need('쓰지 않은 지적', ['출처', '쓰지 않은 이유'])
    for (const t of ['기본값으로 정한 것', '사용자가 정할 구조', '열린 질문']) {
      const sec = sections.get(t)
      if (!sec) problems.push(`report.md has no \`## ${t}\` section`)
      else if (!sec.some(l => l.trim() && !l.includes(PH))) problems.push(`report.md ${t}: empty (write 없음 when there is nothing)`)
    }
    for (const l of sections.get('검증') ?? []) {
      const m = l.match(/^-\s+(.+?):\s*(.*)$/)
      if (m && !m[2].trim()) problems.push(`report.md 검증: "${m[1]}" has no result`)
    }
    if (!sections.has('검증')) problems.push('report.md has no `## 검증` section')
  }
  return { round: n, dir: relative(root, dir).split(sep).join('/'), unfilled, problems, ok: problems.length === 0 }
}

// ── stable: the frozen baseline ──
// skeleton + deck source + resume sources + style/ frozen together under stable/<date>-skeleton-v<ver>/,
// read-only, one row in stable/README.md. Rounds compare against it; it is never edited.
export function freezeStable(root, { note = '', date } = {}) {
  const skelPath = wsFile(root, SKELETON)
  const skel = readFileSync(skelPath, 'utf8')
  const m = skel.match(VERSION)
  if (!m) throw new Error(`${basename(skelPath)} has no \`version: vX.Y.Z\` line`)
  const ver = `v${m[1]}.${m[2]}.${m[3]}`
  const day = date || new Date().toISOString().slice(0, 10)
  const base = join(root, 'stable')
  const dir = join(base, `${day}-skeleton-${ver}`)
  assertInside(root, dir)
  if (existsSync(dir)) throw new Error(`${relative(root, dir)} exists: a stable baseline is never overwritten`)
  mkdirSync(dir, { recursive: true })
  const kept = []
  for (const f of [skelPath, wsFile(root, DECK), wsFile(root, 'resume-skeleton.md'), wsFile(root, RESUME_DECK)]) {
    if (!existsSync(f)) continue
    copyFileSync(f, join(dir, basename(f)))
    kept.push(basename(f))
  }
  const styleDir = at(root, 'style')
  if (existsSync(styleDir)) { cpSync(styleDir, join(dir, 'style'), { recursive: true }); kept.push('style/') }
  const newest = k => {
    try {
      const v = readdirSync(join(root, 'snapshot', k)).map(n => n.match(/-(v\d+\.\d+\.\d+)$/)?.[1]).filter(Boolean)
        .sort((a, b) => { const x = a.slice(1).split('.').map(Number); const y = b.slice(1).split('.').map(Number); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2] })
      return v[0] ?? '-'
    } catch { return '-' }
  }
  const row = `| ${day} | skeleton ${ver} · deck ${newest('deck')} · resume ${newest('resume')} | ${note.replace(/\|/g, '/') || '-'} |`
  const readme = join(base, 'README.md')
  assertInside(root, readme)
  const body = existsSync(readme) ? readFileSync(readme, 'utf8')
    : '# 기준본 (stable)\n\n고정한 판. 고치지 않는다. 라운드는 이 판과 견준다.\n\n| 날짜 | 버전 | 메모 |\n|---|---|---|\n'
  writeFileSync(readme, `${body.replace(/\n*$/, '\n')}${row}\n`)
  // frozen: files read-only (a later write fails instead of editing a baseline)
  const lock = p => { for (const e of readdirSync(p, { withFileTypes: true })) { const q = join(p, e.name); if (e.isDirectory()) lock(q); else chmodSync(q, 0o444) } }
  lock(dir)
  return { stable: relative(root, dir).split(sep).join('/'), skeleton: ver, kept, readme: relative(root, readme).split(sep).join('/') }
}

// ── questions: docs/확인할-것.md ──
// One line per question: `- [ ] 날짜 · N쪽 · 질문`; answered: `- [x] … · 질문 → 답: …` (the user writes the answer).
const Q_LINE = /^- \[( |x|X)\] (\d{4}-\d{2}-\d{2}) · ([^·]+?) · (.+?)(?: → 답: (.+))?\s*$/
export function readQuestions(root) {
  let text = ''
  try { text = readFileSync(at(root, 'docs', '확인할-것.md'), 'utf8') } catch { return { open: [], answered: [], error: 'no docs/확인할-것.md: run scaffold' } }
  const open = []; const answered = []
  for (const l of text.split('\n')) {
    const m = l.match(Q_LINE)
    if (!m) continue
    const q = { date: m[2], page: m[3].trim(), text: m[4].trim() }
    if (m[1] !== ' ' && m[5]) answered.push({ ...q, answer: m[5].trim() })
    else open.push(q)
  }
  return { open, answered }
}
export function addQuestion(root, { text, page, date }) {
  if (typeof text !== 'string' || !text.trim() || text.includes('\n')) throw new Error('--text <question> is required (one line)')
  const day = date || new Date().toISOString().slice(0, 10)
  const where = page === undefined || page === true ? '-' : /쪽$/.test(String(page)) ? String(page) : `${page}쪽`
  const p = at(root, 'docs', '확인할-것.md')
  assertInside(root, p)
  mkdirSync(dirname(p), { recursive: true })
  const body = existsSync(p) ? readFileSync(p, 'utf8') : QUESTIONS_HEAD
  const q = text.trim().replace(/ · /g, ' / ')
  const dup = readQuestions(root).open.some(o => o.page === where && o.text === q)
  if (dup) return { added: false, duplicate: true, page: where, text: q }
  writeFileSync(p, `${body.replace(/\n*$/, '\n')}- [ ] ${day} · ${where} · ${q}\n`)
  return { added: true, date: day, page: where, text: q }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0]
  const root = realpathSync(process.cwd())
  const file = args.file ? join(root, args.file) : wsFile(root, SKELETON)
  let out
  if (cmd === 'layout') {
    out = layout(root)
  } else if (cmd === 'sync') {
    out = sync(root, { write: args.write === true })
  } else if (cmd === 'verify-build') {
    out = verifyBuild(root)
  } else if (cmd === 'snapshot' && args.stable === true) {
    out = freezeStable(root, { note: typeof args.note === 'string' ? args.note : '', date: args.date })
  } else if (cmd === 'round-check') {
    out = roundCheck(root, Number(args.round))
  } else if (cmd === 'questions') {
    if (args.add) out = addQuestion(root, { text: args.text, page: args.page, date: args.date })
    else if (args.read) out = readQuestions(root)
    else throw new Error('usage: questions --add --text <question> [--page N] [--date D] | questions --read')
  } else if (cmd === 'snapshot') {
    out = snapshot(root, { kind: args.kind, level: args.level, note: args.note, by: args.by, date: args.date })
  } else if (cmd === 'renumber') {
    const r = renumber(readFileSync(file, 'utf8'), parseMap(args.map))
    // written only when the result verifies (or with --force); a broken result leaves the file as it was
    const v = verify(r.text)
    const write = !args['dry-run'] && (!v.problems.length || args.force === true)
    if (write) writeFileSync(file, r.text)
    out = { file, changes: r.changes, warnings: r.warnings, written: write, ...v }
    // renumber reads one file; the deck's own page numbers are fixed by hand and said so
    const deck = wsFile(root, DECK)
    if (!/\.mdx$/.test(file) && existsSync(deck)) {
      out.by_hand = [`${basename(deck)}: slide order, \`<!-- N. … -->\` comments and page cells (toc, appendix toc) are not renumbered`]
    }
  } else if (cmd === 'verify') {
    out = verify(readFileSync(file, 'utf8'))
  } else if (cmd === 'compare') {
    if (typeof args.before !== 'string' || typeof args.after !== 'string') throw new Error('--before and --after are required')
    const load = p => JSON.parse(readFileSync(join(root, p), 'utf8'))
    const both = typeof args['claims-before'] === 'string' && typeof args['claims-after'] === 'string'
    out = compare(load(args.before), load(args.after), both ? load(args['claims-before']) : undefined, both ? load(args['claims-after']) : undefined)
  } else if (cmd === 'claims') {
    const text = readFileSync(file, 'utf8')
    const pages = /^##\s+@s\d+/m.test(text) ? deckPages(text) : /(resume\.md|resume-deck\.mdx)$/.test(file) ? resumePages(text) : text
    out = claims(pages, readMaterial(root), settled(root), selection(root), confirmedFacts(root))
    const note = settledNote(root)
    if (note) out.settled_note = note
  } else if (cmd === 'settle') {
    if (typeof args.findings !== 'string') throw new Error('--findings <file> is required: a JSON array of {id, text}')
    const path = resolve(root, args.findings)
    const rel = relative(resolve(root), path)
    if (isAbsolute(args.findings) || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !insideRoot(root, path)) {
      throw new Error(`--findings ${args.findings} must be a path inside the workspace root ${root}`)
    }
    let findings
    try { findings = JSON.parse(readFileSync(path, 'utf8')) } catch (e) { throw new Error(`--findings ${args.findings} cannot be read as JSON: ${e.message}`) }
    if (!Array.isArray(findings)) throw new Error(`--findings ${args.findings} must be a JSON array of {id, text}`)
    findings.forEach((f, i) => {
      if (!f || typeof f !== 'object' || Array.isArray(f) || typeof f.id !== 'string' || typeof f.text !== 'string') {
        throw new Error(`findings[${i}] must be an object with string id and string text`)
      }
    })
    out = settle(findings, settled(root))
    const note = settledNote(root)
    if (note) out.settled_note = note
  } else if (cmd === 'intake') {
    if (typeof args.feedback !== 'string') throw new Error('--feedback <file> is required: the feedback output this round produced')
    const path = resolve(root, args.feedback)
    const rel = relative(resolve(root), path)
    if (isAbsolute(args.feedback) || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !insideRoot(root, path)) {
      throw new Error(`--feedback ${args.feedback} must be a path inside the workspace root ${root}`)
    }
    out = intake(readFileSync(path, 'utf8'))
    if (args.round !== undefined) {
      const n = Number(args.round)
      if (!isInt(n)) throw new Error('--round must be a positive integer')
      const target = join(root, ROUNDS_DIR, `findings-${n}.json`)
      assertInside(root, target)
      mkdirSync(join(root, ROUNDS_DIR), { recursive: true })
      writeFileSync(target, `${JSON.stringify(out.findings, null, 2)}\n`)
      out.written = relative(root, target).split(sep).join('/')
    }
  } else if (cmd === 'step') {
    if (args.input !== '-') throw new Error('--input - is required: one step entry as JSON on stdin')
    let input
    try { input = JSON.parse(readFileSync(0, 'utf8')) } catch (e) { throw new Error(`step input cannot be read as JSON: ${e.message}`) }
    out = step(root, input)
  } else if (cmd === 'round' && args.read === true) {
    out = readRounds(root)
  } else if (cmd === 'round') {
    if (typeof args.input !== 'string') throw new Error('--input <file | -> is required: the round input JSON (path inside the workspace, or - for stdin)')
    let text
    let skip = []
    if (args.input === '-') text = readFileSync(0, 'utf8')
    else {
      const path = resolve(root, args.input)
      const rel = relative(resolve(root), path)
      if (isAbsolute(args.input) || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !insideRoot(root, path)) {
        throw new Error(`--input ${args.input} must be a path inside the workspace root ${root}`)
      }
      try { text = readFileSync(path, 'utf8') } catch (e) { throw new Error(`--input ${args.input} cannot be read: ${e.message}`) }
      skip = [rel.split(sep).join('/')]
    }
    let input
    try { input = JSON.parse(text) } catch (e) { throw new Error(`--input ${args.input} cannot be read as JSON: ${e.message}`) }
    out = round(root, input, { skip })
  } else if (cmd === 'scaffold') {
    out = scaffold(root)
  } else if (cmd === 'selection') {
    out = selection(root) || { error: 'no sources/선정.md: run scaffold' }
  } else if (cmd === 'keep-render') {
    out = keepRender(root, args.version)
  } else {
    throw new Error('usage: manage.mjs layout | scaffold | selection | sync [--write] | verify-build | snapshot [--stable] | renumber | verify | compare | round-check --round N | questions --add|--read | claims | settle --findings <file> | intake --feedback <file> [--round N] | step --input - | round --input <file | -> | round --read | keep-render')
  }
  process.stdout.write(`${JSON.stringify(out)}\n`)
}

const invokedDirectly = () => {
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) } catch { return false }
}
if (invokedDirectly()) {
  try { main() } catch (e) { process.stdout.write(`${JSON.stringify({ error: e.message })}\n`); process.exit(1) }
}
