import { expect, test } from 'claude-code/testing'

// The engine side of the guard: an allowed command reaches the tool, a refused
// one never does and comes back as a deny carrying the reason. The rules
// themselves are checked against the real shell by tests/real-shell.mjs.

const ok = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

test('a delete in a temp folder runs; a delete in the project is refused', async ($, on) => {
  let ran = 0
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.root', () => ({ value: '/repo' }))
  // Stands for bash printing the real path of each path rm would reach
  on('process.run', ($, e) => ok(e.argv.includes('/tmp/out') ? '/private/tmp/out\n' : '/repo/src/app.py\n'))
  on('tool.call', () => {
    ran += 1

    return { result: 'ran' }
  })

  const allowed = await $.tool.call({ tool: 'Bash', command: 'rm -rf /tmp/out' })
  expect(allowed.deny).toBeUndefined()
  expect(ran).toBe(1)

  const refused = await $.tool.call({ tool: 'Bash', command: 'rm -f src/app.py' })
  expect(refused.deny).toContain('Strict Guard refused this command')
  expect(refused.deny).toContain('/repo/src/app.py')
  expect(ran).toBe(1)
})

test('a command with nothing destructive in it is never measured', async ($, on) => {
  let measured = 0
  on('process.run', () => {
    measured += 1

    return ok('')
  })
  on('tool.call', () => ({ result: 'ran' }))

  await $.tool.call({ tool: 'Bash', command: 'ls -la && git status' })
  expect(measured).toBe(0)
})

test('a delete hidden behind &, $( ), bash -c or xargs is refused', async ($, on) => {
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.root', () => ({ value: '/repo' }))
  on('process.run', () => ok('/work/me\n'))
  on('tool.call', () => ({ result: 'ran' }))

  for (const command of ['true & rm -rf ~', 'echo $(rm -rf ~)', "bash -c 'rm -rf ~'", 'ls | xargs rm', 'git stash drop']) {
    const refused = await $.tool.call({ tool: 'Bash', command })
    expect(refused.deny).toContain('Strict Guard refused this command')
  }
})
