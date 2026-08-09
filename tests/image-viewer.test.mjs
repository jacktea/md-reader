import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const imageViewerUrl = new URL('../src/plugins/img-viewer.ts', import.meta.url)

test('image viewer collects previewable images from the current markdown page', async () => {
  const source = await readFile(imageViewerUrl, 'utf8')

  assert.match(
    source,
    /closest<HTMLElement>\(`\.\$\{className\.MD_CONTENT\}`\)/,
  )
  assert.match(source, /querySelectorAll<HTMLImageElement>\('img'\)/)
  assert.match(source, /filter\(\s*isPreviewableImage/)
})

test('image viewer switches images with left and right arrow keys', async () => {
  const source = await readFile(imageViewerUrl, 'utf8')

  assert.match(source, /e\.code === 'ArrowLeft'[\s\S]*?switchImage\(-1\)/)
  assert.match(source, /e\.code === 'ArrowRight'[\s\S]*?switchImage\(1\)/)
  assert.match(
    source,
    /\(imageIndex \+ offset \+ images\.length\) % images\.length/,
  )
})

test('image viewer restores the source image and removes keyboard handling on close', async () => {
  const source = await readFile(imageViewerUrl, 'utf8')

  assert.match(source, /document\.removeEventListener\('keydown', onKeydown\)/)
  assert.match(source, /if \(ele\) ele\.style\.visibility = ''/)
})
