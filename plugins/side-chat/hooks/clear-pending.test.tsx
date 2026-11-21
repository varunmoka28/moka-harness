import { test, expect } from 'claude-code/testing'

// A request is tagged when it starts. A thread reset (/clear, /new) must cancel it where the engine can
// (the haiku fallback) and drop its late answer where it cannot (the fork), so it never lands in the new thread.

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const settle = () => new Promise(done => setTimeout(done, 100))
const mount = ($: any) => $.ui.mount({ plugin: 'side-chat', surface: 'terminal', component: 'Pane', props: {}, requestId: 'side-chat' } as never)
const late = { isAnswered: true, text: 'late answer', usage }

// A promise the test settles by hand, so an answer can arrive after the reset.
function later<T>() {
  let release!: (v: T) => void
  const done = new Promise<T>(r => (release = r))
  return { done, release }
}

// The fork and the haiku fallback both wait until the test releases them; the fallback's AbortSignal is kept,
// and so are the threads the mod saves.
function host(on: any) {
  const fork = later<unknown>()
  // The fork's second call waits on its own gate, so a test can save one answer and leave the next pending.
  const fork2 = later<unknown>()
  const haiku = later<unknown>()
  let forks = 0
  const seen = { signal: undefined as AbortSignal | undefined }
  const kept = new Map<string, unknown>()
  on('store.get', async (_t: any, e: any) => ({ value: kept.get(e.key) }) as never)
  on('store.set', async (_t: any, e: any) => (kept.set(e.key, e.value), { value: undefined }) as never)
  on('session.root', async () => ({ value: '/proj/a' }) as never)
  on('session.id', async () => ({ value: 's-a' }) as never)
  on('agent.list', async () => ({ value: [] }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.scroll', async () => ({}) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  on('model.fork', async () => ({ value: await (forks++ ? fork2 : fork).done }) as never)
  on('model.complete', async (_t: any, _e: any, next: any) => {
    seen.signal = next?.signal
    return { value: await haiku.done } as never
  })
  return { fork, fork2, haiku, seen, kept }
}

const btw = async ($: any, args: string) => {
  await $.command.run({ command: 'btw', args } as never)
  await settle()
}

// No card in the pane, and nothing saved to /history.
async function expectEmpty($: any, kept: Map<string, unknown>) {
  const m = await mount($)
  expect(await m.find({ key: 'copy-0' })).toBeUndefined()
  expect(await m.find({ key: 'answer-last' })).toBeUndefined()
  expect(kept.get('threads') ?? []).toEqual([])
}

test('/clear while the fork is still answering leaves the cleared thread empty', async ($, on) => {
  const h = host(on)
  await btw($, 'first question')
  await btw($, 'clear')
  h.fork.release(late)
  await settle()
  await expectEmpty($, h.kept)
})

test('/clear aborts the haiku fallback and drops its late answer', async ($, on) => {
  const h = host(on)
  h.fork.release({ isAnswered: false, reason: 'nothing-to-fork' })
  await btw($, 'first question')
  expect(h.seen.signal?.aborted).toBe(false)
  await btw($, 'clear')
  expect(h.seen.signal?.aborted).toBe(true)
  h.haiku.release(late)
  await settle()
  await expectEmpty($, h.kept)
})

test('/new while an answer is pending starts an empty thread that the late answer does not enter', async ($, on) => {
  const h = host(on)
  await btw($, 'first question')
  await btw($, 'new')
  h.fork.release(late)
  await settle()
  await expectEmpty($, h.kept)
})


test('picking a saved thread in /history while an answer is pending drops the late answer', async ($, on) => {
  const h = host(on)
  h.fork.release({ isAnswered: true, text: 'saved answer', usage })
  await btw($, 'first question')
  await btw($, 'new')
  await btw($, 'second question')
  await btw($, 'history')
  const m = await mount($)
  const pick = (await m.find({ key: 'history' })) as any
  await m.select({ key: 'history', value: (pick.options ?? pick.props.options)[0].value })
  h.fork2.release(late)
  await settle()
  expect((await m.find({ key: 'answer-last' }))?.text).toContain('saved answer')
  expect(await m.find({ key: 'copy-1' })).toBeUndefined()
})
