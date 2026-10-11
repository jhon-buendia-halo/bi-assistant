export type Step = {
  number: number
  title: string
  summary: string
}

export type StepsSource = 'claude-md' | 'fallback' | ''

export type TaskStatus = 'running' | 'tentative' | 'done'

export type TaskAgent = {
  id?: string
  type: string
  model: string
  description: string
  running: boolean
}

export type Task = {
  /** The sequence number, given when the task is promoted; null while tentative. */
  seq: number | null
  step: number
  status: TaskStatus
  startedAt: number
  endedAt?: number
  matched: number
  unmatched: number
  /** Input plus output tokens of the turns that ended while the task ran. */
  tokens: number
  cached: number
  /** The session cost when the task started, and its share so far. */
  costStart: number
  cost: number
  agents: TaskAgent[]
  evidence: Record<string, number>
  /** For a step-9 task: the result of its last test command. */
  result?: 'passed' | 'failed'
}

export type Queue = {
  tasks: Task[]
  nextSeq: number
  hasWritten: boolean
  firstActionDone: boolean
  startedAt: number
  /** The last session cost seen, in US dollars. */
  usd: number
}

declare module 'claude-code' {
  interface PluginState {
    'workflow-steps': { steps: Step[]; source: StepsSource; firstAction: string; queue: Queue }
  }
}
