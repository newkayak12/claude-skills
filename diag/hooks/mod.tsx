import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import {
  appendEntry, batchBody, buildBatch, copyBody, goalFailed, harnessResult, marketplaceCandidates, newest,
  ownedMcpTool, ownedSkill, rowDetail, rowTitle, sendsOn,
} from './logic.ts'
import type { Entry } from './logic.ts'

const active = atom({ plugin: 'diag', key: 'active' } as const, false)
const lastSkill = atom({ plugin: 'diag', key: 'lastSkill' } as const, '')

const PANE = 'diag'
const DAY_MS = 86_400_000
// trophy's consent, read only; trophy alone writes it.
const trophyConsent = atom({ plugin: 'trophy', key: 'consent' } as const, 'unasked' as 'unasked' | 'yes' | 'no')
const trophyVersion = atom({ plugin: 'trophy', key: 'consentVersion' } as const, 0)

const TEXT_MAX = 2000
const USAGE = 'usage: /diag bug <note>'

type Owned = { skills: Record<string, string[]>; servers: Record<string, string[]> }

// What this marketplace ships, read once per session from $.plugin.root; empty when unreadable, so
// nothing is recorded (fails toward privacy).
let owned: Owned = { skills: {}, servers: {} }

const readJson = async ($: any, path: string) => JSON.parse(await $.fs.read(path))

async function loadOwned($: any): Promise<Owned> {
  const out: Owned = { skills: {}, servers: {} }
  const parts = String($.plugin.root).replace(/\/+$/, '').split('/')
  for (const path of marketplaceCandidates($.plugin.root, parts[parts.length - 3])) {
    let plugins: { name: string; source?: unknown }[]
    try {
      plugins = (await readJson($, path)).plugins
    } catch {
      continue // try the next candidate
    }
    const base = path.slice(0, -'/.claude-plugin/marketplace.json'.length)
    for (const p of plugins) {
      out.skills[p.name] = []
      out.servers[p.name] = []
      if (typeof p.source !== 'string' || !p.source.startsWith('./')) continue
      const dir = `${base}/${p.source.slice(2)}`
      try {
        const entries = (await $.fs.list(`${dir}/skills`)) as { name: string; kind: string }[]
        out.skills[p.name] = entries.filter(x => x.kind === 'dir').map(x => x.name)
      } catch {}
      try {
        out.servers[p.name] = Object.keys((await readJson($, `${dir}/.mcp.json`)).mcpServers ?? {})
      } catch {}
    }
    break
  }
  return out
}

async function record($: any, entry: Omit<Entry, 'ts' | 'day' | 'session'>) {
  const ts = (await $.clock.now()) as number
  const session = (await $.session.id()) as string
  const log = ((await $.store.get('diag.log')) ?? []) as Entry[]
  const day = new Date(ts).toISOString().slice(0, 10)
  await $.store.set('diag.log', appendEntry(log, { ...entry, ts, day, session }))
}

// Recording never changes what the engine returns: any failure here is swallowed.
const safe = async (work: () => Promise<unknown>) => {
  try {
    await work()
  } catch {}
}

const cut = (v: unknown) => String(v ?? '').slice(0, TEXT_MAX)

