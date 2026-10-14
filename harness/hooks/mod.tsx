import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Decision, OpenRun, OpenRuns, RunInfo, RunSub, StageKey } from '../types'
import { MARK, TINT, bar, cap, fmt, isKorean, rail, tabs } from './draw'
import type { Mark } from './draw'
import { NONE, critiqueReason, flowLines, gateReason, goalReason, sinceLast } from './status'

const last = atom({ plugin: 'harness', key: 'last' } as const, null as Decision | null)
const armed = atom({ plugin: 'harness', key: 'armed' } as const, false)
const patterns = atom({ plugin: 'harness', key: 'patterns' } as const, [] as string[])
const windowHours = atom({ plugin: 'harness', key: 'windowHours' } as const, 2)
// the config file exists but is not JSON
const broken = atom({ plugin: 'harness', key: 'broken' } as const, false)
const runs = atom({ plugin: 'harness', key: 'runs' } as const, { harness: [], graph: [] } as OpenRuns)
const run = atom({ plugin: 'harness', key: 'run' } as const, null as RunInfo | null)
// 'auto' opens on Flow when a run is found, else on Detail (where the gate rules are)
const view = atom({ plugin: 'harness', key: 'view' } as const, 'auto' as 'auto' | 'flow' | 'detail')
const lang = atom({ plugin: 'harness', key: 'lang' } as const, 'en' as 'en' | 'ko')

const PANE = 'harness-status'
const CONFIG = '.claude/harness-gate.json'
const DECISION = '.claude/.harness-last-decision.json'
const TEAMS_CONFIG = '.claude/teams-dispatch.json'
const TICK_MS = 5000
const PUSH_GAP_MS = 10 * 60 * 1000
const RUNS = '.harness-run'
const LIVE_MS = 2 * 60 * 60 * 1000
const MAX_READ = 4 * 1024 * 1024
const PASS_PCT = 90 // the pass bar of the run checker (engine fallback check)
const BAR = 24
const LINE_MAX = 24 // flow lines / detail lines drawn before "+n more"
const RUN_STAGES: StageKey[] = ['plan', 'setgoal', 'critique', 'implement', 'gate', 'report']

const en = {
  paneTitle: 'Harness status', tabFlow: 'Flow', tabDetail: 'Detail',
  stagePlan: 'Plan', stageSetgoal: 'SetGoal', stageCritique: 'Critique', stageImplement: 'Implement/Test', stageGate: 'Gate', stageReport: 'Report',
  now: 'Now', nowImplement: 'Implementing', nowTest: 'Testing', nowGate: 'Gating', nowRetry: 'Retrying',
  nowStage: 'Working on {stage}', nowDone: 'All done', attempt: ' (attempt {n})',
  stateRunning: 'running', stateStalled: 'stalled', stateComplete: 'finished', headLine: '{state} · {done}/{total}',
  tryNo: 'attempt {n}', resPassed: 'passed · {n} tries', resFailed: 'failed · {n} tries', resNone: 'not judged yet', stalled: 'stalled: the retry changed nothing',
  gateRejected: 'gate {n}: rejected', gatePassed: 'gate {n}: passed', critiqueRejected: 'Critique rejected', rules: 'Gate rules',
  goalGate: 'Goal gate', passBar: '{pct}% (pass ≥ {bar})', more: '+{n} more',
  noRun: 'No harness run in this folder.', closeBtn: 'close [q]',
  cmdDesc: 'Open or close the harness status pane: run flow and detail, why the gate denied the last call', paneOpened: 'pane opened', paneClosed: 'pane closed',
  noGate: 'No gate configured: .claude/harness-gate.json is not in this project.',
  badGate: 'Gate config .claude/harness-gate.json could not be read (invalid JSON).',
  gated: 'Gated patterns ({n}): {list}', window: 'Engagement window: {h} h',
  noDecision: 'No gated call decided yet.', lastDecision: 'Last decision: {decision} ({tool} {target}, {ago})', reason: 'Reason: {reason}',
  agoMin: '{n} min ago', agoHour: '{n} h ago',
  // the deny message of the gate hook, after the gated paths
  engage:
    'Engage the harness before editing it: invoke the harness skill and follow its Process - ' +
    'the graph MCP, the Workflow engine, or an Agent Team fallback run whose plan, goal-spec and ' +
    'sound critique are on disk. A mention in text does not engage it.',
}

