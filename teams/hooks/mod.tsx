import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Decision, DecisionsPayload, Mark, PaneView, ReportPayload, StatusInfo, SummaryItem, SummaryTask, SummaryTaskEntry, TeamsEvent, TeamsView } from '../types'
import { fallbackSelection, paneKey, paneSlash, stepClamp, storyRows } from './pane'
import { STORY_SHRINK, columnWidths, epicCells, epicState, handoffCells, renderLines, rowLine, since, storyCells, tabRowPlan, footerPlan, workerCells } from './teams-draw'
import type { Line } from './teams-draw'

const cursor = atom({ plugin: 'teams', key: 'cursor' } as const, 0)
const status = atom({ plugin: 'teams', key: 'status' } as const, null as StatusInfo | null)
const summary = atom({ plugin: 'teams', key: 'summary' } as const, null as SummaryTask | null)
const teams = atom({ plugin: 'teams', key: 'teams' } as const, null as TeamsView | null)
const decisions = atom({ plugin: 'teams', key: 'decisions' } as const, null as { task_id: string; card: string | null; payload: DecisionsPayload } | null)
const selected = atom({ plugin: 'teams', key: 'selected' } as const, null as string | null)
const watch = atom({ plugin: 'teams', key: 'watch' } as const, [] as string[])
const view = atom({ plugin: 'teams', key: 'view' } as const, 'floor' as PaneView)
// every listed EPIC (live first, then stalled), the ids of the tick before, the one the pane shows, and the STORY row `g` opens
const tasks = atom({ plugin: 'teams', key: 'tasks' } as const, [] as SummaryTaskEntry[])
const taskIds = atom({ plugin: 'teams', key: 'taskIds' } as const, [] as string[])
const epic = atom({ plugin: 'teams', key: 'epic' } as const, null as string | null)
const row = atom({ plugin: 'teams', key: 'row' } as const, 0)
// the spinner frame beside an acting worker; moved by the 800 ms clock only while a worker acts
const frame = atom({ plugin: 'teams', key: 'frame' } as const, 0)
// the report of one task: keyed to the task it was fetched for, so a card or tab never draws another's
const report = atom({ plugin: 'teams', key: 'report' } as const, null as { task_id: string; payload: ReportPayload } | null)
// the report behind the end-of-run card: its own atom, so an open Report tab on another task never
// replaces it (nor it the tab)
const cardReport = atom({ plugin: 'teams', key: 'cardReport' } as const, null as { task_id: string; payload: ReportPayload } | null)
const lang = atom({ plugin: 'teams', key: 'lang' } as const, 'en' as 'en' | 'ko')

// the end-of-run card per ended task: 'card' while it is shown, 'seen' once its report was opened,
// 'dismissed' on the person's say-so
type Ended = Record<string, 'card' | 'seen' | 'dismissed'>
const ended = atom({ plugin: 'teams', key: 'ended' } as const, {} as Ended)
const mark = (m: Ended, id: string, state: Ended[string]): Ended => ({ ...m, [id]: state })

const PANE = 'teams-status'
// opened by the person: it takes the keys, and Escape hands them back by closing it
const OPEN = { id: PANE, title: 'Teams', focus: true, closeOnEscape: true } as const

const en = {
  tabFloor: 'Floor', tabStories: 'STORYs', tabDecisions: 'Decisions', tabLog: 'Log', tabReport: 'Report', close: 'q close',
  teamPlanning: 'Planning', teamDevelop: 'Develop', teamQa: 'QA', teamAudit: 'Audit', teamEpic: 'EPIC', nodeWaiting: 'waiting for you',
  decAll: 'all cards', decCard: 'Card {c}', decNone: 'No decisions recorded yet.',
  kindProposal: 'proposed', kindRetry: 'retry', kindRejudge: 're-judge', kindResplit: 're-split', kindDefect: 'defect filed', kindAnswer: 'answered', kindDecision: 'decided',
  vAccept: 'accepted', vSound: 'sound', vVerified: 'verified', vReject: 'rejected', vJudgeFailed: 'could not judge',
  lineBlocking: 'blocking', lineProblems: 'problems', lineGaps: 'gaps', lineEvidence: 'evidence',
  paneClosed: 'pane closed',
  cardFinished: 'finished', cardBlocked: 'blocked', cardFailed: 'failed {n}', cardMore: '+{n} more', reportButton: 'report', dismiss: '×',
  reportMissing: 'No report yet: {path}', reportTruncated: 'Shortened: {n} more lines in the file.',
  stages: 'Stages', work: 'Work', cost: 'Cost',
  youOthers: '{n} more in other runs', costLine: '{usd} · {turns} turns',
  headLine: '{state} · {done}/{total}', wordIdle: 'idle', wordDone: 'done', wordStalled: 'stalled', wordFailed: 'failed', bandDone: '{done}/{total} done',
  stateRunning: 'running', stateStalled: 'stalled', stateComplete: 'finished', stateFailed: 'failed',
  stagePlan: 'Plan', stageBuild: 'Build', stageIntegrate: 'Integrate', stageQa: 'QA', stageGate: 'Final gate', stageReport: 'Report',
  nowFix: 'Fixing defect', nowFixnext: 'Waiting to fix defect', nowBuild: 'Building', nowPlan: 'Planning', nowQa: 'QA', nowAnswer: 'Waiting for your answer',
  nowIntegrate: 'Integrating', nowGate: 'Final gate', nowReport: 'Writing the report', nowDone: 'All done', nowIdle: 'Idle',
  logPassed: '{s} passed', logFailed: '{s} failed', logFiled: '{s} filed', logIntegrated: '{s} integrated',
  logDispatched: '{s} started', logWaiting: '{s} waiting for you', logFinished: '{s} finished',
  noRun: 'No teams run in this session.', loading: 'Loading...', noLog: 'Nothing logged yet.',
  workMore: '+{n} more', cmdDesc: 'Open or close the teams status pane', paneOpened: 'pane opened',
  board: 'board', inboxOne: '{n} question for you', inboxMany: '{n} questions for you', statusWaiting: 'needs you: {n} waiting - open /teams-status',
  pushRejected: 'rejected', pushNeedsYou: 'needs you', pushEnded: 'run ended', nodeFailed: 'failed',
  prev: '◀', next: '▶', keysHint: '[ ] EPIC · j k row · 1-5 tabs', openHint: 'g open run', noStories: 'No STORY at work.',
}

