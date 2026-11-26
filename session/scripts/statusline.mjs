// Status line command: reads the engine's JSON on stdin, prints one line, never throws.
// Only child process is git; no jq.
import { readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { render } from './statusline-logic.mjs'

function readInput() {
  try {
    const v = JSON.parse(readFileSync(0, 'utf8'))
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

function gitBranch(input) {
  try {
    const cwd = input.workspace?.current_dir ?? input.cwd
    if (typeof cwd !== 'string' || !cwd || !statSync(cwd).isDirectory()) return ''
    return execFileSync('git', ['-C', cwd, '--no-optional-locks', 'symbolic-ref', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).replace(/\n+$/, '')
  } catch {
    return ''
  }
}

try {
  const input = readInput()
  process.stdout.write(render(input, { now: new Date(), branch: gitBranch(input) }))
} catch {
  process.stdout.write(render({}))
}
