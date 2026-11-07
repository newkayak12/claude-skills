import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Dash, Decision, DecisionsPayload, Mark, PaneView, ReportPayload, StatusInfo, SummaryItem, SummaryTask, SummaryTaskEntry, TeamsEvent, TeamsView } from '../types'
import { askBandShown, carriesInput, fallbackSelection, paneKey, paneSlash, statusAnswer, stepClamp, storyRows } from './pane'
import { STORY_SHRINK, clipText, columnWidths, epicCells, epicState, handoffCells, renderLines, rowLine, runCells, since, storyCells, tabRowPlan, footerPlan, workerCells } from './teams-draw'
import type { Line } from './teams-draw'

const cursor = atom({ plugin: 'teams', key: 'cursor' } as const, 0)
const status = atom({ plugin: 'teams', key: 'status' } as const, null as StatusInfo | null)
const summary = atom({ plugin: 'teams', key: 'summary' } as const, null as SummaryTask | null)
const teams = atom({ plugin: 'teams', key: 'teams' } as const, null as TeamsView | null)
const dash = atom({ plugin: 'teams', key: 'dash' } as const, null as Dash | null)
const decisions = atom({ plugin: 'teams', key: 'decisions' } as const, null as { task_id: string; card: string | null; payload: DecisionsPayload } | null)
const selected = atom({ plugin: 'teams', key: 'selected' } as const, null as string | null)
const watch = atom({ plugin: 'teams', key: 'watch' } as const, [] as string[])
const view = atom({ plugin: 'teams', key: 'view' } as const, 'dash' as PaneView)
// every listed EPIC (live first, then stalled), the ids of the tick before, the one the pane shows, and the STORY row `g` opens
const tasks = atom({ plugin: 'teams', key: 'tasks' } as const, [] as SummaryTaskEntry[])
const taskIds = atom({ plugin: 'teams', key: 'taskIds' } as const, [] as string[])
const epic = atom({ plugin: 'teams', key: 'epic' } as const, null as string | null)
const row = atom({ plugin: 'teams', key: 'row' } as const, 0)
// the pane Input's text: drawn as its value, so a handled key can draw '' and the host drops what was typed
const typed = atom({ plugin: 'teams', key: 'typed' } as const, '')
// the spinner frame beside an acting worker; moved by the 800 ms clock only while a worker acts
const frame = atom({ plugin: 'teams', key: 'frame' } as const, 0)
// the report of one task: keyed to the task it was fetched for, so a card or tab never draws another's
const report = atom({ plugin: 'teams', key: 'report' } as const, null as { task_id: string; payload: ReportPayload } | null)
// the report behind the end-of-run card: its own atom, so an open Report tab on another task never
// replaces it (nor it the tab)
const cardReport = atom({ plugin: 'teams', key: 'cardReport' } as const, null as { task_id: string; payload: ReportPayload } | null)
const lang = atom({ plugin: 'teams', key: 'lang' } as const, 'en' as 'en' | 'ko')
// set once the person pressed `l` or the Button; from then on the session.start setting no longer decides the language
const langChosen = atom({ plugin: 'teams', key: 'langChosen' } as const, false)

// the end-of-run card per ended task: 'card' while it is shown, 'seen' once its report was opened,
// 'dismissed' on the person's say-so
type Ended = Record<string, 'card' | 'seen' | 'dismissed'>
const ended = atom({ plugin: 'teams', key: 'ended' } as const, {} as Ended)
const mark = (m: Ended, id: string, state: Ended[string]): Ended => ({ ...m, [id]: state })

const PANE = 'teams-status'
// opened by the person: it takes the keys, and Escape hands them back by closing it
// 'Teams' is the product name: on the lang-allow ALLOW list, so it is not a table word
const OPEN = { id: PANE, title: 'Teams', focus: true, closeOnEscape: true } as const

const en = {
  tabDash: 'Home', tabFloor: 'Floor', tabStories: 'STORYs', tabDecisions: 'Decisions', tabLog: 'Log', tabReport: 'Report', close: 'q close',
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
  headLine: '{state} · {done}/{total}', wordIdle: 'idle', wordDone: 'done', wordStalled: 'stalled', wordFailed: 'failed', wordActing: 'working', wordYou: 'needs you', bandDone: '{done}/{total} done',
  stateRunning: 'running', stateStalled: 'stalled', stateComplete: 'finished', stateFailed: 'failed',
  stagePlan: 'Plan', stageBuild: 'Build', stageIntegrate: 'Integrate', stageQa: 'QA', stageGate: 'Final gate', stageReport: 'Report',
  subjPlan: 'plan', subjBuild: 'build', subjIntegration: 'integration', subjQa: 'QA', subjFinalGate: 'final gate', subjReport: 'report', subjTask: 'the task', subjCard: 'a card', subjStep: 'a step',
  stageFix: 'fix', stageFixnext: 'fixnext', stageAnswer: 'answer', stageIdle: 'idle', stageDone: 'done',
  nowFix: 'Fixing defect', nowFixnext: 'Waiting to fix defect', nowBuild: 'Building', nowPlan: 'Planning', nowQa: 'QA', nowAnswer: 'Waiting for your answer',
  nowIntegrate: 'Integrating', nowGate: 'Final gate', nowReport: 'Writing the report', nowDone: 'All done', nowIdle: 'Idle',
  logPassed: '{s} passed', logFailed: '{s} failed', logFiled: '{s} filed', logIntegrated: '{s} integrated',
  logDispatched: '{s} started', logWaiting: '{s} waiting for you', logFinished: '{s} finished',
  noRun: 'No teams run in this session.', loading: 'Loading...', noLog: 'Nothing logged yet.',
  workMore: '+{n} more', cmdDesc: 'Open or close the teams status pane', paneOpened: 'pane opened',
  asksYou: '{who} asks you: {q}',
  board: 'board', inboxOne: '{n} question for you', inboxMany: '{n} questions for you', statusWaiting: 'needs you: {n} waiting - open /teams-status',
  pushRejected: 'rejected', pushNeedsYou: 'needs you', pushEnded: 'run ended', nodeFailed: 'failed',
  prev: '◀', next: '▶', keysHint: '[ ] EPIC · j k row · 0-5 tabs', openHint: 'g open run', noStories: 'No STORY at work.',
  runBudget: 'Budget', runBudgetOf: '{spent} of {limit}', runDrivers: 'Drivers', runLive: '{n} live', runLiveCap: '{n}/{cap} live',
  runStalled: 'Stalled', runStalledOne: '{id} {m}m', runDenials: 'Denials', runDefects: 'Defects', runDefectsOf: '{filed} filed · {dropped} dropped',
  runOutOfRetries: 'Out of retries', runScopedOut: 'Scoped out', storyJudge: 'judge {score} vs {threshold}', storyJudgeBare: 'judge {score}', storyGap: 'own gap: {gap}',
  progBuild: 'Build {done}/{total}', progQa: 'QA {done}/{total}', progSg: 'SG{k} {stage} · {k}/{n}',
  sgStagePlan: 'Plan', sgStageSetgoal: 'Setgoal', sgStageCritique: 'Critique', sgStageImplement: 'Implement', sgStageTest: 'Test', sgStageGate: 'Gate', sgStageReport: 'Report',
  estMark: '~', afterStop: 'after stop {usd}', stalledMinutes: '⏸ {n}m',
  stageIntegShort: 'Integ', stageReportShort: 'Rep',
  nextShape: 'retrying as shape:{n}', nextAreas: 'retrying as areas:{n}', nextRetry: 'retry {n}/{max}', nextGaveUp: 'gave up', nextNeedsYou: 'needs you',
  reasonNone: 'no reason recorded', reasonFailed: 'failed',
  handAsks: 'asks you', handVerdict: 'verdict {v}', handIntegrated: 'integrated {n}', handFiled: 'filed {n} defect(s)', handAnswered: 'answered', partyYou: 'you',
  tileProgress: 'Progress', tileStories: 'Stories', tileCost: 'Cost', tileWaiting: 'Needs you', tileDrivers: 'Drivers',
  tileSubStages: '{done}/{total} stages', tileSubAccepted: 'accepted', tileSubTurns: '{n} turns', tileSubWaiting: 'waiting', tileSubNothing: 'nothing', tileSubLive: 'live',
  evWaiting: '{run} needs you: {node}', evPaused: '{run} paused: provider limit', evDone: '{run} finished: {state}', evExhausted: '{run} stopped: daemon restarts used up', evFixRounds: '{run} {pkg}: fix rounds used up', evAttempt: '(attempt {n})',
  doneComplete: 'complete', donePartial: 'partial', doneBlocked: 'blocked',
  askTo: '⚑ {who} → you', stateBlocked: 'blocked', stateCancelled: 'cancelled',
  ticketDone: 'done', ticketBlocked: 'blocked', ticketInProgress: 'in progress', ticketReady: 'ready', ticketInReview: 'in review', ticketCancelled: 'cancelled', ticketStalled: 'stalled',
  ticketBacklog: 'backlog', ticketUnreachable: 'unreachable', ticketWaitingCapacity: 'waiting for capacity', ticketWaitingHuman: 'waiting for you', ticketRejected: 'rejected', ticketSettled: 'settled', ticketUnknown: 'unknown',
  stateWaitingHuman: 'waiting_human', stateStale: 'stale', stateUnknown: 'unknown', statePartial: 'partial',
  doneCancelled: 'cancelled', doneRunning: 'running', doneWaitingHuman: 'waiting_human',
  laneRunning: 'In progress', laneYou: 'Needs you', lanePending: 'Up next', laneDone: 'Done',
  langMarker: 'l {lang}', langEN: 'EN', langKR: 'KR',
  footFloor: 'w s move · d ⏎ Phase detail · a back · n next ⚑ · q close', footLog: 'w s scroll · a back · q close',
}

