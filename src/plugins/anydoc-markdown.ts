/**
 * Serialize anydoc's document model into GitHub-Flavored Markdown.
 *
 * anydoc's own `toMarkdownBytes` renders embedded images as their alt text
 * only (Markdown cannot embed bytes). This serializer walks the model
 * (`toDocument`) instead, so embedded images render as real image links
 * backed by the caller-provided asset URLs (e.g. `blob:` URLs), which is
 * what an in-browser preview needs. The rest of the output mirrors anydoc's
 * serializer: same block structure, list markers, table grid, footnote
 * numbering and escaping.
 */

import type {
  Block,
  Cell,
  Document,
  Inline,
  List,
  Note,
  Style,
  Table,
} from '@firecrawl/anydoc-wasm'

type InlineContext = 'block' | 'heading' | 'tableCell'

interface EscapeOpts {
  atLineStart?: boolean
  styled?: boolean
  trailingActive?: boolean
  inLabel?: boolean
}

/** Escape Markdown syntax in document text (port of anydoc escape_text). */
function escapeText(
  text: string,
  ctx: InlineContext,
  opts: EscapeOpts = {},
): string {
  const { atLineStart, styled, trailingActive, inLabel } = opts
  const chars = [...text]

  // Last position of each pairable delimiter; a lone one is inert.
  const last: (number | null)[] = [null, null, null, null, null] // * _ ~ ` ]
  chars.forEach((c, j) => {
    if (c === '*') last[0] = j
    else if (c === '_') last[1] = j
    else if (c === '~') last[2] = j
    else if (c === '`') last[3] = j
    else if (c === ']') last[4] = j
  })

  let out = ''
  let lineHasContent = !(atLineStart && ctx === 'block')
  let i = 0
  while (i < chars.length) {
    const c = chars[i]
    if (c === '\n') {
      out += '\n'
      if (ctx === 'block') lineHasContent = false
      i += 1
      continue
    }
    const startOfLine = !lineHasContent
    if (!/\s/.test(c)) lineHasContent = true
    const next = chars[i + 1]
    const nextNonspace = next === undefined ? trailingActive : !/\s/.test(next)
    const paired = (slot: number) =>
      trailingActive || (last[slot] !== null && last[slot]! > i)

    let escape = false
    let advanceExtra = 0
    switch (c) {
      case '\\':
        escape = true
        break
      case ']':
        escape = !!inLabel
        break
      case '`':
        escape = !!styled || paired(3)
        break
      case '*':
        escape = !!styled || startOfLine || (!!nextNonspace && paired(0))
        break
      case '_': {
        const prevAlnum = i > 0 && /[\p{L}\p{N}]/u.test(chars[i - 1])
        const nextAlnum = next !== undefined && /[\p{L}\p{N}]/u.test(next)
        escape =
          !!styled || (!!nextNonspace && !(prevAlnum && nextAlnum) && paired(1))
        break
      }
      case '~':
        escape = !!styled || (!!nextNonspace && paired(2))
        break
      case '[':
        escape = !!inLabel || paired(4)
        break
      case '<':
        escape =
          next !== undefined &&
          (/[A-Za-z]/.test(next) ||
            next === '/' ||
            next === '!' ||
            next === '?')
        break
      case '!':
        escape = next === undefined && !!trailingActive
        break
      case '|':
        escape = ctx === 'tableCell'
        break
      case '&':
        if (entityAhead(chars, i)) {
          out += '&amp;'
          i += 1
          continue
        }
        break
      case '#':
        if (startOfLine) {
          let j = i
          while (j < chars.length && chars[j] === '#') j += 1
          escape = j >= chars.length || /\s/.test(chars[j])
        }
        break
      case '-':
        if (startOfLine) {
          escape = !nextNonspace || lineIsOnly(chars, i, '-')
        }
        break
      case '+':
        if (startOfLine) escape = !nextNonspace
        break
      case '>':
        if (startOfLine) escape = true
        break
      case '=':
        if (startOfLine) escape = lineIsOnly(chars, i, '=')
        break
      default:
        if (startOfLine && c >= '0' && c <= '9') {
          let j = i
          while (j < chars.length && chars[j] >= '0' && chars[j] <= '9') j += 1
          if (
            j < chars.length &&
            (chars[j] === '.' || chars[j] === ')') &&
            (j + 1 >= chars.length || /\s/.test(chars[j + 1]))
          ) {
            out += chars.slice(i, j).join('')
            out += '\\'
            out += chars[j]
            i = j + 1
            continue
          }
        }
        break
    }
    if (escape) out += '\\'
    out += c
    if (advanceExtra > 0) {
      i += advanceExtra
    }
    i += 1
  }
  return out
}

