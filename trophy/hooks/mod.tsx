import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { achievements } from '../data/achievements.ts'
import { triggers } from '../data/triggers.ts'
import {
  achievementRow,
  addTurn,
  buildBatch,
  buildProfile,
  closeTurn,
  CONSENT_VERSION,
  dayOf,
  effectiveConsent,
  evaluate,
  matchTriggers,
  POSTHOG_URL,
  recordUse,
  resolveSkill,
  scrub,
  sumDays,
  triggerLists,
  typedCommand,
} from './logic.ts'
import type { BatchStore, DayCounts, Use } from './logic.ts'

const active = atom({ plugin: 'trophy', key: 'active' } as const, false)
const turnMatched = atom({ plugin: 'trophy', key: 'turnMatched' } as const, [] as string[])
const turnFired = atom({ plugin: 'trophy', key: 'turnFired' } as const, [] as string[])
const turnTyped = atom({ plugin: 'trophy', key: 'turnTyped' } as const, false)
const tab = atom({ plugin: 'trophy', key: 'tab' } as const, 'trophies' as 'trophies' | 'triggers')
const consent = atom({ plugin: 'trophy', key: 'consent' } as const, 'unasked' as 'unasked' | 'yes' | 'no')
const consentVersion = atom({ plugin: 'trophy', key: 'consentVersion' } as const, 0)

const PANE = 'trophy'
const BATCH_PANE = 'trophy-batch'
type Consent = 'unasked' | 'yes' | 'no'

// The one place consent changes: the store keeps it, the state redraws the band.
async function setConsent($: EngineInterface, value: Consent) {
  await $.store.set('trophy.consent', value)
  await $.store.set('trophy.consentVersion', CONSENT_VERSION)
  await update($, consent, () => value)
  await update($, consentVersion, () => CONSENT_VERSION)
}

const DAY_MS = 86_400_000
const MARKETPLACE_PLUGINS = new Set(triggers.map(t => t.plugin))

// Every hook fails open: the event goes on, and the failure is kept (scrubbed) for the next send.
async function failOpen($: EngineInterface, e: unknown, next: any) {
  try {
    const errors = (((await $.store.get('trophy.errors')) ?? []) as BatchStore['errors']).slice(-49)
    const day = dayOf(await $.clock.now())
    await $.store.set('trophy.errors', [...errors, { day, message: scrub(String(next.error?.message ?? 'hook failed')) }])
  } catch {
    // keeping the error is best effort
  }
  return next(e)
}

async function readBatchStore($: EngineInterface): Promise<BatchStore> {
  const get = async (key: string, empty: unknown) => (await $.store.get(key)) ?? empty
  return {
    installId: String(await get('trophy.installId', '')),
    sentThrough: (await $.store.get('trophy.sentThrough')) as string | undefined,
    uses: (await get('trophy.uses', [])) as Use[],
    triggers: (await get('trophy.triggers', {})) as DayCounts,
    unlocked: (await get('trophy.unlocked', {})) as Record<string, string>,
    errors: (await get('trophy.errors', [])) as BatchStore['errors'],
    plugins: (await get('trophy.plugins', {})) as Record<string, string[]>,
  }
}

const yesterday = async ($: EngineInterface) => dayOf((await $.clock.now()) - DAY_MS)

// Which of this marketplace's plugins the session lists skills from, kept per day.
async function recordPlugins($: EngineInterface) {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const names = (usage.context.breakdown?.skills?.skillFrontmatter ?? []).flatMap(s =>
    s.pluginName && MARKETPLACE_PLUGINS.has(s.pluginName) ? [s.pluginName] : [],
  )
  if (names.length === 0) return
  const day = dayOf(await $.clock.now())
  const all = ((await $.store.get('trophy.plugins')) ?? {}) as Record<string, string[]>
  await $.store.set('trophy.plugins', { ...all, [day]: [...new Set([...(all[day] ?? []), ...names])].sort() })
}

