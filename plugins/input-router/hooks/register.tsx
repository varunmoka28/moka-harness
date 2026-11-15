import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HandOff, Totals } from '../types'
import {
  buildPrompt,
  costOf,
  MODEL_IDS,
  count,
  estimate,
  forClaude,
  idsIn,
  isReadTool,
  isWorthIt,
  money,
  notesCap,
  strip,
  SYSTEM,
  textsOf,
  withText,
} from './logic'

const PANE = 'input-router'
/** At most this many small-model requests at once; the rest wait their turn. */
const MAX_RUNNING = 4
/** A request that takes longer is dropped and the full result goes through. */
const TIMEOUT_MS = 60_000
/** Cards kept in the panel. */
const KEPT = 30
const SHOWN = 10
/** Files under the mod's private folder (macOS spells /tmp as /private/tmp too). */
const OWN_FILE = /^(\/private)?\/tmp\/input-router-[^/]+\//
const ZERO: Totals = { count: 0, before: 0, after: 0, cost: 0 }

const handoffs = atom({ plugin: 'input-router', key: 'handoffs' } as const, [] as HandOff[])
const totals = atom({ plugin: 'input-router', key: 'totals' } as const, ZERO)
const shown = atom({ plugin: 'input-router', key: 'shown' } as const, [] as number[])

// What the user last asked for: the small model keeps what bears on it.
let lastPrompt = ''
// Files already handed off once: a second read comes back whole, so Claude can edit from the real text.
const summarised = new Set<string>()
// Record ids a connector write call named this session: results holding them come back whole.
const edited = new Set<string>()
// Full results this mod saved and named to Claude: opening one exactly as named needs no permission prompt.
const saved = new Set<string>()
let running = 0
const waiting: Array<() => void> = []
let opened = false
let toasted = false

type Next = { signal: AbortSignal; budget: { remainingMs: number } }

const isOn = async ($: EngineInterface) => Boolean(await $.store.get('on').catch(() => false))
const modelOf = async ($: EngineInterface) => ((await $.store.get('model').catch(() => undefined)) === 'sonnet' ? 'sonnet' : 'haiku')
const Name = (model: string) => (model === 'sonnet' ? 'Sonnet' : 'Haiku')

// Waits up to `waitMs` for one of the request slots. The wait is the hook's own time, so it is kept inside its budget.
async function takeSlot($: EngineInterface, waitMs: number): Promise<boolean> {
  if (running < MAX_RUNNING) {
    running++

    return true
  }
  if (waitMs <= 0) return false
  let wake = () => {}
  const turn = new Promise<boolean>(resolve => (wake = () => resolve(true)))
  waiting.push(wake)
  const stop = new AbortController()
  const won = await Promise.race([turn, $.clock.sleep(waitMs, { signal: stop.signal }).then(() => false, () => false)])
  stop.abort()
  if (won) return true
  const i = waiting.indexOf(wake)
  // Handed a slot just as the wait ran out: it is ours.
  if (i < 0) return true
  waiting.splice(i, 1)

  return false
}

function freeSlot() {
  const wake = waiting.shift()
  if (wake) wake()
  else running--
}

// A folder only this user can open. Undefined where it cannot be made (no mkdir, or someone else owns it).
async function privateDir($: EngineInterface): Promise<string | undefined> {
  try {
    const user = ((await $.env.get('USER')) ?? 'user').replace(/[^A-Za-z0-9_-]/g, '') || 'user'
    const dir = `/tmp/input-router-${user}`
    if ((await $.process.run(['mkdir', '-p', '-m', '700', dir])).exitCode !== 0) return undefined
    if ((await $.process.run(['chmod', '700', dir])).exitCode !== 0) return undefined

    return dir
  } catch {
    return undefined
  }
}

async function writePrivate($: EngineInterface, path: string, text: string): Promise<boolean> {
  await $.fs.write(path, text)

  return (await $.process.run(['chmod', '600', path])).exitCode === 0
}

const slug = (name: string) => name.replace(/[^A-Za-z0-9.]+/g, '_').slice(-60)

