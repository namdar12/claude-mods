export type Diagram = {
  id: string
  title: string
  source: string
  htmlPath: string
  pngPath?: string
  width?: number
  height?: number
  error?: string
  createdAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'mermaid-pane': {
      diagrams: Diagram[]
      index: number
      showSource: boolean
    }
  }
}
