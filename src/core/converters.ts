/**
 * Binary-file preview converters.
 *
 * The directory viewer's `previewBinary` handles images and PDFs natively;
 * anything else falls through to "无法预览". Plugins (e.g. the anydoc
 * office/epub converter) register a converter here so the viewer can render
 * the bytes as Markdown instead.
 */

export interface BinaryConverterResult {
  markdown: string
}

export interface BinaryConverter {
  /** File extensions (lowercase, no leading dot) this converter handles. */
  extensions: string[]
  /**
   * Convert a binary file to Markdown, or return null when the file cannot
   * be converted (unknown/encrypted/unsupported). The caller keeps the
   * markdown render + outline refresh to itself.
   */
  convert(file: File, name: string): Promise<BinaryConverterResult | null>
}

const converters: BinaryConverter[] = []

export function registerBinaryConverter(converter: BinaryConverter): void {
  converters.push(converter)
}

/** Find the first registered converter that handles `name`'s extension. */
export function findBinaryConverter(name: string): BinaryConverter | null {
  const ext = name.split('.').pop()?.toLowerCase()
  if (!ext) return null
  return converters.find(c => c.extensions.includes(ext)) ?? null
}
