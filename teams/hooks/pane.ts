/*
 * Pure helpers of the teams pane: which key does what, how a step moves, where the selection goes when
 * its task leaves the list. No engine, no drawing: mod.tsx reads state and calls these.
 */

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

// the text the command answers with. Quiet = the pane was seated and every attached surface carries an Input: the one
// `opened` line, no board. Anything else (a mobile or unknown surface, none attached, an unseated pane, a bad input)
// keeps the board: the run's stdout, else `opened` when the run failed or printed nothing.
export function statusAnswer(
  run: { exitCode: number; stdout: string } | null,
  opened: string,
  surfaces: readonly string[] | null | undefined,
  isPlaced: boolean,
): string {
  const quiet = isPlaced === true && Array.isArray(surfaces) && surfaces.length > 0 && surfaces.every(s => typeof s === 'string' && carriesInput(s))
  if (quiet) return opened
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

// ---- F2 page stack ----

export type PageName = 'HOME' | 'FLOOR' | 'PHASE' | 'STORY' | 'LOG' | 'STORY_REPORT' | 'EPIC_REPORT' | 'ANSWER'
// where the pane is: an EPIC (null on HOME), a STORY (STORY, LOG, STORY_REPORT, ANSWER of a STORY), a Phase 1-6 (PHASE)
export type Page = { name: PageName; epic: string | null; story: string | null; phase: number | null }
export const HOME: Page = { name: 'HOME', epic: null, story: null, phase: null }

// The engine sends F2 labels by their dotted name (F2.log.attemptStart); the table holds f2LogAttemptStart. Other text passes through.
export function f2Key(dotted: string): string {
  if (!dotted.startsWith('F2.')) return dotted
  return 'f2' + dotted.slice(3).split('.').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('')
}

// w s move (scroll on a page of text), d and Enter open, a goes back, n jumps to the next flag, q closes, l is the language.
// Esc is the host's (closeOnEscape) except in answer mode (pageEsc). Letters are text while answering, a `/` holds all keys.
export type PageKey =
  | { kind: 'move'; by: 1 | -1 } | { kind: 'open' } | { kind: 'back' } | { kind: 'nextFlag' } | { kind: 'close' } | { kind: 'lang' } | null

export const PAGE_KEYS: Record<string, Exclude<PageKey, null>> = {
  w: { kind: 'move', by: -1 }, s: { kind: 'move', by: 1 }, d: { kind: 'open' }, '\r': { kind: 'open' }, '\n': { kind: 'open' },
  a: { kind: 'back' }, n: { kind: 'nextFlag' }, q: { kind: 'close' }, l: { kind: 'lang' },
}

export function pageKey(text: unknown, opts?: { answering?: boolean }): PageKey {
  if (typeof text !== 'string' || text === '' || text.includes('/')) return null
  if (opts?.answering === true) return null
  return PAGE_KEYS[[...text].pop()!] ?? null
}

// What a selected row is, so d / Enter know what to open
export type RowRef =
  | { type: 'epic'; epic: string; ended: boolean; unfolded: boolean }
  | { type: 'story'; epic: string; story: string }
  | { type: 'flag'; epic: string; story: string | null; ask: boolean }
  | { type: 'phase'; epic: string; phase: number }
  | { type: 'storyRow'; epic: string; story: string; row: 'log' | 'report' | 'answer' | 'other' }

export type Opened = { kind: 'page'; page: Page } | { kind: 'unfold'; epic: string } | null

const pageOf = (name: PageName, epic: string | null, story: string | null = null, phase: number | null = null): Page => ({ name, epic, story, phase })

// d / Enter on a row. Nothing to open (or no row) is null.
export function openFrom(row: RowRef | null): Opened {
  if (row === null) return null
  switch (row.type) {
    case 'epic':
      if (row.ended && !row.unfolded) return { kind: 'unfold', epic: row.epic }
      return { kind: 'page', page: pageOf('FLOOR', row.epic) }
    case 'story': return { kind: 'page', page: pageOf('STORY', row.epic, row.story) }
    case 'flag':
      if (row.ask) return { kind: 'page', page: pageOf('ANSWER', row.epic, row.story) }
      return { kind: 'page', page: row.story === null ? pageOf('FLOOR', row.epic) : pageOf('STORY', row.epic, row.story) }
    case 'phase': return { kind: 'page', page: row.phase === 6 ? pageOf('EPIC_REPORT', row.epic) : pageOf('PHASE', row.epic, null, row.phase) }
    case 'storyRow':
      if (row.row === 'log') return { kind: 'page', page: pageOf('LOG', row.epic, row.story) }
      if (row.row === 'report') return { kind: 'page', page: pageOf('STORY_REPORT', row.epic, row.story) }
      if (row.row === 'answer') return { kind: 'page', page: pageOf('ANSWER', row.epic, row.story) }
      return null
  }
}

// the `a` target of each page; ANSWER returns to the page it was opened from, HOME has none
export function backOf(p: Page, from: Page | null): Page | null {
  switch (p.name) {
    case 'FLOOR': case 'STORY': return HOME
    case 'PHASE': case 'EPIC_REPORT': return pageOf('FLOOR', p.epic)
    case 'LOG': case 'STORY_REPORT': return pageOf('STORY', p.epic, p.story)
    case 'ANSWER': return from ?? HOME
    default: return null
  }
}

// pages of text scroll with w s; the others move the selected row
export const scrollsPage = (p: Page): boolean => p.name === 'PHASE' || p.name === 'LOG' || p.name === 'STORY_REPORT' || p.name === 'EPIC_REPORT'

// one selection and one scroll offset per level, a level being one page of one EPIC / STORY / Phase
export const levelOf = (p: Page): string => `${p.name}:${p.epic ?? ''}:${p.story ?? ''}:${p.phase ?? ''}`

export type PageNav = {
  page: Page
  from: Page | null // the page ANSWER was opened from
  sel: Record<string, string> // level -> selected row id
  scroll: Record<string, number> // level -> first line shown
  unfolded: Record<string, boolean> // EPIC id -> an ended EPIC is shown open (kept in $.state)
}
export const startNav = (unfolded: Record<string, boolean> = {}): PageNav => ({ page: HOME, from: null, sel: {}, scroll: {}, unfolded })

export type StepCtx = {
  ids: readonly string[] // the rows of the current page, in order
  row: RowRef | null // the selected row
  flags: readonly string[] // HOME's flag-section row ids, in list order across every listed EPIC
  maxScroll: number // last first-line of a scrolled page
  prev?: readonly string[] // the rows of the previous draw, for fallbackSelection
}
export type StepResult = { nav: PageNav; closed: boolean; hint: 'noFlag' | 'draftDropped' | null }

// The selected row id of the current level after a new list: kept, else the nearest listed, else none
export function selectedOf(nav: PageNav, ids: readonly string[], prev: readonly string[] = ids): string | null {
  return ids.length === 0 ? null : fallbackSelection(prev, ids, nav.sel[levelOf(nav.page)] ?? null)
}

// n: the next flag row of HOME's flag section after `current`, wrapping; none listed is null
export function nextFlag(flags: readonly string[], current: string | null): string | null {
  if (flags.length === 0) return null
  const at = current === null ? -1 : flags.indexOf(current)
  return flags[(at + 1) % flags.length]!
}

// the pane's page when its EPIC leaves the listing: HOME with HOME's remembered row, never a stale page
export function reconcileEpic(nav: PageNav, listed: readonly string[]): PageNav {
  const e = nav.page.epic
  return e === null || listed.includes(e) ? nav : { ...nav, page: HOME, from: null }
}

// Esc: in answer mode it cancels the draft and the pane stays; anywhere else the host closes the pane
export function pageEsc(nav: PageNav, dropped = false): StepResult {
  if (nav.page.name !== 'ANSWER') return { nav, closed: true, hint: null }
  return { nav: { ...nav, page: backOf(nav.page, nav.from)!, from: null }, closed: false, hint: dropped ? 'draftDropped' : null }
}

// One key on the current page. `l` is the language (the caller toggles it) and `q` closes; the rest move, open, go back or jump.
export function pageStep(nav: PageNav, key: Exclude<PageKey, null>, ctx: StepCtx): StepResult {
  const stay: StepResult = { nav, closed: false, hint: null }
  const level = levelOf(nav.page)
  switch (key.kind) {
    case 'close': return { nav, closed: true, hint: null }
    case 'lang': return stay
    case 'move': {
      if (scrollsPage(nav.page)) {
        const at = Math.min((nav.scroll[level] ?? 0) + key.by, Math.max(0, ctx.maxScroll))
        return { ...stay, nav: { ...nav, scroll: { ...nav.scroll, [level]: Math.max(0, at) } } }
      }
      const cur = selectedOf(nav, ctx.ids, ctx.prev)
      if (cur === null) return stay
      const id = ctx.ids[stepClamp(ctx.ids.indexOf(cur), key.by, ctx.ids.length)]!
      return { ...stay, nav: { ...nav, sel: { ...nav.sel, [level]: id } } }
    }
    case 'open': {
      const o = openFrom(ctx.row)
      if (o === null) return stay
      if (o.kind === 'unfold') return { ...stay, nav: { ...nav, unfolded: { ...nav.unfolded, [o.epic]: true } } }
      return { ...stay, nav: { ...nav, page: o.page, from: o.page.name === 'ANSWER' ? nav.page : null } }
    }
    case 'back': {
      if (nav.page.name === 'HOME') {
        const r = ctx.row
        const epic = r !== null && (r.type === 'epic' || r.type === 'story') ? r.epic : null
        if (epic === null || nav.unfolded[epic] !== true) return stay
        const { [epic]: _gone, ...rest } = nav.unfolded
        return { ...stay, nav: { ...nav, unfolded: rest } }
      }
      return { ...stay, nav: { ...nav, page: backOf(nav.page, nav.from) ?? HOME, from: null } }
    }
    case 'nextFlag': {
      const home = levelOf(HOME)
      const id = nextFlag(ctx.flags, nav.sel[home] ?? null)
      if (id === null) return { ...stay, hint: 'noFlag' }
      return { nav: { ...nav, page: HOME, from: null, sel: { ...nav.sel, [home]: id } }, closed: false, hint: null }
    }
  }
}
