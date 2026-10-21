import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { classify, classifyFile, copyReveal, pushRing, redact, splitCommands, stopCells, stopColumns, stopHeader, stopHeaderText, stopRows } from './guard-logic.ts'
import type { Denial, Env, Verdict } from './guard-logic.ts'
import { deniedCount, statusLine } from './status.ts'

const PANE = 'guard-denials'
export const DENIALS_KEY = 'session.denials'
const CAP = 200

export const guardAtom = atom({ plugin: 'session', key: 'guard' } as const, { denials: [] as Denial[] })
const copyAtom = atom({ plugin: 'session', key: 'guardCopy' } as const, '')

type Mode = 'confirm' | 'deny' | 'off'
type Ctx = { tool: string; call: string; agentId?: string; log: boolean }

let seq = 0

const list = (s: unknown) => String(s ?? '').split(/[,\n]/).map(x => x.trim()).filter(Boolean)

// One entry per stopped call. A broken store drops the entry, never the decision.
async function record($: any, d: Omit<Denial, 'id' | 'ts'>) {
  try {
    const ts = (await $.clock.now()) as number
    const cur = ((await $.store.get(DENIALS_KEY)) as Denial[] | undefined) ?? []
    const next = pushRing(cur, { ...d, id: `${ts}-${++seq}`, ts }, CAP)
    await $.store.set(DENIALS_KEY, next)
    await update($, guardAtom, () => ({ denials: next }))
  } catch {}
}

// A guard stop: log it, tell the person, answer the deny.
async function stop($: any, ctx: Ctx, reason: string, source: 'guard' | 'declined', rule: string) {
  if (ctx.log) await record($, { tool: ctx.tool, call: ctx.call, reason, source, rule, agentId: ctx.agentId })
  try {
    $.ui.toast(`guard: ${reason.split('\n')[0]}`, { timeoutMs: 6000 })
    $.ui.status(statusLine({ denied: deniedCount() + 1 }))
  } catch {}
  return { deny: reason }
}

// The one place a confirm-class verdict becomes a question; a missing or failing ask counts as Cancel.
async function askOrDeny($: any, v: NonNullable<Verdict>, e: any, next: (e: any) => any, mode: Mode, ctx: Ctx, label: string) {
  if (mode === 'off') return next(e)
  if (v.action === 'deny') return stop($, ctx, v.reason, 'guard', v.rule)
  if (mode === 'deny') return stop($, ctx, `${v.reason} Set guard_mode=off in /config to allow.`, 'guard', v.rule)
  let answer: string | undefined
  try {
    answer = await $.ui.ask(`Run \`${label.slice(0, 120)}\`?`, ['Run', 'Cancel'])
  } catch {}
  if (answer === 'Run') return next(e)
  return stop($, ctx, `session: the person declined (${v.rule}).`, 'declined', v.rule)
}

// Interactive sessions only: headless agents pass every rule and nothing is logged.
const live = async ($: any, mode: Mode) => mode !== 'off' && (await $.session.surfaces()).length > 0

const tryRun = async ($: any, argv: string[]) => {
  try {
    const r = await $.process.run(argv, { timeoutMs: 5000 })
    return r.exitCode === 0 ? (r.stdout as string) : undefined
  } catch {
    return undefined
  }
}

async function envOf($: any, extraBranches: string[]): Promise<Env> {
  const cwd = (await $.session.cwd()) as string
  let root: string | undefined
  let home: string | undefined
  try {
    root = (await $.session.root()) as string
  } catch {}
  try {
    home = (await $.env.get('HOME')) as string | undefined
  } catch {}
  return {
    cwd,
    root,
    home,
    extraBranches,
    git: argv => tryRun($, ['git', ...argv]),
    pgrep: path => tryRun($, ['pgrep', '-f', path]),
  }
}

const callOf = (tool: string, input: any) =>
  tool === 'Bash' ? redact(String(input?.command ?? '')).slice(0, 200) : String(input?.file_path ?? '')

