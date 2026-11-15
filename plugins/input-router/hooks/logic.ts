// Pure logic, no engine calls: the hooks and the tests share it.
// The connector stripping is adapted from lean-connector-results by Creator Scripts (MIT).

/** A result this many estimated tokens or more goes to the small model. */
export const THRESHOLD_TOKENS = 5_000
/** Above this the small model could not read it all at once, so it goes through whole. */
export const MAX_TOKENS = 150_000
/** The most the notes may be, in tokens; never more than half the original. */
export const NOTES_TOKENS = 1_200

/** Characters / 4: a rough token count, close enough for English text and JSON. */
export const estimate = (text: string): number => Math.ceil(text.length / 4)

export const isWorthIt = (text: string): boolean => {
  const tokens = estimate(text)

  return tokens >= THRESHOLD_TOKENS && tokens <= MAX_TOKENS
}

export const notesCap = (tokens: number): number => Math.min(NOTES_TOKENS, Math.floor(tokens / 2))

export const SYSTEM = [
  'You are filtering a document for another model, which will work from your notes instead of the document.',
  'Return only what bears on the task you are given.',
  'Quote figures, names, dates and identifiers exactly as written.',
  'Keep section headings or line numbers next to what you keep, so the other model can find the original.',
  'End with one line that says plainly what you left out.',
  'Write plain notes, no preamble.',
].join(' ')

export type Ask = { text: string; task: string; call: string; tokens: number }

export function buildPrompt(ask: Ask): string {
  const task = ask.task.trim() === '' ? '(none given)' : ask.task.trim().slice(0, 4_000)
  const call = ask.call.trim() === '' ? '' : `\n\nWhat the other model asked for when it opened this:\n${ask.call.slice(0, 2_000)}`

  return (
    `The user's last request:\n${task}${call}\n\n` +
    `Keep your notes under ${Math.floor(notesCap(ask.tokens) * 0.75)} words.\n\n` +
    `<document>\n${ask.text}\n</document>`
  )
}

/** What Claude reads in place of the original: the notes, then one fixed line naming where the original is. */
export function forClaude(notes: string, path: string, model: string): string {
  return (
    `[Notes by ${model} for this task, not the full text]\n\n${notes.trim()}\n\n` +
    `The original is at ${path}. Read a part of it with offset and limit, or read it again to get it whole.`
  )
}

// ---- Connector results ----

const READ_VERBS = new Set(['get', 'list', 'search', 'query', 'fetch', 'find', 'read', 'show', 'lookup'])
const WRITE_VERBS = new Set([
  'update', 'upsert', 'create', 'add', 'delete', 'remove', 'edit', 'patch', 'send', 'post', 'put', 'set',
  'publish', 'convert', 'assign', 'move', 'rename', 'trash', 'label', 'upload', 'import', 'run', 'execute',
  'invoke', 'activate', 'deactivate', 'book', 'reschedule', 'clone', 'install', 'call', 'replace', 'manage',
  'mark', 'apply', 'share', 'copy', 'restore', 'empty',
])

/** Keys that are transport or system metadata, not the record's own data. */
const METADATA_KEY = /^(\$.*|@.*|_links?|links|_meta|meta|_?metadata|_?etag|kind|self|href|request_?id|trace_?id|api_?version|response_?headers)$/i
/** Inside metadata, anything paging needs is kept. */
const PAGING_KEY = /page|cursor|next|prev|more|token|count|total|offset|limit/i
const ID_KEY = /^(id|ID|.*_id|.*Id|.*ID|record_?ids?|ids)$/

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** The words of the tool's own name, without the `mcp__server__` part. */
function words(tool: string): string[] {
  const name = tool.split('__').slice(2).join('__') || tool

  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map(w => w.toLowerCase())
    .filter(Boolean)
}

/** A read tool: the first verb in its name is a read verb. Anything else counts as a write. */
export function isReadTool(tool: string): boolean {
  for (const w of words(tool)) {
    if (WRITE_VERBS.has(w)) return false
    if (READ_VERBS.has(w)) return true
  }

  return false
}

/** The record ids a write call names, however deep in its arguments. */
export function idsIn(args: unknown, out: Set<string>, key = '', depth = 0): void {
  if (depth > 5 || args === null || args === undefined) return
  if (typeof args === 'string' || typeof args === 'number') {
    const s = String(args)
    if ((ID_KEY.test(key) && s.length >= 4) || /^\d{10,}$/.test(s)) out.add(s)

    return
  }
  if (Array.isArray(args)) {
    for (const item of args) idsIn(item, out, key, depth + 1)

    return
  }
  if (typeof args === 'object') for (const [k, v] of Object.entries(args)) idsIn(v, out, k, depth + 1)
}

