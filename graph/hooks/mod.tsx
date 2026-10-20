import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GraphNode, GraphRun, Snap } from '../types'
import { MARK, TINT, bar, cap, fmt, isKorean, rail, tabs } from './draw'
import type { Mark } from './draw'
import { active, detailRows, flowGroups } from './status'
import type { FlowGroup, FlowLine } from './status'

// Read only: the mod lists and reads the broker's run files and writes nothing.
const snap = atom({ plugin: 'graph', key: 'snap' } as const, null as Snap | null)
const view = atom({ plugin: 'graph', key: 'view' } as const, 'flow' as 'flow' | 'detail')
const lang = atom({ plugin: 'graph', key: 'lang' } as const, 'en' as 'en' | 'ko')

const PANE = 'graph-status'
const LINE_MAX = 24 // flow lines / detail rows drawn before "+n more"
const NOW_MAX = 3 // running nodes named on the Now lines
const DIR = '.harness-run/broker/runs'
const FILE = /^[0-9a-f-]+\.json$/ // not the `<file>.<pid>.<uuid>.tmp` the store renames from
const MAX_BYTES = 4 * 1024 * 1024 // $.fs.read rejects more
const LIVE_MS = 2 * 60 * 60 * 1000
const TICK_MS = 3000
const BAR = 24

const en = {
  tabFlow: 'Flow', tabDetail: 'Detail',
  now: 'Now', next: 'Next', blockedAt: 'Blocked at', allDone: 'All done', nothing: 'Nothing to run',
  stateRunning: 'running', stateBlocked: 'blocked', stateComplete: 'finished',
  headLine: '{state} · {done}/{total}', gates: '{done}/{total} gates', goalGate: 'goal gate {pct}%',
  stagePlan: 'Plan', stageSetgoal: 'SetGoal', stageCritique: 'Critique', stageBuild: 'Build', stageGate: 'Goal gate', stageReport: 'Report',
  nodeImplement: 'impl', nodeTest: 'test', nodeGate: 'gate',
  attempt: '(attempt {n})', feedback: 'feedback',
  noRun: 'No graph run in this folder.', tooBig: 'This run file is too large to show.',
  more: '+{n} more', cmdDesc: 'Open or close the graph status pane', paneOpened: 'pane opened', paneClosed: 'pane closed',
  closeBtn: 'close [q]',
}

// one table, two languages; the type keeps the keys identical
export const STRINGS: Record<'en' | 'ko', Record<keyof typeof en, string>> = {
  en,
  ko: {
    tabFlow: '흐름', tabDetail: '상세',
    now: '지금', next: '다음', blockedAt: '막힌 곳', allDone: '모두 끝남', nothing: '실행할 것 없음',
    stateRunning: '진행 중', stateBlocked: '막힘', stateComplete: '완료',
    headLine: '{state} · {done}/{total}', gates: '관문 {done}/{total}', goalGate: '목표 관문 {pct}%',
    stagePlan: '계획', stageSetgoal: '목표 설정', stageCritique: '비평', stageBuild: '구현', stageGate: '목표 관문', stageReport: '보고',
    nodeImplement: '구현', nodeTest: '테스트', nodeGate: '관문',
    attempt: '({n}번째 시도)', feedback: '전달된 피드백',
    noRun: '이 폴더에 그래프 실행이 없습니다.', tooBig: '실행 파일이 너무 커서 보여줄 수 없습니다.',
    more: '+{n}건 더', cmdDesc: '그래프 상태 창 열기/닫기', paneOpened: '창을 열었습니다', paneClosed: '창을 닫았습니다',
    closeBtn: '닫기 [q]',
  },
}
type Key = keyof typeof en

const nodeMark = (state: string): Mark =>
  state === 'done' ? 'done' : state === 'running' ? 'running' : state === 'failed' ? 'failed' : 'pending'

// graph.mjs settled(): an order-only dep that can no longer change
const settled = (n: GraphNode) =>
  n.state === 'done' || n.state === 'skipped' || n.state === 'unreachable' || (n.state === 'failed' && n.final === true)

