import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Dash, DecisionsPayload, ReportPayload, StatusInfo, SummaryTask, SummaryTaskEntry, TeamsEvent, TeamsView } from '../types'
import { HOME, askBandShown, carriesInput, fallbackSelection, levelOf, pageEsc, pageKey, pageStep, paneSlash, reconcileEpic, selectedOf, statusAnswer } from './pane'
import type { Page, PageKey, PageNav, RowRef, StepCtx, StepResult } from './pane'
import { HOME_PLANS, PAGE_ROWS, PHASE_KEYS, clipText, costText, epicElapsed, floorRows, footerPlan, homeHeader, homeRows, isEnded, logLines, needsOf, pageLines, phaseLines, renderLines, rowIdsOf, since, storyGrid, storyLabel, storyNow, storyReportLines, storyRows, storyTop, width, windowOf } from './teams-draw'
import type { DecisionX, Line, PageOpts, PageRow, PhaseEntry, StoryPayload, StoryReport } from './teams-draw'

const cursor = atom({ plugin: 'teams', key: 'cursor' } as const, 0)
const status = atom({ plugin: 'teams', key: 'status' } as const, null as StatusInfo | null)
const summary = atom({ plugin: 'teams', key: 'summary' } as const, null as SummaryTask | null)
const teams = atom({ plugin: 'teams', key: 'teams' } as const, null as TeamsView | null)
const dash = atom({ plugin: 'teams', key: 'dash' } as const, null as Dash | null)
const watch = atom({ plugin: 'teams', key: 'watch' } as const, [] as string[])
// every listed EPIC (live first, then stalled), the ids of the tick before, and the one the data call is for
const tasks = atom({ plugin: 'teams', key: 'tasks' } as const, [] as SummaryTaskEntry[])
const taskIds = atom({ plugin: 'teams', key: 'taskIds' } as const, [] as string[])
const epic = atom({ plugin: 'teams', key: 'epic' } as const, null as string | null)
// the page stack (pane.ts PageNav): the page, the page ANSWER came from, the row id and scroll offset per level, the ended EPICs
// shown open. The pane's page decides the EPIC the data call is for.
const page = atom({ plugin: 'teams', key: 'page' } as const, HOME as Page)
const pageFrom = atom({ plugin: 'teams', key: 'pageFrom' } as const, null as Page | null)
const pageSel = atom({ plugin: 'teams', key: 'pageSel' } as const, {} as Record<string, string>)
const pageScroll = atom({ plugin: 'teams', key: 'pageScroll' } as const, {} as Record<string, number>)
const unfolded = atom({ plugin: 'teams', key: 'unfolded' } as const, {} as Record<string, boolean>)
// `n` found no flag: a dim line says so until the next key
const flagHint = atom({ plugin: 'teams', key: 'flagHint' } as const, false)
// a counter only: answer mode's draft lives in a module variable, and a change to it bumps this so the pane redraws
const answerRev = atom({ plugin: 'teams', key: 'answerRev' } as const, 0)
// the pane Input's text: drawn as its value, so a handled key can draw '' and the host drops what was typed
const typed = atom({ plugin: 'teams', key: 'typed' } as const, '')
// the spinner frame beside an acting worker; moved by the 800 ms clock only while a worker acts
const frame = atom({ plugin: 'teams', key: 'frame' } as const, 0)
// the report of one task: keyed to the task it was fetched for, so a card or tab never draws another's
const report = atom({ plugin: 'teams', key: 'report' } as const, null as { task_id: string; payload: ReportPayload } | null)
// the report behind the end-of-run card: its own atom, so an open Report tab on another task never
// replaces it (nor it the tab)
const cardReport = atom({ plugin: 'teams', key: 'cardReport' } as const, null as { task_id: string; payload: ReportPayload } | null)
// what the open page reads beyond the listing, each keyed to the EPIC (and STORY) it was fetched for so a page never draws another's:
// a Phase page's decisions thread, a STORY's payload (STORY and Log pages), a STORY's report
const decisions = atom({ plugin: 'teams', key: 'decisions' } as const, null as { task_id: string; payload: DecisionsPayload } | null)
const storyData = atom({ plugin: 'teams', key: 'storyData' } as const, null as { task_id: string; story: string; payload: StoryPayload } | null)
const storyDoc = atom({ plugin: 'teams', key: 'storyDoc' } as const, null as { task_id: string; story: string; payload: StoryReport } | null)
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
// while answering Esc is the person's, not the host's close (F2-AC-12)
const OPEN_ANSWER = { id: PANE, title: 'Teams', focus: true } as const