async function patch($: EngineInterface, id: number, change: Partial<HandOff>) {
  await update($, handoffs, list => list.map(one => (one.id === id ? { ...one, ...change } : one)))
}

async function showPane($: EngineInterface, model: string) {
  if (opened) return
  opened = true
  const got = await $.ui.open({ id: PANE, title: `${Name(model)} hand-offs` })
  if (!got.isPlaced && !toasted) {
    toasted = true
    $.ui.toast('Input router is handing large reads to a small model. Type /input-router panel to see them.')
  }
}

type Card = Pick<HandOff, 'kind' | 'title' | 'where' | 'before' | 'fullPath'>

/**
 * Gives `text` to the small model and returns what Claude should read instead, or undefined to send the original whole.
 * Every way it can fail (no free slot in time, a timeout, no answer, notes no shorter) ends in undefined.
 */
async function handOff($: EngineInterface, next: Next, card: Card, text: string, call: string): Promise<string | undefined> {
  const model = await modelOf($)
  const tokens = estimate(text)
  const startedAt = await $.clock.now()
  const list = await update($, handoffs, list => {
    const added: HandOff = {
      ...card,
      id: (list[0]?.id ?? 0) + 1,
      after: 0,
      cost: 0,
      model,
      startedAt,
      seconds: 0,
      status: 'running',
      reason: '',
      notes: '',
      detailPath: '',
    }

    return [added, ...list].slice(0, KEPT)
  })
  const id = list[0]!.id
  await showPane($, model).catch(() => {})
  const whole = (reason: string) => patch($, id, { status: 'whole', reason }).then(() => undefined)

  // Keep a second and a half of the hook's ten for the work after the reply.
  if (!(await takeSlot($, next.budget.remainingMs - 1_500))) return whole(`${MAX_RUNNING} hand-offs were already running`)
  const ask = { text, task: lastPrompt, call, tokens }
  const reply = await $.model
    .complete({ model: MODEL_IDS[model]!, system: SYSTEM, prompt: buildPrompt(ask), maxTokens: notesCap(tokens), timeoutMs: TIMEOUT_MS }, { signal: next.signal })
    .catch(() => undefined)
    .finally(freeSlot)
  if (reply === undefined) return whole('the small model call failed')
  const seconds = Math.round(((await $.clock.now()) - startedAt) / 1000)
  const cost = costOf(model, reply.usage)
  await update($, totals, t => ({ ...ZERO, ...t, cost: (t?.cost ?? 0) + cost }))
  await patch($, id, { cost, seconds })
  if (!reply.isAnswered) return whole(reply.reason === 'aborted' ? 'the small model took too long' : `the small model did not answer (${reply.reason})`)

  const notes = reply.text.trim()
  const out = forClaude(notes, card.fullPath, Name(model))
  const after = estimate(out)
  if (notes === '' || after >= card.before) return whole('the notes were not shorter than the original')

  const dir = await privateDir($)
  let detailPath = ''
  if (dir !== undefined) {
    const path = `${dir}/${startedAt.toString(36)}-${id}-${slug(card.title)}.notes.md`
    const facts = `# ${card.title}\n\n${card.where}\nOriginal: ${card.fullPath}\n${count(card.before)} to ${count(after)} tokens (estimate) · ${Name(model)} about ${money(cost)} (estimate) · ${seconds}s\n\n## What Claude got\n\n`
    if (await writePrivate($, path, facts + out).catch(() => false)) detailPath = path
  }
  await patch($, id, { status: 'done', after, notes: out, detailPath })
  await update($, totals, t => ({ ...ZERO, ...t, count: t.count + 1, before: t.before + card.before, after: t.after + after }))

  return out
}

