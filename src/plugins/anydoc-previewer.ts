/**
 * anydoc office/epub preview plugin.
 *
 * Converts Word/PowerPoint/Excel/OpenDocument/RTF/EPUB/CSV files to Markdown
 * in the browser via the @firecrawl/anydoc-wasm WebAssembly build, and
 * renders embedded images from the document model as blob: URLs. PDF stays
 * on the native iframe preview (it preserves layout and page navigation).
 *
 * The WASM module (~6 MB) is embedded in the extension and fetched lazily on
 * the first office file preview — opening a directory or a markdown file
 * never pays the load cost.
 */

import init, {
  formatFromExtension,
  toDocument,
  toMarkdownBytes,
  type Document,
} from '@firecrawl/anydoc-wasm'
import wasmUrl from '@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm'
import { registerBinaryConverter } from '@/core/converters'
import { serializeDocument } from './anydoc-markdown'

const EXTS = [
  // Word
  'doc',
  'docx',
  'docm',
  // PowerPoint
  'ppt',
  'pps',
  'pot',
  'pptx',
  'pptm',
  'ppsx',
  'ppsm',
  // Excel
  'xls',
  'xlsx',
  'xlsm',
  'xlsb',
  // OpenDocument
  'odt',
  'ods',
  'odp',
  // other
  'rtf',
  'epub',
  'csv',
]

let wasmReady: Promise<void> | null = null

function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = init(wasmUrl).then(() => undefined)
  }
  return wasmReady
}

/** Resolve embedded assets to blob: URLs for the lifetime of the preview. */
function buildAssetUrls(doc: Document): Map<number, string> {
  const map = new Map<number, string>()
  for (const asset of doc.assets) {
    const blob = new Blob([asset.data], { type: asset.mediaType })
    map.set(asset.id, URL.createObjectURL(blob))
  }
  return map
}

export default function anydocPreviewerPlugin(): void {
  registerBinaryConverter({
    extensions: EXTS,
    async convert(file, name) {
      await ensureWasm()
      const bytes = new Uint8Array(await file.arrayBuffer())
      const ext = name.split('.').pop()?.toLowerCase()
      const format = ext ? formatFromExtension(ext) : undefined

      try {
        // Document model first: it carries the embedded assets we render
        // as real images. Unsupported for PDF, which we exclude anyway.
        const doc = toDocument(bytes, format)
        const assetUrls = buildAssetUrls(doc)
        return { markdown: serializeDocument(doc, { assetUrls }) }
      } catch (err) {
        // Some formats fail the document-model path (e.g. resource-heavy
        // layouts); fall back to the plain markdown serializer, which has
        // no image assets but still renders the document.
        try {
          const markdown = toMarkdownBytes(bytes, format)
          return { markdown }
        } catch (fallbackErr) {
          console.error(`[anydoc] failed to convert ${name}:`, err, fallbackErr)
          return null
        }
      }
    },
  })
}