const en = {
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
  noStories: 'No STORY at work.',
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
  stateWaitingHuman: 'waiting_human', stateStale: 'stale', stateUnknown: 'unknown', statePartial: 'partial', statePending: 'pending',
  doneCancelled: 'cancelled', doneRunning: 'running', doneWaitingHuman: 'waiting_human',
  laneRunning: 'In progress', laneYou: 'Needs you', lanePending: 'Up next', laneDone: 'Done',
  langMarker: 'l {lang}', langEN: 'EN', langKR: 'KR',
  // F2 page-stack words. Key = the spec's dotted name with the dots dropped and each part capitalised, after `f2`
  // (F2.page.floor -> f2PageFloor; pane.ts f2Key does it for a key the engine sends, e.g. F2.log.*). Families: page, phase.name, rail,
  // crumb, hint, home, fold, row, phase, story, log, report, answer, btn, flag, foot, floor.
  f2PageFloor: 'FLOOR', f2PageLog: 'Log', f2PageReport: 'Report',
  f2PhaseNamePlan: 'Plan', f2PhaseNameBuild: 'Build', f2PhaseNameIntegrate: 'Integrate', f2PhaseNameQa: 'QA', f2PhaseNameGate: 'Gate', f2PhaseNameReport: 'Report',
  f2RailIntegrate: 'Integ', f2RailReport: 'Rep', f2CrumbStory: 'STORY {id}', f2HintNoFlag: 'No ⚑ waiting',
  f2HomeDrivers: 'drivers {n}/{max} · load {l}/{max} (machine-wide)',
  f2FoldEnded: 'ended {ago} ago · STORY {done}/{total}', f2FoldHasReport: 'report ready', f2FoldUnfold: 'd unfold', f2FoldRefold: 'a fold',
  f2RowRejected: 'last {score}/{threshold} · {reason}', f2RowRetrying: 'try {n}/{max}', f2RowStalledMinutes: '⏸ {m}m', f2RowAgents: '{n} ag',
  f2PhaseRunning: 'Running', f2PhaseHandoffs: 'Handed over', f2PhaseDecisions: 'Decisions (this Phase)', f2PhaseAccept: 'accept {score}', f2PhaseReject: 'reject {score}',
  f2StoryFlow: 'FLOW', f2StoryProgress: 'Progress', f2StoryParticipants: 'Participants', f2StoryGrid: 'Attempts', f2StoryNow: 'Now',
  f2StoryTryLine: 'this try {n}/{m} nodes · total {t}/{u} (based on {k} tries)', f2StoryAgents: 'subagent: {total} total · {live} live',
  f2StoryLogRow: 'Log {n} · last {ago} ago', f2StoryReportRow: 'Report: appears after the gate passes', f2StoryAnswerRow: '⏎ answer',
  f2LogCount: '{n} entries', f2LogAttemptStart: 'attempt {n} started', f2LogAttemptCommits: 'attempt {n} commits {c}',
  f2LogAttemptReject: 'attempt {n} reject {score}/{threshold}', f2LogApproved: 'approved ({gaps} gaps)', f2LogCriteria: '{n} acceptance criteria',
  f2LogSubgoals: '{n} subgoals', f2LogAsked: 'TeamLeader → me "{question}"',
  f2ReportNotAvailable: 'Not available yet: appears after the gate passes', f2ReportSeeLog: 'Look again', f2ReportAccepted: 'accepted {score}/{threshold} · {t}',
  f2ReportVerdictLine: 'judge {score} / threshold {threshold} · attempt {n}/{max}', f2ReportTestsPassed: '{n} tests passed',
  f2ReportResult: 'Result', f2ReportVerdict: 'Judge', f2ReportFiles: 'Files changed', f2ReportDecisions: 'Decisions', f2ReportLeft: 'Left over',
  f2AnswerTitle: 'Answer the question', f2AnswerPrompt: 'Answer', f2AnswerContext: 'Context', f2AnswerSend: '⏎ send', f2AnswerCancel: 'empty ⏎ cancel',
  f2AnswerDesktopOnly: 'answer on a desktop', f2AnswerAccepted: 'Answer sent', f2AnswerRefused: 'Not accepted: {reason}', f2AnswerFailed: 'Could not run the answer tool: {reason}',
  f2BtnUp: '▲', f2BtnDown: '▼', f2BtnOpen: 'open', f2BtnBack: 'back', f2BtnFlag: '⚑', f2BtnClose: 'close',
  f2FlagTitle: 'Waiting for you {n}', f2FlagAge: '{m} waiting', f2FlagDriverSilent: 'no output for {m} (driver stopped?)',
  f2FootHome: 'w s move · d ⏎ open (EPIC → Floor · STORY → detail) · n next ⚑ · q close', f2FootFloor: 'w s move · d ⏎ Phase detail · a back · n next ⚑ · q close',
  f2FootStory: 'w s move · d ⏎ open · a back · n next ⚑ · q close', f2FootScroll: 'w s scroll · a back · n next ⚑ · q close',
  f2FootAnswer: 'Input mode: letters go in as typed · ⏎ send · empty ⏎ cancel',
  f2FloorPhaseOf: 'Phase {n}/6', f2FloorDecisionsN: 'decisions {n}', f2FloorReportHint: 'EPIC report opens here',
  // keys the engine sends beside its English (view-status decisions, docs.mjs unaccepted_packages); the English stays beside each
  actorHuman: 'human', proposalSize: 'size {size}', proposalSizeFlow: 'size {size} · {flow}',
  resplitAreas: 'resplit → areas:{n}', resplit: 'resplit', replanIds: 'replan {ids}',
  reasonNeverDispatched: 'never dispatched', reasonState: 'state: {state}',
}

