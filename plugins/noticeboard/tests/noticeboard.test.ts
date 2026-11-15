import { expect, test } from 'claude-code/testing'

const TOOL = 'mcp__noticeboard__pin'
const TABLE = '| Option | New code |\n|---|---|\n| Tool | ~60 lines |'

function engine(on: any, registered: string[]) {
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
  on('tool.register', ($: any, e: any) => {
    registered.push(e.name)
    return { value: { tool: `mcp__noticeboard__${e.name}` } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
}

// The module's memory outlives a test, so each starts from /board off
async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' } as any)
  await $.command.run({ command: 'board', args: 'off' } as any)
}

const pane = (surface: 'terminal' | 'desktop') => ({
  plugin: 'noticeboard',
  surface,
  component: 'Pane',
  requestId: 'noticeboard',
  props: { title: 'Notice board', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: {}, view: {} },
})

test('no pin tool until /board send; pins count up; /board send off refuses', async ($, on) => {
  const registered: string[] = []
  engine(on, registered)
  await start($)
  expect(registered).toEqual([])

  await $.command.run({ command: 'board', args: 'send' } as any)
  expect(registered).toEqual(['pin'])
  expect((await $.tool.call({ tool: TOOL, title: 'Options', markdown: TABLE } as any)).result).toContain('1 of 1')
  expect((await $.tool.call({ tool: TOOL, title: 'Summary', markdown: 'Three lines.' } as any)).result).toContain('2 of 2')

  await $.command.run({ command: 'board', args: 'send off' } as any)
  expect((await $.tool.call({ tool: TOOL, title: 'Late', markdown: 'x' } as any)).result).toContain('/board send')
})

test('the board shows the newest pin, and Older goes back one', async ($, on) => {
  engine(on, [])
  await start($)
  await $.command.run({ command: 'board', args: 'send' } as any)
  await $.tool.call({ tool: TOOL, title: 'First pin', markdown: TABLE } as any)
  await $.tool.call({ tool: TOOL, title: 'Second pin', markdown: 'Three lines.' } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(pane(surface) as any)
    expect(await ui.find({ type: 'Text', text: 'Pinned · 2 of 2' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Second pin' })).toBeDefined()
    expect(await ui.find({ key: 'older' })).toBeDefined()
    expect(await ui.find({ key: 'newer' })).toBeUndefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount(pane('terminal') as any)
  await ui.press({ key: 'older' })
  expect(await ui.find({ type: 'Text', text: 'First pin' })).toBeDefined()
  expect(await ui.find({ key: 'newer' })).toBeDefined()
  await ui.unmount()
})

test('/board off forgets the pins and stops pinning', async ($, on) => {
  engine(on, [])
  await start($)
  await $.command.run({ command: 'board', args: 'send' } as any)
  await $.tool.call({ tool: TOOL, title: 'Options', markdown: TABLE } as any)
  await $.command.run({ command: 'board', args: 'off' } as any)
  expect((await $.tool.call({ tool: TOOL, title: 'Late', markdown: 'x' } as any)).result).toContain('/board send')
  const ui = await $.ui.mount(pane('terminal') as any)
  expect(await ui.find({ type: 'Text', text: /Nothing pinned yet/ })).toBeDefined()
  await ui.unmount()
})
