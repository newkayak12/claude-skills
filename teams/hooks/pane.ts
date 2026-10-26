/*
 * Pure helpers of the teams pane: which key does what, how a step moves, where the selection goes when
 * its task leaves the list. No engine, no drawing: mod.tsx reads state and calls these.
 */

export type PaneTabKey = 'dash' | 'floor' | 'stories' | 'decisions' | 'log' | 'report'
const KEY_TABS: Record<string, PaneTabKey> = { '0': 'dash', '1': 'floor', '2': 'stories', '3': 'decisions', '4': 'log', '5': 'report' }

// `[` / `]` step the EPIC, `j` / `k` the STORY row, `g` opens the row's run, `0`-`5` pick a tab, `q` closes. The pane's
// Input holds the focus, so these keys reach it as text, never a Button hotkey. Text holding a `/` is a slash command
// being typed (`/teams-status`): held, no key fires until submit (paneSlash). Any other text, none, or a non-string is no key.
export type PaneKey =
  | { kind: 'step'; by: 1 | -1 } | { kind: 'row'; by: 1 | -1 } | { kind: 'open' } | { kind: 'tab'; tab: PaneTabKey } | { kind: 'close' } | null

export function paneKey(text: unknown): PaneKey {
  if (typeof text !== 'string' || text === '' || text.includes('/')) return null
  const k = [...text].pop()!
  if (k === 'q') return { kind: 'close' }
  const tab = KEY_TABS[k]
  if (tab !== undefined) return { kind: 'tab', tab }
  if (k === ']') return { kind: 'step', by: 1 }
  if (k === '[') return { kind: 'step', by: -1 }
  if (k === 'j') return { kind: 'row', by: 1 }
  if (k === 'k') return { kind: 'row', by: -1 }
  if (k === 'g') return { kind: 'open' }
  return null
}

// A slash command typed into the pane's Input and submitted. The buffer may start with earlier key presses, so the
// command starts at the first `/`. `/teams-status` closes the pane (the command again toggles); `/name args` runs that
// command; anything else is dropped.
export type PaneSlash = { kind: 'close' } | { kind: 'run'; command: string; args: string } | null

export function paneSlash(text: unknown): PaneSlash {
  if (typeof text !== 'string') return null
  const at = text.indexOf('/')
  if (at < 0) return null
  const m = /^\/([^\s/]+)\s*(.*)$/.exec(text.slice(at).trim())
  if (m === null) return null
  return m[1] === 'teams-status' ? { kind: 'close' } : { kind: 'run', command: m[1]!, args: m[2]! }
}

// the surfaces that carry an Input; the others (mobile) keep the footer's Buttons only
export function carriesInput(surface: string): boolean {
  return surface === 'terminal' || surface === 'desktop' || surface === 'vscode'
}

// the text the command answers with: the run's stdout, else `opened` when the run failed or printed nothing
export function statusAnswer(run: { exitCode: number; stdout: string } | null, opened: string): string {
  return run === null || run.exitCode !== 0 || run.stdout.trim() === '' ? opened : run.stdout
}

// one step inside 0..count-1: it stops at the ends, never wraps
export function stepClamp(index: number, by: number, count: number): number {
  if (count <= 0) return 0
  return Math.min(count - 1, Math.max(0, index + by))
}

// The selected id after a new list arrives. Still listed: it stays. Gone: the nearest id of the previous list that
// is still listed (the later one first on a tie), else the first listed. Nothing selected yet: the first listed.
export function fallbackSelection(previous: readonly string[], ids: readonly string[], selected: string | null): string | null {
  if (ids.length === 0) return selected
  if (selected !== null && ids.includes(selected)) return selected
  const at = selected === null ? -1 : previous.indexOf(selected)
  if (at >= 0) {
    for (let d = 1; d < previous.length; d += 1) {
      for (const i of [at + d, at - d]) {
        const id = previous[i]
        if (id !== undefined && ids.includes(id)) return id
      }
    }
  }
  return ids[0]!
}

// the ⚑ ask band is drawn while an ask is addressed to this session and no end-of-run card replaces it
export function askBandShown(asks: readonly unknown[] | undefined, cardShown: boolean): boolean {
  return (asks?.length ?? 0) > 0 && !cardShown
}

// the STORY rows of every listed task, in list order, each with the task it belongs to
export function storyRows<T extends { items: readonly I[] }, I>(tasks: readonly T[]): { entry: T; item: I }[] {
  return tasks.flatMap(entry => entry.items.map(item => ({ entry, item })))
}
