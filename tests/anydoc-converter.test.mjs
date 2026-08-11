import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initSync, toDocument } from '@firecrawl/anydoc-wasm'
import { serializeDocument } from '../src/plugins/anydoc-markdown.ts'

// Node has no fetch-based loader for wasm-pack `--target web` output; the
// package ships `initSync` for byte input, which is what we use here. The
// extension loads the same wasm binary via `init()` from the extension page.
const wasmPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../node_modules/@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm',
)
initSync(await readFile(wasmPath))

// ——— minimal ZIP writer (stored + deflate via zlib) ———

import { deflateRawSync } from 'node:zlib'

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  let crc = 0xffffffff
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Build a minimal ZIP buffer. `entries`: [{name, data (Buffer|string),
 * store? (uncompressed)}].
 */
function buildZip(entries) {
  const chunks = []
  const central = []
  let offset = 0
  for (const entry of entries) {
    const data =
      typeof entry.data === 'string'
        ? Buffer.from(entry.data, 'utf8')
        : entry.data
    const crc = crc32(data)
    const method = entry.store ? 0 : 8
    const compressed = entry.store ? data : deflateRawSync(data)
    const nameBuf = Buffer.from(entry.name, 'utf8')

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // flags: utf8
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(0, 10) // time/date
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra len
    chunks.push(local, nameBuf, compressed)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(method, 10)
    centralHeader.writeUInt32LE(0, 12)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(compressed.length, 20)
    centralHeader.writeUInt32LE(data.length, 24)
    centralHeader.writeUInt16LE(nameBuf.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    central.push(centralHeader, nameBuf)
    offset += local.length + nameBuf.length + compressed.length
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...chunks, ...central, end])
}

// ——— sample files ———

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function buildDocx(withImage = false) {
  const imageRun = withImage
    ? `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="609600" cy="609600"/><wp:docPr id="1" name="Picture 1"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="Picture 1"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId5"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="609600" cy="609600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
    : ''
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Docx Heading</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Plain paragraph with </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold text</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>
    <w:p>${imageRun}</w:p>
    <w:sectPr/>
  </w:body>
</w:document>`

  const entries = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      name: 'word/styles.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:outlineLvl w:val="0"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
</w:styles>`,
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: withImage
        ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`
        : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
    },
  ]
  if (withImage) {
    entries.push({ name: 'word/media/image1.png', data: PNG_1x1 })
  }
  entries.push({ name: 'word/document.xml', data: documentXml })
  return buildZip(entries)
}