function lineIsOnly(chars: string[], from: number, c: string): boolean {
  for (let i = from; i < chars.length && chars[i] !== '\n'; i += 1) {
    if (chars[i] !== c && chars[i] !== ' ' && chars[i] !== '\t') return false
  }
  return true
}

function entityAhead(chars: string[], from: number): boolean {
  let i = from + 1
  if (i < chars.length && chars[i] === '#') return true
  let seen = 0
  while (i < chars.length && /[A-Za-z0-9]/.test(chars[i])) {
    i += 1
    seen += 1
  }
  return seen > 0 && i < chars.length && chars[i] === ';'
}

/** Format a link destination, angle-bracketing when needed (port of format_url). */
function formatUrl(url: string): string {
  let escaped = ''
  for (const c of url) {
    if (c === '<') escaped += '%3C'
    else if (c === '>') escaped += '%3E'
    else if (c === '|') escaped += '%7C'
    else if (isControl(c)) {
      for (const byte of new TextEncoder().encode(c)) {
        escaped += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
      }
    } else escaped += c
  }
  if ([...escaped].some(c => /\s/.test(c) || c === '(' || c === ')')) {
    return `<${escaped}>`
  }
  return escaped
}

function isControl(c: string): boolean {
  return c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f
}

/** Shortest backtick fence longer than any backtick run in `text`. */
function backtickFence(text: string, min: number): string {
  const longestRun = text
    .split(/[^`]+/)
    .reduce((max, run) => Math.max(max, run.length), 0)
  return '`'.repeat(Math.max(longestRun + 1, min))
}

interface RenderCtx {
  assetUrls?: Map<number, string>
}

type TextRun = { kind: 'text'; text: string; styleKey: string; style?: Style }
type Run =
  | TextRun
  | { kind: 'link'; inline: Inline }
  | { kind: 'image'; inline: Inline }
  | { kind: 'noteRef'; id: string }
  | { kind: 'lineBreak' }
  | { kind: 'anchor' }

function styleKeyOf(style?: Style): string {
  if (!style) return ''
  return `${style.bold ? 'b' : ''}${style.italic ? 'i' : ''}${
    style.strike ? 's' : ''
  }${style.code ? 'c' : ''}`
}

function isStyledRun(run: Run): boolean {
  return run.kind === 'text' && run.styleKey !== ''
}

/**
 * Render inline runs, merging adjacent same-style text and dropping
 * whitespace-only styled runs (port of anydoc normalize + render_inlines).
 */
function renderInlines(
  inlines: Inline[],
  ctx: InlineContext,
  rc: RenderCtx,
  nums: Map<string, number>,
): string {
  // — normalize —
  const runs: Run[] = []
  const pushRuns = (list: Inline[]): void => {
    for (const inline of list) {
      if (inline.kind === 'text') {
        const text = inline.text ?? ''
        if (!text) continue
        const styleKey = styleKeyOf(inline.style)
        const lastRun = runs[runs.length - 1]
        if (
          lastRun &&
          lastRun.kind === 'text' &&
          lastRun.styleKey === styleKey
        ) {
          lastRun.text += text
          continue
        }
        runs.push({ kind: 'text', text, styleKey, style: inline.style })
      } else if (
        inline.kind === 'link' &&
        (!inline.target || !inline.target.value)
      ) {
        // No usable destination: keep the content as plain inlines.
        pushRuns(inline.content ?? [])
      } else if (inline.kind === 'link') {
        runs.push({ kind: 'link', inline })
      } else if (inline.kind === 'image') {
        runs.push({ kind: 'image', inline })
      } else if (inline.kind === 'noteRef') {
        runs.push({ kind: 'noteRef', id: inline.noteId ?? '' })
      } else if (inline.kind === 'lineBreak') {
        runs.push({ kind: 'lineBreak' })
      } else if (inline.kind === 'anchor') {
        runs.push({ kind: 'anchor' })
      }
    }
  }
  pushRuns(inlines)

  // — render —
  let out = ''
  for (let idx = 0; idx < runs.length; idx += 1) {
    const run = runs[idx]
    const next = runs[idx + 1]
    const nextActive =
      !!next &&
      (next.kind === 'link' ||
        next.kind === 'image' ||
        next.kind === 'noteRef' ||
        (isStyledRun(next) && next.text.trim().length > 0))
    switch (run.kind) {
      case 'text':
        out += renderTextRun(
          run.text,
          run.style,
          ctx,
          nextActive,
          out.length === 0,
          false,
        )
        break
      case 'link':
        out += renderLink(run.inline, ctx, rc)
        break
      case 'image':
        out += renderImage(run.inline, ctx, rc)
        break
      case 'noteRef': {
        const num = nums.get(run.id)
        if (num !== undefined) out += `[^${num}]`
        break
      }
      case 'lineBreak':
        out += ctx === 'heading' ? ' ' : '\\\n'
        break
      case 'anchor':
        // Zero-width target marker; anydoc emits <a id> only for resolved
        // targets, which we don't track.
        break
    }
  }
  return out
}

function renderTextRun(
  text: string,
  style: Style | undefined,
  ctx: InlineContext,
  trailingActive: boolean,
  atLineStart: boolean,
  inLabel: boolean,
): string {
  if (!style || styleKeyOf(style) === '') {
    return escapeText(text, ctx, { atLineStart, trailingActive, inLabel })
  }
  const coreStart = text.length - text.trimStart().length
  const coreEnd = text.trimEnd().length
  const lead = text.slice(0, coreStart)
  const core = text.slice(coreStart, coreEnd)
  const trail = text.slice(coreEnd)
  let s = lead
  if (core) {
    if (style.code) {
      s += pushCodeSpan(core)
    } else {
      let open = ''
      if (style.strike) open += '~~'
      if (style.bold) open += '**'
      if (style.italic) open += '*'
      const close = [...open].reverse().join('')
      s += open
      s += escapeText(core, ctx, {
        styled: true,
        inLabel,
        atLineStart: false,
        trailingActive: false,
      })
      s += close
    }
  }
  s += trail
  return s
}

function pushCodeSpan(text: string): string {
  const t = text.replace(/\n/g, ' ')
  const fence = backtickFence(t, 1)
  const pad = t.startsWith('`') || t.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${t}${pad}${fence}`
}

function renderLink(
  inline: Inline,
  ctx: InlineContext,
  rc: RenderCtx,
  nums: Map<string, number>,
): string {
  const target = inline.target!
  const label = renderInlines(inline.content ?? [], ctx, rc, nums)
  let url: string
  if (target.kind === 'anchor') {
    url = `#${target.value}`
  } else {
    url = target.value
  }
  const trimmed = label.trim()
  if (!trimmed) {
    return `[${escapeUrlAsText(url, ctx)}](${formatUrl(url)})`
  }
  return `[${label}](${formatUrl(url)})`
}

function renderImage(
  inline: Inline,
  ctx: InlineContext,
  rc: RenderCtx,
): string {
  const alt = (inline.alt ?? '').trim()
  const source = inline.source
  if (source?.kind === 'external' && source.url) {
    return `![${escapeText(alt, ctx, { inLabel: true })}](${formatUrl(
      source.url,
    )})`
  }
  if (source?.kind === 'asset' && source.assetId !== undefined) {
    const url = rc.assetUrls?.get(source.assetId)
    if (url) {
      return `![${escapeText(alt, ctx, { inLabel: true })}](${formatUrl(url)})`
    }
  }
  // Embedded without a usable asset URL, or unavailable: alt text only,
  // mirroring anydoc's serializer.
  return alt ? escapeText(alt, ctx, { inLabel: false }) : ''
}

function escapeUrlAsText(url: string, ctx: InlineContext): string {
  const cleaned = [...url].map(c => (isControl(c) ? ' ' : c)).join('')
  return escapeText(cleaned, ctx, { trailingActive: true, inLabel: true })
}

export interface SerializeOptions {
  /** Map of anydoc asset id -> display URL (e.g. blob: URL). */
  assetUrls?: Map<number, string>
}

/** Serialize an anydoc document model to GitHub-Flavored Markdown. */
export function serializeDocument(
  doc: Document,
  options: SerializeOptions = {},
): string {
  const rc: RenderCtx = { assetUrls: options.assetUrls }
  const nums = numberNotes(doc)
  const parts: string[] = []
  for (const block of doc.blocks) {
    const rendered = renderBlock(block, rc, nums)
    if (rendered) parts.push(rendered)
  }

  const renderedDefs = new Set<number>()
  const ordered = doc.notes
    .map((note): [Note, number | undefined] => [note, nums.get(note.id)])
    .filter((entry): entry is [Note, number] => entry[1] !== undefined)
    .sort((a, b) => a[1] - b[1])
  for (const [note, num] of ordered) {
    const body = renderBlocks(note.blocks, rc, nums)
    if (!body.trim()) continue
    if (renderedDefs.has(num)) continue
    renderedDefs.add(num)
    const lines = body.split('\n')
    let s = `[^${num}]: ${lines[0]}`
    for (const line of lines.slice(1)) {
      s += '\n'
      if (line) s += '    ' + line
    }
    parts.push(s)
  }

  let out = parts.join('\n\n')
  if (out) out += '\n'
  return out
}

function numberNotes(doc: Document): Map<string, number> {
  const valid = new Map<string, Note>()
  for (const note of doc.notes) {
    if (!note.blocks.every(blockIsBlank)) {
      if (!valid.has(note.id)) valid.set(note.id, note)
    }
  }
  const order: string[] = []
  const seen = new Set<string>()
  collectNoteRefs(doc.blocks, valid, order, seen)
  for (const note of doc.notes) {
    if (valid.has(note.id) && !seen.has(note.id)) {
      seen.add(note.id)
      order.push(note.id)
    }
  }
  const nums = new Map<string, number>()
  order.forEach((id, i) => nums.set(id, i + 1))
  return nums
}

function blockIsBlank(block: Block): boolean {
  return (
    block.kind === 'paragraph' &&
    (block.content ?? []).every(
      i => i.kind !== 'text' || !(i.text ?? '').trim(),
    )
  )
}

function collectNoteRefs(
  blocks: Block[],
  valid: Map<string, Note>,
  order: string[],
  seen: Set<string>,
): void {
  const walkInlines = (inlines: Inline[]): void => {
    for (const inline of inlines) {
      if (inline.kind === 'noteRef' && inline.noteId) {
        const note = valid.get(inline.noteId)
        if (note && !seen.has(inline.noteId)) {
          seen.add(inline.noteId)
          order.push(inline.noteId)
          collectNoteRefs(note.blocks, valid, order, seen)
        }
      } else if (inline.kind === 'link') {
        walkInlines(inline.content ?? [])
      }
    }
  }
  for (const block of blocks) {
    if (block.kind === 'paragraph' || block.kind === 'heading') {
      walkInlines(block.content ?? [])
    } else if (block.kind === 'list' && block.list) {
      for (const item of block.list.items) {
        collectNoteRefs(item.blocks, valid, order, seen)
      }
    } else if (block.kind === 'table' && block.table) {
      for (const row of block.table.grid) {
        for (const slot of row) {
          if (slot.kind === 'origin' && slot.cell) {
            collectNoteRefs(slot.cell.blocks, valid, order, seen)
          }
        }
      }
    } else if (block.kind === 'blockQuote') {
      collectNoteRefs(block.blocks ?? [], valid, order, seen)
    }
  }
}

function renderBlocks(
  blocks: Block[],
  rc: RenderCtx,
  nums: Map<string, number>,
): string {
  const parts: string[] = []
  for (const block of blocks) {
    const rendered = renderBlock(block, rc, nums)
    if (rendered) parts.push(rendered)
  }
  return parts.join('\n\n')
}

function renderBlock(
  block: Block,
  rc: RenderCtx,
  nums: Map<string, number>,
): string | null {
  switch (block.kind) {
    case 'heading': {
      const text = renderInlines(
        block.content ?? [],
        'heading',
        rc,
        nums,
      ).trim()
      if (!text) return null
      const level = Math.min(Math.max(block.level ?? 1, 1), 6)
      return `${'#'.repeat(level)} ${text}`
    }
    case 'paragraph': {
      const text = renderInlines(block.content ?? [], 'block', rc, nums)
      const trimmed = trimParagraph(text)
      return trimmed || null
    }
    case 'list':
      return renderList(block.list!, rc, nums)
    case 'table': {
      const table = block.table!
      // Trivial layout tables are scaffolding; render their content directly.
      if (table.kind === 'layout' && isSingleCell(table)) {
        const cell = table.grid[0][0].cell!
        const inner = renderBlocks(cell.blocks, rc, nums)
        return inner || null
      }
      return renderTable(table, rc, nums)
    }
    case 'blockQuote': {
      const inner = renderBlocks(block.blocks ?? [], rc, nums)
      if (!inner) return null
      return inner
        .split('\n')
        .map(line => (line ? `> ${line}` : '>'))
        .join('\n')
    }
    case 'codeBlock': {
      const fence = backtickFence(block.text ?? '', 3)
      const lang = block.lang ?? ''
      const body = (block.text ?? '').replace(/\n+$/, '')
      return `${fence}${lang}\n${body}\n${fence}`
    }
    case 'rule':
      return '---'
  }
}

function isSingleCell(table: Table): boolean {
  return (
    table.grid.length === 1 &&
    table.grid[0].length === 1 &&
    table.grid[0][0].kind === 'origin'
  )
}

function renderList(
  list: List,
  rc: RenderCtx,
  nums: Map<string, number>,
): string | null {
  if (list.items.length === 0) return null
  const renderedItems: string[] = []
  let loose = false
  for (let i = 0; i < list.items.length; i += 1) {
    const item = list.items[i]
    let marker: string
    if (item.markerLabel) {
      marker = `- ${escapeMarkerLabel(item.markerLabel)} `
    } else if (list.marker === 'bullet') {
      marker = '- '
    } else if (list.marker === 'decimal') {
      marker = `${list.start + i}. `
    } else {
      marker = `- ${markerLabel(list.marker, list.start + i)} `
    }
    const checkbox =
      item.checked === true ? '[x] ' : item.checked === false ? '[ ] ' : ''
    const body = renderBlocks(item.blocks, rc, nums)
    if (item.blocks.length > 1) loose = true
    const indent = ' '.repeat([...marker].length)
    const lines = body.split('\n')
    let s = `${marker}${checkbox}${lines[0]}`
    for (const line of lines.slice(1)) {
      s += '\n'
      if (!line) loose = true
      else s += indent + line
    }
    renderedItems.push(s)
  }
  return renderedItems.join(loose ? '\n\n' : '\n')
}

function escapeMarkerLabel(label: string): string {
  const cleaned = [...label].map(c => (isControl(c) ? ' ' : c)).join('')
  return escapeText(cleaned, 'block', {
    atLineStart: true,
    trailingActive: true,
  })
}

function markerLabel(marker: List['marker'], n: number): string {
  switch (marker) {
    case 'lowerAlpha':
      return alpha(n)
    case 'upperAlpha':
      return alpha(n).toUpperCase()
    case 'lowerRoman':
      return roman(n)
    case 'upperRoman':
      return roman(n).toUpperCase()
    default:
      return String(n)
  }
}

/** 1 -> a, 26 -> z, 27 -> aa (bijective base 26). */
function alpha(n: number): string {
  if (n <= 0) return '0'
  let out = ''
  let m = n
  while (m > 0) {
    m -= 1
    out = String.fromCharCode(97 + (m % 26)) + out
    m = Math.floor(m / 26)
  }
  return out
}

function roman(n: number): string {
  if (n <= 0 || n > 3999) return String(n)
  const numerals: [number, string][] = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ]
  let out = ''
  let m = n
  for (const [value, numeral] of numerals) {
    while (m >= value) {
      out += numeral
      m -= value
    }
  }
  return out
}

