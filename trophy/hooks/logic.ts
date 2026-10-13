// Pure functions of the trophy module: no `$`, no store, no clock.

import { failureEvents, ownedMcpTool } from './failures.ts'
import type { Entry } from './failures.ts'

export type Use = { skill: string; plugin: string; day: string; session: string; ts: number }

export type Rule =
  | { kind: 'first_use'; plugin: string }
  | { kind: 'collect'; count: number; plugin?: string }
  | { kind: 'combo'; sequence: string[] }
  | { kind: 'streak'; days: number }
  | { kind: 'repeat'; skill: string; count: number }

export type Achievement = {
  id: string
  title: string
  description: string
  ko: { title: string; description: string }
  hidden?: true
  rule: Rule
}

export type TriggerEntry = { skill: string; plugin: string; phrases: string[] }

export const MAX_USES = 5000
const DUPLICATE_MS = 5000

export const dayOf = (ts: number) => new Date(ts).toISOString().slice(0, 10)

// `plugin:skill` of this marketplace stays; a bare name maps through the index (two owners: kept bare, no plugin).
export function resolveSkill(name: string, index: readonly TriggerEntry[]): { skill: string; plugin: string } | null {
  if (name.includes(':')) {
    return index.some(t => t.skill === name) ? { skill: name, plugin: name.split(':')[0]! } : null
  }
  const owners = index.filter(t => t.skill.endsWith(`:${name}`))
  if (owners.length === 0) return null
  if (owners.length === 1) return { skill: owners[0]!.skill, plugin: owners[0]!.plugin }
  return { skill: name, plugin: '' }
}

// The Skill tool, skill.prompt and the typed command all report one use: same skill, same session, within 5 s is one.
// The command a prompt typed, raw (`/think:grill …`) or as the engine expands it (`<command-name>/think:grill</command-name>`).
export function typedCommand(text: string): string | undefined {
  return (/^\s*\/(\S+)/.exec(text) ?? /<command-name>\/([^<\s]+)<\/command-name>/.exec(text))?.[1]
}

export function recordUse(uses: readonly Use[], skill: string, now: number, session: string): Use[] {
  const last = uses[uses.length - 1]
  if (last && last.skill === skill && last.session === session && now - last.ts < DUPLICATE_MS) return [...uses]
  const plugin = skill.includes(':') ? skill.split(':')[0]! : ''
  return [...uses, { skill, plugin, day: dayOf(now), session, ts: now }].slice(-MAX_USES)
}

const distinct = (uses: readonly Use[], plugin?: string) =>
  new Set(uses.filter(u => plugin === undefined || u.plugin === plugin).map(u => u.skill)).size

// How many of a combo's skills appear in order inside one session; the best session counts.
function comboSteps(uses: readonly Use[], sequence: readonly string[]) {
  const sessions = new Map<string, Use[]>()
  for (const u of uses) sessions.set(u.session, [...(sessions.get(u.session) ?? []), u])
  let best = 0
  for (const list of sessions.values()) {
    let step = 0
    for (const u of [...list].sort((a, b) => a.ts - b.ts)) if (u.skill === sequence[step]) step += 1
    best = Math.max(best, step)
  }
  return best
}

function longestStreak(uses: readonly Use[]) {
  const days = [...new Set(uses.map(u => Date.parse(u.day) / 86_400_000))].sort((a, b) => a - b)
  let best = 0
  let run = 0
  days.forEach((d, i) => {
    run = i > 0 && d - days[i - 1]! === 1 ? run + 1 : 1
    best = Math.max(best, run)
  })
  return best
}

// [have, need] for one achievement; the pane draws it and evaluate compares it.
export function progress(uses: readonly Use[], { rule }: Achievement): [number, number] {
  switch (rule.kind) {
    case 'first_use':
      return [uses.some(u => u.plugin === rule.plugin) ? 1 : 0, 1]
    case 'collect':
      return [Math.min(distinct(uses, rule.plugin), rule.count), rule.count]
    case 'combo':
      return [comboSteps(uses, rule.sequence), rule.sequence.length]
    case 'streak':
      return [Math.min(longestStreak(uses), rule.days), rule.days]
    case 'repeat':
      return [Math.min(uses.filter(u => u.skill === rule.skill).length, rule.count), rule.count]
  }
}

