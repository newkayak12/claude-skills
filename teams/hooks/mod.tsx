import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Mark, StatusInfo, SummaryTask, TeamsEvent } from '../types'

const cursor = atom({ plugin: 'teams', key: 'cursor' } as const, 0)
const status = atom({ plugin: 'teams', key: 'status' } as const, null as StatusInfo | null)
const summary = atom({ plugin: 'teams', key: 'summary' } as const, null as SummaryTask | null)
const watch = atom({ plugin: 'teams', key: 'watch' } as const, [] as string[])
const view = atom({ plugin: 'teams', key: 'view' } as const, 'summary' as 'summary' | 'work' | 'log')
const lang = atom({ plugin: 'teams', key: 'lang' } as const, 'en' as 'en' | 'ko')

const PANE = 'teams-live'

const en = {
  tabSummary: 'Summary', tabWork: 'Work', tabLog: 'Log',
  now: 'Now', you: 'You', stages: 'Stages', work: 'Work', cost: 'Cost',
  youNone: 'Nothing needed', youOthers: '{n} more in other runs', costLine: '{usd} · {turns} turns',
  headLine: '{state} · day {day} · {done}/{total}', bandDone: '{done}/{total} done',
  stateRunning: 'running', stateStalled: 'stalled', stateComplete: 'finished', stateFailed: 'failed',
  stagePlan: 'Plan', stageBuild: 'Build', stageIntegrate: 'Integrate', stageQa: 'QA', stageGate: 'Final gate', stageReport: 'Report',
  nowFix: 'Fixing defect', nowFixnext: 'Waiting to fix defect', nowBuild: 'Building', nowPlan: 'Planning', nowQa: 'QA', nowAnswer: 'Waiting for your answer',
  nowIntegrate: 'Integrating', nowGate: 'Final gate', nowReport: 'Writing the report', nowDone: 'All done', nowIdle: 'Idle',
  logPassed: '{s} passed', logFailed: '{s} failed', logFiled: '{s} filed', logIntegrated: '{s} integrated',
  logDispatched: '{s} started', logWaiting: '{s} waiting for you', logFinished: '{s} finished',
  noRun: 'No teams run in this session.', loading: 'Loading...', noLog: 'Nothing logged yet.',
  workMore: '+{n} more', cmdDesc: 'Open the teams live pane', paneOpened: 'pane opened',
  board: 'board', inbox: 'needs you {n}', statusWaiting: 'needs you: {n} waiting - open /teams-live',
  colTodo: 'To do', colDoing: 'Doing', colDone: 'Done',
}

// one table, two languages; the type keeps the keys identical
export const STRINGS: Record<'en' | 'ko', Record<keyof typeof en, string>> = {
  en,
  ko: {
    tabSummary: '요약', tabWork: '작업', tabLog: '기록',
    now: '지금', you: '확인', stages: '단계', work: '작업', cost: '비용',
    youNone: '필요한 조치 없음', youOthers: '다른 실행에 {n}건 더', costLine: '{usd} · {turns}턴',
    headLine: '{state} · {day}일째 · {done}/{total}', bandDone: '{done}/{total} 완료',
    stateRunning: '진행 중', stateStalled: '멈춤', stateComplete: '완료', stateFailed: '실패',
    stagePlan: '계획', stageBuild: '구현', stageIntegrate: '통합', stageQa: 'QA', stageGate: '최종 관문', stageReport: '보고',
    nowFix: '결함 수정 중', nowFixnext: '결함 수정 대기', nowBuild: '구현 중', nowPlan: '계획 중', nowQa: 'QA 중', nowAnswer: '답변 대기 중',
    nowIntegrate: '통합 중', nowGate: '최종 관문', nowReport: '보고서 작성 중', nowDone: '모두 끝남', nowIdle: '대기 중',
    logPassed: '{s} 통과', logFailed: '{s} 실패', logFiled: '{s} 등록', logIntegrated: '{s} 반영',
    logDispatched: '{s} 시작', logWaiting: '{s} 답변 대기', logFinished: '{s} 끝남',
    noRun: '이 세션에 팀 실행이 없습니다.', loading: '불러오는 중...', noLog: '아직 기록이 없습니다.',
    workMore: '+{n}건 더', cmdDesc: '팀 실행 현황 창 열기', paneOpened: '창을 열었습니다',
    board: '보드', inbox: '확인 필요 {n}', statusWaiting: '확인 필요: {n}건 대기 - /teams-live 열기',
    colTodo: '대기', colDoing: '진행', colDone: '완료',
  },
}

// a key the table lacks (a state or kind this mod does not know) formats to ''
const fmt = (text: string | undefined, vars: Record<string, string | number> = {}) =>
  (text ?? '').replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))

