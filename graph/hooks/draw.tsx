/*
 * Drawing kit for mods: stage rail, progress bar, tabs, board.
 * Origin: teams/hooks/mod.tsx (teams 0.46.0). Copied per plugin because a mod imports only its own
 * plugin's files; copies may drift, so change one and diff the other.
 */
export type Mark = 'done' | 'running' | 'pending' | 'failed'

export const MARK: Record<Mark, string> = { done: '✔', running: '●', pending: '○', failed: '✘' }
// the stage rail: a dot per stage, a solid rail up to where the run is, dotted after
export const DOT: Record<Mark, string> = { done: '●', running: '◉', pending: '○', failed: '✘' }
export const TINT: Record<Mark, string> = { done: 'success', running: 'claude', pending: 'inactive', failed: 'error' }

// a key the table lacks formats to ''
export const fmt = (text: string | undefined, vars: Record<string, string | number> = {}) =>
  (text ?? '').replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Claude Code's `language` setting
export const isKorean = (language: unknown) => typeof language === 'string' && /^(ko|korean|한국어)/i.test(language)

// filled cells of a bar `width` wide, clamped to 0..width
export const cells = (done: number, total: number, width: number) =>
  total > 0 ? Math.min(width, Math.max(0, Math.round((width * done) / total))) : 0

// between two stages: solid once the next stage has started, dotted before
export const connector = (nextState: Mark) => (nextState !== 'pending' ? ' ━━ ' : ' ┄┄ ')

// the resolved components from $.ui.resolve(e)
export type Ui = { Box: any; Text: any; Button: any }

export function rail(ui: Ui, stages: { label: string; state: Mark }[]) {
  const { Box, Text } = ui
  return (
    <Box flexWrap="wrap">
      {stages.map((g, i) => {
        const next = stages[i + 1]
        return (
          <Box key={`g${i}`}>
            <Text color={TINT[g.state]} bold={g.state === 'running'}>{`${DOT[g.state]} ${g.label}`}</Text>
            {next !== undefined && (
              <Text color={next.state !== 'pending' ? 'success' : 'inactive'}>{connector(next.state)}</Text>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

export function bar(ui: Ui, done: number, total: number, width: number, suffix?: string) {
  const { Box, Text } = ui
  const filled = cells(done, total, width)
  return (
    <Box>
      <Text color="success">{'━'.repeat(filled)}</Text>
      <Text color="inactive">{'─'.repeat(width - filled)}</Text>
      {suffix !== undefined && <Text bold>{`  ${suffix}`}</Text>}
    </Box>
  )
}

// plain tabs with hotkeys 1-9: the selected one in full strength with a dot, the rest dim
export function tabs(ui: Ui, items: { key: string; label: string }[], current: string, onPick: (key: string) => void) {
  const { Box, Button } = ui
  return (
    <Box columnGap={3}>
      {items.map((one, i) => (
        <Button key={one.key} plain hotkey={String(i + 1)} dimColor={current !== one.key}
          label={`${current === one.key ? '● ' : ''}${one.label}`} onPress={() => onPick(one.key)} />
      ))}
    </Box>
  )
}

// columns of bordered cards, each with a count in its title
export function board<T>(
  ui: Ui,
  cols: { label: string; tint: string; items: T[] }[],
  render: (item: T, i: number) => unknown,
) {
  const { Box, Text } = ui
  const width = `${Math.floor(100 / Math.max(cols.length, 1))}%`
  return (
    <Box>
      {cols.map(col => (
        <Box key={col.label} flexDirection="column" width={width} borderStyle="round" borderColor={col.tint} paddingX={1}>
          <Text bold color={col.tint}>{`${col.label} ${col.items.length}`}</Text>
          {col.items.map(render)}
        </Box>
      ))}
    </Box>
  )
}
