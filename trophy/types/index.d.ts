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
      tab: 'trophies' | 'triggers' | 'failures'
      // last `plugin:skill` of this marketplace used or typed this session; '' when none
      lastSkill: string
      // failures recorded since the failures tab was last shown, and the newest one's title
      unseen: number
      lastTitle: string
      // any achievement unlocked yet (stored or this session): the consent question waits for it
      anyUnlocked: boolean
      // UI language, from Claude Code's `language` setting
      lang: 'en' | 'ko'
    }
  }
}
