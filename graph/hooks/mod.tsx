import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GraphRow, OpenedRun } from '../types'
import { fmt, isKorean, tabs } from './draw'
import { bandLines, cells, detailLines, footerKeys, paneBody, renderLines } from './graph-draw'
import type { PaneCtx } from './graph-draw'
import { cycleRun, frozenOrder, listArgv, markLooked, paneKey, paneSlash, parseOpenArg, parseRow, parseRows, pickRun, runPosition, showArgv, spinnerPlan, standalone } from './status'

// Read only: the mod runs the node readout (`broker.mjs runs --list/--show --json`) and writes nothing.
const tab = atom({ plugin: 'graph', key: 'view' } as const, 'flow' as 'flow' | 'detail')
const lang = atom({ plugin: 'graph', key: 'lang' } as const, 'en' as 'en' | 'ko')
// the open runs of the last good list; [] until the readout first answers
const rows = atom({ plugin: 'graph', key: 'rows' } as const, [] as GraphRow[])
// the run the pane shows, by run_id; null (or one no longer listed): opening order decides
const selected = atom({ plugin: 'graph', key: 'selected' } as const, null as string | null)
// per run_id, the rejects the person has seen
const looked = atom({ plugin: 'graph', key: 'looked' } as const, {} as Record<string, number>)
// a run opened by `/graph-status open <run-file> <owner-key>`: not in the band or the [ ] list
const opened = atom({ plugin: 'graph', key: 'opened' } as const, null as OpenedRun | null)
const spin = atom({ plugin: 'graph', key: 'spin' } as const, 0)

const PANE = 'graph-status'
const TICK_MS = 5000
const SPIN_MS = 800 // a spinner frame; only while a shown run acts
const LIST_TIMEOUT_MS = 10_000

const en = {
  tabFlow: 'Flow', tabDetail: 'Detail', noRun: 'No graph run in this folder.',
  cmdDesc: 'Open or close the graph status pane', paneOpened: 'pane opened', paneClosed: 'pane closed',
  closeBtn: 'q', closeWord: 'close', prev: '[ prev', next: 'next ]', bandOpen: 'open',
  openFailed: 'could not read that run file',
  attempt: '(attempt {n})', feedback: 'feedback', more: '+{n} more',
}

// one table, two languages; the type keeps the keys identical
export const STRINGS: Record<'en' | 'ko', Record<keyof typeof en, string>> = {
  en,
  ko: {
    tabFlow: '흐름', tabDetail: '상세', noRun: '이 폴더에 그래프 실행이 없습니다.',
    cmdDesc: '그래프 상태 창 열기/닫기', paneOpened: '창을 열었습니다', paneClosed: '창을 닫았습니다',
    closeBtn: 'q', closeWord: '닫기', prev: '[ 이전', next: '다음 ]', bandOpen: '열기',
    openFailed: '그 실행 파일을 읽을 수 없습니다',
    attempt: '({n}번째 시도)', feedback: '전달된 피드백', more: '+{n}건 더',
  },
}
type Key = keyof typeof en

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
const failureLine = (row: GraphRow, ev: FailureEvent) =>
  `${row.id8} ${ev.what} failed: ${ev.reason}${ev.next_step === null ? '' : ` → ${ev.next_step}`}`