const MARK: Record<Mark, string> = { done: '✔', running: '●', pending: '○', failed: '✘' }
// the stage rail: a dot per stage, a solid rail up to where the run is, dotted after
const DOT: Record<Mark, string> = { done: '●', running: '◉', pending: '○', failed: '✘' }
const TINT: Record<Mark, string> = { done: 'success', running: 'claude', pending: 'inactive', failed: 'error' }
const BAR = 24
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

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

// the pane's task: the last watched one, else this cwd's newest running one (from the tick's status)
async function paneTask($: EngineInterface): Promise<string | undefined> {
  return (await read($, watch)).at(-1) ?? (await read($, status))?.latest ?? undefined
}

// a person's words for the card the task is on now
function nowSentence(s: (key: keyof typeof en) => string, task: SummaryTask): string {
  const label = s(`now${cap(task.now.kind)}` as keyof typeof en) || s('nowIdle')
  return task.now.subject ? `${label}: ${task.now.subject}` : label
}

const TICK_MS = 3000
const WORK_MAX = 6

export const register: Register = on => {
  let isRunning = false

  on('session.start', async ($, e, next) => {
    if ((await $.session.surfaces()).length === 0) return next(e)

    const VIEW = `${$.plugin.root}/scripts/view.mjs`

    async function tick() {
      if (isRunning) return
      isRunning = true
      try {
        const cwd = await $.session.cwd()
        const since = await read($, cursor)

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
            for (const one of fresh) $.ui.toast(one.text)
            const latest = Math.max(...fresh.map(one => one.ts))
            await update($, cursor, () => latest)
          }
        }

        // one data call: the summary while the pane is open or a task of this cwd is running, else the status
        const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
        const isSummary = isOpen || (await read($, status))?.latest != null
        const id = isOpen ? await paneTask($) : undefined
        const data = await $.process.run([
          'node', VIEW, '--once', '--format', isSummary ? 'summary' : 'status', '--cwd', cwd,
          ...(id === undefined ? [] : ['--task', id]),
        ])
        if (data.exitCode === 0) {
          const parsed = JSON.parse(data.stdout) as { status: StatusInfo; task: SummaryTask | null } & StatusInfo
          const info: StatusInfo = isSummary ? parsed.status : parsed
          await update($, status, () => info)
          await update($, summary, () => (isSummary ? parsed.task ?? null : null))
          // pinned only while a person must act (the engine draws it as a warning)
          $.ui.status(info.waiting > 0 ? fmt(STRINGS[await read($, lang)].statusWaiting, { n: info.waiting }) : undefined)
        }
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
    await $.command.register({ name: 'teams-live', description: STRINGS[await read($, lang)].cmdDesc })
    // events older than this session's start are not toasted
    const now = await $.clock.now()
    await update($, cursor, since => (since === 0 ? now : since))
    $.clock.every(TICK_MS, tick)

    return next(e)
  })

  // asked for by the person: the pane seats at any width
  on('command.run', { command: 'teams-live' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Teams' })
    return { text: STRINGS[await read($, lang)].paneOpened }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const kind = await read($, view)
    const lang$ = await read($, lang)
    const s = (key: keyof typeof en, vars?: Record<string, string | number>) => fmt(STRINGS[lang$][key], vars)
    const id = await paneTask($)
    const task = await read($, summary)
    const info = await read($, status)

    // plain tabs with hotkeys 1-3: the selected one in full strength with a dot, the rest dim
    const tabs = (
      <Box columnGap={3}>
        {(['summary', 'work', 'log'] as const).map((one, i) => (
          <Button key={one} plain hotkey={String(i + 1)} dimColor={kind !== one}
            label={`${kind === one ? '● ' : ''}${s(`tab${cap(one)}` as keyof typeof en)}`}
            onPress={() => update($, view, () => one)} />
        ))}
      </Box>
    )
    if (id === undefined || task === null) {
      return (
        <Box flexDirection="column">
          <Text>{id === undefined ? s('noRun') : s('loading')}</Text>
        </Box>
      )
    }

    const stateWord = s(`state${cap(task.state)}` as keyof typeof en) || task.state
    const filled = task.total > 0 ? Math.round((BAR * task.done) / task.total) : 0
    const bar = (
      <Box>
        <Text color="success">{'━'.repeat(filled)}</Text>
        <Text color="inactive">{'─'.repeat(BAR - filled)}</Text>
        <Text bold>{`  ${task.done}/${task.total}`}</Text>
      </Box>
    )
    const card = (c: SummaryTask['work'][number], i: number) => (
      <Box key={`c${i}`} flexDirection="column">
        <Text wrap="truncate-end"><Text color={TINT[c.state]}>{MARK[c.state]}</Text>{` ${c.title}`}</Text>
        {c.state === 'failed' && c.reason && <Text color="error" wrap="truncate-end">{`  ${c.reason}`}</Text>}
      </Box>
    )

    let body
    if (kind === 'summary') {
      const you = task.you.items.length > 0 ? task.you.items.join('; ') : task.you.count > 0 ? String(task.you.count) : s('youNone')
      const others = (info?.waiting ?? 0) - task.you.count
      body = (
        <Box flexDirection="column">
          <Box flexWrap="wrap">
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
          <Box flexDirection="column" marginTop={1}>
            <Text color="claude" bold wrap="truncate-end">{`▶ ${s('now')} · ${nowSentence(s, task)}`}</Text>
            <Text color={task.you.count > 0 ? 'warning' : 'inactive'} wrap="truncate-end">{`⚑ ${s('you')} · ${you}`}</Text>
            {others > 0 && <Text color="warning">{`  ${s('youOthers', { n: others })}`}</Text>}
          </Box>
          <Box flexDirection="column" marginY={1}>
            {task.work.slice(0, WORK_MAX).map(card)}
            {task.work.length > WORK_MAX && <Text dimColor>{`  ${s('workMore', { n: task.work.length - WORK_MAX })}`}</Text>}
          </Box>
          {bar}
        </Box>
      )
    } else if (kind === 'work') {
      const cols = [
        { key: 'colTodo', tint: 'inactive', cards: task.work.filter(c => c.state === 'pending' || c.state === 'failed') },
        { key: 'colDoing', tint: 'claude', cards: task.work.filter(c => c.state === 'running') },
        { key: 'colDone', tint: 'success', cards: task.work.filter(c => c.state === 'done') },
      ] as const
      body = (
        <Box flexDirection="column">
          <Box>
            {cols.map(col => (
              <Box key={col.key} flexDirection="column" width="33%" borderStyle="round" borderColor={col.tint} paddingX={1}>
                <Text bold color={col.tint}>{`${s(col.key)} ${col.cards.length}`}</Text>
                {col.cards.map(card)}
              </Box>
            ))}
          </Box>
          {bar}
        </Box>
      )
    } else {
      const lines = task.log.map(one => `${one.time} ${s(`log${cap(one.kind)}` as keyof typeof en, { s: one.subject ?? '' }).trim()}`)
      body = (
        <Box flexDirection="column">
          {lines.length === 0 ? <Text dimColor>{s('noLog')}</Text> : lines.map((line, i) => <Text key={`l${i}`}>{line}</Text>)}
        </Box>
      )
    }
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        <Box>
          <Box flexShrink={1}><Text bold wrap="truncate-end">{task.title}</Text></Box>
          <Box flexShrink={0} marginLeft={2}>
            <Text color="claude">{s('headLine', { state: stateWord, day: task.day, done: task.done, total: task.total })}</Text>
          </Box>
        </Box>
        <Box marginY={1} justifyContent="space-between">
          {tabs}
          <Text dimColor>{`${task.key} · ${s('costLine', { usd: `$${task.cost.usd.toFixed(2)}`, turns: task.cost.turns })}`}</Text>
        </Box>
        {body}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const info = await read($, status)
    const task = await read($, summary)
    if (e.props.hasSurvey || info?.latest == null || task?.state !== 'running') return next(e)
    const lang$ = await read($, lang)
    const s = (key: keyof typeof en, vars?: Record<string, string | number>) => fmt(STRINGS[lang$][key], vars)
    const { Box, Button, Text } = $.ui.resolve(e)
    const open = () => $.ui.open({ id: PANE, title: 'Teams' })
    return (
      <Box flexDirection="column">
        <Box>
          <Box flexShrink={1}><Text dimColor wrap="truncate-end">{`teams · ${task.title}`}</Text></Box>
          <Box flexShrink={1}><Text dimColor wrap="truncate-end">{` — ${nowSentence(s, task)}`}</Text></Box>
          <Box flexShrink={0} marginLeft={1}>
            <Text color="success">{'━'.repeat(task.total > 0 ? Math.round((10 * task.done) / task.total) : 0)}</Text>
            <Text color="inactive">{'─'.repeat(10 - (task.total > 0 ? Math.round((10 * task.done) / task.total) : 0))}</Text>
            <Text dimColor>{` ${s('bandDone', { done: task.done, total: task.total })}`}</Text>
          </Box>
          <Box flexShrink={0} marginLeft={1}><Button key="board" label={s('board')} onPress={open} /></Box>
          {info.waiting > 0 && <Box flexShrink={0} marginLeft={1}><Button key="inbox" label={s('inbox', { n: info.waiting })} onPress={open} /></Box>}
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
