declare module 'claude-code' {
  interface PluginState {
    trophy: {
      active: boolean
      turnMatched: string[]
      turnFired: string[]
      turnTyped: boolean
      consent: 'unasked' | 'yes' | 'no'
      consentVersion: number
      celebrate: { ids: string[]; until: number } | null
      tab: 'trophies' | 'triggers'
    }
  }
}