function buildEpub() {
  const entries = [
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    {
      name: 'META-INF/container.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    },
    {
      name: 'OEBPS/content.opf',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Sample</dc:title></metadata>
  <manifest>
    <item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="img" href="image.png" media-type="image/png"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`,
    },
    {
      name: 'OEBPS/chapter.xhtml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head>
<body>
  <h1>Epub Chapter</h1>
  <p>First paragraph of the ebook.</p>
  <p><img src="image.png" alt="Cover art"/></p>
</body></html>`,
    },
    { name: 'OEBPS/image.png', data: PNG_1x1 },
    {
      name: 'OEBPS/toc.ncx',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap/></ncx>`,
    },
  ]
  return buildZip(entries)
}

// ——— tests ———

test('csv converts to a markdown table', () => {
  const bytes = new Uint8Array(
    Buffer.from('name,count\nalpha,1\nbeta,2\n', 'utf8'),
  )
  const doc = toDocument(bytes, 'csv')
  const md = serializeDocument(doc)
  assert.match(md, /name/)
  assert.match(md, /alpha/)
  assert.match(md, /\|/)
})

test('docx converts text, headings and bold', () => {
  const doc = toDocument(new Uint8Array(buildDocx(false)), 'docx')
  const md = serializeDocument(doc)
  assert.match(md, /# Docx Heading/)
  assert.match(md, /Plain paragraph with \*\*bold text\*\*\./)
})

test('docx embedded image renders as image markdown with asset url', () => {
  const doc = toDocument(new Uint8Array(buildDocx(true)), 'docx')
  const assetUrls = new Map(doc.assets.map(a => [a.id, `blob:asset-${a.id}`]))
  const md = serializeDocument(doc, { assetUrls })
  assert.ok(
    doc.assets.length >= 1,
    'document model should carry the image asset',
  )
  assert.match(
    md,
    /!\[.*\]\(blob:asset-\d+\)/,
    'embedded image should use the asset url',
  )
  assert.match(doc.assets[0].mediaType, /image\/png/)
})

test('epub converts chapters and embedded images', () => {
  const doc = toDocument(new Uint8Array(buildEpub()), 'epub')
  const md = serializeDocument(doc, {
    assetUrls: new Map(doc.assets.map(a => [a.id, `blob:epub-${a.id}`])),
  })
  assert.match(md, /# Epub Chapter/)
  assert.match(md, /First paragraph of the ebook\./)
  assert.ok(doc.assets.length >= 1, 'epub should carry image assets')
  assert.match(md, /!\[.*\]\(blob:epub-\d+\)/)
})

// ——— synthetic model: tables, lists, footnotes ———

test('serializer renders merged-cell tables as blank covered cells', () => {
  const doc = {
    blocks: [
      {
        kind: 'table',
        table: {
          headerRows: 1,
          kind: 'data',
          grid: [
            [
              {
                kind: 'origin',
                cell: {
                  blocks: [
                    {
                      kind: 'paragraph',
                      content: [{ kind: 'text', text: 'A', style: {} }],
                    },
                  ],
                  colSpan: 1,
                  rowSpan: 1,
                },
              },
              {
                kind: 'origin',
                cell: {
                  blocks: [
                    {
                      kind: 'paragraph',
                      content: [{ kind: 'text', text: 'B', style: {} }],
                    },
                  ],
                  colSpan: 1,
                  rowSpan: 1,
                },
              },
            ],
            [
              {
                kind: 'origin',
                cell: {
                  blocks: [
                    {
                      kind: 'paragraph',
                      content: [{ kind: 'text', text: 'C', style: {} }],
                    },
                  ],
                  colSpan: 2,
                  rowSpan: 1,
                },
              },
              { kind: 'covered', originRow: 1, originCol: 0 },
            ],
          ],
        },
      },
    ],
    notes: [],
    assets: [],
  }
  const md = serializeDocument(doc)
  assert.match(md, /\| A \| B \|/)
  assert.match(md, /\| C \|  \|/)
})

test('serializer renders nested lists and task items', () => {
  const doc = {
    blocks: [
      {
        kind: 'list',
        list: {
          marker: 'bullet',
          start: 1,
          items: [
            {
              checked: true,
              blocks: [
                {
                  kind: 'paragraph',
                  content: [{ kind: 'text', text: 'todo item', style: {} }],
                },
              ],
            },
            {
              checked: undefined,
              blocks: [
                {
                  kind: 'paragraph',
                  content: [{ kind: 'text', text: 'parent', style: {} }],
                },
                {
                  kind: 'list',
                  list: {
                    marker: 'decimal',
                    start: 1,
                    items: [
                      {
                        blocks: [
                          {
                            kind: 'paragraph',
                            content: [
                              { kind: 'text', text: 'child', style: {} },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    ],
    notes: [],
    assets: [],
  }
  const md = serializeDocument(doc)
  assert.match(md, /- \[x\] todo item/)
  assert.match(md, /- parent/)
  assert.match(md, /1\. child/)
})

test('serializer emits footnote definitions in reference order', () => {
  const doc = {
    blocks: [
      {
        kind: 'paragraph',
        content: [
          { kind: 'text', text: 'with a note', style: {} },
          { kind: 'noteRef', noteId: 'n2' },
        ],
      },
    ],
    notes: [
      {
        id: 'n1',
        kind: 'footnote',
        blocks: [
          {
            kind: 'paragraph',
            content: [{ kind: 'text', text: 'second note', style: {} }],
          },
        ],
      },
      {
        id: 'n2',
        kind: 'footnote',
        blocks: [
          {
            kind: 'paragraph',
            content: [{ kind: 'text', text: 'first note', style: {} }],
          },
        ],
      },
    ],
    assets: [],
  }
  const md = serializeDocument(doc)
  assert.match(md, /with a note\[\^1\]/)
  assert.match(md, /\[\^1\]: first note/)
  assert.match(md, /\[\^2\]: second note/)
})

test('paragraph text with markdown syntax is escaped', () => {
  const doc = {
    blocks: [
      {
        kind: 'paragraph',
        content: [{ kind: 'text', text: 'a *b* [c] `d`', style: {} }],
      },
    ],
    notes: [],
    assets: [],
  }
  const md = serializeDocument(doc)
  // anydoc escapes only where a character could parse as Markdown syntax:
  // the opening delimiters are escaped, trailing lone delimiters are inert.
  assert.equal(md.trim(), 'a \\*b* \\[c] \\`d`')
})
