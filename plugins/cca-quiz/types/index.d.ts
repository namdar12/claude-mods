export type Score = { right: number; total: number }
export type Current = { id: string; order: number[] }

declare module 'claude-code' {
  interface PluginState {
    'cca-quiz': {
      enabled: boolean
      current: Current | null
      picked: number | null
      score: Score
      deck: string[]
    }
  }
}
