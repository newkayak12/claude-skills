import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Decision, HarnessRow, PaneTab, RunInfo, RunSub, StageKey } from '../types'
import { MARK, TINT, bar, cap, fmt, isKorean, tabs } from './draw'
import type { Mark } from './draw'
import { DEMO_NOW, bandLines, demoRows, footerFits, innerWidth, paneContent, paneHead, parseDemoArg, renderLines, tabRowPlan } from './harness-draw'
import type { PaneCtx, TabLabels } from './harness-draw'
import type { RowFailure } from './status'
import {
  cycleRun, failureToast, failuresOf, flowLines, frozenOrder, listArgv, markLooked, openTab, otherRunLabel, parseRow, parseRows,
  paneKey, pickRun, reasonFor, runPosition, shownRows, showArgv, spinnerPlan, stageStatus,
} from './status'

const last = atom({ plugin: 'harness', key: 'last' } as const, null as Decision | null)
const armed = atom({ plugin: 'harness', key: 'armed' } as const, false)
const patterns = atom({ plugin: 'harness', key: 'patterns' } as const, [] as string[])
const windowHours = atom({ plugin: 'harness', key: 'windowHours' } as const, 2)
// the config file exists but is not JSON
const broken = atom({ plugin: 'harness', key: 'broken' } as const, false)
const run = atom({ plugin: 'harness', key: 'run' } as const, null as RunInfo | null)
const lang = atom({ plugin: 'harness', key: 'lang' } as const, 'en' as 'en' | 'ko')
// the open runs of `fallback-check --list --json`: the last good list; [] until the first read answers
const rows = atom({ plugin: 'harness', key: 'rows' } as const, [] as HarnessRow[])
// the run the pane shows, by slug; null (or a slug no longer open): opening order decides
const selected = atom({ plugin: 'harness', key: 'selected' } as const, null as string | null)
// per slug, the rejects the person has seen
const looked = atom({ plugin: 'harness', key: 'looked' } as const, {} as Record<string, number>)
// the spinner's frame counter
const spin = atom({ plugin: 'harness', key: 'tick' } as const, 0)
const paneTab = atom({ plugin: 'harness', key: 'paneTab' } as const, 'now' as PaneTab)
const demo = atom({ plugin: 'harness', key: 'demo' } as const, null as 'minimal' | 'full' | 'parallel' | 'narrow' | null)

const PANE = 'harness-status'
const CONFIG = '.claude/harness-gate.json'
const DECISION = '.claude/.harness-last-decision.json'
const TEAMS_CONFIG = '.claude/teams-dispatch.json'
const TICK_MS = 5000
const SPIN_MS = 800 // a spinner frame; faster than the 5 s tick, and only while a shown run acts
const LIST_TIMEOUT_MS = 10_000
const PUSH_GAP_MS = 10 * 60 * 1000
const RUNS = '.harness-run'
const LIVE_MS = 2 * 60 * 60 * 1000
const MAX_READ = 4 * 1024 * 1024
const PASS_PCT = 90 // the pass bar of the run checker (engine fallback check)
const BAR = 24
const LINE_MAX = 24 // flow lines / detail lines drawn before "+n more"
const RUN_STAGES: StageKey[] = ['plan', 'setgoal', 'critique', 'implement', 'gate', 'report']

