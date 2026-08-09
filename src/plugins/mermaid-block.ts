import mermaid from 'mermaid'
import type MarkdownIt from 'markdown-it'

/**
 * Vendored from @md-reader/markdown-it-mermaid.
 *
 * The original plugin rendered diagrams synchronously via the deprecated
 * `mermaid.mermaidAPI.render(id, code, cb)` API, whose callback timing is
 * undefined in mermaid v9 — this made diagrams unreliable (empty/flashing on
 * slower loads). This version instead emits the raw diagram source in a
 * `<pre class="mermaid">` element and lets `mermaid.run()` render it after
 * the content is in the DOM (see main.ts's `contentRendered` handler).
 */

interface MermaidBlockOptions {
  theme?: string
}

export default function MermaidBlockPlugin(
  md: MarkdownIt,
  opts: MermaidBlockOptions = {},
) {
  // initialize once; disable auto-init so we control rendering via mermaid.run()
  mermaid.initialize({ startOnLoad: false, theme: opts.theme || 'default' })

  const fallbackFence = md.renderer.rules.fence.bind(md.renderer.rules)

  md.renderer.rules.fence = (
    tokens: any[],
    idx: number,
    options: any,
    env: any,
    self: any,
  ) => {
    const token = tokens[idx]
    const info = token.info.trim()
    if (info !== 'mermaid') {
      return fallbackFence(tokens, idx, options, env, self)
    }
    const code = token.content
    return `<pre class="mermaid">${code}</pre>`
  }
}