// one table, two languages; the type keeps the keys identical
export const STRINGS: Record<'en' | 'ko', Record<keyof typeof en, string>> = {
  en,
  ko: {
    paneTitle: '하네스 상태', tabFlow: '흐름', tabDetail: '상세',
    stagePlan: '계획', stageSetgoal: '목표 설정', stageCritique: '비평', stageImplement: '구현/테스트', stageGate: '게이트', stageReport: '보고',
    now: '지금', nowImplement: '구현 중', nowTest: '테스트 중', nowGate: '게이트 판정 중', nowRetry: '재시도 중',
    nowStage: '{stage} 진행 중', nowDone: '모두 끝남', attempt: ' ({n}번째 시도)',
    stateRunning: '진행 중', stateStalled: '멈춤', stateComplete: '완료', headLine: '{state} · {done}/{total}',
    tryNo: '{n}번째 시도', resPassed: '통과 · {n}회 시도', resFailed: '실패 · {n}회 시도', resNone: '아직 판정 전', stalled: '멈춤: 재시도로 달라진 것이 없음',
    gateRejected: '게이트 {n}: 반려', gatePassed: '게이트 {n}: 통과', critiqueRejected: '비평 반려', rules: '게이트 규칙',
    goalGate: '목표 게이트', passBar: '{pct}% (통과 ≥ {bar})', more: '+{n}건 더',
    noRun: '이 폴더에 하네스 실행이 없습니다.', closeBtn: '닫기 [q]',
    cmdDesc: '하네스 상태 창 열기/닫기: 실행 흐름과 상세, 게이트가 마지막 호출을 막은 이유', paneOpened: '창을 열었습니다', paneClosed: '창을 닫았습니다',
    noGate: '게이트 설정 없음: 이 프로젝트에 .claude/harness-gate.json 이 없습니다.',
    badGate: '게이트 설정 .claude/harness-gate.json 을 읽을 수 없습니다 (JSON 오류).',
    gated: '게이트 대상 ({n}): {list}', window: '개입 유효 시간: {h}시간',
    noDecision: '아직 판정한 게이트 호출이 없습니다.', lastDecision: '마지막 판정: {decision} ({tool} {target}, {ago})', reason: '이유: {reason}',
    agoMin: '{n}분 전', agoHour: '{n}시간 전',
    engage:
      '편집 전에 하네스를 켜세요: harness 스킬을 호출해 Process를 따르면 됩니다 - ' +
      'graph MCP, Workflow 엔진, 또는 계획·목표 명세·통과한 비평이 디스크에 있는 Agent Team 대체 실행. ' +
      '글로 언급하는 것만으로는 켜지지 않습니다.',
  },
}

type Key = keyof typeof en
type S = (key: Key, vars?: Record<string, string | number>) => string
const strings = (l: 'en' | 'ko'): S => (key, vars) => fmt(STRINGS[l][key], vars)

// an unparseable or partial decision file is no decision
function parseDecision(text: string): Decision | null {
  try {
    const d = JSON.parse(text) as Partial<Decision> | null
    if (d === null || typeof d !== 'object') return null
    if (typeof d.ts !== 'number' || typeof d.tool !== 'string' || typeof d.target !== 'string') return null
    if (d.decision !== 'allow' && d.decision !== 'deny') return null
    return { ts: d.ts, session_id: d.session_id, tool: d.tool, target: d.target, decision: d.decision, reason: typeof d.reason === 'string' ? d.reason : '' }
  } catch {
    return null
  }
}

const ago = (s: S, ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000))
  return m < 60 ? s('agoMin', { n: m }) : s('agoHour', { n: Math.round(m / 60) })
}

type Ent = { name: string; kind: string; size: number; mtimeMs: number }
const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined

// a list failure means nothing is there
async function ls($: EngineInterface, path: string): Promise<Ent[]> {
  try {
    return (await $.fs.list(path)) as Ent[]
  } catch {
    return []
  }
}

// a missing, oversized or unparseable file is no file
async function readJson($: EngineInterface, path: string, ent?: Ent): Promise<Record<string, unknown> | undefined> {
  if (ent !== undefined && ent.size > MAX_READ) return undefined
  try {
    return asRecord(JSON.parse(await $.fs.read(path)))
  } catch {
    return undefined
  }
}

const firstLine = (v: unknown) => (typeof v === 'string' ? (v.split('\n')[0] ?? '').trim().slice(0, 120) : '')

// the highest n of <prefix>-<n>.<ext> among the names, 0 when none
const maxN = (names: string[], prefix: string) =>
  Math.max(0, ...names.map(n => Number(new RegExp(`^${prefix}-(\\d+)\\.`).exec(n)?.[1] ?? 0)))

const records = (v: unknown) =>
  (Array.isArray(v) ? (v as unknown[]) : []).map(asRecord).filter((r): r is Record<string, unknown> => r !== undefined && typeof r.id === 'string')