const en = {
  paneTitle: 'Harness status', tabNow: 'Now', tabFlow: 'Flow', tabFindings: 'Findings', tabRules: 'Gate rules', tabRulesShort: 'Rules',
  prev: 'prev', next: 'next', keysLead: '[ ] run · 1-4 tab · Esc or', keysTail: 'closes', demoOn: 'demo: {name}', demoOff: 'demo off', demoFiles: 'The demo has no run files.',
  stagePlan: 'Plan', stageSetgoal: 'SetGoal', stageCritique: 'Critique', stageImplement: 'Implement/Test', stageGate: 'Gate', stageReport: 'Report',
  tryNo: 'attempt {n}', resPassed: 'passed · {n} tries', resFailed: 'failed · {n} tries', resNone: 'not judged yet', stalled: 'stalled: the retry changed nothing',
  gateRejected: 'gate {n}: rejected', gatePassed: 'gate {n}: passed', critiqueRejected: 'Critique rejected', rules: 'Gate rules',
  goalGate: 'Goal gate', passBar: '{pct}% (pass ≥ {bar})', more: '+{n} more',
  noRun: 'No harness run in this folder.', closeBtn: 'q',
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
    paneTitle: '하네스 상태', tabNow: '지금', tabFlow: '흐름', tabFindings: '발견', tabRules: '게이트 규칙', tabRulesShort: '규칙',
    prev: '이전', next: '다음', keysLead: '[ ] 실행 · 1-4 탭 · Esc 또는', keysTail: '로 닫기', demoOn: '데모: {name}', demoOff: '데모 끝', demoFiles: '데모에는 실행 파일이 없습니다.',
    stagePlan: '계획', stageSetgoal: '목표 설정', stageCritique: '비평', stageImplement: '구현/테스트', stageGate: '게이트', stageReport: '보고',
    tryNo: '{n}번째 시도', resPassed: '통과 · {n}회 시도', resFailed: '실패 · {n}회 시도', resNone: '아직 판정 전', stalled: '멈춤: 재시도로 달라진 것이 없음',
    gateRejected: '게이트 {n}: 반려', gatePassed: '게이트 {n}: 통과', critiqueRejected: '비평 반려', rules: '게이트 규칙',
    goalGate: '목표 게이트', passBar: '{pct}% (통과 ≥ {bar})', more: '+{n}건 더',
    noRun: '이 폴더에 하네스 실행이 없습니다.', closeBtn: 'q',
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

// The files of one run, .harness-run/<slug>/ (the Flow and Gate rules tabs); no slug: the newest live run, else the
// newest by time. Which runs are open, and which one the pane shows, is the node list's and status.ts's call. Why a
// stage failed is the node's too: `failures` are the row's, and reasonFor reads them. Read only.
async function scanRun($: EngineInterface, slug: string | null, failures: readonly RowFailure[]): Promise<RunInfo | null> {
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
  const pick = cands.find(c => c.slug === slug) ?? newest(cands.filter(isLive)) ?? newest(cands)
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
      if (g !== undefined) gates.push({ n, pass: g.pass === true, reason: g.pass === true ? '' : reasonFor(failures, `${pick.slug}|gate|${id}|${n}`) })
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
    critique: { sound: typeof critique?.sound === 'boolean' ? critique.sound : null, reason: critique?.sound === false ? reasonFor(failures, `${pick.slug}|critique`) : '' },
    goalReason: goalPass === false ? reasonFor(failures, `${pick.slug}|goal`) : '',
    lastMs: pick.time,
  }
}

// The events to show: each failure the node gives (`failures` of an open run's row, and of a run finished since the
// session started, which --list leaves out so `--show` is asked, once) written after `start`, and `complete` for a
// finished run with no failure that gave up. The node decides reason, next step and severity (status.ts failureToast
// words them); nothing here reads a run file for them. A key shown once is not shown again (the severity is part of the
// key: a goal gate retry and its later gave-up share the node's key). Read only.
// `outcome` is the run outcome trophy counts: gave up on a subgoal is fail, on the goal gate reject, a clean report pass
type RunOutcome = 'pass' | 'reject' | 'fail'
type RunEvent = { key: string; run: string; text: string; pushText: string | null; timeoutMs?: number; outcome?: RunOutcome }
const GAVE_UP_OUTCOME: Record<string, RunOutcome> = { result: 'fail', goal: 'reject' } // by the kind in the node's key `<run>|<kind>|…`