// one table, two languages; the type keeps the keys identical
export const STRINGS: Record<'en' | 'ko', Record<keyof typeof en, string>> = {
  en,
  ko: {
    tabFloor: '현장', tabStories: '스토리', tabDecisions: '결정', tabLog: '기록', tabReport: '보고서', close: 'q 닫기',
    teamPlanning: '기획', teamDevelop: '개발', teamQa: 'QA', teamAudit: '감사', teamEpic: '에픽', nodeWaiting: '답변 대기',
    decAll: '전체 카드', decCard: '카드 {c}', decNone: '아직 기록된 결정이 없습니다.',
    kindProposal: '제안', kindRetry: '재시도', kindRejudge: '재판정', kindResplit: '재분할', kindDefect: '결함 등록', kindAnswer: '답변', kindDecision: '결정',
    vAccept: '승인', vSound: '타당', vVerified: '검증됨', vReject: '반려', vJudgeFailed: '판정 실패',
    lineBlocking: '차단', lineProblems: '문제', lineGaps: '누락', lineEvidence: '근거',
    paneClosed: '창을 닫았습니다',
    cardFinished: '끝남', cardBlocked: '막힘', cardFailed: '실패 {n}', cardMore: '+{n}건 더', reportButton: '보고서', dismiss: '×',
    reportMissing: '아직 보고서가 없습니다: {path}', reportTruncated: '일부만 표시: 파일에 {n}줄 더 있습니다.',
    stages: '단계', work: '작업', cost: '비용',
    youOthers: '다른 실행에 {n}건 더', costLine: '{usd} · {turns}턴',
    headLine: '{state} · {done}/{total}', wordIdle: '유휴', wordDone: '완료', wordStalled: '멈춤', wordFailed: '실패', bandDone: '{done}/{total} 완료',
    stateRunning: '진행 중', stateStalled: '멈춤', stateComplete: '완료', stateFailed: '실패',
    stagePlan: '계획', stageBuild: '구현', stageIntegrate: '통합', stageQa: 'QA', stageGate: '최종 관문', stageReport: '보고',
    nowFix: '결함 수정 중', nowFixnext: '결함 수정 대기', nowBuild: '구현 중', nowPlan: '계획 중', nowQa: 'QA 중', nowAnswer: '답변 대기 중',
    nowIntegrate: '통합 중', nowGate: '최종 관문', nowReport: '보고서 작성 중', nowDone: '모두 끝남', nowIdle: '대기 중',
    logPassed: '{s} 통과', logFailed: '{s} 실패', logFiled: '{s} 등록', logIntegrated: '{s} 반영',
    logDispatched: '{s} 시작', logWaiting: '{s} 답변 대기', logFinished: '{s} 끝남',
    noRun: '이 세션에 팀 실행이 없습니다.', loading: '불러오는 중...', noLog: '아직 기록이 없습니다.',
    workMore: '+{n}건 더', cmdDesc: '팀 현황 창 열기/닫기', paneOpened: '창을 열었습니다',
    board: '보드', inboxOne: '질문 {n}건', inboxMany: '질문 {n}건', statusWaiting: '확인 필요: {n}건 대기 - /teams-status 열기',
    pushRejected: '반려', pushNeedsYou: '확인 필요', pushEnded: '실행 종료', nodeFailed: '실패',
    prev: '◀', next: '▶', keysHint: '[ ] 에픽 · j k 행 · 1-5 탭', openHint: 'g 실행 열기', noStories: '진행 중인 스토리가 없습니다.',
  },
}

// a key the table lacks (a state or kind this mod does not know) formats to ''
const fmt = (text: string | undefined, vars: Record<string, string | number> = {}) =>
  (text ?? '').replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))

const MARK: Record<Mark, string> = { done: '✔', running: '●', pending: '○', failed: '✘' }
// the stage rail: a dot per stage, a solid rail up to where the run is, dotted after
const DOT: Record<Mark, string> = { done: '●', running: '◉', pending: '○', failed: '✘' }
const TINT: Record<Mark, string> = { done: 'success', running: 'claude', pending: 'inactive', failed: 'error' }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const VERDICT_WORD: Record<string, keyof typeof en> = { accept: 'vAccept', sound: 'vSound', verified: 'vVerified', reject: 'vReject', judge_failed: 'vJudgeFailed' }

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined

// task_id of a tm_open/tm_run result: structuredContent first, then JSON in content[0].text
function taskIdOf(r: { result?: unknown; text?: unknown }): string | undefined {
  const res = asRecord(r.result)
  const fromStructured = asRecord(res?.structuredContent)?.task_id
  if (typeof fromStructured === 'string' && fromStructured !== '') return fromStructured
  const content = res?.content
  const first = Array.isArray(content) ? asRecord(content[0])?.text : r.text
  if (typeof first !== 'string') return undefined
  try {
    const id = asRecord(JSON.parse(first))?.task_id
    return typeof id === 'string' && id !== '' ? id : undefined
  } catch {
    return undefined
  }
}

