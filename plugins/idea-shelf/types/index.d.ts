// `at`: ISO time the idea was shelved; absent on ideas shelved before 0.3.0.
export type Idea = { id: string; text: string; at?: string }

declare module 'claude-code' {
  interface PluginState {
    'idea-shelf': { ideas: Idea[] }
  }
}
