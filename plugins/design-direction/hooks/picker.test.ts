import { expect, test } from 'claude-code/testing'

test('HTML previews go to a browser page and the dialog gets a short note', async ($, on) => {
  let written = ''
  let opened: readonly string[] = []
  let seen: any = null
  on('fs.write', async (_$, e) => {
    written = e.text
    return { value: undefined }
  })
  on('process.run', async (_$, e) => {
    opened = e.argv
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    seen = e
    return { result: 'ok' }
  })

  await $.tool.call({
    tool: 'AskUserQuestion',
    questions: [
      {
        question: 'Which design direction fits your library site?',
        header: 'Direction',
        multiSelect: false,
        options: [
          { label: 'Classic Editorial', description: 'Serif, cream', preview: '<div style="font-family:serif">Read "more"</div>' },
          { label: 'Archive Brutalist', description: 'Mono, black', preview: '<section>READ</section>' },
        ],
      },
      {
        question: 'Which database?',
        header: 'DB',
        multiSelect: false,
        options: [
          { label: 'Postgres', description: 'SQL', preview: 'CREATE TABLE x' },
          { label: 'SQLite', description: 'file' },
        ],
      },
    ],
  } as any)

  expect(opened[0]).toBe('open')
  expect(written).toContain('srcdoc="<div')
  expect(written).toContain('Read &quot;more&quot;')
  expect(written).toContain('<b>2</b> Archive Brutalist')
  expect(seen.questions[0].options[0].preview).toContain('Rendered in your browser')
  expect(seen.questions[1].options[0].preview).toBe('CREATE TABLE x')
})

test('previews are sandboxed, any leading tag counts as HTML, and a failed open is reported', async ($, on) => {
  let written = ''
  let seen: any = null
  on('fs.write', async (_$, e) => {
    written = e.text
    return { value: undefined }
  })
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: 'no browser', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    seen = e
    return { result: 'ok' }
  })

  await $.tool.call({
    tool: 'AskUserQuestion',
    questions: [
      {
        question: 'Which direction?',
        header: 'Direction',
        multiSelect: false,
        options: [
          { label: 'A', description: 'nav first', preview: '<nav>A</nav>' },
          { label: 'B', description: 'plain', preview: '<p>B</p>' },
        ],
      },
    ],
  } as any)

  expect(written).toContain('<iframe sandbox=""')
  const note = seen.questions[0].options[1].preview
  expect(note).not.toContain('Rendered in your browser')
  expect(note).toContain('could not open')
})

test('before a new batch, only this mod\'s own day-old mockups are deleted', async ($, on) => {
  const now = Date.now()
  const entry = (name: string, age: number) => ({ name, kind: 'file', size: 1, mtimeMs: now - age, isLink: false })
  const day = 86_400_000
  const ran: (readonly string[])[] = []
  on('fs.list', async () => ({ value: [entry('1-0.html', 2 * day), entry('2-1.html', 1000), entry('notes.html', 2 * day), entry('3-0.txt', 2 * day)] }) as any)
  on('fs.write', async () => ({ value: undefined }))
  on('process.run', async (_$, e) => {
    ran.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ result: 'ok' }))

  await $.tool.call({
    tool: 'AskUserQuestion',
    questions: [{ question: 'Which?', header: 'D', multiSelect: false, options: [{ label: 'A', description: 'a', preview: '<p>A</p>' }] }],
  } as any)

  expect(ran[0]).toEqual(['rm', '-f', '/tmp/design-direction/1-0.html'])
})