// Ids newly met: never one already unlocked.
export function evaluate(uses: readonly Use[], catalog: readonly Achievement[], unlocked: Readonly<Record<string, string>>) {
  return catalog
    .filter(a => unlocked[a.id] === undefined)
    .filter(a => {
      const [have, need] = progress(uses, a)
      return have >= need
    })
    .map(a => a.id)
}

// Skills whose trigger phrase appears in a prompt. A typed `/command` is not natural language.
export function matchTriggers(text: string, index: readonly TriggerEntry[]): string[] {
  if (text.trimStart().startsWith('/')) return []
  const lower = text.toLowerCase()
  return index.filter(t => t.phrases.some(p => contains(lower, p))).map(t => t.skill)
}

// A phrase edged by an ASCII letter or digit must not start or end inside a longer word ("done" in "abandoned").
function contains(lower: string, phrase: string): boolean {
  for (let i = lower.indexOf(phrase); i !== -1; i = lower.indexOf(phrase, i + 1)) {
    const before = i > 0 && /[a-z0-9]/.test(lower[i - 1]!) && /[a-z0-9]/.test(phrase[0]!)
    const end = i + phrase.length
    const after = end < lower.length && /[a-z0-9]/.test(lower[end]!) && /[a-z0-9]/.test(phrase[phrase.length - 1]!)
    if (!before && !after) return true
  }
  return false
}

export type TurnResult = { hit: string[]; miss: string[]; unmatched: string[] }

// hit: matched and fired; miss: matched, not fired; unmatched: fired, not matched.
export function closeTurn(matched: readonly string[], fired: readonly string[]): TurnResult {
  return {
    hit: matched.filter(s => fired.includes(s)),
    miss: matched.filter(s => !fired.includes(s)),
    unmatched: [...new Set(fired)].filter(s => !matched.includes(s)),
  }
}

export type Counts = { hit: number; miss: number; unmatched: number }
export type DayCounts = Record<string, Record<string, Counts>>

export function addTurn(counts: DayCounts, day: string, turn: TurnResult): DayCounts {
  const today = { ...counts[day] }
  for (const kind of ['hit', 'miss', 'unmatched'] as const) {
    for (const skill of turn[kind]) {
      today[skill] = { hit: 0, miss: 0, unmatched: 0, ...today[skill] }
      today[skill]![kind] += 1
    }
  }
  return { ...counts, [day]: today }
}

const BAR_CELLS = 5

export function bar(have: number, need: number) {
  const filled = Math.round((have / need) * BAR_CELLS)
  return '▓'.repeat(filled) + '░'.repeat(BAR_CELLS - filled)
}

// The pane's progress: eight ▰▱ cells and have/need.
export function cells(a: Achievement, uses: readonly Use[]) {
  const [have, need] = progress(uses, a)
  const filled = Math.round((have / need) * 8)
  return `${'▰'.repeat(filled)}${'▱'.repeat(8 - filled)} ${have}/${need}`
}

// One row of the achievements list, as the pane and trophy:list draw it; the pane draws its own bar (`withBar` false).
export function achievementRow(a: Achievement, uses: readonly Use[], unlockedOn: string | undefined, withBar = true) {
  if (unlockedOn !== undefined) return `🏆 ${a.title} · ${unlockedOn}`
  if (a.hidden) return '🔒 ???'
  if (!withBar) return `🔒 ${a.title}`
  const [have, need] = progress(uses, a)
  return `🔒 ${a.title}  ${bar(have, need)} ${have}/${need}`
}