async function shrinkRead($: EngineInterface, e: { file_path: string; offset?: number; limit?: number; pages?: string }, ran: any, next: Next) {
  // A targeted read asked for those exact lines.
  if (e.offset !== undefined || e.limit !== undefined || e.pages !== undefined) return ran
  if (ran.deny !== undefined || ran.isError === true) return ran
  const result = ran.result
  // Images, PDFs and notebooks are other types; a page the tool cut short is already partial.
  if (result?.type !== 'text' || result.file?.truncatedByTokenCap === true) return ran
  const content: string = result.file.content
  // The mod's own saved results are what Claude opens to get past the notes.
  if (!isWorthIt(content) || summarised.has(e.file_path) || OWN_FILE.test(e.file_path)) return ran
  if (!(await isOn($))) return ran

  const path: string = result.file.filePath ?? e.file_path
  const cut = path.lastIndexOf('/')
  const card = { kind: 'file' as const, title: path.slice(cut + 1), where: cut > 0 ? path.slice(0, cut) : '', before: estimate(content), fullPath: path }
  const out = await handOff($, next, card, content, '')
  if (out === undefined) return ran
  summarised.add(e.file_path)

  // A fresh object without `ref`, so the engine sends this result and not the one it made.
  return { result: { ...result, file: { ...result.file, content: out, numLines: out.split('\n').length } }, context: ran.context }
}

async function shrinkConnector($: EngineInterface, e: Record<string, unknown>, ran: any, next: Next) {
  const { tool, tool_use_id: _id, agentId: _agent, consent: _consent, requestMeta: _meta, ...args } = e as Record<string, unknown> & { tool: string }
  if (!isReadTool(tool)) {
    idsIn(args, edited)

    return ran
  }
  if (ran.deny !== undefined || ran.isError === true) return ran
  const texts = textsOf(ran.result)
  if (texts === undefined) return ran
  const original: string = ran.text ?? texts.join('\n\n')
  if (!isWorthIt(original)) return ran
  if (!(await isOn($))) return ran

  const parts = texts.map(t => strip(t, edited))
  const lean: string[] = []
  for (const p of parts) {
    if ('whole' in p) return ran
    lean.push(p.text)
  }
  const text = lean.join('\n\n')
  // Stripping alone brought it under the line: Claude gets the stripped copy, no model call.
  if (!isWorthIt(text)) return { result: withText(ran.result, text), context: ran.context }

  const dir = await privateDir($)
  if (dir === undefined) return ran
  const [, server = 'connector', ...rest] = tool.split('__')
  const fullPath = `${dir}/${(await $.clock.now()).toString(36)}-${slug(tool)}.txt`
  if (!(await writePrivate($, fullPath, text).catch(() => false))) return ran
  saved.add(fullPath)

  const card = { kind: 'connector' as const, title: server, where: `connector result · ${rest.join('__')}`, before: estimate(original), fullPath }
  const out = await handOff($, next, card, text, JSON.stringify(args).slice(0, 2_000))
  if (out === undefined) return ran

  return { result: withText(ran.result, out), context: ran.context }
}