// one table, two languages; the type keeps the keys identical
export const STRINGS: Record<'en' | 'ko', Record<keyof typeof en, string>> = {
  en,
  ko: {
    tabDash: '홈', tabFloor: '현장', tabStories: 'STORY', tabDecisions: '결정', tabLog: '기록', tabReport: '보고서', close: 'q 닫기',
    teamPlanning: '기획', teamDevelop: '개발', teamQa: 'QA', teamAudit: '감사', teamEpic: 'EPIC', nodeWaiting: '답변 대기',
    decAll: '전체 카드', decCard: '카드 {c}', decNone: '아직 기록된 결정이 없습니다.',
    kindProposal: '제안', kindRetry: '재시도', kindRejudge: '재판정', kindResplit: '재분할', kindDefect: '결함 등록', kindAnswer: '답변', kindDecision: '결정',
    vAccept: '승인', vSound: '타당', vVerified: '검증됨', vReject: '반려', vJudgeFailed: '판정 실패',
    lineBlocking: '차단', lineProblems: '문제', lineGaps: '누락', lineEvidence: '근거',
    paneClosed: '창을 닫았습니다',
    cardFinished: '끝남', cardBlocked: '막힘', cardFailed: '실패 {n}', cardMore: '+{n}건 더', reportButton: '보고서', dismiss: '×',
    reportMissing: '아직 보고서가 없습니다: {path}', reportTruncated: '일부만 표시: 파일에 {n}줄 더 있습니다.',
    stages: '단계', work: '작업', cost: '비용',
    youOthers: '다른 실행에 {n}건 더', costLine: '{usd} · {turns}턴',
    headLine: '{state} · {done}/{total}', wordIdle: '유휴', wordDone: '완료', wordStalled: '멈춤', wordFailed: '실패', wordActing: '작업 중', wordYou: '확인 필요', bandDone: '{done}/{total} 완료',
    stateRunning: '진행 중', stateStalled: '멈춤', stateComplete: '완료', stateFailed: '실패',
    stagePlan: 'Plan', stageBuild: 'Build', stageIntegrate: 'Integrate', stageQa: 'QA', stageGate: 'Gate', stageReport: 'Report',
    subjPlan: '계획', subjBuild: '구현', subjIntegration: '통합', subjQa: 'QA', subjFinalGate: '최종 게이트', subjReport: '보고서', subjTask: '작업', subjCard: '카드', subjStep: '단계',
    stageFix: '결함 수정', stageFixnext: '결함 수정 대기', stageAnswer: '답변 대기', stageIdle: '대기', stageDone: '완료',
    nowFix: '결함 수정 중', nowFixnext: '결함 수정 대기', nowBuild: '구현 중', nowPlan: '계획 중', nowQa: 'QA 중', nowAnswer: '답변 대기 중',
    nowIntegrate: '통합 중', nowGate: '최종 관문', nowReport: '보고서 작성 중', nowDone: '모두 끝남', nowIdle: '대기 중',
    logPassed: '{s} 통과', logFailed: '{s} 실패', logFiled: '{s} 등록', logIntegrated: '{s} 반영',
    logDispatched: '{s} 시작', logWaiting: '{s} 답변 대기', logFinished: '{s} 끝남',
    noRun: '이 세션에 팀 실행이 없습니다.', loading: '불러오는 중...', noLog: '아직 기록이 없습니다.',
    workMore: '+{n}건 더', cmdDesc: '팀 현황 창 열기/닫기', paneOpened: '창을 열었습니다',
    asksYou: '{who}님이 묻습니다: {q}',
    board: '보드', inboxOne: '질문 {n}건', inboxMany: '질문 {n}건', statusWaiting: '확인 필요: {n}건 대기 - /teams-status 열기',
    pushRejected: '반려', pushNeedsYou: '확인 필요', pushEnded: '실행 종료', nodeFailed: '실패',
    prev: '◀', next: '▶', keysHint: '[ ] EPIC · j k 행 · 0-5 탭', openHint: 'g 실행 열기', noStories: '진행 중인 STORY가 없습니다.',
    runBudget: '예산', runBudgetOf: '{spent} / {limit}', runDrivers: '드라이버', runLive: '{n}개 동작 중', runLiveCap: '{n}/{cap} 동작 중',
    runStalled: '멈춤', runStalledOne: '{id} {m}분', runDenials: '거부', runDefects: '결함', runDefectsOf: '등록 {filed} · 폐기 {dropped}',
    runOutOfRetries: '재시도 소진', runScopedOut: '범위 밖', storyJudge: '판정 {score} / 기준 {threshold}', storyJudgeBare: '판정 {score}', storyGap: '자체 결함: {gap}',
    progBuild: 'Build {done}/{total}', progQa: 'QA {done}/{total}', progSg: 'SG{k} {stage} · {k}/{n}',
    sgStagePlan: '계획', sgStageSetgoal: '목표 설정', sgStageCritique: '비평', sgStageImplement: '구현', sgStageTest: '테스트', sgStageGate: '게이트', sgStageReport: '보고',
    estMark: '~', afterStop: '중단 후 {usd}', stalledMinutes: '⏸ {n}분',
    stageIntegShort: 'Integ', stageReportShort: 'Rep',
    nextShape: '형태 {n}(으)로 재시도', nextAreas: '영역 {n}(으)로 재시도', nextRetry: '재시도 {n}/{max}', nextGaveUp: '포기', nextNeedsYou: '확인 필요',
    reasonNone: '기록된 사유 없음', reasonFailed: '실패',
    handAsks: '질문', handVerdict: '판정 {v}', handIntegrated: '{n}건 통합', handFiled: '결함 {n}건 등록', handAnswered: '답변함', partyYou: '나',
    tileProgress: '진행', tileStories: 'STORY', tileCost: '비용', tileWaiting: '확인 필요', tileDrivers: '드라이버',
    tileSubStages: '{done}/{total} 단계', tileSubAccepted: '승인', tileSubTurns: '{n}턴', tileSubWaiting: '대기', tileSubNothing: '없음', tileSubLive: '동작 중',
    evWaiting: '{run} 확인 필요: {node}', evPaused: '{run} 일시 중지: 제공자 한도', evDone: '{run} 종료: {state}', evExhausted: '{run} 중단: 데몬 재시작 소진', evFixRounds: '{run} {pkg}: 수정 라운드 소진', evAttempt: '({n}회차)',
    doneComplete: '완료', donePartial: '일부 완료', doneBlocked: '막힘',
    askTo: '⚑ {who} → 나', stateBlocked: '막힘', stateCancelled: '취소됨',
    ticketDone: '완료', ticketBlocked: '막힘', ticketInProgress: '진행 중', ticketReady: '준비됨', ticketInReview: '검토 중', ticketCancelled: '취소됨', ticketStalled: '멈춤',
    ticketBacklog: '대기열', ticketUnreachable: '도달 불가', ticketWaitingCapacity: '자리 대기', ticketWaitingHuman: '확인 필요', ticketRejected: '반려됨', ticketSettled: '종결', ticketUnknown: '알 수 없음',
    stateWaitingHuman: '확인 필요', stateStale: '오래됨', stateUnknown: '알 수 없음', statePartial: '일부 완료',
    doneCancelled: '취소됨', doneRunning: '진행 중', doneWaitingHuman: '확인 필요',
    laneRunning: '진행 중', laneYou: '확인 필요', lanePending: '대기', laneDone: '완료',
    langMarker: 'l {lang}', langEN: 'EN', langKR: 'KR',
    footFloor: 'w s 이동 · d ⏎ Phase 상세 · a 뒤로 · n 다음 ⚑ · q 닫기', footLog: 'w s 스크롤 · a 뒤로 · q 닫기',
  },
}

