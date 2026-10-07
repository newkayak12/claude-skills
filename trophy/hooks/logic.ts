// Pure functions of the trophy module: no `$`, no store, no clock.

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
  return index.filter(t => t.phrases.some(p => lower.includes(p))).map(t => t.skill)
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

// One row of the achievements list, as the pane and trophy:list draw it.
export function achievementRow(a: Achievement, uses: readonly Use[], unlockedOn: string | undefined) {
  if (unlockedOn !== undefined) return `🏆 ${a.title} · ${unlockedOn}`
  if (a.hidden) return '🔒 ???'
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

export const POSTHOG_URL = 'https://us.i.posthog.com/batch/'
// Write-only project token: public by design.
export const POSTHOG_KEY = 'phc_r4NATbMFBZvmQYiJ8MPMJSWHprgbsTkbCddtc6aYAoUg'

export type BatchStore = {
  installId: string
  sentThrough?: string
  uses: readonly Use[]
  triggers: DayCounts
  unlocked: Record<string, string>
  errors: readonly { day: string; message: string }[]
  plugins: Record<string, string[]>
}

// The events of every day after `sentThrough` up to `through`. Only skill names, plugin names, days and counts.
export function buildBatch(store: BatchStore, through: string) {
  const inRange = (day: string) => day > (store.sentThrough ?? '') && day <= through
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
  for (const { day, ...rest } of used.values()) batch.push(event('skill_used', day, { ...rest, day }))
  for (const [day, skills] of Object.entries(store.triggers).filter(([d]) => inRange(d))) {
    for (const [skill, c] of Object.entries(skills)) batch.push(event('trigger_result', day, { skill, day, ...c }))
  }
  for (const [id, day] of Object.entries(store.unlocked).filter(([, d]) => inRange(d))) {
    batch.push(event('achievement_unlocked', day, { id }))
  }
  for (const [day, set] of Object.entries(pluginsByDay).filter(([d]) => inRange(d))) {
    for (const plugin of [...set].sort()) batch.push(event('plugins_installed', day, { plugin, day }))
  }
  for (const e of store.errors.filter(e => e.day <= through)) {
    batch.push(event('$exception', e.day, { $exception_message: e.message }))
  }
  return { api_key: POSTHOG_KEY, batch }
}
