import { test, expect, mock } from 'claude-code/testing'

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const settle = () => new Promise(done => setTimeout(done, 100))
const mount = ($: any) => $.ui.mount({ plugin: 'side-chat', surface: 'terminal', component: 'Pane', props: {}, requestId: 'side-chat' } as never)

function base(on: any, fork: (t: any, e: any) => Promise<unknown> = async () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }), messages: unknown[] = [], complete: (t: any, e: any) => Promise<unknown> = async () => ({ value: { isAnswered: true, text: 'Use **pnpm**.', usage } })) {
  mock.store(on)
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

test('only the last 5 side turns go with a question', async ($, on) => {
  const prompts: string[] = []
  base(on, async (_t, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, text: 'ok', usage } }
  })
  for (let i = 1; i <= 7; i++) {
    await $.command.run({ command: 'btw', args: `q${i}` } as never)
    await settle()
  }
  const lastPrompt = prompts.at(-1)!
  expect(lastPrompt).not.toContain('Earlier question: q1\n')
  expect(lastPrompt).toContain('Earlier question: q2')
  expect(lastPrompt).toContain('Earlier question: q6')
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

test('Now joins a running turn, and is sent as a message when main is idle', async ($, on) => {
  base(on)
  const submitted: string[] = []
  on('prompt.submit', async (_t: any, e: any) => {
    submitted.push(e.text)
    return { drop: 'test' } as never
  })
  const rows = mock.session(on)
  on('turn.start', async (_t: any, e: any) => ({ turnId: e.turnId }) as never)
  await $.command.run({ command: 'btw', args: 'q' } as never)
  await settle()
  const m = await mount($)
  await m.press({ key: 'now-0' })
  expect(submitted).toEqual(['Use **pnpm**.'])

  await $.turn.start({ text: 'main work', turnId: 't1' } as never)
  await m.press({ key: 'now-0' })
  expect(submitted).toHaveLength(1)
  expect(JSON.stringify(rows.appended())).toContain('From my side chat: Use **pnpm**.')
})
