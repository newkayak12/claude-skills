import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Decision, RunInfo, RunSub, StageKey } from '../types'
import { MARK, TINT, bar, board, cap, cells, fmt, isKorean, rail, tabs } from './draw'
import type { Mark } from './draw'

const last = atom({ plugin: 'harness', key: 'last' } as const, null as Decision | null)
const armed = atom({ plugin: 'harness', key: 'armed' } as const, false)
const patterns = atom({ plugin: 'harness', key: 'patterns' } as const, [] as string[])
const windowHours = atom({ plugin: 'harness', key: 'windowHours' } as const, 2)
// the config file exists but is not JSON
const broken = atom({ plugin: 'harness', key: 'broken' } as const, false)
const run = atom({ plugin: 'harness', key: 'run' } as const, null as RunInfo | null)
// 'auto' opens on Run when a run is found, else on Gate
const view = atom({ plugin: 'harness', key: 'view' } as const, 'auto' as 'auto' | 'run' | 'units' | 'gate')
const lang = atom({ plugin: 'harness', key: 'lang' } as const, 'en' as 'en' | 'ko')

const PANE = 'harness-gate'
const CONFIG = '.claude/harness-gate.json'
const DECISION = '.claude/.harness-last-decision.json'
const TICK_MS = 5000
const RECENT_MS = 10 * 60 * 1000
const RUNS = '.harness-run'
const LIVE_MS = 2 * 60 * 60 * 1000
const MAX_READ = 4 * 1024 * 1024
const PASS_PCT = 90 // the pass bar of the run checker (engine fallback check)
const BAR = 24
const WORK_MAX = 6
const STAGES: StageKey[] = ['plan', 'setgoal', 'critique', 'implement', 'gate', 'report']

