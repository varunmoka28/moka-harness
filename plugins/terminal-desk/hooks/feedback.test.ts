import { expect, mock, test } from 'claude-code/testing'

const DRAFT = { title: 'pane broke', type: 'bug', details: '- **What happened:** x' }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a feedback draft is kept in the desk pane; s sends it once on ${surface}`, async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on)
    const sent: unknown[] = []
    on('ui.open', async () => ({ value: { isPlaced: true } }) as any)
    on('ui.log', async () => ({ value: undefined }) as any)
    on('session.start', async (_$, e) => e as any)
    on('command.register', async () => ({ value: undefined }) as any)
    on('tool.register', async () => ({ value: undefined }) as any)
    on('tool.call', { tool: 'SendFeedback' }, async (_$, e) => (sent.push(e), { result: 'sent' }) as any)
    on('env.get', async () => ({ value: undefined }) as any)
    on('fs.list', async () => ({ value: [] }) as any)

    await $.session.start({ source: 'startup', cwd: '/repo', isInteractive: true } as any)
    const kept = await $.tool.call({ tool: 'SendFeedback', ...DRAFT } as any)
    expect(kept.deny).toBeDefined()
    expect(sent).toEqual([])

    const ui = await $.ui.mount({ plugin: 'terminal-desk', surface, component: 'Pane', requestId: 'desk', props: { bodyColumns: 80, maxRows: 80 } } as any)
    expect(await ui.find({ text: /pane broke/ })).toBeDefined()
    await ui.press({ key: 'feedback-send' })
    expect(sent.length).toBe(1)
    expect(await ui.find({ text: /pane broke/ })).toBeUndefined()
  })
}