function renderTable(
  table: Table,
  rc: RenderCtx,
  nums: Map<string, number>,
): string | null {
  if (table.grid.length === 0) return null
  const width = table.grid.reduce((max, row) => Math.max(max, row.length), 0)
  const rendered = table.grid.map(row => {
    const cells = row.map(slot =>
      slot.kind === 'origin' && slot.cell
        ? { text: renderCell(slot.cell, rc, nums), covered: false }
        : { text: '', covered: true },
    )
    while (cells.length < width) cells.push({ text: '', covered: false })
    return cells
  })
  // Drop trailing blank rows.
  while (
    rendered.length > 1 &&
    rendered[rendered.length - 1].every(c => !c.text && !c.covered)
  ) {
    rendered.pop()
  }
  let w = 0
  for (const row of rendered) {
    let last = 0
    row.forEach((c, i) => {
      if (c.text || c.covered) last = i + 1
    })
    w = Math.max(w, last)
  }
  if (w === 0) return null
  for (const row of rendered) row.length = w

  let out = ''
  const header: string[] =
    table.headerRows >= 1 && rendered.length > 0
      ? rendered.shift()!.map(c => c.text)
      : new Array(w).fill('')
  out += formatRow(header)
  out += '\n'
  out += formatRow(new Array(w).fill('---'))
  for (const row of rendered) {
    out += '\n'
    out += formatRow(row.map(c => c.text))
  }
  return out
}

