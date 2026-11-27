// Pure decisions for statusline-install.mjs: no fs, no process, no child processes.
import { resolve, join } from 'node:path'

export const MODES = ['show', 'on', 'off']
export const USAGE = 'usage: statusline-install.mjs [show|on|off] [--replace] [--data <dir>] [--settings <file>]'
export const BLOCKED_LINE = 'your own statusLine is set; rerun with --replace only after the person agrees'

// argv (without node and script) -> { mode, replace, data, settings } or { error }
export function parseArgs(argv) {
  const out = { mode: null, replace: false, data: undefined, settings: undefined }
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i])
    if (a === '--replace') out.replace = true
    else if (a === '--data' || a === '--settings') {
      if (i + 1 >= argv.length) return { error: `${a} needs a value` }
      out[a.slice(2)] = String(argv[++i])
    } else if (a.startsWith('--data=')) out.data = a.slice(7)
    else if (a.startsWith('--settings=')) out.settings = a.slice(11)
    else if (a.startsWith('--')) return { error: `unknown option ${a}` }
    else {
      const w = a.trim().toLowerCase()
      if (!w) continue
      if (!MODES.includes(w)) return { error: `unknown mode "${a}"` }
      if (out.mode) return { error: `two mode words: ${out.mode} and ${w}` }
      out.mode = w
    }
  }
  out.mode ??= 'show'
  return out
}

export function configDir(env, home) {
  return env?.CLAUDE_CONFIG_DIR ? env.CLAUDE_CONFIG_DIR : join(home, '.claude')
}

export function settingsPath(env, home) {
  return join(configDir(env, home), 'settings.json')
}

export function normalizeDir(dir) {
  return resolve(dir)
}

const CACHE_SCRIPT = /^(.*)\/plugins\/cache\/([^/]+)\/session\/[^/]+\/scripts\//

// -> { dir, source: 'given'|'derived-cache'|'derived-inline' } or { error }
export function dataDirFrom({ data, scriptPath, env, home }) {
  if (typeof data === 'string' && data && !data.startsWith('${') && data.startsWith('/')) {
    const dir = normalizeDir(data)
    if (`${dir}/`.includes('/plugins/cache/')) {
      return { error: `data dir ${dir} is inside a plugin cache (changes on every update); pass a stable --data` }
    }
    return { dir, source: 'given' }
  }
  const m = CACHE_SCRIPT.exec(String(scriptPath ?? ''))
  if (m) return { dir: join(m[1], 'plugins', 'data', `session-${m[2]}`), source: 'derived-cache' }
  return { dir: join(configDir(env, home), 'plugins', 'data', 'session-inline'), source: 'derived-inline' }
}

export function scriptIn(dir) {
  return join(dir, 'statusline', 'statusline.mjs')
}

export function commandFor(dir) {
  return `node "${scriptIn(dir)}"`
}

// the path of `node <path>` / `node "<path>"` (one argument, nothing else), else null
function pathOf(command) {
  const m = /^node (?:"([^"]+)"|([^\s"]+))$/.exec(String(command ?? ''))
  return m ? resolve(m[1] ?? m[2]) : null
}

// command: our command; alt: other accepted spellings of it (strings)
export function isOurs(statusLine, command, alt = []) {
  if (!statusLine || typeof statusLine !== 'object' || statusLine.type !== 'command') return false
  const p = pathOf(statusLine.command)
  return p !== null && [command, ...alt].some(c => pathOf(c) === p)
}

export function serialize(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`
}

// -> { action, current, next, exit }; next is the settings object after the change
// (for show: what `on` would write). Never mutates settings.
export function decide(settings, command, { mode, replace = false, alt = [] } = {}) {
  const current = settings?.statusLine ?? null
  const ours = { type: 'command', command }
  const none = current === null
  const mine = isOurs(current, command, alt)
  const done = (action, next, exit = 0) => ({ action, current, next, exit })
  if (mode === 'show') return done('show', mine ? settings : { ...settings, statusLine: ours })
  if (mode === 'on') {
    if (none) return done('add', { ...settings, statusLine: ours })
    if (mine) return done('refresh', settings)
    if (!replace) return done('blocked', settings, 3)
    return done('replace', { ...settings, statusLine: ours })
  }
  if (mode === 'off') {
    if (mine) {
      const { statusLine, ...rest } = settings
      return done('remove', rest)
    }
    return done(none ? 'absent' : 'foreign-kept', settings)
  }
  return done('invalid', settings, 2)
}