const failureEvent = (run: string, f: RowFailure): RunEvent => {
  const outcome = f.severity === 'gave up' ? GAVE_UP_OUTCOME[f.key.split('|')[1] ?? ''] : undefined
  return { key: `${f.key}|${f.severity}`, run, ...failureToast(run, f), ...(outcome ? { outcome } : {}) }
}

// one finished run, as the node shows it; no answer (non-zero exit, timeout, not a row) is null
async function showRun($: EngineInterface, dir: string): Promise<HarnessRow | null> {
  try {
    const out = await $.process.run(showArgv($.plugin.root, dir), { timeoutMs: LIST_TIMEOUT_MS })
    return out.exitCode === 0 ? parseRow(out.stdout) : null
  } catch {
    return null
  }
}

async function runEvents($: EngineInterface, start: number, open: readonly HarnessRow[], asked: Set<string>): Promise<RunEvent[]> {
  const out: RunEvent[] = []
  const add = (row: HarnessRow) => {
    for (const f of failuresOf(row)) if (f.at > start) out.push(failureEvent(row.slug, f))
  }
  for (const row of open) add(row)
  const cwd = await $.session.cwd()
  for (const d of await ls($, RUNS)) {
    // graph runs (broker/) are pushed by the graph mod, which sees their rejects too
    if (d.kind !== 'dir' || d.name === 'broker' || asked.has(d.name)) continue
    const report = (await ls($, `${RUNS}/${d.name}`)).find(f => f.name === '05-report.md')
    if (report === undefined || report.mtimeMs <= start) continue
    const row = await showRun($, `${cwd}/${RUNS}/${d.name}`)
    if (row === null) continue // asked again next tick
    asked.add(d.name)
    add(row)
    if (!failuresOf(row).some(f => f.severity === 'gave up')) {
      out.push({ key: `${d.name}|complete`, run: d.name, text: `harness ${d.name}: complete — Report (1/1)`, pushText: null, outcome: 'pass' })
    }
  }
  return out
}

// The open runs from the node CLI (rule 6: the path through $.plugin.root). A non-zero exit, a timeout, a throw or
// output that is not a list is no answer: null, and the caller keeps its last good list.
async function loadRows($: EngineInterface): Promise<HarnessRow[] | null> {
  try {
    const out = await $.process.run(listArgv($.plugin.root, await $.session.cwd()), { timeoutMs: LIST_TIMEOUT_MS })
    return out.exitCode === 0 ? parseRows(out.stdout) : null
  } catch {
    return null
  }
}

// The slug order `[` / `]` walk, fixed until a run opens or closes, or the pane opens from closed or the demo changes
// (then null: opening order decides again). A cache a reload may lose: the order is then worked out once more.
let frozen: string[] | null = null

// What the pane and band draw: the live rows, or the demo's; in the frozen opening order.
async function view($: EngineInterface) {
  const name = await read($, demo)
  const open = name === null ? await read($, rows) : demoRows(name)
  const ordered = frozenOrder(open, await read($, looked), frozen)
  frozen = ordered.map(r => r.slug)
  const sel = await read($, selected)
  return { demo: name, ordered, sel, picked: pickRun(ordered, sel), nowMs: name === null ? await $.clock.now() : DEMO_NOW }
}

async function paneOpen($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some((p: { id: string }) => p.id === PANE)
  } catch {
    return false // panes unreadable: closed
  }
}

// Set at session.start of a session that has a surface, to look at the spinner again with that session's engine (a
// timer is started from it, not from a command or a draw); no surface, never set, no timer. A cache a reload may lose.
let kick: (() => Promise<void>) | null = null
let spinner: { cancel: () => void } | null = null

// The files of the run the Flow and Gate rules tabs show; the demo and no run have none.
async function refreshRun($: EngineInterface) {
  try {
    const v = await view($)
    const found = v.demo !== null || v.picked === null ? null : await scanRun($, v.picked.slug, failuresOf(v.picked))
    await update($, run, () => found)
  } catch {
    // an unreadable run dir leaves the last run as it was
  }
}

