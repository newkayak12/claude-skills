#!/usr/bin/env node
// PreCompact command hook: where the session.compact mod hook is skipped (an org policy), the engine's own
// auto-compact still writes smart-compact's handoff. Reads the PreCompact JSON on stdin and prints the handoff
// sections as plain text, which the engine appends to the compaction's custom instructions (exit 0), or prints
// nothing. Always exits 0: exit 2 would block the compaction.
// With a fresh bridge file (see precompact-logic.mjs) the stored handoff is printed ahead of the sections. The
// PreCompact stdin field names (session_id, transcript_path, cwd, trigger, custom_instructions) are a default to
// revisit against the engine's types or a live run.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { handoffBridgePath, precompactInstructions } from './precompact-logic.mjs'

// The first bridge file from cwd up through its ancestors; undefined when none, no HOME, or any error.
function readBridge(input, env) {
  try {
    const home = env.HOME
    if (!home || typeof input?.cwd !== 'string' || !input.cwd || typeof input.transcript_path !== 'string') return undefined
    let dir = resolve(input.cwd)
    for (;;) {
      const p = handoffBridgePath(home, dir)
      if (existsSync(p)) {
        const record = JSON.parse(readFileSync(p, 'utf8'))
        const lines = readFileSync(input.transcript_path, 'utf8').split('\n')
        return { record, lines, now: Date.now() }
      }
      const up = dirname(dir)
      if (up === dir) return undefined
      dir = up
    }
  } catch {
    return undefined
  }
}

let raw = ''
try {
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) raw += chunk
} catch {}
let input = {}
try {
  input = JSON.parse(raw)
} catch {}
const out = precompactInstructions(input, process.env, readBridge(input, process.env))
if (out) process.stdout.write(out)
process.exitCode = 0