function isEmpty(v: Json | undefined): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v).length === 0

  return false
}

/** True when some array holds two or more records: a list, not one record. */
function hasRecordList(v: Json, depth = 0): boolean {
  if (depth > 12 || v === null || typeof v !== 'object') return false
  if (Array.isArray(v)) {
    const records = v.filter(i => i !== null && typeof i === 'object' && !Array.isArray(i))

    return records.length >= 2 || v.some(i => hasRecordList(i, depth + 1))
  }

  return Object.values(v).some(child => hasRecordList(child, depth + 1))
}

/** True when a record anywhere in it carries an id a write call named this session. */
function namesEdited(v: Json, edited: ReadonlySet<string>, depth = 0): boolean {
  if (edited.size === 0 || depth > 12 || v === null || typeof v !== 'object') return false
  if (Array.isArray(v)) return v.some(i => namesEdited(i, edited, depth + 1))

  return Object.entries(v).some(
    ([k, child]) =>
      ((typeof child === 'string' || typeof child === 'number') && ID_KEY.test(k) && edited.has(String(child))) ||
      namesEdited(child, edited, depth + 1),
  )
}

function pagingOnly(v: Json): Json | undefined {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined
  const kept: { [key: string]: Json } = {}
  for (const [k, child] of Object.entries(v)) {
    if (PAGING_KEY.test(k) && !isEmpty(child) && (typeof child !== 'object' || child === null)) kept[k] = child
  }

  return Object.keys(kept).length > 0 ? kept : undefined
}

/** A copy without empty fields and metadata. 0 and false are kept. */
export function prune(v: Json): Json {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(prune)
  const out: { [key: string]: Json } = {}
  for (const [k, child] of Object.entries(v)) {
    if (METADATA_KEY.test(k)) {
      const paging = PAGING_KEY.test(k) && (typeof child !== 'object' || child === null) ? child : pagingOnly(child)
      if (paging !== undefined && !isEmpty(paging)) out[k] = paging
      continue
    }
    const next = prune(child)
    if (!isEmpty(next)) out[k] = next
  }

  return out
}

/**
 * One text of a connector result, ready for the small model, or why it must go through whole:
 * `single` (JSON that is one record, not a list) or `edited` (it holds a record a write call named).
 * Text that is not JSON goes as it is.
 */
export function strip(text: string, edited: ReadonlySet<string>): { text: string } | { whole: 'single' | 'edited' } {
  const trimmed = text.trim()
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return { text }
  let parsed: Json
  try {
    parsed = JSON.parse(trimmed) as Json
  } catch {
    return { text }
  }
  if (!hasRecordList(parsed)) return { whole: 'single' }
  if (namesEdited(parsed, edited)) return { whole: 'edited' }

  return { text: JSON.stringify(prune(parsed)) }
}

const isTextBlock = (b: unknown): b is { type: 'text'; text: string } =>
  typeof b === 'object' && b !== null && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string'

/** The texts of a connector result, or undefined when it holds anything else (an image, a structured record). */
export function textsOf(result: unknown): string[] | undefined {
  if (typeof result === 'string') return [result]
  if (Array.isArray(result)) return result.every(isTextBlock) ? result.map(b => b.text) : undefined
  if (typeof result === 'object' && result !== null) {
    const { content, structuredContent } = result as { content?: unknown; structuredContent?: unknown }
    // A structured result is checked against the tool's own schema; notes could not pass it.
    if (structuredContent !== undefined || !Array.isArray(content)) return undefined

    return textsOf(content)
  }

  return undefined
}

/** The result in the shape it came in, holding the notes alone. */
export function withText(result: unknown, text: string): unknown {
  if (typeof result === 'string') return text
  if (Array.isArray(result)) return [{ type: 'text', text }]

  return { ...(result as object), content: [{ type: 'text', text }] }
}

// ---- Money, shown as an estimate only ----

/** The exact model asked for, so the price below is the price of what ran. */
export const MODEL_IDS: Record<string, string> = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5' }

/** List prices in dollars per million tokens: [input, output]. An estimate; check the current price list. */
export const PRICES: Record<string, readonly [number, number]> = { haiku: [0.1, 0.5], sonnet: [2, 10] }

export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

export function costOf(model: string, u: Usage): number {
  const [inPrice, outPrice] = PRICES[model] ?? PRICES.haiku!
  const input = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

  return (input * inPrice + u.output_tokens * outPrice) / 1_000_000
}

export const money = (dollars: number): string => `$${dollars < 0.01 ? dollars.toFixed(4) : dollars.toFixed(3)}`
export const count = (n: number): string => n.toLocaleString('en-US')
