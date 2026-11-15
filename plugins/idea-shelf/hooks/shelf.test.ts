import { expect, mock, test } from 'claude-code/testing'

test('/idea shelves globally, survives a restart, send fills the prompt, discard drops', async ($, on) => {
  mock.store(on)
  let draft = ''
  let status: string | undefined = 'unset'
  let enhancerPressed = false
  let root = '/repo'
  on('session.root', async () => ({ value: root }))
  on('session.start', async (_$, e) => e as any)
  on('command.register', async () => ({ value: undefined }) as any)
  on('ui.status', async (_$, e) => {
    status = e.text
    return { value: undefined }
  })
  on('prompt.read', async () => ({ value: { text: draft, cursor: draft.length } }))
  on('prompt.fill', async (_$, e) => {
    draft = e.mode === 'append' ? draft + e.text : e.text
    return { isFilled: true, text: draft }
  })
  // stands in for another plugin's band (prompt-enhancer) beneath this one
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Button } = $.ui.resolve(e)
    return h(Button, { key: 'enhance', label: 'Enhance', onPress: () => { enhancerPressed = true } })
  })

  const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} }
  const start = () => $.session.start({ source: 'startup', cwd: root } as any)
  const mount = () => $.ui.mount({ plugin: 'idea-shelf', surface: 'terminal', component: 'AbovePrompt', props })

  await start()
  let ui = await mount()
  // an empty shelf draws nothing
  expect(await ui.find({ type: 'Button', text: /Send/ })).toBeUndefined()

  expect((await $.command.run({ command: 'ideas', args: '' } as any)).text).toBe('Nothing shelved.')
  expect((await $.command.run({ command: 'idea', args: 'test' } as any)).text).toBe('Shelved: test')
  await $.command.run({ command: 'idea', args: 'dark mode' } as any)
  expect(status).toBe('💡 2 shelved')
  expect((await $.command.run({ command: 'ideas', args: '' } as any)).text).toBe('2 shelved\nToday\n  💡 dark mode\n  💡 test')

  // restart in another project: the shelf is global, so both ideas come back
  root = '/other-repo'
  await start()
  expect(status).toBe('💡 2 shelved')
  ui = await mount()
  expect(await ui.find({ text: /dark mode/ })).toBeDefined()

  const sends = await ui.findAll({ type: 'Button', text: /Send/ })
  const discards = await ui.findAll({ type: 'Button', text: /Discard/ })
  expect(sends).toHaveLength(2)

  // newest first: 'dark mode' is the top row
  await ui.press({ key: sends[0]!.key! })
  expect(draft).toBe('dark mode')
  expect(status).toBe('💡 1 shelved')

  await ui.press({ key: discards[1]!.key! })
  expect(status).toBeUndefined()
  expect(draft).toBe('dark mode')

  // sending into a half-written prompt appends instead of replacing it
  draft = 'my draft'
  await $.command.run({ command: 'idea', args: 'more' } as any)
  ui = await mount()
  await ui.press({ key: (await ui.findAll({ type: 'Button', text: /Send/ }))[0]!.key! })
  expect(draft).toBe('my draft\nmore')

  await ui.press({ key: 'enhance', plugin: 'test' } as any)
  expect(enhancerPressed).toBe(true)
})

test('pre-0.2.0 per-project lists fold into the global shelf once', async ($, on) => {
  // a hand-rolled store so the test can read what the migration left behind
  const store = new Map<string, unknown>([
    ['/old-a', [{ id: 'a', text: 'from a' }]],
    ['/old-b', [{ id: 'b', text: 'from b' }]],
    ['ideas', [{ id: 'g', text: 'global' }]],
  ])
  let sets = 0
  on('store.get', async (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', async (_$, e) => { sets++; store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', async (_$, e) => { store.delete(e.key); return { value: undefined } })
  on('store.keys', async () => ({ value: [...store.keys()] }))
  let status: string | undefined
  on('session.root', async () => ({ value: '/repo' }))
  on('session.start', async (_$, e) => e as any)
  on('command.register', async () => ({ value: undefined }) as any)
  on('ui.status', async (_$, e) => { status = e.text; return { value: undefined } })

  await $.session.start({ source: 'startup', cwd: '/repo' } as any)
  expect(status).toBe('💡 3 shelved')
  expect([...store.keys()]).toEqual(['ideas'])
  expect((store.get('ideas') as any[]).map(i => i.text)).toEqual(['global', 'from a', 'from b'])

  // second start: nothing left to migrate, no write
  sets = 0
  await $.session.start({ source: 'startup', cwd: '/repo' } as any)
  expect(status).toBe('💡 3 shelved')
  expect(sets).toBe(0)
})

test('the shelf lists ideas grouped by age, newest first, with short titles; Send fills the full text', async ($, on) => {
  const now = Date.now()
  const DAY = 86_400_000
  const long = 'Claude mod: watch live sports in the terminal with a VPN login and ad stripping. Then more detail.'
  mock.store(on, {
    ideas: [
      { id: 'old', text: 'pre-0.3.0 idea without a date' },
      { id: 'wk', text: 'from three days ago', at: new Date(now - 3 * DAY).toISOString() },
      { id: 'new', text: long, at: new Date(now - 60_000).toISOString() },
    ],
  })
  let draft = ''
  on('session.root', async () => ({ value: '/repo' }))
  on('session.start', async (_$, e) => e as any)
  on('command.register', async () => ({ value: undefined }) as any)
  on('ui.status', async () => ({ value: undefined }))
  on('prompt.read', async () => ({ value: { text: draft, cursor: draft.length } }))
  on('prompt.fill', async (_$, e) => { draft = e.text; return { isFilled: true, text: draft } })
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, null, '')
  })

  const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} }
  await $.session.start({ source: 'startup', cwd: '/repo' } as any)
  const ui = await $.ui.mount({ plugin: 'idea-shelf', surface: 'terminal', component: 'AbovePrompt', props })

  const text = JSON.stringify(await ui.drawn())
  const order = ['Today', 'Claude mod: watch live sports in the terminal with a VPN lo…', 'This week', 'from three days ago', 'Older', 'pre-0.3.0 idea without a date']
  const at = order.map(s => text.indexOf(s))
  expect(at.every(i => i >= 0)).toBe(true)
  expect([...at].sort((a, b) => a - b)).toEqual(at)
  expect(text.includes('Then more detail')).toBe(false)

  await ui.press({ key: 'send-new' })
  expect(draft).toBe(long)
  expect(await ui.find({ text: /three days ago/ })).toBeDefined()
})
