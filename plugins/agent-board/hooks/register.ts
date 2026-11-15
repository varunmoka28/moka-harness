import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

type Agent = {
  pane_id: string
  agent: string
  agent_status: string
  name?: string
  terminal_title_stripped?: string
  tab_id?: string
  // The tab's own label, when it has been given one
  tab?: string
}
type Context = { tokens: number; window: number }

// One line about the other tabs, for a mod that draws it (such as cache-clock): null while there is nothing to show
const tabs = atom({ plugin: 'agent-board', key: 'tabs' } as const, null)

const POLL_MS = 30_000
// States worth interrupting for: the tab stopped and is waiting on someone.
const STOPPED = new Set(['done', 'blocked'])
// A tab in one of these is between tasks, so a compaction cannot cut work off.
const SETTLED = new Set(['idle', 'done'])
// With AGENT_BOARD_COMPACT=1, an idle tab over this size is compacted by sending it its CLI's compact
// command, well inside the prompt cache's ~1 hour life. Claude tabs are only shown (they can compact
// themselves); a CLI not listed here is only shown too.
const FIRST = 150_000
const IDLE_MS = 10 * 60_000
const COMPACT: Record<string, string> = { codex: '/compact' }
// A Claude tab can publish its context size here, one JSON file per herdr pane: { tokens, window }.
const CTX_DIR = '/tmp/agent-board-ctx'
// A file older than this belongs to a tab that has closed.
const CTX_MAX_AGE_MS = 60 * 60_000

// Codex logs each request's input size in its rollout file; the newest one whose cwd is the pane's
// is the tab's. Two tabs in one worktree cannot be told apart: the newest wins.
const CODEX = `
import sys,os,glob,json,time
cwd=sys.argv[1]
fs=sorted(glob.glob(os.path.expanduser('~/.codex/sessions/*/*/*/rollout-*.jsonl')),key=os.path.getmtime,reverse=True)[:40]
for f in fs:
    if time.time()-os.path.getmtime(f)>86400: break
    with open(f,'rb') as h:
        if ('"cwd":"%s"'%cwd) not in h.read(6000).decode('utf8','ignore'): continue
        h.seek(0,2); h.seek(max(0,h.tell()-400000)); tail=h.read().decode('utf8','ignore')
    for l in reversed(tail.splitlines()):
        if '"token_count"' in l and '"last_token_usage"' in l:
            try: i=json.loads(l)['payload']['info']; print(i['last_token_usage']['input_tokens'], i['model_context_window']); sys.exit()
            except Exception: pass
    break
`

// Last state seen per pane, to tell a change from a standing state.
let seen = new Map<string, string>()
// When each pane became settled, and which settled panes were already compacted.
let settledSince = new Map<string, number>()
let compacted = new Set<string>()

const label = (a: Agent) =>
  (a.tab ?? a.name ?? a.terminal_title_stripped ?? a.pane_id).slice(0, 28)
const k = (n: number) => `${Math.round(n / 1000)}K`

async function herdr($: EngineInterface, args: readonly string[]) {
  const session = await $.env.get('HERDR_SESSION')
  if (session === undefined) return undefined

  return $.process.run(['herdr', '--session', session, ...args])
}

async function others($: EngineInterface): Promise<Agent[] | undefined> {
  const self = await $.env.get('HERDR_PANE_ID')
  const ran = await herdr($, ['agent', 'list'])
  if (ran === undefined || ran.exitCode !== 0) return undefined
  const agents: Agent[] = JSON.parse(ran.stdout).result.agents
  // Tabs can share one agent name, so the tab label is what tells them apart.
  // herdr's default label is the tab's number, which says nothing.
  const listed = await herdr($, ['tab', 'list'])
  const rows: { tab_id: string; label: string }[] = listed?.exitCode === 0 ? JSON.parse(listed.stdout).result.tabs ?? [] : []
  const labels = new Map(rows.filter(t => !/^\d+$/.test(t.label)).map(t => [t.tab_id, t.label]))

  return agents.filter(a => a.pane_id !== self).map(a => ({ ...a, tab: labels.get(a.tab_id ?? '') }))
}

async function paneCwds($: EngineInterface) {
  const ran = await herdr($, ['pane', 'list'])
  const panes: { pane_id: string; cwd: string }[] = ran?.exitCode === 0 ? JSON.parse(ran.stdout).result.panes : []

  return new Map(panes.map(p => [p.pane_id, p.cwd]))
}