export const register: Register = (on, options) => {
  const mode = ((options.guard_mode as Mode | undefined) ?? 'confirm') as Mode
  const extraBranches = list(options.guard_extra_protected_branches)
  const secretPaths = list(options.guard_secret_paths)
  const logOn = options.log_enabled !== false

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.tool !== 'Bash' || !(await live($, mode))) return next(e)
    const cmds = splitCommands(e.command)
    if (cmds.length === 0) return next(e)
    const v = await classify(cmds, await envOf($, extraBranches))
    if (!v) return next(e)
    const ctx = { tool: 'Bash', call: callOf('Bash', e), agentId: e.agentId, log: logOn }
    return askOrDeny($, v, e, next, mode, ctx, e.command)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (e.tool !== 'Write' || !(await live($, mode))) return next(e)
    const v = await classifyFile(e.file_path, secretPaths, await envOf($, extraBranches))
    if (!v) return next(e)
    const ctx = { tool: e.tool, call: e.file_path, agentId: e.agentId, log: logOn }
    return askOrDeny($, v, e, next, mode, ctx, `${e.tool} ${e.file_path}`)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (e.tool !== 'Edit' || !(await live($, mode))) return next(e)
    const v = await classifyFile(e.file_path, secretPaths, await envOf($, extraBranches))
    if (!v) return next(e)
    const ctx = { tool: e.tool, call: e.file_path, agentId: e.agentId, log: logOn }
    return askOrDeny($, v, e, next, mode, ctx, `${e.tool} ${e.file_path}`)
  }).catch(($, e, next) => next(e))

  // Observer: a verdict from beneath is never altered; a native deny is only written down.
  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    try {
      if (r.decision === 'deny' && logOn && (await $.session.surfaces()).length > 0) {
        await record($, {
          tool: e.tool,
          call: callOf(e.tool, e.input),
          reason: r.reason ?? 'denied',
          source: 'native',
          nativeRule: r.rule,
          agentId: e.agentId,
        })
      }
    } catch {}
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'session-denials' }, async ($, e) => {
    if ((await $.session.surfaces()).length === 0) return { text: 'Nothing to show here: no screen is attached.' }
    // the command again on an open pane closes it
    if (((await $.ui.panes()) as { id: string }[]).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: 'Denials pane closed.' }
    }
    await $.ui.open({ id: PANE, title: 'Denied calls', closeOnEscape: true })
    return { text: 'Denials pane opened.' }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const ring = (await read($, guardAtom)).denials
    const rows = stopRows(ring)
    const width = stopColumns(rows)
    const shown = await read($, copyAtom)
    return (
      <Box flexDirection="column">
        <Text key="head" bold>{stopHeaderText(stopHeader(mode, ring))}</Text>
        {rows.length === 0 && <Text>no denials</Text>}
        {rows.map(r => {
          const c = stopCells(r, width)
          return (
            <Box key={`d-${c.id}`} flexDirection="column">
              <Box gap={1}>
                <Text dimColor>{c.time}</Text>
                <Text bold>{c.tool}</Text>
                <Box flexGrow={1} flexShrink={1}><Text wrap="truncate-end">{c.what}</Text></Box>
                <Text dimColor>{c.rule}</Text>
                {c.source.tone === 'dim' ? <Text dimColor>{c.source.text}</Text> : <Text color={c.source.tone}>{c.source.text}</Text>}
                <Button key={`copy-${c.id}`} label="copy" onPress={() => update($, copyAtom, () => c.id)} />
              </Box>
              {shown === c.id && <Text>{copyReveal(r)}</Text>}
            </Box>
          )
        })}
        <Box key="foot" gap={1}>
          <Text dimColor>Esc ·</Text>
          <Button key="close" role="dismiss" label="q" hotkey="q" onPress={() => $.ui.close({ id: PANE })} />
          <Text dimColor>· /session-denials closes</Text>
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
