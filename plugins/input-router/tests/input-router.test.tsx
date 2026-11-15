import { expect, mock, test } from 'claude-code/testing'

import { estimate, isReadTool, prune, strip } from '../hooks/logic'

const OK = { exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }
const START = { cwd: '/p', surface: 'terminal', isInteractive: true } as any
const PANE = { plugin: 'input-router', surface: 'terminal', component: 'Pane', requestId: 'input-router', props: { title: 'Haiku hand-offs', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as any
const USAGE = { input_tokens: 15_000, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

// About 15,000 tokens of text: 60,000 characters.
const BIG = Array.from({ length: 1_000 }, (_, i) => `Line ${i}: the quarterly figure for region ${i % 7} was ${i * 3} units.`.padEnd(59, '.')).join('\n')
const SMALL = 'a short file\n'
// About 3,000 tokens: under the line, not worth a model call.
const MEDIUM = BIG.slice(0, 12_000)

type Opts = { on?: boolean; broken?: boolean; reply?: (prompt: string) => Promise<any> | any; files?: Record<string, string> }

// Stands for the engine beneath the mod: the Read tool, a connector, the small model, the shell and files.
const host = (on: any, opts: Opts = {}) => {
  const files = { '/p/big.md': BIG, '/p/medium.md': MEDIUM, '/p/small.md': SMALL, ...opts.files }
  const seen = { reads: 0, mcp: 0, prompts: [] as string[], models: [] as string[], writes: {} as Record<string, string>, toasts: [] as string[] }
  mock.store(on, opts.on === false ? {} : { on: true })
  mock.env(on, { USER: 'tester' })
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.end', (_: any, e: any) => e)
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => {
    if (opts.broken) throw new Error('no surface')

    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_: any, e: any) => (seen.toasts.push(JSON.stringify(e)), { value: undefined }))
  on('process.run', () => ({ value: OK }))
  on('fs.write', (_: any, e: any) => {
    if (opts.broken) throw new Error('disk full')
    seen.writes[e.path] = e.text

    return { value: undefined }
  })
  on('model.complete', async (_: any, e: any) => {
    seen.prompts.push(e.prompt)
    seen.models.push(e.model)
    const reply = opts.reply ? await opts.reply(e.prompt) : 'Region 3 had 9 units (Line 3). Left out: the other 999 lines.'

    return { value: typeof reply === 'string' ? { isAnswered: true, text: reply, usage: USAGE } : reply }
  })
  on('tool.call', { tool: 'Read' }, (_: any, e: any) => {
    seen.reads++
    const content = files[e.file_path as keyof typeof files] ?? ''

    return { result: { type: 'text', file: { filePath: e.file_path, content, numLines: content.split('\n').length, startLine: 1, totalLines: content.split('\n').length } } }
  })

  return { seen, clock }
}

const read = ($: any, file_path: string, extra = {}) => $.tool.call({ tool: 'Read', file_path, ...extra })
// Lets the hooks in flight run on, without a timer.
const settle = async () => {
  for (let i = 0; i < 500; i++) await Promise.resolve()
}
const contentOf = (r: any): string => r.result.file.content

test('a 15,000-token file comes back as short notes with its path, and the panel shows both numbers', async ($, on) => {
  const { seen } = host(on)
  await $.session.start(START)
  await $.prompt.submit({ text: 'what did region 3 sell?' } as any).catch(() => {})
  expect(estimate(BIG)).toBeGreaterThan(14_000)

  const out = await read($, '/p/big.md')
  expect(estimate(contentOf(out))).toBeLessThan(1_500)
  expect(contentOf(out)).toContain('Region 3 had 9 units')
  expect(contentOf(out)).toContain('The original is at /p/big.md')
  expect(contentOf(out)).toContain('offset and limit')
  expect(seen.prompts[0]).toContain('Line 999')
  // Asked by full id, priced at Haiku 5.5 list prices: 15,000 in at $0.10/M, 400 out at $0.50/M.
  expect(seen.models[0]).toBe('claude-haiku-5-5')
  expect(Object.values(seen.writes).some(t => t.includes('Haiku about $0.0017'))).toBe(true)

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: /Read big\.md/ })).toBeDefined()
  expect(await ui.find({ text: new RegExp(`${estimate(BIG).toLocaleString('en-US')} to \\d+ tokens`) })).toBeDefined()
  expect(await ui.find({ text: /Done\. Claude got these notes/ })).toBeDefined()
  expect(await ui.find({ text: /1 in this chat/ })).toBeDefined()
  // The notes are folded until asked for.
  expect(await ui.find({ text: /Left out: the other 999 lines/ })).toBeUndefined()
  await ui.press({ key: 'notes-1' })
  expect(await ui.find({ text: /Left out: the other 999 lines/ })).toBeDefined()
  // The detail file is written, private.
  expect(Object.keys(seen.writes).some(p => p.startsWith('/tmp/input-router-tester/') && p.endsWith('.notes.md'))).toBe(true)
})

