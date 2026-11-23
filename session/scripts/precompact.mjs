#!/usr/bin/env node
// PreCompact command hook: where the session.compact mod hook is skipped (an org policy), the engine's own
// auto-compact still writes smart-compact's handoff. Reads the PreCompact JSON on stdin and prints the handoff
// sections as plain text, which the engine appends to the compaction's custom instructions (exit 0), or prints
// nothing. Always exits 0: exit 2 would block the compaction.
import { precompactInstructions } from './precompact-logic.mjs'

let raw = ''
try {
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) raw += chunk
} catch {}
let input = {}
try {
  input = JSON.parse(raw)
} catch {}
const out = precompactInstructions(input, process.env)
if (out) process.stdout.write(out)
process.exitCode = 0