// graph.mjs unmetDeps(), recomputed here: what still holds a pending node back
function unmet(run: GraphRun, n: GraphNode): string[] {
  const get = (id: string) => run.nodes.find(x => x.node_id === id)
  const data = n.deps.filter(d => get(d)?.state !== 'done')
  const order = (n.after ?? []).filter(d => {
    const dep = get(d)
    return !dep || !settled(dep)
  })
  const live =
    n.stage === 'report' && data.length === 0 && order.length === 0
      ? run.nodes.filter(x => x !== n && x.stage !== 'report' && (x.state === 'running' || (x.state === 'pending' && unmet(run, x).length === 0)))
      : []
  return [...data, ...order, ...live.map(x => x.node_id)]
}

const readyOf = (run: GraphRun) => run.nodes.filter(n => n.state === 'pending' && unmet(run, n).length === 0)

// graph.mjs runState()
function runState(run: GraphRun): 'running' | 'blocked' | 'complete' {
  if (run.nodes.some(n => n.stage === 'report' && n.state === 'done')) return 'complete'
  const isRunning = run.nodes.some(n => n.state === 'running')
  if (run.routing_blocked && !isRunning) return 'blocked'
  return readyOf(run).length === 0 && !isRunning ? 'blocked' : 'running'
}

const sgOf = (n: GraphNode) => (typeof n.subgoal_id === 'string' && n.subgoal_id !== '' ? n.subgoal_id : null)

// a person's name for a node, never its raw id
function label(s: (k: Key, v?: Record<string, string | number>) => string, n: GraphNode, how: 'attempt' | 'again') {
  const sg = sgOf(n)
  const name = sg !== null ? `${sg} ${s(`node${cap(n.stage)}` as Key)}` : s(`stage${cap(n.stage)}` as Key)
  if (sg === null && n.attempt <= 1) return name
  return `${name} ${s(how, { n: n.attempt })}`
}

function stageMark(nodes: GraphNode[]): Mark {
  if (nodes.length === 0) return 'pending'
  if (nodes.some(n => n.state === 'failed')) return 'failed'
  if (nodes.every(n => n.state === 'done')) return 'done'
  return nodes.some(n => n.state === 'running' || n.state === 'done') ? 'running' : 'pending'
}

function model(run: GraphRun) {
  const nodes = run.nodes.filter(n => n.state !== 'skipped')
  const last = (stage: string) => nodes.filter(n => n.stage === stage && sgOf(n) === null).at(-1)
  const single = (stage: string): Mark => {
    const n = last(stage)
    return n === undefined ? 'pending' : stageMark([n])
  }
  const rail: { key: string; state: Mark }[] = [
    { key: 'Plan', state: single('plan') },
    { key: 'Setgoal', state: single('setgoal') },
    { key: 'Critique', state: single('critique') },
    { key: 'Build', state: stageMark(nodes.filter(n => sgOf(n) !== null)) },
    { key: 'Gate', state: single('gate') },
    { key: 'Report', state: single('report') },
  ]
  const state = runState(run)
  // nothing running yet (a session run never marks a node running): the next stage is the one in progress
  if (state === 'running' && !rail.some(g => g.state === 'running' || g.state === 'failed')) {
    const first = rail.find(g => g.state === 'pending')
    if (first !== undefined) first.state = 'running'
  }
  const subgoals = run.spec?.subgoals ?? [...new Set(nodes.map(sgOf).filter((x): x is string => x !== null))].map(id => ({ id, title: '' }))
  const gateOf = (id: string) => nodes.filter(n => n.stage === 'gate' && sgOf(n) === id).at(-1)
  const pct = nodes.filter(n => n.stage === 'gate' && sgOf(n) === null && typeof n.result?.match_pct === 'number').at(-1)?.result?.match_pct
  const failed = nodes.filter(n => n.state === 'failed')
  return {
    state,
    nodes,
    rail,
    subgoals,
    total: subgoals.length,
    done: subgoals.filter(g => gateOf(g.id)?.state === 'done').length,
    pct,
    running: nodes.filter(n => n.state === 'running'),
    ready: readyOf(run),
    blocked: failed.find(n => n.final !== true) ?? failed[0] ?? nodes.find(n => n.state === 'pending'),
    nodeOf: (id: string, stage: string) => nodes.filter(n => n.stage === stage && sgOf(n) === id).at(-1),
  }
}
type Model = ReturnType<typeof model>

