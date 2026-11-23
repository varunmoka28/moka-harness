import { test, expect, mock } from 'claude-code/testing'

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const settle = () => new Promise(done => setTimeout(done, 100))
// What the session answers as its project and id; a test sets them to pose as another project.
let root = '/proj/a'
let sid = 's-a'
const mount = ($: any) => $.ui.mount({ plugin: 'side-chat', surface: 'terminal', component: 'Pane', props: {}, requestId: 'side-chat' } as never)

function base(on: any, fork: (t: any, e: any) => Promise<unknown> = async () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }), messages: unknown[] = [], complete: (t: any, e: any) => Promise<unknown> = async () => ({ value: { isAnswered: true, text: 'Use **pnpm**.', usage } }), store: (on: any) => void = mock.store) {
  store(on)
  on('session.root', async () => ({ value: root }) as never)
  on('session.id', async () => ({ value: sid }) as never)
  on('agent.list', async () => ({ value: [] }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.scroll', async () => ({}) as never)
  on('model.fork', fork as never)
  on('model.complete', complete as never)
  on('session.messages', async () => ({ value: messages }) as never)
  const toasts: string[] = []
  on('ui.toast', async (_t: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  return toasts
}

test("the /clear main button runs the main session's /clear and leaves the side thread", async ($, on) => {
  base(on)
  let cleared = 0
  on('command.run', { command: 'clear' }, async () => {
    cleared++
    return { value: {} } as never
  })
  await $.command.run({ command: 'btw', args: 'q' } as never)
  await settle()
  const m = await mount($)
  expect((await m.find({ key: 'mainclear' }))?.text).toBe('/clear main')
  await m.press({ key: 'mainclear' })
  await settle()
  expect(cleared).toBe(1)
  expect(await m.find({ key: 'copy-0' })).toBeDefined()
})

test('an unforkable session is answered by haiku, tagged, and drawn as markdown', async ($, on) => {
  base(on)
  await $.command.run({ command: 'btw', args: 'which package manager?' } as never)
  await settle()
  const m = await mount($)
  expect((await m.find({ key: 'answer-last' }))?.text).toContain('Use **pnpm**.')
  expect(await m.find({ type: 'Text', text: /^haiku$/ })).toBeDefined()
})

test('Copy pipes the answer to pbcopy, Draft fills and Send submits the main prompt', async ($, on) => {
  const toasts = base(on)
  let copied = ''
  let filled = ''
  let sent = ''
  on('process.run', async (_t: any, e: any) => {
    if (e.argv[0] === 'pbcopy') copied = e.init.stdin
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.fill', async (_t: any, e: any) => {
    filled = e.text
    return { isFilled: true, text: e.text }
  })
  on('prompt.submit', async (_t: any, e: any) => {
    sent = e.text
    return { drop: 'test' } as never
  })
  await $.command.run({ command: 'btw', args: 'q' } as never)
  await settle()
  const m = await mount($)
  await m.press({ key: 'copy-0' })
  await m.press({ key: 'draft-0' })
  await m.press({ key: 'send-0' })
  await settle()
  expect(copied).toBe('Use **pnpm**.')
  expect(filled).toBe('Use **pnpm**.')
  expect(sent).toBe('Use **pnpm**.')
  const all = await $.command.run({ command: 'side', args: 'copy all' } as never)
  expect(all).toEqual({})
  expect(toasts.at(-1)).toBe('Copied.')
  expect(copied).toBe('Q: q\nA: Use **pnpm**.')
})

test('/new saves the thread and /history brings it back', async ($, on) => {
  const toasts = base(on)
  await $.command.run({ command: 'btw', args: 'first question' } as never)
  await settle()
  await $.command.run({ command: 'side', args: 'new' } as never)
  expect(toasts.at(-1)).toContain('/history')
  const m = await mount($)
  expect(await m.find({ key: 'answer-last' })).toBeUndefined()
  await $.command.run({ command: 'side', args: 'history' } as never)
  await settle()
  const pick = await m.find({ key: 'history' })
  expect(JSON.stringify(pick)).toContain('first question')
  const id = (pick as any).options?.[0]?.value ?? (pick as any).props?.options?.[0]?.value
  await m.select({ key: 'history', value: id })
  await settle()
  expect((await m.find({ key: 'answer-last' }))?.text).toContain('Use **pnpm**.')
})

test('heading, chips, folding past 12 lines, and Stop drops the late answer', async ($, on) => {
  let release: (v: unknown) => void = () => {}
  let reply: unknown
  const prompts: string[] = []
  base(on, async (_t, e) => {
    prompts.push(e.prompt)
    return reply ?? new Promise(done => { release = done })
  })
  const m = await mount($)
  expect(await m.find({ type: 'Text', text: /^Side chat$/ })).toBeDefined()
  expect(await m.find({ key: 'chip-0' })).toBeDefined()
  // Short labels keep the row inside a narrow pane; the full question is still what gets asked.
  expect((await m.find({ key: 'chip-0' }))?.text).toBe('WRD?')
  expect((await m.find({ key: 'chip-1' }))?.text).toBe('Explain')
  expect((await m.find({ key: 'chip-2' }))?.text).toBe('Next?')
  await m.press({ key: 'chip-0' })
  await settle()
  expect(prompts[0]).toContain('Question: What are you doing?')
  await m.press({ key: 'stop' })
  await settle()
  release({ value: { isAnswered: true, text: 'late', usage } })
  await settle()
  expect(await m.find({ key: 'answer-last' })).toBeUndefined()

  const long = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')
  reply = { value: { isAnswered: true, text: long, usage } }
  await $.command.run({ command: 'btw', args: 'long one' } as never)
  await settle()
  expect((await m.find({ key: 'answer-last' }))?.text).not.toContain('line 13')
  await m.press({ key: 'fold-0' })
  await settle()
  expect((await m.find({ key: 'answer-last' }))?.text).toContain('line 20')
})

test('/btw writes nothing to the transcript', async ($, on) => {
  base(on)
  expect(await $.command.run({ command: 'btw', args: '' } as never)).toEqual({})
})

test('the haiku fallback reads the main transcript and is marked partial, with a cost line', async ($, on) => {
  let sent = ''
  base(on, undefined, [{ role: 'user', text: 'fix the parser', toolUses: [] }], async (_t, e) => {
    sent = e.prompt
    return { value: { isAnswered: true, text: 'ok', usage: { ...usage, input_tokens: 2500, output_tokens: 40 } } }
  })
  await $.command.run({ command: 'btw', args: 'what is main doing?' } as never)
  await settle()
  expect(sent).toContain('user: fix the parser')
  expect(sent).toContain('may look unanswered')
  const m = await mount($)
  expect(await m.find({ type: 'Text', text: /^partial context · .*new 2\.5k · out 40$/ })).toBeDefined()
})

test('a fork answer shows how much the cache served', async ($, on) => {
  base(on, async () => ({ value: { isAnswered: true, text: 'yes', usage: { ...usage, cache_read_input_tokens: 73000, input_tokens: 12, output_tokens: 300 } } }))
  await $.command.run({ command: 'btw', args: 'q' } as never)
  await settle()
  const m = await mount($)
  expect(await m.find({ type: 'Text', text: /s · read 73\.0k · new 12 · out 300$/ })).toBeDefined()
})

test('a card has Send but no Now button (Now removed in 0.4.7)', async ($, on) => {
  base(on)
  await $.command.run({ command: 'btw', args: 'q' } as never)
  await settle()
  const m = await mount($)
  expect(await m.find({ key: 'send-0' })).toBeDefined()
  expect(await m.find({ key: 'now-0' })).toBeUndefined()
})

test('a fallback with no main transcript text answers from the side thread only and says so', async ($, on) => {
  let sent = ''
  base(on, undefined, [{ role: 'assistant', text: '', toolUses: [] }], async (_t, e) => {
    sent = e.prompt
    return { value: { isAnswered: true, text: 'ok', usage } }
  })
  await $.command.run({ command: 'btw', args: 'what is main doing?' } as never)
  await settle()
  expect(sent).toContain('side thread only')
  expect(sent).not.toContain('conversation above')
  expect(sent).not.toContain('main conversation')
  const m = await mount($)
  expect(await m.find({ type: 'Text', text: /^no main context · [\d.]+s · read 0 · new 0 · out 0$/ })).toBeDefined()
})

test("/clear's command echo is not main context, so the fallback says no main context", async ($, on) => {
  let sent = ''
  const echo = { role: 'user', text: '<command-name>/clear</command-name>\n            <command-message>clear</command-message>\n            <command-args></command-args>', toolUses: [] }
  base(on, undefined, [echo], async (_t, e) => {
    sent = e.prompt
    return { value: { isAnswered: true, text: 'ok', usage } }
  })
  await $.command.run({ command: 'btw', args: 'what is main doing?' } as never)
  await settle()
  expect(sent).toContain('side thread only')
  expect(sent).not.toContain('<command-name>')
  const m = await mount($)
  expect(await m.find({ type: 'Text', text: /^no main context · / })).toBeDefined()
})

test('a /btw @agent is read-only: writers and Bash are denied, even before spawn returns and after Stop, until it ends', async ($, on) => {
  mock.store(on)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.scroll', async () => ({}) as never)
  // The engine lists an agent, with who started it, as soon as it runs; b2 belongs to someone else.
  let agents: unknown[] = [
    { id: 'a1', type: 'Explore', status: 'running', description: 'side chat question', spawnedBy: 'side-chat' },
    { id: 'b2', type: 'Explore', status: 'running', description: 'other' },
  ]
  on('agent.list', async () => ({ value: agents }) as never)
  const prompts: string[] = []
  let handOver: (v?: unknown) => void = () => {}
  on('agent.spawn', async (_t: any, e: any) => {
    prompts.push(e.prompt)
    // Spawn never answers while the agent works: its calls come before the mod has an id.
    await new Promise(done => { handOver = done })
    return { model: 'haiku' } as never
  })
  on('tool.call', async () => ({ result: 'ran', text: 'ran' }) as never)
  const call = (tool: string, agentId?: string) => $.tool.call({ tool, ...(agentId ? { agentId } : {}) } as never) as Promise<{ deny?: string; text?: string }>

  await $.command.run({ command: 'btw', args: '@Explore look at the parser' } as never)
  await settle()
  expect(prompts[0]).toContain('do not change any files')
  for (const tool of ['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Bash', 'Agent', 'REPL']) expect((await call(tool, 'a1')).deny).toContain('read-only')
  expect((await call('Read', 'a1')).text).toBe('ran')
  expect((await call('Edit')).text).toBe('ran')
  expect((await call('Edit', 'b2')).text).toBe('ran')

  await (await mount($)).press({ key: 'stop' })
  await settle()
  expect((await call('Edit', 'a1')).deny).toContain('read-only')

  agents = []
  expect((await call('Edit', 'a1')).text).toBe('ran')
  handOver()
})


test('Stop cancels the haiku fallback while it runs and nothing is drawn after', async ($, on) => {
  let cancelled = false
  base(on, undefined, [{ role: 'user', text: 'fix the parser', toolUses: [] }], async (_t, _e, next) => {
    await new Promise<void>(done => next.signal.addEventListener('abort', () => done()))
    cancelled = true
    return { value: { isAnswered: false, reason: 'aborted' } }
  })
  await $.command.run({ command: 'btw', args: 'what is main doing?' } as never)
  await settle()
  const m = await mount($)
  await m.press({ key: 'stop' })
  await settle()
  expect(cancelled).toBe(true)
  expect(await m.find({ key: 'answer-last' })).toBeUndefined()
  expect(await m.find({ type: 'Text', text: /^No reply/ })).toBeUndefined()
})

test('side history is capped by size too: the newest turns that fit 8000 characters go, an oversize newest is cut', async ($, on) => {
  const prompts: string[] = []
  let text = ''
  base(on, async (_t, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, text, usage } }
  })
  const ask = async (q: string, answer: string) => {
    text = answer
    await $.command.run({ command: 'btw', args: q } as never)
    await settle()
  }
  await ask('q1', 'a'.repeat(5000))
  await ask('q2', 'b'.repeat(5000))
  await ask('q3', 'c'.repeat(9000))
  expect(prompts[2]).toContain('Earlier question: q2')
  expect(prompts[2]).not.toContain('Earlier question: q1')
  await ask('q4', 'ok')
  expect(prompts[3]).toContain('Earlier question: q3')
  expect(prompts[3]).not.toContain('Earlier question: q2')
  expect(prompts[3].match(/c{100,}/)![0]).toHaveLength(8000 - 'q3'.length)
})

test('threads are saved with their project and session, and /history lists this project first and the rest as other', async ($, on) => {
  const kept = new Map<string, any>()
  base(on, undefined, [], undefined, (on: any) => {
    on('store.get', async (_t: any, e: any) => ({ value: kept.get(e.key) }) as never)
    on('store.set', async (_t: any, e: any) => (kept.set(e.key, e.value), { value: undefined }) as never)
  })
  const here = async (project: string, id: string, q: string) => {
    root = project
    sid = id
    await $.command.run({ command: 'btw', args: q } as never)
    await settle()
    await $.command.run({ command: 'side', args: 'new' } as never)
  }
  await here('/proj/a', 's-a', 'question from a')
  await here('/proj/b', 's-b', 'question from b')
  root = '/proj/a'
  expect(kept.get('threads').map((t: any) => [t.root, t.session])).toEqual([['/proj/b', 's-b'], ['/proj/a', 's-a']])
  const m = await mount($)
  await $.command.run({ command: 'side', args: 'history' } as never)
  await settle()
  const labels = ((await m.find({ key: 'history' })) as any).props.options.map((o: any) => o.label)
  expect(labels[0]).toContain('question from a')
  expect(labels[0]).not.toContain('other')
  expect(labels[1]).toContain('other')
  expect(labels[1]).toContain('question from b')
})

test('Stop while the fallback reads the transcript starts no haiku call', async ($, on) => {
  mock.store(on)
  on('session.root', async () => ({ value: root }) as never)
  on('session.id', async () => ({ value: sid }) as never)
  on('agent.list', async () => ({ value: [] }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.scroll', async () => ({}) as never)
  on('model.fork', async () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }) as never)
  let readTranscript: (rows: unknown[]) => void = () => {}
  on('session.messages', async () => ({ value: await new Promise(done => { readTranscript = done }) }) as never)
  let completes = 0
  on('model.complete', async () => {
    completes++
    return { value: { isAnswered: true, text: 'late', usage } } as never
  })
  await $.command.run({ command: 'btw', args: 'what is main doing?' } as never)
  await settle()
  const m = await mount($)
  await m.press({ key: 'stop' })
  readTranscript([])
  await settle()
  expect(completes).toBe(0)
  expect(await m.find({ key: 'answer-last' })).toBeUndefined()
})
