import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enabledPlugins, stale } from './sync-codex.mjs'

const TOML = `[marketplaces.newkayak12-claude-skills]
source = "/x"

[plugins."teams@newkayak12-claude-skills"]
enabled = true

[plugins."graph@newkayak12-claude-skills"]
enabled = false

[plugins."visualize@openai-bundled"]
enabled = true

[plugins."harness@newkayak12-claude-skills"]
enabled = true
`

test('enabled plugins of this marketplace only', () => {
  assert.deepEqual(enabledPlugins(TOML, 'newkayak12-claude-skills'), ['teams', 'harness'])
})

test('stale when the repo version is not cached; unknown repo version skipped', () => {
  const repo = { teams: '0.56.0', harness: '1.36.0', gone: undefined }
  const cache = { teams: ['0.55.0'], harness: ['1.36.0'], gone: [] }
  assert.deepEqual(stale(['teams', 'harness', 'gone'], p => repo[p], p => cache[p]), ['teams'])
})
