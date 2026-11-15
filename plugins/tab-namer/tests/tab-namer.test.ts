import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const OK = { exitCode: 0, stderr: '', signal: null, timedOut: false }
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const TURN = { answer: 'The band shows two pills.', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as const

// Stands for herdr: answers `tab get` with the tab's label, starting from the one given; records every `tab rename`.
// `relabel` is the saved on/off setting; `inHerdr` false leaves out the variables herdr sets.
// `space` puts the tab in workspace w1 with that name ('junk': herdr answers for it with something unreadable); `spaces` records every `workspace rename`.
const host = (on: On, label: string, o: { reply?: string; relabel?: boolean; inHerdr?: boolean; herdr?: 'throws' | 'junk' | 'fails'; space?: string } = {}) => {
  const runs: string[][] = []
  const tab = { label }
  const space = { label: o.space }
  const renames: string[] = []
  const spaces: string[] = []
  const toasts: string[] = []
  const asked: string[] = []
  const saved: Record<string, unknown> = { relabel: o.relabel ?? true }
  on('turn.complete', () => ({ text: 'done' }))
  on('model.complete', (_, e) => {
    asked.push(e.prompt)
    return { value: { isAnswered: true, text: o.reply ?? '', usage: USAGE } }
  })
  mock.env(on, o.inHerdr === false ? {} : { HERDR_SESSION: 'main', HERDR_TAB_ID: 'w1:t1' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('command.register', (_, e) => ({ value: { command: e.name } }) as never)
  on('store.get', (_, e) => ({ value: saved[e.key] }) as never)
  on('store.set', (_, e) => {
    saved[e.key] = e.value
    return { value: undefined } as never
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    const argv = e.argv
    runs.push([...argv])
    if (o.herdr === 'throws') throw new Error('spawn herdr ENOENT')
    if (o.herdr === 'fails') return { value: { ...OK, exitCode: 1, stdout: '' } }
    if (argv[3] === 'tab' && argv[4] === 'get') {
      if (o.herdr === 'junk') return { value: { ...OK, stdout: 'not json' } }
      const workspace_id = o.space === undefined ? undefined : 'w1'
      return { value: { ...OK, stdout: JSON.stringify({ result: { tab: { tab_id: 'w1:t1', label: tab.label, number: 4, workspace_id } } }) } }
    }
    if (argv[3] === 'workspace' && argv[4] === 'get') {
      if (o.space === 'junk') return { value: { ...OK, stdout: 'not json' } }
      return { value: { ...OK, stdout: JSON.stringify({ result: { workspace: { workspace_id: 'w1', label: space.label } } }) } }
    }
    if (argv[3] === 'workspace' && argv[4] === 'rename') {
      spaces.push(`${argv[5]} ${argv[6]}`)
      space.label = argv[6]
    }
    if (argv[3] === 'tab' && argv[4] === 'rename') {
      renames.push(`${argv[5]} ${argv[6]}`)
      tab.label = argv[6]
    }

    return { value: { ...OK, stdout: '' } }
  })

  return { renames, spaces, toasts, asked, tab, space, runs, saved }
}

type Engine = Parameters<Parameters<typeof test>[1]>[0]
const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const submit = ($: Engine, text: string) => $.prompt.submit({ text })

test('the first real prompt names an unlabelled tab with the task alone; slash commands and later prompts do not', async ($, on) => {
  const seen = host(on, '1')
  await $.session.start(START)

  await submit($, '/unattended')
  expect(seen.renames).toEqual([])

  await submit($, '  fix   the login page\nbug and rerun the tests on the staging site please  ')
  expect(seen.renames).toEqual(['w1:t1 fix the login page bug'])
  expect(seen.toasts[0]).toContain('Tab named')

  await submit($, 'now something else')
  expect(seen.renames).toHaveLength(1)
})

test('a tab somebody labelled keeps its name and is not asked about', async ($, on) => {
  const seen = host(on, 'orchestration', { reply: 'cost band' })
  await $.session.start(START)
  await submit($, 'what is cost band?')
  await $.turn.complete(TURN)
  expect(seen.asked).toEqual([])
  expect(seen.renames).toEqual([])
})

test('a tab relabelled by somebody after it was named is theirs from then on', async ($, on) => {
  const seen = host(on, '1', { reply: 'cost band' })
  await $.session.start(START)
  await submit($, 'what is cost band?')
  seen.tab.label = 'my own name'
  await $.turn.complete(TURN)
  expect(seen.asked).toEqual([])
  expect(seen.renames).toEqual(['w1:t1 what is cost band'])
})

test('after a turn the small model relabels the tab from the recent prompts', async ($, on) => {
  const seen = host(on, '1', { reply: ' "Cost band mod review"\n' })
  await $.session.start(START)
  await submit($, 'what is cost band?')
  await $.turn.complete(TURN)
  expect(seen.renames).toEqual(['w1:t1 what is cost band', 'w1:t1 Cost band mod review'])
  expect(seen.asked[0]).toContain('Current label: what is cost band')
  expect(seen.asked[0]).toContain('- what is cost band?')
  expect(seen.asked[0]).toContain('The band shows two pills.')
})

test('the same label back, a subagent turn and an interrupted turn rename nothing more', async ($, on) => {
  const same = host(on, '1', { reply: 'what is cost band' })
  await $.session.start(START)
  await submit($, 'what is cost band?')
  await $.turn.complete(TURN)
  await $.turn.complete({ ...TURN, agentId: 'a1' })
  await $.turn.complete({ ...TURN, isAborted: true, reason: 'aborted' })
  expect(same.renames).toEqual(['w1:t1 what is cost band'])
  expect(same.asked).toHaveLength(1)
})

test('a slash command names the tab from its arguments; a bare one does not', async ($, on) => {
  const seen = host(on, '1')
  await $.session.start(START)
  await submit($, '/model')
  expect(seen.renames).toEqual([])

  await submit($, '/superpowers:brainstorming tab-namer how to improve it')
  expect(seen.renames).toEqual(['w1:t1 tab-namer how to improve it'])
})

test('the first label drops opening filler and keeps five words with their case', async ($, on) => {
  const seen = host(on, '1')
  await $.session.start(START)
  await submit($, 'Please, can you fix the login page bug and rerun the tests?')
  expect(seen.renames).toEqual(['w1:t1 fix the login page bug'])
})

test('a first label over 40 characters is cut at a word break', async ($, on) => {
  const seen = host(on, '1')
  await $.session.start(START)
  await submit($, 'refactor supercalifragilistic orchestration dispatcher internals')
  expect(seen.renames).toEqual(['w1:t1 refactor supercalifragilistic'])
})

test('a prompt that is all filler names nothing', async ($, on) => {
  const seen = host(on, '1')
  await $.session.start(START)
  await submit($, 'please')
  expect(seen.renames).toEqual([])
})

test('Haiku is asked after the first turn, then once three more prompts have come in', async ($, on) => {
  const seen = host(on, '1', { reply: 'x' })
  await $.session.start(START)
  for (const p of ['one', 'two', 'three', 'four']) {
    await submit($, p)
    await $.turn.complete(TURN)
  }
  expect(seen.asked).toHaveLength(2)
  expect(seen.asked[1]).toContain('- four')
})

test('the small model is not asked until relabelling is turned on', async ($, on) => {
  const seen = host(on, '1', { reply: 'cost band review', relabel: false })
  await $.session.start(START)
  await submit($, 'what is cost band?')
  await $.turn.complete(TURN)
  expect(seen.asked).toEqual([])
  expect(seen.renames).toEqual(['w1:t1 what is cost band'])
})

test('/tab-namer on and off switch relabelling and say which it is', async ($, on) => {
  const seen = host(on, '1', { relabel: false })
  await $.session.start(START)
  expect((await $.command.run({ command: 'tab-namer', args: '' })).text).toContain('is off')
  expect((await $.command.run({ command: 'tab-namer', args: 'on' })).text).toContain('is on')
  expect(seen.saved.relabel).toBe(true)
  expect((await $.command.run({ command: 'tab-namer', args: 'off' })).text).toContain('is off')
  expect(seen.saved.relabel).toBe(false)
})

test('outside herdr nothing is run, written or asked', async ($, on) => {
  const seen = host(on, '1', { reply: 'cost band review', inHerdr: false })
  await $.session.start(START)
  await submit($, 'what is cost band?')
  await $.turn.complete(TURN)
  expect(seen.runs).toEqual([])
  expect(seen.renames).toEqual([])
  expect(seen.asked).toEqual([])
  expect(seen.toasts).toEqual([])
})

for (const herdr of ['throws', 'junk', 'fails'] as const) {
  test(`when herdr ${herdr}, the prompt and the turn go through and nothing is renamed`, async ($, on) => {
    const seen = host(on, '1', { reply: 'cost band review', herdr })
    await $.session.start(START)
    await submit($, 'what is cost band?')
    await $.turn.complete(TURN)
    expect(seen.renames).toEqual([])
    expect(seen.asked).toEqual([])
  })
}

test('a tab that is not ours is not looked up again until new prompts come in', async ($, on) => {
  const seen = host(on, 'orchestration')
  await $.session.start(START)
  await submit($, 'one')
  await $.turn.complete(TURN)
  const gets = () => seen.runs.filter(a => a[4] === 'get').length
  const before = gets()
  await $.turn.complete(TURN)
  expect(gets()).toBe(before)
})

const REPO = { ...START, cwd: '/work/repo' } as const

test('a workspace still named after its folder follows the tab, at the first name and at each relabel', async ($, on) => {
  const seen = host(on, '1', { reply: 'cost band review', space: 'repo' })
  await $.session.start(REPO)
  await submit($, 'what is cost band?')
  expect(seen.spaces).toEqual(['w1 what is cost band'])
  await $.turn.complete(TURN)
  expect(seen.spaces).toEqual(['w1 what is cost band', 'w1 cost band review'])
  expect(seen.renames).toEqual(['w1:t1 what is cost band', 'w1:t1 cost band review'])
})

test('a workspace somebody named keeps its name', async ($, on) => {
  const theirs = host(on, '1', { space: 'wave 23' })
  await $.session.start(REPO)
  await submit($, 'what is cost band?')
  expect(theirs.renames).toEqual(['w1:t1 what is cost band'])
  expect(theirs.spaces).toEqual([])
})

test('a workspace renamed by somebody after the mod named it is theirs from then on', async ($, on) => {
  const seen = host(on, '1', { reply: 'cost band review', space: 'repo' })
  await $.session.start(REPO)
  await submit($, 'what is cost band?')
  seen.space.label = 'my own space'
  await $.turn.complete(TURN)
  expect(seen.renames).toEqual(['w1:t1 what is cost band', 'w1:t1 cost band review'])
  expect(seen.spaces).toEqual(['w1 what is cost band'])
})

test('when herdr does not answer for the workspace, the tab is still named', async ($, on) => {
  const seen = host(on, '1', { space: 'junk' })
  await $.session.start(REPO)
  await submit($, 'what is cost band?')
  expect(seen.renames).toEqual(['w1:t1 what is cost band'])
  expect(seen.spaces).toEqual([])
})

test('a tab herdr has labelled with the shell name counts as unlabelled', async ($, on) => {
  const seen = host(on, 'zsh', { space: 'repo' })
  await $.session.start(REPO)
  await submit($, 'what is cost band?')
  expect(seen.renames).toEqual(['w1:t1 what is cost band'])
  expect(seen.spaces).toEqual(['w1 what is cost band'])
})