// the pane's task: the picked EPIC, else the last watched one, else this cwd's newest running one (from the tick's status)
async function paneTask($: EngineInterface): Promise<string | undefined> {
  return (await read($, epic)) ?? (await read($, watch)).at(-1) ?? (await read($, status))?.latest ?? undefined
}

// a person's words for the card the task is on now
function nowSentence(s: (key: keyof typeof en) => string, task: SummaryTask): string {
  const label = s(`now${cap(task.now.kind)}` as keyof typeof en) || s('nowIdle')
  return task.now.subject ? `${label}: ${task.now.subject}` : label
}

// One report call for a task: the payload is stored under that task's id. A failed call or
// unreadable output leaves what was stored.
async function fetchReport($: EngineInterface, taskId: string, forCard = false): Promise<void> {
  try {
    const cwd = await $.session.cwd()
    const r = await $.process.run(['node', `${$.plugin.root}/scripts/view.mjs`, '--once', '--format', 'report', '--task', taskId, '--cwd', cwd])
    if (r.exitCode !== 0) return
    const payload = JSON.parse(r.stdout.trim().split('\n').pop() ?? '') as ReportPayload
    if (forCard) await update($, cardReport, () => ({ task_id: taskId, payload }))
    else await update($, report, () => ({ task_id: taskId, payload }))
  } catch {
    // a failed call keeps the last payload
  }
}

// One decisions call for a task (and the picked card); a failed call keeps what was stored.
async function fetchDecisions($: EngineInterface, taskId: string): Promise<void> {
  try {
    const cwd = await $.session.cwd()
    const card = await read($, selected)
    const r = await $.process.run(['node', `${$.plugin.root}/scripts/view.mjs`, '--once', '--format', 'decisions', '--task', taskId, '--cwd', cwd, ...(card === null ? [] : ['--card', card])])
    if (r.exitCode !== 0) return
    const payload = JSON.parse(r.stdout.trim().split('\n').pop() ?? '') as DecisionsPayload
    await update($, decisions, () => ({ task_id: taskId, card, payload }))
  } catch {
    // a failed call keeps the last payload
  }
}

// the task whose card is shown now: the latest one still marked 'card'
const cardTask = (m: Record<string, string>) => Object.keys(m).filter(k => m[k] === 'card').at(-1)

// push kinds: a reject (a failed node or spent fix rounds), a person must act, the run ended
const PUSH_KIND: Record<string, keyof typeof en> = {
  node_finish: 'pushRejected', upstream_fix_rounds_exhausted: 'pushRejected',
  waiting_human: 'pushNeedsYou', daemon_done: 'pushEnded', daemon_exhausted: 'pushEnded',
}

// A failed node_finish as view.mjs tells it (scripts/lib/view-events.mjs): the node worked out the run,
// node, reason and next step; the mod only draws them. A line missing any of them is an old-shape line.
// (A local extension: teams/types is not this change's to edit.)
type FailedFinish = TeamsEvent & { run?: string; node?: string; reason?: string; next_step?: string | null; severity?: string }
type Failure = { run: string; node: string; reason: string; next: string | null; severity: 'info' | 'failure' }

function failureOf(one: FailedFinish): Failure | null {
  const { run, node, reason, next_step: next, severity } = one
  if (one.kind !== 'node_finish' || typeof run !== 'string' || typeof node !== 'string' || typeof reason !== 'string') return null
  if (severity !== 'info' && severity !== 'failure') return null
  if (next !== undefined && next !== null && typeof next !== 'string') return null
  return { run, node, reason, next: next ?? null, severity }
}

// `<node> failed: <reason> → <next step>`, the arrow left out when there is no next step
const failureWhat = (f: Failure, word: string) => `${f.node} ${word}: ${f.reason}${f.next === null ? '' : ` → ${f.next}`}`

const FAIL_TOAST_MS = 10000
const PUSH_MAX = 200

// info (retry, reshape, nothing yet) is ↻ with the default timeout; a person must act ⚠, gave up ✗, both held longer
function toastFailure($: EngineInterface, f: Failure, word: string): void {
  if (f.severity === 'info') $.ui.toast(`↻ ${f.run} ${failureWhat(f, word)}`)
  else $.ui.toast(`${f.next === 'needs you' ? '⚠' : '✗'} ${f.run} ${failureWhat(f, word)}`, { timeoutMs: FAIL_TOAST_MS })
}

// One push for an event, `teams <task>: <kind> - <what>`. The event's text already toasts, so a push not
// sent (user at the terminal, off, throw) needs no second toast. Fail open: nothing here may throw.
async function pushEvent($: EngineInterface, one: TeamsEvent, sent: Set<string>): Promise<void> {
  try {
    const kind = PUSH_KIND[one.kind]
    // a failed node pushes only once it needs you or gave up; a retry or reshape is a toast
    const failed = failureOf(one)
    if (failed !== null && failed.severity !== 'failure') return
    // once per (task, kind, package, attempt); the ts keeps two lines of one attempt apart
    const key = `${one.task_id}|${one.kind}|${one.package ?? ''}|${one.attempt ?? ''}|${one.text}|${one.ts}`
    if (kind === undefined || sent.has(key)) return
    sent.add(key)
    // the run outcome trophy counts, from the daemon's state field; any other state is no outcome
    const outcome =
      one.kind === 'daemon_exhausted' ? 'fail'
        : one.kind !== 'daemon_done' ? undefined
          : one.state === 'complete' ? 'pass'
            : one.state === 'partial' ? 'reject'
              : one.state === 'blocked' ? 'fail'
                : undefined
    if (outcome !== undefined) {
      try {
        await $.state.set({ plugin: 'teams', key: 'outcome' }, { system: 'teams', outcome, at: await $.clock.now() })
      } catch {
        // fail open: a lost outcome never costs the push
      }
    }
    const words = STRINGS[await read($, lang)]
    let message: string
    if (failed !== null) {
      message = `teams ${failed.run}: ${words[kind]} \u2014 ${failureWhat(failed, words.nodeFailed)}`
      if (message.length > PUSH_MAX) message = message.slice(0, PUSH_MAX - 1) + '\u2026'
    } else {
      const m = /^(E-\S+) (.*)$/.exec(one.text)
      message = `teams ${m?.[1] ?? one.task_id}: ${words[kind]} \u2014 ${m?.[2] ?? one.text}`.slice(0, 200)
    }
    // PushNotification's result: { pushSent?, localSent? }
    await $.tool.call({ tool: 'PushNotification', message, status: 'proactive' } as never)
  } catch {
    // a failed push is a push not sent
  }
}

