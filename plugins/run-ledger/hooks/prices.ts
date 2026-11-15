import type { Usage } from '../types'

// List prices in USD per million tokens, read on the date below from
// https://platform.claude.com/docs/en/about-claude/pricing and https://docs.typesafe.ai/models.md.
// When a price changes, edit the row and the date together.
export const PRICES_AS_OF = '2026-10-03'

type Price = { match: RegExp; input: number; output: number; cacheRead: number; cacheWrite: number }

// First match wins, so a narrower id sits above the wider one.
// ponytail: usage does not split cache writes by lifetime, so every write is priced at the
// 1-hour rate (the dearer one). Split it here if the engine ever reports the two apart.
// A bare alias (`haiku`) is priced as the newest model of that family.
const PRICES: Price[] = [
  { match: /(fable|mythos)-5-1/, input: 10, output: 50, cacheRead: 0.25, cacheWrite: 20 },
  { match: /(fable|mythos)-5/, input: 10, output: 50, cacheRead: 1, cacheWrite: 20 },
  { match: /opus-5-5|^opus$/, input: 4, output: 20, cacheRead: 0.2, cacheWrite: 8 },
  { match: /opus-(5|4-[5-8])/, input: 5, output: 25, cacheRead: 0.5, cacheWrite: 10 },
  { match: /sonnet-5|^sonnet$/, input: 2, output: 10, cacheRead: 0.2, cacheWrite: 4 },
  { match: /sonnet-4-[56]/, input: 3, output: 15, cacheRead: 0.3, cacheWrite: 6 },
  { match: /haiku-4-5|^haiku$/, input: 1, output: 5, cacheRead: 0.1, cacheWrite: 2 },
  { match: /^jev-/, input: 0.042, output: 0, cacheRead: 0, cacheWrite: 0 },
]

export const priceOf = (model: string) => PRICES.find(p => p.match.test(model))

// An API estimate in USD, or null for a model with no dated price.
export function cost(model: string, u: Usage): number | null {
  const p = priceOf(model)
  if (p === undefined) return null
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6
}