async function reset($: EngineInterface) {
  await update($, handoffs, () => [])
  await update($, totals, () => ZERO)
  await update($, shown, () => [])
  summarised.clear()
  edited.clear()
  saved.clear()
  lastPrompt = ''
  opened = false
  toasted = false
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'input-router',
      description: 'Hand large file reads and connector results to a small model first. Starts off.',
      argumentHint: '[on | off | status | model haiku | model sonnet | savings | panel]',
    })

    return next(e)
  })

  // /clear, /resume and exit end the chat the totals belong to.
  on('session.end', async ($, e, next) => {
    await reset($).catch(() => {})

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.text.trim().startsWith('/input-router')) lastPrompt = e.text

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'input-router' }, async ($, e) => {
    const [verb = 'status', arg = ''] = `${e.args ?? ''}`.trim().toLowerCase().split(/\s+/)
    if (verb === 'on' || verb === 'off') await $.store.set('on', verb === 'on')
    if (verb === 'model') {
      if (arg !== 'haiku' && arg !== 'sonnet') return { text: 'Say /input-router model haiku or /input-router model sonnet.' }
      await $.store.set('model', arg)
    }
    const model = await modelOf($)
    if (verb === 'panel') {
      opened = true
      await $.ui.open({ id: PANE, title: `${Name(model)} hand-offs` })

      return { text: 'Hand-offs panel opened.' }
    }
    if (verb === 'savings') {
      const t = { ...ZERO, ...(await read($, totals)) }

      return {
        text:
          `${t.count} hand-offs in this chat: ${count(t.before)} to ${count(t.after)} tokens (estimates, characters / 4). ` +
          `Small model spend about ${money(t.cost)} (estimate at list prices, not your bill).`,
      }
    }
    const isRunning = await isOn($)

    return {
      text:
        `Input router is ${isRunning ? 'on' : 'off'}, using ${Name(model)}. ` +
        `When on, a file read or connector result over about 5,000 tokens goes to ${Name(model)} first and Claude gets its notes. ` +
        `/input-router ${isRunning ? 'off' : 'on'} to switch it.`,
    }
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    // A failure sends the tool's own result: next(e) in a catch replays it, the tool does not run twice.
    return shrinkRead($, e, await next(e), next)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: /^mcp__/ }, async ($, e, next) => {
    return shrinkConnector($, e as unknown as Record<string, unknown>, await next(e), next)
  }).catch(($, e, next) => next(e))

  // The notes tell Claude to open the saved full result when they fall short. That file sits outside the project,
  // so without this every such read would stop for a permission prompt. Only the exact paths this mod wrote, and
  // only when the verdict beneath is an ask: a deny rule still wins.
  on('tool.check', { tool: 'Read' }, async ($, e, next) => {
    const verdict = await next(e)
    const path = (e.input as { file_path?: unknown } | undefined)?.file_path

    return verdict.decision === 'ask' && typeof path === 'string' && saved.has(path)
      ? { decision: 'allow' as const, reason: 'input-router saved this result for Claude' }
      : verdict
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Link, Text } = $.ui.resolve(e)
    const list = (await read($, handoffs)) ?? []
    const t = { ...ZERO, ...(await read($, totals)) }
    const open = (await read($, shown)) ?? []
    const at = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const toggle = (id: number) => update($, shown, ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]))

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>{`${Name(await modelOf($))} hand-offs`}</Text>
          <Button key="hide" label="Hide" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        <Text dimColor wrap="wrap">{`${t.count} in this chat · ${count(t.before)} to ${count(t.after)} tokens · about ${money(t.cost)} (estimates)`}</Text>
        {list.length === 0 && <Text dimColor>None yet.</Text>}
        {list.slice(0, SHOWN).map(card => {
          const isShown = open.includes(card.id)
          const reqs = `1 ${Name(card.model)} request`
          const sizes = card.status === 'done' ? `${count(card.before)} to ${count(card.after)} tokens · ${reqs} · about ${money(card.cost)}` : `${count(card.before)} tokens`

          return (
            <Box key={`card-${card.id}`} flexDirection="column" marginTop={1}>
              <Text bold wrap="truncate-start">{`Read ${card.title}`}</Text>
              {card.where !== '' && <Text dimColor wrap="truncate-start">{card.where}</Text>}
              <Text dimColor wrap="wrap">{`${sizes} · ${at(card.startedAt)}`}</Text>
              {card.status === 'running' && <Text color="yellow">{`${Name(card.model)} is reading it`}</Text>}
              {card.status === 'done' && <Text color="green">{`Done. Claude got these notes (${card.seconds}s)`}</Text>}
              {card.status === 'whole' && <Text dimColor wrap="wrap">{`Claude got it whole: ${card.reason}`}</Text>}
              {card.status === 'done' && (
                <Box flexDirection="row" gap={2}>
                  {card.detailPath !== '' && <Link href={`file://${card.detailPath}`} label="Open detail file" />}
                  <Link href={`file://${card.fullPath}`} label="Open full result" />
                </Box>
              )}
              {card.status === 'done' && (
                <Button key={`notes-${card.id}`} label={isShown ? 'Hide the notes' : 'Show the notes Claude got'} plain onPress={() => toggle(card.id)} />
              )}
              {isShown && <Text wrap="wrap">{card.notes}</Text>}
            </Box>
          )
        })}
        {list.length > SHOWN && <Text dimColor>{`${list.length - SHOWN} older not shown`}</Text>}
      </Box>
    )
  })
}
