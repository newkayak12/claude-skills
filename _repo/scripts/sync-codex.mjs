#!/usr/bin/env node
// Keep Codex on this repo's current plugin versions. Codex runs a versioned cache copy
// (~/.codex/plugins/cache/<marketplace>/<plugin>/<version>); `codex plugin add` refreshes it.
// Reinstalls each plugin of this marketplace enabled in ~/.codex/config.toml whose cached
// version differs from the repo manifest. No codex, no config → does nothing.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MKT = 'newkayak12-claude-skills'

// Plugins of `mkt` with `enabled = true` in a codex config.toml.
export function enabledPlugins(toml, mkt) {
  const out = []
  const re = /^\[plugins\."([^"@]+)@([^"]+)"\]\s*\n(?:[^\[]*?)enabled\s*=\s*true/gm
  for (const m of toml.matchAll(re)) if (m[2] === mkt) out.push(m[1])
  return out
}

// Plugins whose cached versions do not include the repo version.
export function stale(plugins, repoVersion, cachedVersions) {
  return plugins.filter(p => {
    const want = repoVersion(p)
    return want !== undefined && !cachedVersions(p).includes(want)
  })
}

function repoVersion(p) {
  for (const dir of ['.codex-plugin', '.claude-plugin']) {
    const f = join(ROOT, p, dir, 'plugin.json')
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')).version
  }
  return undefined
}

function cachedVersions(p) {
  const d = join(homedir(), '.codex', 'plugins', 'cache', MKT, p)
  return existsSync(d) ? readdirSync(d) : []
}

function main() {
  const cfg = join(homedir(), '.codex', 'config.toml')
  if (!existsSync(cfg)) return
  try { execFileSync('codex', ['--version'], { stdio: 'ignore' }) } catch { return }
  const todo = stale(enabledPlugins(readFileSync(cfg, 'utf8'), MKT), repoVersion, cachedVersions)
  for (const p of todo) {
    try {
      execFileSync('codex', ['plugin', 'add', `${p}@${MKT}`], { stdio: 'ignore', timeout: 120000 })
      console.log(`codex: ${p} -> ${repoVersion(p)}`)
    } catch (e) {
      console.log(`codex: ${p} not refreshed (${e.message.split('\n')[0]})`)
    }
  }
  if (todo.length === 0) console.log('codex: plugins current')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
