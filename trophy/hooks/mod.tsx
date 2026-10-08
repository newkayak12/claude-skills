import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { achievements } from '../data/achievements.ts'
import { triggers } from '../data/triggers.ts'
import {
  achievementRow,
  cells,
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
import type { Achievement, BatchStore, DayCounts, Use } from './logic.ts'
import {
  appendEntry, copyBody, goalFailed, harnessResult, marketplaceCandidates, newest, ownedMcpTool, ownedSkill,
  rowDetail, rowTitle,
} from './failures.ts'
import type { Entry } from './failures.ts'

const active = atom({ plugin: 'trophy', key: 'active' } as const, false)
const turnMatched = atom({ plugin: 'trophy', key: 'turnMatched' } as const, [] as string[])
const turnFired = atom({ plugin: 'trophy', key: 'turnFired' } as const, [] as string[])
const turnTyped = atom({ plugin: 'trophy', key: 'turnTyped' } as const, false)
const tab = atom({ plugin: 'trophy', key: 'tab' } as const, 'trophies' as 'trophies' | 'triggers' | 'failures')
const consent = atom({ plugin: 'trophy', key: 'consent' } as const, 'unasked' as 'unasked' | 'yes' | 'no')
const celebrate = atom({ plugin: 'trophy', key: 'celebrate' } as const, null as { ids: string[]; until: number } | null)
const consentVersion = atom({ plugin: 'trophy', key: 'consentVersion' } as const, 0)
// The last `plugin:skill` of this marketplace used or typed; failures recorded since the pane last showed them.
const lastSkill = atom({ plugin: 'trophy', key: 'lastSkill' } as const, '')
const unseen = atom({ plugin: 'trophy', key: 'unseen' } as const, 0)
const lastTitle = atom({ plugin: 'trophy', key: 'lastTitle' } as const, '')
const lang = atom({ plugin: 'trophy', key: 'lang' } as const, 'en' as 'en' | 'ko')

const CARD_MS = 8000
const BAR = 10
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
const TEXT_MAX = 2000

const en = {
  paneTitle: 'Achievements', previewTitle: 'Telemetry preview',
  cmdAchievements: 'Show your skill achievements',
  cmdTelemetry: 'Anonymous usage counts: on, off or status',
  cmdBug: "Report a problem with this marketplace's last skill; the note stays local",
  bugUsage: 'usage: /trophy-bug <note>', bugRecorded: 'Recorded.', bugFailed: 'Could not record the report.',
  paneOpened: 'Achievements pane opened.', unlockedCount: '{done} / {n} unlocked',
  tabTrophies: 'Achievements', tabTriggers: 'Triggers', tabFailures: 'Failures',
  copy: 'Copy', noFailures: 'No failures recorded.',
  headHit: 'Most-hit skills (7 days)', headMiss: 'Most-missed skills (had a trigger phrase, not used)',
  headNever: 'Never-used skills ({n})',
  telemetryUsage: 'usage: /trophy-telemetry on|off|status',
  telemetryReconsent: 'unasked (v1 yes — needs re-consent)',
  consentAsk: '📊 trophy · Send anonymous usage stats?', consentSent: 'Sent: skill names · daily counts · error codes',
  consentNotSent: 'Never sent: prompts · file paths',
  send: 'Send', decline: "Don't send", show: 'Show contents',
  unlockHead: '🏆 Achievement unlocked!', see: 'View',
}

// one table, two languages; the type keeps the keys identical
export const STRINGS: Record<'en' | 'ko', Record<keyof typeof en, string>> = {
  en,
  ko: {
    paneTitle: '업적', previewTitle: '전송 내용 미리보기',
    cmdAchievements: '스킬 업적 보기',
    cmdTelemetry: '익명 사용 통계: on, off, status',
    cmdBug: '이 마켓플레이스의 마지막 스킬 문제 신고 (메모는 로컬에만 저장)',
    bugUsage: '사용법: /trophy-bug <메모>', bugRecorded: '기록했습니다.', bugFailed: '신고를 기록하지 못했습니다.',
    paneOpened: '업적 창을 열었습니다.', unlockedCount: '{done} / {n} 해금',
    tabTrophies: '업적', tabTriggers: '트리거', tabFailures: '실패',
    copy: '복사', noFailures: '기록된 실패가 없습니다.',
    headHit: '가장 많이 맞은 스킬 (7일)', headMiss: '가장 많이 놓친 스킬 (트리거 문구는 있었는데 안 쓴)',
    headNever: '한 번도 안 쓴 스킬 ({n})',
    telemetryUsage: '사용법: /trophy-telemetry on|off|status',
    telemetryReconsent: 'unasked (v1 yes — 재동의 필요)',
    consentAsk: '📊 trophy · 익명 사용 통계를 보낼까요?', consentSent: '보내는 것: 스킬명 · 일별 횟수 · 오류 코드',
    consentNotSent: '보내지 않는 것: 프롬프트 · 파일 경로',
    send: '보내기', decline: '안 보내기', show: '내용 보기',
    unlockHead: '🏆 업적 해금!', see: '보기',
  },
}

const fmt = (text: string | undefined, vars: Record<string, string | number> = {}) =>
  (text ?? '').replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
// An achievement's title and description in the session's language (the top-level fields are English).
const localize = (a: Achievement, l: 'en' | 'ko'): Achievement => (l === 'ko' ? { ...a, ...a.ko } : a)
const str = async ($: EngineInterface, key: keyof typeof en, vars?: Record<string, string | number>) =>
  fmt(STRINGS[await read($, lang)][key], vars)

type Owned = { skills: Record<string, string[]>; servers: Record<string, string[]>; versions: Record<string, string> }

// What this marketplace ships and at which version, read once per session from $.plugin.root; empty when
// unreadable, so no failure is recorded (fails toward privacy). `cc` is Claude Code's release.
let owned: Owned = { skills: {}, servers: {}, versions: {} }
let cc = ''

const readJson = async ($: EngineInterface, path: string) => JSON.parse(await $.fs.read(path))

async function loadOwned($: EngineInterface): Promise<Owned> {
  const out: Owned = { skills: {}, servers: {}, versions: {} }
  const parts = String($.plugin.root).replace(/\/+$/, '').split('/')
  for (const path of marketplaceCandidates($.plugin.root, parts[parts.length - 3])) {
    let plugins: { name: string; version?: unknown; source?: unknown }[]
    try {
      plugins = (await readJson($, path)).plugins
    } catch {
      continue // try the next candidate
    }
    const base = path.slice(0, -'/.claude-plugin/marketplace.json'.length)
    for (const p of plugins) {
      out.skills[p.name] = []
      out.servers[p.name] = []
      if (typeof p.version === 'string') out.versions[p.name] = p.version
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

async function record($: EngineInterface, entry: Omit<Entry, 'ts' | 'day' | 'session' | 'version' | 'cc'>) {
  const ts = await $.clock.now()
  const session = await $.session.id()
  const log = ((await $.store.get('trophy.failures')) ?? []) as Entry[]
  const version = entry.plugin ? owned.versions[entry.plugin] : undefined
  const full: Entry = { ...entry, ts, day: dayOf(ts), session, ...(version ? { version } : {}), ...(cc ? { cc } : {}) }
  await $.store.set('trophy.failures', appendEntry(log, full))
  if (entry.kind === 'bug' || entry.kind === 'outcome') {
    await update($, unseen, n => n + 1)
    await update($, lastTitle, () => rowTitle(full))
  }
}

// Recording a failure never changes what the engine returns: any failure here is swallowed.
const safe = async (work: () => Promise<unknown>) => {
  try {
    await work()
  } catch {}
}

const cut = (v: unknown) => String(v ?? '').slice(0, TEXT_MAX)

const showFailures = async ($: EngineInterface) => {
  await update($, unseen, () => 0)
  await update($, tab, () => 'failures')
  await $.ui.open({ id: PANE, title: await str($, 'paneTitle') })
}

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
    failures: (await get('trophy.failures', [])) as Entry[],
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
    const l = await read($, lang)
    for (const a of achievements.filter(a => fresh.includes(a.id)).map(a => localize(a, l))) {
      $.ui.toast(`🏆 ${a.title} — ${a.description}`)
    }
    // The card lists every unlock of the last few seconds; the timer clears it and redraws the band.
    const until = now + CARD_MS
    await update($, celebrate, card => ({ ids: [...(card && card.until > now ? card.ids : []), ...fresh], until }))
    $.clock.after(CARD_MS, () => {
      void update($, celebrate, card => (card && card.until === until ? null : card))
    })
  }
  await mirror($)
}

export const register: Register = on => {
  // Non-interactive sessions (every `claude -p`, so every teams/graph adapter) stay idle.
  on('session.start', async ($, e, next) => {
    if (!e.isInteractive) return next(e)

    // The stored answer first: until then the band stays hidden, so a yes never flashes the question.
    const savedVersion = (await $.store.get('trophy.consentVersion')) as number | undefined
    // An older yes reads as unasked (the band asks once more); the stored value stays until answered.
    const saved = effectiveConsent((await $.store.get('trophy.consent')) as Consent | undefined, savedVersion)
    await update($, consent, () => saved)
    await update($, consentVersion, () => savedVersion ?? 0)
    await update($, active, () => true)
    await update($, lastSkill, () => '')
    await update($, unseen, () => 0)
    await update($, lastTitle, () => '')
    // Claude Code's own language setting, read once per session, before the commands are described
    const language = ((await $.settings.read().catch(() => ({}))) as { language?: unknown }).language
    await update($, lang, () => (typeof language === 'string' && /^(ko|korean|한국어)/i.test(language) ? 'ko' : 'en'))
    owned = await loadOwned($).catch(() => ({ skills: {}, servers: {}, versions: {} }))
    cc = (await $.session.version().catch(() => undefined))?.base ?? ''
    if ((await $.store.get('trophy.installId')) === undefined) {
      await $.store.set('trophy.installId', crypto.randomUUID())
    }
    await $.command.register({
      name: 'achievements',
      description: await str($, 'cmdAchievements'),
    })
    await $.command.register({
      name: 'trophy-telemetry',
      description: await str($, 'cmdTelemetry'),
      argumentHint: 'on|off|status',
    })
    await $.command.register({
      name: 'trophy-bug',
      description: await str($, 'cmdBug'),
      argumentHint: '<note>',
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

  // Also: the Skill tool answered but the skill did not succeed; remembers the last owned skill.
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    await note($, e.skill)
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
  }).catch(failOpen)

  // An owned skill failed to load, or an owned MCP tool failed. An interrupt is the person's, not a bug.
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
  }).catch(failOpen)

  // The harness engine wrote a final failed subgoal result (local only, never sent).
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const result = await next(e)
    if (e.tool !== 'Write' || !(await read($, active))) return result
    await safe(async () => {
      const r = result as { deny?: string; isError?: boolean }
      if (r.deny !== undefined || r.isError) return
      const hit = harnessResult(e.file_path, e.content)
      if (hit) {
        await record($, { kind: 'outcome', reason: 'subgoal_failed', local: { slug: hit.slug, subgoal: hit.subgoal, path: e.file_path } })
      }
    })
    return result
  }).catch(failOpen)

  // fallback-check.mjs printed the final `COMPLETE <slug> goal-gate FAIL` (local only, never sent).
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
  }).catch(failOpen)

  // `/trophy-bug <note>`: the note stays local; only the code `user_report` can be sent.
  on('command.run', { command: 'trophy-bug' }, async ($, e) => {
    const note = e.args.trim()
    if (!note) return { text: await str($, 'bugUsage') }
    try {
      const hit = ownedSkill(await read($, lastSkill), owned.skills)
      await record($, {
        kind: 'report',
        reason: 'user_report',
        ...(hit ? { plugin: hit.plugin, skill: hit.skill } : {}),
        local: { note: cut(note) },
      })
      return { text: await str($, 'bugRecorded') }
    } catch {
      return { text: await str($, 'bugFailed') }
    }
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
      // Only a name this marketplace ships becomes the last skill; whatever else was typed is never stored.
      const hit = ownedSkill(typed, owned.skills)
      if (hit) await update($, lastSkill, () => `${hit.plugin}:${hit.skill}`)
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
    if ((await read($, tab)) === 'failures') await update($, unseen, () => 0)
    await $.ui.open({ id: PANE, title: await str($, 'paneTitle') })
    return { text: await str($, 'paneOpened') }
  }).catch(failOpen)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const lang$ = await read($, lang)
    const current = await read($, tab)
    const t = (key: keyof typeof en, vars?: Record<string, string | number>) => fmt(STRINGS[lang$][key], vars)
    const unlocked = ((await $.store.get('trophy.unlocked')) ?? {}) as Record<string, string>
    const done = Object.keys(unlocked).length
    const filled = achievements.length === 0 ? 0 : Math.round((done / achievements.length) * BAR)
    const header = (
      <Box borderStyle="round" borderColor="claude">
        <Text key="count" bold>
          {'▰'.repeat(filled)}
          {'▱'.repeat(BAR - filled)} {t('unlockedCount', { done, n: achievements.length })}{' '}
        </Text>
        <Button
          key="tab-trophies"
          label={t('tabTrophies')}
          variant={current === 'trophies' ? 'primary' : undefined}
          onPress={() => update($, tab, () => 'trophies')}
        />
        <Button
          key="tab-triggers"
          label={t('tabTriggers')}
          variant={current === 'triggers' ? 'primary' : undefined}
          onPress={() => update($, tab, () => 'triggers')}
        />
        <Button
          key="tab-failures"
          label={t('tabFailures')}
          variant={current === 'failures' ? 'primary' : undefined}
          onPress={() => showFailures($)}
        />
      </Box>
    )

    if (current === 'failures') {
      const rows = newest(((await $.store.get('trophy.failures')) ?? []) as Entry[])
      return (
        <Box flexDirection="column">
          {header}
          {rows.length === 0 && <Text dimColor>{t('noFailures')}</Text>}
          {rows.map((r, i) => (
            <Box key={`fail-${i}`} flexDirection="column" borderStyle="round" borderColor="error" borderDimColor paddingX={1}>
              <Box justifyContent="space-between" gap={1}>
                <Box flexShrink={1}>
                  <Text color="error">✘ </Text>
                  <Text wrap="truncate-end">{rowTitle(r)}</Text>
                </Box>
                <Box flexShrink={0}>
                  <Button
                    key={`copy-${i}`}
                    label={t('copy')}
                    onPress={press => {
                      void $.ui.copy({ text: copyBody(r), surface: press.surface }).catch(() => {})
                    }}
                  />
                </Box>
              </Box>
              {rowDetail(r).map((line, j) => <Text key={`d-${i}-${j}`} dimColor>{line}</Text>)}
            </Box>
          ))}
        </Box>
      )
    }

    if (current === 'triggers') {
      const counts = ((await $.store.get('trophy.triggers')) ?? {}) as DayCounts
      const lists = triggerLists(sumDays(counts, dayOf(await $.clock.now()), 7), triggers)
      const never = lists.never.slice(0, 5).join(', ')
      return (
        <Box flexDirection="column">
          {header}
          <Text bold color="success">{t('headHit')}</Text>
          {lists.hit.map(([skill, n]) => (
            <Text key={`hit-${skill}`}>{skill} · {n}</Text>
          ))}
          <Text bold color="warning">{t('headMiss')}</Text>
          {lists.miss.map(([skill, n]) => (
            <Text key={`miss-${skill}`}>{skill} · {n}</Text>
          ))}
          <Text bold color="subtle">{t('headNever', { n: lists.never.length })}</Text>
          <Text dimColor wrap="truncate-end">{never}</Text>
        </Box>
      )
    }

    const uses = ((await $.store.get('trophy.uses')) ?? []) as Use[]
    return (
      <Box flexDirection="column">
        {header}
        {achievements.map(a => (
          <Box key={`row-${a.id}`} gap={1}>
            {unlocked[a.id] ? (
              <Text key="mark" color="success">✔</Text>
            ) : (
              <Text key="mark" dimColor>○</Text>
            )}
            <Text key="row" wrap="truncate-end">{achievementRow(localize(a, lang$), uses, unlocked[a.id], false)}</Text>
            {unlocked[a.id] || a.hidden ? null : (
              <Text key="bar" color="claude" wrap="truncate-end">{cells(a, uses)}</Text>
            )}
          </Box>
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
      return { text: `trophy telemetry: ${old ? await str($, 'telemetryReconsent') : now === 'yes' ? `yes (v${CONSENT_VERSION})` : now}` }
    }
    return { text: await str($, 'telemetryUsage') }
  }).catch(failOpen)

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, active))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const lang$ = await read($, lang)
    const t = (key: keyof typeof en) => STRINGS[lang$][key]
    const asking = (await read($, consent)) === 'unasked'
    const card = await read($, celebrate)
    const shown = card && card.until > (await $.clock.now()) ? achievements.filter(a => card.ids.includes(a.id)).map(a => localize(a, lang$)) : []
    const failed = await read($, unseen)
    if (!asking && shown.length === 0 && failed === 0) return next(e)

    const mine = (
      <Box flexDirection="column">
        {asking ? (
          // a question, not a notice: a double frame, every line in full, three buttons drawn alike (no nudge to yes)
          <Box key="consent" flexDirection="column" borderStyle="double" borderColor="warning" paddingX={1}>
            <Text bold color="warning">{t('consentAsk')}</Text>
            <Text>{`   ${t('consentSent')}`}</Text>
            <Text>{`   ${t('consentNotSent')}`}</Text>
            <Box marginTop={1} marginLeft={3} columnGap={3}>
              <Button key="send" label={t('send')} onPress={() => setConsent($, 'yes')} />
              <Button key="decline" label={t('decline')} onPress={() => setConsent($, 'no')} />
              <Button key="show" label={t('show')} onPress={() => $.ui.open({ id: BATCH_PANE, title: t('previewTitle') })} />
            </Box>
          </Box>
        ) : null}
        {shown.length > 0 ? (
          <Box key="celebrate" borderStyle="round" borderColor="#d4a017" flexDirection="column" paddingX={1}>
            <Text key="head" bold color="#d4a017">{t('unlockHead')}</Text>
            {shown.map(a => (
              <Text key={`card-${a.id}`} wrap="truncate-end">
                <Text bold>{a.title}</Text> — {a.description}
              </Text>
            ))}
          </Box>
        ) : null}
        {failed > 0 ? (
          <Box key="failed" gap={1}>
            <Box flexShrink={0}><Text color="error" bold>{`✘ ${failed}`}</Text></Box>
            <Box flexShrink={0}><Text dimColor>trophy</Text></Box>
            <Box flexShrink={1}><Text wrap="truncate-end">{await read($, lastTitle)}</Text></Box>
            <Box flexShrink={0}><Button key="see" label={t('see')} onPress={() => showFailures($)} /></Box>
          </Box>
        ) : null}
      </Box>
    )
    return (
      <Box flexDirection="column">
        {mine}
        {await next(e)}
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
        <Box borderStyle="round" borderDimColor>
          <Text>{JSON.stringify(body, null, 2)}</Text>
        </Box>
      </Box>
    )
  }).catch(failOpen)
}
