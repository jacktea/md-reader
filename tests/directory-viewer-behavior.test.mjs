import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const directoryTreeUrl = new URL(
  '../src/core/directory-tree.ts',
  import.meta.url,
)
const viewerUrl = new URL('../src/viewer/viewer.ts', import.meta.url)
const localImagesUrl = new URL('../src/core/local-images.ts', import.meta.url)
const sidebarTabsUrl = new URL('../src/core/sidebar-tabs.ts', import.meta.url)

test('restoring a stored directory does not request permission without a user gesture', async () => {
  const source = await readFile(directoryTreeUrl, 'utf8')
  const init = source.match(
    /private async init\(\): Promise<void> \{([\s\S]*?)\n  \}\n\n  \/\*\* Open the directory picker/,
  )

  assert.ok(init, 'expected to find DirectoryTree.init')
  assert.match(init[1], /queryPermission/)
  assert.doesNotMatch(init[1], /requestPermission/)
})

test('content swap preserves relative image paths for handle-based loading', async () => {
  const source = await readFile(viewerUrl, 'utf8')
  const swapContent = source.match(
    /const swapContent = \([\s\S]*?\n  \}\n\n  \/\*\*/,
  )

  assert.ok(swapContent, 'expected to find the viewer content swap')
  assert.match(swapContent[0], /prepareRelativeImages/)
})

test('directory viewer forwards image clicks to the preview plugins', async () => {
  const source = await readFile(viewerUrl, 'utf8')

  assert.match(
    source,
    /mdContent\.on\([\s\S]*?['"]click['"][\s\S]*?globalEvent\.emit\([\s\S]*?['"]click['"][\s\S]*?e\.target/,
  )
})

test('scroll state is initialized before rendering a file', async () => {
  const source = await readFile(viewerUrl, 'utf8')
  const goTopInitialization = source.indexOf('const goTopBtn')
  const fileRendering = source.indexOf('renderFileHandle(pendingFile')

  assert.notEqual(goTopInitialization, -1, 'expected the go-top button')
  assert.notEqual(fileRendering, -1, 'expected file rendering')
  assert.ok(
    goTopInitialization < fileRendering,
    'onScroll can run during initial file rendering, so goTopBtn must already be initialized',
  )
})

test('a newly added inactive tab panel is hidden immediately', async () => {
  const source = await readFile(sidebarTabsUrl, 'utf8')
  const addTab = source.match(
    /addTab\(id: string,[\s\S]*?\n  \}\n\n  private async restoreTab/,
  )

  assert.ok(addTab, 'expected to find SidebarTabs.addTab')
  assert.match(addTab[0], /this\.applyActiveTab\(\)/)
})

test('source button toggles directory content between raw and preview', async () => {
  const source = await readFile(viewerUrl, 'utf8')
  const rawButton = source.match(
    /\/\* raw toggle button \*\/[\s\S]*?\/\* side expand button \*\//,
  )

  assert.ok(rawButton, 'expected to find the raw toggle button')
  assert.match(rawButton[0], /rawToggleBtn\.on\(['"]click['"]/)
  assert.match(rawButton[0], /toggleRawContent/)
})

test('relative images are masked while absolute images are left alone', async () => {
  const { prepareRelativeImages, TRANSPARENT_IMAGE_PLACEHOLDER } = await import(
    localImagesUrl
  )
  const relativeAttributes = new Map([['src', 'images/diagram.png']])
  const absoluteAttributes = new Map([
    ['src', 'https://example.com/diagram.png'],
  ])
  const relativeImage = {
    getAttribute: name => relativeAttributes.get(name) ?? null,
    setAttribute: (name, value) => relativeAttributes.set(name, value),
    src: 'images/diagram.png',
  }
  const absoluteImage = {
    getAttribute: name => absoluteAttributes.get(name) ?? null,
    setAttribute: (name, value) => absoluteAttributes.set(name, value),
    src: 'https://example.com/diagram.png',
  }
  const container = {
    querySelectorAll: () => [relativeImage, absoluteImage],
  }

  prepareRelativeImages(container)

  assert.equal(relativeAttributes.get('data-rel-src'), 'images/diagram.png')
  assert.equal(relativeImage.src, TRANSPARENT_IMAGE_PLACEHOLDER)
  assert.equal(absoluteAttributes.has('data-rel-src'), false)
  assert.equal(absoluteImage.src, 'https://example.com/diagram.png')
})

test('binary preview falls back to registered converters with a loading state', async () => {
  const source = await readFile(viewerUrl, 'utf8')

  assert.match(source, /findBinaryConverter\(name\)/)
  assert.match(source, /正在转换/)
  assert.match(source, /converter\.convert\(file, name\)/)
  assert.match(source, /previewBinary\(handle, name, mdContent, mdSideList\)/)
})

test('viewer reads the anydoc toggle from storage', async () => {
  const source = await readFile(viewerUrl, 'utf8')

  assert.match(source, /storage\.get\(['"]anydocEnabled['"]\)/)
  assert.match(source, /configData\.anydocEnabled/)
})

test('viewer accepts dropped files through the anydoc pipeline', async () => {
  const source = await readFile(viewerUrl, 'utf8')

  assert.match(source, /addEventListener\(['"]dragover['"]/)
  assert.match(source, /addEventListener\(['"]drop['"]/)
  assert.match(source, /e\.dataTransfer\?\.files\?\.\[0\]/)
  assert.match(source, /tryConvertAndRender\(file, file\.name\)/)
})

test('extension manifest allows wasm instantiation', async () => {
  const manifestUrl = new URL('../src/manifest.json', import.meta.url)
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))

  assert.ok(
    manifest.content_security_policy,
    'expected a content_security_policy',
  )
  assert.match(
    manifest.content_security_policy.extension_pages,
    /'wasm-unsafe-eval'/,
  )
  assert.ok(
    manifest.permissions.includes('downloads'),
    'needs downloads for MIME-based interception',
  )
  assert.ok(
    !manifest.permissions.includes('declarativeNetRequest'),
    'MIME interception replaces URL-suffix redirects',
  )
})

test('background intercepts remote office/epub downloads by MIME', async () => {
  const backgroundUrl = new URL('../src/background.ts', import.meta.url)
  const source = await readFile(backgroundUrl, 'utf8')

  assert.match(source, /chrome\.downloads\.onCreated/)
  assert.match(source, /OFFICE_MIME_RE/)
  assert.match(source, /item\.mime/)
  assert.match(source, /anydocEnabled/)
  assert.match(source, /downloads\.cancel\(item\.id\)/)
  assert.match(source, /getURL\(\s*['"]viewer\.html['"],?\s*\)/)
})

test('viewer renders remote office files via #remote= hash', async () => {
  const source = await readFile(viewerUrl, 'utf8')

  assert.match(source, /previewRemoteFile/)
  assert.match(source, /#remote=\(\.\+\)\$/)
  assert.match(source, /fetch\(url, \{ credentials: 'include' \}\)/)
})
