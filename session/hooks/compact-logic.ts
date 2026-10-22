// Pure decisions of smart-compact; compact.tsx renders and acts on what these return.

export type CompactState = { isRunning: boolean; agentId?: string; surfaces: number }
export type CompactDecision = 'below' | 'run' | 'skipped:running' | 'skipped:agent' | 'skipped:headless'

// At or above the threshold runs; a sub-agent, a run in flight and a headless session never do.
export const shouldCompactNow = (percent: number, threshold: number, state: CompactState): CompactDecision => {
  if (state.agentId) return 'skipped:agent'
  if (state.isRunning) return 'skipped:running'
  if (state.surfaces <= 0) return 'skipped:headless'
  return percent < threshold ? 'below' : 'run'
}

export const firstLine = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).split('\n')[0]!

export const compactFailed = (err: unknown): string => `compact-failed:${firstLine(err)}`

export const FINAL_TRIES = 3

// compact rejects while a turn runs: wait until the turn has ended, then a bounded number of final tries.
export type RetryStep = 'wait' | 'try' | 'fail'

export const compactRetry = (turnEnded: boolean, finalTries: number, lastError?: unknown): RetryStep => {
  if (!turnEnded) return 'wait'
  if (lastError === undefined || finalTries < FINAL_TRIES) return 'try'
  return 'fail'
}
