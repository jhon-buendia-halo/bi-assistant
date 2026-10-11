export type Step = {
  number: number
  title: string
  summary: string
}

export type StepsSource = 'claude-md' | 'fallback' | ''

declare module 'claude-code' {
  interface PluginState {
    'workflow-steps': { steps: Step[]; source: StepsSource; firstAction: string }
  }
}