function formatRow(cells: string[]): string {
  return '|' + cells.map(c => ` ${c} |`).join('')
}

function renderCell(
  cell: Cell,
  rc: RenderCtx,
  nums: Map<string, number>,
): string {
  const parts: string[] = []
  for (const block of cell.blocks) {
    cellBlockText(block, rc, nums, parts)
  }
  return parts
    .join('<br>')
    .split('\n')
    .filter(l => l.trim())
    .map(l => l.trim())
    .join('<br>')
}

function cellBlockText(
  block: Block,
  rc: RenderCtx,
  nums: Map<string, number>,
  parts: string[],
): void {
  switch (block.kind) {
    case 'heading': {
      const t = renderInlines(block.content ?? [], 'tableCell', rc, nums).trim()
      if (t) parts.push(`**${t}**`)
      break
    }
    case 'paragraph': {
      const t = renderInlines(block.content ?? [], 'tableCell', rc, nums).trim()
      if (t) parts.push(t)
      break
    }
    case 'list': {
      const list = block.list!
      list.items.forEach((item, i) => {
        const inner: string[] = []
        for (const b of item.blocks) cellBlockText(b, rc, nums, inner)
        const marker = item.markerLabel
          ? `${escapeMarkerLabel(item.markerLabel)} `
          : list.marker === 'bullet'
          ? '• '
          : `${markerLabel(list.marker, list.start + i)} `
        if (inner.length) parts.push(`${marker}${inner.join(' ')}`)
      })
      break
    }
    case 'table': {
      const table = block.table!
      for (const row of table.grid) {
        const cells = row.map(slot =>
          slot.kind === 'origin' && slot.cell
            ? renderCell(slot.cell, rc, nums)
            : '',
        )
        if (cells.some(c => c)) parts.push(cells.join(' / '))
      }
      break
    }
    case 'blockQuote':
      for (const b of block.blocks ?? []) cellBlockText(b, rc, nums, parts)
      break
    case 'codeBlock': {
      const t = (block.text ?? '').trim()
      if (t) parts.push(pushCodeSpan(t))
      break
    }
    case 'rule':
      break
  }
}

/** Trim paragraph lines, keeping hard-break backslashes intact. */
function trimParagraph(text: string): string {
  const lines = text.split('\n').map(l => {
    let t = l.trimStart()
    t = endsWithHardBreak(t) ? t : t.trimEnd()
    if (!t.trimEnd().replace(/\\+$/, '').trim()) return ''
    return t
  })
  let start = lines.findIndex(l => l !== '')
  let end = lines
    .map((l, i) => (l !== '' ? i : -1))
    .reduce((a, b) => Math.max(a, b), -1)
  if (start < 0 || end < 0) return ''
  let out = lines.slice(start, end + 1).join('\n')
  if (endsWithHardBreak(out)) {
    out = out.slice(0, -1).trimEnd()
  }
  return out
}

function endsWithHardBreak(line: string): boolean {
  let count = 0
  for (let i = line.length - 1; i >= 0 && line[i] === '\\'; i -= 1) count += 1
  return count % 2 === 1
}
