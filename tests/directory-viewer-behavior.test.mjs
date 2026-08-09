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
    /const swapContent = \([\s\S]*?\n  \}\n\n  const tree/,
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

test('scroll state is initialized before restoring a file from the URL', async () => {
  const source = await readFile(viewerUrl, 'utf8')
  const goTopInitialization = source.indexOf('const goTopBtn')
  const initialNavigation = source.indexOf('await tree.navigateTo(initialPath)')

  assert.notEqual(goTopInitialization, -1, 'expected the go-top button')
  assert.notEqual(initialNavigation, -1, 'expected initial file navigation')
  assert.ok(
    goTopInitialization < initialNavigation,
    'onScroll can run during initial navigation, so goTopBtn must already be initialized',
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