// the run finished: the one event the mod reads from the row itself (the node decided its state)
function completeEvent(row: GraphRow): RunEvent[] {
  if (row.state !== 'complete') return []
  const report = row.nodes.find(n => n.stage === 'report' && n.state === 'done')
  if (report === undefined) return []
  const attempt = report.attempt ?? 1
  return [{ key: `${row.run_id}:${report.node_id}:complete:${attempt}`, kind: 'complete', node: report.node_id, attempt }]
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

// The runs from the node CLI (rule 6: the path through $.plugin.root). A non-zero exit, a timeout, a throw or output
// that is not a list is no answer: null, and the caller keeps its last good list.
async function loadRows($: EngineInterface): Promise<GraphRow[] | null> {
  try {
    const out = await $.process.run(listArgv($.plugin.root, await $.session.cwd()), { timeoutMs: LIST_TIMEOUT_MS })
    return out.exitCode === 0 ? parseRows(out.stdout) : null
  } catch {
    return null
  }
}

// one run file as the node shows it; no answer is null
async function showRow($: EngineInterface, file: string): Promise<GraphRow | null> {
  try {
    const out = await $.process.run(showArgv($.plugin.root, file), { timeoutMs: LIST_TIMEOUT_MS })
    return out.exitCode === 0 ? parseRow(out.stdout) : null
  } catch {
    return null
  }
}

// The run_id order `[` / `]` walk, fixed while the listed set is the same. A cache a reload may lose: the order is then worked out again.
let frozen: string[] | null = null
// Set at session.start of a session that has a surface; no surface, never set, no timer. Caches a reload may lose.
let kick: (() => Promise<void>) | null = null
let spinner: { cancel: () => void } | null = null
let isRunning = false

// What the pane and band draw: the standalone runs in opening order, the one shown, and the opened run when there is one.
async function view($: EngineInterface) {
  const ordered = frozenOrder(standalone(await read($, rows)), await read($, looked), frozen)
  frozen = ordered.map(r => r.run_id)
  const sel = await read($, selected)
  const op = await read($, opened)
  return { ordered, sel, op, picked: op?.row ?? pickRun(ordered, sel) }
}

async function paneOpen($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some((p: { id: string }) => p.id === PANE)
  } catch {
    return false // panes unreadable: closed
  }
}

