import { test, expect } from 'claude-code/testing'

import { confirmMatrix, guardWorld, PASSED, passes } from './testkit.ts'

const w = (file_path: string) => ({ tool: 'Write', file_path, content: 'x' })

confirmMatrix('SC-1', w('/proj/.env'))
confirmMatrix('SC-2', w('/proj/app/.env.production'))
confirmMatrix('SC-3', w('~/.aws/credentials'))
confirmMatrix('SC-4', w('/proj/deploy.pem'))
confirmMatrix('SC-5', { tool: 'Edit', file_path: '/home/me/.ssh/id_ed25519', old_string: 'a', new_string: 'b' })

test('SC-6 an extra glob', { options: { guard_secret_paths: 'secrets/**' } }, async ($, on) => {
  const seen = guardWorld(on, { answer: 'Cancel' })
  expect(await $.tool.call(w('/proj/secrets/a/b.txt') as never)).not.toEqual(PASSED)
  expect(seen.asks).toHaveLength(1)
})

test('SC-7 a private key header in docs/x.md passes: path-only', async ($, on) => {
  const seen = guardWorld(on)
  const content = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'
  expect(await $.tool.call({ tool: 'Write', file_path: '/proj/docs/x.md', content } as never)).toEqual(PASSED)
  expect(seen.asks).toEqual([])
})

passes('SC-8 .env.example', w('/proj/.env.example'))
passes('SC-9 .env.sample', w('/proj/.env.sample'))
passes('SC-10 .env.template', w('/proj/.env.template'))
passes('SC-11 docs/env.md', w('/proj/docs/env.md'))
passes('SC-12 environment.ts', w('/proj/src/environment.ts'))
passes('SC-13 notes edit', { tool: 'Edit', file_path: '/proj/notes.md', old_string: 'a', new_string: 'b' })