// a key the table lacks (a state or kind this mod does not know) draws as the key received: fail open, never a throw
const fmt = (text: string | undefined, vars: Record<string, string | number> = {}, key = '') =>
  text === undefined ? key : text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))

// one lookup of an engine word by key: the table's words when it holds the key, else `fallback` (the raw value the engine sent)
const wordOr = (words: Record<string, string>, key: string, fallback: string, vars?: Record<string, string | number>) =>
  Object.prototype.hasOwnProperty.call(words, key) ? fmt(words[key], vars) : fallback

// `in_progress` -> `InProgress`: an engine state word as the tail of a table key
const camel = (w: string) => w.toLowerCase().split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('')

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

// The English words the engine writes as a subject (view-summary.mjs SUBJECT_KEY_OF; strings.test.ts keeps the two equal): the pane
// maps one to its key. Any other subject is a card title or text a model or person wrote, drawn as written. The summary's exact shape
// is pinned by view-once-golden.json, so the engine's words ride as they are and the mod looks them up.
export const SUBJECT_KEY: Record<string, string> = {
  plan: 'subjPlan', build: 'subjBuild', integration: 'subjIntegration', QA: 'subjQa', 'final gate': 'subjFinalGate', report: 'subjReport',
  'the task': 'subjTask', 'a card': 'subjCard', 'a step': 'subjStep',
}
export const subjectWord = (wo: (key: string, fallback: string) => string, subject: string | null | undefined): string =>
  subject != null && Object.prototype.hasOwnProperty.call(SUBJECT_KEY, subject) ? wo(SUBJECT_KEY[subject]!, subject) : (subject ?? '')

// a person's words for the card the task is on now
function nowSentence(s: (key: keyof typeof en) => string, wo: (key: string, fallback: string) => string, task: SummaryTask): string {
  const label = wo(`now${cap(task.now.kind)}`, s('nowIdle'))
  return task.now.subject ? `${label}: ${subjectWord(wo, task.now.subject)}` : label
}

// A cache a reload may lose: when the view server was last started (at most once per 30 s)
const SERVE_RETRY_MS = 30_000
let serveStartedAt = 0
// The socket path of a tasks root too long for sun_path, asked of the server once per root
const longSocks = new Map<string, string>()

// What `node view.mjs --once <args>` prints: asked of the tasks root's state socket first (args become
// query parameters, proto=1); on a 409 (another protocol) this call runs `--once` and starts nothing; on
// any other failure the state server is started (throttled, interactive sessions only) and this call runs
// the unchanged `--once` spawn. The server leaves this session itself (own session, ignores SIGHUP), so
// the backgrounding `&` is only so the call does not wait; nohup alone would not survive a closed pane.
async function viewOnce($: EngineInterface, args: string[]): Promise<{ exitCode: number; stdout: string }> {
  const VIEW = `${$.plugin.root}/scripts/view.mjs`
  const SERVER = `${$.plugin.root}/mcp/stateserver.mjs`
  let tasksDir = ''
  let refused = false
  try {
    const tasks = await $.env.get('HARNESS_TASKS_DIR')
    const home = await $.env.get('HOME')
    tasksDir = tasks ? tasks.replace(/\/+$/, '') : home ? `${home}/.harness/tasks` : ''
    // a relative root means the session's cwd, not this process's; no cwd keeps the value as is
    if (tasks && !tasks.startsWith('/')) {
      const cwd = await $.session.cwd().catch(() => '')
      if (cwd && cwd.startsWith('/')) {
        const parts: string[] = []
        for (const p of `${cwd}/${tasks}`.split('/')) {
          if (p === '..') parts.pop()
          else if (p !== '' && p !== '.') parts.push(p)
        }
        tasksDir = `/${parts.join('/')}`
      }
    }
    let sock = tasksDir ? `${tasksDir}/.state.sock` : ''
    if (sock && new TextEncoder().encode(sock).length > 103) {
      let long = longSocks.get(tasksDir)
      if (long === undefined) {
        const r = await $.process.run(['node', SERVER, '--sock-path', '--tasks-dir', tasksDir])
        long = r.exitCode === 0 ? r.stdout.trim() : ''
        longSocks.set(tasksDir, long)
      }
      sock = long
    }
    if (sock) {
      const q = new URLSearchParams()
      for (let i = 0; i < args.length; i += 2) q.set(args[i].replace(/^--/, ''), args[i + 1] ?? '')
      q.set('proto', '1')
      const r = await $.http.fetch(`http://view/?${q.toString()}`, { socketPath: sock })
      if (r.status === 200) return { exitCode: 0, stdout: r.text }
      refused = r.status === 409
    }
  } catch {
    // no socket, refused, or a host that cannot reach it: start the server and spawn once
  }
  try {
    const now = await $.clock.now()
    if (tasksDir && !refused && (await $.session.surfaces()).length > 0 && (serveStartedAt === 0 || now - serveStartedAt >= SERVE_RETRY_MS)) {
      serveStartedAt = now
      await $.process.run(['sh', '-c', 'nohup node "$1" --tasks-dir "$2" >/dev/null 2>&1 </dev/null &', 'sh', SERVER, tasksDir])
    }
  } catch {
    // the spawn below still answers
  }
  return $.process.run(['node', VIEW, '--once', ...args])
}