// The tab's context size, or undefined when its CLI tells us nothing (agy, a tab without the mod).
async function context($: EngineInterface, a: Agent, cwds: () => Promise<Map<string, string>>): Promise<Context | undefined> {
  try {
    if (a.agent === 'claude') {
      const path = `${CTX_DIR}/${a.pane_id.replace(/[^\w.-]/g, '_')}.json`
      if ((await $.clock.now()) - (await $.fs.stat(path)).mtimeMs > CTX_MAX_AGE_MS) return undefined

      return JSON.parse(await $.fs.read(path))
    }
    if (a.agent === 'codex') {
      const cwd = (await cwds()).get(a.pane_id)
      if (cwd === undefined) return undefined
      const ran = await $.process.run(['python3', '-c', CODEX, cwd])
      const [tokens, window] = ran.stdout.trim().split(' ').map(Number)

      return ran.exitCode === 0 && tokens > 0 ? { tokens, window } : undefined
    }
  } catch {
    return undefined
  }
}

async function compact($: EngineInterface, a: Agent, ctx: Context | undefined, now: number) {
  if (!SETTLED.has(a.agent_status)) {
    settledSince.delete(a.pane_id)
    compacted.delete(a.pane_id)
    return
  }
  const since = settledSince.get(a.pane_id) ?? now
  settledSince.set(a.pane_id, since)
  const command = COMPACT[a.agent]
  if (command === undefined || ctx === undefined || ctx.tokens < FIRST) return
  if (now - since < IDLE_MS || compacted.has(a.pane_id)) return
  if ((await $.env.get('AGENT_BOARD_COMPACT')) !== '1') return

  compacted.add(a.pane_id)
  await herdr($, ['agent', 'prompt', a.pane_id, command])
  $.ui.toast(`${label(a)} idle ${Math.round(IDLE_MS / 60_000)} min at ${k(ctx.tokens)}: sent ${command}`, { timeoutMs: 15_000 })
}

// A poll that outlasts POLL_MS must not be joined by the next one: both would see the same change and toast twice.
let polling = false

async function poll($: EngineInterface) {
  if (polling) return
  polling = true
  try {
    await pollOnce($)
  } catch (error) {
    $.ui.log(`poll failed: ${String(error)}`)
  } finally {
    polling = false
  }
}

async function pollOnce($: EngineInterface) {
  const agents = await others($)
  if (agents !== undefined) {
    // Panes that have closed would otherwise stay in these for the life of the session.
    const live = new Set(agents.map(a => a.pane_id))
    for (const pane of settledSince.keys()) if (!live.has(pane)) settledSince.delete(pane)
    for (const pane of compacted) if (!live.has(pane)) compacted.delete(pane)
  }
  if (agents === undefined || agents.length === 0) {
    await update($, tabs, () => null)
    return
  }
  const now = await $.clock.now()
  let cwds: Map<string, string> | undefined
  const lookup = async () => (cwds ??= await paneCwds($))
  const sizes = new Map<string, Context | undefined>()
  for (const a of agents) {
    sizes.set(a.pane_id, await context($, a, lookup))
    if (seen.get(a.pane_id) === 'working' && STOPPED.has(a.agent_status)) {
      $.ui.toast(`${label(a)} is ${a.agent_status}`, { timeoutMs: 15_000 })
    }
    await compact($, a, sizes.get(a.pane_id), now)
  }
  seen = new Map(agents.map(a => [a.pane_id, a.agent_status]))
  const line = `tabs: ${agents.map(a => `${label(a)} ${a.agent_status}${sizes.get(a.pane_id) ? ` ${k(sizes.get(a.pane_id)!.tokens)}` : ''}`).join(', ')}`
  await update($, tabs, () => line)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      if (e.isInteractive && (await $.env.get('HERDR_SESSION')) !== undefined) {
        await $.command.register({
          name: 'tabs',
          description: 'List the other herdr agent tabs and their state',
          immediate: true,
        })
        await poll($)
        $.clock.every(POLL_MS, () => void poll($))
      }
    } catch (error) {
      $.ui.log(`agent-board did not start: ${String(error)}`)
    }

    return next(e)
  })

  on('command.run', { command: 'tabs' }, async $ => {
    try {
      const agents = await others($)
      if (agents === undefined) return { text: 'herdr did not answer.' }
      if (agents.length === 0) return { text: 'No other agent tabs.' }
      let cwds: Map<string, string> | undefined
      const lookup = async () => (cwds ??= await paneCwds($))

      const rows = []
      for (const a of agents) {
        const ctx = await context($, a, lookup)
        rows.push(`${a.agent_status.padEnd(8)} ${a.agent.padEnd(7)} ${label(a)}  ${ctx ? k(ctx.tokens).padStart(5) : '    ?'}  (${a.pane_id})`)
      }

      return { text: rows.join('\n') }
    } catch {
      return { text: 'herdr did not answer.' }
    }
  })
}