// The current run of .harness-run/<run>/: the newest live run, else the newest by time. Read only.
async function scanRun($: EngineInterface): Promise<RunInfo | null> {
  const now = await $.clock.now()
  const cands: { slug: string; files: Ent[]; subs: Record<string, Ent[]>; time: number; finished: boolean }[] = []
  for (const d of await ls($, RUNS)) {
    if (d.kind !== 'dir' || d.name === 'broker') continue
    const base = `${RUNS}/${d.name}`
    const files = await ls($, base)
    const subs: Record<string, Ent[]> = {}
    if (files.some(f => f.name === 'subgoals' && f.kind === 'dir')) {
      for (const sg of await ls($, `${base}/subgoals`)) if (sg.kind === 'dir') subs[sg.name] = await ls($, `${base}/subgoals/${sg.name}`)
    }
    // a run's time counts its subgoal files too
    const all = [...files, ...Object.values(subs).flat()].filter(f => f.kind === 'file')
    cands.push({
      slug: d.name, files, subs,
      time: Math.max(0, ...all.map(f => f.mtimeMs)),
      finished: files.some(f => f.name === '05-report.md'),
    })
  }
  const isLive = (c: (typeof cands)[number]) => !c.finished && now - c.time < LIVE_MS
  const newest = (list: typeof cands) => [...list].sort((a, b) => b.time - a.time)[0]
  const pick = newest(cands.filter(isLive)) ?? newest(cands)
  if (pick === undefined) return null

  const base = `${RUNS}/${pick.slug}`
  const has = (name: string) => pick.files.some(f => f.name === name)
  const get = (name: string) => (has(name) ? readJson($, `${base}/${name}`, pick.files.find(f => f.name === name)) : Promise.resolve(undefined))
  const manifest = await get('manifest.json')
  const spec = await get('02-goal-spec.json')
  const critique = await get('02-critique.json')
  const gate = await get('04-goal-gate.json')

  // subgoal ids: the manifest's order, then the spec's, then any directory
  const fromManifest = records(manifest?.subgoals).sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
  const fromSpec = records(spec?.subgoals)
  const titles = new Map(fromSpec.map(r => [String(r.id), typeof r.title === 'string' ? r.title : '']))
  const ids = [...new Set([...fromManifest.map(r => String(r.id)), ...fromSpec.map(r => String(r.id)), ...Object.keys(pick.subs)])]

  const subs: RunSub[] = []
  let doing: RunInfo['now'] | undefined
  for (const id of ids) {
    const sub = pick.subs[id] ?? []
    const names = sub.map(f => f.name)
    const impl = maxN(names, 'impl')
    const test = maxN(names, 'test')
    const gn = maxN(names, 'gate')
    const dir = `${base}/subgoals/${id}`
    const result = names.includes('result.json') ? await readJson($, `${dir}/result.json`, sub.find(f => f.name === 'result.json')) : undefined
    const lastGate = gn > 0 ? await readJson($, `${dir}/gate-${gn}.json`, sub.find(f => f.name === `gate-${gn}.json`)) : undefined
    const attempt = Math.max(1, impl, test, gn)
    const title = titles.get(id) ?? ''
    // every verdict, so a reject keeps its reason after the retry
    const gates: RunSub['gates'] = []
    for (let n = 1; n <= gn; n++) {
      const g = n === gn ? lastGate : await readJson($, `${dir}/gate-${n}.json`, sub.find(f => f.name === `gate-${n}.json`))
      if (g !== undefined) gates.push({ n, pass: g.pass === true, reason: gateReason(g) })
    }
    let state: Mark = impl > 0 ? 'running' : 'pending'
    if (result?.passed === true) state = 'done'
    else if (result?.passed === false) state = 'failed'
    subs.push({
      id, title, state,
      reason: state === 'failed' && typeof lastGate?.reason === 'string' ? lastGate.reason : '',
      tries: Math.max(Number(result?.attempts ?? 0) || 0, attempt),
      gates, stalled: result?.stalled === true,
    })
    // what the first unfinished subgoal is doing
    if (doing === undefined && result === undefined) {
      if (impl === 0) doing = { kind: 'implement', id, title, attempt }
      else if (test < impl) doing = { kind: 'test', id, title, attempt }
      else if (gn < test) doing = { kind: 'gate', id, title, attempt }
      else if (lastGate?.pass === false) doing = { kind: 'retry', id, title, attempt: gn + 1 }
      else doing = { kind: 'gate', id, title, attempt }
    }
  }

  const match = typeof gate?.match_pct === 'number' ? gate.match_pct : null
  const goalPass = gate === undefined ? null : typeof gate.pass === 'boolean' ? gate.pass : match !== null && match >= PASS_PCT
  const implDone = subs.length > 0 && subs.every(x => x.state === 'done' || x.state === 'failed')
  const raw: { done: boolean; failed?: boolean }[] = [
    { done: has('01-plan.md') },
    { done: spec !== undefined },
    { done: critique !== undefined && critique.sound !== false, failed: critique?.sound === false },
    { done: implDone, failed: implDone && subs.some(x => x.state === 'failed') },
    { done: gate !== undefined, failed: goalPass === false },
    { done: has('05-report.md') },
  ]
  // done up to the first stage that is not; that one runs (or has failed), the rest wait
  let reached = false
  const stages = RUN_STAGES.map((key, i) => {
    const r = raw[i]!
    let state: Mark = 'pending'
    if (r.failed) state = 'failed'
    else if (r.done) state = 'done'
    else if (!reached) state = 'running'
    if (state === 'running' || state === 'failed') reached = true
    return { key, state }
  })
  const current = stages.find(g => g.state === 'running' || g.state === 'failed')
  const nowInfo: RunInfo['now'] =
    pick.finished || current === undefined
      ? { kind: 'done' }
      : current.key === 'implement' && doing !== undefined
        ? doing
        : { kind: 'stage', stage: current.key }

  return {
    slug: pick.slug,
    title: firstLine(manifest?.request) || firstLine(spec?.goal) || pick.slug,
    live: isLive(pick), finished: pick.finished, stages, subs,
    done: subs.filter(x => x.state === 'done').length, total: subs.length,
    now: nowInfo, match, pass: goalPass,
    critique: { sound: typeof critique?.sound === 'boolean' ? critique.sound : null, reason: critiqueReason(critique) },
    goalReason: goalReason(gate),
    lastMs: pick.time,
  }
}