// One report call for a task: the payload is stored under that task's id. A failed call or
// unreadable output leaves what was stored.
async function fetchReport($: EngineInterface, taskId: string, forCard = false): Promise<void> {
  try {
    const cwd = await $.session.cwd()
    const r = await viewOnce($, ['--format', 'report', '--task', taskId, '--cwd', cwd])
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
    const r = await viewOnce($, ['--format', 'decisions', '--task', taskId, '--cwd', cwd, ...(card === null ? [] : ['--card', card])])
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
// node, reason and next step (with the keys of the last two); the mod only draws them. A line missing any
// of run, node, reason is an old-shape line.
type Failure = { run: string; node: string; reason: string; reasonKey?: string; next: string | null; nextKey?: string; nextVars?: Record<string, string | number>; severity: 'info' | 'failure' }

function failureOf(one: TeamsEvent): Failure | null {
  const { run, node, reason, next_step: next, severity } = one
  if (one.kind !== 'node_finish' || typeof run !== 'string' || typeof node !== 'string' || typeof reason !== 'string') return null
  if (severity !== 'info' && severity !== 'failure') return null
  if (next !== undefined && next !== null && typeof next !== 'string') return null
  return {
    run, node, reason, next: next ?? null, severity,
    ...(typeof one.reason_key === 'string' ? { reasonKey: one.reason_key } : {}),
    ...(typeof one.next_key === 'string' ? { nextKey: one.next_key } : {}),
    ...(typeof one.next_vars === 'object' && one.next_vars !== null ? { nextVars: one.next_vars } : {}),
  }
}

// `<node> failed: <reason> → <next step>`, the arrow left out when there is no next step. The reason and the next step
// are drawn by their keys when the engine sent them (a key the table lacks draws as received); free reason text and an
// old-shape line stay as they came.
const failureWhat = (f: Failure, words: Record<string, string>) => {
  const reason = f.reasonKey === undefined ? f.reason : wordOr(words, f.reasonKey, f.reasonKey)
  const next = f.next === null || f.nextKey === undefined ? f.next : wordOr(words, f.nextKey, f.nextKey, f.nextVars)
  return `${f.node} ${words.nodeFailed}: ${reason}${next === null ? '' : ` → ${next}`}`
}

const FAIL_TOAST_MS = 10000
const PUSH_MAX = 200

// an old-shape line (no next_key) told its next step in this English; only the ⚠ is still read from it
const LEGACY_NEEDS_YOU = 'needs you'

// info (retry, reshape, nothing yet) is ↻ with the default timeout; a person must act ⚠, gave up ✗, both held longer
function toastFailure($: EngineInterface, f: Failure, words: Record<string, string>): void {
  if (f.severity === 'info') $.ui.toast(`↻ ${f.run} ${failureWhat(f, words)}`)
  else {
    const needsYou = f.nextKey !== undefined ? f.nextKey === 'nextNeedsYou' : f.next === LEGACY_NEEDS_YOU
    $.ui.toast(`${needsYou ? '⚠' : '✗'} ${f.run} ${failureWhat(f, words)}`, { timeoutMs: FAIL_TOAST_MS })
  }
}

// An event's toast and push sentence from its fields: the ev* sentence for kinds that have one. A kind it does not know, or a
// line missing a field it needs (an old-shape line), is the engine's own text verbatim: fail open.
function eventSentence(words: Record<string, string>, one: TeamsEvent): string {
  const run = one.run
  if (typeof run !== 'string') return one.text
  if (one.kind === 'waiting_human' && typeof one.node === 'string') return fmt(words.evWaiting, { run, node: one.node })
  if (one.kind === 'daemon_done' && typeof one.state === 'string') return fmt(words.evDone, { run, state: wordOr(words, `done${camel(one.state)}`, one.state) })
  if (one.kind === 'child_driver_capacity') return fmt(words.evPaused, { run })
  if (one.kind === 'daemon_exhausted') return fmt(words.evExhausted, { run })
  if (one.kind === 'upstream_fix_rounds_exhausted' && typeof one.package === 'string') return fmt(words.evFixRounds, { run, pkg: one.package })
  return one.text
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
      message = `teams ${failed.run}: ${words[kind]} \u2014 ${failureWhat(failed, words)}`
      if (message.length > PUSH_MAX) message = message.slice(0, PUSH_MAX - 1) + '\u2026'
    } else {
      const sentence = eventSentence(words, one)
      const m = /^(E-\S+) (.*)$/.exec(sentence)
      message = `teams ${m?.[1] ?? one.task_id}: ${words[kind]} \u2014 ${m?.[2] ?? sentence}`.slice(0, 200)
    }
    // PushNotification's result: { pushSent?, localSent? }
    await $.tool.call({ tool: 'PushNotification', message, status: 'proactive' } as never)
  } catch {
    // a failed push is a push not sent
  }
}

const TICK_MS = 3000
const SPIN_MS = 800
const MARKER_RECHECK_MS = 30000
const TEAMS_MARKERS = ['.claude/team.json', '.teams_output', '.harness-run']
const WORK_MAX = 6

// `l` or the footer Button: flip the language, remember the choice, and say the command in it. Nothing else is written.
async function toggleLang($: EngineInterface): Promise<void> {
  const to = (await read($, lang)) === 'en' ? 'ko' : 'en'
  await update($, lang, () => to)
  await update($, langChosen, () => true)
  await $.command.register({ name: 'teams-status', description: STRINGS[to].cmdDesc })
}

