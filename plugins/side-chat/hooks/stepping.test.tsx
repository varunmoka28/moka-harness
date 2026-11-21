import { test, expect, mock } from 'claude-code/testing'

// Older and Newer pick one card; the c (copy) and f (fork) hotkeys sit on the picked card, newest until Older is pressed.

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const settle = () => new Promise(done => setTimeout(done, 100))
const mount = ($: any) => $.ui.mount({ plugin: 'side-chat', surface: 'terminal', component: 'Pane', props: {}, requestId: 'side-chat' } as never)

// `count` answered turns; ask() adds the next one. copied is what pbcopy was given, spawned the raw agent.spawn events.
async function turns($: any, on: any, count: number) {
  mock.store(on)
  const answers = ['first answer', 'second answer', 'third answer', 'fourth answer']
  const questions = ['one', 'two', 'three', 'four']
  let n = 0
  let q = 0
  on('session.root', async () => ({ value: '/proj/a' }) as never)
  on('session.id', async () => ({ value: 's-a' }) as never)
  on('agent.list', async () => ({ value: [] }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.scroll', async () => ({}) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('model.fork', async () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }) as never)
  on('session.messages', async () => ({ value: [] }) as never)
  on('model.complete', async () => ({ value: { isAnswered: true, text: answers[n++], usage } }) as never)
  const spawned: any[] = []
  on('agent.spawn', async (_t: any, e: any) => {
    spawned.push(e)
    return { model: 'sonnet', agentId: 'f1' } as never
  })
  const copied: string[] = []
  on('process.run', async (_t: any, e: any) => {
    if (e.argv[0] === 'pbcopy') copied.push(e.init.stdin)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const ask = async () => {
    await $.command.run({ command: 'btw', args: questions[q++] } as never)
    await settle()
  }
  for (let i = 0; i < count; i++) await ask()
  return { copied, spawned, ask }
}

// The card index a hotkey is on, from the Button key ('copy-1' -> 1); undefined when no Button carries it.
async function cardOf(m: any, hotkey: string) {
  const b = (await m.findAll({ type: 'Button' })).find((x: any) => x.props.hotkey === hotkey)
  return b ? Number(String(b.key).split('-')[1]) : undefined
}

test('Older and Newer move the c and f hotkeys between cards', async ($, on) => {
  await turns($, on, 3)
  const m = await mount($)
  const at = async () => [await cardOf(m, 'c'), await cardOf(m, 'f')]
  expect(await at()).toEqual([2, 2])
  await m.press({ key: 'older' })
  expect(await at()).toEqual([1, 1])
  expect((await m.find({ key: 'copy-2' }))?.props.hotkey).toBeUndefined()
  await m.press({ key: 'older' })
  expect(await at()).toEqual([0, 0])
  await m.press({ key: 'older' })
  expect(await at()).toEqual([0, 0])
  await m.press({ key: 'newer' })
  expect(await at()).toEqual([1, 1])
  await m.press({ key: 'newer' })
  await m.press({ key: 'newer' })
  expect(await at()).toEqual([2, 2])
})

test('after Older, the button that carries c copies the older answer and the one that carries f forks the older card', async ($, on) => {
  const { copied, spawned } = await turns($, on, 3)
  const m = await mount($)
  await m.press({ key: 'older' })
  const find = async (hotkey: string) => String((await m.findAll({ type: 'Button' })).find((x: any) => x.props.hotkey === hotkey)?.key)
  await m.press({ key: await find('c') })
  await settle()
  expect(copied).toEqual(['second answer'])
  expect(spawned.length).toBe(0)
  await m.press({ key: await find('f') })
  await settle()
  expect(copied).toEqual(['second answer'])
  expect(spawned.length).toBe(1)
  expect(spawned[0].subagent_type).toBe('fork')
  expect(spawned[0].prompt).toContain('two')
  expect(spawned[0].prompt).toContain('second answer')
  expect(spawned[0].prompt).not.toContain('third answer')
})

test('a new answer puts the selection back on the newest card', async ($, on) => {
  const { ask } = await turns($, on, 3)
  const m = await mount($)
  await m.press({ key: 'older' })
  expect(await cardOf(m, 'c')).toBe(1)
  await ask()
  expect(await cardOf(m, 'c')).toBe(3)
  expect(await cardOf(m, 'f')).toBe(3)
})

test('Older and Newer appear only with two or more cards, and no hotkey repeats in the pane', async ($, on) => {
  const one = await turns($, on, 1)
  const m1 = await mount($)
  expect(await m1.find({ key: 'older' })).toBeUndefined()
  expect(await m1.find({ key: 'newer' })).toBeUndefined()
  expect(one.copied).toEqual([])
})

test('three cards: the hotkeys are exactly c, f, o, n and none repeats', async ($, on) => {
  await turns($, on, 3)
  const m = await mount($)
  const keys = (await m.findAll({ type: 'Button' })).map((b: any) => b.props.hotkey).filter(Boolean)
  expect(new Set(keys).size).toBe(keys.length)
  expect([...keys].sort()).toEqual(['c', 'f', 'n', 'o'])
})