test('a read with offset or limit, and a file under 5,000 tokens, are exactly what the mod off returns', async ($, on) => {
  const { seen } = host(on)
  await $.session.start(START)
  const offMod = async (file_path: string, extra = {}) => {
    await $.command.run({ command: 'input-router', args: 'off' } as any)
    const r = await read($, file_path, extra)
    await $.command.run({ command: 'input-router', args: 'on' } as any)

    return r
  }

  for (const [path, extra] of [['/p/big.md', { offset: 1 }], ['/p/big.md', { limit: 50 }], ['/p/medium.md', {}], ['/p/small.md', {}]] as const) {
    expect(JSON.stringify(await read($, path, extra))).toBe(JSON.stringify(await offMod(path, extra)))
  }
  expect(seen.prompts).toEqual([])
})

test('the mod starts off: nothing goes to the small model until /input-router on', async ($, on) => {
  const { seen } = host(on, { on: false })
  await $.session.start(START)

  expect(contentOf(await read($, '/p/big.md'))).toBe(BIG)
  expect(seen.prompts).toEqual([])
  const said = await $.command.run({ command: 'input-router', args: '' } as any)
  expect(JSON.stringify(said)).toContain('is off')
})

test('when the small model times out, does not answer, or throws, the whole file reaches Claude', async ($, on) => {
  let mode = 0
  host(on, {
    reply: () => {
      mode++
      if (mode === 1) return { isAnswered: false, reason: 'aborted', usage: { ...USAGE, input_tokens: 0, output_tokens: 0 } }
      if (mode === 2) return { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }
      throw new Error('boom')
    },
    files: { '/p/b2.md': BIG + ' ', '/p/b3.md': BIG + '  ' },
  })
  await $.session.start(START)

  expect(contentOf(await read($, '/p/big.md'))).toBe(BIG)
  expect(contentOf(await read($, '/p/b2.md'))).toBe(BIG + ' ')
  expect(contentOf(await read($, '/p/b3.md'))).toBe(BIG + '  ')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: /Claude got it whole: the small model took too long/ })).toBeDefined()
  expect(await ui.find({ text: /Claude got it whole: the small model call failed/ })).toBeDefined()
  expect(await ui.find({ text: /is reading it/ })).toBeUndefined()
})

test('notes no shorter than the original are thrown away', async ($, on) => {
  host(on, { reply: () => BIG + BIG })
  await $.session.start(START)

  expect(contentOf(await read($, '/p/big.md'))).toBe(BIG)
})

test('a failure after the tool ran never runs the tool a second time', async ($, on) => {
  // The engine replays next(e) inside .catch, so the fallback must not run the tool again.
  const { seen } = host(on, { broken: true, reply: () => { throw new Error('model gone') } })
  await $.session.start(START)

  await read($, '/p/big.md')
  expect(seen.reads).toBe(1)
})

test('a file read again after its notes comes back whole, so Claude can edit from the real text', async ($, on) => {
  const { seen } = host(on)
  await $.session.start(START)

  expect(contentOf(await read($, '/p/big.md'))).not.toBe(BIG)
  expect(contentOf(await read($, '/p/big.md'))).toBe(BIG)
  expect(seen.prompts.length).toBe(1)
})

test('the saved full result of a connector comes back whole when Claude reads it', async ($, on) => {
  // Found live: the mod handed its own saved file to the small model again, so Claude got notes on notes.
  const saved = '/tmp/input-router-tester/abc-mcp_drive_list_files.txt'
  const { seen } = host(on, { files: { [saved]: BIG, ['/private' + saved]: BIG } })
  await $.session.start(START)

  expect(contentOf(await read($, saved))).toBe(BIG)
  expect(contentOf(await read($, '/private' + saved))).toBe(BIG)
  expect(seen.prompts).toEqual([])
})

// ---- Connectors ----

const member = (i: number) => ({ id: `m${1000 + i}`, name: `Member ${i}`, email: `m${i}@example.com`, bio: '', avatar: null, tags: [], _links: { self: { href: `https://x/${i}` } }, etag: 'abc' })
const LIST = JSON.stringify({ members: Array.from({ length: 500 }, (_, i) => member(i)), meta: { request_id: 'r1', next_cursor: 'c2' } })

const connector = (on: any, result: unknown) => {
  const calls: string[] = []
  on('tool.call', { tool: /^mcp__/ }, (_: any, e: any) => (calls.push(e.tool), { result }))

  return calls
}

