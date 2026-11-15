import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const asks = atom({ plugin: 'layman', key: 'asks' } as const, 0)

// Longer prompts that mention these words are usually about something else.
const MAX_CHARS = 200

// Covers the spellings seen in the transcripts: "didt", "didit", "understadn", "undersatnd".
const TRIGGER =
  /\blay\s?man\b|\b(i'?m|i am) lost\b|\b(did not|didn'?t|didt|didit|do not|don'?t)\s+unders(?:t?an|tad|atn)\w*|explain (it |that |this )?again/i

// A pasted document plus a request to explain it. Long pastes are fine here: the length cap is for plain asks.
const DOC_NOUN =
  /\b(contract|agreement|lease|tenancy|nda|non-disclosure|offer letter|job offer|employment offer|freelance|loan|terms (of (service|use)|and conditions)|privacy policy|clause)\b/i

const DOC_ASK =
  /\b(explain|break (it|this|that) down|translate|read (this|it)|review (this|it)|what (does|do|is) (this|it|that)|what (am|do) i (sign|agree)|is (this|it) (\w+ ){0,3}(fair|normal|standard|legal|safe))\b/i

const DOCUMENT = [
  'The user asked you to explain a document. If the message does not name the document type or their role, infer both from the text and state the assumption in one line.',
  'Use only what the text says. If a section is absent, say so. Do not invent clauses.',
  'Open with the single most important thing, in one plain sentence.',
  'Then give five numbered sections in tight bullets, everyday words, no legalese:',
  '1) Plain-English summary, section by section if long.',
  '2) Red flags, most to least concerning, with the real-world consequence of each.',
  '3) Unusual terms, and what the normal version usually looks like.',
  '4) Missing protections a fair version would include for their side.',
  '5) Five smart questions to ask the other party before signing.',
  'Quote the clause or give its number beside each point.',
  'Close with: general information, not legal advice; see a licensed professional for anything high-stakes.',
].join(' ')

const EXPLAIN = [
  'The user asked for a plain explanation.',
  'If their message names no topic, re-explain your previous reply only; otherwise answer what it asks.',
  'Rules for this reply: everyday words from the first line. One idea.',
  'Say what any working term means in the same sentence, or leave the term out.',
  'Use one real example from the work in hand (a real row, file or number) and one everyday comparison.',
  'Number the steps if there is a sequence. No findings tables and no new topics.',
  'End with at most one yes-or-no question, with your pick stated.',
].join(' ')

const STICKY =
  'The user has asked for plain explanations more than once this session. Write this reply in everyday words from the first line, and say what any working term means in the same sentence.'

// Plain mode is on from the second ask; /layman sets the count to this or to 0.
const ON = 2

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'layman',
      description: 'Switch plain mode on or off: /layman on, /layman off, or /layman to flip it',
      immediate: true,
    })

    return next(e)
  })

  on('command.run', { command: 'layman' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const isOn = arg === 'on' || (arg !== 'off' && (await read($, asks)) < ON)
    await update($, asks, () => (isOn ? ON : 0))
    $.ui.status(isOn ? 'plain mode' : undefined)

    return { text: isOn ? 'Plain mode on.' : 'Plain mode off.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const isDoc = DOC_NOUN.test(e.text) && DOC_ASK.test(e.text)
    const isAsk = !isDoc && e.text.length <= MAX_CHARS && TRIGGER.test(e.text)
    const wasPlain = (await read($, asks)) >= ON

    if (isAsk) {
      await update($, asks, n => n + 1)
    }

    const isPlain = (await read($, asks)) >= ON

    // The status stays pinned, so it is set only when plain mode comes on.
    if (isPlain && !wasPlain) {
      $.ui.status('plain mode')
    }

    const note = isDoc ? DOCUMENT : isAsk ? EXPLAIN : isPlain ? STICKY : null

    return note === null ? next(e) : next({ ...e, context: [...(e.context ?? []), note] })
  })
}