// Counts of the last `days` days up to and including `today`, summed per skill.
export function sumDays(counts: DayCounts, today: string, days: number): Record<string, Counts> {
  const from = Date.parse(today) - (days - 1) * 86_400_000
  const sum: Record<string, Counts> = {}
  for (const [day, skills] of Object.entries(counts)) {
    const t = Date.parse(day)
    if (t < from || t > Date.parse(today)) continue
    for (const [skill, c] of Object.entries(skills)) {
      const s = (sum[skill] ??= { hit: 0, miss: 0, unmatched: 0 })
      s.hit += c.hit
      s.miss += c.miss
      s.unmatched += c.unmatched
    }
  }
  return sum
}

export type TriggerLists = { hit: [string, number][]; miss: [string, number][]; never: string[] }

// Most hit, most missed (routing gaps), and skills that never fired in the window.
export function triggerLists(sum: Record<string, Counts>, index: readonly TriggerEntry[], top = 5): TriggerLists {
  const ranked = (kind: 'hit' | 'miss') =>
    Object.entries(sum)
      .filter(([, c]) => c[kind] > 0)
      .sort((a, b) => b[1][kind] - a[1][kind])
      .slice(0, top)
      .map(([skill, c]): [string, number] => [skill, c[kind]])
  return {
    hit: ranked('hit'),
    miss: ranked('miss'),
    never: index.filter(t => !sum[t.skill] || sum[t.skill]!.hit + sum[t.skill]!.unmatched === 0).map(t => t.skill),
  }
}

// What trophy:list reads: no `uses`, no session ids.
export function buildProfile(
  uses: readonly Use[],
  unlocked: Record<string, string>,
  counts: DayCounts,
  catalog: readonly Achievement[],
  index: readonly TriggerEntry[],
  now: number,
) {
  return {
    updated: new Date(now).toISOString(),
    unlocked,
    progress: Object.fromEntries(catalog.map(a => [a.id, progress(uses, a)])),
    triggers7d: triggerLists(sumDays(counts, dayOf(now), 7), index),
  }
}

