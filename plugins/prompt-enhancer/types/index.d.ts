export type Recent = { prompts: string[]; answer: string }

export type Status = { kind: 'idle' } | { kind: 'working' } | { kind: 'done'; skills: string[] } | { kind: 'error'; message: string }

declare module 'claude-code' {
  interface PluginState {
    'prompt-enhancer': { original: string | null; status: Status; recent: Recent }
  }
}
