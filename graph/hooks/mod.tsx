import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { GraphNode, GraphRun, Snap } from '../types'
import { MARK, TINT, board, bar, cap, fmt, isKorean, rail, tabs } from './draw'
import type { Mark } from './draw'

// Read only: the mod lists and reads the broker's run files and writes nothing.
const snap = atom({ plugin: 'graph', key: 'snap' } as const, null as Snap | null)
const view = atom({ plugin: 'graph', key: 'view' } as const, 'flow' as 'flow' | 'nodes')
const lang = atom({ plugin: 'graph', key: 'lang' } as const, 'en' as 'en' | 'ko')

const PANE = 'graph-live'
const DIR = '.harness-run/broker/runs'
const FILE = /^[0-9a-f-]+\.json$/ // not the `<file>.<pid>.<uuid>.tmp` the store renames from
const MAX_BYTES = 4 * 1024 * 1024 // $.fs.read rejects more
const LIVE_MS = 2 * 60 * 60 * 1000
const TICK_MS = 3000
const BAR = 24
const COL_MAX = 6

const en = {
  tabFlow: 'Flow', tabNodes: 'Nodes',
  now: 'Now', next: 'Next', blockedAt: 'Blocked at', allDone: 'All done', nothing: 'Nothing to run',
  stateRunning: 'running', stateBlocked: 'blocked', stateComplete: 'finished',
  headLine: '{state} · {done}/{total}', gates: '{done}/{total} gates', goalGate: 'goal gate {pct}%',
  stagePlan: 'Plan', stageSetgoal: 'SetGoal', stageCritique: 'Critique', stageBuild: 'Build', stageGate: 'Goal gate', stageReport: 'Report',
  nodeImplement: 'impl', nodeTest: 'test', nodeGate: 'gate',
  attempt: '(attempt {n})', again: '#{n}',
  noRun: 'No graph run in this folder.', tooBig: 'This run file is too large to show.',
  more: '+{n} more', cmdDesc: 'Open the graph live pane', paneOpened: 'pane opened',
  colTodo: 'To do', colDoing: 'Doing', colDone: 'Done',
}