// the sentence the pane leads with
function focus(s: (k: Key, v?: Record<string, string | number>) => string, m: Model) {
  if (m.state === 'complete') return { kind: 'done', head: s('now'), text: s('allDone'), color: 'success' }
  if (m.state === 'blocked') {
    const reason = m.blocked?.result?.reason
    const what = m.blocked === undefined ? s('nothing') : label(s, m.blocked, 'attempt')
    return { kind: 'blocked', head: s('blockedAt'), text: reason ? `${what}: ${reason}` : what, color: 'warning' }
  }
  const one = m.running[0] ?? m.ready[0]
  const head = m.running.length > 0 ? s('now') : s('next')
  return { kind: 'run', head, text: one === undefined ? s('nothing') : label(s, one, 'attempt'), color: 'claude' }
}

// what scripts/failure-events.mjs returns per failed, reshaped or blocked node: the mod renders it as given
type FailureEvent = {
  key: string
  kind: string
  node: string
  attempt: number
  what: string
  reason: string
  next_step: string | null
  severity: 'info' | 'failure'
}
type RunEvent = { key: string; kind: string; node: string; attempt: number }

const FAILURE_MS = 10_000 // an info toast keeps the default timeout; a failure stays longer
const PUSH_MAX = 200
const PUSHED_STEPS = ['gave up', 'needs you']

// the node script's events for one run file; a failed call or unreadable output is no events
async function fetchFailures($: EngineInterface, file: string): Promise<FailureEvent[]> {
  try {
    const r = await $.process.run(['node', `${$.plugin.root}/scripts/failure-events.mjs`, file])
    if (r.exitCode !== 0) return []
    const out: unknown = JSON.parse(r.stdout.trim())
    return Array.isArray(out) ? (out as FailureEvent[]) : []
  } catch {
    return []
  }
}

// icon and timeout from the node-given severity and next_step only
const failureIcon = (ev: FailureEvent) => (ev.next_step === 'needs you' ? '⚠' : ev.severity === 'failure' ? '✗' : '↻')
const failureLine = (run: GraphRun, ev: FailureEvent) =>
  `${run.run_id.slice(0, 8)} ${ev.what} failed: ${ev.reason}${ev.next_step === null ? '' : ` → ${ev.next_step}`}`

// the run finished: the one event the mod reads from the run file itself
function completeEvent(run: GraphRun): RunEvent[] {
  if (runState(run) !== 'complete') return []
  const report = run.nodes.find(n => n.stage === 'report' && n.state === 'done')
  return report === undefined ? [] : [{ key: `${run.run_id}:${report.node_id}:complete:${report.attempt}`, kind: 'complete', node: report.node_id, attempt: report.attempt }]
}

// PushNotification's result: { message, pushSent?, localSent?, disabledReason? } (user_present at the terminal)
async function push($: EngineInterface, message: string): Promise<boolean> {
  try {
    const out = (await $.tool.call({ tool: 'PushNotification', message, status: 'proactive' } as never)) as { result?: unknown }
    const r = typeof out?.result === 'object' && out.result !== null ? (out.result as Record<string, unknown>) : undefined
    return r?.pushSent === true || r?.localSent === true
  } catch {
    return false // a failed push is a push not sent
  }
}

const titleOf = (run: GraphRun) => run.request.split('\n')[0]!.replace(/^\[[^\]]*\]\s*/, '').slice(0, 80)

