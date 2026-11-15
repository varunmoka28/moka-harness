import { expect, mock, test } from 'claude-code/testing'

test('Enhance rewrites the draft with rules and Jev skills, Undo restores it', async ($, on) => {
  mock.env(on, { CLAUDE_PLUGIN_ROOT: '/plugin', TYPESAFE_API_KEY: 'k' })
  let draft = 'add dark mode'
  let modelPrompt = ''
  on('prompt.read', async () => ({ value: { text: draft, cursor: draft.length } }))
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => h($.ui.resolve(e).Box, {}))
  on('prompt.fill', async (_$, e) => {
    draft = e.text
    return { isFilled: true, text: draft }
  })
  on('session.cwd', async () => ({ value: '/repo' }))
  on('fs.ancestors', async () => ({ value: [{ dir: '/repo', name: 'CLAUDE.md', content: 'Use pnpm.', parts: [] }] }))
  on('fs.list', async () => ({ value: [] }))
  let ran: { argv: unknown; env: unknown; stdin: unknown } | null = null
  on('process.run', async (_$, e) => { ran = { argv: e.argv, env: e.init?.env, stdin: e.init?.stdin }
    return { value: {
    exitCode: 0,
    stderr: '',
    isStdoutTruncated: false,
    isStderrTruncated: false,
    stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: 'Skills:\n- `antislop-ui` (0.81): UI rules' } }),
  } } })
  on('model.complete', async (_$, e) => {
    modelPrompt = String(e.prompt)
    return { value: { isAnswered: true, text: 'Add a dark mode toggle.\nDone means: pnpm build passes.', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })

  const ui = await $.ui.mount({
    plugin: 'prompt-enhancer',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })

  await ui.press({ key: 'enhance' })
  expect(modelPrompt).toContain('Use pnpm.')
  expect(modelPrompt).toContain('antislop-ui')
  expect(modelPrompt).toContain('add dark mode')
  expect(draft).toBe('Add a dark mode toggle.\nDone means: pnpm build passes.')
  expect(ran).toMatchObject({ argv: ['python3', '/plugin/hooks/jev-skill-router.py'], env: { TYPESAFE_API_KEY: 'k' } })

  await ui.press({ key: 'undo' })
  expect(draft).toBe('add dark mode')
})

test('Enhance sends recent prompts and the last reply with the draft', async ($, on) => {
  mock.env(on, { CLAUDE_PLUGIN_ROOT: '/plugin', TYPESAFE_API_KEY: 'k' })
  let draft = 'why does it not show the next steps'
  let modelPrompt = ''
  on('prompt.read', async () => ({ value: { text: draft, cursor: draft.length } }))
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => h($.ui.resolve(e).Box, {}))
  on('prompt.fill', async (_$, e) => {
    draft = e.text
    return { isFilled: true, text: draft }
  })
  on('session.cwd', async () => ({ value: '/repo' }))
  on('fs.ancestors', async () => ({ value: [] }))
  on('fs.list', async () => ({ value: [] }))
  on('process.run', async () => ({ value: { exitCode: 1, stderr: '', stdout: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('model.complete', async (_$, e) => {
    modelPrompt = String(e.prompt)
    return { value: { isAnswered: true, text: 'rewritten', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('prompt.submit', async (_$, e) => ({ text: e.text }))

  await $.prompt.submit({ text: 'build the prompt enhancer mod', wait: false, origin: { kind: 'composer' } }).catch(() => undefined)

  const ui = await $.ui.mount({
    plugin: 'prompt-enhancer',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })
  expect((await ui.find({ key: 'enhance' }))).toBeDefined()

  await ui.press({ key: 'enhance' })
  expect(modelPrompt).toContain('User: build the prompt enhancer mod')
  expect(modelPrompt).toContain('why does it not show the next steps')
})

const mountBand = ($: any) =>
  $.ui.mount({
    plugin: 'prompt-enhancer',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })

const answered = (text: string) => ({ value: { isAnswered: true, text, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })

test('Enhance still rewrites when the router prints something that is not JSON', async ($, on) => {
  mock.env(on, { CLAUDE_PLUGIN_ROOT: '/plugin', TYPESAFE_API_KEY: 'k' })
  let draft = 'add dark mode'
  on('prompt.read', async () => ({ value: { text: draft, cursor: draft.length } }))
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => h($.ui.resolve(e).Box, {}))
  on('prompt.fill', async (_$, e) => {
    draft = e.text
    return { isFilled: true, text: draft }
  })
  on('session.cwd', async () => ({ value: '/repo' }))
  on('fs.ancestors', async () => ({ value: [] }))
  on('fs.list', async () => ({ value: [] }))
  on('process.run', async () => ({ value: { exitCode: 0, stderr: '', stdout: 'Traceback: boom', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('model.complete', async () => answered('rewritten'))

  const ui = await mountBand($)
  await ui.press({ key: 'enhance' })
  expect(draft).toBe('rewritten')
})

test('Enhance leaves the prompt alone when it was edited during the wait', async ($, on) => {
  mock.env(on, { CLAUDE_PLUGIN_ROOT: '/plugin', TYPESAFE_API_KEY: 'k' })
  let draft = 'add dark mode'
  on('prompt.read', async () => ({ value: { text: draft, cursor: draft.length } }))
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => h($.ui.resolve(e).Box, {}))
  on('prompt.fill', async (_$, e) => {
    draft = e.text
    return { isFilled: true, text: draft }
  })
  on('session.cwd', async () => ({ value: '/repo' }))
  on('fs.ancestors', async () => ({ value: [] }))
  on('fs.list', async () => ({ value: [] }))
  on('process.run', async () => ({ value: { exitCode: 1, stderr: '', stdout: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('model.complete', async () => {
    draft = 'add dark mode and a toggle I just typed'
    return answered('rewritten')
  })

  const ui = await mountBand($)
  await ui.press({ key: 'enhance' })
  expect(draft).toBe('add dark mode and a toggle I just typed')
})

test('Without a key Enhance does nothing and says so once', async ($, on) => {
  mock.env(on, { CLAUDE_PLUGIN_ROOT: '/plugin' })
  let draft = 'add dark mode'
  const toasts: string[] = []
  let calls = 0
  on('prompt.read', async () => ({ value: { text: draft, cursor: draft.length } }))
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => h($.ui.resolve(e).Box, {}))
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.cwd', async () => ({ value: '/repo' }))
  on('process.run', async () => {
    calls += 1
    throw new Error('must not run')
  })
  on('model.complete', async () => {
    calls += 1
    return answered('rewritten')
  })

  const ui = await mountBand($)
  await ui.press({ key: 'enhance' })
  await ui.press({ key: 'enhance' })
  expect(draft).toBe('add dark mode')
  expect(calls).toBe(0)
  expect(toasts.length).toBe(1)
})