// Open runs per stage, in flow order, this worktree: fallback runs (.harness-run/<slug>/, staged by
// the first missing file: 01-plan.md, 02-goal-spec.json, a sound 02-critique.json, every subgoal's
// result.json, 04-goal-gate.json) and graph runs (.harness-run/broker/runs/<id>.json).
const STAGES = ['plan', 'setgoal', 'critique', 'implement', 'test', 'gate', 'report'] as const
type Stage = (typeof STAGES)[number]
// A run untouched for 12 h is abandoned, not open.
const STALE_MS = 12 * 60 * 60 * 1000
const FINISHED = new Set(['done', 'skipped', 'unreachable'])

export type StageCounts = { harness: Partial<Record<Stage, number>>; graph: Partial<Record<Stage, number>> }

export type { OpenRuns }

const label = (s: Stage) => s.charAt(0).toUpperCase() + s.slice(1)
const counted = (c: Partial<Record<Stage, number>>) =>
  STAGES.filter(s => (c[s] ?? 0) > 0).map(s => `${label(s)}(${c[s]})`).join(' / ')

// `Plan(6) / Implement(11) · graph Implement(3)`; nothing open is no status
export function stageStatus(c: StageCounts): string | undefined {
  const parts = [counted(c.harness), counted(c.graph) ? `graph ${counted(c.graph)}` : ''].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

async function countStages($: EngineInterface, cwd: string, now: number): Promise<{ counts: StageCounts; runs: OpenRuns }> {
  const out: StageCounts = { harness: {}, graph: {} }
  const detail: OpenRuns = { harness: [], graph: [] }
  const add = (kind: 'harness' | 'graph', s: Stage, r: Omit<OpenRun, 'stage'>) => {
    out[kind][s] = (out[kind][s] ?? 0) + 1
    detail[kind].push({ ...r, stage: s })
  }
  const json = async (p: string) => { try { return JSON.parse(await $.fs.read(p)) } catch { return null } }
  const list = async (p: string) => { try { return await $.fs.list(p) } catch { return [] } }
  // this session's worktree only: runs of other worktrees belong to other sessions
  let trees = [cwd]
  try {
    const top = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel'])
    if (top.exitCode === 0 && top.stdout.trim()) trees = [top.stdout.trim()]
  } catch {
    // not a repo: this cwd alone
  }
  for (const tree of trees) {
    const base = `${tree}/.harness-run`
    for (const run of await list(base)) {
      if (run.kind !== 'dir') continue
      const dir = `${base}/${run.name}`
      if (run.name === 'broker') {
        for (const f of await list(`${dir}/runs`)) {
          if (!f.name.endsWith('.json') || now - f.mtimeMs > STALE_MS) continue
          const g = await json(`${dir}/runs/${f.name}`)
          const nodes = (Array.isArray(g?.nodes) ? g.nodes : []) as { stage?: string; state?: string }[]
          if (nodes.some(n => n.stage === 'report' && n.state === 'done')) continue
          const stage = STAGES.find(s => nodes.some(n => n.stage === s && !FINISHED.has(String(n.state))))
          // the request's first line names the run for a person; the run id when there is none
          const request = typeof g?.request === 'string' ? g.request.trim().split('\n')[0].slice(0, 60) : ''
          if (stage) add('graph', stage, { slug: request || f.name.replace(/\.json$/, ''), passed: 0, failed: 0, total: 0 })
        }
        continue
      }
      const files = await list(dir)
      const has = (name: string) => files.some(f => f.name === name)
      if (!has('manifest.json') || has('05-report.md')) continue
      const subs = await list(`${dir}/subgoals`)
      if (now - Math.max(0, ...files.map(f => f.mtimeMs), ...subs.map(f => f.mtimeMs)) > STALE_MS) continue
      const spec = await json(`${dir}/02-goal-spec.json`)
      const crit = await json(`${dir}/02-critique.json`)
      const ids = (Array.isArray(spec?.subgoals) ? spec.subgoals : []).map((s: { id?: unknown }) => String(s.id))
      let passed = 0
      let failed = 0
      for (const id of ids) {
        const r = await json(`${dir}/subgoals/${id}/result.json`)
        if (r?.passed === true) passed++
        else if (r?.passed === false) failed++
      }
      const judged = passed + failed
      add('harness', !has('01-plan.md') ? 'plan'
        : !spec ? 'setgoal'
        : crit?.sound !== true ? 'critique'
        : judged < ids.length ? 'implement'
        : !has('04-goal-gate.json') ? 'gate'
        : 'report', { slug: run.name, passed, failed, total: ids.length })
    }
  }
  return { counts: out, runs: detail }
}

// Reject / failed / complete events of the fallback runs in .harness-run/<slug>/ (and finished graph runs),
// each read from a file written after `start`; keys make them once per (run, where, kind, attempt). Read only.
//   rejected  02-critique.json sound:false; subgoals/<id>/gate-<n>.json pass:false; 04-goal-gate.json
//             pass:false (or match_pct < 90) before 05-report.md (each rewrite is one more attempt)
//   failed    subgoals/<id>/result.json passed:false (retries spent); a failing goal gate once 05-report.md exists
//   complete  05-report.md written with no failure; a graph run whose report node is done
// `outcome` is the run outcome trophy counts (a retry or an attempt-level reject carries none)
type RunOutcome = 'pass' | 'reject' | 'fail'
type RunEvent = { key: string; message: string; outcome?: RunOutcome }
async function runEvents($: EngineInterface, start: number, tries: Map<string, number>): Promise<RunEvent[]> {
  const out: RunEvent[] = []
  const emit = (run: string, where: string, kind: string, attempt: number, max: number | string, outcome?: RunOutcome) =>
    out.push({ key: `${run}|${where}|${kind}|${attempt}`, message: `harness ${run}: ${kind} — ${where} (${attempt}/${max})`, ...(outcome ? { outcome } : {}) })
  // a file rewritten by each retry counts one attempt per write
  const nth = (run: string, where: string, mtime: number) => {
    const id = `${run}|${where}|${mtime}`
    if (!tries.has(id)) tries.set(id, [...tries.keys()].filter(k => k.startsWith(`${run}|${where}|`)).length + 1)
    return tries.get(id)!
  }
  for (const d of await ls($, RUNS)) {
    // graph runs (broker/) are pushed by the graph mod, which sees their rejects too
    if (d.kind !== 'dir' || d.name === 'broker') continue
    const base = `${RUNS}/${d.name}`
    const files = await ls($, base)
    const file = (name: string) => files.find(f => f.name === name)
    const run = d.name
    const mf = file('manifest.json')
    const manifest = mf ? await readJson($, `${base}/manifest.json`, mf) : undefined
    const max = Number.isInteger(manifest?.max_retries) ? Number(manifest?.max_retries) : 2
    let failed = false

    const crit = file('02-critique.json')
    if (crit !== undefined && crit.mtimeMs > start && (await readJson($, `${base}/02-critique.json`, crit))?.sound === false) {
      emit(run, 'Critique', 'rejected', nth(run, 'Critique', crit.mtimeMs), 2)
    }

    for (const sg of await ls($, `${base}/subgoals`)) {
      if (sg.kind !== 'dir') continue
      const dir = `${base}/subgoals/${sg.name}`
      const sub = await ls($, dir)
      for (const g of sub) {
        const n = Number(/^gate-(\d+)\.json$/.exec(g.name)?.[1] ?? 0)
        if (n === 0 || g.mtimeMs <= start) continue
        if ((await readJson($, `${dir}/${g.name}`, g))?.pass === false) emit(run, `QualityGate ${sg.name}`, 'rejected', n, max)
      }
      const res = sub.find(f => f.name === 'result.json')
      const r = res ? await readJson($, `${dir}/result.json`, res) : undefined
      if (r?.passed === false) {
        failed = true
        if (res!.mtimeMs > start) emit(run, `subgoal ${sg.name}`, 'failed', Number(r.attempts) || max, max, 'fail')
      }
    }

    const reported = file('05-report.md')
    const gg = file('04-goal-gate.json')
    if (gg !== undefined && gg.mtimeMs > start) {
      const g = await readJson($, `${base}/04-goal-gate.json`, gg)
      if (g?.pass === false || (typeof g?.match_pct === 'number' && g.match_pct < PASS_PCT && g.pass !== true)) {
        failed = true
        emit(run, 'goal gate', reported ? 'failed' : 'rejected', nth(run, 'goal gate', gg.mtimeMs), max, reported ? 'reject' : undefined)
      }
    }

    if (reported !== undefined && reported.mtimeMs > start && !failed) emit(run, 'Report', 'complete', 1, 1, 'pass')
  }
  return out
}

const SHORT: Record<Stage, string> = { plan: 'Plan', setgoal: 'Goal', critique: 'Crit', implement: 'Impl', test: 'Test', gate: 'Gate', report: 'Rpt' }
const CELLS = 10

// passed ▰ in success, failed ▰ in error, the rest ▱ dim; at least one cell for any run judged
export function barCells(r: OpenRun): { ok: number; bad: number; rest: number } {
  if (r.total === 0) return { ok: 0, bad: 0, rest: CELLS }
  const ok = Math.min(CELLS, Math.round((r.passed / r.total) * CELLS))
  const bad = Math.min(CELLS - ok, Math.round((r.failed / r.total) * CELLS))
  return { ok, bad, rest: CELLS - ok - bad }
}

// a person's words for what the run is on now
function nowSentence(s: S, r: RunInfo): string {
  const n = r.now
  if (n.kind === 'done') return s('nowDone')
  if (n.kind === 'stage') return s('nowStage', { stage: s(`stage${cap(n.stage ?? 'plan')}` as Key) })
  const what = `${s(`now${cap(n.kind)}` as Key)} ${n.id}${n.title ? `: ${n.title}` : ''}`
  return n.attempt !== undefined && (n.attempt > 1 || n.kind === 'retry') ? `${what}${s('attempt', { n: n.attempt })}` : what
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if ((await $.session.surfaces()).length === 0) return next(e)

    // PushNotification's result: { message, pushSent?, localSent?, disabledReason? } (user_present at the terminal);
    // not sent or thrown: the same line as a toast
    async function push(message: string) {
      let sent = false
      try {
        const out = (await $.tool.call({ tool: 'PushNotification', message, status: 'proactive' } as never)) as { result?: unknown }
        const r = asRecord(out?.result)
        sent = r?.pushSent === true || r?.localSent === true
      } catch {
        // a failed push is a push not sent
      }
      if (!sent) $.ui.toast(message)
    }

    const startMs = await $.clock.now()
    // the newest decision timestamp seen; null until the first poll, which only sets the baseline
    let seenTs: number | null = null
    // a deny is pushed (one per path per 10 min); a push not sent, or one skipped, is the toast
    const pushed = new Map<string, number>()
    async function notifyDeny(target: string, message: string) {
      let sent = false
      try {
        const now = await $.clock.now()
        const at = pushed.get(target)
        if (at === undefined || now - at >= PUSH_GAP_MS) {
          pushed.set(target, now)
          // PushNotification's result: { message, pushSent?, localSent?, disabledReason? } (user_present at the terminal)
          const out = (await $.tool.call({ tool: 'PushNotification', message: message.slice(0, 200), status: 'proactive' } as never)) as { result?: unknown }
          const r = asRecord(out?.result)
          sent = r?.pushSent === true || r?.localSent === true
        }
      } catch {
        // a failed push is a push not sent
      }
      if (!sent) $.ui.toast(message, { timeoutMs: 8000 })
    }

    // rejects, failures and completions of runs, once each, none from before the session started
    const told = new Set<string>()
    // one published outcome per (run, outcome): several failed subgoals or a re-written goal gate count once
    const published = new Set<string>()
    const tries = new Map<string, number>()
    async function notifyRuns() {
      try {
        for (const ev of await runEvents($, startMs, tries)) {
          if (told.has(ev.key)) continue
          told.add(ev.key)
          const run = ev.key.split('|')[0]
          if (ev.outcome !== undefined && !published.has(`${run}|${ev.outcome}`)) {
            published.add(`${run}|${ev.outcome}`)
            try {
              await $.state.set({ plugin: 'harness', key: 'outcome' }, { system: 'harness', outcome: ev.outcome, at: await $.clock.now() })
            } catch {
              // fail open: a lost outcome never costs the push
            }
          }
          await push(ev.message.slice(0, 200))
        }
      } catch {
        // fail open: a read error is no event
      }
    }

    async function tick() {
      try {
        // the status line: open runs per stage; the gate's decisions live in /harness-status
        const open = await countStages($, await $.session.cwd(), await $.clock.now())
        $.ui.status(stageStatus(open.counts))
        await update($, runs, () => open.runs)
        try {
          const found = await scanRun($)
          await update($, run, () => found)
        } catch {
          // an unreadable run dir leaves the last run as it was
        }
        await notifyRuns()
        if (!(await $.fs.exists(CONFIG))) {
          await update($, armed, () => false)
          await update($, last, () => null)
          await update($, broken, () => false)
          return
        }
        let cfg: { patterns?: unknown; window_hours?: unknown }
        try {
          cfg = JSON.parse(await $.fs.read(CONFIG)) as typeof cfg
        } catch (err) {
          if (err instanceof SyntaxError) await update($, broken, () => true)
          throw err
        }
        await update($, broken, () => false)
        const list = Array.isArray(cfg.patterns) ? cfg.patterns.map(String) : []
        const hours = Number(cfg.window_hours) > 0 ? Number(cfg.window_hours) : 2
        let decision: Decision | null = null
        if (await $.fs.exists(DECISION)) decision = parseDecision(await $.fs.read(DECISION))
        await update($, patterns, () => list)
        await update($, windowHours, () => hours)
        await update($, armed, () => true)
        await update($, last, () => decision)
        if (decision) {
          if (seenTs !== null && decision.ts > seenTs && decision.decision === 'deny') {
            // teams' dispatch gate has no toast of its own, so this is the one toast when the gates meet
            const meet = await $.fs.exists(TEAMS_CONFIG)
            await notifyDeny(
              decision.target,
              meet
                ? `⛔ harness and teams gates both blocked ${decision.tool}: ${decision.target} — simple dev: graph/harness; spec, planning, QA or unsure: teams:orchestrate`
                : `⛔ goal gate blocked ${decision.tool}: ${decision.target} — finish the harness run, don't script around it`,
            )
          }
          seenTs = Math.max(seenTs ?? 0, decision.ts)
        } else if (seenTs === null) seenTs = 0
      } catch {
        // a read error leaves the gate state as it was
      }
    }

    // Claude Code's own language setting, read once per session
    try {
      const language = (await $.settings.read()).language
      await update($, lang, () => (isKorean(language) ? 'ko' : 'en'))
    } catch {
      // unreadable settings: English
    }
    await $.command.register({ name: 'harness-status', description: STRINGS[await read($, lang)].cmdDesc })
    // a project hook copy that differs from this plugin's own is out of date (installed once, never refreshed)
    try {
      const copy = '.claude/hooks/goal-gate.mjs'
      if ((await $.fs.exists(copy)) && (await $.fs.read(copy)) !== (await $.fs.read(`${$.plugin.root}/hooks/goal-gate.mjs`))) {
        $.ui.toast('⚠ project goal gate is out of date — run harness:update', { timeoutMs: 8000 })
      }
    } catch {
      // unreadable: say nothing
    }
    await tick()
    $.clock.every(TICK_MS, tick)

    return next(e)
  })

  // the command opens the pane on Detail (the gate rules and why the last call was denied); again, it closes it.
  // Esc and q close it too (closeOnEscape, the close button)
  on('command.run', { command: 'harness-status' }, async $ => {
    const text = STRINGS[await read($, lang)]
    let isOpen = false
    try {
      isOpen = (await $.ui.panes()).some((p: { id: string }) => p.id === PANE)
    } catch {
      // panes unreadable: open it
    }
    if (isOpen) {
      await $.ui.close({ id: PANE })
      return { text: text.paneClosed }
    }
    await update($, view, () => 'detail' as const)
    await $.ui.open({ id: PANE, title: 'Harness', focus: true, closeOnEscape: true })
    return { text: text.paneOpened }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const ui = { Box, Text, Button }
    const s = strings(await read($, lang))
    const r = await read($, run)
    const picked = await read($, view)
    const kind = picked === 'auto' ? (r === null ? 'detail' : 'flow') : picked
    const now = await $.clock.now()
    const closeBtn = <Button key="close" role="dismiss" label={s('closeBtn')} hotkey="q" onPress={() => $.ui.close({ id: PANE })} />

    const items = (['flow', 'detail'] as const).map(k => ({ key: k, label: s(`tab${cap(k)}` as Key) }))
    const tabRow = tabs(ui, items, kind, k => update($, view, () => k as 'flow' | 'detail'))

    // the gate's own rules and its last decision (the part of the pane that answers a deny)
    const rules = async () => {
      if (!(await read($, armed))) return <Text>{s((await read($, broken)) ? 'badGate' : 'noGate')}</Text>
      const list = await read($, patterns)
      const hours = await read($, windowHours)
      const d = await read($, last)
      return (
        <Box flexDirection="column">
          <Text>{s('gated', { n: list.length, list: list.join(', ') })}</Text>
          <Text>{s('window', { h: hours })}</Text>
          {d === null ? (
            <Text>{s('noDecision')}</Text>
          ) : (
            <Box flexDirection="column">
              <Text>{s('lastDecision', { decision: d.decision, tool: d.tool, target: d.target, ago: ago(s, now - d.ts) })}</Text>
              <Text>{s('reason', { reason: d.reason })}</Text>
            </Box>
          )}
          <Text>{s('engage')}</Text>
        </Box>
      )
    }

    let body
    if (r === null) {
      body = kind === 'detail' ? await rules() : <Text>{s('noRun')}</Text>
    } else {
      const reasonLine = (text: string, pad: number, key: string) =>
        text === '' ? null : <Text key={key} color="error" wrap="truncate-end">{`${' '.repeat(pad)}↳ ${text}`}</Text>
      const progress =
        r.match !== null
          ? (
            <Box>
              <Text>{`${s('goalGate')} `}</Text>
              {bar(ui, r.match, 100, BAR, s('passBar', { pct: r.match, bar: PASS_PCT }))}
            </Box>
          )
          : bar(ui, r.done, r.total, BAR, `${r.done}/${r.total}`)
      const rows: unknown[] = []
      if (kind === 'flow') {
        // stages in order; each subgoal opens into its gate verdicts, a retry one level under the reject it answers
        flowLines(r).forEach((l, i) => {
          const pad = l.kind === 'attempt' ? 2 + Math.min(l.depth, 4) * 2 : 0
          const name =
            l.kind === 'stage' ? s(`stage${cap(l.stage!)}` as Key)
            : l.kind === 'sub' ? `${l.id}${l.title ? ` ${l.title}` : ''}`
            : s('tryNo', { n: l.n ?? 0 })
          rows.push(
            <Text key={`f${i}`} wrap="truncate-end">
              {' '.repeat(pad)}
              <Text color={TINT[l.state]}>{MARK[l.state]}</Text>
              {` ${name}`}
            </Text>,
          )
          const why = reasonLine(l.reason, pad + 2, `w${i}`)
          if (why !== null) rows.push(why)
        })
      } else {
        // per subgoal: the result and every gate verdict; the critique and the goal gate when they rejected
        if (r.critique.sound === false) {
          rows.push(<Text key="c" color="error" wrap="truncate-end">{`${MARK.failed} ${s('critiqueRejected')}`}</Text>)
          const why = reasonLine(r.critique.reason, 2, 'cw')
          if (why !== null) rows.push(why)
        }
        r.subs.forEach((x, i) => {
          rows.push(<Text key={`s${i}`} wrap="truncate-end"><Text color={TINT[x.state]}>{MARK[x.state]}</Text>{` ${x.id}${x.title ? ` ${x.title}` : ''}`}</Text>)
          const result = x.state === 'done' ? s('resPassed', { n: x.tries }) : x.state === 'failed' ? s('resFailed', { n: x.tries }) : s('resNone')
          rows.push(<Text key={`r${i}`} dimColor wrap="truncate-end">{`  ${result}${x.stalled ? ` · ${s('stalled')}` : ''}`}</Text>)
          x.gates.forEach(gt =>
            rows.push(
              <Text key={`g${i}-${gt.n}`} color={gt.pass ? undefined : 'error'} wrap="truncate-end">
                {`  ${s(gt.pass ? 'gatePassed' : 'gateRejected', { n: gt.n })}${gt.reason !== '' && !gt.pass ? ` — ${gt.reason}` : ''}`}
              </Text>,
            ),
          )
        })
        if (r.goalReason !== '' && r.pass === false) {
          rows.push(<Text key="gg" color="error" wrap="truncate-end">{`${MARK.failed} ${s('goalGate')}`}</Text>)
          const why = reasonLine(r.goalReason, 2, 'ggw')
          if (why !== null) rows.push(why)
        }
      }
      body = (
        <Box flexDirection="column">
          {kind === 'flow' && rail(ui, r.stages.map(g => ({ label: s(`stage${cap(g.key)}` as Key), state: g.state })))}
          <Box flexDirection="column" marginY={1}>
            {rows.slice(0, LINE_MAX)}
            {rows.length > LINE_MAX && <Text dimColor>{`  ${s('more', { n: rows.length - LINE_MAX })}`}</Text>}
          </Box>
          {progress}
          {kind === 'detail' && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>{s('rules')}</Text>
              {await rules()}
            </Box>
          )}
        </Box>
      )
    }

    // Now: the stage or subgoal at work, the agent (the harness records none), time since the last file change
    const nowLine = r === null ? null : r.now.kind === 'done' ? `▶ ${s('now')} · ${nowSentence(s, r)}` : `▶ ${s('now')} · ${nowSentence(s, r)} · ${NONE}${sinceLast(r, now) === '' ? '' : ` · ${sinceLast(r, now)}`}`
    const state = r === null ? '' : r.finished ? s('stateComplete') : r.live ? s('stateRunning') : s('stateStalled')
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        <Box>
          <Box flexShrink={1}><Text bold wrap="truncate-end">{r === null ? s('paneTitle') : r.title}</Text></Box>
          {r !== null && <Box flexShrink={1} marginLeft={2}><Text dimColor wrap="truncate-end">{r.slug}</Text></Box>}
          {r !== null && (
            <Box flexShrink={0} marginLeft={2}>
              <Text color="claude">{s('headLine', { state, done: r.done, total: r.total })}</Text>
            </Box>
          )}
        </Box>
        {nowLine !== null && <Box marginTop={1}><Text color="claude" bold wrap="truncate-end">{nowLine}</Text></Box>}
        <Box marginY={1} justifyContent="space-between">
          <Box flexShrink={0}>{tabRow}</Box>
          <Box flexShrink={0} marginLeft={2}>{closeBtn}</Box>
        </Box>
        {body}
      </Box>
    )
  })

  // the band: one pipeline row per kind with open runs; a stage with runs is a chip with a hover card
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const open = await read($, runs)
    const kinds = (['harness', 'graph'] as const).filter(k => open[k].length > 0)
    if (e.props.hasSurvey || kinds.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {kinds.map(kind => {
          const stages = STAGES.filter(s => kind === 'graph' || s !== 'test')
          const count = (s: Stage) => open[kind].filter(r => r.stage === s).length
          // full labels while the row fits 80 columns, short ones past that
          const width = (names: (s: Stage) => string) =>
            9 + stages.reduce((n, s) => n + names(s).length + (count(s) > 0 ? String(count(s)).length + 1 : 0), 0) + 3 * (stages.length - 1)
          const name = width(label) <= 76 ? label : (s: Stage) => SHORT[s]
          return (
            <Box key={kind} flexShrink={1}>
              <Text dimColor>{kind.padEnd(8)} </Text>
              {stages.map((s, i) => {
                const rows = open[kind].filter(r => r.stage === s)
                return (
                  <Box key={s} flexShrink={1} hover={rows.length > 0 ? { scope: `${kind}-${s}` } : undefined}>
                    {i > 0 && <Text dimColor>{' ━ '}</Text>}
                    {rows.length === 0 ? (
                      <Text dimColor color="inactive" wrap="truncate-end">{name(s)}</Text>
                    ) : (
                      <Text bold color="claude" wrap="truncate-end">{`${name(s)} ${rows.length}`}</Text>
                    )}
                  </Box>
                )
              })}
            </Box>
          )
        })}
        {/* one hidden card per lit chip, in the flow under the rows: the band's region holds it */}
        {kinds.flatMap(kind =>
          STAGES.map(s => ({ s, rows: open[kind].filter(r => r.stage === s) }))
            .filter(c => c.rows.length > 0)
            .map(({ s, rows }) => (
              <Box
                key={`card-${kind}-${s}`}
                display="none"
                hover={{ scope: `${kind}-${s}`, display: 'flex' }}
                flexDirection="column"
                borderStyle="round"
                borderColor="claude"
                paddingX={1}
              >
                <Text dimColor>{`${kind} · ${label(s)}`}</Text>
                {rows.map(r => {
                  const b = barCells(r)
                  return (
                    <Box key={r.slug} gap={1}>
                      <Text wrap="truncate-end">{r.slug}</Text>
                      {kind === 'harness' && (
                        <Text>
                          <Text color="success">{'▰'.repeat(b.ok)}</Text>
                          <Text color="error">{'▰'.repeat(b.bad)}</Text>
                          <Text dimColor>{'▱'.repeat(b.rest)}</Text>
                          {` ${r.passed}/${r.total}`}
                        </Text>
                      )}
                      {r.failed > 0 && <Text color="error">{`${r.failed} failed`}</Text>}
                    </Box>
                  )
                })}
              </Box>
            )),
        )}
        {await next(e)}
      </Box>
    )
  })
}