export const register: Register = on => {
  let isRunning = false

  on('session.start', async ($, e, next) => {
    if ((await $.session.surfaces()).length === 0) return next(e)

    const startMs = await $.clock.now()
    const pushed = new Set<string>()
    const baselined = new Set<string>()
    const published = new Set<string>()
    const scanned = new Map<string, number>() // run id -> the file mtime its events were taken from

    // a failed, reshaped or blocked node toasts (a gave up also pushes); a finished run pushes (a toast when it is not sent)
    async function notifyRun(run: GraphRun, mtimeMs: number, name: string) {
      try {
        // the events change only when the file does: one script run per write
        if (scanned.get(run.run_id) === mtimeMs) return
        const file = `${await $.session.cwd()}/${DIR}/${name}`
        scanned.set(run.run_id, mtimeMs)
        const failures = await fetchFailures($, file)
        const fresh: (RunEvent | FailureEvent)[] = [...failures, ...completeEvent(run)].filter(ev => !pushed.has(ev.key))
        for (const ev of fresh) pushed.add(ev.key)
        // a run last written before this session started: what it already holds is not news
        if (!baselined.has(run.run_id)) {
          baselined.add(run.run_id)
          if (mtimeMs < startMs) return
        }
        for (const ev of fresh) {
          // the run outcome trophy counts: one per (run, outcome); a node reject is a retry, not an outcome
          const outcome = ev.kind === 'complete' ? 'pass' : ev.kind === 'failed' || ev.kind === 'blocked' ? 'fail' : undefined
          if (outcome !== undefined && !published.has(`${run.run_id}:${outcome}`)) {
            published.add(`${run.run_id}:${outcome}`)
            try {
              await $.state.set({ plugin: 'graph', key: 'outcome' }, { system: 'graph', outcome, at: await $.clock.now() })
            } catch {
              // fail open: a lost outcome never costs the push
            }
          }
          if ('what' in ev) {
            const line = failureLine(run, ev)
            const long = ev.severity !== 'info' || ev.next_step === 'needs you'
            const toast = `${failureIcon(ev)} ${line}`
            if (long) $.ui.toast(toast, { timeoutMs: FAILURE_MS })
            else $.ui.toast(toast)
            if (ev.next_step !== null && PUSHED_STEPS.includes(ev.next_step)) await push($, `graph ${line}`.slice(0, PUSH_MAX))
            continue
          }
          const max = typeof run.max_retries === 'number' ? `/${run.max_retries}` : ''
          const message = `graph ${run.run_id.slice(0, 8)}: ${ev.kind} — ${ev.node} (${ev.attempt}${max})`.slice(0, PUSH_MAX)
          if (!(await push($, message))) $.ui.toast(message)
        }
      } catch {
        // fail open: the pane is unaffected
      }
    }

    // the newest run file; skipped when it is unchanged, kept when it does not parse
    async function tick() {
      if (isRunning) return
      isRunning = true
      try {
        const now = await $.clock.now()
        const prev = await read($, snap)
        let entries: { name: string; kind: string; size: number; mtimeMs: number }[]
        try {
          entries = await $.fs.list(DIR)
        } catch {
          if (prev !== null) await update($, snap, () => null)
          return
        }
        const newest = entries.filter(f => f.kind === 'file' && FILE.test(f.name)).sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
        if (newest === undefined) {
          if (prev !== null) await update($, snap, () => null)
          return
        }
        const fresh = now - newest.mtimeMs <= LIVE_MS
        if (newest.size > MAX_BYTES) {
          await update($, snap, () => ({ run: null, big: true, mtimeMs: newest.mtimeMs, size: newest.size, live: false }))
          return
        }
        let run: GraphRun
        if (prev !== null && !prev.big && prev.run !== null && prev.mtimeMs === newest.mtimeMs && prev.size === newest.size) {
          run = prev.run
        } else {
          try {
            run = JSON.parse(await $.fs.read(`${DIR}/${newest.name}`)) as GraphRun
            if (!Array.isArray(run.nodes)) return
          } catch {
            return // a failed read or parse leaves the last good view
          }
        }
        await notifyRun(run, newest.mtimeMs, newest.name)
        const live = fresh && runState(run) !== 'complete'
        if (prev !== null && prev.run === run && prev.live === live) return
        await update($, snap, () => ({ run, big: false, mtimeMs: newest.mtimeMs, size: newest.size, live }))
      } catch {
        // an unreadable folder leaves the last view as it was
      } finally {
        isRunning = false
      }
    }

    // Claude Code's own language setting, read once per session
    try {
      const language = (await $.settings.read()).language
      await update($, lang, () => (isKorean(language) ? 'ko' : 'en'))
    } catch {
      // unreadable settings: English
    }
    await $.command.register({ name: 'graph-status', description: STRINGS[await read($, lang)].cmdDesc })
    await tick()
    $.clock.every(TICK_MS, tick)

    return next(e)
  })

  // the command again closes the pane; Esc and q close it too (closeOnEscape, the close button)
  on('command.run', { command: 'graph-status' }, async $ => {
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
    await $.ui.open({ id: PANE, title: 'Graph', focus: true, closeOnEscape: true })
    return { text: text.paneOpened }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const kind = await read($, view)
    const lang$ = await read($, lang)
    const s = (key: Key, vars?: Record<string, string | number>) => fmt(STRINGS[lang$][key], vars)
    const sn = await read($, snap)
    const closeBtn = <Button key="close" role="dismiss" label={s('closeBtn')} hotkey="q" onPress={() => $.ui.close({ id: PANE })} />
    if (sn === null || (sn.run === null && !sn.big)) return <Box flexDirection="column"><Text>{s('noRun')}</Text>{closeBtn}</Box>
    if (sn.run === null) return <Box flexDirection="column"><Text color="warning">{s('tooBig')}</Text>{closeBtn}</Box>

    const m = model(sn.run)
    const f = focus(s, m)
    const now = await $.clock.now()
    // Now: a line per running node (agent, how long); with none running, the sentence of focus()
    const act = active(sn.run, now).slice(0, NOW_MAX)
    const nowLines =
      act.length > 0
        ? act.map(a => ({ color: 'claude', text: `▶ ${s('now')} · ${label(s, a.node, 'attempt')} · ${a.agent}${a.elapsed === '' ? '' : ` · ${a.elapsed}`}` }))
        : [{ color: f.color, text: `${f.kind === 'blocked' ? '⚠' : '▶'} ${f.head} · ${f.text}` }]
    const stateWord = s(`state${cap(m.state)}` as Key)
    const gatesText = `${s('gates', { done: m.done, total: m.total })}${m.pct === undefined ? '' : ` · ${s('goalGate', { pct: m.pct })}`}`
    const mark = (n: GraphNode | undefined, word: string) => {
      const st = n === undefined ? 'pending' : nodeMark(n.state)
      return <Text color={TINT[st]}>{`${MARK[st]} ${word}`}</Text>
    }

    const subTitle = (id: string) => m.subgoals.find(g => g.id === id)?.title ?? ''
    const attemptText = (l: FlowLine) => s('attempt', { n: l.attempt })
    // one line per attempt: a subgoal's impl/test/gate chain, or one stage; a retry sits under the reject it answers
    const flowItem = (g: FlowGroup, l: FlowLine, key: string) => {
      const pad = (g.sg === null ? 0 : 1) + Math.min(l.depth, 4)
      const of = (st: string) => l.nodes.find(x => x.stage === st)
      const joined = (n: GraphNode | undefined) => (n !== undefined && n.state !== 'pending' && n.state !== 'skipped' ? ' ━ ' : ' ┄ ')
      const stageWord = (STRINGS[lang$] as Record<string, string>)[`stage${cap(g.stage)}`] ?? g.stage
      return (
        <Box key={key} flexDirection="column" marginLeft={pad * 2}>
          {g.sg === null ? (
            <Text wrap="truncate-end"><Text color={TINT[l.state]}>{MARK[l.state]}</Text>{` ${stageWord}${l.attempt > 1 ? ` ${attemptText(l)}` : ''}`}</Text>
          ) : (
            <Box>
              {mark(of('implement'), s('nodeImplement'))}
              <Text dimColor>{joined(of('test'))}</Text>
              {mark(of('test'), s('nodeTest'))}
              <Text dimColor>{joined(of('gate'))}</Text>
              {mark(of('gate'), s('nodeGate'))}
              <Text dimColor>{` ${attemptText(l)}`}</Text>
            </Box>
          )}
          {l.reason !== '' && <Text color="error" wrap="truncate-end">{`↳ ${l.reason}`}</Text>}
        </Box>
      )
    }

    let body
    if (kind === 'flow') {
      const items: unknown[] = []
      flowGroups(sn.run).forEach((g, gi) => {
        if (g.sg !== null) items.push(<Text key={`h${gi}`} bold wrap="truncate-end">{`${g.sg} ${subTitle(g.sg)}`.trim()}</Text>)
        g.lines.forEach((l, li) => items.push(flowItem(g, l, `l${gi}-${li}`)))
      })
      body = (
        <Box flexDirection="column">
          <Box flexDirection="column" marginY={1}>
            {items.slice(0, LINE_MAX)}
            {items.length > LINE_MAX && <Text dimColor>{`  ${s('more', { n: items.length - LINE_MAX })}`}</Text>}
          </Box>
          {bar(ui, m.done, m.total, BAR, gatesText)}
        </Box>
      )
    } else {
      const rows = detailRows(sn.run, now)
      body = (
        <Box flexDirection="column">
          <Box flexDirection="column" marginY={1}>
            {rows.slice(0, LINE_MAX).map((r, i) => {
              const st = nodeMark(r.node.state)
              return (
                <Box key={`d${i}`} flexDirection="column">
                  <Text wrap="truncate-end">
                    <Text color={TINT[st]}>{MARK[st]}</Text>
                    {` ${label(s, r.node, 'attempt')}  ${r.agent}${r.elapsed === '' ? '' : `  ${r.elapsed}`}`}
                  </Text>
                  {r.feedback !== '' && <Text dimColor wrap="truncate-end">{`  ${s('feedback')}: ${r.feedback}`}</Text>}
                  {r.reason !== '' && <Text color="error" wrap="truncate-end">{`  ${r.reason}`}</Text>}
                </Box>
              )
            })}
            {rows.length > LINE_MAX && <Text dimColor>{`  ${s('more', { n: rows.length - LINE_MAX })}`}</Text>}
          </Box>
          {bar(ui, m.done, m.total, BAR, gatesText)}
        </Box>
      )
    }
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        <Box>
          <Box flexShrink={1}><Text bold wrap="truncate-end">{titleOf(sn.run)}</Text></Box>
          <Box flexShrink={1} marginLeft={2}><Text dimColor wrap="truncate-end">{sn.run.run_id.slice(0, 8)}</Text></Box>
          <Box flexShrink={0} marginLeft={2}>
            <Text color="claude">{s('headLine', { state: stateWord, done: m.done, total: m.total })}</Text>
          </Box>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {nowLines.map((l, i) => <Text key={`now${i}`} color={l.color} bold wrap="truncate-end">{l.text}</Text>)}
        </Box>
        <Box marginY={1} justifyContent="space-between">
          <Box flexShrink={0}>
            {tabs(ui, [{ key: 'flow', label: s('tabFlow') }, { key: 'detail', label: s('tabDetail') }], kind, key => update($, view, () => key as 'flow' | 'detail'))}
          </Box>
          <Box flexShrink={0} marginLeft={2}>{closeBtn}</Box>
        </Box>
        <Box flexDirection="column">
          {m.rail.length > 0 && rail(ui, m.rail.map(g => ({ label: s(`stage${g.key}` as Key), state: g.state })))}
        </Box>
        {body}
      </Box>
    )
  })
}