const TICK_MS = 3000
const SPIN_MS = 800
const WORK_MAX = 6

export const register: Register = on => {
  let isRunning = false
  const pushed = new Set<string>()

  on('session.start', async ($, e, next) => {
    if ((await $.session.surfaces()).length === 0) return next(e)

    const VIEW = `${$.plugin.root}/scripts/view.mjs`

    // the spinner clock runs only while the pane is open and a worker of the shown EPIC acts
    let spinner: { cancel: () => void } | null = null
    async function wantsSpin() {
      if ((await $.session.surfaces()).length === 0) return false
      if (!(await $.ui.panes()).some(p => p.id === PANE)) return false
      const id = await paneTask($)
      return (await read($, tasks)).find(t => t.task_id === id)?.workers.some(w => w.state === 'acting') ?? false
    }
    async function syncSpinner() {
      const go = await wantsSpin()
      if (go && spinner === null) {
        spinner = $.clock.every(SPIN_MS, async () => {
          if (await wantsSpin()) await update($, frame, n => n + 1)
          else {
            spinner?.cancel()
            spinner = null
          }
        })
      } else if (!go && spinner !== null) {
        spinner.cancel()
        spinner = null
      }
    }

    async function tick() {
      if (isRunning) return
      isRunning = true
      try {
        const cwd = await $.session.cwd()
        const since = await read($, cursor)

        const fetched = new Set<string>()
        const cardFetched = new Set<string>()
        const ev = await $.process.run([
          'node', VIEW, '--once', '--format', 'events', '--since', String(since), '--cwd', cwd,
        ])
        if (ev.exitCode === 0) {
          const fresh: TeamsEvent[] = []
          for (const line of ev.stdout.split('\n')) {
            if (!line.trim()) continue
            try {
              const one = JSON.parse(line) as TeamsEvent
              if (one.ts > since) fresh.push(one)
            } catch {
              // a torn line: skip it
            }
          }
          if (fresh.length > 0) {
            for (const one of fresh) {
              const failure = failureOf(one)
              if (failure === null) $.ui.toast(one.text)
              else toastFailure($, failure, STRINGS[await read($, lang)].nodeFailed)
              await pushEvent($, one, pushed)
            }
            // a run that ended after this session began gets a card and one report call
            for (const one of fresh.filter(f => f.kind === 'daemon_done')) {
              await update($, ended, m => mark(m, one.task_id, 'card'))
              cardFetched.add(one.task_id)
              await fetchReport($, one.task_id, true)
            }
            const latest = Math.max(...fresh.map(one => one.ts))
            await update($, cursor, () => latest)
          }
        }

        // one data call: the teams rows while the pane is open, the summary while a task of this cwd
        // is running, else the status
        const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
        const isSummary = isOpen || (await read($, status))?.latest != null
        const id = isOpen ? await paneTask($) : undefined
        const data = await $.process.run([
          'node', VIEW, '--once', '--format', isOpen ? 'teams' : isSummary ? 'summary' : 'status', '--cwd', cwd,
          ...(id === undefined ? [] : ['--task', id]),
        ])
        if (data.exitCode === 0) {
          const parsed = JSON.parse(data.stdout) as { status: StatusInfo; tasks?: SummaryTaskEntry[]; task: SummaryTask | null; teams?: TeamsView | null } & StatusInfo
          const info: StatusInfo = isSummary ? parsed.status : parsed
          await update($, status, () => info)
          await update($, summary, () => (isSummary ? parsed.task ?? null : null))
          await update($, teams, () => parsed.teams ?? null)
          if (isSummary) {
            // the listed EPICs; a selection that left the list moves to the nearest and the pane stays open
            const list = parsed.tasks ?? []
            const ids = list.map(t => t.task_id)
            await update($, tasks, () => list)
            if (ids.length > 0) {
              const current = await read($, epic)
              const chosen = fallbackSelection(await read($, taskIds), ids, (await paneTask($)) ?? null)
              if (chosen !== null && chosen !== current) await update($, epic, () => chosen)
              await update($, taskIds, () => ids)
            }
          }
          // pinned only while a person must act (the engine draws it as a warning)
          $.ui.status(info.waiting > 0 ? fmt(STRINGS[await read($, lang)].statusWaiting, { n: info.waiting }) : undefined)
        }
        // the Decisions tab refetches only while it is open, for the pane's task and picked card
        if (id !== undefined && (await read($, view)) === 'decisions') await fetchDecisions($, id)
        // the Report tab refetches only while it is open, for the pane's task
        const isTab = id !== undefined && (await read($, view)) === 'report'
        if (isTab && (await read($, ended))[id] === 'card') await update($, ended, m => mark(m, id, 'seen'))
        if (isTab && !fetched.has(id)) {
          fetched.add(id)
          await fetchReport($, id)
        }
        // a card waits for its report (none yet, or another task's in the atom)
        const waiting = cardTask(await read($, ended))
        if (waiting !== undefined && !cardFetched.has(waiting)) {
          const held = await read($, cardReport)
          if (held?.task_id !== waiting || held.payload.report === null) await fetchReport($, waiting, true)
        }
        await syncSpinner()
      } catch {
        // a failed run or unreadable output leaves the last status as it was
      } finally {
        isRunning = false
      }
    }

    // Claude Code's own language setting, read once per session
    try {
      const language = (await $.settings.read()).language
      await update($, lang, () => (typeof language === 'string' && /^(ko|korean|한국어)/i.test(language) ? 'ko' : 'en'))
    } catch {
      // unreadable settings: English
    }
    await $.command.register({ name: 'teams-status', description: STRINGS[await read($, lang)].cmdDesc })
    // events older than this session's start are not toasted
    const now = await $.clock.now()
    await update($, cursor, since => (since === 0 ? now : since))
    $.clock.every(TICK_MS, tick)

    return next(e)
  })

  // asked for by the person: the pane seats at any width; the command again closes it
  on('command.run', { command: 'teams-status' }, async $ => {
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: STRINGS[await read($, lang)].paneClosed }
    }
    await $.ui.open(OPEN)
    return { text: STRINGS[await read($, lang)].paneOpened }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Input, Markdown, Text } = ui
    const kind = await read($, view)
    const lang$ = await read($, lang)
    const s = (key: keyof typeof en, vars?: Record<string, string | number>) => fmt(STRINGS[lang$][key], vars)
    // node's word_key (idle, done, stalled, failed) names a STRINGS entry; a pure lookup, no decision
    const fixedWord = (key: string) => s(`word${key.charAt(0).toUpperCase()}${key.slice(1)}` as keyof typeof en)
    const id = await paneTask($)
    const listed = await read($, tasks)
    const entry = listed.find(t => t.task_id === id)
    // the summary is drawn only for the EPIC the pane shows; right after a switch it is the last one's until the next tick
    const held = await read($, summary)
    const task = held !== null && entry !== undefined && held.key !== entry.key ? null : held
    const info = await read($, status)
    const inner = Math.max(20, (e.props.bodyColumns ?? 80) - 4)

    // said once, as the footer's last item
    // (no Button hotkey: the pane's Input holds the focus and takes `q` and `1`-`5` as text, see onKey)
    const close = <Button key="close" role="dismiss" plain dimColor label={s('close')} onPress={() => $.ui.close({ id: PANE })} />
    // plain tabs on one line: the selected one in full strength with a dot, the rest dim; `1`-`5` pick them
    const TABS = ['floor', 'stories', 'decisions', 'log', 'report'] as const
    const pickTab = async (one: (typeof TABS)[number]) => {
      await update($, view, () => one)
      if (one === 'report' && id !== undefined) {
        await update($, ended, m => (m[id] === 'card' ? mark(m, id, 'seen') : m))
        await fetchReport($, id)
      }
      if (one === 'decisions' && id !== undefined) await fetchDecisions($, id)
    }
    const costText = task === null ? '' : s('costLine', { usd: `$${task.cost.usd.toFixed(2)}`, turns: task.cost.turns })
    const tabPlan = tabRowPlan(TABS.map(one => `${kind === one ? '● ' : ''}${s(`tab${cap(one)}` as keyof typeof en)}`), costText, inner)
    const tabs = (
      <Box columnGap={tabPlan.gap}>
        {TABS.map((one, i) => (
          <Box key={`tab-${one}`} flexShrink={0}><Button key={one} plain dimColor={kind !== one} label={tabPlan.labels[i]!} onPress={() => pickTab(one)} /></Box>
        ))}
      </Box>
    )
    if (id === undefined || (task === null && entry === undefined && kind !== 'report' && kind !== 'stories')) {
      return (
        <Box flexDirection="column">
          <Text>{id === undefined ? s('noRun') : s('loading')}</Text>
          {close}
        </Box>
      )
    }
    // the task's report, drawn only when it was fetched for the pane's task: its path first, then
    // (when capped) the truncated notice, then the text
    const rp = await read($, report)
    const mine = rp !== null && rp.task_id === id ? rp.payload : null
    const reportBody = mine === null ? <Text dimColor>{s('loading')}</Text>
      : mine.report === null ? <Text>{s('reportMissing', { path: mine.path })}</Text>
      : (
        <Box flexDirection="column">
          <Text>{mine.path}</Text>
          {mine.report.truncated && <Text color="warning">{s('reportTruncated', { n: mine.report.more_lines })}</Text>}
          <Markdown text={mine.report.text} />
        </Box>
      )

    // the listed EPICs, one line each, are the title block
    const now = await $.clock.now()
    const epicWord = (t: SummaryTaskEntry) => (t.state === 'waiting_human' ? s('nodeWaiting') : s(`state${cap(t.state)}` as keyof typeof en) || t.state)
    const epicOf = listed.map(t => epicCells(t, epicState(t), t.task_id === id, now, epicWord(t)))
    const epicWidths = columnWidths(epicOf.map(r => r.cells), inner, 2, [4])
    const epicLines: Line[] = epicOf.map(r => rowLine(r.cells, epicWidths, 2, r.tints))
    const epics = epicLines.length === 0 ? null : renderLines(ui, epicLines, 'e')

    // the STORYs tab: every listed task's STORYs at work, columns at the same offset on every row
    const rows = storyRows(listed)
    const pick = Math.min(Math.max(0, await read($, row)), Math.max(0, rows.length - 1))
    const verdictText = (v: string | null) => (v === null ? '' : VERDICT_WORD[v] === undefined ? v : s(VERDICT_WORD[v]!))
    const harnessText = (t: SummaryTaskEntry) => t.harness === null ? ''
      : `${t.stages.map(g => `${MARK[g.state]}${s(`stage${cap(g.key)}` as keyof typeof en)}`).join(' ')}${t.harness.slug ? ` · ${t.harness.slug}` : ''}${t.harness.moving ? ' ▸' : ''}`
    const storyOf = rows.map(({ entry: t, item }, i) => storyCells(item, verdictText(item.last_verdict), harnessText(t), i === pick, fixedWord))
    const storyWidths = columnWidths(storyOf.map(r => r.cells), inner, 2, STORY_SHRINK)
    const storiesBody = rows.length === 0 ? <Text dimColor>{s('noStories')}</Text>
      : renderLines(ui, storyOf.map(r => rowLine(r.cells, storyWidths, 2, r.tints)), 's')

    // `[` `]` step the EPIC and stop at the ends; `j` `k` move the STORY row; `g` opens its run. The Input takes the
    // keys (a Button hotkey is one digit or lowercase letter), prev / next are Buttons for the pointer
    const cycle = async (by: 1 | -1) => {
      const ids = listed.map(t => t.task_id)
      if (ids.length === 0) return
      const to = ids[stepClamp(Math.max(0, ids.indexOf(id)), by, ids.length)]!
      if (to === id) return
      await update($, epic, () => to)
      await update($, row, () => 0)
    }
    const target = kind === 'stories' ? rows[pick]?.item : undefined
    const canOpen = target?.run_file != null
    const onKey = async (text: string) => {
      const key = paneKey(text)
      if (key === null) return
      if (key.kind === 'close') await $.ui.close({ id: PANE })
      else if (key.kind === 'tab') await pickTab(key.tab)
      else if (key.kind === 'step') await cycle(key.by)
      else if (kind !== 'stories') return
      else if (key.kind === 'row') await update($, row, () => stepClamp(pick, key.by, rows.length))
      else if (target !== undefined && target.run_file != null) {
        try {
          await $.command.run({ command: 'graph-status', args: `open ${target.run_file} ${target.owner_key}` })
        } catch {
          // a hand-off that is not there leaves the pane as it was
        }
      }
    }
    // the same Input takes a typed `/command`, held until Enter (paneKey fires no key on text holding `/`): `/teams-status`
    // closes the pane, `/name args` runs that command. Not awaited: awaited inside onSubmit the host cuts the hook at its budget.
    const onSubmit = async (text: string) => {
      const slash = paneSlash(text)
      if (slash === null) return
      if (slash.kind === 'close') await $.ui.close({ id: PANE })
      else void $.command.run({ command: slash.command, args: slash.args }).catch(() => {})
    }
    const openHint = kind === 'stories' ? s('openHint') : ''
    const footerHint = footerPlan({ steps: listed.length > 1 ? 2 : 0, open: openHint, close: s('close'), hint: s('keysHint') }, inner).hint
    const footer = (
      <Box columnGap={2}>
        {listed.length > 1 && <Button key="prev" plain label={s('prev')} onPress={() => cycle(-1)} />}
        {listed.length > 1 && <Button key="next" plain label={s('next')} onPress={() => cycle(1)} />}
        <Box flexShrink={1} height={1} overflow="hidden"><Input key="keys" autoFocus value="" placeholder={footerHint} onInput={onKey} onSubmit={onSubmit} /></Box>
        {openHint !== '' && <Text dimColor={!canOpen}>{openHint}</Text>}
        <Box flexShrink={0}>{close}</Box>
      </Box>
    )
    if (task === null) {
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
          <Box marginY={1}>{tabs}</Box>
          {epics}
          {kind === 'stories' ? storiesBody : kind === 'report' ? reportBody : <Text>{s('loading')}</Text>}
          {footer}
        </Box>
      )
    }

    const stateWord = s(`state${cap(task.state)}` as keyof typeof en) || task.state
    const card = (c: SummaryTask['work'][number], i: number) => (
      <Box key={`c${i}`} flexDirection="column">
        <Text wrap="truncate-end"><Text color={TINT[c.state]}>{MARK[c.state]}</Text>{` ${c.title}`}</Text>
        {c.state === 'failed' && c.reason && <Text color="error" wrap="truncate-end">{`  ${c.reason}`}</Text>}
      </Box>
    )

    // above the tabs only what waits on the person: each waiting card with its question, then the runs besides this one
    const others = (info?.waiting ?? 0) - task.you.count
    const tv = await read($, teams)
    const teamWord = (t: string) => s(`team${cap(t)}` as keyof typeof en) || t
    const nodeWord = (n: string) => (n === 'waiting' ? s('nodeWaiting') : n)
    const waitCards = task.you.cards ?? []
    const waitBox = waitCards.length === 0 && others <= 0 ? null : (
      <Box flexDirection="column" marginTop={1}>
        {waitCards.map((c, i) => (
          <Text key={`w${i}`} color="warning" wrap="truncate-end">{`⚑ ${c.title}${c.question ? ` — ${c.question}` : ''}`}</Text>
        ))}
        {others > 0 && <Text color="warning">{s('youOthers', { n: others })}</Text>}
      </Box>
    )
    const pickCard = async (cardId: string) => {
      await update($, selected, () => cardId)
      await update($, view, () => 'decisions')
      await fetchDecisions($, id)
    }

    // the Floor: one line per worker of the shown EPIC, then the newest hand-offs; columns at one offset per block
    const frameNo = await read($, frame)
    const workerOf = workerCells(entry?.workers ?? [], frameNo, fixedWord)
    const workerWidths = columnWidths(workerOf.map(r => r.cells), inner, 2, [3])
    const handoffOf = handoffCells(entry?.handoffs ?? [])
    const handoffWidths = columnWidths(handoffOf, inner, 2, [2, 3])
    const floorLines = (
      <Box flexDirection="column">
        {renderLines(ui, workerOf.map(r => rowLine(r.cells, workerWidths, 2, r.tints)), 'w')}
        {handoffOf.length > 0 && <Box marginTop={1}>{renderLines(ui, handoffOf.map(r => rowLine(r, handoffWidths, 2, ['dim'])), 'h')}</Box>}
      </Box>
    )

    // the stage rail heads the STORYs tab
    const rail = (
      <Box flexWrap="wrap" marginBottom={1}>
        {task.stages.map((g, i) => {
          const next = task.stages[i + 1]
          const solid = next !== undefined && next.state !== 'pending'
          return (
            <Box key={g.key}>
              <Text color={TINT[g.state]} bold={g.state === 'running'}>{`${DOT[g.state]} ${s(`stage${cap(g.key)}` as keyof typeof en)}`}</Text>
              {next !== undefined && <Text color={solid ? 'success' : 'inactive'}>{solid ? ' ━━ ' : ' ┄┄ '}</Text>}
            </Box>
          )
        })}
      </Box>
    )
    // the card list heads the Decisions tab, where a picked card's thread is read
    const reasonOf = (title: string) => task.work.find(w => w.title === title && w.state === 'failed')?.reason ?? null
    const picker = tv === null ? (
      // before the first teams call: the summary's card list
      <Box flexDirection="column" marginBottom={1}>
        {task.work.slice(0, WORK_MAX).map(card)}
        {task.work.length > WORK_MAX && <Text dimColor>{`  ${s('workMore', { n: task.work.length - WORK_MAX })}`}</Text>}
      </Box>
    ) : (
      // one block per team; each card a button (↑↓ moves, Enter opens its decision thread)
      <Box flexDirection="column" marginBottom={1}>
        {tv.teams.map(t => (
          <Box key={`t-${t.team}`} flexDirection="column">
            <Text bold>{teamWord(t.team)}</Text>
            {t.cards.map(c => (
              <Box key={`k-${c.id}`} flexDirection="column">
                {/* one line per card: a narrow pane clips the label instead of wrapping it */}
                <Box height={1} overflow="hidden"><Button key={`card:${c.id}`} plain dimColor={c.mark === 'done'}
                  label={`${MARK[c.mark]} ${c.title} · ${c.state ?? ''}${c.now ? ` · ${nodeWord(c.now.node)} ${c.now.agent ?? ''} ${since(c.now.elapsed_ms)}`.trimEnd() : ''}`}
                  onPress={() => pickCard(c.id)} /></Box>
                {c.mark === 'failed' && reasonOf(c.title) && <Text color="error" wrap="truncate-end">{`  ${reasonOf(c.title)}`}</Text>}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )

    let body
    if (kind === 'floor') {
      body = floorLines
    } else if (kind === 'stories') {
      body = <Box flexDirection="column">{rail}{storiesBody}</Box>
    } else if (kind === 'decisions') {
      const pickedId = await read($, selected)
      const dp = await read($, decisions)
      const mine = dp !== null && dp.task_id === id && dp.card === pickedId ? dp.payload.entries : null
      const what = (d: Decision) => {
        const label = d.kind === 'verdict' ? s(VERDICT_WORD[d.verdict ?? ''] ?? 'vReject') : s(`kind${cap(d.kind)}` as keyof typeof en) || d.kind
        const score = d.score !== null && d.score !== undefined ? ` ${d.score}%` : ''
        const why = d.reason ?? d.text ?? d.title ?? ''
        return `${d.time ?? '     '} ${d.actor ?? '—'} · ${label}${score} · ${d.node ?? d.card ?? ''}${why ? ` — ${why}` : ''}`
      }
      const subs = (d: Decision) => [
        ...(d.blocking ?? []).map(x => `${s('lineBlocking')}: ${x}`),
        ...(d.problems ?? []).map(x => `${s('lineProblems')}: ${x}`),
        ...(d.gaps ?? []).map(x => `${s('lineGaps')}: ${x}`),
        ...(d.evidence ? [`${s('lineEvidence')}: ${d.evidence}`] : []),
      ]
      body = (
        <Box flexDirection="column">
          {picker}
          {pickedId !== null && (
            <Box columnGap={2}>
              <Text bold>{s('decCard', { c: pickedId })}</Text>
              <Button key="all" plain label={s('decAll')} onPress={async () => {
                await update($, selected, () => null)
                await fetchDecisions($, id)
              }} />
            </Box>
          )}
          {mine === null ? <Text dimColor>{s('loading')}</Text>
            : mine.length === 0 ? <Text dimColor>{s('decNone')}</Text>
            : mine.map((d, i) => (
              <Box key={`d${i}`} flexDirection="column">
                <Text color={d.verdict === 'reject' || d.kind === 'defect' ? 'error' : d.kind === 'answer' || d.kind === 'decision' ? 'warning' : undefined} wrap="truncate-end">{what(d)}</Text>
                {subs(d).map((line, j) => <Text key={`d${i}-${j}`} dimColor wrap="truncate-end">{`      ${line}`}</Text>)}
              </Box>
            ))}
        </Box>
      )
    } else if (kind === 'log') {
      const lines = task.log.map(one => `${one.time} ${s(`log${cap(one.kind)}` as keyof typeof en, { s: one.subject ?? '' }).trim()}`)
      body = (
        <Box flexDirection="column">
          {lines.length === 0 ? <Text dimColor>{s('noLog')}</Text> : lines.map((line, i) => <Text key={`l${i}`}>{line}</Text>)}
        </Box>
      )
    } else {
      body = reportBody
    }
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        {/* the EPIC rows are the title; a task that is not listed gets one row of its own */}
        {entry === undefined && (
          <Box>
            <Box flexShrink={1}><Text bold wrap="truncate-end">{task.title}</Text></Box>
            <Box flexShrink={0} marginLeft={2}>
              <Text color="claude">{s('headLine', { state: stateWord, done: task.done, total: task.total })}</Text>
            </Box>
          </Box>
        )}
        {epics !== null && <Box marginTop={entry === undefined ? 1 : 0}>{epics}</Box>}
        {waitBox}
        {/* the tab row never wraps: tabRowPlan drops the cost text first, then shortens the labels */}
        <Box marginY={1}>
          <Box flexShrink={0}>{tabs}</Box>
          {tabPlan.cost !== null && (
            <Box flexGrow={1} flexShrink={1} justifyContent="flex-end" marginLeft={2}>
              <Text dimColor wrap="truncate-end">{tabPlan.cost}</Text>
            </Box>
          )}
        </Box>
        {body}
        {footer}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const info = await read($, status)
    const task = await read($, summary)
    const lang$ = await read($, lang)
    const s = (key: keyof typeof en, vars?: Record<string, string | number>) => fmt(STRINGS[lang$][key], vars)
    const open = () => $.ui.open(OPEN)

    // an ended run: one card in place of the running row, until the person opens the report or dismisses it
    const cardId = cardTask(await read($, ended))
    const held = await read($, cardReport)
    if (!e.props.hasSurvey && cardId !== undefined && held?.task_id === cardId && held.payload.verdict !== 'running') {
      const { Box, Button, Text } = $.ui.resolve(e)
      const p = held.payload
      const set = (state: 'seen' | 'dismissed') => update($, ended, m => mark(m, cardId, state))
      return (
        <Box flexDirection="column">
          <Box>
            <Box flexShrink={0}><Text bold color={p.verdict === 'finished' ? 'success' : 'warning'}>{`teams · ${s(p.verdict === 'finished' ? 'cardFinished' : 'cardBlocked')}`}</Text></Box>
            {p.failed > 0 && <Box flexShrink={0} marginLeft={1}><Text color="error">{s('cardFailed', { n: p.failed })}</Text></Box>}
            {p.needs.items.length > 0 && <Box flexShrink={1} marginLeft={1}><Text dimColor wrap="truncate-end">{`— ${p.needs.items.join('; ')}`}</Text></Box>}
            {p.needs.more > 0 && <Box flexShrink={0} marginLeft={1}><Text dimColor>{s('cardMore', { n: p.needs.more })}</Text></Box>}
            {p.report !== null && (
              <Box flexShrink={0} marginLeft={1}>
                <Button key="report" label={s('reportButton')} onPress={async () => {
                  await update($, watch, l => [...l.filter(x => x !== cardId), cardId])
                  await update($, summary, () => null)
                  await update($, report, () => held)
                  await update($, view, () => 'report')
                  await set('seen')
                  await open()
                }} />
              </Box>
            )}
            <Box flexShrink={0} marginLeft={1}><Button key="dismiss" label={s('dismiss')} onPress={() => set('dismissed')} /></Box>
          </Box>
          {await next(e)}
        </Box>
      )
    }

    // a card waits on a person: ⚑ leads the row, with or without a running task
    const flagged = (info?.waiting ?? 0) > 0 || (task?.you.count ?? 0) > 0
    const isRunning = info?.latest != null && task?.state === 'running'
    if (e.props.hasSurvey || (!flagged && !isRunning)) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const inboxLabel = (n: number) => s(n === 1 ? 'inboxOne' : 'inboxMany', { n })
    const flag = flagged ? <Box flexShrink={0} marginRight={1}><Text color="warning" bold>⚑</Text></Box> : null
    if (task === null || !isRunning) {
      return (
        <Box flexDirection="column">
          <Box>
            {flag}
            <Box flexShrink={0}><Button key="inbox" label={inboxLabel(Math.max(info?.waiting ?? 0, task?.you.count ?? 0))} onPress={open} /></Box>
          </Box>
          {await next(e)}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Box>
          {flag}
          <Box flexShrink={1}><Text dimColor wrap="truncate-end">{`teams · ${task.title} — ${nowSentence(s, task)}`}</Text></Box>
          <Box flexShrink={0} marginLeft={1}>
            <Text color="success">{'━'.repeat(task.total > 0 ? Math.round((10 * task.done) / task.total) : 0)}</Text>
            <Text color="inactive">{'─'.repeat(10 - (task.total > 0 ? Math.round((10 * task.done) / task.total) : 0))}</Text>
            <Text dimColor>{` ${s('bandDone', { done: task.done, total: task.total })}`}</Text>
          </Box>
          {(info?.waiting ?? 0) > 0
            ? <Box flexShrink={0} marginLeft={1}><Button key="inbox" label={inboxLabel(info?.waiting ?? 0)} onPress={open} /></Box>
            : <Box flexShrink={0} marginLeft={1}><Button key="board" label={s('board')} onPress={open} /></Box>}
        </Box>
        {await next(e)}
      </Box>
    )
  })

  // react only: the result goes back unchanged; interactive sessions only
  on('tool.call', { tool: /__(tm_open|tm_run)$/ }, async ($, e, next) => {
    const r = await next(e)
    if ((await $.session.surfaces()).length === 0) return r
    if (r.deny !== undefined) return r
    const id = taskIdOf(r)
    if (id !== undefined) await update($, watch, list => (list.includes(id) ? list : [...list, id]))
    return r
  }).catch(($, e, next) => next(e))

  // guard: runs headless too
  on('tool.call', { tool: /__team_status$/ }, ($, e, next) => {
    const args = e as unknown as { full?: unknown; node_id?: unknown }
    if (args.full === true && !args.node_id) {
      return { deny: 'team_status full:true dumps every node; pass node_id or read detail_path (teams:orchestrate NEVER rule)' }
    }
    return next(e)
  }).catch(($, e, next) => next(e))
}