export const register: Register = on => {
  let isRunning = false
  const pushed = new Set<string>()
  // the session.start tick, kept so a received ask can refresh the data once
  let refresh: (() => Promise<void>) | null = null

  on('session.start', async ($, e, next) => {
    if ((await $.session.surfaces()).length === 0) return next(e)

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

    // no spawn in a folder that does not use teams: a watched EPIC, the open pane, or a marker in cwd or a parent
    let markerAt = 0
    let markerHit = false
    async function usesTeams() {
      try {
        if ((await read($, watch)).length > 0) return true
        if ((await $.ui.panes()).some(p => p.id === PANE)) return true
        const now = await $.clock.now()
        if (markerAt > 0 && now - markerAt < MARKER_RECHECK_MS) return markerHit
        let found = false
        let dir = await $.session.cwd()
        for (;;) {
          const base = dir === '/' ? '' : dir
          for (const m of TEAMS_MARKERS) if (await $.fs.exists(`${base}/${m}`)) found = true
          if (found || dir === '/' || dir === '') break
          dir = dir.slice(0, dir.lastIndexOf('/')) || '/'
        }
        markerHit = found
        markerAt = now
        return found
      } catch {
        return true
      }
    }

    async function tick() {
      if (isRunning) return
      isRunning = true
      try {
        if (!(await usesTeams())) return
        const cwd = await $.session.cwd()
        const since = await read($, cursor)

        const fetched = new Set<string>()
        const cardFetched = new Set<string>()
        const ev = await viewOnce($, ['--format', 'events', '--since', String(since), '--cwd', cwd])
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
              if (failure === null) $.ui.toast(eventSentence(STRINGS[await read($, lang)], one))
              else toastFailure($, failure, STRINGS[await read($, lang)])
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
        let sid: string | undefined
        try {
          sid = await $.session.id()
        } catch {
          // no session id: the call goes without --session
        }
        const data = await viewOnce($, [
          '--format', isOpen ? 'teams' : isSummary ? 'summary' : 'status', '--cwd', cwd,
          ...(id === undefined ? [] : ['--task', id]),
          ...(sid === undefined ? [] : ['--session', sid]),
        ])
        if (data.exitCode === 0) {
          const parsed = JSON.parse(data.stdout) as { status: StatusInfo; tasks?: SummaryTaskEntry[]; task: SummaryTask | null; teams?: TeamsView | null; dash?: Dash | null } & StatusInfo
          const info: StatusInfo = isSummary ? parsed.status : parsed
          await update($, status, () => info)
          await update($, summary, () => (isSummary ? parsed.task ?? null : null))
          await update($, teams, () => parsed.teams ?? null)
          await update($, dash, () => parsed.dash ?? null)
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
          // pinned only while a person must act (the engine draws it as a warning); the ask band already says so
          // Known limits: (1) the poll cannot see e.props.hasSurvey, so while a survey hides the band the status
          // line has no segment either. (2) The poll cannot see a dismissed band, so a dismissed band does not
          // bring the segment back; it returns only when asks are empty or the end-of-run card replaces the band.
          // With no asks (which includes no interactive surface) the segment is kept.
          const cardId = cardTask(await read($, ended))
          const held = await read($, cardReport)
          const cardShown = cardId !== undefined && held?.task_id === cardId && held.payload.verdict !== 'running'
          $.ui.status(info.waiting > 0 && !askBandShown(info.asks, cardShown) ? fmt(STRINGS[await read($, lang)].statusWaiting, { n: info.waiting }) : undefined)
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
    // (a language the person chose with `l` is kept: the setting no longer decides)
    if (!(await read($, langChosen))) {
      try {
        const language = (await $.settings.read()).language
        await update($, lang, () => (typeof language === 'string' && /^(ko|korean|한국어)/i.test(language) ? 'ko' : 'en'))
      } catch {
        // unreadable settings: English
        await update($, lang, () => 'en')
      }
    }
    await $.command.register({ name: 'teams-status', description: STRINGS[await read($, lang)].cmdDesc })
    // events older than this session's start are not toasted
    const now = await $.clock.now()
    await update($, cursor, since => (since === 0 ? now : since))
    refresh = tick
    $.clock.every(TICK_MS, tick)

    return next(e)
  })

  // a phone or the desktop app joined: an open pane is offered to it too (Remote Control attaches after the pane opened)
  on('session.attach', async ($, e, next) => {
    const r = await next(e)
    try {
      $.ui.log(`teams: ${e.surface} attached (${e.clientId})`, { to: 'debug' })
      if ((await $.ui.panes()).some(p => p.id === PANE)) await $.ui.open(OPEN)
    } catch {
      // a pane that cannot be offered leaves the session as it was
    }
    return r
  })

  // asked for by the person: the pane seats at any width; the command again closes it
  on('command.run', { command: 'teams-status' }, async $ => {
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: STRINGS[await read($, lang)].paneClosed }
    }
    const placed = await $.ui.open(OPEN)
    const paneOpened = STRINGS[await read($, lang)].paneOpened
    let run: { exitCode: number; stdout: string } | null = null
    try {
      run = await viewOnce($, ['--format', 'board', '--cwd', await $.session.cwd()])
    } catch {
      // a run that cannot start answers with the pane text
    }
    let surfaces: readonly string[] = []
    try {
      surfaces = await $.session.surfaces()
    } catch {
      // unreadable surfaces keep the board text
    }
    return { text: statusAnswer(run, paneOpened, surfaces, placed?.isPlaced === true) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Input, Markdown, Text } = ui
    const kind = await read($, view)
    const lang$ = await read($, lang)
    const s = (key: keyof typeof en, vars?: Record<string, string | number>) => fmt(STRINGS[lang$][key], vars, key)
    // an engine word by its key: the table's word, else the raw value the engine sent (fail open)
    const wo = (key: string, fallback: string, vars?: Record<string, string | number>) => wordOr(STRINGS[lang$], key, fallback, vars)
    // the same, for a word whose English is the engine's own and is pinned that way (a lane header that fits its box, an activity
    // kind, an upper-case ticket state): English keeps it, Korean goes through the key
    const woKo = (key: string, raw: string, vars?: Record<string, string | number>) => (lang$ === 'en' ? raw : wo(key, raw, vars))
    // node's word_key (idle, done, stalled, failed) names a STRINGS entry; a pure lookup, no decision
    const fixedWord = (key: string) => wo(`word${cap(key)}`, key)
    const id = await paneTask($)
    const listed = await read($, tasks)
    const entry = listed.find(t => t.task_id === id)
    // the summary is drawn only for the EPIC the pane shows; right after a switch it is the last one's until the next tick
    const held = await read($, summary)
    const task = held !== null && entry !== undefined && held.key !== entry.key ? null : held
    const info = await read($, status)
    const inner = Math.max(20, (e.props.bodyColumns ?? 80) - 4)
    // the Input draws what it holds: every edit is stored, and a handled key stores '' so the host drops the whole
    // buffer (text holding a `/` is no key: it stays until Enter). The store is a state update, so the pane redraws.
    const buffer = await read($, typed)
    const keep = (handle: (text: string) => Promise<void>) => async (text: string) => {
      await update($, typed, () => text)
      if (paneKey(text) === null) return
      try {
        await handle(text)
      } finally {
        await update($, typed, () => '')
      }
    }

    // said once, as the footer's last item
    // (no Button hotkey: the pane's Input holds the focus and takes `q` and `1`-`5` as text, see onKey)
    const close = <Button key="close" role="dismiss" plain dimColor label={s('close')} onPress={() => $.ui.close({ id: PANE })} />
    // the language marker: `l EN` / `l KR` beside an Input (the key works there), bare `EN` / `KR` on mobile (a Button only)
    const langWord = s(lang$ === 'en' ? 'langEN' : 'langKR')
    const marker = carriesInput(e.surface) ? s('langMarker', { lang: langWord }) : langWord
    const langButton = <Button key="lang" plain dimColor label={marker} onPress={() => toggleLang($)} />
    // plain tabs on one line: the selected one in full strength with a dot, the rest dim; `1`-`5` pick them
    const TABS = ['dash', 'floor', 'stories', 'decisions', 'log', 'report'] as const
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
          {/* the empty view has no tabs to pick: its Input takes `q` and `l` only, so the pane closes or switches language on the key as it does elsewhere */}
          {id === undefined && carriesInput(e.surface) && (
            <Box height={1} overflow="hidden">
              <Input key="keys" autoFocus value={buffer} placeholder="" onInput={keep(async text => {
                const k = paneKey(text)?.kind
                if (k === 'close') await $.ui.close({ id: PANE })
                else if (k === 'lang') await toggleLang($)
              })} onSubmit={async () => {}} />
            </Box>
          )}
          <Box columnGap={2}>{close}{langButton}</Box>
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
    // the list's state is a ticket state (BACKLOG, IN_PROGRESS, stalled), a run state (running) or 'unknown'; English draws it as sent
    const epicWord = (t: SummaryTaskEntry) => (t.state === 'waiting_human' ? s('nodeWaiting') : lang$ === 'en' ? t.state : wo(`ticket${camel(t.state)}`, wo(`state${camel(t.state)}`, t.state)))
    const epicOf = listed.map(t => epicCells(t, epicState(t), t.task_id === id, now, epicWord(t)))
    const epicWidths = columnWidths(epicOf.map(r => r.cells), inner, 2, [3], 4, [6, 5], 12)
    const epicLines: Line[] = epicOf.map(r => rowLine(r.cells, epicWidths, 2, r.tints))
    const epics = epicLines.length === 0 ? null : renderLines(ui, epicLines, 'e')

    // the STORYs tab: every listed task's STORYs at work, columns at the same offset on every row
    const rows = storyRows(listed)
    const pick = Math.min(Math.max(0, await read($, row)), Math.max(0, rows.length - 1))
    const verdictText = (v: string | null) => (v === null ? '' : VERDICT_WORD[v] === undefined ? v : s(VERDICT_WORD[v]!))
    const harnessText = (t: SummaryTaskEntry) => t.harness === null ? ''
      : `${t.stages.map(g => `${MARK[g.state]}${wo(`stage${cap(g.key)}`, g.key)}`).join(' ')}${t.harness.slug ? ` · ${t.harness.slug}` : ''}${t.harness.moving ? ' ▸' : ''}`
    const judgeText = (score: number, threshold: number | null) => (threshold === null ? s('storyJudgeBare', { score }) : s('storyJudge', { score, threshold }))
    const storyOf = rows.map(({ entry: t, item }, i) => storyCells(item, verdictText(item.last_verdict), harnessText(t), i === pick, fixedWord, judgeText, gap => s('storyGap', { gap })))
    const storyWidths = columnWidths(storyOf.map(r => r.cells), inner, 2, STORY_SHRINK, 4, [9, 7, 8, 6, 5], 24)
    // line 2 sits under the title: the marker and icon columns and their gaps, then the note up to the pane's edge;
    // in a narrow pane (inner < 60) it is indented 2 cells instead, so the reason keeps the room
    const noteAt = inner < 60 ? 2 : storyWidths.slice(0, 2).reduce((n, w) => n + (w > 0 ? w + 2 : 0), 0)
    const storyLines: Line[] = storyOf.flatMap(r => [
      rowLine(r.cells, storyWidths, 2, r.tints),
      ...(r.note === '' ? [] : [[{ t: ' '.repeat(noteAt) }, { t: clipText(r.note, Math.max(4, inner - noteAt)), dim: true }] as Line]),
    ])
    const storiesBody = rows.length === 0 ? <Text dimColor>{s('noStories')}</Text>
      : renderLines(ui, storyLines, 's')

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
      else if (key.kind === 'lang') await toggleLang($)
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
    const footerHint = footerPlan({ steps: listed.length > 1 ? 2 : 0, open: openHint, close: s('close'), hint: s('keysHint'), marker }, inner).hint
    const footer = (
      <Box columnGap={2}>
        {listed.length > 1 && <Button key="prev" plain label={s('prev')} onPress={() => cycle(-1)} />}
        {listed.length > 1 && <Button key="next" plain label={s('next')} onPress={() => cycle(1)} />}
        {carriesInput(e.surface) && <Box flexShrink={1} height={1} overflow="hidden"><Input key="keys" autoFocus value={buffer} placeholder={footerHint} onInput={keep(onKey)} onSubmit={async (text: string) => { await onSubmit(text); await update($, typed, () => '') }} /></Box>}
        {openHint !== '' && <Text dimColor={!canOpen}>{openHint}</Text>}
        <Box flexShrink={0}>{close}</Box>
        <Box flexShrink={0}>{langButton}</Box>
      </Box>
    )
    // the Dashboard: node's model (view-dashboard.mjs) for the EPIC the pane shows. An Svg surface draws node's own
    // SVG; the terminal draws the same model in Ink — header, tiles, numbered pipeline with Build's packages, lanes, activity
    const dv = await read($, dash)
    const dm = dv !== null && dv.model.key === (task?.key ?? entry?.key) ? dv.model : null
    // Svg is every surface's but the terminal's (mod.md rule 8: behind an e.surface check)
    const Svg = e.surface === 'terminal' ? undefined : (ui as { Svg?: any }).Svg
    if (task === null && kind === 'dash' && dm !== null) {
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
          <Box marginY={1}>{tabs}</Box>
          {drawDash()}
          {footer}
        </Box>
      )
    }
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

    const stateWord = wo(`state${camel(task.state)}`, task.state)
    // a failed card's reason: the engine's key when it sent one (no reason recorded, failed), else the text a model or person wrote
    const reasonText = (w: { reason: string | null; reason_key?: string }) => (w.reason_key === undefined ? w.reason : wo(w.reason_key, w.reason_key))
    const card = (c: SummaryTask['work'][number], i: number) => (
      <Box key={`c${i}`} flexDirection="column">
        <Text wrap="truncate-end"><Text color={TINT[c.state]}>{MARK[c.state]}</Text>{` ${c.title}`}</Text>
        {c.state === 'failed' && c.reason && <Text color="error" wrap="truncate-end">{`  ${reasonText(c)}`}</Text>}
      </Box>
    )

    // above the tabs only what waits on the person: each waiting card with its question, then the runs besides this one
    const others = (info?.waiting ?? 0) - task.you.count
    const tv = await read($, teams)
    const teamWord = (t: string) => wo(`team${cap(t)}`, t)
    const nodeWord = (n: string) => (n === 'waiting' ? s('nodeWaiting') : n)
    const waitCards = task.you.cards ?? []
    const waitBox = waitCards.length === 0 && others <= 0 ? null : (
      <Box flexDirection="column" marginTop={1}>
        {waitCards.map((c, i) => (
          <Text key={`w${i}`} color="warning" wrap="truncate-end">{`⚑ ${subjectWord(wo, c.title)}${c.question ? ` — ${c.question}` : ''}`}</Text>
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
    const handoffOf = handoffCells(entry?.handoffs ?? [], (key, vars) => wo(key, key, vars))
    const handoffWidths = columnWidths(handoffOf, inner, 2, [2, 3])
    // asks addressed to this session, from node's status.asks: one warning line each, above the hand-offs
    const askOf = ((await read($, status))?.asks ?? []).map(a => [s('askTo', { who: a.who }), a.question])
    const askWidths = columnWidths(askOf, inner, 2, [1])
    const floorLines = (
      <Box flexDirection="column">
        {askOf.length > 0 && <Box marginBottom={1}>{renderLines(ui, askOf.map(r => rowLine(r, askWidths, 2, ['warning'])), 'a')}</Box>}
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
              <Text color={TINT[g.state]} bold={g.state === 'running'}>{`${DOT[g.state]} ${wo(`stage${cap(g.key)}`, g.key)}`}</Text>
              {next !== undefined && <Text color={solid ? 'success' : 'inactive'}>{solid ? ' ━━ ' : ' ┄┄ '}</Text>}
            </Box>
          )
        })}
      </Box>
    )
    // the card list heads the Decisions tab, where a picked card's thread is read
    const reasonOf = (title: string) => {
      const w = task.work.find(x => x.title === title && x.state === 'failed')
      return w === undefined ? null : reasonText(w)
    }
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
                  label={`${MARK[c.mark]} ${c.title} · ${c.state === null ? '' : woKo(`ticket${camel(c.state)}`, c.state)}${c.now ? ` · ${nodeWord(c.now.node)} ${c.now.agent ?? ''} ${since(c.now.elapsed_ms)}`.trimEnd() : ''}`}
                  onPress={() => pickCard(c.id)} /></Box>
                {c.mark === 'failed' && reasonOf(c.title) && <Text color="error" wrap="truncate-end">{`  ${reasonOf(c.title)}`}</Text>}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )

    // hoisted: the task-less view above draws it too
    function drawDash() {
    let dashBody
    if (dm === null) {
      dashBody = <Text dimColor>{s('loading')}</Text>
    } else if (Svg !== undefined) {
      dashBody = <Svg source={dv!.svg} alt={dv!.alt} />
    } else {
      // every engine word of the model by its key (state*, tile*, stage*, lane*, log*); an unknown key draws the raw value
      const runState = wo(`state${camel(dm.state)}`, dm.state)
      const stateText = clipText(runState.toUpperCase(), 12)
      const tileLabel = (t: (typeof dm.tiles)[number]) => wo(`tile${cap(t.key)}`, t.label).toUpperCase()
      // the sub-word: the engine's key when it sent one, else the key read from tile.key and the sub text
      const tileSub = (t: (typeof dm.tiles)[number]) => {
        if (t.sub_key !== undefined) return wo(t.sub_key, t.sub_key, t.sub_vars)
        const stages = t.key === 'progress' ? /^(\d+)\/(\d+) stages$/.exec(t.sub) : null
        if (stages !== null) return wo('tileSubStages', t.sub, { done: stages[1]!, total: stages[2]! })
        const turns = t.key === 'cost' ? /^(\d+) turns$/.exec(t.sub) : null
        if (turns !== null) return wo('tileSubTurns', t.sub, { n: turns[1]! })
        return wo(`tileSub${cap(t.sub)}`, t.sub)
      }
      const laneWord = (l: (typeof dm.lanes)[number]) => woKo(`lane${cap(l.key)}`, l.short)
      const actWord = (a: (typeof dm.activity)[number]) => woKo(`log${cap(a.kind)}`, a.kind, { s: '' }).trim()
      // the run's now line: the stage word by key, then the subject; the engine's text when the model carries no kind
      const nowKind = dm.now_key ?? task?.now.kind
      const nowSubject = subjectWord(wo, dm.now_key !== undefined ? dm.now_subject : task?.now.subject)
      const nowText = dm.now === '' || nowKind === undefined ? dm.now : [wo(`stage${cap(nowKind)}`, nowKind), nowSubject].filter(Boolean).join(' · ')
      // the state word, a space, the bar, ' 100%': one row at any width
      const barW = Math.max(4, Math.min(60, inner - stateText.length - 6))
      const fill = Math.round((barW * dm.pct) / 100)
      const tileW = Math.max(12, Math.floor((inner - (dm.tiles.length - 1)) / dm.tiles.length))
      // lane box width from node (view-summary.mjs laneBoxes): 0 = a pane too narrow for boxes, which lists them one per line
      const laneBox: number = dm.laneBoxes[Math.min(inner, dm.laneBoxes.length - 1)]
      // boxes only where each keeps a readable width; a narrow pane lists them one per line
      const tilesFit = inner >= dm.tiles.length * 15
      const LANE_TINT: Record<string, string> = { running: 'claude', you: 'warning', pending: 'inactive', done: 'success' }
      const ACT_TINT: Record<string, string> = { failed: 'error', passed: 'success', finished: 'success', integrated: 'success', waiting: 'warning' }
      const STAGE_GLYPH: Record<Mark, string> = { done: '✔', running: '◉', pending: '○', failed: '✘' }
      // the run's numbers, label · value on one line each, columns at one offset
      const runOf = dm.run ? runCells(dm.run, (key, vars) => s(key as keyof typeof en, vars)) : []
      const runWidths = columnWidths(runOf.map(r => r.cells), inner, 2, [1])
      dashBody = (
        <Box flexDirection="column">
          <Box>
            <Text color={TINT[(dm.state === 'complete' ? 'done' : dm.state === 'blocked' ? 'failed' : 'running') as Mark]} bold>{`${stateText} `}</Text>
            <Text color="claude">{'█'.repeat(fill)}</Text><Text color="inactive">{'░'.repeat(barW - fill)}</Text>
            <Text bold>{` ${dm.pct}%`}</Text>
          </Box>
          {dm.now !== '' && <Text dimColor wrap="truncate-end">{`▸ ${nowText}`}</Text>}
          {!tilesFit && (
            <Box marginTop={1} flexDirection="column">
              {dm.tiles.map(t => (
                <Text key={`tile-${t.key}`} wrap="truncate-end"><Text dimColor>{tileLabel(t).padEnd(10)}</Text><Text bold color={t.alert ? 'warning' : undefined}>{t.value}</Text><Text dimColor>{`  ${tileSub(t)}`}</Text></Text>
              ))}
            </Box>
          )}
          {tilesFit && <Box marginTop={1} columnGap={1}>
            {dm.tiles.map(t => (
              <Box key={`tile-${t.key}`} width={tileW} flexDirection="column" borderStyle="round" borderColor={t.alert ? 'warning' : 'inactive'} paddingX={1}>
                <Text dimColor>{clipText(tileLabel(t), tileW - 4)}</Text>
                <Text bold color={t.alert ? 'warning' : undefined}>{clipText(t.value, tileW - 4)}</Text>
                <Text dimColor>{clipText(tileSub(t), tileW - 4)}</Text>
              </Box>
            ))}
          </Box>}
          {runOf.length > 0 && <Box marginTop={1}>{renderLines(ui, runOf.map(r => rowLine(r.cells, runWidths, 2, r.tints)), 'r')}</Box>}
          <Box marginTop={1} flexWrap="wrap">
            {dm.stages.map((g, i) => (
              <Box key={`ds-${g.key}`}>
                <Text color={TINT[g.state]} bold={g.state === 'running'}>{`${STAGE_GLYPH[g.state]} ${g.n} ${wo(`stage${cap(g.key)}`, g.label)}`}</Text>
                {i < dm.stages.length - 1 && <Text color={dm.stages[i + 1]!.state === 'pending' ? 'inactive' : 'success'}>{dm.stages[i + 1]!.state === 'pending' ? ' ┄┄ ' : ' ━━ '}</Text>}
              </Box>
            ))}
          </Box>
          {dm.packages.slice(0, 6).map((p, i, all) => (
            <Text key={`dp-${i}`} wrap="truncate-end"><Text color="inactive">{i === all.length - 1 ? '  └─ ' : '  ├─ '}</Text><Text color={TINT[p.state]}>{`${MARK[p.state]} `}</Text>{clipText(p.title, inner - 8)}</Text>
          ))}
          {laneBox === 0 && (
            <Box marginTop={1} flexDirection="column">
              {dm.lanes.map(l => (
                <Text key={`lane-${l.key}`} wrap="truncate-end"><Text color={LANE_TINT[l.key]}>● </Text><Text bold>{laneWord(l)}</Text><Text dimColor>{` ${l.count}  `}</Text>{l.cards.map(c => `${c.failed ? '✘ ' : ''}${c.title}`).join(' · ')}</Text>
              ))}
            </Box>
          )}
          {laneBox > 0 && <Box marginTop={1} columnGap={1}>
            {dm.lanes.map(l => (
              <Box key={`lane-${l.key}`} width={laneBox} flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1}>
                <Text><Text color={LANE_TINT[l.key]}>● </Text><Text bold>{laneWord(l)}</Text><Text dimColor>{` ${l.count}`}</Text></Text>
                {l.cards.map((c, j) => <Text key={`lc-${j}`} color={c.failed ? 'error' : undefined}>{clipText(`${c.failed ? '✘ ' : ''}${c.title}`, laneBox - 4)}</Text>)}
                {l.more > 0 && <Text dimColor>{`+${l.more}`}</Text>}
              </Box>
            ))}
          </Box>}
          <Box marginTop={1} flexDirection="column">
            {dm.activity.map((a, i) => (
              <Text key={`da-${i}`} wrap="truncate-end"><Text dimColor>{`${a.time}  `}</Text><Text color={ACT_TINT[a.kind] ?? 'inactive'}>{`● ${actWord(a).padEnd(10)}`}</Text>{` ${subjectWord(wo, a.subject)}`}</Text>
            ))}
          </Box>
        </Box>
      )
    }
    return dashBody
    }
    const dashBody = drawDash()

    let body
    if (kind === 'dash') {
      body = dashBody
    } else if (kind === 'floor') {
      body = floorLines
    } else if (kind === 'stories') {
      body = <Box flexDirection="column">{rail}{storiesBody}</Box>
    } else if (kind === 'decisions') {
      const pickedId = await read($, selected)
      const dp = await read($, decisions)
      const mine = dp !== null && dp.task_id === id && dp.card === pickedId ? dp.payload.entries : null
      const what = (d: Decision) => {
        const label = d.kind === 'verdict' ? s(VERDICT_WORD[d.verdict ?? ''] ?? 'vReject') : wo(`kind${cap(d.kind)}`, d.kind)
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
      const lines = task.log.map(one => `${one.time} ${wo(`log${cap(one.kind)}`, `${one.kind} ${one.subject ?? ''}`, { s: subjectWord(wo, one.subject) }).trim()}`)
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
    const s = (key: keyof typeof en, vars?: Record<string, string | number>) => fmt(STRINGS[lang$][key], vars, key)
    const wo = (key: string, fallback: string) => wordOr(STRINGS[lang$], key, fallback)
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
    // status.asks is not cwd-scoped like waiting: a card from another repo's task can address this session
    const flagged = (info?.waiting ?? 0) > 0 || (task?.you.count ?? 0) > 0 || (info?.asks?.length ?? 0) > 0
    const isRunning = info?.latest != null && task?.state === 'running'
    if (e.props.hasSurvey || (!flagged && !isRunning)) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const inboxLabel = (n: number) => s(n === 1 ? 'inboxOne' : 'inboxMany', { n })
    const flag = flagged ? <Box flexShrink={0} marginRight={1}><Text color="warning" bold>⚑</Text></Box> : null
    // a card addressed to this session: its question leads the ⚑ row (node's status.asks, newest first)
    const asks = info?.asks ?? []
    const first = asks[0]
    const asked = first === undefined ? null : (
      // one row Box, not a fragment: the host lays fragment children out on their own line
      <Box flexDirection="row" flexShrink={1} marginRight={1}>
        <Box flexShrink={1}><Text color="warning" wrap="truncate-end">{s('asksYou', { who: first.who, q: first.question })}</Text></Box>
        {asks.length > 1 && <Box flexShrink={0} marginLeft={1}><Text dimColor>{`+${asks.length - 1}`}</Text></Box>}
      </Box>
    )
    if (task === null || !isRunning) {
      return (
        <Box flexDirection="column">
          <Box>
            {flag}
            {asked}
            <Box flexShrink={0}><Button key="inbox" label={inboxLabel(Math.max(info?.waiting ?? 0, task?.you.count ?? 0, asks.length))} onPress={open} /></Box>
          </Box>
          {await next(e)}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Box>
          {flag}
          {asked}
          <Box flexShrink={1}><Text dimColor wrap="truncate-end">{`teams · ${task.worktree ? `⑂ ${task.worktree} · ` : ''}${task.title} — ${nowSentence(s, wo, task)}`}</Text></Box>
          <Box flexShrink={0} marginLeft={1}>
            <Text color="success">{'━'.repeat(task.total > 0 ? Math.round((10 * task.done) / task.total) : 0)}</Text>
            <Text color="inactive">{'─'.repeat(10 - (task.total > 0 ? Math.round((10 * task.done) / task.total) : 0))}</Text>
            <Text dimColor>{` ${s('bandDone', { done: task.done, total: task.total })}`}</Text>
          </Box>
          {Math.max(info?.waiting ?? 0, asks.length) > 0
            ? <Box flexShrink={0} marginLeft={1}><Button key="inbox" label={inboxLabel(Math.max(info?.waiting ?? 0, asks.length))} onPress={open} /></Box>
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

  // receiver: a peer's message that node reads as a teams ask is taken here and the data refreshed once
  on('session.receive', { origin: { kind: 'peer' } }, async ($, e, next) => {
    const r = await $.process.run(['node', `${$.plugin.root}/scripts/ask-message.mjs`, '--received', '--session', await $.session.id()], { stdin: e.text })
    if (r.exitCode !== 0 || r.stdout.trim() === '') return next(e)
    if (refresh !== null) await refresh()
    return { consumed: 'teams ask' }
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