// The open runs, read again: the node list, then the run files. Every failure leaves what was there. Returns the live
// list when the node answered (the status line counts it, also in the demo, which draws demo rows instead), else null.
async function refresh($: EngineInterface): Promise<HarnessRow[] | null> {
  let live: HarnessRow[] | null = null
  try {
    live = await loadRows($)
    if (live !== null && (await read($, demo)) === null) await update($, rows, () => live!)
    await refreshRun($)
    // a reject that lands while the pane shows the run has been seen
    if (await paneOpen($)) {
      const shown = (await view($)).picked
      await update($, looked, l => markLooked(l, shown))
    }
  } catch {
    // an unreadable list or run dir leaves the last one as it was
  }
  await kick?.()
  return live
}

// The faster interval: only while a run on screen acts (a pane or the band shows it) and a surface exists; it ends as
// soon as the run waits, stalls or ends, or the pane and band are gone.
async function syncSpinner($: EngineInterface) {
  try {
    const v = await view($)
    const shown = shownRows(v.ordered, v.sel, await paneOpen($))
    const { run: go } = spinnerPlan(shown, (await $.session.surfaces()).length, shown.length > 0)
    if (go && spinner === null) spinner = $.clock.every(SPIN_MS, () => step($))
    else if (!go && spinner !== null) {
      spinner.cancel()
      spinner = null
    }
  } catch {
    // a failed check leaves the timer as it was
  }
}
async function step($: EngineInterface) {
  await syncSpinner($)
  if (spinner !== null) await update($, spin, n => n + 1)
}