test('a connector list over the line is stripped, saved privately, summarised, and shown as a connector card', async ($, on) => {
  const { seen } = host(on, { reply: () => '200 members; Member 3 is Mia Rossi (id m1003).' })
  connector(on, { content: [{ type: 'text', text: LIST }] })
  await $.session.start(START)
  expect(estimate(JSON.stringify(prune(JSON.parse(LIST))))).toBeGreaterThan(5_000)

  const out: any = await $.tool.call({ tool: 'mcp__circle__list_community_members', community: 'x' } as any)
  expect(out.result.content[0].text).toContain('Member 3 is Mia Rossi')
  const [fullPath, full] = Object.entries(seen.writes).find(([p]) => p.endsWith('.txt'))!
  expect(fullPath.startsWith('/tmp/input-router-tester/')).toBe(true)
  expect(out.result.content[0].text).toContain(`The original is at ${fullPath}`)
  expect(full).not.toContain('_links')
  expect(full).not.toContain('"bio"')
  expect(full).toContain('next_cursor')
  expect(seen.prompts[0]).toContain('"community":"x"')

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: /Read circle/ })).toBeDefined()
  expect(await ui.find({ text: /connector result · list_community_members/ })).toBeDefined()
})

test('a single record, a record a write call named, and a write result all go through whole', async ($, on) => {
  const one = JSON.stringify({ id: 'm1', notes: 'x'.repeat(20_000) })
  const { seen } = host(on)
  const results: Record<string, unknown> = {
    mcp__crm__get_member: { content: [{ type: 'text', text: one }] },
    mcp__crm__update_member: { content: [{ type: 'text', text: LIST }] },
    mcp__crm__list_members: { content: [{ type: 'text', text: LIST }] },
  }
  on('tool.call', { tool: /^mcp__/ }, (_: any, e: any) => ({ result: results[e.tool] }))
  await $.session.start(START)

  const single: any = await $.tool.call({ tool: 'mcp__crm__get_member', id: 'm1' } as any)
  expect(single.result.content[0].text).toBe(one)
  const write: any = await $.tool.call({ tool: 'mcp__crm__update_member', member_id: 'm1005', name: 'New' } as any)
  expect(write.result.content[0].text).toBe(LIST)
  const list: any = await $.tool.call({ tool: 'mcp__crm__list_members' } as any)
  expect(list.result.content[0].text).toBe(LIST)
  expect(seen.prompts).toEqual([])
})

test('at most four requests run at once; a fifth waits its turn and then goes', async ($, on) => {
  const gates: Array<() => void> = []
  const files: Record<string, string> = {}
  for (let i = 1; i <= 5; i++) files[`/p/f${i}.md`] = BIG + `${i}`
  const { seen } = host(on, { files, reply: () => new Promise(resolve => gates.push(() => resolve('short notes'))) })
  await $.session.start(START)

  const all = [1, 2, 3, 4, 5].map(i => read($, `/p/f${i}.md`))
  await settle()
  expect(seen.prompts.length).toBe(4)
  gates[0]!()
  await settle()
  expect(seen.prompts.length).toBe(5)
  for (const g of gates) g()
  const outs = await Promise.all(all)
  expect(outs.every(o => contentOf(o).includes('short notes'))).toBe(true)
})

test('Claude may open the saved full result without a prompt; other paths and deny rules are untouched', async ($, on) => {
  // Found live: in the default permission mode the read of the saved file stopped for permission.
  const { seen } = host(on)
  connector(on, { content: [{ type: 'text', text: LIST }] })
  let beneath: 'ask' | 'deny' = 'ask'
  on('tool.check', { tool: 'Read' }, () => ({ decision: beneath }))
  await $.session.start(START)
  await $.tool.call({ tool: 'mcp__circle__list_community_members' } as any)
  const fullPath = Object.keys(seen.writes).find(p => p.endsWith('.txt'))!
  const check = (file_path: string) => $.tool.check({ tool: 'Read', input: { file_path } } as any).then((v: any) => v.decision)

  expect(await check(fullPath)).toBe('allow')
  expect(await check('/tmp/input-router-tester/other.txt')).toBe('ask')
  expect(await check(`${fullPath}/../../../../etc/passwd`)).toBe('ask')
  expect(await check('/p/big.md')).toBe('ask')
  beneath = 'deny'
  expect(await check(fullPath)).toBe('deny')
})

// ---- Pure logic ----

test('read and write tools are told apart by the first verb in the name', () => {
  expect(isReadTool('mcp__circle__list_community_members')).toBe(true)
  expect(isReadTool('mcp__crm__update_member')).toBe(false)
  expect(isReadTool('mcp__x__transcripts')).toBe(false)
})

test('pruning drops empty fields and metadata, keeps 0, false and paging', () => {
  expect(prune({ a: 0, b: false, c: '', d: null, e: [], meta: { next_cursor: 'c', request_id: 'r' }, etag: 'x' } as any)).toEqual({ a: 0, b: false, meta: { next_cursor: 'c' } })
  expect(strip('plain text', new Set())).toEqual({ text: 'plain text' })
  expect(strip('{"id":"1"}', new Set())).toEqual({ whole: 'single' })
})