// Error text may carry paths; keep none of them, and no more than 300 characters.
export function scrub(message: string) {
  return message.replace(/(?<![\w.])(?:[A-Za-z]:\\[^\s'"():;,]*|~?\/[^\s'"():;,]*)/g, '<path>').slice(0, 300)
}

// v1 = the first band text (no version stored); v2 names error codes; v3 adds versions, OS type and run results.
export const CONSENT_VERSION = 3
export type ConsentAnswer = 'unasked' | 'yes' | 'no'

// A yes counts only for the text version it answered; an older yes reads as unasked, a no stays no.
export function effectiveConsent(stored: ConsentAnswer | undefined, version: number | undefined): ConsentAnswer {
  if (stored === 'no') return 'no'
  if (stored === 'yes' && version === CONSENT_VERSION) return 'yes'
  return 'unasked'
}

export const POSTHOG_URL = 'https://us.i.posthog.com/batch/'
// Write-only project token: public by design.
export const POSTHOG_KEY = 'phc_r4NATbMFBZvmQYiJ8MPMJSWHprgbsTkbCddtc6aYAoUg'

export type Activity = Record<string, Record<string, number>>
export type McpCalls = Record<string, Record<string, { ok: number; error: number }>>
export type Outcomes = Record<string, Record<string, number>>
export type Versions = Record<string, Record<string, string>>

export type BatchStore = {
  installId: string
  sentThrough?: string
  uses: readonly Use[]
  triggers: DayCounts
  unlocked: Record<string, string>
  errors: readonly { day: string; message: string }[]
  plugins: Record<string, string[]>
  failures: readonly Entry[]
  versions?: Versions
  activity?: Activity
  mcpCalls?: McpCalls
  outcomes?: Outcomes
}

export type Os = 'darwin' | 'linux' | 'win32' | 'other'

// The engine has no OS API: HOME / USERPROFILE decide a label, and only the label is kept.
export function osOf(home?: string, userprofile?: string): Os {
  if (home) {
    if (home.startsWith('/Users/')) return 'darwin'
    if (home.startsWith('/home/') || home === '/root') return 'linux'
    if (/^[A-Za-z]:[\\/]/.test(home) || /^\/[a-z]\//i.test(home)) return 'win32'
    return 'other'
  }
  return userprofile ? 'win32' : 'other'
}

// The newest `versions` entry on or before `day` that names the plugin.
export function versionOn(versions: Versions, day: string, plugin: string): string | undefined {
  const days = Object.keys(versions).filter(d => d <= day && versions[d]?.[plugin] !== undefined).sort()
  const last = days[days.length - 1]
  return last === undefined ? undefined : versions[last]![plugin]
}

export function addActivity(activity: Activity, day: string, cc: string, os: Os): Activity {
  const key = `${cc}|${os}`
  const today = { ...activity[day] }
  today[key] = (today[key] ?? 0) + 1
  return { ...activity, [day]: today }
}

// Marks the day active without counting a session.
export function markActive(activity: Activity, day: string, cc: string, os: Os): Activity {
  const key = `${cc}|${os}`
  const today = { ...activity[day] }
  today[key] = today[key] ?? 0
  return { ...activity, [day]: today }
}

export function addMcp(calls: McpCalls, day: string, plugin: string, tool: string, kind: 'ok' | 'error'): McpCalls {
  const key = `${plugin}|${tool}`
  const today = { ...calls[day] }
  const cell = { ok: 0, error: 0, ...today[key] }
  cell[kind] += 1
  today[key] = cell
  return { ...calls, [day]: today }
}

// `mcp__plugin_<plugin>_<server>__<tool>` by name only: tool.call carries no provenance.
export function ownedMcpByName(
  name: unknown,
  servers: Readonly<Record<string, readonly string[]>>,
): { plugin: string; server: string; tool: string } | undefined {
  return ownedMcpTool(name, { source: 'plugin' }, servers)
}

const SYSTEMS = ['graph', 'teams', 'harness'] as const
const OUTCOME_KINDS = ['pass', 'reject', 'fail'] as const
export type System = (typeof SYSTEMS)[number]
export type OutcomeKind = (typeof OUTCOME_KINDS)[number]

// A producer's published outcome, reduced to its two fixed labels; anything else is dropped.
export function outcomeOf(value: unknown, system: System): { system: System; outcome: OutcomeKind } | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const v = value as { system?: unknown; outcome?: unknown }
  if (v.system !== system) return undefined
  const outcome = OUTCOME_KINDS.find(o => o === v.outcome)
  return outcome === undefined ? undefined : { system, outcome }
}

export function addOutcome(outcomes: Outcomes, day: string, system: System, outcome: OutcomeKind): Outcomes {
  const key = `${system}|${outcome}`
  const today = { ...outcomes[day] }
  today[key] = (today[key] ?? 0) + 1
  return { ...outcomes, [day]: today }
}

// Required and optional property keys of every event; buildBatch builds each from these names only.
export const EVENT_KEYS: Record<string, { required: string[]; optional: string[] }> = {
  skill_used: { required: ['skill', 'plugin', 'day', 'count'], optional: ['plugin_version'] },
  trigger_result: { required: ['skill', 'day', 'hit', 'miss', 'unmatched'], optional: ['plugin_version'] },
  achievement_unlocked: { required: ['id'], optional: [] },
  plugins_installed: { required: ['plugin', 'day'], optional: [] },
  daily_active: { required: ['day', 'cc_version', 'os', 'sessions'], optional: [] },
  mcp_tool_result: { required: ['day', 'plugin', 'tool', 'ok', 'error'], optional: ['plugin_version'] },
  run_outcome: { required: ['day', 'system', 'outcome', 'count'], optional: [] },
  diag_skill_error: { required: ['skill', 'plugin', 'reason', 'count', 'day'], optional: ['plugin_version', 'cc_version'] },
  diag_mcp_error: { required: ['tool', 'plugin', 'reason', 'count', 'day'], optional: ['plugin_version', 'cc_version'] },
  diag_user_report: { required: ['reason', 'count', 'day'], optional: ['skill', 'plugin', 'plugin_version', 'cc_version'] },
  $exception: { required: ['$exception_message'], optional: [] },
}

// The events of every day after `sentThrough` up to `through`. Only names, days, labels and counts.
export function buildBatch(store: BatchStore, through: string) {
  const inRange = (day: string) => day > (store.sentThrough ?? '') && day <= through
  const versions = store.versions ?? {}
  const withVersion = (day: string, plugin: string) => {
    const v = plugin ? versionOn(versions, day, plugin) : undefined
    return v === undefined ? {} : { plugin_version: v }
  }
  const event = (name: string, day: string, properties: Record<string, unknown>) => ({
    event: name,
    distinct_id: store.installId,
    timestamp: `${day}T12:00:00Z`,
    properties: { ...properties, $process_person_profile: false },
  })
  const batch: ReturnType<typeof event>[] = []

  const used = new Map<string, { day: string; skill: string; plugin: string; count: number }>()
  const pluginsByDay: Record<string, Set<string>> = {}
  for (const [day, list] of Object.entries(store.plugins)) pluginsByDay[day] = new Set(list)
  for (const u of store.uses.filter(u => inRange(u.day))) {
    const row = used.get(`${u.day} ${u.skill}`) ?? { day: u.day, skill: u.skill, plugin: u.plugin, count: 0 }
    used.set(`${u.day} ${u.skill}`, { ...row, count: row.count + 1 })
    if (u.plugin) (pluginsByDay[u.day] ??= new Set()).add(u.plugin)
  }
  for (const r of used.values()) {
    batch.push(event('skill_used', r.day, { skill: r.skill, plugin: r.plugin, day: r.day, count: r.count, ...withVersion(r.day, r.plugin) }))
  }
  for (const [day, skills] of Object.entries(store.triggers).filter(([d]) => inRange(d))) {
    for (const [skill, c] of Object.entries(skills)) {
      batch.push(event('trigger_result', day, {
        skill, day, hit: c.hit, miss: c.miss, unmatched: c.unmatched, ...withVersion(day, skill.split(':')[0]!),
      }))
    }
  }
  for (const [id, day] of Object.entries(store.unlocked).filter(([, d]) => inRange(d))) {
    batch.push(event('achievement_unlocked', day, { id }))
  }
  for (const [day, set] of Object.entries(pluginsByDay).filter(([d]) => inRange(d))) {
    for (const plugin of [...set].sort()) batch.push(event('plugins_installed', day, { plugin, day }))
  }
  for (const [day, cells] of Object.entries(store.activity ?? {}).filter(([d]) => inRange(d))) {
    for (const [key, sessions] of Object.entries(cells)) {
      const i = key.lastIndexOf('|')
      batch.push(event('daily_active', day, { day, cc_version: key.slice(0, i), os: key.slice(i + 1), sessions }))
    }
  }
  for (const [day, cells] of Object.entries(store.mcpCalls ?? {}).filter(([d]) => inRange(d))) {
    for (const [key, c] of Object.entries(cells)) {
      const [plugin = '', tool = ''] = key.split('|')
      batch.push(event('mcp_tool_result', day, { day, plugin, tool, ok: c.ok, error: c.error, ...withVersion(day, plugin) }))
    }
  }
  for (const [day, cells] of Object.entries(store.outcomes ?? {}).filter(([d]) => inRange(d))) {
    for (const [key, count] of Object.entries(cells)) {
      const [system, outcome, ...rest] = key.split('|')
      if (rest.length > 0 || !SYSTEMS.some(s => s === system) || !OUTCOME_KINDS.some(o => o === outcome)) continue
      batch.push(event('run_outcome', day, { day, system, outcome, count }))
    }
  }
  for (const e of store.errors.filter(e => e.day <= through)) {
    batch.push(event('$exception', e.day, { $exception_message: e.message }))
  }
  for (const f of failureEvents(store.failures, store.sentThrough, through)) {
    batch.push(event(f.event, String(f.properties.day), f.properties))
  }
  return { api_key: POSTHOG_KEY, batch }
}
