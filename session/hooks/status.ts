// The plugin owns one status line; the running task, the claude -p child count, the guard denial count and the cost share it.
// Pure: callers pass the result to $.ui.status themselves ($ never crosses an import).
const parts = { orphans: 0, denied: 0, task: '', cost: '' }

export function statusLine(patch: Partial<typeof parts>): string | undefined {
  Object.assign(parts, patch)
  const shown = [
    parts.task,
    parts.orphans > 0 ? `⧗ ${parts.orphans} claude -p child(ren) running` : '',
    parts.denied > 0 ? `guard: ${parts.denied} denied` : '',
    parts.cost,
  ].filter(Boolean)
  return shown.length > 0 ? shown.join(' · ') : undefined
}

export const deniedCount = () => parts.denied

// `$1.23 · 5h 42%`: the session's cost and the highest rate-limit use, '' when neither is known.
export function costText(usd: number | undefined, limits: readonly { kind: string; percentUsed: number }[]): string {
  const top = [...limits].sort((a, b) => b.percentUsed - a.percentUsed)[0]
  return [usd === undefined ? '' : `$${usd.toFixed(2)}`, top ? `${top.kind} ${Math.round(top.percentUsed)}%` : ''].filter(Boolean).join(' · ')
}
