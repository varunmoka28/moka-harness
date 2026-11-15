import type { EngineInterface, Register } from 'claude-code'

const GUIDE = `When you ask the user to choose a visual design direction or style (for a site, app, page or component), use AskUserQuestion with 2 to 4 distinct directions. Give every option a "preview" that is a complete, self-contained HTML mockup of that direction applied to the user's actual project: a realistic hero or key screen with its own fonts, colors and layout, all CSS inline in a <style> tag, no scripts, no external images. Keep each under about 6 KB. A plugin renders these side by side in the user's browser. Only do this for visual design choices.`

const isHtml = (s?: string) => !!s && /^\s*<[a-z!]/i.test(s)

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
const text = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

type Option = { label: string; description: string; preview?: string }

export function page(question: string, options: readonly Option[]): string {
  const cards = options
    .map((o, i) => `<figure><iframe sandbox="" srcdoc="${attr(o.preview ?? '')}"></iframe><figcaption><b>${i + 1}</b> ${text(o.label)}<p>${text(o.description)}</p></figcaption></figure>`)
    .join('\n')
  return `<!doctype html><meta charset="utf-8"><title>${text(question)}</title>
<style>
body{margin:0;padding:24px;font:15px system-ui,sans-serif;background:#f4f3ef;color:#222}
h1{font-size:20px;margin:0 0 16px}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(520px,1fr));gap:20px}
figure{margin:0;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px #0002}
iframe{width:100%;height:420px;border:0;display:block}
figcaption{padding:12px 16px}
figcaption b{display:inline-block;background:#111;color:#fff;border-radius:4px;padding:0 7px;margin-right:6px}
figcaption p{margin:6px 0 0;color:#555}
footer{margin-top:20px;color:#666}
</style>
<h1>${text(question)}</h1>
<main>
${cards}
</main>
<footer>Press the number in Claude Code to choose.</footer>`
}

const DIR = '/tmp/design-direction'
const DAY_MS = 86_400_000

// Only this mod's own <stamp>-<i>.html files, a day old or more.
async function sweep($: EngineInterface, now: number) {
  const files = await $.fs.list(DIR).catch(() => [])
  const old = files.filter(f => f.kind === 'file' && /^\d+-\d+\.html$/.test(f.name) && now - f.mtimeMs > DAY_MS)
  if (old.length) await $.process.run(['rm', '-f', ...old.map(f => `${DIR}/${f.name}`)], { timeoutMs: 10000 }).catch(() => null)
}

export const register: Register = on => {
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (!e.tools.includes('AskUserQuestion')) return r
    return { sections: [...r.sections, { id: 'design-direction:guide', text: GUIDE, scope: 'session' }] }
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const stamp = Date.now()
    await sweep($, stamp)
    const questions = await Promise.all(
      e.questions.map(async (q, i) => {
        if (!q.options.some(o => isHtml(o.preview))) return q
        const path = `${DIR}/${stamp}-${i}.html`
        await $.fs.write(path, page(q.question, q.options))
        const run = await $.process.run(['open', path], { timeoutMs: 10000 }).catch(() => null)
        const note = run?.exitCode === 0 ? `Rendered in your browser: ${path}` : `Mockup saved at ${path}, but Claude could not open the browser: open it by hand`
        return { ...q, options: q.options.map(o => (isHtml(o.preview) ? { ...o, preview: note } : o)) }
      }),
    )
    return next({ ...e, questions })
  }).catch(($, e, next) => next(e))
}