// one table, two languages; the type keeps the keys identical
export const STRINGS: Record<'en' | 'ko', Record<keyof typeof en, string>> = {
  en,
  ko: {
    tabFlow: '흐름', tabNodes: '노드',
    now: '지금', next: '다음', blockedAt: '막힌 곳', allDone: '모두 끝남', nothing: '실행할 것 없음',
    stateRunning: '진행 중', stateBlocked: '막힘', stateComplete: '완료',
    headLine: '{state} · {done}/{total}', gates: '관문 {done}/{total}', goalGate: '목표 관문 {pct}%',
    stagePlan: '계획', stageSetgoal: '목표 설정', stageCritique: '비평', stageBuild: '구현', stageGate: '목표 관문', stageReport: '보고',
    nodeImplement: '구현', nodeTest: '테스트', nodeGate: '관문',
    attempt: '({n}번째 시도)', again: '#{n}',
    noRun: '이 폴더에 그래프 실행이 없습니다.', tooBig: '실행 파일이 너무 커서 보여줄 수 없습니다.',
    more: '+{n}건 더', cmdDesc: '그래프 실행 현황 창 열기', paneOpened: '창을 열었습니다',
    colTodo: '대기', colDoing: '진행', colDone: '완료',
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

const titleOf = (run: GraphRun) => run.request.split('\n')[0]!.replace(/^\[[^\]]*\]\s*/, '').slice(0, 80)

export const register: Register = on => {
  let isRunning = false

  on('session.start', async ($, e, next) => {
    if ((await $.session.surfaces()).length === 0) return next(e)

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
    await $.command.register({ name: 'graph-live', description: STRINGS[await read($, lang)].cmdDesc })
    await tick()
    $.clock.every(TICK_MS, tick)

    return next(e)
  })

  on('command.run', { command: 'graph-live' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Graph' })
    return { text: STRINGS[await read($, lang)].paneOpened }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const kind = await read($, view)
    const lang$ = await read($, lang)
    const s = (key: Key, vars?: Record<string, string | number>) => fmt(STRINGS[lang$][key], vars)
    const sn = await read($, snap)
    if (sn === null || (sn.run === null && !sn.big)) return <Box flexDirection="column"><Text>{s('noRun')}</Text></Box>
    if (sn.run === null) return <Box flexDirection="column"><Text color="warning">{s('tooBig')}</Text></Box>

    const m = model(sn.run)
    const f = focus(s, m)
    const stateWord = s(`state${cap(m.state)}` as Key)
    const gatesText = `${s('gates', { done: m.done, total: m.total })}${m.pct === undefined ? '' : ` · ${s('goalGate', { pct: m.pct })}`}`
    const mark = (n: GraphNode | undefined, word: string) => {
      const st = n === undefined ? 'pending' : nodeMark(n.state)
      return <Text color={TINT[st]}>{`${MARK[st]} ${word}`}</Text>
    }

    let body
    if (kind === 'flow') {
      body = (
        <Box flexDirection="column">
          <Box flexDirection="column" marginTop={1}>
            <Text color={f.color} bold wrap="truncate-end">{`${f.kind === 'blocked' ? '⚠' : '▶'} ${f.head} · ${f.text}`}</Text>
          </Box>
          <Box flexDirection="column" marginY={1}>
            {m.subgoals.slice(0, COL_MAX).map(g => {
              const imp = m.nodeOf(g.id, 'implement')
              const tst = m.nodeOf(g.id, 'test')
              const gat = m.nodeOf(g.id, 'gate')
              const joined = (n: GraphNode | undefined) => (n !== undefined && n.state !== 'pending' ? ' ━ ' : ' ┄ ')
              return (
                <Box key={g.id}>
                  <Box flexShrink={1}><Text wrap="truncate-end">{`${g.id} ${g.title ?? ''}`.trim()}</Text></Box>
                  <Box flexShrink={0} marginLeft={2}>
                    {mark(imp, s('nodeImplement'))}
                    <Text dimColor>{joined(tst)}</Text>
                    {mark(tst, s('nodeTest'))}
                    <Text dimColor>{joined(gat)}</Text>
                    {mark(gat, s('nodeGate'))}
                  </Box>
                </Box>
              )
            })}
            {m.subgoals.length > COL_MAX && <Text dimColor>{`  ${s('more', { n: m.subgoals.length - COL_MAX })}`}</Text>}
          </Box>
          {bar(ui, m.done, m.total, BAR, gatesText)}
        </Box>
      )
    } else {
      const card = (n: GraphNode, i: number) => {
        const st = n.state === 'unreachable' ? 'pending' : nodeMark(n.state)
        return (
          <Box key={`n${i}`} flexDirection="column">
            <Text wrap="truncate-end"><Text color={TINT[st]}>{MARK[st]}</Text>{` ${label(s, n, 'again')}`}</Text>
            {n.state === 'failed' && n.result?.reason && <Text color="error" wrap="truncate-end">{`  ${n.result.reason}`}</Text>}
          </Box>
        )
      }
      const cols = [
        { label: s('colTodo'), tint: 'inactive', items: m.nodes.filter(n => n.state !== 'running' && n.state !== 'done') },
        { label: s('colDoing'), tint: 'claude', items: m.nodes.filter(n => n.state === 'running') },
        { label: s('colDone'), tint: 'success', items: m.nodes.filter(n => n.state === 'done') },
      ]
      body = (
        <Box flexDirection="column">
          {board(ui, cols, card)}
          {bar(ui, m.done, m.total, BAR, gatesText)}
        </Box>
      )
    }
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        <Box>
          <Box flexShrink={1}><Text bold wrap="truncate-end">{titleOf(sn.run)}</Text></Box>
          <Box flexShrink={0} marginLeft={2}>
            <Text color="claude">{s('headLine', { state: stateWord, done: m.done, total: m.total })}</Text>
          </Box>
        </Box>
        <Box marginY={1} justifyContent="space-between">
          {tabs(ui, [{ key: 'flow', label: s('tabFlow') }, { key: 'nodes', label: s('tabNodes') }], kind, key => update($, view, () => key as 'flow' | 'nodes'))}
          <Text dimColor>{sn.run.run_id.slice(0, 8)}</Text>
        </Box>
        <Box flexDirection="column">
          {m.rail.length > 0 && rail(ui, m.rail.map(g => ({ label: s(`stage${g.key}` as Key), state: g.state })))}
        </Box>
        {body}
      </Box>
    )
  })
}