// `[` and `]`: the next run by slug, marked as looked at; one run or none, nothing changes
async function cycle($: EngineInterface, by: 1 | -1) {
  const v = await view($)
  const slug = cycleRun(v.ordered, v.sel, by)
  if (slug === (v.picked?.slug ?? null)) return // at an end (or one run): nothing changes
  await update($, selected, () => slug)
  await update($, looked, l => markLooked(l, pickRun(v.ordered, slug)))
  await refreshRun($)
  await kick?.()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if ((await $.session.surfaces()).length === 0) return next(e)
    // a second session.start (a cleared session) starts over: the old interval ends
    spinner?.cancel()
    spinner = null
    frozen = null
    kick = () => syncSpinner($)

    // a failure that needs you or gave up is pushed as well as toasted; a push not sent or thrown costs nothing more
    async function push(message: string) {
      try {
        await $.tool.call({ tool: 'PushNotification', message, status: 'proactive' } as never)
      } catch {
        // a failed push is a push not sent
      }
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

    // failures and completions of runs, once each, none from before the session started
    const told = new Set<string>()
    // one published outcome per (run, outcome): several failed subgoals or a re-written goal gate count once
    const published = new Set<string>()
    // finished runs `--show` has answered for
    const asked = new Set<string>()
    async function notifyRuns() {
      try {
        for (const ev of await runEvents($, startMs, await read($, rows), asked)) {
          if (told.has(ev.key)) continue
          told.add(ev.key)
          const run = ev.run
          if (ev.outcome !== undefined && !published.has(`${run}|${ev.outcome}`)) {
            published.add(`${run}|${ev.outcome}`)
            try {
              await $.state.set({ plugin: 'harness', key: 'outcome' }, { system: 'harness', outcome: ev.outcome, at: await $.clock.now() })
            } catch {
              // fail open: a lost outcome never costs the push
            }
          }
          if (ev.timeoutMs === undefined) $.ui.toast(ev.text)
          else $.ui.toast(ev.text, { timeoutMs: ev.timeoutMs })
          if (ev.pushText !== null) await push(ev.pushText)
        }
      } catch {
        // fail open: a read error is no event
      }
    }

    async function tick() {
      try {
        // the status line: the node's open runs per stage; no answer is no status; the gate's decisions live in /harness-status
        const live = await refresh($)
        $.ui.status(live === null ? undefined : stageStatus(live))
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
    await $.command.register({ name: 'harness-status', description: STRINGS[await read($, lang)].cmdDesc, argumentHint: 'demo [minimal|full|parallel|narrow|off]' })
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
    const first = openTab((await view($)).picked !== null)
    await update($, paneTab, () => first)
    $.clock.every(TICK_MS, tick)

    return next(e)
  })

  // The command opens the pane on the run to look at (Now), or on the gate rules when no run is open; again, it
  // closes it. Esc and q close it too (closeOnEscape, the close button). `demo [name|off]` draws the fixtures instead
  // of the live runs. The answer is one line: the headless reply.
  on('command.run', { command: 'harness-status' }, async ($, e) => {
    const text = STRINGS[await read($, lang)]
    const want = parseDemoArg(e.args ?? '', await read($, demo))
    const isOpen = await paneOpen($)
    if (want === null && isOpen) {
      await $.ui.close({ id: PANE })
      await kick?.()
      return { text: text.paneClosed }
    }
    if (want !== null) {
      await update($, demo, () => (want === 'off' ? null : want))
      await update($, selected, () => null)
      frozen = null
      await refresh($)
    }
    if (!isOpen) frozen = null // a pane opened from closed orders again: an unseen reject leads
    if (want === 'off') return { text: text.demoOff }
    const v = await view($)
    // the run opening order picks is the run shown from here on, by slug: marking its reject as seen must not move it
    const slug = v.picked?.slug ?? null
    await update($, selected, () => slug)
    if (!isOpen) {
      await update($, paneTab, () => openTab(v.picked !== null))
      await update($, looked, l => markLooked(l, v.picked))
      await $.ui.open({ id: PANE, title: 'Harness', focus: true, closeOnEscape: true })
    }
    await refreshRun($)
    await kick?.()
    return { text: want === null ? text.paneOpened : fmt(text.demoOn, { name: want }) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const ui = { Box, Text, Button }
    const s = strings(await read($, lang))
    const v = await view($)
    const r = v.picked
    const files = await read($, run)
    const ri = files !== null && r !== null && files.slug === r.slug ? files : null
    const tab = await read($, paneTab)
    const now = v.nowMs
    const closeBtn = <Button key="close" role="dismiss" label={s('closeBtn')} hotkey="q" onPress={() => $.ui.close({ id: PANE })} />
    const labels = Object.fromEntries(
      (['now', 'flow', 'findings', 'rules'] as const).map(k => [k, { label: s(`tab${cap(k)}` as Key), short: s(k === 'rules' ? 'tabRulesShort' : (`tab${cap(k)}` as Key)) }]),
    ) as TabLabels
    const ctx: PaneCtx = {
      width: innerWidth(e.props.bodyColumns), nowMs: now, tick: await read($, spin),
      pos: runPosition(v.ordered, v.sel), other: otherRunLabel(v.ordered, v.sel), tab,
    }
    const plan = tabRowPlan(ctx, labels)
    const tabRow = tabs(ui, plan.items, tab, k => update($, paneTab, () => k as PaneTab))
    // `[` and `]` cannot be a Button hotkey (one digit or lowercase letter; the engine refuses them): the pane's Input has
    // the focus ring when the pane is opened with focus (the moment hotkeys are armed), takes every printable key, and
    // status.ts paneKey reads the last one; prev / next are Buttons for the pointer
    const onKey = async (text: string) => {
      const key = paneKey(text)
      if (key === null) return
      if (key.kind === 'step') await cycle($, key.by)
      else if (key.kind === 'tab') await update($, paneTab, () => key.tab)
      else await $.ui.close({ id: PANE })
    }
    // prev/next join the keys row only where harness-draw's footerFits says they fit (the keys stay one row; [ and ] still step)
    const steps =
      footerFits({ lead: s('keysLead'), tail: s('keysTail'), prev: s('prev'), next: s('next') }, ctx.width, v.ordered.length).steps ? (
        <Box columnGap={2} flexShrink={1} overflow="hidden">
          <Button key="prev" plain label={s('prev')} onPress={() => cycle($, -1)} />
          <Button key="next" plain label={s('next')} onPress={() => cycle($, 1)} />
        </Box>
      ) : null

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

    // Now and Findings are drawn from the row (harness-draw); Flow and Gate rules read the run's files
    const kind = tab === 'rules' ? 'detail' : 'flow'
    let body
    if (r === null) {
      body = tab === 'rules' ? await rules() : <Text>{s('noRun')}</Text>
    } else if (tab === 'now' || tab === 'findings') {
      body = renderLines(ui, paneContent(r, ctx))
    } else if (ri === null) {
      body = tab === 'rules' ? await rules() : <Text>{s(v.demo === null ? 'noRun' : 'demoFiles')}</Text>
    } else {
      const reasonLine = (text: string, pad: number, key: string) =>
        text === '' ? null : <Text key={key} color="error" wrap="truncate-end">{`${' '.repeat(pad)}↳ ${text}`}</Text>
      const progress =
        ri.match !== null
          ? (
            <Box>
              <Text>{`${s('goalGate')} `}</Text>
              {bar(ui, ri.match, 100, BAR, s('passBar', { pct: ri.match, bar: PASS_PCT }))}
            </Box>
          )
          : bar(ui, ri.done, ri.total, BAR, `${ri.done}/${ri.total}`)
      const rows: unknown[] = []
      if (kind === 'flow') {
        // stages in order; each subgoal opens into its gate verdicts, a retry one level under the reject it answers
        flowLines(ri).forEach((l, i) => {
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
        if (ri.critique.sound === false) {
          rows.push(<Text key="c" color="error" wrap="truncate-end">{`${MARK.failed} ${s('critiqueRejected')}`}</Text>)
          const why = reasonLine(ri.critique.reason, 2, 'cw')
          if (why !== null) rows.push(why)
        }
        ri.subs.forEach((x, i) => {
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
        if (ri.goalReason !== '' && ri.pass === false) {
          rows.push(<Text key="gg" color="error" wrap="truncate-end">{`${MARK.failed} ${s('goalGate')}`}</Text>)
          const why = reasonLine(ri.goalReason, 2, 'ggw')
          if (why !== null) rows.push(why)
        }
      }
      body = (
        <Box flexDirection="column">
          <Box flexDirection="column">
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

    // the header, Now / last step / You and the rail are harness-draw's lines; the tab row and the keys are Buttons
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        {r === null ? <Text bold wrap="truncate-end">{s('paneTitle')}</Text> : renderLines(ui, paneHead(r, ctx))}
        {body}
        <Box marginTop={1} justifyContent="space-between">
          <Box flexShrink={0}>{tabRow}</Box>
          {plan.right !== '' && <Box flexShrink={1} marginLeft={2}><Text dimColor wrap="truncate-end">{plan.right}</Text></Box>}
        </Box>
        <Box columnGap={1}>
          <Box flexShrink={0}><Text dimColor wrap="truncate-end">{s('keysLead')}</Text></Box>
          {closeBtn}
          <Box flexShrink={0}><Text dimColor wrap="truncate-end">{s('keysTail')}</Text></Box>
          {steps}
          <Box flexShrink={1} height={1} overflow="hidden"><Input key="keys" autoFocus value="" placeholder="" onInput={onKey} onSubmit={() => {}} /></Box>
        </Box>
      </Box>
    )
  })

  // the band: three rows for the leading harness run (what it is doing and whether it waits on you / how far / what
  // it cost and what came back last), `+N` for the others. Graph runs are the graph mod's: no row for them here.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await view($)
    if (e.props.hasSurvey || v.ordered.length === 0) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const lines = bandLines(v.ordered, { width: e.props.bodyColumns, nowMs: v.nowMs, tick: await read($, spin) })
    return (
      <Box flexDirection="column">
        {renderLines({ Box, Text, Button }, lines)}
        {await next(e)}
      </Box>
    )
  })
}
