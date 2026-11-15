// Pure helpers for the park note: no host calls, so the tests can import them directly.

// The ten headings every note carries, in this order.
export const HEADINGS = [
  'Goal',
  'Done',
  'Open',
  'First step',
  'Decisions and why',
  'Ruled out',
  'Files read and edited',
  'Skills and tools used',
  'Sources and links',
  'Verify command',
] as const

export const FACTS_HEADING = '## Facts (from code, not from the model)'

export const parkPrompt = (noteDir: string, tabList: string) =>
  [
    'Park this session.',
    '1. Save your own work now: finish or write down anything unsaved. Ask nothing.',
    `2. Write the start prompt for the next session to the ${noteDir}/ folder of this project as park-<topic>.md. Use exactly these ten headings, in this order, and write "none" under any that is empty:`,
    ...HEADINGS.map((h, i) => `   ${i + 1}. ${h}`),
    '   Write each heading as a "## " line. Under "Ruled out", name what was tried and dropped so the next session does not repeat it. Under "Verify command", give one command that shows the work is right.',
    '3. Reply with the file path and one line per agent tab.',
    tabList === '' ? 'There are no other agent tabs.' : `Agent tabs after /park:\n${tabList}`,
  ].join('\n')

// The first prompt of the next chat.
export const seedLine = (noteDir: string, note: string) => `Read ${noteDir}/${note} and follow it.`

type Edit = { tool: string; input: Record<string, unknown> }
type Msg = { role: string; text: string; toolUses: readonly Edit[]; toolResults?: readonly unknown[] }

const EDITING = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// Files the session changed, once each, in the order they were first changed.
export function editedFiles(messages: readonly Msg[]): string[] {
  const files = new Set<string>()
  for (const m of messages) {
    for (const u of m.toolUses ?? []) {
      const f = u.input?.file_path ?? u.input?.notebook_path
      if (EDITING.has(u.tool) && typeof f === 'string') files.add(f)
    }
  }

  return [...files]
}

// The person's last `count` prompts, word for word. Tool results, the park request itself and
// the seed line are not prompts.
export function lastPrompts(messages: readonly Msg[], count: number): string[] {
  return messages
    .filter(m => m.role === 'user' && (m.toolResults?.length ?? 0) === 0 && m.text.trim() !== '')
    .map(m => m.text.trim())
    .filter(t => !t.startsWith('Park this session.') && !/^Read \S+ and follow it\.$/.test(t))
    .slice(-count)
}

// Each part is optional: a part that could not be read is left out and the rest still go in.
export function factsBlock(parts: { files?: string[]; git?: string; prompts?: string[] }): string {
  const out = ['', FACTS_HEADING]
  if (parts.files !== undefined) {
    out.push('', '### Files edited this session', ...(parts.files.length === 0 ? ['none'] : parts.files.map(f => `- ${f}`)))
  }
  if (parts.git !== undefined) {
    out.push('', '### git status --short', '```', parts.git.trimEnd() === '' ? '(clean)' : parts.git.trimEnd(), '```')
  }
  if (parts.prompts !== undefined) {
    out.push('', '### Last prompts, word for word')
    parts.prompts.forEach((p, i) => out.push('', `${i + 1}.`, ...p.split('\n').map(l => `> ${l}`)))
    if (parts.prompts.length === 0) out.push('none')
  }

  return `${out.join('\n')}\n`
}