// Sends the days not yet sent, up to yesterday, for a person who said yes; a failed send changes nothing.
async function sendIfDue($: EngineInterface) {
  const answer = effectiveConsent(
    (await $.store.get('trophy.consent')) as Consent | undefined,
    (await $.store.get('trophy.consentVersion')) as number | undefined,
  )
  if (answer !== 'yes') return
  const through = await yesterday($)
  const sent = (await $.store.get('trophy.sentThrough')) as string | undefined
  if (sent !== undefined && sent >= through) return
  const body = buildBatch(await readBatchStore($), through)
  if (body.batch.length > 0) {
    const res = await $.http.fetch(POSTHOG_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return
  }
  const errors = (((await $.store.get('trophy.errors')) ?? []) as BatchStore['errors']).filter(e => e.day > through)
  await $.store.set('trophy.errors', errors)
  await $.store.set('trophy.sentThrough', through)
}

// The file trophy:list reads. Written after every store change; a failed write never blocks the prompt.
async function mirror($: EngineInterface) {
  try {
    const get = async (key: string, empty: unknown) => (await $.store.get(key)) ?? empty
    const profile = buildProfile(
      (await get('trophy.uses', [])) as Use[],
      (await get('trophy.unlocked', {})) as Record<string, string>,
      (await get('trophy.triggers', {})) as DayCounts,
      achievements,
      triggers,
      await $.clock.now(),
    )
    await $.fs.write(`${await $.env.get('HOME')}/.claude/trophy/profile.json`, JSON.stringify(profile, null, 2))
  } catch {
    // the mirror is a convenience
  }
}

// Records one skill use; always called before `next`, so a throw here falls to the hook's `.catch`.
async function note($: EngineInterface, name: string) {
  if (!(await read($, active))) return
  const hit = resolveSkill(name, triggers)
  if (!hit) return
  const uses = ((await $.store.get('trophy.uses')) ?? []) as Use[]
  const now = await $.clock.now()
  const recorded = recordUse(uses, hit.skill, now, await $.session.id())
  await $.store.set('trophy.uses', recorded)
  await update($, turnFired, list => [...list, hit.skill])

  const unlocked = ((await $.store.get('trophy.unlocked')) ?? {}) as Record<string, string>
  const fresh = evaluate(recorded, achievements, unlocked)
  if (fresh.length > 0) {
    await $.store.set('trophy.unlocked', { ...unlocked, ...Object.fromEntries(fresh.map(id => [id, dayOf(now)])) })
    for (const a of achievements.filter(a => fresh.includes(a.id))) $.ui.toast(`🏆 ${a.title} — ${a.description}`)
  }
  await mirror($)
}

export const register: Register = on => {
  // Non-interactive sessions (every `claude -p`, so every teams/graph adapter) stay idle.
  on('session.start', async ($, e, next) => {
    if (!e.isInteractive) return next(e)

    await update($, active, () => true)
    const savedVersion = (await $.store.get('trophy.consentVersion')) as number | undefined
    // An older yes reads as unasked (the band asks once more); the stored value stays until answered.
    const saved = effectiveConsent((await $.store.get('trophy.consent')) as Consent | undefined, savedVersion)
    await update($, consent, () => saved)
    await update($, consentVersion, () => savedVersion ?? 0)
    if ((await $.store.get('trophy.installId')) === undefined) {
      await $.store.set('trophy.installId', crypto.randomUUID())
    }
    await $.command.register({
      name: 'achievements',
      description: 'Show your skill achievements',
    })
    await $.command.register({
      name: 'trophy-telemetry',
      description: 'Anonymous usage counts: on, off or status',
      argumentHint: 'on|off|status',
    })
    await recordPlugins($).catch(() => {})
    await sendIfDue($).catch(() => {})

    return next(e)
  }).catch(failOpen)

  // skill.prompt is skipped for user-tier hooks under some organizations' policy (00-spike-findings),
  // so the Skill tool and the typed command report the same uses.
  on('skill.prompt', async ($, e, next) => {
    await note($, e.skill)
    return next(e)
  }).catch(failOpen)

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    await note($, e.skill)
    return next(e)
  }).catch(failOpen)

  on('classic.UserPromptExpansion', async ($, e, next) => {
    if (e.expansion_type === 'slash_command') await note($, e.command_name)
    return next(e)
  }).catch(failOpen)

  // A prompt's trigger phrases are matched on the way in and judged against the skills that fired when the turn ends.
  on('prompt.submit', async ($, e, next) => {
    if (await read($, active)) {
      await update($, turnMatched, () => matchTriggers(e.text, triggers))
      await update($, turnFired, () => [])
      const typed = typedCommand(e.text)
      await update($, turnTyped, () => typed !== undefined)
      // The one path that still sees a typed skill when skill.prompt and UserPromptExpansion are skipped.
      if (typed) await note($, typed)
    }
    return next(e)
  }).catch(failOpen)

  on('turn.complete', async ($, e, next) => {
    if ((await read($, active)) && e.agentId === undefined && !(await read($, turnTyped))) {
      const turn = closeTurn(await read($, turnMatched), await read($, turnFired))
      await update($, turnMatched, () => [])
      await update($, turnFired, () => [])
      if (turn.hit.length + turn.miss.length + turn.unmatched.length > 0) {
        const counts = ((await $.store.get('trophy.triggers')) ?? {}) as DayCounts
        await $.store.set('trophy.triggers', addTurn(counts, dayOf(await $.clock.now()), turn))
        await mirror($)
      }
    }
    return next(e)
  }).catch(failOpen)

  // The pane opens only from its command.
  on('command.run', { command: 'achievements' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Achievements' })
    return { text: 'Achievements pane opened.' }
  }).catch(failOpen)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await read($, tab)
    const unlocked = ((await $.store.get('trophy.unlocked')) ?? {}) as Record<string, string>
    const header = (
      <Box>
        <Text key="count" bold>
          {Object.keys(unlocked).length} / {achievements.length} 해금{' '}
        </Text>
        <Button key="tab-trophies" label="업적" onPress={() => update($, tab, () => 'trophies')} />
        <Button key="tab-triggers" label="트리거" onPress={() => update($, tab, () => 'triggers')} />
      </Box>
    )

    if (current === 'triggers') {
      const counts = ((await $.store.get('trophy.triggers')) ?? {}) as DayCounts
      const lists = triggerLists(sumDays(counts, dayOf(await $.clock.now()), 7), triggers)
      const never = lists.never.slice(0, 5).join(', ')
      return (
        <Box flexDirection="column">
          {header}
          <Text bold>가장 많이 맞은 스킬 (7일)</Text>
          {lists.hit.map(([skill, n]) => (
            <Text>{skill} · {n}</Text>
          ))}
          <Text bold>가장 많이 놓친 스킬 (트리거 문구는 있었는데 안 쓴)</Text>
          {lists.miss.map(([skill, n]) => (
            <Text>{skill} · {n}</Text>
          ))}
          <Text bold>한 번도 안 쓴 스킬 ({lists.never.length})</Text>
          <Text dimColor>{never}</Text>
        </Box>
      )
    }

    const uses = ((await $.store.get('trophy.uses')) ?? []) as Use[]
    return (
      <Box flexDirection="column">
        {header}
        {achievements.map(a => (
          <Text key={`row-${a.id}`}>{achievementRow(a, uses, unlocked[a.id])}</Text>
        ))}
      </Box>
    )
  }).catch(failOpen)

  on('command.run', { command: 'trophy-telemetry' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'on' || arg === 'off') {
      await setConsent($, arg === 'on' ? 'yes' : 'no')
      return { text: `trophy telemetry: ${arg === 'on' ? 'yes' : 'no'}` }
    }
    if (arg === 'status') {
      const now = await read($, consent)
      const old = now === 'unasked' && (await $.store.get('trophy.consent')) === 'yes'
      return { text: `trophy telemetry: ${old ? 'unasked (v1 yes — 재동의 필요)' : now === 'yes' ? `yes (v${CONSENT_VERSION})` : now}` }
    }
    return { text: 'usage: /trophy-telemetry on|off|status' }
  }).catch(failOpen)

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, active)) || (await read($, consent)) !== 'unasked') return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text>trophy: 익명 사용 통계를 보낼까요? (스킬명·일별 횟수·오류 코드만, 프롬프트·경로 없음) </Text>
        <Button key="send" label="보내기" onPress={() => setConsent($, 'yes')} />
        <Button key="decline" label="안 보내기" onPress={() => setConsent($, 'no')} />
        <Button key="show" label="내용 보기" onPress={() => $.ui.open({ id: BATCH_PANE, title: 'Telemetry preview' })} />
      </Box>
    )
  }).catch(failOpen)

  // Exactly what the next send would carry.
  on('ui.render', { component: 'Pane', requestId: BATCH_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const body = buildBatch(await readBatchStore($), await yesterday($))
    return (
      <Box flexDirection="column">
        <Text dimColor>POST {POSTHOG_URL} — {body.batch.length} events</Text>
        <Text>{JSON.stringify(body, null, 2)}</Text>
      </Box>
    )
  }).catch(failOpen)
}
