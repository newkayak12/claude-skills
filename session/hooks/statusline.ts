import type { On, PluginOptions } from 'claude-code'

type Settings = Readonly<Record<string, unknown>>
type Layer = { source: string; settings: Settings }
type ReadEvent = { source?: string; layers: readonly Layer[] }

// pluginConfigs key: --plugin-dir gives `session@inline` (or bare `session`), a marketplace install `session@<marketplace>`.
const isSessionKey = (key: string) => key === 'session' || key.startsWith('session@')

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// Highest-precedence layer that sets status_line decides; layers run lowest precedence first.
const toggleOff = (layers: readonly Layer[]): boolean => {
  for (let i = layers.length - 1; i >= 0; i--) {
    const configs = layers[i]!.settings.pluginConfigs
    if (!isRecord(configs)) continue
    let seen: unknown
    for (const [key, cfg] of Object.entries(configs)) {
      if (!isSessionKey(key) || !isRecord(cfg) || !isRecord(cfg.options)) continue
      if (typeof cfg.options.status_line === 'boolean') seen = seen === false ? false : cfg.options.status_line
    }
    if (typeof seen === 'boolean') return seen === false
  }
  return false
}

// A function of the layers and next's value only (the settings.read law): the toggle is never read from register()'s options.
export const withStatusLine = (settings: Settings, layers: readonly Layer[], root: string): Settings => {
  if (layers.some(l => isRecord(l.settings) && 'statusLine' in l.settings)) return settings
  if ('statusLine' in settings || toggleOff(layers)) return settings
  return { ...settings, statusLine: { type: 'command', command: `node "${root}/scripts/statusline.mjs"` } }
}

export const settingsRead = async (root: () => string, e: ReadEvent, next: (e: never) => Promise<Settings>): Promise<Settings> => {
  const settings = await next(e as never)
  if (e.source !== undefined) return settings
  try {
    return withStatusLine(settings, e.layers, root())
  } catch {
    return settings
  }
}

export const register = (on: On, _options: PluginOptions) => {
  on('settings.read', ($, e, next) => settingsRead(() => $.plugin.root, e as never, next as never) as never).catch(($, e, next) => next(e))
}
