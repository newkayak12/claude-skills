// The plugin owns one status line; the claude -p child count and the guard denial count share it.
// Pure: callers pass the result to $.ui.status themselves ($ never crosses an import).
const parts = { orphans: 0, denied: 0 }

export function statusLine(patch: Partial<typeof parts>): string | undefined {
  Object.assign(parts, patch)
  const shown = [
    parts.orphans > 0 ? `⧗ ${parts.orphans} claude -p child(ren) running` : '',
    parts.denied > 0 ? `guard: ${parts.denied} denied` : '',
  ].filter(Boolean)
  return shown.length > 0 ? shown.join(' · ') : undefined
}

export const deniedCount = () => parts.denied