export const register: Register = on => {
  // Non-interactive sessions (every `claude -p`) record and register nothing.
  on('session.start', async ($, e, next) => {
    if (!e.isInteractive) return next(e)

    await update($, active, () => true)
    await update($, lastSkill, () => '')
    owned = await loadOwned($)
    if ((await $.store.get('diag.installId')) === undefined) {
      await $.store.set('diag.installId', crypto.randomUUID())
    }
    await $.command.register({
      name: 'diag',
      description: 'Failures of this marketplace\'s skills: list, or "bug <note>" to report one',
      argumentHint: 'bug <note>',
    })

    return next(e)
  }).catch(($, e, next) => next(e))

  // S1a (owned skill failed to load) and S5 (owned MCP tool failed). An interrupt is the person's, not a bug.
  on('classic.PostToolUseFailure', async ($, e, next) => {
    if (!(await read($, active)) || e.is_interrupt === true) return next(e)
    await safe(async () => {
      const text = cut(e.error)
      if (e.tool_name === 'Skill') {
        const hit = ownedSkill((e.tool_input as { skill?: unknown } | undefined)?.skill, owned.skills)
        if (hit) await record($, { kind: 'bug', reason: 'is_error', plugin: hit.plugin, skill: hit.skill, local: { text } })
        return
      }
      const mcp = ownedMcpTool(e.tool_name, e.mcp_server, owned.servers)
      if (mcp) await record($, { kind: 'bug', reason: 'mcp_error', plugin: mcp.plugin, tool: mcp.tool, local: { text } })
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  // S1b: the Skill tool answered but the skill did not succeed; remembers the last owned skill.
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const result = await next(e)
    if (e.tool !== 'Skill' || !(await read($, active))) return result
    await safe(async () => {
      const hit = ownedSkill(e.skill, owned.skills)
      if (!hit) return
      await update($, lastSkill, () => `${hit.plugin}:${hit.skill}`)
      const r = result as { deny?: string; isError?: boolean; result?: any }
      if (r.deny !== undefined || r.isError || !r.result || r.result.success !== false) return
      const forked = r.result.status === 'forked'
      await record($, {
        kind: 'bug',
        reason: forked ? 'forked_unsuccessful' : 'unsuccessful',
        plugin: hit.plugin,
        skill: hit.skill,
        local: forked ? { text: cut(r.result.result) } : {},
      })
    })
    return result
  }).catch(($, e, next) => next(e))

  // S2a: the harness engine wrote a final failed subgoal result.
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const result = await next(e)
    if (e.tool !== 'Write' || !(await read($, active))) return result
    await safe(async () => {
      const r = result as { deny?: string; isError?: boolean }
      if (r.deny !== undefined || r.isError) return
      const hit = harnessResult(e.file_path, e.content)
      if (hit) {
        await record($, {
          kind: 'outcome',
          reason: 'subgoal_failed',
          local: { slug: hit.slug, subgoal: hit.subgoal, path: e.file_path },
        })
      }
    })
    return result
  }).catch(($, e, next) => next(e))

  // S2b': fallback-check.mjs printed the final `COMPLETE <slug> goal-gate FAIL`.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    if (e.tool !== 'Bash' || !(await read($, active))) return result
    await safe(async () => {
      const r = result as { deny?: string; isError?: boolean; result?: { stdout?: string } }
      if (r.deny !== undefined || r.isError || !e.command.includes('fallback-check.mjs')) return
      const stdout = r.result?.stdout ?? ''
      if (!goalFailed(stdout)) return
      const slug = /^COMPLETE\s+(\S+)/m.exec(stdout)?.[1]
      await record($, { kind: 'outcome', reason: 'goal_failed', local: slug ? { slug } : {} })
    })
    return result
  }).catch(($, e, next) => next(e))

  // A typed `/plugin:skill` of this marketplace becomes the last skill. Only a name this marketplace
  // ships is kept; whatever else was typed is never stored.
  on('prompt.submit', async ($, e, next) => {
    if (await read($, active)) {
      await safe(async () => {
        const typed = /^\s*\/(\S+)/.exec(e.text)?.[1]
        const hit = ownedSkill(typed, owned.skills)
        if (hit) await update($, lastSkill, () => `${hit.plugin}:${hit.skill}`)
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // S4: `/diag bug <note>`; the note stays local.
  on('command.run', { command: 'diag' }, async ($, e, next) => {
    const m = /^\s*bug(?:\s+([\s\S]*))?$/.exec(e.args)
    if (!m) return next(e)
    const note = (m[1] ?? '').trim()
    if (!note) return { text: USAGE }
    try {
      const last = await read($, lastSkill)
      const hit = ownedSkill(last, owned.skills)
      await record($, {
        kind: 'report',
        reason: 'user_report',
        ...(hit ? { plugin: hit.plugin, skill: hit.skill } : {}),
        local: { note: cut(note) },
      })
      return { text: 'Recorded.' }
    } catch {
      return { text: 'Could not record the report.' }
    }
  }).catch(($, e, next) => next(e))

  // `/diag` opens the pane; `/diag bug <note>` is handled above.
  on('command.run', { command: 'diag' }, async ($, e, next) => {
    if (/^\s*bug(?:\s|$)/.test(e.args)) return next(e)
    await $.ui.open({ id: PANE, title: 'Diag' })
    return { text: 'Diag pane opened.' }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const log = ((await $.store.get('diag.log')) ?? []) as Entry[]
    const sending = sendsOn(await read($, trophyConsent), await read($, trophyVersion))
    const through = new Date(((await $.clock.now()) as number) - DAY_MS).toISOString().slice(0, 10)
    const events = buildBatch(log, (await $.store.get('diag.sentThrough')) as string | undefined, through)
    const installId = String((await $.store.get('diag.installId')) ?? '')
    const rows = newest(log)
    return (
      <Box flexDirection="column">
        <Text bold>{sending ? '전송: trophy 동의 yes → 켜짐' : '전송: 꺼짐 (로컬만)'}</Text>
        {rows.length === 0 && <Text dimColor>No failures recorded.</Text>}
        {rows.map((r, i) => (
          <Box key={`row-${i}`} flexDirection="column">
            <Box>
              <Text>{rowTitle(r)} </Text>
              <Button
                key={`copy-${i}`}
                label="복사"
                onPress={press => {
                  void $.ui.copy({ text: copyBody(r), surface: press.surface }).catch(() => {})
                }}
              />
            </Box>
            {rowDetail(r).map((line, j) => <Text key={`d-${i}-${j}`} dimColor>{line}</Text>)}
          </Box>
        ))}
        <Text bold>다음 전송 미리보기 ({events.length} events)</Text>
        <Text>{batchBody(events, installId)}</Text>
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
