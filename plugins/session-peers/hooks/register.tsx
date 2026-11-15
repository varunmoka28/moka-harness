import type { EngineInterface, Register } from 'claude-code'

import type { Peer, Status } from '../types'

// The list of other sessions is drawn by the terminal-desk mod's /desk pane, which reads these files.

const STALE_MS = 120_000 // a session silent this long (crashed, killed tab) drops out
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

let dir = ''
let timer: { cancel: () => void } | undefined
let me: Peer = { id: '', label: '', status: 'done', seen: 0, edits: {} }

async function save($: EngineInterface) {
  // a /clear goes on under a new session id with no session.start: start a fresh record for it
  const id = await $.session.id()
  if (id !== me.id) {
    await remove($, [`${dir}/${me.id}.json`])
    me = { id, label: 'new session', status: 'done', seen: 0, edits: {}, headless: me.headless, tab: me.tab }
  }
  me.seen = await $.clock.now()
  await $.fs.write(`${dir}/${me.id}.json`, JSON.stringify(me))
}

async function setStatus($: EngineInterface, status: Status) {
  if (me.status === status) return
  me.status = status
  await save($)
}

const remove = ($: EngineInterface, paths: string[]) => paths.length ? $.process.run(['rm', '-f', ...paths]).catch(() => null) : undefined

async function others($: EngineInterface): Promise<Peer[]> {
  const now = await $.clock.now()
  const files = (await $.fs.list(dir).catch(() => [])).filter(f => f.kind === 'file' && f.name !== `${me.id}.json`)
  const list = await Promise.all(files.map(f => $.fs.read(`${dir}/${f.name}`).then(t => ({ path: `${dir}/${f.name}`, peer: JSON.parse(t as string) as Peer })).catch(() => undefined)))
  const found = list.filter(x => !!x)
  const live = (p: Peer) => !p.ended && now - p.seen < STALE_MS
  // ended or silent past STALE_MS: nothing reads these files again
  await remove($, found.filter(x => !live(x.peer)).map(x => x.path))
  return found.map(x => x.peer).filter(live)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const root = await $.session.root()
    const cfg = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await $.env.get('HOME')}/.claude`
    dir = `${cfg}/session-peers/${encodeURIComponent(root)}`
    const id = await $.session.id()
    // a reload keeps the session id: pick its record back up so earlier edits still count
    const prior = await $.fs.read(`${dir}/${id}.json`).then(t => JSON.parse(t as string) as Peer).catch(() => undefined)
    const tab = await $.env.get('HERDR_TAB_ID')
    me = prior ? { ...prior, ended: false, tab } : { id, label: 'new session', status: 'done', seen: 0, edits: {}, headless: !e.isInteractive, tab }
    await save($)
    // after a plugin reload the old copy's timer keeps running; once its session.end has fired it must stop writing
    timer?.cancel()
    timer = $.clock.every(30_000, () => { if (!me.ended) void save($) })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    const clear = e.reason === 'clear'
    if (!clear) {
      me.ended = true
      timer?.cancel()
    }
    await remove($, [`${dir}/${me.id}.json`])
    const ended = await next(e)
    if (clear) await save($).catch(() => {})
    return ended
  })

  on('turn.start', async ($, e, next) => {
    // a finished background task starts a turn whose text is a <task-notification> block: show its summary, not the tag
    const summary = e.text.startsWith('<task-notification>') ? /<summary>([^<]*)<\/summary>/.exec(e.text)?.[1] : undefined
    me.label = (summary ?? e.text.split('\n')[0]!).trim().slice(0, 50) || me.label
    me.status = 'working'
    await save($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) await setStatus($, 'done')
    return next(e)
  })

  // a permission prompt: the engine settled on asking the person
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask') await setStatus($, 'waiting')
    return verdict
  })

  on('tool.call', async ($, e, next) => {
    const asks = e.tool === 'AskUserQuestion' || e.tool === 'ExitPlanMode'
    if (asks) await setStatus($, 'waiting')
    const ran = await next(e)
    await setStatus($, 'working')
    if (!EDIT_TOOLS.has(e.tool) || ran.deny !== undefined || ran.isError) return ran

    const input = e as unknown as { file_path?: string; notebook_path?: string }
    const path = input.file_path ?? input.notebook_path
    if (!path) return ran
    me.edits[path] = await $.clock.now()
    await save($)

    const clash = (await others($)).filter(p => p.edits[path] !== undefined)
    if (!clash.length) return ran
    const who = clash.map(p => `"${p.label}" (${p.status})`).join(', ')
    $.ui.toast(`⚠ ${path.split('/').pop()} is also being edited by ${who}`)
    return { ...ran, context: [...(ran.context ?? []), `session-peers: another Claude session in this folder also edited ${path}: ${who}. Its changes and yours may overlap; re-read the file before further edits and mention the overlap to the user.`] }
  })
}
