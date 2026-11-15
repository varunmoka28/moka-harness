export type TaskStatus = 'done' | 'active' | 'upcoming'

export type Task = {
  id: string
  name: string
  status: TaskStatus
  percent: number
  hasReported: boolean
}

export type Checklist = {
  title: string
  phase: 'working' | 'needs-you' | 'stuck' | 'stopped' | 'done'
  tasks: Task[]
  // False until plan_steps (or a to-do tool) gives a real plan; gates the other tools
  hasRealPlan: boolean
  needsYouReason: string | null
  stuckReason: string | null
  startedAt: number
  finishedAt: number | null
  isCollapsed: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'clean-view': { cleanViewEnabled: boolean; checklist: Checklist | null; tick: number }
  }
}