const en = {
  paneTitle: 'Harness gate', tabRun: 'Run', tabUnits: 'Units', tabGate: 'Gate',
  stagePlan: 'Plan', stageSetgoal: 'SetGoal', stageCritique: 'Critique', stageImplement: 'Implement/Test', stageGate: 'Gate', stageReport: 'Report',
  now: 'Now', nowImplement: 'Implementing', nowTest: 'Testing', nowGate: 'Gating', nowRetry: 'Retrying',
  nowStage: 'Working on {stage}', nowDone: 'All done', attempt: ' (attempt {n})',
  stateRunning: 'running', stateStalled: 'stalled', stateComplete: 'finished', headLine: '{state} · {done}/{total}',
  tries: '{n} tries', goalGate: 'Goal gate', passBar: '{pct}% (pass ≥ {bar})', more: '+{n} more',
  colTodo: 'To do', colDoing: 'Doing', colDone: 'Done',
  noRun: 'No harness run in this folder.', bandDone: '{done}/{total} done', bandRun: 'run',
  cmdDesc: 'Why the harness gate denied the last call, and how to engage it', paneOpened: 'pane opened',
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
    paneTitle: '하네스 게이트', tabRun: '실행', tabUnits: '단위', tabGate: '게이트',
    stagePlan: '계획', stageSetgoal: '목표 설정', stageCritique: '비평', stageImplement: '구현/테스트', stageGate: '게이트', stageReport: '보고',
    now: '지금', nowImplement: '구현 중', nowTest: '테스트 중', nowGate: '게이트 판정 중', nowRetry: '재시도 중',
    nowStage: '{stage} 진행 중', nowDone: '모두 끝남', attempt: ' ({n}번째 시도)',
    stateRunning: '진행 중', stateStalled: '멈춤', stateComplete: '완료', headLine: '{state} · {done}/{total}',
    tries: '{n}회 시도', goalGate: '목표 게이트', passBar: '{pct}% (통과 ≥ {bar})', more: '+{n}건 더',
    colTodo: '대기', colDoing: '진행', colDone: '완료',
    noRun: '이 폴더에 하네스 실행이 없습니다.', bandDone: '{done}/{total} 완료', bandRun: '보기',
    cmdDesc: '하네스 게이트가 마지막 호출을 막은 이유와 개입 방법', paneOpened: '창을 열었습니다',
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
    let state: Mark = impl > 0 ? 'running' : 'pending'
    if (result?.passed === true) state = 'done'
    else if (result?.passed === false) state = 'failed'
    subs.push({
      id, title, state,
      reason: state === 'failed' && typeof lastGate?.reason === 'string' ? lastGate.reason : '',
      tries: Math.max(Number(result?.attempts ?? 0) || 0, attempt),
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
    { done: critique !== undefined && critique.sound !== false },
    { done: implDone, failed: implDone && subs.some(x => x.state === 'failed') },
    { done: gate !== undefined, failed: goalPass === false },
    { done: has('05-report.md') },
  ]
  // done up to the first stage that is not; that one runs (or has failed), the rest wait
  let reached = false
  const stages = STAGES.map((key, i) => {
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
  }
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

    async function tickRun() {
      try {
        const found = await scanRun($)
        await update($, run, () => found)
      } catch {
        // an unreadable run dir leaves the last run as it was
      }
    }
    async function tickGate() {
      try {
        if (!(await $.fs.exists(CONFIG))) {
          await update($, armed, () => false)
          await update($, last, () => null)
          await update($, broken, () => false)
          $.ui.status(undefined)
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
        const now = await $.clock.now()
        if (decision !== null && decision.decision === 'deny' && now - decision.ts < RECENT_MS) {
          $.ui.status(`gate: denied ${decision.target} — /harness-gate`)
        } else {
          $.ui.status(`gate: armed (${list.length} patterns)`)
        }
      } catch {
        // a read error leaves the status as it was
      }
    }
    const tickAll = async () => {
      await tickRun()
      await tickGate()
    }

    // Claude Code's own language setting, read once per session
    try {
      const language = (await $.settings.read()).language
      await update($, lang, () => (isKorean(language) ? 'ko' : 'en'))
    } catch {
      // unreadable settings: English
    }
    await $.command.register({ name: 'harness-gate', description: STRINGS[await read($, lang)].cmdDesc })
    await tickAll()
    $.clock.every(TICK_MS, tickAll)

    return next(e)
  })

  // asked for by the person: the pane seats at any width; the command answers why the gate denied
  on('command.run', { command: 'harness-gate' }, async $ => {
    await update($, view, () => 'gate' as const)
    await $.ui.open({ id: PANE, title: 'Harness' })
    return { text: STRINGS[await read($, lang)].paneOpened }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const ui = { Box, Text, Button }
    const s = strings(await read($, lang))
    const r = await read($, run)
    const picked = await read($, view)
    const kind = picked === 'auto' ? (r === null ? 'gate' : 'run') : picked

    const items = (['run', 'units', 'gate'] as const).map(k => ({ key: k, label: s(`tab${cap(k)}` as Key) }))
    const tabRow = tabs(ui, items, kind, k => update($, view, () => k as 'run' | 'units' | 'gate'))

    let body
    if (kind === 'gate') {
      if (!(await read($, armed))) {
        body = <Text>{s((await read($, broken)) ? 'badGate' : 'noGate')}</Text>
      } else {
        const list = await read($, patterns)
        const hours = await read($, windowHours)
        const d = await read($, last)
        const now = await $.clock.now()
        body = (
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
    } else if (r === null) {
      body = <Text>{s('noRun')}</Text>
    } else {
      const unit = (x: RunSub, i: number) => (
        <Box key={`u${i}`} flexDirection="column">
          <Text wrap="truncate-end">
            <Text color={TINT[x.state]}>{MARK[x.state]}</Text>
            {` ${x.id}${x.title ? ` ${x.title}` : ''}${kind === 'run' && x.tries > 1 ? `  ${s('tries', { n: x.tries })}` : ''}`}
          </Text>
          {x.state === 'failed' && x.reason !== '' && <Text color="error" wrap="truncate-end">{`  ${x.reason}`}</Text>}
        </Box>
      )
      const progress =
        r.match !== null
          ? (
            <Box>
              <Text>{`${s('goalGate')} `}</Text>
              {bar(ui, r.match, 100, BAR, s('passBar', { pct: r.match, bar: PASS_PCT }))}
            </Box>
          )
          : bar(ui, r.done, r.total, BAR, `${r.done}/${r.total}`)
      if (kind === 'run') {
        body = (
          <Box flexDirection="column">
            {rail(ui, r.stages.map(g => ({ label: s(`stage${cap(g.key)}` as Key), state: g.state })))}
            <Box flexDirection="column" marginTop={1}>
              <Text color="claude" bold wrap="truncate-end">{`▶ ${s('now')} · ${nowSentence(s, r)}`}</Text>
            </Box>
            <Box flexDirection="column" marginY={1}>
              {r.subs.slice(0, WORK_MAX).map(unit)}
              {r.subs.length > WORK_MAX && <Text dimColor>{`  ${s('more', { n: r.subs.length - WORK_MAX })}`}</Text>}
            </Box>
            {progress}
          </Box>
        )
      } else {
        body = (
          <Box flexDirection="column">
            {board(
              ui,
              [
                { label: s('colTodo'), tint: 'inactive', items: r.subs.filter(x => x.state === 'pending' || x.state === 'failed') },
                { label: s('colDoing'), tint: 'claude', items: r.subs.filter(x => x.state === 'running') },
                { label: s('colDone'), tint: 'success', items: r.subs.filter(x => x.state === 'done') },
              ],
              unit,
            )}
            {progress}
          </Box>
        )
      }
    }

    const state = r === null ? '' : r.finished ? s('stateComplete') : r.live ? s('stateRunning') : s('stateStalled')
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        <Box>
          <Box flexShrink={1}><Text bold wrap="truncate-end">{r === null ? s('paneTitle') : r.title}</Text></Box>
          {r !== null && (
            <Box flexShrink={0} marginLeft={2}>
              <Text color="claude">{s('headLine', { state, done: r.done, total: r.total })}</Text>
            </Box>
          )}
        </Box>
        <Box marginY={1} justifyContent="space-between">
          {tabRow}
          {r !== null && <Text dimColor>{r.slug}</Text>}
        </Box>
        {body}
      </Box>
    )
  })

  // a band only while a run is live; the engine's own band is chained beneath
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await read($, run)
    if (e.props.hasSurvey || r === null || !r.live) return next(e)
    const s = strings(await read($, lang))
    const { Box, Button, Text } = $.ui.resolve(e)
    const open = async () => {
      await update($, view, () => 'run' as const)
      await $.ui.open({ id: PANE, title: 'Harness' })
    }
    const filled = cells(r.done, r.total, 10)
    return (
      <Box flexDirection="column">
        <Box>
          <Box flexShrink={1}><Text dimColor wrap="truncate-end">{`harness · ${r.title}`}</Text></Box>
          <Box flexShrink={1}><Text dimColor wrap="truncate-end">{` — ${nowSentence(s, r)}`}</Text></Box>
          <Box flexShrink={0} marginLeft={1}>
            <Text color="success">{'━'.repeat(filled)}</Text>
            <Text color="inactive">{'─'.repeat(10 - filled)}</Text>
            <Text dimColor>{` ${s('bandDone', { done: r.done, total: r.total })}`}</Text>
          </Box>
          <Box flexShrink={0} marginLeft={1}><Button key="run" label={s('bandRun')} onPress={open} /></Box>
        </Box>
        {await next(e)}
      </Box>
    )
  })
}
