// the shapes of hooks/debate.ts the mod keeps in state (self-contained: the contract may not import)
export type Line = { ts: string; round: number; persona: string; to: string; kind: string; text: string }
export type Option = { id: string; title: string; by: string; pros: number; cons: number; cut: string | null }
export type Debate = {
  lines: Line[]
  personas: string[]
  options: Option[]
  phase: 1 | 2 | 3
  speaking: string | null
  ended: boolean
  result: string | null
  fallback: boolean
}
// what the tick keeps: the newest debate log, summarized
export type Snap = { slug: string; debate: Debate; mtimeMs: number; size: number; live: boolean; fresh: boolean }

declare module 'claude-code' {
  interface PluginState {
    think: {
      snap: Snap | null
      view: 'timeline' | 'options' | 'result'
      filter: string | null
      offset: number
      lang: 'en' | 'ko'
      // slugs whose end card the person dismissed or opened
      seen: string[]
    }
  }
}