// The faster interval runs only while a shown run acts: the pane's run, or the band's leading one.
async function syncSpinner($: EngineInterface) {
  try {
    const v = await view($)
    const shown = (await paneOpen($)) ? [v.picked] : [v.ordered[0] ?? null]
    const { run: go } = spinnerPlan(shown, (await $.session.surfaces()).length, shown.some(r => r !== null))
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

// The one place the pane is opened from closed (the command and the band's button): the run opening order picks is the
// run shown from here on, by run_id. Open already: no-op.
async function openPane($: EngineInterface): Promise<void> {
  if (await paneOpen($)) return
  frozen = null // opened from closed: orders again, an unseen reject leads
  const v = await view($)
  await update($, selected, () => v.picked?.run_id ?? null)
  await update($, looked, l => markLooked(l, v.picked))
  await $.ui.open({ id: PANE, title: 'Graph', focus: true, closeOnEscape: true })
  await kick?.()
}

async function closePane($: EngineInterface): Promise<void> {
  await $.ui.close({ id: PANE })
  await update($, opened, () => null)
  await kick?.()
}

// `[` and `]`: the next run by run_id, marked as looked at; at an end, one run, or an opened run, nothing changes
async function cycle($: EngineInterface, by: 1 | -1) {
  const v = await view($)
  if (v.op !== null) return
  const id = cycleRun(v.ordered, v.sel, by)
  if (id === (v.picked?.run_id ?? null)) return
  await update($, selected, () => id)
  await update($, looked, l => markLooked(l, pickRun(v.ordered, id)))
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

    const startMs = await $.clock.now()
    const pushed = new Set<string>()
    const baselined = new Set<string>()
    const published = new Set<string>()
    const scanned = new Map<string, number>() // run id -> the file mtime its events were taken from

    // a failed, reshaped or blocked node toasts (a gave up also pushes); a finished run pushes (a toast when it is not sent)
    async function notifyRun(row: GraphRow) {
      try {
        // the events change only when the file does: one script run per write
        if (scanned.get(row.run_id) === row.last_change_ms) return
        scanned.set(row.run_id, row.last_change_ms)
        const failures = await fetchFailures($, row.file)
        const fresh: (RunEvent | FailureEvent)[] = [...failures, ...completeEvent(row)].filter(ev => !pushed.has(ev.key))
        for (const ev of fresh) pushed.add(ev.key)
        // a run last written before this session started: what it already holds is not news
        if (!baselined.has(row.run_id)) {
          baselined.add(row.run_id)
          if (row.last_change_ms < startMs) return
        }
        for (const ev of fresh) {
          // the run outcome trophy counts: one per (run, outcome); a node reject is a retry, not an outcome
          const outcome = ev.kind === 'complete' ? 'pass' : ev.kind === 'failed' || ev.kind === 'blocked' ? 'fail' : undefined
          if (outcome !== undefined && !published.has(`${row.run_id}:${outcome}`)) {
            published.add(`${row.run_id}:${outcome}`)
            try {
              await $.state.set({ plugin: 'graph', key: 'outcome' }, { system: 'graph', outcome, at: await $.clock.now() })
            } catch {
              // fail open: a lost outcome never costs the push
            }
          }
          if ('what' in ev) {
            const line = failureLine(row, ev)
            const long = ev.severity !== 'info' || ev.next_step === 'needs you'
            const toast = `${failureIcon(ev)} ${line}`
            if (long) $.ui.toast(toast, { timeoutMs: FAILURE_MS })
            else $.ui.toast(toast)
            if (ev.next_step !== null && PUSHED_STEPS.includes(ev.next_step)) await push($, `graph ${line}`.slice(0, PUSH_MAX))
            continue
          }
          const max = typeof row.max_retries === 'number' ? `/${row.max_retries}` : ''
          const message = `graph ${row.id8}: ${ev.kind} — ${ev.node} (${ev.attempt}${max})`.slice(0, PUSH_MAX)
          if (!(await push($, message))) $.ui.toast(message)
        }
      } catch {
        // fail open: the pane is unaffected
      }
    }

    // the readout again; a failed read leaves the last good list
    async function tick() {
      if (isRunning) return
      isRunning = true
      try {
        const live = await loadRows($)
        if (live !== null) {
          await update($, rows, () => live)
          // a run last written before the session, and not open, holds nothing new
          for (const row of live) if (row.open || row.last_change_ms >= startMs) await notifyRun(row)
        }
        const op = await read($, opened)
        if (op !== null) {
          const row = await showRow($, op.file)
          if (row !== null) await update($, opened, () => ({ ...op, row }))
        }
        // a reject that lands while the pane shows the run has been seen
        if (await paneOpen($)) {
          const shown = (await view($)).picked
          await update($, looked, l => markLooked(l, shown))
        }
      } catch {
        // an unreadable list leaves the last view as it was
      } finally {
        isRunning = false
      }
      await kick?.()
    }

    // Claude Code's own language setting, read once per session
    try {
      const language = (await $.settings.read()).language
      await update($, lang, () => (isKorean(language) ? 'ko' : 'en'))
    } catch {
      // unreadable settings: English
    }
    await $.command.register({ name: 'graph-status', description: STRINGS[await read($, lang)].cmdDesc, argumentHint: '[open <run-file> <owner-key>]' })
    await tick()
    $.clock.every(TICK_MS, tick)

    return next(e)
  })

  // The command again closes the pane; Esc and q close it too. `open <run-file> <owner-key>` is the hand-off from a teams
  // task: that run is shown under its key, outside the band and the [ ] list. The answer is one line (the headless reply).
  on('command.run', { command: 'graph-status' }, async ($, e) => {
    const text = STRINGS[await read($, lang)]
    const arg = parseOpenArg(e.args ?? '')
    if (arg !== null && 'usage' in arg) return { text: arg.usage }
    const isOpen = await paneOpen($)
    if (arg === null && isOpen) {
      await closePane($)
      return { text: text.paneClosed }
    }
    if (arg !== null) {
      const cwd = await $.session.cwd()
      // absolute: the refresh re-reads this path from the engine's own cwd, where a relative one would stop updating
      const file = arg.file.startsWith('/') ? arg.file : `${cwd}/${arg.file}`
      const row = await showRow($, file)
      if (row === null) return { text: text.openFailed }
      await update($, opened, () => ({ file, owner: arg.owner, row }))
    } else await update($, opened, () => null)
    if (!isOpen) await openPane($)
    else await kick?.()
    return { text: text.paneOpened }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const ui = { Box, Text, Button }
    const lang$ = await read($, lang)
    const s = (key: Key, vars?: Record<string, string | number>) => fmt(STRINGS[lang$][key], vars)
    const kind = await read($, tab)
    const v = await view($)
    const r = v.picked
    const n = v.op !== null ? 1 : v.ordered.length
    const ctx: PaneCtx = {
      width: Math.max(20, e.props.bodyColumns - 4), nowMs: await $.clock.now(), tick: await read($, spin),
      pos: v.op !== null ? { k: 1, n: 1 } : runPosition(v.ordered, v.sel), ...(v.op !== null ? { owner: v.op.owner } : {}),
      words: { attempt: STRINGS[lang$].attempt, feedback: STRINGS[lang$].feedback, more: STRINGS[lang$].more },
    }

    // `[` and `]` cannot be a Button hotkey; the pane's Input has the focus ring, takes every printable key, and status.ts
    // paneKey reads the last one. The same Input takes a typed `/command` (card 57): held until Enter, then paneSlash maps
    // it: `/graph-status` closes the pane, `/name args` runs that command, not awaited (awaited inside onSubmit the host
    // cuts the hook at its 10 s budget).
    const onKey = async (text: string) => {
      const key = paneKey(text)
      if (key === null) return
      if (key.kind === 'step') await cycle($, key.by)
      else if (key.kind === 'tab') await update($, tab, () => key.tab)
      else await closePane($)
    }
    const onSubmit = async (text: string) => {
      const slash = paneSlash(text)
      if (slash === null) return
      if (slash.kind === 'close') await closePane($)
      else void $.command.run({ command: slash.command, args: slash.args }).catch(() => {})
    }

    let body
    if (r === null) body = <Text>{s('noRun')}</Text>
    else body = renderLines(ui, kind === 'flow' ? paneBody(r, ctx) : detailLines(r, ctx))
    const keys = footerKeys(n)
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        <Box marginBottom={1}>
          {tabs(ui, [{ key: 'flow', label: s('tabFlow') }, { key: 'detail', label: s('tabDetail') }], kind, k => update($, tab, () => k as 'flow' | 'detail'))}
        </Box>
        {body}
        <Box marginTop={1} columnGap={2}>
          {keys.length > 1 && (
            <Box columnGap={1} flexShrink={0}>
              <Button key="prev" plain dimColor label={s('prev')} onPress={() => cycle($, -1)} />
              <Button key="next" plain dimColor label={s('next')} onPress={() => cycle($, 1)} />
            </Box>
          )}
          <Box columnGap={1} flexShrink={0}>
            <Button key="close" role="dismiss" dimColor label={s('closeBtn')} hotkey="q" onPress={() => closePane($)} />
            <Text dimColor>{s('closeWord')}</Text>
          </Box>
          <Box flexShrink={1} height={1} overflow="hidden"><Input key="keys" autoFocus value="" placeholder="" onInput={onKey} onSubmit={onSubmit} /></Box>
        </Box>
      </Box>
    )
  })

  // the band: one row for the leading standalone run, `+N` for the others, and a button that opens the pane
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await view($)
    if (e.props.hasSurvey || v.ordered.length === 0) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const label = STRINGS[await read($, lang)].bandOpen
    const lines = bandLines(v.ordered, { width: e.props.bodyColumns, nowMs: await $.clock.now(), tick: await read($, spin), reserve: cells(label) + 5 }) // the Button draws `[ label ]` after a 1-column margin
    if (lines.length === 0) return next(e)
    return (
      <Box flexDirection="column">
        <Box>
          <Box flexShrink={1}>{renderLines({ Box, Text, Button }, lines)}</Box>
          <Box flexShrink={0} marginLeft={1}>
            <Button key="open" label={label} onPress={async () => { await update($, opened, () => null); await openPane($) }} />
          </Box>
        </Box>
        {await next(e)}
      </Box>
    )
  })
}