// one table, two languages; the type keeps the keys identical
export const STRINGS: Record<'en' | 'ko', Record<keyof typeof en, string>> = {
  en,
  ko: {
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
    noStories: '진행 중인 STORY가 없습니다.',
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
    stateWaitingHuman: '확인 필요', stateStale: '오래됨', stateUnknown: '알 수 없음', statePartial: '일부 완료', statePending: '대기',
    doneCancelled: '취소됨', doneRunning: '진행 중', doneWaitingHuman: '확인 필요',
    laneRunning: '진행 중', laneYou: '확인 필요', lanePending: '대기', laneDone: '완료',
    langMarker: 'l {lang}', langEN: 'EN', langKR: 'KR',
    f2PageFloor: 'FLOOR', f2PageLog: 'Log', f2PageReport: 'Report',
    f2PhaseNamePlan: 'Plan', f2PhaseNameBuild: 'Build', f2PhaseNameIntegrate: 'Integrate', f2PhaseNameQa: 'QA', f2PhaseNameGate: 'Gate', f2PhaseNameReport: 'Report',
    f2RailIntegrate: 'Integ', f2RailReport: 'Rep', f2CrumbStory: 'STORY {id}', f2HintNoFlag: '대기 중인 ⚑ 없음',
    f2HomeDrivers: 'drivers {n}/{max} · load {l}/{max} (머신 전체)',
    f2FoldEnded: '끝남 {ago} 전 · STORY {done}/{total}', f2FoldHasReport: '보고서 있음', f2FoldUnfold: 'd 펼치기', f2FoldRefold: 'a 접기',
    f2RowRejected: '직전 {score}/{threshold} · {reason}', f2RowRetrying: 'try {n}/{max}', f2RowStalledMinutes: '⏸ {m}분', f2RowAgents: '{n} ag',
    f2PhaseRunning: '돌고 있음', f2PhaseHandoffs: '넘겨준 일', f2PhaseDecisions: '결정 (이 Phase)', f2PhaseAccept: 'accept {score}', f2PhaseReject: 'reject {score}',
    f2StoryFlow: 'FLOW', f2StoryProgress: '진행', f2StoryParticipants: '참가', f2StoryGrid: '시도', f2StoryNow: '지금',
    f2StoryTryLine: '이번 시도 {n}/{m} 노드 · 전체 {t}/{u} (시도 {k}회 기준)', f2StoryAgents: 'subagent 누적 {total} · 지금 {live}',
    f2StoryLogRow: 'Log {n}건 · 마지막 {ago} 전', f2StoryReportRow: 'Report: gate 통과 후 생김', f2StoryAnswerRow: '⏎ 답하기',
    f2LogCount: '{n}건', f2LogAttemptStart: '시도 {n} 시작', f2LogAttemptCommits: '시도 {n} 커밋 {c}건',
    f2LogAttemptReject: '시도 {n} reject {score}/{threshold}', f2LogApproved: '승인 (지적 {gaps})', f2LogCriteria: '완료 기준 {n}개',
    f2LogSubgoals: '하위 목표 {n}개', f2LogAsked: 'TeamLeader → 나 "{question}"',
    f2ReportNotAvailable: '아직 없음: gate 통과 후 생김', f2ReportSeeLog: '다시 보기', f2ReportAccepted: 'accepted {score}/{threshold} · {t}',
    f2ReportVerdictLine: 'judge {score} / 기준 {threshold} · 시도 {n}/{max}', f2ReportTestsPassed: '테스트 {n} 통과',
    f2ReportResult: '결과', f2ReportVerdict: '판정', f2ReportFiles: '바뀐 파일', f2ReportDecisions: '결정', f2ReportLeft: '남은 일',
    f2AnswerTitle: '질문에 답하기', f2AnswerPrompt: '답', f2AnswerContext: '맥락', f2AnswerSend: '⏎ 보내기', f2AnswerCancel: '빈 ⏎ 취소',
    f2AnswerDesktopOnly: '데스크톱에서 답해 주세요', f2AnswerAccepted: '답을 보냈습니다', f2AnswerRefused: '받지 못했습니다: {reason}', f2AnswerFailed: '답변 도구를 실행하지 못했습니다: {reason}',
    f2BtnUp: '▲', f2BtnDown: '▼', f2BtnOpen: '열기', f2BtnBack: '뒤로', f2BtnFlag: '⚑', f2BtnClose: '닫기',
    f2FlagTitle: '나를 기다림 {n}', f2FlagAge: '{m} 대기', f2FlagDriverSilent: '응답 없음 {m} (드라이버 멈춤?)',
    f2FootHome: 'w s 이동 · d ⏎ 열기 (EPIC → FLOOR · STORY → 상세) · n 다음 ⚑ · q 닫기', f2FootFloor: 'w s 이동 · d ⏎ Phase 상세 · a 뒤로 · n 다음 ⚑ · q 닫기',
    f2FootStory: 'w s 이동 · d ⏎ 열기 · a 뒤로 · n 다음 ⚑ · q 닫기', f2FootScroll: 'w s 스크롤 · a 뒤로 · n 다음 ⚑ · q 닫기',
    f2FootAnswer: '입력 모드: 글자가 그대로 들어감 · ⏎ 보내기 · 빈 ⏎ 취소',
    f2FloorPhaseOf: 'Phase {n}/6', f2FloorDecisionsN: '결정 {n}', f2FloorReportHint: 'EPIC 보고서는 여기서 열림',
    actorHuman: '사람', proposalSize: '규모 {size}', proposalSizeFlow: '규모 {size} · {flow}',
    resplitAreas: '재분할 → 영역:{n}', resplit: '재분할', replanIds: '재계획 {ids}',
    reasonNeverDispatched: '시작된 적 없음', reasonState: '상태: {state}',
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

// the pane's task: the EPIC of the open page, else the picked one, else the last watched one, else this cwd's newest running one (from the tick's status)
async function paneTask($: EngineInterface): Promise<string | undefined> {
  return (await read($, page)).epic ?? (await read($, epic)) ?? (await read($, watch)).at(-1) ?? (await read($, status))?.latest ?? undefined
}

// the page stack as one value, and back: only what changed is written
async function readNav($: EngineInterface): Promise<PageNav> {
  return { page: await read($, page), from: await read($, pageFrom), sel: await read($, pageSel), scroll: await read($, pageScroll), unfolded: await read($, unfolded) }
}
async function writeNav($: EngineInterface, nav: PageNav): Promise<void> {
  const cur = await readNav($)
  if (JSON.stringify(nav.page) !== JSON.stringify(cur.page)) await update($, page, () => nav.page)
  if (JSON.stringify(nav.from) !== JSON.stringify(cur.from)) await update($, pageFrom, () => nav.from)
  if (JSON.stringify(nav.sel) !== JSON.stringify(cur.sel)) await update($, pageSel, () => nav.sel)
  if (JSON.stringify(nav.scroll) !== JSON.stringify(cur.scroll)) await update($, pageScroll, () => nav.scroll)
  if (JSON.stringify(nav.unfolded) !== JSON.stringify(cur.unfolded)) await update($, unfolded, () => nav.unfolded)
}
// the rows each level listed at the last tick: the nearest-row fallback when the selected row leaves (a cache a reload may lose)
const levelIds = new Map<string, string[]>()

// ---- answer mode ----
// The draft of one ask card (the answers typed so far, the question the person is on, the last refusal) is a cache a reload may
// lose: it is never written to $.state, and it is dropped when the pane leaves ANSWER. `answerRev` only tells the pane to redraw.
type AskCard = { key: string; node_id: string; title: string; story_key: string | null; ask_id: string | null; since: number | null; questions: { question: string; options: string[] }[] }
type Draft = { task: string; story: string; cards: AskCard[]; loadError: string | null; qi: number; chosen: { question: string; chose: string }[]; status: { kind: 'refused' | 'failed'; reason: string } | null; busy: boolean }
let draft: Draft | null = null
// whether the pane was last opened without closeOnEscape (while answering)
let answering = false
const redraw = (a: EngineInterface) => update(a, answerRev, n => n + 1)

// One run of the answer CLI under $.plugin.root; its one JSON line on stdout. A run that fails or prints no JSON throws.
async function answerCli($: EngineInterface, args: string[]): Promise<Record<string, unknown>> {
  const r = await $.process.run(['node', `${$.plugin.root}/scripts/answer.mjs`, ...args])
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `exit ${r.exitCode}`)
  return JSON.parse(r.stdout.trim().split('\n').pop() ?? '') as Record<string, unknown>
}
const failText = (e: unknown) => String((e as { message?: unknown } | null)?.message ?? e)

// The ask card behind the ANSWER page, asked of the engine once per page (not per tick): its own key and questions with their options.
async function loadAnswer($: EngineInterface, task: string, story: string): Promise<void> {
  if (draft !== null && draft.task === task && draft.story === story) return
  const d: Draft = { task, story, cards: [], loadError: null, qi: 0, chosen: [], status: null, busy: false }
  draft = d
  try {
    const o = await answerCli($, ['--card', '--task', task, '--story', story])
    if (o.ok === true && Array.isArray(o.cards)) d.cards = o.cards as AskCard[]
    else d.loadError = String(o.reason ?? '')
  } catch (e) {
    d.loadError = failText(e)
  }
  await redraw($)
}

const openArgs = () => (answering ? OPEN_ANSWER : OPEN)
// Answering opens the pane again without closeOnEscape (each open sets it anew); leaving puts it back. A host that refuses the
// re-open leaves the pane as it was: fail open.
async function setAnswering($: EngineInterface, on: boolean): Promise<void> {
  if (on === answering) return
  answering = on
  try {
    if ((await $.ui.panes()).some(p => p.id === PANE)) await $.ui.open(openArgs())
  } catch {
    // the pane keeps its last flags
  }
}
// The pane's page decides whether a draft lives: leaving ANSWER drops it and the typed text.
async function settleAnswer($: EngineInterface, pg: Page): Promise<void> {
  if (pg.name === 'ANSWER') return setAnswering($, true)
  if (draft !== null) {
    draft = null
    await update($, typed, () => '')
    await redraw($)
  }
  await setAnswering($, false)
}
// Esc, or the person's close while answering: the draft is cancelled and the pane returns to the page ANSWER was opened from
async function leaveAnswer($: EngineInterface): Promise<void> {
  const r = pageEsc(await readNav($))
  await writeNav($, r.nav)
  await settleAnswer($, r.nav.page)
}
// A pane opened again after it closed on ANSWER (the host's Esc, the Close Button) starts on the page ANSWER came from, draft lost
async function openPane($: EngineInterface) {
  if (!(await $.ui.panes()).some(p => p.id === PANE) && (await read($, page)).name === 'ANSWER') await leaveAnswer($)
  return $.ui.open(openArgs())
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

// The data of the page the pane is on, fetched for its EPIC: a Phase page's decisions, a STORY's payload (STORY and Log), a STORY's
// report, an EPIC's report. A failed call or unreadable output leaves what was stored.
async function fetchPage($: EngineInterface, pg: Page): Promise<void> {
  try {
    await settleAnswer($, pg)
  } catch {
    // answer mode keeps its last state
  }
  if (pg.epic === null) return
  const task = pg.epic
  const last = async (args: string[]) => {
    const r = await viewOnce($, [...args, '--task', task, '--cwd', await $.session.cwd()])
    return r.exitCode !== 0 ? null : JSON.parse(r.stdout.trim().split('\n').pop() ?? '')
  }
  try {
    const story = pg.story === null ? '' : storyLabel(pg.story)
    if (pg.name === 'PHASE') {
      const payload = await last(['--format', 'decisions']) as DecisionsPayload | null
      if (payload !== null) await update($, decisions, () => ({ task_id: task, payload }))
    } else if (pg.name === 'STORY' || pg.name === 'LOG') {
      const payload = await last(['--format', 'story', '--story', story]) as StoryPayload | null
      if (payload !== null) await update($, storyData, () => ({ task_id: task, story, payload }))
    } else if (pg.name === 'STORY_REPORT') {
      const payload = await last(['--format', 'story-report', '--story', story]) as StoryReport | null
      if (payload !== null) await update($, storyDoc, () => ({ task_id: task, story, payload }))
    } else if (pg.name === 'EPIC_REPORT') {
      await fetchReport($, task)
    } else if (pg.name === 'ANSWER') {
      await loadAnswer($, task, story)
    }
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
    draft = null
    answering = false

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
            // a page of an EPIC that left the listing goes back to HOME, so no stale page stays drawn
            // and a selected row that left its page's list falls to the nearest listed row, kept here (a draw writes no state)
            const nav = reconcileEpic(await readNav($), ids)
            const rowIds = rowIdsOf(nav.page, list, nav.unfolded)
            const level = levelOf(nav.page)
            const kept = selectedOf(nav, rowIds, levelIds.get(level) ?? rowIds)
            levelIds.set(level, rowIds)
            await writeNav($, kept === null || kept === nav.sel[level] ? nav : { ...nav, sel: { ...nav.sel, [level]: kept } })
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
        if (isOpen) await fetchPage($, await read($, page))
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
      if ((await $.ui.panes()).some(p => p.id === PANE)) await $.ui.open(openArgs())
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
    const placed = await openPane($)
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

  // The person's close (Esc, the close mark) while answering cancels the draft and the pane stays; the next one closes it. Another
  // origin (this plugin's own close, an unload) passes. Whether the host sends Esc here or hands it back to the prompt once
  // closeOnEscape is dropped is unchecked without a live session.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person' || (await read($, page)).name !== 'ANSWER') return next(e)
    await leaveAnswer($)
    return { value: undefined } as never
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Input, Markdown, Text } = ui
    const lang$ = await read($, lang)
    const s = (key: keyof typeof en, vars?: Record<string, string | number>) => fmt(STRINGS[lang$][key], vars, key)
    // an engine word by its key: the table's word, else the raw value the engine sent (fail open)
    const wo = (key: string, fallback: string, vars?: Record<string, string | number>) => wordOr(STRINGS[lang$], key, fallback, vars)
    // node's word_key (idle, done, stalled, failed) names a STRINGS entry; a pure lookup, no decision
    const fixedWord = (key: string) => wo(`word${cap(key)}`, key)
    const say = (key: string, vars?: Record<string, string | number>) => s(key as keyof typeof en, vars)
    const id = await paneTask($)
    const listed = await read($, tasks)
    const inner = Math.max(20, (e.props.bodyColumns ?? 80) - 4)
    const compact = !carriesInput(e.surface)
    // the Input draws what it holds: every edit is stored, and a handled key stores '' so the host drops the whole
    // buffer (text holding a `/` is no key: it stays until Enter). The store is a state update, so the pane redraws.
    const buffer = await read($, typed)
    await read($, answerRev) // answer mode's draft is a module variable: this read is what redraws the pane when it changes
    const keep = (handle: (text: string) => Promise<void>) => async (text: string) => {
      await update($, typed, () => text)
      if (pageKey(text, { answering: (await read($, page)).name === 'ANSWER' }) === null) return
      try {
        await handle(text)
      } finally {
        await update($, typed, () => '')
      }
    }

    // the language marker: `l EN` / `l KR` beside an Input (the key works there), bare `EN` / `KR` on mobile (a Button only)
    const langWord = s(lang$ === 'en' ? 'langEN' : 'langKR')
    const marker = carriesInput(e.surface) ? s('langMarker', { lang: langWord }) : langWord
    const langButton = <Button key="lang" plain dimColor label={marker} onPress={() => toggleLang($)} />

    // The page stack. An EPIC that left the listing sends the pane to HOME; the selected row is kept per level by its id and
    // falls to the nearest listed row when it leaves; what a row opens comes from pane.ts.
    // (a host with no clock still draws: the wall clock stands in)
    const now = await $.clock.now().catch(() => Date.now())
    const stored = reconcileEpic(await readNav($), listed.map(t => t.task_id))
    const pg = stored.page
    const entry = pg.epic === null ? undefined : listed.find(t => t.task_id === pg.epic)
    const cardHeld = await read($, cardReport)
    const verdictText = (v: string | null) => (v === null ? '' : VERDICT_WORD[v] === undefined ? v : s(VERDICT_WORD[v]!))
    const home = homeRows(listed, { now, compact, unfolded: stored.unfolded, say, fixed: fixedWord, verdict: verdictText, reportReady: tid => cardHeld?.task_id === tid && cardHeld.payload.report !== null })
    // what the page reads beyond the listing, only when it was fetched for this EPIC (and STORY)
    const storyId = pg.story === null ? null : storyLabel(pg.story)
    const sdHeld = await read($, storyData)
    const sd = sdHeld !== null && sdHeld.task_id === pg.epic && sdHeld.story === storyId && sdHeld.payload.missing !== true ? sdHeld.payload : null
    const docHeld = await read($, storyDoc)
    const doc = docHeld !== null && docHeld.task_id === pg.epic && docHeld.story === storyId && docHeld.payload.missing !== true ? docHeld.payload : null
    const decHeld = await read($, decisions)
    const thread = decHeld !== null && decHeld.task_id === pg.epic ? (decHeld.payload.entries as DecisionX[]) : null
    const opts: PageOpts = { say, wo, fixed: fixedWord, verdictOf: v => s(VERDICT_WORD[v ?? ''] ?? 'vReject'), frame: await read($, frame), now }
    const phaseKey = PHASE_KEYS[Math.min(5, Math.max(0, (pg.phase ?? 1) - 1))]!
    const rows: PageRow[] = pg.name === 'HOME' ? [...home.flags, ...home.body] : pg.name === 'FLOOR' && entry !== undefined ? floorRows(entry, say)
      : pg.name === 'STORY' && entry !== undefined && storyId !== null ? storyRows(entry, storyId, sd, doc, opts) : []
    const rowIds = rows.map(r => r.id)
    const level = levelOf(pg)
    const sel = selectedOf(stored, rowIds, levelIds.get(level) ?? rowIds)
    const nav: PageNav = sel === null ? stored : { ...stored, sel: { ...stored.sel, [level]: sel } }
    const selRow = rows.find(r => r.id === sel)
    const ref: RowRef | null = selRow?.ref ?? null
    // the text pages: Phase detail, Log and the STORY Report are lines windowed by the scroll offset of their level
    const docLines: Line[] | null = entry === undefined ? null
      : pg.name === 'PHASE' ? phaseLines(entry as PhaseEntry, phaseKey, thread, opts, inner)
        : pg.name === 'LOG' ? logLines(sd, opts, inner)
          : pg.name === 'STORY_REPORT' ? storyReportLines(doc, say, inner) : null
    const windowed = docLines === null ? null : windowOf(docLines, stored.scroll[level] ?? 0, PAGE_ROWS)
    const ctx: StepCtx = { ids: rowIds, row: ref, flags: home.flags.map(f => f.id), maxScroll: windowed?.max ?? 0 }
    const hinted = await read($, flagHint)
    // one key or Button press: the page stack moves, the EPIC the data call is for follows the page
    const act = async (key: Exclude<PageKey, null>): Promise<void> => {
      if (hinted) await update($, flagHint, () => false)
      if (key.kind === 'lang') return toggleLang($)
      const r: StepResult = pageStep(nav, key, ctx)
      if (r.closed) {
        await $.ui.close({ id: PANE })
        return
      }
      await writeNav($, r.nav)
      const to = r.nav.page.epic
      if (to !== null && to !== (await read($, epic))) await update($, epic, () => to)
      if (JSON.stringify(r.nav.page) !== JSON.stringify(nav.page)) await fetchPage($, r.nav.page)
      if (r.hint === 'noFlag') await update($, flagHint, () => true)
    }
    const onKey = async (text: string) => {
      const key = pageKey(text)
      if (key !== null) await act(key)
    }
    // the same Input takes a typed `/command`, held until Enter (pageKey fires no key on text holding `/`): `/teams-status`
    // closes the pane, `/name args` runs that command; Enter on any other text opens the selected row. Not awaited: awaited
    // inside onSubmit the host cuts the hook at its budget.
    const onSubmit = async (text: string) => {
      const slash = paneSlash(text)
      if (slash === null) await act({ kind: 'open' })
      else if (slash.kind === 'close') await $.ui.close({ id: PANE })
      else void $.command.run({ command: slash.command, args: slash.args }).catch(() => {})
      await update($, typed, () => '')
    }
    // Answer mode: one question at a time, the engine takes the whole card once after the last, one decisions[] entry per question.
    // Empty Enter cancels. Refused or a failed run keeps the draft (and the text) and says why; accepted returns to the page ANSWER
    // came from, and the data is read again so the ⚑ clears.
    const submitAnswer = async (text: string): Promise<void> => {
      const d = draft
      if (d === null || d.busy) return
      const chose = text.trim()
      if (chose === '') return leaveAnswer($)
      const card = d.cards[0]
      const q = card?.questions[d.qi]
      if (card === undefined || q === undefined) return
      const decisions = [...d.chosen, { question: q.question, chose }]
      if (d.qi + 1 < card.questions.length) {
        d.chosen = decisions
        d.qi += 1
        d.status = null
        await update($, typed, () => '')
        return redraw($)
      }
      d.busy = true
      let sent = false
      try {
        const o = await answerCli($, ['--answer', '--task', d.task, '--key', card.key, '--decisions', JSON.stringify(decisions)])
        if (o.ok === true) sent = true
        else d.status = { kind: 'refused', reason: String(o.reason ?? '') }
      } catch (e) {
        d.status = { kind: 'failed', reason: failText(e) }
      }
      d.busy = false
      if (sent) {
        try {
          $.ui.toast(s('f2AnswerAccepted'))
          await leaveAnswer($)
          if (refresh !== null) await refresh()
        } catch {
          // the answer is in; a toast or a refresh that fails changes nothing
        }
        return
      }
      await update($, typed, () => chose)
      await redraw($)
    }

    // line 1: the breadcrumb from HOME (page names and Phase names by key), the Phase header of FLOOR on its right
    const phaseLabel = (n: number) => `${n} ${say(`f2PhaseName${cap(PHASE_KEYS[n - 1]!)}`)}`
    const item = entry?.items.find(i => i.key === pg.story)
    const storyName = pg.story === null ? '' : `${storyLabel(pg.story)}${item === undefined ? '' : ` ${item.title}`}`
    const epicName = entry?.title ?? ''
    const crumbs = pg.name === 'FLOOR' ? [epicName, s('f2PageFloor')]
      : pg.name === 'PHASE' ? [epicName, s('f2PageFloor'), phaseLabel(pg.phase ?? 1)]
      : pg.name === 'EPIC_REPORT' ? [epicName, s('f2PageFloor'), phaseLabel(6)]
      : pg.name === 'STORY' ? [epicName, storyName]
      : pg.name === 'LOG' ? [epicName, storyName, s('f2PageLog')]
      : pg.name === 'STORY_REPORT' ? [epicName, storyName, s('f2PageReport')]
      : [epicName, storyName, s('f2AnswerTitle')]
    const phaseAt = entry === undefined ? 0 : Math.max(0, entry.stages.some(g => g.state === 'running') ? entry.stages.findIndex(g => g.state === 'running') : entry.stages.filter(g => g.state === 'done').length - 1)
    // the right of line 1: FLOOR's Phase header; a Phase's own time and spend; a STORY's node, try, spend and time; the Log's count;
    // the Report's verdict. Each is the engine's number placed, blank when it sent none.
    const ledger = entry?.metrics?.stages?.find(x => x.stage === phaseKey)
    const ledgerUsd = ledger === undefined ? 0 : ledger.cost_usd + ledger.retry_cost_usd
    const storyMs = item?.metrics != null && (item.metrics.wall_ms ?? 0) > 0 ? item.metrics.wall_ms : item?.elapsed_ms ?? null
    const verdictOf = doc?.verdict
    // the ask the ANSWER page is about: who asks, the summary's question and age
    const askCard = entry?.you.cards?.find(c => c.stage === 'ask' && storyId !== null && storyLabel(c.key) === storyId)
    const floorRight = entry === undefined ? ''
      : pg.name === 'FLOOR'
        ? [`${s('f2FloorPhaseOf', { n: phaseAt + 1 })} ${say(`f2PhaseName${cap(PHASE_KEYS[Math.min(phaseAt, 5)]!)}`)}`, since(epicElapsed(entry, now)), entry.cost.usd > 0 ? costText(entry.cost.usd, entry.cost.estimated === true) : ''].filter(Boolean).join(' · ')
        : pg.name === 'PHASE' ? [ledger !== undefined && ledger.wall_ms > 0 ? since(ledger.wall_ms) : '', ledgerUsd > 0 ? costText(ledgerUsd, false) : ''].filter(Boolean).join(' · ')
          : pg.name === 'STORY' && item !== undefined
            ? [sd?.flow.find(f => f.state === 'running')?.key ?? '', item.try === null ? '' : s('f2RowRetrying', { n: item.try, max: item.max ?? '-' }), costText(item.cost_usd ?? item.metrics?.cost_usd ?? null, item.cost_estimated), since(storyMs)].filter(Boolean).join(' · ')
            : pg.name === 'LOG' ? (sd === null ? '' : s('f2LogCount', { n: sd.log.length }))
              : pg.name === 'STORY_REPORT' && doc?.finished === true && verdictOf?.score != null && item?.last_verdict !== 'reject'
                ? s('f2ReportAccepted', { score: verdictOf.score, threshold: verdictOf.threshold ?? '', t: since(storyMs) })
                : pg.name === 'ANSWER' && askCard?.since != null ? `⚑ ${s('f2FlagAge', { m: since(Math.max(0, now - askCard.since)) })}` : ''
    const crumbRoom = inner - (floorRight === '' ? 0 : width(floorRight) + 2)
    const crumbFull = crumbs.join(' › ')
    const crumbEl = width(crumbFull) > crumbRoom ? <Text bold wrap="truncate-end">{clipText(crumbFull, crumbRoom)}</Text> : (
      <Text wrap="truncate-end"><Text dimColor>{`${crumbs.slice(0, -1).join(' › ')} › `}</Text><Text bold>{crumbs[crumbs.length - 1]}</Text></Text>
    )
    const rule = (k: string) => renderLines(ui, [[{ t: '─'.repeat(inner), dim: true }]], k)

    let body
    if (pg.name === 'HOME') {
      const lines = pageLines(rows, sel, inner, HOME_PLANS)
      const nFlag = home.flags.length
      const hd = homeHeader(listed, now, say)
      const room = inner - width('teams') - width(hd.right) - 4
      const left = compact ? '' : width([hd.epics, hd.drivers].filter(Boolean).join(' · ')) <= room ? [hd.epics, hd.drivers].filter(Boolean).join(' · ') : hd.epics
      const flagPicked = sel !== null && home.flags.some(f => f.id === sel)
      body = listed.length === 0 ? <Text>{id === undefined ? s('noRun') : s('loading')}</Text> : (
        <Box flexDirection="column">
          <Box>
            <Box flexShrink={0}><Text bold>teams</Text></Box>
            <Box flexShrink={1} marginLeft={2}><Text dimColor wrap="truncate-end">{left}</Text></Box>
            <Box flexGrow={1} flexShrink={0} justifyContent="flex-end" marginLeft={2}><Text>{hd.right}</Text></Box>
          </Box>
          {rule('r1')}
          {nFlag > 0 && (
            <Box flexDirection="column">
              {compact
                ? renderLines(ui, [[{ t: flagPicked ? '▸ ' : '  ', tint: 'claude' }, ...home.flagLine]], 'g')
                : <Box flexDirection="column"><Text color="warning" bold>{`⚑ ${s('f2FlagTitle', { n: nFlag })}`}</Text>{renderLines(ui, lines.slice(0, nFlag), 'f')}</Box>}
              {rule('r2')}
            </Box>
          )}
          {renderLines(ui, lines.slice(nFlag), 'e')}
        </Box>
      )
    } else {
      let page$
      if (entry === undefined) page$ = <Text dimColor>{s('loading')}</Text>
      else if (pg.name === 'FLOOR') page$ = renderLines(ui, pageLines(rows, sel, inner, HOME_PLANS), 'p')
      else if (windowed !== null) {
        // Log waits for its payload; Phase detail and the Report draw their sections (a dim – where nothing is recorded)
        page$ = pg.name === 'LOG' && sd === null ? <Text dimColor>{s('loading')}</Text> : renderLines(ui, windowed.lines, 't')
      } else if (pg.name === 'STORY') {
        const top = storyTop(sd, say)
        const grid = storyGrid(sd, item?.max ?? null, say, inner)
        const working = storyNow(sd, opts, inner)
        page$ = (
          <Box flexDirection="column">
            {sd === null ? <Text dimColor>{s('loading')}</Text> : renderLines(ui, top, 'a')}
            {grid.length > 0 && <Box flexDirection="column">{rule('r2')}{renderLines(ui, grid, 'b')}</Box>}
            {working.length > 0 && <Box flexDirection="column">{rule('r3')}{renderLines(ui, working, 'c')}</Box>}
            {rule('r4')}
            {renderLines(ui, pageLines(rows, sel, inner, HOME_PLANS), 'd')}
          </Box>
        )
      } else if (pg.name === 'EPIC_REPORT') {
        const held = (await read($, report))?.task_id === pg.epic ? await read($, report) : cardHeld?.task_id === pg.epic ? cardHeld : null
        const p = held?.payload ?? null
        const needs = p === null ? [] : needsOf(p.needs, wo)
        page$ = p === null ? <Text dimColor>{s('loading')}</Text> : p.report === null ? <Text>{s('reportMissing', { path: p.path })}</Text> : (
          <Box flexDirection="column">
            <Text>{p.path}</Text>
            {needs.map((n, i) => <Text key={`n${i}`} color="warning" wrap="truncate-end">{`⚑ ${n}`}</Text>)}
            {p.report.truncated && <Text color="warning">{s('reportTruncated', { n: p.report.more_lines })}</Text>}
            <Markdown text={p.report.text} />
          </Box>
        )
      } else if (pg.name === 'ANSWER') {
        // who asks, the question, a context line, then the prompt: an Input on a surface that carries one, else the card's options as
        // Buttons (a free-text ask has no input on mobile)
        const d = draft !== null && draft.task === pg.epic && draft.story === storyId ? draft : null
        const qs = d?.cards[0]?.questions ?? []
        const q = qs[d?.qi ?? 0]
        const question = q?.question ?? askCard?.question ?? ''
        const options = q?.options ?? []
        const failed = d?.loadError != null ? s('f2AnswerFailed', { reason: d.loadError }) : d?.status == null ? '' : s(d.status.kind === 'refused' ? 'f2AnswerRefused' : 'f2AnswerFailed', { reason: d.status.reason })
        page$ = (
          <Box flexDirection="column">
            <Text>{`${askCard?.who ?? ''} → ${s('partyYou')}${qs.length > 1 ? ` ${(d?.qi ?? 0) + 1}/${qs.length}` : ''}`}</Text>
            <Text bold>{question === '' ? askCard?.title ?? '' : `"${question}"`}</Text>
            <Text dimColor wrap="truncate-end">{`${s('f2AnswerContext')}  ${askCard?.title ?? d?.cards[0]?.title ?? ''}`}</Text>
            {rule('r2')}
            {compact
              ? options.length > 0
                ? <Box flexDirection="column">{options.map((o, i) => <Button key={`o${i}`} plain label={o} onPress={() => submitAnswer(o)} />)}</Box>
                : <Text dimColor>{s('f2AnswerDesktopOnly')}</Text>
              : (
                <Box>
                  <Box flexShrink={0}><Text color="claude">{`${s('f2AnswerPrompt')} ›`}</Text></Box>
                  <Box flexShrink={1} marginLeft={1} height={1} overflow="hidden"><Input key="answer" autoFocus value={buffer} onInput={keep(onKey)} onSubmit={submitAnswer} /></Box>
                </Box>
              )}
            {failed !== '' && <Text color="error">{failed}</Text>}
            {rule('r3')}
          </Box>
        )
      } else page$ = <Text dimColor>{s('loading')}</Text>
      body = (
        <Box flexDirection="column">
          <Box>
            <Box flexShrink={1}>{crumbEl}</Box>
            {floorRight !== '' && <Box flexShrink={0} marginLeft={2}><Text>{floorRight}</Text></Box>}
          </Box>
          {rule('r1')}
          {page$}
        </Box>
      )
    }

    // The footer: the page's key line in the Input's placeholder (with the unfold or fold hint of the selected EPIC row), then
    // `l EN`; on mobile no Input, the same actions as Buttons that act on the selected row, then `EN`.
    const selEpic = ref !== null && (ref.type === 'epic' || ref.type === 'story') ? listed.find(t => t.task_id === ref.epic) : undefined
    const foldHint = pg.name !== 'HOME' || selEpic === undefined || !isEnded(selEpic) ? ''
      : nav.unfolded[selEpic.task_id] === true ? s('f2FoldRefold') : ref?.type === 'epic' ? s('f2FoldUnfold') : ''
    const foot = pg.name === 'HOME' ? 'f2FootHome' : pg.name === 'FLOOR' ? 'f2FootFloor' : pg.name === 'STORY' ? 'f2FootStory' : pg.name === 'ANSWER' ? 'f2FootAnswer' : 'f2FootScroll'
    const footText = [s(foot), foldHint].filter(Boolean).join(' · ')
    const footHint = footerPlan({ steps: 0, open: '', close: '', hint: footText, marker }, inner).hint
    const footer = compact ? (
      <Box columnGap={2} flexWrap="wrap">
        <Button key="up" plain label={s('f2BtnUp')} onPress={() => act({ kind: 'move', by: -1 })} />
        <Button key="down" plain label={s('f2BtnDown')} onPress={() => act({ kind: 'move', by: 1 })} />
        <Button key="open" plain label={s('f2BtnOpen')} onPress={() => act({ kind: 'open' })} />
        <Button key="back" plain label={s('f2BtnBack')} onPress={() => act({ kind: 'back' })} />
        <Button key="flag" plain label={s('f2BtnFlag')} onPress={() => act({ kind: 'nextFlag' })} />
        <Button key="close" role="dismiss" plain label={s('f2BtnClose')} onPress={() => $.ui.close({ id: PANE })} />
        {langButton}
      </Box>
    ) : pg.name === 'ANSWER' ? (
      <Box columnGap={2}>
        <Box flexShrink={1}><Text dimColor wrap="truncate-end">{footHint}</Text></Box>
        <Box flexShrink={0}>{langButton}</Box>
      </Box>
    ) : (
      <Box columnGap={2}>
        <Box flexShrink={1} height={1} overflow="hidden"><Input key="keys" autoFocus value={buffer} placeholder={footHint} onInput={keep(onKey)} onSubmit={onSubmit} /></Box>
        <Box flexShrink={0}>{langButton}</Box>
      </Box>
    )
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        {body}
        {hinted && <Text dimColor>{s('f2HintNoFlag')}</Text>}
        {footer}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const info = await read($, status)
    const task = await read($, summary)
    const lang$ = await read($, lang)
    const s = (key: keyof typeof en, vars?: Record<string, string | number>) => fmt(STRINGS[lang$][key], vars, key)
    const wo = (key: string, fallback: string, vars?: Record<string, string | number>) => wordOr(STRINGS[lang$], key, fallback, vars)
    const open = () => openPane($)
    // the band's [board] opens HOME, wherever the pane was left
    const openHome = async () => {
      await update($, page, () => HOME)
      await update($, pageFrom, () => null)
      await open()
    }

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
            {p.needs.items.length > 0 && <Box flexShrink={1} marginLeft={1}><Text dimColor wrap="truncate-end">{`— ${needsOf(p.needs, wo).join('; ')}`}</Text></Box>}
            {p.needs.more > 0 && <Box flexShrink={0} marginLeft={1}><Text dimColor>{s('cardMore', { n: p.needs.more })}</Text></Box>}
            {p.report !== null && (
              <Box flexShrink={0} marginLeft={1}>
                <Button key="report" label={s('reportButton')} onPress={async () => {
                  await update($, watch, l => [...l.filter(x => x !== cardId), cardId])
                  await update($, summary, () => null)
                  // the Report button opens FLOOR with Phase 6 selected, for that EPIC
                  const to: Page = { name: 'FLOOR', epic: cardId, story: null, phase: null }
                  await update($, epic, () => cardId)
                  await update($, page, () => to)
                  await update($, pageFrom, () => null)
                  await update($, pageSel, m => ({ ...m, [levelOf(to)]: `p:${PHASE_KEYS.length}` }))
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
            : <Box flexShrink={0} marginLeft={1}><Button key="board" label={s('board')} onPress={openHome} /></Box>}
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
