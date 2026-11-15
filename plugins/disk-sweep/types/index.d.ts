export type Tier = 'safe' | 'look'

// One removable thing: a dir, or a list of files that share a rule.
export type Candidate = {
  id: string      // `${dir}:${group}:${paths[0]}`, stable across rescans
  dir: string     // the Claude config dir it was found in
  group: string   // the target it came from, used as the table row
  tier: Tier
  label: string   // e.g. "some-plugin 1.2.0", "code-my-app"
  reason: string  // e.g. "not installed, 13.34.2 is", "412 files older than 14d, oldest 2026-08-14"
  paths: string[] // what rm removes
  bytes: number
  ticked: boolean
}

export type Scan = { at: string; days: number; candidates: Candidate[] }

export type Reply = { exitCode: number; stdout: string; stderr?: string } | null
export type Run = (argv: string[], timeoutMs?: number) => Promise<Reply>
export type Io = { run: Run; read: (path: string) => Promise<string | null>; now: number } // now: epoch ms

declare module 'claude-code' {
  interface PluginState {
    'disk-sweep': { scan: Scan | null; confirm: boolean }
  }
}
