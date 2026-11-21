export type SideTurn = { q: string; a: string; via?: 'fork' | 'haiku' | 'agent' | 'transcript'; cost?: string }
export type SideThread = { id: string; started: string; title: string; turns: SideTurn[]; root?: string; session?: string }

declare module 'claude-code' {
  interface PluginState {
    'side-chat': { turns: SideTurn[]; pending: string; model: string; draft: string; thread: { id: string; started: string }; notice: string; picking: boolean; opened: number[]; picked: number }
  }
}
